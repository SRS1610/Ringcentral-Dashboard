import type { CallKind, CallRecord, DateRange, QosRecord, SmsRecord } from '../types'
import { formatDateKey } from './format.ts'
import { zonedDateKey, zonedParts } from './timezone.ts'

export function filterByRange<T>(records: T[], getDate: (r: T) => Date, range: DateRange): T[] {
  return records.filter((r) => {
    const t = getDate(r).getTime()
    return t >= range.start.getTime() && t <= range.end.getTime()
  })
}

/** The window of the same length that ends the instant before `range` starts. */
export function priorRange(range: DateRange): DateRange {
  const lengthMs = range.end.getTime() - range.start.getTime()
  const end = range.start.getTime() - 1
  return { start: new Date(end - lengthMs), end: new Date(end) }
}

/** How far before a file's first record a comparison period may start: a weekend or holiday with no activity. */
const FILE_COVERAGE_SLACK_MS = 4 * 86_400_000

/**
 * Whether the data on hand covers all of `prior`, so a period-over-period figure is like for like.
 * A period that is only partly loaded would look tiny and turn every change into a huge increase.
 *
 * @param coveredFrom  where the imported period starts, when known
 * @param firstRecord  time of the earliest record, used when it isn't
 */
export function coversRange(prior: DateRange, coveredFrom: Date | null, firstRecord: Date | null): boolean {
  if (coveredFrom) return prior.start.getTime() >= coveredFrom.getTime()
  if (!firstRecord) return false
  return prior.start.getTime() >= firstRecord.getTime() - FILE_COVERAGE_SLACK_MS
}

export function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

// ---- Voice vs fax ----------------------------------------------------------
// RingCentral keeps faxes in the same log as phone calls. Live data says which is
// which; an export without a "Type" column is told apart by its result.

const FAX_RESULTS = new Set(['Received', 'Sent', 'Partial Receive', 'Receive Error', 'Send Error'])

export function isFaxResult(result: string): boolean {
  return FAX_RESULTS.has(result) || /\bfax\b/i.test(result)
}

export function callKindOf(type: string | undefined | null, result: string): CallKind {
  if (type) return /fax/i.test(type) ? 'fax' : 'voice'
  return isFaxResult(result) ? 'fax' : 'voice'
}

export function splitByKind(records: CallRecord[]): { voice: CallRecord[]; fax: CallRecord[] } {
  const voice: CallRecord[] = []
  const fax: CallRecord[] = []
  for (const r of records) (r.kind === 'fax' ? fax : voice).push(r)
  return { voice, fax }
}

const FAX_OK_RESULTS = new Set(['Received', 'Sent'])

/** Fax counts for a set of fax records. */
export function faxKpis(fax: CallRecord[]) {
  const sent = fax.filter((f) => f.direction === 'Outbound').length
  const failed = fax.filter((f) => !FAX_OK_RESULTS.has(f.result)).length
  return { total: fax.length, sent, received: fax.length - sent, failed }
}

// ---- Calls ---------------------------------------------------------------
// Every function below expects voice calls only (see `splitByKind`).

/** RingCentral logs an answered inbound call as "Accepted" and a connected outbound call as "Call connected". */
const ANSWERED_RESULTS = new Set(['Call connected', 'Accepted'])

export const isAnswered = (c: CallRecord): boolean => ANSWERED_RESULTS.has(c.result)

const rate = (part: number, whole: number): number => (whole > 0 ? (part / whole) * 100 : 0)

export function callKpis(calls: CallRecord[]) {
  const total = calls.length
  const answered = calls.filter(isAnswered)
  const inboundCalls = calls.filter((c) => c.direction === 'Inbound')
  const inbound = inboundCalls.length
  const outbound = total - inbound
  const inboundAnswered = inboundCalls.filter(isAnswered).length
  const outboundConnected = answered.length - inboundAnswered
  const avgDuration = answered.length > 0 ? answered.reduce((s, c) => s + c.durationSeconds, 0) / answered.length : 0
  return {
    total,
    inbound,
    outbound,
    connected: answered.length,
    inboundAnswered,
    outboundConnected,
    /** Share of inbound calls a person picked up. */
    inboundAnswerRate: rate(inboundAnswered, inbound),
    /** Share of outbound calls that connected. */
    outboundConnectRate: rate(outboundConnected, outbound),
    missed: inboundCalls.filter((c) => c.result === 'Missed').length,
    voicemail: inboundCalls.filter((c) => c.result === 'Voicemail').length,
    avgDuration,
  }
}

