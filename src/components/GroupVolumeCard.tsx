import { useMemo } from 'react'
import { ChartCard } from './ui/ChartCard'
import { HorizontalBarChart } from './charts/HorizontalBarChart'
import { volumeByGroup } from '../lib/metrics'

interface GroupVolumeCardProps {
  records: { department: string; extensionName: string }[]
  /** What is being counted, lower case plural: "calls", "messages". */
  noun: string
  /** Show only the busiest N rows. */
  limit?: number
  color?: string
  className?: string
}

/**
 * Volume by department when departments are set up (in RingCentral or in Settings).
 * Without them every record would land in one "Unassigned" bar, so the card ranks
 * team members and shared lines instead.
 */
export function GroupVolumeCard({ records, noun, limit, color = 'var(--series-1)', className }: GroupVolumeCardProps) {
  const { by, rows } = useMemo(() => volumeByGroup(records), [records])
  const shown = limit ? rows.slice(0, limit) : rows
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1)
  const ranked = limit && rows.length > limit ? `Top ${limit} of ${rows.length}` : 'All'
  const title = by === 'department' ? `${Noun} by department` : `${Noun} by team member`
  const subtitle = by === 'department' ? `${ranked} departments, ranked by ${noun}` : `${ranked} team members and lines, ranked by ${noun}. Add departments in Settings to group them.`

  return (
    <ChartCard title={title} subtitle={subtitle} className={className}>
      {shown.length === 0 ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
          No {noun} in this date range.
        </div>
      ) : (
        <HorizontalBarChart data={shown} color={color} />
      )}
    </ChartCard>
  )
}
