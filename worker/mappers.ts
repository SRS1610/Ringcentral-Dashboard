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
  /** The team member (or shared line) the call belongs to — never the outside party. */
  extension: string
  extensionName: string
  /** RingCentral extension type of that owner ("User", "Department", …); "" when it couldn't be looked up. */
  extensionType: string
  /** The owner's department in the RingCentral directory; "" when none is set there. */
  extensionDepartment: string
  /** RingCentral logs faxes in the call log too; the dashboard keeps them out of call metrics. */
  type: 'Voice' | 'Fax'
  durationSeconds: number
  result: string
  recorded: boolean
}

/** Who a call can belong to: an extension from the account's list, or a company number no extension owns. */
export interface DirectoryEntry {
  name: string
  extensionNumber: string
  /** RingCentral extension type; "CompanyNumber" for a number that belongs to the account itself. */
  type: string
  department: string
}

export interface Directory {
  /** Extensions by extension id. */
  extensions: Map<string, DirectoryEntry>
  /** The account's own phone numbers (digits only) and who each one rings. */
  numbers: Map<string, DirectoryEntry>
}

export const emptyDirectory = (): Directory => ({ extensions: new Map(), numbers: new Map() })

const NO_DIRECTORY: Directory = emptyDirectory()

const digitsOf = (phoneNumber: unknown): string => String(phoneNumber ?? '').replace(/\D/g, '')

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
  department: string
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

const ANSWERED_RESULTS = new Set(['Accepted', 'Call connected'])

/**
 * Who on the account the call belongs to. A call log record's own `extension` carries
 * only an id, so the name and number come from the extension directory. The fallbacks
 * only ever read the account's side of the call (`from` on outbound, `to` on inbound):
 * the other side is the outside party, whose caller-ID label must not be mistaken for staff.
 */
function callOwner(record: RcRecord, directory: Directory, fallbackExt?: RcRecord): DirectoryEntry {
  const ourSide: RcRecord | undefined = record.direction === 'Outbound' ? record.from : record.to
  const lookup = (id: unknown) => (id === undefined || id === null ? undefined : directory.extensions.get(String(id)))

  let owner = lookup(record.extension?.id) ?? lookup(ourSide?.extensionId)

  // A call to a queue or the main line is owned by that shared extension; credit the
  // person who actually picked it up, when one of the legs shows a user answering.
  if (owner?.type !== 'User') {
    for (const leg of (record.legs ?? []) as RcRecord[]) {
      const legOwner = lookup(leg.extension?.id)
      if (legOwner?.type === 'User' && ANSWERED_RESULTS.has(leg.result)) {
        owner = legOwner
        break
      }
    }
  }

  // An inbound call nobody picked up often carries no extension at all. The number that
  // was dialled still says whose line it was: a person's direct number, or a company line.
  if (!owner && record.direction !== 'Outbound') {
    const dialled = digitsOf(ourSide?.phoneNumber)
    if (dialled) owner = directory.numbers.get(dialled)
  }
  if (owner) return owner

  const inline: RcRecord | undefined = record.extension?.name || record.extension?.extensionNumber ? record.extension : fallbackExt
  return {
    name: inline?.name ?? ourSide?.name ?? 'Unassigned',
    extensionNumber: inline?.extensionNumber ?? ourSide?.extensionNumber ?? '',
    type: inline?.type ?? '',
    department: inline?.contact?.department ?? '',
  }
}

export function mapCall(record: RcRecord, directory: Directory = NO_DIRECTORY, fallbackExt?: RcRecord): WireCall {
  const owner = callOwner(record, directory, fallbackExt)
  return {
    callId: String(record.id),
    startTime: record.startTime,
    direction: record.direction === 'Outbound' ? 'Outbound' : 'Inbound',
    fromName: record.from?.name ?? '',
    fromNumber: record.from?.phoneNumber ?? record.from?.extensionNumber ?? '',
    toName: record.to?.name ?? '',
    toNumber: record.to?.phoneNumber ?? record.to?.extensionNumber ?? '',
    extension: owner.extensionNumber,
    extensionName: owner.name || 'Unassigned',
    extensionType: owner.type,
    extensionDepartment: owner.department,
    type: record.type === 'Fax' ? 'Fax' : 'Voice',
    durationSeconds: record.duration ?? 0,
    result: record.result ?? 'Unknown',
    recorded: Boolean(record.recording),
  }
}

const USAGE_LABELS: Record<string, string> = {
  MainCompanyNumber: 'Main number',
  AdditionalCompanyNumber: 'Company line',
  CompanyNumber: 'Company line',
  CompanyFaxNumber: 'Fax line',
}

/**
 * @param extensions    the account's extension list
 * @param phoneNumbers  the account's phone-number list; each number names the extension it rings, if any
 */
export function mapDirectory(extensions: RcRecord[], phoneNumbers: RcRecord[] = []): Directory {
  const directory = emptyDirectory()
  for (const r of extensions) {
    if (r.id === undefined || r.id === null) continue
    directory.extensions.set(String(r.id), {
      name: r.name ?? '',
      extensionNumber: r.extensionNumber ?? '',
      type: r.type ?? '',
      department: r.contact?.department ?? '',
    })
  }
  for (const n of phoneNumbers) {
    const digits = digitsOf(n.phoneNumber)
    if (!digits) continue
    const owner = n.extension?.id === undefined || n.extension?.id === null ? undefined : directory.extensions.get(String(n.extension.id))
    directory.numbers.set(
      digits,
      owner ?? {
        // A number that rings no single extension (main line, company fax): a shared line, not a person.
        name: `${String(n.label ?? '').trim() || USAGE_LABELS[n.usageType] || 'Company line'} ${n.phoneNumber}`,
        extensionNumber: '',
        type: 'CompanyNumber',
        department: '',
      },
    )
  }
  return directory
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
  return { id: String(record.id), name: record.name ?? 'Unassigned', extensionNumber: record.extensionNumber ?? '', department: record.contact?.department ?? '' }
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
