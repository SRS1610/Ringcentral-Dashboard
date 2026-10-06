// Cloudflare Worker for the dashboard. It serves the built site (dist/) and a small
// JSON API under /api/ that signs in to RingCentral server-side with the JWT app
// credentials held in Worker secrets. The browser never gets those credentials.
//
//   GET /api/status                               who the Worker is signed in as, and the account's time zone
//   GET /api/calls?from&to&page[&scope]           one page of the call log
//   GET /api/extensions                           user extensions (for the SMS import)
//   GET /api/sms?from&to&extensionId&page         one page of one user's SMS log
//   GET /api/qos?from&to&page                     queue service quality per day (Business Analytics API)
//   GET /api/performance?from&to&page[&timeZone]  each user's calls per day (Business Analytics API)

import { ApiError, RcSession, RcUpstreamError, isForbidden, type Env, type RcRecord } from './ringcentral.ts'
import { emptyDirectory, mapCall, mapDirectory, mapExtension, mapPerformanceTimeline, mapQosTimeline, mapSms, type Directory } from './mappers.ts'

const CALL_PAGE_SIZE = '1000'
const SMS_PAGE_SIZE = '1000'
const EXTENSION_PAGE_SIZE = '1000'
const MAX_EXTENSION_PAGES = 10
const PHONE_NUMBER_PAGE_SIZE = '1000'
const MAX_PHONE_NUMBER_PAGES = 5
/** The timeline endpoint returns at most 20 groups (queues) per page. */
const QOS_PAGE_SIZE = '20'
/** Business Analytics keeps roughly the last 184 days. */
const ANALYTICS_MAX_DAYS = 184
const DAY_MS = 86_400_000
/** How long an isolate reuses the extension list it resolves call owners against. */
const DIRECTORY_TTL_MS = 10 * 60_000
/** After a failed attempt (e.g. the app lacks Read Accounts), wait this long before asking again. */
const DIRECTORY_RETRY_MS = 60_000

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })
}

function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) {
    return json({ error: e.code, message: e.message }, e.status, e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {})
  }
  console.error('Unhandled API error', e)
  return json({ error: 'internal', message: 'The dashboard Worker hit an unexpected error.' }, 500)
}

// ---- Who may read the data -----------------------------------------------------
// The Worker holds admin-level RingCentral access, so the API is closed unless a
// viewer presents the shared dashboard password (or the owner has explicitly said
// something else is guarding the site).

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)])
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

async function requireAccess(request: Request, env: Env): Promise<void> {
  if (env.DASHBOARD_AUTH?.trim().toLowerCase() === 'none') return
  const expected = env.DASHBOARD_PASSWORD?.trim()
  if (!expected) {
    throw new ApiError(
      503,
      'not_configured',
      'The Worker has no DASHBOARD_PASSWORD secret, so live data is switched off. Add one (viewers enter it once in Settings), ' +
        'or set the variable DASHBOARD_AUTH to "none" if the site is already protected another way, such as Cloudflare Access.',
    )
  }
  const header = request.headers.get('Authorization') ?? ''
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!given) throw new ApiError(401, 'password_required', 'Enter the dashboard password to load live RingCentral data.')
  if (!(await sameSecret(given, expected))) throw new ApiError(401, 'password_wrong', "That dashboard password isn't right.")
}

// ---- Request parameters ----------------------------------------------------------

function dateParam(url: URL, name: string): Date {
  const raw = url.searchParams.get(name)
  const date = raw ? new Date(raw) : null
  if (!date || Number.isNaN(date.getTime())) throw new ApiError(400, 'bad_request', `"${name}" must be an ISO date-time.`)
  return date
}

function windowParams(url: URL): { from: Date; to: Date } {
  const from = dateParam(url, 'from')
  const requestedTo = dateParam(url, 'to')
  const now = new Date()
  const to = requestedTo > now ? now : requestedTo
  if (from >= to) throw new ApiError(400, 'bad_request', '"from" must be earlier than "to".')
  return { from, to }
}

