import { useMemo, useState } from 'react'
import { useFilteredData } from '../state/useFilteredData'
import { StatTile } from '../components/ui/StatTile'
import { ChartCard } from '../components/ui/ChartCard'
import { ChartLegend } from '../components/charts/ChartLegend'
import { TimeTrendChart } from '../components/charts/TimeTrendChart'
import { HorizontalBarChart } from '../components/charts/HorizontalBarChart'
import { hasDepartments, pctDelta, performanceByUser, performanceDailyTrend, performanceKpis, type PerformanceUserRow } from '../lib/metrics'
import { compareLabel, formatDuration, formatNumber, formatPercent } from '../lib/format'

/** Short waits read better as "14s" than "0m 14s". */
const formatWait = (seconds: number) => (seconds < 60 ? `${Math.round(seconds)}s` : formatDuration(seconds))

type SortKey = 'calls' | 'inbound' | 'answered' | 'notAnswered' | 'answerRate' | 'outbound' | 'connectRate' | 'talkSec' | 'avgTalkSec' | 'avgRingSec' | 'holdSec' | 'afterHours'

const COLUMNS: { key: SortKey; label: string; format: (row: PerformanceUserRow) => string }[] = [
  { key: 'calls', label: 'Calls', format: (r) => formatNumber(r.calls) },
  { key: 'inbound', label: 'Inbound', format: (r) => formatNumber(r.inbound) },
  { key: 'answered', label: 'Answered', format: (r) => formatNumber(r.answered) },
  { key: 'notAnswered', label: 'Not answered', format: (r) => formatNumber(r.notAnswered) },
  { key: 'answerRate', label: 'Answer rate', format: (r) => (r.answered + r.notAnswered > 0 ? formatPercent(r.answerRate) : '—') },
  { key: 'outbound', label: 'Outbound', format: (r) => formatNumber(r.outbound) },
  { key: 'connectRate', label: 'Connect rate', format: (r) => (r.connected + r.notConnected > 0 ? formatPercent(r.connectRate) : '—') },
  { key: 'talkSec', label: 'Talk time', format: (r) => formatDuration(r.talkSec) },
  { key: 'avgTalkSec', label: 'Avg talk', format: (r) => (r.answered + r.connected > 0 ? formatDuration(r.avgTalkSec) : '—') },
  { key: 'avgRingSec', label: 'Avg ring', format: (r) => formatWait(r.avgRingSec) },
  { key: 'holdSec', label: 'Hold time', format: (r) => formatDuration(r.holdSec) },
  { key: 'afterHours', label: 'After hours', format: (r) => formatNumber(r.afterHours) },
]

/**
 * The Analytics Portal's Performance Report: how each person's calls were answered and how
 * long each part of them took. This is the service picture for an account whose calls go
 * straight to people's extensions rather than through queues.
 */
