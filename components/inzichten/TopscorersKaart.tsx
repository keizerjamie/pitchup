import type { Dict } from '@/messages/nl'
import type { Topscorers } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'

// Doelpunten, assists en betrokkenheid per speler (gasten doen mee, met label).
// Gewone <ol>, geen grafiek — leesbare tekst is al toegankelijk.
export default function TopscorersKaart({ data, fout, t }: { data: Topscorers; fout: boolean; t: Dict }) {
  const i = t.insights
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (data.doelpunten === 0) empty = <InsightEmpty icon="emoji_events" text={i.topscorersEmpty} />

  return (
    <InsightCard title={i.topscorersTitle} description={i.topscorersDescription} empty={empty}>
      <div className="flex flex-col gap-3">
        <ol className="flex flex-col gap-1.5">
          {data.spelers.map((s) => (
            <li key={s.player_id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink font-semibold min-w-0 leading-snug">
                {s.naam}
                {s.gast && (
                  <span className="ml-2 text-[11px] font-bold text-faint rounded-full px-2 py-0.5 bg-surface-sunken">{i.gastLabel}</span>
                )}
              </span>
              <span className="text-faint font-semibold text-right tabular-nums">
                {i.topscorersWaarde
                  .replace('{doelpunten}', String(s.doelpunten))
                  .replace('{assists}', String(s.assists))
                  .replace('{betrokken}', String(s.betrokken))}
              </span>
            </li>
          ))}
        </ol>
        {data.assistPercentage !== null && (
          <p className="text-xs font-semibold text-faint">{i.assistPercentage.replace('{pct}', String(data.assistPercentage))}</p>
        )}
      </div>
    </InsightCard>
  )
}
