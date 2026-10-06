// The numbers the dashboard shows: voice vs fax, answer rates, time zones, comparisons.
// Run with `npm test` (Node 22.18+ runs the TypeScript sources directly).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callHeatmap,
  callKindOf,
  callKpis,
  callsForMetric,
  dailyCallVolume,
  faxKpis,
  filterByRange,
  hasDepartments,
  priorRange,
  smsKpis,
  splitByKind,
  volumeByGroup,
} from '../src/lib/metrics.ts'
import { isValidTimeZone, zonedDateKey, zonedDayEnd, zonedDayStart, zonedMidnight, zonedMonthStart, zonedParts } from '../src/lib/timezone.ts'
import { departmentFor } from '../src/lib/departmentMap.ts'
import { formatDayKey } from '../src/lib/format.ts'

let seq = 0
const call = (over = {}) => ({
  callId: `c${++seq}`,
  kind: 'voice',
  startTime: new Date('2026-09-15T15:00:00Z'),
  direction: 'Outbound',
  fromName: '',
  fromNumber: '',
  toName: '',
  toNumber: '',
  extension: '104',
  extensionName: 'Pat',
  extensionType: 'User',
  department: 'Unassigned',
  durationSeconds: 0,
  result: 'Call connected',
  recorded: false,
  ...over,
})
const many = (n, over) => Array.from({ length: n }, () => call(over))

// ---- Voice vs fax ------------------------------------------------------------

test('RingCentral’s own type decides fax vs voice; without it the result does', () => {
  assert.equal(callKindOf('Fax', 'Wrong Number'), 'fax')
  assert.equal(callKindOf('Voice', 'Received'), 'voice')
  for (const result of ['Sent', 'Received', 'Fax Not Sent', 'Receive Error', 'Send Error', 'Partial Receive', 'Fax Partially Sent', 'Fax on Demand']) {
    assert.equal(callKindOf(undefined, result), 'fax', result)
  }
  for (const result of ['Call connected', 'Accepted', 'Missed', 'Voicemail', 'Hang Up', 'Wrong Number', 'Blocked', 'No Answer', 'Rejected']) {
    assert.equal(callKindOf('', result), 'voice', result)
  }
})

test('faxes are counted on their own, with failures', () => {
  const log = [
    ...many(5, { kind: 'fax', result: 'Sent' }),
    ...many(2, { kind: 'fax', result: 'Fax Not Sent' }),
    ...many(3, { kind: 'fax', direction: 'Inbound', result: 'Received' }),
    call({ kind: 'fax', direction: 'Inbound', result: 'Receive Error' }),
    ...many(4),
  ]
  const { voice, fax } = splitByKind(log)
  assert.equal(voice.length, 4)
  assert.deepEqual(faxKpis(fax), { total: 11, sent: 7, received: 4, failed: 3 })
})

// ---- Call KPIs ---------------------------------------------------------------

test('inbound answered and outbound connected are separate rates, over voice calls only', () => {
  // The shape of the live account this was built against: a busy outbound team, few inbound calls, and a fax line.
  const log = [
    ...many(2767, { result: 'Call connected', durationSeconds: 600 }),
    ...many(18, { result: 'Hang Up' }),
    ...many(6, { result: 'Wrong Number' }),
    ...many(2, { result: 'No Answer' }),
    ...many(4, { direction: 'Inbound', result: 'Accepted', durationSeconds: 300 }),
    ...many(44, { direction: 'Inbound', result: 'Missed', extensionName: 'Unassigned', extensionType: '' }),
    ...many(36, { direction: 'Inbound', result: 'Voicemail', extensionName: 'Unassigned', extensionType: '', durationSeconds: 40 }),
    ...many(4, { direction: 'Inbound', result: 'Blocked' }),
    call({ direction: 'Inbound', result: 'Rejected' }),
    ...many(964, { kind: 'fax', result: 'Sent', durationSeconds: 60 }),
    ...many(965, { kind: 'fax', direction: 'Inbound', result: 'Received', durationSeconds: 60 }),
  ]
  const k = callKpis(splitByKind(log).voice)
  assert.equal(k.total, 2882)
  assert.equal(k.inbound, 89)
  assert.equal(k.outbound, 2793)
  assert.equal(k.inboundAnswered, 4)
  assert.equal(k.outboundConnected, 2767)
  assert.equal(k.connected, 2771)
  assert.equal(k.missed, 44)
  assert.equal(k.voicemail, 36)
  assert.equal(Math.round(k.inboundAnswerRate * 10) / 10, 4.5)
  assert.equal(Math.round(k.outboundConnectRate * 10) / 10, 99.1)
  // Average length of answered calls; voicemails and faxes don't drag it.
  assert.equal(Math.round(k.avgDuration), Math.round((2767 * 600 + 4 * 300) / 2771))
})

