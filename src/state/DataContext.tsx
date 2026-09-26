import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CallRecord, DatasetSource, DateRange, DateRangePreset, QosRecord, SmsRecord } from '../types'
import { parseCallLogCsv, parseQosCsv, parseSmsCsv } from '../lib/parsers'

interface DatasetState<T> {
  records: T[]
  source: DatasetSource
  fileName: string
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
  setCallsFromRingCentral: (records: CallRecord[], label: string) => void
  setSmsFromRingCentral: (records: SmsRecord[], label: string) => void
  resetToSampleData: () => Promise<void>
  range: DateRange | null
  preset: DateRangePreset
  setPreset: (p: DateRangePreset) => void
  /** Pick exact from/to days on the calendar; switches the preset to 'custom'. */
  setCustomRange: (r: DateRange) => void
  customRange: DateRange | null
  dataBounds: DateRange | null
}

const DataContext = createContext<DataContextValue | null>(null)

const initial = <T,>(): DatasetState<T> => ({ records: [], source: 'sample', fileName: '', loading: true, error: null })

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

function presetToRange(preset: DateRangePreset, bounds: DateRange | null): DateRange | null {
  if (!bounds) return null
  const end = bounds.end
  if (preset === 'all' || preset === 'custom') return bounds
  if (preset === 'mtd') {
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))
    return { start: start < bounds.start ? bounds.start : start, end }
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  const start = new Date(end.getTime() - (days - 1) * 86400000)
  return { start: start < bounds.start ? bounds.start : start, end }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [calls, setCalls] = useState<DatasetState<CallRecord>>(initial<CallRecord>())
  const [qos, setQos] = useState<DatasetState<QosRecord>>(initial<QosRecord>())
  const [sms, setSms] = useState<DatasetState<SmsRecord>>(initial<SmsRecord>())
  const [preset, setPreset] = useState<DateRangePreset>('30d')
  const [customRange, setCustomRangeState] = useState<DateRange | null>(null)

  const setCustomRange = useCallback((r: DateRange) => {
    setCustomRangeState(r)
    setPreset('custom')
  }, [])

  // On first load the sample CSVs (~2.5 MB) can arrive after a RingCentral import or an
  // upload has already landed; `replaceExisting: false` keeps that real data instead of
  // clobbering it. The explicit "Reset to sample data" action passes true.
  const loadSample = useCallback(async ({ replaceExisting }: { replaceExisting: boolean }) => {
    const apply = <T,>(next: DatasetState<T>) => (prev: DatasetState<T>) => (replaceExisting || prev.source === 'sample' ? next : prev)
    const markLoading = <T,>(prev: DatasetState<T>) => (replaceExisting || prev.source === 'sample' ? { ...prev, loading: true, error: null } : prev)
    setCalls(markLoading)
    setQos(markLoading)
    setSms(markLoading)
    try {
      const [callText, qosText, smsText] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}data/call-log-sample.csv`).then((r) => r.text()),
        fetch(`${import.meta.env.BASE_URL}data/analytics-qos-sample.csv`).then((r) => r.text()),
        fetch(`${import.meta.env.BASE_URL}data/sms-log-sample.csv`).then((r) => r.text()),
      ])
      setCalls(apply<CallRecord>({ records: parseCallLogCsv(callText), source: 'sample', fileName: 'call-log-sample.csv', loading: false, error: null }))
      setQos(apply<QosRecord>({ records: parseQosCsv(qosText), source: 'sample', fileName: 'analytics-qos-sample.csv', loading: false, error: null }))
      setSms(apply<SmsRecord>({ records: parseSmsCsv(smsText), source: 'sample', fileName: 'sms-log-sample.csv', loading: false, error: null }))
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load sample data'
      const fail = <T,>(prev: DatasetState<T>) => (replaceExisting || prev.source === 'sample' ? { ...prev, loading: false, error: message } : prev)
      setCalls(fail)
      setQos(fail)
      setSms(fail)
    }
  }, [])

  useEffect(() => {
    loadSample({ replaceExisting: false })
  }, [loadSample])

  const resetToSampleData = useCallback(() => loadSample({ replaceExisting: true }), [loadSample])

  const loadCallsFile = useCallback(async (file: File) => {
    setCalls((s) => ({ ...s, loading: true, error: null }))
    try {
      const text = await file.text()
      const records = parseCallLogCsv(text)
      if (records.length === 0) throw new Error('No recognizable call records found in this file.')
      setCalls({ records, source: 'uploaded', fileName: file.name, loading: false, error: null })
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
      setQos({ records, source: 'uploaded', fileName: file.name, loading: false, error: null })
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
      setSms({ records, source: 'uploaded', fileName: file.name, loading: false, error: null })
    } catch (e) {
      setSms((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Failed to parse file' }))
    }
  }, [])

  const setCallsFromRingCentral = useCallback((records: CallRecord[], label: string) => {
    setCalls({ records, source: 'ringcentral', fileName: label, loading: false, error: null })
  }, [])

  const setSmsFromRingCentral = useCallback((records: SmsRecord[], label: string) => {
    setSms({ records, source: 'ringcentral', fileName: label, loading: false, error: null })
  }, [])

  const dataBounds = useMemo(() => {
    const dates = [...calls.records.map((c) => c.startTime), ...qos.records.map((q) => q.date), ...sms.records.map((s) => s.dateTime)]
    return computeBounds(dates)
  }, [calls.records, qos.records, sms.records])

  const range = useMemo(
    () => (preset === 'custom' && customRange ? customRange : presetToRange(preset, dataBounds)),
    [preset, customRange, dataBounds],
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
    resetToSampleData,
    range,
    preset,
    setPreset,
    setCustomRange,
    customRange,
    dataBounds,
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within a DataProvider')
  return ctx
}
