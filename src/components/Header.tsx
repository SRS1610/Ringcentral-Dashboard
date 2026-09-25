import { useState } from 'react'
import { DateRangeControl } from './DateRangeControl'
import { UploadPanel } from './UploadPanel'

export function Header() {
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
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="text-sm font-medium rounded-lg px-3.5 py-2 whitespace-nowrap"
            style={{ background: 'var(--series-1)', color: '#ffffff' }}
          >
            Upload data
          </button>
        </div>
        <DateRangeControl />
      </div>
      {uploadOpen && <UploadPanel onClose={() => setUploadOpen(false)} />}
    </header>
  )
}
