'use client'

import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts'
import type { Dict } from '@/messages/nl'
import { OPKOMST_DOEL, maandLabel, type MaandOpkomst } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'
import ChartDataTable from './ChartDataTable'
import { GRID_STROKE, AXIS_LINE, AXIS_TICK_LINE, AXIS_TICK } from './chartTheme'

export default function OpkomstPerMaandChart({ data, t }: { data: MaandOpkomst[]; t: Dict }) {
  const isEmpty = data.length === 0

  const metPercentage = data.filter((d): d is MaandOpkomst & { percentage: number } => d.percentage !== null)
  const gemiddeld = metPercentage.length > 0
    ? Math.round(metPercentage.reduce((sum, d) => sum + d.percentage, 0) / metPercentage.length)
    : null

  const summary = t.insights.opkomstSummary
    .replace('{n}', String(data.length))
    .replace('{gem}', gemiddeld !== null ? `${gemiddeld}%` : '—')

  const chartData = data.map((d) => ({
    maand: maandLabel(d.maand, t.browserLocale),
    // Recharts slaat een null-waarde over (geen staaf), wat hier precies
    // klopt: percentage null betekent geen data voor die maand, geen 0%.
    percentage: d.percentage,
  }))

  return (
    <InsightCard
      title={t.insights.opkomstTitle}
      description={t.insights.opkomstDescription}
      empty={isEmpty ? <InsightEmpty icon="calendar_month" text={t.insights.opkomstEmpty} /> : undefined}
    >
      {!isEmpty && (
        // role="img" impliceert "children presentational: true" (WAI-ARIA) — AT
        // negeert alles eronder en leest alleen aria-label. De sr-only
        // ChartDataTable staat daarom BUITEN deze wrapper (sibling), net als
        // VormChart.tsx, zodat schermlezers de volledige cijfers wél bereiken.
        <>
          <div role="img" aria-label={summary} className="overflow-x-auto">
            <BarChart width={Math.max(280, chartData.length * 64) + 70} height={220} data={chartData} margin={{ top: 8, right: 70, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} className="chart-grid" />
              <XAxis dataKey="maand" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_TICK_LINE} className="chart-axis" />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                allowDecimals={false}
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={AXIS_TICK_LINE}
                className="chart-axis"
              />
              {/* Normlijn op OPKOMST_DOEL. Dit is wat een percentage in een
                  oordeel verandert: zonder referentie is 78% een getal, met
                  referentie is het "onder de norm". */}
              <ReferenceLine
                y={OPKOMST_DOEL}
                stroke="var(--brand-accent)"
                strokeDasharray="5 4"
                strokeWidth={1.5}
                className="chart-stroke-primary"
                label={{
                  value: t.insights.kpiOpkomstDoel.replace('{doel}', String(OPKOMST_DOEL)),
                  // Buiten het plotvlak, in de rechtermarge hierboven: elke
                  // `inside*`-positie legt dit label over de staaf van de
                  // laatste maand heen.
                  position: 'right',
                  fill: 'var(--brand-accent)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              />
              {/* Maanden onder de norm krijgen de waarschuwingskleur in plaats
                  van het gewone groen. Per staaf via <Cell>, want één `fill` op
                  de <Bar> geldt voor alle staven. Kleuren als var(...)-string,
                  nooit als hex — zie chartTheme.ts. */}
              <Bar dataKey="percentage" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {chartData.map((d) => (
                  <Cell
                    key={d.maand}
                    className={d.percentage !== null && d.percentage < OPKOMST_DOEL ? 'chart-fill-amber' : 'chart-fill-primary'}
                    fill={d.percentage !== null && d.percentage < OPKOMST_DOEL ? 'var(--chip-amber-fg)' : 'var(--brand-accent)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </div>
          <ChartDataTable
            caption={summary}
            headers={[t.insights.monthLabel, t.insights.percentageLabel]}
            rows={data.map((d) => [maandLabel(d.maand, t.browserLocale), d.percentage !== null ? `${d.percentage}%` : '—'])}
          />
        </>
      )}
    </InsightCard>
  )
}
