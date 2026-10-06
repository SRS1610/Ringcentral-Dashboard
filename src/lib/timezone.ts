// The dashboard reports in one time zone (the RingCentral account's, unless the viewer
// picks another in Settings), so "Tuesday 9am" means the team's Tuesday 9am no matter
// where the page is opened. Everything here works on plain Dates and an IANA zone name.

const DAY_MS = 86_400_000

export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function listTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['UTC']
  }
}

export interface ZonedParts {
  year: number
  /** 1–12 */
  month: number
  day: number
  /** 0–23 */
  hour: number
  minute: number
  second: number
  /** 0 = Sunday */
  weekday: number
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const partsFormatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsFormatters.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsFormatters.set(timeZone, fmt)
  }
  return fmt
}

/** The calendar date and clock time `date` falls on in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const out: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, weekday: 0 }
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    switch (part.type) {
      case 'year':
        out.year = Number(part.value)
        break
      case 'month':
        out.month = Number(part.value)
        break
      case 'day':
        out.day = Number(part.value)
        break
      case 'hour':
        out.hour = Number(part.value) % 24
        break
      case 'minute':
        out.minute = Number(part.value)
        break
      case 'second':
        out.second = Number(part.value)
        break
      case 'weekday':
        out.weekday = WEEKDAYS[part.value] ?? 0
        break
    }
  }
  return out
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` of the day `date` falls on in `timeZone`. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** How far `timeZone`'s clock is ahead of UTC at `date`, in ms. */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** The instant a calendar day starts in `timeZone`. `month` is 1–12; `day` may overflow (day 32 rolls into the next month). */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const wallClock = Date.UTC(year, month - 1, day)
  // The offset at the answer can differ from the offset at the first guess across a DST change; a second pass settles it.
  let instant = wallClock - offsetMs(new Date(wallClock), timeZone)
  instant = wallClock - offsetMs(new Date(instant), timeZone)
  return new Date(instant)
}

/** Start of the day `date` falls on in `timeZone`, moved by `addDays` calendar days. */
export function zonedDayStart(date: Date, timeZone: string, addDays = 0): Date {
  const p = zonedParts(date, timeZone)
  return zonedMidnight(p.year, p.month, p.day + addDays, timeZone)
}

/** Last millisecond of the day `date` falls on in `timeZone`. */
export function zonedDayEnd(date: Date, timeZone: string): Date {
  return new Date(zonedDayStart(date, timeZone, 1).getTime() - 1)
}

/** Start of the month `date` falls in, in `timeZone`. */
export function zonedMonthStart(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone)
  return zonedMidnight(p.year, p.month, 1, timeZone)
}

/**
 * The day a daily bucket from RingCentral Analytics stands for. A bucket starts at midnight in
 * the zone the report was requested in, but the timestamp can arrive either as that true
 * instant or as the local date stamped "00:00" with no usable offset. Both are read as the
 * same day; anything else (a first bucket cut short by the requested start) is taken as given.
 */
export function analyticsDay(time: string, timeZone: string): { date: Date; day: string } {
  const instant = new Date(time)
  const literal = /^(\d{4})-(\d{2})-(\d{2})T00:00(?::00(?:\.0+)?)?/.exec(time)
  if (!Number.isNaN(instant.getTime())) {
    const p = zonedParts(instant, timeZone)
    if (!literal || (p.hour === 0 && p.minute === 0 && p.second === 0)) return { date: instant, day: zonedDateKey(instant, timeZone) }
  }
  if (literal) {
    return { date: zonedMidnight(Number(literal[1]), Number(literal[2]), Number(literal[3]), timeZone), day: `${literal[1]}-${literal[2]}-${literal[3]}` }
  }
  return { date: instant, day: time.slice(0, 10) }
}

/** Short zone label for captions, e.g. "PDT" or "GMT+8". */
export function timeZoneAbbreviation(timeZone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')
    return part?.value ?? timeZone
  } catch {
    return timeZone
  }
}

export { DAY_MS }
