import Link from 'next/link'
import type { Dict } from '@/messages/nl'

// Eenmalige setup-kaart op het dashboard: de periodisering doet niets zolang
// er geen nulmeting is.
//
// Waarom dit nodig was: de trainingsplanner waarschuwde hier al voor, en de
// periodiseringspagina toont een lege staat — maar allebei op plekken die je
// pas bereikt als je al aan het plannen bent. Zonder nulmeting is er geen
// cyclusweek, dus geen suggesties in de planner en geen status; de hele
// feature blijft daardoor onzichtbaar in plaats van zichtbaar uit te staan.
// Het dashboard is de enige plek waar je hoe dan ook langskomt.
//
// BEWUST GEEN TO-DO-ITEM: de to-do-lijst (lib/todos.mjs) gaat over taken bij
// één event — opstelling, analyse, trainingsplan. Een nulmeting is een
// team-instelling zonder event en zou dat model vervuilen.
//
// BEWUST GEEN WEGKLIK-KNOP: de kaart verdwijnt vanzelf zodra er een nulmeting
// staat. Een aparte "verberg dit"-status zou een kolom en een migratie vragen
// voor iets dat je één keer doet en daarna nooit meer ziet.
export default function SetupNulmeting({ t }: { t: Dict }) {
  return (
    <div className="surface-card p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <span
        className="ms text-[26px] flex-shrink-0"
        style={{ color: 'var(--warning-text)' }}
        aria-hidden="true"
      >
        monitoring
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[15px] font-bold text-ink">{t.home.setupNulmetingTitle}</p>
        <p className="text-[13.5px] text-muted mt-0.5">{t.home.setupNulmetingBody}</p>
      </div>
      <Link
        href="/periodisering"
        className="h-11 rounded-xl px-5 inline-flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
        style={{ background: 'var(--brand-btn)' }}
      >
        {t.home.setupNulmetingCta}
      </Link>
    </div>
  )
}
