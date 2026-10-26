'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Button, { IconButton } from '@/components/ui/Button'
import { useDict } from '@/lib/i18n-context'
import { useReducedMotion } from '@/lib/use-reduced-motion'

// Eén toast tegelijk ("Ongedaan maken" na een verwijderactie, UT). Een nieuwe
// toast vervangt de vorige direct. Bewust geen library en geen stapel: er is
// altijd maar één ongedaan-te-maken-actie relevant.

export const TOAST_DUUR_MS = 5000
export const TOAST_EXIT_MS = 150

export type ToastInput = {
  bericht: string
  toon?: 'info' | 'fout'
  actie?: { label: string; onActie: () => Promise<void>; foutBericht: string }
}

export type ToastApi = {
  toon(input: ToastInput): void
  sluit(): void
}

// Zonder provider (tests renderen componenten los, zonder AppShell) is toast
// bewust een no-op.
const GEEN_TOAST: ToastApi = { toon() {}, sluit() {} }
const ToastContext = createContext<ToastApi>(GEEN_TOAST)

export function useToast(): ToastApi {
  return useContext(ToastContext)
}

type Item = { key: number; input: ToastInput }

export function ToastProvider({ teamId, children }: { teamId: string | null; children: ReactNode }) {
  const t = useDict()
  const reduceMotion = useReducedMotion()
  const [item, setItem] = useState<Item | null>(null)
  const [zichtbaar, setZichtbaar] = useState(false)
  const [vertrekt, setVertrekt] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const [verborgen, setVerborgen] = useState(false)
  const [vorigTeamId, setVorigTeamId] = useState(teamId)

  const keyRef = useRef(0)
  const itemKeyRef = useRef<number | null>(null)
  const restRef = useRef(TOAST_DUUR_MS)
  const timerKeyRef = useRef<number | null>(null)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bezigRef = useRef(false)
  const teamIdRef = useRef(teamId)

  // Teamwissel wist de toast (patroon: state aanpassen tijdens render).
  if (teamId !== vorigTeamId) {
    setVorigTeamId(teamId)
    setItem(null)
    setZichtbaar(false)
    setBezig(false)
    setHover(false)
    setFocus(false)
  }
  useEffect(() => {
    teamIdRef.current = teamId
    itemKeyRef.current = null
    bezigRef.current = false
  }, [teamId])

  const sluit = useCallback(() => {
    const key = itemKeyRef.current
    if (key === null) return
    setZichtbaar(false)
    setVertrekt(true)
    // De toast verdwijnt (soms) onder de cursor/focus zonder pointerleave/blur:
    // pauzestatus hoort niet door te lekken naar de volgende toast.
    setHover(false)
    setFocus(false)
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    exitTimerRef.current = setTimeout(() => {
      if (itemKeyRef.current === key) {
        itemKeyRef.current = null
        setItem(null)
        setBezig(false)
        bezigRef.current = false
      }
    }, TOAST_EXIT_MS + 20)
  }, [])

  const toon = useCallback((input: ToastInput) => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    const key = ++keyRef.current
    itemKeyRef.current = key
    bezigRef.current = false
    setBezig(false)
    setHover(false)
    setFocus(false)
    setItem({ key, input })
    setZichtbaar(false)
    setVertrekt(false)
    // Dubbele rAF: eerst de begintoestand laten painten, dan pas de transitie
    // starten (patroon TeamSwitcher).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (itemKeyRef.current === key) setZichtbaar(true)
      }),
    )
  }, [])

  const api = useMemo<ToastApi>(() => ({ toon, sluit }), [toon, sluit])

  useEffect(() => {
    function onVisibility() {
      setVerborgen(document.visibilityState === 'hidden')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Aftelling: pauzeert bij hover, focus binnen de toast, verborgen tab of een
  // lopende actie, en hervat met de resterende tijd.
  const gepauzeerd = hover || focus || verborgen || bezig
  const itemKey = item?.key ?? null
  useEffect(() => {
    if (itemKey === null) return
    // Nieuwe toast: volle tijd (de cleanup van de vorige effect-run is al klaar).
    if (timerKeyRef.current !== itemKey) {
      timerKeyRef.current = itemKey
      restRef.current = TOAST_DUUR_MS
    }
    if (gepauzeerd) return
    const start = Date.now()
    const timer = setTimeout(() => sluit(), restRef.current)
    return () => {
      clearTimeout(timer)
      restRef.current = Math.max(0, restRef.current - (Date.now() - start))
    }
  }, [itemKey, gepauzeerd, sluit])

  useEffect(
    () => () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    },
    [],
  )

  async function voerActieUit(key: number, actie: NonNullable<ToastInput['actie']>) {
    if (bezigRef.current) return
    bezigRef.current = true
    setBezig(true)
    try {
      await actie.onActie()
      if (itemKeyRef.current === key && teamIdRef.current === teamId) sluit()
    } catch {
      if (itemKeyRef.current === key && teamIdRef.current === teamId) {
        toon({ bericht: actie.foutBericht, toon: 'fout' })
      }
    }
  }

  const fout = item?.input.toon === 'fout'
  const actie = item?.input.actie

  const kaart = item && (
    <div
        key={item.key}
        data-testid="toast-kaart"
        role={fout ? 'alert' : 'status'}
        aria-live={fout ? 'assertive' : 'polite'}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onFocus={() => setFocus(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false)
        }}
        className={`motion-ok pointer-events-auto flex items-center gap-2 rounded-2xl border pl-4 pr-2 py-2 shadow-2xl ${
          fout ? 'bg-panel-red border-panel-red-edge text-panel-red-ink' : 'bg-surface border-[var(--border-soft)] text-ink'
        }`}
        style={{
          opacity: zichtbaar ? 1 : 0,
          transform: reduceMotion ? 'none' : zichtbaar ? 'translateY(0)' : vertrekt ? 'translateY(4px)' : 'translateY(8px)',
          transition: zichtbaar
            ? reduceMotion
              ? 'opacity 200ms cubic-bezier(0.23, 1, 0.32, 1)'
              : 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1), opacity 200ms cubic-bezier(0.23, 1, 0.32, 1)'
            : reduceMotion
              ? `opacity ${TOAST_EXIT_MS}ms ease-out`
              : `transform ${TOAST_EXIT_MS}ms ease-out, opacity ${TOAST_EXIT_MS}ms ease-out`,
        }}
      >
        <span className="flex-1 min-w-0 text-sm font-semibold">{item.input.bericht}</span>
        {actie && (
          <Button
            variant="ghost"
            size="md"
            loading={bezig}
            onClick={() => voerActieUit(item.key, actie)}
          >
            {actie.label}
          </Button>
        )}
        <IconButton aria-label={t.common.close} onClick={sluit}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
          </svg>
        </IconButton>
      </div>
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {item && (
        <div
          data-testid="toast-viewport"
          className="pointer-events-none fixed left-4 right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+156px)] md:left-[calc(16rem+1.5rem)] md:right-auto md:bottom-6 md:max-w-sm md:w-full z-[var(--z-toast)]"
        >
          {kaart}
        </div>
      )}
    </ToastContext.Provider>
  )
}
