'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from 'recharts'
import type { Dict } from '@/messages/nl'
import { KWARTIER_BAKKEN, type KwartierTelling } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'
import ChartDataTable from './ChartDataTable'
import { GRID_STROKE, AXIS_LINE, AXIS_TICK_LINE, AXIS_TICK } from './chartTheme'

// Eén reeks: eigen doelpunten per kwartier. Doelpunten zonder minuut staan niet
// als kolom maar in de tekstregel "x van y met minuut" — een kolom "onbekend"
// zou als een echt kwartier worden gelezen.
export default function KwartierChart({ telling, fout, t }: { telling: KwartierTelling; fout: boolean; t: Dict }) {
  const i = t.insights
  const data = KWARTIER_BAKKEN.map((bak) => ({ bak, aantal: telling.perBak[bak] }))
  const reeks = data.map((d) => `${d.bak.replace('-', '–')}: ${d.aantal}`).join(', ')
  const summary = i.kwartierSummary.replace('{reeks}', reeks)

  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (telling.metMinuut === 0) empty = <InsightEmpty icon="sports_soccer" text={i.kwartierEmpty} />

  return (
    <InsightCard title={i.kwartierTitle} description={i.kwartierDescription} empty={empty}>
      <div className="flex flex-col gap-3">
        {/* role="img" maakt kinderen presentational: de ChartDataTable staat
            daarom als sibling NA deze wrapper (zie DoelpuntenChart). */}
        <div role="img" aria-label={summary} className="overflow-x-auto">
          <BarChart width={336} height={200} data={data}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} className="chart-grid" />
            <XAxis dataKey="bak" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_TICK_LINE} className="chart-axis" interval={0} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_TICK_LINE} className="chart-axis" />
            <Bar dataKey="aantal" name={i.countLabel} fill="var(--chip-green-fg)" className="chart-fill-green" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="aantal" position="top" fill="var(--faint)" className="chart-axis" fontSize={10} />
            </Bar>
          </BarChart>
        </div>
        <ChartDataTable
          caption={summary}
          headers={[i.minutenKolom, i.countLabel]}
          rows={data.map((d) => [d.bak, d.aantal])}
        />
        <p className="text-xs font-semibold text-faint">
          {i.kwartierDekking.replace('{x}', String(telling.metMinuut)).replace('{y}', String(telling.totaal))}
        </p>
      </div>
    </InsightCard>
  )
}
