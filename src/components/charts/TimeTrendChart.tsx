import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatShortDate } from '../../lib/format'
import { makeTooltipFormatter } from './ChartTooltip'

interface Series {
  key: string
  label: string
  color: string
}

interface TimeTrendChartProps {
  data: Record<string, string | number>[]
  series: Series[]
  valueFormatter: (v: number) => string
  height?: number
}

export function TimeTrendChart({ data, series, valueFormatter, height = 260 }: TimeTrendChartProps) {
  const tickFormatter = (v: string) => formatShortDate(new Date(v))
  const Tip = makeTooltipFormatter(
    tickFormatter,
    series.map((s) => ({ ...s, format: valueFormatter })),
  )

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
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(v: number) => valueFormatter(v)}
        />
        <Tooltip content={Tip} cursor={{ stroke: 'var(--baseline)', strokeWidth: 1 }} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
