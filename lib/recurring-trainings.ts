// Gedeelde types en pure functies voor "herhalende trainingen" (aanmaken van een
// wekelijks terugkerende training vanuit /events/new).
//
// Bewust GEEN 'use server': een `export type`/`export const` uit een
// 'use server'-bestand lekt in Turbopack als runtime-verwijzing en crasht dan
// pas in de browser — een fout die typecheck niet ziet (zelfde reden als
// lib/bulk-matches.ts). De server actions in app/actions/events-bulk.ts én het
// formulier gebruiken allebei dit bestand, zodat de teller in de browser exact
// dezelfde datums ziet als de server aanmaakt.
//
// Geen Date-object met lokale tijd en geen tijdzone-conversie: alle
// datumrekenkunde loopt via seasonTrainingDates (lib/season-dates.ts), dat
// uitsluitend met UTC-componenten van kale 'YYYY-MM-DD'-strings rekent. De
// weekdag van een datum is daardoor in elke server- of browsertijdzone gelijk,
// ook rond een zomertijdovergang.

import { MAX_SEASON_DAYS, isDateString, seasonTrainingDates } from '@/lib/season-dates'
import { formatTime, isTimeString } from '@/lib/utils'
import { MAX_LOCATION_CHARS } from '@/lib/bulk-matches'

// Bovengrens (in kalenderdagen, start en eind inclusief) van één herhaling.
// Dezelfde grens als het Trainingsschema; voor de melding 'too_long' ({max}).
export const MAX_RECURRING_DAYS = MAX_SEASON_DAYS

export type RecurringTrainingsErrorCode =
  | 'invalid_date' | 'invalid_time' | 'invalid_trainingstype'
  | 'location_too_long' | 'notes_too_long'
  | 'no_weekdays' | 'invalid_end_date' | 'end_before_start' | 'too_long'

export type RecurringTrainingsResult =
  | { ok: true; created: number; skipped: number; attendanceFailed: boolean }
  | { ok: false; error: RecurringTrainingsErrorCode }

// Voorinvulling van tijd, locatie en einddatum op /events/new.
export type NewTrainingDefaults = {
  time: string | null      // 'HH:MM' of null
  location: string | null  // getrimd, ≤ MAX_LOCATION_CHARS, of null
  seasonEnd: string | null // 'YYYY-MM-DD' of null
}

export const EMPTY_TRAINING_DEFAULTS: NewTrainingDefaults = { time: null, location: null, seasonEnd: null }

export type RecurringPlanErrorCode = Extract<
  RecurringTrainingsErrorCode,
  'invalid_date' | 'no_weekdays' | 'invalid_end_date' | 'end_before_start' | 'too_long'
>

export type RecurringPlan =
  | { ok: true; dates: string[]; toCreate: string[]; skipped: number }
  | { ok: false; error: RecurringPlanErrorCode }

const WEEKDAY_RE = /^[0-6]$/

// Kommalijst van weekdagen (0 = zondag … 6 = zaterdag, zoals Date#getUTCDay)
// → unieke, oplopend gesorteerde getallen. Lege segmenten vallen eerst weg
// (`''.split(',')` geeft [''] en `Number('')` is 0 — dat zou anders als
// "zondag" tellen, zie generateSeasonTrainings in app/actions/settings.ts).
// Alles wat geen enkel cijfer 0-6 is ('7', 'a', '1.5', '-1') valt weg.
export function parseRepeatDays(raw: unknown): number[] {
  if (typeof raw !== 'string') return []
  const days = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => WEEKDAY_RE.test(part))
    .map(Number)
  return [...new Set(days)].sort((a, b) => a - b)
}

// Welke datums een herhaling van `start` t/m `end` (beide inclusief) op de
// gekozen weekdagen oplevert, en welke daarvan nog niet als training bestaan.
// `existing` = datums waarop het team al een training heeft; die worden
// overgeslagen (dubbel-detectie alleen op datum). De eerste datum is vanzelf
// de eerste gekozen weekdag op of na `start`.
//
// De volgorde van de controles is gelijk aan die van createRecurringTrainings,
// zodat client en server dezelfde eerste fout melden.
export function planRecurringTrainings(
  start: string,
  end: string,
  days: number[],
  existing?: Set<string>,
): RecurringPlan {
  if (!isDateString(start)) return { ok: false, error: 'invalid_date' }
  const validDays = days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  if (validDays.length === 0) return { ok: false, error: 'no_weekdays' }
  if (!isDateString(end)) return { ok: false, error: 'invalid_end_date' }

  const result = seasonTrainingDates(start, end, validDays)
  if (!result.ok) {
    if (result.reason === 'end-before-start') return { ok: false, error: 'end_before_start' }
    if (result.reason === 'season-too-long') return { ok: false, error: 'too_long' }
    return { ok: false, error: 'invalid_end_date' }
  }

  const dates = result.dates
  const toCreate = existing ? dates.filter((date) => !existing.has(date)) : dates
  return { ok: true, dates, toCreate, skipped: dates.length - toCreate.length }
}

// ── Voorinvulling ────────────────────────────────────────────

// Database-TIME ('19:00:00') of settings-waarde → 'HH:MM', of null als het geen
// geldige kloktijd is. De settings-waarde wordt bij opslaan niet gevalideerd
// (saveScheduleSettings), dus hier wel.
function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const time = formatTime(value.trim())
  return isTimeString(time) ? time : null
}

// Getrimd en niet leeg, en niet langer dan wat de nieuwe flow accepteert
// (anders zou de voorinvulling zelf op 'location_too_long' stuklopen).
function normalizeLocation(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const location = value.trim()
  if (location === '' || location.length > MAX_LOCATION_CHARS) return null
  return location
}

// Bepaalt de voorinvulling per veld: eerst de laatst aangemaakte training van
// het team; is dat veld daar leeg of ongeldig, dan de teaminstelling
// (training_time / training_location); anders null. De einddatum komt
// uitsluitend uit season_end.
export function resolveNewTrainingDefaults(
  lastTraining: { time?: unknown; location?: unknown } | null,
  settings: Record<string, string | undefined>,
): NewTrainingDefaults {
  return {
    time: normalizeTime(lastTraining?.time) ?? normalizeTime(settings['training_time']),
    location: normalizeLocation(lastTraining?.location) ?? normalizeLocation(settings['training_location']),
    seasonEnd: isDateString(settings['season_end']) ? settings['season_end'] : null,
  }
}
