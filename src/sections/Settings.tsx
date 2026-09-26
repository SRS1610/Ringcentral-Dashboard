import { useRef, useState } from 'react'
import { ChartCard } from '../components/ui/ChartCard'
import { StatusBadge } from '../components/ui/Badge'
import { useRingCentral } from '../state/RingCentralContext'
import { RC_SERVER_URLS } from '../lib/ringcentralAuth'

const inputStyle = { border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)' }
const secondaryButtonStyle = { border: '1px solid var(--border)', color: 'var(--text-secondary)' }

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
    <div role="alert" className="text-xs rounded-md p-2.5" style={{ background: 'var(--surface-2)', color: 'var(--status-critical)', border: '1px solid var(--border)' }}>
      {message}
    </div>
  )
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return (
    <div
      aria-hidden="true"
      className="rounded-full flex items-center justify-center font-semibold text-sm shrink-0"
      style={{ width: 40, height: 40, background: 'var(--series-1)', color: '#ffffff' }}
    >
      {initials || 'RC'}
    </div>
  )
}

function SignedInCard() {
  const rc = useRingCentral()
  const [syncDays, setSyncDays] = useState(30)
  const [signingOut, setSigningOut] = useState(false)
  const how = rc.mode === 'jwt' ? 'Signed in with a credentials file' : 'Signed in with RingCentral'
  const details = rc.user ? [rc.user.extensionNumber && `Ext ${rc.user.extensionNumber}`, rc.user.email].filter(Boolean).join(' · ') : ''

  return (
    <ChartCard title="RingCentral account" subtitle={`${how} · ${rc.config?.serverUrl ?? ''}`} action={<StatusBadge status="good" label="Signed in" />}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={rc.user?.name ?? ''} />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {rc.user?.name ?? 'RingCentral account'}
            </div>
            {details && (
              <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                {details}
              </div>
            )}
          </div>
        </div>

        {rc.scope === 'self' && (
          <div className="text-xs rounded-md p-2.5" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            Showing only <strong>your own</strong> calls and messages. Company-wide data needs a RingCentral <strong>admin</strong> account to sign
            in (or the credentials-file option set up by an admin).
          </div>
        )}
        {rc.scope === 'company' && (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Company-wide data (admin access).
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            Import last
            <select value={syncDays} onChange={(e) => setSyncDays(Number(e.target.value))} className="rounded-md px-2 py-1 text-sm" style={inputStyle}>
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
            {rc.syncing ? 'Importing…' : 'Sync now'}
          </button>
          <button
            type="button"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true)
              await rc.signOut()
              setSigningOut(false)
            }}
            className="text-sm font-medium rounded-lg px-3.5 py-2"
            style={secondaryButtonStyle}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>

        <div className="text-xs flex flex-col gap-1" style={{ color: 'var(--text-muted)' }}>
          {rc.syncing && rc.syncStatus && <span>{rc.syncStatus}</span>}
          {rc.lastSyncedAt && <span>Last imported {rc.lastSyncedAt.toLocaleString()}</span>}
          {rc.mode === 'pkce' && <span>You'll stay signed in on this browser until you sign out.</span>}
          {rc.mode === 'jwt' && !rc.remembered && <span>Credentials are held in memory only and will be cleared when you close this tab.</span>}
          {rc.mode === 'jwt' && rc.remembered && <span>Credentials are remembered on this browser. Sign out to remove them.</span>}
          {rc.smsSkipped !== null && rc.smsSkipped > 0 && <span>{rc.smsSkipped} user(s) skipped for SMS — likely a permissions/scope issue on that mailbox.</span>}
        </div>

        {rc.lastError && <ErrorBox message={rc.lastError} />}
      </div>
    </ChartCard>
  )
}

function CredentialsFileOption() {
  const rc = useRingCentral()
  const [remember, setRemember] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Pick the JSON credentials file from a RingCentral app that uses the JWT auth flow. The dashboard signs in with it and imports your
        data.
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
          style={{ ...secondaryButtonStyle, color: 'var(--text-primary)', opacity: rc.connecting ? 0.5 : 1 }}
        >
          Choose credentials file
        </button>
        <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember on this browser
        </label>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Unchecked (recommended on shared computers): the file is used only until you close this tab. Checked: it's saved in this browser —
        treat that like saving a password here.
      </p>
    </div>
  )
}

