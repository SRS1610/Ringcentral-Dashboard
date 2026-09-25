import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatShortDate } from '../../lib/format'
import { makeTooltipFormatter } from './ChartTooltip'

interface Point {
  date: string
  inbound: number
  outbound: number
}

export function VolumeAreaChart({ data, height = 260 }: { data: Point[]; height?: number }) {
  const tickFormatter = (v: string) => formatShortDate(new Date(v))
  const Tip = makeTooltipFormatter(tickFormatter, [
    { key: 'inbound', label: 'Inbound', color: 'var(--series-1)', format: (v) => v.toLocaleString() },
    { key: 'outbound', label: 'Outbound', color: 'var(--series-2)', format: (v) => v.toLocaleString() },
  ])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fillInbound" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--series-1)" stopOpacity={0.28} />
            <stop offset="95%" stopColor="var(--series-1)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="fillOutbound" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--series-2)" stopOpacity={0.28} />
            <stop offset="95%" stopColor="var(--series-2)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={tickFormatter}
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          axisLine={{ stroke: 'var(--baseline)' }}
          tickLine={false}
          minTickGap={32}
        />
        <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={40} />
        <Tooltip content={Tip} cursor={{ stroke: 'var(--baseline)', strokeWidth: 1 }} />
        <Area type="monotone" dataKey="outbound" stackId="1" stroke="var(--series-2)" strokeWidth={2} fill="url(#fillOutbound)" />
        <Area type="monotone" dataKey="inbound" stackId="1" stroke="var(--series-1)" strokeWidth={2} fill="url(#fillInbound)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}
