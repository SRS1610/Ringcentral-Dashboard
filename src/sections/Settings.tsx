import { useState } from 'react'
import { ChartCard } from '../components/ui/ChartCard'
import { StatusBadge } from '../components/ui/Badge'
import { useRingCentral } from '../state/RingCentralContext'
import { useData } from '../state/DataContext'
import { browserTimeZone, listTimeZones, timeZoneAbbreviation } from '../lib/timezone'

const inputStyle = { border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)' }
const secondaryButtonStyle = { border: '1px solid var(--border)', color: 'var(--text-secondary)' }

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

function ConnectedCard() {
  const rc = useRingCentral()
  const [syncDays, setSyncDays] = useState(30)
  const details = [rc.user?.extensionNumber && `Ext ${rc.user.extensionNumber}`, rc.environment === 'sandbox' && 'Sandbox account'].filter(Boolean).join(' · ')

  return (
    <ChartCard title="RingCentral connection" subtitle="The dashboard server signs in to RingCentral for you" action={<StatusBadge status="good" label="Connected" />}>
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
            Showing only <strong>this one user's</strong> calls and messages. Company-wide data needs the server's JWT credential to be issued
            for a RingCentral <strong>admin</strong> user.
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
          {rc.hasPassword && (
            <button type="button" onClick={rc.lock} className="text-sm font-medium rounded-lg px-3.5 py-2" style={secondaryButtonStyle}>
              Lock this browser
            </button>
          )}
        </div>

        <div className="text-xs flex flex-col gap-1" style={{ color: 'var(--text-muted)' }}>
          {rc.syncing && rc.syncStatus && <span>{rc.syncStatus}</span>}
          {rc.lastSyncedAt && <span>Last imported {rc.lastSyncedAt.toLocaleString()}</span>}
          {rc.hasPassword && !rc.remembered && <span>The dashboard password is kept until you close this tab.</span>}
          {rc.hasPassword && rc.remembered && <span>The dashboard password is remembered on this browser. "Lock this browser" removes it.</span>}
          {rc.smsSkipped !== null && rc.smsSkipped > 0 && <span>{rc.smsSkipped} user(s) skipped for SMS — likely a permissions/scope issue on that mailbox.</span>}
          {rc.qosNote && <span>{rc.qosNote}</span>}
          {rc.perfNote && <span>{rc.perfNote}</span>}
          {rc.compareNote && <span>{rc.compareNote}</span>}
        </div>

        {rc.lastError && <ErrorBox message={rc.lastError} />}
      </div>
    </ChartCard>
  )
}

function UnlockCard() {
  const rc = useRingCentral()
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const canSubmit = !rc.connecting && password.trim() !== ''

  return (
    <ChartCard title="Unlock live RingCentral data" subtitle="Enter the dashboard password" action={<StatusBadge status="neutral" label="Locked" />}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) void rc.unlock(password.trim(), remember)
        }}
      >
        {rc.backendMessage && <ErrorBox message={rc.backendMessage} />}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="dashboard-password" className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            Dashboard password
          </label>
          <input
            id="dashboard-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="text-sm rounded-md px-3 py-2 max-w-sm"
            style={inputStyle}
          />
        </div>
        <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember on this browser
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          className="text-sm font-semibold rounded-lg px-4 py-2.5 self-start"
          style={{ background: 'var(--series-1)', color: '#ffffff', opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
        >
          {rc.connecting ? 'Checking…' : 'Unlock'}
        </button>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          This is the password set on the dashboard server, not your RingCentral password. Leave "Remember" unchecked on shared computers.
          Once unlocked, the last {30} days of calls, SMS and service quality import automatically, followed by the 30 days before for comparison.
        </p>
      </form>
    </ChartCard>
  )
}

function ProblemCard({ title, badge }: { title: string; badge: string }) {
  const rc = useRingCentral()
  return (
    <ChartCard title="RingCentral connection" subtitle={title} action={<StatusBadge status={rc.backend === 'error' ? 'critical' : 'warning'} label={badge} />}>
      <div className="flex flex-col gap-3">
        {rc.backendMessage && <ErrorBox message={rc.backendMessage} />}
        {rc.backend === 'unavailable' && (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Uploads and the scheduled sync's data files still work here. For live data, open the dashboard at its Cloudflare Worker address.
          </p>
        )}
        <button
          type="button"
          disabled={rc.connecting}
          onClick={() => void rc.retry()}
          className="text-sm font-medium rounded-lg px-3.5 py-2 self-start"
          style={{ ...secondaryButtonStyle, color: 'var(--text-primary)', opacity: rc.connecting ? 0.6 : 1 }}
        >
          {rc.connecting ? 'Checking…' : 'Check again'}
        </button>
      </div>
    </ChartCard>
  )
}

