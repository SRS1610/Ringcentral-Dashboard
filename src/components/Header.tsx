import { useState } from 'react'
import { DateRangeControl } from './DateRangeControl'
import { UploadPanel } from './UploadPanel'
import { useRingCentral } from '../state/RingCentralContext'

function RingCentralChip({ onOpenSettings }: { onOpenSettings: () => void }) {
  const rc = useRingCentral()
  if (!rc.ready) return null

  if (!rc.connected) {
    return (
      <button
        type="button"
        onClick={onOpenSettings}
        className="text-sm font-medium rounded-lg px-3.5 py-2 whitespace-nowrap"
        style={{ background: 'var(--series-1)', color: '#ffffff' }}
      >
        {rc.lastError ? 'Sign-in problem — retry' : 'Sign in to RingCentral'}
      </button>
    )
  }

  const problem = !rc.syncing && rc.lastError
  const dot = rc.syncing ? 'var(--series-1)' : problem ? 'var(--status-critical)' : 'var(--status-good)'
  const label = rc.syncing ? 'Importing from RingCentral…' : problem ? 'RingCentral: import problem' : `Live · ${rc.user?.name ?? 'RingCentral'}`
  return (
    <button
      type="button"
      onClick={onOpenSettings}
      title="RingCentral account and sync settings"
      className="text-sm font-medium rounded-lg px-3 py-2 whitespace-nowrap inline-flex items-center gap-2"
      style={{ border: '1px solid var(--border)', color: 'var(--text-primary)', background: 'var(--surface-2)' }}
    >
      <span aria-hidden="true" className="inline-block rounded-full" style={{ width: 8, height: 8, background: dot }} />
      {label}
    </button>
  )
}

export function Header({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [uploadOpen, setUploadOpen] = useState(false)

  return (
    <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              RingCentral Performance Dashboard
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Voice, service quality, and messaging activity across the organization
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <RingCentralChip onOpenSettings={onOpenSettings} />
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="text-sm font-medium rounded-lg px-3.5 py-2 whitespace-nowrap"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              Upload data
            </button>
          </div>
        </div>
        <DateRangeControl />
      </div>
      {uploadOpen && <UploadPanel onClose={() => setUploadOpen(false)} />}
    </header>
  )
}
