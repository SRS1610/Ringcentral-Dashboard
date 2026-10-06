import type { ReactNode } from 'react'

interface StatTileProps {
  label: string
  value: string
  sublabel?: string
  delta?: number | null
  deltaGoodDirection?: 'up' | 'down'
  icon?: ReactNode
  /** Makes the tile a button, e.g. to list the calls behind the number. */
  onClick?: () => void
  active?: boolean
  actionLabel?: string
}

export function StatTile({ label, value, sublabel, delta, deltaGoodDirection = 'up', icon, onClick, active, actionLabel }: StatTileProps) {
  const hasDelta = delta !== undefined && delta !== null && Number.isFinite(delta)
  const isUp = hasDelta && delta! > 0.05
  const isDown = hasDelta && delta! < -0.05
  const isGood = hasDelta && ((deltaGoodDirection === 'up' && isUp) || (deltaGoodDirection === 'down' && isDown))
  const isBad = hasDelta && ((deltaGoodDirection === 'up' && isDown) || (deltaGoodDirection === 'down' && isUp))

  const className = 'rounded-xl border p-4 sm:p-5 flex flex-col gap-2 min-w-0 text-left'
  const style = { borderColor: active ? 'var(--series-1)' : 'var(--border)', background: 'var(--surface-1)' }

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
        {icon}
      </div>
      <div className="text-2xl sm:text-3xl font-semibold tabular-nums truncate" style={{ color: 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm min-h-[20px]">
        {hasDelta && (isUp || isDown) && (
          <span
            className="inline-flex items-center gap-1 font-medium tabular-nums"
            style={{ color: isGood ? 'var(--status-good-text)' : isBad ? 'var(--status-critical)' : 'var(--text-muted)' }}
          >
            <span aria-hidden="true">{isUp ? '▲' : '▼'}</span>
            {Math.abs(delta!).toFixed(1)}%
          </span>
        )}
        {sublabel && <span style={{ color: 'var(--text-muted)' }}>{sublabel}</span>}
      </div>
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} title={actionLabel} className={`${className} cursor-pointer transition hover:brightness-110`} style={style}>
        {body}
      </button>
    )
  }
  return (
    <div className={className} style={style}>
      {body}
    </div>
  )
}
