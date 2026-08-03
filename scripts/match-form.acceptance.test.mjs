// Acceptatietests voor de dashboard-vorm (W/G/V van de laatste 5 wedstrijden).
//   node --test scripts/match-form.acceptance.test.mjs
//
// Dit bestand toetst de ACCEPTATIECRITERIA van de feature, niet losse units
// (de unit-dekking van matchResult staat in scripts/match-analysis.test.mjs).
//
// Er is geen draaiende Supabase in de tests, dus `selectRecentForm` hieronder
// is een in-memory GEDRAGSHARNAS dat regel-voor-regel dezelfde filter/sort/
// limit-keuzes maakt als de query die in app/page.tsx komt:
//
//   supabase.from('events')
//     .select('id, date, goals_for, goals_against')
//     .eq('team_id', user.id)
//     .eq('type', 'match')
//     .lt('date', today)
//     .order('date', { ascending: false })
//     .order('created_at', { ascending: false, nullsFirst: false })
//     .order('id', { ascending: false })
//     .limit(5)
//
// Het harnas bevat GEEN eigen uitslag-logica: de W/G/V-beslissing komt uit de
// echte, geïmporteerde matchResult() uit lib/match-analysis.mjs — dezelfde
// functie die de productiecode aanroept. Dat de query in app/page.tsx
// werkelijk deze vorm heeft, wordt onderaan op broncodeniveau gecontroleerd
// (zelfde precedent als scripts/todos.acceptance.test.mjs:512).
//
// ── Waarom bestaat dit bestand NAAST dashboard-vorm.acceptance.test.tsx? ──
// De twee bestanden overlappen bewust in criteria, maar bewijzen elk iets
// anders en falen dus om andere redenen:
//
//   • DIT bestand toetst de filter/sort/limit-REGELS zelf, in isolatie:
//     welke rijen horen erbij, in welke volgorde, hoeveel — dependency-vrij
//     via `node --test`, zonder React, jsdom, i18n of vitest. Het draait in
//     milliseconden en blijft leesbaar als losse regel-specificatie; de
//     laatste test hier verankert bovendien op BRONCODEniveau dat de query in
//     app/page.tsx exact deze regels uitdrukt (tenant-scoping, cutoff,
//     tie-breaks, limit) — een check die geen enkele runtime-test doet.
//
//   • dashboard-vorm.acceptance.test.tsx (projectroot, vitest) bewijst dat de
//     ECHTE querychain uit app/page.tsx die regels in productie ook werkelijk
//     volgt: het draait de echte method-chain tegen een generieke, in-memory
//     Supabase-tabel-engine en rendert de echte FormStrip. Daar zit de
//     end-to-end-dekking (query → matchResult → DOM, kleuren, i18n).
//
// Bewust NIET samengevoegd: het regelharnas hieronder tot een dunne wrapper om
// de vitest-mock maken zou dit bestand afhankelijk maken van React/jsdom en de
// snelle, dependency-vrije node-laag opheffen; andersom zou de page-test de
// broncontract-check niet kunnen doen. Wie de regels wijzigt, past beide aan —
// dat is de prijs van dubbele verankering, en die is hier gewild.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { matchResult } from '../lib/match-analysis.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Vaste "vandaag" zodat de tests niet van de systeemklok afhangen. In de
// productiecode is dit todayLocal() (lib/utils.ts:4) — bewust de LOKALE
// kalenderdag, niet de UTC-datum.
const TODAY = '2026-07-26'
const TEAM = 'team-a'
const LIMIT = 5

