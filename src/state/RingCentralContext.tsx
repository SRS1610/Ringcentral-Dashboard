import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  beginConnect,
  clearConnection,
  completePendingConnect,
  getConnectionMode,
  getValidAccessToken,
  jwtCredentialsRemembered,
  loadConnectionConfig,
  redirectUriForDisplay,
  setJwtCredentials,
  RC_SERVER_URLS,
  type ConnectionMode,
  type RcConnectionConfig,
} from '../lib/ringcentralAuth'
import { parseCredentialsJson } from '../lib/ringcentralCredentials'
import { syncCallLog, syncSms } from '../lib/ringcentralApi'
import { loadDepartmentMap, saveDepartmentMap, type DepartmentMap } from '../lib/departmentMap'
import { useData } from './DataContext'

interface RingCentralContextValue {
  connected: boolean
  mode: ConnectionMode | null
  remembered: boolean
  config: RcConnectionConfig | null
  connecting: boolean
  syncing: boolean
  lastSyncedAt: Date | null
  lastError: string | null
  smsSkipped: number | null
  redirectUri: string
  departmentMap: DepartmentMap
  connect: (config: RcConnectionConfig) => Promise<void>
  connectWithCredentialsFile: (file: File, remember: boolean) => Promise<void>
  disconnect: () => void
  syncNow: (days: number) => Promise<void>
  updateDepartmentMap: (map: DepartmentMap) => void
}

const RingCentralContext = createContext<RingCentralContextValue | null>(null)

export function RingCentralProvider({ children }: { children: ReactNode }) {
  const { setCallsFromRingCentral, setSmsFromRingCentral } = useData()
  const [connected, setConnected] = useState(false)
  const [mode, setMode] = useState<ConnectionMode | null>(null)
  const [remembered, setRemembered] = useState(false)
  const [config, setConfig] = useState<RcConnectionConfig | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [smsSkipped, setSmsSkipped] = useState<number | null>(null)
  const [departmentMap, setDepartmentMap] = useState<DepartmentMap>(() => loadDepartmentMap())

  const refreshConnectionState = useCallback(() => {
    const nextMode = getConnectionMode()
    setMode(nextMode)
    setConnected(nextMode !== null)
    setConfig(loadConnectionConfig())
    setRemembered(nextMode === 'jwt' ? jwtCredentialsRemembered() : nextMode === 'pkce')
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await completePendingConnect()
      if (cancelled) return
      if (result && !result.ok) setLastError(result.error)
      refreshConnectionState()
    })()
    return () => {
      cancelled = true
    }
  }, [refreshConnectionState])

  const connect = useCallback(async (nextConfig: RcConnectionConfig) => {
    setConnecting(true)
    setLastError(null)
    try {
      await beginConnect(nextConfig)
      // Navigation away happens here; this promise never really resolves in-page.
    } catch (e) {
      setConnecting(false)
      setLastError(e instanceof Error ? e.message : 'Failed to start connection')
    }
  }, [])

  const connectWithCredentialsFile = useCallback(
    async (file: File, remember: boolean) => {
      setConnecting(true)
      setLastError(null)
      try {
        const text = await file.text()
        const creds = parseCredentialsJson(text, RC_SERVER_URLS.production)
        setJwtCredentials(creds, remember)
        // Prove the credentials work before reporting "connected".
        await getValidAccessToken()
        refreshConnectionState()
      } catch (e) {
        clearConnection()
        refreshConnectionState()
        setLastError(e instanceof Error ? e.message : 'Failed to sign in with that file')
      } finally {
        setConnecting(false)
      }
    },
    [refreshConnectionState],
  )

  const disconnect = useCallback(() => {
    clearConnection()
    refreshConnectionState()
    setLastSyncedAt(null)
    setLastError(null)
    setSmsSkipped(null)
  }, [refreshConnectionState])

  const syncNow = useCallback(
    async (days: number) => {
      setSyncing(true)
      setLastError(null)
      const [callsResult, smsResult] = await Promise.allSettled([syncCallLog(departmentMap, days), syncSms(departmentMap, days)])

      const errors: string[] = []
      if (callsResult.status === 'fulfilled') {
        setCallsFromRingCentral(callsResult.value, `RingCentral (last ${days}d)`)
      } else {
        errors.push(`Call log: ${callsResult.reason instanceof Error ? callsResult.reason.message : String(callsResult.reason)}`)
      }
      if (smsResult.status === 'fulfilled') {
        setSmsFromRingCentral(smsResult.value.records, `RingCentral (last ${days}d)`)
        setSmsSkipped(smsResult.value.skippedExtensions)
      } else {
        errors.push(`SMS: ${smsResult.reason instanceof Error ? smsResult.reason.message : String(smsResult.reason)}`)
      }

      if (errors.length > 0) setLastError(errors.join(' | '))
      if (callsResult.status === 'fulfilled' || smsResult.status === 'fulfilled') setLastSyncedAt(new Date())
      setSyncing(false)
    },
    [departmentMap, setCallsFromRingCentral, setSmsFromRingCentral],
  )

  const updateDepartmentMap = useCallback((map: DepartmentMap) => {
    setDepartmentMap(map)
    saveDepartmentMap(map)
  }, [])

  const value = useMemo<RingCentralContextValue>(
    () => ({
      connected,
      mode,
      remembered,
      config,
      connecting,
      syncing,
      lastSyncedAt,
      lastError,
      smsSkipped,
      redirectUri: redirectUriForDisplay(),
      departmentMap,
      connect,
      connectWithCredentialsFile,
      disconnect,
      syncNow,
      updateDepartmentMap,
    }),
    [
      connected,
      mode,
      remembered,
      config,
      connecting,
      syncing,
      lastSyncedAt,
      lastError,
      smsSkipped,
      departmentMap,
      connect,
      connectWithCredentialsFile,
      disconnect,
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
