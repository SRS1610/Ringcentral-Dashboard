import { Fragment } from 'react'

interface HeatmapRow {
  day: string
  hour: number
  count: number
}

const SEQ_STEPS = ['var(--seq-100)', 'var(--seq-200)', 'var(--seq-300)', 'var(--seq-400)', 'var(--seq-500)', 'var(--seq-600)', 'var(--seq-700)']

function stepFor(value: number, max: number): string {
  if (max <= 0) return SEQ_STEPS[0]
  const ratio = value / max
  const idx = Math.min(SEQ_STEPS.length - 1, Math.floor(ratio * SEQ_STEPS.length))
  return SEQ_STEPS[idx]
}

function hourLabel(h: number): string {
  const period = h < 12 ? 'a' : 'p'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}${period}`
}

export function Heatmap({ rows, hours, days }: { rows: HeatmapRow[]; hours: number[]; days: string[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  const byKey = new Map(rows.map((r) => [`${r.day}-${r.hour}`, r.count]))

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `44px repeat(${hours.length}, 26px)` }}>
        <div />
        {hours.map((h) => (
          <div key={h} className="text-[10px] text-center" style={{ color: 'var(--text-muted)' }}>
            {hourLabel(h)}
          </div>
        ))}
        {days.map((day) => (
          <Fragment key={day}>
            <div className="text-xs flex items-center" style={{ color: 'var(--text-secondary)' }}>
              {day}
            </div>
            {hours.map((h) => {
              const count = byKey.get(`${day}-${h}`) ?? 0
              return (
                <div
                  key={`${day}-${h}`}
                  title={`${day} ${hourLabel(h)}: ${count} calls`}
                  className="rounded-[3px]"
                  style={{ width: 26, height: 20, background: count === 0 ? 'var(--surface-2)' : stepFor(count, max), border: '1px solid var(--border)' }}
                />
              )
            })}
          </Fragment>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <span>Fewer</span>
        <div className="flex gap-[2px]">
          {SEQ_STEPS.map((s) => (
            <div key={s} style={{ width: 14, height: 10, background: s, borderRadius: 2 }} />
          ))}
        </div>
        <span>More calls</span>
      </div>
    </div>
  )
}
