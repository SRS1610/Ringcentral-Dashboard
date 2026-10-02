import { useMemo, useState } from 'react'
import { useFilteredData } from '../state/useFilteredData'
import { ChartCard } from '../components/ui/ChartCard'
import { HorizontalBarChart } from '../components/charts/HorizontalBarChart'
import { agentLeaderboard, departmentLeaderboard, type AgentLeaderboardRow } from '../lib/metrics'
import { formatDuration, formatNumber, formatPercent } from '../lib/format'

type SortKey = 'total' | 'inbound' | 'outbound' | 'connected' | 'missed' | 'voicemail' | 'answerRate' | 'avgDuration' | 'talkSeconds'

const COLUMNS: { key: SortKey; label: string; format: (row: AgentLeaderboardRow) => string }[] = [
  { key: 'total', label: 'Calls', format: (r) => formatNumber(r.total) },
  { key: 'inbound', label: 'Inbound', format: (r) => formatNumber(r.inbound) },
  { key: 'outbound', label: 'Outbound', format: (r) => formatNumber(r.outbound) },
  { key: 'connected', label: 'Connected', format: (r) => formatNumber(r.connected) },
  { key: 'missed', label: 'Missed', format: (r) => formatNumber(r.missed) },
  { key: 'voicemail', label: 'Voicemail', format: (r) => formatNumber(r.voicemail) },
  { key: 'answerRate', label: 'Answer rate', format: (r) => formatPercent(r.answerRate) },
  { key: 'avgDuration', label: 'Avg duration', format: (r) => formatDuration(r.avgDuration) },
  { key: 'talkSeconds', label: 'Talk time', format: (r) => formatDuration(r.talkSeconds) },
]

export function TeamPerformance() {
  const { callsInRange, loading } = useFilteredData()
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [staffOnly, setStaffOnly] = useState(true)

  const agents = useMemo(() => agentLeaderboard(callsInRange), [callsInRange])
  const departments = useMemo(() => departmentLeaderboard(callsInRange), [callsInRange])

  const staff = useMemo(() => agents.filter((a) => a.isStaff), [agents])
  const otherCalls = useMemo(() => agents.filter((a) => !a.isStaff).reduce((sum, a) => sum + a.total, 0), [agents])
  const rows = staffOnly ? staff : agents
  const sorted = useMemo(() => [...rows].sort((a, b) => b[sortKey] - a[sortKey] || b.total - a.total), [rows, sortKey])

  if (loading) {
    return <div className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>Loading team performance&hellip;</div>
  }

  const toggle = (
    <div className="flex rounded-lg border overflow-hidden shrink-0" style={{ borderColor: 'var(--border)' }} role="group" aria-label="Rows to show">
      {[
        { value: true, label: 'Team members' },
        { value: false, label: 'All lines' },
      ].map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={staffOnly === option.value}
          onClick={() => setStaffOnly(option.value)}
          className="text-xs font-medium px-3 py-1.5"
          style={{
            background: staffOnly === option.value ? 'var(--series-1)' : 'transparent',
            color: staffOnly === option.value ? '#ffffff' : 'var(--text-secondary)',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      <ChartCard title="Call volume by department" subtitle="Ranked by total calls in the selected range">
        <HorizontalBarChart data={departments.map((d) => ({ name: d.department, value: d.total }))} color="var(--series-1)" />
      </ChartCard>

      <ChartCard title="Agent leaderboard" subtitle="Each metric per team member. Click a column to rank by it." action={toggle}>
        {sorted.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
            {agents.length === 0 ? 'No calls in this date range.' : 'No calls in this range are tied to a team member. Switch to All lines to see them.'}
          </p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm border-collapse min-w-[980px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th className="text-left font-medium px-2 py-2" style={{ color: 'var(--text-muted)' }}>
                    Agent
                  </th>
                  <th className="text-left font-medium px-2 py-2" style={{ color: 'var(--text-muted)' }}>
                    Department
                  </th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="text-right font-medium px-2 py-2 whitespace-nowrap" aria-sort={sortKey === c.key ? 'descending' : undefined}>
                      <button
                        type="button"
                        onClick={() => setSortKey(c.key)}
                        className="tabular-nums"
                        style={{ color: sortKey === c.key ? 'var(--text-primary)' : 'var(--text-muted)' }}
                      >
                        {c.label} {sortKey === c.key && <span aria-hidden="true">&darr;</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((a) => (
                  <tr key={a.extensionName} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-2 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                      {a.extensionName}
                      {a.extension && (
                        <span className="font-normal tabular-nums" style={{ color: 'var(--text-muted)' }}>
                          {' '}
                          · ext {a.extension}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2" style={{ color: 'var(--text-secondary)' }}>
                      {a.department}
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="px-2 py-2 text-right tabular-nums whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {c.format(a)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {staffOnly && otherCalls > 0 && (
          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            {formatNumber(otherCalls)} {otherCalls === 1 ? 'call is' : 'calls are'} not tied to a team member (main line, queues, or calls nobody picked up). Switch to All lines to
            see them.
          </p>
        )}
      </ChartCard>
    </div>
  )
}
