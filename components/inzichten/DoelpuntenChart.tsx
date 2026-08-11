'use client'

import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from 'recharts'
import type { Dict } from '@/messages/nl'
import type { DoelpuntItem, DoelpuntFilter } from '@/lib/inzichten'
import { filterDoelpunten } from '@/lib/inzichten'
import { formatDateShort } from '@/lib/utils'
import InsightCard, { InsightEmpty } from './InsightCard'
import ChartDataTable from './ChartDataTable'
import { GRID_STROKE, AXIS_LINE, AXIS_TICK_LINE, AXIS_TICK } from './chartTheme'

// Vaste, gevalideerde filterwaarden — filterDoelpunten() geeft [] terug bij
// een onbekende waarde (lib/inzichten.ts), dus alleen deze vier komen ooit in
// aanmerking. 'all' is en blijft de default.
const FILTERS: DoelpuntFilter[] = ['all', 'league', 'friendly', 'cup']

function itemLabel(item: Pick<DoelpuntItem, 'date' | 'opponent'>, locale: string): string {
  return item.opponent ? `${formatDateShort(item.date, locale)} · ${item.opponent}` : formatDateShort(item.date, locale)
}

export default function DoelpuntenChart({ items, t }: { items: DoelpuntItem[]; t: Dict }) {
  const [filter, setFilter] = useState<DoelpuntFilter>('all')
  const gefilterd = filterDoelpunten(items, filter)

  const filterLabel = (f: DoelpuntFilter): string => (f === 'all' ? t.insights.filterAll : t.event.matchTypes[f])

  const chartData = gefilterd.map((item) => ({
    id: item.id,
    label: itemLabel(item, t.browserLocale),
    voor: item.goals_for ?? 0,
    tegen: item.goals_against ?? 0,
  }))

  const summary = t.insights.doelpuntenSummary
    .replace('{n}', String(gefilterd.length))
    .replace('{filter}', filterLabel(filter))

  return (
    <InsightCard
      title={t.insights.doelpuntenTitle}
      description={t.insights.doelpuntenDescription}
      empty={items.length === 0 ? <InsightEmpty icon="sports_soccer" text={t.insights.doelpuntenEmpty} /> : undefined}
    >
      {items.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.insights.filterLabel}>
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${filter === f ? 'text-white' : 'text-muted'}`}
                style={
                  filter === f
                    ? { background: 'var(--primary)' }
                    : { background: 'var(--surface-sunken)', border: '1px solid var(--border-soft)' }
                }
              >
                {filterLabel(f)}
              </button>
            ))}
          </div>

          {gefilterd.length === 0 ? (
            <InsightEmpty icon="sports_soccer" text={t.insights.doelpuntenFilterEmpty} />
          ) : (
            // role="img" impliceert "children presentational: true" (WAI-ARIA) —
            // AT negeert alles eronder en leest alleen aria-label. De sr-only
            // ChartDataTable staat daarom BUITEN deze wrapper (sibling), net als
            // VormChart.tsx, zodat schermlezers de volledige cijfers wél bereiken.
            <>
              <div role="img" aria-label={summary} className="overflow-x-auto">
                <BarChart width={Math.max(320, chartData.length * 76)} height={230} data={chartData}>
                  <CartesianGrid vertical={false} stroke={GRID_STROKE} className="chart-grid" />
                  <XAxis
                    dataKey="label"
                    tick={{ ...AXIS_TICK, fontSize: 10 }}
                    axisLine={AXIS_LINE}
                    tickLine={AXIS_TICK_LINE}
                    className="chart-axis"
                    interval={0}
                    angle={-25}
                    textAnchor="end"
                    height={54}
                  />
                  <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_TICK_LINE} className="chart-axis" />
                  <Bar dataKey="voor" name={t.insights.doelpuntenVoor} fill="var(--chip-green-fg)" className="chart-fill-green" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    <LabelList dataKey="voor" position="top" fill="var(--faint)" className="chart-axis" fontSize={10} />
                  </Bar>
                  <Bar dataKey="tegen" name={t.insights.doelpuntenTegen} fill="var(--chip-red-fg)" className="chart-fill-red" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    <LabelList dataKey="tegen" position="top" fill="var(--faint)" className="chart-axis" fontSize={10} />
                  </Bar>
                </BarChart>
              </div>
              <ChartDataTable
                caption={summary}
                headers={[t.insights.matchLabel, t.insights.doelpuntenVoor, t.insights.doelpuntenTegen]}
                rows={gefilterd.map((item) => [itemLabel(item, t.browserLocale), item.goals_for ?? 0, item.goals_against ?? 0])}
              />
            </>
          )}
        </div>
      )}
    </InsightCard>
  )
}
