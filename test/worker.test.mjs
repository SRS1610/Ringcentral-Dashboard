// Exercises the Worker's /api/ routes against a fake RingCentral.
// Run with `npm test` (Node 22.18+ runs the TypeScript sources directly).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.ts'
import { resetTokenMemo } from '../worker/ringcentral.ts'

const RC = 'https://rc.test'
const env = {
  ASSETS: { fetch: async () => new Response('<html>site</html>', { headers: { 'Content-Type': 'text/html' } }) },
  RC_CREDENTIALS_JSON: JSON.stringify({ clientId: 'cid', clientSecret: 'csecret', jwt: 'jwt-value', server: RC }),
  DASHBOARD_PASSWORD: 'open-sesame',
}

let calls = []
let routes = {}
const realFetch = globalThis.fetch

function reply(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

beforeEach(() => {
  resetTokenMemo()
  calls = []
  routes = {
    'POST /restapi/oauth/token': () => reply({ access_token: 'tok-1', expires_in: 3600 }),
    'GET /restapi/v1.0/account/~/extension/~': () => reply({ name: 'Ada Admin', extensionNumber: '101', permissions: { admin: { enabled: true } } }),
  }
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input)
    const method = init.method ?? 'GET'
    const key = `${method} ${decodeURIComponent(url.pathname)}`
    calls.push({ key, url, init })
    const handler = routes[key]
    if (!handler) return reply({ message: `no mock for ${key}` }, 404)
    return handler(url, init)
  }
})

test.after(() => {
  globalThis.fetch = realFetch
})

const api = (path, headers = { Authorization: 'Bearer open-sesame' }, e = env) => worker.fetch(new Request(`https://dash.test${path}`, { headers }), e)
const tokenRequests = () => calls.filter((c) => c.key === 'POST /restapi/oauth/token').length
const WINDOW = 'from=2026-09-01T00:00:00Z&to=2026-09-08T00:00:00Z'

test('non-API paths are served from the static assets', async () => {
  const res = await api('/', {})
  assert.equal(await res.text(), '<html>site</html>')
  assert.equal(calls.length, 0)
})

test('live data is off until a dashboard password is configured', async () => {
  const res = await api('/api/status', {}, { ...env, DASHBOARD_PASSWORD: undefined })
  assert.equal(res.status, 503)
  assert.equal((await res.json()).error, 'not_configured')
  assert.equal(calls.length, 0, 'RingCentral must not be contacted')
})

test('a missing or wrong password is refused before RingCentral is contacted', async () => {
  const missing = await api('/api/status', {})
  assert.equal(missing.status, 401)
  assert.equal((await missing.json()).error, 'password_required')
  const wrong = await api('/api/status', { Authorization: 'Bearer nope' })
  assert.equal(wrong.status, 401)
  assert.equal((await wrong.json()).error, 'password_wrong')
  assert.equal(calls.length, 0)
})

test('DASHBOARD_AUTH=none opens the API without a password', async () => {
  const res = await api('/api/status', {}, { ...env, DASHBOARD_PASSWORD: undefined, DASHBOARD_AUTH: 'none' })
  assert.equal(res.status, 200)
})

test('missing RingCentral secrets are reported by name only', async () => {
  const res = await api('/api/status', undefined, { ASSETS: env.ASSETS, DASHBOARD_PASSWORD: 'open-sesame', RC_CLIENT_ID: 'cid' })
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.equal(body.error, 'not_configured')
  assert.match(body.message, /RC_CLIENT_SECRET, RC_JWT/)
})

