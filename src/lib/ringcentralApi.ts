import type { CallRecord, SmsRecord } from '../types'
import type { DepartmentMap } from './departmentMap'
import { departmentFor } from './departmentMap'
import { getValidAccessToken, loadConnectionConfig } from './ringcentralAuth'

// The RingCentral REST responses being mapped here are wider than what we use;
// `any` keeps the field access below terse instead of hand-typing the full API shape.
// oxlint-disable-next-line no-explicit-any
type RcRecord = Record<string, any>

/** "company" = account-wide data (admin); "self" = only the signed-in user's own extension. */
export type DataScope = 'company' | 'self'

export type StatusCallback = (message: string) => void

export class RcHttpError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export interface RcUser {
  name: string
  extensionNumber: string
  email: string
  isAdmin: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MAX_RATE_LIMIT_RETRIES = 3

async function rcGet(url: URL, accessToken: string, onStatus?: StatusCallback): Promise<RcRecord> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      // Retry-After may not be exposed cross-origin; RingCentral's penalty window is 60s.
      const header = Number(res.headers.get('Retry-After'))
      const waitSec = Number.isFinite(header) && header > 0 ? Math.min(header, 65) : 60
      onStatus?.(`RingCentral rate limit reached — waiting ${waitSec}s before continuing…`)
      await sleep(waitSec * 1000)
      continue
    }
    if (!res.ok) {
      const body = await res.text()
      throw new RcHttpError(`GET ${url.pathname} failed (${res.status}): ${body}`, res.status)
    }
    return res.json()
  }
}

