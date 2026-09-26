import { useState } from 'react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'

export interface DayRange {
  start: Date
  end: Date
}

interface Props {
  initial: DayRange | null
  /** Days after this can't be picked (defaults to today). */
  maxDate?: Date
  onChange: (range: DayRange | null) => void
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/**
 * Two-month range calendar: first click sets "from", second click sets "to"
 * (clicking an earlier day than "from" restarts the selection there).
 */
export function RangeCalendar({ initial, maxDate = new Date(), onChange }: Props) {
  const max = startOfDay(maxDate)
  const [start, setStart] = useState<Date | null>(initial ? startOfDay(initial.start) : null)
  const [end, setEnd] = useState<Date | null>(initial ? startOfDay(initial.end) : null)
  const [hover, setHover] = useState<Date | null>(null)
  // Left-hand month; the right-hand one is the month after.
  const [month, setMonth] = useState<Date>(() => startOfMonth(subMonths(initial ? initial.end : max, 1)))

  const pick = (day: Date) => {
    if (!start || end || isBefore(day, start)) {
      setStart(day)
      setEnd(null)
      onChange(null)
      return
    }
    setEnd(day)
    onChange({ start, end: day })
  }

  // While choosing the "to" day, preview the range under the pointer.
  const previewEnd = start && !end && hover && !isBefore(hover, start) ? hover : end

  const canGoNext = !isAfter(startOfMonth(addMonths(month, 1)), startOfMonth(max)) && !isSameMonth(addMonths(month, 1), max)

  const renderMonth = (m: Date, className = '') => {
    const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(m)), end: endOfWeek(endOfMonth(m)) })
    return (
      <div className={className}>
        <div className="text-sm font-semibold text-center mb-2" style={{ color: 'var(--text-primary)' }}>
          {format(m, 'MMMM yyyy')}
        </div>
        <div className="grid grid-cols-7 gap-y-1 text-center">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-xs py-1" style={{ color: 'var(--text-muted)' }}>
              {w}
            </div>
          ))}
          {days.map((day) => {
            const outside = !isSameMonth(day, m)
            if (outside) return <div key={day.toISOString()} />
            const disabled = isAfter(day, max)
            const isStart = start && isSameDay(day, start)
            const isEnd = previewEnd && isSameDay(day, previewEnd)
            const inRange = start && previewEnd && isAfter(day, start) && isBefore(day, previewEnd)
            const isToday = isSameDay(day, max)
            const selected = isStart || isEnd
            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={disabled}
                onClick={() => pick(day)}
                onMouseEnter={() => setHover(day)}
                aria-label={format(day, 'EEEE, MMMM d, yyyy')}
                aria-pressed={Boolean(selected)}
                className="h-9 text-sm tabular-nums transition-colors"
                style={{
                  background: selected ? 'var(--series-1)' : inRange ? 'var(--range-fill)' : 'transparent',
                  color: disabled ? 'var(--baseline)' : selected ? '#ffffff' : 'var(--text-primary)',
                  borderRadius: selected ? 8 : inRange ? 0 : 8,
                  fontWeight: selected || isToday ? 600 : 400,
                  textDecoration: isToday && !selected ? 'underline' : 'none',
                  textUnderlineOffset: 3,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                {format(day, 'd')}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div onMouseLeave={() => setHover(null)}>
      <div className="flex items-center justify-between mb-1">
        <NavButton label="Previous month" onClick={() => setMonth((m) => subMonths(m, 1))}>
          ‹
        </NavButton>
        <NavButton label="Next month" disabled={!canGoNext} onClick={() => setMonth((m) => addMonths(m, 1))}>
          ›
        </NavButton>
      </div>
      <div className="flex gap-6">
        {renderMonth(month, 'w-[252px] hidden sm:block')}
        {renderMonth(addMonths(month, 1), 'w-[252px]')}
      </div>
    </div>
  )
}

function NavButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="w-8 h-8 rounded-md text-lg leading-none"
      style={{ color: disabled ? 'var(--baseline)' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
    >
      {children}
    </button>
  )
}
