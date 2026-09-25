export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-4 flex-wrap text-xs" style={{ color: 'var(--text-secondary)' }}>
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block rounded-full" style={{ width: 8, height: 8, background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}
