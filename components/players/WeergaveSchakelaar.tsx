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
      className="grid grid-cols-2 sm:inline-grid gap-1.5 print:hidden"
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
            className={`h-11 px-5 rounded-xl flex items-center justify-center text-sm font-bold transition-[transform] duration-[160ms] ease-out active:scale-[0.97] ${isActief ? 'text-white' : 'text-muted'}`}
            style={
              isActief
                ? { background: 'var(--primary)' }
                : { background: 'var(--surface-sunken)', border: '1px solid var(--border-soft)' }
            }
          >
            {label[weergave]}
          </Link>
        )
      })}
    </div>
  )
}
