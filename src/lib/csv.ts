import Papa from 'papaparse'

export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

/** Finds the first header in `headers` matching any of `candidates` (order-insensitive, punctuation-insensitive). */
export function resolveColumn(headers: string[], candidates: string[]): string | undefined {
  const normalizedHeaders = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }))
  for (const candidate of candidates) {
    const target = normalizeHeader(candidate)
    const hit = normalizedHeaders.find((h) => h.norm === target)
    if (hit) return hit.raw
  }
  return undefined
}

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
}

export function parseCsvText(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })
  const headers = result.meta.fields ?? []
  return { headers, rows: result.data }
}

export function toNumber(value: string | undefined, fallback = 0): number {
  if (value === undefined || value === '') return fallback
  const n = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(n) ? n : fallback
}

export function toDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}
