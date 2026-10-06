// Exercises the Worker's /api/ routes against a fake RingCentral.
// Run with `npm test` (Node 22.18+ runs the TypeScript sources directly).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import worker, { resetDirectoryMemo } from '../worker/index.ts'
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
  resetDirectoryMemo()
  calls = []
  routes = {
    'POST /restapi/oauth/token': () => reply({ access_token: 'tok-1', expires_in: 3600 }),
    'GET /restapi/v1.0/account/~/extension/~': () =>
      reply({ name: 'Ada Admin', extensionNumber: '101', permissions: { admin: { enabled: true } }, regionalSettings: { timezone: { id: '58', name: 'America/Los_Angeles' } } }),
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
  assert.deepEqual(JSON.parse(text), {
    ok: true,
    user: { name: 'Ada Admin', extensionNumber: '101', isAdmin: true },
    environment: 'production',
    timeZone: 'America/Los_Angeles',
  })

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
        extensionType: '',
        extensionDepartment: '',
        type: 'Voice',
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

const DIRECTORY = {
  records: [
    { id: 11, type: 'User', name: 'Ada Admin', extensionNumber: '101' },
    { id: 12, type: 'Department', name: 'Support queue', extensionNumber: '200' },
    { id: 13, type: 'User', name: 'Ben Agent', extensionNumber: '102' },
  ],
}

test('calls: the owner is the team member from the extension list, never the outside party', async () => {
  routes['GET /restapi/v1.0/account/~/extension'] = () => reply(DIRECTORY)
  routes['GET /restapi/v1.0/account/~/call-log'] = () =>
    reply({
      records: [
        // Outbound: `to` is the outside party. Its caller-ID label must not become the agent.
        { id: 'o1', startTime: '2026-09-02T01:00:00Z', direction: 'Outbound', from: { name: 'Ada Admin' }, to: { name: 'CHICAGO IL', phoneNumber: '+13125550100' }, extension: { id: 11, uri: 'x' } },
        // Inbound to a number with no name and no known extension: nobody owns it.
        { id: 'i1', startTime: '2026-09-02T02:00:00Z', direction: 'Inbound', from: { name: 'Possible spam call', phoneNumber: '+17025550100' }, to: { phoneNumber: '+18005550100' }, result: 'Missed' },
        // Inbound to a queue, picked up by a user on one of the legs.
        {
          id: 'i2',
          startTime: '2026-09-02T03:00:00Z',
          direction: 'Inbound',
          from: { name: 'LAS VEGAS NV', phoneNumber: '+17025550101' },
          to: { name: 'Support queue', phoneNumber: '+18005550100' },
          extension: { id: 12 },
          result: 'Accepted',
          legs: [
            { extension: { id: 12 }, result: 'Accepted' },
            { extension: { id: 11 }, result: 'Missed' },
            { extension: { id: 13 }, result: 'Accepted' },
          ],
        },
        // Inbound to a queue that nobody answered stays with the queue.
        { id: 'i3', startTime: '2026-09-02T04:00:00Z', direction: 'Inbound', from: { name: 'NEVADA', phoneNumber: '+17025550102' }, to: { name: 'Support queue' }, extension: { id: 12 }, result: 'Missed', legs: [{ extension: { id: 13 }, result: 'Missed' }] },
        // No record-level extension, but the account's side of the call names one.
        { id: 'o2', startTime: '2026-09-02T05:00:00Z', direction: 'Outbound', from: { extensionId: '13', name: 'Somebody' }, to: { name: 'VA', phoneNumber: '+18005550199' } },
      ],
    })
  const body = await (await api(`/api/calls?${WINDOW}`)).json()
  const owners = body.records.map((r) => [r.callId, r.extensionName, r.extension, r.extensionType])
  assert.deepEqual(owners, [
    ['o1', 'Ada Admin', '101', 'User'],
    ['i1', 'Unassigned', '', ''],
    ['i2', 'Ben Agent', '102', 'User'],
    ['i3', 'Support queue', '200', 'Department'],
    ['o2', 'Ben Agent', '102', 'User'],
  ])
  // The outside party is still reported, as the caller.
  assert.equal(body.records[0].toName, 'CHICAGO IL')
  assert.equal(body.records[1].fromName, 'Possible spam call')

  const listRequest = calls.find((c) => c.key === 'GET /restapi/v1.0/account/~/extension')
  assert.equal(listRequest.url.searchParams.get('status'), null, 'disabled users are included so their past calls resolve')
})

test('calls: the extension list is fetched once per isolate, and a failure there does not fail the call log', async () => {
  const record = { id: 'o1', startTime: '2026-09-02T01:00:00Z', direction: 'Outbound', from: { name: 'Ada Admin' }, to: { name: 'CHICAGO IL' }, extension: { id: 11 } }
  routes['GET /restapi/v1.0/account/~/call-log'] = () => reply({ records: [record] })

  // No mock for the extension list yet: RingCentral answers 404.
  const withoutList = await (await api(`/api/calls?${WINDOW}`)).json()
  assert.equal(withoutList.records[0].extensionName, 'Ada Admin', 'falls back to the account side of the call')

  resetDirectoryMemo()
  routes['GET /restapi/v1.0/account/~/extension'] = () => reply(DIRECTORY)
  calls = []
  await api(`/api/calls?${WINDOW}`)
  await api(`/api/calls?${WINDOW}&page=2`)
  assert.equal(calls.filter((c) => c.key === 'GET /restapi/v1.0/account/~/extension').length, 1)

  resetDirectoryMemo()
  routes['GET /restapi/v1.0/account/~/extension'] = () => reply({ message: 'Request rate exceeded' }, 429, { 'Retry-After': '7' })
  const limited = await api(`/api/calls?${WINDOW}`)
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('Retry-After'), '7')
})