export function dailyCallVolume(calls: CallRecord[], timeZone: string) {
  const map = new Map<string, { date: string; inbound: number; outbound: number; total: number }>()
  for (const c of calls) {
    const key = zonedDateKey(c.startTime, timeZone)
    const entry = map.get(key) ?? { date: key, inbound: 0, outbound: 0, total: 0 }
    if (c.direction === 'Inbound') entry.inbound += 1
    else entry.outbound += 1
    entry.total += 1
    map.set(key, entry)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function callOutcomeBreakdown(calls: CallRecord[]) {
  const map = new Map<string, number>()
  for (const c of calls) map.set(c.result, (map.get(c.result) ?? 0) + 1)
  return [...map.entries()].map(([result, count]) => ({ result, count })).sort((a, b) => b.count - a.count)
}

export interface DeptLeaderboardRow {
  department: string
  total: number
  connected: number
  answerRate: number
  avgDuration: number
}

export function departmentLeaderboard(calls: CallRecord[]): DeptLeaderboardRow[] {
  const map = new Map<string, CallRecord[]>()
  for (const c of calls) {
    const arr = map.get(c.department) ?? []
    arr.push(c)
    map.set(c.department, arr)
  }
  return [...map.entries()]
    .map(([department, records]) => {
      const connected = records.filter(isAnswered)
      return {
        department,
        total: records.length,
        connected: connected.length,
        answerRate: records.length > 0 ? (connected.length / records.length) * 100 : 0,
        avgDuration: connected.length > 0 ? connected.reduce((s, r) => s + r.durationSeconds, 0) / connected.length : 0,
      }
    })
    .sort((a, b) => b.total - a.total)
}

const UNASSIGNED = 'Unassigned'

/** True when at least one record carries a real department, so a by-department chart says something. */
export function hasDepartments(records: { department: string }[]): boolean {
  return records.some((r) => Boolean(r.department) && r.department !== UNASSIGNED)
}

/** Record counts per department when departments are set up, otherwise per team member or line. */
export function volumeByGroup(records: { department: string; extensionName: string }[]): { by: 'department' | 'member'; rows: { name: string; value: number }[] } {
  const by = hasDepartments(records) ? 'department' : 'member'
  const map = new Map<string, number>()
  for (const r of records) {
    const name = (by === 'department' ? r.department : r.extensionName) || UNASSIGNED
    map.set(name, (map.get(name) ?? 0) + 1)
  }
  return { by, rows: [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) }
}

export interface AgentLeaderboardRow {
  extensionName: string
  extension: string
  department: string
  /** True for a person; false for a queue, main line or other shared extension, and for calls nobody owns. */
  isStaff: boolean
  total: number
  inbound: number
  outbound: number
  connected: number
  missed: number
  voicemail: number
  answerRate: number
  avgDuration: number
  talkSeconds: number
}

/** Live data says what kind of extension owns a call; CSV data only has a name, which is taken as a person. */
function isStaffCall(c: CallRecord): boolean {
  if (c.extensionType) return c.extensionType === 'User'
  return Boolean(c.extensionName) && c.extensionName !== UNASSIGNED
}

export function agentLeaderboard(calls: CallRecord[]): AgentLeaderboardRow[] {
  const map = new Map<string, CallRecord[]>()
  for (const c of calls) {
    const key = c.extensionName || UNASSIGNED
    const arr = map.get(key) ?? []
    arr.push(c)
    map.set(key, arr)
  }
  return [...map.entries()]
    .map(([extensionName, records]) => {
      const connected = records.filter(isAnswered)
      const talkSeconds = connected.reduce((s, r) => s + r.durationSeconds, 0)
      const inbound = records.filter((r) => r.direction === 'Inbound').length
      return {
        extensionName,
        extension: records.find((r) => r.extension)?.extension ?? '',
        department: records[0]?.department ?? UNASSIGNED,
        isStaff: records.some(isStaffCall),
        total: records.length,
        inbound,
        outbound: records.length - inbound,
        connected: connected.length,
        missed: records.filter((r) => r.result === 'Missed').length,
        voicemail: records.filter((r) => r.result === 'Voicemail').length,
        answerRate: records.length > 0 ? (connected.length / records.length) * 100 : 0,
        avgDuration: connected.length > 0 ? talkSeconds / connected.length : 0,
        talkSeconds,
      }
    })
    .sort((a, b) => b.total - a.total)
}

// ---- Callers behind a metric ---------------------------------------------------

/** A headline metric, or `result:<name>` for one bar of the call outcomes chart. */
export type CallMetricKey = 'all' | 'inbound' | 'outbound' | 'connected' | 'missed' | 'voicemail' | `result:${string}`

const RESULT_PRESETS: Record<string, CallMetricKey> = { Missed: 'missed', Voicemail: 'voicemail' }

/** The metric for one call result, as shown in the call outcomes chart. */
export const metricForResult = (result: string): CallMetricKey => RESULT_PRESETS[result] ?? `result:${result}`

/** The call result a metric stands for, if it is exactly one. */
export function resultForMetric(key: CallMetricKey): string | null {
  if (key.startsWith('result:')) return key.slice('result:'.length)
  return Object.keys(RESULT_PRESETS).find((result) => RESULT_PRESETS[result] === key) ?? null
}

export function callMetricLabel(key: CallMetricKey): string {
  switch (key) {
    case 'all':
      return 'All calls'
    case 'inbound':
      return 'Inbound'
    case 'outbound':
      return 'Outbound'
    case 'connected':
      return 'Connected'
    case 'missed':
      return 'Missed'
    case 'voicemail':
      return 'Voicemail'
    default:
      return key.slice('result:'.length)
  }
}

/** The calls a metric counts, using the same definitions as `callKpis`. */
export function callsForMetric(calls: CallRecord[], key: CallMetricKey): CallRecord[] {
  switch (key) {
    case 'all':
      return calls
    case 'inbound':
      return calls.filter((c) => c.direction === 'Inbound')
    case 'outbound':
      return calls.filter((c) => c.direction === 'Outbound')
    case 'connected':
      return calls.filter(isAnswered)
    case 'missed':
      return calls.filter((c) => c.result === 'Missed')
    case 'voicemail':
      return calls.filter((c) => c.result === 'Voicemail')
    default: {
      const result = key.slice('result:'.length)
      return calls.filter((c) => c.result === result)
    }
  }
}

export interface CallerRow {
  key: string
  /** Caller-ID name of the outside party; empty when RingCentral had none. */
  name: string
  number: string
  total: number
  inbound: number
  outbound: number
  talkSeconds: number
  lastCall: Date
  /** Team members on these calls, most frequent first. */
  staff: string[]
}

const mostCommon = (counts: Map<string, number>): string[] => [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)

/** Groups calls by the outside party: who called in, or who was called. */
export function callerBreakdown(calls: CallRecord[]): CallerRow[] {
  interface Acc extends Omit<CallerRow, 'name' | 'staff'> {
    names: Map<string, number>
    staff: Map<string, number>
  }
  const map = new Map<string, Acc>()
  for (const c of calls) {
    const inbound = c.direction === 'Inbound'
    const number = (inbound ? c.fromNumber : c.toNumber).trim()
    const name = (inbound ? c.fromName : c.toName).trim()
    const key = number || (name ? `name:${name.toLowerCase()}` : 'unknown')
    const row = map.get(key) ?? { key, number, total: 0, inbound: 0, outbound: 0, talkSeconds: 0, lastCall: c.startTime, names: new Map(), staff: new Map() }
    row.total += 1
    if (inbound) row.inbound += 1
    else row.outbound += 1
    row.talkSeconds += c.durationSeconds
    if (c.startTime > row.lastCall) row.lastCall = c.startTime
    if (name) row.names.set(name, (row.names.get(name) ?? 0) + 1)
    if (isStaffCall(c)) row.staff.set(c.extensionName, (row.staff.get(c.extensionName) ?? 0) + 1)
    map.set(key, row)
  }
  return [...map.values()]
    .map(({ names, staff, ...row }) => ({ ...row, name: mostCommon(names)[0] ?? '', staff: mostCommon(staff) }))
    .sort((a, b) => b.total - a.total || b.lastCall.getTime() - a.lastCall.getTime())
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Always shown, so a quiet week still draws a readable grid. */
const CORE_HOURS = { first: 9, last: 17 }
/** An hour needs this share of all calls to widen the grid; strays are counted in `outside` instead. */
const MIN_HOUR_SHARE = 0.01

/**
 * Call counts by weekday and hour on the clock of `timeZone`. The hours shown stretch to
 * cover when calls actually happen rather than assuming a fixed working day.
 */
export function callHeatmap(calls: CallRecord[], timeZone: string) {
  const grid = new Map<string, number>()
  const perHour = new Array<number>(24).fill(0)
  for (const c of calls) {
    const { weekday, hour } = zonedParts(c.startTime, timeZone)
    const key = `${weekday}-${hour}`
    grid.set(key, (grid.get(key) ?? 0) + 1)
    perHour[hour] += 1
  }

  let first = CORE_HOURS.first
  let last = CORE_HOURS.last
  const threshold = Math.max(1, calls.length * MIN_HOUR_SHARE)
  for (let hour = 0; hour < 24; hour++) {
    if (perHour[hour] < threshold) continue
    if (hour < first) first = hour
    if (hour > last) last = hour
  }
  const hours: number[] = []
  for (let hour = first; hour <= last; hour++) hours.push(hour)

  const rows: { day: string; hour: number; count: number }[] = []
  let shown = 0
  for (let day = 0; day < 7; day++) {
    for (const hour of hours) {
      const count = grid.get(`${day}-${hour}`) ?? 0
      shown += count
      rows.push({ day: DAY_LABELS[day], hour, count })
    }
  }
  return { rows, hours, days: DAY_LABELS, outside: calls.length - shown }
}

// ---- QoS / Service quality -------------------------------------------------

export function qosKpis(qos: QosRecord[]) {
  const offered = qos.reduce((s, q) => s + q.offered, 0)
  const answered = qos.reduce((s, q) => s + q.answered, 0)
  const abandoned = qos.reduce((s, q) => s + q.abandoned, 0)
  const avgServiceLevel = qos.length > 0 ? qos.reduce((s, q) => s + q.serviceLevelPct, 0) / qos.length : 0
  const avgHandleTime = qos.length > 0 ? qos.reduce((s, q) => s + q.avgHandleTimeSec, 0) / qos.length : 0
  const avgSpeedAnswer = qos.length > 0 ? qos.reduce((s, q) => s + q.avgSpeedAnswerSec, 0) / qos.length : 0
  const abandonRate = offered > 0 ? (abandoned / offered) * 100 : 0
  return { offered, answered, abandoned, avgServiceLevel, avgHandleTime, avgSpeedAnswer, abandonRate }
}

export function qosDailyTrend(qos: QosRecord[]) {
  const map = new Map<string, { date: string; serviceLevel: number[]; handleTime: number[]; speedAnswer: number[] }>()
  for (const q of qos) {
    const key = formatDateKey(q.date)
    const entry = map.get(key) ?? { date: key, serviceLevel: [], handleTime: [], speedAnswer: [] }
    entry.serviceLevel.push(q.serviceLevelPct)
    entry.handleTime.push(q.avgHandleTimeSec)
    entry.speedAnswer.push(q.avgSpeedAnswerSec)
    map.set(key, entry)
  }
  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
  return [...map.values()]
    .map((e) => ({
      date: e.date,
      serviceLevel: avg(e.serviceLevel),
      handleTime: avg(e.handleTime),
      speedAnswer: avg(e.speedAnswer),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function qosByQueue(qos: QosRecord[]) {
  const map = new Map<string, QosRecord[]>()
  for (const q of qos) {
    const arr = map.get(q.queue) ?? []
    arr.push(q)
    map.set(q.queue, arr)
  }
  return [...map.entries()]
    .map(([queue, records]) => {
      const offered = records.reduce((s, r) => s + r.offered, 0)
      const abandoned = records.reduce((s, r) => s + r.abandoned, 0)
      return {
        queue,
        offered,
        avgServiceLevel: records.length > 0 ? records.reduce((s, r) => s + r.serviceLevelPct, 0) / records.length : 0,
        abandonRate: offered > 0 ? (abandoned / offered) * 100 : 0,
      }
    })
    .sort((a, b) => b.offered - a.offered)
}

// ---- SMS -------------------------------------------------------------------

/** RingCentral's outbound statuses that mean the message did not get through. */
const SMS_FAILED_STATUSES = new Set(['DeliveryFailed', 'SendingFailed'])

export function smsKpis(sms: SmsRecord[]) {
  const total = sms.length
  const outboundMessages = sms.filter((s) => s.direction === 'Outbound')
  const outbound = outboundMessages.length
  const inbound = total - outbound
  const delivered = outboundMessages.filter((s) => s.status === 'Delivered').length
  const failed = outboundMessages.filter((s) => SMS_FAILED_STATUSES.has(s.status)).length
  // Only messages the team sent can be delivered or not; received messages are left out of the rate.
  const deliveryRate = rate(delivered, outbound)
  return { total, delivered, failed, inbound, outbound, deliveryRate }
}

export function smsDailyVolume(sms: SmsRecord[], timeZone: string) {
  const map = new Map<string, { date: string; inbound: number; outbound: number; total: number }>()
  for (const s of sms) {
    const key = zonedDateKey(s.dateTime, timeZone)
    const entry = map.get(key) ?? { date: key, inbound: 0, outbound: 0, total: 0 }
    if (s.direction === 'Inbound') entry.inbound += 1
    else entry.outbound += 1
    entry.total += 1
    map.set(key, entry)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function smsByDepartment(sms: SmsRecord[]) {
  const map = new Map<string, number>()
  for (const s of sms) map.set(s.department, (map.get(s.department) ?? 0) + 1)
  return [...map.entries()].map(([department, count]) => ({ department, count })).sort((a, b) => b.count - a.count)
}
