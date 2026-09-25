import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { TooltipShell } from './ChartTooltip'

export interface HBarDatum {
  label: string
  value: string
  color: string
}

interface HorizontalBarChartProps {
  data: { name: string; value: number }[]
  color?: string
  colors?: string[]
  valueFormatter?: (v: number) => string
  height?: number
}

export function HorizontalBarChart({ data, color = 'var(--series-1)', colors, valueFormatter, height }: HorizontalBarChartProps) {
  const fmt = valueFormatter ?? ((v: number) => v.toLocaleString())
  const chartHeight = height ?? Math.max(140, data.length * 34)

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }} barCategoryGap={10}>
        <CartesianGrid stroke="var(--gridline)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={132}
          tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null
            const p = payload[0]
            const name = String(p.payload.name)
            const val = typeof p.value === 'number' ? p.value : Number(p.value)
            return <TooltipShell title={name} rows={[{ label: 'Value', value: fmt(val), color: colors ? String(p.payload.fill) : color }]} />
          }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20}>
          {data.map((d, i) => (
            <Cell key={d.name} fill={colors ? colors[i % colors.length] : color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