test('status: a missing time zone is reported as empty rather than guessed', async () => {
  routes['GET /restapi/v1.0/account/~/extension/~'] = () => reply({ name: 'Ada Admin', extensionNumber: '101' })
  assert.equal((await (await api('/api/status')).json()).timeZone, '')
})

test('calls: faxes are marked so the dashboard can keep them out of call metrics', async () => {
  routes['GET /restapi/v1.0/account/~/extension'] = () => reply(DIRECTORY)
  routes['GET /restapi/v1.0/account/~/call-log'] = () =>
    reply({
      records: [
        { id: 'f1', type: 'Fax', startTime: '2026-09-02T01:00:00Z', direction: 'Outbound', to: { phoneNumber: '+13125550100' }, extension: { id: 11 }, result: 'Sent' },
        { id: 'v1', type: 'Voice', startTime: '2026-09-02T02:00:00Z', direction: 'Outbound', to: { phoneNumber: '+13125550101' }, extension: { id: 11 }, result: 'Call connected' },
        { id: 'v2', startTime: '2026-09-02T03:00:00Z', direction: 'Outbound', to: { phoneNumber: '+13125550102' }, extension: { id: 11 }, result: 'Call connected' },
      ],
    })
  const body = await (await api(`/api/calls?${WINDOW}`)).json()
  assert.deepEqual(body.records.map((r) => [r.callId, r.type]), [['f1', 'Fax'], ['v1', 'Voice'], ['v2', 'Voice']])
})

