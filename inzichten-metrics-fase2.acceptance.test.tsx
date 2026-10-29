// Acceptatietests — fase 2a "inzichten-metrics" (spelers, idee 1-5): vijf nieuwe
// kaarten op /inzichten (Speelkansen, Stijgers en dalers, Positiedekking,
// Opkomst/selectie/rating, Blessures per maand).
//
// Methode (van buitenaf, geen unit-tests):
//   * Rendert de ECHTE app/inzichten/page.tsx (async server component) met RTL
//     met alle echte kaartcomponenten en echte pure functies uit lib/inzichten.ts.
//     Alleen @/lib/supabase/server, next/navigation en next/headers zijn gestubd.
//   * De RPC's worden beantwoord door handlers die de SQL uit
//     supabase/inzichten-metrics-fase2.sql (incl. besluit O2) nabootsen op
//     in-memory rijen en daarbij het p_team_id-ARGUMENT van de pagina gebruiken.
//     De players-select van positiedekking loopt door de echte filter-keten van
//     de mock-client (.eq/.order), dus een verdwenen .eq('active', true) is te zien.
//
// Verwachte waarden zijn met de hand uit story + besluiten W1-W7/O1-O7 afgeleid
// (zie de scenario-commentaren), NIET uit de productiecode overgenomen.
//
// BEPERKING (eerlijk): vitest kan RLS en de SQL zelf niet bewijzen. De handlers
// bootsen de SQL alleen na. Wat de DB-laag afdwingt staat in
// supabase/team-rls-verificatie.sql blok 27 (al op de echte database gedraaid,
// zie fase2/05-migratie-en-verificatie.md) en in de tekst-structuurtest
// inzichten-metrics-fase2-migratie.acceptance.test.ts.
//
// AC 6.x (speelminuten) is fase 2b en wordt hier bewust NIET getest.
//
// ── AC -> test-mapping: elke testnaam begint met zijn criterium (bv. "AC-3.2") ──

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, configure, cleanup } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { es } from '@/messages/es'
import { fr } from '@/messages/fr'
import type { Dict } from '@/messages/nl'

const state = vi.hoisted(() => ({ locale: 'nl' }))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`__redirect__:${to}`)
  },
  notFound: () => {
    throw new Error('__notFound__')
  },
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (k === 'locale' ? { value: state.locale } : undefined),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import InzichtenPage from '@/app/inzichten/page'
import { maandLabel } from '@/lib/inzichten'

// ═══════════════════════════════════════════════════════════════════════
// In-memory database + Supabase-client
// ═══════════════════════════════════════════════════════════════════════
type Row = Record<string, unknown>
type Db = Record<string, Row[]>

interface Harness {
  db: Db
  rpcCalls: { name: string; args: Row }[]
  rpcErrors: Record<string, unknown>
  selectErrors: Record<string, unknown>
  handlers: Record<string, (db: Db, args: Row) => Row[]>
  userId: string
}

function makeClient(h: Harness) {
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
    let limitN: number | null = null

    async function execute(): Promise<{ data: Row[] | null; error: unknown }> {
      const rows = h.db[table]
      if (!rows) throw new Error(`Onverwachte tabel in test: "${table}"`)
      if (h.selectErrors[table]) return { data: null, error: h.selectErrors[table] }
      let out = rows.filter((r) => filters.every((f) => f(r)))
      if (orders.length > 0) {
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const av = a[o.col] as string | number | null | undefined
            const bv = b[o.col] as string | number | null | undefined
            const an = av === null || av === undefined
            const bn = bv === null || bv === undefined
            if (an && bn) continue
            if (an) return o.nullsFirst ? -1 : 1
            if (bn) return o.nullsFirst ? 1 : -1
            if (av! < bv!) return o.ascending ? -1 : 1
            if (av! > bv!) return o.ascending ? 1 : -1
          }
          return 0
        })
      }
      if (limitN !== null) out = out.slice(0, limitN)
      return { data: out.map((r) => ({ ...r })), error: null }
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), chain),
      gt: (c: string, v: unknown) => (filters.push((r) => (r[c] as string) > (v as string)), chain),
      gte: (c: string, v: unknown) => (filters.push((r) => (r[c] as string) >= (v as string)), chain),
      lt: (c: string, v: unknown) => (filters.push((r) => (r[c] as string) < (v as string)), chain),
      lte: (c: string, v: unknown) => (filters.push((r) => (r[c] as string) <= (v as string)), chain),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), chain),
      not: (c: string, o: string, v: unknown) => {
        if (o !== 'is') throw new Error(`.not(): onverwachte operator "${o}"`)
        filters.push((r) => r[c] !== v && !(v === null && r[c] === undefined))
        return chain
      },
      order: (c: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
        orders.push({ col: c, ascending: o.ascending ?? true, nullsFirst: o.nullsFirst ?? false })
        return chain
      },
      limit: (n: number) => ((limitN = n), chain),
      single: async () => {
        const r = await execute()
        return { data: r.data?.[0] ?? null, error: r.error }
      },
      maybeSingle: async () => {
        const r = await execute()
        return { data: r.data?.[0] ?? null, error: r.error }
      },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => execute().then(res, rej),
    }
    return chain
  }

  return {
    auth: { getUser: async () => ({ data: { user: { id: h.userId } } }) },
    from,
    rpc: (name: string, args: Row) => {
      h.rpcCalls.push({ name, args })
      if (h.rpcErrors[name]) return Promise.resolve({ data: null, error: h.rpcErrors[name] })
      const handler = h.handlers[name]
      if (!handler) throw new Error(`Onbekende RPC in test: "${name}"`)
      return Promise.resolve({ data: handler(h.db, args), error: null })
    },
  }
}

function setup(db: Db, over: Partial<Harness> = {}): Harness {
  const h: Harness = { db, rpcCalls: [], rpcErrors: {}, selectErrors: {}, handlers: {}, userId: 'team-1', ...over }
  vi.mocked(createClient).mockResolvedValue(makeClient(h) as unknown as Awaited<ReturnType<typeof createClient>>)
  return h
}

const TEAM = 'team-1'
const OTHER = 'team-2'
const owner = (team = TEAM) => ({ team_id: team, user_id: team, rol: 'owner' })

function fmt(tpl: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), tpl)
}
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

let consoleError: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  state.locale = 'nl'
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  consoleError.mockRestore()
  configure({ defaultIgnore: 'script, style' })
  vi.useRealTimers()
})

// ═══════════════════════════════════════════════════════════════════════
// Nagebootste RPC's (supabase/inzichten-metrics-fase2.sql)
// Elke handler gebruikt p_team_id uit de ARGUMENTEN en filtert op team_id van
// elke gejoinde tabel. Markeringen `// M..` zijn de mutatieplekken.
// ═══════════════════════════════════════════════════════════════════════
const inRange = (d: string, s: string, e: string) => d >= s && d <= e
const byNaamId = (a: Row, b: Row) =>
  String(a.naam).localeCompare(String(b.naam)) || String(a.player_id).localeCompare(String(b.player_id))

function spelersVan(db: Db, team: string) {
  return new Map(db.players.filter((p) => p.team_id === team).map((p) => [p.id as string, p]))
}

// RPC 1 — inzichten_speelkansen (W2, W3, O2, O6)
function hSpeelkansen(db: Db, args: Row): Row[] {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const spelers = spelersVan(db, p_team_id)
  const jsonbSpelers = spelers // M4a: players-join van de lineups.positions-JSONB (p.team_id = p_team_id)
  const wedstrijden = db.events.filter((e) => e.team_id === p_team_id && e.type === 'match' && (e.date as string) <= p_end)
  const wedById = new Map(wedstrijden.map((e) => [e.id as string, e]))
  const selectie = new Set<string>()
  for (const ms of db.match_squad) {
    if (ms.team_id !== p_team_id) continue // M4b: match_squad.team_id
    if (!spelers.has(ms.player_id as string)) continue
    selectie.add(`${ms.event_id}|${ms.player_id}`)
  }
  const basis = new Set<string>()
  for (const l of db.lineups) {
    if (l.team_id !== p_team_id || !Array.isArray(l.positions)) continue
    for (const pos of l.positions as Row[]) {
      const id = pos?.player_id
      if (typeof id === 'string' && jsonbSpelers.has(id)) basis.add(`${l.event_id}|${id}`)
    }
  }
  const aanwezig = new Set<string>()
  for (const a of db.attendance) {
    if (a.team_id !== p_team_id) continue // M4c: attendance.team_id
    if (a.status === 'unknown') continue // M6b: unknown-rijen tellen niet mee
    if (!spelers.has(a.player_id as string)) continue
    aanwezig.add(`${a.event_id}|${a.player_id}`)
  }
  const voorkomen = new Map<string, { eerste: string; laatste: string }>()
  for (const sleutel of [...selectie, ...basis, ...aanwezig]) {
    const [eventId, playerId] = sleutel.split('|')
    const w = wedById.get(eventId)
    if (!w) continue
    const d = w.date as string
    const cur = voorkomen.get(playerId)
    if (!cur) voorkomen.set(playerId, { eerste: d, laatste: d })
    else {
      if (d < cur.eerste) cur.eerste = d
      if (d > cur.laatste) cur.laatste = d
    }
  }
  const metSelectie = new Set([...selectie].map((k) => k.split('|')[0]))
  const noemerWed = wedstrijden.filter(
    (w) => (w.date as string) >= p_start && metSelectie.has(w.id as string), // M5: alleen wedstrijden MET selectie
  )
  return [...voorkomen.entries()]
    .map(([playerId, f]) => {
      const p = spelers.get(playerId)!
      const teller = noemerWed.filter(
        (nw) =>
          (nw.date as string) >= f.eerste && // M6a: vanaf het eerste voorkomen
          (p.active !== false || (nw.date as string) <= f.laatste), // O2: inactief -> t/m laatste voorkomen
      )
      return {
        player_id: playerId,
        naam: p.name,
        gast: p.type === 'guest',
        noemer: teller.length,
        selectie: teller.filter((nw) => selectie.has(`${nw.id}|${playerId}`)).length,
        basis: teller.filter((nw) => basis.has(`${nw.id}|${playerId}`)).length, // M7: basis alleen binnen noemer
      }
    })
    .sort(byNaamId)
}

// RPC 2 — inzichten_rating_vorm_per_speler (W5; W3: alleen actieve vaste spelers)
function hRatingVorm(db: Db, args: Row): Row[] {
  const { p_team_id, p_start, p_end, p_recent } = args as {
    p_team_id: string; p_start: string; p_end: string; p_recent: number
  }
  const events = new Map(db.events.map((e) => [e.id as string, e]))
  const spelers = spelersVan(db, p_team_id)
  const per = new Map<string, { datum: string; eventId: string; rating: number }[]>()
  for (const r of db.match_ratings) {
    if (r.team_id !== p_team_id) continue
    const e = events.get(r.event_id as string)
    if (!e || e.team_id !== p_team_id || e.type !== 'match' || !inRange(e.date as string, p_start, p_end)) continue
    const p = spelers.get(r.player_id as string)
    if (!p) continue
    if (p.active !== true || p.type !== 'regular') continue // M9c: alleen actieve vaste spelers
    const l = per.get(p.id as string) ?? []
    l.push({ datum: e.date as string, eventId: e.id as string, rating: r.rating as number })
    per.set(p.id as string, l)
  }
  const gem = (xs: { rating: number }[]) => xs.reduce((a, b) => a + b.rating, 0) / xs.length
  return [...per.entries()]
    .map(([playerId, l]) => {
      const nieuwsteEerst = [...l].sort((a, b) => b.datum.localeCompare(a.datum) || b.eventId.localeCompare(a.eventId))
      return {
        player_id: playerId,
        naam: spelers.get(playerId)!.name,
        aantal: l.length,
        seizoen_gemiddelde: gem(l),
        recent_gemiddelde: gem(nieuwsteEerst.slice(0, Math.max(p_recent, 1))),
      }
    })
    .sort(byNaamId)
}

// RPC 3 — inzichten_training_opkomst_per_speler (W7: alleen trainingen; W3: gasten + inactieven)
function hTrainingOpkomst(db: Db, args: Row): Row[] {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const events = new Map(db.events.map((e) => [e.id as string, e]))
  const spelers = spelersVan(db, p_team_id)
  const per = new Map<string, { aanwezig: number; afwezig: number }>()
  for (const a of db.attendance) {
    if (a.team_id !== p_team_id) continue // M4d: attendance.team_id
    const e = events.get(a.event_id as string)
    if (!e || e.team_id !== p_team_id || e.type !== 'training' || !inRange(e.date as string, p_start, p_end)) continue
    const p = spelers.get(a.player_id as string)
    if (!p) continue
    const cur = per.get(p.id as string) ?? { aanwezig: 0, afwezig: 0 }
    if (a.status === 'present') cur.aanwezig++
    else if (a.status === 'absent' || a.status === 'injured') cur.afwezig++
    per.set(p.id as string, cur)
  }
  return [...per.entries()]
    .map(([playerId, v]) => {
      const p = spelers.get(playerId)!
      return { player_id: playerId, naam: p.name, gast: p.type === 'guest', ...v }
    })
    .sort(byNaamId)
}

