import { useEffect, useRef, useState } from 'react'
import { endOfDay, format, startOfDay, subDays } from 'date-fns'
import type { DateRangePreset } from '../types'
import { formatShortDate } from '../lib/format'
import { useData } from '../state/DataContext'
import { useRingCentral } from '../state/RingCentralContext'
import { RangeCalendar, type DayRange } from './RangeCalendar'

const PRESETS: { key: Exclude<DateRangePreset, 'custom'>; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'mtd', label: 'MTD' },
  { key: 'all', label: 'All time' },
]

const fmtLong = (d: Date) => format(d, 'd MMM yyyy')

export function DateRangeControl() {
  const { preset, setPreset, range, customRange, setCustomRange } = useData()
  const rc = useRingCentral()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DayRange | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close the popover on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openPicker = () => {
    const seed = customRange ?? range ?? { start: subDays(new Date(), 6), end: new Date() }
    setDraft({ start: startOfDay(seed.start), end: startOfDay(seed.end) })
    setOpen((o) => !o)
  }

  const apply = () => {
    if (!draft) return
    const picked = { start: startOfDay(draft.start), end: endOfDay(draft.end) }
    setCustomRange(picked)
    setOpen(false)
    // Signed in: pull exactly this window's call records (and SMS) from RingCentral.
    if (rc.connected && !rc.syncing) void rc.syncNow(picked)
  }

  const customActive = preset === 'custom'
  const segBtn = (active: boolean) => ({
    background: active ? 'var(--series-1)' : 'transparent',
    color: active ? '#ffffff' : 'var(--text-secondary)',
  })

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div ref={wrapRef} className="relative">
        <div className="inline-flex flex-wrap rounded-lg border p-0.5" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setPreset(p.key)
                setOpen(false)
              }}
              className="px-3 py-1.5 text-sm rounded-md font-medium transition-colors"
              style={segBtn(p.key === preset)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={openPicker}
            aria-expanded={open}
            aria-haspopup="dialog"
            className="px-3 py-1.5 text-sm rounded-md font-medium transition-colors inline-flex items-center gap-1.5"
            style={segBtn(customActive || open)}
          >
            <CalendarIcon />
            Custom
          </button>
        </div>

        {open && (
          <div
            role="dialog"
            aria-label="Choose a date range"
            className="absolute left-0 top-full mt-2 z-30 rounded-xl p-4 shadow-xl"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <RangeCalendar initial={draft} onChange={setDraft} />
            <div className="mt-4 pt-3 flex items-center justify-between gap-4 flex-wrap" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                {draft ? (
                  <>
                    <span style={{ color: 'var(--text-muted)' }}>From</span> {fmtLong(draft.start)}{' '}
                    <span style={{ color: 'var(--text-muted)' }}>to</span> {fmtLong(draft.end)}
                  </>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>Now pick the end date</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm font-medium rounded-lg px-3 py-1.5"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!draft}
                  onClick={apply}
                  className="text-sm font-medium rounded-lg px-3.5 py-1.5"
                  style={{ background: 'var(--series-1)', color: '#ffffff', opacity: draft ? 1 : 0.5 }}
                >
                  {rc.connected ? 'Get call records' : 'Apply'}
                </button>
              </div>
            </div>
            {!rc.connected && (
              <p className="text-xs mt-2 max-w-[520px]" style={{ color: 'var(--text-muted)' }}>
                Filters the data already loaded. Sign in to RingCentral to fetch call records for any dates you pick.
              </p>
            )}
          </div>
        )}
      </div>

      {range && (
        <span className="text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {formatShortDate(range.start)} &ndash; {formatShortDate(range.end)}
          {customActive && rc.syncing && ' · fetching from RingCentral…'}
        </span>
      )}
    </div>
  )
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