function ConnectionCard() {
  const rc = useRingCentral()
  switch (rc.backend) {
    case 'checking':
      return (
        <ChartCard title="RingCentral connection" subtitle="Checking the dashboard server…">
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
            One moment…
          </div>
        </ChartCard>
      )
    case 'connected':
      return <ConnectedCard />
    case 'locked':
      return <UnlockCard />
    case 'not_configured':
      return <ProblemCard title="The dashboard server isn't set up yet" badge="Setup needed" />
    case 'unavailable':
      return <ProblemCard title="No dashboard server on this site" badge="Not available" />
    case 'error':
      return <ProblemCard title="The dashboard server couldn't sign in to RingCentral" badge="Sign-in failed" />
  }
}

function SetupGuide() {
  return (
    <ChartCard title="One-time server setup" subtitle="Done once by whoever manages the Cloudflare Worker; viewers only need the dashboard password">
      <div className="text-sm flex flex-col gap-2" style={{ color: 'var(--text-secondary)' }}>
        <ol className="list-decimal pl-5 flex flex-col gap-1.5">
          <li>
            In the{' '}
            <a href="https://developers.ringcentral.com/" target="_blank" rel="noreferrer" style={{ color: 'var(--series-1)' }}>
              RingCentral Developer Console
            </a>
            , use an app with the <strong>JWT auth flow</strong> and the permissions <strong>Read Accounts</strong>, <strong>Read Call Log</strong>,{' '}
            <strong>Read Messages</strong> and <strong>Analytics</strong>. Create a JWT credential for an <strong>admin</strong> user.
          </li>
          <li>
            Add the Worker secret <code>RC_CREDENTIALS_JSON</code> with the whole credentials file (or <code>RC_CLIENT_ID</code>,{' '}
            <code>RC_CLIENT_SECRET</code> and <code>RC_JWT</code> separately).
          </li>
          <li>
            Add the Worker secret <code>DASHBOARD_PASSWORD</code>: the password viewers type on this page.
          </li>
        </ol>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          The same credentials file powers the scheduled GitHub sync. See the README for the commands and for sandbox accounts.
        </p>
      </div>
    </ChartCard>
  )
}

const ZONES = listTimeZones()

function TimeZoneCard() {
  const { timeZone, timeZoneChoice, setTimeZoneChoice, accountTimeZone } = useData()
  const automatic = accountTimeZone ? `RingCentral account (${accountTimeZone})` : `this browser (${browserTimeZone()})`
  // A saved zone the browser's list doesn't name (an alias such as "US/Pacific") still needs an option.
  const options = timeZoneChoice && !ZONES.includes(timeZoneChoice) ? [timeZoneChoice, ...ZONES] : ZONES

  return (
    <ChartCard title="Time zone" subtitle="Days, hours and call times across the dashboard are counted on this clock">
      <div className="flex flex-col gap-2">
        <select
          aria-label="Dashboard time zone"
          value={timeZoneChoice ?? ''}
          onChange={(e) => setTimeZoneChoice(e.target.value || null)}
          className="rounded-md px-2 py-1.5 text-sm max-w-md"
          style={inputStyle}
        >
          <option value="">Automatic: {automatic}</option>
          {options.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Now using {timeZone} ({timeZoneAbbreviation(timeZone)}). Set it to where the team works, so a call at 9am there shows as 9am here wherever
          the dashboard is opened. Saved on this browser.
        </p>
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
    <ChartCard title="Department mapping" subtitle="Departments come from each extension's Department field in RingCentral. Add or override them here by extension number; applies from the next import.">
      <div className="flex flex-col gap-2">
        {entries.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No mappings yet. Extensions with no department in RingCentral and none here are grouped by team member instead.
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
      <TimeZoneCard />
      <DepartmentMapEditor />
      <SetupGuide />

      <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
        Live data is fetched by the dashboard server, which holds the RingCentral credentials; they never reach this browser. Service
        Quality comes from RingCentral's Business Analytics API, which needs the Analytics permission on the app and a plan that includes it.
        Imported data stays in this browser tab.
      </p>
    </div>
  )
}
