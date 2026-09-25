import { useMemo } from 'react'
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

export function Overview() {
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
        <StatTile label="Total calls" value={formatNumber(kpis.totalCalls)} delta={kpis.totalCallsDelta} sublabel="vs prior period" />
        <StatTile label="Answer rate" value={formatPercent(kpis.answerRate)} delta={kpis.answerRateDelta} sublabel="vs prior period" />
        <StatTile
          label="Avg call duration"
          value={formatDuration(kpis.avgDuration)}
          delta={kpis.avgDurationDelta}
          deltaGoodDirection="down"
          sublabel="vs prior period"
        />
        <StatTile
          label="Service level"
          value={formatPercent(kpis.serviceLevel)}
          delta={kpis.serviceLevelDelta}
          sublabel="target 85%"
        />
        <StatTile
          label="Abandon rate"
          value={formatPercent(kpis.abandonRate, 1)}
          delta={kpis.abandonRateDelta}
          deltaGoodDirection="down"
          sublabel="vs prior period"
        />
        <StatTile label="SMS volume" value={formatCompact(kpis.totalSms)} delta={kpis.totalSmsDelta} sublabel="vs prior period" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Call volume trend" subtitle="Inbound vs outbound, daily" className="lg:col-span-2">
          <VolumeAreaChart data={volume} />
        </ChartCard>
        <ChartCard title="Call outcomes" subtitle="Share of all calls in range">
          <HorizontalBarChart
            data={outcomes.map((o) => ({ name: o.result, value: o.count }))}
            colors={outcomes.map((o) => OUTCOME_COLORS[o.result] ?? 'var(--series-7)')}
            height={220}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Service level trend" subtitle="Daily average across all queues" className="lg:col-span-2">
          <ServiceLevelChart data={serviceTrend.map((d) => ({ date: d.date, serviceLevel: d.serviceLevel }))} />
        </ChartCard>
        <ChartCard title="Volume by department" subtitle="Top departments by call count">
          <HorizontalBarChart data={deptLeaderboard.map((d) => ({ name: d.department, value: d.total }))} color="var(--series-1)" />
        </ChartCard>
      </div>
    </div>
  )
}
