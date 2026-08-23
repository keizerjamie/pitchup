import type { Dict } from '@/messages/nl'
import type { RatingPerSpelerRij, TopWorst } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'

// Rond op 1 decimaal — zelfde afronding en weergave (punt, geen
// locale-notatie) als de teamrating-grafiek (RatingsChart.tsx), zodat
// eenzelfde gemiddelde overal op de pagina hetzelfde cijfer toont. De
// weergave gebruikt bewust toFixed(1) en niet String(): anders staat een
// gemiddelde van precies 8 als "8" tussen "8.2" en "7.7", wat in een lijstje
// leest als een ander soort getal.
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// Spelers die zowel in `top` als in `worst` staan — bij een kleine selectie
// (minder dan 2x TOP_WORST_AANTAL spelers) is dat bedoeld gedrag van
// topWorstRating() (lib/inzichten.ts), geen bug. Alleen gebruikt voor een
// subtiele toelichting, niet om iets te filteren.
function overlapIds(top: RatingPerSpelerRij[], worst: RatingPerSpelerRij[]): Set<string> {
  const topIds = new Set(top.map((r) => r.player_id))
  return new Set(worst.filter((r) => topIds.has(r.player_id)).map((r) => r.player_id))
}

function RatingLijst({ titel, rows, t }: { titel: string; rows: RatingPerSpelerRij[]; t: Dict }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-bold text-muted">{titel}</h3>
      <ol className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.player_id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink font-semibold truncate">{r.naam}</span>
            <span className="text-faint font-semibold whitespace-nowrap">
              {t.insights.topWorstRatingsWaarde
                .replace('{gemiddelde}', round1(r.gemiddelde).toFixed(1))
                .replace('{aantal}', String(r.aantal))}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// Top 5 / worst 5 op gemiddelde spelerrating. Geen grafiek: naam + cijfer is
// gewone leesbare tekst (semantische <ol>), dus geen recharts, geen
// role="img" en geen aparte ChartDataTable nodig — dit ís al toegankelijk.
export default function TopWorstRatings({ data, t }: { data: TopWorst<RatingPerSpelerRij>; t: Dict }) {
  const isEmpty = data.top.length === 0 && data.worst.length === 0
  const overlap = overlapIds(data.top, data.worst)

  return (
    <InsightCard
      title={t.insights.topWorstRatingsTitle}
      description={t.insights.topWorstRatingsDescription}
      empty={isEmpty ? <InsightEmpty icon="emoji_events" text={t.insights.topWorstRatingsEmpty} /> : undefined}
    >
      {!isEmpty && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <RatingLijst titel={t.insights.bestLabel} rows={data.top} t={t} />
            <RatingLijst titel={t.insights.worstLabel} rows={data.worst} t={t} />
          </div>
          {overlap.size > 0 && (
            <p className="text-xs font-semibold text-faint">{t.insights.topWorstOverlapHint}</p>
          )}
        </div>
      )}
    </InsightCard>
  )
}
