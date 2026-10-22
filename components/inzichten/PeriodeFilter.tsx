import Link from 'next/link'
import type { Dict } from '@/messages/nl'
import { PERIODES, type Periode } from '@/lib/inzichten'

// Periodekiezer boven de KPI-strook. Bewust GEEN client component met state:
// een andere periode betekent andere RPC-parameters, dus de server moet
// sowieso opnieuw rekenen. Gewone <Link>'s naar dezelfde pagina met een
// andere `?periode=` zijn dan zowel eenvoudiger als deelbaar (de URL draagt de
// keuze) én werken zonder JavaScript.
//
// Dit wijkt bewust af van het filter in DoelpuntenChart.tsx, dat wél
// useState gebruikt: dáár wordt puur op al opgehaalde rijen gefilterd, zonder
// server-ronde. De knopstijl is wel letterlijk van dat filter overgenomen,
// zodat de twee filters op één pagina niet als twee verschillende dingen
// ogen.
//
// `hrefVoor` is optioneel zodat /inzichten ongewijzigd blijft; andere pagina's
// (bv. /players?weergave=aanwezigheid) geven hun eigen URL-opbouw mee. Dit is
// een server component, dus de functie-prop gaat niet door een client boundary.
function inzichtenHref(p: Periode): string {
  // De standaardperiode laat de parameter helemaal weg, zodat
  // /inzichten en /inzichten?periode=seizoen niet als twee
  // verschillende URL's naast elkaar bestaan.
  return p === 'seizoen' ? '/inzichten' : `/inzichten?periode=${p}`
}

export default function PeriodeFilter({
  actief,
  t,
  hrefVoor = inzichtenHref,
}: {
  actief: Periode
  t: Dict
  hrefVoor?: (p: Periode) => string
}) {
  const label: Record<Periode, string> = {
    '4w': t.insights.periode4w,
    '8w': t.insights.periode8w,
    seizoen: t.insights.periodeSeizoen,
  }

  return (
    // Designronde 3: segmentknop in dezelfde vorm als de weergaveschakelaar op
    // /players (track + actieve pil), i.p.v. losse chips die over twee regels
    // braken op mobiel.
    <div className="inline-flex self-start max-w-full gap-1 p-1 rounded-full bg-surface-sunken border border-[var(--border-soft)]" role="group" aria-label={t.insights.periodeLabel}>
      {PERIODES.map((p) => {
        const isActief = p === actief
        return (
          <Link
            key={p}
            href={hrefVoor(p)}
            aria-current={isActief ? 'page' : undefined}
            className={`h-9 px-3.5 sm:px-4 inline-flex items-center whitespace-nowrap text-[13px] font-bold rounded-full transition-colors ${isActief ? 'text-white shadow-sm' : 'text-muted hover:text-ink'}`}
            style={
              isActief
                ? { background: 'var(--primary)' }
                : undefined
            }
          >
            {label[p]}
          </Link>
        )
      })}
    </div>
  )
}
