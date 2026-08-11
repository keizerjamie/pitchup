import type { Dict } from '@/messages/nl'
import type { AanwezigheidPerSpeler, TopWorst } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'

// Spelers die zowel in `top` als in `worst` staan — bij een kleine selectie
// (minder dan 2x TOP_WORST_AANTAL spelers) is dat bedoeld gedrag van
// topWorstAanwezigheid() (lib/inzichten.ts), geen bug. Alleen gebruikt voor
// een subtiele toelichting, niet om iets te filteren.
function overlapIds(top: AanwezigheidPerSpeler[], worst: AanwezigheidPerSpeler[]): Set<string> {
  const topIds = new Set(top.map((r) => r.player_id))
  return new Set(worst.filter((r) => topIds.has(r.player_id)).map((r) => r.player_id))
}

function AanwezigheidLijst({ titel, rows, t }: { titel: string; rows: AanwezigheidPerSpeler[]; t: Dict }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-bold text-muted">{titel}</h3>
      <ol className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.player_id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink font-semibold truncate">{r.naam}</span>
            <span className="text-faint font-semibold whitespace-nowrap">
              {t.insights.topWorstAanwezigheidWaarde
                .replace('{percentage}', String(r.percentage))
                .replace('{aanwezig}', String(r.aanwezig))
                .replace('{totaal}', String(r.aanwezig + r.afwezig))}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// Top 5 / worst 5 op aanwezigheidspercentage. Geen grafiek: naam + cijfer is
// gewone leesbare tekst (semantische <ol>), dus geen recharts, geen
// role="img" en geen aparte ChartDataTable nodig — dit ís al toegankelijk.
export default function TopWorstAanwezigheid({ data, t }: { data: TopWorst<AanwezigheidPerSpeler>; t: Dict }) {
  const isEmpty = data.top.length === 0 && data.worst.length === 0
  const overlap = overlapIds(data.top, data.worst)

  return (
    <InsightCard
      title={t.insights.topWorstAanwezigheidTitle}
      description={t.insights.topWorstAanwezigheidDescription}
      empty={isEmpty ? <InsightEmpty icon="groups" text={t.insights.topWorstAanwezigheidEmpty} /> : undefined}
    >
      {!isEmpty && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <AanwezigheidLijst titel={t.insights.bestLabel} rows={data.top} t={t} />
            <AanwezigheidLijst titel={t.insights.worstLabel} rows={data.worst} t={t} />
          </div>
          {overlap.size > 0 && (
            <p className="text-xs font-semibold text-faint">{t.insights.topWorstOverlapHint}</p>
          )}
        </div>
      )}
    </InsightCard>
  )
}
