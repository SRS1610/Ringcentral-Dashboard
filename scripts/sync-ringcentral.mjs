#!/usr/bin/env node
// Pulls recent call log + SMS data from RingCentral and merges it into the
// dashboard's public/data CSVs. Designed to run on a schedule (see
// .github/workflows/sync-ringcentral.yml) with a rolling fetch window, so
// each run only re-fetches the last few days rather than the full history.
//
// Required env vars: RC_CLIENT_ID, RC_CLIENT_SECRET, RC_JWT
// Optional: RC_SERVER_URL (defaults to production), SYNC_DAYS (default 7),
// RETENTION_DAYS (default 120)

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { fetchAllPages, getAccessToken, rcConfig } from './lib/rc-client.mjs'
import { mergeRows, readCsvRows, writeCsvRows } from './lib/csv-io.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'public', 'data')
const CALL_LOG_PATH = path.join(DATA_DIR, 'call-log-sample.csv')
const SMS_LOG_PATH = path.join(DATA_DIR, 'sms-log-sample.csv')
const DEPARTMENT_MAP_PATH = path.join(__dirname, 'department-map.json')

const SYNC_DAYS = Number(process.env.SYNC_DAYS ?? 7)
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 120)

const CALL_HEADERS = [
  'Call ID', 'Start Time', 'Direction', 'From Name', 'From Number', 'To Name', 'To Number',
  'Extension Number', 'Extension Name', 'Department', 'Duration (Seconds)', 'Result', 'Recorded',
]
const SMS_HEADERS = ['Message ID', 'Date/Time', 'Direction', 'From', 'To', 'Extension Name', 'Department', 'Segments', 'Status']

function loadDepartmentMap() {
  const raw = JSON.parse(readFileSync(DEPARTMENT_MAP_PATH, 'utf-8'))
  delete raw._comment
  return raw
}

function departmentFor(map, extensionNumber) {
  return map[extensionNumber] ?? 'Unassigned'
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString()
}

async function fetchExtensions(config, token) {
  const records = await fetchAllPages(config, token, '/restapi/v1.0/account/~/extension', { status: 'Enabled' })
  return records.filter((r) => r.type === 'User')
}

function mapCallRecord(record, deptMap) {
  const extensionNumber = record.extension?.extensionNumber ?? ''
  return {
    'Call ID': record.id,
    'Start Time': record.startTime,
    Direction: record.direction === 'Outbound' ? 'Outbound' : 'Inbound',
    'From Name': record.from?.name ?? '',
    'From Number': record.from?.phoneNumber ?? record.from?.extensionNumber ?? '',
    'To Name': record.to?.name ?? '',
    'To Number': record.to?.phoneNumber ?? record.to?.extensionNumber ?? '',
    'Extension Number': extensionNumber,
    'Extension Name': record.extension?.name ?? record.to?.name ?? record.from?.name ?? 'Unassigned',
    Department: departmentFor(deptMap, extensionNumber),
    'Duration (Seconds)': record.duration ?? 0,
    Result: record.result ?? 'Unknown',
    Recorded: record.recording ? 'Yes' : 'No',
  }
}

function mapSmsRecord(record, extension, deptMap) {
  const direction = record.direction === 'Outbound' ? 'Outbound' : 'Inbound'
  return {
    'Message ID': String(record.id),
    'Date/Time': record.creationTime,
    Direction: direction,
    From: record.from?.phoneNumber ?? '',
    To: (record.to ?? []).map((t) => t.phoneNumber).join(';'),
    'Extension Name': extension.name ?? 'Unassigned',
    Department: departmentFor(deptMap, extension.extensionNumber ?? ''),
    // RingCentral's message-store response doesn't expose SMS segment count directly;
    // default to 1 (single-part) rather than guess at a field that may not exist.
    Segments: 1,
    Status: record.messageStatus ?? 'Unknown',
  }
}

async function syncCallLog(config, token, deptMap) {
  const dateFrom = isoDaysAgo(SYNC_DAYS)
  const dateTo = new Date().toISOString()
  console.log(`Fetching call log from ${dateFrom} to ${dateTo}...`)
  const records = await fetchAllPages(config, token, '/restapi/v1.0/account/~/call-log', {
    view: 'Detailed',
    dateFrom,
    dateTo,
  })
  console.log(`  ${records.length} call log records fetched.`)
  const newRows = records.map((r) => mapCallRecord(r, deptMap))
  const existingRows = readCsvRows(CALL_LOG_PATH)
  const merged = mergeRows({
    existingRows,
    newRows,
    keyField: 'Call ID',
    dateField: 'Start Time',
    retentionDays: RETENTION_DAYS,
  })
  writeCsvRows(CALL_LOG_PATH, CALL_HEADERS, merged)
  console.log(`  Wrote ${merged.length} total call log rows (retention ${RETENTION_DAYS}d) to ${CALL_LOG_PATH}`)
}

async function syncSms(config, token, deptMap) {
  const dateFrom = isoDaysAgo(SYNC_DAYS)
  const dateTo = new Date().toISOString()
  console.log(`Fetching extensions for SMS sync...`)
  const extensions = await fetchExtensions(config, token)
  console.log(`  ${extensions.length} active user extensions found.`)

  const newRows = []
  let failures = 0
  for (const ext of extensions) {
    try {
      const messages = await fetchAllPages(
        config,
        token,
        `/restapi/v1.0/account/~/extension/${ext.id}/message-store`,
        { messageType: 'SMS', dateFrom, dateTo },
      )
      for (const m of messages) newRows.push(mapSmsRecord(m, ext, deptMap))
    } catch (err) {
      failures += 1
      console.warn(`  Skipping extension ${ext.extensionNumber} (${ext.name}): ${err.message.split('\n')[0]}`)
    }
  }
  console.log(`  ${newRows.length} SMS records fetched (${failures} extensions skipped due to errors/permissions).`)

  const existingRows = readCsvRows(SMS_LOG_PATH)
  const merged = mergeRows({
    existingRows,
    newRows,
    keyField: 'Message ID',
    dateField: 'Date/Time',
    retentionDays: RETENTION_DAYS,
  })
  writeCsvRows(SMS_LOG_PATH, SMS_HEADERS, merged)
  console.log(`  Wrote ${merged.length} total SMS rows (retention ${RETENTION_DAYS}d) to ${SMS_LOG_PATH}`)
}

async function main() {
  const config = rcConfig()
  console.log(`Authenticating against ${config.serverUrl}...`)
  const token = await getAccessToken(config)
  const deptMap = loadDepartmentMap()

  const results = await Promise.allSettled([syncCallLog(config, token, deptMap), syncSms(config, token, deptMap)])
  const failed = results.filter((r) => r.status === 'rejected')
  for (const f of failed) console.error('Sync step failed:', f.reason)
  if (failed.length === results.length) {
    console.error('All sync steps failed.')
    process.exit(1)
  }
  console.log('RingCentral sync complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
