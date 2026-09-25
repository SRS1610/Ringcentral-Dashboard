import type { DateRangePreset } from '../types'
import { formatShortDate } from '../lib/format'
import { useData } from '../state/DataContext'

const PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'mtd', label: 'MTD' },
  { key: 'all', label: 'All time' },
]

export function DateRangeControl() {
  const { preset, setPreset, range } = useData()

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
        {PRESETS.map((p) => {
          const active = p.key === preset
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              className="px-3 py-1.5 text-sm rounded-md font-medium transition-colors"
              style={{
                background: active ? 'var(--series-1)' : 'transparent',
                color: active ? '#ffffff' : 'var(--text-secondary)',
              }}
            >
              {p.label}
            </button>
          )
        })}
      </div>
      {range && (
        <span className="text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {formatShortDate(range.start)} &ndash; {formatShortDate(range.end)}
        </span>
      )}
    </div>
  )
}
