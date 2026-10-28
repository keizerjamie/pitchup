// Acceptatietests — fase 3a "inzichten-metrics": training en kwaliteit (ALLEEN LEZEN).
// Drie nieuwe kaarten op /inzichten: trainingsbelasting in minuten per week,
// periodisering-voortgang per onderdeel en invul-discipline.
//
// Methode (van buitenaf, geen unit-tests):
//   * Rendert de ECHTE app/inzichten/page.tsx (async server component) met RTL.
//     Alleen @/lib/supabase/server, next/navigation en next/headers zijn gestubd.
//   * De twee nieuwe RPC's (inzichten_training_koppelingen en
//     inzichten_invul_discipline) worden beantwoord door handlers die de SQL uit
//     supabase/inzichten-metrics-fase3a.sql nabootsen op in-memory rijen, met het
//     p_team_id-ARGUMENT van de pagina en een team_id-filter op e, k, r, me en tov.
//     De BEWUSTE uitzondering: de oefening wordt NIET op team gefilterd
//     (oefeningen.team_id is de eigenaar-user); een oefening zonder leesrecht geeft
//     oefening_leesbaar = false.
//   * Alle verwachte getallen zijn met de hand afgeleid uit de fixtures (zie de
//     toelichting bij elke fixture), niet uit de uitvoer van de code overgenomen.
//   * Pariteit: de kaarten worden vergeleken met de ECHTE planner-/periodiserings-
//     functies (berekenTijdlijn, blokkenVanKoppelingen, getTrainingLog,
//     actueleMetingen) die hier rechtstreeks worden aangeroepen.
//
// BEPERKING (eerlijk): vitest kan RLS en de SQL zelf niet bewijzen. De handlers
// bootsen de SQL alleen na; de koppeling tussen handler en SQL-tekst staat in
// "SQL-koppeling" onderaan. RLS en het echte SQL-gedrag zijn bewezen door blok 29
// van supabase/team-rls-verificatie.sql (op de echte database gedraaid, zie
// fase3/05-migratie-en-verificatie.md).
//
// Besluiten die hier gelden: Q1-Q6 (story §6) en O1-O5 (brief §8).
//
// ── AC → test-mapping: elke testnaam begint met zijn criterium (bv. "AC-B.2") ──

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, configure, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { es } from '@/messages/es'
import { fr } from '@/messages/fr'
import type { Dict } from '@/messages/nl'

const state = vi.hoisted(() => ({
  locale: 'nl',
}))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`__redirect__:${to}`)
  },
  notFound: () => {
    throw new Error('__notFound__')
  },
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
    prefetch: () => {},
    refresh: () => {},
  }),
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
import { getTrainingLog, actueleMetingen } from '@/lib/periodization'
import { berekenTijdlijn } from '@/lib/sessie-tijdlijn'
import { blokkenVanKoppelingen } from '@/lib/parallel-groep'
import type { CategorieMeting } from '@/lib/types'

// ═══════════════════════════════════════════════════════════════════════
// Gedeelde in-memory database + Supabase-client
// ═══════════════════════════════════════════════════════════════════════
type Row = Record<string, unknown>
type Db = Record<string, Row[]>

interface Harness {
  db: Db
  rpcCalls: { name: string; args: Row }[]
  writes: { table: string; op: string; payload: Row }[]
  rpcErrors: Record<string, unknown>
  selectErrors: Record<string, unknown>
  handlers: Record<string, (db: Db, args: Row) => Row[]>
  userId: string
}

