import Link from 'next/link'
import type { Dict } from '@/messages/nl'
import type { Weergave } from '@/lib/aanwezigheidsoverzicht'

// Schakelaar Lijst / Aanwezigheid bovenaan /players. Bewust gewone <Link>'s
// (server component, geen state): de weergave staat in de URL
// (?weergave=aanwezigheid), dus de server bepaalt wat er getoond wordt, de
// keuze is deelbaar en het werkt zonder JavaScript. Zelfde idee als
// PeriodeFilter. Geen overgangsanimatie — dit is een navigatie die vaak
// gebeurt — alleen drukfeedback via active:scale.
const OPTIES: { weergave: Weergave; href: string }[] = [
  { weergave: 'lijst', href: '/players' },
  { weergave: 'aanwezigheid', href: '/players?weergave=aanwezigheid' },
]

export default function WeergaveSchakelaar({ actief, t }: { actief: Weergave; t: Dict }) {
  const label: Record<Weergave, string> = {
    lijst: t.players.weergaveLijst,
    aanwezigheid: t.players.weergaveAanwezigheid,
  }

  return (
    <div
      // Designronde 3: één segmentknop (track + actieve pil) i.p.v. twee losse
      // grote knoppen; leest als weergavekeuze, niet als actie.
      className="grid grid-cols-2 sm:inline-grid sm:self-start gap-1 p-1 rounded-full bg-surface-sunken border border-[var(--border-soft)] print:hidden"
      role="group"
      aria-label={t.players.weergaveLabel}
    >
      {OPTIES.map(({ weergave, href }) => {
        const isActief = weergave === actief
        return (
          <Link
            key={weergave}
            href={href}
            aria-current={isActief ? 'page' : undefined}
            className={`h-11 px-6 rounded-full flex items-center justify-center text-sm font-bold transition-[transform] duration-[160ms] ease-out active:scale-[0.97] ${isActief ? 'text-white shadow-sm' : 'text-muted hover:text-ink'}`}
            style={
              isActief
                ? { background: 'var(--primary)' }
                : { background: 'var(--surface-sunken)' }
            }
          >
            {label[weergave]}
          </Link>
        )
      })}
    </div>
  )
}
