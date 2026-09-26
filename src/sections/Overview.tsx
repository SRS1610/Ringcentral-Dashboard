import { useMemo } from 'react'
import { useData } from '../state/DataContext'
import { useFilteredData } from '../state/useFilteredData'
import { StatTile } from '../components/ui/StatTile'
import { ChartCard } from '../components/ui/ChartCard'
import { VolumeAreaChart } from '../components/charts/VolumeAreaChart'
import { ServiceLevelChart } from '../components/charts/ServiceLevelChart'
import { HorizontalBarChart } from '../components/charts/HorizontalBarChart'
import {
  callKpis,
  callOutcomeBreakdown,
  dailyCallVolume,
  departmentLeaderboard,
  pctDelta,
  qosDailyTrend,
  qosKpis,
  smsKpis,
} from '../lib/metrics'
import { formatCompact, formatDuration, formatNumber, formatPercent } from '../lib/format'

const OUTCOME_COLORS: Record<string, string> = {
  'Call connected': 'var(--status-good)',
  Missed: 'var(--status-critical)',
  Voicemail: 'var(--series-1)',
  Rejected: 'var(--status-serious)',
  Busy: 'var(--status-warning)',
}

function NoDataNote({ children }: { children: string }) {
  return (
    <div className="h-[220px] flex items-center justify-center text-sm text-center px-6" style={{ color: 'var(--text-muted)' }}>
      {children}
    </div>
  )
}

export function Overview() {
  // A dataset that hasn't been loaded at all shows "—" rather than a misleading 0.
  const { calls, qos, sms } = useData()
  const hasCalls = calls.records.length > 0
  const hasQos = qos.records.length > 0
  const hasSms = sms.records.length > 0
  const { callsInRange, qosInRange, smsInRange, callsPrior, qosPrior, smsPrior, loading } = useFilteredData()

  const kpis = useMemo(() => {
    const calls = callKpis(callsInRange)
    const callsPriorK = callKpis(callsPrior)
    const qos = qosKpis(qosInRange)
    const qosPriorK = qosKpis(qosPrior)
    const sms = smsKpis(smsInRange)
    const smsPriorK = smsKpis(smsPrior)
    return {
      totalCalls: calls.total,
      totalCallsDelta: pctDelta(calls.total, callsPriorK.total),
      answerRate: calls.answerRate,
      answerRateDelta: pctDelta(calls.answerRate, callsPriorK.answerRate),
      avgDuration: calls.avgDuration,
      avgDurationDelta: pctDelta(calls.avgDuration, callsPriorK.avgDuration),
      serviceLevel: qos.avgServiceLevel,
      serviceLevelDelta: pctDelta(qos.avgServiceLevel, qosPriorK.avgServiceLevel),
      abandonRate: qos.abandonRate,
      abandonRateDelta: pctDelta(qos.abandonRate, qosPriorK.abandonRate),
      totalSms: sms.total,
      totalSmsDelta: pctDelta(sms.total, smsPriorK.total),
    }
  }, [callsInRange, callsPrior, qosInRange, qosPrior, smsInRange, smsPrior])

  const volume = useMemo(() => dailyCallVolume(callsInRange), [callsInRange])
  const serviceTrend = useMemo(() => qosDailyTrend(qosInRange), [qosInRange])
  const deptLeaderboard = useMemo(() => departmentLeaderboard(callsInRange).slice(0, 6), [callsInRange])
  const outcomes = useMemo(() => callOutcomeBreakdown(callsInRange), [callsInRange])

  if (loading) {
    return <div className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>Loading dashboard data&hellip;</div>
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile
          label="Total calls"
          value={hasCalls ? formatNumber(kpis.totalCalls) : '—'}
          delta={hasCalls ? kpis.totalCallsDelta : undefined}
          sublabel={hasCalls ? 'vs prior period' : 'No call data'}
        />
        <StatTile
          label="Answer rate"
          value={hasCalls ? formatPercent(kpis.answerRate) : '—'}
          delta={hasCalls ? kpis.answerRateDelta : undefined}
          sublabel={hasCalls ? 'vs prior period' : 'No call data'}
        />
        <StatTile
          label="Avg call duration"
          value={hasCalls ? formatDuration(kpis.avgDuration) : '—'}
          delta={hasCalls ? kpis.avgDurationDelta : undefined}
          deltaGoodDirection="down"
          sublabel={hasCalls ? 'vs prior period' : 'No call data'}
        />
        <StatTile
          label="Service level"
          value={hasQos ? formatPercent(kpis.serviceLevel) : '—'}
          delta={hasQos ? kpis.serviceLevelDelta : undefined}
          sublabel={hasQos ? 'target 85%' : 'No analytics data'}
        />
        <StatTile
          label="Abandon rate"
          value={hasQos ? formatPercent(kpis.abandonRate, 1) : '—'}
          delta={hasQos ? kpis.abandonRateDelta : undefined}
          deltaGoodDirection="down"
          sublabel={hasQos ? 'vs prior period' : 'No analytics data'}
        />
        <StatTile
          label="SMS volume"
          value={hasSms ? formatCompact(kpis.totalSms) : '—'}
          delta={hasSms ? kpis.totalSmsDelta : undefined}
          sublabel={hasSms ? 'vs prior period' : 'No SMS data'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Call volume trend" subtitle="Inbound vs outbound, daily" className="lg:col-span-2">
          {hasCalls ? <VolumeAreaChart data={volume} /> : <NoDataNote>No call data loaded yet.</NoDataNote>}
        </ChartCard>
        <ChartCard title="Call outcomes" subtitle="Share of all calls in range">
          {hasCalls ? (
            <HorizontalBarChart
              data={outcomes.map((o) => ({ name: o.result, value: o.count }))}
              colors={outcomes.map((o) => OUTCOME_COLORS[o.result] ?? 'var(--series-7)')}
              height={220}
            />
          ) : (
            <NoDataNote>No call data loaded yet.</NoDataNote>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Service level trend" subtitle="Daily average across all queues" className="lg:col-span-2">
          {hasQos ? (
            <ServiceLevelChart data={serviceTrend.map((d) => ({ date: d.date, serviceLevel: d.serviceLevel }))} />
          ) : (
            <NoDataNote>Service level comes from the RingCentral Analytics export. Upload it with Upload data.</NoDataNote>
          )}
        </ChartCard>
        <ChartCard title="Volume by department" subtitle="Top departments by call count">
          {hasCalls ? (
            <HorizontalBarChart data={deptLeaderboard.map((d) => ({ name: d.department, value: d.total }))} color="var(--series-1)" />
          ) : (
            <NoDataNote>No call data loaded yet.</NoDataNote>
          )}
        </ChartCard>
      </div>
    </div>
  )
}
