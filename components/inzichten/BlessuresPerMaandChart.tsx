'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from 'recharts'
import type { Dict } from '@/messages/nl'
import { maandLabel } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'
import ChartDataTable from './ChartDataTable'
import { GRID_STROKE, AXIS_LINE, AXIS_TICK_LINE, AXIS_TICK } from './chartTheme'

// Eén reeks: verschillende geblesseerde spelers per maand. Geen alarmkleur en
// geen normlijn — dit is geen oordeel. Een maand zonder gegevens (null) krijgt
// geen staaf maar het label "—", zodat "geen gegevens" en "0" verschillen.
export default function BlessuresPerMaandChart({
  maanden,
  fout,
  t,
}: {
  maanden: { maand: string; geblesseerd: number | null }[]
  fout: boolean
  t: Dict
}) {
  const i = t.insights
  const rijen = maanden.map((m) => ({
    maand: maandLabel(m.maand, t.browserLocale),
    aantal: m.geblesseerd ?? 0,
    label: m.geblesseerd === null ? '—' : String(m.geblesseerd),
    waarde: m.geblesseerd,
  }))
  const reeks = rijen.map((r) => `${r.maand}: ${r.label}`).join(', ')
  const summary = i.blessuresSummary.replace('{reeks}', reeks)

  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (maanden.every((m) => m.geblesseerd === null)) empty = <InsightEmpty icon="calendar_month" text={i.blessuresEmpty} />

  return (
    <InsightCard title={i.blessuresTitle} description={i.blessuresDescription} empty={empty}>
      {/* role="img" maakt kinderen presentational: ChartDataTable staat als sibling NA de wrapper. */}
      <>
        <div role="img" aria-label={summary} className="overflow-x-auto">
          <BarChart width={Math.max(280, rijen.length * 64) + 20} height={200} data={rijen} margin={{ top: 16, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} className="chart-grid" />
            <XAxis dataKey="maand" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_TICK_LINE} className="chart-axis" interval={0} />
            <YAxis domain={[0, (max: number) => Math.max(max, 1)]} allowDecimals={false} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_TICK_LINE} className="chart-axis" />
            <Bar dataKey="aantal" name={i.kolomGeblesseerd} fill="var(--brand-accent)" className="chart-fill-primary" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="label" position="top" fill="var(--faint)" className="chart-axis" fontSize={10} />
            </Bar>
          </BarChart>
        </div>
        <ChartDataTable
          caption={summary}
          headers={[i.monthLabel, i.kolomGeblesseerd]}
          rows={rijen.map((r) => [r.maand, r.waarde === null ? i.geenGegevens : r.waarde])}
        />
      </>
    </InsightCard>
  )
}
