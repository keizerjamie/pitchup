'use client'

import { useState, useEffect, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Player, POSITION_GROUPS } from '@/lib/types'
import { markInjured, markRecovered } from '@/app/actions/players'
import { useDict } from '@/lib/i18n-context'

type SheetAction = {
  label: string
  icon: string
  tone: 'ink' | 'danger'
  href?: string
  onClick?: () => void
}

const AVATAR_BG = ['#16a34a', '#14655c', '#0d3d38', '#1a6b63', '#0f766e', '#15803d']

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return (words.length >= 2 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase()
}
function avatarBg(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_BG[h % AVATAR_BG.length]
}

interface Props {
  active: Player[]
  inactive: Player[]
}

export default function PlayerList({ active, inactive }: Props) {
  const t = useDict()
  const router = useRouter()
  const [selected, setSelected] = useState<Player | null>(null)
  const [sheetVisible, setSheetVisible] = useState(false)
  const [query, setQuery] = useState('')
  const [isPending, startTransition] = useTransition()

  const q = query.trim().toLowerCase()
  const filteredActive = useMemo(
    () => (q ? active.filter((p) => p.name.toLowerCase().includes(q)) : active),
    [active, q],
  )
  const filteredInactive = useMemo(
    () => (q ? inactive.filter((p) => p.name.toLowerCase().includes(q)) : inactive),
    [inactive, q],
  )

  function openSheet(player: Player) {
    setSelected(player)
    requestAnimationFrame(() => requestAnimationFrame(() => setSheetVisible(true)))
  }
  function closeSheet() {
    setSheetVisible(false)
    setTimeout(() => setSelected(null), 300)
  }
  function navigate(href: string) {
    closeSheet()
    setTimeout(() => router.push(href), 260)
  }
  function runAction(fn: () => Promise<void>) {
    startTransition(async () => {
      await fn()
      router.refresh()
      closeSheet()
    })
  }

  useEffect(() => {
    if (!selected) return
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') closeSheet() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [selected])

  const actions: SheetAction[] = selected ? [
    { label: t.players.editLabel, icon: 'edit',        tone: 'ink',    href: `/players/${selected.id}/edit` },
    { label: t.players.signOff,   icon: 'event_busy',  tone: 'danger', href: `/players/${selected.id}/absence` },
    selected.injured
      ? { label: t.players.reportRecovered, icon: 'check_circle', tone: 'ink',    onClick: () => runAction(() => markRecovered(selected.id)) }
      : { label: t.players.reportInjury,    icon: 'healing',      tone: 'danger', onClick: () => runAction(() => markInjured(selected.id)) },
  ] : []

  const hasAny = active.length > 0 || inactive.length > 0

  function PlayerRow({ player, dimmed }: { player: Player; dimmed?: boolean }) {
    return (
      <button
        type="button"
        onClick={() => openSheet(player)}
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
          </span>
          <span className="text-[12px] font-semibold text-faint">
            {t.players.positions[player.position] ?? player.position}
          </span>
        </div>
        {player.rating != null && (
          <span className="text-[11.5px] font-extrabold text-brand-accent px-2 py-0.5 rounded-full flex-shrink-0"
            style={{ background: 'color-mix(in srgb, var(--brand-accent) 14%, transparent)' }}>
            {player.rating}
          </span>
        )}
        <span className="w-9 text-center font-display text-[15px] font-bold text-muted flex-shrink-0">
          {player.jersey_number ?? '–'}
        </span>
        <span className="ms text-[20px] text-faint flex-shrink-0">chevron_right</span>
      </button>
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
          <Link
            href="/players/new"
            className="h-[42px] rounded-xl px-4 flex items-center gap-2 text-[13.5px] font-bold text-white flex-shrink-0"
            style={{ background: 'var(--primary)' }}
          >
            <span className="ms text-[19px]">person_add</span>
            <span className="hidden sm:inline">{t.players.add}</span>
          </Link>
        </div>
      </div>

      {!hasAny ? (
        <div className="surface-card p-10 text-center flex flex-col items-center gap-3">
          <span className="ms text-[40px] text-faint">groups</span>
          <p className="text-ink font-bold">{t.players.noPlayers}</p>
          <p className="text-faint text-sm">{t.players.noPlayersHint}</p>
          <Link href="/players/new" className="mt-1 h-11 rounded-xl px-5 flex items-center gap-2 text-sm font-bold text-white" style={{ background: 'var(--primary)' }}>
            <span className="ms text-[19px]">person_add</span>{t.players.add}
          </Link>
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

      {/* Bottom sheet */}
      {selected && (
        <>
          <div
            className="fixed inset-0 z-[290]"
            onClick={closeSheet}
            style={{
              background: 'rgba(0,0,0,0.28)',
              backdropFilter: sheetVisible ? 'blur(6px)' : 'blur(0px)',
              WebkitBackdropFilter: sheetVisible ? 'blur(6px)' : 'blur(0px)',
              opacity: sheetVisible ? 1 : 0,
              transition: 'opacity 0.25s ease, backdrop-filter 0.25s ease',
            }}
          />
          <div
            className="fixed left-0 right-0 z-[300] px-4 max-w-md mx-auto"
            style={{
              bottom: 'max(env(safe-area-inset-bottom), 16px)',
              transform: sheetVisible ? 'translateY(0)' : 'translateY(110%)',
              transition: 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
            }}
          >
            <div className="surface-card rounded-2xl overflow-hidden mb-3">
              <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-soft)' }}>
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-[13px] font-bold font-display flex-shrink-0"
                  style={{ background: avatarBg(selected.name) }}
                  aria-hidden="true"
                >
                  {initialsOf(selected.name)}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-ink truncate">{selected.name}</div>
                  <div className="text-xs font-semibold text-faint">{t.players.positions[selected.position] ?? selected.position}</div>
                </div>
              </div>
              {actions.map((action, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={isPending}
                  onClick={() => (action.href ? navigate(action.href) : action.onClick?.())}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-surface-sunken transition-colors text-left disabled:opacity-55 disabled:pointer-events-none"
                  style={i < actions.length - 1 ? { borderBottom: '1px solid var(--border-soft)' } : undefined}
                >
                  <div
                    className="w-[38px] h-[38px] rounded-xl flex items-center justify-center flex-shrink-0"
                    style={
                      action.tone === 'danger'
                        ? { background: 'rgba(220,38,38,0.12)', color: '#dc2626' }
                        : { background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--brand-accent)' }
                    }
                  >
                    <span className="ms text-[20px]">{action.icon}</span>
                  </div>
                  <span className="font-bold text-ink flex-1">{action.label}</span>
                  <span className="ms text-[20px] text-faint">chevron_right</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={closeSheet}
              className="surface-card w-full py-4 rounded-2xl font-bold text-ink"
            >
              {t.players.cancel ?? 'Annuleren'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