test('no calls means no rates, not a divide-by-zero', () => {
  const k = callKpis([])
  assert.equal(k.inboundAnswerRate, 0)
  assert.equal(k.outboundConnectRate, 0)
  assert.equal(k.avgDuration, 0)
})

test('the "connected" caller list includes answered inbound calls', () => {
  const log = [call(), call({ direction: 'Inbound', result: 'Accepted' }), call({ direction: 'Inbound', result: 'Missed' })]
  assert.equal(callsForMetric(log, 'connected').length, 2)
  assert.equal(callsForMetric(log, 'missed').length, 1)
})

// ---- SMS ---------------------------------------------------------------------

test('SMS delivery rate is measured on messages sent, not on messages received', () => {
  const sms = [
    ...Array.from({ length: 47 }, () => ({ direction: 'Outbound', status: 'Delivered' })),
    ...Array.from({ length: 30 }, () => ({ direction: 'Inbound', status: 'Received' })),
  ]
  const k = smsKpis(sms)
  assert.equal(k.deliveryRate, 100)
  assert.deepEqual([k.total, k.inbound, k.outbound, k.delivered, k.failed], [77, 30, 47, 47, 0])

  const withFailures = smsKpis([...sms, { direction: 'Outbound', status: 'DeliveryFailed' }, { direction: 'Outbound', status: 'SendingFailed' }, { direction: 'Outbound', status: 'Queued' }])
  assert.equal(withFailures.failed, 2)
  assert.equal(withFailures.deliveryRate, (47 / 50) * 100)
  assert.equal(smsKpis([{ direction: 'Inbound', status: 'Received' }]).deliveryRate, 0)
})

// ---- Time zone ---------------------------------------------------------------

test('a moment is placed on the calendar and clock of the chosen zone', () => {
  const t = new Date('2026-09-15T03:30:00Z') // Monday evening in the US, Tuesday in Australia
  assert.deepEqual(zonedParts(t, 'America/Los_Angeles'), { year: 2026, month: 9, day: 14, hour: 20, minute: 30, second: 0, weekday: 1 })
  assert.equal(zonedDateKey(t, 'America/Los_Angeles'), '2026-09-14')
  assert.equal(zonedDateKey(t, 'Australia/Melbourne'), '2026-09-15')
  assert.equal(zonedDateKey(t, 'UTC'), '2026-09-15')
  assert.equal(zonedParts(new Date('2026-09-15T07:00:00Z'), 'America/Los_Angeles').hour, 0, 'midnight is hour 0, not 24')
})

test('day and month boundaries follow the zone, including across daylight-saving changes', () => {
  assert.equal(zonedMidnight(2026, 9, 15, 'America/New_York').toISOString(), '2026-09-15T04:00:00.000Z')
  assert.equal(zonedMidnight(2026, 9, 31, 'America/New_York').toISOString(), '2026-10-01T04:00:00.000Z', 'day overflow rolls into the next month')
  // US clocks go back on 1 Nov 2026 and forward on 8 Mar 2026.
  assert.equal(zonedMidnight(2026, 11, 1, 'America/New_York').toISOString(), '2026-11-01T04:00:00.000Z')
  assert.equal(zonedMidnight(2026, 11, 2, 'America/New_York').toISOString(), '2026-11-02T05:00:00.000Z')
  assert.equal(zonedMidnight(2026, 3, 8, 'America/New_York').toISOString(), '2026-03-08T05:00:00.000Z')
  assert.equal(zonedMidnight(2026, 3, 9, 'America/New_York').toISOString(), '2026-03-09T04:00:00.000Z')
  // Melbourne moves forward on 4 Oct 2026.
  assert.equal(zonedMidnight(2026, 10, 4, 'Australia/Melbourne').toISOString(), '2026-10-03T14:00:00.000Z')
  assert.equal(zonedMidnight(2026, 10, 5, 'Australia/Melbourne').toISOString(), '2026-10-04T13:00:00.000Z')

  const t = new Date('2026-10-06T15:06:00Z')
  assert.equal(zonedDayStart(t, 'America/New_York').toISOString(), '2026-10-06T04:00:00.000Z')
  assert.equal(zonedDayStart(t, 'America/New_York', -29).toISOString(), '2026-09-07T04:00:00.000Z')
  assert.equal(zonedDayEnd(t, 'America/New_York').toISOString(), '2026-10-07T03:59:59.999Z')
  assert.equal(zonedMonthStart(t, 'America/New_York').toISOString(), '2026-10-01T04:00:00.000Z')
})

