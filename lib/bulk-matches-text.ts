// Parser voor vrij geplakte tekst ("za 12 sept 2026 14:30 thuis competitie DVC").
//
// Volledig deterministisch: regel voor regel, vaste regex- en woordtabellen,
// geen AI en geen `new Date(string)` om waarden af te leiden (dat zou de
// servertijdzone laten meebeslissen — zie lib/season-dates.ts).
//
// Kernregel: er wordt NOOIT iets ingevuld wat er niet staat. Een dubbelzinnige
// of ontbrekende waarde levert een leeg veld plus een vermelding in
// `uncertain` op; de preview blokkeert bevestigen tot de trainer het zelf
// aanvult. Bewust anders dan het losse wedstrijdformulier, dat wél defaults
// (competitie/thuis) kent.

import {
  MAX_PREVIEW_ROWS,
  MAX_TEXT_CHARS,
  MAX_TEXT_LINES,
  bulkRowId,
  type BulkField,
  type BulkParseResult,
  type ParsedMatchRow,
} from '@/lib/bulk-matches'
import { isDateString } from '@/lib/season-dates'
import type { HomeAway, MatchType } from '@/lib/types'

export const TEXT_TOO_LONG_ERROR = `Deze tekst is te lang. Plak maximaal ${MAX_TEXT_CHARS.toLocaleString('nl-NL')} tekens.`
export const TEXT_TOO_MANY_LINES_ERROR = `Deze tekst heeft te veel regels. Plak maximaal ${MAX_TEXT_LINES.toLocaleString('nl-NL')} regels.`
export const TEXT_NO_MATCHES_ERROR =
  'Geen wedstrijden gevonden. Zet elke wedstrijd op een eigen regel, met een datum erin.'
export const TEXT_TOO_MANY_ERROR =
  `Er staan meer dan ${MAX_PREVIEW_ROWS} wedstrijden in deze tekst. Plak ze in kleinere delen.`

// Vaste NL-maandtabel (voluit én de gangbare afkortingen). Staat een maandnaam
// hier niet in, dan wordt er niet gegokt.
const MONTHS: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mrt: 3, maart: 3,
  apr: 4, april: 4,
  mei: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, augustus: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

// Weekdagen worden alleen weggestript, nooit gebruikt om een datum af te
// leiden: "za" zegt niets over wélke zaterdag.
const WEEKDAY_PREFIX_RE =
  /^(ma|di|wo|do|vr|za|zo|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\.?[\s,-]+/i

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/
const ISO_LOOSE_RE = /\b\d{4}-\d{1,2}-\d{1,2}\b/
const TEXT_DATE_RE = /\b(\d{1,2})\s+([A-Za-zéë]{3,9})\.?\s+(\d{4})\b/
const TEXT_DATE_NO_YEAR_RE = /\b(\d{1,2})\s+([A-Za-zéë]{3,9})\.?/
const NUMERIC_DATE_RE = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/
const NUMERIC_DATE_SHORT_YEAR_RE = /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2}\b/

const TIME_RE = /\b(\d{1,2})[:.u](\d{2})\b/g

const HOME_RE = /\b(thuis|home)\b/gi
const AWAY_RE = /\b(uit|away)\b/gi
const HOME_AWAY_PAREN_RE = /\(\s*([tuhTUH])\s*\)/g

const LEAGUE_RE = /\b(competitie|comp|league)\b\.?/gi
const CUP_RE = /\b(beker|cup)\b/gi
const FRIENDLY_RE = /\b(oefenwedstrijd|oefen|vriendschappelijk|friendly)\b/gi

const OPPONENT_PREFIX_RE = /\b(tegen|vs)\b\.?/gi
const EDGE_SEPARATORS_RE = /^[\s\-–—|,;:]+|[\s\-–—|,;:]+$/g

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

// 'JJJJ-MM-DD' als de combinatie een bestaande kalenderdatum is, anders null.
function toDateString(year: number, month: number, day: number): string | null {
  const value = `${pad(year, 4)}-${pad(month)}-${pad(day)}`
  return isDateString(value) ? value : null
}

interface DateHit {
  token: string          // wat er uit de regel gehaald wordt
  date: string | null    // null = herkend als datum-token, maar niet te duiden
}

// Zoekt het eerste datum-vormige token in een regel. Geeft ook een hit terug
// als het token onbruikbaar is (dubbelzinnig, onbestaande datum, geen jaar):
// het token moet dan namelijk nog steeds uit de regel verdwijnen, anders belandt
// het in de tegenstandernaam.
export function findDate(line: string): DateHit | null {
  const iso = line.match(ISO_DATE_RE)
  if (iso) return { token: iso[0], date: isDateString(iso[0]) ? iso[0] : null }

  // 2026-9-12: wel duidelijk een datum, maar niet het afgesproken formaat.
  const isoLoose = line.match(ISO_LOOSE_RE)
  if (isoLoose) return { token: isoLoose[0], date: null }

  const textDate = line.match(TEXT_DATE_RE)
  if (textDate) {
    const month = MONTHS[textDate[2].toLowerCase()]
    return {
      token: textDate[0],
      date: month ? toDateString(Number(textDate[3]), month, Number(textDate[1])) : null,
    }
  }

  // "12 september" zonder jaartal: herkend, maar het seizoensjaar wordt nooit
  // geraden.
  const noYear = line.match(TEXT_DATE_NO_YEAR_RE)
  if (noYear && MONTHS[noYear[2].toLowerCase()]) return { token: noYear[0], date: null }

  const numeric = line.match(NUMERIC_DATE_RE)
  if (numeric) {
    const first = Number(numeric[1])
    const second = Number(numeric[2])
    // Alleen ondubbelzinnig dag-maand-jaar wordt overgenomen. Bij twee getallen
    // ≤ 12 is niet te zeggen of 3-4-2026 3 april of 4 maart is, en M-D-J wordt
    // nooit aangenomen.
    const date = first > 12 && second <= 12
      ? toDateString(Number(numeric[3]), second, first)
      : null
    return { token: numeric[0], date }
  }

  // 12-09-26: een tweecijferig jaartal wordt niet aangevuld ("26" kan 1926 of
  // 2026 zijn), maar het token moet wel weg uit de regel.
  const shortYear = line.match(NUMERIC_DATE_SHORT_YEAR_RE)
  if (shortYear) return { token: shortYear[0], date: null }

  // Een datum zónder jaartal in cijfervorm ("12/9") wordt bewust niet als
  // datum-token gezien: dat is niet te onderscheiden van een uitslag ("3-1").
  return null
}

