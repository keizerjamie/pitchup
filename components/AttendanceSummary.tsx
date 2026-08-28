import Link from 'next/link'
import { Player, POSITION_GROUPS } from '@/lib/types'
import type { Dict } from '@/messages/nl'

interface Props {
  present: Player[]
  absent: Player[]
  eventId: string
  t: Dict
  className?: string
}

function Chip({ player, tone }: { player: Player; tone: 'present' | 'absent' }) {
  // Aanwezig krijgt het groene statuspaneel-drietal (achtergrond/rand/tekst,
  // in beide thema's op minimaal 4.5:1 nagerekend — zie de --panel-*-tokens in
  // globals.css). Afwezig blijft bewust neutraal, maar krijgt nu wél een rand:
  // met alleen `bg-surface-sunken` (#f6faf8) was de chip op het lichte thema
  // vrijwel dezelfde kleur als de kaart eronder, dus geen zichtbare chip en
  // nauwelijks verschil met een aanwezige speler.
  const chip = tone === 'present'
    ? 'bg-panel-green text-panel-green-ink border border-panel-green-edge'
    : 'bg-surface-sunken text-muted border border-[var(--border-soft)]'
  const badge = tone === 'present' ? 'bg-primary text-white' : 'bg-[var(--track)] text-muted'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg pl-1 pr-2.5 py-1 text-sm font-medium ${chip}`}>
      <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${badge}`}>
        {player.jersey_number ?? '#'}
      </span>
      {player.name.split(' ')[0]}
    </span>
  )
}

// Read-only overview of who is present / absent for an event, for reference
// while building a lineup or training plan. Editing lives on the event page.
//
// Print krijgt een eigen, veel compactere weergave (kladblok-model, op
// verzoek van de eigenaar): rugnummer + naam onder elkaar in een smalle
// kolom, i.p.v. de gegroepeerde chips-weergave hieronder — zie het
// `hidden print:block`-blok verderop. Dezelfde `present`/`absent`-props,
// alleen anders opgemaakt.
export default function AttendanceSummary({ present, absent, eventId, t, className = '' }: Props) {
  return (
    // `.glass-card` is ongelaagde CSS en wint van elke Tailwind-utility in
    // `@layer utilities` — `print:bg-transparent`/`print:shadow-none`/
    // `print:border-0` verloren dat gevecht en waren dode klassen. De
    // achtergrond/rand/schaduw op print worden nu geregeld door de
    // `.print-attendance-col`-regel in het `@media print`-blok van
    // globals.css (staat zelf ook ongelaagd, dus kan `.glass-card` wél
    // overrulen) — deze component draagt die klasse altijd via `className`
    // (zie app/events/[id]/training-plan/page.tsx en app/print-preview).
    <div className={`print:break-inside-avoid glass-card rounded-2xl overflow-hidden print:rounded-none ${className}`}>
      <div className="print:hidden">
        <div className="px-5 py-4 border-b border-[var(--border-soft)] flex items-center justify-between gap-2">
          <h2 className="font-semibold text-ink">{t.event.attendance}</h2>
          <span className="text-sm font-semibold text-primary-strong flex-shrink-0">
            {present.length}/{present.length + absent.length}
          </span>
        </div>

        <div className="px-5 py-4 space-y-3.5">
          {present.length === 0 ? (
            <p className="text-sm text-faint">{t.event.unknownStat}</p>
          ) : (
            POSITION_GROUPS.map((group) => {
              const gp = present.filter((p) => group.positions.includes(p.position))
              if (gp.length === 0) return null
              return (
                <div key={group.label}>
                  <p className="text-xs font-semibold text-faint uppercase tracking-wide mb-1.5">
                    {t.players.groups[group.label] ?? group.label}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {gp.map((p) => <Chip key={p.id} player={p} tone="present" />)}
                  </div>
                </div>
              )
            })
          )}

          {absent.length > 0 && (
            <div className="pt-3 border-t border-[var(--border-soft)]">
              <p className="text-xs font-semibold text-faint uppercase tracking-wide mb-1.5">
                {t.event.absentStat} ({absent.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {absent.map((p) => <Chip key={p.id} player={p} tone="absent" />)}
              </div>
            </div>
          )}
        </div>

        {/* `text-brand` (#0d3d38) en `bg-brand-light` (#e6f4f2) zijn VASTE hexen
            die niet met het thema meebewegen: op de donkere kaart was deze link
            donker-op-donker en lichtte de hover-tint fel wit op. --brand-accent
            en --surface-sunken zijn de themabare tegenhangers. */}
        <Link
          href={`/events/${eventId}`}
          transitionTypes={['nav-back']}
          className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-soft)] text-sm font-medium text-brand-accent hover:bg-surface-sunken transition-colors"
        >
          {t.event.editAttendance}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      {/* Print-only: rugnummer + naam onder elkaar, aanwezig/afwezig onder
          elkaar met een kopje. Niet gegroepeerd per positie (dat kost extra
          kopjes/hoogte in een kolom van maar 42mm breed) — op het kladblokje
          van de eigenaar staan alle namen gewoon onder elkaar.

          Let op: bij `present.length === 0` wordt hier bewust GEEN
          `{t.event.unknownStat}`-tekst herhaald — dat zou (jsdom past geen
          CSS/`print:`-media toe, dus dit blok en het scherm-blok hierboven
          staan tegelijk in de DOM) exact dezelfde losse tekst op twee plekken
          opleveren en een "Found multiple elements"-fout riskeren in
          bestaande tests, zoals ook bij poolLabel/poolLabelPrint
          (TeamIndelingEditor.tsx). */}
      <div className="hidden print:block print:text-[8px] print:leading-snug">
        {/* Kopjes in de gewaarborgde accentkleur (kleine kapitalen), nummers
            rechtsuitgelijnd in een vast kadertje (.print-attendance-nr) zodat
            de namen één nette linkerlijn vormen — verstrakking 2026-08-24. */}
        <p className="print:font-extrabold print:uppercase print:tracking-[0.12em] print:text-[7px] print:mb-[1mm] print-accent-text">
          {t.event.attendance} ({present.length}/{present.length + absent.length})
        </p>
        {present.length > 0 && (
          <ul>
            {present.map((p) => (
              <li key={p.id}><span className="print-attendance-nr">{p.jersey_number ?? '#'}</span> {p.name}{p.type === 'guest' && ` (${t.players.guestBadge})`}</li>
            ))}
          </ul>
        )}
        {absent.length > 0 && (
          <>
            <p className="print:font-extrabold print:uppercase print:tracking-[0.12em] print:text-[7px] print:mt-[2mm] print:mb-[1mm] print-accent-text">
              {t.event.absentStat} ({absent.length})
            </p>
            <ul>
              {absent.map((p) => (
                <li key={p.id}><span className="print-attendance-nr">{p.jersey_number ?? '#'}</span> {p.name}{p.type === 'guest' && ` (${t.players.guestBadge})`}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