test('status signs in with the JWT and never exposes credentials or the token', async () => {
  const res = await api('/api/status')
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.deepEqual(JSON.parse(text), { ok: true, user: { name: 'Ada Admin', extensionNumber: '101', isAdmin: true }, environment: 'production' })

  const tokenCall = calls.find((c) => c.key === 'POST /restapi/oauth/token')
  assert.equal(tokenCall.init.headers.Authorization, `Basic ${btoa('cid:csecret')}`)
  assert.equal(tokenCall.init.body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
  assert.equal(tokenCall.init.body.get('assertion'), 'jwt-value')

  const blob = res.headers.get('X-RC-Session')
  assert.ok(blob, 'a session blob is issued')
  for (const secret of ['tok-1', 'csecret', 'jwt-value']) {
    assert.ok(!text.includes(secret) && !blob.includes(secret), `${secret} must not reach the browser`)
  }
})

test('the token is reused: in memory, and from the session blob after the isolate is recycled', async () => {
  const first = await api('/api/status')
  const blob = first.headers.get('X-RC-Session')
  await api('/api/status')
  assert.equal(tokenRequests(), 1, 'second request reuses the in-memory token')

  resetTokenMemo() // a new isolate
  const third = await api('/api/status', { Authorization: 'Bearer open-sesame', 'X-RC-Session': blob })
  assert.equal(third.status, 200)
  assert.equal(tokenRequests(), 1, 'the blob spares a token request')
  assert.equal(third.headers.get('X-RC-Session'), null, 'a still-valid blob is not reissued')

  resetTokenMemo()
  const forged = await api('/api/status', { Authorization: 'Bearer open-sesame', 'X-RC-Session': 'AAAA' + blob.slice(4) })
  assert.equal(forged.status, 200)
  assert.equal(tokenRequests(), 2, 'a tampered blob is ignored and a new token is fetched')
})

test('a rejected JWT is explained', async () => {
  routes['POST /restapi/oauth/token'] = () => reply({ error: 'invalid_grant', error_description: 'JWT is not valid' }, 400)
  const res = await api('/api/status')
  assert.equal(res.status, 502)
  const body = await res.json()
  assert.equal(body.error, 'ringcentral_auth')
  assert.match(body.message, /JWT is not valid/)
})

test('an expired token is refreshed once', async () => {
  let n = 0
  routes['GET /restapi/v1.0/account/~/extension/~'] = () => (++n === 1 ? reply({ message: 'Token not found' }, 401) : reply({ name: 'Ada Admin' }))
  const res = await api('/api/status')
  assert.equal(res.status, 200)
  assert.equal(tokenRequests(), 2)
})

test('calls: one page, mapped, with paging and the requested window', async () => {
  routes['GET /restapi/v1.0/account/~/call-log'] = () =>
    reply({
      records: [
        {
          id: 'c1',
          startTime: '2026-09-02T01:00:00.000Z',
          direction: 'Inbound',
          from: { name: 'Caller', phoneNumber: '+15550001' },
          to: { name: 'Sales', phoneNumber: '+15550002' },
          extension: { extensionNumber: '101', name: 'Ada Admin' },
          duration: 65,
          result: 'Call connected',
          recording: { id: 'r1' },
          legs: [{ big: 'payload' }],
        },
      ],
      navigation: { nextPage: { uri: 'x' } },
    })
  const res = await api(`/api/calls?${WINDOW}&page=2`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), {
    records: [
      {
        callId: 'c1',
        startTime: '2026-09-02T01:00:00.000Z',
        direction: 'Inbound',
        fromName: 'Caller',
        fromNumber: '+15550001',
        toName: 'Sales',
        toNumber: '+15550002',
        extension: '101',
        extensionName: 'Ada Admin',
        durationSeconds: 65,
        result: 'Call connected',
        recorded: true,
      },
    ],
    hasMore: true,
    scope: 'company',
  })
  const rcCall = calls.find((c) => c.key === 'GET /restapi/v1.0/account/~/call-log')
  assert.equal(rcCall.url.searchParams.get('dateFrom'), '2026-09-01T00:00:00.000Z')
  assert.equal(rcCall.url.searchParams.get('page'), '2')
  assert.equal(rcCall.init.headers.Authorization, 'Bearer tok-1')
})

