import type { Dict } from '@/messages/nl'
import type { SpelerMomentenRij } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'

// Gekleurd kaartchipje (12×16, zoals KindIndicator in MatchAnalysisEditor); de
// betekenis staat altijd ook in tekst (kaartenWaarde), kleur is dus nooit alleen.
function Chipje({ kleur }: { kleur: string }) {
  return (
    <span
      className="inline-block rounded-[3px] flex-shrink-0 self-center"
      style={{ width: 12, height: 16, background: kleur }}
      aria-hidden="true"
    />
  )
}

export default function GeleRodeKaartenLijst({ rijen, fout, t }: { rijen: SpelerMomentenRij[]; fout: boolean; t: Dict }) {
  const i = t.insights
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (rijen.length === 0) empty = <InsightEmpty icon="sports_soccer" text={i.kaartenEmpty} />

  return (
    <InsightCard title={i.kaartenTitle} description={i.kaartenDescription} empty={empty}>
      <ol className="flex flex-col gap-1.5">
        {rijen.map((r) => (
          <li key={r.player_id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink font-semibold min-w-0 leading-snug">
              {r.naam}
              {r.gast && (
                <span className="ml-2 text-[11px] font-bold text-faint rounded-full px-2 py-0.5 bg-surface-sunken">{i.gastLabel}</span>
              )}
            </span>
            <span className="flex items-center gap-2 text-faint font-semibold whitespace-nowrap tabular-nums">
              {r.geel > 0 && <Chipje kleur="var(--chip-amber-fg)" />}
              {r.rood > 0 && <Chipje kleur="var(--chip-red-fg)" />}
              {i.kaartenWaarde.replace('{geel}', String(r.geel)).replace('{rood}', String(r.rood))}
            </span>
          </li>
        ))}
      </ol>
    </InsightCard>
  )
}