function pageParam(url: URL): number {
  const raw = url.searchParams.get('page') ?? '1'
  const page = Number(raw)
  if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new ApiError(400, 'bad_request', '"page" must be a positive whole number.')
  return page
}

// ---- Endpoints -------------------------------------------------------------------

async function status(rc: RcSession) {
  const me = await rc.call('/restapi/v1.0/account/~/extension/~')
  return {
    ok: true,
    user: {
      name: me.name || [me.contact?.firstName, me.contact?.lastName].filter(Boolean).join(' ') || 'RingCentral account',
      extensionNumber: me.extensionNumber ?? '',
      isAdmin: Boolean(me.permissions?.admin?.enabled),
    },
    environment: rc.creds.serverUrl.includes('devtest') ? 'sandbox' : 'production',
    // The IANA zone set in RingCentral for this user, e.g. "America/Los_Angeles"; the dashboard buckets days and hours in it.
    timeZone: typeof me.regionalSettings?.timezone?.name === 'string' ? me.regionalSettings.timezone.name : '',
  }
}

async function listExtensions(rc: RcSession, filter: Record<string, string> = {}): Promise<RcRecord[]> {
  const all: RcRecord[] = []
  for (let page = 1; page <= MAX_EXTENSION_PAGES; page++) {
    const data = await rc.call('/restapi/v1.0/account/~/extension', { params: { ...filter, perPage: EXTENSION_PAGE_SIZE, page: String(page) } })
    const records: RcRecord[] = data.records ?? []
    all.push(...records)
    if (records.length === 0 || !data.navigation?.nextPage) break
  }
  return all
}

async function listPhoneNumbers(rc: RcSession): Promise<RcRecord[]> {
  const all: RcRecord[] = []
  for (let page = 1; page <= MAX_PHONE_NUMBER_PAGES; page++) {
    const data = await rc.call('/restapi/v1.0/account/~/phone-number', { params: { perPage: PHONE_NUMBER_PAGE_SIZE, page: String(page) } })
    const records: RcRecord[] = data.records ?? []
    all.push(...records)
    if (records.length === 0 || !data.navigation?.nextPage) break
  }
  return all
}

// ---- Extension directory ---------------------------------------------------------
// A call log record names its owner only by extension id, so the calls route resolves
// ids against the account's extension list. Every status is included: a team member who
// has since been disabled still owns their past calls. The account's phone numbers are
// loaded alongside, so an inbound call that never reached anyone is still credited to
// the line that was dialled.

let directoryMemo: { account: string; expiresAt: number; directory: Directory } | null = null

const isRateLimited = (e: unknown) => e instanceof ApiError && e.code === 'rate_limited'

async function loadDirectory(rc: RcSession): Promise<Directory> {
  const account = `${rc.creds.serverUrl}|${rc.creds.clientId}`
  if (directoryMemo && directoryMemo.account === account && Date.now() < directoryMemo.expiresAt) return directoryMemo.directory
  let directory: Directory
  let ttl = DIRECTORY_TTL_MS
  try {
    const extensionList = await listExtensions(rc)
    let phoneNumbers: RcRecord[] = []
    try {
      phoneNumbers = await listPhoneNumbers(rc)
    } catch (e) {
      if (isRateLimited(e)) throw e
      // Not retried sooner than the extension list: this is a rate-limit-heavy call, and without it
      // the only loss is that unanswered inbound calls stay unattributed.
      console.warn('Phone-number list unavailable; unanswered inbound calls are not matched to a line.', e instanceof Error ? e.message : e)
    }
    directory = mapDirectory(extensionList, phoneNumbers)
  } catch (e) {
    // Rate limits are passed on so the browser waits and retries with names intact.
    // Anything else: carry on without the list rather than failing the call log.
    if (isRateLimited(e)) throw e
    console.warn('Extension list unavailable; call owners fall back to the names on each record.', e instanceof Error ? e.message : e)
    directory = emptyDirectory()
    ttl = DIRECTORY_RETRY_MS
  }
  directoryMemo = { account, expiresAt: Date.now() + ttl, directory }
  return directory
}

