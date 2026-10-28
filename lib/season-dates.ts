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

// ── ISO-weken (maandag–zondag) ───────────────────────────────
// Zelfde regel als de rest van dit bestand: alleen strings en UTC-componenten
// (toUtcMs/fromUtcMs/weekdayOf), nooit `new Date(str + 'T00:00:00')`,
// `getDay()` of addDays uit lib/utils.ts (die rekenen lokaal). Zo valt een
// training in dezelfde week, ongeacht de tijdzone van server of browser — ook
// rond een zomertijdovergang, want een UTC-dag is altijd precies DAY_MS lang.

// Maandag van de ISO-week waarin `datum` valt ('YYYY-MM-DD'), of null bij een
// ongeldige datum. Een maandag blijft zichzelf, een zondag gaat naar de maandag
// ervóór (ISO: de week loopt van maandag t/m zondag).
export function maandagVanWeek(datum: string): string | null {
  const ms = toUtcMs(datum)
  const weekdag = weekdayOf(datum)
  if (ms === null || weekdag === null) return null
  const offset = (weekdag + 6) % 7
  return fromUtcMs(ms - offset * DAY_MS)
}

// ISO-weeknummer en ISO-jaar van `datum`, of null bij een ongeldige datum. De
// DONDERDAG van de week bepaalt het jaar: 2024-12-30 hoort bij week 1 van 2025,
// 2021-01-03 bij week 53 van 2020.
export function isoWeek(datum: string): { jaar: number; week: number } | null {
  const maandag = maandagVanWeek(datum)
  if (maandag === null) return null
  const donderdagMs = toUtcMs(maandag)! + 3 * DAY_MS
  const jaar = new Date(donderdagMs).getUTCFullYear()
  const dagVanJaar = Math.round((donderdagMs - Date.UTC(jaar, 0, 1)) / DAY_MS) + 1
  return { jaar, week: Math.floor((dagVanJaar - 1) / 7) + 1 }
}

// Bovengrens op het aantal weken dat wekenInVenster teruggeeft: een seizoen
// (MAX_SEASON_DAYS) plus een deelweek aan begin en eind.
export const MAX_WEKEN_IN_VENSTER = Math.ceil(MAX_SEASON_DAYS / 7) + 2

// De maandagen van elke ISO-week die het venster [start, end] (inclusief) raakt,
// chronologisch: van maandagVanWeek(start) t/m maandagVanWeek(end). De eerste en
// laatste week kunnen deelweken zijn. [] bij ongeldige invoer of end < start.
// De lus is begrensd op MAX_WEKEN_IN_VENSTER, zodat een onzinnig lang venster
// nooit onbegrensd rijen maakt.
export function wekenInVenster(start: string, end: string): string[] {
  const startMs = toUtcMs(start)
  const endMs = toUtcMs(end)
  if (startMs === null || endMs === null || endMs < startMs) return []
  const eerste = toUtcMs(maandagVanWeek(start)!)!
  const laatste = toUtcMs(maandagVanWeek(end)!)!
  const weken: string[] = []
  for (let ms = eerste; ms <= laatste && weken.length < MAX_WEKEN_IN_VENSTER; ms += 7 * DAY_MS) {
    weken.push(fromUtcMs(ms))
  }
  return weken
}
