import type { Dict } from '@/messages/nl'
import { Player, Position, POSITION_GROUPS } from '@/lib/types'

// Positiegroep → thema-bewuste paneeltokens (AC11/AC12). Bewust NIET
// POSITION_COLORS (lib/types.ts) hergebruikt: die is hardcoded Tailwind-licht
// en breekt dark mode. Zelfde kleursemantiek als vandaag (Keepers=amber,
// Verdedigers=blauw, Middenvelders=groen, Aanvallers=rood), maar via de
// bestaande --panel-*-tokens die in beide thema's op ≥4.5:1 doorgerekend zijn.
const POSITIE_GROEP_TOKENS: Record<string, { bg: string; fg: string; border: string }> = {
  Keepers: { bg: 'var(--panel-amber-bg)', fg: 'var(--panel-amber-fg)', border: 'var(--panel-amber-border)' },
  Verdedigers: { bg: 'var(--panel-blue-bg)', fg: 'var(--panel-blue-fg)', border: 'var(--panel-blue-border)' },
  Middenvelders: { bg: 'var(--panel-green-bg)', fg: 'var(--panel-green-fg)', border: 'var(--panel-green-border)' },
  Aanvallers: { bg: 'var(--panel-red-bg)', fg: 'var(--panel-red-fg)', border: 'var(--panel-red-border)' },
}

// Neutrale val voor een positie zonder bekende groep (zou nooit moeten
// gebeuren met de huidige POSITIONS-lijst, maar geen crash als dat ooit wijzigt).
const NEUTRAAL_TOKEN = { bg: 'var(--surface-sunken)', fg: 'var(--muted)', border: 'var(--border-soft)' }

function tokenVoorPositie(position: Position): { bg: string; fg: string; border: string } {
  const groep = POSITION_GROUPS.find((g) => g.positions.includes(position))
  return (groep && POSITIE_GROEP_TOKENS[groep.label]) || NEUTRAAL_TOKEN
}

function PositieBadge({ label, position }: { label: string; position: Position }) {
  const token = tokenVoorPositie(position)
  return (
    <span
      className="text-[12px] font-bold px-2.5 py-1 rounded-full inline-flex items-center"
      style={{ background: token.bg, color: token.fg, border: `1px solid ${token.border}` }}
    >
      {label}
    </span>
  )
}

function Rij({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-[13px] font-semibold text-faint">{label}</span>
      <span className="text-[14px] font-bold text-ink text-right">{children}</span>
    </div>
  )
}

export default function PlayerInfoTab({ player, t }: { player: Player; t: Dict }) {
  return (
    <div className="surface-card p-5">
      <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-faint mb-1">
        {t.players.profileInfoTitle}
      </h2>
      <div>
        <div style={{ borderTop: '1px solid var(--border-soft)' }} />
        <Rij label={t.players.name}>{player.name}</Rij>
        <div style={{ borderTop: '1px solid var(--border-soft)' }} />
        <Rij label={t.players.primaryPosition}>
          <PositieBadge label={t.players.positions[player.position] ?? player.position} position={player.position} />
        </Rij>
        <div style={{ borderTop: '1px solid var(--border-soft)' }} />
        <Rij label={t.players.secondaryPositions}>
          {player.secondary_positions.length > 0 ? (
            <span className="flex flex-wrap justify-end gap-1.5">
              {player.secondary_positions.map((pos) => (
                <PositieBadge key={pos} label={t.players.positions[pos] ?? pos} position={pos} />
              ))}
            </span>
          ) : (
            '—'
          )}
        </Rij>
        <div style={{ borderTop: '1px solid var(--border-soft)' }} />
        <Rij label={t.players.jerseyNumber}>{player.jersey_number ?? '—'}</Rij>
        <div style={{ borderTop: '1px solid var(--border-soft)' }} />
        <Rij label={t.players.rating}>{player.rating ?? '—'}</Rij>
        <div style={{ borderTop: '1px solid var(--border-soft)' }} />
        <Rij label={t.players.playerType}>{player.type === 'guest' ? t.players.typeGuest : t.players.typeRegular}</Rij>
        <div style={{ borderTop: '1px solid var(--border-soft)' }} />
        <Rij label={t.players.activeInSquad}>{player.active ? t.players.profileYes : t.players.profileNo}</Rij>
      </div>
    </div>
  )
}