// RPC 4 — inzichten_blessures_per_maand (W7, O4): left join; filters in de ON
function hBlessures(db: Db, args: Row): Row[] {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const spelers = spelersVan(db, p_team_id)
  const per = new Map<string, Set<string>>()
  for (const e of db.events) {
    if (e.team_id !== p_team_id || e.type === 'meting' || !inRange(e.date as string, p_start, p_end)) continue
    const maand = (e.date as string).slice(0, 7)
    const set = per.get(maand) ?? new Set<string>()
    per.set(maand, set)
    for (const a of db.attendance) {
      if (a.event_id !== e.id) continue
      if (a.team_id !== p_team_id) continue // M4e: attendance.team_id
      if (a.status !== 'injured') continue // M11a: alleen injured (absent telt niet)
      const p = spelers.get(a.player_id as string)
      if (p && p.type === 'regular') set.add(p.id as string)
    }
  }
  return [...per.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([maand, set]) => ({ maand, geblesseerd: set.size }))
}

// Bestaande RPC (fase 1) die kaart 4 voedt: rating per speler, venster-gebonden.
function hRatingPerSpeler(db: Db, args: Row): Row[] {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const events = new Map(db.events.map((e) => [e.id as string, e]))
  const spelers = spelersVan(db, p_team_id)
  const per = new Map<string, number[]>()
  for (const r of db.match_ratings) {
    if (r.team_id !== p_team_id) continue
    const e = events.get(r.event_id as string)
    if (!e || e.team_id !== p_team_id || e.type !== 'match' || !inRange(e.date as string, p_start, p_end)) continue
    const p = spelers.get(r.player_id as string)
    if (!p || p.active !== true || p.type !== 'regular') continue
    per.set(p.id as string, [...(per.get(p.id as string) ?? []), r.rating as number])
  }
  return [...per.entries()]
    .map(([id, l]) => ({
      player_id: id, naam: spelers.get(id)!.name, gemiddelde: l.reduce((a, b) => a + b, 0) / l.length, aantal: l.length,
    }))
    .sort(byNaamId)
}

// Alle overige (fase-1) bronnen zijn hier leeg: deze suite test alleen fase 2a.
const HANDLERS: Harness['handlers'] = {
  inzichten_aanwezigheid: () => [{ aanwezig: 0, afwezig: 0 }],
  inzichten_training_opkomst_per_maand: () => [],
  inzichten_rating_team_per_wedstrijd: () => [],
  inzichten_rating_speler: () => [],
  inzichten_rating_per_speler: hRatingPerSpeler,
  inzichten_aanwezigheid_per_speler: () => [],
  inzichten_wedstrijd_uitslagen: () => [],
  inzichten_speler_momenten: () => [],
  inzichten_doelpunten_per_minuut: () => [],
  inzichten_tegendoelpunten: () => [],
  inzichten_speelkansen: hSpeelkansen,
  inzichten_rating_vorm_per_speler: hRatingVorm,
  inzichten_training_opkomst_per_speler: hTrainingOpkomst,
  inzichten_blessures_per_maand: hBlessures,
  // Fase 2b: dit fase-2a-harnas test die kaart niet; een lege bron volstaat.
  inzichten_speelminuten_per_speler: () => [],
  // Fase 3a: dit bestand test de nieuwe kaarten niet; lege bronnen.
  inzichten_training_koppelingen: () => [],
  inzichten_invul_discipline: () => [],
  inzichten_training_evaluaties: () => [],
}
const NIEUWE_RPCS = [
  'inzichten_speelkansen',
  'inzichten_rating_vorm_per_speler',
  'inzichten_training_opkomst_per_speler',
  'inzichten_blessures_per_maand',
]

// ═══════════════════════════════════════════════════════════════════════
// Bouwstenen
// ═══════════════════════════════════════════════════════════════════════
const TODAY = '2026-10-15' // verleden = t/m 2026-10-14
const STANDAARD_IGNORE = 'script, style'
const NEGEER_PRINTBLOK = `${STANDAARD_IGNORE}, [data-print-only], [data-print-only] *`

let n = 0
const ev = (id: string, date: string, o: Row = {}): Row => ({
  id, team_id: TEAM, type: 'match', date, opponent: 'Tegenstander', match_type: 'league', home_away: 'home',
  goals_for: null, goals_against: null, created_at: '2026-01-01T10:00:00Z', trainingstype: 'vct', ...o,
})
const trn = (id: string, date: string, o: Row = {}): Row =>
  ev(id, date, { type: 'training', opponent: null, match_type: null, home_away: null, ...o })
const sp = (id: string, name: string, o: Row = {}): Row => ({
  id, team_id: TEAM, name, active: true, type: 'regular', position: 'Spits', secondary_positions: [], injured: false, ...o,
})
const sq = (event: string, player: string, team = TEAM): Row => ({ id: `sq-${++n}`, team_id: team, event_id: event, player_id: player })
const att = (event: string, player: string, status: string, team = TEAM): Row => ({
  id: `at-${++n}`, team_id: team, event_id: event, player_id: player, status,
})
const lu = (event: string, ids: (string | null)[], team = TEAM): Row => ({
  id: `lu-${++n}`, team_id: team, event_id: event, formation: '4-3-3',
  positions: ids.map((id, i) => ({ position_label: `pos${i}`, player_id: id })),
})
const rat = (event: string, player: string, rating: number, team = TEAM): Row => ({
  id: `ra-${++n}`, team_id: team, event_id: event, player_id: player, rating,
})

function leegDb(over: Partial<Db> = {}): Db {
  return {
    team_members: [owner(), owner(OTHER)],
    settings: [
      { team_id: TEAM, key: 'season_start', value: '2026-08-01' },
      { team_id: TEAM, key: 'season_end', value: '2027-06-30' },
      { team_id: OTHER, key: 'season_start', value: '2026-08-01' },
      { team_id: OTHER, key: 'season_end', value: '2027-06-30' },
    ],
    events: [], players: [], match_events: [], lineups: [], tegendoelpunten: [], match_squad: [],
    attendance: [], match_ratings: [], training_oefeningen: [],
    // Fase 3a: de metingen-query van de pagina (leeg = geen metingen).
    categorie_metingen: [],
    ...over,
  }
}

// ── HOOFDSCENARIO ──────────────────────────────────────────────────────
// Wedstrijden: m1 09-05, m2 09-12, m3 09-19 (GEEN selectie), m4 09-26,
//   m5 10-03, m6 10-10 (GEEN selectie), m7 10-20 (toekomst, wel selectie).
// Trainingen: ta1 08-20, tS1 09-10, tS2 09-17, tS3 09-24, tF 10-20 (toekomst).
// Venster: seizoen 2026-08-01..2027-06-30, verleden t/m 2026-10-14.
// Noemer-wedstrijden (met selectie, t/m 10-14): m1, m2, m4, m5.
//
// Selecties:  m1 {anna,bram,cor}  m2 {anna,bram,cor,dirk}  m4 {anna,bram,dirk}
//             m5 {anna,dirk,eva}  m7 {anna,bram,dirk}
// Opstellingen (plan): m1 {anna,bram,cor}  m2 {anna,dirk,null,Xander(team-2)}
//             m3 {anna,bram} (geen selectie)  m4 {anna,guus,'geen-uuid',Xander}
//             m5 {null,null,null} (half leeg)  m6 {lenny} (geen selectie)
//
// VERWACHT speelkansen (selectie x van y | basis x van y):
//   Anna  4/4 | 3/4     Cor   2/2 | 1/2  (inactief, O2: noemer stopt bij laatste voorkomen m2)
//   Dirk  3/3 | 1/3     Eva   1/1 | 0/1  (unknown-rij op m1 telt niet voor eerste voorkomen)
//   Bram  3/4 | 1/4     Guus  0/2 | 1/2  (gast; in opstelling m4 zonder selectie)
//   Lenny geen gegevens (noemer 0: alleen in opstelling van wedstrijd zonder selectie)
// Volgorde O5: selectie-aandeel aflopend, dan basis-aandeel aflopend, dan naam;
//   noemer 0 achteraan -> Anna, Cor, Dirk, Eva, Bram, Guus, Lenny.
function hoofdDb(o: { vreemd?: boolean } = {}): Db {
  const vreemd = o.vreemd ?? true
  n = 0
  const db = leegDb({
    events: [
      ev('m1', '2026-09-05', { goals_for: 3, goals_against: 1 }), ev('m2', '2026-09-12'), ev('m3', '2026-09-19'),
      ev('m4', '2026-09-26'), ev('m5', '2026-10-03'), ev('m6', '2026-10-10'), ev('m7', '2026-10-20'),
      trn('ta1', '2026-08-20'), trn('tS1', '2026-09-10'), trn('tS2', '2026-09-17'), trn('tS3', '2026-09-24'),
      trn('tF', '2026-10-20'),
    ],
    players: [
      sp('p-anna', 'Anna Aap', { secondary_positions: ['Linksbuiten'] }), sp('p-bram', 'Bram Beer'),
      sp('p-cor', 'Cor Cobra', { active: false }), sp('p-dirk', 'Dirk Duif'), sp('p-eva', 'Eva Ezel'),
      sp('p-guus', 'Guus Gast', { type: 'guest' }), sp('p-gert', 'Gert Gast', { type: 'guest' }),
      sp('p-lenny', 'Lenny Laat'), sp('p-uli', 'Uli Unknown'),
    ],
    match_squad: [
      sq('m1', 'p-anna'), sq('m1', 'p-bram'), sq('m1', 'p-cor'),
      sq('m2', 'p-anna'), sq('m2', 'p-bram'), sq('m2', 'p-cor'), sq('m2', 'p-dirk'),
      sq('m4', 'p-anna'), sq('m4', 'p-bram'), sq('m4', 'p-dirk'),
      sq('m5', 'p-anna'), sq('m5', 'p-dirk'), sq('m5', 'p-eva'),
      sq('m7', 'p-anna'), sq('m7', 'p-bram'), sq('m7', 'p-dirk'),
    ],
    lineups: [
      lu('m1', ['p-anna', 'p-bram', 'p-cor']), lu('m2', ['p-anna', 'p-dirk', null, 'p-x']),
      lu('m3', ['p-anna', 'p-bram']), lu('m4', ['p-anna', 'p-guus', 'geen-uuid', 'p-x']),
      lu('m5', [null, null, null]), lu('m6', ['p-lenny']),
    ],
    attendance: [
      // wedstrijden (tellen NIET mee voor opkomst, W7)
      att('m1', 'p-anna', 'present'), att('m2', 'p-anna', 'present'), att('m4', 'p-anna', 'absent'),
      att('m5', 'p-anna', 'absent'), att('m2', 'p-bram', 'absent'), // bram: geselecteerd maar afwezig (W2)
      att('m1', 'p-eva', 'unknown'), // backfill-placeholder (O6)
      att('m4', 'p-guus', 'injured'), att('m4', 'p-dirk', 'injured'),
      att('m3', 'p-bram', 'injured'), att('m7', 'p-eva', 'injured'), // m7 = toekomst
      // trainingen
      att('ta1', 'p-anna', 'present'), att('ta1', 'p-cor', 'present'), att('ta1', 'p-eva', 'absent'),
      att('ta1', 'p-guus', 'absent'), att('ta1', 'p-gert', 'absent'),
      att('tS1', 'p-anna', 'present'), att('tS1', 'p-bram', 'injured'), att('tS1', 'p-cor', 'injured'),
      att('tS1', 'p-dirk', 'unknown'), att('tS1', 'p-uli', 'unknown'), att('tS1', 'p-guus', 'absent'), att('tS1', 'p-gert', 'absent'),
      att('tS2', 'p-anna', 'present'), att('tS2', 'p-bram', 'present'), att('tS2', 'p-dirk', 'present'),
      att('tS2', 'p-eva', 'absent'), att('tS2', 'p-guus', 'present'), att('tS2', 'p-gert', 'absent'),
      att('tS3', 'p-anna', 'absent'), att('tS3', 'p-bram', 'present'), att('tS3', 'p-dirk', 'present'),
      att('tS3', 'p-guus', 'absent'), att('tS3', 'p-gert', 'absent'),
      att('tF', 'p-anna', 'absent'), att('tF', 'p-bram', 'absent'), // toekomst
    ],
    match_ratings: [
      rat('m1', 'p-anna', 7), rat('m2', 'p-anna', 8), rat('m4', 'p-anna', 6), rat('m5', 'p-anna', 7),
      rat('m1', 'p-bram', 6), rat('m1', 'p-cor', 9), rat('m4', 'p-guus', 9),
    ],
  })
  if (vreemd) {
    db.events.push(ev('x1', '2026-09-06', { team_id: OTHER, goals_for: 9, goals_against: 0 }), trn('xt', '2026-09-10', { team_id: OTHER }))
    db.players.push(sp('p-x', 'Xander Vreemd', { team_id: OTHER, position: 'Keeper' }))
    db.match_squad.unshift(
      sq('x1', 'p-x', OTHER),
      sq('m6', 'p-anna', OTHER), // vreemde selectierij op EIGEN wedstrijd zonder selectie: mag m6 niet in de noemer trekken
      sq('m1', 'p-x', TEAM), // eigen team_id maar vreemde speler
    )
    db.lineups.unshift(lu('m1', ['p-eva', 'p-x'], OTHER), lu('x1', ['p-x'], OTHER))
    db.attendance.unshift(
      att('m1', 'p-eva', 'present', OTHER), // vreemd team op eigen wedstrijd: eerste voorkomen eva mag niet schuiven
      att('tS1', 'p-anna', 'injured', OTHER), // vreemde blessure op eigen training
      att('tS1', 'p-x', 'injured', TEAM), // eigen team_id maar vreemde speler
      att('ta1', 'p-anna', 'absent', OTHER),
      att('x1', 'p-x', 'present', OTHER),
    )
    db.match_ratings.push(rat('m1', 'p-anna', 1, OTHER), rat('x1', 'p-x', 10, OTHER))
  }
  return db
}