test('calls: a non-admin JWT falls back to that user’s own call log', async () => {
  routes['GET /restapi/v1.0/account/~/call-log'] = () => reply({ errorCode: 'CMN-408', message: 'In order to call this API endpoint, user needs to have [ReadCompanyCallLog] permission' }, 403)
  routes['GET /restapi/v1.0/account/~/extension/~/call-log'] = () => reply({ records: [{ id: 'c9', startTime: '2026-09-02T01:00:00Z', direction: 'Outbound' }] })
  const body = await (await api(`/api/calls?${WINDOW}`)).json()
  assert.equal(body.scope, 'self')
  assert.equal(body.records[0].extension, '101')
  assert.equal(body.records[0].extensionName, 'Ada Admin')

  calls = []
  await api(`/api/calls?${WINDOW}&page=2&scope=self`)
  assert.ok(!calls.some((c) => c.key === 'GET /restapi/v1.0/account/~/call-log'), 'scope=self skips the company call log')
})

test('bad parameters are rejected without calling RingCentral for data', async () => {
  for (const path of ['/api/calls?from=nope&to=2026-09-08T00:00:00Z', '/api/calls?from=2026-09-08T00:00:00Z&to=2026-09-01T00:00:00Z', `/api/calls?${WINDOW}&page=0`, `/api/sms?${WINDOW}&extensionId=../../account`]) {
    const res = await api(path)
    assert.equal(res.status, 400, path)
  }
  assert.ok(!calls.some((c) => c.key.includes('call-log') || c.key.includes('message-store')))
})

test('extensions: only user extensions are listed', async () => {
  routes['GET /restapi/v1.0/account/~/extension'] = () =>
    reply({ records: [{ id: 11, type: 'User', name: 'Ada', extensionNumber: '101' }, { id: 12, type: 'Department', name: 'Sales queue', extensionNumber: '200' }] })
  assert.deepEqual(await (await api('/api/extensions')).json(), { extensions: [{ id: '11', name: 'Ada', extensionNumber: '101' }], scope: 'company' })
})

test('sms: message text is never passed to the browser', async () => {
  routes['GET /restapi/v1.0/account/~/extension/11/message-store'] = () =>
    reply({ records: [{ id: 501, creationTime: '2026-09-03T05:00:00Z', direction: 'Outbound', from: { phoneNumber: '+15550001' }, to: [{ phoneNumber: '+15550002' }, { phoneNumber: '+15550003' }], messageStatus: 'Delivered', subject: 'the secret text' }] })
  const res = await api(`/api/sms?${WINDOW}&extensionId=11`)
  const text = await res.text()
  assert.ok(!text.includes('the secret text'))
  assert.deepEqual(JSON.parse(text), {
    records: [{ messageId: '501', dateTime: '2026-09-03T05:00:00Z', direction: 'Outbound', from: '+15550001', to: '+15550002;+15550003', status: 'Delivered' }],
    hasMore: false,
  })
  assert.equal(calls.at(-1).url.searchParams.get('messageType'), 'SMS')
})

test('a mailbox RingCentral refuses is reported as forbidden so the import can skip it', async () => {
  routes['GET /restapi/v1.0/account/~/extension/11/message-store'] = () => reply({ message: 'no permission' }, 403)
  const res = await api(`/api/sms?${WINDOW}&extensionId=11`)
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error, 'ringcentral_forbidden')
})

test('RingCentral rate limits are passed on with Retry-After', async () => {
  routes['GET /restapi/v1.0/account/~/call-log'] = () => reply({ message: 'Request rate exceeded' }, 429, { 'Retry-After': '42' })
  const res = await api(`/api/calls?${WINDOW}`)
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('Retry-After'), '42')
})

