interface Row {
  label: string
  value: string
  color: string
}

export function TooltipShell({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
    >
      <div className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        {title}
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 justify-between min-w-[140px]">
            <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
              <span aria-hidden="true" className="inline-block rounded-full" style={{ width: 8, height: 8, background: r.color }} />
              {r.label}
            </span>
            <span className="font-medium tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function makeTooltipFormatter(
  labelFormatter: (label: string) => string,
  seriesConfig: { key: string; label: string; color: string; format?: (v: number) => string }[],
) {
  // Recharts' generic Tooltip `content` prop is invariant in ValueType/NameType,
  // which makes a concretely-typed custom renderer awkward to assign directly;
  // narrow from `unknown` here instead of fighting the variance.
  return function CustomTooltip(props: unknown) {
    const { active, payload, label } = props as {
      active?: boolean
      payload?: { dataKey?: string; value?: number | string }[]
      label?: string | number
    }
    if (!active || !payload || payload.length === 0) return null
    const rows = seriesConfig
      .map((cfg) => {
        const entry = payload.find((p) => p.dataKey === cfg.key)
        if (!entry) return null
        const raw = typeof entry.value === 'number' ? entry.value : Number(entry.value)
        return { label: cfg.label, value: cfg.format ? cfg.format(raw) : String(entry.value), color: cfg.color }
      })
      .filter((r): r is Row => r !== null)
    return <TooltipShell title={labelFormatter(String(label))} rows={rows} />
  }
}
