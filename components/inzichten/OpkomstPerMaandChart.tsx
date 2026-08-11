'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { Dict } from '@/messages/nl'
import type { MaandOpkomst } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'
import ChartDataTable from './ChartDataTable'
import { GRID_STROKE, AXIS_LINE, AXIS_TICK_LINE, AXIS_TICK } from './chartTheme'

// Zelfde tijdzone-veilige aanpak als lib/season-dates.ts: 'YYYY-MM' gaat via
// Date.UTC naar een leesbaar maandlabel. timeZone:'UTC' is VERPLICHT bij het
// formatteren, anders kan de browser-tijdzone van de bezoeker de getoonde
// maand laten verschuiven (bv. eind/begin van de maand rond middernacht UTC).
function maandLabel(maand: string, locale: string): string {
  const [jaar, maandNr] = maand.split('-').map(Number)
  const ms = Date.UTC(jaar, maandNr - 1, 1)
  const label = new Date(ms).toLocaleDateString(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

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
            <BarChart width={Math.max(280, chartData.length * 64)} height={220} data={chartData}>
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
              <Bar dataKey="percentage" fill="var(--primary)" className="chart-fill-primary" radius={[4, 4, 0, 0]} isAnimationActive={false} />
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