// Zelfde events/spelers/ratings, maar zonder alle fase-2a-bronnen (selecties, opstellingen, aanwezigheid).
function zonderFase2(db: Db): Db {
  return { ...db, match_squad: [], lineups: [], attendance: [] }
}

// ── RATING-SCENARIO (stijgers/dalers) ─────────────────────────────────
// 10 wedstrijden r1..r10 (oud -> nieuw). recent = laatste 5, seizoen = alles.
// verschil = (som laatste 5 - som eerste 5) / 10 bij 10 ratings.
const RDATA = ['2026-08-08', '2026-08-15', '2026-08-22', '2026-08-29', '2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10']
function ratingDb(): Db {
  n = 0
  const events = RDATA.map((d, i) => ev(`r${i + 1}`, d, { goals_for: 1, goals_against: 0 }))
  const spelers: Row[] = []
  const ratings: Row[] = []
  const voeg = (id: string, naam: string, reeks: number[], o: Row = {}) => {
    spelers.push(sp(id, naam, o))
    const start = 10 - reeks.length
    reeks.forEach((r, i) => ratings.push(rat(`r${start + i + 1}`, id, r)))
  }
  voeg('p-rik', 'Rik Riser', [6, 6, 6, 6, 6, 7, 7, 7, 7, 7]) // 6.5 -> 7.0 = +0.5
  voeg('p-bea', 'Bea Gelijk', [6, 6, 6, 6, 6, 7, 7, 7, 7, 7]) // +0.5 (gelijke stand)
  voeg('p-ada', 'Ada Gelijk', [6, 6, 6, 6, 6, 7, 7, 7, 7, 7]) // +0.5 (gelijke stand)
  voeg('p-dre', 'Drempel Drie', [7, 7, 7, 7, 7, 8, 8, 8, 7, 7]) // 7.3 -> 7.6 = +0.3 (grens, inclusief)
  voeg('p-net', 'Net Onder', [7, 7, 7, 7, 7, 8, 8, 7, 7, 7]) // 7.2 -> 7.4 = +0.2 (onder drempel)
  voeg('p-acht', 'Acht Acht', [6, 6, 6, 7, 7, 7, 7, 7]) // 8 ratings: 6.625 -> 7.0 = +0.375 (minimum = 8, inclusief)
  voeg('p-zeven', 'Zeven Zeven', [5, 5, 9, 9, 9, 9, 9]) // 7 ratings: groot verschil maar te weinig -> ontbreekt
  voeg('p-daan', 'Daan Daler', [8, 8, 8, 8, 8, 7, 7, 7, 7, 7]) // 7.5 -> 7.0 = -0.5
  voeg('p-dd', 'Daal Drie', [8, 8, 8, 7, 7, 7, 7, 7, 7, 7]) // 7.3 -> 7.0 = -0.3 (grens daler, inclusief)
  voeg('p-dora', 'Dora Daalt', [8, 8, 8, 8, 8, 6, 6, 6, 6, 6]) // 7.0 -> 6.0 = -1.0
  voeg('p-stan', 'Stan Stabiel', [7, 7, 7, 7, 7, 7, 7, 7, 7, 7]) // 0
  voeg('p-gast', 'Gast Hoog', [6, 6, 6, 6, 6, 9, 9, 9, 9, 9], { type: 'guest' }) // gast: nooit in stijgers (W3)
  voeg('p-oud', 'Oud Hoog', [6, 6, 6, 6, 6, 9, 9, 9, 9, 9], { active: false }) // inactief: nooit in stijgers (W3)
  voeg('p-x2', 'Xander Vreemd', [1, 1, 1, 1, 1, 9, 9, 9, 9, 9], { team_id: OTHER })
  const db = leegDb({ events, players: spelers, match_ratings: ratings })
  db.match_ratings.push(rat('r10', 'p-rik', 1, OTHER)) // vreemd team op eigen speler: mag niets veranderen
  return db
}

// ── POSITIE-SCENARIO ───────────────────────────────────────────────────
// Eén eigen wedstrijd met uitslag zodat de pagina niet leeg is.
function positieDb(extra: Row[] = []): Db {
  n = 0
  return leegDb({
    events: [ev('b1', '2026-10-05', { goals_for: 1, goals_against: 0 })],
    players: [
      sp('p-kees', 'Kees Keeper', { position: 'Keeper' }),
      sp('p-vera', 'Vera Verdediger', { position: 'Centrale verdediger', secondary_positions: ['Linksachter'] }),
      sp('p-bob', 'Bob Back', { position: 'Linksachter' }),
      sp('p-joost', 'Joost Gewond', { position: 'Centrale verdediger', secondary_positions: ['Keeper'], injured: true }),
      sp('p-mo', 'Mo Mid', { position: 'Centrale middenvelder', secondary_positions: ['Centrale verdediger', 'Onbekende positie'] }),
      sp('p-nul', 'Nul Null', { position: 'Rechtsachter', injured: null }),
      sp('p-sven', 'Sven Spits', { position: 'Spits', secondary_positions: ['Spits'] }),
      sp('p-zoe', 'Zoe Zijspits', { position: 'Spits' }),
      sp('p-cor', 'Cor Cobra', { position: 'Defensieve middenvelder', active: false }),
      sp('p-guus', 'Guus Gast', { position: 'Defensieve middenvelder', type: 'guest' }),
      sp('p-x', 'Xander Vreemd', { team_id: OTHER, position: 'Keeper' }),
      ...extra,
    ],
  })
}

const dicts: Record<string, Dict> = { nl, en, de, es, fr }
const i = nl.insights
const T = {
  speel: i.speelkansenTitle, stijg: i.stijgersTitle, dekking: i.dekkingTitle, naast: i.naastElkaarTitle, bless: i.blessuresTitle,
}
const NIEUWE_TITELS = [T.speel, T.stijg, T.dekking, T.naast, T.bless]

