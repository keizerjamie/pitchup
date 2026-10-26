// Pure gebaarlogica voor de swipe-to-dismiss van components/ui/BottomSheet.tsx.
// Geen DOM, geen React: alle drempels staan hier zodat ze testbaar zijn.

/** Afstand (px) die de vinger moet afleggen voordat de richting wordt bepaald. */
export const SHEET_SLOP_PX = 8
/** Absolute sluitafstand (px); op lage bladen telt de fractie hieronder. */
export const SHEET_SLUIT_AFSTAND_PX = 120
/** Fractie van de bladhoogte die als sluitafstand telt als dat minder is dan 120px. */
export const SHEET_SLUIT_FRACTIE = 0.3
/** Neerwaartse snelheid (px/ms) vanaf waar een veeg als flick telt. */
export const SHEET_FLICK_SNELHEID = 0.5
/** Minimale afstand (px) voor een flick, zodat een toevallige tik niet sluit. */
export const SHEET_FLICK_MIN_PX = 24
/** Opwaartse snelheid (px/ms, negatief) waarbij loslaten nooit sluit. */
export const SHEET_OMHOOG_SNELHEID = -0.1
/** Duur (ms) van de sluitanimatie. */
export const SHEET_SLUIT_MS = 240
/** Duur (ms) van het terugveren. */
export const SHEET_TERUG_MS = 300
/** Tijdvenster (ms) waarover de loslaat-snelheid wordt gemeten. */
export const SHEET_SNELHEID_VENSTER_MS = 100

export interface GebaarMonster {
  y: number
  /** Tijd in ms (monotoon, bv. performance.now()). */
  t: number
}

export function moetSluiten({ dy, vy, hoogte }: { dy: number; vy: number; hoogte: number }): boolean {
  if (vy < SHEET_OMHOOG_SNELHEID) return false
  if (vy >= SHEET_FLICK_SNELHEID && dy >= SHEET_FLICK_MIN_PX) return true
  return dy >= Math.min(SHEET_SLUIT_AFSTAND_PX, SHEET_SLUIT_FRACTIE * hoogte)
}

/**
 * Progressieve weerstand voorbij een rand: hoe verder voorbij, hoe minder het
 * element volgt. Altijd kleiner dan `overshoot` en monotoon stijgend; de
 * uitkomst loopt asymptotisch naar `dimensie` toe.
 */
export function rubberband(overshoot: number, dimensie: number, c = 0.55): number {
  const teken = overshoot < 0 ? -1 : 1
  const o = Math.abs(overshoot)
  if (o === 0 || dimensie <= 0) return 0
  return teken * ((o * dimensie * c) / (dimensie + c * o))
}

/** Verticale snelheid in px/ms over de laatste ~100ms van de monsters. */
export function snelheid(historie: GebaarMonster[]): number {
  if (historie.length < 2) return 0
  const laatste = historie[historie.length - 1]
  let eerste = laatste
  for (let i = historie.length - 2; i >= 0; i--) {
    if (laatste.t - historie[i].t > SHEET_SNELHEID_VENSTER_MS) break
    eerste = historie[i]
  }
  const dt = laatste.t - eerste.t
  if (dt <= 0) return 0
  return (laatste.y - eerste.y) / dt
}