test('calls: an inbound call nobody picked up is credited to the line that was dialled', async () => {
  routes['GET /restapi/v1.0/account/~/extension'] = () =>
    reply({ records: [...DIRECTORY.records, { id: 14, type: 'User', name: 'Cy Advocate', extensionNumber: '103', contact: { department: 'Claims' } }] })
  routes['GET /restapi/v1.0/account/~/phone-number'] = () =>
    reply({
      records: [
        { phoneNumber: '+18005550100', usageType: 'MainCompanyNumber' },
        { phoneNumber: '+17025550114', usageType: 'DirectNumber', extension: { id: 14, extensionNumber: '103' } },
        { phoneNumber: '+17025550199', usageType: 'CompanyFaxNumber', label: 'Records fax' },
      ],
    })
  routes['GET /restapi/v1.0/account/~/call-log'] = () =>
    reply({
      records: [
        // Missed on a person's direct number: theirs, even though the record names no extension.
        { id: 'm1', startTime: '2026-09-02T01:00:00Z', direction: 'Inbound', from: { name: 'NEVADA', phoneNumber: '+17025550001' }, to: { phoneNumber: '+17025550114' }, result: 'Missed' },
        // Missed on the main number: a company line, not a person.
        { id: 'm2', startTime: '2026-09-02T02:00:00Z', direction: 'Inbound', from: { phoneNumber: '+17025550002' }, to: { phoneNumber: '+18005550100' }, result: 'Voicemail' },
        // A labelled company number keeps its label.
        { id: 'f1', type: 'Fax', startTime: '2026-09-02T03:00:00Z', direction: 'Inbound', from: { phoneNumber: '+17025550003' }, to: { phoneNumber: '+17025550199' }, result: 'Received' },
        // Rang the direct number but a colleague answered: the person who answered keeps the call.
        {
          id: 'a1',
          startTime: '2026-09-02T04:00:00Z',
          direction: 'Inbound',
          from: { phoneNumber: '+17025550004' },
          to: { phoneNumber: '+17025550114' },
          result: 'Accepted',
          legs: [{ extension: { id: 13 }, result: 'Accepted' }],
        },
        // The outside number on an outbound call is never looked up as one of ours.
        { id: 'o1', startTime: '2026-09-02T05:00:00Z', direction: 'Outbound', from: { name: 'Somebody' }, to: { phoneNumber: '+17025550114' }, result: 'Call connected' },
        // A number the account doesn't list stays unowned.
        { id: 'm3', startTime: '2026-09-02T06:00:00Z', direction: 'Inbound', from: { phoneNumber: '+17025550005' }, to: { phoneNumber: '+19995550000' }, result: 'Missed' },
      ],
    })
  const body = await (await api(`/api/calls?${WINDOW}`)).json()
  assert.deepEqual(
    body.records.map((r) => [r.callId, r.extensionName, r.extension, r.extensionType, r.extensionDepartment]),
    [
      ['m1', 'Cy Advocate', '103', 'User', 'Claims'],
      ['m2', 'Main number +18005550100', '', 'CompanyNumber', ''],
      ['f1', 'Records fax +17025550199', '', 'CompanyNumber', ''],
      ['a1', 'Ben Agent', '102', 'User', ''],
      ['o1', 'Somebody', '', '', ''],
      ['m3', 'Unassigned', '', '', ''],
    ],
  )

  // Loaded with the extension list: once per isolate, not once per page.
  await api(`/api/calls?${WINDOW}&page=2`)
  assert.equal(calls.filter((c) => c.key === 'GET /restapi/v1.0/account/~/phone-number').length, 1)
})

test('calls: an account that refuses the phone-number list still gets names from the extension list', async () => {
  routes['GET /restapi/v1.0/account/~/extension'] = () => reply(DIRECTORY)
  routes['GET /restapi/v1.0/account/~/phone-number'] = () => reply({ errorCode: 'CMN-408', message: 'needs [ReadCompanyPhoneNumbers]' }, 403)
  routes['GET /restapi/v1.0/account/~/call-log'] = () =>
    reply({
      records: [
        { id: 'o1', startTime: '2026-09-02T01:00:00Z', direction: 'Outbound', to: { phoneNumber: '+13125550100' }, extension: { id: 11 } },
        { id: 'm1', startTime: '2026-09-02T02:00:00Z', direction: 'Inbound', from: { phoneNumber: '+17025550001' }, to: { phoneNumber: '+18005550100' }, result: 'Missed' },
      ],
    })
  const res = await api(`/api/calls?${WINDOW}`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.scope, 'company', 'a refused phone-number list must not be mistaken for a non-admin user')
  assert.deepEqual(body.records.map((r) => r.extensionName), ['Ada Admin', 'Unassigned'])

  // Not asked again on the next page: the list is as rate-limited as the call log itself.
  await api(`/api/calls?${WINDOW}&page=2`)
  assert.equal(calls.filter((c) => c.key === 'GET /restapi/v1.0/account/~/phone-number').length, 1)
})

test('calls: a non-admin JWT falls back to that user’s own call log', async () => {
  routes['GET /restapi/v1.0/account/~/call-log'] = () => reply({ errorCode: 'CMN-408', message: 'In order to call this API endpoint, user needs to have [ReadCompanyCallLog] permission' }, 403)
  routes['GET /restapi/v1.0/account/~/extension/~/call-log'] = () => reply({ records: [{ id: 'c9', startTime: '2026-09-02T01:00:00Z', direction: 'Outbound' }] })
  const body = await (await api(`/api/calls?${WINDOW}`)).json()
  assert.equal(body.scope, 'self')
  assert.equal(body.records[0].extension, '101')
  assert.equal(body.records[0].extensionName, 'Ada Admin')
  assert.equal(body.records[0].extensionType, 'User')

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
    reply({
      records: [
        { id: 11, type: 'User', name: 'Ada', extensionNumber: '101', contact: { department: 'Intake' } },
        { id: 12, type: 'Department', name: 'Sales queue', extensionNumber: '200' },
      ],
    })
  assert.deepEqual(await (await api('/api/extensions')).json(), { extensions: [{ id: '11', name: 'Ada', extensionNumber: '101', department: 'Intake' }], scope: 'company' })
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