function SignInCard() {
  const rc = useRingCentral()
  const [clientId, setClientId] = useState('')
  const [server, setServer] = useState<'production' | 'sandbox'>('production')
  const [showFile, setShowFile] = useState(false)
  const needsApp = !rc.appConfig
  const canSignIn = !rc.connecting && (!needsApp || clientId.trim() !== '')

  const onSignIn = () => {
    if (needsApp) rc.signIn({ clientId: clientId.trim(), serverUrl: RC_SERVER_URLS[server] })
    else rc.signIn()
  }

  return (
    <ChartCard title="Sign in to RingCentral" subtitle="Import your call and messaging data" action={<StatusBadge status="neutral" label="Not signed in" />}>
      <div className="flex flex-col gap-5">
        {rc.lastError && <ErrorBox message={rc.lastError} />}

        {needsApp && (
          <div className="flex flex-col gap-3 rounded-lg p-3.5" style={{ border: '1px dashed var(--border)', background: 'var(--surface-2)' }}>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              One-time setup: your RingCentral app
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Sign-in needs the Client ID of your organization's RingCentral app (see "One-time app setup" below). Enter it once; this browser
              remembers it. To skip this step for everyone, put it in <code>public/ringcentral-app.json</code>.
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rc-client-id" className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                App Client ID
              </label>
              <input
                id="rc-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="e.g. AbCdEf123456"
                className="text-sm rounded-md px-3 py-2"
                style={{ ...inputStyle, background: 'var(--surface-1)' }}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                Environment
              </span>
              <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
                {(['production', 'sandbox'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setServer(s)}
                    className="px-2.5 py-1 text-xs rounded-md font-medium capitalize"
                    style={{ background: server === s ? 'var(--series-1)' : 'transparent', color: server === s ? '#ffffff' : 'var(--text-secondary)' }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={!canSignIn}
            onClick={onSignIn}
            className="text-base font-semibold rounded-lg px-5 py-3 self-start"
            style={{ background: 'var(--series-1)', color: '#ffffff', opacity: canSignIn ? 1 : 0.5, cursor: canSignIn ? 'pointer' : 'not-allowed' }}
          >
            {rc.connecting ? 'Opening RingCentral…' : 'Sign in with RingCentral'}
          </button>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            You'll enter your RingCentral username and password on RingCentral's own secure login page — this dashboard never sees your
            password. When you come back, your last {30} days of data import automatically.
          </p>
          {rc.appConfig?.source === 'browser' && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Using RingCentral app …{rc.appConfig.clientId.slice(-4)} ({rc.appConfig.serverUrl.includes('devtest') ? 'sandbox' : 'production'}).{' '}
              <button type="button" onClick={rc.changeApp} className="underline" style={{ color: 'var(--series-1)' }}>
                Change
              </button>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <button type="button" onClick={() => setShowFile((v) => !v)} className="text-xs self-start" style={{ color: 'var(--series-1)' }} aria-expanded={showFile}>
            {showFile ? 'Hide' : 'Or use a credentials file instead'}
          </button>
          {showFile && <CredentialsFileOption />}
        </div>
      </div>
    </ChartCard>
  )
}

function ConnectionCard() {
  const rc = useRingCentral()
  if (!rc.ready) {
    return (
      <ChartCard title="RingCentral account" subtitle="Checking sign-in…">
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
          One moment…
        </div>
      </ChartCard>
    )
  }
  return rc.connected ? <SignedInCard /> : <SignInCard />
}

function SetupGuide() {
  const rc = useRingCentral()
  return (
    <ChartCard title="One-time app setup" subtitle="Done once by a RingCentral admin, then everyone just clicks Sign in">
      <div className="text-sm flex flex-col gap-3" style={{ color: 'var(--text-secondary)' }}>
        <div>
          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
            For "Sign in with RingCentral"
          </div>
          <ol className="list-decimal pl-5 flex flex-col gap-1.5 mt-1">
            <li>
              In the{' '}
              <a href="https://developers.ringcentral.com/" target="_blank" rel="noreferrer" style={{ color: 'var(--series-1)' }}>
                RingCentral Developer Console
              </a>
              , create a <strong>REST API app</strong> that signs users in with the <strong>authorization code</strong> flow as a{' '}
              <strong>client-side / browser app</strong> (PKCE — the kind with no client secret).
            </li>
            <li>
              Add this exact <strong>redirect URI</strong> to the app:
              <div className="mt-1">
                <CopyField value={rc.redirectUri} />
              </div>
            </li>
            <li>
              Grant read permissions: <strong>Read Accounts</strong>, <strong>Read Call Log</strong>, <strong>Read Messages</strong>.
            </li>
            <li>
              Copy the app's <strong>Client ID</strong> into the one-time setup box above — or into <code>public/ringcentral-app.json</code> so
              nobody has to enter it. The Client ID is not a secret.
            </li>
          </ol>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
            Admins who sign in see company-wide data; other users see their own calls and messages.
          </p>
        </div>
        <div>
          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
            For the credentials-file option
          </div>
          <p className="mt-1">
            Use an app with the <strong>JWT auth flow</strong>, generate a JWT for an admin user, and save the credentials JSON. The same file
            powers the scheduled GitHub sync (see README), which keeps one shared dataset fresh for every viewer without anyone signing in.
          </p>
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
            style={inputStyle}
          />
          <input
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
            placeholder="Department name"
            className="text-sm rounded-md px-2 py-1.5 flex-1"
            style={inputStyle}
          />
          <button type="button" onClick={addRow} className="text-xs font-medium rounded-md px-3 py-1.5" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
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
      <ConnectionCard />
      <DepartmentMapEditor />
      <SetupGuide />

      <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
        Signing in refreshes data in <em>your</em> browser only. Your sign-in stays on this device and data goes straight between your
        browser and RingCentral. Service Quality / SLA metrics still come from CSV upload — that data needs RingCentral's separate Analytics
        API, whose availability depends on plan tier.
      </p>
    </div>
  )
}