function addDaysFixed(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Postgres-equivalente vergelijking van de drie .order()-clausules:
 *   date desc, created_at desc NULLS LAST, id desc.
 * Datums/timestamps zijn ISO-strings, waarvoor lexicografisch == chronologisch.
 */
function compareRows(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  const ca = a.created_at ?? null
  const cb = b.created_at ?? null
  // nullsFirst: false → NULLS LAST, ook in aflopende volgorde.
  if (ca === null && cb !== null) return 1
  if (ca !== null && cb === null) return -1
  if (ca !== null && cb !== null && ca !== cb) return ca < cb ? 1 : -1
  if (a.id !== b.id) return a.id < b.id ? 1 : -1
  return 0
}

/**
 * Testharnas: repliceert de Supabase-query + de mapping die app/page.tsx
 * uitvoert, en levert dezelfde vorm op als `recentForm`:
 *   { id: string, result: MatchResult }[]
 */
function selectRecentForm(rows, { teamId = TEAM, today = TODAY, limit = LIMIT } = {}) {
  return rows
    .filter((r) => r.team_id === teamId) // .eq('team_id', user.id) — tenant-isolatie
    .filter((r) => r.type === 'match') // .eq('type', 'match')
    .filter((r) => r.date < today) // .lt('date', today) — strikt vóór vandaag
    .sort(compareRows) // de drie .order()-clausules
    .slice(0, limit) // .limit(5)
    .map((m) => ({ id: m.id, result: matchResult(m) }))
}

function row(over = {}) {
  return {
    id: 'e1',
    team_id: TEAM,
    type: 'match',
    date: addDaysFixed(TODAY, -1),
    created_at: '2026-07-25T18:00:00Z',
    goals_for: null,
    goals_against: null,
    ...over,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Cutoff: alleen afgelopen wedstrijden
// ═══════════════════════════════════════════════════════════════════════════

test('AC: wedstrijd van vandaag telt niet mee (ook mét uitslag); gisteren wel', () => {
  const form = selectRecentForm([
    row({ id: 'vandaag', date: TODAY, goals_for: 3, goals_against: 0 }),
    row({ id: 'gisteren', date: addDaysFixed(TODAY, -1), goals_for: 1, goals_against: 2 }),
  ])
  assert.deepEqual(form, [{ id: 'gisteren', result: 'loss' }])
})

test('AC: toekomstige wedstrijden tellen niet mee', () => {
  const form = selectRecentForm([
    row({ id: 'morgen', date: addDaysFixed(TODAY, 1), goals_for: 4, goals_against: 0 }),
    row({ id: 'volgende-week', date: addDaysFixed(TODAY, 7) }),
  ])
  assert.deepEqual(form, [])
})

// ═══════════════════════════════════════════════════════════════════════════
// Welke events tellen mee
// ═══════════════════════════════════════════════════════════════════════════

test('AC: alleen type match telt mee — training en meting niet', () => {
  const form = selectRecentForm([
    row({ id: 'tr', type: 'training', date: addDaysFixed(TODAY, -2) }),
    row({ id: 'me', type: 'meting', date: addDaysFixed(TODAY, -3) }),
    row({ id: 'wed', type: 'match', date: addDaysFixed(TODAY, -4), goals_for: 2, goals_against: 2 }),
  ])
  assert.deepEqual(form, [{ id: 'wed', result: 'draw' }])
})

test('AC: elke match_type telt mee, inclusief friendly (geen filter op match_type)', () => {
  const form = selectRecentForm([
    row({ id: 'league', date: addDaysFixed(TODAY, -1), match_type: 'league', goals_for: 1, goals_against: 0 }),
    row({ id: 'friendly', date: addDaysFixed(TODAY, -2), match_type: 'friendly', goals_for: 0, goals_against: 1 }),
    row({ id: 'cup', date: addDaysFixed(TODAY, -3), match_type: 'cup', goals_for: 2, goals_against: 2 }),
    row({ id: 'geen-type', date: addDaysFixed(TODAY, -4), match_type: null, goals_for: 3, goals_against: 1 }),
  ])
  assert.deepEqual(form, [
    { id: 'league', result: 'win' },
    { id: 'friendly', result: 'loss' },
    { id: 'cup', result: 'draw' },
    { id: 'geen-type', result: 'win' },
  ])
})

test('AC (tenant-isolatie): wedstrijden van een ander team komen nooit in de vorm', () => {
  const form = selectRecentForm([
    row({ id: 'eigen', date: addDaysFixed(TODAY, -1), goals_for: 1, goals_against: 0 }),
    row({ id: 'ander-team', team_id: 'team-b', date: addDaysFixed(TODAY, -2), goals_for: 5, goals_against: 0 }),
  ])
  assert.deepEqual(form, [{ id: 'eigen', result: 'win' }])
})

// ═══════════════════════════════════════════════════════════════════════════
// Uitslag ontbreekt
// ═══════════════════════════════════════════════════════════════════════════

test('AC: wedstrijd zonder uitslag bezet een positie met unknown (geen skip)', () => {
  const form = selectRecentForm([
    row({ id: 'a', date: addDaysFixed(TODAY, -1), goals_for: 2, goals_against: 1 }),
    row({ id: 'b', date: addDaysFixed(TODAY, -2), goals_for: null, goals_against: null }),
    row({ id: 'c', date: addDaysFixed(TODAY, -3), goals_for: 1, goals_against: 1 }),
  ])
  assert.deepEqual(form, [
    { id: 'a', result: 'win' },
    { id: 'b', result: 'unknown' },
    { id: 'c', result: 'draw' },
  ])
  assert.equal(form.length, 3, 'de lege wedstrijd wordt niet overgeslagen')
})

test('AC: half ingevulde uitslag telt als unknown, 0-0 als draw', () => {
  const form = selectRecentForm([
    row({ id: 'half-voor', date: addDaysFixed(TODAY, -1), goals_for: 2, goals_against: null }),
    row({ id: 'half-tegen', date: addDaysFixed(TODAY, -2), goals_for: null, goals_against: 1 }),
    row({ id: 'nul-nul', date: addDaysFixed(TODAY, -3), goals_for: 0, goals_against: 0 }),
  ])
  assert.deepEqual(form, [
    { id: 'half-voor', result: 'unknown' },
    { id: 'half-tegen', result: 'unknown' },
    { id: 'nul-nul', result: 'draw' },
  ])
})

// ═══════════════════════════════════════════════════════════════════════════
// Aantal & lege staat
// ═══════════════════════════════════════════════════════════════════════════

test('AC: 8 afgelopen wedstrijden → precies de 5 meest recente, nieuwste eerst', () => {
  const rows = []
  for (let i = 1; i <= 8; i++) {
    rows.push(row({
      id: `m-${i}`,
      date: addDaysFixed(TODAY, -i),
      created_at: `2026-07-${String(26 - i).padStart(2, '0')}T18:00:00Z`,
      goals_for: 1,
      goals_against: 0,
    }))
  }
  const form = selectRecentForm(rows)
  assert.equal(form.length, LIMIT, 'nooit meer dan 5 resultaten')
  assert.deepEqual(form.map((f) => f.id), ['m-1', 'm-2', 'm-3', 'm-4', 'm-5'])
})

test('AC: minder dan 5 afgelopen wedstrijden → alleen wat er is (geen opvulling)', () => {
  const form = selectRecentForm([
    row({ id: 'a', date: addDaysFixed(TODAY, -1), goals_for: 1, goals_against: 0 }),
    row({ id: 'b', date: addDaysFixed(TODAY, -2), goals_for: 0, goals_against: 2 }),
  ])
  assert.equal(form.length, 2)
})

test('AC: 0 afgelopen wedstrijden → lege reeks', () => {
  assert.deepEqual(selectRecentForm([]), [], 'helemaal geen events')
  assert.deepEqual(
    selectRecentForm([
      row({ id: 'toekomst', date: addDaysFixed(TODAY, 3) }),
      row({ id: 'training', type: 'training', date: addDaysFixed(TODAY, -3) }),
    ]),
    [],
    'wel events, maar geen afgelopen wedstrijd',
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// Deterministische volgorde bij gelijke datum
// ═══════════════════════════════════════════════════════════════════════════

test('AC: twee wedstrijden op dezelfde datum → nieuwste created_at eerst', () => {
  const d = addDaysFixed(TODAY, -1)
  const form = selectRecentForm([
    row({ id: 'eerst-ingevoerd', date: d, created_at: '2026-07-25T09:00:00Z', goals_for: 1, goals_against: 0 }),
    row({ id: 'later-ingevoerd', date: d, created_at: '2026-07-25T17:30:00Z', goals_for: 0, goals_against: 1 }),
  ])
  assert.deepEqual(form.map((f) => f.id), ['later-ingevoerd', 'eerst-ingevoerd'])
})

test('AC: zelfde datum én zelfde created_at → deterministisch op id desc', () => {
  const d = addDaysFixed(TODAY, -1)
  const ts = '2026-07-25T12:00:00Z'
  const form = selectRecentForm([
    row({ id: 'aaa', date: d, created_at: ts, goals_for: 1, goals_against: 0 }),
    row({ id: 'ccc', date: d, created_at: ts, goals_for: 0, goals_against: 1 }),
    row({ id: 'bbb', date: d, created_at: ts, goals_for: 2, goals_against: 2 }),
  ])
  assert.deepEqual(form.map((f) => f.id), ['ccc', 'bbb', 'aaa'])
})

test('AC: ontbrekende created_at sorteert achteraan binnen dezelfde datum (nullsFirst: false)', () => {
  const d = addDaysFixed(TODAY, -1)
  const form = selectRecentForm([
    row({ id: 'zonder-ts', date: d, created_at: null, goals_for: 1, goals_against: 0 }),
    row({ id: 'met-ts', date: d, created_at: '2026-07-25T08:00:00Z', goals_for: 0, goals_against: 1 }),
  ])
  assert.deepEqual(form.map((f) => f.id), ['met-ts', 'zonder-ts'])
})

test('AC: de volgorde is stabiel, ongeacht in welke volgorde de rijen binnenkomen', () => {
  const d1 = addDaysFixed(TODAY, -1)
  const d2 = addDaysFixed(TODAY, -2)
  const rows = [
    row({ id: 'b', date: d1, created_at: '2026-07-25T08:00:00Z', goals_for: 1, goals_against: 1 }),
    row({ id: 'a', date: d1, created_at: '2026-07-25T20:00:00Z', goals_for: 3, goals_against: 0 }),
    row({ id: 'c', date: d2, created_at: '2026-07-24T20:00:00Z', goals_for: 0, goals_against: 2 }),
  ]
  const expected = ['a', 'b', 'c']
  assert.deepEqual(selectRecentForm(rows).map((f) => f.id), expected)
  assert.deepEqual(selectRecentForm([...rows].reverse()).map((f) => f.id), expected)
})

// ═══════════════════════════════════════════════════════════════════════════
// Broncontract — codeniveau (de query zelf is zonder draaiende Supabase niet
// runtime-testbaar; zelfde aanpak als scripts/todos.acceptance.test.mjs:512).
// ═══════════════════════════════════════════════════════════════════════════

// Deze test kent GEEN ontsnapping: verdwijnt de vorm-query (of matchResult)
// ooit uit app/page.tsx, dan faalt hij hard in plaats van over te slaan.
test('AC (codeniveau): de vorm-query in app/page.tsx volgt het afgesproken contract', () => {
  const pageSrc = readFileSync(path.join(ROOT, 'app/page.tsx'), 'utf8')
  assert.ok(
    pageSrc.includes('matchResult'),
    'app/page.tsx moet matchResult gebruiken om de vorm af te leiden',
  )

  const flat = pageSrc.replace(/\s+/g, ' ')
  const chunks = flat.split("from('events')").slice(1)
  const queryChunk = chunks.find((c) => c.includes(".lt('date', today)"))
  assert.ok(queryChunk, "vorm-query ontbreekt: geen events-query met .lt('date', today)")

  const end = queryChunk.indexOf('.limit(5)')
  assert.ok(end >= 0, 'vorm-query moet .limit(5) bevatten (nooit meer dan 5 resultaten)')
  const query = queryChunk.slice(0, end + '.limit(5)'.length)

  assert.ok(query.includes("goals_for"), 'select moet goals_for ophalen')
  assert.ok(query.includes("goals_against"), 'select moet goals_against ophalen')
  assert.ok(query.includes(".eq('team_id', user.id)"), "tenant-isolatie: .eq('team_id', user.id) verplicht")
  assert.ok(query.includes(".eq('type', 'match')"), "alleen wedstrijden: .eq('type', 'match')")
  assert.ok(query.includes(".lt('date', today)"), "cutoff: strikt .lt('date', today)")
  assert.ok(/\.order\('date', \{ ascending: false/.test(query), 'sorteren op date aflopend')
  assert.ok(
    /\.order\('created_at', \{ ascending: false, nullsFirst: false \}\)/.test(query),
    'tie-break op created_at aflopend met nullsFirst: false',
  )
  assert.ok(/\.order\('id', \{ ascending: false/.test(query), 'laatste tie-break op id aflopend')
  assert.ok(!query.includes('match_type'), 'geen filter op match_type — oefenwedstrijden tellen mee')
})
