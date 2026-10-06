import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, clearPassword, loadPassword, passwordRemembered, setPassword } from '../lib/dashboardApi'
import { fetchStatus, syncCallLog, syncPerformance, syncQos, syncSms, type DataScope, type RcUser, type SyncWindow } from '../lib/ringcentralApi'
import { isValidTimeZone } from '../lib/timezone'
import { loadDepartmentMap, saveDepartmentMap, type DepartmentMap } from '../lib/departmentMap'
import { useData } from './DataContext'

const AUTO_SYNC_DAYS = 30
const DAY_MS = 86_400_000
/** Longer windows skip the comparison import: it would double an already long fetch. */
const COMPARE_MAX_DAYS = 92

/**
 * The window to import so "vs prior period" has something to compare against.
 * For "last N days" the date presets end at the latest record rather than at now, so the
 * comparison reaches back 2N days from that record.
 */
function comparisonWindow(window: SyncWindow, latestRecord: number | null): { start: Date; end: Date } | null {
  if (typeof window === 'number') {
    if (window > COMPARE_MAX_DAYS) return null
    const now = Date.now()
    return { start: new Date((latestRecord ?? now) - 2 * window * DAY_MS), end: new Date(now - window * DAY_MS - 1) }
  }
  const lengthMs = window.end.getTime() - window.start.getTime()
  if (lengthMs <= 0 || lengthMs > COMPARE_MAX_DAYS * DAY_MS) return null
  const end = window.start.getTime() - 1
  return { start: new Date(end - lengthMs), end: new Date(end) }
}

function mergeById<T>(primary: T[], extra: T[], idOf: (record: T) => string): T[] {
  const seen = new Set(primary.map(idOf))
  return [...primary, ...extra.filter((r) => !seen.has(idOf(r)))]
}

/**
 * Where the dashboard's server-side RingCentral connection stands:
 * - connected: the Worker is signed in to RingCentral and this browser may read from it
 * - locked: the Worker wants the dashboard password
 * - not_configured: the Worker is missing its secrets
 * - unavailable: this copy of the site has no Worker behind it (static hosting or `vite dev`)
 * - error: the Worker couldn't sign in to RingCentral
 */
export type BackendState = 'checking' | 'connected' | 'locked' | 'not_configured' | 'unavailable' | 'error'

interface RingCentralContextValue {
  ready: boolean
  connected: boolean
  backend: BackendState
  /** Explains a locked / not_configured / unavailable / error state. */
  backendMessage: string | null
  user: RcUser | null
  environment: 'production' | 'sandbox' | null
  scope: DataScope | null
  /** True when the dashboard password is saved on this browser. */
  remembered: boolean
  /** True when this browser holds a dashboard password (so "Lock" makes sense). */
  hasPassword: boolean
  connecting: boolean
  syncing: boolean
  syncStatus: string | null
  lastSyncedAt: Date | null
  lastError: string | null
  smsSkipped: number | null
  /** Anything worth knowing about the last service-quality import. */
  qosNote: string | null
  /** Anything worth knowing about the last performance-report import. */
  perfNote: string | null
  /** Set when the previous period couldn't be imported, so period-over-period figures are missing. */
  compareNote: string | null
  departmentMap: DepartmentMap
  unlock: (password: string, remember: boolean) => Promise<void>
  /** Forgets the dashboard password on this browser. */
  lock: () => void
  retry: () => Promise<void>
  /** Import calls, SMS, service quality and the performance report for the last N days, or for an exact calendar from/to window. */
  syncNow: (window: SyncWindow) => Promise<void>
  updateDepartmentMap: (map: DepartmentMap) => void
}

const RingCentralContext = createContext<RingCentralContextValue | null>(null)

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const isLocked = (e: unknown) => e instanceof ApiError && e.status === 401

