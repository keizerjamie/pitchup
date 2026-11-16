import Link from 'next/link'
import type { Dict } from '@/messages/nl'
import type { VandaagKaart } from '@/lib/vandaag-scherm'
import { formatTime } from '@/lib/utils'
import { dagKolomTekst, eventTitel, opstellingMistTekst } from '@/components/dashboard/vandaag-teksten'

// Compacte regels onder/naast de hoofdkaart: één per event met een To-do-taak,
// in To-do-volgorde. Servercomponent; de klok komt als `vandaag` binnen. De
// linknaam is de zichtbare tekst (titel + status), nooit de To-do-taaklabels.
export default function WeekRegels({ regels, vandaag, t }: { regels: VandaagKaart[]; vandaag: string; t: Dict }) {
  if (regels.length === 0) return null

  function subregel(kaart: VandaagKaart): string {
    switch (kaart.doelTaak) {
      case 'squad': return t.vandaag.lineSquad
      case 'lineup': return t.vandaag.lineLineup
      case 'analysis': return t.vandaag.lineAnalysis
      case 'training_plan': return t.vandaag.lineTraining
      case 'self_review': return t.vandaag.lineSelfReview
    }
  }

  return (
    <section aria-labelledby="week-regels-titel" className="surface-card p-5 flex flex-col gap-2">
      <h2
        id="week-regels-titel"
        className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint mb-1"
      >
        {t.vandaag.weekTitle}
      </h2>
      {regels.map((kaart) => {
        const isMatch = kaart.event.type === 'match'
        const probleem = kaart.soort === 'lineup_onvolledig'
        const sub = [kaart.event.time ? formatTime(kaart.event.time) : null, kaart.open ? subregel(kaart) : null].filter(
          (d): d is string => Boolean(d),
        )
        return (
          <Link
            key={kaart.event.id}
            href={kaart.href}
            className="flex items-center gap-3 p-3 rounded-[15px] bg-surface-sunken min-h-[44px] transition-transform active:scale-[0.98]"
            style={{ border: '1px solid var(--border-soft)' }}
          >
            <span className="w-[72px] flex-shrink-0 self-start pt-[2px] text-[12.5px] font-bold text-muted">
              {dagKolomTekst(kaart.event.date, vandaag, t)}
            </span>
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="flex items-start gap-2 min-w-0">
                <span
                  aria-hidden="true"
                  data-testid="week-regel-stip"
                  className="w-2 h-2 mt-[6px] rounded-full flex-shrink-0"
                  style={{ background: isMatch ? 'var(--event-match)' : 'var(--event-training)' }}
                />
                <span className="text-[14px] font-bold leading-snug text-ink break-words min-w-0">
                  {isMatch ? eventTitel(kaart.event, vandaag, t) : t.event.training}
                </span>
              </span>
              {sub.length > 0 && (
                <span className="text-[12.5px] font-semibold text-muted break-words pl-4">{sub.join(' · ')}</span>
              )}
            </span>
            {kaart.open ? (
              <span
                className="text-[11px] font-extrabold px-2 py-[2px] rounded-full flex-shrink-0 text-right"
                style={{ color: 'var(--warning-text)', background: 'color-mix(in srgb, var(--warning) 12%, transparent)' }}
              >
                {probleem ? opstellingMistTekst(kaart.legePosities, t) : t.vandaag.statusOpen}
              </span>
            ) : (
              <span
                className="text-[11px] font-extrabold px-2 py-[2px] rounded-full flex-shrink-0 inline-flex items-center gap-1"
                style={{ color: 'var(--chip-green-fg)', background: 'rgba(22,163,74,0.14)' }}
              >
                <span className="ms text-[13px]" aria-hidden="true">check</span>
                {t.vandaag.statusDone}
              </span>
            )}
          </Link>
        )
      })}
    </section>
  )
}
