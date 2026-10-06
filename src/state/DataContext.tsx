import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CallRecord, DatasetSource, DateRange, DateRangePreset, QosRecord, SmsRecord } from '../types'
import { parseCallLogCsv, parseQosCsv, parseSmsCsv } from '../lib/parsers'
import { browserTimeZone, isValidTimeZone, zonedDayStart, zonedMonthStart } from '../lib/timezone'

interface DatasetState<T> {
  records: T[]
  source: DatasetSource
  fileName: string
  /**
   * The start of the period that was asked for when this data was imported; records can begin
   * later (a quiet weekend). Null for files, where the first record is all there is to go on.
   */
  coveredFrom: Date | null
  loading: boolean
  error: string | null
}

interface DataContextValue {
  calls: DatasetState<CallRecord>
  qos: DatasetState<QosRecord>
  sms: DatasetState<SmsRecord>
  loadCallsFile: (file: File) => Promise<void>
  loadQosFile: (file: File) => Promise<void>
  loadSmsFile: (file: File) => Promise<void>
  setCallsFromRingCentral: (records: CallRecord[], label: string, coveredFrom: Date) => void
  setSmsFromRingCentral: (records: SmsRecord[], label: string, coveredFrom: Date) => void
  setQosFromRingCentral: (records: QosRecord[], label: string, coveredFrom: Date) => void
  /** Drops uploads and browser imports, going back to the data files published with the site. */
  resetToSiteData: () => Promise<void>
  range: DateRange | null
  preset: DateRangePreset
  setPreset: (p: DateRangePreset) => void
  /** Pick exact from/to days on the calendar; switches the preset to 'custom'. */
  setCustomRange: (r: DateRange) => void
  customRange: DateRange | null
  dataBounds: DateRange | null
  /** The zone days, hours and displayed times are worked out in. */
  timeZone: string
  /** The zone picked in Settings, or null to follow the RingCentral account (else this browser). */
  timeZoneChoice: string | null
  setTimeZoneChoice: (timeZone: string | null) => void
  /** The zone RingCentral reports for the account; null until live data is connected. */
  accountTimeZone: string | null
  setAccountTimeZone: (timeZone: string | null) => void
}

const TIME_ZONE_KEY = 'rc_dashboard_timezone'

function loadTimeZoneChoice(): string | null {
  try {
    const saved = localStorage.getItem(TIME_ZONE_KEY)
    return isValidTimeZone(saved) ? saved : null
  } catch {
    return null
  }
}

const DataContext = createContext<DataContextValue | null>(null)

const initial = <T,>(): DatasetState<T> => ({ records: [], source: 'site', fileName: '', coveredFrom: null, loading: true, error: null })

function computeBounds(dates: Date[]): DateRange | null {
  if (dates.length === 0) return null
  let min = dates[0].getTime()
  let max = dates[0].getTime()
  for (const d of dates) {
    const t = d.getTime()
    if (t < min) min = t
    if (t > max) max = t
  }
  return { start: new Date(min), end: new Date(max) }
}