async function fetchAllPages(
  serverUrl: string,
  accessToken: string,
  path: string,
  params: Record<string, string>,
  onStatus?: StatusCallback,
): Promise<RcRecord[]> {
  const records: RcRecord[] = []
  let page = 1
  for (;;) {
    const url = new URL(`${serverUrl}${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    url.searchParams.set('perPage', '1000')
    url.searchParams.set('page', String(page))
    const data = await rcGet(url, accessToken, onStatus)
    const pageRecords: RcRecord[] = data.records ?? []
    records.push(...pageRecords)
    if (pageRecords.length === 0 || !data.navigation?.nextPage) break
    page += 1
  }
  return records
}

async function session() {
  const config = loadConnectionConfig()
  if (!config) throw new Error('Not signed in to RingCentral.')
  const accessToken = await getValidAccessToken()
  return { serverUrl: config.serverUrl, accessToken }
}

const isPermissionDenied = (e: unknown) => e instanceof RcHttpError && e.status === 403

export async function fetchCurrentUser(): Promise<RcUser> {
  const { serverUrl, accessToken } = await session()
  const me = await rcGet(new URL(`${serverUrl}/restapi/v1.0/account/~/extension/~`), accessToken)
  return {
    name: me.name || [me.contact?.firstName, me.contact?.lastName].filter(Boolean).join(' ') || 'RingCentral user',
    extensionNumber: me.extensionNumber ?? '',
    email: me.contact?.email ?? '',
    isAdmin: Boolean(me.permissions?.admin?.enabled),
  }
}

function mapCallRecord(record: RcRecord, deptMap: DepartmentMap, fallbackExt?: RcRecord): CallRecord {
  const ext = record.extension ?? fallbackExt
  const extensionNumber = ext?.extensionNumber ?? ''
  return {
    callId: record.id,
    startTime: new Date(record.startTime),
    direction: record.direction === 'Outbound' ? 'Outbound' : 'Inbound',
    fromName: record.from?.name ?? '',
    fromNumber: record.from?.phoneNumber ?? record.from?.extensionNumber ?? '',
    toName: record.to?.name ?? '',
    toNumber: record.to?.phoneNumber ?? record.to?.extensionNumber ?? '',
    extension: extensionNumber,
    extensionName: ext?.name ?? record.to?.name ?? record.from?.name ?? 'Unassigned',
    department: departmentFor(deptMap, extensionNumber),
    durationSeconds: record.duration ?? 0,
    result: record.result ?? 'Unknown',
    recorded: Boolean(record.recording),
  }
}

function mapSmsRecord(record: RcRecord, extension: RcRecord, deptMap: DepartmentMap): SmsRecord {
  return {
    messageId: String(record.id),
    dateTime: new Date(record.creationTime),
    direction: record.direction === 'Outbound' ? 'Outbound' : 'Inbound',
    from: record.from?.phoneNumber ?? '',
    to: (record.to ?? []).map((t: RcRecord) => t.phoneNumber).join(';'),
    extensionName: extension.name ?? 'Unassigned',
    department: departmentFor(deptMap, extension.extensionNumber ?? ''),
    segments: 1,
    status: record.messageStatus ?? 'Unknown',
  }
}

/** Either "the last N days" or an exact from/to window picked on the calendar. */
export type SyncWindow = number | { start: Date; end: Date }

function windowParams(window: SyncWindow) {
  const now = new Date()
  if (typeof window === 'number') {
    return { dateFrom: new Date(now.getTime() - window * 86400000).toISOString(), dateTo: now.toISOString() }
  }
  const end = window.end > now ? now : window.end
  return { dateFrom: window.start.toISOString(), dateTo: end.toISOString() }
}

export interface CallSyncResult {
  records: CallRecord[]
  scope: DataScope
}

export async function syncCallLog(deptMap: DepartmentMap, window: SyncWindow, onStatus?: StatusCallback): Promise<CallSyncResult> {
  const { serverUrl, accessToken } = await session()
  const params = { view: 'Detailed', ...windowParams(window) }
  onStatus?.('Importing call log…')
  try {
    const records = await fetchAllPages(serverUrl, accessToken, '/restapi/v1.0/account/~/call-log', params, onStatus)
    return { records: records.map((r) => mapCallRecord(r, deptMap)), scope: 'company' }
  } catch (e) {
    if (!isPermissionDenied(e)) throw e
    // Not an admin: RingCentral only allows this user's own call log.
    const me = await rcGet(new URL(`${serverUrl}/restapi/v1.0/account/~/extension/~`), accessToken)
    const records = await fetchAllPages(serverUrl, accessToken, '/restapi/v1.0/account/~/extension/~/call-log', params, onStatus)
    return { records: records.map((r) => mapCallRecord(r, deptMap, me)), scope: 'self' }
  }
}

export interface SmsSyncResult {
  records: SmsRecord[]
  skippedExtensions: number
  scope: DataScope
}

export async function syncSms(deptMap: DepartmentMap, window: SyncWindow, onStatus?: StatusCallback): Promise<SmsSyncResult> {
  const { serverUrl, accessToken } = await session()
  const params = { messageType: 'SMS', ...windowParams(window) }

  let extensions: RcRecord[]
  let scope: DataScope = 'company'
  try {
    extensions = (await fetchAllPages(serverUrl, accessToken, '/restapi/v1.0/account/~/extension', { status: 'Enabled' }, onStatus)).filter(
      (e) => e.type === 'User',
    )
  } catch (e) {
    if (!isPermissionDenied(e)) throw e
    const me = await rcGet(new URL(`${serverUrl}/restapi/v1.0/account/~/extension/~`), accessToken)
    extensions = [{ ...me, id: '~' }]
    scope = 'self'
  }

  const records: SmsRecord[] = []
  let skippedExtensions = 0
  for (const [i, ext] of extensions.entries()) {
    if (extensions.length > 1) onStatus?.(`Importing SMS (${i + 1} of ${extensions.length} users)…`)
    try {
      const messages = await fetchAllPages(serverUrl, accessToken, `/restapi/v1.0/account/~/extension/${ext.id}/message-store`, params, onStatus)
      for (const m of messages) records.push(mapSmsRecord(m, ext, deptMap))
    } catch {
      skippedExtensions += 1
    }
  }
  return { records, skippedExtensions, scope }
}
