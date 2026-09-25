import { useMemo, useState } from 'react'
import { useFilteredData } from '../state/useFilteredData'
import { ChartCard } from '../components/ui/ChartCard'
import { HorizontalBarChart } from '../components/charts/HorizontalBarChart'
import { agentLeaderboard, departmentLeaderboard } from '../lib/metrics'
import { formatDuration, formatNumber, formatPercent } from '../lib/format'

type SortKey = 'total' | 'answerRate' | 'avgDuration'

export function TeamPerformance() {
  const { callsInRange, loading } = useFilteredData()
  const [sortKey, setSortKey] = useState<SortKey>('total')

  const agents = useMemo(() => agentLeaderboard(callsInRange), [callsInRange])
  const departments = useMemo(() => departmentLeaderboard(callsInRange), [callsInRange])

  const sortedAgents = useMemo(() => [...agents].sort((a, b) => b[sortKey] - a[sortKey]), [agents, sortKey])

  if (loading) {
    return <div className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>Loading team performance&hellip;</div>
  }

  const columns: { key: SortKey; label: string }[] = [
    { key: 'total', label: 'Calls handled' },
    { key: 'answerRate', label: 'Answer rate' },
    { key: 'avgDuration', label: 'Avg duration' },
  ]

  return (
    <div className="flex flex-col gap-5">
      <ChartCard title="Call volume by department" subtitle="Ranked by total calls in the selected range">
        <HorizontalBarChart data={departments.map((d) => ({ name: d.department, value: d.total }))} color="var(--series-1)" />
      </ChartCard>

      <ChartCard title="Agent leaderboard" subtitle="Click a column to sort">
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm border-collapse min-w-[560px]">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="text-left font-medium px-2 py-2" style={{ color: 'var(--text-muted)' }}>
                  Agent
                </th>
                <th className="text-left font-medium px-2 py-2" style={{ color: 'var(--text-muted)' }}>
                  Department
                </th>
                {columns.map((c) => (
                  <th key={c.key} className="text-right font-medium px-2 py-2">
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
              {sortedAgents.map((a) => (
                <tr key={a.extensionName} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="px-2 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {a.extensionName}
                  </td>
                  <td className="px-2 py-2" style={{ color: 'var(--text-secondary)' }}>
                    {a.department}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {formatNumber(a.total)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {formatPercent(a.answerRate)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {formatDuration(a.avgDuration)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  )
}
