'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from 'recharts'
import type { Dict } from '@/messages/nl'
import { KWARTIER_BAKKEN, type TegendoelpuntTelling } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'
import ChartDataTable from './ChartDataTable'
import { GRID_STROKE, AXIS_LINE, AXIS_TICK_LINE, AXIS_TICK } from './chartTheme'

// Gegroepeerd (niet gestapeld) kolomdiagram: standaardsituatie naast open spel
// per kwartier. De legenda is HTML (geen recharts-Legend: die zet een hex-
// default in de DOM). Identiteit staat nooit alleen in kleur: legendatekst,
// LabelList, de regel per soort en de datatabel dragen dezelfde informatie.
export default function TegendoelpuntenChart({ telling, fout, t }: { telling: TegendoelpuntTelling; fout: boolean; t: Dict }) {
  const i = t.insights
  const soortLabel = t.analysis.tegendoelpuntSoorten
  const data = KWARTIER_BAKKEN.map((bak) => ({
    bak,
    standaard: telling.perBak[bak].set_piece,
    open: telling.perBak[bak].open_play,
  }))
  const reeks = data
    .map((d) => `${d.bak.replace('-', '–')}: ${d.standaard + d.open}`)
    .join(', ')
  const summary = i.tegenSummary.replace('{reeks}', reeks)

  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (telling.totaal === 0) empty = <InsightEmpty icon="sports_soccer" text={i.tegenEmpty} />

  return (
    <InsightCard title={i.tegenTitle} description={i.tegenDescription} empty={empty}>
      <div className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-muted">
          <li className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-[3px]" style={{ background: 'var(--panel-blue-fg)' }} aria-hidden="true" />
            {soortLabel.set_piece}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-[3px]" style={{ background: 'var(--chip-red-fg)' }} aria-hidden="true" />
            {soortLabel.open_play}
          </li>
        </ul>
        <div role="img" aria-label={summary} className="overflow-x-auto">
          <BarChart width={336} height={200} data={data}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} className="chart-grid" />
            <XAxis dataKey="bak" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_TICK_LINE} className="chart-axis" interval={0} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_TICK_LINE} className="chart-axis" />
            <Bar dataKey="standaard" name={soortLabel.set_piece} fill="var(--panel-blue-fg)" className="chart-fill-blue" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="standaard" position="top" fill="var(--faint)" className="chart-axis" fontSize={10} />
            </Bar>
            <Bar dataKey="open" name={soortLabel.open_play} fill="var(--chip-red-fg)" className="chart-fill-red" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="open" position="top" fill="var(--faint)" className="chart-axis" fontSize={10} />
            </Bar>
          </BarChart>
        </div>
        <ChartDataTable
          caption={summary}
          headers={[i.minutenKolom, soortLabel.set_piece, soortLabel.open_play, i.totaalLabel]}
          rows={data.map((d) => [d.bak, d.standaard, d.open, d.standaard + d.open])}
        />
        <div className="flex flex-col gap-1 text-xs font-semibold text-faint">
          <p>
            {i.tegenPerSoort
              .replace('{standaard}', String(telling.perSoort.set_piece))
              .replace('{open}', String(telling.perSoort.open_play))}
          </p>
          <p>{i.tegenDekking.replace('{x}', String(telling.metMinuut)).replace('{y}', String(telling.totaal))}</p>
        </div>
      </div>
    </InsightCard>
  )
}