/** For tests: forget the cached extension list. */
export function resetDirectoryMemo(): void {
  directoryMemo = null
}

async function calls(rc: RcSession, url: URL) {
  const { from, to } = windowParams(url)
  const params = { view: 'Detailed', dateFrom: from.toISOString(), dateTo: to.toISOString(), perPage: CALL_PAGE_SIZE, page: String(pageParam(url)) }
  const hasMore = (data: RcRecord, count: number) => count > 0 && Boolean(data.navigation?.nextPage)

  if (url.searchParams.get('scope') !== 'self') {
    try {
      const data = await rc.call('/restapi/v1.0/account/~/call-log', { params })
      const records: RcRecord[] = data.records ?? []
      const directory = records.length > 0 ? await loadDirectory(rc) : emptyDirectory()
      return { records: records.map((r) => mapCall(r, directory)), hasMore: hasMore(data, records.length), scope: 'company' }
    } catch (e) {
      if (!isForbidden(e)) throw e
      // The JWT belongs to a non-admin user: RingCentral only allows that user's own call log.
    }
  }
  const me = await rc.call('/restapi/v1.0/account/~/extension/~')
  const data = await rc.call('/restapi/v1.0/account/~/extension/~/call-log', { params })
  const records: RcRecord[] = data.records ?? []
  return { records: records.map((r) => mapCall(r, undefined, { type: 'User', ...me })), hasMore: hasMore(data, records.length), scope: 'self' }
}

async function extensions(rc: RcSession) {
  try {
    const all = await listExtensions(rc, { status: 'Enabled' })
    return { extensions: all.filter((e) => e.type === 'User').map(mapExtension), scope: 'company' }
  } catch (e) {
    if (!isForbidden(e)) throw e
    const me = await rc.call('/restapi/v1.0/account/~/extension/~')
    return { extensions: [{ ...mapExtension(me), id: '~' }], scope: 'self' }
  }
}

async function sms(rc: RcSession, url: URL) {
  const { from, to } = windowParams(url)
  const extensionId = url.searchParams.get('extensionId') ?? ''
  if (!/^(\d{1,20}|~)$/.test(extensionId)) throw new ApiError(400, 'bad_request', '"extensionId" must be an extension id.')
  const data = await rc.call(`/restapi/v1.0/account/~/extension/${extensionId}/message-store`, {
    params: { messageType: 'SMS', dateFrom: from.toISOString(), dateTo: to.toISOString(), perPage: SMS_PAGE_SIZE, page: String(pageParam(url)) },
  })
  const records: RcRecord[] = data.records ?? []
  return { records: records.map(mapSms), hasMore: records.length > 0 && Boolean(data.navigation?.nextPage) }
}

async function qos(rc: RcSession, url: URL) {
  const window = windowParams(url)
  const page = pageParam(url)

  // Whole UTC days, so the first bucket isn't a partial day, and no further back than Analytics keeps.
  const earliest = Date.now() - ANALYTICS_MAX_DAYS * DAY_MS
  const clamped = window.from.getTime() < earliest
  const fromMs = Math.floor(Math.max(window.from.getTime(), earliest) / DAY_MS) * DAY_MS
  const timeSettings = { timeZone: 'UTC', timeRange: { timeFrom: new Date(fromMs).toISOString(), timeTo: window.to.toISOString() } }
  const path = '/analytics/calls/v1/accounts/~/timeline/fetch'

  const all = await rc.call(path, {
    params: { interval: 'Day', perPage: QOS_PAGE_SIZE, page: String(page) },
    body: {
      grouping: { groupBy: 'Queues' },
      timeSettings,
      responseOptions: { counters: { allCalls: true, callsByResponse: true, callsByResult: true, callsByQueueSla: true } },
    },
  })
  const queueRecords: RcRecord[] = all.data?.records ?? []
  const keys = queueRecords.map((r) => String(r.key))

  // Second pass over the same queues, answered calls only: ring time before pickup and time spent handling the call.
  let answeredRecords: RcRecord[] = []
  if (keys.length > 0) {
    const answered = await rc.call(path, {
      params: { interval: 'Day', perPage: QOS_PAGE_SIZE, page: '1' },
      body: {
        grouping: { groupBy: 'Queues', keys },
        timeSettings,
        callFilters: { callResponses: ['Answered'] },
        responseOptions: { timers: { callsSegmentsDuration: true } },
      },
    })
    answeredRecords = answered.data?.records ?? []
  }

  const mapped = mapQosTimeline(queueRecords, answeredRecords)
  const totalPages = Number(all.paging?.totalPages ?? 1)
  return { ...mapped, queues: keys.length, hasMore: page < totalPages, clampedToDays: clamped ? ANALYTICS_MAX_DAYS : null }
}

