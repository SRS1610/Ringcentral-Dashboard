import type { CallRecord, SmsRecord } from '../types'
import type { DepartmentMap } from './departmentMap'
import { departmentFor } from './departmentMap'
import { getValidAccessToken, loadConnectionConfig } from './ringcentralAuth'

// The RingCentral REST responses being mapped here are wider than what we use;
// `any` keeps the field access below terse instead of hand-typing the full API shape.
// oxlint-disable-next-line no-explicit-any
type RcRecord = Record<string, any>

async function fetchAllPages(serverUrl: string, accessToken: string, path: string, params: Record<string, string>): Promise<RcRecord[]> {
  const records: RcRecord[] = []
  let page = 1
  for (;;) {
    const url = new URL(`${serverUrl}${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    url.searchParams.set('perPage', '1000')
    url.searchParams.set('page', String(page))

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GET ${path} failed (${res.status}): ${body}`)
    }
    const data = await res.json()
    const pageRecords: RcRecord[] = data.records ?? []
    records.push(...pageRecords)
    if (pageRecords.length === 0 || !data.navigation?.nextPage) break
    page += 1
  }
  return records
}

function mapCallRecord(record: RcRecord, deptMap: DepartmentMap): CallRecord {
  const extensionNumber = record.extension?.extensionNumber ?? ''
  const recorded = Boolean(record.recording)
  return {
    callId: record.id,
    startTime: new Date(record.startTime),
    direction: record.direction === 'Outbound' ? 'Outbound' : 'Inbound',
    fromName: record.from?.name ?? '',
    fromNumber: record.from?.phoneNumber ?? record.from?.extensionNumber ?? '',
    toName: record.to?.name ?? '',
    toNumber: record.to?.phoneNumber ?? record.to?.extensionNumber ?? '',
    extension: extensionNumber,
    extensionName: record.extension?.name ?? record.to?.name ?? record.from?.name ?? 'Unassigned',
    department: departmentFor(deptMap, extensionNumber),
    durationSeconds: record.duration ?? 0,
    result: record.result ?? 'Unknown',
    recorded,
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

export async function syncCallLog(deptMap: DepartmentMap, days: number): Promise<CallRecord[]> {
  const config = loadConnectionConfig()
  if (!config) throw new Error('Not connected to RingCentral.')
  const accessToken = await getValidAccessToken()

  const dateFrom = new Date(Date.now() - days * 86400000).toISOString()
  const dateTo = new Date().toISOString()
  const records = await fetchAllPages(config.serverUrl, accessToken, '/restapi/v1.0/account/~/call-log', {
    view: 'Detailed',
    dateFrom,
    dateTo,
  })
  return records.map((r) => mapCallRecord(r, deptMap))
}

export interface SmsSyncResult {
  records: SmsRecord[]
  skippedExtensions: number
}

export async function syncSms(deptMap: DepartmentMap, days: number): Promise<SmsSyncResult> {
  const config = loadConnectionConfig()
  if (!config) throw new Error('Not connected to RingCentral.')
  const accessToken = await getValidAccessToken()

  const dateFrom = new Date(Date.now() - days * 86400000).toISOString()
  const dateTo = new Date().toISOString()

  const extensions = (await fetchAllPages(config.serverUrl, accessToken, '/restapi/v1.0/account/~/extension', { status: 'Enabled' })).filter(
    (e) => e.type === 'User',
  )

  const records: SmsRecord[] = []
  let skippedExtensions = 0
  for (const ext of extensions) {
    try {
      const messages = await fetchAllPages(config.serverUrl, accessToken, `/restapi/v1.0/account/~/extension/${ext.id}/message-store`, {
        messageType: 'SMS',
        dateFrom,
        dateTo,
      })
      for (const m of messages) records.push(mapSmsRecord(m, ext, deptMap))
    } catch {
      skippedExtensions += 1
    }
  }
  return { records, skippedExtensions }
}
