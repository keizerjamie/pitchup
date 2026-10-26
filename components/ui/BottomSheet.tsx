'use client'

import { useCallback, useEffect, useId, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useDict } from '@/lib/i18n-context'
import { useReducedMotion } from '@/lib/use-reduced-motion'
import {
  SHEET_SLOP_PX,
  SHEET_SLUIT_MS,
  SHEET_TERUG_MS,
  moetSluiten,
  rubberband,
  snelheid,
  type GebaarMonster,
} from '@/lib/sheet-gebaar'

// Zelfde curve als .anim-sheet (globals.css): iOS-sheetcurve, geen doorschieten.
const CURVE = 'cubic-bezier(0.32, 0.72, 0, 1)'
// Reduced motion: sluiten = korte fade, geen beweging.
const REDUCED_SLUIT_MS = 150
// Zelfde marge als de andere exit-animaties (Toast, TeamSwitcher): net voorbij
// het einde van de overgang unmounten, zodat de laatste frame nooit wordt afgekapt.
const EXIT_MARGE_MS = 20
// Swipe alleen op telefoonbreedte (Jamie, V-E): onder sm, en alleen touch/pen.
const SWIPE_QUERY = '(max-width: 639.98px)'

interface Props {
  onClose: () => void
  titel: ReactNode
  ondertitel?: ReactNode
  /** Toegankelijk label van de sluitknop (aria-label). */
  sluitLabel: string
  toonSluitknop?: boolean
  /**
   * Ongeopslagen wijzigingen. Bij een veeg voorbij de drempel én bij een tik
   * op de achtergrond vraagt het blad eerst om bevestiging
   * (window.confirm(t.sheet.discardConfirm)). De sluitknop sluit altijd direct.
   */
  dirty?: boolean
  breedte?: 'md' | 'lg'
  className?: string
  wrapperClassName?: string
  /** Inhoud van de sticky voet (knoppenrij). */
  voet?: ReactNode
  children: ReactNode
}

interface Gebaar {
  pointerId: number
  startX: number
  startY: number
  actief: boolean
  dy: number
  historie: GebaarMonster[]
}

function captureIfSupported(el: Element, pointerId: number) {
  if (typeof (el as { setPointerCapture?: unknown }).setPointerCapture === 'function') {
    try {
      el.setPointerCapture(pointerId)
    } catch {
      // Pointer al weg (bv. synthetische events): volgen werkt ook zonder capture.
    }
  }
}

function releaseIfSupported(el: Element, pointerId: number) {
  if (typeof (el as { releasePointerCapture?: unknown }).releasePointerCapture === 'function') {
    try {
      el.releasePointerCapture(pointerId)
    } catch {
      // idem
    }
  }
}

function isSwipeOmgeving(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(SWIPE_QUERY).matches
}

