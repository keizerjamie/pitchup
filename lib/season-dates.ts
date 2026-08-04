// Tijdzone-onafhankelijke datumrekenkunde voor het genereren van
// seizoenstrainingen.
//
// De rest van de app parseert kalenderdatums bewust als lokale middernacht
// (`new Date(str + 'T00:00:00')`, zie lib/utils.ts) omdat het daar om *tonen*
// gaat in de tijdzone van de bezoeker. Op de server mag dat juist niet: een
// Vercel-lambda draait in UTC en een gebruiker in Europe/Amsterdam. `getDay()`
// en `getFullYear()` op een lokaal geparste datum kunnen dan een andere dag
// opleveren dan de gebruiker bedoelde, waardoor trainingen op de verkeerde
// weekdag terechtkomen.
//
// Daarom rekenen we hier uitsluitend met UTC-componenten: 'YYYY-MM-DD' gaat via
// Date.UTC naar milliseconden en via getUTC*() weer terug. Het resultaat is
// hetzelfde in elke server-tijdzone. Er komt geen tijdstip aan te pas — de
// kolom `events.date` is een kale kalenderdatum.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const DAY_MS = 86_400_000

// Bovengrens op het aantal dagen dat één generatie mag overspannen. Zonder
// grens bepaalt de (door de gebruiker gekozen) einddatum hoe lang de lus loopt
// en hoeveel rijen er in het geheugen komen.
export const MAX_SEASON_DAYS = 800

// Is dit een echte kalenderdatum in 'YYYY-MM-DD'? Weigert ook 2026-02-30 en
// 2026-13-01, die `Date` stilzwijgend zou doorrollen naar een andere maand.
export function isDateString(value: unknown): value is string {
  return typeof value === 'string' && toUtcMs(value) !== null
}

// 'YYYY-MM-DD' → ms sinds epoch op middernacht UTC, of null bij een ongeldige
// of niet-bestaande datum.
export function toUtcMs(dateStr: string): number | null {
  if (!DATE_RE.test(dateStr)) return null
  const [year, month, day] = dateStr.split('-').map(Number)
  const ms = Date.UTC(year, month - 1, day)
  // Doorgerolde datums (2026-02-30 → 2026-03-02) vallen hier af.
  return fromUtcMs(ms) === dateStr ? ms : null
}

// ms sinds epoch → 'YYYY-MM-DD' in UTC.
export function fromUtcMs(ms: number): string {
  const d = new Date(ms)
  const y = String(d.getUTCFullYear()).padStart(4, '0')
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Weekdag van een kalenderdatum (0 = zondag, zoals Date#getDay), of null als de
// datum ongeldig is.
export function weekdayOf(dateStr: string): number | null {
  const ms = toUtcMs(dateStr)
  return ms === null ? null : new Date(ms).getUTCDay()
}

export type SeasonDatesResult =
  | { ok: true; dates: string[] }
  | { ok: false; reason: 'invalid-date' | 'end-before-start' | 'season-too-long' }

// Alle datums tussen `seasonStart` en `seasonEnd` (beide inclusief) die op een
// van de opgegeven weekdagen vallen, oplopend gesorteerd.
export function seasonTrainingDates(
  seasonStart: string,
  seasonEnd: string,
  trainingDays: number[],
): SeasonDatesResult {
  const start = toUtcMs(seasonStart)
  const end = toUtcMs(seasonEnd)
  if (start === null || end === null) return { ok: false, reason: 'invalid-date' }
  if (end < start) return { ok: false, reason: 'end-before-start' }
  if ((end - start) / DAY_MS + 1 > MAX_SEASON_DAYS) return { ok: false, reason: 'season-too-long' }

  const days = new Set(trainingDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))
  if (days.size === 0) return { ok: true, dates: [] }

  const dates: string[] = []
  for (let ms = start; ms <= end; ms += DAY_MS) {
    if (days.has(new Date(ms).getUTCDay())) dates.push(fromUtcMs(ms))
  }
  return { ok: true, dates }
}
