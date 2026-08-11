'use client'

import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { Dict } from '@/messages/nl'
import type { TeamRatingRij, SpelerOptie, SpelerRatingPunt } from '@/lib/inzichten'
import { getSpelerRatingReeks } from '@/app/actions/inzichten'
import { formatDateShort } from '@/lib/utils'
import InsightCard, { InsightEmpty } from './InsightCard'
import ChartDataTable from './ChartDataTable'
import { GRID_STROKE, AXIS_LINE, AXIS_TICK_LINE, AXIS_TICK } from './chartTheme'

// Rond op 1 decimaal — de RPC levert een float8-gemiddelde.
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// Gedeeld tussen de teamgrafiek en de individuele-spelergrafiek hieronder —
// zelfde assen/grid/lijnstijl, alleen de data en dataKey verschillen.
function RatingLine({ data, dataKey, height }: { data: { datum: string }[]; dataKey: string; height: number }) {
  return (
    <LineChart width={Math.max(280, data.length * 60)} height={height} data={data}>
      <CartesianGrid vertical={false} stroke={GRID_STROKE} className="chart-grid" />
      <XAxis dataKey="datum" tick={{ ...AXIS_TICK, fontSize: 10 }} axisLine={AXIS_LINE} tickLine={AXIS_TICK_LINE} className="chart-axis" />
      <YAxis domain={[1, 10]} allowDecimals={false} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_TICK_LINE} className="chart-axis" />
      <Line
        type="monotone"
        dataKey={dataKey}
        stroke="var(--primary)"
        className="chart-stroke-primary"
        strokeWidth={2}
        dot={{ fill: 'var(--surface)', stroke: 'var(--primary)', r: 3 }}
        isAnimationActive={false}
      />
    </LineChart>
  )
}

export default function RatingsChart({
  teamData,
  spelers,
  t,
}: {
  teamData: TeamRatingRij[]
  spelers: SpelerOptie[]
  t: Dict
}) {
  const [playerId, setPlayerId] = useState('')
  const [reeks, setReeks] = useState<SpelerRatingPunt[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  async function onSelectPlayer(id: string) {
    setPlayerId(id)
    setReeks(null)
    setError(false)
    if (!id) return
    setLoading(true)
    try {
      // getSpelerRatingReeks() gooit bij een ongeldig/vreemd speler-id of een
      // DB-probleem (app/actions/inzichten.ts) — een lege array is een
      // geldige uitkomst en geen fout, dus die valt hier NIET in de catch.
      const data = await getSpelerRatingReeks(id)
      setReeks(data)
    } catch {
      // Nooit de ruwe foutmelding tonen — alleen de generieke tekst.
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  const isEmpty = teamData.length === 0

  const teamSummary = t.insights.ratingsSummary.replace('{n}', String(teamData.length))
  const teamChartData = teamData.map((r) => ({
    datum: formatDateShort(r.datum, t.browserLocale),
    team: round1(r.gemiddelde),
  }))

  const spelerSummary = reeks !== null ? t.insights.spelerSummary.replace('{n}', String(reeks.length)) : ''
  const spelerChartData = (reeks ?? []).map((r) => ({
    datum: formatDateShort(r.datum, t.browserLocale),
    rating: r.rating,
  }))

  return (
    <InsightCard
      title={t.insights.ratingsTitle}
      description={t.insights.ratingsDescription}
      empty={isEmpty ? <InsightEmpty icon="emoji_events" text={t.insights.ratingsEmpty} /> : undefined}
    >
      {!isEmpty && (
        <div className="flex flex-col gap-4">
          {/* role="img" impliceert "children presentational: true" (WAI-ARIA) —
              AT negeert alles eronder en leest alleen aria-label. De sr-only
              ChartDataTable staat daarom BUITEN deze wrapper (sibling), net als
              VormChart.tsx, zodat schermlezers de volledige cijfers wél bereiken. */}
          <div role="img" aria-label={teamSummary} className="overflow-x-auto">
            <RatingLine data={teamChartData} dataKey="team" height={190} />
          </div>
          <ChartDataTable
            caption={teamSummary}
            headers={[t.insights.matchLabel, t.insights.ratingLabel]}
            rows={teamData.map((r) => [formatDateShort(r.datum, t.browserLocale), round1(r.gemiddelde)])}
          />

          {spelers.length > 0 && (
            <div className="flex flex-col gap-2">
              <label htmlFor="ratings-speler-select" className="text-xs font-bold text-muted">
                {t.insights.spelerSelectLabel}
              </label>
              <select
                id="ratings-speler-select"
                value={playerId}
                onChange={(e) => onSelectPlayer(e.target.value)}
                className="h-10 rounded-lg px-3 text-sm font-semibold text-ink"
                style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-soft)' }}
              >
                <option value="">{t.insights.spelerSelectPlaceholder}</option>
                {spelers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              {loading && <p className="text-xs font-semibold text-faint" role="status">{t.insights.spelerLoading}</p>}
              {error && <p className="text-xs font-semibold" style={{ color: 'var(--chip-red-fg)' }} role="alert">{t.insights.spelerError}</p>}
              {!loading && !error && playerId && reeks !== null && (
                reeks.length === 0 ? (
                  <InsightEmpty text={t.insights.spelerEmpty} />
                ) : (
                  <>
                    <div role="img" aria-label={spelerSummary} className="overflow-x-auto">
                      <RatingLine data={spelerChartData} dataKey="rating" height={170} />
                    </div>
                    <ChartDataTable
                      caption={spelerSummary}
                      headers={[t.insights.matchLabel, t.insights.ratingLabel]}
                      rows={(reeks ?? []).map((r) => [formatDateShort(r.datum, t.browserLocale), r.rating])}
                    />
                  </>
                )
              )}
            </div>
          )}
        </div>
      )}
    </InsightCard>
  )
}
