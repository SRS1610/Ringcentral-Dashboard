import { useState } from 'react'
import { DateRangeControl } from './DateRangeControl'
import { useRingCentral } from '../state/RingCentralContext'

function RingCentralChip({ onOpenSettings }: { onOpenSettings: () => void }) {
  const rc = useRingCentral()
  const [signingOut, setSigningOut] = useState(false)
  if (!rc.ready) return null

  if (!rc.connected) {
    return (
      <button
        type="button"
        onClick={onOpenSettings}
        className="text-sm font-medium rounded-lg px-3.5 py-2 whitespace-nowrap"
        style={{ background: 'var(--series-1)', color: '#ffffff' }}
      >
        {rc.lastError || rc.abandonedApp ? 'Sign-in problem — see Settings' : 'Sign in to RingCentral'}
      </button>
    )
  }

  const problem = !rc.syncing && rc.lastError
  const dot = rc.syncing ? 'var(--series-1)' : problem ? 'var(--status-critical)' : 'var(--status-good)'
  const label = rc.syncing ? 'Importing from RingCentral…' : problem ? 'RingCentral: import problem' : `Live · ${rc.user?.name ?? 'RingCentral'}`
  return (
    <>
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
    <button
      type="button"
      disabled={signingOut}
      onClick={async () => {
        if (!window.confirm('Sign out of RingCentral? This ends the connection and clears the saved sign-in on this browser.')) return
        setSigningOut(true)
        try {
          await rc.signOut()
        } finally {
          setSigningOut(false)
        }
      }}
      title="Sign out of RingCentral and stop the connection"
      className="text-sm font-medium rounded-lg px-3 py-2 whitespace-nowrap inline-flex items-center gap-1.5"
      style={{ border: '1px solid var(--border)', color: 'var(--status-critical)', opacity: signingOut ? 0.6 : 1 }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10.5 11l3-3-3-3M13.5 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {signingOut ? 'Signing out…' : 'Sign out'}
    </button>
    </>
  )
}

export function Header({ onOpenSettings, onOpenUpload }: { onOpenSettings: () => void; onOpenUpload: () => void }) {
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
              onClick={onOpenUpload}
              className="text-sm font-medium rounded-lg px-3.5 py-2 whitespace-nowrap"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              Upload data
            </button>
          </div>
        </div>
        <DateRangeControl />
      </div>
    </header>
  )
}
