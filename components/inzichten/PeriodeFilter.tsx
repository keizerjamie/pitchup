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
export default function PeriodeFilter({ actief, t }: { actief: Periode; t: Dict }) {
  const label: Record<Periode, string> = {
    '4w': t.insights.periode4w,
    '8w': t.insights.periode8w,
    seizoen: t.insights.periodeSeizoen,
  }

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.insights.periodeLabel}>
      {PERIODES.map((p) => {
        const isActief = p === actief
        return (
          <Link
            key={p}
            // De standaardperiode laat de parameter helemaal weg, zodat
            // /inzichten en /inzichten?periode=seizoen niet als twee
            // verschillende URL's naast elkaar bestaan.
            href={p === 'seizoen' ? '/inzichten' : `/inzichten?periode=${p}`}
            aria-current={isActief ? 'page' : undefined}
            className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${isActief ? 'text-white' : 'text-muted'}`}
            style={
              isActief
                ? { background: 'var(--primary)' }
                : { background: 'var(--surface-sunken)', border: '1px solid var(--border-soft)' }
            }
          >
            {label[p]}
          </Link>
        )
      })}
    </div>
  )
}
