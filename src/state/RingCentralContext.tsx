import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  beginConnect,
  clearConnection,
  completePendingConnect,
  forgetRememberedApp,
  getConnectionMode,
  getValidAccessToken,
  jwtCredentialsRemembered,
  loadConnectionConfig,
  loadRememberedApp,
  loadSiteAppConfig,
  redirectUriForDisplay,
  rememberApp,
  setJwtCredentials,
  signInAppRegistrationUrl,
  signOutAndRevoke,
  takeAbandonedSignIn,
  RC_SERVER_URLS,
  type ConnectionMode,
  type RcAppConfig,
  type RcConnectionConfig,
} from '../lib/ringcentralAuth'
import { parseCredentialsJson } from '../lib/ringcentralCredentials'
import { fetchCurrentUser, syncCallLog, syncSms, type DataScope, type RcUser } from '../lib/ringcentralApi'
import { loadDepartmentMap, saveDepartmentMap, type DepartmentMap } from '../lib/departmentMap'
import { useData } from './DataContext'

const AUTO_SYNC_DAYS = 30

interface RingCentralContextValue {
  ready: boolean
  connected: boolean
  mode: ConnectionMode | null
  remembered: boolean
  config: RcConnectionConfig | null
  user: RcUser | null
  scope: DataScope | null
  appConfig: RcAppConfig | null
  connecting: boolean
  syncing: boolean
  syncStatus: string | null
  lastSyncedAt: Date | null
  lastError: string | null
  /** Set when RingCentral rejected a sign-in without redirecting back (e.g. OAU-113). */
  abandonedApp: RcConnectionConfig | null
  smsSkipped: number | null
  redirectUri: string
  appRegistrationUrl: string
  departmentMap: DepartmentMap
  signIn: (appOverride?: RcConnectionConfig) => Promise<void>
  changeApp: () => void
  connectWithCredentialsFile: (file: File, remember: boolean) => Promise<void>
  signOut: () => Promise<void>
  syncNow: (days: number) => Promise<void>
  updateDepartmentMap: (map: DepartmentMap) => void
}