async function renderInzichten(db: Db, o: { periode?: string; over?: Partial<Harness>; locale?: string } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`))
  configure({ defaultIgnore: NEGEER_PRINTBLOK })
  state.locale = o.locale ?? 'nl'
  const h = setup(db, { handlers: HANDLERS, ...o.over })
  const el = o.periode === undefined
    ? await InzichtenPage()
    : await InzichtenPage({ searchParams: Promise.resolve({ periode: o.periode }) })
  const r = render(<DictProvider dict={dicts[state.locale]}>{el}</DictProvider>)
  return { ...r, h }
}

function kaart(titel: string): HTMLElement {
  return screen.getByRole('heading', { level: 2, name: titel }).closest('.surface-card') as HTMLElement
}
const kaartTekst = (titel: string) => norm(kaart(titel).textContent)
function tabelRijen(k: HTMLElement) {
  return [...k.querySelectorAll('table:not(.sr-only) tbody tr')].map((tr) => ({
    naam: norm(tr.querySelector('th')!.childNodes[0]?.textContent),
    gast: !!tr.querySelector('th span'),
    cellen: [...tr.querySelectorAll('td')].map((td) => norm(td.textContent)),
  }))
}
const naamLijst = (k: HTMLElement) => tabelRijen(k).map((r) => r.naam)
function dataTabel(k: HTMLElement): string[][] {
  const tbl = k.querySelector('table.sr-only')!
  return [...tbl.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => norm(td.textContent)))
}
function lijstItems(k: HTMLElement) {
  return [...k.querySelectorAll('ol')].map((ol) =>
    [...ol.querySelectorAll('li')].map((li) => ({ naam: norm(li.children[0]?.textContent), waarde: norm(li.children[1]?.textContent) })),
  )
}
const rijVoor = (k: HTMLElement, naam: string) => tabelRijen(k).find((r) => r.naam === naam)!
const callsVan = (h: Harness, naam: string) => h.rpcCalls.filter((c) => c.name === naam)

// ═══════════════════════════════════════════════════════════════════════
// ALGEMEEN
// ═══════════════════════════════════════════════════════════════════════
describe('AC-A1 — nieuwe spelerskaarten onder de fase-1-kaarten, de rest ongewijzigd', () => {
  it('AC-A1: de vijf kaarten staan er, in volgorde O7, ná de fase-1-kaarten (Tegendoelpunten laatste fase-1-kaart)', async () => {
    await renderInzichten(hoofdDb())
    const koppen = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    const idx = NIEUWE_TITELS.map((t) => koppen.indexOf(t))
    expect(idx.every((x) => x >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    for (const faseEen of [i.thuisUitTitle, i.formatieTitle, i.topscorersTitle, i.kaartenTitle, i.kwartierTitle, i.tegenTitle, i.doelpuntenTitle, i.inhoudTitle]) {
      const p = koppen.indexOf(faseEen)
      expect(p, faseEen).toBeGreaterThanOrEqual(0)
      expect(p, faseEen).toBeLessThan(idx[0])
    }
    expect(koppen.indexOf(i.tegenTitle)).toBe(idx[0] - 1) // direct na de laatste fase-1-kaart
  })

  it('AC-A1 (O7): kaart 1 en kaart 4 staan over de volle breedte, de andere drie niet', async () => {
    await renderInzichten(hoofdDb())
    const vol = (t: string) => (kaart(t).parentElement?.className ?? '').includes('lg:col-span-2')
    expect([vol(T.speel), vol(T.stijg), vol(T.dekking), vol(T.naast), vol(T.bless)]).toEqual([true, false, false, true, false])
  })

  it('AC-A1: alles buiten de vijf nieuwe kaarten (fase-1-kaarten, KPI-strook, signalen, periodefilter, rapport) is identiek met en zonder fase-2a-bronnen', async () => {
    const strip = (root: HTMLElement) => {
      const klon = root.cloneNode(true) as HTMLElement
      for (const t of NIEUWE_TITELS) {
        const h = [...klon.querySelectorAll('h2')].find((x) => x.textContent === t)
        h?.closest('.surface-card')?.remove()
      }
      return norm(klon.textContent)
    }
    const met = await renderInzichten(hoofdDb({ vreemd: false }))
    const metTekst = strip(met.container)
    met.unmount()
    const zonder = await renderInzichten(zonderFase2(hoofdDb({ vreemd: false })))
    expect(strip(zonder.container)).toBe(metTekst)
    expect(metTekst.length).toBeGreaterThan(100)
  })

  it('AC-A1: de periodekiezer werkt nog; de fase-1-RPC\'s krijgen onveranderd hun eigen venster (verleden/venster)', async () => {
    const { h } = await renderInzichten(hoofdDb(), { periode: '4w' })
    const verleden = { p_team_id: TEAM, p_start: '2026-09-18', p_end: '2026-10-14' }
    const venster = { p_team_id: TEAM, p_start: '2026-09-18', p_end: '2027-06-30' }
    expect(callsVan(h, 'inzichten_aanwezigheid')[0].args).toEqual(verleden)
    expect(callsVan(h, 'inzichten_training_opkomst_per_maand')[0].args).toEqual(verleden)
    expect(callsVan(h, 'inzichten_aanwezigheid_per_speler')[0].args).toEqual(verleden)
    expect(callsVan(h, 'inzichten_rating_team_per_wedstrijd')[0].args).toEqual(venster)
    expect(callsVan(h, 'inzichten_wedstrijd_uitslagen')[0].args).toEqual(venster)
  })
})

describe('AC-A2 — tenant-isolatie op de nieuwe kaarten', () => {
  it('AC-A2: data van team-2 (spelers, selecties, opstellingen met vreemde speler-id, aanwezigheid, ratings, events) verandert niets aan de vijf kaarten', async () => {
    const schoon = await renderInzichten(hoofdDb({ vreemd: false }))
    const schoonTekst = NIEUWE_TITELS.map(kaartTekst)
    schoon.unmount()
    const vuil = await renderInzichten(hoofdDb({ vreemd: true }))
    expect(NIEUWE_TITELS.map(kaartTekst)).toEqual(schoonTekst)
    expect(document.body.textContent).not.toContain('Xander')
    expect(document.body.textContent).not.toContain('Vreemd')
    for (const c of vuil.h.rpcCalls.filter((c) => NIEUWE_RPCS.includes(c.name) || c.name === 'inzichten_rating_per_speler')) {
      expect((c.args as Row).p_team_id).toBe(TEAM)
    }
  })

  it('AC-A2: een lineup van het eigen team met het speler-id van een team-2-speler telt nergens mee', async () => {
    await renderInzichten(hoofdDb())
    expect(naamLijst(kaart(T.speel))).not.toContain('Xander Vreemd')
    expect(naamLijst(kaart(T.naast))).not.toContain('Xander Vreemd')
  })

  it('AC-A2: selectie- en aanwezigheidsrijen met team_id team-2 op een eigen wedstrijd tellen niet mee (m6 blijft buiten de noemer, eva-eerste-voorkomen schuift niet, vreemde blessure telt niet)', async () => {
    await renderInzichten(hoofdDb())
    expect(rijVoor(kaart(T.speel), 'Anna Aap').cellen).toEqual(['4 van 4 wedstrijden', '3 van 4 wedstrijden'])
    expect(rijVoor(kaart(T.speel), 'Eva Ezel').cellen).toEqual(['1 van 1 wedstrijden', '0 van 1 wedstrijden'])
    expect(dataTabel(kaart(T.bless)).map((r) => r[1])).toEqual(['0', '3', '0'])
  })

  it('AC-A2: een lid van team-2 ziet alleen team-2-gegevens, nooit die van team-1 (en alle nieuwe calls dragen zijn eigen p_team_id)', async () => {
    const db = hoofdDb()
    db.match_squad.push(sq('x1', 'p-x', OTHER))
    const { h } = await renderInzichten(db, { over: { userId: OTHER } })
    for (const c of h.rpcCalls.filter((c) => NIEUWE_RPCS.includes(c.name))) expect((c.args as Row).p_team_id).toBe(OTHER)
    expect(document.body.textContent).not.toMatch(/Anna|Bram|Cor Cobra|Dirk|Eva|Guus|Lenny/)
    expect(naamLijst(kaart(T.speel))).toEqual(['Xander Vreemd'])
  })

  it('AC-A2: p_team_id wordt altijd uit de teamcontext gehaald (nooit leeg of een vaste waarde): alle vijf bron-calls hebben exact TEAM', async () => {
    const { h } = await renderInzichten(hoofdDb())
    for (const naam of [...NIEUWE_RPCS, 'inzichten_rating_per_speler']) {
      expect(callsVan(h, naam)).toHaveLength(1)
      expect((callsVan(h, naam)[0].args as Row).p_team_id).toBe(TEAM)
    }
  })
})

describe('AC-A3 — geen relevante data: lege staat, geen nullen-als-meting, NaN of fout', () => {
  it('AC-A3: een team met alleen een toekomstige wedstrijd met uitslag: alle vijf kaarten tonen hun eigen lege staat, geen NaN/Infinity/undefined, geen fout', async () => {
    const db = leegDb({ events: [ev('f1', '2026-10-20', { goals_for: 1, goals_against: 0 })], players: [sp('p-a', 'Anna Aap')] })
    await renderInzichten(db)
    expect(kaart(T.speel)).toHaveTextContent(i.speelkansenEmpty)
    expect(kaart(T.stijg)).toHaveTextContent(fmt(i.stijgersTeWeinig, { min: 8 }))
    expect(kaart(T.naast)).toHaveTextContent(i.naastElkaarEmpty)
    expect(kaart(T.bless)).toHaveTextContent(i.blessuresEmpty)
    expect(kaart(T.dekking).querySelector('table')).not.toBeNull() // er is wél een actieve speler
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined/)
    for (const t of NIEUWE_TITELS) expect(kaart(t)).not.toHaveTextContent(i.bronFout)
  })

  it('AC-A3 / AC-1.6: wedstrijd met alleen een opstelling (geen selectie) -> speelkansen leeg, niet "0 van 0"', async () => {
    const db = hoofdDb({ vreemd: false })
    db.match_squad = []
    await renderInzichten(db)
    expect(kaart(T.speel)).toHaveTextContent(i.speelkansenEmpty)
    expect(kaart(T.speel).querySelector('table')).toBeNull()
    expect(kaart(T.speel)).not.toHaveTextContent('0 van 0')
  })

  it('AC-A3: spelers zonder enige selectie/opstelling/aanwezigheid komen niet als 0-regel in speelkansen of de naast-elkaar-tabel', async () => {
    await renderInzichten(hoofdDb())
    expect(naamLijst(kaart(T.speel))).not.toContain('Gert Gast')
    expect(naamLijst(kaart(T.naast))).not.toContain('Gert Gast')
    expect(naamLijst(kaart(T.naast))).not.toContain('Lenny Laat')
  })
})

describe('AC-A4 — één falende bron raakt alleen de eigen kaart(en)', () => {
  const FOUT = { code: 'PGRST202', message: 'Could not find the function GEHEIM_DETAIL_XYZ' }
  const kaartenBijBron: Record<string, string[]> = {
    inzichten_speelkansen: [T.speel, T.naast],
    inzichten_rating_vorm_per_speler: [T.stijg],
    inzichten_training_opkomst_per_speler: [T.naast],
    inzichten_blessures_per_maand: [T.bless],
    inzichten_rating_per_speler: [T.naast],
  }
  it.each(Object.keys(kaartenBijBron))('AC-A4: %s faalt — alleen de gekoppelde kaart(en) tonen de algemene melding, de rest werkt, geen details in de DOM', async (rpc) => {
    await renderInzichten(hoofdDb(), { over: { rpcErrors: { [rpc]: FOUT } } })
    for (const t of NIEUWE_TITELS) {
      if (kaartenBijBron[rpc].includes(t)) expect(kaart(t)).toHaveTextContent(i.bronFout)
      else expect(kaart(t)).not.toHaveTextContent(i.bronFout)
    }
    expect(document.body.textContent).not.toMatch(/PGRST202|GEHEIM_DETAIL_XYZ/)
    // de overige kaarten tonen echte inhoud
    if (rpc !== 'inzichten_speelkansen') expect(rijVoor(kaart(T.speel), 'Anna Aap').cellen[0]).toBe('4 van 4 wedstrijden')
    expect(kaart(T.dekking).querySelectorAll('tbody tr')).toHaveLength(12)
  })

  it('AC-A4: de players-select faalt — alleen positiedekking toont de melding; de andere vier kaarten renderen normaal', async () => {
    await renderInzichten(hoofdDb(), { over: { selectErrors: { players: { code: 'XX000', message: 'GEHEIM_DETAIL_XYZ' } } } })
    expect(kaart(T.dekking)).toHaveTextContent(i.bronFout)
    for (const t of [T.speel, T.stijg, T.naast, T.bless]) expect(kaart(t)).not.toHaveTextContent(i.bronFout)
    expect(rijVoor(kaart(T.speel), 'Anna Aap').cellen[0]).toBe('4 van 4 wedstrijden')
    expect(document.body.textContent).not.toMatch(/XX000|GEHEIM_DETAIL_XYZ/)
  })

  it('AC-A4: migratie ontbreekt (alle vier de nieuwe RPC\'s PGRST202) — vier kaarten tonen de melding; positiedekking en de bestaande kaarten werken door', async () => {
    const rpcErrors = Object.fromEntries(NIEUWE_RPCS.map((x) => [x, FOUT]))
    await renderInzichten(hoofdDb(), { over: { rpcErrors } })
    for (const t of [T.speel, T.stijg, T.naast, T.bless]) expect(kaart(t)).toHaveTextContent(i.bronFout)
    expect(kaart(T.dekking)).not.toHaveTextContent(i.bronFout)
    expect(kaart(T.dekking).querySelectorAll('tbody tr')).toHaveLength(12)
    expect(screen.getByRole('heading', { level: 2, name: i.doelpuntenTitle })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/PGRST202|GEHEIM_DETAIL_XYZ/)
  })

  it('AC-A4: een falende bron toont geen misleidende lege staat of 0 (geen "nog geen"-tekst naast de foutmelding)', async () => {
    await renderInzichten(hoofdDb(), { over: { rpcErrors: { inzichten_blessures_per_maand: FOUT, inzichten_speelkansen: FOUT } } })
    expect(kaart(T.bless)).not.toHaveTextContent(i.blessuresEmpty)
    expect(kaart(T.speel)).not.toHaveTextContent(i.speelkansenEmpty)
    expect(kaart(T.naast)).not.toHaveTextContent(i.naastElkaarEmpty)
  })
})

describe('AC-A5 — team zonder data / bronnen tellen mee', () => {
  it('AC-A5: geen enkele data -> bestaande lege-pagina-staat, geen nieuwe kaarten', async () => {
    await renderInzichten(leegDb())
    expect(screen.getByText(i.geenDataTitle)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: T.speel })).toBeNull()
  })

  it('AC-A5: alleen spelers (een selectie van de groep, zonder registraties) blijft de lege pagina', async () => {
    await renderInzichten(leegDb({ players: [sp('p-a', 'Anna Aap'), sp('p-b', 'Bram Beer')] }))
    expect(screen.getByText(i.geenDataTitle)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: T.dekking })).toBeNull()
  })

  it('AC-A5: alleen trainingsaanwezigheid (nieuwe bron "opkomst per speler") telt als data -> gewone pagina', async () => {
    const db = leegDb({ events: [trn('t1', '2026-09-10')], players: [sp('p-a', 'Anna Aap')], attendance: [att('t1', 'p-a', 'present')] })
    await renderInzichten(db)
    expect(screen.queryByText(i.geenDataTitle)).toBeNull()
    expect(rijVoor(kaart(T.naast), 'Anna Aap').cellen[0]).toBe('100% (1 van 1 trainingen)')
  })

  it('AC-A5: alleen een blessure-registratie op een training telt als data -> gewone pagina met 1 geblesseerde', async () => {
    const db = leegDb({ events: [trn('t1', '2026-09-10')], players: [sp('p-a', 'Anna Aap')], attendance: [att('t1', 'p-a', 'injured')] })
    await renderInzichten(db)
    expect(screen.queryByText(i.geenDataTitle)).toBeNull()
    expect(dataTabel(kaart(T.bless)).find((r) => r[1] === '1')).toBeTruthy()
  })

  it('AC-A5: alleen evenementen zonder aanwezigheid/blessures, selectie of spelers blijven de lege pagina voor de nieuwe bronnen (trainings-event zonder rijen)', async () => {
    await renderInzichten(leegDb({ events: [trn('t1', '2026-09-10')] }))
    expect(screen.getByText(i.geenDataTitle)).toBeInTheDocument()
  })

  it('AC-A5: een periode (4w) zonder enige data in het venster -> lege-periode-staat met zichtbare periodekiezer', async () => {
    const db = leegDb({ events: [trn('t1', '2026-08-10')], players: [sp('p-a', 'Anna Aap')], attendance: [att('t1', 'p-a', 'present')] })
    await renderInzichten(db, { periode: '4w' })
    expect(screen.getByText(i.periodeLeeg)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: T.speel })).toBeNull()
  })
})

describe('AC-A6 — unieke titel per kaart, nl/en/de/es/fr', () => {
  it.each(['nl', 'en', 'de', 'es', 'fr'])('AC-A6: taal %s — vijf nieuwe, onderling en pagina-breed unieke titels uit de eigen taal, precies één keer aanwezig', async (loc) => {
    await renderInzichten(hoofdDb(), { locale: loc })
    const d = dicts[loc].insights
    const nieuw = [d.speelkansenTitle, d.stijgersTitle, d.dekkingTitle, d.naastElkaarTitle, d.blessuresTitle]
    expect(new Set(nieuw).size).toBe(5)
    const koppen = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    for (const t of nieuw) {
      expect(t.trim().length).toBeGreaterThan(0)
      expect(koppen.filter((k) => k === t)).toHaveLength(1)
    }
    expect(new Set(koppen).size).toBe(koppen.length)
  })

  it('AC-A6: alle nieuwe teksten bestaan in alle vijf de talen, zijn niet leeg en behouden hun {plaatshouders}', () => {
    const sleutels = [
      'speelkansenTitle', 'speelkansenDescription', 'speelkansenEmpty', 'speelkansenUitleg', 'kolomSpeler', 'kolomInSelectie',
      'kolomInBasis', 'vanWedstrijden', 'geenGegevens', 'stijgersTitle', 'stijgersDescription', 'stijgersEmpty',
      'stijgersTeWeinig', 'stijgersLabel', 'dalersLabel', 'stijgersNiemand', 'stijgersWaarde', 'dekkingTitle',
      'dekkingDescription', 'dekkingEmpty', 'kolomPositie', 'kolomFit', 'dekkingGeen', 'dekkingEen', 'dekkingMeer',
      'dekkingSecundair', 'naastElkaarTitle', 'naastElkaarDescription', 'naastElkaarEmpty', 'kolomTrainingsopkomst',
      'opkomstWaarde', 'opkomstGastWaarde', 'blessuresTitle', 'blessuresDescription', 'blessuresEmpty', 'blessuresSummary',
      'kolomGeblesseerd',
    ] as const
    for (const [loc, d] of Object.entries(dicts)) {
      const rec = d.insights as unknown as Record<string, string>
      for (const s of sleutels) {
        expect(typeof rec[s], `${loc}.insights.${s}`).toBe('string')
        expect(rec[s].trim().length, `${loc}.insights.${s}`).toBeGreaterThan(0)
        const nlPlaats = (nl.insights as unknown as Record<string, string>)[s].match(/\{\w+\}/g) ?? []
        for (const p of nlPlaats) expect(rec[s], `${loc}.insights.${s} mist ${p}`).toContain(p)
      }
    }
  })

  it.each(['en', 'de', 'es', 'fr'])('AC-A6: taal %s — de nieuwe teksten zijn echt vertaald (niet de Nederlandse tekst)', (loc) => {
    const rec = dicts[loc].insights as unknown as Record<string, string>
    for (const s of ['speelkansenTitle', 'stijgersTitle', 'dekkingTitle', 'naastElkaarTitle', 'blessuresTitle', 'dekkingGeen', 'opkomstGastWaarde']) {
      expect(rec[s], `${loc}.${s}`).not.toBe((nl.insights as unknown as Record<string, string>)[s])
    }
  })
})

describe('AC-A7 — tekstvariant bij elke grafiek, kleuren uit tokens', () => {
  it('AC-A7: blessuregrafiek heeft role="img" met aria-label (samenvatting) en een datatabel die NIET binnen de img-wrapper staat', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.bless)
    const img = k.querySelector('[role="img"]') as HTMLElement
    expect(img).not.toBeNull()
    const label = img.getAttribute('aria-label') ?? ''
    const reeks = ['2026-08', '2026-09', '2026-10'].map((m, ix) => `${maandLabel(m, nl.browserLocale)}: ${['0', '3', '0'][ix]}`).join(', ')
    expect(label).toBe(fmt(i.blessuresSummary, { reeks }))
    const tabel = k.querySelector('table.sr-only') as HTMLElement
    expect(tabel).not.toBeNull()
    expect(img.contains(tabel)).toBe(false)
    expect(k.querySelectorAll('[role="img"] table')).toHaveLength(0)
    expect(tabel.querySelector('caption')?.textContent).toBe(label)
  })

  it('AC-A7: de tabellen (speelkansen, positiedekking, naast-elkaar) zijn semantisch: kolomkoppen met scope="col", rijkoppen met scope="row"', async () => {
    await renderInzichten(hoofdDb())
    for (const t of [T.speel, T.dekking, T.naast]) {
      const k = kaart(t)
      expect(k.querySelectorAll('thead th[scope="col"]').length).toBeGreaterThanOrEqual(3)
      expect(k.querySelectorAll('tbody th[scope="row"]').length).toBeGreaterThan(0)
    }
  })

  it('AC-A7: de meters in speelkansen zijn decoratief (aria-hidden) en gebruiken tokens (--brand-accent op --track), nooit een hex-kleur', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.speel)
    const meters = k.querySelectorAll('[aria-hidden="true"]')
    expect(meters.length).toBeGreaterThan(0)
    expect(k.innerHTML).toContain('var(--brand-accent)')
    expect(k.innerHTML).toContain('var(--track)')
  })

  it('AC-A7: geen hex-kleur (#rrggbb, rgb(), hsl()) in fill/stroke/style/stop-color van de vijf nieuwe kaarten; de blessurestaaf gebruikt var(--brand-accent)', async () => {
    await renderInzichten(hoofdDb())
    for (const t of NIEUWE_TITELS) {
      for (const el of kaart(t).querySelectorAll('*')) {
        for (const attr of ['fill', 'stroke', 'style', 'stop-color', 'color']) {
          const v = el.getAttribute(attr) ?? ''
          expect(v, `${t} ${el.tagName}[${attr}]`).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(/)
        }
      }
    }
    expect(kaart(T.bless).innerHTML).toContain('var(--brand-accent)')
  })
})

describe('AC-A8 — percentage/verhouding toont de noemer; noemer 0 -> "geen gegevens"', () => {
  it('AC-A8: elke cel in speelkansen is "x van y wedstrijden" of "geen gegevens" — nooit een kaal percentage of NaN', async () => {
    await renderInzichten(hoofdDb())
    for (const r of tabelRijen(kaart(T.speel))) {
      for (const c of r.cellen) expect(c, r.naam).toMatch(/^(\d+ van \d+ wedstrijden|geen gegevens)$/)
    }
    expect(kaart(T.speel).textContent).not.toMatch(/%|NaN/)
  })

  it('AC-A8: noemer 0 (Lenny: alleen in opstelling van wedstrijden zonder selectie) -> "geen gegevens" in beide kolommen, geen meter', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.speel)
    expect(rijVoor(k, 'Lenny Laat').cellen).toEqual([i.geenGegevens, i.geenGegevens])
    const tr = [...k.querySelectorAll('tbody tr')].find((x) => x.querySelector('th')!.textContent!.startsWith('Lenny'))!
    expect(tr.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('AC-A8: in de naast-elkaar-tabel heeft opkomst "x van y trainingen", selectie "x van y wedstrijden"; een ontbrekende waarde is "geen gegevens", niet 0', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.naast)
    for (const r of tabelRijen(k)) {
      expect(r.cellen[0], r.naam).toMatch(/^(\d+% \(\d+ van \d+ trainingen\)|\d+ keer aanwezig|geen gegevens)$/)
      expect(r.cellen[1], r.naam).toMatch(/^(\d+ van \d+ wedstrijden|geen gegevens)$/)
      expect(r.cellen[2], r.naam).toMatch(/^(\d+\.\d \(\d+ wedstrijden\)|geen gegevens)$/)
    }
    expect(k.textContent).not.toMatch(/NaN|Infinity/)
  })
})

describe('AC-A9 — vaste volgorde; gelijke waarde -> naam, dan speler-id', () => {
  it('AC-A9 / O5: speelkansen op selectie-aandeel aflopend, dan basis-aandeel aflopend, noemer 0 achteraan', async () => {
    await renderInzichten(hoofdDb())
    expect(naamLijst(kaart(T.speel))).toEqual(['Anna Aap', 'Cor Cobra', 'Dirk Duif', 'Eva Ezel', 'Bram Beer', 'Guus Gast', 'Lenny Laat'])
  })

  it('AC-A9: gelijke stand in speelkansen valt terug op naam, dan op speler-id (twee spelers met dezelfde naam)', async () => {
    n = 0
    const db = leegDb({
      events: [ev('a', '2026-09-05'), ev('b', '2026-09-12')],
      players: [sp('p-t2', 'Twin Tweeling'), sp('p-t1', 'Twin Tweeling'), sp('p-aaa', 'Zed Zacht'), sp('p-bbb', 'Aad Aardig')],
      match_squad: [sq('a', 'p-t1'), sq('a', 'p-t2'), sq('b', 'p-t1'), sq('b', 'p-t2'), sq('b', 'p-aaa'), sq('b', 'p-bbb')],
    })
    await renderInzichten(db)
    const rijen = tabelRijen(kaart(T.speel))
    // t1/t2: selectie 2/2; aaa/bbb: eerste voorkomen in b -> 1/1. Hele rij gelijk -> naam, id.
    expect(rijen.map((r) => r.naam)).toEqual(['Aad Aardig', 'Twin Tweeling', 'Twin Tweeling', 'Zed Zacht'])
    const html = [...kaart(T.speel).querySelectorAll('tbody tr')].map((tr) => tr.querySelector('th')!.textContent)
    expect(html).toHaveLength(4)
  })

  it('AC-A9: de naast-elkaar-tabel staat op naam (geen rangorde)', async () => {
    await renderInzichten(hoofdDb())
    expect(naamLijst(kaart(T.naast))).toEqual(['Anna Aap', 'Bram Beer', 'Cor Cobra', 'Dirk Duif', 'Eva Ezel', 'Guus Gast'])
  })

  it('AC-A9: stijgers op verschil aflopend, bij gelijk verschil naam; dalers met grootste daling eerst', async () => {
    await renderInzichten(ratingDb())
    const [stijgers, dalers] = lijstItems(kaart(T.stijg))
    expect(stijgers.map((s) => s.naam)).toEqual(['Ada Gelijk', 'Bea Gelijk', 'Rik Riser', 'Acht Acht', 'Drempel Drie'])
    expect(dalers.map((s) => s.naam)).toEqual(['Dora Daalt', 'Daan Daler', 'Daal Drie'])
  })
})

describe('AC-A10 — alleen aantallen/verhoudingen; geen KPI, signaal, advies, alarm of rapport (V6)', () => {
  it('AC-A10: de vijf nieuwe kaarten hebben geen waarschuwings-/succeskleuren, geen alert-rol, geen knoppen of links en geen oordeel-/adviesteksten', async () => {
    await renderInzichten(hoofdDb())
    // statuskleuren van de app: --chip-*-fg tokens en chart-fill-red/green (zie SignalenBlok, VormChart, TegendoelpuntenChart)
    const verboden = /--chip-|chart-fill-(?:red|green|amber|yellow)|--danger|--success|--warn/
    for (const t of NIEUWE_TITELS) {
      const k = kaart(t)
      expect(k.innerHTML, `${t}: statuskleur`).not.toMatch(verboden)
      expect(k.querySelector('[role="alert"], [role="status"], button, a')).toBeNull()
      expect(norm(k.textContent)).not.toMatch(/advies|aanbevel|risico|zorgelijk|alarm|waarschuw|te laag|te hoog|pdf|rapport|kritiek|\bdun\b/i)
    }
  })

  it('AC-A10: er komen geen nieuwe KPI-/signaal-/rapport-elementen bij (identiek met en zonder fase-2a-bronnen — zie AC-A1 — en geen extra knoppen in het kaartengebied)', async () => {
    const met = await renderInzichten(hoofdDb())
    const knoppen = [...kaart(T.speel).parentElement!.parentElement!.querySelectorAll('button')].length
    met.unmount()
    await renderInzichten(zonderFase2(hoofdDb()))
    expect([...kaart(T.speel).parentElement!.parentElement!.querySelectorAll('button')].length).toBe(knoppen)
  })

  it('AC-A10: stijgers en dalers gebruiken neutrale inkt voor de waarde (een daling is geen alarm)', async () => {
    await renderInzichten(ratingDb())
    const k = kaart(T.stijg)
    const waarden = [...k.querySelectorAll('li > span:nth-child(2)')]
    expect(waarden.length).toBeGreaterThan(0)
    const klassen = new Set(waarden.map((w) => w.className))
    expect(klassen.size).toBe(1) // stijgers en dalers precies dezelfde stijl
  })
})

describe('AC-A12 — gasten en inactieven per kaart (W3)', () => {
  it('AC-A12 / AC-1.7: speelkansen toont de gast mét label "gast" en de inactieve speler zonder label; vaste actieve spelers hebben geen label', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.speel)
    expect(rijVoor(k, 'Guus Gast').gast).toBe(true)
    expect(rijVoor(k, 'Cor Cobra').gast).toBe(false)
    expect(rijVoor(k, 'Cor Cobra').cellen).toEqual(['2 van 2 wedstrijden', '1 van 2 wedstrijden'])
    expect(rijVoor(k, 'Anna Aap').gast).toBe(false)
    const badge = [...k.querySelectorAll('tbody th span')]
    expect(badge).toHaveLength(1)
    expect(badge[0].textContent).toBe(i.gastLabel)
  })

  it('AC-A12: opkomst/selectie/rating toont de gast met label en de inactieve speler; de rating van gast en inactieve is "geen gegevens" (bestaande ratingregel)', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.naast)
    expect(rijVoor(k, 'Guus Gast').gast).toBe(true)
    expect(rijVoor(k, 'Cor Cobra')).toBeTruthy()
    expect(rijVoor(k, 'Guus Gast').cellen[2]).toBe(i.geenGegevens)
    expect(rijVoor(k, 'Cor Cobra').cellen[2]).toBe(i.geenGegevens)
    expect(rijVoor(k, 'Anna Aap').cellen[2]).toBe('7.0 (4 wedstrijden)')
  })

  it('AC-A12: stijgers en dalers tonen alleen actieve vaste spelers (geen gast, geen inactieve), ook niet met groot verschil', async () => {
    await renderInzichten(ratingDb())
    const alle = lijstItems(kaart(T.stijg)).flat().map((x) => x.naam)
    expect(alle).not.toContain('Gast Hoog')
    expect(alle).not.toContain('Oud Hoog')
    expect(alle).not.toContain('Xander Vreemd')
  })

  it('AC-A12: positiedekking telt alleen actieve vaste spelers (geen inactieve, geen gast)', async () => {
    await renderInzichten(positieDb())
    const tekst = kaartTekst(T.dekking)
    expect(tekst).not.toContain('Cor Cobra')
    expect(tekst).not.toContain('Guus Gast')
    expect(rijVoor(kaart(T.dekking), nl.players.positions['Defensieve middenvelder']).cellen[0]).toBe(i.dekkingGeen)
  })

  it('AC-A12 (O4): blessures per maand tellen vaste spelers inclusief nu-inactieve (Cor), maar geen gasten (Guus)', async () => {
    await renderInzichten(hoofdDb())
    // sept: bram, cor (inactief), dirk = 3; guus (gast, injured op m4) telt niet mee
    expect(dataTabel(kaart(T.bless))[1][1]).toBe('3')
  })
})

describe('AC-A13 — venster per kaart', () => {
  const VERLEDEN_SEIZOEN = { p_team_id: TEAM, p_start: '2026-08-01', p_end: '2026-10-14' }
  const VERLEDEN_4W = { p_team_id: TEAM, p_start: '2026-09-18', p_end: '2026-10-14' }
  const SEIZOEN = { p_team_id: TEAM, p_start: '2026-08-01', p_end: '2027-06-30', p_recent: 5 }

  it('AC-A13: hele seizoen — speelkansen, trainingsopkomst en blessures krijgen "verleden" (t/m gisteren); rating-vorm het hele seizoen met p_recent 5; kaart-4-rating het venster', async () => {
    const { h } = await renderInzichten(hoofdDb())
    expect(callsVan(h, 'inzichten_speelkansen')[0].args).toEqual(VERLEDEN_SEIZOEN)
    expect(callsVan(h, 'inzichten_training_opkomst_per_speler')[0].args).toEqual(VERLEDEN_SEIZOEN)
    expect(callsVan(h, 'inzichten_blessures_per_maand')[0].args).toEqual(VERLEDEN_SEIZOEN)
    expect(callsVan(h, 'inzichten_rating_vorm_per_speler')[0].args).toEqual(SEIZOEN)
    expect(callsVan(h, 'inzichten_rating_per_speler')[0].args).toEqual({ p_team_id: TEAM, p_start: '2026-08-01', p_end: '2027-06-30' })
  })

  it('AC-A13: periode 4w — speelkansen, opkomst en blessures volgen de periode (verleden); rating-vorm blijft het HELE seizoen; kaart-4-rating volgt het venster', async () => {
    const { h } = await renderInzichten(hoofdDb(), { periode: '4w' })
    expect(callsVan(h, 'inzichten_speelkansen')[0].args).toEqual(VERLEDEN_4W)
    expect(callsVan(h, 'inzichten_training_opkomst_per_speler')[0].args).toEqual(VERLEDEN_4W)
    expect(callsVan(h, 'inzichten_blessures_per_maand')[0].args).toEqual(VERLEDEN_4W)
    expect(callsVan(h, 'inzichten_rating_vorm_per_speler')[0].args).toEqual(SEIZOEN)
    expect(callsVan(h, 'inzichten_rating_per_speler')[0].args).toEqual({ p_team_id: TEAM, p_start: '2026-09-18', p_end: '2027-06-30' })
  })

  it('AC-A13: 4w verandert de speelkansen-cijfers (alleen wedstrijden met selectie vanaf 18 sept; eerste voorkomen vóór het venster blijft gelden; O2-speler zonder noemer in het venster -> geen gegevens)', async () => {
    await renderInzichten(hoofdDb(), { periode: '4w' })
    const k = kaart(T.speel)
    expect(rijVoor(k, 'Anna Aap').cellen).toEqual(['2 van 2 wedstrijden', '1 van 2 wedstrijden']) // m4, m5
    expect(rijVoor(k, 'Dirk Duif').cellen).toEqual(['2 van 2 wedstrijden', '0 van 2 wedstrijden']) // eerste m2 (vóór venster)
    expect(rijVoor(k, 'Eva Ezel').cellen).toEqual(['1 van 1 wedstrijden', '0 van 1 wedstrijden'])
    expect(rijVoor(k, 'Cor Cobra').cellen).toEqual([i.geenGegevens, i.geenGegevens]) // inactief: noemer stopt bij m2, buiten het venster
  })

  it('AC-A13: stijgers/dalers en positiedekking volgen de periodekiezer niet — de kaarten zijn tekstueel identiek bij seizoen en 4w, en de kaarttekst zegt dat', async () => {
    const a = await renderInzichten(ratingDb())
    const stijgSeizoen = kaartTekst(T.stijg)
    a.unmount()
    await renderInzichten(ratingDb(), { periode: '4w' })
    expect(kaartTekst(T.stijg)).toBe(stijgSeizoen)
    expect(kaart(T.stijg)).toHaveTextContent('Altijd het hele seizoen')
    cleanup()
    const p1 = await renderInzichten(positieDb())
    const dekSeizoen = kaartTekst(T.dekking)
    p1.unmount()
    await renderInzichten(positieDb(), { periode: '8w' })
    expect(kaartTekst(T.dekking)).toBe(dekSeizoen)
    expect(kaart(T.dekking)).toHaveTextContent('Stand van vandaag, los van de gekozen periode')
  })

  it('AC-A13: de afbakening staat in de kaarttekst — speelkansen "t/m gisteren", opkomst-kaart noemt per kolom zijn afbakening, blessures "t/m gisteren"', async () => {
    await renderInzichten(hoofdDb())
    expect(kaart(T.speel)).toHaveTextContent('t/m gisteren')
    expect(kaart(T.naast)).toHaveTextContent('Opkomst: trainingen t/m gisteren')
    expect(kaart(T.naast)).toHaveTextContent('Selectie: zoals bij speelkansen')
    expect(kaart(T.naast)).toHaveTextContent('Rating: vaste actieve spelers, deze periode')
    expect(kaart(T.bless)).toHaveTextContent('t/m gisteren')
  })
})

describe('AC-A14 — meer wedstrijden dan de limiet: nooit stil afgekapt', () => {
  it('AC-A14: 250 wedstrijden met selectie (boven MAX_SEIZOEN_WEDSTRIJDEN) -> noemer 250 en selectie 250, geen enkele wedstrijd weggelaten, geen limiet-melding nodig', async () => {
    n = 0
    const events: Row[] = []
    const squads: Row[] = []
    for (let k = 0; k < 250; k++) {
      const dag = String(1 + (k % 28)).padStart(2, '0')
      const maand = k < 125 ? '08' : '09'
      events.push(ev(`w${k}`, `2026-${maand}-${dag}`))
      squads.push(sq(`w${k}`, 'p-a'))
      if (k % 2 === 0) squads.push(sq(`w${k}`, 'p-b'))
    }
    const db = leegDb({ events, players: [sp('p-a', 'Anna Aap'), sp('p-b', 'Bram Beer')], match_squad: squads })
    await renderInzichten(db)
    const k = kaart(T.speel)
    expect(rijVoor(k, 'Anna Aap').cellen[0]).toBe('250 van 250 wedstrijden')
    expect(rijVoor(k, 'Bram Beer').cellen[0]).toBe('125 van 250 wedstrijden')
    expect(k).not.toHaveTextContent(i.afgekapt)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 1. SPEELKANSEN
// ═══════════════════════════════════════════════════════════════════════
describe('AC-1.x — speelkansen-verdeling', () => {
  it('AC-1.1 / AC-1.2 / AC-1.3 / W2: per speler selectie en basis als "x van y wedstrijden" (handgetelde waarden)', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.speel)
    const verwacht: Record<string, string[]> = {
      'Anna Aap': ['4 van 4 wedstrijden', '3 van 4 wedstrijden'],
      'Cor Cobra': ['2 van 2 wedstrijden', '1 van 2 wedstrijden'],
      'Dirk Duif': ['3 van 3 wedstrijden', '1 van 3 wedstrijden'],
      'Eva Ezel': ['1 van 1 wedstrijden', '0 van 1 wedstrijden'],
      'Bram Beer': ['3 van 4 wedstrijden', '1 van 4 wedstrijden'],
      'Guus Gast': ['0 van 2 wedstrijden', '1 van 2 wedstrijden'],
      'Lenny Laat': [i.geenGegevens, i.geenGegevens],
    }
    for (const [naam, cellen] of Object.entries(verwacht)) expect(rijVoor(k, naam).cellen, naam).toEqual(cellen)
    expect(tabelRijen(k)).toHaveLength(7)
  })

  it('AC-1.2 / W2: geselecteerd maar afwezig (Bram: selectie m2, aanwezigheid "absent") telt als geselecteerd', async () => {
    await renderInzichten(hoofdDb())
    expect(rijVoor(kaart(T.speel), 'Bram Beer').cellen[0]).toBe('3 van 4 wedstrijden')
  })

  it('AC-1.3 / W2: basis = opgeslagen plan; een opstelling zonder enige speler (alleen null) geeft geen basis (m5 telt voor niemand)', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.speel)
    // Anna stond in m5 wel in de selectie, maar m5 heeft een lege opstelling: basis 3 (m1, m2, m4), niet 4
    expect(rijVoor(k, 'Anna Aap').cellen[1]).toBe('3 van 4 wedstrijden')
    expect(rijVoor(k, 'Eva Ezel').cellen[1]).toBe('0 van 1 wedstrijden')
  })

  it('AC-1.3: een geldig uuid-achtig maar onbekend of ongeldig speler-id in de opstelling ("geen-uuid", null) laat de kaart niet falen', async () => {
    await renderInzichten(hoofdDb())
    expect(kaart(T.speel)).not.toHaveTextContent(i.bronFout)
    expect(tabelRijen(kaart(T.speel)).length).toBeGreaterThan(0)
  })

  it('AC-1.4 / W2: wedstrijden zonder selectie (m3, m6) staan buiten de noemer, ook al is er een opstelling', async () => {
    await renderInzichten(hoofdDb())
    // 6 wedstrijden t/m gisteren, 4 met selectie: noemer van Anna is 4, niet 6
    expect(rijVoor(kaart(T.speel), 'Anna Aap').cellen[0]).toBe('4 van 4 wedstrijden')
    expect(rijVoor(kaart(T.speel), 'Bram Beer').cellen[1]).toBe('1 van 4 wedstrijden') // m3 (opstelling zonder selectie) telt niet
  })

  it('AC-1.4 / W2: de noemer begint per speler bij zijn eerste voorkomen (Dirk vanaf m2, Eva vanaf m5) en een unknown-aanwezigheidsrij (backfill) schuift dat niet op (O6)', async () => {
    await renderInzichten(hoofdDb())
    expect(rijVoor(kaart(T.speel), 'Dirk Duif').cellen[0]).toBe('3 van 3 wedstrijden')
    expect(rijVoor(kaart(T.speel), 'Eva Ezel').cellen[0]).toBe('1 van 1 wedstrijden')
  })

  it('AC-1.4 / O1: een toekomstige wedstrijd met selectie (m7, na vandaag) telt niet mee (t/m gisteren)', async () => {
    await renderInzichten(hoofdDb())
    expect(rijVoor(kaart(T.speel), 'Anna Aap').cellen[0]).toBe('4 van 4 wedstrijden') // m7 zou 5 geven
  })

  it('O2: een inactieve speler (Cor) heeft een noemer die stopt bij zijn laatste voorkomen (m2): 2 van 2 — niet 2 van 4', async () => {
    await renderInzichten(hoofdDb())
    expect(rijVoor(kaart(T.speel), 'Cor Cobra').cellen).toEqual(['2 van 2 wedstrijden', '1 van 2 wedstrijden'])
  })

  it('O2 (actieve spelers): een actieve speler houdt de noemer tot het einde van het venster (Dirk: m4 en m5 blijven in de noemer)', async () => {
    await renderInzichten(hoofdDb())
    expect(rijVoor(kaart(T.speel), 'Dirk Duif').cellen[0]).toBe('3 van 3 wedstrijden')
  })

  it('O2 (active = null telt als actief): een speler zonder active-waarde wordt niet als vertrokken behandeld', async () => {
    const db = hoofdDb()
    db.players.find((p) => p.id === 'p-dirk')!.active = null
    await renderInzichten(db)
    expect(rijVoor(kaart(T.speel), 'Dirk Duif').cellen[0]).toBe('3 van 3 wedstrijden')
  })

  it('AC-1.5 / W4: de verdeling is een semantische tabel (datatabel) met een vergelijking per speler; geen rangnummers, geen oordeel-/drempellabels', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.speel)
    expect(k.querySelector('table')).not.toBeNull()
    expect([...k.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([i.kolomSpeler, i.kolomInSelectie, i.kolomInBasis])
    expect(k.querySelector('ol')).toBeNull()
    for (const r of tabelRijen(k)) expect(r.naam).not.toMatch(/^\d+[.)]?\s/)
    expect(norm(k.textContent)).not.toMatch(/\b(topper|beste|slechtste|reserve|vaste kracht|onder de norm|laag|hoog)\b/i)
  })

  it('AC-1.5: de uitleg onder de tabel noemt de noemerregel en dat basis = opgeslagen opstelling', async () => {
    await renderInzichten(hoofdDb())
    expect(kaart(T.speel)).toHaveTextContent(i.speelkansenUitleg)
  })

  it('AC-1.6: geen wedstrijd met selectie in de periode -> eigen lege staat (ook als er wel opstellingen zijn)', async () => {
    const db = hoofdDb({ vreemd: false })
    db.match_squad = []
    await renderInzichten(db)
    expect(kaart(T.speel)).toHaveTextContent(i.speelkansenEmpty)
  })

  it('AC-1.7 / W3: gast (Guus: 0 van 2 selectie, 1 van 2 basis) en inactieve speler doen mee', async () => {
    await renderInzichten(hoofdDb())
    expect(naamLijst(kaart(T.speel))).toEqual(expect.arrayContaining(['Guus Gast', 'Cor Cobra']))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 2. STIJGERS EN DALERS
// ═══════════════════════════════════════════════════════════════════════
describe('AC-2.x — stijgers en dalers in rating', () => {
  it('AC-2.1 / AC-2.3: stijgers en dalers staan gescheiden in twee lijsten met teken, recent- en seizoensgemiddelde en aantal; stijgers op grootte aflopend', async () => {
    await renderInzichten(ratingDb())
    const [stijgers, dalers] = lijstItems(kaart(T.stijg))
    expect(stijgers).toEqual([
      { naam: 'Ada Gelijk', waarde: '+0.5 · recent 7.0 · seizoen 6.5 (10 wedstrijden)' },
      { naam: 'Bea Gelijk', waarde: '+0.5 · recent 7.0 · seizoen 6.5 (10 wedstrijden)' },
      { naam: 'Rik Riser', waarde: '+0.5 · recent 7.0 · seizoen 6.5 (10 wedstrijden)' },
      { naam: 'Acht Acht', waarde: '+0.4 · recent 7.0 · seizoen 6.6 (8 wedstrijden)' },
      { naam: 'Drempel Drie', waarde: '+0.3 · recent 7.6 · seizoen 7.3 (10 wedstrijden)' },
    ])
    expect(dalers).toEqual([
      { naam: 'Dora Daalt', waarde: '−1.0 · recent 6.0 · seizoen 7.0 (10 wedstrijden)' },
      { naam: 'Daan Daler', waarde: '−0.5 · recent 7.0 · seizoen 7.5 (10 wedstrijden)' },
      { naam: 'Daal Drie', waarde: '−0.3 · recent 7.0 · seizoen 7.3 (10 wedstrijden)' },
    ])
    const kop = [...kaart(T.stijg).querySelectorAll('h3')].map((h) => h.textContent)
    expect(kop).toEqual([i.stijgersLabel, i.dalersLabel])
  })

  it('AC-2.1 / W5: de beschrijving noemt 5 beoordeelde wedstrijden, seizoensgemiddelde en minimaal 8 beoordelingen', async () => {
    await renderInzichten(ratingDb())
    expect(kaart(T.stijg)).toHaveTextContent(fmt(i.stijgersDescription, { n: 5, min: 8 }))
  })

  it('AC-2.2 / W5: precies 8 beoordelingen telt mee (Acht Acht); 7 beoordelingen (Zeven Zeven, groot verschil) niet', async () => {
    await renderInzichten(ratingDb())
    const alle = lijstItems(kaart(T.stijg)).flat().map((x) => x.naam)
    expect(alle).toContain('Acht Acht')
    expect(alle).not.toContain('Zeven Zeven')
  })

  it('AC-2.1 / W5: de drempel 0,3 is inclusief aan beide kanten (Drempel Drie: +0,3 en Daal Drie: -0,3 staan erin) en 0,2 niet (Net Onder); een stabiele speler (0,0) staat nergens', async () => {
    await renderInzichten(ratingDb())
    const alle = lijstItems(kaart(T.stijg)).flat().map((x) => x.naam)
    expect(alle).toContain('Drempel Drie')
    expect(alle).toContain('Daal Drie')
    expect(alle).not.toContain('Net Onder')
    expect(alle).not.toContain('Stan Stabiel')
  })

  it('AC-2.4: spelers zonder (voldoende) ratings ontbreken in de lijsten en komen niet als 0 voor', async () => {
    const db = ratingDb()
    db.players.push(sp('p-zonder', 'Zonder Rating'))
    await renderInzichten(db)
    expect(kaartTekst(T.stijg)).not.toContain('Zonder Rating')
    expect(kaart(T.stijg).textContent).not.toMatch(/NaN|0\.0 ·/)
  })

  it('AC-2.5: spelers met genoeg beoordelingen maar niemand boven de drempel -> lege staat "geen speler wijkt 0.3 of meer af"', async () => {
    n = 0
    const events = RDATA.map((d, ix) => ev(`r${ix + 1}`, d, { goals_for: 1, goals_against: 0 }))
    const db = leegDb({
      events,
      players: [sp('p-stan', 'Stan Stabiel')],
      match_ratings: events.map((e) => rat(e.id as string, 'p-stan', 7)),
    })
    await renderInzichten(db)
    expect(kaart(T.stijg)).toHaveTextContent(fmt(i.stijgersEmpty, { drempel: '0.3' }))
    expect(kaart(T.stijg).querySelector('ol')).toBeNull()
  })

  it('AC-2.5 / AC-2.4: niemand met minstens 8 beoordelingen -> andere lege staat "nog geen speler met 8 of meer beoordelingen"', async () => {
    await renderInzichten(hoofdDb())
    expect(kaart(T.stijg)).toHaveTextContent(fmt(i.stijgersTeWeinig, { min: 8 }))
    expect(kaart(T.stijg).querySelector('ol')).toBeNull()
  })

  it('AC-2.5: een kant zonder spelers (alleen stijgers) toont "Niemand in deze lijst" bij de lege kant', async () => {
    const db = ratingDb()
    db.match_ratings = db.match_ratings.filter((r) => !['p-daan', 'p-dora', 'p-dd'].includes(r.player_id as string))
    await renderInzichten(db)
    expect(lijstItems(kaart(T.stijg))).toHaveLength(1) // alleen de stijgers-<ol>; de dalerskant is leeg
    expect(kaart(T.stijg)).toHaveTextContent(i.stijgersNiemand)
  })

  it('AC-2.6: ratings blijven een trainersoordeel — de kaart trekt geen conclusie en geeft geen advies', async () => {
    await renderInzichten(ratingDb())
    expect(kaartTekst(T.stijg)).not.toMatch(/moet|zou|advies|aanbevel|conclusie|vormdip|vormcrisis|wissel/i)
  })

  it('AC-2.7: het verschil is recent (laatste 5 beoordeelde wedstrijden) min seizoensgemiddelde, hergebruik van RATING_TREND_VENSTER=5 (p_recent) — vaste seizoensgrens, niet de periode', async () => {
    const { h } = await renderInzichten(ratingDb(), { periode: '8w' })
    expect(callsVan(h, 'inzichten_rating_vorm_per_speler')[0].args).toEqual({
      p_team_id: TEAM, p_start: '2026-08-01', p_end: '2027-06-30', p_recent: 5,
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 3. POSITIEDEKKING
// ═══════════════════════════════════════════════════════════════════════
describe('AC-3.x — positiedekking', () => {
  const pos = (p: string) => nl.players.positions[p]
  const POSITIE_VOLGORDE = [
    'Keeper', 'Linksachter', 'Centrale verdediger', 'Rechtsachter', 'Defensieve middenvelder', 'Centrale middenvelder',
    'Linksmiddenvelder', 'Rechtsmiddenvelder', 'Aanvallende middenvelder', 'Linksbuiten', 'Rechtsbuiten', 'Spits',
  ]

  it('AC-3.1 / AC-3.4 / W6: altijd alle 12 posities in vaste volgorde, met aantal fitte spelers en de namen (secundaire met "(2e positie)")', async () => {
    await renderInzichten(positieDb())
    const k = kaart(T.dekking)
    const rijen = [...k.querySelectorAll('tbody tr')].map((tr) => ({
      positie: norm(tr.querySelector('th')!.textContent),
      fit: norm(tr.querySelectorAll('td')[0].textContent),
      spelers: norm(tr.querySelectorAll('td')[1].textContent),
    }))
    expect(rijen.map((r) => r.positie)).toEqual(POSITIE_VOLGORDE.map(pos))
    const per = Object.fromEntries(rijen.map((r) => [r.positie, r]))
    expect(per[pos('Keeper')]).toMatchObject({ fit: i.dekkingEen, spelers: 'Kees Keeper' })
    expect(per[pos('Linksachter')]).toMatchObject({ fit: '2 fitte spelers', spelers: 'Bob Back, Vera Verdediger (2e positie)' })
    expect(per[pos('Centrale verdediger')]).toMatchObject({ fit: '2 fitte spelers', spelers: 'Vera Verdediger, Mo Mid (2e positie)' })
    expect(per[pos('Rechtsachter')]).toMatchObject({ fit: i.dekkingEen, spelers: 'Nul Null' })
    expect(per[pos('Centrale middenvelder')]).toMatchObject({ fit: i.dekkingEen, spelers: 'Mo Mid' })
    expect(per[pos('Spits')]).toMatchObject({ fit: '2 fitte spelers', spelers: 'Sven Spits, Zoe Zijspits' })
  })

  it('AC-3.1: een speler met dezelfde positie primair én secundair telt één keer (Sven op Spits), als primair zonder "(2e positie)"', async () => {
    await renderInzichten(positieDb())
    const rij = rijVoor(kaart(T.dekking), pos('Spits'))
    expect(rij.cellen[1]).not.toContain('(2e positie)')
    expect(rij.cellen[1].match(/Sven Spits/g)).toHaveLength(1)
  })

  it('AC-3.1: een onbekende positiewaarde ("Onbekende positie") wordt genegeerd en geeft geen extra regel', async () => {
    await renderInzichten(positieDb())
    expect(kaart(T.dekking).querySelectorAll('tbody tr')).toHaveLength(12)
    expect(kaartTekst(T.dekking)).not.toContain('Onbekende')
  })

  it('AC-3.2 / W6: een geblesseerde speler (Joost: Centrale verdediger primair, Keeper secundair) telt nergens als fit; injured=null telt als fit', async () => {
    await renderInzichten(positieDb())
    const k = kaart(T.dekking)
    expect(kaartTekst(T.dekking)).not.toContain('Joost')
    expect(rijVoor(k, pos('Keeper')).cellen[1]).toBe('Kees Keeper')
    expect(rijVoor(k, pos('Rechtsachter')).cellen[1]).toBe('Nul Null')
  })

  it('AC-3.2 / W3 / W6: inactieve spelers en gasten tellen niet als fit', async () => {
    await renderInzichten(positieDb())
    expect(kaartTekst(T.dekking)).not.toContain('Cor Cobra')
    expect(kaartTekst(T.dekking)).not.toContain('Guus Gast')
  })

  it('AC-3.3 / W6: nul fitte spelers -> "geen fitte speler"; één -> "één fitte speler"; meer -> "n fitte spelers" — neutrale tekst, geen icoon, geen alarmstijl', async () => {
    await renderInzichten(positieDb())
    const k = kaart(T.dekking)
    expect(rijVoor(k, pos('Defensieve middenvelder')).cellen[0]).toBe('geen fitte speler')
    expect(rijVoor(k, pos('Linksmiddenvelder')).cellen[0]).toBe('geen fitte speler')
    expect(rijVoor(k, pos('Keeper')).cellen[0]).toBe('één fitte speler')
    expect(rijVoor(k, pos('Spits')).cellen[0]).toBe('2 fitte spelers')
    expect(k.querySelector('.ms, [role="alert"]')).toBeNull()
    const fitCellen = [...k.querySelectorAll('tbody tr td:first-of-type')]
    expect(new Set(fitCellen.map((td) => td.className)).size).toBe(1) // 0, 1 en meer hebben dezelfde stijl: geen "dun"-drempel
  })

  it('AC-3.4: per positie zijn de namen zichtbaar (kaart toont alle fitte spelers bij naam)', async () => {
    await renderInzichten(positieDb())
    for (const naam of ['Kees Keeper', 'Vera Verdediger', 'Bob Back', 'Mo Mid', 'Nul Null', 'Sven Spits', 'Zoe Zijspits']) {
      expect(kaartTekst(T.dekking)).toContain(naam)
    }
  })

  it('AC-3.5 / W6: momentopname van nu — de kaart is identiek bij 4w en seizoen en de beschrijving zegt "stand van vandaag, los van de gekozen periode"', async () => {
    const a = await renderInzichten(positieDb())
    const seizoen = kaartTekst(T.dekking)
    a.unmount()
    const b = await renderInzichten(positieDb(), { periode: '4w' })
    expect(kaartTekst(T.dekking)).toBe(seizoen)
    expect(kaart(T.dekking)).toHaveTextContent(i.dekkingDescription)
    expect(b.h.rpcCalls.some((c) => c.name.includes('positie'))).toBe(false)
  })

  it('AC-3.6 / W6: keeper alleen via de keeperpositie — geen fallbacks: Rechtsachter/Linksachter/Centrale verdediger-spelers staan niet onder Keeper en een verdediger dekt geen "Rechtsachter" via POSITION_FALLBACKS', async () => {
    await renderInzichten(positieDb())
    const k = kaart(T.dekking)
    expect(rijVoor(k, pos('Keeper')).cellen[1]).toBe('Kees Keeper')
    // Vera (CV) en Bob (LA) zouden via POSITION_FALLBACKS ook Rechtsachter dekken; Rechtsachter heeft alleen Nul
    expect(rijVoor(k, pos('Rechtsachter')).cellen[1]).toBe('Nul Null')
    // Mo (CM) zou via fallbacks onder Defensieve/Aanvallende middenvelder vallen
    expect(rijVoor(k, pos('Defensieve middenvelder')).cellen[0]).toBe('geen fitte speler')
    expect(rijVoor(k, pos('Aanvallende middenvelder')).cellen[0]).toBe('geen fitte speler')
  })

  it('AC-3.6: zonder fitte keeper staat er "geen fitte speler" voor Keeper — ook als een veldspeler hem zou kunnen vervangen', async () => {
    const db = positieDb()
    db.players = db.players.filter((p) => p.id !== 'p-kees')
    await renderInzichten(db)
    expect(rijVoor(kaart(T.dekking), pos('Keeper')).cellen).toEqual([i.dekkingGeen, ''])
  })

  it('AC-3.7: team zonder actieve vaste spelers -> lege staat, geen tabel van 12 lege posities', async () => {
    const db = positieDb()
    db.players = db.players.filter((p) => p.team_id !== TEAM)
    await renderInzichten(db)
    expect(kaart(T.dekking)).toHaveTextContent(i.dekkingEmpty)
    expect(kaart(T.dekking).querySelector('table')).toBeNull()
  })

  it('AC-3.7: alleen geblesseerde spelers = wél spelers -> geen lege staat maar 12 posities met "geen fitte speler" (geen verwarring met "geen spelers")', async () => {
    const db = positieDb()
    db.players = db.players.filter((p) => p.team_id !== TEAM)
    db.players.push(sp('p-zieke', 'Ziek Zwak', { position: 'Keeper', injured: true }))
    await renderInzichten(db)
    expect(kaart(T.dekking)).not.toHaveTextContent(i.dekkingEmpty)
    expect(rijVoor(kaart(T.dekking), pos('Keeper')).cellen[0]).toBe(i.dekkingGeen)
  })

  it('AC-A2 (positiedekking): spelers van team-2 staan niet in de kaart', async () => {
    await renderInzichten(positieDb())
    expect(kaartTekst(T.dekking)).not.toContain('Xander')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 4. OPKOMST NAAST SELECTIE EN RATING
// ═══════════════════════════════════════════════════════════════════════
describe('AC-4.x — opkomst, selectie en rating naast elkaar', () => {
  it('AC-4.1 / W7: één tabel met per speler trainingsopkomst, selectie en rating naast elkaar, elk met zijn noemer (handgetelde waarden)', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.naast)
    expect([...k.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      i.kolomSpeler, i.kolomTrainingsopkomst, i.kolomInSelectie, i.ratingLabel,
    ])
    const verwacht: Record<string, string[]> = {
      'Anna Aap': ['75% (3 van 4 trainingen)', '4 van 4 wedstrijden', '7.0 (4 wedstrijden)'],
      'Bram Beer': ['67% (2 van 3 trainingen)', '3 van 4 wedstrijden', '6.0 (1 wedstrijden)'],
      'Cor Cobra': ['50% (1 van 2 trainingen)', '2 van 2 wedstrijden', i.geenGegevens],
      'Dirk Duif': ['100% (2 van 2 trainingen)', '3 van 3 wedstrijden', i.geenGegevens],
      'Eva Ezel': ['0% (0 van 2 trainingen)', '1 van 1 wedstrijden', i.geenGegevens],
      'Guus Gast': ['1 keer aanwezig', '0 van 2 wedstrijden', i.geenGegevens],
    }
    for (const [naam, cellen] of Object.entries(verwacht)) expect(rijVoor(k, naam).cellen, naam).toEqual(cellen)
    expect(tabelRijen(k)).toHaveLength(6)
  })

  it('AC-4.1 / W7: wedstrijden tellen niet mee in de opkomst (Anna was bij wedstrijden 2x aanwezig en 2x afwezig: de opkomst blijft 3 van 4 trainingen); een unknown-training telt niet (Dirk)', async () => {
    await renderInzichten(hoofdDb())
    expect(rijVoor(kaart(T.naast), 'Anna Aap').cellen[0]).toBe('75% (3 van 4 trainingen)')
    expect(rijVoor(kaart(T.naast), 'Dirk Duif').cellen[0]).toBe('100% (2 van 2 trainingen)')
  })

  it('AC-4.1 / W7: een geblesseerde training telt als afwezig (Bram: injured + 2x aanwezig = 2 van 3); toekomstige trainingen tellen niet (tF)', async () => {
    await renderInzichten(hoofdDb())
    expect(rijVoor(kaart(T.naast), 'Bram Beer').cellen[0]).toBe('67% (2 van 3 trainingen)')
  })

  it('AC-4.2 / W4: geen samenvattend label, geen correlatie of "reden" — alleen vier kolommen cijfers en de beschrijving zegt "zonder verband te leggen"', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.naast)
    expect(k.querySelectorAll('thead th')).toHaveLength(4)
    expect(k).toHaveTextContent('zonder verband te leggen')
    expect(norm(k.textContent)).not.toMatch(/correlatie|daardoor|omdat|oorzaak|reden|samenhang|conclusie/i)
  })

  it('AC-4.3: ontbrekende waarden zijn "geen gegevens", niet 0 (rating van Cor/Dirk/Eva/Guus)', async () => {
    await renderInzichten(hoofdDb())
    for (const naam of ['Cor Cobra', 'Dirk Duif', 'Eva Ezel', 'Guus Gast']) expect(rijVoor(kaart(T.naast), naam).cellen[2]).toBe(i.geenGegevens)
  })

  it('AC-4.3: een speler met alleen een niet-meetbare kolom (Lenny: noemer 0) of niets (Gert: 0x aanwezig) krijgt geen lege regel', async () => {
    await renderInzichten(hoofdDb())
    expect(naamLijst(kaart(T.naast))).not.toContain('Lenny Laat')
    expect(naamLijst(kaart(T.naast))).not.toContain('Gert Gast')
  })

  it('AC-4.3: een speler met alleen unknown-aanwezigheid (0 van 0, Uli) krijgt geen "0%" en staat niet in de tabel (geen gegevens, niet 0)', async () => {
    await renderInzichten(hoofdDb())
    expect(naamLijst(kaart(T.naast))).not.toContain('Uli Unknown')
    expect(kaart(T.naast).textContent).not.toContain('0 van 0')
  })

  it('AC-4.4: selectie volgens speelkansen (gelijke x van y), rating volgens het venster (bestaande ratingkaart: alleen actieve vaste spelers)', async () => {
    await renderInzichten(hoofdDb())
    for (const naam of ['Anna Aap', 'Bram Beer', 'Cor Cobra', 'Dirk Duif', 'Eva Ezel']) {
      expect(rijVoor(kaart(T.naast), naam).cellen[1], naam).toBe(rijVoor(kaart(T.speel), naam).cellen[0])
    }
  })

  it('AC-4.4: een team-2-rating op een eigen speler (anna, rating 1) vertekent het ratinggemiddelde niet', async () => {
    await renderInzichten(hoofdDb())
    expect(rijVoor(kaart(T.naast), 'Anna Aap').cellen[2]).toBe('7.0 (4 wedstrijden)')
  })

  it('AC-4.5 / W3: gasten en inactieven doen mee (Guus met label, Cor zonder)', async () => {
    await renderInzichten(hoofdDb())
    expect(rijVoor(kaart(T.naast), 'Guus Gast').gast).toBe(true)
    expect(rijVoor(kaart(T.naast), 'Cor Cobra').gast).toBe(false)
  })

  it('O3: een gast toont alleen "1 keer aanwezig" — zonder noemer en zonder percentage ("1 van 30" en "%" komen niet voor)', async () => {
    n = 0
    const events: Row[] = []
    const rows: Row[] = []
    for (let d = 1; d <= 30; d++) {
      const id = `tg${d}`
      events.push(trn(id, `2026-08-${String(d).padStart(2, '0')}`))
      rows.push(att(id, 'p-gast', d === 17 ? 'present' : 'absent'))
    }
    const db = leegDb({ events, players: [sp('p-gast', 'Gijs Gast', { type: 'guest' })], attendance: rows })
    await renderInzichten(db)
    const r = rijVoor(kaart(T.naast), 'Gijs Gast')
    expect(r.cellen[0]).toBe('1 keer aanwezig')
    expect(r.cellen[0]).not.toMatch(/1 van 30|%|trainingen/)
    expect(r.gast).toBe(true)
  })

  it('O3: een gast die nooit aanwezig was (0 keer) krijgt geen opkomstregel — "0 keer aanwezig" zegt niets omdat afwezig de standaard is', async () => {
    await renderInzichten(hoofdDb())
    expect(naamLijst(kaart(T.naast))).not.toContain('Gert Gast')
  })

  it('O3: een gast heeft op de hele pagina nergens een opkomstpercentage', async () => {
    await renderInzichten(hoofdDb())
    expect(rijVoor(kaart(T.naast), 'Guus Gast').cellen[0]).not.toContain('%')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 5. BLESSURES PER MAAND
// ═══════════════════════════════════════════════════════════════════════
describe('AC-5.x — blessurelast per maand', () => {
  it('AC-5.1 / W7: per kalendermaand het aantal verschillende geblesseerde spelers (aug 0, sep 3, okt 0), maanden volgen de periode (geklemd tot gisteren)', async () => {
    await renderInzichten(hoofdDb())
    const rijen = dataTabel(kaart(T.bless))
    expect(rijen).toEqual([
      [maandLabel('2026-08', nl.browserLocale), '0'],
      [maandLabel('2026-09', nl.browserLocale), '3'],
      [maandLabel('2026-10', nl.browserLocale), '0'],
    ])
    expect([...kaart(T.bless).querySelectorAll('table.sr-only th')].map((th) => th.textContent)).toEqual([i.monthLabel, i.kolomGeblesseerd])
  })

  it('AC-5.1: dezelfde speler twee keer geblesseerd in één maand telt als 1 (Bram: training 10 sept én wedstrijd 19 sept)', async () => {
    await renderInzichten(hoofdDb({ vreemd: false }))
    // sep = bram (2 registraties), cor, dirk = 3 verschillende spelers (niet 4 registraties)
    expect(dataTabel(kaart(T.bless))[1][1]).toBe('3')
  })

  it('AC-5.2: geblesseerd staat apart van afwezig — "absent" telt niet mee (Anna was in sept 2x afwezig en 1x absent op een wedstrijd, maar nooit geblesseerd)', async () => {
    await renderInzichten(hoofdDb())
    expect(dataTabel(kaart(T.bless))[1][1]).toBe('3') // bram, cor, dirk; anna (alleen absent) telt niet
  })

  it('AC-5.2: een enkele absent-registratie in een maand geeft 0, geen 1', async () => {
    n = 0
    const db = leegDb({ events: [trn('t1', '2026-09-10')], players: [sp('p-a', 'Anna Aap')], attendance: [att('t1', 'p-a', 'absent')] })
    await renderInzichten(db)
    expect(dataTabel(kaart(T.bless)).find((r) => r[0] === maandLabel('2026-09', nl.browserLocale))![1]).toBe('0')
  })

  it('AC-5.3: een toekomstige gebeurtenis die al "injured" staat (Eva op m7, 20 okt) telt niet; de maanden lopen niet door na gisteren', async () => {
    await renderInzichten(hoofdDb())
    const rijen = dataTabel(kaart(T.bless))
    expect(rijen).toHaveLength(3)
    expect(rijen[2]).toEqual([maandLabel('2026-10', nl.browserLocale), '0'])
  })

  it('AC-5.4: een maand zonder enige training of wedstrijd toont "geen gegevens" (en "—" in de samenvatting); een maand mét gebeurtenissen en zonder blessures toont 0', async () => {
    n = 0
    const db = leegDb({
      events: [trn('t-aug', '2026-08-20'), ev('m-okt', '2026-10-03')],
      players: [sp('p-a', 'Anna Aap')],
      attendance: [att('t-aug', 'p-a', 'present')],
    })
    await renderInzichten(db)
    const k = kaart(T.bless)
    expect(dataTabel(k)).toEqual([
      [maandLabel('2026-08', nl.browserLocale), '0'],
      [maandLabel('2026-09', nl.browserLocale), i.geenGegevens],
      [maandLabel('2026-10', nl.browserLocale), '0'],
    ])
    const label = (k.querySelector('[role="img"]') as HTMLElement).getAttribute('aria-label')!
    expect(label).toContain(`${maandLabel('2026-09', nl.browserLocale)}: —`)
    expect(label).toContain(`${maandLabel('2026-08', nl.browserLocale)}: 0`)
  })

  it('AC-5.4: geen enkele gebeurtenis in het venster -> eigen lege staat (geen rij met nullen)', async () => {
    const db = leegDb({ events: [ev('f1', '2026-10-20', { goals_for: 1, goals_against: 0 })] })
    await renderInzichten(db)
    expect(kaart(T.bless)).toHaveTextContent(i.blessuresEmpty)
    expect(kaart(T.bless).querySelector('table.sr-only')).toBeNull()
  })

  it('AC-5.5: de maand komt uit de kalenderdatum — 31 aug, 30 sept en 1 okt landen in de juiste maand, ongeacht tijdzone', async () => {
    n = 0
    const db = leegDb({
      events: [trn('a', '2026-08-31'), trn('b', '2026-09-30'), trn('c', '2026-10-01')],
      players: [sp('p-a', 'Anna Aap'), sp('p-b', 'Bram Beer'), sp('p-c', 'Cor Cobra')],
      attendance: [att('a', 'p-a', 'injured'), att('b', 'p-b', 'injured'), att('c', 'p-c', 'injured')],
    })
    await renderInzichten(db)
    expect(dataTabel(kaart(T.bless))).toEqual([
      [maandLabel('2026-08', nl.browserLocale), '1'],
      [maandLabel('2026-09', nl.browserLocale), '1'],
      [maandLabel('2026-10', nl.browserLocale), '1'],
    ])
  })

  it('AC-5.6: de kaart toont alleen aantallen — geen duur in dagen, hersteltermijn of prognose', async () => {
    await renderInzichten(hoofdDb())
    expect(kaartTekst(T.bless)).not.toMatch(/dagen|herstel|prognose|duur|weken|terug/i)
  })

  it('AC-5.8 / W7: het maandbereik volgt de gekozen periode — 4w midden in een maand geeft een gedeeltelijke septembermaand (alleen vanaf 18 sept: Bram m3, Dirk m4 = 2) en geen augustus', async () => {
    await renderInzichten(hoofdDb(), { periode: '4w' })
    expect(dataTabel(kaart(T.bless))).toEqual([
      [maandLabel('2026-09', nl.browserLocale), '2'],
      [maandLabel('2026-10', nl.browserLocale), '0'],
    ])
  })

  it('AC-5.7 / W7: "beschikbaarheid van de selectie" is weggelaten — de kaart toont alleen blessurelast', async () => {
    await renderInzichten(hoofdDb())
    expect(kaartTekst(T.bless)).not.toMatch(/beschikbaar/i)
    expect(kaart(T.bless)).toHaveTextContent(i.blessuresDescription)
  })

  it('AC-A2 (blessures): vreemde blessure-registraties (team_id team-2 op eigen training, vreemde speler met eigen team_id) tellen niet mee', async () => {
    const schoon = await renderInzichten(hoofdDb({ vreemd: false }))
    const a = dataTabel(kaart(T.bless))
    schoon.unmount()
    await renderInzichten(hoofdDb({ vreemd: true }))
    expect(dataTabel(kaart(T.bless))).toEqual(a)
  })
})
