type Status = 'good' | 'warning' | 'serious' | 'critical' | 'neutral'

const STATUS_VAR: Record<Status, string> = {
  good: 'var(--status-good-text)',
  warning: 'var(--status-warning)',
  serious: 'var(--status-serious)',
  critical: 'var(--status-critical)',
  neutral: 'var(--text-muted)',
}

const STATUS_ICON: Record<Status, string> = {
  good: '●',
  warning: '▲',
  serious: '▲',
  critical: '▲',
  neutral: '●',
}

export function StatusBadge({ status, label }: { status: Status; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2 py-1" style={{ background: 'var(--surface-2)', color: STATUS_VAR[status], border: '1px solid var(--border)' }}>
      <span aria-hidden="true" style={{ fontSize: 8 }}>
        {STATUS_ICON[status]}
      </span>
      {label}
    </span>
  )
}
