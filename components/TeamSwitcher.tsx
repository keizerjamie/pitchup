'use client'

// Teamwisselaar: het actieve team tonen/wisselen + ingang voor "Nieuw team
// aanmaken" (brief §4.1). Vervangt de statische teamnaam-regel in de
// desktop-sidebar en de mobiele header (components/AppShell.tsx).
//
// Eén component, twee `variant`-instanties (desktop popover / mobiele
// bottom-sheet) — AppShell rendert er al twee (in `hidden md:flex` resp.
// `md:hidden`-wrappers), dus de responsieve keuze hoeft hier niet nogmaals
// met JS (matchMedia) bepaald te worden.
//
// Bij één team: geen chevron, geen popover, alleen de naam — een wisselaar
// zonder alternatief is ruis.

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useSyncExternalStore } from 'react'
import { setActiveTeam, createTeam } from '@/app/actions/team'
import { useDict } from '@/lib/i18n-context'
import { useReducedMotion } from '@/lib/use-reduced-motion'
import type { TeamLidmaatschap } from '@/lib/team-context'
import Spinner from '@/components/icons/Spinner'

// Exit sneller dan enter (asymmetrische timing, geheugen.md §"Animatie-review
// & -fixes"). De unmount-setTimeout is exit-duur + 20ms, als module-constante
// gebruikt in zowel de transition-string als de setTimeout — dat is precies
// de bug die dit project al twee keer eerder had (GlobalFab.tsx/PlayerList.tsx).
const DESKTOP_ENTER_MS = 180
const DESKTOP_EXIT_MS = 120
const MOBILE_ENTER_MS = 260
const MOBILE_EXIT_MS = 180

const emptySubscribe = () => () => {}

