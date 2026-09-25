import type { CallRecord, DateRange, QosRecord, SmsRecord } from '../types'
import { formatDateKey } from './format'

export function filterByRange<T>(records: T[], getDate: (r: T) => Date, range: DateRange): T[] {
  return records.filter((r) => {
    const t = getDate(r).getTime()
    return t >= range.start.getTime() && t <= range.end.getTime()
  })
}

/** Returns the [start, end] window immediately preceding `range`, same length. */
export function priorRange(range: DateRange): DateRange {
  const lengthMs = range.end.getTime() - range.start.getTime()
  return {
    start: new Date(range.start.getTime() - lengthMs - 86400000),
    end: new Date(range.start.getTime() - 86400000),
  }
}

export function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

// ---- Calls ---------------------------------------------------------------

export function callKpis(calls: CallRecord[]) {
  const total = calls.length
  const connected = calls.filter((c) => c.result === 'Call connected')
  const missed = calls.filter((c) => c.result === 'Missed' || c.result === 'Rejected' || c.result === 'Busy')
  const answerRate = total > 0 ? (connected.length / total) * 100 : 0
  const avgDuration = connected.length > 0 ? connected.reduce((s, c) => s + c.durationSeconds, 0) / connected.length : 0
  const inbound = calls.filter((c) => c.direction === 'Inbound').length
  const outbound = total - inbound
  return { total, connected: connected.length, missed: missed.length, answerRate, avgDuration, inbound, outbound }
}

export function dailyCallVolume(calls: CallRecord[]) {
  const map = new Map<string, { date: string; inbound: number; outbound: number; total: number }>()
  for (const c of calls) {
    const key = formatDateKey(c.startTime)
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
      const connected = records.filter((r) => r.result === 'Call connected')
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

export interface AgentLeaderboardRow {
  extensionName: string
  department: string
  total: number
  answerRate: number
  avgDuration: number
}

export function agentLeaderboard(calls: CallRecord[]): AgentLeaderboardRow[] {
  const map = new Map<string, CallRecord[]>()
  for (const c of calls) {
    const key = c.extensionName
    const arr = map.get(key) ?? []
    arr.push(c)
    map.set(key, arr)
  }
  return [...map.entries()]
    .map(([extensionName, records]) => {
      const connected = records.filter((r) => r.result === 'Call connected')
      return {
        extensionName,
        department: records[0]?.department ?? 'Unassigned',
        total: records.length,
        answerRate: records.length > 0 ? (connected.length / records.length) * 100 : 0,
        avgDuration: connected.length > 0 ? connected.reduce((s, r) => s + r.durationSeconds, 0) / connected.length : 0,
      }
    })
    .sort((a, b) => b.total - a.total)
}

const HOUR_BUCKETS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function callHeatmap(calls: CallRecord[]) {
  const grid = new Map<string, number>()
  for (const c of calls) {
    const day = c.startTime.getUTCDay()
    const hour = c.startTime.getUTCHours()
    const key = `${day}-${hour}`
    grid.set(key, (grid.get(key) ?? 0) + 1)
  }
  const rows: { day: string; hour: number; count: number }[] = []
  for (let day = 0; day < 7; day++) {
    for (const hour of HOUR_BUCKETS) {
      rows.push({ day: DAY_LABELS[day], hour, count: grid.get(`${day}-${hour}`) ?? 0 })
    }
  }
  return { rows, hours: HOUR_BUCKETS, days: DAY_LABELS }
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

export function smsKpis(sms: SmsRecord[]) {
  const total = sms.length
  const delivered = sms.filter((s) => s.status === 'Delivered').length
  const inbound = sms.filter((s) => s.direction === 'Inbound').length
  const outbound = total - inbound
  const deliveryRate = total > 0 ? (delivered / total) * 100 : 0
  return { total, delivered, inbound, outbound, deliveryRate }
}

export function smsDailyVolume(sms: SmsRecord[]) {
  const map = new Map<string, { date: string; inbound: number; outbound: number; total: number }>()
  for (const s of sms) {
    const key = formatDateKey(s.dateTime)
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
