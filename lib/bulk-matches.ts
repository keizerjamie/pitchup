// Gedeelde types, grenzen en pure functies voor "wedstrijden bulk toevoegen".
//
// Bewust GEEN 'use server': een `export type`/`export const` uit een
// 'use server'-bestand lekt in Turbopack als runtime-verwijzing en crasht dan
// pas in de browser — een fout die typecheck niet ziet. Zelfde reden als
// lib/logo-upload.ts:11-14. De server actions (app/actions/events-bulk.ts) én
// de preview-UI gebruiken allebei dit bestand, zodat client en server exact
// dezelfde regels hanteren.

import type { HomeAway, MatchType } from '@/lib/types'
import { isDateString } from '@/lib/season-dates'
import { isTimeString } from '@/lib/utils'

// Harde grens voor daadwerkelijk opslaan (één insert-statement).
export const MAX_BULK_MATCHES = 100
// Bovengrens voor de preview: 101-200 rijen zijn wél zichtbaar (zodat de
// trainer ziet wat er te veel is), maar opslaan blokkeert bij >100.
export const MAX_PREVIEW_ROWS = 200
export const MAX_BULK_FILE_BYTES = 512 * 1024
export const MAX_TEXT_CHARS = 50_000
export const MAX_TEXT_LINES = 1_000

// Lengtegrenzen. Bewuste afwijking van createEvent (app/actions/events.ts:32-42),
// dat te lange waarden stilzwijgend afkapt: bulk WEIGERT ze, want bij honderd
// rijen tegelijk merkt niemand een stille verminking.
export const MAX_OPPONENT_CHARS = 100
export const MAX_LOCATION_CHARS = 200
export const MAX_NOTES_CHARS = 2000

export type BulkField =
  | 'date' | 'time' | 'opponent' | 'home_away'
  | 'match_type' | 'location' | 'gather_time' | 'notes'

export interface ParsedMatchRow {
  id: string                    // stabiele React-key ('r0', 'r1', ...)
  date: string                  // 'JJJJ-MM-DD' of ''
  time: string                  // 'HH:MM' of ''
  opponent: string
  home_away: '' | HomeAway
  match_type: '' | MatchType
  location: string
  gather_time: string
  notes: string
  uncertain: BulkField[]        // "twijfelgeval" — blokkeert bevestigen
  sourceLine: string | null     // originele tekstregel (hint bij twijfelgeval)
}

export type BulkRowError = { field: BulkField; code: 'required' | 'invalid' | 'too_long' }

export interface BulkMatchInput {
  date: string
  time: string | null
  opponent: string
  home_away: HomeAway
  match_type: MatchType
  location: string | null
  gather_time: string | null
  notes: string | null
}

export type BulkParseResult =
  | { ok: false; error: string }
  | { ok: true; rows: ParsedMatchRow[] }

export interface BulkCreateResult { created: number; attendanceFailed: boolean }

// De acht vaste kolommen van het CSV/Excel-formaat, in exact deze volgorde.
export const BULK_HEADERS = [
  'datum',
  'tijd',
  'tegenstander',
  'thuis_uit',
  'wedstrijdtype',
  'locatie',
  'verzameltijd',
  'notities',
] as const

export const BULK_HEADER_LINE = BULK_HEADERS.join(';')

// Vaste waardetabel, geen fuzzy matching: alles wat hier niet in staat is een
// rijfout (leeg veld → 'required' uit validateBulkRow).
const HOME_AWAY_MAP: Record<string, HomeAway> = {
  thuis: 'home',
  home: 'home',
  uit: 'away',
  away: 'away',
}

const MATCH_TYPE_MAP: Record<string, MatchType> = {
  competitie: 'league',
  league: 'league',
  beker: 'cup',
  cup: 'cup',
  oefen: 'friendly',
  friendly: 'friendly',
}

export function normalizeHomeAway(value: string): '' | HomeAway {
  return HOME_AWAY_MAP[value.trim().toLowerCase()] ?? ''
}

export function normalizeMatchType(value: string): '' | MatchType {
  return MATCH_TYPE_MAP[value.trim().toLowerCase()] ?? ''
}

export function bulkRowId(index: number): string {
  return `r${index}`
}

// Bouwt een previewrij uit de acht kolomwaarden van een CSV-/Excel-regel.
// Waarden blijven staan zoals ze zijn (alleen getrimd): een onherkende datum
// als '31/02/2026' hoort zichtbaar te blijven in de preview, zodat de trainer
// ziet wát er mis is. validateBulkRow markeert hem als 'invalid'.
// `uncertain` blijft bij bestandsinvoer altijd leeg — dat begrip hoort bij de
// vrije-tekst-parser, waar velden geraden moeten worden.
export function rowFromColumns(cells: string[], index: number): ParsedMatchRow {
  const cell = (i: number) => (cells[i] ?? '').trim()
  return {
    id: bulkRowId(index),
    date: cell(0),
    time: cell(1),
    opponent: cell(2),
    home_away: normalizeHomeAway(cell(3)),
    match_type: normalizeMatchType(cell(4)),
    location: cell(5),
    gather_time: cell(6),
    notes: cell(7),
    uncertain: [],
    sourceLine: null,
  }
}

