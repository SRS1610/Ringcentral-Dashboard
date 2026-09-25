import { useMemo } from 'react'
import { useFilteredData } from '../state/useFilteredData'
import { StatTile } from '../components/ui/StatTile'
import { ChartCard } from '../components/ui/ChartCard'
import { ServiceLevelChart } from '../components/charts/ServiceLevelChart'
import { TimeTrendChart } from '../components/charts/TimeTrendChart'
import { ChartLegend } from '../components/charts/ChartLegend'
import { HorizontalBarChart } from '../components/charts/HorizontalBarChart'
import { StatusBadge } from '../components/ui/Badge'
import { pctDelta, qosByQueue, qosDailyTrend, qosKpis } from '../lib/metrics'
import { formatNumber, formatPercent } from '../lib/format'

const TARGET_SL = 85

function slStatus(sl: number): 'good' | 'warning' | 'critical' {
  if (sl >= TARGET_SL) return 'good'
  if (sl >= TARGET_SL - 15) return 'warning'
  return 'critical'
}

export function ServiceQuality() {
  const { qosInRange, qosPrior, loading } = useFilteredData()

  const kpis = useMemo(() => {
    const cur = qosKpis(qosInRange)
    const prior = qosKpis(qosPrior)
    return {
      offered: cur.offered,
      offeredDelta: pctDelta(cur.offered, prior.offered),
      serviceLevel: cur.avgServiceLevel,
      serviceLevelDelta: pctDelta(cur.avgServiceLevel, prior.avgServiceLevel),
      abandonRate: cur.abandonRate,
      abandonRateDelta: pctDelta(cur.abandonRate, prior.abandonRate),
      avgHandleTime: cur.avgHandleTime,
      avgHandleTimeDelta: pctDelta(cur.avgHandleTime, prior.avgHandleTime),
      avgSpeedAnswer: cur.avgSpeedAnswer,
      avgSpeedAnswerDelta: pctDelta(cur.avgSpeedAnswer, prior.avgSpeedAnswer),
    }
  }, [qosInRange, qosPrior])

  const trend = useMemo(() => qosDailyTrend(qosInRange), [qosInRange])
  const byQueue = useMemo(() => qosByQueue(qosInRange), [qosInRange])

  if (loading) {
    return <div className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>Loading service quality data&hellip;</div>
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatTile label="Calls offered" value={formatNumber(kpis.offered)} delta={kpis.offeredDelta} sublabel="vs prior period" />
        <StatTile label="Service level" value={formatPercent(kpis.serviceLevel)} delta={kpis.serviceLevelDelta} sublabel="target 85%" />
        <StatTile
          label="Abandon rate"
          value={formatPercent(kpis.abandonRate, 1)}
          delta={kpis.abandonRateDelta}
          deltaGoodDirection="down"
          sublabel="vs prior period"
        />
        <StatTile
          label="Avg speed of answer"
          value={`${Math.round(kpis.avgSpeedAnswer)}s`}
          delta={kpis.avgSpeedAnswerDelta}
          deltaGoodDirection="down"
          sublabel="vs prior period"
        />
        <StatTile
          label="Avg handle time"
          value={`${Math.round(kpis.avgHandleTime / 60)}m ${Math.round(kpis.avgHandleTime % 60)}s`}
          delta={kpis.avgHandleTimeDelta}
          deltaGoodDirection="down"
          sublabel="vs prior period"
        />
      </div>

      <ChartCard title="Service level trend" subtitle="Daily average across all queues, vs 85% target">
        <ServiceLevelChart data={trend.map((d) => ({ date: d.date, serviceLevel: d.serviceLevel }))} target={TARGET_SL} height={280} />
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Handle time & speed of answer"
          subtitle="Daily average, seconds"
          action={
            <ChartLegend
              items={[
                { label: 'Avg handle time', color: 'var(--series-1)' },
                { label: 'Avg speed of answer', color: 'var(--series-2)' },
              ]}
            />
          }
        >
          <TimeTrendChart
            data={trend.map((d) => ({ date: d.date, handleTime: Math.round(d.handleTime), speedAnswer: Math.round(d.speedAnswer) }))}
            series={[
              { key: 'handleTime', label: 'Avg handle time', color: 'var(--series-1)' },
              { key: 'speedAnswer', label: 'Avg speed of answer', color: 'var(--series-2)' },
            ]}
            valueFormatter={(v) => `${Math.round(v)}s`}
          />
        </ChartCard>

        <ChartCard title="Service level by queue" subtitle="Average over the selected range">
          <div className="flex flex-col gap-2">
            {byQueue.map((q) => (
              <div key={q.queue} className="flex items-center justify-between gap-3 py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {q.queue}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {formatNumber(q.offered)} offered
                  </span>
                  <StatusBadge status={slStatus(q.avgServiceLevel)} label={formatPercent(q.avgServiceLevel)} />
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <ChartCard title="Calls offered by queue" subtitle="Total volume across the selected range">
        <HorizontalBarChart data={byQueue.map((q) => ({ name: q.queue, value: q.offered }))} color="var(--series-3)" />
      </ChartCard>
    </div>
  )
}
