import { useMemo } from 'react'
import type { CallRecord } from '../types'
import { ChartCard } from './ui/ChartCard'
import { HorizontalBarChart } from './charts/HorizontalBarChart'
import { callOutcomeBreakdown, faxKpis } from '../lib/metrics'
import { formatNumber } from '../lib/format'

const FAX_COLORS: Record<string, string> = {
  Sent: 'var(--series-3)',
  Received: 'var(--series-1)',
}

/** Faxes sit in RingCentral's call log next to phone calls; they are reported here and nowhere else. */
export function FaxActivityCard({ fax, className }: { fax: CallRecord[]; className?: string }) {
  const kpis = useMemo(() => faxKpis(fax), [fax])
  const outcomes = useMemo(() => callOutcomeBreakdown(fax), [fax])
  const subtitle =
    kpis.total === 0
      ? 'No faxes in this date range'
      : `${formatNumber(kpis.sent)} sent, ${formatNumber(kpis.received)} received, ${formatNumber(kpis.failed)} failed. Not counted as calls.`

  return (
    <ChartCard title="Fax activity" subtitle={subtitle} className={className}>
      {kpis.total === 0 ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
          Nothing to show.
        </div>
      ) : (
        <HorizontalBarChart
          data={outcomes.map((o) => ({ name: o.result, value: o.count }))}
          colors={outcomes.map((o) => FAX_COLORS[o.result] ?? 'var(--status-critical)')}
          height={Math.max(140, outcomes.length * 34)}
        />
      )}
    </ChartCard>
  )
}
