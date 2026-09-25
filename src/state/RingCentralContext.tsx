import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  beginConnect,
  clearConnection,
  completePendingConnect,
  isConnected,
  loadConnectionConfig,
  redirectUriForDisplay,
  type RcConnectionConfig,
} from '../lib/ringcentralAuth'
import { syncCallLog, syncSms } from '../lib/ringcentralApi'
import { loadDepartmentMap, saveDepartmentMap, type DepartmentMap } from '../lib/departmentMap'
import { useData } from './DataContext'

interface RingCentralContextValue {
  connected: boolean
  config: RcConnectionConfig | null
  connecting: boolean
  syncing: boolean
  lastSyncedAt: Date | null
  lastError: string | null
  smsSkipped: number | null
  redirectUri: string
  departmentMap: DepartmentMap
  connect: (config: RcConnectionConfig) => Promise<void>
  disconnect: () => void
  syncNow: (days: number) => Promise<void>
  updateDepartmentMap: (map: DepartmentMap) => void
}

const RingCentralContext = createContext<RingCentralContextValue | null>(null)

export function RingCentralProvider({ children }: { children: ReactNode }) {
  const { setCallsFromRingCentral, setSmsFromRingCentral } = useData()
  const [connected, setConnected] = useState(false)
  const [config, setConfig] = useState<RcConnectionConfig | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [smsSkipped, setSmsSkipped] = useState<number | null>(null)
  const [departmentMap, setDepartmentMap] = useState<DepartmentMap>(() => loadDepartmentMap())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await completePendingConnect()
      if (cancelled) return
      if (result && !result.ok) setLastError(result.error)
      setConnected(isConnected())
      setConfig(loadConnectionConfig())
    })()
    return () => {
      cancelled = true
    }
  }, [])

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

  const disconnect = useCallback(() => {
    clearConnection()
    setConnected(false)
    setConfig(null)
    setLastSyncedAt(null)
    setLastError(null)
    setSmsSkipped(null)
  }, [])

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
      else setLastSyncedAt(new Date())
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
      config,
      connecting,
      syncing,
      lastSyncedAt,
      lastError,
      smsSkipped,
      redirectUri: redirectUriForDisplay(),
      departmentMap,
      connect,
      disconnect,
      syncNow,
      updateDepartmentMap,
    }),
    [connected, config, connecting, syncing, lastSyncedAt, lastError, smsSkipped, departmentMap, connect, disconnect, syncNow, updateDepartmentMap],
  )

  return <RingCentralContext.Provider value={value}>{children}</RingCentralContext.Provider>
}

export function useRingCentral() {
  const ctx = useContext(RingCentralContext)
  if (!ctx) throw new Error('useRingCentral must be used within a RingCentralProvider')
  return ctx
}
