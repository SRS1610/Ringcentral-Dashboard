import { useMemo } from 'react'
import { useData } from './DataContext'
import { filterByRange, priorRange, splitByKind } from '../lib/metrics'

/**
 * The records inside the selected date range and inside the equal-length window before it.
 * `calls*` hold phone calls only; faxes from the same RingCentral log are in `fax*`.
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
    const before = splitByKind(filterByRange(calls.records, (c) => c.startTime, prior))
    return {
      callsInRange: current.voice,
      faxInRange: current.fax,
      qosInRange: filterByRange(qos.records, (q) => q.date, range),
      smsInRange: filterByRange(sms.records, (s) => s.dateTime, range),
      callsPrior: before.voice,
      faxPrior: before.fax,
      qosPrior: filterByRange(qos.records, (q) => q.date, prior),
      smsPrior: filterByRange(sms.records, (s) => s.dateTime, prior),
      timeZone,
      loading,
    }
  }, [calls.records, calls.loading, qos.records, qos.loading, sms.records, sms.loading, range, timeZone])
}
