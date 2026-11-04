// Begroeting op het dashboard ("Goedemorgen/Goedemiddag/Goedenavond"). Pure
// helpers, geen 'use client' en geen 'use server': de server rendert een
// eerste begroeting, en een inline script (begroetingScript) corrigeert die
// vóór de eerste paint op basis van de klok van het APPARAAT. De server draait
// in UTC, dus zonder die correctie zei het dashboard tussen 00:00 en 01:00
// Nederlandse tijd "Goedenavond". Patroon: Next-docs "Preventing flash before
// hydration" (inline script + suppressHydrationWarning).

export type Dagdeel = 'morning' | 'afternoon' | 'evening'

export type BegroetingLabels = Record<Dagdeel, string>

// Vanaf dit uur is het middag, vanaf GRENS_AVOND avond. Eén bron voor zowel
// begroetingVoorUur als het inline script (dat ze als getal inbakt).
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

// JSON.stringify escapet aanhalingstekens en backslashes, maar niet `<`: een
// label met "</script>" zou het script-element voortijdig sluiten. De escape
// \u003c is binnen een JS-string gelijkwaardig aan `<`. Idem U+2028/U+2029
// (regelscheidingstekens die oudere JS-parsers in een string weigeren).
function veiligJson(waarde: unknown): string {
  return JSON.stringify(waarde)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

// De broncode van het inline script: zet de tekst van het element met dit id
// op de begroeting van het uur van het apparaat. Zelfde grenzen als
// begroetingVoorUur (GRENS_MIDDAG/GRENS_AVOND). Doet niets als het element
// ontbreekt. Id en labels gaan via veiligJson het script in, nooit rauw.
export function begroetingScript(id: string, labels: BegroetingLabels): string {
  const l = { morning: labels.morning, afternoon: labels.afternoon, evening: labels.evening }
  return (
    `{var n=document.getElementById(${veiligJson(id)});` +
    `if(n){var h=new Date().getHours(),l=${veiligJson(l)};` +
    `n.textContent=h<${GRENS_MIDDAG}?l.morning:h<${GRENS_AVOND}?l.afternoon:l.evening}}`
  )
}
