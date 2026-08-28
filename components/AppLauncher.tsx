'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useDict } from '@/lib/i18n-context'
import { useReducedMotion } from '@/lib/use-reduced-motion'

// Exit is sneller dan de veerkrachtige entree — zelfde asymmetrie als GlobalFab.
const CLOSE_MS = 200

const emptySubscribe = () => () => {}

// De onderdelen die op mobiel GEEN eigen tab in de balk hebben. De balk houdt
// alleen de basis (Hoofdpagina, Spelers, Kalender); al het overige zit hier.
// Navigation.tsx importeert deze lijst om te bepalen wanneer de "Meer"-tab de
// actieve tab is — zo kunnen balk en paneel niet uit elkaar lopen.
//
// Alle vier de icoonnamen zitten in de gesubsette Material Symbols-font
// (gecontroleerd tegen de GSUB-ligatuurtabel); een ontbrekende glyph zou
// letterlijk de tekst tonen, zie components/icons/AppsIcon.tsx.
export const LAUNCHER_ITEMS = [
  { href: '/oefeningen', icon: 'sports_soccer', labelKey: 'oefeningen' },
  { href: '/periodisering', icon: 'monitoring', labelKey: 'periodization' },
  { href: '/inzichten', icon: 'scoreboard', labelKey: 'insights' },
  { href: '/settings', icon: 'settings', labelKey: 'settings' },
] as const

export default function AppLauncher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useDict()
  const reduceMotion = useReducedMotion()
  // true na hydratie op de client, false tijdens SSR — portal-veilig.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted) return null

  return createPortal(
    // Blijft altijd gemonteerd en schakelt op `visibility` i.p.v. te
    // (un)mounten: zo animeren zowel openen als sluiten zonder mount-timing in
    // een effect, en houdt `visibility: hidden` de tegels tegelijk uit de
    // tabvolgorde en de toegankelijkheidsboom zolang het paneel dicht is.
    //
    // --z-modal, niet --z-sheet: de FAB (--z-fab) zweeft precies boven de
    // navigatiebalk en zou anders dwars door dit paneel heen prikken. De
    // z-ladder in app/globals.css merkt --z-modal expliciet aan als de laag
    // die álles dekt, de FAB incluis.
    <div
      className="fixed inset-0 z-[var(--z-modal)] md:hidden"
      style={{
        visibility: open ? 'visible' : 'hidden',
        transition: open ? 'visibility 0s' : `visibility 0s linear ${CLOSE_MS}ms`,
      }}
    >
      <div
        onClick={onClose}
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background: 'rgba(0,0,0,0.28)',
          backdropFilter: open ? 'blur(6px)' : 'blur(0px)',
          WebkitBackdropFilter: open ? 'blur(6px)' : 'blur(0px)',
          opacity: open ? 1 : 0,
          transition: 'opacity 0.25s ease, backdrop-filter 0.25s ease, -webkit-backdrop-filter 0.25s ease',
        }}
      />

      {/* Paneel zweeft net boven de navigatiebalk (balkhoogte 62px + zijn eigen
          onderpadding), zodat de ruimtelijke band met de "Meer"-tab intact blijft. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.nav.moreTitle}
        className="absolute left-0 right-0 px-3"
        style={{
          bottom: 'calc(max(env(safe-area-inset-bottom), 10px) + 82px)',
          transform: reduceMotion ? 'none' : open ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.97)',
          transformOrigin: 'bottom center',
          opacity: open ? 1 : 0,
          transition: open
            ? 'transform 0.34s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.22s ease-out'
            : `transform ${CLOSE_MS}ms cubic-bezier(0.23, 1, 0.32, 1), opacity ${CLOSE_MS}ms ease-out`,
        }}
      >
        <div className="surface-card p-4 flex flex-col gap-3">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint">
            {t.nav.moreTitle}
          </span>
          <div className="grid grid-cols-2 gap-2">
            {LAUNCHER_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                tabIndex={open ? undefined : -1}
                className="flex flex-col items-center gap-1.5 py-3 px-1 rounded-[12px] bg-surface-sunken transition-colors hover:bg-surface active:scale-[0.98]"
                style={{ border: '1px solid var(--border-soft)' }}
              >
                <span className="ms text-[24px] text-brand-accent">{item.icon}</span>
                <span className="text-[11px] font-bold text-muted text-center leading-tight">
                  {t.nav[item.labelKey]}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
