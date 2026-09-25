export type SectionKey = 'overview' | 'calls' | 'quality' | 'messaging' | 'team' | 'settings'

const TABS: { key: SectionKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'calls', label: 'Call Activity' },
  { key: 'quality', label: 'Service Quality' },
  { key: 'messaging', label: 'Messaging' },
  { key: 'team', label: 'Team Performance' },
  { key: 'settings', label: 'Settings' },
]

export function Tabs({ active, onChange }: { active: SectionKey; onChange: (k: SectionKey) => void }) {
  return (
    <nav className="border-b sticky top-0 z-10" style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const isActive = t.key === active
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              className="px-3 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors"
              style={{
                borderColor: isActive ? 'var(--series-1)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
