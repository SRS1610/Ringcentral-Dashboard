import { useMemo } from 'react'
import { useData } from './DataContext'
import { coversRange, filterByRange, priorRange, splitByKind } from '../lib/metrics'

function earliest<T>(records: T[], getDate: (r: T) => Date): Date | null {
  let min: number | null = null
  for (const r of records) {
    const t = getDate(r).getTime()
    if (min === null || t < min) min = t
  }
  return min === null ? null : new Date(min)
}

/**
 * The records inside the selected date range and inside the equal-length window before it.
 * `calls*` hold phone calls only; faxes from the same RingCentral log are in `fax*`.
 * A `*Prior` list is empty unless the loaded data covers that whole earlier window, so
 * comparisons are never made against a partly loaded period.
 */
export function useFilteredData() {
  const { calls, qos, sms, range, timeZone } = useData()

  return useMemo(() => {
    const loading = calls.loading || qos.loading || sms.loading
    if (!range) {
      return { callsInRange: [], faxInRange: [], qosInRange: [], smsInRange: [], callsPrior: [], faxPrior: [], qosPrior: [], smsPrior: [], timeZone, loading }
    }
    const prior = priorRange(range)
    const current = splitByKind(filterByRange(calls.records, (c) => c.startTime, range))
    const callsCovered = coversRange(prior, calls.coveredFrom, earliest(calls.records, (c) => c.startTime))
    const before = splitByKind(callsCovered ? filterByRange(calls.records, (c) => c.startTime, prior) : [])
    return {
      callsInRange: current.voice,
      faxInRange: current.fax,
      qosInRange: filterByRange(qos.records, (q) => q.date, range),
      smsInRange: filterByRange(sms.records, (s) => s.dateTime, range),
      callsPrior: before.voice,
      faxPrior: before.fax,
      qosPrior: coversRange(prior, qos.coveredFrom, earliest(qos.records, (q) => q.date)) ? filterByRange(qos.records, (q) => q.date, prior) : [],
      smsPrior: coversRange(prior, sms.coveredFrom, earliest(sms.records, (s) => s.dateTime)) ? filterByRange(sms.records, (s) => s.dateTime, prior) : [],
      timeZone,
      loading,
    }
  }, [calls.records, calls.coveredFrom, calls.loading, qos.records, qos.coveredFrom, qos.loading, sms.records, sms.coveredFrom, sms.loading, range, timeZone])
}
