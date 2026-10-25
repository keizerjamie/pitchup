// Wat de knop "Afdrukken/Delen" op dit toestel doet.
//
//  - 'delen'     : touch-toestel of iOS-beginscherm-app, én bestanden delen
//                  (navigator.canShare met een PDF-bestand) kan.
//  - 'link'      : iOS-beginscherm-app zonder bestand-delen: window.print()
//                  doet daar niets, dus de "Link kopiëren"-noodroute.
//  - 'afdrukken' : alle andere gevallen (computer, of touch zonder bestand-delen).
//
// De server rendert altijd 'afdrukken'; de echte modus komt pas na hydration
// (useSyncExternalStore met server-snapshot), zodat er geen mismatch ontstaat.

import { useSyncExternalStore } from 'react'

export type DeelModus = 'delen' | 'link' | 'afdrukken'

export type DeelOmgeving = {
  isBeginschermApp: boolean
  isTouchToestel: boolean
  kanBestandDelen: boolean
}

export function bepaalDeelModus(env: DeelOmgeving): DeelModus {
  if ((env.isTouchToestel || env.isBeginschermApp) && env.kanBestandDelen) return 'delen'
  if (env.isBeginschermApp) return 'link'
  return 'afdrukken'
}

// iOS voert window.print() niet uit in de beginscherm-app. `navigator.standalone`
// bestaat alleen op iOS, dus een geïnstalleerde app op Android/desktop blijft printen.
export function isIosBeginschermApp(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isTouchToestel(): boolean {
  if (typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true
  // iPadOS meldt zich als Mac, maar heeft een touchscherm.
  return navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)
}

function kanBestandDelen(): boolean {
  if (typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.pdf', { type: 'application/pdf' })] }) === true
  } catch {
    return false
  }
}

function leesModus(): DeelModus {
  return bepaalDeelModus({
    isBeginschermApp: isIosBeginschermApp(),
    isTouchToestel: isTouchToestel(),
    kanBestandDelen: kanBestandDelen(),
  })
}

// De omgeving verandert niet tijdens de levensduur van de pagina.
function abonneer(): () => void {
  return () => {}
}

export function useDeelModus(): DeelModus {
  return useSyncExternalStore(abonneer, leesModus, () => 'afdrukken')
}
