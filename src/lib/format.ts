export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n))
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function formatPercent(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds)
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const min = m % 60
    return `${h}h ${min}m`
  }
  return `${m}m ${sec}s`
}

/** "Sep 6" for an instant, as the calendar reads in `timeZone` (the viewer's own zone when omitted). */
export function formatShortDate(d: Date, timeZone?: string): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })
}

/** "Sep 6, 9:41 AM" for an instant, on the clock of `timeZone`. */
export function formatDateTime(d: Date, timeZone?: string): string {
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone })
}

/** `YYYY-MM-DD` of the UTC day; used for data that arrives already bucketed by UTC day. */
export function formatDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** "Sep 6" for a `YYYY-MM-DD` day key. The key already names a calendar day, so no zone is applied to it. */
export function formatDayKey(key: string): string {
  const d = new Date(`${key}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function formatDelta(pct: number, digits = 0): string {
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(digits)}%`
}

/** Caption for a tile's period-over-period figure; says so when nothing earlier is loaded to compare with. */
export function compareLabel(hasPrior: boolean): string {
  return hasPrior ? 'vs prior period' : 'no prior data'
}