// De velden waar validateBulkRow naar kijkt. Zowel ParsedMatchRow (preview) als
// een uit BulkMatchInput opgebouwd object (server) passen hierop, zodat client
// en server letterlijk dezelfde regels draaien.
export interface BulkRowFields {
  date: string
  time: string
  opponent: string
  home_away: string
  match_type: string
  location: string
  gather_time: string
  notes: string
}

const VALID_MATCH_TYPES: string[] = ['friendly', 'league', 'cup']
const VALID_HOME_AWAY: string[] = ['home', 'away']

// Enige bron van waarheid voor rijvalidatie: de preview gebruikt hem om
// bevestigen te blokkeren, createBulkMatches draait hem opnieuw server-side
// (clientinvoer wordt nooit vertrouwd).
//
// Strenger dan createEvent op twee punten: de datum moet een BESTAANDE
// kalenderdatum zijn (isDateString, dus 2026-02-30 valt af waar
// app/actions/events.ts:27 hem doorlaat) en te lange/lege waarden worden
// geweigerd in plaats van afgekapt.
export function validateBulkRow(row: BulkRowFields): BulkRowError[] {
  const errors: BulkRowError[] = []

  const date = row.date.trim()
  if (date === '') errors.push({ field: 'date', code: 'required' })
  else if (!isDateString(date)) errors.push({ field: 'date', code: 'invalid' })

  const time = row.time.trim()
  if (time !== '' && !isTimeString(time)) errors.push({ field: 'time', code: 'invalid' })

  const opponent = row.opponent.trim()
  if (opponent === '') errors.push({ field: 'opponent', code: 'required' })
  else if (opponent.length > MAX_OPPONENT_CHARS) errors.push({ field: 'opponent', code: 'too_long' })

  if (row.home_away.trim() === '') errors.push({ field: 'home_away', code: 'required' })
  else if (!VALID_HOME_AWAY.includes(row.home_away.trim())) {
    errors.push({ field: 'home_away', code: 'invalid' })
  }

  if (row.match_type.trim() === '') errors.push({ field: 'match_type', code: 'required' })
  else if (!VALID_MATCH_TYPES.includes(row.match_type.trim())) {
    errors.push({ field: 'match_type', code: 'invalid' })
  }

  const location = row.location.trim()
  if (location.length > MAX_LOCATION_CHARS) errors.push({ field: 'location', code: 'too_long' })

  const gatherTime = row.gather_time.trim()
  if (gatherTime !== '' && !isTimeString(gatherTime)) {
    errors.push({ field: 'gather_time', code: 'invalid' })
  }

  const notes = row.notes.trim()
  if (notes.length > MAX_NOTES_CHARS) errors.push({ field: 'notes', code: 'too_long' })

  return errors
}

// Zet een gevalideerde previewrij om naar de payload voor createBulkMatches.
// Lege optionele velden worden null (de kolommen zijn nullable), niet ''.
// Roep dit alleen aan op rijen zonder fouten uit validateBulkRow.
export function toBulkMatchInput(row: ParsedMatchRow): BulkMatchInput {
  return {
    date: row.date.trim(),
    time: row.time.trim() || null,
    opponent: row.opponent.trim(),
    home_away: row.home_away as HomeAway,
    match_type: row.match_type as MatchType,
    location: row.location.trim() || null,
    gather_time: row.gather_time.trim() || null,
    notes: row.notes.trim() || null,
  }
}

// Sleutel voor duplicaatherkenning: datum + tegenstander, hoofdletter- en
// spatie-ongevoelig. Tijd en locatie tellen bewust NIET mee — twee keer dezelfde
// tegenstander op dezelfde dag is vrijwel altijd dubbel ingevoerd, ook als de
// aanvangstijd verschilt.
export function duplicateKey(date: string, opponent: string): string {
  return `${date.trim()}|${opponent.trim().toLowerCase()}`
}

// Geeft de ids van previewrijen die een duplicaat zijn: van een al bestaande
// wedstrijd in de database, óf van een andere rij in dezelfde batch (dan worden
// álle betrokken rijen gemarkeerd, want welke de "echte" is weet alleen de
// trainer). Rijen zonder datum of zonder tegenstander doen niet mee — die zijn
// nog niet vergelijkbaar en falen sowieso op validatie.
export function markDuplicates(
  rows: ParsedMatchRow[],
  existing: { date: string; opponent: string | null }[],
): Set<string> {
  const existingKeys = new Set(
    existing.map((e) => duplicateKey(e.date ?? '', e.opponent ?? '')),
  )

  const seen = new Map<string, string[]>()
  for (const row of rows) {
    if (row.date.trim() === '' || row.opponent.trim() === '') continue
    const key = duplicateKey(row.date, row.opponent)
    const ids = seen.get(key)
    if (ids) ids.push(row.id)
    else seen.set(key, [row.id])
  }

  const duplicates = new Set<string>()
  for (const [key, ids] of seen) {
    if (existingKeys.has(key) || ids.length > 1) for (const id of ids) duplicates.add(id)
  }
  return duplicates
}
