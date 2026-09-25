import { useMemo } from 'react'
import { useData } from './DataContext'
import { filterByRange, priorRange } from '../lib/metrics'

export function useFilteredData() {
  const { calls, qos, sms, range } = useData()

  return useMemo(() => {
    if (!range) {
      return {
        callsInRange: [],
        qosInRange: [],
        smsInRange: [],
        callsPrior: [],
        qosPrior: [],
        smsPrior: [],
        loading: calls.loading || qos.loading || sms.loading,
      }
    }
    const prior = priorRange(range)
    return {
      callsInRange: filterByRange(calls.records, (c) => c.startTime, range),
      qosInRange: filterByRange(qos.records, (q) => q.date, range),
      smsInRange: filterByRange(sms.records, (s) => s.dateTime, range),
      callsPrior: filterByRange(calls.records, (c) => c.startTime, prior),
      qosPrior: filterByRange(qos.records, (q) => q.date, prior),
      smsPrior: filterByRange(sms.records, (s) => s.dateTime, prior),
      loading: calls.loading || qos.loading || sms.loading,
    }
  }, [calls.records, calls.loading, qos.records, qos.loading, sms.records, sms.loading, range])
}