export function RingCentralProvider({ children }: { children: ReactNode }) {
  const { setCallsFromRingCentral, setSmsFromRingCentral, setQosFromRingCentral, setPerfFromRingCentral, setAccountTimeZone, timeZone, timeZoneChoice } = useData()
  const [backend, setBackend] = useState<BackendState>('checking')
  const [backendMessage, setBackendMessage] = useState<string | null>(null)
  const [user, setUser] = useState<RcUser | null>(null)
  const [environment, setEnvironment] = useState<'production' | 'sandbox' | null>(null)
  const [scope, setScope] = useState<DataScope | null>(null)
  const [remembered, setRemembered] = useState(() => passwordRemembered())
  const [hasPassword, setHasPassword] = useState(() => loadPassword() !== null)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [smsSkipped, setSmsSkipped] = useState<number | null>(null)
  const [qosNote, setQosNote] = useState<string | null>(null)
  const [compareNote, setCompareNote] = useState<string | null>(null)
  const [perfNote, setPerfNote] = useState<string | null>(null)
  // Refs for the same reason as the department map: a sync always asks for days in the current zone.
  const zoneRef = useRef(timeZone)
  const zoneChoiceRef = useRef(timeZoneChoice)
  useEffect(() => {
    zoneRef.current = timeZone
    zoneChoiceRef.current = timeZoneChoice
  }, [timeZone, timeZoneChoice])
  const [departmentMap, setDepartmentMap] = useState<DepartmentMap>(() => loadDepartmentMap())
  // A ref so syncs started from long-lived callbacks always use the latest mapping.
  const deptRef = useRef(departmentMap)
  useEffect(() => {
    deptRef.current = departmentMap
  }, [departmentMap])

  const applyFailure = useCallback((e: unknown) => {
    setUser(null)
    setScope(null)
    if (e instanceof ApiError && e.status === 401) {
      // A saved password that no longer works is dropped so the prompt starts clean.
      if (e.code === 'password_wrong') {
        clearPassword()
        setHasPassword(false)
        setRemembered(false)
      }
      setBackend('locked')
      setBackendMessage(e.code === 'password_wrong' ? e.message : null)
    } else if (e instanceof ApiError && e.code === 'no_backend') {
      setBackend('unavailable')
      setBackendMessage(e.message)
    } else if (e instanceof ApiError && e.code === 'not_configured') {
      setBackend('not_configured')
      setBackendMessage(e.message)
    } else {
      setBackend('error')
      setBackendMessage(message(e))
    }
  }, [])

  const syncNow = useCallback(
    async (window: SyncWindow, zoneOverride?: string) => {
      const zone = zoneOverride ?? zoneRef.current
      const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      const label = typeof window === 'number' ? `RingCentral (last ${window}d)` : `RingCentral (${fmt(window.start)} – ${fmt(window.end)})`
      // Where the requested period starts: comparisons are only shown for periods the import fully covers.
      const coveredFrom = typeof window === 'number' ? new Date(Date.now() - window * DAY_MS) : window.start
      setSyncing(true)
      setLastError(null)
      setQosNote(null)
      setCompareNote(null)
      setPerfNote(null)
      const errors: string[] = []
      let anySucceeded = false
      let locked: unknown = null
      const scopes: DataScope[] = []

      // Sequential on purpose: RingCentral rate-limits these APIs, so don't double the load.
      let calls: Awaited<ReturnType<typeof syncCallLog>> | null = null
      let sms: Awaited<ReturnType<typeof syncSms>> | null = null
      let qosLoaded: Awaited<ReturnType<typeof syncQos>>['records'] = []
      let perf: Awaited<ReturnType<typeof syncPerformance>> | null = null
      try {
        calls = await syncCallLog(deptRef.current, window, setSyncStatus)
        setCallsFromRingCentral(calls.records, label, coveredFrom)
        scopes.push(calls.scope)
        anySucceeded = true
      } catch (e) {
        if (isLocked(e)) locked = e
        errors.push(`Call log: ${message(e)}`)
      }
      if (!locked) {
        try {
          sms = await syncSms(deptRef.current, window, setSyncStatus)
          setSmsFromRingCentral(sms.records, label, coveredFrom)
          setSmsSkipped(sms.skippedExtensions)
          scopes.push(sms.scope)
          anySucceeded = true
        } catch (e) {
          if (isLocked(e)) locked = e
          errors.push(`SMS: ${message(e)}`)
        }
      }
      if (!locked) {
        try {
          const qos = await syncQos(window, setSyncStatus)
          const notes: string[] = []
          // An empty answer leaves any uploaded Analytics export in place rather than blanking the tab.
          if (qos.records.length > 0) setQosFromRingCentral(qos.records, label, coveredFrom)
          else notes.push('RingCentral Analytics has no call-queue data for this period, so service level and abandon rate are not shown.')
          qosLoaded = qos.records
          if (qos.skippedNoSla > 0) notes.push(`${qos.skippedNoSla} queue-day(s) had calls but no SLA classification and are left out of Service Quality.`)
          if (qos.clampedToDays) notes.push(`RingCentral Analytics only keeps about ${qos.clampedToDays} days, so earlier dates have no service quality data.`)
          setQosNote(notes.length > 0 ? notes.join(' ') : null)
          anySucceeded = true
        } catch (e) {
          if (isLocked(e)) locked = e
          errors.push(`Service quality: ${message(e)}`)
        }
      }

      if (!locked) {
        try {
          perf = await syncPerformance(deptRef.current, window, zone, setSyncStatus)
          setPerfFromRingCentral(perf.records, label, coveredFrom)
          const notes: string[] = []
          if (perf.records.length === 0) {
            notes.push(
              perf.users === 0 ? 'RingCentral Analytics returned no users for the performance report.' : 'RingCentral Analytics reported no calls for any user in this period.',
            )
          }
          if (perf.unrecognised > 0) notes.push(`${perf.unrecognised} day(s) of the performance report came back in a form the dashboard couldn't read and are left out.`)
          if (perf.timeZone !== zone) notes.push(`RingCentral Analytics didn't accept the time zone ${zone}, so the performance report counts days in ${perf.timeZone}.`)
          if (perf.clampedToDays) notes.push(`RingCentral Analytics only keeps about ${perf.clampedToDays} days, so earlier dates are missing from the performance report.`)
          setPerfNote(notes.length > 0 ? notes.join(' ') : null)
          anySucceeded = true
        } catch (e) {
          if (isLocked(e)) locked = e
          errors.push(`Performance report: ${message(e)}`)
        }
      }

      // The period just before, so the tiles can say how this one compares. It loads after the
      // requested period is already on screen, and a failure here only costs the comparison.
      const latest = [...(calls?.records ?? []).map((c) => c.startTime.getTime()), ...(sms?.records ?? []).map((m) => m.dateTime.getTime())]
      const before = comparisonWindow(window, latest.length > 0 ? latest.reduce((a, b) => (a > b ? a : b)) : null)
      if (!locked && before && (calls || sms)) {
        const comparing = (text: string) => setSyncStatus(`Previous period, for comparison — ${text.charAt(0).toLowerCase()}${text.slice(1)}`)
        try {
          if (calls) {
            const earlier = await syncCallLog(deptRef.current, before, comparing)
            setCallsFromRingCentral(mergeById(calls.records, earlier.records, (c) => c.callId), label, before.start)
          }
          if (sms) {
            const earlier = await syncSms(deptRef.current, before, comparing)
            setSmsFromRingCentral(mergeById(sms.records, earlier.records, (m) => m.messageId), label, before.start)
          }
          if (qosLoaded.length > 0) {
            const earlier = await syncQos(before, comparing)
            setQosFromRingCentral([...qosLoaded, ...earlier.records], label, before.start)
          }
          if (perf && perf.records.length > 0) {
            const earlier = await syncPerformance(deptRef.current, before, zone, comparing)
            setPerfFromRingCentral([...perf.records, ...earlier.records], label, before.start)
          }
        } catch (e) {
          if (isLocked(e)) locked = e
          else setCompareNote(`The previous period couldn't be imported, so some "vs prior period" figures are missing (${message(e)}).`)
        }
      } else if (!locked && !before && anySucceeded) {
        setCompareNote(`Ranges longer than ${COMPARE_MAX_DAYS} days are imported without the period before them, so they show no "vs prior period" figures.`)
      }

      if (locked) applyFailure(locked)
      if (scopes.length > 0) setScope(scopes.includes('self') ? 'self' : 'company')
      if (errors.length > 0) setLastError(errors.join(' | '))
      if (anySucceeded) setLastSyncedAt(new Date())
      setSyncStatus(null)
      setSyncing(false)
    },
    [setCallsFromRingCentral, setSmsFromRingCentral, setQosFromRingCentral, setPerfFromRingCentral, applyFailure],
  )

  /** Asks the Worker who it is signed in as; on success, imports the default window. */
  const connect = useCallback(async () => {
    setConnecting(true)
    try {
      const status = await fetchStatus()
      setUser(status.user)
      setEnvironment(status.environment)
      setAccountTimeZone(status.timeZone ?? null)
      setBackend('connected')
      setBackendMessage(null)
      setConnecting(false)
      // The account's zone was only just learned; state hasn't caught up with it yet.
      const accountZone = isValidTimeZone(status.timeZone) ? status.timeZone : null
      await syncNow(AUTO_SYNC_DAYS, zoneChoiceRef.current ?? accountZone ?? zoneRef.current)
    } catch (e) {
      applyFailure(e)
      setConnecting(false)
    }
  }, [syncNow, applyFailure, setAccountTimeZone])

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void connect()
  }, [connect])

  const unlock = useCallback(
    async (password: string, remember: boolean) => {
      setPassword(password, remember)
      setHasPassword(true)
      setRemembered(remember)
      await connect()
    },
    [connect],
  )

  const lock = useCallback(() => {
    clearPassword()
    setHasPassword(false)
    setRemembered(false)
    setUser(null)
    setScope(null)
    setLastSyncedAt(null)
    setLastError(null)
    setSmsSkipped(null)
    setQosNote(null)
    setCompareNote(null)
    setPerfNote(null)
    setBackend('locked')
    setBackendMessage(null)
  }, [])

  const updateDepartmentMap = useCallback((map: DepartmentMap) => {
    setDepartmentMap(map)
    saveDepartmentMap(map)
  }, [])

  const value = useMemo<RingCentralContextValue>(
    () => ({
      ready: backend !== 'checking',
      connected: backend === 'connected',
      backend,
      backendMessage,
      user,
      environment,
      scope,
      remembered,
      hasPassword,
      connecting,
      syncing,
      syncStatus,
      lastSyncedAt,
      lastError,
      smsSkipped,
      qosNote,
      compareNote,
      perfNote,
      departmentMap,
      unlock,
      lock,
      retry: connect,
      syncNow,
      updateDepartmentMap,
    }),
    [
      backend,
      backendMessage,
      user,
      environment,
      scope,
      remembered,
      hasPassword,
      connecting,
      syncing,
      syncStatus,
      lastSyncedAt,
      lastError,
      smsSkipped,
      qosNote,
      compareNote,
      perfNote,
      departmentMap,
      unlock,
      lock,
      connect,
      syncNow,
      updateDepartmentMap,
    ],
  )

  return <RingCentralContext.Provider value={value}>{children}</RingCentralContext.Provider>
}

export function useRingCentral() {
  const ctx = useContext(RingCentralContext)
  if (!ctx) throw new Error('useRingCentral must be used within a RingCentralProvider')
  return ctx
}
