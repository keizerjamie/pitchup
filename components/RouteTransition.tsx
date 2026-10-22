'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

// iOS-achtige paginaovergang (designronde 3, op verzoek van de eigenaar).
//
// Vervangt de eerdere React-<ViewTransition> (PageTransition.tsx), die op de
// iPhone stroperig voelde: hij wachtte tot de server klaar was en schoof dan
// de hele pagina. Deze versie:
// - animeert alleen de INHOUD; kop, zijbalk en onderbalk staan in AppShell
//   buiten dit element en blijven stil;
// - start zodra de route wisselt — met app/loading.tsx is dat meteen na de
//   tik, met het skeletscherm — en blokkeert nooit invoer;
// - gebruikt de Web Animations API, zodat de globale "geen beweging"-regel
//   in app/globals.css er niet aan raakt, en een nieuwe navigatie de lopende
//   animatie gewoon afbreekt (interruptible);
// - alleen transform + opacity, geen fill: na afloop staat er geen transform
//   meer op de wrapper (anders zouden `fixed` onderbladen in de pagina zich
//   aan deze wrapper vastzetten).
//
// Richting volgt de route-diepte: dieper = van rechts (vooruit), ondieper =
// van links (terug, zelfde pad), tussen tabbladen of op gelijke diepte = een
// korte vervaging. Bij prefers-reduced-motion altijd alleen vervagen.

export type Richting = 'vooruit' | 'terug' | 'vervaag'

const TABBLADEN = new Set(['/', '/players', '/events', '/oefeningen', '/periodisering', '/inzichten', '/settings'])

const diepte = (pad: string) => pad.split('/').filter(Boolean).length

export function richtingVoor(vorige: string, volgende: string): Richting {
  if (TABBLADEN.has(vorige) && TABBLADEN.has(volgende)) return 'vervaag'
  const a = diepte(vorige)
  const b = diepte(volgende)
  if (b > a) return 'vooruit'
  if (b < a) return 'terug'
  return 'vervaag'
}

// Gezet door de in-app terugknop (components/BackButton.tsx) vlak vóór
// router.back(): die popstate komt dan van ons en moet wél animeren, ook in
// Safari-in-de-browser (alleen het systeem-veeggebaar animeert daar zelf).
let inAppTerug = false
export function markeerInAppTerug() {
  inAppTerug = true
}

const IOS_CURVE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const SCHUIF_PX = 28

function keyframesVoor(richting: Richting, verminderd: boolean): [Keyframe[], KeyframeAnimationOptions] {
  if (verminderd || richting === 'vervaag') {
    return [[{ opacity: 0 }, { opacity: 1 }], { duration: verminderd ? 150 : 180, easing: 'ease-out' }]
  }
  const start = richting === 'vooruit' ? SCHUIF_PX : -SCHUIF_PX
  return [
    [{ opacity: 0, transform: `translate3d(${start}px, 0, 0)` }, { opacity: 1, transform: 'translate3d(0, 0, 0)' }],
    { duration: 300, easing: IOS_CURVE },
  ]
}

// useLayoutEffect alleen in de browser (geen SSR-waarschuwing).
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export default function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const ref = useRef<HTMLDivElement>(null)
  const vorige = useRef(pathname)
  const animatie = useRef<Animation | null>(null)
  const viaGeschiedenis = useRef(false)

  useEffect(() => {
    const markeer = () => { viaGeschiedenis.current = true }
    window.addEventListener('popstate', markeer)
    return () => window.removeEventListener('popstate', markeer)
  }, [])

  useIsoLayoutEffect(() => {
    const van = vorige.current
    vorige.current = pathname
    const pop = viaGeschiedenis.current && !inAppTerug
    viaGeschiedenis.current = false
    inAppTerug = false
    const el = ref.current
    if (van === pathname || !el || typeof el.animate !== 'function') return

    // In Safari-in-de-browser (niet als beginscherm-app) animeert de
    // terug-veeggebaar zelf al; dan niet nog eens schuiven.
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    const touch = window.matchMedia?.('(pointer: coarse)').matches
    if (pop && touch && !standalone) return

    const verminderd = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    animatie.current?.cancel()
    const [frames, opties] = keyframesVoor(richtingVoor(van, pathname), verminderd)
    animatie.current = el.animate(frames, opties)
  }, [pathname])

  return <div ref={ref}>{children}</div>
}