test('qos: queue timeline becomes one row per queue per day', async () => {
  const point = (time, counters, timers) => ({ time, counters, timers })
  const counters = (offered, answered, abandoned, inSla, outOfSla) => ({
    allCalls: { valueType: 'Instances', values: offered },
    callsByResponse: { valueType: 'Instances', values: { answered, notAnswered: offered - answered, connected: 0, notConnected: 0 } },
    callsByResult: { valueType: 'Instances', values: { completed: answered, abandoned, voicemail: 0, missed: 0 } },
    callsByQueueSla: { valueType: 'Instances', values: { inSla, outOfSla } },
  })
  const bodies = []
  routes['POST /analytics/calls/v1/accounts/~/timeline/fetch'] = (url, init) => {
    const body = JSON.parse(init.body)
    bodies.push({ body, page: url.searchParams.get('page'), interval: url.searchParams.get('interval') })
    if (body.callFilters) {
      return reply({
        paging: { page: 1, perPage: 20, totalPages: 1, totalElements: 1 },
        data: { groupedBy: 'Queues', records: [{ key: '900', points: [point('2026-09-01T00:00:00Z', undefined, { callsSegments: { valueType: 'Seconds', values: { ringing: 160, liveTalk: 2000, hold: 400 } } })] }] },
      })
    }
    return reply({
      paging: { page: 1, perPage: 20, totalPages: 3, totalElements: 41 },
      data: {
        groupedBy: 'Queues',
        records: [
          {
            key: '900',
            info: { name: 'Support', extensionNumber: '900' },
            points: [
              point('2026-09-01T00:00:00Z', counters(10, 8, 2, 6, 2)),
              point('2026-09-02T00:00:00Z', counters(0, 0, 0, 0, 0)), // no calls: no row
              point('2026-09-03T00:00:00Z', counters(5, 5, 0, 0, 0)), // calls but no SLA data: counted, not shown as 0%
            ],
          },
          { key: '901', info: { extensionNumber: '901' }, points: [point('2026-09-01T00:00:00Z', counters(4, 0, 4, 0, 4))] },
        ],
      },
    })
  }

  const res = await api(`/api/qos?from=2026-09-01T07:30:00Z&to=2026-09-04T00:00:00Z&page=1`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), {
    records: [
      { date: '2026-09-01T00:00:00Z', queue: 'Support', offered: 10, answered: 8, abandoned: 2, serviceLevelPct: 75, avgSpeedAnswerSec: 20, avgHandleTimeSec: 300, longestWaitSec: 0 },
      { date: '2026-09-01T00:00:00Z', queue: '901', offered: 4, answered: 0, abandoned: 4, serviceLevelPct: 0, avgSpeedAnswerSec: 0, avgHandleTimeSec: 0, longestWaitSec: 0 },
    ],
    skippedNoSla: 1,
    queues: 2,
    hasMore: true,
    clampedToDays: null,
  })

  assert.equal(bodies.length, 2)
  const [all, answered] = bodies
  assert.equal(all.interval, 'Day')
  assert.deepEqual(all.body.grouping, { groupBy: 'Queues' })
  assert.deepEqual(all.body.timeSettings, { timeZone: 'UTC', timeRange: { timeFrom: '2026-09-01T00:00:00.000Z', timeTo: '2026-09-04T00:00:00.000Z' } })
  assert.deepEqual(answered.body.grouping, { groupBy: 'Queues', keys: ['900', '901'] })
  assert.deepEqual(answered.body.callFilters, { callResponses: ['Answered'] })
  assert.equal(answered.page, '1')
})

test('qos: an account without Analytics access gets a clear error', async () => {
  routes['POST /analytics/calls/v1/accounts/~/timeline/fetch'] = () => reply({ errorCode: 'CMN-401', message: 'In order to call this API endpoint, application needs to have [Analytics] permission' }, 403)
  const res = await api(`/api/qos?${WINDOW}`)
  assert.equal(res.status, 403)
  assert.match((await res.json()).message, /\[Analytics\] permission/)
})

test('only GET is accepted', async () => {
  const res = await worker.fetch(new Request('https://dash.test/api/status', { method: 'POST', headers: { Authorization: 'Bearer open-sesame' } }), env)
  assert.equal(res.status, 405)
})
