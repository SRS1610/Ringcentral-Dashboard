import { useMemo, useRef, useState } from 'react'
import { useData } from '../state/DataContext'
import { useFilteredData } from '../state/useFilteredData'
import { StatTile } from '../components/ui/StatTile'
import { ChartCard } from '../components/ui/ChartCard'
import { VolumeAreaChart } from '../components/charts/VolumeAreaChart'
import { HorizontalBarChart } from '../components/charts/HorizontalBarChart'
import { Heatmap } from '../components/charts/Heatmap'
import { CallerBreakdown } from '../components/CallerBreakdown'
import { FaxActivityCard } from '../components/FaxActivityCard'
import { GroupVolumeCard } from '../components/GroupVolumeCard'
import { callHeatmap, callKpis, callOutcomeBreakdown, dailyCallVolume, metricForResult, pctDelta, resultForMetric, type CallMetricKey } from '../lib/metrics'
import { compareLabel, formatDuration, formatNumber, formatPercent } from '../lib/format'
import { outcomeColor } from '../lib/outcomeColors'
import { timeZoneAbbreviation } from '../lib/timezone'

export function CallActivity() {
  const { calls } = useData()
  const { callsInRange, callsPrior, faxInRange, timeZone, loading } = useFilteredData()
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
      ...cur,
      totalDelta: pctDelta(cur.total, prior.total),
      inboundDelta: pctDelta(cur.inbound, prior.inbound),
      outboundDelta: pctDelta(cur.outbound, prior.outbound),
      inboundAnswerDelta: prior.inbound > 0 ? pctDelta(cur.inboundAnswerRate, prior.inboundAnswerRate) : null,
      outboundConnectDelta: prior.outbound > 0 ? pctDelta(cur.outboundConnectRate, prior.outboundConnectRate) : null,
      avgDurationDelta: pctDelta(cur.avgDuration, prior.avgDuration),
    }
  }, [callsInRange, callsPrior])

  const volume = useMemo(() => dailyCallVolume(callsInRange, timeZone), [callsInRange, timeZone])
  const heatmap = useMemo(() => callHeatmap(callsInRange, timeZone), [callsInRange, timeZone])
  const outcomes = useMemo(() => callOutcomeBreakdown(callsInRange), [callsInRange])

  if (loading) {
    return <div className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>Loading call activity&hellip;</div>
  }

  const compare = compareLabel(callsPrior.length > 0)
  const hasFax = calls.records.some((r) => r.kind === 'fax')
  const zone = timeZoneAbbreviation(timeZone, callsInRange[0]?.startTime)

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Total calls" value={formatNumber(kpis.total)} delta={kpis.totalDelta} sublabel={compare} {...tile('all')} />
        <StatTile label="Inbound" value={formatNumber(kpis.inbound)} delta={kpis.inboundDelta} sublabel={compare} {...tile('inbound')} />
        <StatTile label="Outbound" value={formatNumber(kpis.outbound)} delta={kpis.outboundDelta} sublabel={compare} {...tile('outbound')} />
        <StatTile
          label="Inbound answered"
          value={kpis.inbound > 0 ? formatPercent(kpis.inboundAnswerRate) : '—'}
          delta={kpis.inboundAnswerDelta}
          sublabel={kpis.inbound > 0 ? `${formatNumber(kpis.inboundAnswered)} of ${formatNumber(kpis.inbound)} inbound` : 'No inbound calls'}
          onClick={() => showCallers('missed')}
          actionLabel="Show the callers who were missed"
        />
        <StatTile
          label="Outbound connected"
          value={kpis.outbound > 0 ? formatPercent(kpis.outboundConnectRate) : '—'}
          delta={kpis.outboundConnectDelta}
          sublabel={kpis.outbound > 0 ? `${formatNumber(kpis.outboundConnected)} of ${formatNumber(kpis.outbound)} outbound` : 'No outbound calls'}
          {...tile('connected')}
        />
        <StatTile label="Avg duration" value={formatDuration(kpis.avgDuration)} delta={kpis.avgDurationDelta} deltaGoodDirection="down" sublabel={compare} />
      </div>

      <ChartCard title="Call volume trend" subtitle="Inbound vs outbound, daily">
        <VolumeAreaChart data={volume} height={280} />
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Call outcomes" subtitle="Phone calls in range, by result. Click a bar to list its callers.">
          <HorizontalBarChart
            data={outcomes.map((o) => ({ name: o.result, value: o.count }))}
            colors={outcomes.map((o) => outcomeColor(o.result))}
            height={Math.max(220, outcomes.length * 28)}
            onSelect={(result) => showCallers(metricForResult(result))}
            selected={resultForMetric(metric)}
          />
        </ChartCard>
        <GroupVolumeCard records={callsInRange} noun="calls" />
      </div>

      <div ref={callersRef} className="scroll-mt-4">
        <CallerBreakdown calls={callsInRange} metric={metric} onMetricChange={setMetric} timeZone={timeZone} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="When calls happen" subtitle={`Calls by day of week and hour, ${zone} time`} className={hasFax ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <Heatmap rows={heatmap.rows} hours={heatmap.hours} days={heatmap.days} outside={heatmap.outside} />
        </ChartCard>
        {hasFax && <FaxActivityCard fax={faxInRange} />}
      </div>
    </div>
  )
}