function makeClient(h: Harness) {
  function from(table: string) {
    let op = 'select'
    let payload: Row = {}
    let selectStr = ''
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean }[] = []
    let limitN: number | null = null

    // PostgREST-join `oefeningen(categorie)` op training_oefeningen: de oefening
    // wordt alleen meegegeven als ze leesbaar is (RLS). Een oefening van een
    // teamgenoot (andere eigenaar) is leesbaar; géén team_id-filter op oefeningen.
    function embed(r: Row): Row {
      if (table === 'training_oefeningen' && selectStr.includes('oefeningen(')) {
        const o = h.db.oefeningen.find((x) => x.id === r.oefening_id && x.leesbaar !== false)
        return { ...r, oefeningen: o ? { categorie: o.categorie, duur_min: o.duur_min } : null }
      }
      return { ...r }
    }

    async function execute(): Promise<{ data: Row[] | null; error: unknown }> {
      const rows = h.db[table]
      if (!rows) throw new Error(`Onverwachte tabel in test: "${table}"`)
      if (op !== 'select') {
        // Fase 3a schrijft niets: elke schrijfpoging wordt vastgelegd en NIET uitgevoerd.
        h.writes.push({ table, op, payload: { ...payload } })
        return { data: null, error: null }
      }
      if (h.selectErrors[table]) return { data: null, error: h.selectErrors[table] }
      let out = rows.filter((r) => filters.every((f) => f(r)))
      if (orders.length > 0) {
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const av = a[o.col] as string | number | null | undefined
            const bv = b[o.col] as string | number | null | undefined
            if ((av === null || av === undefined) && (bv === null || bv === undefined)) continue
            if (av === null || av === undefined) return 1
            if (bv === null || bv === undefined) return -1
            if (av < bv) return o.ascending ? -1 : 1
            if (av > bv) return o.ascending ? 1 : -1
          }
          return 0
        })
      }
      if (limitN !== null) out = out.slice(0, limitN)
      return { data: out.map(embed), error: null }
    }

    const chain: Record<string, unknown> = {
      select: (s?: string) => {
        selectStr = s ?? ''
        return chain
      },
      insert: (p: Row) => ((op = 'insert'), (payload = p), chain),
      upsert: (p: Row) => ((op = 'upsert'), (payload = p), chain),
      update: (p: Row) => ((op = 'update'), (payload = p), chain),
      delete: () => ((op = 'delete'), chain),
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
      order: (c: string, o: { ascending?: boolean } = {}) => {
        orders.push({ col: c, ascending: o.ascending ?? true })
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
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    rpc: (name: string, args: Row) => {
      h.rpcCalls.push({ name, args })
      if (h.rpcErrors[name]) return Promise.resolve({ data: null, error: h.rpcErrors[name] })
      const handler = h.handlers[name]
      if (!handler) throw new Error(`Onbekende RPC in test: "${name}"`)
      return Promise.resolve({ data: handler(h.db, args), error: null })
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════
// De twee nieuwe RPC's, nagebootst uit supabase/inzichten-metrics-fase3a.sql
// ═══════════════════════════════════════════════════════════════════════
const inRange = (d: string, s: string, e: string) => d >= s && d <= e
const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
const SQL_LIMIT = 901 // limit 901 in beide functies

// RPC 1: `from events e left join training_oefeningen k on k.event_id = e.id and
// k.team_id = p_team_id left join oefeningen oef on oef.id = k.oefening_id` —
// de oefening wordt BEWUST niet op team gefilterd; leesbaar = (oef.id is not null).
function hKoppelingen(db: Db, args: Row): Row[] {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const evs = db.events
    .filter((e) => e.team_id === p_team_id && e.type === 'training' && inRange(e.date as string, p_start, p_end))
    .sort((a, b) => cmp(a.date, b.date) || cmp(a.id, b.id))
  const rijen: Row[] = []
  for (const e of evs) {
    const ks = db.training_oefeningen
      .filter((k) => k.event_id === e.id && k.team_id === p_team_id)
      .sort((a, b) => (a.volgorde as number) - (b.volgorde as number) || cmp(a.created_at, b.created_at) || cmp(a.id, b.id))
    if (ks.length === 0) {
      rijen.push({
        event_id: e.id, datum: e.date, trainingstype: e.trainingstype,
        koppeling_id: null, volgorde: null, aangemaakt: null, parallel_groep_id: null,
        koppeling_duur_min: null, oefening_duur_min: null, categorie: null, stap_override: null,
        oefening_leesbaar: false,
      })
      continue
    }
    for (const k of ks) {
      const oef = db.oefeningen.find((x) => x.id === k.oefening_id && x.leesbaar !== false)
      rijen.push({
        event_id: e.id, datum: e.date, trainingstype: e.trainingstype,
        koppeling_id: k.id, volgorde: k.volgorde, aangemaakt: k.created_at,
        parallel_groep_id: k.parallel_groep_id ?? null,
        koppeling_duur_min: k.duur_min ?? null,
        oefening_duur_min: oef ? (oef.duur_min ?? null) : null,
        categorie: oef ? (oef.categorie ?? null) : null,
        stap_override: k.stap_override ?? null,
        oefening_leesbaar: !!oef,
      })
    }
  }
  return rijen.slice(0, SQL_LIMIT).map((r) => ({ ...r, totaal: rijen.length }))
}

// RPC 2: één rij per wedstrijd/training in bereik met ruwe tellingen; r, me, k en
// tov elk met team_id = p_team_id; handmatig = override van het BIJBEHORENDE type.
function hDiscipline(db: Db, args: Row): Row[] {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const rijen = db.events
    .filter((e) => e.team_id === p_team_id && (e.type === 'match' || e.type === 'training') && inRange(e.date as string, p_start, p_end))
    .sort((a, b) => cmp(a.date, b.date) || cmp(a.id, b.id))
    .map((e) => ({
      event_id: e.id,
      soort: e.type,
      datum: e.date,
      goals_for: e.goals_for ?? null,
      goals_against: e.goals_against ?? null,
      doelstelling: e.type === 'training' ? (e.doelstelling ?? null) : null,
      aantal_ratings: db.match_ratings.filter((r) => r.event_id === e.id && r.team_id === p_team_id).length,
      aantal_momenten: db.match_events.filter((me) => me.event_id === e.id && me.team_id === p_team_id).length,
      aantal_oefeningen: db.training_oefeningen.filter((k) => k.event_id === e.id && k.team_id === p_team_id).length,
      handmatig: db.task_overrides.some(
        (tov) => tov.event_id === e.id && tov.team_id === p_team_id && tov.task_type === (e.type === 'match' ? 'analysis' : 'training_plan'),
      ),
    }))
  return rijen.slice(0, SQL_LIMIT).map((r) => ({ ...r, totaal: rijen.length }))
}

// Bronnen van de oudere kaarten. MET_DATA geeft rating-data zodat de pagina nooit
// de lege-pagina-staat toont; LEEG geeft niets.
const MET_DATA: Harness['handlers'] = {
  inzichten_aanwezigheid: () => [{ aanwezig: 8, afwezig: 2 }],
  inzichten_training_opkomst_per_maand: () => [],
  inzichten_rating_team_per_wedstrijd: () => [
    { event_id: 'r1', datum: '2026-09-05', tegenstander: 'Ajax', gemiddelde: 7.5, aantal: 3 },
    { event_id: 'r2', datum: '2026-09-12', tegenstander: 'PSV', gemiddelde: 6.5, aantal: 3 },
  ],
  inzichten_rating_speler: () => [],
  inzichten_rating_per_speler: () => [{ player_id: 'x', naam: 'Ratingspeler', gemiddelde: 7.2, aantal: 3 }],
  inzichten_aanwezigheid_per_speler: () => [],
  inzichten_speelkansen: () => [],
  inzichten_rating_vorm_per_speler: () => [
    { player_id: 'x', naam: 'Ratingspeler', aantal: 4, seizoen_gemiddelde: 6.5, recent_gemiddelde: 7.5 },
  ],
  inzichten_training_opkomst_per_speler: () => [],
  inzichten_blessures_per_maand: () => [],
  inzichten_wedstrijd_uitslagen: () => [],
  inzichten_speler_momenten: () => [],
  inzichten_doelpunten_per_minuut: () => [],
  inzichten_tegendoelpunten: () => [],
  inzichten_speelminuten_per_speler: () => [],
  inzichten_training_koppelingen: hKoppelingen,
  inzichten_invul_discipline: hDiscipline,
}
const LEEG: Harness['handlers'] = {
  ...MET_DATA,
  inzichten_aanwezigheid: () => [{ aanwezig: 0, afwezig: 0 }],
  inzichten_rating_team_per_wedstrijd: () => [],
  inzichten_rating_per_speler: () => [],
  inzichten_rating_vorm_per_speler: () => [],
}

function setup(db: Db, over: Partial<Harness> = {}): Harness {
  const h: Harness = {
    db,
    rpcCalls: [],
    writes: [],
    rpcErrors: {},
    selectErrors: {},
    handlers: MET_DATA,
    userId: 'team-1',
    ...over,
  }
  vi.mocked(createClient).mockResolvedValue(makeClient(h) as unknown as Awaited<ReturnType<typeof createClient>>)
  return h
}

const TEAM = 'team-1'
const OTHER = 'team-2'
const owner = (team = TEAM) => ({ team_id: team, user_id: team, rol: 'owner' })
const U = (k: string, n: number) => `${k}000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function fmt(tpl: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), tpl)
}

// ─── Klok en tijdzone ───
const TODAY = '2026-10-15' // donderdag; gisteren = 2026-10-14
function zetKlok(datum: string, uur = 10, min = 0) {
  const [y, m, d] = datum.split('-').map(Number)
  if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(y, m - 1, d, uur, min, 0))
}
const ORIGINELE_TZ = process.env.TZ

const dicts: Record<string, Dict> = { nl, en, de, es, fr }
const STANDAARD_IGNORE = 'script, style'
const NEGEER_PRINTBLOK = `${STANDAARD_IGNORE}, [data-print-only], [data-print-only] *`

let consoleError: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  state.locale = 'nl'
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  zetKlok(TODAY)
})
afterEach(() => {
  cleanup()
  consoleError.mockRestore()
  configure({ defaultIgnore: STANDAARD_IGNORE })
  vi.useRealTimers()
  if (ORIGINELE_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINELE_TZ
})

const i = nl.insights
const G = i.geenGegevens

// ═══════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════
function leegDb(over: Partial<Db> = {}, seizoen: [string, string] = ['2026-08-01', '2027-06-30']): Db {
  return {
    team_members: [owner()],
    settings: [
      { team_id: TEAM, key: 'season_start', value: seizoen[0] },
      { team_id: TEAM, key: 'season_end', value: seizoen[1] },
    ],
    events: [], players: [], match_events: [], lineups: [], tegendoelpunten: [], match_squad: [], speelminuten: [],
    attendance: [], match_ratings: [], training_oefeningen: [], categorie_metingen: [], task_overrides: [], oefeningen: [],
    ...over,
  }
}

let kN = 0
let mN = 0
let evN = 0
const tr = (id: string, date: string, o: Row = {}): Row => ({
  id, team_id: TEAM, type: 'training', date, opponent: null, trainingstype: 'vct', doelstelling: null,
  goals_for: null, goals_against: null, created_at: '2026-01-01T10:00:00Z', ...o,
})
const wed = (id: string, date: string, o: Row = {}): Row => ({
  id, team_id: TEAM, type: 'match', date, opponent: 'Tegenstander', match_type: 'league', home_away: 'home',
  goals_for: null, goals_against: null, trainingstype: 'vct', doelstelling: null, created_at: '2026-01-01T10:00:00Z', ...o,
})
const oef = (id: string, categorie: string, duur: number | null, o: Row = {}): Row => ({
  id, team_id: TEAM, categorie, duur_min: duur, ...o,
})
const kp = (event: string, oefId: string, o: Row = {}): Row => {
  const n = ++kN
  return {
    id: U('4b', n), team_id: TEAM, event_id: event, oefening_id: oefId, volgorde: n,
    created_at: new Date(Date.UTC(2026, 0, 1, 10, 0, n)).toISOString(), parallel_groep_id: null, duur_min: null,
    stap_override: null, ...o,
  }
}
const mt = (categorie: string, datum: string, stap: number, team = TEAM): Row => ({
  id: U('c7', ++mN), team_id: team, categorie, datum, stap, notes: null, created_at: '2026-01-01T10:00:00Z',
})
const rating = (event: string, team = TEAM): Row => ({ id: U('d1', ++kN), team_id: team, event_id: event, player_id: 'p', rating: 7 })
const moment = (event: string, team = TEAM): Row => ({ id: U('d2', ++kN), team_id: team, event_id: event, kind: 'goal' })
const ovr = (event: string, taskType: string, team = TEAM): Row => ({ id: U('d3', ++kN), team_id: team, event_id: event, task_type: taskType })

// De volgorde waarin de tien categorieën als kolommen staan (story B.8 / brief §4.1).
const CATS = [
  'warming_up', 'partijen_groot', 'partijen_midden', 'partijen_klein', 'positiespel', 'pass_trap',
  'sprints_weinig_rust', 'sprints_veel_rust', 'steigerungs', 'overig',
]
const cellen = (m: Record<string, number>, totaal: string): string[] => [...CATS.map((c) => String(m[c] ?? 0)), totaal]
const GEEN_WEEK = Array(11).fill(G)

// Bibliotheek. Eigen oefeningen hebben team_id = TEAM (= de eigenaar-user in deze
// test); de oefening van een teamgenoot een ANDERE eigenaar; "hid" is voor de
// aanroeper niet leesbaar (join levert niets).
const O = {
  pg: U('0f', 1), wu: U('0f', 2), sw: U('0f', 3), pm: U('0f', 4), pk: U('0f', 5), ov: U('0f', 6),
  mate: U('0f', 7), hid: U('0f', 8), sv: U('0f', 9),
}
function bibliotheek(): Row[] {
  return [
    oef(O.pg, 'partijen_groot', 25), oef(O.wu, 'warming_up', 10), oef(O.sw, 'sprints_weinig_rust', 12),
    oef(O.pm, 'partijen_midden', 40), oef(O.pk, 'partijen_klein', 40), oef(O.ov, 'overig', 10),
    oef(O.mate, 'pass_trap', 18, { team_id: 'mate-user' }),
    oef(O.hid, 'positiespel', 40, { leesbaar: false }),
    oef(O.sv, 'sprints_veel_rust', 20),
  ]
}

// ── Fixture BELASTING (donderdag 2026-10-15; venster = seizoen t/m gisteren 2026-10-14) ──
// ISO-weken: wk 40 = ma 28 sep, wk 41 = ma 5 okt, wk 42 = ma 12 okt (deelweek: eindigt na gisteren);
// wk 31 = ma 27 jul (deelweek: begint vóór de seizoensstart 1 aug).
//  th  vr 02-10  mate-oefening (andere eigenaar), koppelingsduur NULL -> bibliotheek 18
//  tg  za 03-10  oefening zonder leesrecht, koppelingsduur 35
//  ta  di 06-10  pg(NULL -> bib 25) + wu(eigen 15, bib 10) + sw(eigen 0, bib 12)
//  tb  zo 11-10  parallelle groep pm(20)+pk(30) + genest kind ov(10)
//  tc  ma 12-10  TEAMTACTISCH, pg koppelingsduur 20
//  td  wo 14-10  geen koppelingen (gisteren)
//  te  do 15-10  VANDAAG, pg 99     tf  di 20-10 TOEKOMST, pg 88
// Verwacht (met de hand):
//  wk40: pass_trap 18; totaal 18 + 35 = 53
//  wk41: wu 15, pg 25, pm 20, pk 30, sw 0, ov 10; totaal ta(25+15 = 40, 1 blok zonder duur) + tb(max(20,30) + 10 = 40) = 80 *
//  wk42: pg 20; totaal 20 (tc). td telt als training zonder oefeningen.
const GRP = U('9a', 1)
const T = {
  ta: U('e3', 1), tb: U('e3', 2), tc: U('e3', 3), td: U('e3', 4), te: U('e3', 5), tf: U('e3', 6), tg: U('e3', 7), th: U('e3', 8),
}
function belastingDb(over: Partial<Db> = {}): Db {
  const kb1 = kp(T.tb, O.pm, { duur_min: 20, parallel_groep_id: GRP, volgorde: 1 })
  return leegDb({
    events: [
      tr(T.ta, '2026-10-06'), tr(T.tb, '2026-10-11'), tr(T.tc, '2026-10-12', { trainingstype: 'teamtactisch' }),
      tr(T.td, '2026-10-14'), tr(T.te, TODAY), tr(T.tf, '2026-10-20'), tr(T.tg, '2026-10-03'), tr(T.th, '2026-10-02'),
    ],
    oefeningen: bibliotheek(),
    training_oefeningen: [
      kp(T.ta, O.pg), kp(T.ta, O.wu, { duur_min: 15 }), kp(T.ta, O.sw, { duur_min: 0 }),
      kb1,
      kp(T.tb, O.pk, { duur_min: 30, parallel_groep_id: GRP, volgorde: 1 }),
      kp(T.tb, O.ov, { duur_min: 10, volgorde: 2, genest_in: kb1.id }),
      kp(T.tc, O.pg, { duur_min: 20 }),
      kp(T.te, O.pg, { duur_min: 99 }),
      kp(T.tf, O.pg, { duur_min: 88 }),
      kp(T.tg, O.hid, { duur_min: 35 }),
      kp(T.th, O.mate),
    ],
    ...over,
  })
}
const WK40 = cellen({ pass_trap: 18 }, '53')
const WK41 = cellen({ warming_up: 15, partijen_groot: 25, partijen_midden: 20, partijen_klein: 30, overig: 10 }, '80 *')
const WK42 = cellen({ partijen_groot: 20 }, '20')

// ── Fixture DISCIPLINE (donderdag 2026-10-15; verleden = 2026-08-01 t/m 2026-10-14) ──
// Wedstrijden in bereik (y = 8): M1 uitslag 2-1; M2 rating; M3 rating + alleen goals_for;
//  M4 niets + override 'analysis' (handmatig); M5 2-0 + override 'analysis' (handmatig MAAR auto waar);
//  M6 niets; M9 één wedstrijdmoment; M10 niets + override van het VERKEERDE type ('training_plan').
// Analyse (analyseBestaat): M1, M2, M3, M5, M9 = 5. Uitslag: M1, M5 = 2. Handmatig zonder auto: M4 = 1.
// Buiten de noemer: M7 (vandaag) en M8 (toekomst) en een event van type 'meeting'.
// Trainingen in bereik (y = 6): T1 doelstelling 'Passen'; T2 twee oefeningen; T3 doelstelling ' ';
//  T4 doelstelling '' + override 'training_plan'; T5 niets + override van het VERKEERDE type; T7 niets (gisteren).
// Plan (hasTrainingPlanDone): T1, T2, T3 = 3. Handmatig zonder auto: T4 = 1. Buiten noemer: T8 (vandaag), T9 (toekomst).
const D = {
  m1: U('e5', 1), m2: U('e5', 2), m3: U('e5', 3), m4: U('e5', 4), m5: U('e5', 5), m6: U('e5', 6), m7: U('e5', 7),
  m8: U('e5', 8), m9: U('e5', 9), m10: U('e5', 10), mee: U('e5', 11),
  t1: U('e6', 1), t2: U('e6', 2), t3: U('e6', 3), t4: U('e6', 4), t5: U('e6', 5), t7: U('e6', 7), t8: U('e6', 8), t9: U('e6', 9),
}
function disciplineDb(over: Partial<Db> = {}): Db {
  return leegDb({
    events: [
      wed(D.m1, '2026-09-05', { goals_for: 2, goals_against: 1 }),
      wed(D.m2, '2026-09-12'),
      wed(D.m3, '2026-09-19', { goals_for: 1 }),
      wed(D.m4, '2026-09-26'),
      wed(D.m5, '2026-10-03', { goals_for: 2, goals_against: 0 }),
      wed(D.m6, '2026-10-10'),
      wed(D.m7, TODAY, { goals_for: 1, goals_against: 1 }),
      wed(D.m8, '2026-10-20', { goals_for: 4, goals_against: 0 }),
      wed(D.m9, '2026-08-20'),
      wed(D.m10, '2026-10-12'),
      { ...wed(D.mee, '2026-09-30'), type: 'meeting' },
      tr(D.t1, '2026-09-08', { doelstelling: 'Passen' }),
      tr(D.t2, '2026-09-10'),
      tr(D.t3, '2026-09-15', { doelstelling: ' ' }),
      tr(D.t4, '2026-09-17', { doelstelling: '' }),
      tr(D.t5, '2026-09-24'),
      tr(D.t7, '2026-10-14'),
      tr(D.t8, TODAY, { doelstelling: 'Vandaag' }),
      tr(D.t9, '2026-10-25', { doelstelling: 'Straks' }),
    ],
    oefeningen: bibliotheek(),
    training_oefeningen: [kp(D.t2, O.pg), kp(D.t2, O.wu)],
    match_ratings: [rating(D.m2), rating(D.m3)],
    match_events: [moment(D.m9)],
    task_overrides: [ovr(D.m4, 'analysis'), ovr(D.m5, 'analysis'), ovr(D.m10, 'training_plan'), ovr(D.t4, 'training_plan'), ovr(D.t5, 'analysis')],
    ...over,
  })
}

// ── Fixture PERIODISERING (donderdag 2026-10-15; weergave = seizoen t/m gisteren) ──
// Alle trainingen zijn VCT tenzij anders vermeld. Stap = meting + floor(k/2); k = aantal eerdere VCT-trainingen
// met het onderdeel, strikt NA de meetdatum en strikt VÓÓR de trainingsdatum (zelfde dag telt niet).
//  partijen_groot (max 21): meting 1-9 stap 3; trainingen 25-8 (vóór meting), 1-9 (op meetdatum), 8-9, 15-9 (twee!), 22-9,
//    29-9, 6-10, 13-10, vandaag 15-10 en toekomst 20-10, plus TEAMTACTISCH 20-9 en een training met niet-leesbare oefening (1-10).
//    Punten: 1-9 meting 3 | 8-9 k0 3 | 15-9 k1 3 | 15-9 k1 3 | 22-9 k3 4 | 29-9 k4 5 | 6-10 k5 5 | 13-10 k6 6.
//    Huidig (gisteren): 7 trainingen na meting -> 3 + 3 = 6; nulmeting 3; verschil +3.
//  partijen_midden (max 15): meting 1-9 stap 5, tweede meting 25-9 stap 2; trainingen 8-9, 15-9, 22-9, 25-9, 29-9, 6-10, 13-10.
//    Punten: 1-9 meting 5 | 8-9 5 | 15-9 5 | 22-9 6 | 25-9 training 6 (nog oude meting) | 25-9 meting 2 | 29-9 2 | 6-10 2 | 13-10 3.
//    Huidig: meting 25-9 stap 2, 3 trainingen erna -> 3; nulmeting = EERSTE meting 5; verschil -2.
//  partijen_klein (max 13): meting 1-9 stap 4; trainingen 8-9, 15-9 (stap_override 9), 22-9, 29-9.
//    Punten: 1-9 meting 4 | 8-9 4 | 15-9 9 (handmatig) | 22-9 5 | 29-9 5. Huidig 4 + 2 = 6; verschil +2.
//  sprints_weinig_rust (max 14): meting 1-9 stap 13; trainingen 8-9, 15-9, 22-9, 29-9, 6-10, 13-10.
//    Punten: 13 13 13 14 14 15 15 (incl. meting); huidig 13 + 3 = 16 (BOVEN max 14, niet geclampt); verschil +3.
//  sprints_veel_rust (max 13): alleen een TOEKOMSTIGE meting (1-11) + trainingen -> "nog niet gemeten".
const mnd = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
const kort = (d: string) => `${Number(d.slice(8))} ${mnd[Number(d.slice(5, 7)) - 1]}`

function periodiseringDb(over: Partial<Db> = {}): Db {
  mN = 0
  evN = 0
  const events: Row[] = []
  const koppelingen: Row[] = []
  const vct = (date: string, oefId: string, o: { tt?: boolean; override?: number | null } = {}) => {
    const id = U('e4', ++evN)
    events.push(tr(id, date, o.tt ? { trainingstype: 'teamtactisch' } : {}))
    koppelingen.push(kp(id, oefId, { stap_override: o.override ?? null }))
  }
  for (const d of ['2026-08-25', '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13', TODAY, '2026-10-20']) vct(d, O.pg)
  vct('2026-09-20', O.pg, { tt: true })
  vct('2026-10-01', O.hid)
  for (const d of ['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-25', '2026-09-29', '2026-10-06', '2026-10-13']) vct(d, O.pm)
  vct('2026-09-08', O.pk)
  vct('2026-09-15', O.pk, { override: 9 })
  vct('2026-09-22', O.pk)
  vct('2026-09-29', O.pk)
  for (const d of ['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13']) vct(d, O.sw)
  vct('2026-09-10', O.sv)
  vct('2026-09-17', O.sv)
  return leegDb({
    events,
    oefeningen: bibliotheek(),
    training_oefeningen: koppelingen,
    categorie_metingen: [
      mt('partijen_groot', '2026-09-01', 3),
      mt('partijen_midden', '2026-09-01', 5),
      mt('partijen_midden', '2026-09-25', 2),
      mt('partijen_klein', '2026-09-01', 4),
      mt('sprints_weinig_rust', '2026-09-01', 13),
      mt('sprints_veel_rust', '2026-11-01', 6),
    ],
    ...over,
  })
}

// Alle drie de fixtures in één database (ids zijn onderling uniek).
function combiDb(): Db {
  const p = periodiseringDb()
  const d = disciplineDb()
  const b = belastingDb()
  return leegDb({
    events: [...p.events, ...d.events, ...b.events],
    oefeningen: bibliotheek(),
    training_oefeningen: [...p.training_oefeningen, ...d.training_oefeningen, ...b.training_oefeningen],
    categorie_metingen: p.categorie_metingen,
    match_ratings: d.match_ratings,
    match_events: d.match_events,
    task_overrides: d.task_overrides,
  })
}

// ═══════════════════════════════════════════════════════════════════════
// Render- en leeshulpen
// ═══════════════════════════════════════════════════════════════════════
async function renderInzichten(db: Db, o: { periode?: string; over?: Partial<Harness>; locale?: string } = {}) {
  configure({ defaultIgnore: NEGEER_PRINTBLOK })
  state.locale = o.locale ?? 'nl'
  const h = setup(db, o.over)
  const el = o.periode === undefined
    ? await InzichtenPage()
    : await InzichtenPage({ searchParams: Promise.resolve({ periode: o.periode }) })
  const r = render(<DictProvider dict={dicts[state.locale]}>{el}</DictProvider>)
  return { ...r, h }
}

function kaart(titel: string): HTMLElement {
  return screen.getByRole('heading', { level: 2, name: titel }).closest('.surface-card') as HTMLElement
}
const BEL = (t: Dict = nl) => kaart(t.insights.belastingTitle)
const PER = (t: Dict = nl) => kaart(t.insights.periodiseringTitle)
const DIS = (t: Dict = nl) => kaart(t.insights.disciplineTitle)

interface WeekRij { label: string; deelweek: boolean; cellen: string[] }
function weekRijen(k: HTMLElement = BEL()): WeekRij[] {
  return within(k).getAllByRole('rowheader').map((th) => ({
    label: th.childNodes[0]?.textContent ?? '',
    deelweek: th.querySelector('span') !== null,
    cellen: [...th.closest('tr')!.querySelectorAll('td')].map((td) => td.textContent ?? ''),
  }))
}
const wk = (rijen: WeekRij[], week: number): WeekRij => {
  const r = rijen.find((x) => x.label.startsWith(`wk ${week} · `))
  if (!r) throw new Error(`week ${week} niet gevonden in ${rijen.map((x) => x.label).join(' | ')}`)
  return r
}

interface OnderdeelRij { nulmeting: string; huidig: string; voortgang: string; punten: string[][]; heeftSvg: boolean; heeftDetails: boolean }
function onderdeel(sleutel: string, k: HTMLElement = PER()): OnderdeelRij {
  const naam = nl.periodization.categories[sleutel as keyof typeof nl.periodization.categories]
  const th = within(k).getAllByRole('rowheader').find((x) => x.textContent === naam)
  if (!th) throw new Error(`onderdeel ${naam} niet gevonden`)
  const tbody = th.closest('tbody')!
  const tds = [...th.closest('tr')!.querySelectorAll('td')].map((td) => td.textContent ?? '')
  return {
    nulmeting: tds[0] ?? '',
    huidig: tds[1] ?? '',
    voortgang: tds[2] ?? '',
    punten: [...tbody.querySelectorAll('details tbody tr')].map((tr2) => [...tr2.querySelectorAll('td')].map((td) => td.textContent ?? '')),
    heeftSvg: tbody.querySelector('svg') !== null,
    heeftDetails: tbody.querySelector('details') !== null,
  }
}
const tekstenMet = (k: HTMLElement, tekst: string) => [...k.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent === tekst)
const calls = (h: Harness, name: string) => h.rpcCalls.filter((c) => c.name === name)

function zonderKaarten(container: HTMLElement, titels: string[]): string {
  const kopie = container.cloneNode(true) as HTMLElement
  for (const titel of titels) {
    const h2 = [...kopie.querySelectorAll('h2')].find((x) => x.textContent === titel)
    h2?.closest('.surface-card')?.remove()
  }
  return kopie.innerHTML.replace(/recharts\d+-clip/g, 'recharts-clip').replace(/_r_[0-9a-z]+_/g, '_r_')
}
const NIEUWE_TITELS = [i.belastingTitle, i.periodiseringTitle, i.disciplineTitle]

// ═══════════════════════════════════════════════════════════════════════
// AC-A — Algemeen
// ═══════════════════════════════════════════════════════════════════════
describe('AC-A1 — kaarten onder de fase-2b-kaarten in vaste volgorde; bestaande kaarten ongewijzigd', () => {
  it('AC-A1: laatste drie kaarten zijn belasting, periodisering, discipline; direct na de speelminutenkaart; belasting volle breedte, de andere twee half breed naast elkaar', async () => {
    await renderInzichten(belastingDb())
    const koppen = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(koppen.slice(-3)).toEqual([i.belastingTitle, i.periodiseringTitle, i.disciplineTitle])
    expect(koppen.at(-4)).toBe(i.speelminutenTitle)
    for (const t of NIEUWE_TITELS) expect(koppen.filter((x) => x === t)).toHaveLength(1)
    const smk = kaart(i.speelminutenTitle)
    expect(smk.nextElementSibling).toBe(BEL().parentElement) // wrapper om belasting
    expect(BEL().parentElement!.className).toContain('lg:col-span-2')
    expect(BEL().parentElement!.nextElementSibling).toBe(PER())
    expect(PER().nextElementSibling).toBe(DIS())
    expect(PER().className).not.toContain('col-span-2')
    expect(DIS().className).not.toContain('col-span-2')
    expect(PER().parentElement).toBe(smk.parentElement)
    expect(DIS().parentElement).toBe(smk.parentElement)
  })

  it('AC-A1: alle overige kaarten zijn byte-voor-byte gelijk met en zonder metingen en handmatige afvinkingen (bestaande kaarten ongewijzigd)', async () => {
    const met = await renderInzichten(periodiseringDb({ task_overrides: [ovr(U('e4', 1), 'training_plan')] }))
    const htmlMet = zonderKaarten(met.container, NIEUWE_TITELS)
    cleanup()
    const zonder = await renderInzichten(periodiseringDb({ categorie_metingen: [], task_overrides: [] }))
    const htmlZonder = zonderKaarten(zonder.container, NIEUWE_TITELS)
    expect(htmlMet.length).toBeGreaterThan(5000)
    expect(htmlMet).toBe(htmlZonder)
  })

  it('AC-A1 / AC-B.3: de bestaande TrainingsinhoudChart blijft staan en telt ongewijzigd het aantal VCT-trainingen per categorie', async () => {
    await renderInzichten(belastingDb())
    // Met de hand: VCT-trainingen t/m gisteren met een leesbare categorie: ta (pg, wu, sw), tb (pm, pk, ov), th (pass_trap).
    // tc is teamtactisch, tg heeft een niet-leesbare oefening, te is vandaag, tf toekomst, td heeft geen oefeningen.
    const chart = kaart(i.inhoudTitle)
    const img = within(chart).getByRole('img')
    expect(img.getAttribute('aria-label')).toBe(fmt(i.inhoudSummary, { n: 7, totaal: 7 }))
  })
})

describe('AC-A2 — tenant-isolatie (ook bij oefeningen van een teamgenoot)', () => {
  it('AC-A2: belasting — vreemd team, vreemde koppeling op een eigen training en een vreemde training tellen niet mee; de teamgenoot-oefening wél', async () => {
    const db = belastingDb()
    db.events.push(tr(U('e3', 90), '2026-10-07', { team_id: OTHER }))
    db.training_oefeningen.push(
      kp(U('e3', 90), O.pg, { team_id: OTHER, duur_min: 500 }),
      kp(T.ta, O.pg, { team_id: OTHER, duur_min: 77 }), // rij van team-2 op een EIGEN training (k.team_id-filter)
    )
    await renderInzichten(db)
    const rijen = weekRijen()
    expect(wk(rijen, 41).cellen).toEqual(WK41)
    expect(wk(rijen, 40).cellen).toEqual(WK40) // met de oefening van de teamgenoot (pass_trap 18)
    expect(BEL().textContent).not.toMatch(/\b(500|77)\b/)
  })

  it('AC-A2: discipline — rating, moment en override van team-2 op een eigen wedstrijd/training tellen niet; een vreemde wedstrijd telt niet', async () => {
    const db = disciplineDb()
    db.events.push(wed(U('e5', 90), '2026-09-06', { team_id: OTHER, goals_for: 3, goals_against: 0 }), tr(U('e6', 90), '2026-09-07', { team_id: OTHER, doelstelling: 'Vreemd' }))
    // M6 en T7 zijn "leeg": vreemde rijen mogen ze niet vullen of afvinken.
    db.match_ratings.push(rating(D.m6, OTHER))
    db.match_events.push(moment(D.m6, OTHER))
    db.task_overrides.push(ovr(D.m6, 'analysis', OTHER), ovr(D.t7, 'training_plan', OTHER))
    db.training_oefeningen.push(kp(D.t7, O.pg, { team_id: OTHER }))
    await renderInzichten(db)
    const k = DIS()
    expect(k.textContent).toContain(fmt(i.disciplineAnalyse, { x: 5, y: 8 }))
    expect(k.textContent).toContain(fmt(i.disciplineUitslag, { x: 2, y: 8 }))
    expect(k.textContent).toContain(fmt(i.disciplinePlan, { x: 3, y: 6 }))
    expect(tekstenMet(k, fmt(i.disciplineHandmatig, { n: 1 }))).toHaveLength(2) // alleen M4 en T4
  })

  it('AC-A2: periodisering — metingen, trainingen en koppelingen (met stap_override) van team-2 veranderen de reeks niet', async () => {
    const db = periodiseringDb()
    db.categorie_metingen.push(mt('partijen_groot', '2026-08-01', 15, OTHER))
    db.events.push(tr(U('e4', 90), '2026-09-10', { team_id: OTHER }))
    // Vreemde koppelingen: op een vreemde training, en op de EIGEN training van 8-9 (met een override die zichtbaar zou zijn).
    db.training_oefeningen.push(kp(U('e4', 90), O.pg, { team_id: OTHER }), kp(U('e4', 3), O.pg, { team_id: OTHER, stap_override: 99 }))
    await renderInzichten(db)
    const pg = onderdeel('partijen_groot')
    expect(pg.nulmeting).toBe(`stap 3 · ${kort('2026-09-01')}`)
    expect(pg.huidig).toBe('stap 6 max 21')
    expect(pg.punten[1]).toEqual([kort('2026-09-08'), '3', i.bronTraining])
    expect(pg.punten).toHaveLength(8)
  })

  it('AC-A2: elke nieuwe RPC-aanroep krijgt p_team_id = team-id uit de context (niet het user-id van een assistent) en nooit iets van de client', async () => {
    const db = periodiseringDb()
    db.team_members = [{ team_id: TEAM, user_id: 'user-a', rol: 'assistent' }]
    const { h } = await renderInzichten(db, { over: { userId: 'user-a' } })
    const nieuw = h.rpcCalls.filter((c) => c.name === 'inzichten_training_koppelingen' || c.name === 'inzichten_invul_discipline')
    expect(nieuw).toHaveLength(3) // belasting, discipline, periodisering
    for (const c of nieuw) expect(c.args.p_team_id).toBe(TEAM)
    expect(weekRijen().length).toBeGreaterThan(0) // de handler filterde op dat argument en vond data
  })
})

describe('AC-A3 — geen data: lege staat met uitleg, geen nullen-als-meting, geen NaN', () => {
  it('AC-A3: pagina met andere data maar zonder trainingen/metingen/wedstrijden -> drie lege staten, geen tabellen, geen NaN', async () => {
    const { container } = await renderInzichten(leegDb())
    expect(within(BEL()).getByText(i.belastingEmpty)).toBeInTheDocument()
    expect(within(PER()).getByText(i.periodiseringEmpty)).toBeInTheDocument()
    expect(within(DIS()).getByText(i.disciplineEmpty)).toBeInTheDocument()
    for (const k of [BEL(), PER(), DIS()]) {
      expect(within(k).queryByRole('table')).toBeNull()
      expect(k.textContent).not.toMatch(/NaN|undefined|Infinity/)
    }
    expect(container.textContent).not.toMatch(/NaN/)
  })

  it('AC-A3 / AC-P.5: een ongemeten onderdeel toont "nog niet gemeten" en nooit een 0 of stap', async () => {
    await renderInzichten(periodiseringDb())
    const sv = onderdeel('sprints_veel_rust')
    expect(sv.nulmeting).toBe(i.periodiseringNietGemeten)
    expect(sv.huidig).toBe('')
    expect(sv.punten).toEqual([])
    expect(sv.heeftSvg).toBe(false)
    const rij = within(PER()).getAllByRole('rowheader').find((th) => th.textContent === nl.periodization.categories.sprints_veel_rust)!
    expect(rij.closest('tbody')!.textContent).not.toMatch(/\b0\b/)
  })

  it('AC-A3: nergens NaN/undefined in de drie kaarten bij een vol scenario', async () => {
    await renderInzichten(periodiseringDb())
    for (const k of [BEL(), PER(), DIS()]) expect(k.textContent).not.toMatch(/NaN|undefined|Infinity/)
  })
})

describe('AC-A4 — één falende bron: rest werkt, de falende kaart meldt algemeen', () => {
  const PGRST202 = { code: 'PGRST202', message: 'RAW_DETAIL Could not find the function public.inzichten_training_koppelingen in the schema cache' }

  it('AC-A4: koppelingen-RPC faalt (met metingen) -> belasting én periodisering melden, discipline en overige kaarten werken; geen ruwe tekst', async () => {
    const { container } = await renderInzichten(periodiseringDb(), { over: { rpcErrors: { inzichten_training_koppelingen: PGRST202 } } })
    expect(within(BEL()).getByText(i.bronFout)).toBeInTheDocument()
    expect(within(PER()).getByText(i.bronFout)).toBeInTheDocument()
    expect(within(DIS()).queryByText(i.bronFout)).toBeNull()
    expect(DIS().querySelectorAll('dt')).toHaveLength(3)
    expect(within(kaart(i.blessuresTitle)).queryByText(i.bronFout)).toBeNull()
    expect(screen.getAllByText(i.bronFout)).toHaveLength(2)
    expect(container.textContent).not.toMatch(/RAW_DETAIL|PGRST202|inzichten_training_koppelingen/)
  })

  it('AC-A4: discipline-RPC faalt -> alleen de disciplinekaart meldt', async () => {
    const { container } = await renderInzichten(belastingDb(), {
      over: { rpcErrors: { inzichten_invul_discipline: { code: 'XX000', message: 'RAW_DETAIL boem' } } },
    })
    expect(within(DIS()).getByText(i.bronFout)).toBeInTheDocument()
    expect(within(BEL()).queryByText(i.bronFout)).toBeNull()
    expect(weekRijen().length).toBeGreaterThan(0)
    expect(screen.getAllByText(i.bronFout)).toHaveLength(1)
    expect(container.textContent).not.toMatch(/RAW_DETAIL|XX000/)
  })

  it('AC-A4: metingenquery faalt -> alleen de periodiseringskaart meldt; belasting en discipline werken', async () => {
    const { container } = await renderInzichten(periodiseringDb(), {
      over: { selectErrors: { categorie_metingen: { code: 'XX000', message: 'RAW_DETAIL meting' } } },
    })
    expect(within(PER()).getByText(i.bronFout)).toBeInTheDocument()
    expect(within(BEL()).queryByText(i.bronFout)).toBeNull()
    expect(within(DIS()).queryByText(i.bronFout)).toBeNull()
    expect(weekRijen().length).toBeGreaterThan(0)
    expect(screen.getAllByText(i.bronFout)).toHaveLength(1)
    expect(container.textContent).not.toMatch(/RAW_DETAIL|XX000/)
  })

  it('AC-A4: zonder migratie (PGRST202 op beide RPC\'s) melden alleen de drie nieuwe kaarten; de rest van de pagina blijft staan', async () => {
    const { container } = await renderInzichten(periodiseringDb(), {
      over: { rpcErrors: { inzichten_training_koppelingen: PGRST202, inzichten_invul_discipline: PGRST202 } },
    })
    for (const k of [BEL(), PER(), DIS()]) expect(within(k).getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.getAllByText(i.bronFout)).toHaveLength(3)
    expect(screen.getByRole('heading', { level: 2, name: i.blessuresTitle })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/RAW_DETAIL|PGRST202/)
  })
})

describe('AC-A5 — team zonder data houdt de lege-pagina-staat; nieuwe bronnen tellen mee', () => {
  it('AC-A5: team zonder enige data -> lege-pagina-staat, geen nieuwe kaarten', async () => {
    await renderInzichten(leegDb(), { over: { handlers: LEEG } })
    expect(screen.getByText(i.geenDataTitle)).toBeInTheDocument()
    for (const t of NIEUWE_TITELS) expect(screen.queryByRole('heading', { name: t })).toBeNull()
  })

  it('AC-A5: alleen ingeplande (verleden) trainingen zonder enige invoer gelden NIET als data -> lege-pagina-staat blijft', async () => {
    const db = leegDb({ events: [tr(U('e7', 1), '2026-09-08'), tr(U('e7', 2), '2026-09-15', { trainingstype: 'teamtactisch' })] })
    await renderInzichten(db, { over: { handlers: LEEG } })
    expect(screen.getByText(i.geenDataTitle)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: i.belastingTitle })).toBeNull()
  })

  it('AC-A5: alleen een meting is genoeg voor de gewone pagina', async () => {
    const db = leegDb({ categorie_metingen: [mt('partijen_groot', '2026-09-01', 4)] })
    await renderInzichten(db, { over: { handlers: LEEG } })
    expect(screen.queryByText(i.geenDataTitle)).toBeNull()
    expect(onderdeel('partijen_groot').huidig).toContain('stap 4')
  })

  it('AC-A5: alleen een gespeelde wedstrijd met uitslag is genoeg voor de gewone pagina', async () => {
    const db = leegDb({ events: [wed(U('e7', 3), '2026-09-08', { goals_for: 1, goals_against: 0 })] })
    await renderInzichten(db, { over: { handlers: LEEG } })
    expect(screen.queryByText(i.geenDataTitle)).toBeNull()
    expect(DIS().textContent).toContain(fmt(i.disciplineUitslag, { x: 1, y: 1 }))
  })

  it('AC-A5: alleen één koppeling met duur (teamtactisch, discipline-bron leeg) is genoeg voor de gewone pagina', async () => {
    const id = U('e7', 4)
    const db = leegDb({
      events: [tr(id, '2026-09-08', { trainingstype: 'teamtactisch' })],
      oefeningen: bibliotheek(),
      training_oefeningen: [kp(id, O.pg, { duur_min: 20 })],
    })
    await renderInzichten(db, { over: { handlers: { ...LEEG, inzichten_invul_discipline: () => [] } } })
    expect(screen.queryByText(i.geenDataTitle)).toBeNull()
    expect(wk(weekRijen(), 37).cellen).toEqual(cellen({ partijen_groot: 20 }, '20'))
  })

  it('AC-A5: alleen een training met doelstelling (plan) is genoeg voor de gewone pagina', async () => {
    const db = leegDb({ events: [tr(U('e7', 5), '2026-09-08', { doelstelling: 'Passen' })] })
    await renderInzichten(db, { over: { handlers: LEEG } })
    expect(screen.queryByText(i.geenDataTitle)).toBeNull()
    expect(DIS().textContent).toContain(fmt(i.disciplinePlan, { x: 1, y: 1 }))
  })
})

describe('AC-A6 — unieke titels en teksten in 5 talen', () => {
  const SLEUTELS = [
    'belastingTitle', 'belastingDescription', 'belastingEmpty', 'belastingGrafiekLabel', 'kolomWeek', 'kolomTrainingstotaal',
    'weekLabel', 'deelweekLabel', 'belastingZonderOefeningen', 'belastingZonderDuur', 'belastingOnbekend',
    'belastingTotaalOnvolledig', 'belastingSomUitleg', 'belastingMomentopname', 'afgekaptTraining', 'periodiseringTitle',
    'periodiseringDescription', 'periodiseringEmpty', 'kolomOnderdeel', 'kolomNulmeting', 'kolomHuidigeStap', 'kolomVoortgang',
    'periodiseringNietGemeten', 'periodiseringGeenVoortgang', 'stapWaarde', 'maxStapWaarde', 'nulmetingWaarde', 'voortgangWaarde',
    'reeksBekijken', 'kolomDatum', 'kolomStap', 'kolomBron', 'bronMeting', 'bronTraining', 'bronHandmatig', 'disciplineTitle',
    'disciplineDescription', 'disciplineAnalyse', 'disciplineUitslag', 'disciplinePlan', 'disciplineHandmatig',
    'disciplineGeenWedstrijden', 'disciplineGeenTrainingen', 'disciplineAanwezigheid', 'disciplineEmpty',
  ] as const
  function waarden(obj: unknown, uit: string[] = []): string[] {
    if (typeof obj === 'string') uit.push(obj)
    else if (obj && typeof obj === 'object') for (const v of Object.values(obj)) waarden(v, uit)
    return uit
  }

  it('AC-A6: de lijst is werkelijk 45 sleutels (brief §4.4)', () => {
    expect(new Set(SLEUTELS).size).toBe(45)
  })

  it.each(Object.keys(dicts))('AC-A6: %s — alle 45 sleutels bestaan en zijn niet leeg; de drie titels komen precies één keer voor in de hele woordenlijst', (taal) => {
    const d = dicts[taal]
    const alle = waarden(d)
    for (const k of SLEUTELS) {
      const w = (d.insights as Record<string, unknown>)[k]
      expect(typeof w === 'string' && w.length > 0, `insights.${k} in ${taal}`).toBe(true)
    }
    for (const k of ['belastingTitle', 'periodiseringTitle', 'disciplineTitle'] as const) {
      expect(alle.filter((x) => x === d.insights[k]), `insights.${k} uniek in ${taal}`).toHaveLength(1)
    }
    const titels = [d.insights.belastingTitle, d.insights.periodiseringTitle, d.insights.disciplineTitle]
    expect(new Set(titels).size).toBe(3)
  })

  it('AC-A6: titels en uitleg zijn per taal werkelijk vertaald (niet gelijk aan het Nederlands)', () => {
    for (const taal of ['en', 'de', 'es', 'fr']) {
      for (const k of ['belastingTitle', 'periodiseringTitle', 'disciplineTitle', 'belastingDescription', 'disciplineAanwezigheid', 'afgekaptTraining'] as const) {
        expect(dicts[taal].insights[k], `${taal}.${k}`).not.toBe(nl.insights[k])
      }
    }
  })

  it.each(['en', 'de', 'es', 'fr'])('AC-A6: %s — /inzichten toont de drie kaarten, kolomkoppen, weeklabel en x-van-y in die taal, zonder losse {placeholders}', async (taal) => {
    const db = combiDb()
    await renderInzichten(db, { locale: taal })
    const d = dicts[taal]
    const bel = BEL(d)
    expect(within(bel).getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      d.insights.kolomWeek, ...CATS.map((c) => d.periodization.categories[c as keyof typeof d.periodization.categories]), d.insights.kolomTrainingstotaal,
    ])
    expect(weekRijen(bel).map((r) => r.label).some((l) => l.startsWith(fmt(d.insights.weekLabel, { week: 41, datum: '' }).trimEnd()))).toBe(true)
    expect(DIS(d).textContent).toContain(fmt(d.insights.disciplineAnalyse, { x: 5, y: 8 }))
    expect(DIS(d).textContent).toContain(fmt(d.insights.disciplineUitslag, { x: 2, y: 8 }))
    expect(DIS(d).textContent).toContain(d.insights.disciplineAanwezigheid)
    expect(PER(d).textContent).toContain(d.insights.periodiseringDescription)
    expect(PER(d).textContent).toContain(d.insights.kolomNulmeting)
    for (const k of [bel, PER(d), DIS(d)]) expect(k.textContent).not.toMatch(/\{[a-z]+\}/)
  })
})

describe('AC-A7 — grafiek met tekstvariant; kleuren uit tokens', () => {
  it('AC-A7: belasting — staafjes (role=img met label) hebben een semantische tabel als tekstvariant; alleen tokens; lege week geen staaf; deelweek gedimd', async () => {
    await renderInzichten(belastingDb())
    const k = BEL()
    const img = within(k).getByRole('img')
    expect(img.getAttribute('aria-label')).toBe(fmt(i.belastingGrafiekLabel, { n: 12 }))
    const staven = [...img.children] as HTMLElement[]
    expect(staven).toHaveLength(12)
    // Weken 31..39 (index 0..8) hebben geen training -> geen staaf; wk 40/41/42 = index 9/10/11.
    for (let n = 0; n < 9; n++) expect(staven[n].querySelector('div'), `week-index ${n}`).toBeNull()
    const hoogte = (n: number) => parseFloat((staven[n].querySelector('div') as HTMLElement).style.height)
    expect(hoogte(10)).toBeCloseTo(100, 5) // 80 / max 80
    expect(hoogte(9)).toBeCloseTo((53 / 80) * 100, 5)
    expect(hoogte(11)).toBeCloseTo(25, 5) // 20 / 80
    expect((staven[10].querySelector('div') as HTMLElement).style.opacity).toBe('1')
    expect((staven[11].querySelector('div') as HTMLElement).style.opacity).toBe('0.5') // deelweek aan het eind
    const stijlen = [...k.querySelectorAll('[style]')].map((el) => el.getAttribute('style') ?? '')
    expect(stijlen.some((s) => s.includes('var(--brand-accent)'))).toBe(true)
    expect(k.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/)
    expect(within(k).getByRole('table')).toBeInTheDocument()
    expect(within(k).getAllByRole('columnheader')).toHaveLength(12)
  })

  it('AC-A7: periodisering — staplijn is aria-hidden met tokens; elke reeks heeft een <details> met datum/stap/bron als tekstvariant', async () => {
    await renderInzichten(periodiseringDb())
    const k = PER()
    for (const sleutel of ['partijen_groot', 'partijen_midden', 'partijen_klein', 'sprints_weinig_rust']) {
      const o = onderdeel(sleutel)
      expect(o.heeftSvg, sleutel).toBe(true)
      expect(o.heeftDetails, sleutel).toBe(true)
    }
    for (const svg of k.querySelectorAll('svg')) expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(k.querySelectorAll('summary')[0].textContent).toBe(i.reeksBekijken)
    const stijl = k.innerHTML
    expect(stijl).toContain('var(--brand-accent)')
    expect(stijl).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/)
    const kop = [...k.querySelectorAll('details thead th')].map((th) => th.textContent)
    expect(kop.slice(0, 3)).toEqual([i.kolomDatum, i.kolomStap, i.kolomBron])
  })

  it('AC-A7: discipline — meters zijn aria-hidden, schalen met x/y en gebruiken alleen tokens; het getal staat als tekst', async () => {
    await renderInzichten(disciplineDb())
    const k = DIS()
    const meters = [...k.querySelectorAll('[aria-hidden="true"]')]
    expect(meters).toHaveLength(3)
    expect(meters.map((m) => parseFloat((m.firstElementChild as HTMLElement).style.width))).toEqual([62.5, 25, 50]) // 5/8, 2/8, 3/6
    expect(k.innerHTML).toContain('var(--track)')
    expect(k.innerHTML).toContain('var(--brand-accent)')
    expect(k.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/)
    expect(k.textContent).toContain('5 van 8')
  })
})

describe('AC-A8 — alleen aantallen/minuten/verhoudingen; geen KPI, signaal, advies, alarm, oordeel of rapport (V6)', () => {
  it('AC-A8: de drie kaarten hebben geen alert/status, links, knoppen, oordeelskleuren of oordeelwoorden', async () => {
    await renderInzichten(combiDb())
    for (const k of [BEL(), PER(), DIS()]) {
      expect(k.querySelectorAll('[role="alert"], [role="status"], a, button')).toHaveLength(0)
      expect(k.innerHTML).not.toMatch(/(text|bg|border|fill|stroke)-(red|green|amber|orange|yellow|rose|emerald|lime|danger|warn|success)/i)
      expect(k.textContent).not.toMatch(/advies|waarschuw|alarm|aanbevel|pdf|rapport|kpi|slecht|uitstekend|onvoldoende/i)
    }
  })
})

describe('AC-A9 — vaste deterministische volgorde met tie-break', () => {
  it('AC-A9: aanlevervolgorde van RPC-rijen en metingen verandert de weergave niet (byte-gelijk)', async () => {
    const normaal = await renderInzichten(combiDb())
    const a = [BEL(), PER(), DIS()].map((k) => k.innerHTML)
    cleanup()
    const db = combiDb()
    db.categorie_metingen.reverse()
    const omgekeerd = await renderInzichten(db, {
      over: {
        handlers: {
          ...MET_DATA,
          inzichten_training_koppelingen: (d, args) => [...hKoppelingen(d, args)].reverse(),
          inzichten_invul_discipline: (d, args) => [...hDiscipline(d, args)].reverse(),
        },
      },
    })
    const b = [BEL(), PER(), DIS()].map((k) => k.innerHTML)
    expect(normaal.h.rpcCalls.length).toBeGreaterThan(0)
    expect(omgekeerd.h.rpcCalls.length).toBeGreaterThan(0)
    expect(b).toEqual(a)
    expect(a[0].length).toBeGreaterThan(1000)
  })

  it('AC-A9: bij meerdere koppelingen van hetzelfde onderdeel in één training wint de eerste stap_override (volgorde), onafhankelijk van de aanlevering', async () => {
    const id = U('e8', 1)
    const db = leegDb({
      events: [tr(id, '2026-09-08')],
      oefeningen: bibliotheek(),
      training_oefeningen: [kp(id, O.pk, { stap_override: 7 }), kp(id, O.pk, { stap_override: 11 })],
      categorie_metingen: [mt('partijen_klein', '2026-09-01', 4)],
    })
    await renderInzichten(db, { over: { handlers: { ...MET_DATA, inzichten_training_koppelingen: (d, args) => [...hKoppelingen(d, args)].reverse() } } })
    expect(onderdeel('partijen_klein').punten).toEqual([[kort('2026-09-01'), '4', i.bronMeting], [kort('2026-09-08'), '7', i.bronHandmatig]])
  })
})

// TZ-matrix: drie tijdzones × drie kloktijden (patroon fase 2b).
const TZS: [string, number][] = [
  ['Europe/Amsterdam', -120],
  ['America/Los_Angeles', 420],
  ['Pacific/Auckland', -780],
]
const KLOKKEN: [number, number][] = [[0, 30], [10, 0], [23, 30]]

describe.each(TZS)('AC-A10 — tijdzone %s', (tz, offset) => {
  beforeEach(() => {
    process.env.TZ = tz
  })

  it('TZ-controle: de tijdzone is echt gewisseld', () => {
    expect(new Date(2026, 9, 15, 12, 0).getTimezoneOffset()).toBe(offset)
  })

  it.each(KLOKKEN)('AC-A10 / AC-B.1 / AC-B.6 / AC-B.7 / AC-D.1: om %i:%i lokaal vallen zondag en maandag in de juiste weken, telt gisteren wel en vandaag niet, en is de huidige week de deelweek aan het eind', async (uur, min) => {
    zetKlok(TODAY, uur, min)
    const db = belastingDb()
    // Discipline in dezelfde render: gisteren (uitslag) telt, vandaag niet.
    db.events.push(wed(U('e5', 70), '2026-10-14', { goals_for: 2, goals_against: 1 }), wed(U('e5', 71), TODAY, { goals_for: 3, goals_against: 0 }))
    const { h } = await renderInzichten(db)
    const rijen = weekRijen()
    expect(rijen).toHaveLength(12)
    expect(wk(rijen, 40).cellen).toEqual(WK40)
    expect(wk(rijen, 41).cellen).toEqual(WK41) // zondag 11 okt zit in wk 41
    expect(wk(rijen, 42).cellen).toEqual(WK42) // maandag 12 okt zit in wk 42; vandaag (99) en toekomst (88) niet
    expect(rijen.filter((r) => r.deelweek).map((r) => r.label.split(' · ')[0])).toEqual(['wk 31', 'wk 42'])
    expect(rijen[0].label).toBe(`wk 31 · ${kort('2026-07-27')}`)
    expect(rijen[11].label).toBe(`wk 42 · ${kort('2026-10-12')}`)
    expect(calls(h, 'inzichten_training_koppelingen')[0].args).toMatchObject({ p_start: '2026-08-01', p_end: '2026-10-14' })
    expect(DIS().textContent).toContain(fmt(i.disciplineUitslag, { x: 1, y: 1 })) // 14 okt wel, 15 okt niet
    expect(DIS().textContent).toContain(fmt(i.disciplinePlan, { x: 5, y: 6 })) // ta, tb, tc, tg, th ja; td nee; te/tf buiten bereik
  })

  it.each(KLOKKEN)('AC-A10: om %i:%i lokaal gelden zomertijdovergangen (27 sep Auckland, 25 okt Europa) niet als verschoven week', async (uur, min) => {
    zetKlok('2026-10-30', uur, min)
    const ids = [U('e9', 1), U('e9', 2), U('e9', 3), U('e9', 4)]
    const db = leegDb({
      events: [tr(ids[0], '2026-09-27'), tr(ids[1], '2026-09-28'), tr(ids[2], '2026-10-25'), tr(ids[3], '2026-10-26')],
      oefeningen: bibliotheek(),
      training_oefeningen: [kp(ids[0], O.pg, { duur_min: 10 }), kp(ids[1], O.pg, { duur_min: 20 }), kp(ids[2], O.pg, { duur_min: 5 }), kp(ids[3], O.pg, { duur_min: 7 })],
    })
    await renderInzichten(db)
    const rijen = weekRijen()
    expect(wk(rijen, 39).cellen).toEqual(cellen({ partijen_groot: 10 }, '10')) // zo 27 sep
    expect(wk(rijen, 40).cellen).toEqual(cellen({ partijen_groot: 20 }, '20')) // ma 28 sep
    expect(wk(rijen, 43).cellen).toEqual(cellen({ partijen_groot: 5 }, '5')) // zo 25 okt
    expect(wk(rijen, 44).cellen).toEqual(cellen({ partijen_groot: 7 }, '7')) // ma 26 okt
    expect(rijen).toHaveLength(14) // wk 31 t/m wk 44
  })

  it.each(KLOKKEN)('AC-A10 / AC-P.3: om %i:%i lokaal geeft de periodisering dezelfde punten en datums', async (uur, min) => {
    zetKlok(TODAY, uur, min)
    await renderInzichten(periodiseringDb())
    const pg = onderdeel('partijen_groot')
    expect(pg.nulmeting).toBe(`stap 3 · ${kort('2026-09-01')}`)
    expect(pg.punten.map((p) => p[0])).toEqual(['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'].map(kort))
    expect(pg.huidig).toContain('stap 6')
  })
})

describe('AC-A11 — elke kaart vermeldt zijn venster of vaste afbakening', () => {
  it('AC-A11: belasting en discipline noemen "t/m gisteren", periodisering het hele seizoen (VCT, nulmeting = eerste ooit)', async () => {
    await renderInzichten(periodiseringDb())
    expect(BEL().textContent).toContain(i.belastingDescription)
    expect(i.belastingDescription).toMatch(/t\/m gisteren/)
    expect(i.belastingDescription).toMatch(/ma–zo/)
    expect(DIS().textContent).toContain(i.disciplineDescription)
    expect(i.disciplineDescription).toMatch(/t\/m gisteren/)
    expect(PER().textContent).toContain(i.periodiseringDescription)
    expect(i.periodiseringDescription).toMatch(/Hele seizoen t\/m gisteren/)
    expect(i.periodiseringDescription).toMatch(/VCT/)
    expect(i.periodiseringDescription).toMatch(/eerste meting ooit/)
  })

  it('AC-A11: de belastingkaart legt het verschil met Trainingsinhoud uit (minuten, geen aantal trainingen) en dat de som per categorie hoger kan zijn dan het trainingstotaal', async () => {
    await renderInzichten(belastingDb())
    expect(i.belastingDescription).toMatch(/minuten/)
    expect(i.belastingDescription).toMatch(/Trainingsinhoud/)
    expect(BEL().textContent).toContain(i.belastingSomUitleg)
    expect(i.belastingSomUitleg).toMatch(/langste/)
  })
})

describe('AC-A12 — limiet overschreden: zichtbaar vermeld, nooit stil afkappen', () => {
  function veelTrainingen(n: number): Db {
    const events: Row[] = []
    for (let x = 0; x < n; x++) {
      const dag = 1 + (x % 70) // 2026-08-01 .. 2026-10-09
      const datum = new Date(Date.UTC(2026, 7, dag)).toISOString().slice(0, 10)
      events.push(tr(U('ea', x + 1), datum))
    }
    return leegDb({ events })
  }

  it('AC-A12: 905 trainingen -> de SQL levert 901 rijen met totaal 905 -> belasting en discipline melden afgekapt en tonen geen cijfers; periodisering blijft gewoon', async () => {
    const { h } = await renderInzichten(veelTrainingen(905))
    const bron = hKoppelingen(h.db, { p_team_id: TEAM, p_start: '2026-08-01', p_end: '2026-10-14' })
    expect(bron).toHaveLength(901)
    expect(bron[0].totaal).toBe(905)
    for (const k of [BEL(), DIS()]) {
      expect(within(k).getByText(i.afgekaptTraining)).toBeInTheDocument()
      expect(within(k).queryByRole('table')).toBeNull()
      expect(within(k).queryByRole('img')).toBeNull()
      expect(k.querySelectorAll('dt')).toHaveLength(0)
      expect(k.textContent).not.toMatch(/wk \d+| van \d+/)
    }
    expect(within(PER()).queryByText(i.afgekaptTraining)).toBeNull()
  })

  it('AC-A12: exact 900 rijen (totaal 900) is NIET afgekapt', async () => {
    await renderInzichten(veelTrainingen(900))
    expect(within(BEL()).queryByText(i.afgekaptTraining)).toBeNull()
    expect(within(BEL()).getByRole('table')).toBeInTheDocument()
    expect(within(DIS()).queryByText(i.afgekaptTraining)).toBeNull()
    expect(DIS().textContent).toContain(fmt(i.disciplinePlan, { x: 0, y: 900 }))
  })

  it('AC-A12: totaal > aantal binnengekomen rijen (lagere PostgREST max-rows) -> afgekapt, ook bij maar 3 rijen', async () => {
    const afgeknipt = (d: Db, args: Row) => hKoppelingen(d, args).slice(0, 3).map((r) => ({ ...r, totaal: 905 }))
    const afgeknipt2 = (d: Db, args: Row) => hDiscipline(d, args).slice(0, 3).map((r) => ({ ...r, totaal: 905 }))
    await renderInzichten(belastingDb(), { over: { handlers: { ...MET_DATA, inzichten_training_koppelingen: afgeknipt, inzichten_invul_discipline: afgeknipt2 } } })
    for (const k of [BEL(), DIS()]) {
      expect(within(k).getByText(i.afgekaptTraining)).toBeInTheDocument()
      expect(within(k).queryByRole('table')).toBeNull()
    }
  })

  it('AC-A12: de periodiseringsbron meldt afgekapt bij totaal > binnengekomen rijen (3 van 905), onafhankelijk van de belasting', async () => {
    await renderInzichten(periodiseringDb(), {
      over: {
        handlers: {
          ...MET_DATA,
          inzichten_training_koppelingen: (d, a) =>
            a.p_start === '2026-09-01' ? hKoppelingen(d, a).slice(0, 3).map((r) => ({ ...r, totaal: 905 })) : hKoppelingen(d, a),
        },
      },
    })
    expect(within(PER()).getByText(i.periodiseringAfgekapt)).toBeInTheDocument()
    expect(within(PER()).queryByText(i.afgekaptTraining)).toBeNull() // eigen tekst, zonder "kies een kortere periode"
    expect(i.periodiseringAfgekapt).not.toMatch(/kortere periode/)
    expect(within(PER()).queryByRole('table')).toBeNull()
    expect(within(BEL()).queryByText(i.afgekaptTraining)).toBeNull()
    expect(within(BEL()).queryByText(i.periodiseringAfgekapt)).toBeNull()
    expect(weekRijen().length).toBeGreaterThan(0)
  })

  it('AC-A12: precies 901 rijen met totaal 901 voor de periodisering is afgekapt', async () => {
    const basis = hKoppelingen(periodiseringDb(), { p_team_id: TEAM, p_start: '2026-09-01', p_end: '2026-10-14' })[0]
    const rijen901 = Array.from({ length: 901 }, (_, n) => ({ ...basis, koppeling_id: `k${n}`, totaal: 901 }))
    await renderInzichten(periodiseringDb(), {
      over: { handlers: { ...MET_DATA, inzichten_training_koppelingen: (d, a) => (a.p_start === '2026-09-01' ? rijen901 : hKoppelingen(d, a)) } },
    })
    expect(within(PER()).getByText(i.periodiseringAfgekapt)).toBeInTheDocument()
    expect(within(PER()).queryByText(i.afgekaptTraining)).toBeNull()
    expect(within(PER()).queryByRole('table')).toBeNull()
  })
})

describe('AC-A13 — alleen lezen: geen schrijfpad; overige kaarten ongewijzigd', () => {
  it('AC-A13: de pagina schrijft niets (geen insert/update/upsert/delete) en roept alleen de twee leesfuncties aan', async () => {
    const { h } = await renderInzichten(combiDb())
    expect(h.writes).toEqual([])
    const nieuw = new Set(h.rpcCalls.map((c) => c.name).filter((n) => /koppelingen|discipline/.test(n)))
    expect([...nieuw].sort()).toEqual(['inzichten_invul_discipline', 'inzichten_training_koppelingen'])
  })

  it('AC-A13: rating-, vorm-, trend- en periodiseringsuitkomsten van de bestaande kaarten zijn byte-gelijk met en zonder fase-3a-gegevens (metingen, afvinkingen, discipline-bron)', async () => {
    const met = await renderInzichten(combiDb())
    const a = zonderKaarten(met.container, NIEUWE_TITELS)
    cleanup()
    const db = combiDb()
    db.categorie_metingen = []
    db.task_overrides = []
    const zonder = await renderInzichten(db, { over: { handlers: { ...MET_DATA, inzichten_invul_discipline: () => [] } } })
    expect(zonderKaarten(zonder.container, NIEUWE_TITELS)).toBe(a)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC-B — Belasting in minuten per categorie per week
// ═══════════════════════════════════════════════════════════════════════
describe('AC-B — belasting', () => {
  it('AC-B.1 / AC-B.2 / AC-B.8: minuten per categorie per week in tien vaste kolommen; koppeling wint, NULL volgt de bibliotheek, 0 = geen duur', async () => {
    await renderInzichten(belastingDb())
    expect(within(BEL()).getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      i.kolomWeek, ...CATS.map((c) => nl.periodization.categories[c as keyof typeof nl.periodization.categories]), i.kolomTrainingstotaal,
    ])
    const rijen = weekRijen()
    expect(wk(rijen, 40).cellen).toEqual(WK40)
    expect(wk(rijen, 41).cellen).toEqual(WK41)
    expect(wk(rijen, 42).cellen).toEqual(WK42)
    // wu: koppeling 15 wint van bibliotheek 10; pg: NULL -> bibliotheek 25; sw: 0 -> GEEN duur (niet de bibliotheek 12)
    expect(wk(rijen, 41).cellen[0]).toBe('15')
    expect(wk(rijen, 41).cellen[1]).toBe('25')
    expect(wk(rijen, 41).cellen[6]).toBe('0')
  })

  it('AC-B.2 / pariteit: het trainingstotaal per week is gelijk aan de som van berekenTijdlijn(blokkenVanKoppelingen(...)) uit de echte planner', async () => {
    const db = belastingDb()
    await renderInzichten(db)
    const rijen = weekRijen()
    const maandagVan = (d: string) => {
      const ms = Date.parse(`${d}T00:00:00Z`)
      const dag = new Date(ms).getUTCDay()
      return new Date(ms - ((dag + 6) % 7) * 86_400_000).toISOString().slice(0, 10)
    }
    const perMaandag: Record<string, number> = {}
    for (const e of db.events) {
      if ((e.date as string) > '2026-10-14') continue
      const leden = db.training_oefeningen.filter((k) => k.event_id === e.id).map((k) => {
        const o = db.oefeningen.find((x) => x.id === k.oefening_id && x.leesbaar !== false)
        return {
          id: k.id as string, volgorde: k.volgorde as number, created_at: k.created_at as string,
          parallel_groep_id: (k.parallel_groep_id as string | null) ?? null, duur_min: (k.duur_min as number | null) ?? null,
          oefeningen: o ? { duur_min: o.duur_min as number | null } : null,
        }
      })
      const totaal = berekenTijdlijn(blokkenVanKoppelingen(leden), null).totaalMin
      const m = maandagVan(e.date as string)
      perMaandag[m] = (perMaandag[m] ?? 0) + totaal
    }
    expect(perMaandag).toEqual({ '2026-09-28': 53, '2026-10-05': 80, '2026-10-12': 20 }) // zelfde handtotalen
    for (const [maandag, totaal] of Object.entries(perMaandag)) {
      const week = rijen.find((r) => r.label.endsWith(kort(maandag)))!
      expect(week.cellen[10].replace(' *', ''), maandag).toBe(String(totaal))
    }
  })

  it('AC-B.4: koppelingen zonder duur tellen niet als 0 minuten en hun aantal is zichtbaar; het trainingstotaal wordt als onvolledig gemarkeerd', async () => {
    const db = belastingDb()
    await renderInzichten(db)
    expect(within(BEL()).getByText(fmt(i.belastingZonderDuur, { n: 1 }))).toBeInTheDocument()
    expect(wk(weekRijen(), 41).cellen[10]).toBe('80 *')
    expect(within(BEL()).getByText(i.belastingTotaalOnvolledig)).toBeInTheDocument()
    expect(wk(weekRijen(), 40).cellen[10]).toBe('53') // week zonder blok zonder duur: geen sterretje
  })

  it('AC-B.4 / AC-A2: een oefening zonder leesrecht wordt zichtbaar geteld (melding), draagt haar koppelingsduur bij aan het trainingstotaal en verdwijnt nooit stil', async () => {
    await renderInzichten(belastingDb())
    expect(within(BEL()).getByText(fmt(i.belastingOnbekend, { n: 1 }))).toBeInTheDocument()
    expect(wk(weekRijen(), 40).cellen[10]).toBe('53') // 18 (teamgenoot) + 35 (niet-leesbare oefening)
    expect(wk(weekRijen(), 40).cellen[4]).toBe('0') // niet in positiespel (bibliotheekcategorie van de onleesbare oefening)
  })

  it('AC-B.5: een training zonder trainingsplan draagt niets bij en het aantal is zichtbaar; zonder enige oefening is de week "0", niet "geen gegevens"', async () => {
    const db = leegDb({ events: [tr(U('eb', 1), '2026-10-06'), tr(U('eb', 2), '2026-10-07')], oefeningen: bibliotheek() })
    await renderInzichten(db)
    expect(within(BEL()).getByText(fmt(i.belastingZonderOefeningen, { n: 2 }))).toBeInTheDocument()
    expect(wk(weekRijen(), 41).cellen).toEqual(cellen({}, '0'))
    expect(wk(weekRijen(), 40).cellen).toEqual(GEEN_WEEK)
    expect(within(BEL()).queryByText(i.belastingEmpty)).toBeNull()
  })

  it('AC-B.5: in de hoofdfixture is het aantal trainingen zonder oefeningen 1 (td)', async () => {
    await renderInzichten(belastingDb())
    expect(within(BEL()).getByText(fmt(i.belastingZonderOefeningen, { n: 1 }))).toBeInTheDocument()
  })

  it('AC-B.6: een week zonder trainingen toont "geen gegevens" in elke cel; een week met trainingen maar zonder minuten in een categorie toont "0"', async () => {
    await renderInzichten(belastingDb())
    const rijen = weekRijen()
    for (const week of [31, 32, 33, 34, 35, 36, 37, 38, 39]) expect(wk(rijen, week).cellen, `wk ${week}`).toEqual(GEEN_WEEK)
    expect(wk(rijen, 42).cellen[0]).toBe('0')
    expect(wk(rijen, 41).cellen[4]).toBe('0') // positiespel
  })

  it('AC-B.6: deelweken aan begin en eind zijn herkenbaar met het label "deelweek"; middenweken niet', async () => {
    await renderInzichten(belastingDb())
    const rijen = weekRijen()
    expect(rijen.map((r) => r.deelweek)).toEqual([true, false, false, false, false, false, false, false, false, false, false, true])
    expect(within(BEL()).getAllByText(i.deelweekLabel)).toHaveLength(2)
  })

  it('AC-B.6: een venster binnen één week levert één week die zowel begin- als eind-deelweek is', async () => {
    // Seizoen start op een woensdag en vandaag is de vrijdag erna: venster 2026-10-14..2026-10-16 -> één week.
    zetKlok('2026-10-17', 10, 0)
    const db = leegDb({ events: [tr(U('ec', 1), '2026-10-15')], oefeningen: bibliotheek() }, ['2026-10-14', '2027-06-30'])
    await renderInzichten(db)
    const rijen = weekRijen()
    expect(rijen).toHaveLength(1)
    expect(rijen[0].label).toBe(`wk 42 · ${kort('2026-10-12')}`)
    expect(rijen[0].deelweek).toBe(true)
  })

  it('AC-B.7: trainingen van vandaag en uit de toekomst tellen niet mee (niet in de tabel, niet in de staven)', async () => {
    const { h } = await renderInzichten(belastingDb())
    expect(wk(weekRijen(), 42).cellen).toEqual(WK42) // 99 (vandaag) en 88 (toekomst) ontbreken
    expect(weekRijen()).toHaveLength(12) // geen week 43
    expect(BEL().textContent).not.toMatch(/\b(99|88)\b/)
    expect(calls(h, 'inzichten_training_koppelingen')[0].args.p_end).toBe('2026-10-14')
  })

  it('AC-B.9: parallelle groep — per categorie telt elk lid zijn eigen duur (20 + 30), het trainingstotaal alleen de langste (30)', async () => {
    const id = U('ed', 1)
    const groep = U('9a', 5)
    const db = leegDb({
      events: [tr(id, '2026-10-06')],
      oefeningen: bibliotheek(),
      training_oefeningen: [kp(id, O.pm, { duur_min: 20, parallel_groep_id: groep, volgorde: 1 }), kp(id, O.pk, { duur_min: 30, parallel_groep_id: groep, volgorde: 1 })],
    })
    await renderInzichten(db)
    expect(wk(weekRijen(), 41).cellen).toEqual(cellen({ partijen_midden: 20, partijen_klein: 30 }, '30'))
  })

  it('AC-B.9: een parallelle groep met één overgebleven lid is een los blok (telt gewoon mee)', async () => {
    const id = U('ed', 2)
    const db = leegDb({
      events: [tr(id, '2026-10-06')],
      oefeningen: bibliotheek(),
      training_oefeningen: [kp(id, O.pm, { duur_min: 20, parallel_groep_id: U('9a', 6), volgorde: 1 }), kp(id, O.pk, { duur_min: 30, volgorde: 2 })],
    })
    await renderInzichten(db)
    expect(wk(weekRijen(), 41).cellen).toEqual(cellen({ partijen_midden: 20, partijen_klein: 30 }, '50'))
  })

  it('AC-B.10: genest is additief — een kind (10) bij een ouder (30 parallel) maakt het trainingstotaal 40', async () => {
    await renderInzichten(belastingDb())
    // tb = groep pm(20)+pk(30) -> 30, plus genest kind ov(10) -> 40; samen met ta (40) is wk41 = 80
    expect(wk(weekRijen(), 41).cellen[9]).toBe('10')
    expect(wk(weekRijen(), 41).cellen[10]).toBe('80 *')
  })

  it('AC-B.11: teamtactische trainingen tellen mee in de belasting', async () => {
    await renderInzichten(belastingDb())
    expect(wk(weekRijen(), 42).cellen[1]).toBe('20') // tc = teamtactisch
    expect(wk(weekRijen(), 42).cellen[10]).toBe('20')
  })

  it('AC-B.12: een gewijzigde bibliotheekduur werkt door in een koppeling zonder eigen duur, niet in een koppeling met eigen duur; de toelichting vermeldt dit', async () => {
    const db = belastingDb()
    db.oefeningen.find((o) => o.id === O.pg)!.duur_min = 40 // koppeling NULL: volgt
    db.oefeningen.find((o) => o.id === O.wu)!.duur_min = 99 // koppeling eigen 15: onveranderd
    await renderInzichten(db)
    // ta: pg 40 + wu 15 = 55; tb 40 -> wk41 = 95 *
    expect(wk(weekRijen(), 41).cellen).toEqual(cellen({ warming_up: 15, partijen_groot: 40, partijen_midden: 20, partijen_klein: 30, overig: 10 }, '95 *'))
    expect(within(BEL()).getByText(i.belastingMomentopname)).toBeInTheDocument()
  })

  it('AC-B.3: de voettekst legt de som-per-categorie uit (Q2) en de momentopname-regel is er altijd', async () => {
    await renderInzichten(belastingDb())
    expect(within(BEL()).getByText(i.belastingSomUitleg)).toBeInTheDocument()
    expect(within(BEL()).getByText(i.belastingMomentopname)).toBeInTheDocument()
  })

  it('AC-B.6: zonder trainingen in het venster toont de kaart haar uitleg-lege staat (niet een tabel vol nullen)', async () => {
    await renderInzichten(leegDb())
    expect(within(BEL()).getByText(i.belastingEmpty)).toBeInTheDocument()
  })

  it('AC-B.1: jaarwisseling — weken 52, 53 (2020-stijl: 2026 heeft 53 weken) en 1 staan in de juiste volgorde met de juiste totalen', async () => {
    zetKlok('2027-01-20', 10, 0)
    const ids = [U('ee', 1), U('ee', 2), U('ee', 3), U('ee', 4)]
    const db = leegDb({
      events: [tr(ids[0], '2026-12-23'), tr(ids[1], '2027-01-01'), tr(ids[2], '2027-01-03'), tr(ids[3], '2027-01-04')],
      oefeningen: bibliotheek(),
      training_oefeningen: [
        kp(ids[0], O.wu, { duur_min: 10 }), kp(ids[1], O.pg, { duur_min: 20 }), kp(ids[2], O.pg, { duur_min: 5 }), kp(ids[3], O.pm, { duur_min: 30 }),
      ],
    }, ['2026-12-01', '2027-02-28'])
    await renderInzichten(db)
    const rijen = weekRijen()
    expect(rijen.map((r) => r.label)).toEqual([
      `wk 49 · ${kort('2026-11-30')}`, `wk 50 · ${kort('2026-12-07')}`, `wk 51 · ${kort('2026-12-14')}`, `wk 52 · ${kort('2026-12-21')}`,
      `wk 53 · ${kort('2026-12-28')}`, `wk 1 · ${kort('2027-01-04')}`, `wk 2 · ${kort('2027-01-11')}`, `wk 3 · ${kort('2027-01-18')}`,
    ])
    expect(wk(rijen, 52).cellen).toEqual(cellen({ warming_up: 10 }, '10'))
    expect(wk(rijen, 53).cellen).toEqual(cellen({ partijen_groot: 25 }, '25')) // vr 1 jan + zo 3 jan: nog 2026-week 53
    expect(wk(rijen, 1).cellen).toEqual(cellen({ partijen_midden: 30 }, '30'))
    expect(rijen.filter((r) => r.deelweek).map((r) => r.label.split(' · ')[0])).toEqual(['wk 49', 'wk 3'])
  })

  it('AC-B.1: schrikkeljaar — 29 feb en 1 mrt 2028 vallen in dezelfde week (wk 9) en 29 feb verschuift niet', async () => {
    zetKlok('2028-03-10', 10, 0)
    const ids = [U('ef', 1), U('ef', 2)]
    const db = leegDb({
      events: [tr(ids[0], '2028-02-29'), tr(ids[1], '2028-03-01')],
      oefeningen: bibliotheek(),
      training_oefeningen: [kp(ids[0], O.pg, { duur_min: 40 }), kp(ids[1], O.pg, { duur_min: 20 })],
    }, ['2028-02-01', '2028-04-30'])
    await renderInzichten(db)
    const rijen = weekRijen()
    expect(wk(rijen, 9).label).toBe(`wk 9 · ${kort('2028-02-28')}`)
    expect(wk(rijen, 9).cellen).toEqual(cellen({ partijen_groot: 60 }, '60'))
    expect(rijen.filter((r) => r.cellen[10] !== G)).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC-P — Periodisering-voortgang
// ═══════════════════════════════════════════════════════════════════════
describe('AC-P — periodisering', () => {
  it('AC-P.1 / AC-P.2: één punt per VCT-training (plus de meetdatum) — stappen 3,3,3,3,4,5,5,6 (k0..k6, zelfde dag telt niet, training op de meetdatum geeft geen punt)', async () => {
    await renderInzichten(periodiseringDb())
    const pg = onderdeel('partijen_groot')
    expect(pg.punten).toEqual([
      [kort('2026-09-01'), '3', i.bronMeting],
      [kort('2026-09-08'), '3', i.bronTraining],
      [kort('2026-09-15'), '3', i.bronTraining],
      [kort('2026-09-15'), '3', i.bronTraining],
      [kort('2026-09-22'), '4', i.bronTraining],
      [kort('2026-09-29'), '5', i.bronTraining],
      [kort('2026-10-06'), '5', i.bronTraining],
      [kort('2026-10-13'), '6', i.bronTraining],
    ])
  })

  it('AC-P.2 / AC-P.6: een latere meting werkt niet terug — oudere punten blijven staan; op de meetdatum zelf gebruikt de training de vorige meting en komt eerst; een nieuwe meting zet k terug', async () => {
    await renderInzichten(periodiseringDb())
    expect(onderdeel('partijen_midden').punten).toEqual([
      [kort('2026-09-01'), '5', i.bronMeting],
      [kort('2026-09-08'), '5', i.bronTraining],
      [kort('2026-09-15'), '5', i.bronTraining],
      [kort('2026-09-22'), '6', i.bronTraining],
      [kort('2026-09-25'), '6', i.bronTraining], // nog de oude meting (5 + floor(3/2))
      [kort('2026-09-25'), '2', i.bronMeting],
      [kort('2026-09-29'), '2', i.bronTraining],
      [kort('2026-10-06'), '2', i.bronTraining],
      [kort('2026-10-13'), '3', i.bronTraining],
    ])
  })

  it('AC-P.3: nulmeting = eerste meting ooit; huidige stap = stand t/m gisteren; progressie in stappen met teken (+3, −2), geen percentage', async () => {
    await renderInzichten(periodiseringDb())
    const pg = onderdeel('partijen_groot')
    expect(pg.nulmeting).toBe(`stap 3 · ${kort('2026-09-01')}`)
    expect(pg.huidig).toBe('stap 6 max 21')
    expect(pg.voortgang).toBe(fmt(i.voortgangWaarde, { verschil: '+3' }))
    const pm = onderdeel('partijen_midden')
    expect(pm.nulmeting).toBe(`stap 5 · ${kort('2026-09-01')}`) // niet de nieuwste (stap 2)
    expect(pm.huidig).toBe('stap 3 max 15')
    expect(pm.voortgang).toBe(fmt(i.voortgangWaarde, { verschil: '−2' }))
    expect(PER().textContent).not.toContain('%')
  })

  it('AC-P.3 / Q3: een stap_override is zichtbaar als handmatig; de teller k loopt gewoon door', async () => {
    await renderInzichten(periodiseringDb())
    const pk = onderdeel('partijen_klein')
    expect(pk.punten).toEqual([
      [kort('2026-09-01'), '4', i.bronMeting],
      [kort('2026-09-08'), '4', i.bronTraining],
      [kort('2026-09-15'), '9', i.bronHandmatig],
      [kort('2026-09-22'), '5', i.bronTraining],
      [kort('2026-09-29'), '5', i.bronTraining],
    ])
    expect(pk.huidig).toBe('stap 6 max 13')
    expect(pk.voortgang).toBe(fmt(i.voortgangWaarde, { verschil: '+2' }))
  })

  it('AC-P.2 / Q3: een stap boven het maximum wordt getoond zoals hij is (16 bij max 14), niet begrensd', async () => {
    await renderInzichten(periodiseringDb())
    const sw = onderdeel('sprints_weinig_rust')
    expect(sw.punten.map((p) => p[1])).toEqual(['13', '13', '13', '14', '14', '15', '15'])
    expect(sw.huidig).toBe('stap 16 max 14')
    expect(sw.voortgang).toBe(fmt(i.voortgangWaarde, { verschil: '+3' }))
  })

  it('AC-P.4: één meting en nog geen trainingen -> huidige stap + "nog geen voortgang te tonen"', async () => {
    const db = leegDb({ categorie_metingen: [mt('partijen_groot', '2026-09-01', 7)] })
    await renderInzichten(db, { over: { handlers: LEEG } })
    const pg = onderdeel('partijen_groot')
    expect(pg.nulmeting).toBe(`stap 7 · ${kort('2026-09-01')}`)
    expect(pg.huidig).toBe('stap 7 max 21')
    expect(pg.voortgang).toBe(i.periodiseringGeenVoortgang)
    expect(pg.heeftDetails).toBe(true)
    expect(pg.punten).toEqual([[kort('2026-09-01'), '7', i.bronMeting]])
  })

  it('AC-P.5: onderdelen zonder meting staan er als "nog niet gemeten" (ook met trainingen in dat onderdeel; een toekomstige meting telt niet) en een gemeten onderdeel staat in vaste volgorde', async () => {
    await renderInzichten(periodiseringDb())
    const namen = within(PER()).getAllByRole('rowheader').map((th) => th.textContent)
    expect(namen).toEqual(['partijen_groot', 'partijen_midden', 'partijen_klein', 'sprints_weinig_rust', 'sprints_veel_rust'].map((c) => nl.periodization.categories[c as keyof typeof nl.periodization.categories]))
    expect(onderdeel('sprints_veel_rust').nulmeting).toBe(i.periodiseringNietGemeten)
  })

  it('AC-P.5: alleen een toekomstige meting -> lege staat "nog geen meting", géén tweede koppelingen-aanroep', async () => {
    const db = leegDb({ categorie_metingen: [mt('partijen_groot', '2026-11-01', 3)], events: [tr(U('e7', 8), '2026-09-08')], oefeningen: bibliotheek(), training_oefeningen: [kp(U('e7', 8), O.pg)] })
    const { h } = await renderInzichten(db)
    expect(within(PER()).getByText(i.periodiseringEmpty)).toBeInTheDocument()
    expect(calls(h, 'inzichten_training_koppelingen')).toHaveLength(1) // alleen de belasting
  })

  it('AC-P.6: vóór de eerste meting geen verzonnen stap of punt — trainingen van vóór en op de meetdatum geven geen trainingspunt', async () => {
    await renderInzichten(periodiseringDb())
    const datums = onderdeel('partijen_groot').punten.map((p) => p[0])
    expect(datums).not.toContain(kort('2026-08-25'))
    expect(datums.filter((d) => d === kort('2026-09-01'))).toHaveLength(1) // alleen de meting zelf
  })

  it('AC-P.6 / AC-A11: een meting van vóór de seizoensstart telt de trainingen van vóór het seizoen mee voor k, maar die staan niet als punt; de meting zelf ook niet', async () => {
    const events: Row[] = []
    const kops: Row[] = []
    for (const [n, d] of ['2026-07-08', '2026-07-15', '2026-08-05', '2026-08-12', '2026-08-19'].entries()) {
      events.push(tr(U('e7', 20 + n), d))
      kops.push(kp(U('e7', 20 + n), O.sv))
    }
    const db = leegDb({ events, oefeningen: bibliotheek(), training_oefeningen: kops, categorie_metingen: [mt('sprints_veel_rust', '2026-07-01', 4)] })
    const { h } = await renderInzichten(db)
    const sv = onderdeel('sprints_veel_rust')
    // k bij 5-8 = 2 (8-7, 15-7) -> 4+1 = 5; 12-8 k3 -> 5; 19-8 k4 -> 6
    expect(sv.punten).toEqual([[kort('2026-08-05'), '5', i.bronTraining], [kort('2026-08-12'), '5', i.bronTraining], [kort('2026-08-19'), '6', i.bronTraining]])
    expect(sv.nulmeting).toBe(`stap 4 · ${kort('2026-07-01')}`)
    expect(sv.huidig).toBe('stap 6 max 13')
    const per = calls(h, 'inzichten_training_koppelingen')[1]
    expect(per.args).toMatchObject({ p_start: '2026-07-01', p_end: '2026-10-14' })
  })

  it('AC-P.7: teamtactische trainingen worden uitgesloten (geen punt, geen invloed op k)', async () => {
    await renderInzichten(periodiseringDb())
    // De teamtactische pg-training van 20-9 zou k bij 22-9 op 4 zetten (stap 5); met uitsluiting blijft het 4.
    expect(onderdeel('partijen_groot').punten.find((p) => p[0] === kort('2026-09-22'))![1]).toBe('4')
    expect(onderdeel('partijen_groot').punten.map((p) => p[0])).not.toContain(kort('2026-09-20'))
  })

  it('AC-P.8: alleen de stap per onderdeel — vier kolommen en geen cyclusweek-naleving', async () => {
    await renderInzichten(periodiseringDb())
    expect([...within(PER()).getAllByRole('table')[0].querySelectorAll(':scope > thead th')].map((c) => c.textContent)).toEqual([i.kolomOnderdeel, i.kolomNulmeting, i.kolomHuidigeStap, i.kolomVoortgang])
    expect(PER().textContent).not.toMatch(/cyclus|naleving/i)
  })

  it('AC-P.9: een lijn én een tabel — svg-staplijn (aria-hidden) plus <details> met alle punten', async () => {
    await renderInzichten(periodiseringDb())
    const pg = onderdeel('partijen_groot')
    expect(pg.heeftSvg).toBe(true)
    expect(pg.punten).toHaveLength(8)
    expect(within(PER()).getAllByText(i.reeksBekijken).length).toBe(4) // één per gemeten onderdeel
  })

  it('AC-P.10: schrijft niets (momentopname-reconstructie)', async () => {
    const { h } = await renderInzichten(periodiseringDb())
    expect(h.writes).toEqual([])
  })

  it('AC-P.2 / AC-A2: een training met een niet-leesbare oefening wordt zichtbaar gemeld (onbekend), nooit stil weggelaten', async () => {
    await renderInzichten(periodiseringDb())
    expect(within(PER()).getByText(fmt(i.belastingOnbekend, { n: 1 }))).toBeInTheDocument()
  })

  it('AC-P.1 / Q6: de periodisering toont altijd het hele seizoen t/m gisteren, ongeacht de periodekiezer', async () => {
    const seizoen = await renderInzichten(periodiseringDb())
    const html = PER().innerHTML
    cleanup()
    const vier = await renderInzichten(periodiseringDb(), { periode: '4w' })
    expect(PER().innerHTML).toBe(html)
    cleanup()
    const acht = await renderInzichten(periodiseringDb(), { periode: '8w' })
    expect(PER().innerHTML).toBe(html)
    for (const r of [seizoen, vier, acht]) {
      const per = calls(r.h, 'inzichten_training_koppelingen')[1]
      expect(per.args).toEqual({ p_team_id: TEAM, p_start: '2026-09-01', p_end: '2026-10-14' }) // vroegste meting t/m gisteren
    }
  })

  it('AC-P.2: pariteit — elke trainingsstap in de kaart is gelijk aan getTrainingLog(...).currentSteps van de echte planner op die trainingsdatum; de huidige stap gelijk aan de planner op vandaag', async () => {
    const db = periodiseringDb()
    const { h } = await renderInzichten(db)
    const metingen = db.categorie_metingen as unknown as CategorieMeting[]
    const client = makeClient(h) as unknown as Parameters<typeof getTrainingLog>[0]
    // Trainingsdatums per onderdeel zoals in de fixture (met de hand opgeschreven, niet uit de kaart afgeleid).
    const datums: Record<string, string[]> = {
      partijen_groot: ['2026-09-08', '2026-09-15', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'],
      partijen_midden: ['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-25', '2026-09-29', '2026-10-06', '2026-10-13'],
      sprints_weinig_rust: ['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'],
    }
    let vergeleken = 0
    for (const [sleutel, lijst] of Object.entries(datums)) {
      const trainingen = onderdeel(sleutel).punten.filter((p) => p[2] === i.bronTraining)
      expect(trainingen.map((p) => p[0]), sleutel).toEqual(lijst.map(kort))
      for (const [n, d] of lijst.entries()) {
        const planner = await getTrainingLog(client, TEAM, actueleMetingen(metingen, d), d)
        expect(Number(trainingen[n][1]), `${sleutel} ${d}`).toBe(planner.currentSteps[sleutel])
        vergeleken++
      }
    }
    expect(vergeleken).toBe(20)
    const nu = await getTrainingLog(client, TEAM, actueleMetingen(metingen, TODAY), TODAY)
    for (const sleutel of ['partijen_groot', 'partijen_midden', 'partijen_klein', 'sprints_weinig_rust']) {
      expect(onderdeel(sleutel).huidig, sleutel).toContain(`stap ${nu.currentSteps[sleutel]} `)
    }
    expect(nu.currentSteps.sprints_veel_rust).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC-D — Invul-discipline
// ═══════════════════════════════════════════════════════════════════════
describe('AC-D — invul-discipline', () => {
  it('AC-D.1 / AC-D.2 / AC-D.3: "x van y" voor analyse (5 van 8), uitslag (2 van 8) en trainingsplan (3 van 6); vandaag, toekomst en een ander eventtype tellen niet in de noemer', async () => {
    await renderInzichten(disciplineDb())
    const k = DIS()
    const dts = [...k.querySelectorAll('dt')].map((dt) => dt.textContent)
    expect(dts).toEqual([
      fmt(i.disciplineAnalyse, { x: 5, y: 8 }),
      fmt(i.disciplineUitslag, { x: 2, y: 8 }),
      fmt(i.disciplinePlan, { x: 3, y: 6 }),
    ])
  })

  it('AC-D.1: analyse volgt analyseBestaat — uitslag, rating OF wedstrijdmoment telt; alleen goals_for zonder rating niet', async () => {
    const m = [U('e5', 41), U('e5', 42), U('e5', 43), U('e5', 44), U('e5', 45)]
    const db = leegDb({
      events: [
        wed(m[0], '2026-09-01', { goals_for: 0, goals_against: 0 }), // uitslag 0-0: telt (0 is ingevuld)
        wed(m[1], '2026-09-02'), // rating
        wed(m[2], '2026-09-03'), // moment
        wed(m[3], '2026-09-04', { goals_for: 2 }), // alleen goals_for -> geen analyse, geen uitslag
        wed(m[4], '2026-09-05'), // niets
      ],
      match_ratings: [rating(m[1])],
      match_events: [moment(m[2])],
    })
    await renderInzichten(db)
    expect(DIS().textContent).toContain(fmt(i.disciplineAnalyse, { x: 3, y: 5 }))
    expect(DIS().textContent).toContain(fmt(i.disciplineUitslag, { x: 1, y: 5 }))
  })

  it('AC-D.3: plan volgt hasTrainingPlanDone — doelstelling (ook " "), of minstens één oefening; "" zonder oefeningen niet', async () => {
    await renderInzichten(disciplineDb())
    // T1 'Passen', T2 twee oefeningen, T3 ' ' = 3; T4 '' en T5/T7 leeg tellen niet
    expect(DIS().textContent).toContain(fmt(i.disciplinePlan, { x: 3, y: 6 }))
  })

  it('AC-D.7 / Q4: handmatig afgevinkt telt NIET als ingevuld en staat apart ("1 handmatig afgevinkt") bij analyse én plan; handmatig bij al-ingevuld telt niet extra; een override van het verkeerde type telt niet', async () => {
    await renderInzichten(disciplineDb())
    const k = DIS()
    expect(tekstenMet(k, fmt(i.disciplineHandmatig, { n: 1 }))).toHaveLength(2)
    // analyse blijft 5 (M4 handmatig telt niet; M5 handmatig+auto telt niet dubbel; M10 verkeerd type)
    expect(k.textContent).toContain(fmt(i.disciplineAnalyse, { x: 5, y: 8 }))
    // geen handmatig-regel als er geen is
    cleanup()
    const db = disciplineDb()
    db.task_overrides = []
    await renderInzichten(db)
    expect(DIS().textContent).not.toContain(fmt(i.disciplineHandmatig, { n: 1 }))
    expect(DIS().textContent).not.toMatch(/handmatig afgevinkt/)
  })

  it('AC-D.4 / Q4: de kaart meldt altijd waarom aanwezigheid ontbreekt en toont geen aanwezigheidsmaat', async () => {
    await renderInzichten(disciplineDb())
    expect(within(DIS()).getByText(i.disciplineAanwezigheid)).toBeInTheDocument()
    expect(DIS().querySelectorAll('dt')).toHaveLength(3)
  })

  it('AC-D.5: noemer 0 -> "geen gespeelde wedstrijden" per wedstrijdmaat, de trainingsmaat blijft; zonder trainingen omgekeerd', async () => {
    const alleenTrainingen = disciplineDb()
    alleenTrainingen.events = alleenTrainingen.events.filter((e) => e.type === 'training')
    await renderInzichten(alleenTrainingen)
    expect([...DIS().querySelectorAll('dt')].map((x) => x.textContent)).toEqual([
      i.disciplineGeenWedstrijden, i.disciplineGeenWedstrijden, fmt(i.disciplinePlan, { x: 3, y: 6 }),
    ])
    expect(DIS().textContent).toContain(i.disciplineAanwezigheid)
    cleanup()
    const alleenWedstrijden = disciplineDb()
    alleenWedstrijden.events = alleenWedstrijden.events.filter((e) => e.type === 'match')
    await renderInzichten(alleenWedstrijden)
    expect([...DIS().querySelectorAll('dt')].map((x) => x.textContent)).toEqual([
      fmt(i.disciplineAnalyse, { x: 5, y: 8 }), fmt(i.disciplineUitslag, { x: 2, y: 8 }), i.disciplineGeenTrainingen,
    ])
    expect(DIS().textContent).not.toMatch(/NaN|Infinity/)
  })

  it('AC-D.5: een noemer 0 toont geen meter (geen verzonnen 0%)', async () => {
    const db = disciplineDb()
    db.events = db.events.filter((e) => e.type === 'training')
    await renderInzichten(db)
    expect(DIS().querySelectorAll('[aria-hidden="true"]')).toHaveLength(1) // alleen de planmeter
  })

  it('AC-D.6: betrouwbaarheidscontext zonder oordeel — geen drempel/kleur/advies, alleen de omschrijving "context, geen oordeel"', async () => {
    await renderInzichten(disciplineDb())
    expect(DIS().textContent).toContain(i.disciplineDescription)
    expect(i.disciplineDescription).toMatch(/geen oordeel/)
    expect(DIS().querySelectorAll('[role="alert"]')).toHaveLength(0)
  })

  it('AC-D.8 / Q6: discipline volgt de gekozen periode t/m gisteren (4w: 18 sep t/m 14 okt) en telt daarbinnen', async () => {
    const { h } = await renderInzichten(disciplineDb(), { periode: '4w' })
    expect(calls(h, 'inzichten_invul_discipline')[0].args).toEqual({ p_team_id: TEAM, p_start: '2026-09-18', p_end: '2026-10-14' })
    // wedstrijden 19-9 (M3), 26-9 (M4), 3-10 (M5), 10-10 (M6), 12-10 (M10) = 5; analyse M3, M5 = 2; uitslag M5 = 1; handmatig M4 = 1
    // trainingen 24-9 (T5), 14-10 (T7) = 2; plan 0 (T5 heeft alleen een override van het verkeerde type)
    expect([...DIS().querySelectorAll('dt')].map((x) => x.textContent)).toEqual([
      fmt(i.disciplineAnalyse, { x: 2, y: 5 }), fmt(i.disciplineUitslag, { x: 1, y: 5 }), fmt(i.disciplinePlan, { x: 0, y: 2 }),
    ])
    expect(tekstenMet(DIS(), fmt(i.disciplineHandmatig, { n: 1 }))).toHaveLength(1)
  })

  it('AC-D.9: geen invul-knop of link in de kaart', async () => {
    await renderInzichten(disciplineDb())
    expect(DIS().querySelectorAll('a, button, input')).toHaveLength(0)
  })

  it('AC-D.10: geen wedstrijden of trainingen in bereik -> lege staat per maat (de hele kaart)', async () => {
    await renderInzichten(leegDb())
    expect(within(DIS()).getByText(i.disciplineEmpty)).toBeInTheDocument()
    expect(DIS().querySelectorAll('dt')).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Q6 — vensters per kaart (mutatiepunten 1 en 2)
// ═══════════════════════════════════════════════════════════════════════
describe('Q6 — vensters: belasting en discipline volgen de periode t/m gisteren, periodisering het hele seizoen vanaf de vroegste meting', () => {
  it.each([
    ['seizoen', undefined, '2026-08-01'],
    ['4w', '4w', '2026-09-18'],
    ['8w', '8w', '2026-08-21'],
  ])('Q6: periode %s -> belasting en discipline (%s) krijgen start %s en einde gisteren; periodisering vroegste meting t/m gisteren', async (_naam, periode, start) => {
    const { h } = await renderInzichten(periodiseringDb(), { periode })
    const kopp = calls(h, 'inzichten_training_koppelingen')
    expect(kopp).toHaveLength(2)
    expect(kopp[0].args).toEqual({ p_team_id: TEAM, p_start: start, p_end: '2026-10-14' })
    expect(kopp[1].args).toEqual({ p_team_id: TEAM, p_start: '2026-09-01', p_end: '2026-10-14' })
    expect(calls(h, 'inzichten_invul_discipline')[0].args).toEqual({ p_team_id: TEAM, p_start: start, p_end: '2026-10-14' })
  })

  it('Q6: bij 4w begint de belastingtabel in de deelweek van 18 sep (wk 38) en eindigt in wk 42', async () => {
    await renderInzichten(belastingDb(), { periode: '4w' })
    const rijen = weekRijen()
    expect(rijen.map((r) => r.label.split(' · ')[0])).toEqual(['wk 38', 'wk 39', 'wk 40', 'wk 41', 'wk 42'])
    expect(rijen[0].deelweek).toBe(true)
    expect(rijen[4].deelweek).toBe(true)
  })

  it('B1 (Q6): seizoen nog niet begonnen MÉT metingen -> tabel met nulmeting, huidige stap en verschil per gemeten onderdeel, plus de regel "seizoen nog niet begonnen"; geen staplijn of details; ongemeten blijft "nog niet gemeten"', async () => {
    // Vandaag 20 jul, seizoen start 1 aug: weergave {1 aug, 19 jul} is ongeldig. Metingen: pg 1 jul stap 4, pm 15 jun stap 6.
    // pg heeft twee VCT-trainingen na de meting (8 en 15 jul): huidig 4 + floor(2/2) = 5, verschil +1. pm: geen trainingen -> 6 (één meting, dus P.4 'nog geen voortgang').
    zetKlok('2026-07-20', 10, 0)
    const e1 = U('e7', 61)
    const e2 = U('e7', 62)
    const db = leegDb({
      events: [tr(e1, '2026-07-08'), tr(e2, '2026-07-15')],
      oefeningen: bibliotheek(),
      training_oefeningen: [kp(e1, O.pg), kp(e2, O.pg)],
      categorie_metingen: [mt('partijen_groot', '2026-07-01', 4), mt('partijen_midden', '2026-06-15', 6)],
    })
    const { container, h } = await renderInzichten(db, { over: { handlers: LEEG } })
    expect(container.textContent).not.toMatch(/NaN|undefined/)
    expect(screen.queryByText(i.geenDataTitle)).toBeNull()
    expect(within(PER()).queryByText(i.periodiseringEmpty)).toBeNull()
    expect(within(PER()).getByText(i.seizoenNogNietBegonnen)).toBeInTheDocument()
    const pg = onderdeel('partijen_groot')
    expect(pg.nulmeting).toBe(`stap 4 · ${kort('2026-07-01')}`)
    expect(pg.huidig).toBe('stap 5 max 21')
    expect(pg.voortgang).toBe(fmt(i.voortgangWaarde, { verschil: '+1' }))
    const pm = onderdeel('partijen_midden')
    expect(pm.nulmeting).toBe(`stap 6 · ${kort('2026-06-15')}`)
    expect(pm.huidig).toBe('stap 6 max 15')
    expect(pm.voortgang).toBe(i.periodiseringGeenVoortgang) // één meting en geen trainingen (P.4)
    for (const sleutel of ['partijen_groot', 'partijen_midden']) {
      expect(onderdeel(sleutel).heeftSvg, sleutel).toBe(false)
      expect(onderdeel(sleutel).heeftDetails, sleutel).toBe(false)
    }
    for (const sleutel of ['partijen_klein', 'sprints_weinig_rust', 'sprints_veel_rust']) {
      expect(onderdeel(sleutel).nulmeting, sleutel).toBe(i.periodiseringNietGemeten)
    }
    expect(PER().querySelectorAll('svg, details')).toHaveLength(0)
    // B2: bron vanaf de laatste meting strikt vóór de seizoensstart (min over onderdelen = 15 jun), t/m gisteren
    expect(calls(h, 'inzichten_training_koppelingen')[1].args).toEqual({ p_team_id: TEAM, p_start: '2026-06-15', p_end: '2026-07-19' })
  })

  it('B1 (Q6): seizoen nog niet begonnen ZONDER meting -> de gewone lege staat, zonder de "nog niet begonnen"-regel', async () => {
    zetKlok('2026-07-20', 10, 0)
    const { container } = await renderInzichten(leegDb(), { over: { handlers: MET_DATA } })
    expect(within(PER()).getByText(i.periodiseringEmpty)).toBeInTheDocument()
    expect(within(PER()).queryByText(i.seizoenNogNietBegonnen)).toBeNull()
    expect(container.textContent).not.toMatch(/NaN|undefined/)
  })

  it('B1: een gewoon lopend seizoen toont de "nog niet begonnen"-regel niet', async () => {
    await renderInzichten(periodiseringDb())
    expect(within(PER()).queryByText(i.seizoenNogNietBegonnen)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// B2 — periodiseringsbron begrensd: p_start = laatste meting STRIKT vóór de seizoensstart per onderdeel (min over onderdelen)
// ═══════════════════════════════════════════════════════════════════════
describe('B2 — begrenzing van de periodiseringsbron', () => {
  // Fixture over twee seizoenen (seizoen 2026-08-01 ..; vandaag 2026-10-15):
  //  pg: meting 2025-09-01 stap 2 (vorig seizoen) en 2026-06-15 stap 8; trainingen 2025-10-01, 2026-06-20, 2026-09-01
  //  pm: meting 2026-06-01 stap 3 en 2026-08-01 (OP de seizoensstart) stap 5;
  //      trainingen 6-8, 9-6, 15-6, 6-7, 13-7 (allemaal na meting 1), 1-8 (startdag), 10-8, 17-8, 1-9
  //  pk: alleen een meting NA de start (2026-09-05 stap 4), trainingen 20-8 (vóór de meting), 12-9, 19-9
  // Strikt vóór de start: pg 15-6, pm 1-6, pk eerste = 5-9 -> p_start = min = 2026-06-01.
  // Met "≤" zou pm 1-8 worden -> min 15-6 en vielen pm-trainingen 8-6 en 9-6 uit de bron.
  // pm: trainingspunt 1-8 gebruikt nog meting 1: k = 5 (8-6, 9-6, 15-6, 6-7, 13-7) -> 3 + 2 = 5 ("≤": k = 3 -> 4).
  //  punten in weergave: 1-8 training 5 | 1-8 meting 5 | 10-8 5 | 17-8 5 | 1-9 6; huidig: meting 2 stap 5, 3 trainingen erna -> 6; nulmeting 3 (1-6).
  function tweeSeizoenenDb(): Db {
    const events: Row[] = []
    const kops: Row[] = []
    const vct = (datum: string, oefId: string) => {
      const id = U('e2', events.length + 1)
      events.push(tr(id, datum))
      kops.push(kp(id, oefId))
    }
    for (const d of ['2025-10-01', '2026-06-20', '2026-09-01']) vct(d, O.pg)
    for (const d of ['2026-06-08', '2026-06-09', '2026-06-15', '2026-07-06', '2026-07-13', '2026-08-01', '2026-08-10', '2026-08-17', '2026-09-01']) vct(d, O.pm)
    for (const d of ['2026-08-20', '2026-09-12', '2026-09-19']) vct(d, O.pk)
    return leegDb({
      events,
      oefeningen: bibliotheek(),
      training_oefeningen: kops,
      categorie_metingen: [
        mt('partijen_groot', '2025-09-01', 2), mt('partijen_groot', '2026-06-15', 8),
        mt('partijen_midden', '2026-06-01', 3), mt('partijen_midden', '2026-08-01', 5),
        mt('partijen_klein', '2026-09-05', 4),
      ],
    })
  }

  it('B2: p_start = laatste meting strikt vóór de seizoensstart per onderdeel, minimum over onderdelen (niet de vroegste meting ooit, niet "≤")', async () => {
    const { h } = await renderInzichten(tweeSeizoenenDb())
    expect(calls(h, 'inzichten_training_koppelingen')[1].args).toEqual({ p_team_id: TEAM, p_start: '2026-06-01', p_end: '2026-10-14' })
  })

  it('B2: de getoonde stappen zijn identiek aan een reconstructie vanaf de vroegste meting (pariteit met getTrainingLog, over twee seizoenen)', async () => {
    const db = tweeSeizoenenDb()
    await renderInzichten(db)
    const pm = onderdeel('partijen_midden')
    expect(pm.punten).toEqual([
      [kort('2026-08-01'), '5', i.bronTraining],
      [kort('2026-08-01'), '5', i.bronMeting],
      [kort('2026-08-10'), '5', i.bronTraining],
      [kort('2026-08-17'), '5', i.bronTraining],
      [kort('2026-09-01'), '6', i.bronTraining],
    ])
    expect(pm.nulmeting).toBe(`stap 3 · ${kort('2026-06-01')}`)
    expect(pm.huidig).toBe('stap 6 max 15')
    expect(pm.voortgang).toBe(fmt(i.voortgangWaarde, { verschil: '+3' }))
    const pg = onderdeel('partijen_groot')
    expect(pg.nulmeting).toBe(`stap 2 · ${kort('2025-09-01')}`) // nulmeting blijft de eerste meting ooit
    expect(pg.punten).toEqual([[kort('2026-09-01'), '8', i.bronTraining]]) // meting 15-6 stap 8, 1 training erna (20-6): 8 + floor(1/2) = 8; 20-6 ligt vóór de weergave
  })

  it('B2: pariteit per trainingspunt — kaart gelijk aan getTrainingLog op de volledige geschiedenis (pg en pm; huidige stap)', async () => {
    const db = tweeSeizoenenDb()
    const { h } = await renderInzichten(db)
    const metingen = db.categorie_metingen as unknown as CategorieMeting[]
    const client = makeClient(h) as unknown as Parameters<typeof getTrainingLog>[0]
    const datums: Record<string, string[]> = {
      partijen_midden: ['2026-08-01', '2026-08-10', '2026-08-17', '2026-09-01'],
      partijen_groot: ['2026-09-01'],
    }
    let n = 0
    for (const [sleutel, lijst] of Object.entries(datums)) {
      const trainingen = onderdeel(sleutel).punten.filter((p) => p[2] === i.bronTraining)
      expect(trainingen.map((p) => p[0]), sleutel).toEqual(lijst.map(kort))
      for (const [x, d] of lijst.entries()) {
        const planner = await getTrainingLog(client, TEAM, actueleMetingen(metingen, d), d)
        expect(Number(trainingen[x][1]), `${sleutel} ${d}`).toBe(planner.currentSteps[sleutel])
        n++
      }
    }
    expect(n).toBe(5)
    const nu = await getTrainingLog(client, TEAM, actueleMetingen(metingen, TODAY), TODAY)
    for (const sleutel of ['partijen_groot', 'partijen_midden', 'partijen_klein']) {
      expect(onderdeel(sleutel).huidig, sleutel).toContain(`stap ${nu.currentSteps[sleutel]} `)
    }
  })

  it('B2: een onderdeel met alleen metingen ná de seizoensstart begint bij zijn eerste meting', async () => {
    const id = U('e2', 70)
    const db = leegDb({ events: [tr(id, '2026-09-12')], oefeningen: bibliotheek(), training_oefeningen: [kp(id, O.pk)], categorie_metingen: [mt('partijen_klein', '2026-09-05', 4)] })
    const { h } = await renderInzichten(db)
    expect(calls(h, 'inzichten_training_koppelingen')[1].args.p_start).toBe('2026-09-05')
    expect(onderdeel('partijen_klein').punten).toEqual([
      [kort('2026-09-05'), '4', i.bronMeting], [kort('2026-09-12'), '4', i.bronTraining],
    ])
  })

  it('B2: een meting precies op de seizoensstart telt als "na": de bron begint dan op die meting', async () => {
    const db = leegDb({ categorie_metingen: [mt('partijen_midden', '2026-08-01', 5)] })
    const { h } = await renderInzichten(db)
    expect(calls(h, 'inzichten_training_koppelingen')[1].args.p_start).toBe('2026-08-01')
  })

  it('B2: meerdere metingen vóór de start -> de laatste daarvan; een onderdeel zonder meting vóór de start verlaagt de ondergrens niet', async () => {
    const db = leegDb({
      categorie_metingen: [
        mt('partijen_groot', '2025-09-01', 2), mt('partijen_groot', '2026-03-01', 5), mt('partijen_groot', '2026-07-01', 7),
        mt('sprints_weinig_rust', '2026-09-10', 3),
      ],
    })
    const { h } = await renderInzichten(db)
    expect(calls(h, 'inzichten_training_koppelingen')[1].args.p_start).toBe('2026-07-01')
  })

  it('B2: geen bruikbare meting (geen meting, of alleen een meting na gisteren) -> geen periodiseringsaanroep', async () => {
    const zonder = await renderInzichten(leegDb())
    expect(calls(zonder.h, 'inzichten_training_koppelingen')).toHaveLength(1)
    cleanup()
    const toekomst = await renderInzichten(leegDb({ categorie_metingen: [mt('partijen_groot', '2026-10-20', 4)] }))
    expect(calls(toekomst.h, 'inzichten_training_koppelingen')).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// SQL-koppeling: de handlers hierboven zijn alleen een nabootsing; deze tests binden ze
// aan de echte SQL-tekst (RLS en gedrag zelf: blok 29 op de echte database).
// ═══════════════════════════════════════════════════════════════════════
describe('SQL-koppeling — de handlers bootsen precies deze SQL na', () => {
  const ruw = readFileSync(join(process.cwd(), 'supabase/inzichten-metrics-fase3a.sql'), 'utf8')
  const sql = ruw.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ')
  const delen = sql.split(/create or replace function/).slice(1)
  const koppelingen = delen.find((d) => d.includes('inzichten_training_koppelingen'))!
  const discipline = delen.find((d) => d.includes('inzichten_invul_discipline'))!

  it('SQL-koppeling (AC-A2): de koppelingen-RPC filtert k.team_id in de ON van de left join en e.team_id = p_team_id; de oefening wordt bewust NIET op team gefilterd', () => {
    expect(koppelingen).toMatch(/left join training_oefeningen k on k\.event_id = e\.id and k\.team_id = p_team_id/)
    expect(koppelingen).toMatch(/left join oefeningen oef on oef\.id = k\.oefening_id(?! and)/)
    expect(koppelingen).not.toMatch(/oef\.team_id/)
    expect(koppelingen).toMatch(/where is_team_member\(p_team_id\) and e\.team_id = p_team_id/)
    expect(koppelingen).toMatch(/\(oef\.id is not null\)/)
    expect(ruw).toContain('EIGENAAR-USER')
  })

  it('SQL-koppeling (AC-A2): de disciplinerpc filtert e, r, me, k en tov elk op team_id en koppelt de override aan het bijbehorende type', () => {
    for (const a of ['r', 'me', 'k', 'tov', 'e']) expect(discipline, a).toMatch(new RegExp(`${a}\\.team_id = p_team_id`))
    expect(discipline).toMatch(/case e\.type when 'match' then 'analysis' else 'training_plan' end/)
  })

  it('SQL-koppeling (AC-A12): beide RPC\'s hebben limit 901 en totaal = count(*) over () (MAX_FASE3_RIJEN + 1)', () => {
    expect(sql.match(/limit 901/g)).toHaveLength(2)
    expect(sql.match(/\(count\(\*\) over \(\)\)::int/g)).toHaveLength(2)
  })

  it('SQL-koppeling (AC-A13): de SQL schrijft niets en maakt geen tabel/policy/index', () => {
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|create table|alter table|create policy|create index|security definer)\b/i)
    expect(sql).toMatch(/security invoker/g)
  })
})
