// "Vandaag" voor het startscherm, los van de klok/tijdzone van het
// serverproces. Pure helpers, geen 'use server', geen Supabase.
//
// Waarom: todayLocal() (lib/utils.ts) leest de lokale klok van het proces. Op
// een UTC-server loopt die tussen 00:00 en 01:00/02:00 Nederlandse tijd een
// dag achter (geheugen.md, C20). Het startscherm rekent daarom alles vanuit
// één expliciete kalenderdag in Europe/Amsterdam. Andere pagina's houden
// bewust todayLocal(); dat verschil is geaccepteerd (C20 buiten scope).
//
// Datums zijn 'YYYY-MM-DD'-strings, net als events.date (zie lib/todos.mjs).

export const TIJDZONE_STARTSCHERM = 'Europe/Amsterdam'

const MS_PER_DAG = 86_400_000
const DATUM_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Kalenderdag 'YYYY-MM-DD' van `nu` in `tijdzone`. Samengesteld uit de parts
 * van Intl.DateTimeFormat (niet uit een locale-afhankelijke string). Een
 * onbekende tijdzone gooit een RangeError (Intl).
 */
export function vandaagIn(tijdzone: string, nu: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tijdzone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(nu)
  const deel = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)?.value ?? ''
  const jaar = deel('year').padStart(4, '0')
  return `${jaar}-${deel('month')}-${deel('day')}`
}

// Ongeldige invoer → NaN (geen exception): net als het oude daysUntil, zodat
// één kapotte datum het startscherm niet laat crashen. Elke vergelijking met
// NaN is false, dus zo'n taak valt via isTaskVisible stil weg.
function utcMiddernacht(datum: string): number {
  const m = typeof datum === 'string' ? DATUM_RE.exec(datum) : null
  if (!m) return Number.NaN
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/**
 * Hele kalenderdagen van `van` naar `tot` (beide 'YYYY-MM-DD'). Rekent via
 * Date.UTC en is daardoor ongevoelig voor zomer-/wintertijd en voor de
 * tijdzone van het proces. 0 = zelfde dag, 1 = dag erna, negatief = ervoor.
 * Ongeldige datum → NaN.
 */
export function dagenTussen(van: string, tot: string): number {
  return Math.round((utcMiddernacht(tot) - utcMiddernacht(van)) / MS_PER_DAG)
}
