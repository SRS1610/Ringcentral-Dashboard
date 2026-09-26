import { useRef, useState } from 'react'
import { ChartCard } from '../components/ui/ChartCard'
import { StatusBadge } from '../components/ui/Badge'
import { useRingCentral } from '../state/RingCentralContext'
import { RC_SERVER_URLS } from '../lib/ringcentralAuth'

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code
        className="text-xs px-2 py-1.5 rounded-md flex-1 overflow-x-auto whitespace-nowrap"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
      >
        {value}
      </code>
      <button
        type="button"
        className="text-xs font-medium rounded-md px-2.5 py-1.5 whitespace-nowrap"
        style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch {
            // clipboard API unavailable — the field is still selectable/copyable by hand
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="text-xs rounded-md p-2.5" style={{ background: 'var(--surface-2)', color: 'var(--status-critical)', border: '1px solid var(--border)' }}>
      {message}
    </div>
  )
}

function ConnectionCard() {
  const rc = useRingCentral()
  const [clientId, setClientId] = useState('')
  const [server, setServer] = useState<'production' | 'sandbox'>('production')
  const [syncDays, setSyncDays] = useState(30)
  const [remember, setRemember] = useState(false)
  const [showSignIn, setShowSignIn] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (rc.connected) {
    const modeLabel = rc.mode === 'jwt' ? 'Signed in with a credentials file' : 'Signed in with RingCentral'
    return (
      <ChartCard
        title="RingCentral connection"
        subtitle={`${modeLabel} · ${rc.config?.serverUrl ?? ''}`}
        action={<StatusBadge status="good" label="Connected" />}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
              Pull last
              <select
                value={syncDays}
                onChange={(e) => setSyncDays(Number(e.target.value))}
                className="rounded-md px-2 py-1 text-sm"
                style={{ border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)' }}
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
            <button
              type="button"
              disabled={rc.syncing}
              onClick={() => rc.syncNow(syncDays)}
              className="text-sm font-medium rounded-lg px-3.5 py-2"
              style={{ background: 'var(--series-1)', color: '#ffffff', opacity: rc.syncing ? 0.6 : 1 }}
            >
              {rc.syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              type="button"
              onClick={rc.disconnect}
              className="text-sm font-medium rounded-lg px-3.5 py-2"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              Disconnect
            </button>
          </div>

          <div className="text-xs flex flex-col gap-1" style={{ color: 'var(--text-muted)' }}>
            {rc.lastSyncedAt && <span>Last synced {rc.lastSyncedAt.toLocaleString()}</span>}
            {rc.mode === 'jwt' && !rc.remembered && <span>Credentials are held in memory only and will be cleared when you close this tab.</span>}
            {rc.mode === 'jwt' && rc.remembered && <span>Credentials are remembered on this browser. Use Disconnect to remove them.</span>}
            {rc.smsSkipped !== null && rc.smsSkipped > 0 && (
              <span>{rc.smsSkipped} extension(s) skipped for SMS — likely a permissions/scope issue on that mailbox.</span>
            )}
          </div>

          {rc.lastError && <ErrorBox message={rc.lastError} />}
        </div>
      </ChartCard>
    )
  }

  return (
    <ChartCard title="RingCentral connection" subtitle="Not connected" action={<StatusBadge status="neutral" label="Not connected" />}>
      <div className="flex flex-col gap-5">
        {rc.lastError && <ErrorBox message={rc.lastError} />}

        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Option A — Use your credentials file
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Pick the JSON credentials file from your RingCentral app (the one with the JWT auth flow). The dashboard signs in with it
            and imports your data — no other setup needed.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) rc.connectWithCredentialsFile(file, remember)
              e.target.value = ''
            }}
          />
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              disabled={rc.connecting}
              onClick={() => fileInputRef.current?.click()}
              className="text-sm font-medium rounded-lg px-3.5 py-2"
              style={{ background: 'var(--series-1)', color: '#ffffff', opacity: rc.connecting ? 0.5 : 1 }}
            >
              {rc.connecting ? 'Signing in…' : 'Choose credentials file'}
            </button>
            <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember on this browser
            </label>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Unchecked (recommended on shared computers): the file is used only until you close this tab. Checked: it's saved in this
            browser's local storage so you don't need to pick it again — treat that like saving a password here.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowSignIn((v) => !v)}
          className="text-xs self-start"
          style={{ color: 'var(--series-1)' }}
        >
          {showSignIn ? 'Hide' : 'Show'} Option B — Sign in with RingCentral (public app, no file)
        </button>

        {showSignIn && (
          <div className="flex flex-col gap-4 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Client ID
          </label>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="From your RingCentral public/browser-based app"
            className="text-sm rounded-md px-3 py-2"
            style={{ border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)' }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Environment
          </label>
          <div className="inline-flex rounded-lg border p-0.5 self-start" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
            {(['production', 'sandbox'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setServer(s)}
                className="px-3 py-1.5 text-sm rounded-md font-medium capitalize"
                style={{ background: server === s ? 'var(--series-1)' : 'transparent', color: server === s ? '#ffffff' : 'var(--text-secondary)' }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Redirect URI to register on the app
          </span>
          <CopyField value={rc.redirectUri} />
        </div>

        <button
          type="button"
          disabled={!clientId.trim() || rc.connecting}
          onClick={() => rc.connect({ clientId: clientId.trim(), serverUrl: RC_SERVER_URLS[server] })}
          className="text-sm font-medium rounded-lg px-3.5 py-2 self-start"
          style={{ background: 'var(--series-1)', color: '#ffffff', opacity: !clientId.trim() || rc.connecting ? 0.5 : 1 }}
        >
          {rc.connecting ? 'Redirecting…' : 'Connect to RingCentral'}
        </button>
          </div>
        )}
      </div>
    </ChartCard>
  )
}

function SetupGuide() {
  return (
    <ChartCard title="One-time app setup" subtitle="Only needed the first time you connect">
      <div className="text-sm flex flex-col gap-3" style={{ color: 'var(--text-secondary)' }}>
        <div>
          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
            Option A — credentials file (simplest)
          </div>
          <ol className="list-decimal pl-5 flex flex-col gap-1 mt-1">
            <li>
              In the{' '}
              <a href="https://developers.ringcentral.com/" target="_blank" rel="noreferrer" style={{ color: 'var(--series-1)' }}>
                RingCentral Developer Console
              </a>
              , create an app (using an <strong>admin</strong> account) with the <strong>JWT auth flow</strong> enabled, and grant it read scopes
              for call log, messages, and extensions/accounts.
            </li>
            <li>Generate a JWT credential for an admin user and download/save the credentials JSON.</li>
            <li>Click "Choose credentials file" above and pick that JSON. That's it.</li>
          </ol>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            The same file works for the scheduled GitHub Actions sync (see README) — that's the way to give every viewer one shared,
            auto-refreshed dataset without anyone signing in.
          </p>
        </div>
        <div>
          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
            Option B — sign in with RingCentral (no file, no secret)
          </div>
          <ol className="list-decimal pl-5 flex flex-col gap-1 mt-1">
            <li>
              Create a separate app as a <strong>public / browser-based client</strong> using the <strong>Authorization Code + PKCE</strong> flow.
            </li>
            <li>Add the redirect URI shown in Option B to the app's allowed redirect URIs.</li>
            <li>Grant the same read scopes, then paste the app's Client ID into Option B and click Connect.</li>
          </ol>
        </div>
      </div>
    </ChartCard>
  )
}

function DepartmentMapEditor() {
  const rc = useRingCentral()
  const entries = Object.entries(rc.departmentMap)
  const [newExt, setNewExt] = useState('')
  const [newDept, setNewDept] = useState('')

  const addRow = () => {
    if (!newExt.trim() || !newDept.trim()) return
    rc.updateDepartmentMap({ ...rc.departmentMap, [newExt.trim()]: newDept.trim() })
    setNewExt('')
    setNewDept('')
  }

  const removeRow = (ext: string) => {
    const next = { ...rc.departmentMap }
    delete next[ext]
    rc.updateDepartmentMap(next)
  }

  return (
    <ChartCard title="Department mapping" subtitle="RingCentral doesn't tag calls with a department, so map extension numbers to department names here">
      <div className="flex flex-col gap-2">
        {entries.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No mappings yet — anything unmapped shows as "Unassigned".
          </p>
        )}
        {entries.map(([ext, dept]) => (
          <div key={ext} className="flex items-center gap-2 text-sm">
            <span className="tabular-nums w-16" style={{ color: 'var(--text-secondary)' }}>
              {ext}
            </span>
            <span className="flex-1" style={{ color: 'var(--text-primary)' }}>
              {dept}
            </span>
            <button type="button" onClick={() => removeRow(ext)} className="text-xs" style={{ color: 'var(--status-critical)' }}>
              Remove
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2 mt-2">
          <input
            value={newExt}
            onChange={(e) => setNewExt(e.target.value)}
            placeholder="Extension #"
            className="text-sm rounded-md px-2 py-1.5 w-24"
            style={{ border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)' }}
          />
          <input
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
            placeholder="Department name"
            className="text-sm rounded-md px-2 py-1.5 flex-1"
            style={{ border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={addRow}
            className="text-xs font-medium rounded-md px-3 py-1.5"
            style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            Add
          </button>
        </div>
      </div>
    </ChartCard>
  )
}

export function Settings() {
  return (
    <div className="flex flex-col gap-5">
      <div
        className="text-sm rounded-xl p-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
      >
        <strong style={{ color: 'var(--text-primary)' }}>This connection is local to your browser.</strong> Your RingCentral credentials
        stay in this browser (in memory only, unless you choose to remember them) and calls go directly from your browser to RingCentral —
        nothing passes through a server we control. That also means connecting here only refreshes data in <em>your</em> session, not for other people
        viewing this dashboard. For one shared, always-fresh dataset every viewer sees, use the scheduled GitHub Actions sync described in
        the repo's README instead — this Settings page and that sync can be used together or independently.
      </div>

      <ConnectionCard />
      <DepartmentMapEditor />
      <SetupGuide />

      <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
        Service Quality / SLA metrics still come from CSV upload only — that data needs RingCentral's separate Analytics API, whose
        availability depends on plan tier.
      </p>
    </div>
  )
}