const RingCentralContext = createContext<RingCentralContextValue | null>(null)

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function RingCentralProvider({ children }: { children: ReactNode }) {
  const { setCallsFromRingCentral, setSmsFromRingCentral } = useData()
  const [ready, setReady] = useState(false)
  const [connected, setConnected] = useState(false)
  const [mode, setMode] = useState<ConnectionMode | null>(null)
  const [remembered, setRemembered] = useState(false)
  const [config, setConfig] = useState<RcConnectionConfig | null>(null)
  const [user, setUser] = useState<RcUser | null>(null)
  const [scope, setScope] = useState<DataScope | null>(null)
  const [siteApp, setSiteApp] = useState<RcAppConfig | null>(null)
  const [appConfig, setAppConfig] = useState<RcAppConfig | null>(() => loadRememberedApp())
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [abandonedApp, setAbandonedApp] = useState<RcConnectionConfig | null>(null)
  const [smsSkipped, setSmsSkipped] = useState<number | null>(null)
  const [departmentMap, setDepartmentMap] = useState<DepartmentMap>(() => loadDepartmentMap())
  // A ref so syncs started from long-lived callbacks always use the latest mapping.
  const deptRef = useRef(departmentMap)
  useEffect(() => {
    deptRef.current = departmentMap
  }, [departmentMap])

  const refreshConnectionState = useCallback(() => {
    const nextMode = getConnectionMode()
    setMode(nextMode)
    setConnected(nextMode !== null)
    setConfig(loadConnectionConfig())
    setRemembered(nextMode === 'jwt' ? jwtCredentialsRemembered() : nextMode === 'pkce')
    return nextMode !== null
  }, [])

  const syncNow = useCallback(
    async (days: number) => {
      setSyncing(true)
      setLastError(null)
      const errors: string[] = []
      let anySucceeded = false
      const scopes: DataScope[] = []

      // Sequential on purpose: RingCentral rate-limits the call-log API, so don't double the load.
      try {
        const calls = await syncCallLog(deptRef.current, days, setSyncStatus)
        setCallsFromRingCentral(calls.records, `RingCentral (last ${days}d)`)
        scopes.push(calls.scope)
        anySucceeded = true
      } catch (e) {
        errors.push(`Call log: ${message(e)}`)
      }
      try {
        const sms = await syncSms(deptRef.current, days, setSyncStatus)
        setSmsFromRingCentral(sms.records, `RingCentral (last ${days}d)`)
        setSmsSkipped(sms.skippedExtensions)
        scopes.push(sms.scope)
        anySucceeded = true
      } catch (e) {
        errors.push(`SMS: ${message(e)}`)
      }

      if (scopes.length > 0) setScope(scopes.includes('self') ? 'self' : 'company')
      if (errors.length > 0) setLastError(errors.join(' | '))
      if (anySucceeded) setLastSyncedAt(new Date())
      setSyncStatus(null)
      setSyncing(false)
    },
    [setCallsFromRingCentral, setSmsFromRingCentral],
  )

  const afterSignIn = useCallback(async () => {
    try {
      setUser(await fetchCurrentUser())
    } catch {
      // Profile is cosmetic; the import below reports any real access problem.
    }
    await syncNow(AUTO_SYNC_DAYS)
  }, [syncNow])

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      const site = await loadSiteAppConfig()
      setSiteApp(site)
      setAppConfig(site ?? loadRememberedApp())

      const result = await completePendingConnect()
      if (result && !result.ok) setLastError(`Sign-in didn't complete: ${result.error}`)
      if (!result) setAbandonedApp(takeAbandonedSignIn())
      const isIn = refreshConnectionState()
      setReady(true)
      if (isIn) await afterSignIn()
    })()
  }, [refreshConnectionState, afterSignIn])

  // Coming "Back" from RingCentral's error page can restore this page from the
  // back/forward cache, where the mount effect above doesn't run again.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return
      setConnecting(false)
      const abandoned = takeAbandonedSignIn()
      if (abandoned) setAbandonedApp(abandoned)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  const signIn = useCallback(
    async (appOverride?: RcConnectionConfig) => {
      const app = appOverride ?? appConfig
      if (!app) {
        setLastError('Enter your RingCentral app Client ID first (one-time setup).')
        return
      }
      if (appOverride) {
        rememberApp(appOverride)
        setAppConfig({ ...appOverride, source: 'browser' })
      }
      setConnecting(true)
      setLastError(null)
      setAbandonedApp(null)
      try {
        await beginConnect(app)
        // Navigates to RingCentral's login page; nothing after this runs in-page.
      } catch (e) {
        setConnecting(false)
        setLastError(`Couldn't start sign-in: ${message(e)}`)
      }
    },
    [appConfig],
  )

  const changeApp = useCallback(() => {
    forgetRememberedApp()
    setAppConfig(siteApp)
  }, [siteApp])

  const connectWithCredentialsFile = useCallback(
    async (file: File, remember: boolean) => {
      setConnecting(true)
      setLastError(null)
      setAbandonedApp(null)
      try {
        const creds = parseCredentialsJson(await file.text(), RC_SERVER_URLS.production)
        setJwtCredentials(creds, remember)
        await getValidAccessToken() // prove the credentials before reporting "signed in"
        refreshConnectionState()
        setConnecting(false)
        await afterSignIn()
      } catch (e) {
        clearConnection()
        refreshConnectionState()
        setLastError(message(e))
        setConnecting(false)
      }
    },
    [refreshConnectionState, afterSignIn],
  )

  const signOut = useCallback(async () => {
    await signOutAndRevoke()
    refreshConnectionState()
    setUser(null)
    setScope(null)
    setLastSyncedAt(null)
    setLastError(null)
    setSmsSkipped(null)
  }, [refreshConnectionState])

  const updateDepartmentMap = useCallback((map: DepartmentMap) => {
    setDepartmentMap(map)
    saveDepartmentMap(map)
  }, [])

  const value = useMemo<RingCentralContextValue>(
    () => ({
      ready,
      connected,
      mode,
      remembered,
      config,
      user,
      scope,
      appConfig,
      connecting,
      syncing,
      syncStatus,
      lastSyncedAt,
      lastError,
      abandonedApp,
      smsSkipped,
      redirectUri: redirectUriForDisplay(),
      appRegistrationUrl: signInAppRegistrationUrl(),
      departmentMap,
      signIn,
      changeApp,
      connectWithCredentialsFile,
      signOut,
      syncNow,
      updateDepartmentMap,
    }),
    [
      ready,
      connected,
      mode,
      remembered,
      config,
      user,
      scope,
      appConfig,
      connecting,
      syncing,
      syncStatus,
      lastSyncedAt,
      lastError,
      abandonedApp,
      smsSkipped,
      departmentMap,
      signIn,
      changeApp,
      connectWithCredentialsFile,
      signOut,
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