test('zone names are validated before use', () => {
  assert.ok(isValidTimeZone('America/Los_Angeles'))
  assert.ok(isValidTimeZone('US/Pacific'), 'RingCentral sometimes reports the older alias')
  assert.ok(!isValidTimeZone('Mars/Olympus'))
  assert.ok(!isValidTimeZone(''))
  assert.ok(!isValidTimeZone(null))
})

test('daily volume buckets a late-evening call on the team’s day', () => {
  const calls = [
    call({ startTime: new Date('2026-09-15T01:30:00Z') }), // Mon 14 Sep, 9:30pm in New York
    call({ startTime: new Date('2026-09-15T14:00:00Z'), direction: 'Inbound' }),
  ]
  assert.deepEqual(dailyCallVolume(calls, 'America/New_York'), [
    { date: '2026-09-14', inbound: 0, outbound: 1, total: 1 },
    { date: '2026-09-15', inbound: 1, outbound: 0, total: 1 },
  ])
  assert.deepEqual(dailyCallVolume(calls, 'UTC').map((d) => d.date), ['2026-09-15'])
})

test('day keys are labelled as the day they name, wherever the page is opened', () => {
  assert.equal(formatDayKey('2026-09-06'), 'Sep 6')
  assert.equal(formatDayKey('not-a-date'), 'not-a-date')
})

test('the heatmap follows the hours calls actually happen in the chosen zone', () => {
  // A 13:00–21:59 UTC working day is 9am–5pm in New York: all of it must be on the grid.
  const calls = []
  for (let hour = 13; hour <= 21; hour++) calls.push(...many(40, { startTime: new Date(Date.UTC(2026, 8, 15, hour, 15)) }))
  calls.push(call({ startTime: new Date('2026-09-15T07:00:00Z') })) // one stray at 3am New York

  const ny = callHeatmap(calls, 'America/New_York')
  assert.deepEqual(ny.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17])
  assert.equal(ny.outside, 1)
  assert.equal(ny.rows.find((r) => r.day === 'Tue' && r.hour === 9).count, 40)
  assert.equal(ny.rows.reduce((sum, r) => sum + r.count, 0), 360)

  // The same calls on a Pacific clock run 6am–2pm; the grid widens to show them instead of cutting them off.
  const la = callHeatmap(calls, 'America/Los_Angeles')
  assert.deepEqual([la.hours[0], la.hours.at(-1)], [6, 17])
  assert.equal(la.outside, 1)
  assert.equal(la.rows.find((r) => r.day === 'Tue' && r.hour === 6).count, 40)
})

// ---- Comparison period -------------------------------------------------------

test('the prior period is the same length and ends the instant before the range starts', () => {
  const range = { start: new Date('2026-09-07T04:00:00.000Z'), end: new Date('2026-10-07T03:59:59.999Z') } // 30 whole New York days
  const prior = priorRange(range)
  assert.equal(prior.end.toISOString(), '2026-09-07T03:59:59.999Z')
  assert.equal(prior.start.toISOString(), '2026-08-08T04:00:00.000Z')
  assert.equal(prior.end.getTime() - prior.start.getTime(), range.end.getTime() - range.start.getTime())

  // A call on the last day before the range belongs to the prior period, and to nothing else.
  const dayBefore = [call({ startTime: new Date('2026-09-06T18:00:00Z') })]
  assert.equal(filterByRange(dayBefore, (c) => c.startTime, prior).length, 1)
  assert.equal(filterByRange(dayBefore, (c) => c.startTime, range).length, 0)
})

// ---- Departments -------------------------------------------------------------

test('a department comes from Settings first, then RingCentral’s directory', () => {
  assert.equal(departmentFor({ 104: 'Intake' }, '104', 'Claims'), 'Intake')
  assert.equal(departmentFor({}, '104', 'Claims'), 'Claims')
  assert.equal(departmentFor({ 104: '  ' }, '104', ''), 'Unassigned')
  assert.equal(departmentFor({}, '104'), 'Unassigned')
})

test('with no departments set up, volume is ranked by team member instead of one "Unassigned" bar', () => {
  const calls = [...many(3, { extensionName: 'Pat' }), ...many(5, { extensionName: 'Lee' }), call({ extensionName: '' })]
  assert.ok(!hasDepartments(calls))
  assert.deepEqual(volumeByGroup(calls), {
    by: 'member',
    rows: [
      { name: 'Lee', value: 5 },
      { name: 'Pat', value: 3 },
      { name: 'Unassigned', value: 1 },
    ],
  })

  const mapped = [...many(3, { department: 'Intake' }), ...many(2, { department: 'Claims' }), call()]
  assert.ok(hasDepartments(mapped))
  assert.deepEqual(volumeByGroup(mapped).rows, [
    { name: 'Intake', value: 3 },
    { name: 'Claims', value: 2 },
    { name: 'Unassigned', value: 1 },
  ])
})
