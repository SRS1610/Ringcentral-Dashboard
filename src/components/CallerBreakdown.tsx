import { useMemo, useState } from 'react'
import type { CallRecord } from '../types'
import { ChartCard } from './ui/ChartCard'
import { callMetricLabel, callerBreakdown, callsForMetric, type CallMetricKey } from '../lib/metrics'
import { formatDuration, formatNumber } from '../lib/format'

const PRESETS: CallMetricKey[] = ['all', 'inbound', 'outbound', 'connected', 'missed', 'voicemail']
const PAGE_SIZE = 25

const formatWhen = (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

interface CallerBreakdownProps {
  calls: CallRecord[]
  metric: CallMetricKey
  onMetricChange: (metric: CallMetricKey) => void
}

/** Lists the outside parties behind one call metric: who called in, or who was called. */
export function CallerBreakdown({ calls, metric, onMetricChange }: CallerBreakdownProps) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)

  const matching = useMemo(() => callsForMetric(calls, metric), [calls, metric])
  const callers = useMemo(() => callerBreakdown(matching), [matching])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return callers
    const digits = q.replace(/\D/g, '')
    return callers.filter(
      (c) => c.name.toLowerCase().includes(q) || (digits.length > 0 && c.number.replace(/\D/g, '').includes(digits)) || c.staff.some((s) => s.toLowerCase().includes(q)),
    )
  }, [callers, query])
  const visible = showAll ? filtered : filtered.slice(0, PAGE_SIZE)

  const chips: CallMetricKey[] = PRESETS.includes(metric) ? PRESETS : [...PRESETS, metric]
  const label = callMetricLabel(metric)
  const subtitle = `${formatNumber(matching.length)} ${matching.length === 1 ? 'call' : 'calls'} from or to ${formatNumber(callers.length)} outside ${callers.length === 1 ? 'number' : 'numbers'}`

  return (
    <ChartCard title={`Callers behind: ${label}`} subtitle={subtitle}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Metric">
            {chips.map((key) => {
              const active = key === metric
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    onMetricChange(key)
                    setShowAll(false)
                  }}
                  className="text-xs font-medium rounded-full px-3 py-1.5 border"
                  style={{
                    borderColor: active ? 'var(--series-1)' : 'var(--border)',
                    background: active ? 'var(--series-1)' : 'transparent',
                    color: active ? '#ffffff' : 'var(--text-secondary)',
                  }}
                >
                  {callMetricLabel(key)}
                </button>
              )
            })}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setShowAll(false)
            }}
            placeholder="Search name, number or team member"
            aria-label="Search callers"
            className="text-sm rounded-lg border px-3 py-1.5 sm:ml-auto w-full sm:w-64"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)' }}
          />
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
            {callers.length === 0 ? `No ${label.toLowerCase()} calls in this date range.` : 'No callers match that search.'}
          </p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm border-collapse min-w-[720px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th className="text-left font-medium px-2 py-2">Caller</th>
                  <th className="text-left font-medium px-2 py-2">Number</th>
                  <th className="text-right font-medium px-2 py-2">Calls</th>
                  <th className="text-right font-medium px-2 py-2">In / out</th>
                  <th className="text-right font-medium px-2 py-2">Total time</th>
                  <th className="text-left font-medium px-2 py-2">Last call</th>
                  <th className="text-left font-medium px-2 py-2">Team member</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.key} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                    <td className="px-2 py-2 font-medium" style={{ color: c.name ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {c.name || 'No caller ID name'}
                    </td>
                    <td className="px-2 py-2 tabular-nums whitespace-nowrap">{c.number || '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatNumber(c.total)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                      {formatNumber(c.inbound)} / {formatNumber(c.outbound)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{formatDuration(c.talkSeconds)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{formatWhen(c.lastCall)}</td>
                    <td className="px-2 py-2">
                      {c.staff.length === 0 ? '—' : c.staff.slice(0, 2).join(', ')}
                      {c.staff.length > 2 && <span style={{ color: 'var(--text-muted)' }}> +{c.staff.length - 2}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > PAGE_SIZE && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-sm font-medium self-start" style={{ color: 'var(--series-1)' }}>
            {showAll ? `Show top ${PAGE_SIZE}` : `Show all ${formatNumber(filtered.length)}`}
          </button>
        )}
      </div>
    </ChartCard>
  )
}
