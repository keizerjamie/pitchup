// Acceptatietests — Inzichtenpagina (/inzichten), user story: als coach in
// één oogopslag aanwezigheid, trainingsopkomst per maand, teamratings,
// doelpunten en recente vorm van het hele seizoen zien.
//
// Zelfde testmethode als dashboard-vorm.acceptance.test.tsx: dit bestand
// rendert de ECHTE app/inzichten/page.tsx (InzichtenPage, een async server
// component) rechtstreeks met RTL, met uitsluitend @/lib/supabase/server en
// next/navigation gestubd. De Supabase-mock hieronder is een generieke
// tabel-engine (zelfde `.eq/.neq/.gte/.lte/.lt/.in/.order/.limit`-precedent
// als dashboard-vorm.acceptance.test.tsx:131-203) — UITGEBREID met `.not()`
// (voor de doelpuntenquery, die `.not('goals_for','is',null)` gebruikt) en
// een `rpc(naam, args)`-handler op de mock zelf. De drie RPC's worden niet
// blind met canned data beantwoord: de handlers herberekenen de aggregatie
// vanuit de in-memory attendance/match_ratings/players-rijen, gefilterd op
// de p_start/p_end (en voor de spelerrating ook p_player) die de PAGINA
// daadwerkelijk doorgeeft. Een verkeerd seizoensfilter of een verkeerd
// RPC-argument in app/inzichten/page.tsx laat deze test daardoor net zo hard
// vallen als tegen een echte Postgres-database (supabase/inzichten.sql).
//
// LET OP (scope): supabase/inzichten.sql zelf is nog nooit tegen een echte
// Postgres gedraaid (zie bouwer-rapportage) — dit bestand kan dat niet
// dekken zonder een live/lokale Postgres-testinstantie. De RPC-handlers
// hieronder herimplementeren de aggregatielogica van dat .sql-bestand in TS
// zodat een verkeerd doorgegeven filter/argument vanuit de pagina toch
// hard faalt, maar een fout in de SQL zelf (bv. een verkeerde join/filter in
// inzichten.sql) blijft ongedekt door dit bestand. Zie testverslag.
//
// ── AC → test-mapping (nummering exact zoals in de goedgekeurde story) ──
//   AC1  → describe('AC1/AC2 — toegang via dashboardtegel')
//   AC2  → describe('AC1/AC2 — toegang via dashboardtegel')
//   AC3  → zie testverslag (geen gatingcode in de repo; impliciet gedekt
//          door elke render-test hieronder, die zonder pro/plan-instelling
//          de volle pagina toont)
//   AC4  → describe('niet ingelogd')
//   AC5  → describe('volledig seizoen — alle 4 grafieken correct') +
//          describe('seizoensgrens middenin een maand')
//   AC6  → describe('geen seizoen ingesteld')
//   AC7  → describe('volledig seizoen — alle 4 grafieken correct')
//   AC8  → describe('AC8/AC21/AC25 — lege staten zonder brondata')
//   AC9  → describe('volledig seizoen — alle 4 grafieken correct')
//   AC10 → describe('wedstrijd zonder uitslag')
//   AC11 → describe('volledig seizoen — alle 4 grafieken correct')
//   AC12 → describe('wedstrijd zonder uitslag')
//   AC13 → describe('AC13–AC16 — doelpuntenfilter op de samengestelde pagina')
//   AC14 → describe('AC13–AC16 — doelpuntenfilter op de samengestelde pagina')
//   AC15 → describe('AC13–AC16 — doelpuntenfilter op de samengestelde pagina')
//   AC16 → describe('AC13–AC16 — doelpuntenfilter op de samengestelde pagina')
//   AC17 → describe('volledig seizoen — alle 4 grafieken correct')
//   AC18 → describe('AC18 — maandlabel is tijdzone-veilig')
//   AC19 → describe('AC19/AC20 — opkomst per maand: randgevallen')
//   AC20 → describe('AC19/AC20 — opkomst per maand: randgevallen')
//   AC21 → describe('AC8/AC21/AC25 — lege staten zonder brondata')
//   AC22 → describe('AC22/AC24 — teamgemiddelde sluit inactieve spelers uit')
//   AC23 → describe('AC23 — per-speler-weergave, volledige keten')
//   AC24 → describe('AC22/AC24 — teamgemiddelde sluit inactieve spelers uit')
//   AC25 → describe('AC8/AC21/AC25 — lege staten zonder brondata')
//   AC26 → describe('tenant-isolatie')
//   AC27 → describe('één RPC geeft een fout') + describe('AC27 — falende
//          niet-RPC-query (events) blokkeert de RPC-gedreven kaarten niet')
//   AC28 → describe('basis-toegankelijkheid op paginaniveau')
//   AC29 → describe('AC29 — geen minimumdrempel: 1 datapunt wordt getoond')
//   AC30 → describe('AC30 — RPC-aanroepen bevatten nooit een team_id-param')
//
// ── Feedback-ronde 2 (post-launch, deze uitbreiding) ────────────────────
//   FC1 → describe('toekomstige events tellen niet mee in de aanwezigheidscijfers')
//          (bestaande bouwer-tests, zie die describe) +
//          describe('FC1 — team-Aanwezigheid combineert verleden én toekomst binnen één venster')
//   FC2 → describe('toekomstige events tellen niet mee in de aanwezigheidscijfers')
//          (bestaande bouwer-tests, zie die describe)
//   FC3 → describe('FC3 — Top 5 / worst 5 spelerratings')
//   FC4 → describe('FC4 — Top 5 / worst 5 aanwezigheid per speler')
//   FC5 → describe('FC5 — tenant-isolatie op de 2 nieuwe per-speler-RPC's')
//   FC6 → volledige testrun van dit bestand (zie testverslag): alle 30
//          bestaande AC's + de bestaande bouwer-uitbreidingen blijven groen.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, configure } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import InzichtenPage from '@/app/inzichten/page'
import AppLauncher from '@/components/AppLauncher'
import { getSpelerRatingReeks } from '@/app/actions/inzichten'

const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'
// Echte UUID's (isUuid() in lib/authz.ts eist exact dit formaat) — nodig
// voor AC22–AC25: getSpelerRatingReeks (app/actions/inzichten.ts) gooit
// "Speler niet gevonden" bij een niet-UUID id, dus 'p1'/'p2' (elders in dit
// bestand, waar alleen de RPC-mocks er zelf naar kijken) volstaan hier niet.
const PLAYER_ACTIVE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PLAYER_INACTIVE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

type Row = Record<string, unknown>

// Vaste "vandaag" voor de hele testrun — de vorm-/laatste-5-query filtert
// op `.lt('date', today)` (app/inzichten/page.tsx, todayLocal()), dus zonder
// een vaste systeemklok zou een wedstrijd-fixture ergens in de toekomst
// (t.o.v. de echte klok) stilletjes uit de vormstrook vallen. Zelfde
// precedent als dashboard-vorm.acceptance.test.tsx.
const TODAY = '2026-10-15'

