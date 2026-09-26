import { useRef, useState } from 'react'
import { useData } from '../state/DataContext'
import type { DatasetSource } from '../types'

function UploadRow({
  title,
  description,
  fileName,
  source,
  rowCount,
  error,
  onSelect,
}: {
  title: string
  description: string
  fileName: string
  source: DatasetSource
  rowCount: number
  error: string | null
  onSelect: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const sourceLabel =
    source === 'uploaded'
      ? `Using your file: ${fileName}`
      : source === 'ringcentral'
        ? `Live from ${fileName}`
        : rowCount > 0
          ? `Using synced RingCentral data (${rowCount.toLocaleString()} rows)`
          : 'No data loaded yet'
  return (
    <div className="flex items-start justify-between gap-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="min-w-0">
        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {title}
        </div>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
        <p className="text-xs mt-1 tabular-nums" style={{ color: source === 'site' && rowCount === 0 ? 'var(--text-muted)' : 'var(--status-good-text)' }}>
          {sourceLabel}
        </p>
        {error && (
          <p className="text-xs mt-1" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}
      </div>
      <div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onSelect(file)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-xs font-medium rounded-md px-3 py-1.5 whitespace-nowrap"
          style={{ border: '1px solid var(--border)', color: 'var(--text-primary)', background: 'var(--surface-2)' }}
        >
          Upload CSV
        </button>
      </div>
    </div>
  )
}

export function UploadPanel({ onClose }: { onClose: () => void }) {
  const { calls, qos, sms, loadCallsFile, loadQosFile, loadSmsFile, resetToSiteData } = useData()
  const hasOverrides = [calls, qos, sms].some((d) => d.source !== 'site')
  const [closing, setClosing] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.35)' }}
        onClick={onClose}
      />
      <div
        className="relative w-full sm:w-[420px] h-full overflow-y-auto p-5 flex flex-col gap-4"
        style={{ background: 'var(--surface-1)', borderLeft: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Data sources
          </h2>
          <button type="button" onClick={onClose} className="text-sm px-2 py-1 rounded" style={{ color: 'var(--text-muted)' }}>
            Close
          </button>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Load your own RingCentral exports. Files stay in your browser &mdash; nothing is uploaded to a server. Column headers are matched automatically against common RingCentral export formats.
        </p>

        <div className="flex flex-col">
          <UploadRow
            title="Call log / call detail export"
            description="RingCentral Call Log Report CSV (one row per call)."
            fileName={calls.fileName}
            source={calls.source}
            rowCount={calls.records.length}
            error={calls.error}
            onSelect={loadCallsFile}
          />
          <UploadRow
            title="Analytics / Quality of Service export"
            description="RingCentral Analytics Portal export (queue performance, SLA)."
            fileName={qos.fileName}
            source={qos.source}
            rowCount={qos.records.length}
            error={qos.error}
            onSelect={loadQosFile}
          />
          <UploadRow
            title="SMS / message log export"
            description="RingCentral message log CSV."
            fileName={sms.fileName}
            source={sms.source}
            rowCount={sms.records.length}
            error={sms.error}
            onSelect={loadSmsFile}
          />
        </div>

        {hasOverrides && (
          <button
            type="button"
            disabled={closing}
            onClick={() => {
              setClosing(true)
              resetToSiteData().finally(() => setClosing(false))
            }}
            className="mt-auto text-sm font-medium rounded-lg px-3 py-2 self-start"
            style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            Clear uploads and imports
          </button>
        )}
      </div>
    </div>
  )
}
