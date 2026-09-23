'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Player, POSITION_GROUPS } from '@/lib/types'
import { useDict } from '@/lib/i18n-context'
import { avatarBg, initialsOf } from '@/lib/avatar'

interface Props {
  active: Player[]
  inactive: Player[]
  canEdit: boolean
}

export default function PlayerList({ active, inactive, canEdit }: Props) {
  const t = useDict()
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const filteredActive = useMemo(
    () => (q ? active.filter((p) => p.name.toLowerCase().includes(q)) : active),
    [active, q],
  )
  const filteredInactive = useMemo(
    () => (q ? inactive.filter((p) => p.name.toLowerCase().includes(q)) : inactive),
    [inactive, q],
  )

  const hasAny = active.length > 0 || inactive.length > 0

  function PlayerRow({ player, dimmed }: { player: Player; dimmed?: boolean }) {
    return (
      <Link
        href={`/players/${player.id}`}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-sunken ${dimmed ? 'opacity-55' : ''}`}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-[13px] font-bold font-display flex-shrink-0"
          style={{ background: dimmed ? 'var(--faint)' : avatarBg(player.name) }}
          aria-hidden="true"
        >
          {initialsOf(player.name)}
        </div>
        <div className="flex-1 min-w-0 flex flex-col leading-tight">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-[14.5px] font-bold text-ink truncate">{player.name}</span>
            {player.injured && (
              <span
                className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0"
                style={{ background: 'rgba(239,68,68,0.14)', color: 'var(--chip-red-fg)' }}
                title={t.players.injuredBadge}
              >
                <span className="ms text-[13px]" aria-hidden="true">healing</span>
                {t.players.injuredBadge}
              </span>
            )}
            {player.type === 'guest' && (
              <span
                className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0"
                style={{ background: 'rgba(245,158,11,0.14)', color: 'var(--chip-amber-fg)' }}
                title={t.players.guestBadge}
              >
                <span className="ms text-[13px]" aria-hidden="true">person_add</span>
                {t.players.guestBadge}
              </span>
            )}
          </span>
          <span className="text-[12px] font-semibold text-faint">
            {t.players.positions[player.position] ?? player.position}
          </span>
        </div>
        {player.rating != null && (
          <span className="text-[11.5px] font-extrabold text-brand-accent px-2 py-0.5 rounded-full flex-shrink-0"
            style={{ background: 'color-mix(in srgb, var(--brand-accent) 14%, transparent)' }}
            title={t.players.rating}
            aria-label={`${t.players.rating}: ${player.rating}`}>
            {player.rating}
          </span>
        )}
        <span className="w-9 text-center font-display text-[15px] font-bold text-muted flex-shrink-0">
          {player.jersey_number ?? '–'}
        </span>
        <span className="ms text-[20px] text-faint flex-shrink-0">chevron_right</span>
      </Link>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex flex-col leading-tight">
          <h1 className="font-display text-[26px] lg:text-[28px] font-bold tracking-tight text-ink">{t.players.title}</h1>
          <p className="text-[13.5px] font-semibold text-faint mt-0.5">
            {active.length} {t.players.activeCount}
            {inactive.length > 0 && ` · ${inactive.length} ${t.players.inactiveCount}`}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <span className="ms text-[19px] text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">search</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.players.searchPlaceholder}
              className="h-[42px] w-[180px] sm:w-[220px] rounded-xl bg-surface text-ink text-[13.5px] font-semibold pl-10 pr-3 placeholder:text-faint placeholder:font-semibold focus:outline-none focus:ring-2 focus:ring-brand-accent/40"
              style={{ border: '1px solid var(--border-soft)' }}
            />
          </div>
          {canEdit && (
            <Link
              href="/players/new"
              aria-label={t.players.add}
              className="h-[42px] rounded-xl px-4 flex items-center gap-2 text-[13.5px] font-bold text-white flex-shrink-0"
              style={{ background: 'var(--primary)' }}
            >
              <span className="ms text-[19px]" aria-hidden="true">person_add</span>
              <span className="hidden sm:inline">{t.players.add}</span>
            </Link>
          )}
        </div>
      </div>

      {!hasAny ? (
        <div className="surface-card p-10 text-center flex flex-col items-center gap-3">
          <span className="ms text-[40px] text-faint">groups</span>
          <p className="text-ink font-bold">{t.players.noPlayers}</p>
          <p className="text-faint text-sm">{t.players.noPlayersHint}</p>
          {canEdit && (
            <Link href="/players/new" className="mt-1 h-11 rounded-xl px-5 flex items-center gap-2 text-sm font-bold text-white" style={{ background: 'var(--primary)' }}>
              <span className="ms text-[19px]">person_add</span>{t.players.add}
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* Active players grouped by position */}
          {POSITION_GROUPS.map((group) => {
            const groupPlayers = filteredActive.filter((p) => group.positions.includes(p.position))
            if (groupPlayers.length === 0) return null
            return (
              <div key={group.label} className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[11.5px] font-extrabold uppercase tracking-wider text-faint">
                    {t.players.groups[group.label] ?? group.label}
                  </span>
                  <span className="text-[11.5px] font-bold text-faint/70">{groupPlayers.length}</span>
                </div>
                <div className="surface-card overflow-hidden">
                  {groupPlayers.map((player, i) => (
                    <div key={player.id} style={i > 0 ? { borderTop: '1px solid var(--border-soft)' } : undefined}>
                      <PlayerRow player={player} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Inactive players */}
          {filteredInactive.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2 px-1">
                <span className="text-[11.5px] font-extrabold uppercase tracking-wider text-faint">{t.players.inactiveLabel}</span>
                <span className="text-[11.5px] font-bold text-faint/70">{filteredInactive.length}</span>
              </div>
              <div className="surface-card overflow-hidden">
                {filteredInactive.map((player, i) => (
                  <div key={player.id} style={i > 0 ? { borderTop: '1px solid var(--border-soft)' } : undefined}>
                    <PlayerRow player={player} dimmed />
                  </div>
                ))}
              </div>
            </div>
          )}

          {q && filteredActive.length === 0 && filteredInactive.length === 0 && (
            <p className="text-center text-faint text-sm py-6">{t.players.noPlayers}</p>
          )}
        </>
      )}
    </div>
  )
}