// Gedeeld onderblad: scrim + sheet + sticky kop met greep, sluitknop en
// swipe-to-dismiss vanaf de kop. Inhoud scrolt via de bestaande
// overflow-y-auto op het blad; slepen kan alleen vanaf de kop zodat scrollen
// en slepen nooit met elkaar concurreren.
export default function BottomSheet({
  onClose,
  titel,
  ondertitel,
  sluitLabel,
  toonSluitknop = true,
  dirty = false,
  breedte = 'lg',
  className = '',
  wrapperClassName = '',
  voet,
  children,
}: Props) {
  const t = useDict()
  const reduced = useReducedMotion()
  const titelId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const gebaarRef = useRef<Gebaar | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bevestigTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sluitendRef = useRef(false)
  const bevestigtRef = useRef(false)

  // Houd de nieuwste props beschikbaar voor timers/handlers zonder ze te herstarten.
  const onCloseRef = useRef(onClose)
  const dirtyRef = useRef(dirty)
  const discardTekstRef = useRef(t.sheet.discardConfirm)
  const reducedRef = useRef(reduced)
  useEffect(() => {
    onCloseRef.current = onClose
    dirtyRef.current = dirty
    discardTekstRef.current = t.sheet.discardConfirm
    reducedRef.current = reduced
  })

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (bevestigTimerRef.current) clearTimeout(bevestigTimerRef.current)
    },
    [],
  )

  const zetTimer = useCallback((fn: () => void, ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      fn()
    }, ms)
  }, [])

  // Vanaf het eerste volgen moet de CSS-entree-animatie uit: .anim-sheet/.anim-scrim
  // hebben fill-mode `both` en zouden anders transform/opacity overschrijven.
  function neemOver() {
    const sheet = sheetRef.current
    const scrim = scrimRef.current
    if (sheet) {
      sheet.style.animation = 'none'
      sheet.style.transition = 'none'
    }
    if (scrim) {
      scrim.style.animation = 'none'
      scrim.style.transition = 'none'
    }
  }

  function volg(dy: number, hoogte: number) {
    const sheet = sheetRef.current
    const scrim = scrimRef.current
    const verschuiving = dy >= 0 ? dy : rubberband(dy, hoogte)
    if (sheet) sheet.style.transform = `translateY(${verschuiving}px)`
    if (scrim) scrim.style.opacity = String(1 - Math.min(Math.max(dy / hoogte, 0), 1))
  }

  function terugVeren() {
    const sheet = sheetRef.current
    const scrim = scrimRef.current
    if (reducedRef.current) {
      if (sheet) {
        sheet.style.transition = 'none'
        sheet.style.transform = ''
      }
      if (scrim) {
        scrim.style.transition = 'none'
        scrim.style.opacity = ''
      }
      return
    }
    if (sheet) {
      sheet.style.transition = `transform ${SHEET_TERUG_MS}ms ${CURVE}`
      sheet.style.transform = 'translateY(0px)'
    }
    if (scrim) {
      scrim.style.transition = `opacity ${SHEET_TERUG_MS}ms ${CURVE}`
      scrim.style.opacity = '1'
    }
    zetTimer(() => {
      // animation blijft 'none': terugzetten zou de entree-animatie herstarten.
      if (sheet) {
        sheet.style.transition = 'none'
        sheet.style.transform = ''
      }
      if (scrim) {
        scrim.style.transition = 'none'
        scrim.style.opacity = ''
      }
    }, SHEET_TERUG_MS)
  }

  function sluitMetAnimatie() {
    if (sluitendRef.current) return
    sluitendRef.current = true
    const sheet = sheetRef.current
    const scrim = scrimRef.current
    neemOver()
    if (reducedRef.current) {
      if (sheet) {
        sheet.style.transition = `opacity ${REDUCED_SLUIT_MS}ms ease-out`
        sheet.style.opacity = '0'
      }
      if (scrim) {
        scrim.style.transition = `opacity ${REDUCED_SLUIT_MS}ms ease-out`
        scrim.style.opacity = '0'
      }
      zetTimer(() => onCloseRef.current(), REDUCED_SLUIT_MS + EXIT_MARGE_MS)
      return
    }
    if (sheet) {
      sheet.style.transition = `transform ${SHEET_SLUIT_MS}ms ${CURVE}`
      sheet.style.transform = 'translateY(100%)'
    }
    if (scrim) {
      scrim.style.transition = 'opacity 200ms ease-out'
      scrim.style.opacity = '0'
    }
    zetTimer(() => onCloseRef.current(), SHEET_SLUIT_MS + EXIT_MARGE_MS)
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (sluitendRef.current || bevestigtRef.current) return
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
    if (!isSwipeOmgeving()) return
    if (gebaarRef.current) return // tweede vinger: negeren
    if (timerRef.current) {
      // Nieuw gebaar tijdens terugveren: lopende opruiming annuleren.
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    gebaarRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      actief: false,
      dy: 0,
      historie: [{ y: e.clientY, t: performance.now() }],
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const g = gebaarRef.current
    if (!g || e.pointerId !== g.pointerId) return
    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (!g.actief) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SHEET_SLOP_PX) return
      if (Math.abs(dx) > Math.abs(dy)) {
        gebaarRef.current = null
        return
      }
      g.actief = true
      captureIfSupported(e.currentTarget, e.pointerId)
      neemOver()
    }
    g.dy = dy
    g.historie.push({ y: e.clientY, t: performance.now() })
    if (g.historie.length > 12) g.historie.shift()
    const hoogte = Math.max(sheetRef.current?.getBoundingClientRect().height ?? 0, 1)
    volg(dy, hoogte)
  }

  function eindig(e: ReactPointerEvent<HTMLDivElement>, geannuleerd: boolean) {
    const g = gebaarRef.current
    if (!g || e.pointerId !== g.pointerId) return
    gebaarRef.current = null
    if (!g.actief) return
    releaseIfSupported(e.currentTarget, e.pointerId)
    const hoogte = Math.max(sheetRef.current?.getBoundingClientRect().height ?? 0, 1)
    const voorbijDrempel = !geannuleerd && moetSluiten({ dy: g.dy, vy: snelheid(g.historie), hoogte })
    if (!voorbijDrempel) {
      terugVeren()
      return
    }
    if (!dirtyRef.current) {
      sluitMetAnimatie()
      return
    }
    // Dirty: eerst terugveren (zodat het blad zichtbaar blijft staan), daarna
    // pas vragen. window.confirm blokkeert de main thread; zonder de wacht
    // zou het terugveren nooit getekend worden.
    terugVeren()
    bevestigtRef.current = true
    bevestigTimerRef.current = setTimeout(() => {
      bevestigTimerRef.current = null
      const sluiten = window.confirm(discardTekstRef.current)
      bevestigtRef.current = false
      if (sluiten) sluitMetAnimatie()
    }, reducedRef.current ? 0 : SHEET_TERUG_MS + EXIT_MARGE_MS)
  }

  function onScrimClick() {
    if (sluitendRef.current || bevestigtRef.current) return
    if (dirty && !window.confirm(t.sheet.discardConfirm)) return
    onClose()
  }

  const titelEl = (
    <h3 id={titelId} className="min-w-0 font-bold text-ink text-lg">
      {titel}
    </h3>
  )

  return (
    <div className={`fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center ${wrapperClassName}`}>
      <div ref={scrimRef} className="anim-scrim absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onScrimClick} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titelId}
        className={`anim-sheet relative w-full ${breedte === 'md' ? 'max-w-md' : 'max-w-lg'} bg-surface rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92dvh] overflow-y-auto ${className}`}
      >
        {/* Kop: sleepvlak. touch-action: none (alleen op telefoonbreedte) zodat de browser de veeg niet als scroll overneemt. */}
        <div
          data-testid="bottom-sheet-kop"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => eindig(e, false)}
          onPointerCancel={(e) => eindig(e, true)}
          className="sticky top-0 z-10 bg-surface border-b border-[var(--border-soft)] rounded-t-3xl sm:rounded-t-2xl max-sm:touch-none"
        >
          <div aria-hidden="true" className="sm:hidden mx-auto mt-2 w-9 h-[5px] rounded-full bg-[var(--border-soft)]" />
          <div className="px-5 pt-3 pb-4 sm:pt-4 flex items-center justify-between gap-3">
            {ondertitel ? (
              <div className="min-w-0">
                {titelEl}
                <p className="text-xs text-faint mt-1">{ondertitel}</p>
              </div>
            ) : (
              titelEl
            )}
            {toonSluitknop && (
              <button
                type="button"
                onClick={onClose}
                aria-label={sluitLabel}
                className="relative hit-slop w-8 h-8 rounded-full bg-surface-sunken flex items-center justify-center flex-shrink-0 text-faint hover:bg-surface-sunken"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {children}

        {voet && (
          <div className="sticky bottom-0 bg-surface border-t border-[var(--border-soft)] p-4 flex gap-3">{voet}</div>
        )}
      </div>
    </div>
  )
}
