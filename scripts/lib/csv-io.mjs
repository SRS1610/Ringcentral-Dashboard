import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import Papa from 'papaparse'

export function readCsvRows(path) {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf-8')
  const result = Papa.parse(text, { header: true, skipEmptyLines: true })
  return result.data
}

export function writeCsvRows(path, headers, rows) {
  const csv = Papa.unparse(
    { fields: headers, data: rows.map((row) => headers.map((h) => row[h] ?? '')) },
    { newline: '\n' },
  )
  writeFileSync(path, csv + '\n')
}

/**
 * Upserts `newRows` into `existingRows` by `keyField`, then drops rows whose
 * `dateField` is older than `retentionDays`. Keeps the sync incremental
 * (only recent days need to be re-fetched each run) while bounding file growth.
 */
export function mergeRows({ existingRows, newRows, keyField, dateField, retentionDays }) {
  const byKey = new Map(existingRows.map((row) => [row[keyField], row]))
  for (const row of newRows) byKey.set(row[keyField], row)

  const cutoff = Date.now() - retentionDays * 86400000
  const merged = [...byKey.values()].filter((row) => {
    const t = Date.parse(row[dateField])
    return Number.isNaN(t) || t >= cutoff
  })
  merged.sort((a, b) => Date.parse(a[dateField]) - Date.parse(b[dateField]))
  return merged
}