export function PerformanceReport() {
  const { perfInRange, perfPrior } = useFilteredData()
  const [sortKey, setSortKey] = useState<SortKey>('calls')

  const cur = useMemo(() => performanceKpis(perfInRange), [perfInRange])
  const prior = useMemo(() => performanceKpis(perfPrior), [perfPrior])
  const users = useMemo(() => performanceByUser(perfInRange), [perfInRange])
  const trend = useMemo(() => performanceDailyTrend(perfInRange), [perfInRange])
  const showDepartments = useMemo(() => hasDepartments(perfInRange), [perfInRange])
  const sorted = useMemo(() => [...users].sort((a, b) => b[sortKey] - a[sortKey] || b.calls - a.calls), [users, sortKey])

  const hasPrior = perfPrior.length > 0
  const compare = compareLabel(hasPrior)
  const inbound = cur.answered + cur.notAnswered
  const outbound = cur.connected + cur.notConnected
  const priorInbound = prior.answered + prior.notAnswered
  const priorOutbound = prior.connected + prior.notConnected
  const delta = (now: number, before: number) => (hasPrior ? pctDelta(now, before) : undefined)

  if (perfInRange.length === 0) {
    return (
      <ChartCard title="Performance report" subtitle="From RingCentral Analytics">
        <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
          RingCentral Analytics has no calls for this date range.
        </p>
      </ChartCard>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile
          label="Inbound answered"
          value={inbound > 0 ? formatPercent(cur.answerRate) : '—'}
          delta={priorInbound > 0 ? delta(cur.answerRate, prior.answerRate) : undefined}
          sublabel={inbound > 0 ? `${formatNumber(cur.answered)} of ${formatNumber(inbound)} inbound` : 'No inbound calls'}
        />
        <StatTile
          label="Not answered"
          value={formatNumber(cur.notAnswered)}
          delta={delta(cur.notAnswered, prior.notAnswered)}
          deltaGoodDirection="down"
          sublabel={`${formatNumber(cur.missed)} missed, ${formatNumber(cur.voicemail)} to voicemail`}
        />
        <StatTile
          label="Outbound connected"
          value={outbound > 0 ? formatPercent(cur.connectRate) : '—'}
          delta={priorOutbound > 0 ? delta(cur.connectRate, prior.connectRate) : undefined}
          sublabel={outbound > 0 ? `${formatNumber(cur.connected)} of ${formatNumber(outbound)} outbound` : 'No outbound calls'}
        />
        <StatTile label="Avg talk time" value={formatDuration(cur.avgTalkSec)} delta={delta(cur.avgTalkSec, prior.avgTalkSec)} sublabel={compare} />
        <StatTile
          label="Avg ring time"
          value={formatWait(cur.avgRingSec)}
          delta={delta(cur.avgRingSec, prior.avgRingSec)}
          deltaGoodDirection="down"
          sublabel={compare}
        />
        <StatTile
          label="After hours"
          value={cur.businessHours + cur.afterHours > 0 ? formatPercent(cur.afterHoursShare) : '—'}
          delta={delta(cur.afterHours, prior.afterHours)}
          deltaGoodDirection="down"
          sublabel={`${formatNumber(cur.afterHours)} calls outside business hours`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard
          title="Inbound calls answered"
          subtitle="Answered and not answered, daily"
          className="lg:col-span-2"
          action={
            <ChartLegend
              items={[
                { label: 'Answered', color: 'var(--status-good)' },
                { label: 'Not answered', color: 'var(--status-critical)' },
              ]}
            />
          }
        >
          <TimeTrendChart
            data={trend}
            series={[
              { key: 'answered', label: 'Answered', color: 'var(--status-good)' },
              { key: 'notAnswered', label: 'Not answered', color: 'var(--status-critical)' },
            ]}
            valueFormatter={(v) => formatNumber(v)}
            allowDecimals={false}
          />
        </ChartCard>
        <ChartCard title="Time on calls" subtitle="Total across the range, by part of the call">
          <HorizontalBarChart
            data={[
              { name: 'Talking', value: cur.talkSec },
              { name: 'Ringing', value: cur.ringSec },
              { name: 'On hold', value: cur.holdSec },
            ]}
            colors={['var(--series-1)', 'var(--series-4)', 'var(--series-2)']}
            valueFormatter={formatDuration}
            height={170}
          />
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            {formatNumber(cur.holds)} {cur.holds === 1 ? 'call' : 'calls'} put on hold, {formatNumber(cur.transfers)} transferred.
          </p>
        </ChartCard>
      </div>

      <ChartCard
        title="Performance by user"
        subtitle="From RingCentral Analytics. A call that involved two people counts for both. Click a column to rank by it."
      >
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm border-collapse min-w-[1080px]">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="text-left font-medium px-2 py-2" style={{ color: 'var(--text-muted)' }}>
                  User
                </th>
                {showDepartments && (
                  <th className="text-left font-medium px-2 py-2" style={{ color: 'var(--text-muted)' }}>
                    Department
                  </th>
                )}
                {COLUMNS.map((c) => (
                  <th key={c.key} className="text-right font-medium px-2 py-2 whitespace-nowrap" aria-sort={sortKey === c.key ? 'descending' : undefined}>
                    <button type="button" onClick={() => setSortKey(c.key)} style={{ color: sortKey === c.key ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {c.label} {sortKey === c.key && <span aria-hidden="true">&darr;</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => (
                <tr key={u.key} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="px-2 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                    {u.extensionName}
                    {u.extension && (
                      <span className="font-normal tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {' '}
                        · ext {u.extension}
                      </span>
                    )}
                  </td>
                  {showDepartments && (
                    <td className="px-2 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {u.department}
                    </td>
                  )}
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="px-2 py-2 text-right tabular-nums whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {c.format(u)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
          RingCentral Analytics and the call log are separate systems, so totals here can differ a little from the other tabs. Business hours are
          the company hours set in RingCentral.
        </p>
      </ChartCard>
    </div>
  )
}
