import type { Dict } from '@/messages/nl'
import type { Player } from '@/lib/types'
import { avatarBg, initialsOf } from '@/lib/avatar'
import Link from 'next/link'
import BackButton from '@/components/BackButton'

// Full-bleed donkere kop (AC6-AC8). Geen container eromheen — de pagina
// plaatst dit component buiten de gecentreerde contentcontainer, zie
// app/players/[id]/page.tsx en brief §4.2.
// Designronde 3: terug links en "Speler bewerken" rechts als ronde glasknoppen
// bovenin de kop — dezelfde plekken als in de PageHeader elders. Bewerken
// stond eerder tussen de statusknoppen (blessure/afmelden) onder de kop.
const glasKnop =
  'absolute top-3 w-11 h-11 rounded-full flex items-center justify-center text-white bg-white/15 hover:bg-white/25 transition-colors backdrop-blur-sm'

export default function PlayerProfileHeader({ player, t, canEditSpelers = false }: { player: Player; t: Dict; canEditSpelers?: boolean }) {
  return (
    <header
      className="relative overflow-hidden px-4 lg:px-8 pt-6 pb-6 md:pt-10 text-white flex flex-col items-center gap-2"
      style={{ background: 'linear-gradient(125deg, var(--color-brand-dark) 0%, var(--color-brand) 45%, var(--color-brand-mid) 100%)' }}
    >
      <BackButton fallback="/players" className={`${glasKnop} left-3`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
      </BackButton>
      {canEditSpelers && (
        <Link href={`/players/${player.id}/edit`} aria-label={t.players.editLabel} className={`${glasKnop} right-3`}>
          <span className="ms text-[20px]" aria-hidden="true">edit</span>
        </Link>
      )}

      <div
        className="w-20 h-20 rounded-full flex items-center justify-center text-white text-[24px] font-bold font-display flex-shrink-0 ring-2 ring-white/20"
        style={{ background: avatarBg(player.name) }}
        aria-hidden="true"
      >
        {initialsOf(player.name)}
      </div>

      <h1 className="font-display text-[22px] font-bold text-center text-balance break-words max-w-[18ch]">
        {player.name}
      </h1>
      <p className="text-[13px] font-semibold text-white/70">
        {t.players.positions[player.position] ?? player.position}
      </p>

      <span
        className="text-[11px] font-extrabold uppercase tracking-wide px-3 py-1 rounded-full text-white inline-flex items-center gap-1"
        style={{ background: player.injured ? 'var(--danger)' : 'var(--primary)' }}
      >
        <span className="ms text-[14px]" aria-hidden="true">{player.injured ? 'healing' : 'check_circle'}</span>
        {player.injured ? t.players.injuredBadge : t.players.availableBadge}
      </span>
    </header>
  )
}
