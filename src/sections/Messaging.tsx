import { useMemo } from 'react'
import { useFilteredData } from '../state/useFilteredData'
import { StatTile } from '../components/ui/StatTile'
import { ChartCard } from '../components/ui/ChartCard'
import { VolumeAreaChart } from '../components/charts/VolumeAreaChart'
import { GroupVolumeCard } from '../components/GroupVolumeCard'
import { pctDelta, smsDailyVolume, smsKpis } from '../lib/metrics'
import { compareLabel, formatNumber, formatPercent } from '../lib/format'

export function Messaging() {
  const { smsInRange, smsPrior, timeZone, loading } = useFilteredData()

  const kpis = useMemo(() => {
    const cur = smsKpis(smsInRange)
    const prior = smsKpis(smsPrior)
    return {
      ...cur,
      totalDelta: pctDelta(cur.total, prior.total),
      inboundDelta: pctDelta(cur.inbound, prior.inbound),
      outboundDelta: pctDelta(cur.outbound, prior.outbound),
      deliveryRateDelta: prior.outbound > 0 ? pctDelta(cur.deliveryRate, prior.deliveryRate) : null,
    }
  }, [smsInRange, smsPrior])

  const volume = useMemo(() => smsDailyVolume(smsInRange, timeZone), [smsInRange, timeZone])

  if (loading) {
    return <div className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>Loading messaging data&hellip;</div>
  }

  const compare = compareLabel(smsPrior.length > 0)

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Total messages" value={formatNumber(kpis.total)} delta={kpis.totalDelta} sublabel={compare} />
        <StatTile label="Inbound" value={formatNumber(kpis.inbound)} delta={kpis.inboundDelta} sublabel={compare} />
        <StatTile label="Outbound" value={formatNumber(kpis.outbound)} delta={kpis.outboundDelta} sublabel={compare} />
        <StatTile
          label="Delivery rate"
          value={kpis.outbound > 0 ? formatPercent(kpis.deliveryRate, 1) : '—'}
          delta={kpis.deliveryRateDelta}
          sublabel={kpis.outbound > 0 ? `${formatNumber(kpis.delivered)} of ${formatNumber(kpis.outbound)} sent` : 'No messages sent'}
        />
      </div>

      <ChartCard title="SMS volume trend" subtitle="Inbound vs outbound, daily">
        <VolumeAreaChart data={volume} height={280} />
      </ChartCard>

      <GroupVolumeCard records={smsInRange} noun="messages" color="var(--series-5)" />
    </div>
  )
}
