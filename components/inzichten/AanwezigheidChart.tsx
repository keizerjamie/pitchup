'use client'

import { PieChart, Pie, Cell } from 'recharts'
import type { Dict } from '@/messages/nl'
import InsightCard, { InsightEmpty } from './InsightCard'
import ChartDataTable from './ChartDataTable'

export interface AanwezigheidChartData {
  aanwezig: number
  afwezig: number
  // null = geen data (totaal 0, of de RPC gaf een fout — lib/inzichten.ts:
  // berekenAanwezigheidPercentage). Nooit als 0% renderen.
  percentage: number | null
}

// Donut aanwezig/afwezig met het percentage als tekst in het midden. `data`
// is bewust nullable (exact het contract uit de technische brief): null
// dekt zowel "geen enkele registratie dit seizoen" als "de RPC gaf een fout"
// (de pagina behandelt die twee gevallen identiek — lib/errors.ts).
export default function AanwezigheidChart({ data, t }: { data: AanwezigheidChartData | null; t: Dict }) {
  const isEmpty = !data || data.percentage === null

  if (isEmpty || !data) {
    return (
      <InsightCard
        title={t.insights.aanwezigheidTitle}
        description={t.insights.aanwezigheidDescription}
        empty={<InsightEmpty icon="groups" text={t.insights.aanwezigheidEmpty} />}
      >
        {null}
      </InsightCard>
    )
  }

  const pctText = `${data.percentage}%`
  const summary = t.insights.aanwezigheidSummary
    .replace('{pct}', pctText)
    .replace('{aanwezig}', String(data.aanwezig))
    .replace('{afwezig}', String(data.afwezig))

  return (
    <InsightCard title={t.insights.aanwezigheidTitle} description={t.insights.aanwezigheidDescription}>
      {/* role="img" impliceert "children presentational: true" (WAI-ARIA) —
          AT negeert alles eronder en leest alleen aria-label. De sr-only
          ChartDataTable staat daarom BUITEN deze wrapper (sibling), net als
          DoelpuntenChart.tsx/VormChart.tsx, zodat schermlezers de volledige
          cijfers wél bereiken. */}
      <div className="flex flex-col items-center gap-3">
        <div role="img" aria-label={summary} className="relative w-[170px] h-[170px]">
          <PieChart width={170} height={170}>
            <Pie
              data={[
                { name: t.insights.aanwezigLabel, value: data.aanwezig },
                { name: t.insights.afwezigLabel, value: data.afwezig },
              ]}
              dataKey="value"
              innerRadius={58}
              outerRadius={82}
              startAngle={90}
              endAngle={-270}
              stroke="none"
              isAnimationActive={false}
            >
              {/* fill als expliciete var(...)-prop, niet alleen als className:
                  recharts zet zelf een hex-default (bv. '#8884d8') als
                  SVG-attribuut zodra `fill` niet is meegegeven. Een CSS-klasse
                  wint daar visueel altijd van (SVG-presentatie-attributen
                  hebben de laagste CSS-prioriteit), maar de rauwe hex bleef
                  dan toch in de DOM staan. var(...) is geen hex-waarde. */}
              <Cell className="chart-fill-primary" fill="var(--primary)" />
              <Cell className="chart-fill-track" fill="var(--track)" />
            </Pie>
          </PieChart>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="font-display text-[24px] font-bold text-ink">{pctText}</span>
          </div>
        </div>
        <div className="flex gap-4 text-xs font-semibold text-muted">
          <span>{t.insights.aanwezigLabel}: {data.aanwezig}</span>
          <span>{t.insights.afwezigLabel}: {data.afwezig}</span>
        </div>
        <ChartDataTable
          caption={summary}
          headers={[t.insights.statusLabel, t.insights.countLabel]}
          rows={[
            [t.insights.aanwezigLabel, data.aanwezig],
            [t.insights.afwezigLabel, data.afwezig],
          ]}
        />
      </div>
    </InsightCard>
  )
}