/** Presets count whole calendar days in the dashboard's time zone, ending on the day of the latest record. */
function presetToRange(preset: DateRangePreset, bounds: DateRange | null, timeZone: string): DateRange | null {
  if (!bounds) return null
  const end = bounds.end
  if (preset === 'all' || preset === 'custom') return bounds
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  const start = preset === 'mtd' ? zonedMonthStart(end, timeZone) : zonedDayStart(end, timeZone, -(days - 1))
  return { start: start < bounds.start ? bounds.start : start, end }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [calls, setCalls] = useState<DatasetState<CallRecord>>(initial<CallRecord>())
  const [qos, setQos] = useState<DatasetState<QosRecord>>(initial<QosRecord>())
  const [sms, setSms] = useState<DatasetState<SmsRecord>>(initial<SmsRecord>())
  const [preset, setPreset] = useState<DateRangePreset>('30d')
  const [customRange, setCustomRangeState] = useState<DateRange | null>(null)
  const [timeZoneChoice, setTimeZoneChoiceState] = useState<string | null>(() => loadTimeZoneChoice())
  const [accountTimeZone, setAccountTimeZoneState] = useState<string | null>(null)
  const timeZone = useMemo(() => timeZoneChoice ?? accountTimeZone ?? browserTimeZone(), [timeZoneChoice, accountTimeZone])

  const setTimeZoneChoice = useCallback((next: string | null) => {
    const value = isValidTimeZone(next) ? next : null
    setTimeZoneChoiceState(value)
    try {
      if (value) localStorage.setItem(TIME_ZONE_KEY, value)
      else localStorage.removeItem(TIME_ZONE_KEY)
    } catch {
      // ignore — the choice just won't persist across sessions
    }
  }, [])

  const setAccountTimeZone = useCallback((next: string | null) => {
    setAccountTimeZoneState(isValidTimeZone(next) ? next : null)
  }, [])

  const setCustomRange = useCallback((r: DateRange) => {
    setCustomRangeState(r)
    setPreset('custom')
  }, [])

  // The site's data files (public/data/, kept current by the scheduled RingCentral sync)
  // can arrive after a live RingCentral import or an upload has already landed;
  // `replaceExisting: false` keeps that data instead of clobbering it. The explicit
  // "Clear uploads and imports" action passes true.
  const loadSiteData = useCallback(async ({ replaceExisting }: { replaceExisting: boolean }) => {
    const apply = <T,>(next: DatasetState<T>) => (prev: DatasetState<T>) => (replaceExisting || prev.source === 'site' ? next : prev)
    const markLoading = <T,>(prev: DatasetState<T>) => (replaceExisting || prev.source === 'site' ? { ...prev, loading: true, error: null } : prev)
    setCalls(markLoading)
    setQos(markLoading)
    setSms(markLoading)
    try {
      const [callText, qosText, smsText] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}data/call-log.csv`).then((r) => r.text()),
        fetch(`${import.meta.env.BASE_URL}data/analytics-qos.csv`).then((r) => r.text()),
        fetch(`${import.meta.env.BASE_URL}data/sms-log.csv`).then((r) => r.text()),
      ])
      setCalls(apply<CallRecord>({ records: parseCallLogCsv(callText), source: 'site', fileName: 'call-log.csv', coveredFrom: null, loading: false, error: null }))
      setQos(apply<QosRecord>({ records: parseQosCsv(qosText), source: 'site', fileName: 'analytics-qos.csv', coveredFrom: null, loading: false, error: null }))
      setSms(apply<SmsRecord>({ records: parseSmsCsv(smsText), source: 'site', fileName: 'sms-log.csv', coveredFrom: null, loading: false, error: null }))
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load dashboard data'
      const fail = <T,>(prev: DatasetState<T>) => (replaceExisting || prev.source === 'site' ? { ...prev, loading: false, error: message } : prev)
      setCalls(fail)
      setQos(fail)
      setSms(fail)
    }
  }, [])

  useEffect(() => {
    loadSiteData({ replaceExisting: false })
  }, [loadSiteData])

  const resetToSiteData = useCallback(() => loadSiteData({ replaceExisting: true }), [loadSiteData])

  const loadCallsFile = useCallback(async (file: File) => {
    setCalls((s) => ({ ...s, loading: true, error: null }))
    try {
      const text = await file.text()
      const records = parseCallLogCsv(text)
      if (records.length === 0) throw new Error('No recognizable call records found in this file.')
      setCalls({ records, source: 'uploaded', fileName: file.name, coveredFrom: null, loading: false, error: null })
    } catch (e) {
      setCalls((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Failed to parse file' }))
    }
  }, [])

  const loadQosFile = useCallback(async (file: File) => {
    setQos((s) => ({ ...s, loading: true, error: null }))
    try {
      const text = await file.text()
      const records = parseQosCsv(text)
      if (records.length === 0) throw new Error('No recognizable analytics rows found in this file.')
      setQos({ records, source: 'uploaded', fileName: file.name, coveredFrom: null, loading: false, error: null })
    } catch (e) {
      setQos((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Failed to parse file' }))
    }
  }, [])

  const loadSmsFile = useCallback(async (file: File) => {
    setSms((s) => ({ ...s, loading: true, error: null }))
    try {
      const text = await file.text()
      const records = parseSmsCsv(text)
      if (records.length === 0) throw new Error('No recognizable SMS records found in this file.')
      setSms({ records, source: 'uploaded', fileName: file.name, coveredFrom: null, loading: false, error: null })
    } catch (e) {
      setSms((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Failed to parse file' }))
    }
  }, [])

  const setCallsFromRingCentral = useCallback((records: CallRecord[], label: string, coveredFrom: Date) => {
    setCalls({ records, source: 'ringcentral', fileName: label, coveredFrom, loading: false, error: null })
  }, [])

  const setSmsFromRingCentral = useCallback((records: SmsRecord[], label: string, coveredFrom: Date) => {
    setSms({ records, source: 'ringcentral', fileName: label, coveredFrom, loading: false, error: null })
  }, [])

  const setQosFromRingCentral = useCallback((records: QosRecord[], label: string, coveredFrom: Date) => {
    setQos({ records, source: 'ringcentral', fileName: label, coveredFrom, loading: false, error: null })
  }, [])

  const dataBounds = useMemo(() => {
    const dates = [...calls.records.map((c) => c.startTime), ...qos.records.map((q) => q.date), ...sms.records.map((s) => s.dateTime)]
    return computeBounds(dates)
  }, [calls.records, qos.records, sms.records])

  const range = useMemo(
    () => (preset === 'custom' && customRange ? customRange : presetToRange(preset, dataBounds, timeZone)),
    [preset, customRange, dataBounds, timeZone],
  )

  const value: DataContextValue = {
    calls,
    qos,
    sms,
    loadCallsFile,
    loadQosFile,
    loadSmsFile,
    setCallsFromRingCentral,
    setSmsFromRingCentral,
    setQosFromRingCentral,
    resetToSiteData,
    range,
    preset,
    setPreset,
    setCustomRange,
    customRange,
    dataBounds,
    timeZone,
    timeZoneChoice,
    setTimeZoneChoice,
    accountTimeZone,
    setAccountTimeZone,
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within a DataProvider')
  return ctx
}
