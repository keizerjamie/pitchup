import { ReactNode } from 'react'

// Gedeelde kaartschil voor elke grafiek op /inzichten — zelfde surface-card +
// titelblok-patroon als app/periodisering/page.tsx:105-108. Elke grafiek
// gebruikt deze shell zelf (importeert 'm rechtstreeks), zodat titel,
// toelichting en de lege-staat-weergave er overal identiek uitzien.
//
// `empty`: als dit is meegegeven (niet undefined), wordt dát getoond in
// plaats van `children` — titel/toelichting blijven altijd zichtbaar, zodat
// duidelijk blijft welke metriek nog geen data heeft (in plaats van de kaart
// stilletjes weg te laten).
export default function InsightCard({
  title,
  description,
  empty,
  children,
}: {
  title: string
  description?: string
  empty?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="surface-card overflow-hidden">
      <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <h2 className="font-display text-[16px] font-bold text-ink">{title}</h2>
        {description && <p className="text-xs font-semibold text-faint mt-0.5">{description}</p>}
      </div>
      <div className="px-5 py-4">{empty !== undefined ? empty : children}</div>
    </div>
  )
}

// Herbruikbare lege-staat-inhoud binnen een InsightCard (icoon + korte tekst),
// zelfde visuele taal als de bestaande pagina-brede lege staten (bv.
// app/periodisering/page.tsx:172-177) maar compacter, want deze zit al binnen
// een kaart die zelf al een titel toont.
export function InsightEmpty({ icon, text }: { icon?: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      {icon && <span className="ms text-[26px] text-faint">{icon}</span>}
      <p className="text-sm font-semibold text-faint">{text}</p>
    </div>
  )
}