/** An IANA-style zone name ("America/Los_Angeles", "US/Pacific", "UTC"); anything else falls back to UTC. */
function timeZoneParam(url: URL): string {
  const raw = (url.searchParams.get('timeZone') ?? '').trim()
  return raw.length <= 64 && /^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(raw) ? raw : 'UTC'
}

// The Analytics Portal's Performance Report, over the API: every user's calls per day, with how
// they were answered and how long each part of them took. Accounts whose calls go straight to
// people rather than through queues get their service picture from this, not from /api/qos.
async function performance(rc: RcSession, url: URL) {
  const window = windowParams(url)
  const page = pageParam(url)
  const timeZone = timeZoneParam(url)

  const earliest = Date.now() - ANALYTICS_MAX_DAYS * DAY_MS
  const clampedToDays = window.from.getTime() < earliest ? ANALYTICS_MAX_DAYS : null
  const from = new Date(Math.max(window.from.getTime(), earliest))
  if (from >= window.to) return { records: [], unrecognised: 0, users: 0, hasMore: false, clampedToDays, timeZone }

  const fetchPage = (zone: string) =>
    rc.call('/analytics/calls/v1/accounts/~/timeline/fetch', {
      params: { interval: 'Day', perPage: QOS_PAGE_SIZE, page: String(page) },
      body: {
        grouping: { groupBy: 'Users' },
        timeSettings: { timeZone: zone, timeRange: { timeFrom: from.toISOString(), timeTo: window.to.toISOString() } },
        responseOptions: {
          counters: { allCalls: true, callsByDirection: true, callsByResponse: true, callsByResult: true, callsByCompanyHours: true, callsByActions: true },
          timers: { allCallsDuration: true, callsSegmentsDuration: true },
        },
      },
    })

  let usedZone = timeZone
  let data: RcRecord
  try {
    data = await fetchPage(timeZone)
  } catch (e) {
    // A zone name RingCentral doesn't know is a bad request; days in UTC beat no report at all.
    if (!(e instanceof RcUpstreamError) || e.upstreamStatus !== 400 || timeZone === 'UTC') throw e
    usedZone = 'UTC'
    data = await fetchPage('UTC')
  }

  const users: RcRecord[] = data.data?.records ?? []
  const directory = users.length > 0 ? await loadDirectory(rc) : emptyDirectory()
  const mapped = mapPerformanceTimeline(users, directory)
  const totalPages = Number(data.paging?.totalPages ?? 1)
  return { ...mapped, users: users.length, hasMore: page < totalPages, clampedToDays, timeZone: usedZone }
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed', message: 'Only GET is supported.' }, 405, { Allow: 'GET' })
  try {
    await requireAccess(request, env)
    const route = url.pathname.replace(/\/+$/, '')
    const handler =
      route === '/api/status'
        ? status
        : route === '/api/calls'
          ? calls
          : route === '/api/extensions'
            ? extensions
            : route === '/api/sms'
              ? sms
              : route === '/api/qos'
                ? qos
                : route === '/api/performance'
                  ? performance
                  : null
    if (!handler) return json({ error: 'not_found', message: 'Unknown API route.' }, 404)

    const rc = await RcSession.open(env, request)
    const body = await handler(rc, url)
    return json(body, 200, await rc.sessionHeader())
  } catch (e) {
    return errorResponse(e)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(request, env, url)
    return env.ASSETS.fetch(request)
  },
}
