import type { CallRecord, PerformanceRecord, QosRecord, SmsRecord } from '../types'
import type { DepartmentMap } from './departmentMap'
import { departmentFor } from './departmentMap'
import { ApiError, apiGet, type StatusCallback } from './dashboardApi'
import { callKindOf } from './metrics'
import { analyticsDay } from './timezone'

export type { StatusCallback } from './dashboardApi'

/** "company" = account-wide data (the Worker's JWT belongs to an admin); "self" = only that one user's records. */
export type DataScope = 'company' | 'self'

export interface RcUser {
  name: string
  extensionNumber: string
  isAdmin: boolean
}

export interface RcStatus {
  user: RcUser
  environment: 'production' | 'sandbox'
  /** The time zone set in RingCentral for the signed-in user; "" when RingCentral didn't say. */
  timeZone?: string
}

/** Either "the last N days" or an exact from/to window picked on the calendar. */
export type SyncWindow = number | { start: Date; end: Date }

function windowParams(window: SyncWindow): { from: string; to: string } {
  const now = new Date()
  if (typeof window === 'number') {
    return { from: new Date(now.getTime() - window * 86400000).toISOString(), to: now.toISOString() }
  }
  const end = window.end > now ? now : window.end
  return { from: window.start.toISOString(), to: end.toISOString() }
}

export function fetchStatus(): Promise<RcStatus> {
  return apiGet<RcStatus>('status')
}

// ---- Calls ----------------------------------------------------------------------

type WireCall = Omit<CallRecord, 'startTime' | 'department' | 'kind'> & {
  startTime: string
  /** "Voice" or "Fax"; absent from a Worker deployed before faxes were told apart. */
  type?: string
  extensionDepartment?: string
}

interface CallPage {
  records: WireCall[]
  hasMore: boolean
  scope: DataScope
}

export interface CallSyncResult {
  records: CallRecord[]
  scope: DataScope
}

export async function syncCallLog(deptMap: DepartmentMap, window: SyncWindow, onStatus?: StatusCallback): Promise<CallSyncResult> {
  const range = windowParams(window)
  const records: CallRecord[] = []
  let scope: DataScope | null = null
  onStatus?.('Importing call log…')
  for (let page = 1; ; page++) {
    const params: Record<string, string> = { ...range, page: String(page) }
    if (scope === 'self') params.scope = 'self'
    const data = await apiGet<CallPage>('calls', params, onStatus)
    scope = data.scope
    for (const { type, extensionDepartment, ...r } of data.records) {
      records.push({
        ...r,
        kind: callKindOf(type, r.result),
        startTime: new Date(r.startTime),
        department: departmentFor(deptMap, r.extension, extensionDepartment),
      })
    }
    if (!data.hasMore) break
    onStatus?.(`Importing call log (${records.length.toLocaleString()} calls so far)…`)
  }
  return { records, scope: scope ?? 'company' }
}

// ---- SMS ------------------------------------------------------------------------

interface WireExtension {
  id: string
  name: string
  extensionNumber: string
  department?: string
}

type WireSms = Omit<SmsRecord, 'dateTime' | 'extensionName' | 'department' | 'segments'> & { dateTime: string }

export interface SmsSyncResult {
  records: SmsRecord[]
  skippedExtensions: number
  scope: DataScope
}

export async function syncSms(deptMap: DepartmentMap, window: SyncWindow, onStatus?: StatusCallback): Promise<SmsSyncResult> {
  const range = windowParams(window)
  const { extensions, scope } = await apiGet<{ extensions: WireExtension[]; scope: DataScope }>('extensions', {}, onStatus)

  const records: SmsRecord[] = []
  let skippedExtensions = 0
  for (const [i, ext] of extensions.entries()) {
    if (extensions.length > 1) onStatus?.(`Importing SMS (${i + 1} of ${extensions.length} users)…`)
    try {
      for (let page = 1; ; page++) {
        const data = await apiGet<{ records: WireSms[]; hasMore: boolean }>('sms', { ...range, extensionId: ext.id, page: String(page) }, onStatus)
        for (const m of data.records) {
          records.push({
            ...m,
            dateTime: new Date(m.dateTime),
            extensionName: ext.name,
            department: departmentFor(deptMap, ext.extensionNumber, ext.department),
            segments: 1,
          })
        }
        if (!data.hasMore) break
      }
    } catch (e) {
      // A mailbox RingCentral won't let the Worker read is skipped and counted; anything else
      // (wrong password, RingCentral unreachable, rate limit not clearing) stops the import.
      if (!(e instanceof ApiError) || (e.code !== 'ringcentral_forbidden' && e.code !== 'ringcentral_error')) throw e
      skippedExtensions += 1
    }
  }
  return { records, skippedExtensions, scope }
}

