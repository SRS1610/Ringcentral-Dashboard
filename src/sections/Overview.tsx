import { useMemo } from 'react'
import { useData } from '../state/DataContext'
import { useFilteredData } from '../state/useFilteredData'
import { StatTile } from '../components/ui/StatTile'
import { ChartCard } from '../components/ui/ChartCard'
import { VolumeAreaChart } from '../components/charts/VolumeAreaChart'
import { ServiceLevelChart } from '../components/charts/ServiceLevelChart'
import { HorizontalBarChart } from '../components/charts/HorizontalBarChart'
import { FaxActivityCard } from '../components/FaxActivityCard'
import { GroupVolumeCard } from '../components/GroupVolumeCard'
import { callKpis, callOutcomeBreakdown, dailyCallVolume, faxKpis, pctDelta, qosDailyTrend, qosKpis, smsKpis } from '../lib/metrics'
import { compareLabel, formatCompact, formatDuration, formatNumber, formatPercent } from '../lib/format'
import { outcomeColor } from '../lib/outcomeColors'

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
  const { callsInRange, faxInRange, qosInRange, smsInRange, callsPrior, faxPrior, qosPrior, smsPrior, timeZone, loading } = useFilteredData()

  const kpis = useMemo(() => {
    const cur = callKpis(callsInRange)
    const prior = callKpis(callsPrior)
    const qosCur = qosKpis(qosInRange)
    const qosPriorK = qosKpis(qosPrior)
    const smsCur = smsKpis(smsInRange)
    const smsPriorK = smsKpis(smsPrior)
    const fax = faxKpis(faxInRange)
    return {
      calls: cur,
      fax,
      totalCallsDelta: pctDelta(cur.total, prior.total),
      inboundAnswerDelta: prior.inbound > 0 ? pctDelta(cur.inboundAnswerRate, prior.inboundAnswerRate) : null,
      outboundConnectDelta: prior.outbound > 0 ? pctDelta(cur.outboundConnectRate, prior.outboundConnectRate) : null,
      avgDurationDelta: pctDelta(cur.avgDuration, prior.avgDuration),
      faxDelta: pctDelta(fax.total, faxPrior.length),
      serviceLevel: qosCur.avgServiceLevel,
      serviceLevelDelta: pctDelta(qosCur.avgServiceLevel, qosPriorK.avgServiceLevel),
      abandonRate: qosCur.abandonRate,
      abandonRateDelta: pctDelta(qosCur.abandonRate, qosPriorK.abandonRate),
      totalSms: smsCur.total,
      totalSmsDelta: pctDelta(smsCur.total, smsPriorK.total),
    }
  }, [callsInRange, callsPrior, faxInRange, faxPrior, qosInRange, qosPrior, smsInRange, smsPrior])

  const volume = useMemo(() => dailyCallVolume(callsInRange, timeZone), [callsInRange, timeZone])
  const serviceTrend = useMemo(() => qosDailyTrend(qosInRange), [qosInRange])
  const outcomes = useMemo(() => callOutcomeBreakdown(callsInRange), [callsInRange])

  if (loading) {
    return <div className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>Loading dashboard data&hellip;</div>
  }

  // Period-over-period figures need the earlier period to be loaded; say so when it isn't.
  const callsCompare = compareLabel(callsPrior.length > 0)
  const { calls: c, fax } = kpis
  // Faxes share RingCentral's call log. They get their own tile whenever the account has any.
  const hasFax = calls.records.some((r) => r.kind === 'fax')
  // Service level and abandon rate only exist for call queues, so they appear only once queue data is loaded.
  const tileCount = 5 + (hasQos ? 2 : 0) + (hasFax ? 1 : 0)
  const tileGrid = tileCount > 6 ? 'grid grid-cols-2 sm:grid-cols-4 gap-3' : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3'

  return (
    <div className="flex flex-col gap-5">
      <div className={tileGrid}>
        <StatTile
          label="Total calls"
          value={hasCalls ? formatNumber(c.total) : '—'}
          delta={hasCalls ? kpis.totalCallsDelta : undefined}
          sublabel={hasCalls ? callsCompare : 'No call data'}
        />
        <StatTile
          label="Inbound answered"
          value={hasCalls && c.inbound > 0 ? formatPercent(c.inboundAnswerRate) : '—'}
          delta={hasCalls ? kpis.inboundAnswerDelta : undefined}
          sublabel={hasCalls ? (c.inbound > 0 ? `${formatNumber(c.inboundAnswered)} of ${formatNumber(c.inbound)} inbound` : 'No inbound calls') : 'No call data'}
        />
        <StatTile
          label="Outbound connected"
          value={hasCalls && c.outbound > 0 ? formatPercent(c.outboundConnectRate) : '—'}
          delta={hasCalls ? kpis.outboundConnectDelta : undefined}
          sublabel={hasCalls ? (c.outbound > 0 ? `${formatNumber(c.outboundConnected)} of ${formatNumber(c.outbound)} outbound` : 'No outbound calls') : 'No call data'}
        />
        <StatTile
          label="Avg call duration"
          value={hasCalls ? formatDuration(c.avgDuration) : '—'}
          delta={hasCalls ? kpis.avgDurationDelta : undefined}
          deltaGoodDirection="down"
          sublabel={hasCalls ? callsCompare : 'No call data'}
        />
        {hasQos && (
          <>
            <StatTile label="Service level" value={formatPercent(kpis.serviceLevel)} delta={kpis.serviceLevelDelta} sublabel="target 85%" />
            <StatTile
              label="Abandon rate"
              value={formatPercent(kpis.abandonRate, 1)}
              delta={kpis.abandonRateDelta}
              deltaGoodDirection="down"
              sublabel={compareLabel(qosPrior.length > 0)}
            />
          </>
        )}
        {hasFax && (
          <StatTile
            label="Faxes"
            value={formatNumber(fax.total)}
            delta={kpis.faxDelta}
            sublabel={`${formatNumber(fax.sent)} sent, ${formatNumber(fax.received)} received`}
          />
        )}
        <StatTile
          label="SMS volume"
          value={hasSms ? formatCompact(kpis.totalSms) : '—'}
          delta={hasSms ? kpis.totalSmsDelta : undefined}
          sublabel={hasSms ? compareLabel(smsPrior.length > 0) : 'No SMS data'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Call volume trend" subtitle="Inbound vs outbound, daily" className="lg:col-span-2">
          {hasCalls ? <VolumeAreaChart data={volume} /> : <NoDataNote>No call data loaded yet.</NoDataNote>}
        </ChartCard>
        <ChartCard title="Call outcomes" subtitle="Phone calls in range, by result">
          {hasCalls ? (
            <HorizontalBarChart
              data={outcomes.map((o) => ({ name: o.result, value: o.count }))}
              colors={outcomes.map((o) => outcomeColor(o.result))}
              height={Math.max(220, outcomes.length * 28)}
            />
          ) : (
            <NoDataNote>No call data loaded yet.</NoDataNote>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {hasQos ? (
          <>
            <ChartCard title="Service level trend" subtitle="Daily average across all queues" className="lg:col-span-2">
              <ServiceLevelChart data={serviceTrend.map((d) => ({ date: d.date, serviceLevel: d.serviceLevel }))} />
            </ChartCard>
            <GroupVolumeCard records={callsInRange} noun="calls" limit={6} />
          </>
        ) : (
          <>
            <GroupVolumeCard records={callsInRange} noun="calls" limit={8} className={hasFax ? 'lg:col-span-2' : 'lg:col-span-3'} />
            {hasFax && <FaxActivityCard fax={faxInRange} />}
          </>
        )}
      </div>
    </div>
  )
}
