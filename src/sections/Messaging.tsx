import { useMemo } from 'react'
import { useFilteredData } from '../state/useFilteredData'
import { StatTile } from '../components/ui/StatTile'
import { ChartCard } from '../components/ui/ChartCard'
import { VolumeAreaChart } from '../components/charts/VolumeAreaChart'
import { HorizontalBarChart } from '../components/charts/HorizontalBarChart'
import { pctDelta, smsByDepartment, smsDailyVolume, smsKpis } from '../lib/metrics'
import { formatNumber, formatPercent } from '../lib/format'

export function Messaging() {
  const { smsInRange, smsPrior, loading } = useFilteredData()

  const kpis = useMemo(() => {
    const cur = smsKpis(smsInRange)
    const prior = smsKpis(smsPrior)
    return {
      total: cur.total,
      totalDelta: pctDelta(cur.total, prior.total),
      inbound: cur.inbound,
      inboundDelta: pctDelta(cur.inbound, prior.inbound),
      outbound: cur.outbound,
      outboundDelta: pctDelta(cur.outbound, prior.outbound),
      deliveryRate: cur.deliveryRate,
      deliveryRateDelta: pctDelta(cur.deliveryRate, prior.deliveryRate),
    }
  }, [smsInRange, smsPrior])

  const volume = useMemo(() => smsDailyVolume(smsInRange), [smsInRange])
  const byDept = useMemo(() => smsByDepartment(smsInRange), [smsInRange])

  if (loading) {
    return <div className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>Loading messaging data&hellip;</div>
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Total messages" value={formatNumber(kpis.total)} delta={kpis.totalDelta} sublabel="vs prior period" />
        <StatTile label="Inbound" value={formatNumber(kpis.inbound)} delta={kpis.inboundDelta} sublabel="vs prior period" />
        <StatTile label="Outbound" value={formatNumber(kpis.outbound)} delta={kpis.outboundDelta} sublabel="vs prior period" />
        <StatTile label="Delivery rate" value={formatPercent(kpis.deliveryRate, 1)} delta={kpis.deliveryRateDelta} sublabel="vs prior period" />
      </div>

      <ChartCard title="SMS volume trend" subtitle="Inbound vs outbound, daily">
        <VolumeAreaChart data={volume} height={280} />
      </ChartCard>

      <ChartCard title="Messages by department" subtitle="Total volume across the selected range">
        <HorizontalBarChart data={byDept.map((d) => ({ name: d.department, value: d.count }))} color="var(--series-5)" />
      </ChartCard>
    </div>
  )
}