// Verwijdert het eerste voorkomen van `token` (string-replace, dus geen
// regex-interpretatie van de inhoud) en laat een spatie achter.
function removeToken(line: string, token: string): string {
  return line.replace(token, ' ')
}

function collectAndStrip(line: string, re: RegExp): { line: string; hits: RegExpMatchArray[] } {
  const hits = [...line.matchAll(re)]
  return { line: hits.length > 0 ? line.replace(re, ' ') : line, hits }
}

function parseLine(line: string, index: number): ParsedMatchRow {
  const uncertain: BulkField[] = []
  let rest = line.replace(WEEKDAY_PREFIX_RE, '')

  // 1. Datum
  const dateHit = findDate(rest)
  let date = ''
  if (dateHit) {
    rest = removeToken(rest, dateHit.token)
    if (dateHit.date) date = dateHit.date
    else uncertain.push('date')
  } else {
    uncertain.push('date')
  }

  // 2. Tijd — één token is de aanvangstijd; bij twee of meer is niet te zeggen
  // welke de aanvang en welke de verzameltijd is, dus blijven beide leeg.
  const times = collectAndStrip(rest, TIME_RE)
  rest = times.line
  let time = ''
  if (times.hits.length === 1) {
    const hours = Number(times.hits[0][1])
    const minutes = Number(times.hits[0][2])
    if (hours <= 23 && minutes <= 59) time = `${pad(hours)}:${pad(minutes)}`
    else uncertain.push('time')
  } else if (times.hits.length > 1) {
    uncertain.push('time')
  }

  // 3. Thuis/uit
  const homeHits = collectAndStrip(rest, HOME_RE)
  rest = homeHits.line
  const awayHits = collectAndStrip(rest, AWAY_RE)
  rest = awayHits.line
  const parenHits = collectAndStrip(rest, HOME_AWAY_PAREN_RE)
  rest = parenHits.line

  const homeSignals = homeHits.hits.length +
    parenHits.hits.filter((h) => h[1].toLowerCase() !== 'u').length
  const awaySignals = awayHits.hits.length +
    parenHits.hits.filter((h) => h[1].toLowerCase() === 'u').length

  let home_away: '' | HomeAway = ''
  if (homeSignals > 0 && awaySignals === 0) home_away = 'home'
  else if (awaySignals > 0 && homeSignals === 0) home_away = 'away'
  else uncertain.push('home_away')

  // 4. Wedstrijdtype
  const leagueHits = collectAndStrip(rest, LEAGUE_RE)
  rest = leagueHits.line
  const cupHits = collectAndStrip(rest, CUP_RE)
  rest = cupHits.line
  const friendlyHits = collectAndStrip(rest, FRIENDLY_RE)
  rest = friendlyHits.line

  const found: MatchType[] = []
  if (leagueHits.hits.length > 0) found.push('league')
  if (cupHits.hits.length > 0) found.push('cup')
  if (friendlyHits.hits.length > 0) found.push('friendly')

  let match_type: '' | MatchType = ''
  if (found.length === 1) match_type = found[0]
  else uncertain.push('match_type')

  // 5. Tegenstander = wat er overblijft.
  const opponent = rest
    .replace(OPPONENT_PREFIX_RE, ' ')
    .replace(/\s+/g, ' ')
    .replace(EDGE_SEPARATORS_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (opponent === '') uncertain.push('opponent')

  return {
    id: bulkRowId(index),
    date,
    time,
    opponent,
    home_away,
    match_type,
    // Locatie, verzameltijd en notities worden uit vrije tekst NOOIT ingevuld:
    // ze zijn niet betrouwbaar van de tegenstandernaam te onderscheiden.
    location: '',
    gather_time: '',
    notes: '',
    uncertain,
    sourceLine: line,
  }
}

// Zet geplakte tekst om in previewrijen. Regels zonder datum-vormig token
// worden stilzwijgend genegeerd (kopjes, poulenamen, lege regels).
export function parseMatchesFromText(input: string): BulkParseResult {
  if (typeof input !== 'string') return { ok: false, error: TEXT_NO_MATCHES_ERROR }
  if (input.length > MAX_TEXT_CHARS) return { ok: false, error: TEXT_TOO_LONG_ERROR }

  const lines = input.split(/\r\n|\r|\n/)
  if (lines.length > MAX_TEXT_LINES) return { ok: false, error: TEXT_TOO_MANY_LINES_ERROR }

  const candidates = lines
    .map((line) => line.trim())
    .filter((line) => line !== '' && findDate(line.replace(WEEKDAY_PREFIX_RE, '')) !== null)

  if (candidates.length === 0) return { ok: false, error: TEXT_NO_MATCHES_ERROR }
  if (candidates.length > MAX_PREVIEW_ROWS) return { ok: false, error: TEXT_TOO_MANY_ERROR }

  return { ok: true, rows: candidates.map((line, index) => parseLine(line, index)) }
}
