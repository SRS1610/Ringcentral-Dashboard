// Turns RingCentral API responses into the small JSON shapes the dashboard reads.
// Only the fields the dashboard uses are passed on — in particular SMS text is
// never sent to the browser.

import type { RcRecord } from './ringcentral.ts'

export interface WireCall {
  callId: string
  startTime: string
  direction: 'Inbound' | 'Outbound'
  fromName: string
  fromNumber: string
  toName: string
  toNumber: string
  extension: string
  extensionName: string
  durationSeconds: number
  result: string
  recorded: boolean
}

export interface WireSms {
  messageId: string
  dateTime: string
  direction: 'Inbound' | 'Outbound'
  from: string
  to: string
  status: string
}

export interface WireExtension {
  id: string
  name: string
  extensionNumber: string
}

export interface WireQos {
  date: string
  queue: string
  offered: number
  answered: number
  abandoned: number
  serviceLevelPct: number
  avgSpeedAnswerSec: number
  avgHandleTimeSec: number
  longestWaitSec: number
}

export function mapCall(record: RcRecord, fallbackExt?: RcRecord): WireCall {
  const ext = record.extension ?? fallbackExt
  return {
    callId: String(record.id),
    startTime: record.startTime,
    direction: record.direction === 'Outbound' ? 'Outbound' : 'Inbound',
    fromName: record.from?.name ?? '',
    fromNumber: record.from?.phoneNumber ?? record.from?.extensionNumber ?? '',
    toName: record.to?.name ?? '',
    toNumber: record.to?.phoneNumber ?? record.to?.extensionNumber ?? '',
    extension: ext?.extensionNumber ?? '',
    extensionName: ext?.name ?? record.to?.name ?? record.from?.name ?? 'Unassigned',
    durationSeconds: record.duration ?? 0,
    result: record.result ?? 'Unknown',
    recorded: Boolean(record.recording),
  }
}

export function mapSms(record: RcRecord): WireSms {
  return {
    messageId: String(record.id),
    dateTime: record.creationTime,
    direction: record.direction === 'Outbound' ? 'Outbound' : 'Inbound',
    from: record.from?.phoneNumber ?? '',
    to: (record.to ?? []).map((t: RcRecord) => t.phoneNumber ?? t.extensionNumber ?? '').join(';'),
    status: record.messageStatus ?? 'Unknown',
  }
}

export function mapExtension(record: RcRecord): WireExtension {
  return { id: String(record.id), name: record.name ?? 'Unassigned', extensionNumber: record.extensionNumber ?? '' }
}

// ---- Business Analytics (timeline, grouped by queue, one point per day) ------

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** `allCalls` counters/timers carry a bare number; breakdowns carry an object of numbers. */
const total = (metric: RcRecord | undefined): number => num(metric?.values)
const part = (metric: RcRecord | undefined, ...keys: string[]): number => {
  for (const key of keys) {
    const v = metric?.values?.[key]
    if (typeof v === 'number') return v
  }
  return 0
}

const round1 = (n: number) => Math.round(n * 10) / 10

export interface QosMapResult {
  records: WireQos[]
  /** Queue-days that had calls but no SLA classification; left out so they don't read as 0% service level. */
  skippedNoSla: number
}

/**
 * @param all       timeline records for every call to the queues
 * @param answered  the same request filtered to answered calls, so wait time is measured only on calls that were picked up
 */
export function mapQosTimeline(all: RcRecord[], answered: RcRecord[]): QosMapResult {
  const answeredPoints = new Map<string, RcRecord>()
  for (const record of answered) {
    for (const point of record.points ?? []) answeredPoints.set(`${record.key}|${point.time}`, point)
  }

  const records: WireQos[] = []
  let skippedNoSla = 0
  for (const record of all) {
    const queue = record.info?.name || record.info?.extensionNumber || String(record.key)
    for (const point of record.points ?? []) {
      const offered = total(point.counters?.allCalls)
      if (offered <= 0) continue

      const inSla = part(point.counters?.callsByQueueSla, 'inSla')
      const outOfSla = part(point.counters?.callsByQueueSla, 'outOfSla', 'outSla')
      if (inSla + outOfSla <= 0) {
        skippedNoSla += 1
        continue
      }

      const answeredPoint = answeredPoints.get(`${record.key}|${point.time}`)
      const answeredCount = part(point.counters?.callsByResponse, 'answered')
      const segments = answeredPoint?.timers?.callsSegments
      const ringSec = part(segments, 'ringing')
      const handleSec = part(segments, 'liveTalk') + part(segments, 'hold', 'holds')

      records.push({
        date: point.time,
        queue,
        offered,
        answered: answeredCount,
        abandoned: part(point.counters?.callsByResult, 'abandoned'),
        serviceLevelPct: round1((inSla / (inSla + outOfSla)) * 100),
        avgSpeedAnswerSec: answeredCount > 0 ? round1(ringSec / answeredCount) : 0,
        avgHandleTimeSec: answeredCount > 0 ? round1(handleSec / answeredCount) : 0,
        // The Analytics API reports totals per day, not the single longest wait.
        longestWaitSec: 0,
      })
    }
  }
  return { records, skippedNoSla }
}