function ChevronIcon({ open, reduceMotion }: { open: boolean; reduceMotion: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      style={{
        transition: reduceMotion ? 'none' : `transform ${DESKTOP_ENTER_MS + 20}ms cubic-bezier(0.23, 1, 0.32, 1)`,
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
      }}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

interface Props {
  teams: TeamLidmaatschap[]
  activeTeamId: string
  variant: 'desktop' | 'mobile'
}

export default function TeamSwitcher({ teams, activeTeamId, variant }: Props) {
  const t = useDict()
  const reduceMotion = useReducedMotion()
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [naam, setNaam] = useState('')
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Validatiebevinding 11: focus terug naar de trigger, maar UITSLUITEND bij
  // Escape of een expliciete sluitactie (de trigger zelf nogmaals aanklikken)
  // — niet bij een klik buiten het paneel (desktop) of op de backdrop
  // (mobiel). Die twee zijn een bewuste "ik wil iets anders op de pagina
  // doen"-actie van de gebruiker; de focus daarna terugtrekken naar de
  // trigger zou die andere actie tegenwerken (coordinator-ronde 2).
  const triggerRef = useRef<HTMLButtonElement>(null)

  const enterMs = variant === 'desktop' ? DESKTOP_ENTER_MS : MOBILE_ENTER_MS
  const exitMs = variant === 'desktop' ? DESKTOP_EXIT_MS : MOBILE_EXIT_MS

  function openMenu() {
    setOpen(true)
    setError(null)
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
  }

  function closeMenu({ returnFocus = false }: { returnFocus?: boolean } = {}) {
    setVisible(false)
    setTimeout(() => {
      setOpen(false)
      setShowCreate(false)
      setNaam('')
    }, exitMs + 20)
    if (returnFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeMenu({ returnFocus: true })
    }
    function onClickOutside(e: MouseEvent) {
      // Alleen desktop sluit op een klik buiten het paneel — de mobiele
      // bottom-sheet heeft al een expliciete backdrop-klik. Geen
      // returnFocus: de gebruiker klikte ergens anders naartoe.
      if (variant !== 'desktop') return
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) closeMenu()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClickOutside)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClickOutside)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variant])

  const actief = teams.find((team) => team.teamId === activeTeamId)
  const activeName = actief?.naam || t.team.activeTeam

  function handleSwitch(teamId: string) {
    if (teamId === activeTeamId || isPending) return
    setError(null)
    setPendingTeamId(teamId)
    startTransition(async () => {
      try {
        await setActiveTeam(teamId)
        // setActiveTeam eindigt in redirect() — deze regel wordt bij succes
        // nooit bereikt. Het paneel blijft expres open tot de redirect landt
        // (item-pending-state in de brief), geen closeMenu() nodig.
      } catch (err) {
        if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) return
        setPendingTeamId(null)
        setError(t.team.switchFailed)
      }
    })
  }

  function handleCreate() {
    const schoon = naam.trim()
    if (!schoon || isPending) return
    setError(null)
    startTransition(async () => {
      try {
        await createTeam(schoon)
      } catch (err) {
        if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) return
        // Nooit err.message: Next saneert server-action-fouten in productie
        // sowieso al tot een generieke Engelse tekst (validatiebevinding 8).
        setError(t.team.switchFailed)
      }
    })
  }

  const triggerClassName =
    variant === 'desktop'
      ? 'team-switcher-trigger flex items-center gap-1.5 min-w-0 rounded-lg px-1 -mx-1 py-0.5 text-left'
      : 'team-switcher-trigger flex items-center gap-1 min-w-0 rounded-lg px-1 -mx-1 py-0.5 text-left'

  const nameClassName = variant === 'desktop' ? 'text-[11.5px] font-semibold text-faint truncate' : 'text-[13px] font-semibold text-faint truncate'

  // Bij één team: platte tekst, geen knop. Een `disabled`-knop met
  // aria-label="Team wisselen" meldt een schermlezer een onbeschikbare
  // actie i.p.v. gewoon de teamnaam (validatiebevinding 11) — brief §4.1
  // vraagt hier expliciet "alleen de naam".
  const trigger = teams.length <= 1 ? (
    <span className={`${triggerClassName} ${nameClassName}`}>{activeName}</span>
  ) : (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => (open ? closeMenu({ returnFocus: true }) : openMenu())}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={t.team.switcherLabel}
      className={`${triggerClassName} active:scale-[0.97] transition-transform`}
    >
      <span className={nameClassName}>{activeName}</span>
      <span className="text-faint flex-shrink-0"><ChevronIcon open={open} reduceMotion={reduceMotion} /></span>
    </button>
  )

  if (teams.length === 0) return null

  const itemRow = (team: TeamLidmaatschap) => {
    const isActive = team.teamId === activeTeamId
    const isPendingItem = pendingTeamId === team.teamId && isPending
    return (
      <button
        key={team.teamId}
        type="button"
        role="menuitemradio"
        aria-checked={isActive}
        aria-label={t.team.switchTo.replace('{team}', team.naam || t.team.activeTeam)}
        onClick={() => handleSwitch(team.teamId)}
        disabled={isPending}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[14px] font-semibold transition-colors hover:bg-surface-sunken disabled:cursor-default"
        style={{ opacity: isPendingItem ? 0.6 : 1 }}
      >
        <span className={isActive ? 'text-brand-accent flex-shrink-0 w-4' : 'flex-shrink-0 w-4'}>
          {isPendingItem ? <Spinner /> : isActive ? <CheckIcon /> : null}
        </span>
        <span className={`flex-1 truncate ${isActive ? 'text-brand-accent' : 'text-ink'}`}>{team.naam || t.team.activeTeam}</span>
      </button>
    )
  }

  const createBlock = showCreate ? (
    <div className="px-4 py-3 border-t border-[var(--border-soft)] flex flex-col gap-2">
      <p className="text-[12.5px] font-bold text-ink">{t.team.createTeamTitle}</p>
      <label className="text-[11px] font-bold text-faint uppercase tracking-wide" htmlFor={`team-switcher-naam-${variant}`}>
        {t.team.createTeamNameLabel}
      </label>
      <input
        id={`team-switcher-naam-${variant}`}
        type="text"
        value={naam}
        onChange={(e) => setNaam(e.target.value)}
        maxLength={80}
        autoFocus
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-soft)] bg-surface text-ink text-sm focus:outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20"
      />
      <button
        type="button"
        onClick={handleCreate}
        disabled={!naam.trim() || isPending}
        className="w-full py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50 active:scale-[0.98] transition"
        style={{ background: 'var(--primary)' }}
      >
        {isPending ? t.team.creating : t.team.createTeam}
      </button>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setShowCreate(true)}
      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[14px] font-semibold text-primary-strong hover:bg-surface-sunken transition-colors border-t border-[var(--border-soft)]"
    >
      <span className="flex-shrink-0 w-4"><PlusIcon /></span>
      {t.team.createTeam}
    </button>
  )

  const panelBody = (
    <>
      <div className="px-4 py-2.5 border-b border-[var(--border-soft)]">
        <span className="text-[11px] font-bold text-faint uppercase tracking-wide">{t.team.switcherLabel}</span>
      </div>
      <div role="menu" aria-label={t.team.switcherLabel} className="py-1 max-h-[50vh] overflow-y-auto">
        {teams.map(itemRow)}
      </div>
      {error && (
        <div className="px-4 py-2 text-[12.5px] font-semibold text-danger">{error}</div>
      )}
      {createBlock}
    </>
  )

  if (!mounted) {
    return <div ref={containerRef} className="relative min-w-0">{trigger}</div>
  }

  if (variant === 'desktop') {
    return (
      <div ref={containerRef} className="relative min-w-0">
        {trigger}
        {open && (
          <div
            role="presentation"
            className="absolute left-0 top-full mt-2 z-[var(--z-sheet)] w-72 rounded-2xl bg-surface shadow-2xl overflow-hidden"
            style={{
              border: '1px solid var(--border-soft)',
              transformOrigin: 'top left',
              transform: reduceMotion ? 'none' : visible ? 'scale(1)' : 'scale(0.96)',
              opacity: visible ? 1 : 0,
              transition: reduceMotion
                ? `opacity ${visible ? enterMs : exitMs}ms ease-out`
                : visible
                  ? `transform ${enterMs}ms cubic-bezier(0.23, 1, 0.32, 1), opacity ${enterMs}ms ease-out`
                  : `transform ${exitMs}ms ease-out, opacity ${exitMs}ms ease-out`,
            }}
          >
            {panelBody}
          </div>
        )}
      </div>
    )
  }

  // variant === 'mobile': bottom-sheet via portal, zelfde onderliggende
  // patroon als GlobalFab.tsx (backdrop + kaart, gemount in document.body).
  const overlay = open ? createPortal(
    <>
      <div
        onClick={() => closeMenu()}
        style={{
          position: 'fixed', inset: 0, zIndex: 'var(--z-scrim)',
          background: 'rgba(0,0,0,0.30)',
          opacity: visible ? 1 : 0,
          transition: `opacity ${visible ? enterMs : exitMs}ms ease-out`,
        }}
      />
      <div
        className="rounded-t-3xl bg-surface shadow-2xl overflow-hidden"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 'var(--z-sheet)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          transform: reduceMotion ? 'none' : visible ? 'translateY(0)' : 'translateY(100%)',
          opacity: reduceMotion ? (visible ? 1 : 0) : 1,
          transition: reduceMotion
            ? `opacity ${visible ? enterMs : exitMs}ms ease-out`
            : `transform ${visible ? enterMs : exitMs}ms cubic-bezier(0.32, 0.72, 0, 1)`,
        }}
      >
        {panelBody}
      </div>
    </>,
    document.body,
  ) : null

  return (
    <>
      <div ref={containerRef} className="min-w-0">{trigger}</div>
      {overlay}
    </>
  )
}
