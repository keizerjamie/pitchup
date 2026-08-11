import type { Dict } from '@/messages/nl'
import type { VormTelling } from '@/lib/inzichten'
import FormStrip, { FormStripItem } from '@/components/dashboard/FormStrip'
import InsightCard, { InsightEmpty } from './InsightCard'
import ChartDataTable from './ChartDataTable'

// Kleuren als var(--token)-referenties (geen hex) — zelfde precedent als
// FormStrip's eigen FORM_STYLE (components/dashboard/FormStrip.tsx:9-14).
// Dit zijn gewone <div>-achtergronden, geen recharts-SVG-elementen, dus de
// .chart-fill-*-klassen (die `fill` zetten) zijn hier niet van toepassing —
// `background` via var(...) is de juiste, theme-aware manier.
const BAR_COLOR = {
  win: 'var(--chip-green-fg)',
  gelijk: 'var(--chip-amber-fg)',
  verlies: 'var(--chip-red-fg)',
  onbekend: 'var(--faint)',
} as const

// Laatste 5 W/G/V: hergebruikt de bestaande, al geteste FormStrip
// (components/dashboard/FormStrip.tsx) plus een gestapelde verdelingsbalk in
// de stijl van app/page.tsx:309-316. Bewust GEEN recharts hier — 5 discrete
// uitkomsten rechtvaardigen geen chart-library.
export default function VormChart({
  items,
  telling,
  t,
}: {
  items: FormStripItem[]
  telling: VormTelling
  t: Dict
}) {
  const totaal = telling.win + telling.gelijk + telling.verlies + telling.onbekend
  const isEmpty = items.length === 0

  const summary = t.insights.vormSummary
    .replace('{win}', String(telling.win))
    .replace('{gelijk}', String(telling.gelijk))
    .replace('{verlies}', String(telling.verlies))

  return (
    <InsightCard
      title={t.insights.vormTitle}
      description={t.insights.vormDescription}
      empty={isEmpty ? <InsightEmpty icon="sports_soccer" text={t.insights.vormEmpty} /> : undefined}
    >
      {!isEmpty && totaal > 0 && (
        <div className="flex flex-col gap-4">
          <FormStrip items={items} t={t} />

          <div role="img" aria-label={summary}>
            <div className="h-2.5 rounded-full overflow-hidden flex" style={{ background: 'var(--track)' }}>
              {telling.win > 0 && <div style={{ width: `${(telling.win / totaal) * 100}%`, background: BAR_COLOR.win }} />}
              {telling.gelijk > 0 && <div style={{ width: `${(telling.gelijk / totaal) * 100}%`, background: BAR_COLOR.gelijk }} />}
              {telling.verlies > 0 && <div style={{ width: `${(telling.verlies / totaal) * 100}%`, background: BAR_COLOR.verlies }} />}
              {telling.onbekend > 0 && <div style={{ width: `${(telling.onbekend / totaal) * 100}%`, background: BAR_COLOR.onbekend }} />}
            </div>
            <p className="text-xs font-semibold text-faint mt-1.5">{summary}</p>
          </div>

          <ChartDataTable
            caption={summary}
            headers={[t.insights.resultLabel, t.insights.countLabel]}
            rows={[
              [t.home.formWin, telling.win],
              [t.home.formDraw, telling.gelijk],
              [t.home.formLoss, telling.verlies],
              [t.home.formUnknown, telling.onbekend],
            ]}
          />
        </div>
      )}
    </InsightCard>
  )
}
