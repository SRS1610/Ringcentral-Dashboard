import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, clearPassword, loadPassword, passwordRemembered, setPassword } from '../lib/dashboardApi'
import { fetchStatus, syncCallLog, syncQos, syncSms, type DataScope, type RcUser, type SyncWindow } from '../lib/ringcentralApi'
import { loadDepartmentMap, saveDepartmentMap, type DepartmentMap } from '../lib/departmentMap'
import { useData } from './DataContext'

const AUTO_SYNC_DAYS = 30

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
  departmentMap: DepartmentMap
  unlock: (password: string, remember: boolean) => Promise<void>
  /** Forgets the dashboard password on this browser. */
  lock: () => void
  retry: () => Promise<void>
  /** Import calls, SMS and service quality for the last N days, or for an exact calendar from/to window. */
  syncNow: (window: SyncWindow) => Promise<void>
  updateDepartmentMap: (map: DepartmentMap) => void
}

const RingCentralContext = createContext<RingCentralContextValue | null>(null)

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const isLocked = (e: unknown) => e instanceof ApiError && e.status === 401

export function RingCentralProvider({ children }: { children: ReactNode }) {
  const { setCallsFromRingCentral, setSmsFromRingCentral, setQosFromRingCentral } = useData()
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
    async (window: SyncWindow) => {
      const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      const label = typeof window === 'number' ? `RingCentral (last ${window}d)` : `RingCentral (${fmt(window.start)} – ${fmt(window.end)})`
      setSyncing(true)
      setLastError(null)
      setQosNote(null)
      const errors: string[] = []
      let anySucceeded = false
      let locked: unknown = null
      const scopes: DataScope[] = []

      // Sequential on purpose: RingCentral rate-limits these APIs, so don't double the load.
      try {
        const calls = await syncCallLog(deptRef.current, window, setSyncStatus)
        setCallsFromRingCentral(calls.records, label)
        scopes.push(calls.scope)
        anySucceeded = true
      } catch (e) {
        if (isLocked(e)) locked = e
        errors.push(`Call log: ${message(e)}`)
      }
      if (!locked) {
        try {
          const sms = await syncSms(deptRef.current, window, setSyncStatus)
          setSmsFromRingCentral(sms.records, label)
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
          if (qos.records.length > 0) setQosFromRingCentral(qos.records, label)
          else notes.push('RingCentral Analytics returned no call-queue data for this period.')
          if (qos.skippedNoSla > 0) notes.push(`${qos.skippedNoSla} queue-day(s) had calls but no SLA classification and are left out of Service Quality.`)
          if (qos.clampedToDays) notes.push(`RingCentral Analytics only keeps about ${qos.clampedToDays} days, so earlier dates have no service quality data.`)
          setQosNote(notes.length > 0 ? notes.join(' ') : null)
          anySucceeded = true
        } catch (e) {
          if (isLocked(e)) locked = e
          errors.push(`Service quality: ${message(e)}`)
        }
      }

      if (locked) applyFailure(locked)
      if (scopes.length > 0) setScope(scopes.includes('self') ? 'self' : 'company')
      if (errors.length > 0) setLastError(errors.join(' | '))
      if (anySucceeded) setLastSyncedAt(new Date())
      setSyncStatus(null)
      setSyncing(false)
    },
    [setCallsFromRingCentral, setSmsFromRingCentral, setQosFromRingCentral, applyFailure],
  )

  /** Asks the Worker who it is signed in as; on success, imports the default window. */
  const connect = useCallback(async () => {
    setConnecting(true)
    try {
      const status = await fetchStatus()
      setUser(status.user)
      setEnvironment(status.environment)
      setBackend('connected')
      setBackendMessage(null)
      setConnecting(false)
      await syncNow(AUTO_SYNC_DAYS)
    } catch (e) {
      applyFailure(e)
      setConnecting(false)
    }
  }, [syncNow, applyFailure])

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
