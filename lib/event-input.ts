// Gedeelde invoervalidatie voor het aanmaken én bewerken van een training of
// wedstrijd (createEvent en updateEvent in app/actions/events.ts).
//
// Bewust een gewoon lib-bestand en geen 'use server': een server-action-bestand
// mag alleen async functies exporteren, en hier staan types, constanten en een
// synchrone functie.
//
// Geen tijdzone-conversie en geen Date-object: events.date en events.time zijn
// kale lokale wandklokwaarden (DATE/TIME), precies zoals de trainer ze invoert
// — zie isTimeString in lib/utils.ts en isDateString in lib/season-dates.ts.

import type { HomeAway, MatchType } from '@/lib/types'
import { isDateString } from '@/lib/season-dates'
import { isTimeString } from '@/lib/utils'

export const VALID_MATCH_TYPES: MatchType[] = ['friendly', 'league', 'cup']
export const VALID_HOME_AWAY: HomeAway[] = ['home', 'away']

export type EventInputErrorCode =
  | 'invalid_date'
  | 'invalid_time'
  | 'invalid_match_type'
  | 'invalid_home_away'

// De codes die updateEvent kan teruggeven. De eerste vier komen uit
// parseEventBaseInput; 'opponent_required' en 'not_found' bepaalt de action zelf.
export type EventUpdateErrorCode = EventInputErrorCode | 'opponent_required' | 'not_found'

export type EventBaseInput = {
  date: string
  time: string | null
  location: string | null
  notes: string | null
  // null bij een training.
  match: { opponent: string; match_type: MatchType; home_away: HomeAway } | null
}

// De meldingen die createEvent gooit. updateEvent geeft de code zelf terug; de
// vertaling daarvan staat in messages/*.
export const EVENT_INPUT_ERROR_MESSAGES: Record<EventInputErrorCode, string> = {
  invalid_date: 'Ongeldige datum',
  invalid_time: 'Ongeldig tijdstip',
  invalid_match_type: 'Ongeldig wedstrijdtype',
  invalid_home_away: 'Ongeldig thuis/uit',
}

// Vrij tekstveld: leeg of ontbrekend → null, anders afgekapt op `max`. Een
// niet-tekstwaarde (een File in de FormData) telt als leeg.
function optionalText(value: FormDataEntryValue | null, max: number): string | null {
  if (typeof value !== 'string' || value === '') return null
  return value.slice(0, max)
}

// Leest uitsluitend de velden die bij aanmaken en bewerken gelijk zijn: date,
// time, location, notes en — alleen bij een wedstrijd — opponent, match_type en
// home_away. Het `type` komt van de aanroeper en nooit uit de FormData: bij
// bewerken is dat het type uit de database. Alle andere velden (team_id,
// gather_time, trainingstype, doelstelling, goals_*) blijven ongelezen.
//
// De volgorde van de controles bepaalt welke fout de gebruiker als eerste ziet
// en is gelijk aan die van createEvent vóór deze helper bestond.
export function parseEventBaseInput(
  formData: FormData,
  type: 'training' | 'match',
): { ok: true; value: EventBaseInput } | { ok: false; code: EventInputErrorCode } {
  const date = formData.get('date')
  // isDateString weigert ook datums die niet bestaan (2026-02-30), die Postgres
  // anders pas als databasefout zou teruggeven.
  if (!isDateString(date)) return { ok: false, code: 'invalid_date' }

  // Leeg tijdveld betekent "geen tijd", niet "ongeldig".
  const timeRaw = formData.get('time') || null
  if (timeRaw !== null && !isTimeString(timeRaw)) return { ok: false, code: 'invalid_time' }

  const location = optionalText(formData.get('location'), 200)
  const notes = optionalText(formData.get('notes'), 2000)

  if (type === 'training') {
    // Wedstrijdvelden horen niet bij een training en worden niet eens gelezen,
    // ook niet als ze toch worden meegestuurd.
    return { ok: true, value: { date, time: timeRaw, location, notes, match: null } }
  }

  const match_type = formData.get('match_type') as MatchType
  if (!VALID_MATCH_TYPES.includes(match_type)) return { ok: false, code: 'invalid_match_type' }
  const home_away = formData.get('home_away') as HomeAway
  if (!VALID_HOME_AWAY.includes(home_away)) return { ok: false, code: 'invalid_home_away' }
  const opponent = optionalText(formData.get('opponent'), 100) ?? ''

  return {
    ok: true,
    value: { date, time: timeRaw, location, notes, match: { opponent, match_type, home_away } },
  }
}
