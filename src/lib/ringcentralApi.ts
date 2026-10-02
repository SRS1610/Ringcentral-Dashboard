import type { CallRecord, QosRecord, SmsRecord } from '../types'
import type { DepartmentMap } from './departmentMap'
import { departmentFor } from './departmentMap'
import { ApiError, apiGet, type StatusCallback } from './dashboardApi'

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

type WireCall = Omit<CallRecord, 'startTime' | 'department'> & { startTime: string }

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
    for (const r of data.records) {
      records.push({ ...r, startTime: new Date(r.startTime), department: departmentFor(deptMap, r.extension) })
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
            department: departmentFor(deptMap, ext.extensionNumber),
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
