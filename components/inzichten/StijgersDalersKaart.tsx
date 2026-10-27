import type { Dict } from '@/messages/nl'
import { RATING_TREND_DREMPEL, RATING_TREND_VENSTER, STIJGER_MIN_BEOORDELINGEN } from '@/lib/inzichten'
import type { StijgersDalers, StijgerRegel } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'

// Verschil met teken ("+0.4" / "−0.3"), punt-notatie zoals TopWorstRatings.
function verschilTekst(v: number): string {
  const abs = Math.abs(v).toFixed(1)
  return v > 0 ? `+${abs}` : v < 0 ? `−${abs}` : abs
}

function Lijst({ titel, rows, t }: { titel: string; rows: StijgerRegel[]; t: Dict }) {
  const i = t.insights
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-bold text-muted">{titel}</h3>
      {rows.length === 0 ? (
        <p className="text-sm font-semibold text-faint">{i.stijgersNiemand}</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.player_id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink font-semibold min-w-0 leading-snug">{r.naam}</span>
              {/* Neutrale inkt: een daling is geen alarm (W4) en statuskleuren zijn gereserveerd. */}
              <span className="text-faint font-semibold text-right tabular-nums">
                {i.stijgersWaarde
                  .replace('{verschil}', verschilTekst(r.verschil))
                  .replace('{recent}', r.recent_gemiddelde.toFixed(1))
                  .replace('{seizoen}', r.seizoen_gemiddelde.toFixed(1))
                  .replace('{aantal}', String(r.aantal))}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// Stijgers en dalers: recent gemiddelde tegenover het seizoensgemiddelde.
// Altijd het hele seizoen (W5), ongeacht de periodekiezer.
export default function StijgersDalersKaart({ data, fout, t }: { data: StijgersDalers; fout: boolean; t: Dict }) {
  const i = t.insights
  const min = String(STIJGER_MIN_BEOORDELINGEN)
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (data.meegeteld === 0) empty = <InsightEmpty icon="emoji_events" text={i.stijgersTeWeinig.replace('{min}', min)} />
  else if (data.stijgers.length === 0 && data.dalers.length === 0) {
    empty = <InsightEmpty icon="emoji_events" text={i.stijgersEmpty.replace('{drempel}', RATING_TREND_DREMPEL.toFixed(1))} />
  }

  return (
    <InsightCard
      title={i.stijgersTitle}
      description={i.stijgersDescription.replace('{n}', String(RATING_TREND_VENSTER)).replace('{min}', min)}
      empty={empty}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Lijst titel={i.stijgersLabel} rows={data.stijgers} t={t} />
        <Lijst titel={i.dalersLabel} rows={data.dalers} t={t} />
      </div>
    </InsightCard>
  )
}
