import { useMemo, useRef, useState } from 'react'
import { useFilteredData } from '../state/useFilteredData'
import { StatTile } from '../components/ui/StatTile'
import { ChartCard } from '../components/ui/ChartCard'
import { VolumeAreaChart } from '../components/charts/VolumeAreaChart'
import { HorizontalBarChart } from '../components/charts/HorizontalBarChart'
import { Heatmap } from '../components/charts/Heatmap'
import { CallerBreakdown } from '../components/CallerBreakdown'
import { callHeatmap, callKpis, callOutcomeBreakdown, dailyCallVolume, departmentLeaderboard, metricForResult, pctDelta, resultForMetric, type CallMetricKey } from '../lib/metrics'
import { formatDuration, formatNumber, formatPercent } from '../lib/format'

const OUTCOME_COLORS: Record<string, string> = {
  'Call connected': 'var(--status-good)',
  Missed: 'var(--status-critical)',
  Voicemail: 'var(--series-1)',
  Rejected: 'var(--status-serious)',
  Busy: 'var(--status-warning)',
}

export function CallActivity() {
  const { callsInRange, callsPrior, loading } = useFilteredData()
  const [metric, setMetric] = useState<CallMetricKey>('missed')
  const callersRef = useRef<HTMLDivElement>(null)

  /** Picks the metric the caller list explains and brings that list into view. */
  const showCallers = (key: CallMetricKey) => {
    setMetric(key)
    callersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
  const tile = (key: CallMetricKey) => ({ onClick: () => showCallers(key), active: metric === key, actionLabel: 'Show the callers behind this number' })

  const kpis = useMemo(() => {
    const cur = callKpis(callsInRange)
    const prior = callKpis(callsPrior)
    return {
      total: cur.total,
      totalDelta: pctDelta(cur.total, prior.total),
      inbound: cur.inbound,
      inboundDelta: pctDelta(cur.inbound, prior.inbound),
      outbound: cur.outbound,
      outboundDelta: pctDelta(cur.outbound, prior.outbound),
      avgDuration: cur.avgDuration,
      avgDurationDelta: pctDelta(cur.avgDuration, prior.avgDuration),
      answerRate: cur.answerRate,
      answerRateDelta: pctDelta(cur.answerRate, prior.answerRate),
    }
  }, [callsInRange, callsPrior])

  const volume = useMemo(() => dailyCallVolume(callsInRange), [callsInRange])
  const heatmap = useMemo(() => callHeatmap(callsInRange), [callsInRange])
  const outcomes = useMemo(() => callOutcomeBreakdown(callsInRange), [callsInRange])
  const departments = useMemo(() => departmentLeaderboard(callsInRange), [callsInRange])

  if (loading) {
    return <div className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>Loading call activity&hellip;</div>
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatTile label="Total calls" value={formatNumber(kpis.total)} delta={kpis.totalDelta} sublabel="vs prior period" {...tile('all')} />
        <StatTile label="Inbound" value={formatNumber(kpis.inbound)} delta={kpis.inboundDelta} sublabel="vs prior period" {...tile('inbound')} />
        <StatTile label="Outbound" value={formatNumber(kpis.outbound)} delta={kpis.outboundDelta} sublabel="vs prior period" {...tile('outbound')} />
        <StatTile label="Answer rate" value={formatPercent(kpis.answerRate)} delta={kpis.answerRateDelta} sublabel="vs prior period" {...tile('connected')} />
        <StatTile
          label="Avg duration"
          value={formatDuration(kpis.avgDuration)}
          delta={kpis.avgDurationDelta}
          deltaGoodDirection="down"
          sublabel="vs prior period"
        />
      </div>

      <ChartCard title="Call volume trend" subtitle="Inbound vs outbound, daily">
        <VolumeAreaChart data={volume} height={280} />
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Call outcomes" subtitle="All calls in range, by result. Click a bar to list its callers.">
          <HorizontalBarChart
            data={outcomes.map((o) => ({ name: o.result, value: o.count }))}
            colors={outcomes.map((o) => OUTCOME_COLORS[o.result] ?? 'var(--series-7)')}
            height={Math.max(220, outcomes.length * 28)}
            onSelect={(result) => showCallers(metricForResult(result))}
            selected={resultForMetric(metric)}
          />
        </ChartCard>
        <ChartCard title="Calls by department" subtitle="Full breakdown, ranked by volume">
          <HorizontalBarChart data={departments.map((d) => ({ name: d.department, value: d.total }))} color="var(--series-1)" />
        </ChartCard>
      </div>

      <div ref={callersRef} className="scroll-mt-4">
        <CallerBreakdown calls={callsInRange} metric={metric} onMetricChange={setMetric} />
      </div>

      <ChartCard title="When calls happen" subtitle="Call volume by day of week and hour (business hours)">
        <Heatmap rows={heatmap.rows} hours={heatmap.hours} days={heatmap.days} />
      </ChartCard>
    </div>
  )
}
