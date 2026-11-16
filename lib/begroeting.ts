// Begroeting op het dashboard ("Goedemorgen/Goedemiddag/Goedenavond"). Pure
// helpers, geen 'use client' en geen 'use server'. De component rekent het uur
// in Europe/Amsterdam (lokaalUur met TIJDZONE_STARTSCHERM), op server én
// client dezelfde klok-definitie als de datumregel en de kaarten.

export type Dagdeel = 'morning' | 'afternoon' | 'evening'

export type BegroetingLabels = Record<Dagdeel, string>

// Vanaf dit uur is het middag, vanaf GRENS_AVOND avond.
export const GRENS_MIDDAG = 12
export const GRENS_AVOND = 18

// 0..11 ochtend, 12..17 middag, 18..23 avond.
export function begroetingVoorUur(uur: number): Dagdeel {
  if (uur < GRENS_MIDDAG) return 'morning'
  if (uur < GRENS_AVOND) return 'afternoon'
  return 'evening'
}

// Het uur (0..23) van `date` in `timeZone`. Zonder timeZone: de tijdzone van
// de omgeving (in de browser die van het apparaat, gelijk aan getHours()).
// Een onbekende tijdzone gooit niet maar valt terug op getHours().
export function lokaalUur(date: Date, timeZone?: string): number {
  if (!timeZone) return date.getHours()
  try {
    const delen = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(date)
    const uur = Number(delen.find((d) => d.type === 'hour')?.value)
    return Number.isInteger(uur) && uur >= 0 && uur <= 23 ? uur : date.getHours()
  } catch {
    return date.getHours()
  }
}
