import type { CallRecord, QosRecord, SmsRecord } from '../types'
import { parseCsvText, resolveColumn, toDate, toNumber } from './csv'

/**
 * Column resolution is tolerant of real-world RingCentral export naming
 * (e.g. "Duration (Seconds)" vs "Call Duration" vs "Length") so a genuine
 * export can usually be dropped in without a remap step.
 */

export function parseCallLogCsv(text: string): CallRecord[] {
  const { headers, rows } = parseCsvText(text)

  const col = {
    id: resolveColumn(headers, ['Call ID', 'CallId', 'ID']),
    start: resolveColumn(headers, ['Start Time', 'Date/Time', 'Date Time', 'Started', 'Call Start Time']),
    direction: resolveColumn(headers, ['Direction']),
    fromName: resolveColumn(headers, ['From Name', 'Caller Name']),
    fromNumber: resolveColumn(headers, ['From Number', 'From', 'Caller ID']),
    toName: resolveColumn(headers, ['To Name', 'Callee Name']),
    toNumber: resolveColumn(headers, ['To Number', 'To', 'Callee Number']),
    extension: resolveColumn(headers, ['Extension Number', 'Extension', 'Ext']),
    extensionName: resolveColumn(headers, ['Extension Name', 'Agent Name', 'User Name']),
    department: resolveColumn(headers, ['Department', 'Queue', 'Team']),
    duration: resolveColumn(headers, ['Duration (Seconds)', 'Duration', 'Call Duration', 'Length (Seconds)']),
    result: resolveColumn(headers, ['Result', 'Action Result', 'Call Result', 'Status']),
    recorded: resolveColumn(headers, ['Recorded', 'Recording']),
  }

  const records: CallRecord[] = []
  for (const row of rows) {
    const start = toDate(col.start ? row[col.start] : undefined)
    if (!start) continue
    const direction = (col.direction ? row[col.direction] : '') as CallRecord['direction']
    records.push({
      callId: (col.id ? row[col.id] : undefined) ?? `${start.getTime()}-${records.length}`,
      startTime: start,
      direction: direction === 'Outbound' ? 'Outbound' : 'Inbound',
      fromName: (col.fromName ? row[col.fromName] : '') ?? '',
      fromNumber: (col.fromNumber ? row[col.fromNumber] : '') ?? '',
      toName: (col.toName ? row[col.toName] : '') ?? '',
      toNumber: (col.toNumber ? row[col.toNumber] : '') ?? '',
      extension: (col.extension ? row[col.extension] : '') ?? '',
      extensionName: (col.extensionName ? row[col.extensionName] : '') ?? 'Unassigned',
      department: (col.department ? row[col.department] : '') || 'Unassigned',
      durationSeconds: toNumber(col.duration ? row[col.duration] : undefined),
      result: (col.result ? row[col.result] : '') || 'Unknown',
      recorded: /^y/i.test((col.recorded ? row[col.recorded] : '') ?? ''),
    })
  }
  return records
}

export function parseQosCsv(text: string): QosRecord[] {
  const { headers, rows } = parseCsvText(text)

  const col = {
    date: resolveColumn(headers, ['Date']),
    queue: resolveColumn(headers, ['Queue', 'Department', 'Team']),
    offered: resolveColumn(headers, ['Calls Offered', 'Offered']),
    answered: resolveColumn(headers, ['Calls Answered', 'Answered']),
    abandoned: resolveColumn(headers, ['Calls Abandoned', 'Abandoned']),
    serviceLevel: resolveColumn(headers, ['Service Level (%)', 'Service Level', 'SLA']),
    avgSpeedAnswer: resolveColumn(headers, ['Avg Speed of Answer (Seconds)', 'Avg Speed of Answer', 'ASA']),
    avgHandleTime: resolveColumn(headers, ['Avg Handle Time (Seconds)', 'Avg Handle Time', 'AHT']),
    longestWait: resolveColumn(headers, ['Longest Wait (Seconds)', 'Longest Wait', 'Max Wait']),
  }

  const records: QosRecord[] = []
  for (const row of rows) {
    const date = toDate(col.date ? row[col.date] : undefined)
    if (!date) continue
    records.push({
      date,
      queue: (col.queue ? row[col.queue] : '') || 'Unassigned',
      offered: toNumber(col.offered ? row[col.offered] : undefined),
      answered: toNumber(col.answered ? row[col.answered] : undefined),
      abandoned: toNumber(col.abandoned ? row[col.abandoned] : undefined),
      serviceLevelPct: toNumber(col.serviceLevel ? row[col.serviceLevel] : undefined),
      avgSpeedAnswerSec: toNumber(col.avgSpeedAnswer ? row[col.avgSpeedAnswer] : undefined),
      avgHandleTimeSec: toNumber(col.avgHandleTime ? row[col.avgHandleTime] : undefined),
      longestWaitSec: toNumber(col.longestWait ? row[col.longestWait] : undefined),
    })
  }
  return records
}

export function parseSmsCsv(text: string): SmsRecord[] {
  const { headers, rows } = parseCsvText(text)

  const col = {
    id: resolveColumn(headers, ['Message ID', 'MessageId', 'ID']),
    dateTime: resolveColumn(headers, ['Date/Time', 'Date Time', 'Date', 'Sent Time']),
    direction: resolveColumn(headers, ['Direction']),
    from: resolveColumn(headers, ['From', 'From Number']),
    to: resolveColumn(headers, ['To', 'To Number']),
    extensionName: resolveColumn(headers, ['Extension Name', 'Agent Name', 'User Name']),
    department: resolveColumn(headers, ['Department', 'Queue', 'Team']),
    segments: resolveColumn(headers, ['Segments', 'Segment Count']),
    status: resolveColumn(headers, ['Status']),
  }

  const records: SmsRecord[] = []
  for (const row of rows) {
    const dateTime = toDate(col.dateTime ? row[col.dateTime] : undefined)
    if (!dateTime) continue
    const direction = (col.direction ? row[col.direction] : '') as SmsRecord['direction']
    records.push({
      messageId: (col.id ? row[col.id] : undefined) ?? `${dateTime.getTime()}-${records.length}`,
      dateTime,
      direction: direction === 'Outbound' ? 'Outbound' : 'Inbound',
      from: (col.from ? row[col.from] : '') ?? '',
      to: (col.to ? row[col.to] : '') ?? '',
      extensionName: (col.extensionName ? row[col.extensionName] : '') || 'Unassigned',
      department: (col.department ? row[col.department] : '') || 'Unassigned',
      segments: toNumber(col.segments ? row[col.segments] : undefined, 1),
      status: (col.status ? row[col.status] : '') || 'Unknown',
    })
  }
  return records
}