// De pagina rendert sinds het seizoensrapport twee versies van dezelfde
// inhoud: het scherm (`print:hidden`) en het print-rapport (`hidden
// print:block`, gemarkeerd met `data-print-only`). Beide staan in de DOM, dus
// een kale `screen.getByText('Aanwezigheid per speler')` zou twee treffers
// geven en terecht klappen.
//
// Deze configuratie laat élke schermquery in dit bestand het printblok
// overslaan — inclusief zijn nakomelingen, vandaar de tweede selector: RTL's
// `ignore` filtert alleen knopen die de selector zélf matchen, niet automatisch
// hun kinderen. De tests hieronder toetsen daarmee onveranderd wat de
// gebruiker op het scherm ziet; het rapport heeft zijn eigen tests
// (seizoensrapport.acceptance.test.tsx) die er juist wél in kijken.
const STANDAARD_IGNORE = 'script, style'
const NEGEER_PRINTBLOK = `${STANDAARD_IGNORE}, [data-print-only], [data-print-only] *`

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`))
  configure({ defaultIgnore: NEGEER_PRINTBLOK })
})

afterEach(() => {
  configure({ defaultIgnore: STANDAARD_IGNORE })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ── Seed-helpers ──────────────────────────────────────────────────────
function eventRow(overrides: Row = {}): Row {
  return {
    id: 'e',
    team_id: TEAM,
    type: 'match',
    date: '2026-09-05',
    opponent: 'Tegenstander',
    match_type: 'league',
    goals_for: null,
    goals_against: null,
    created_at: '2026-01-01T10:00:00Z',
    ...overrides,
  }
}

function attendanceRow(overrides: Row = {}): Row {
  return { team_id: TEAM, event_id: 'e', player_id: 'p1', status: 'present', ...overrides }
}

function ratingRow(overrides: Row = {}): Row {
  return { team_id: TEAM, event_id: 'e', player_id: 'p1', rating: 7, ...overrides }
}

function playerRow(overrides: Row = {}): Row {
  // `type` hoort erbij sinds gastspelers: de spelerskiezer en alle zes RPC's
  // filteren op type = 'regular'. Zonder deze default valt elke fixture-speler
  // uit de lijst.
  return { id: 'p1', team_id: TEAM, name: 'Piet Peters', active: true, type: 'regular', ...overrides }
}

// ── Generieke Supabase-tabel-engine, zelfde precedent als
// dashboard-vorm.acceptance.test.tsx:131-203, plus `.not()`. ──
// `errorFn`: optioneel, geëvalueerd bij elke resolve — laat een tabelquery
// een {data:null, error} teruggeven i.p.v. rijen. Nodig om AC27 (één
// falende, niet-RPC-gedreven dataset blokkeert de andere kaarten niet) te
// simuleren voor de doelpunten-/vorm-/spelers-queries, die via `.from(...)`
// lopen i.p.v. via `rpc()` (die heeft al `rpcErrors`, zie hieronder).
function tableFactory(rows: Row[], errorFn?: () => unknown) {
  return () => {
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
    let limitN: number | null = null

    function resolveRows(): Row[] {
      let out = rows.filter((r) => filters.every((f) => f(r)))
      if (orders.length > 0) {
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const av = a[o.col] as string | number | null | undefined
            const bv = b[o.col] as string | number | null | undefined
            const aNull = av === null || av === undefined
            const bNull = bv === null || bv === undefined
            if (aNull && bNull) continue
            if (aNull) return o.nullsFirst ? -1 : 1
            if (bNull) return o.nullsFirst ? 1 : -1
            if (av! < bv!) return o.ascending ? -1 : 1
            if (av! > bv!) return o.ascending ? 1 : -1
          }
          return 0
        })
      }
      if (limitN !== null) out = out.slice(0, limitN)
      return out
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
        return chain
      },
      neq: (col: string, val: unknown) => {
        filters.push((r) => r[col] !== val)
        return chain
      },
      gt: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string | number) > (val as string | number))
        return chain
      },
      gte: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string | number) >= (val as string | number))
        return chain
      },
      lte: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string | number) <= (val as string | number))
        return chain
      },
      lt: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string | number) < (val as string | number))
        return chain
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]))
        return chain
      },
      // Nieuw t.o.v. dashboard-vorm.acceptance.test.tsx: de doelpuntenquery
      // gebruikt `.not('goals_for', 'is', null)`. Alleen de 'is'-operator
      // komt in de productiecode voor; een andere operator is een test-bug.
      not: (col: string, op: string, val: unknown) => {
        if (op !== 'is') throw new Error(`tableFactory.not(): onverwachte operator "${op}"`)
        filters.push((r) => r[col] !== val)
        return chain
      },
      order: (col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
        orders.push({ col, ascending: opts.ascending ?? true, nullsFirst: opts.nullsFirst ?? false })
        return chain
      },
      limit: (n: number) => {
        limitN = n
        return chain
      },
      maybeSingle: () => Promise.resolve({ data: resolveRows()[0] ?? null }),
      single: () => Promise.resolve({ data: resolveRows()[0] ?? null }),
      then: (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) => {
        const err = errorFn?.() ?? null
        if (err) return resolve({ data: null, error: err })
        return resolve({ data: resolveRows(), error: null })
      },
    }
    return chain
  }
}

// ── RPC-engine: herberekent de vier SQL-aggregaties (supabase/inzichten.sql)
// vanuit de in-memory rijen, gefilterd op p_start/p_end (+p_player). Geen
// canned uitkomsten — een verkeerd doorgegeven filter/param breekt dit net
// zo hard als een echte database. ──
function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}

// Gastspelers (players.type = 'guest') tellen nooit mee in de teambrede
// aanwezigheidscijfers (AC10/AC11) — zie supabase/inzichten.sql 3a/3b. Deze
// twee functies keken vóór de gastspelers-feature helemaal niet naar
// `db.players`; zonder deze players-lookup zou een verkeerd/ontbrekend
// `p.type = 'regular'`-filter in de ECHTE SQL door deze mock-suite heen
// glippen.
function rpcAanwezigheid(db: Db, args: Row) {
  const { p_start, p_end } = args as { p_start: string; p_end: string }
  const events = new Map(db.events.map((e) => [e.id as string, e]))
  const players = new Map(db.players.map((p) => [p.id as string, p]))
  let aanwezig = 0
  let afwezig = 0
  for (const a of db.attendance) {
    if (a.team_id !== TEAM) continue
    const e = events.get(a.event_id as string)
    if (!e || e.team_id !== TEAM || e.type === 'meting') continue
    if (!inRange(e.date as string, p_start, p_end)) continue
    const p = players.get(a.player_id as string)
    if (!p || p.team_id !== TEAM || p.type !== 'regular') continue
    if (a.status === 'present') aanwezig++
    else if (a.status === 'absent') afwezig++
  }
  return [{ aanwezig, afwezig }]
}

function rpcMaandOpkomst(db: Db, args: Row) {
  const { p_start, p_end } = args as { p_start: string; p_end: string }
  const events = new Map(db.events.map((e) => [e.id as string, e]))
  const players = new Map(db.players.map((p) => [p.id as string, p]))
  const byMaand = new Map<string, { aanwezig: number; afwezig: number }>()
  for (const a of db.attendance) {
    if (a.team_id !== TEAM) continue
    const e = events.get(a.event_id as string)
    if (!e || e.team_id !== TEAM || e.type !== 'training') continue
    if (!inRange(e.date as string, p_start, p_end)) continue
    const p = players.get(a.player_id as string)
    if (!p || p.team_id !== TEAM || p.type !== 'regular') continue
    const maand = (e.date as string).slice(0, 7)
    const cur = byMaand.get(maand) ?? { aanwezig: 0, afwezig: 0 }
    if (a.status === 'present') cur.aanwezig++
    else if (a.status === 'absent') cur.afwezig++
    byMaand.set(maand, cur)
  }
  return Array.from(byMaand.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([maand, v]) => ({ maand, ...v }))
}

// Deze vier functies joinden al op players (voor de active-check); het
// gast-filter (AC12) breidt diezelfde `!p.active`-uitsluiting simpelweg uit
// met `p.type !== 'regular'` — exact zoals supabase/inzichten.sql 3c-3f.
function rpcTeamRating(db: Db, args: Row) {
  const { p_start, p_end } = args as { p_start: string; p_end: string }
  const events = new Map(db.events.map((e) => [e.id as string, e]))
  const players = new Map(db.players.map((p) => [p.id as string, p]))
  const byEvent = new Map<string, number[]>()
  for (const r of db.match_ratings) {
    if (r.team_id !== TEAM) continue
    const e = events.get(r.event_id as string)
    if (!e || e.team_id !== TEAM || e.type !== 'match') continue
    if (!inRange(e.date as string, p_start, p_end)) continue
    const p = players.get(r.player_id as string)
    if (!p || p.team_id !== TEAM || !p.active || p.type !== 'regular') continue
    const arr = byEvent.get(e.id as string) ?? []
    arr.push(r.rating as number)
    byEvent.set(e.id as string, arr)
  }
  const rows = Array.from(byEvent.entries()).map(([eventId, ratings]) => {
    const e = events.get(eventId)!
    return {
      event_id: eventId,
      datum: e.date,
      tegenstander: e.opponent ?? null,
      gemiddelde: ratings.reduce((a, b) => a + b, 0) / ratings.length,
      aantal: ratings.length,
    }
  })
  rows.sort((a, b) => (a.datum === b.datum ? String(a.event_id).localeCompare(String(b.event_id)) : String(a.datum) < String(b.datum) ? -1 : 1))
  return rows
}

// inzichten_rating_speler — zelfde active/team-filters als rpcTeamRating,
// maar dan voor precies één speler (p_player). Nodig om AC22–AC25 (per-speler
// ratingweergave + uitsluiting van inactieve spelers) écht via de
// samengestelde pagina + de echte getSpelerRatingReeks-server-action te
// kunnen bewijzen, niet alleen via gemockte component-props.
function rpcRatingSpeler(db: Db, args: Row) {
  const { p_player, p_start, p_end } = args as { p_player: string; p_start: string; p_end: string }
  const events = new Map(db.events.map((e) => [e.id as string, e]))
  const players = new Map(db.players.map((p) => [p.id as string, p]))
  const p = players.get(p_player)
  if (!p || p.team_id !== TEAM || !p.active || p.type !== 'regular') return []
  const rows: Row[] = []
  for (const r of db.match_ratings) {
    if (r.team_id !== TEAM || r.player_id !== p_player) continue
    const e = events.get(r.event_id as string)
    if (!e || e.team_id !== TEAM || e.type !== 'match') continue
    if (!inRange(e.date as string, p_start, p_end)) continue
    rows.push({ event_id: e.id, datum: e.date, tegenstander: e.opponent ?? null, rating: r.rating })
  }
  rows.sort((a, b) => (a.datum === b.datum ? String(a.event_id).localeCompare(String(b.event_id)) : String(a.datum) < String(b.datum) ? -1 : 1))
  return rows
}

// inzichten_rating_per_speler — zelfde filters als rpcTeamRating, maar
// gegroepeerd per speler i.p.v. per wedstrijd. Voedt de top 5 / worst 5 op
// gemiddelde rating.
function rpcRatingPerSpeler(db: Db, args: Row) {
  const { p_start, p_end } = args as { p_start: string; p_end: string }
  const events = new Map(db.events.map((e) => [e.id as string, e]))
  const players = new Map(db.players.map((p) => [p.id as string, p]))
  const byPlayer = new Map<string, number[]>()
  for (const r of db.match_ratings) {
    if (r.team_id !== TEAM) continue
    const e = events.get(r.event_id as string)
    if (!e || e.team_id !== TEAM || e.type !== 'match') continue
    if (!inRange(e.date as string, p_start, p_end)) continue
    const p = players.get(r.player_id as string)
    if (!p || p.team_id !== TEAM || !p.active || p.type !== 'regular') continue
    const arr = byPlayer.get(p.id as string) ?? []
    arr.push(r.rating as number)
    byPlayer.set(p.id as string, arr)
  }
  return Array.from(byPlayer.entries())
    .map(([playerId, ratings]) => ({
      player_id: playerId,
      naam: players.get(playerId)!.name,
      gemiddelde: ratings.reduce((a, b) => a + b, 0) / ratings.length,
      aantal: ratings.length,
    }))
    .sort((a, b) => String(a.naam).localeCompare(String(b.naam)))
}

// inzichten_aanwezigheid_per_speler — zoals rpcAanwezigheid (type <> 'meting'),
// maar per speler én mét active-filter (bewust anders dan de team-brede kaart,
// zie de comment in supabase/inzichten.sql). Voedt de top 5 / worst 5 op
// aanwezigheidspercentage.
function rpcAanwezigheidPerSpeler(db: Db, args: Row) {
  const { p_start, p_end } = args as { p_start: string; p_end: string }
  const events = new Map(db.events.map((e) => [e.id as string, e]))
  const players = new Map(db.players.map((p) => [p.id as string, p]))
  const byPlayer = new Map<string, { aanwezig: number; afwezig: number }>()
  for (const a of db.attendance) {
    if (a.team_id !== TEAM) continue
    const e = events.get(a.event_id as string)
    if (!e || e.team_id !== TEAM || e.type === 'meting') continue
    if (!inRange(e.date as string, p_start, p_end)) continue
    const p = players.get(a.player_id as string)
    if (!p || p.team_id !== TEAM || !p.active || p.type !== 'regular') continue
    const cur = byPlayer.get(p.id as string) ?? { aanwezig: 0, afwezig: 0 }
    if (a.status === 'present') cur.aanwezig++
    else if (a.status === 'absent') cur.afwezig++
    byPlayer.set(p.id as string, cur)
  }
  return Array.from(byPlayer.entries())
    .map(([playerId, telling]) => ({
      player_id: playerId,
      naam: players.get(playerId)!.name,
      ...telling,
    }))
    .sort((a, b) => String(a.naam).localeCompare(String(b.naam)))
}

interface Db {
  events: Row[]
  attendance: Row[]
  match_ratings: Row[]
  players: Row[]
}

const RPC_HANDLERS: Record<string, (db: Db, args: Row) => Row[]> = {
  inzichten_aanwezigheid: rpcAanwezigheid,
  inzichten_training_opkomst_per_maand: rpcMaandOpkomst,
  inzichten_rating_team_per_wedstrijd: rpcTeamRating,
  inzichten_rating_speler: rpcRatingSpeler,
  inzichten_rating_per_speler: rpcRatingPerSpeler,
  inzichten_aanwezigheid_per_speler: rpcAanwezigheidPerSpeler,
}

function makeSupabaseMock(opts: {
  user?: { id: string } | null
  events?: Row[]
  players?: Row[]
  attendance?: Row[]
  matchRatings?: Row[]
  settings?: Row[]
  rpcErrors?: Record<string, unknown>
  // AC27: laat de niet-RPC-gedreven `events`-query (doelpunten + vormstrook)
  // falen zonder de RPC-gedreven kaarten te raken.
  eventsError?: unknown
  // Koppelingen van oefeningen aan trainingen, voor de trainingsinhoud-kaart.
  // Vorm: { event_id, oefeningen: { categorie } } — de gejoinde vorm die
  // countCategoryOccurrences() leest (lib/periodization.ts).
  trainingOefeningen?: Row[]
} = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const db: Db = {
    events: opts.events ?? [],
    attendance: opts.attendance ?? [],
    match_ratings: opts.matchRatings ?? [],
    // Default op [playerRow()] (id 'p1', type 'regular'): sinds de
    // gastspelers-feature hebben rpcAanwezigheid/rpcMaandOpkomst ook een
    // players-lookup nodig (zie hierboven). attendanceRow()/ratingRow()
    // wijzen standaard naar player_id 'p1' — zonder deze default zou elke
    // bestaande test die geen eigen `players` meegeeft stilzwijgend 0
    // aanwezigen/afwezigen berekenen (de rij bestaat wel, maar de "speler"
    // wordt niet gevonden en dus overgeslagen). Een test die tenant-isolatie
    // of het gast-/active-filter zelf test, geeft gewoon een eigen
    // `players`-array mee en overschrijft deze default.
    players: opts.players ?? [playerRow()],
  }
  const eventsFactory = tableFactory(db.events, () => opts.eventsError ?? null)
  const playersFactory = tableFactory(db.players)
  const settingsFactory = tableFactory(opts.settings ?? [])
  const trainingOefeningenFactory = tableFactory(opts.trainingOefeningen ?? [])
  const rpcCalls: { name: string; args: unknown }[] = []
  // AC14: bewijst dat een client-side filterwissel geen nieuwe `.from(...)`
  // -aanroep doet — zonder dit zou "geen page-reload/nieuwe fetch" alleen op
  // vertrouwen berusten in plaats van gemeten worden.
  const fromCalls: string[] = []

  return {
    __rpcCalls: rpcCalls,
    __fromCalls: fromCalls,
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      fromCalls.push(table)
      if (table === 'events') return eventsFactory()
      if (table === 'players') return playersFactory()
      if (table === 'settings') return settingsFactory()
      if (table === 'training_oefeningen') return trainingOefeningenFactory()
      throw new Error(`Onverwachte tabel in test: "${table}"`)
    },
    rpc: (name: string, args: Row) => {
      rpcCalls.push({ name, args })
      if (opts.rpcErrors?.[name]) {
        return Promise.resolve({ data: null, error: opts.rpcErrors[name] })
      }
      const handler = RPC_HANDLERS[name]
      if (!handler) throw new Error(`Onbekende RPC in test: "${name}"`)
      return Promise.resolve({ data: handler(db, args), error: null })
    },
  }
}

async function renderInzichten(
  opts: Parameters<typeof makeSupabaseMock>[0] = {},
  // Optioneel: zonder deze parameter wordt de pagina aangeroepen zoals
  // voorheen (helemaal zonder props), zodat elke bestaande test onveranderd
  // de standaardperiode "heel seizoen" toetst.
  periode?: string,
) {
  const mock = makeSupabaseMock(opts)
  vi.mocked(createClient).mockResolvedValue(mock as unknown as Awaited<ReturnType<typeof createClient>>)
  const el = periode === undefined
    ? await InzichtenPage()
    : await InzichtenPage({ searchParams: Promise.resolve({ periode }) })
  const rendered = render(<DictProvider dict={nl}>{el}</DictProvider>)
  return { ...rendered, rpcCalls: mock.__rpcCalls, fromCalls: mock.__fromCalls }
}

function seasonSettings(start: string, end: string): Row[] {
  return [
    { team_id: TEAM, key: 'season_start', value: start },
    { team_id: TEAM, key: 'season_end', value: end },
  ]
}

// Het percentage staat zowel als groot cijfer (span.font-display) áls, bij
// toeval, als een y-as-tick-tekst in de opkomst-per-maand-grafiek — vind
// daarom specifiek het percentage-cijfer in de Aanwezigheid-kaart.
function aanwezigheidPercentage(): string | null {
  const title = screen.getByText(nl.insights.aanwezigheidTitle)
  const card = title.closest('.surface-card') as HTMLElement
  const el = within(card).queryByText(/^\d+%$/, { selector: 'span.font-display' })
  return el?.textContent ?? null
}

// role="group" komt zowel van FormStrip (de vormstrook) als van de
// filterknoppen-rij in DoelpuntenChart — de vormstrook is degene met
// aria-label = t.home.formLabel.
function vormGroup(): HTMLElement {
  return screen.getByRole('group', { name: nl.home.formLabel })
}

// ── Feedback-ronde 2 helpers: Top 5/worst 5-kaarten (FC3/FC4) ──────────
// Zowel TopWorstRatings als TopWorstAanwezigheid gebruiken exact dezelfde
// bestLabel/worstLabel-tekst ("Beste"/"Minste"), dus elke lookup moet eerst
// scopen op de kaart (via de unieke titel) vóór hij binnen die kaart zoekt.
function topWorstCard(titleText: string): HTMLElement {
  return screen.getByText(titleText).closest('.surface-card') as HTMLElement
}

function topWorstSublist(card: HTMLElement, label: string): HTMLOListElement {
  const heading = within(card).getByText(label)
  return heading.parentElement!.querySelector('ol') as HTMLOListElement
}

// Namen, in de volgorde waarin ze in het lijstje ("Beste" of "Minste") staan.
function topWorstNames(card: HTMLElement, label: string): string[] {
  const list = topWorstSublist(card, label)
  return Array.from(list.querySelectorAll('li')).map((li) => li.firstElementChild?.textContent ?? '')
}

// Het waarde-tekstje (2e span) naast een specifieke naam binnen één lijstje.
function topWorstValueFor(card: HTMLElement, label: string, naam: string): string | null {
  const list = topWorstSublist(card, label)
  const li = Array.from(list.querySelectorAll('li')).find((el) => el.firstElementChild?.textContent === naam)
  return li?.lastElementChild?.textContent ?? null
}

// ═══════════════════════════════════════════════════════════════════════
// Niet ingelogd → bestaande /login-redirect
// ═══════════════════════════════════════════════════════════════════════
describe('niet ingelogd', () => {
  it("gooit de redirect naar /login, vóórdat er iets van settings/RPC's draait", async () => {
    await expect(renderInzichten({ user: null })).rejects.toThrow('__redirect__:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Geen (geldig) seizoen ingesteld → pagina-brede lege staat, GEEN RPC's
// ═══════════════════════════════════════════════════════════════════════
describe('geen seizoen ingesteld', () => {
  it('geen season_start/season_end → pagina-brede lege staat, geen enkele RPC aangeroepen', async () => {
    const { rpcCalls } = await renderInzichten({ settings: [] })
    expect(screen.getByText(nl.insights.noSeason)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.noSeasonHint)).toBeInTheDocument()
    expect(rpcCalls).toHaveLength(0)
    // Geen van de kaarten wordt gerenderd.
    expect(screen.queryByText(nl.insights.aanwezigheidTitle)).toBeNull()
  })

  it('omgekeerd venster (season_end < season_start) telt ook als "geen seizoen" — geen RPC-aanroep', async () => {
    const { rpcCalls } = await renderInzichten({ settings: seasonSettings('2026-12-31', '2026-07-01') })
    expect(screen.getByText(nl.insights.noSeason)).toBeInTheDocument()
    expect(rpcCalls).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Seizoensrapport — de pagina levert het print-blok mee en drukt zelf niet af
// ═══════════════════════════════════════════════════════════════════════
describe('seizoensrapport op de pagina', () => {
  const settings = seasonSettings('2026-07-01', '2026-12-31')
  const events = [eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC', match_type: 'league', goals_for: 3, goals_against: 1 })]

  it('rendert het print-blok naast de schermweergave, met de ingestelde clubkleuren en teamnaam', async () => {
    const { container } = await renderInzichten({
      settings: [
        ...settings,
        { team_id: TEAM, key: 'team_name', value: 'FC Voorbeeld' },
        { team_id: TEAM, key: 'team_color_primary', value: '#a1b2c3' },
        { team_id: TEAM, key: 'team_color_secondary', value: '#4d4dff' },
      ],
      events,
    })
    const blok = container.querySelector('[data-print-only]') as HTMLElement
    expect(blok).not.toBeNull()
    expect(blok.getAttribute('style')).toContain('--club-primary: #a1b2c3')
    expect(blok.textContent).toContain('FC Voorbeeld')
    expect(blok.textContent).toContain(nl.insights.rapportTitle)
  })

  it('de schermweergave draagt print:hidden, zodat er nooit twee versies uit de printer komen', async () => {
    const { container } = await renderInzichten({ settings, events })
    const scherm = container.querySelector('.print\\:hidden')
    expect(scherm).not.toBeNull()
    // De paginakop hoort bij het scherm-blok, niet bij het rapport.
    expect(scherm?.textContent).toContain(nl.insights.pageTitle)
  })

  it('het rapport volgt de gekozen periode, niet altijd het hele seizoen', async () => {
    const { container } = await renderInzichten({ settings, events }, '8w')
    const blok = container.querySelector('[data-print-only]') as HTMLElement
    expect(blok.textContent).toContain(nl.insights.periode8w)
    expect(blok.textContent).not.toContain(nl.insights.periodeSeizoen)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Periodefilter — ?periode=4w/8w knipt het venster af dat naar élke RPC en
// query gaat. TODAY staat vast op 2026-10-15 (zie boven), dus de verwachte
// startdatums hieronder zijn deterministisch.
// ═══════════════════════════════════════════════════════════════════════
describe('periodefilter', () => {
  const settings = seasonSettings('2026-07-01', '2026-12-31')

  // Startdatum die de RPC's meekregen. Alle zes gebruiken dezelfde p_start,
  // op de aanwezigheids-RPC's na — die knippen daarnaast op gisteren af, maar
  // dat raakt p_end, niet p_start.
  function rpcStarts(rpcCalls: { name: string; args: unknown }[]): string[] {
    return [...new Set(rpcCalls.map((c) => String((c.args as { p_start?: unknown }).p_start)))]
  }

  it('zonder parameter: het volledige seizoensvenster gaat naar de RPC\'s', async () => {
    const { rpcCalls } = await renderInzichten({ settings })
    expect(rpcStarts(rpcCalls)).toEqual(['2026-07-01'])
  })

  it('?periode=4w knipt de start af op 28 dagen terug, voor élke RPC', async () => {
    const { rpcCalls } = await renderInzichten({ settings }, '4w')
    expect(rpcStarts(rpcCalls)).toEqual(['2026-09-18'])
  })

  it('?periode=8w knipt de start af op 56 dagen terug', async () => {
    const { rpcCalls } = await renderInzichten({ settings }, '8w')
    expect(rpcStarts(rpcCalls)).toEqual(['2026-08-21'])
  })

  it('een onbekende periode valt terug op het hele seizoen — nooit stilzwijgend een smaller venster', async () => {
    const { rpcCalls } = await renderInzichten({ settings }, 'gisteren')
    expect(rpcStarts(rpcCalls)).toEqual(['2026-07-01'])
  })

  it('de periodekiezer markeert de actieve periode en linkt de standaard naar /inzichten zonder parameter', async () => {
    await renderInzichten({ settings }, '4w')
    const groep = screen.getByRole('group', { name: nl.insights.periodeLabel })
    const actief = within(groep).getByText(nl.insights.periode4w)
    expect(actief).toHaveAttribute('aria-current', 'page')
    expect(within(groep).getByText(nl.insights.periodeSeizoen)).toHaveAttribute('href', '/inzichten')
    expect(within(groep).getByText(nl.insights.periode8w)).toHaveAttribute('href', '/inzichten?periode=8w')
  })

  it('een periode zonder data houdt de periodekiezer zichtbaar — anders zit de gebruiker vast in een lege pagina', async () => {
    // Wedstrijd valt binnen het seizoen maar ruim buiten de laatste 4 weken.
    await renderInzichten({
      settings,
      events: [eventRow({ id: 'match-oud', type: 'match', date: '2026-07-05', opponent: 'DVC', match_type: 'league', goals_for: 2, goals_against: 0 })],
    }, '4w')
    expect(screen.getByText(nl.insights.periodeLeeg)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: nl.insights.periodeLabel })).toBeInTheDocument()
    // NIET de onboarding-lege staat: er ís data, alleen niet in deze periode.
    expect(screen.queryByText(nl.insights.geenDataTitle)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Seizoen ingesteld maar nog geen enkele registratie → één pagina-brede lege
// staat in plaats van zeven kaarten die elk apart "nog geen data" melden.
//
// Grens die deze twee tests samen vastleggen: ALLE bronnen leeg → lege staat;
// één ingevulde uitslag is al genoeg om de gewone pagina te tonen. Zonder die
// tweede test zou een te ruime conditie (bv. "geen aanwezigheid") ongemerkt
// een pagina met wél data kunnen wegdrukken.
// ═══════════════════════════════════════════════════════════════════════
describe('seizoen ingesteld, nog geen enkele registratie', () => {
  const settings = seasonSettings('2026-07-01', '2026-12-31')

  it('geen events, spelers, aanwezigheid of ratings → pagina-brede lege staat, geen enkele grafiekkaart', async () => {
    await renderInzichten({ settings })
    expect(screen.getByText(nl.insights.geenDataTitle)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.geenDataHint)).toBeInTheDocument()
    // Geen van de kaarten en ook de KPI-strook niet: dit is een lege PAGINA.
    expect(screen.queryByText(nl.insights.aanwezigheidTitle)).toBeNull()
    expect(screen.queryByText(nl.insights.opkomstTitle)).toBeNull()
    expect(screen.queryByText(nl.insights.vormTitle)).toBeNull()
    expect(screen.queryByText(nl.insights.kpiOpkomstLabel)).toBeNull()
    // De paginakop blijft wél staan — de gebruiker moet zien wáár hij is.
    expect(screen.getByText(nl.insights.pageTitle)).toBeInTheDocument()
  })

  it('één wedstrijd met een volledige uitslag is genoeg: gewone pagina, geen lege staat', async () => {
    await renderInzichten({
      settings,
      events: [eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC', match_type: 'league', goals_for: 3, goals_against: 1 })],
    })
    expect(screen.queryByText(nl.insights.geenDataTitle)).toBeNull()
    expect(screen.getByText(nl.insights.vormTitle)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.kpiDoelsaldoLabel)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Volledig seizoen → alle 4 (RPC-gedreven) grafieken correct
// ═══════════════════════════════════════════════════════════════════════
describe('volledig seizoen — alle 4 grafieken correct', () => {
  const settings = seasonSettings('2026-07-01', '2026-12-31')

  it('aanwezigheid, opkomst per maand, teamrating en doelpunten kloppen allemaal', async () => {
    await renderInzichten({
      settings,
      events: [
        eventRow({ id: 'training-1', type: 'training', date: '2026-09-10' }),
        eventRow({ id: 'training-2', type: 'training', date: '2026-10-10' }),
        eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC', match_type: 'league', goals_for: 3, goals_against: 1 }),
        eventRow({ id: 'match-2', type: 'match', date: '2026-09-12', opponent: 'FC Oost', match_type: 'friendly', goals_for: 1, goals_against: 1 }),
      ],
      // p2 hoort er als REGULIERE speler bij: attendanceRow hieronder
      // gebruikt player_id 'p2' voor de afwezige rij. Sinds rpcAanwezigheid
      // een players-lookup doet (gastspelers-feature), telt een attendance-
      // rij van een onbekende speler niet meer mee — zonder deze fixture
      // zou de test stilzwijgend een andere (foutieve) uitkomst bewijzen.
      players: [
        playerRow({ id: 'p1', name: 'Piet Peters', active: true }),
        playerRow({ id: 'p2', name: 'Jan Jansen', active: true }),
      ],
      attendance: [
        attendanceRow({ event_id: 'training-1', status: 'present' }),
        attendanceRow({ event_id: 'training-1', player_id: 'p2', status: 'absent' }),
        attendanceRow({ event_id: 'training-2', status: 'present' }),
        attendanceRow({ event_id: 'match-1', status: 'present' }),
      ],
      matchRatings: [
        ratingRow({ event_id: 'match-1', player_id: 'p1', rating: 8 }),
        ratingRow({ event_id: 'match-2', player_id: 'p1', rating: 6 }),
      ],
    })

    // Aanwezigheid: 3 present, 1 absent (training+match, meting uitgesloten) → 75%.
    expect(aanwezigheidPercentage()).toBe('75%')

    // Opkomst per maand: sep 1/1 = 100%, okt 1/0 = 100%.
    const tables = document.querySelectorAll('table')
    const opkomstTable = Array.from(tables).find((tb) => tb.querySelector('caption')?.textContent?.includes('maanden'))!
    expect(opkomstTable.textContent).toMatch(/Sep 2026/)
    expect(opkomstTable.textContent).toMatch(/Okt 2026/)

    // Teamrating: match-1 gemiddelde 8, match-2 gemiddelde 6.
    const ratingsTable = Array.from(tables).find((tb) => tb.querySelector('caption')?.textContent?.includes('wedstrijden') && tb.textContent?.includes('8'))!
    expect(ratingsTable.textContent).toMatch(/8/)
    expect(ratingsTable.textContent).toMatch(/6/)

    // Doelpunten: beide wedstrijden hebben een uitslag, dus beide in de grafiek.
    const doelpuntenTable = Array.from(tables).find((tb) => tb.querySelector('caption')?.textContent?.includes('wedstrijden ('))!
    expect(doelpuntenTable.textContent).toMatch(/DVC/)
    expect(doelpuntenTable.textContent).toMatch(/FC Oost/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Eén RPC geeft error → alleen die grafiek toont lege staat, andere 3
// renderen door
// ═══════════════════════════════════════════════════════════════════════
describe('één RPC geeft een fout', () => {
  const settings = seasonSettings('2026-07-01', '2026-12-31')
  const events = [
    eventRow({ id: 'training-1', type: 'training', date: '2026-09-10' }),
    eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC', match_type: 'league', goals_for: 3, goals_against: 1 }),
  ]
  const players = [playerRow()]
  const attendance = [attendanceRow({ event_id: 'training-1', status: 'present' })]
  const matchRatings = [ratingRow({ event_id: 'match-1', rating: 8 })]

  it('inzichten_aanwezigheid faalt → alleen die kaart is leeg, opkomst/rating/doelpunten renderen door', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderInzichten({
      settings, events, players, attendance, matchRatings,
      rpcErrors: { inzichten_aanwezigheid: { message: 'db down (simulated)', code: '500' } },
    })

    expect(screen.getByText(nl.insights.aanwezigheidEmpty)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/db down \(simulated\)/i)

    // De andere 3 RPC-gedreven kaarten renderen wél.
    const tables = document.querySelectorAll('table')
    const ratingsTable = Array.from(tables).find((tb) => tb.querySelector('caption')?.textContent?.includes('wedstrijden') && tb.textContent?.includes('8'))
    expect(ratingsTable).toBeTruthy()
    errorSpy.mockRestore()
  })

  it('inzichten_rating_team_per_wedstrijd faalt → alleen de ratingkaart is leeg, aanwezigheid rendert door', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderInzichten({
      settings, events, players, attendance, matchRatings,
      rpcErrors: { inzichten_rating_team_per_wedstrijd: { message: 'db down (simulated)', code: '500' } },
    })

    expect(screen.getByText(nl.insights.ratingsEmpty)).toBeInTheDocument()
    // Aanwezigheid (1/0 present → 100%) rendert nog gewoon.
    expect(aanwezigheidPercentage()).toBe('100%')
    errorSpy.mockRestore()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Seizoensgrens middenin een maand
// ═══════════════════════════════════════════════════════════════════════
describe('seizoensgrens middenin een maand', () => {
  it('een training exact op season_start/season_end telt mee, één dag erbuiten niet', async () => {
    await renderInzichten({
      settings: seasonSettings('2026-09-15', '2026-09-20'),
      events: [
        eventRow({ id: 'op-grens-start', type: 'training', date: '2026-09-15' }),
        eventRow({ id: 'op-grens-eind', type: 'training', date: '2026-09-20' }),
        eventRow({ id: 'voor-seizoen', type: 'training', date: '2026-09-14' }),
        eventRow({ id: 'na-seizoen', type: 'training', date: '2026-09-21' }),
      ],
      attendance: [
        attendanceRow({ event_id: 'op-grens-start', status: 'present' }),
        attendanceRow({ event_id: 'op-grens-eind', status: 'present' }),
        attendanceRow({ event_id: 'voor-seizoen', status: 'absent' }),
        attendanceRow({ event_id: 'na-seizoen', status: 'absent' }),
      ],
    })

    // Alleen de 2 aanwezigheden binnen het venster tellen mee (2 present, 0 absent → 100%).
    expect(aanwezigheidPercentage()).toBe('100%')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Feedback 1/2 — geen toekomstige events in de aanwezigheidscijfers: het
// venster van inzichten_aanwezigheid en inzichten_training_opkomst_per_maand
// stopt bij gisteren (verledenSeizoensVenster(), lib/inzichten.ts), ook als
// het seizoen nog doorloopt.
// ═══════════════════════════════════════════════════════════════════════
describe('toekomstige events tellen niet mee in de aanwezigheidscijfers', () => {
  // Seizoen loopt door tot ver ná TODAY (2026-10-15).
  const settings = seasonSettings('2026-07-01', '2027-06-30')

  it('een al ingeplande training van morgen verlaagt het aanwezigheidspercentage niet', async () => {
    const { rpcCalls } = await renderInzichten({
      settings,
      events: [
        eventRow({ id: 'gisteren', type: 'training', date: '2026-10-14' }),
        eventRow({ id: 'morgen', type: 'training', date: '2026-10-16' }),
      ],
      attendance: [
        attendanceRow({ event_id: 'gisteren', status: 'present' }),
        // Nog niet afgevinkt → zou als 'absent' meetellen zonder de cutoff.
        attendanceRow({ event_id: 'morgen', status: 'absent' }),
      ],
    })

    expect(aanwezigheidPercentage()).toBe('100%')

    const aanwezigheidCall = rpcCalls.find((c) => c.name === 'inzichten_aanwezigheid')!
    expect(aanwezigheidCall.args).toEqual({ p_start: '2026-07-01', p_end: '2026-10-14' })
    const opkomstCall = rpcCalls.find((c) => c.name === 'inzichten_training_opkomst_per_maand')!
    expect(opkomstCall.args).toEqual({ p_start: '2026-07-01', p_end: '2026-10-14' })
  })

  it('een training van vandaag telt (nog) niet mee — zelfde grens als de vorm-cutoff', async () => {
    await renderInzichten({
      settings,
      events: [
        eventRow({ id: 'gisteren', type: 'training', date: '2026-10-14' }),
        eventRow({ id: 'vandaag', type: 'training', date: TODAY }),
      ],
      attendance: [
        attendanceRow({ event_id: 'gisteren', status: 'present' }),
        attendanceRow({ event_id: 'vandaag', status: 'absent' }),
      ],
    })

    expect(aanwezigheidPercentage()).toBe('100%')
  })

  it('een maand die volledig in de toekomst ligt verschijnt niet als rij in de trainingsopkomst', async () => {
    await renderInzichten({
      settings,
      events: [
        eventRow({ id: 'sep-training', type: 'training', date: '2026-09-10' }),
        eventRow({ id: 'nov-training', type: 'training', date: '2026-11-10' }),
      ],
      attendance: [
        attendanceRow({ event_id: 'sep-training', status: 'present' }),
        attendanceRow({ event_id: 'nov-training', status: 'absent' }),
      ],
    })

    const tables = document.querySelectorAll('table')
    const opkomstTable = Array.from(tables).find((tb) => tb.querySelector('caption')?.textContent?.includes('maanden'))!
    expect(opkomstTable.textContent).toMatch(/Sep 2026/)
    expect(opkomstTable.textContent).not.toMatch(/Nov 2026/)
    expect(opkomstTable.querySelectorAll('tbody tr')).toHaveLength(1)
  })

  it('de rating-/doelpuntenkaarten houden het volledige seizoensvenster — die zijn per definitie verleden-only', async () => {
    const { rpcCalls } = await renderInzichten({
      settings,
      events: [eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC' })],
      players: [playerRow({ id: PLAYER_ACTIVE, active: true })],
      matchRatings: [ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 8 })],
    })

    const teamRatingCall = rpcCalls.find((c) => c.name === 'inzichten_rating_team_per_wedstrijd')!
    expect(teamRatingCall.args).toEqual({ p_start: '2026-07-01', p_end: '2027-06-30' })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Feedback 3 (datakant) — de twee nieuwe per-speler-RPC's worden bij het
// laden aangeroepen met het juiste venster. De bijbehorende top 5/worst 5-
// kaarten bouwt de frontend-engineer; hier wordt alleen de query-integratie
// vastgelegd.
// ═══════════════════════════════════════════════════════════════════════
describe('per-speler-RPC\'s voor top 5 / worst 5', () => {
  it('rating per speler krijgt het volle seizoensvenster, aanwezigheid per speler het geclampte venster', async () => {
    const { rpcCalls } = await renderInzichten({
      settings: seasonSettings('2026-07-01', '2027-06-30'),
      events: [eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC' })],
      players: [playerRow({ id: PLAYER_ACTIVE, active: true })],
      matchRatings: [ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 8 })],
    })

    const ratingCall = rpcCalls.find((c) => c.name === 'inzichten_rating_per_speler')!
    expect(ratingCall.args).toEqual({ p_start: '2026-07-01', p_end: '2027-06-30' })

    const aanwezigheidCall = rpcCalls.find((c) => c.name === 'inzichten_aanwezigheid_per_speler')!
    expect(aanwezigheidCall.args).toEqual({ p_start: '2026-07-01', p_end: '2026-10-14' })
  })

  it('een falende per-speler-RPC blokkeert de bestaande kaarten niet en lekt geen ruwe fout', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [eventRow({ id: 'training-1', type: 'training', date: '2026-09-10' })],
      attendance: [attendanceRow({ event_id: 'training-1', status: 'present' })],
      rpcErrors: {
        inzichten_rating_per_speler: { message: 'db down (simulated)', code: '500' },
        inzichten_aanwezigheid_per_speler: { message: 'db down (simulated)', code: '500' },
      },
    })

    expect(aanwezigheidPercentage()).toBe('100%')
    expect(document.body.textContent).not.toMatch(/db down \(simulated\)/i)
    errorSpy.mockRestore()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Tenant-isolatie: data van een ander team_id komt nergens terug
// ═══════════════════════════════════════════════════════════════════════
describe('tenant-isolatie', () => {
  it('attendance/ratings/events van een ander team_id beïnvloeden geen enkele grafiek van dit team', async () => {
    await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [
        eventRow({ id: 'eigen-training', team_id: TEAM, type: 'training', date: '2026-09-10' }),
        eventRow({ id: 'ander-training', team_id: OTHER_TEAM, type: 'training', date: '2026-09-10' }),
      ],
      attendance: [
        attendanceRow({ team_id: TEAM, event_id: 'eigen-training', status: 'present' }),
        // Ander team_id op de attendance-rij zelf, gekoppeld aan het EIGEN event —
        // dekt de dubbele team_id-check in de RPC (a.team_id én e.team_id).
        attendanceRow({ team_id: OTHER_TEAM, event_id: 'eigen-training', status: 'absent' }),
        attendanceRow({ team_id: OTHER_TEAM, event_id: 'ander-training', status: 'absent' }),
      ],
    })

    // Alleen de ene eigen 'present' telt mee (1 present, 0 absent → 100%), niet
    // de 2 absent-rijen van het andere team.
    expect(aanwezigheidPercentage()).toBe('100%')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Wedstrijd zonder uitslag: ontbreekt in de doelpuntengrafiek, staat wel als
// "?" in de vormstrook
// ═══════════════════════════════════════════════════════════════════════
describe('wedstrijd zonder uitslag', () => {
  it('ontbreekt in de sr-only doelpuntentabel, maar staat als "?" in de vormstrook', async () => {
    await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [
        eventRow({ id: 'zonder-uitslag', type: 'match', date: '2026-09-01', opponent: 'Onbekend FC', goals_for: null, goals_against: null }),
        eventRow({ id: 'met-uitslag', type: 'match', date: '2026-09-02', opponent: 'DVC', goals_for: 2, goals_against: 0 }),
      ],
    })

    const tables = document.querySelectorAll('table')
    const doelpuntenTable = Array.from(tables).find((tb) => tb.querySelector('caption')?.textContent?.includes('wedstrijden ('))!
    expect(doelpuntenTable.textContent).not.toMatch(/Onbekend FC/)
    expect(doelpuntenTable.textContent).toMatch(/DVC/)

    // Vormstrook: role="group" komt van FormStrip; 2 tekens, oudste (zonder
    // uitslag) is '?', nieuwste (met uitslag) is 'W'.
    const group = vormGroup()
    const letters = Array.from(group.querySelectorAll('span[aria-label]')).map((el) => el.textContent)
    expect(letters).toEqual([nl.home.formLetterWin, nl.home.formLetterUnknown])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// A11y — elke RPC-gedreven grafiek heeft role="img" met een niet-lege
// aria-label; de vormstrook heeft role="group"
// ═══════════════════════════════════════════════════════════════════════
describe('basis-toegankelijkheid op paginaniveau', () => {
  it('4 role="img"-grafieken (aanwezigheid, opkomst, ratings, doelpunten) + 1 role="group" (vorm), allemaal met tekstinhoud', async () => {
    await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [
        eventRow({ id: 'training-1', type: 'training', date: '2026-09-10' }),
        eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC', goals_for: 3, goals_against: 1 }),
      ],
      players: [playerRow()],
      attendance: [attendanceRow({ event_id: 'training-1', status: 'present' })],
      matchRatings: [ratingRow({ event_id: 'match-1', rating: 8 })],
    })

    const imgs = screen.getAllByRole('img')
    expect(imgs.length).toBeGreaterThanOrEqual(4)
    for (const img of imgs) {
      expect(img.getAttribute('aria-label')).toBeTruthy()
    }
    expect(within(vormGroup()).getAllByText(/W|G|V|\?/).length).toBeGreaterThan(0)
  })

  it('AC28: elke role="img"-grafiek heeft een `sr-only`-tabel met de exacte cijfers, niet uitsluitend een kleur/vorm in de SVG', async () => {
    await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [
        eventRow({ id: 'training-1', type: 'training', date: '2026-09-10' }),
        eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC', match_type: 'league', goals_for: 3, goals_against: 1 }),
      ],
      // p2 hoort er als REGULIERE speler bij (zie de toelichting bij de
      // "volledig seizoen"-test) — anders telt de afwezige rij niet mee en
      // klopt de verwachte 50% hieronder niet meer.
      players: [
        playerRow({ id: PLAYER_ACTIVE }),
        playerRow({ id: 'p2', name: 'Jan Jansen', active: true }),
      ],
      attendance: [
        attendanceRow({ event_id: 'training-1', status: 'present' }),
        attendanceRow({ event_id: 'training-1', player_id: 'p2', status: 'absent' }),
      ],
      matchRatings: [ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 8 })],
    })

    // Elke sr-only-tabel moet een <caption> hebben (VoiceOver/NVDA lezen die
    // als eerste voor) én de ruwe waarden als tekst, niet enkel als kleur.
    const tables = Array.from(document.querySelectorAll('table.sr-only'))
    expect(tables.length).toBeGreaterThanOrEqual(4)
    for (const tb of tables) {
      expect(tb.querySelector('caption')?.textContent?.trim()).toBeTruthy()
    }

    // Aanwezigheid: 1 present, 1 absent → 50%. De exacte cijfers (niet enkel
    // de kleur van het taartdiagram) staan in de sr-only-tabel.
    const aanwCard = screen.getByText(nl.insights.aanwezigheidTitle).closest('.surface-card') as HTMLElement
    const aanwCells = Array.from(within(aanwCard).getByRole('table').querySelectorAll('td')).map((td) => td.textContent)
    expect(aanwCells).toEqual(expect.arrayContaining([nl.insights.aanwezigLabel, '1', nl.insights.afwezigLabel, '1']))

    // Doelpunten: 3 voor, 1 tegen tegen DVC — exact terug te vinden als tekst.
    const doelpuntenCard = screen.getByText(nl.insights.doelpuntenTitle).closest('.surface-card') as HTMLElement
    const doelpuntenCells = Array.from(within(doelpuntenCard).getByRole('table').querySelectorAll('td')).map((td) => td.textContent)
    expect(doelpuntenCells).toEqual(expect.arrayContaining(['3', '1']))
  })

  // Regressietest ná de validator-bevinding: role="img" impliceert
  // "children presentational: true" (WAI-ARIA) — AT negeert dan alles
  // eronder en leest alleen de korte aria-label, niet de sr-only-tabel. De
  // vorige AC28-test hierboven bewees alleen dát de sr-only-tabel ÉRGENS in
  // de DOM stond (via within(card).getByRole('table')), niet dat hij buiten
  // een role="img"-element staat. Deze test controleert dat structureel,
  // voor ALLE role="img"-grafieken op de pagina — inclusief de tweede
  // (per-speler) grafiek in RatingsChart, die pas rendert ná een
  // selector-wissel.
  it('AC28 (structureel): geen enkele sr-only ChartDataTable zit genest in een element met role="img", voor alle grafieken incl. de per-speler-ratinggrafiek', async () => {
    await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [
        eventRow({ id: 'training-1', type: 'training', date: '2026-09-10' }),
        eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC', match_type: 'league', goals_for: 3, goals_against: 1 }),
      ],
      // p2 hoort er als REGULIERE speler bij, zie de toelichting hierboven.
      players: [
        playerRow({ id: PLAYER_ACTIVE, active: true, name: 'Piet Peters' }),
        playerRow({ id: 'p2', name: 'Jan Jansen', active: true }),
      ],
      attendance: [
        attendanceRow({ event_id: 'training-1', status: 'present' }),
        attendanceRow({ event_id: 'training-1', player_id: 'p2', status: 'absent' }),
      ],
      matchRatings: [ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 8 })],
    })

    // Trigger ook de TWEEDE role="img" in RatingsChart (de per-speler-
    // ratinggrafiek), die alleen rendert na een selector-wissel — anders zou
    // deze test die plek nooit controleren.
    vi.useRealTimers()
    const select = screen.getByLabelText(nl.insights.spelerSelectLabel)
    fireEvent.change(select, { target: { value: PLAYER_ACTIVE } })
    await waitFor(() => {
      const tables = Array.from(document.querySelectorAll('table'))
      expect(tables.some((tb) => tb.querySelector('caption')?.textContent?.includes('Individuele rating'))).toBe(true)
    })

    // Alle 6 role="img"-grafieken op dit moment: Aanwezigheid, Opkomst per
    // maand, Doelpunten, Ratings-team, Ratings-speler, Vorm.
    const imgEls = screen.getAllByRole('img')
    expect(imgEls.length).toBeGreaterThanOrEqual(6)
    for (const img of imgEls) {
      const nestedTable = img.querySelector('table.sr-only')
      expect(nestedTable).toBeNull()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC1/AC2 — toegang via de tegel
// ═══════════════════════════════════════════════════════════════════════
describe('AC1/AC2 — toegang via de tegel', () => {
  it('AC2: de app-launcher in de mobiele navigatiebalk bevat een tegel naar /inzichten, analoog aan de bestaande tegel naar /periodisering', () => {
    // De tegel zat tot 2026-08-28 in QuickActions op het dashboard; die sectie
    // is vervangen door deze launcher (components/AppLauncher.tsx), bereikbaar
    // via de "Meer"-tab vanaf élk scherm. Het criterium — er is één tik naar
    // /inzichten, naast /periodisering — is ongewijzigd.
    //
    // AppLauncher gebruikt useReducedMotion (lib/use-reduced-motion.ts) voor
    // de open-animatie; jsdom kent window.matchMedia niet standaard. Zelfde
    // stub als components/PlayerList.test.tsx.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    render(<DictProvider dict={nl}><AppLauncher open onClose={() => {}} /></DictProvider>)
    // De tegel-<a> bevat ook een icoon-ligature-span; de accessible name is
    // dus "monitoring Periodisering" i.p.v. exact het label, vandaar
    // getByText (op het label-span) + closest('a') i.p.v. getByRole('link').
    const periodiseringLink = screen.getByText(nl.nav.periodization).closest('a')
    const inzichtenLink = screen.getByText(nl.nav.insights).closest('a')
    expect(periodiseringLink).toHaveAttribute('href', '/periodisering')
    expect(inzichtenLink).toHaveAttribute('href', '/inzichten')
  })

  it('AC1: na de tegel toont /inzichten de pagina met alle grafiek-onderdelen uit de volledige criteria-lijst', async () => {
    // AC1's samenvattende zin noemt "4 grafiek-onderdelen", maar de volledige,
    // eveneens goedgekeurde criteria-lijst beschrijft 5 aparte clusters —
    // inclusief de "nieuwe" Trainingsopkomst-per-maand-kaart (AC17–AC21). De
    // gebouwde pagina toont terecht alle 5 (zie testverslag: dit is een
    // afwijking in de AC1-tekst zelf, geen bouwfout).
    await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [
        eventRow({ id: 'training-1', type: 'training', date: '2026-09-10' }),
        eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC', goals_for: 3, goals_against: 1 }),
      ],
      players: [playerRow({ id: PLAYER_ACTIVE })],
      attendance: [attendanceRow({ event_id: 'training-1', status: 'present' })],
      matchRatings: [ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 8 })],
    })
    expect(screen.getByText(nl.insights.aanwezigheidTitle)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.opkomstTitle)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.ratingsTitle)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.doelpuntenTitle)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.vormTitle)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC13–AC16 — doelpuntenfilter, getest op de SAMENGESTELDE pagina (niet op
// een geïsoleerd component): bewijst dat de al door de server opgehaalde
// `items`-prop client-side gefilterd wordt, zonder extra databasetoegang.
// ═══════════════════════════════════════════════════════════════════════
describe('AC13–AC16 — doelpuntenfilter op de samengestelde pagina', () => {
  const settings = seasonSettings('2026-07-01', '2026-12-31')
  const events = [
    eventRow({ id: 'm-league', type: 'match', date: '2026-09-01', opponent: 'DVC', match_type: 'league', goals_for: 2, goals_against: 1 }),
    eventRow({ id: 'm-friendly', type: 'match', date: '2026-09-02', opponent: 'FC Oost', match_type: 'friendly', goals_for: 1, goals_against: 1 }),
  ]

  function doelpuntenCard(): HTMLElement {
    return screen.getByText(nl.insights.doelpuntenTitle).closest('.surface-card') as HTMLElement
  }

  // De tegenstandernaam staat zowel in de recharts-SVG (<tspan>, tick-label)
  // als in de sr-only-tabel — scope daarom bewust op de <table>, anders vindt
  // getByText 2 matches en gooit hij een dubbelzinnigheidsfout.
  function doelpuntenTableRows(): string[] {
    const table = within(doelpuntenCard()).getByRole('table')
    return Array.from(table.querySelectorAll('tbody tr')).map((r) => r.textContent ?? '')
  }

  it('AC13: default filterstand bij openen is "alle"', async () => {
    await renderInzichten({ settings, events })
    const allBtn = within(doelpuntenCard()).getByRole('button', { name: nl.insights.filterAll })
    expect(allBtn).toHaveAttribute('aria-pressed', 'true')
    const rows = doelpuntenTableRows()
    expect(rows.some((r) => r.includes('DVC'))).toBe(true)
    expect(rows.some((r) => r.includes('FC Oost'))).toBe(true)
  })

  it('AC14: wisselen naar "Competitie" herberekent direct client-side, zonder nieuwe fetch/RPC-aanroep', async () => {
    const { rpcCalls, fromCalls } = await renderInzichten({ settings, events })
    const rpcCountBefore = rpcCalls.length
    const fromCountBefore = fromCalls.length

    fireEvent.click(within(doelpuntenCard()).getByRole('button', { name: nl.event.matchTypes.league }))

    // Geen enkele nieuwe databasetoegang: InzichtenPage is een server
    // component die al vóór de klik éénmalig is uitgevoerd; de toggle
    // herrekent puur client-side vanuit de al opgehaalde `items`-prop
    // (filterDoelpunten(), lib/inzichten.ts).
    expect(rpcCalls.length).toBe(rpcCountBefore)
    expect(fromCalls.length).toBe(fromCountBefore)

    const rows = doelpuntenTableRows()
    expect(rows.some((r) => r.includes('FC Oost'))).toBe(false)
    expect(rows.some((r) => r.includes('DVC'))).toBe(true)
  })

  it('AC15: filter naar een stand zonder data ("Beker") → lege staat voor die selectie, geen foutmelding', async () => {
    await renderInzichten({ settings, events })
    fireEvent.click(within(doelpuntenCard()).getByRole('button', { name: nl.event.matchTypes.cup }))
    expect(within(doelpuntenCard()).getByText(nl.insights.doelpuntenFilterEmpty)).toBeInTheDocument()
    expect(within(doelpuntenCard()).queryByRole('img')).toBeNull()
    // De foutmelding staat nergens op de pagina.
    expect(document.body.textContent).not.toMatch(/error|exception/i)
  })

  it('AC16: geen enkele wedstrijd met volledige uitslag binnen het venster → pagina-brede lege staat voor deze kaart', async () => {
    await renderInzichten({
      settings,
      events: [eventRow({ id: 'zonder-uitslag', type: 'match', date: '2026-09-01', goals_for: null, goals_against: null })],
    })
    expect(within(doelpuntenCard()).getByText(nl.insights.doelpuntenEmpty)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC18 — maandlabel is tijdzone-veilig (timeZone: UTC in maandLabel())
// ═══════════════════════════════════════════════════════════════════════
describe('AC18 — maandlabel is tijdzone-veilig', () => {
  const ORIGINAL_TZ = process.env.TZ

  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ
  })

  it('een training op de 1e van de maand blijft in die maand staan, ook als de servertijdzone ten westen van UTC ligt', async () => {
    // Reproduceert exact de bug die AC18 verbiedt: zonder `timeZone:'UTC'` in
    // maandLabel() (components/inzichten/OpkomstPerMaandChart.tsx) zou
    // Date.UTC(2026,8,1) (1 sep 00:00 UTC) in bv. Los Angeles (UTC-7) op 31
    // augustus lokale tijd vallen en dus als "Aug 2026" renderen i.p.v.
    // "Sep 2026". Deze omgeving draait zelf op Europe/Amsterdam (vóór UTC),
    // wat die bug NOOIT zou laten zien — vandaar de expliciete TZ-override.
    process.env.TZ = 'America/Los_Angeles'
    await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [eventRow({ id: 'training-1', type: 'training', date: '2026-09-01' })],
      attendance: [attendanceRow({ event_id: 'training-1', status: 'present' })],
    })
    const tables = document.querySelectorAll('table')
    const opkomstTable = Array.from(tables).find((tb) => tb.querySelector('caption')?.textContent?.includes('maanden'))!
    expect(opkomstTable.textContent).toMatch(/Sep 2026/)
    expect(opkomstTable.textContent).not.toMatch(/Aug 2026/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC19/AC20 — opkomst per maand: randgevallen rond de seizoensgrens
// ═══════════════════════════════════════════════════════════════════════
describe('AC19/AC20 — opkomst per maand: randgevallen', () => {
  it('AC19: een gedeeltelijke maand aan de seizoensgrens telt volledig mee zodra er ≥1 training van die maand binnen het venster valt', async () => {
    await renderInzichten({
      // Venster begint pas op 28 september — september is dus een
      // gedeeltelijke maand (28,29,30) binnen het venster.
      settings: seasonSettings('2026-09-28', '2026-10-31'),
      events: [eventRow({ id: 'sep-training', type: 'training', date: '2026-09-29' })],
      attendance: [attendanceRow({ event_id: 'sep-training', status: 'present' })],
    })
    const tables = document.querySelectorAll('table')
    const opkomstTable = Array.from(tables).find((tb) => tb.querySelector('caption')?.textContent?.includes('maanden'))!
    expect(opkomstTable.textContent).toMatch(/Sep 2026/)
  })

  it('AC20: een maand zonder training binnen het venster wordt helemaal niet getoond (niet als 0%-rij)', async () => {
    await renderInzichten({
      settings: seasonSettings('2026-09-01', '2026-10-31'),
      events: [eventRow({ id: 'okt-training', type: 'training', date: '2026-10-05' })],
      attendance: [attendanceRow({ event_id: 'okt-training', status: 'present' })],
    })
    const tables = document.querySelectorAll('table')
    const opkomstTable = Array.from(tables).find((tb) => tb.querySelector('caption')?.textContent?.includes('maanden'))!
    expect(opkomstTable.textContent).toMatch(/Okt 2026/)
    expect(opkomstTable.textContent).not.toMatch(/Sep 2026/)
    // September wordt niet als losse 0%-rij geretourneerd: precies 1 datarij
    // (Okt), niet 2 (waarvan Sep op 0%).
    expect(opkomstTable.querySelectorAll('tbody tr')).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC8/AC21/AC25 — lege staten zonder brondata: nooit een verzonnen 0%/lege
// grafiek, gewoon de daarvoor bedoelde lege-staattekst
// ═══════════════════════════════════════════════════════════════════════
describe('AC8/AC21/AC25 — lege staten zonder brondata', () => {
  const settings = seasonSettings('2026-07-01', '2026-12-31')

  // AANGEPAST SCENARIO (niet het criterium): deze drie tests draaiden eerder
  // op `renderInzichten({ settings })` — een seizoen zónder ook maar één
  // registratie. Sinds de pagina-brede lege staat (zie de describe
  // "seizoen ingesteld, nog geen enkele registratie") rendert dat scenario
  // helemaal geen grafiekkaarten meer, dus daar viel de per-kaart lege staat
  // niet langer te bewijzen.
  //
  // Het CRITERIUM is ongewijzigd en wordt hieronder nog steeds volledig
  // getoetst: zonder brondata toont een kaart zijn lege-staattekst en NOOIT
  // een verzonnen 0%. Er is alleen één losstaande wedstrijd toegevoegd zodat
  // de pagina normaal rendert — die wedstrijd voedt uitsluitend de
  // doelpunten-/vormkaart en raakt aanwezigheid, opkomst en ratings niet.
  const losseWedstrijd = eventRow({
    id: 'match-los', type: 'match', date: '2026-09-05',
    opponent: 'DVC', match_type: 'league', goals_for: 3, goals_against: 1,
  })

  it('AC8: geen aanwezigheidsdata binnen het venster → lege staat, geen verzonnen 0%', async () => {
    await renderInzichten({ settings, events: [losseWedstrijd] })
    expect(screen.getByText(nl.insights.aanwezigheidEmpty)).toBeInTheDocument()
    expect(aanwezigheidPercentage()).toBeNull()
  })

  it('AC21: geen trainingen/aanwezigheidsregistraties binnen het venster → opkomst-per-maand toont zijn lege staat', async () => {
    await renderInzichten({ settings, events: [losseWedstrijd] })
    expect(screen.getByText(nl.insights.opkomstEmpty)).toBeInTheDocument()
  })

  it('AC25: geen match_ratings van actieve spelers binnen het venster → team- én per-speler-weergave allebei leeg (selector verschijnt niet eens)', async () => {
    await renderInzichten({
      settings,
      events: [losseWedstrijd],
      players: [playerRow({ id: PLAYER_ACTIVE, active: true })],
    })
    expect(screen.getByText(nl.insights.ratingsEmpty)).toBeInTheDocument()
    expect(screen.queryByLabelText(nl.insights.spelerSelectLabel)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC22/AC24 — teamgemiddelde sluit inactieve spelers uit (team- én
// per-speler-weergave, plus de selector zelf)
// ═══════════════════════════════════════════════════════════════════════
describe('AC22/AC24 — teamgemiddelde sluit inactieve spelers uit', () => {
  const settings = seasonSettings('2026-07-01', '2026-12-31')
  const match = eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC' })

  function teamRatingsTable(): HTMLTableElement {
    const tables = Array.from(document.querySelectorAll('table'))
    return tables.find((tb) => tb.querySelector('caption')?.textContent?.includes('Teamgemiddelde')) as HTMLTableElement
  }

  it('AC22: teamgemiddelde is het gemiddelde over alle actieve spelers voor die wedstrijd', async () => {
    await renderInzichten({
      settings,
      events: [match],
      players: [playerRow({ id: PLAYER_ACTIVE, active: true, name: 'Actief Speler' })],
      matchRatings: [ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 8 })],
    })
    const cellTexts = Array.from(teamRatingsTable().querySelectorAll('td')).map((td) => td.textContent)
    expect(cellTexts).toContain('8')
  })

  it('AC24: een inactieve speler met een rating op dezelfde wedstrijd telt NIET mee in het teamgemiddelde', async () => {
    await renderInzichten({
      settings,
      events: [match],
      players: [
        playerRow({ id: PLAYER_ACTIVE, active: true, name: 'Actief Speler' }),
        playerRow({ id: PLAYER_INACTIVE, active: false, name: 'Inactieve Speler' }),
      ],
      matchRatings: [
        ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 8 }),
        // Zonder de active-filter zou het gemiddelde (8+2)/2 = 5 zijn i.p.v. 8.
        ratingRow({ event_id: 'match-1', player_id: PLAYER_INACTIVE, rating: 2 }),
      ],
    })
    const cellTexts = Array.from(teamRatingsTable().querySelectorAll('td')).map((td) => td.textContent)
    expect(cellTexts).toContain('8')
    expect(cellTexts).not.toContain('5')
  })

  it('AC24: de inactieve speler staat niet als optie in de individuele-ratingselector', async () => {
    await renderInzichten({
      settings,
      events: [match],
      players: [
        playerRow({ id: PLAYER_ACTIVE, active: true, name: 'Actief Speler' }),
        playerRow({ id: PLAYER_INACTIVE, active: false, name: 'Inactieve Speler' }),
      ],
      matchRatings: [ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 8 })],
    })
    const select = screen.getByLabelText(nl.insights.spelerSelectLabel) as HTMLSelectElement
    const optionLabels = Array.from(select.options).map((o) => o.textContent)
    expect(optionLabels).toContain('Actief Speler')
    expect(optionLabels).not.toContain('Inactieve Speler')
  })

  it('AC24: rechtstreeks aanroepen van getSpelerRatingReeks met het id van een inactieve speler geeft [] terug — server-side afgedwongen, niet enkel een UI-restrictie', async () => {
    await renderInzichten({
      settings,
      events: [match],
      players: [playerRow({ id: PLAYER_INACTIVE, active: false, name: 'Inactieve Speler' })],
      matchRatings: [ratingRow({ event_id: 'match-1', player_id: PLAYER_INACTIVE, rating: 8 })],
    })
    // Dezelfde createClient-mock die renderInzichten() net heeft ingesteld is
    // nog actief — dit roept de ECHTE server action + RPC-herimplementatie
    // aan, buiten de UI om, zoals een omzeilende/foutieve client dat ook zou
    // kunnen proberen (de speler bestaat wél bij dit team, is alleen inactief).
    const reeks = await getSpelerRatingReeks(PLAYER_INACTIVE)
    expect(reeks).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC10/AC11/AC12 — gastspelers (players.type = 'guest') tellen nooit mee in
// de teambrede statistieken. Toegevoegd door de test-verifier: dit blok
// bewijst zowel dat de zes RPC-mock-functies hierboven het gast-filter
// daadwerkelijk toepassen, als dat app/inzichten/page.tsx (spelerskiezer)
// gasten weglaat (O3).
// ═══════════════════════════════════════════════════════════════════════
describe('AC10/AC11/AC12 — gastspelers uitgesloten van teambrede statistieken', () => {
  const settings = seasonSettings('2026-07-01', '2026-12-31')
  const training = eventRow({ id: 'training-1', type: 'training', date: '2026-09-10' })
  const match = eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC' })
  const PLAYER_GUEST = 'eeeeeeee-0000-0000-0000-000000000001'
  const PLAYER_ACTIVE_2 = 'eeeeeeee-0000-0000-0000-000000000002'

  function opkomstPerMaandCells(): string[] {
    const tables = Array.from(document.querySelectorAll('table'))
    const table = tables.find((tb) => tb.querySelector('caption')?.textContent?.includes('maanden')) as HTMLTableElement
    return Array.from(table.querySelectorAll('td')).map((td) => td.textContent ?? '')
  }

  it('AC10: een gast met een aanwezigheidsrij in het venster verandert het teambrede opkomstpercentage niet', async () => {
    // Bewust een NIET-100%-basis (1 aanwezig, 1 afwezig → 50%): zou de
    // gast-rij toch meetellen (in teller óf noemer), dan verschuift dit
    // percentage aantoonbaar — een 100%-basis zou een missend filter niet
    // per se laten opvallen (een aanwezige gast extra blijft dan toevallig
    // ook 100%).
    const basis = {
      settings,
      events: [training],
      players: [
        playerRow({ id: PLAYER_ACTIVE, active: true, name: 'Vaste Speler 1' }),
        playerRow({ id: PLAYER_ACTIVE_2, active: true, name: 'Vaste Speler 2' }),
      ],
      attendance: [
        attendanceRow({ event_id: 'training-1', player_id: PLAYER_ACTIVE, status: 'present' }),
        attendanceRow({ event_id: 'training-1', player_id: PLAYER_ACTIVE_2, status: 'absent' }),
      ],
    }
    const { unmount } = await renderInzichten(basis)
    const zonderGast = aanwezigheidPercentage()
    unmount()

    await renderInzichten({
      ...basis,
      players: [
        ...basis.players,
        playerRow({ id: PLAYER_GUEST, type: 'guest', active: true, name: 'Gast Speler' }),
      ],
      attendance: [
        ...basis.attendance,
        // Zelfs aanwezig (dus in de teller ván een gewone telling) mag het
        // percentage niet veranderen — de gast wordt volledig genegeerd, niet
        // als 'absent' geteld.
        attendanceRow({ event_id: 'training-1', player_id: PLAYER_GUEST, status: 'present' }),
      ],
    })
    expect(zonderGast).toBe('50%')
    expect(aanwezigheidPercentage()).toBe(zonderGast)
  })

  it('AC11: opkomst per maand blijft ongewijzigd als een gast in dezelfde maand meedoet', async () => {
    const basis = {
      settings,
      events: [training],
      players: [playerRow({ id: PLAYER_ACTIVE, active: true, name: 'Vaste Speler' })],
      attendance: [attendanceRow({ event_id: 'training-1', player_id: PLAYER_ACTIVE, status: 'present' })],
    }
    const { unmount } = await renderInzichten(basis)
    const zonderGast = opkomstPerMaandCells()
    unmount()

    await renderInzichten({
      ...basis,
      players: [
        ...basis.players,
        playerRow({ id: PLAYER_GUEST, type: 'guest', active: true, name: 'Gast Speler' }),
      ],
      attendance: [
        ...basis.attendance,
        attendanceRow({ event_id: 'training-1', player_id: PLAYER_GUEST, status: 'absent' }),
      ],
    })
    expect(opkomstPerMaandCells()).toEqual(zonderGast)
  })

  it('AC12: een gast met de hoogste rating in het venster verschijnt niet in top/worst spelerrating', async () => {
    await renderInzichten({
      settings,
      events: [match],
      players: [
        playerRow({ id: PLAYER_ACTIVE, active: true, name: 'Vaste Speler' }),
        playerRow({ id: PLAYER_GUEST, type: 'guest', active: true, name: 'Gast Uitblinker' }),
      ],
      matchRatings: [
        ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 5 }),
        // Hoogste rating van allemaal, maar een gast — mag nergens verschijnen,
        // en mag het teamgemiddelde/top-5 niet omhoog trekken.
        ratingRow({ event_id: 'match-1', player_id: PLAYER_GUEST, rating: 10 }),
      ],
    })
    const card = topWorstCard(nl.insights.topWorstRatingsTitle)
    expect(within(card).queryByText('Gast Uitblinker')).toBeNull()
    expect(topWorstNames(card, nl.insights.bestLabel)).toEqual(['Vaste Speler'])
  })

  it('AC12: een gast met de hoogste aanwezigheid in het venster verschijnt niet in top/worst aanwezigheid per speler', async () => {
    await renderInzichten({
      settings,
      events: [training],
      players: [
        playerRow({ id: PLAYER_ACTIVE, active: true, name: 'Vaste Speler' }),
        playerRow({ id: PLAYER_GUEST, type: 'guest', active: true, name: 'Gast Trouw' }),
      ],
      attendance: [
        attendanceRow({ event_id: 'training-1', player_id: PLAYER_ACTIVE, status: 'absent' }),
        // 100% aanwezig, maar een gast — mag nergens verschijnen.
        attendanceRow({ event_id: 'training-1', player_id: PLAYER_GUEST, status: 'present' }),
      ],
    })
    const card = topWorstCard(nl.insights.topWorstAanwezigheidTitle)
    expect(within(card).queryByText('Gast Trouw')).toBeNull()
    expect(topWorstNames(card, nl.insights.bestLabel)).toEqual(['Vaste Speler'])
  })

  it('AC12/O3: een gast staat niet als optie in de individuele-ratingselector (spelerskiezer)', async () => {
    await renderInzichten({
      settings,
      events: [match],
      players: [
        playerRow({ id: PLAYER_ACTIVE, active: true, name: 'Vaste Speler' }),
        playerRow({ id: PLAYER_GUEST, type: 'guest', active: true, name: 'Gast Speler' }),
      ],
      matchRatings: [ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 8 })],
    })
    const select = screen.getByLabelText(nl.insights.spelerSelectLabel) as HTMLSelectElement
    const optionLabels = Array.from(select.options).map((o) => o.textContent)
    expect(optionLabels).toContain('Vaste Speler')
    expect(optionLabels).not.toContain('Gast Speler')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC23 — per-speler-weergave, volledige keten: dropdown → echte server
// action (app/actions/inzichten.ts) → echte RPC-aanroep → grafiek
// ═══════════════════════════════════════════════════════════════════════
describe('AC23 — per-speler-weergave, volledige keten', () => {
  it('een actieve speler selecteren toont zijn eigen ratingreeks, los van het teamgemiddelde', async () => {
    const match1 = eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC' })
    const match2 = eventRow({ id: 'match-2', type: 'match', date: '2026-09-12', opponent: 'FC Oost' })
    await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [match1, match2],
      players: [playerRow({ id: PLAYER_ACTIVE, active: true, name: 'Piet Peters' })],
      matchRatings: [
        ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 7 }),
        ratingRow({ event_id: 'match-2', player_id: PLAYER_ACTIVE, rating: 9 }),
      ],
    })

    // De select-onChange doet een ECHTE async server-actionaanroep
    // (getSpelerRatingReeks) via de gemockte Supabase-client. `waitFor` heeft
    // echte timers nodig om te pollen; de venster-/RPC-filters van deze test
    // zijn niet afhankelijk van de vaste systeemklok van dit bestand.
    vi.useRealTimers()
    const select = screen.getByLabelText(nl.insights.spelerSelectLabel)
    fireEvent.change(select, { target: { value: PLAYER_ACTIVE } })

    await waitFor(() => {
      const tables = Array.from(document.querySelectorAll('table'))
      const spelerTable = tables.find((tb) => tb.querySelector('caption')?.textContent?.includes('Individuele rating'))
      expect(spelerTable).toBeTruthy()
    })

    const tables = Array.from(document.querySelectorAll('table'))
    const spelerTable = tables.find((tb) => tb.querySelector('caption')?.textContent?.includes('Individuele rating'))!
    const cellTexts = Array.from(spelerTable.querySelectorAll('td')).map((td) => td.textContent)
    expect(cellTexts).toContain('7')
    expect(cellTexts).toContain('9')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC26 (uitbreiding) — tenant-isolatie ook voor de niet-RPC-gedreven kaarten
// (doelpunten/vorm, die rechtstreeks via `.from('events')` lopen) en voor de
// spelersselector
// ═══════════════════════════════════════════════════════════════════════
describe('AC26 (uitbreiding) — tenant-isolatie op doelpunten en spelersselector', () => {
  it('een wedstrijd en een speler van een ander team_id komen niet terug in de doelpuntengrafiek of de ratingselector', async () => {
    await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [
        eventRow({ id: 'eigen-match', team_id: TEAM, type: 'match', date: '2026-09-05', opponent: 'DVC', goals_for: 2, goals_against: 0 }),
        eventRow({ id: 'ander-match', team_id: OTHER_TEAM, type: 'match', date: '2026-09-06', opponent: 'Indringer FC', goals_for: 9, goals_against: 0 }),
      ],
      players: [
        playerRow({ id: PLAYER_ACTIVE, team_id: TEAM, active: true, name: 'Eigen Speler' }),
        playerRow({ id: PLAYER_INACTIVE, team_id: OTHER_TEAM, active: true, name: 'Indringer Speler' }),
      ],
      // Zonder teamrating-data blijft RatingsChart in de lege staat, waarbij
      // de selector helemaal niet rendert (RatingsChart.tsx: `!isEmpty &&`)
      // — dat is AC25-gedrag, niet wat AC26 hier moet aantonen. Eén eigen
      // rating is genoeg om de selector zichtbaar te maken.
      matchRatings: [ratingRow({ event_id: 'eigen-match', player_id: PLAYER_ACTIVE, rating: 7 })],
    })
    const doelpuntenCard = screen.getByText(nl.insights.doelpuntenTitle).closest('.surface-card') as HTMLElement
    const rows = Array.from(within(doelpuntenCard).getByRole('table').querySelectorAll('tbody tr')).map((r) => r.textContent ?? '')
    expect(rows.some((r) => r.includes('Indringer FC'))).toBe(false)
    expect(rows.some((r) => r.includes('DVC'))).toBe(true)

    const select = screen.getByLabelText(nl.insights.spelerSelectLabel) as HTMLSelectElement
    const optionLabels = Array.from(select.options).map((o) => o.textContent)
    expect(optionLabels).toContain('Eigen Speler')
    expect(optionLabels).not.toContain('Indringer Speler')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC27 (uitbreiding) — een falende NIET-RPC-query (`events`, gebruikt door
// doelpunten + vorm) blokkeert de RPC-gedreven kaarten niet. De bestaande
// "één RPC geeft een fout"-tests hierboven dekken al de omgekeerde situatie
// (een RPC faalt, de `events`-query niet).
// ═══════════════════════════════════════════════════════════════════════
describe('AC27 (uitbreiding) — falende niet-RPC-query (events) blokkeert de RPC-gedreven kaarten niet', () => {
  it('een falende `events`-query laat doelpunten/vorm hun eigen lege staat tonen, zonder de RPC-gedreven kaarten te raken', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [eventRow({ id: 'training-1', type: 'training', date: '2026-09-10' })],
      attendance: [attendanceRow({ event_id: 'training-1', status: 'present' })],
      eventsError: { message: 'events tabel plat (simulated)', code: '500' },
    })

    expect(screen.getByText(nl.insights.doelpuntenEmpty)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.vormEmpty)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/events tabel plat \(simulated\)/i)

    // Aanwezigheid (RPC, niet geraakt door de eventsError) rendert gewoon door.
    expect(aanwezigheidPercentage()).toBe('100%')
    errorSpy.mockRestore()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC29 — geen minimumdrempel: 1 datapunt wordt gewoon getoond (0 = lege staat)
// ═══════════════════════════════════════════════════════════════════════
describe('AC29 — geen minimumdrempel: 1 datapunt wordt gewoon getoond', () => {
  it('1 training, 1 wedstrijd met uitslag en 1 rating leiden gewoon tot een zichtbare grafiek, geen lege staat', async () => {
    await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [
        eventRow({ id: 'training-1', type: 'training', date: '2026-09-10' }),
        eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC', goals_for: 2, goals_against: 0 }),
      ],
      players: [playerRow({ id: PLAYER_ACTIVE, active: true })],
      // player_id moet matchen met de speler hierboven (PLAYER_ACTIVE, niet
      // de standaard 'p1' van attendanceRow()) — sinds rpcAanwezigheid een
      // players-lookup doet, telt een rij van een onbekende speler niet mee.
      attendance: [attendanceRow({ event_id: 'training-1', player_id: PLAYER_ACTIVE, status: 'present' })],
      matchRatings: [ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 8 })],
    })

    expect(screen.queryByText(nl.insights.opkomstEmpty)).toBeNull()
    expect(screen.queryByText(nl.insights.doelpuntenEmpty)).toBeNull()
    expect(screen.queryByText(nl.insights.ratingsEmpty)).toBeNull()

    const tables = Array.from(document.querySelectorAll('table'))
    const opkomstTable = tables.find((tb) => tb.querySelector('caption')?.textContent?.includes('maanden'))!
    expect(opkomstTable.querySelectorAll('tbody tr')).toHaveLength(1)

    const doelpuntenTable = tables.find((tb) => tb.querySelector('caption')?.textContent?.includes('wedstrijden ('))!
    expect(doelpuntenTable.querySelectorAll('tbody tr')).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC30 — geen enkele RPC-aanroep bevat een team_id-parameter (server-side
// uit auth.uid() afgeleid, zie supabase/inzichten.sql)
// ═══════════════════════════════════════════════════════════════════════
describe('AC30 — RPC-aanroepen bevatten nooit een team_id-parameter', () => {
  it('de 3 RPC-aanroepen die bij het laden gebeuren (aanwezigheid, opkomst, teamrating) krijgen alleen p_start/p_end', async () => {
    const match = eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC' })
    const { rpcCalls } = await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [match],
      players: [playerRow({ id: PLAYER_ACTIVE, active: true })],
      matchRatings: [ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 8 })],
    })

    const names = rpcCalls.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'inzichten_aanwezigheid',
        'inzichten_training_opkomst_per_maand',
        'inzichten_rating_team_per_wedstrijd',
      ]),
    )
    for (const call of rpcCalls) {
      const args = call.args as Record<string, unknown>
      expect(Object.keys(args)).not.toContain('team_id')
      expect(Object.keys(args)).not.toContain('p_team')
      expect(Object.keys(args)).not.toContain('teamId')
    }
  })

  it('de 4e RPC (inzichten_rating_speler, via de selector) krijgt p_player/p_start/p_end, ook geen team_id', async () => {
    const match = eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC' })
    const { rpcCalls } = await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [match],
      players: [playerRow({ id: PLAYER_ACTIVE, active: true, name: 'Piet Peters' })],
      matchRatings: [ratingRow({ event_id: 'match-1', player_id: PLAYER_ACTIVE, rating: 8 })],
    })

    vi.useRealTimers()
    const select = screen.getByLabelText(nl.insights.spelerSelectLabel)
    fireEvent.change(select, { target: { value: PLAYER_ACTIVE } })

    await waitFor(() => {
      expect(rpcCalls.some((c) => c.name === 'inzichten_rating_speler')).toBe(true)
    })

    const call = rpcCalls.find((c) => c.name === 'inzichten_rating_speler')!
    const args = call.args as Record<string, unknown>
    expect(args).toMatchObject({ p_player: PLAYER_ACTIVE })
    expect(Object.keys(args)).not.toContain('team_id')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// FC1 (aanvulling) — de team-brede Aanwezigheid-kaart combineert
// verleden- én toekomstige events binnen HETZELFDE seizoensvenster: het
// percentage moet uitsluitend uit de verleden-events komen. De bestaande
// describe('toekomstige events tellen niet mee in de aanwezigheidscijfers')
// hierboven (van de bouwers) bewijst dit al met gescheiden events per test;
// dit blok voegt de door de story met name genoemde situatie toe waarin
// verleden- én toekomst-registraties in ÉÉN venster samen voorkomen.
// ═══════════════════════════════════════════════════════════════════════
describe('FC1 — team-Aanwezigheid combineert verleden én toekomst binnen één venster', () => {
  it('een training van gisteren (absent) en een training van morgen (present, nog niet gespeeld) samen: alleen gisteren telt mee', async () => {
    const { rpcCalls } = await renderInzichten({
      settings: seasonSettings('2026-07-01', '2027-06-30'),
      events: [
        eventRow({ id: 'verleden', type: 'training', date: '2026-10-14' }),
        eventRow({ id: 'toekomst', type: 'training', date: '2026-10-20' }),
      ],
      attendance: [
        // Verleden: 1x afwezig → zou zonder clamp al 0% opleveren als de
        // toekomst-registratie hieronder meetelt (1 present/1 absent = 50%).
        attendanceRow({ event_id: 'verleden', status: 'absent' }),
        // Toekomst: nog niet gespeeld, maar er staat toch al een registratie
        // (bv. een testfixture-fout of een te vroeg weggeschreven rij) — deze
        // mag het percentage niet beïnvloeden.
        attendanceRow({ event_id: 'toekomst', status: 'present' }),
      ],
    })

    // Zonder de FC1-cutoff: 1 present + 1 absent = 50%. Mét de cutoff (alleen
    // "verleden" telt): 0 present + 1 absent = 0%.
    expect(aanwezigheidPercentage()).toBe('0%')

    const call = rpcCalls.find((c) => c.name === 'inzichten_aanwezigheid')!
    expect(call.args).toEqual({ p_start: '2026-07-01', p_end: '2026-10-14' })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// FC3 — Top 5 / worst 5 spelerratings (TopWorstRatings, gevoed door
// inzichten_rating_per_speler → topWorstRating() in lib/inzichten.ts)
// ═══════════════════════════════════════════════════════════════════════
describe('FC3 — Top 5 / worst 5 spelerratings', () => {
  const settings = seasonSettings('2026-07-01', '2026-12-31')
  const match = eventRow({ id: 'match-1', type: 'match', date: '2026-09-05', opponent: 'DVC' })

  const P_PIET = 'cccccccc-0000-0000-0000-000000000001'
  const P_JAN = 'cccccccc-0000-0000-0000-000000000002'
  const P_KLAAS = 'cccccccc-0000-0000-0000-000000000003'

  it('top = hoogste gemiddelde eerst, worst = laagste eerst, gelijke waarden op naam gesorteerd, inactieve spelers nooit — en bij <10 spelers overlappen top/worst bewust', async () => {
    const { rpcCalls } = await renderInzichten({
      settings,
      events: [match],
      players: [
        playerRow({ id: P_PIET, name: 'Piet Peters', active: true }),
        playerRow({ id: P_JAN, name: 'Jan Jansen', active: true }),
        playerRow({ id: P_KLAAS, name: 'Klaas Klaassen', active: true }),
        playerRow({ id: PLAYER_INACTIVE, name: 'Inactieve Uitblinker', active: false }),
      ],
      matchRatings: [
        ratingRow({ event_id: 'match-1', player_id: P_PIET, rating: 9 }),
        ratingRow({ event_id: 'match-1', player_id: P_JAN, rating: 5 }),
        ratingRow({ event_id: 'match-1', player_id: P_KLAAS, rating: 5 }),
        // Hoogste rating van allemaal, maar inactief — mag nergens verschijnen.
        ratingRow({ event_id: 'match-1', player_id: PLAYER_INACTIVE, rating: 10 }),
      ],
    })

    const card = topWorstCard(nl.insights.topWorstRatingsTitle)

    // Top: aflopend op gemiddelde; Jan/Klaas zijn gelijk (5) en staan op naam
    // gesorteerd (Jan < Klaas).
    expect(topWorstNames(card, nl.insights.bestLabel)).toEqual(['Piet Peters', 'Jan Jansen', 'Klaas Klaassen'])
    // Worst: oplopend op gemiddelde, zelfde tie-break.
    expect(topWorstNames(card, nl.insights.worstLabel)).toEqual(['Jan Jansen', 'Klaas Klaassen', 'Piet Peters'])

    // Inactieve speler komt nergens voor, ondanks de hoogste rating.
    expect(within(card).queryByText('Inactieve Uitblinker')).toBeNull()

    // 3 spelers < 2×TOP_WORST_AANTAL(5): bewuste overlap, met toelichting.
    expect(within(card).getByText(nl.insights.topWorstOverlapHint)).toBeInTheDocument()

    // De RPC voor dit onderwerp krijgt het volle (niet-geclampte) seizoensvenster.
    const call = rpcCalls.find((c) => c.name === 'inzichten_rating_per_speler')!
    expect(call.args).toEqual({ p_start: '2026-07-01', p_end: '2026-12-31' })
  })

  it('0 spelers met ratings binnen het venster → lege staat op de kaart, geen verzonnen cijfers', async () => {
    await renderInzichten({
      settings,
      events: [match],
      players: [playerRow({ id: P_PIET, name: 'Piet Peters', active: true })],
      // Geen matchRatings → RPC levert 0 rijen.
    })

    const card = topWorstCard(nl.insights.topWorstRatingsTitle)
    expect(within(card).getByText(nl.insights.topWorstRatingsEmpty)).toBeInTheDocument()
    expect(within(card).queryByText(nl.insights.bestLabel)).toBeNull()
    expect(within(card).queryByText(nl.insights.worstLabel)).toBeNull()
    expect(within(card).queryByText('Piet Peters')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// FC4 — Top 5 / worst 5 aanwezigheid per speler (TopWorstAanwezigheid,
// gevoed door inzichten_aanwezigheid_per_speler → topWorstAanwezigheid())
// ═══════════════════════════════════════════════════════════════════════
describe('FC4 — Top 5 / worst 5 aanwezigheid per speler', () => {
  const P_A = 'dddddddd-0000-0000-0000-000000000001'

  it('gebruikt hetzelfde geclampte (verleden-only) venster als de team-Aanwezigheid-kaart: een nog niet gespeelde training telt niet mee in het percentage', async () => {
    const { rpcCalls } = await renderInzichten({
      settings: seasonSettings('2026-07-01', '2027-06-30'), // seizoen loopt door ná TODAY (2026-10-15)
      events: [
        eventRow({ id: 'gisteren', type: 'training', date: '2026-10-14' }),
        eventRow({ id: 'morgen', type: 'training', date: '2026-10-16' }),
      ],
      players: [playerRow({ id: P_A, name: 'Actieve Speler', active: true })],
      attendance: [
        attendanceRow({ event_id: 'gisteren', player_id: P_A, status: 'present' }),
        // Nog niet gespeeld — zou zonder de clamp 50% i.p.v. 100% opleveren.
        attendanceRow({ event_id: 'morgen', player_id: P_A, status: 'absent' }),
      ],
    })

    const card = topWorstCard(nl.insights.topWorstAanwezigheidTitle)
    expect(topWorstValueFor(card, nl.insights.bestLabel, 'Actieve Speler')).toBe(
      nl.insights.topWorstAanwezigheidWaarde.replace('{percentage}', '100').replace('{aanwezig}', '1').replace('{totaal}', '1'),
    )

    const teamCall = rpcCalls.find((c) => c.name === 'inzichten_aanwezigheid')!
    const perSpelerCall = rpcCalls.find((c) => c.name === 'inzichten_aanwezigheid_per_speler')!
    expect(perSpelerCall.args).toEqual(teamCall.args)
    expect(perSpelerCall.args).toEqual({ p_start: '2026-07-01', p_end: '2026-10-14' })
  })

  it('alleen actieve spelers, 0-registraties (null%) uitgesloten, 0%-spelers (wél registraties) tellen wél mee, en kleine selecties overlappen', async () => {
    const P_GOOD = 'dddddddd-0000-0000-0000-000000000002'
    const P_ZERO = 'dddddddd-0000-0000-0000-000000000003'
    const P_UNKNOWN = 'dddddddd-0000-0000-0000-000000000004'
    const P_INACTIVE_100 = 'dddddddd-0000-0000-0000-000000000005'

    await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [
        eventRow({ id: 't1', type: 'training', date: '2026-09-10' }),
        eventRow({ id: 't2', type: 'training', date: '2026-09-11' }),
      ],
      players: [
        playerRow({ id: P_GOOD, name: 'Goede Speler', active: true }),
        playerRow({ id: P_ZERO, name: 'Afwezige Speler', active: true }),
        playerRow({ id: P_UNKNOWN, name: 'Onbekende Speler', active: true }),
        playerRow({ id: P_INACTIVE_100, name: 'Inactieve Volledige Speler', active: false }),
      ],
      attendance: [
        attendanceRow({ event_id: 't1', player_id: P_GOOD, status: 'present' }),
        attendanceRow({ event_id: 't1', player_id: P_ZERO, status: 'absent' }),
        attendanceRow({ event_id: 't2', player_id: P_ZERO, status: 'absent' }),
        // Uitsluitend 'unknown' → RPC levert 0/0 → percentage null → uitgesloten.
        attendanceRow({ event_id: 't1', player_id: P_UNKNOWN, status: 'unknown' }),
        // Inactief, ondanks 100% aanwezigheid: mag niet verschijnen.
        attendanceRow({ event_id: 't1', player_id: P_INACTIVE_100, status: 'present' }),
      ],
    })

    const card = topWorstCard(nl.insights.topWorstAanwezigheidTitle)

    // P_ZERO heeft wél registraties (2x afwezig) en hoort als 0% mee te tellen.
    expect(topWorstValueFor(card, nl.insights.worstLabel, 'Afwezige Speler')).toBe(
      nl.insights.topWorstAanwezigheidWaarde.replace('{percentage}', '0').replace('{aanwezig}', '0').replace('{totaal}', '2'),
    )
    expect(topWorstValueFor(card, nl.insights.bestLabel, 'Goede Speler')).toBe(
      nl.insights.topWorstAanwezigheidWaarde.replace('{percentage}', '100').replace('{aanwezig}', '1').replace('{totaal}', '1'),
    )

    // P_UNKNOWN (0/0, geen percentage) staat nergens.
    expect(within(card).queryByText('Onbekende Speler')).toBeNull()
    // Inactieve speler staat nergens, ondanks 100%.
    expect(within(card).queryByText('Inactieve Volledige Speler')).toBeNull()

    // 2 spelers met percentage < 2×TOP_WORST_AANTAL(5): bewuste overlap.
    expect(within(card).getByText(nl.insights.topWorstOverlapHint)).toBeInTheDocument()
    expect(topWorstNames(card, nl.insights.bestLabel).sort()).toEqual(['Afwezige Speler', 'Goede Speler'])
    expect(topWorstNames(card, nl.insights.worstLabel).sort()).toEqual(['Afwezige Speler', 'Goede Speler'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// FC5 — tenant-isolatie op de 2 nieuwe per-speler-RPC's: nooit data van een
// ander team, en nooit een team_id-achtige parameter vanuit de aanroeper.
// ═══════════════════════════════════════════════════════════════════════
describe('FC5 — tenant-isolatie op de 2 nieuwe per-speler-RPC\'s', () => {
  it('spelers/ratings/aanwezigheid van een ander team_id komen niet terug in de top/worst-kaarten, en de RPC-args bevatten geen team_id', async () => {
    const OTHER_PLAYER = 'eeeeeeee-0000-0000-0000-000000000001'
    const { rpcCalls } = await renderInzichten({
      settings: seasonSettings('2026-07-01', '2026-12-31'),
      events: [
        eventRow({ id: 'eigen-match', team_id: TEAM, type: 'match', date: '2026-09-05', opponent: 'DVC' }),
        eventRow({ id: 'ander-match', team_id: OTHER_TEAM, type: 'match', date: '2026-09-06', opponent: 'Indringer FC' }),
        eventRow({ id: 'eigen-training', team_id: TEAM, type: 'training', date: '2026-09-01' }),
        eventRow({ id: 'ander-training', team_id: OTHER_TEAM, type: 'training', date: '2026-09-01' }),
      ],
      players: [
        playerRow({ id: PLAYER_ACTIVE, team_id: TEAM, name: 'Eigen Ster', active: true }),
        // Ander team, maar wél active=true, met een HOGERE rating/aanwezigheid
        // dan het eigen team — als tenant-isolatie faalt, zou deze speler de
        // eigen top-lijst kunnen "kapen".
        playerRow({ id: OTHER_PLAYER, team_id: OTHER_TEAM, name: 'Vreemde Ster', active: true }),
      ],
      matchRatings: [
        ratingRow({ team_id: TEAM, event_id: 'eigen-match', player_id: PLAYER_ACTIVE, rating: 6 }),
        ratingRow({ team_id: OTHER_TEAM, event_id: 'ander-match', player_id: OTHER_PLAYER, rating: 10 }),
      ],
      attendance: [
        attendanceRow({ team_id: TEAM, event_id: 'eigen-training', player_id: PLAYER_ACTIVE, status: 'present' }),
        attendanceRow({ team_id: OTHER_TEAM, event_id: 'ander-training', player_id: OTHER_PLAYER, status: 'present' }),
      ],
    })

    // "Eigen Ster" staat met maar 1 speler in zowel de top- als de
    // worst-lijst (bewuste overlap bij een kleine selectie), vandaar
    // getAllByText i.p.v. getByText.
    const ratingCard = topWorstCard(nl.insights.topWorstRatingsTitle)
    expect(within(ratingCard).getAllByText('Eigen Ster').length).toBeGreaterThan(0)
    expect(within(ratingCard).queryByText('Vreemde Ster')).toBeNull()

    const aanwCard = topWorstCard(nl.insights.topWorstAanwezigheidTitle)
    expect(within(aanwCard).getAllByText('Eigen Ster').length).toBeGreaterThan(0)
    expect(within(aanwCard).queryByText('Vreemde Ster')).toBeNull()

    const ratingCall = rpcCalls.find((c) => c.name === 'inzichten_rating_per_speler')!
    const aanwCall = rpcCalls.find((c) => c.name === 'inzichten_aanwezigheid_per_speler')!
    for (const call of [ratingCall, aanwCall]) {
      const keys = Object.keys(call.args as Record<string, unknown>)
      expect(keys).not.toContain('team_id')
      expect(keys).not.toContain('p_team')
      expect(keys).not.toContain('teamId')
      expect(keys.sort()).toEqual(['p_end', 'p_start'])
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Trainingsinhoud — in hoeveel TRAININGEN kwam elke categorie voor.
//
// Hergebruikt countCategoryOccurrences() uit de periodisering, zodat de
// inzichtenpagina en de periodiseringspagina nooit een ander cijfer tonen.
// ═══════════════════════════════════════════════════════════════════════
describe('trainingsinhoud', () => {
  const settings = seasonSettings('2026-07-01', '2026-12-31')
  const trainingen = [
    eventRow({ id: 't1', type: 'training', date: '2026-09-01' }),
    eventRow({ id: 't2', type: 'training', date: '2026-09-08' }),
  ]

  function inhoudCard(): HTMLElement {
    return screen.getByText(nl.insights.inhoudTitle).closest('.surface-card') as HTMLElement
  }

  // De sr-only tabel van de kaart draagt de exacte cijfers (ChartDataTable).
  function aantalVoor(card: HTMLElement, label: string): string | null {
    const rij = Array.from(card.querySelectorAll('tbody tr')).find(
      (tr) => tr.querySelector('td')?.textContent === label,
    )
    return rij?.querySelectorAll('td')[1]?.textContent ?? null
  }

  it('zonder gekoppelde oefeningen toont de kaart zijn lege staat', async () => {
    // Eén wedstrijd met uitslag erbij, anders valt de héle pagina terug op de
    // onboarding-lege-staat en is er geen kaart om op te toetsen.
    await renderInzichten({
      settings,
      events: [
        ...trainingen,
        eventRow({ id: 'm1', type: 'match', date: '2026-09-05', opponent: 'DVC', match_type: 'league', goals_for: 2, goals_against: 0 }),
      ],
    })
    expect(within(inhoudCard()).getByText(nl.insights.inhoudEmpty)).toBeInTheDocument()
  })

  it('telt per TRAINING, niet per oefening: twee vormen in dezelfde training tellen als één', async () => {
    await renderInzichten({
      settings,
      events: trainingen,
      trainingOefeningen: [
        { team_id: TEAM, event_id: 't1', oefeningen: { categorie: 'positiespel' } },
        { team_id: TEAM, event_id: 't1', oefeningen: { categorie: 'positiespel' } },
        { team_id: TEAM, event_id: 't2', oefeningen: { categorie: 'positiespel' } },
      ],
    })
    // Twee trainingen met positiespel, niet drie oefeningen.
    expect(aantalVoor(inhoudCard(), nl.periodization.categories.positiespel)).toBe('2')
  })

  it('categorieën die je nooit deed blijven staan met 0 — dat is juist het inzicht', async () => {
    await renderInzichten({
      settings,
      events: trainingen,
      trainingOefeningen: [{ team_id: TEAM, event_id: 't1', oefeningen: { categorie: 'positiespel' } }],
    })
    const card = inhoudCard()
    expect(aantalVoor(card, nl.periodization.categories.partijen_groot)).toBe('0')
    expect(aantalVoor(card, nl.periodization.categories.warming_up)).toBe('0')
  })

  it('een training van een ander team telt niet mee', async () => {
    await renderInzichten({
      settings,
      events: trainingen,
      trainingOefeningen: [
        { team_id: TEAM, event_id: 't1', oefeningen: { categorie: 'positiespel' } },
        { team_id: 'ander-team', event_id: 't2', oefeningen: { categorie: 'positiespel' } },
      ],
    })
    expect(aantalVoor(inhoudCard(), nl.periodization.categories.positiespel)).toBe('1')
  })
})