// ---- Service quality (RingCentral Business Analytics API) -------------------------

type WireQos = Omit<QosRecord, 'date'> & { date: string }

interface QosPage {
  records: WireQos[]
  skippedNoSla: number
  hasMore: boolean
  clampedToDays: number | null
}

export interface QosSyncResult {
  records: QosRecord[]
  /** Queue-days with calls but no SLA classification, left out of the Service Quality tab. */
  skippedNoSla: number
  /** Set when the requested window reached further back than Analytics keeps data. */
  clampedToDays: number | null
}

export async function syncQos(window: SyncWindow, onStatus?: StatusCallback): Promise<QosSyncResult> {
  const range = windowParams(window)
  const records: QosRecord[] = []
  let skippedNoSla = 0
  let clampedToDays: number | null = null
  onStatus?.('Importing service quality from RingCentral Analytics…')
  for (let page = 1; ; page++) {
    const data = await apiGet<QosPage>('qos', { ...range, page: String(page) }, onStatus)
    for (const r of data.records) records.push({ ...r, date: new Date(r.date) })
    skippedNoSla += data.skippedNoSla
    clampedToDays = data.clampedToDays ?? clampedToDays
    if (!data.hasMore) break
  }
  return { records, skippedNoSla, clampedToDays }
}

// ---- Performance report (RingCentral Business Analytics API, per user) ------------

type WirePerformance = Omit<PerformanceRecord, 'date' | 'day' | 'extensionName' | 'extension'> & {
  date: string
  name: string
  extensionNumber: string
}

interface PerformancePage {
  records: WirePerformance[]
  unrecognised: number
  users: number
  hasMore: boolean
  clampedToDays: number | null
  /** The zone RingCentral bucketed days in: the one asked for, or UTC if it wouldn't take that. */
  timeZone: string
}

export interface PerformanceSyncResult {
  records: PerformanceRecord[]
  /** Users RingCentral reported on, with or without calls. */
  users: number
  /** Points whose counters the dashboard couldn't read; above zero means RingCentral changed the report's shape. */
  unrecognised: number
  clampedToDays: number | null
  timeZone: string
}

/** Each user's calls per day in `timeZone`, the way the Analytics Portal's Performance Report counts them. */
export async function syncPerformance(deptMap: DepartmentMap, window: SyncWindow, timeZone: string, onStatus?: StatusCallback): Promise<PerformanceSyncResult> {
  const range = windowParams(window)
  const records: PerformanceRecord[] = []
  let users = 0
  let unrecognised = 0
  let clampedToDays: number | null = null
  let usedZone = timeZone
  onStatus?.('Importing the performance report from RingCentral Analytics…')
  for (let page = 1; ; page++) {
    const data = await apiGet<PerformancePage>('performance', { ...range, timeZone, page: String(page) }, onStatus)
    usedZone = data.timeZone || usedZone
    for (const { date, name, extensionNumber, department, ...r } of data.records) {
      records.push({
        ...r,
        ...analyticsDay(date, usedZone),
        extensionName: name,
        extension: extensionNumber,
        department: departmentFor(deptMap, extensionNumber, department),
      })
    }
    users += data.users
    unrecognised += data.unrecognised
    clampedToDays = data.clampedToDays ?? clampedToDays
    if (!data.hasMore) break
  }
  return { records, users, unrecognised, clampedToDays, timeZone: usedZone }
}
