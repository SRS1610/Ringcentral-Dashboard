import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatShortDate } from '../../lib/format'
import { makeTooltipFormatter } from './ChartTooltip'

interface Point {
  date: string
  serviceLevel: number
}

export function ServiceLevelChart({ data, target = 85, height = 260 }: { data: Point[]; target?: number; height?: number }) {
  const tickFormatter = (v: string) => formatShortDate(new Date(v))
  const Tip = makeTooltipFormatter(tickFormatter, [
    { key: 'serviceLevel', label: 'Service level', color: 'var(--series-3)', format: (v) => `${v.toFixed(0)}%` },
  ])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={tickFormatter}
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          axisLine={{ stroke: 'var(--baseline)' }}
          tickLine={false}
          minTickGap={32}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          axisLine={false}
          tickLine={false}
          width={36}
          tickFormatter={(v) => `${v}%`}
        />
        <ReferenceLine y={target} stroke="var(--status-good)" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: `Target ${target}%`, position: 'insideTopRight', fill: 'var(--status-good-text)', fontSize: 11 }} />
        <Tooltip content={Tip} cursor={{ stroke: 'var(--baseline)', strokeWidth: 1 }} />
        <Line type="monotone" dataKey="serviceLevel" stroke="var(--series-3)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
