import { useRingCentral } from '../state/RingCentralContext'

/**
 * Shown instead of a dashboard tab when the data it needs hasn't been loaded, so
 * nobody reads an empty dataset as "0 calls" or "0% service level".
 */
export function EmptyState({
  title,
  body,
  canSignIn,
  onOpenSettings,
  onOpenUpload,
}: {
  title: string
  body: string
  /** False when the data can only come from an upload (e.g. Analytics / QoS). */
  canSignIn: boolean
  onOpenSettings: () => void
  onOpenUpload: () => void
}) {
  const rc = useRingCentral()
  const showSignIn = canSignIn && rc.ready && !rc.connected
  return (
    <div
      className="rounded-xl border px-6 py-12 sm:py-16 flex flex-col items-center text-center gap-3"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
        <path d="M4 19V5M4 19h16M8 15v-3M12 15V8M16 15v-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h2>
      <p className="text-sm max-w-md" style={{ color: 'var(--text-secondary)' }}>
        {body}
      </p>
      <div className="flex items-center gap-2 flex-wrap justify-center mt-2">
        {showSignIn && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-sm font-medium rounded-lg px-3.5 py-2"
            style={{ background: 'var(--series-1)', color: '#ffffff' }}
          >
            Sign in to RingCentral
          </button>
        )}
        <button
          type="button"
          onClick={onOpenUpload}
          className="text-sm font-medium rounded-lg px-3.5 py-2"
          style={
            showSignIn
              ? { border: '1px solid var(--border)', color: 'var(--text-secondary)' }
              : { background: 'var(--series-1)', color: '#ffffff' }
          }
        >
          Upload RingCentral exports
        </button>
      </div>
      {canSignIn && (
        <p className="text-xs max-w-md mt-1" style={{ color: 'var(--text-muted)' }}>
          Once the scheduled RingCentral sync is set up, data appears here for everyone automatically.
        </p>
      )}
    </div>
  )
}
