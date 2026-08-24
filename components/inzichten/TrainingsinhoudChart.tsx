import { PERIODIZATION_CATEGORIES } from '@/lib/types'
import type { Dict } from '@/messages/nl'
import InsightCard, { InsightEmpty } from './InsightCard'
import ChartDataTable from './ChartDataTable'

// Waar legde je je accenten? De periodisering wist al in hoeveel trainingen
// elke categorie voorkwam (lib/periodization.ts, countCategoryOccurrences) —
// dat werd alleen gebruikt om de stap te berekenen en nergens getoond. Dit is
// hetzelfde cijfer, als seizoensbeeld.
//
// Geen recharts: tien horizontale balken zijn gewone divs. Zelfde afweging als
// VormChart.tsx.
//
// Telt per TRAINING, niet per oefening: twee positiespelvormen in dezelfde
// training tellen als één. Anders zou een sessie met vier kleine vormen de
// verdeling scheeftrekken tegenover een sessie met één lange partij.
export default function TrainingsinhoudChart({
  tellingen,
  t,
}: {
  tellingen: Record<string, number>
  t: Dict
}) {
  const rijen = PERIODIZATION_CATEGORIES.map((cat) => ({
    key: cat.key,
    label: t.periodization.categories[cat.key] ?? cat.label,
    aantal: tellingen[cat.key] ?? 0,
  }))

  const totaal = rijen.reduce((som, r) => som + r.aantal, 0)
  const isEmpty = totaal === 0

  // Schaal op de hoogste categorie, niet op het totaal: bij tien categorieën
  // zou elke balk anders een streepje worden.
  const hoogste = Math.max(1, ...rijen.map((r) => r.aantal))

  const summary = t.insights.inhoudSummary
    .replace('{n}', String(rijen.filter((r) => r.aantal > 0).length))
    .replace('{totaal}', String(totaal))

  // Lege staat gebruikt "assignment" i.p.v. "list_alt": list_alt zit niet in
  // de gesubsette icoonfont en rendert daar als letterlijke tekst (GSUB-check).
  return (
    <InsightCard
      title={t.insights.inhoudTitle}
      description={t.insights.inhoudDescription}
      empty={isEmpty ? <InsightEmpty icon="assignment" text={t.insights.inhoudEmpty} /> : undefined}
    >
      {!isEmpty && (
        <>
          <div role="img" aria-label={summary} className="flex flex-col gap-2">
            {rijen.map((rij) => (
              <div key={rij.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-bold text-ink truncate">{rij.label}</span>
                  <span className="text-xs font-bold text-faint tabular-nums flex-shrink-0">{rij.aantal}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: 'var(--track)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.round((rij.aantal / hoogste) * 100)}%`,
                      // Categorieën zonder enige training krijgen geen balk,
                      // maar blijven wél in de lijst staan: "nul keer gedaan"
                      // is precies het inzicht dat je zoekt.
                      background: rij.aantal > 0 ? 'var(--brand-accent)' : 'transparent',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <ChartDataTable
            caption={summary}
            headers={[t.insights.inhoudCategoryLabel, t.insights.inhoudCountLabel]}
            rows={rijen.map((r) => [r.label, r.aantal])}
          />
        </>
      )}
    </InsightCard>
  )
}
