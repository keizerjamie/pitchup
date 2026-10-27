// Acceptatietests — fase 1 "inzichten-metrics": zes nieuwe kaarten op /inzichten
// (Thuis/uit, Formatie, Topscorers, Kaarten, Kwartier eigen doelpunten,
// Tegendoelpunten) en het vastleggen van tegendoelpunten op de wedstrijdanalyse.
//
// Methode (van buitenaf, geen unit-tests):
//   * Deel A rendert de ECHTE app/inzichten/page.tsx (async server component) met
//     RTL; alleen @/lib/supabase/server, next/navigation en next/headers zijn
//     gestubd. De vier nieuwe RPC's worden beantwoord door handlers die de SQL uit
//     supabase/inzichten-metrics.sql nabootsen op in-memory rijen en daarbij het
//     p_team_id-ARGUMENT van de pagina gebruiken.
//   * Deel B rendert de ECHTE app/events/[id]/analysis/page.tsx met de echte
//     MatchAnalysisEditor/TegendoelpuntenSectie en de ECHTE server actions
//     (app/actions/tegendoelpunten.ts) tegen een in-memory database die filters
//     (.eq/.in/...) werkelijk toepast. router.refresh() rendert de pagina opnieuw
//     vanuit die database, dus "blijft na herladen" is echt gemeten.
//
// BEPERKING (eerlijk): vitest kan RLS en de SQL zelf niet bewijzen. De handlers
// bootsen de SQL alleen na. Wat de DB-laag afdwingt (RLS, CHECK-constraints,
// security invoker, team-filters in de RPC's) staat in
// supabase/team-rls-verificatie.sql (blok 2, 22, 26 — al gedraaid) en in de
// tekst-structuurtest inzichten-metrics-migratie.acceptance.test.ts. De CHECK
// constraints worden hier bewust NIET nagebootst, zodat bewezen wordt dat de
// server action zelf weigert.
//
// ── AC → test-mapping: elke testnaam begint met zijn criterium (bv. "AC-3.2") ──

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, configure, cleanup } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DictProvider } from '@/lib/i18n-context'
import { ToastProvider } from '@/components/ui/Toast'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { es } from '@/messages/es'
import { fr } from '@/messages/fr'
import type { Dict } from '@/messages/nl'

const state = vi.hoisted(() => ({
  locale: 'nl',
  refresh: (() => {}) as () => void,
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
    refresh: () => state.refresh(),
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
import AnalysisPage from '@/app/events/[id]/analysis/page'
import { addTegendoelpunt, deleteTegendoelpunt, herstelTegendoelpunt } from '@/app/actions/tegendoelpunten'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { MAX_SEIZOEN_WEDSTRIJDEN } from '@/lib/inzichten'
import { TEAM_TABELLEN } from '@/lib/team-opruimen'
import type { HerstelTegendoelpunt } from '@/lib/herstel'

// ═══════════════════════════════════════════════════════════════════════
// Gedeelde in-memory database + Supabase-client
// ═══════════════════════════════════════════════════════════════════════
type Row = Record<string, unknown>
type Db = Record<string, Row[]>

interface Harness {
  db: Db
  rpcCalls: { name: string; args: Row }[]
  inserts: { table: string; payload: Row }[]
  rpcErrors: Record<string, unknown>
  selectErrors: Record<string, unknown>
  insertGate: Promise<void> | null
  insertError: (() => unknown) | null
  handlers: Record<string, (db: Db, args: Row) => Row[]>
  userId: string
}

function makeClient(h: Harness) {
  function from(table: string) {
    let op: 'select' | 'insert' | 'delete' = 'select'
    let payload: Row = {}
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
    let limitN: number | null = null

    async function execute(): Promise<{ data: Row[] | null; error: unknown }> {
      const rows = h.db[table]
      if (!rows) throw new Error(`Onverwachte tabel in test: "${table}"`)
      if (op === 'insert') {
        h.inserts.push({ table, payload: { ...payload } })
        if (h.insertGate) await h.insertGate
        const fout = h.insertError?.()
        if (fout) return { data: null, error: fout }
        if (rows.some((r) => r.id !== undefined && r.id === payload.id)) {
          return {
            data: null,
            error: { code: '23505', message: `duplicate key value violates unique constraint "${table}_pkey"` },
          }
        }
        rows.push({ created_at: new Date().toISOString(), ...payload })
        return { data: null, error: null }
      }
      if (op === 'delete') {
        const keep = rows.filter((r) => !filters.every((f) => f(r)))
        rows.length = 0
        rows.push(...keep)
        return { data: null, error: null }
      }
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
      insert: (p: Row) => {
        op = 'insert'
        payload = p
        return chain
      },
      delete: () => {
        op = 'delete'
        return chain
      },
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
  const h: Harness = {
    db,
    rpcCalls: [],
    inserts: [],
    rpcErrors: {},
    selectErrors: {},
    insertGate: null,
    insertError: null,
    handlers: {},
    userId: 'team-1',
    ...over,
  }
  vi.mocked(createClient).mockResolvedValue(makeClient(h) as unknown as Awaited<ReturnType<typeof createClient>>)
  return h
}

const TEAM = 'team-1'
const OTHER = 'team-2'
const owner = (team = TEAM) => ({ team_id: team, user_id: team, rol: 'owner' })

function fmt(tpl: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), tpl)
}

let consoleError: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  state.locale = 'nl'
  state.refresh = () => {}
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  consoleError.mockRestore()
  vi.unstubAllGlobals()
})

// ═══════════════════════════════════════════════════════════════════════
// DEEL A — /inzichten
// ═══════════════════════════════════════════════════════════════════════
const TODAY = '2026-10-15'
const STANDAARD_IGNORE = 'script, style'
const NEGEER_PRINTBLOK = `${STANDAARD_IGNORE}, [data-print-only], [data-print-only] *`

function inRange(d: string, s: string, e: string) {
  return d >= s && d <= e
}

// De vier RPC-handlers: SQL van supabase/inzichten-metrics.sql in TS. Ze gebruiken
// args.p_team_id en filteren op team_id van elke gejoinde tabel; geen filter op
// players.active of players.type (besluit V2).
function evMap(db: Db) {
  return new Map(db.events.map((e) => [e.id as string, e]))
}
function momenten(db: Db, args: Row, kinds: string[]) {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const events = evMap(db)
  const players = new Map(db.players.map((p) => [p.id as string, p]))
  const out: { me: Row; p: Row }[] = []
  for (const me of db.match_events) {
    if (me.team_id !== p_team_id || !kinds.includes(me.kind as string)) continue
    const e = events.get(me.event_id as string)
    if (!e || e.team_id !== p_team_id || e.type !== 'match') continue
    if (!inRange(e.date as string, p_start, p_end)) continue
    const p = players.get(me.player_id as string)
    if (!p || p.team_id !== p_team_id) continue
    out.push({ me, p })
  }
  return out
}

const METRICS_HANDLERS: Harness['handlers'] = {
  inzichten_aanwezigheid: () => [{ aanwezig: 0, afwezig: 0 }],
  inzichten_training_opkomst_per_maand: () => [],
  inzichten_rating_team_per_wedstrijd: () => [],
  inzichten_rating_speler: () => [],
  inzichten_rating_per_speler: () => [],
  inzichten_aanwezigheid_per_speler: () => [],
  // Fase 2a: dit fase-1-harnas test de nieuwe kaarten niet; lege bronnen
  // volstaan zodat de pagina niet op een onbekende RPC klapt.
  inzichten_speelkansen: () => [],
  inzichten_rating_vorm_per_speler: () => [],
  inzichten_training_opkomst_per_speler: () => [],
  inzichten_blessures_per_maand: () => [],
  // Fase 2b: idem, lege bron volstaat.
  inzichten_speelminuten_per_speler: () => [],
  inzichten_wedstrijd_uitslagen: (db, args) => {
    const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
    return db.events
      .filter(
        (e) =>
          e.team_id === p_team_id && e.type === 'match' && e.goals_for != null && e.goals_against != null &&
          inRange(e.date as string, p_start, p_end),
      )
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)))
      .slice(0, 201) // limit 201 in de SQL
      .map((e) => {
        const l = db.lineups.find((x) => x.event_id === e.id && x.team_id === p_team_id)
        const f = typeof l?.formation === 'string' ? l.formation.trim() : ''
        return {
          event_id: e.id, datum: e.date, home_away: e.home_away ?? null,
          goals_for: e.goals_for, goals_against: e.goals_against, formatie: f === '' ? null : f,
        }
      })
  },
  inzichten_speler_momenten: (db, args) => {
    const per = new Map<string, Row>()
    for (const { me, p } of momenten(db, args, ['goal', 'assist', 'yellow', 'red'])) {
      const cur = per.get(p.id as string) ?? {
        player_id: p.id, naam: p.name, gast: p.type === 'guest', doelpunten: 0, assists: 0, geel: 0, rood: 0,
      }
      const veld = { goal: 'doelpunten', assist: 'assists', yellow: 'geel', red: 'rood' }[me.kind as string]!
      cur[veld] = (cur[veld] as number) + 1
      per.set(p.id as string, cur)
    }
    return [...per.values()].sort(
      (a, b) => String(a.naam).localeCompare(String(b.naam)) || String(a.player_id).localeCompare(String(b.player_id)),
    )
  },
  inzichten_doelpunten_per_minuut: (db, args) => {
    const per = new Map<number | null, number>()
    for (const { me } of momenten(db, args, ['goal'])) {
      const m = (me.minute as number | null | undefined) ?? null
      per.set(m, (per.get(m) ?? 0) + 1)
    }
    return [...per.entries()].map(([minuut, aantal]) => ({ minuut, aantal }))
  },
  inzichten_tegendoelpunten: (db, args) => {
    const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
    const events = evMap(db)
    const per = new Map<string, Row>()
    for (const t of db.tegendoelpunten) {
      if (t.team_id !== p_team_id) continue
      const e = events.get(t.event_id as string)
      if (!e || e.team_id !== p_team_id || e.type !== 'match') continue
      if (!inRange(e.date as string, p_start, p_end)) continue
      const minuut = (t.minute as number | null | undefined) ?? null
      const key = `${minuut}|${t.soort}`
      const cur = per.get(key) ?? { minuut, soort: t.soort, aantal: 0 }
      cur.aantal = (cur.aantal as number) + 1
      per.set(key, cur)
    }
    return [...per.values()]
  },
}

const ev = (id: string, date: string, o: Row = {}): Row => ({
  id, team_id: TEAM, type: 'match', date, opponent: 'Tegenstander', match_type: 'league', home_away: 'home',
  goals_for: null, goals_against: null, created_at: '2026-01-01T10:00:00Z', trainingstype: 'vct', ...o,
})
const speler = (id: string, name: string, o: Row = {}): Row => ({
  id, team_id: TEAM, name, active: true, type: 'regular', ...o,
})
let meTeller = 0
const me = (event: string, player: string, kind: string, minute: number | null): Row => ({
  id: `me-${++meTeller}`, team_id: TEAM, event_id: event, player_id: player, kind, minute,
})
const lineup = (event: string, formation: string, team = TEAM): Row => ({ event_id: event, team_id: team, formation })
const tdp = (event: string, soort: string, minute: number | null, team = TEAM): Row => ({
  id: `td-${++meTeller}`, team_id: team, event_id: event, soort, minute,
})

function leegDb(over: Partial<Db> = {}): Db {
  return {
    team_members: [owner()],
    settings: [
      { team_id: TEAM, key: 'season_start', value: '2026-08-01' },
      { team_id: TEAM, key: 'season_end', value: '2027-06-30' },
    ],
    events: [], players: [], match_events: [], lineups: [], tegendoelpunten: [], match_squad: [], speelminuten: [],
    attendance: [], match_ratings: [], training_oefeningen: [],
    ...over,
  }
}

// Het hoofdscenario. Verwachte waarden zijn met de hand uit de story afgeleid.
//   m1 09-05 thuis 3-1 (4-3-3)   m2 09-12 uit 0-2 (4-3-3)   m3 09-19 thuis 2-2 (3-5-2)
//   m4 09-26 uit 1-0 beker ('4-1-4-1X')   m5 10-03 thuis/uit onbekend 2-0, geen opstelling
//   m6 10-10 thuis ZONDER uitslag, wél opstelling 4-3-3   m7 10-12 thuis 1-1 oefen, opstelling ''
function hoofdDb(): Db {
  meTeller = 0
  return leegDb({
    events: [
      ev('m1', '2026-09-05', { goals_for: 3, goals_against: 1 }),
      ev('m2', '2026-09-12', { home_away: 'away', goals_for: 0, goals_against: 2 }),
      ev('m3', '2026-09-19', { goals_for: 2, goals_against: 2 }),
      ev('m4', '2026-09-26', { home_away: 'away', match_type: 'cup', goals_for: 1, goals_against: 0 }),
      ev('m5', '2026-10-03', { home_away: null, goals_for: 2, goals_against: 0 }),
      ev('m6', '2026-10-10'),
      ev('m7', '2026-10-12', { match_type: 'friendly', goals_for: 1, goals_against: 1 }),
      ev('t1', '2026-09-10', { type: 'training', opponent: null, match_type: null, home_away: null }),
    ],
    players: [
      speler('p-anna', 'Anna Aap'), speler('p-bram', 'Bram Beer'),
      speler('p-cor', 'Cor Cobra', { active: false }), speler('p-dirk', 'Dirk Duif'),
      speler('p-eva', 'Eva Ezel'), speler('p-guus', 'Guus Gast', { type: 'guest' }),
    ],
    lineups: [
      lineup('m1', '4-3-3'), lineup('m2', '4-3-3'), lineup('m3', '3-5-2'), lineup('m4', '4-1-4-1X'),
      lineup('m6', '4-3-3'), lineup('m7', ''),
    ],
    match_events: [
      // eigen doelpunten (10; 9 met minuut)
      me('m1', 'p-anna', 'goal', 0), me('m1', 'p-anna', 'goal', 15), me('m3', 'p-anna', 'goal', 16),
      me('m1', 'p-bram', 'goal', 45), me('m3', 'p-bram', 'goal', 47), me('m6', 'p-bram', 'goal', 130),
      me('m4', 'p-cor', 'goal', 90), me('m5', 'p-guus', 'goal', 91), me('m5', 'p-guus', 'goal', null),
      me('m2', 'p-eva', 'goal', 60),
      // assists (4)
      me('m1', 'p-anna', 'assist', 14), me('m1', 'p-bram', 'assist', 44), me('m3', 'p-bram', 'assist', 46),
      me('m4', 'p-dirk', 'assist', 89),
      // kaarten
      me('m1', 'p-anna', 'yellow', 10), me('m1', 'p-anna', 'yellow', 70), me('m2', 'p-cor', 'yellow', 33),
      me('m5', 'p-guus', 'yellow', 20), me('m5', 'p-guus', 'red', 88), me('m3', 'p-bram', 'red', 80),
    ],
    tegendoelpunten: [
      tdp('m2', 'set_piece', 20), tdp('m2', 'open_play', 20), tdp('m3', 'open_play', 90),
      tdp('m3', 'open_play', null), tdp('m1', 'set_piece', 91),
    ],
  })
}

// Zelfde scenario + data van team-2 in elke tabel + kruisbesmetting.
function vervuildeDb(): Db {
  const db = hoofdDb()
  db.events.push(ev('x1', '2026-09-06', { team_id: OTHER, goals_for: 9, goals_against: 0 }))
  db.players.push(speler('p-x', 'Xander Vreemd', { team_id: OTHER }))
  db.match_events.push(
    { id: 'me-x1', team_id: OTHER, event_id: 'x1', player_id: 'p-x', kind: 'goal', minute: 5 },
    // moment met team_id = TEAM, maar speler van team-2
    { id: 'me-x2', team_id: TEAM, event_id: 'm1', player_id: 'p-x', kind: 'goal', minute: 7 },
    // moment met team_id = team-2 op een eigen event met een eigen speler
    { id: 'me-x3', team_id: OTHER, event_id: 'm1', player_id: 'p-anna', kind: 'goal', minute: 3 },
  )
  // Vreemde opstelling op een EIGEN event, bewust VOOR de eigen opstelling in de lijst:
  // een ontbrekend team-filter zou dan de vreemde formatie oppikken.
  db.lineups.unshift(lineup('m1', '5-4-1', OTHER))
  db.lineups.push(lineup('x1', '5-4-1', OTHER))
  db.tegendoelpunten.push(tdp('x1', 'open_play', 5, OTHER), tdp('m1', 'open_play', 5, OTHER))
  return db
}

const dicts: Record<string, Dict> = { nl, en, de, es, fr }

async function renderInzichten(db: Db, o: { periode?: string; over?: Partial<Harness>; locale?: string } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`))
  configure({ defaultIgnore: NEGEER_PRINTBLOK })
  state.locale = o.locale ?? 'nl'
  const h = setup(db, { handlers: METRICS_HANDLERS, ...o.over })
  const el = o.periode === undefined
    ? await InzichtenPage()
    : await InzichtenPage({ searchParams: Promise.resolve({ periode: o.periode }) })
  const r = render(<DictProvider dict={dicts[state.locale]}>{el}</DictProvider>)
  return { ...r, h }
}

afterEach(() => {
  configure({ defaultIgnore: STANDAARD_IGNORE })
  vi.useRealTimers()
})

function kaart(titel: string): HTMLElement {
  return screen.getByRole('heading', { level: 2, name: titel }).closest('.surface-card') as HTMLElement
}
function rij(k: HTMLElement, label: string): string[] {
  const th = within(k).getByRole('rowheader', { name: label })
  return [...th.closest('tr')!.querySelectorAll('td')].map((td) => td.textContent ?? '')
}
function rijLabels(k: HTMLElement): string[] {
  return within(k).getAllByRole('rowheader').map((th) => th.textContent ?? '')
}
function dataTabel(k: HTMLElement): string[][] {
  const tbl = k.querySelector('table.sr-only')!
  return [...tbl.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''))
}
function lijst(k: HTMLElement): string[] {
  return [...k.querySelectorAll('ol > li')].map((li) => li.textContent ?? '')
}
const i = nl.insights
const T = {
  thuisUit: i.thuisUitTitle, formatie: i.formatieTitle, top: i.topscorersTitle,
  kaarten: i.kaartenTitle, kwartier: i.kwartierTitle, tegen: i.tegenTitle,
}
const NIEUWE_RPCS = [
  'inzichten_wedstrijd_uitslagen', 'inzichten_speler_momenten',
  'inzichten_doelpunten_per_minuut', 'inzichten_tegendoelpunten',
]

describe('AC-A1 — nieuwe kaarten voor het gekozen venster, naast de bestaande', () => {
  it('AC-A1: de zes nieuwe kaarten staan er, in de afgesproken volgorde, na de bestaande kaarten', async () => {
    await renderInzichten(hoofdDb())
    const koppen = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    const nieuw = [T.thuisUit, T.formatie, T.top, T.kaarten, T.kwartier, T.tegen]
    const idx = nieuw.map((t) => koppen.indexOf(t))
    expect(idx.every((n) => n >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx) // volgorde O3
    // bestaande kaarten blijven aanwezig en staan vóór de nieuwe
    for (const bestaand of [i.doelpuntenTitle, i.inhoudTitle]) {
      const n = koppen.indexOf(bestaand)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(idx[0])
    }
  })

  it('AC-A1: gekozen venster 4w — de kaarten tonen alleen de laatste 4 weken (andere cijfers dan het seizoen)', async () => {
    const { h } = await renderInzichten(hoofdDb(), { periode: '4w' })
    for (const naam of NIEUWE_RPCS) {
      const call = h.rpcCalls.find((c) => c.name === naam)!
      expect(call.args).toEqual({ p_team_id: TEAM, p_start: '2026-09-18', p_end: '2027-06-30' })
    }
    const k = kaart(T.thuisUit)
    expect(rij(k, i.thuisLabel)).toEqual(['2', '0', '2', '0', '1.00', '0'])
    expect(rij(k, i.uitLabel)).toEqual(['1', '1', '0', '0', '3.00', '+1'])
    expect(rij(k, i.onbekendLabel)).toEqual(['1', '1', '0', '0', '3.00', '+2'])
    expect(rij(k, i.totaalLabel)).toEqual(['4', '2', '2', '0', '2.00', '+3'])
    expect(kaart(T.kwartier)).toHaveTextContent(fmt(i.kwartierDekking, { x: 5, y: 6 }))
  })

  it('AC-A1 (venster, geen "verleden"): de vier RPC\'s krijgen het seizoenseinde als p_end; een wedstrijd van vandaag met uitslag telt mee', async () => {
    const db = leegDb({ events: [ev('v1', TODAY, { goals_for: 1, goals_against: 0 })] })
    const { h } = await renderInzichten(db)
    for (const naam of NIEUWE_RPCS) {
      const call = h.rpcCalls.find((c) => c.name === naam)!
      expect(call.args).toEqual({ p_team_id: TEAM, p_start: '2026-08-01', p_end: '2027-06-30' })
    }
    expect(rij(kaart(T.thuisUit), i.totaalLabel)).toEqual(['1', '1', '0', '0', '3.00', '+1'])
  })
})

describe('AC-A2 — tenant-isolatie op de nieuwe kaarten', () => {
  it('AC-A2: data van team-2 (events, momenten, opstellingen, tegendoelpunten, ook kruisbesmetting) verandert niets aan de zes kaarten', async () => {
    const schoon = await renderInzichten(hoofdDb())
    const schoonTekst = [T.thuisUit, T.formatie, T.top, T.kaarten, T.kwartier, T.tegen].map((t) => kaart(t).textContent)
    schoon.unmount()
    const vuil = await renderInzichten(vervuildeDb())
    const vuilTekst = [T.thuisUit, T.formatie, T.top, T.kaarten, T.kwartier, T.tegen].map((t) => kaart(t).textContent)
    expect(vuilTekst).toEqual(schoonTekst)
    expect(kaart(T.formatie)).not.toHaveTextContent('5-4-1')
    expect(document.body.textContent).not.toContain('Xander')
    for (const c of vuil.h.rpcCalls.filter((c) => NIEUWE_RPCS.includes(c.name))) {
      expect((c.args as Row).p_team_id).toBe(TEAM)
    }
  })

  it('AC-A2: een team dat alleen data van een ander team heeft ziet lege staten, geen vreemde cijfers', async () => {
    const db = vervuildeDb()
    db.events = db.events.filter((e) => e.team_id !== TEAM)
    db.match_events = db.match_events.filter((m) => m.team_id !== TEAM)
    db.tegendoelpunten = db.tegendoelpunten.filter((t) => t.team_id !== TEAM)
    db.lineups = db.lineups.filter((l) => l.team_id !== TEAM)
    await renderInzichten(db)
    // geen eigen data -> bestaande lege-pagina-staat
    expect(screen.getByText(i.geenDataTitle)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Xander')
  })
})

describe('AC-A3 — periode/team zonder relevante data: lege staat, geen nullen of fout', () => {
  it('AC-A3: alleen een uitslag zonder opstelling of momenten — per kaart een eigen lege staat, geen NaN/Infinity/undefined', async () => {
    const db = leegDb({ events: [ev('e1', '2026-09-05', { goals_for: 1, goals_against: 0 })] })
    await renderInzichten(db)
    expect(kaart(T.formatie)).toHaveTextContent(i.formatieEmpty)
    expect(kaart(T.top)).toHaveTextContent(i.topscorersEmpty)
    expect(kaart(T.kaarten)).toHaveTextContent(i.kaartenEmpty)
    expect(kaart(T.kwartier)).toHaveTextContent(i.kwartierEmpty)
    expect(kaart(T.tegen)).toHaveTextContent(i.tegenEmpty)
    expect(kaart(T.thuisUit)).not.toHaveTextContent(i.thuisUitEmpty) // er ís een uitslag
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined/)
    expect(screen.queryByText(i.bronFout)).toBeNull()
  })

  it('AC-A3 / AC-1.3: alleen wedstrijden zonder uitslag — Thuis/uit en Formatie leeg, kaarten met momenten niet', async () => {
    const db = leegDb({
      events: [ev('e1', '2026-09-05')],
      players: [speler('p-a', 'Anna Aap')],
      match_events: [me('e1', 'p-a', 'goal', 10)],
      lineups: [lineup('e1', '4-3-3')],
    })
    await renderInzichten(db)
    expect(kaart(T.thuisUit)).toHaveTextContent(i.thuisUitEmpty)
    expect(kaart(T.formatie)).toHaveTextContent(i.formatieEmpty)
    expect(kaart(T.top)).toHaveTextContent('Anna Aap')
    expect(kaart(T.kwartier)).toHaveTextContent(fmt(i.kwartierDekking, { x: 1, y: 1 }))
  })

  it('AC-A3 / AC-6.8: geen tegendoelpunten in de periode — lege staat van de tegendoelpuntenkaart', async () => {
    const db = hoofdDb()
    db.tegendoelpunten = []
    await renderInzichten(db)
    expect(kaart(T.tegen)).toHaveTextContent(i.tegenEmpty)
    expect(kaart(T.tegen).querySelector('table')).toBeNull()
  })
})

describe('AC-A4 / AC-6.12 — één falende bron raakt alleen de eigen kaart(en)', () => {
  const FOUT = { code: 'PGRST202', message: 'Could not find the function GEHEIM_DETAIL_XYZ' }
  const kaartenBijBron: Record<string, string[]> = {
    inzichten_wedstrijd_uitslagen: [T.thuisUit, T.formatie],
    inzichten_speler_momenten: [T.top, T.kaarten],
    inzichten_doelpunten_per_minuut: [T.kwartier],
    inzichten_tegendoelpunten: [T.tegen],
  }
  it.each(NIEUWE_RPCS)('AC-A4: %s faalt — alleen de gekoppelde kaart(en) tonen de algemene melding, de rest werkt, geen technische details', async (rpc) => {
    await renderInzichten(hoofdDb(), { over: { rpcErrors: { [rpc]: FOUT } } })
    const alle = [T.thuisUit, T.formatie, T.top, T.kaarten, T.kwartier, T.tegen]
    for (const t of alle) {
      if (kaartenBijBron[rpc].includes(t)) expect(kaart(t)).toHaveTextContent(i.bronFout)
      else expect(kaart(t)).not.toHaveTextContent(i.bronFout)
    }
    expect(document.body.textContent).not.toMatch(/PGRST202|GEHEIM_DETAIL_XYZ/)
    // bestaande kaarten renderen gewoon door
    expect(screen.getByRole('heading', { level: 2, name: i.doelpuntenTitle })).toBeInTheDocument()
  })

  it('AC-6.12: migratie ontbreekt (alle vier PGRST202) — nieuwe kaarten tonen de melding, de bestaande pagina blijft werken', async () => {
    const rpcErrors = Object.fromEntries(NIEUWE_RPCS.map((n) => [n, FOUT]))
    await renderInzichten(hoofdDb(), { over: { rpcErrors } })
    for (const t of [T.thuisUit, T.formatie, T.top, T.kaarten, T.kwartier, T.tegen]) {
      expect(kaart(t)).toHaveTextContent(i.bronFout)
    }
    expect(screen.getByRole('heading', { level: 2, name: i.doelpuntenTitle })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/PGRST202|GEHEIM_DETAIL_XYZ/)
  })
})

describe('AC-A5 — team zonder enige data', () => {
  it('AC-A5: geen enkele data -> bestaande lege-pagina-staat', async () => {
    await renderInzichten(leegDb())
    expect(screen.getByText(i.geenDataTitle)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: T.thuisUit })).toBeNull()
  })

  it.each([
    ['alleen een match_event', () => leegDb({ events: [ev('e1', '2026-09-05')], players: [speler('p-a', 'Anna Aap')], match_events: [me('e1', 'p-a', 'goal', 5)] })],
    ['alleen een tegendoelpunt', () => leegDb({ events: [ev('e1', '2026-09-05')], tegendoelpunten: [tdp('e1', 'open_play', 5)] })],
    ['alleen een uitslag', () => leegDb({ events: [ev('e1', '2026-09-05', { goals_for: 0, goals_against: 0 })] })],
  ])('AC-A5: %s telt mee als data — gewone pagina, geen lege-pagina-staat', async (_naam, bouw) => {
    await renderInzichten(bouw())
    expect(screen.queryByText(i.geenDataTitle)).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: T.tegen })).toBeInTheDocument()
  })
})

describe('AC-A6 — unieke titels in nl/en/de/es/fr', () => {
  it.each(['nl', 'en', 'de', 'es', 'fr'])('AC-A6: taal %s — zes nieuwe, onderling en pagina-breed unieke titels uit de eigen taal', async (loc) => {
    await renderInzichten(hoofdDb(), { locale: loc })
    const d = dicts[loc].insights
    const nieuw = [d.thuisUitTitle, d.formatieTitle, d.topscorersTitle, d.kaartenTitle, d.kwartierTitle, d.tegenTitle]
    expect(new Set(nieuw).size).toBe(6)
    const koppen = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    for (const t of nieuw) {
      expect(t.trim().length).toBeGreaterThan(0)
      expect(koppen.filter((k) => k === t)).toHaveLength(1)
    }
    expect(new Set(koppen).size).toBe(koppen.length) // pagina-breed uniek
  })

  it('AC-A6: alle nieuwe teksten bestaan in alle vijf de talen, zijn niet leeg en behouden hun {plaatshouders}', () => {
    const sleutels = [
      'thuisUitTitle', 'thuisUitDescription', 'thuisUitEmpty', 'locatieKolom', 'thuisLabel', 'uitLabel', 'onbekendLabel',
      'totaalLabel', 'kolomGespeeld', 'kolomWinst', 'kolomGelijk', 'kolomVerlies', 'kolomPpw', 'kolomSaldo', 'cleanSheets',
      'zonderEigenDoelpunt', 'afgekapt', 'bronFout', 'formatieTitle', 'formatieEmpty', 'topscorersTitle', 'topscorersEmpty',
      'topscorersWaarde', 'assistPercentage', 'gastLabel', 'kaartenTitle', 'kaartenEmpty', 'kaartenWaarde', 'kwartierTitle',
      'kwartierEmpty', 'kwartierDekking', 'kwartierSummary', 'tegenTitle', 'tegenEmpty', 'tegenDekking', 'tegenSummary',
      'tegenPerSoort', 'minutenKolom',
    ] as const
    for (const [loc, d] of Object.entries(dicts)) {
      const rec = d.insights as unknown as Record<string, string>
      for (const s of sleutels) {
        expect(typeof rec[s], `${loc}.insights.${s}`).toBe('string')
        expect(rec[s].trim().length, `${loc}.insights.${s}`).toBeGreaterThan(0)
        const nlPlaats = (nl.insights as unknown as Record<string, string>)[s].match(/\{\w+\}/g) ?? []
        for (const p of nlPlaats) expect(rec[s], `${loc}.insights.${s} mist ${p}`).toContain(p)
      }
      const a = d.analysis
      expect(new Set([a.tegendoelpuntSoorten.set_piece, a.tegendoelpuntSoorten.open_play]).size).toBe(2)
      for (const k of ['tegendoelpunten', 'addTegendoelpunt', 'noTegendoelpunten', 'tegendoelpuntSumHint', 'tegendoelpuntOngeldigeMinuut', 'tegendoelpuntOpslaanFout', 'tegendoelpuntSoortLabel'] as const) {
        expect(a[k].trim().length, `${loc}.analysis.${k}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('AC-A7 — toegankelijke tekstvariant en thema-kleuren van de grafieken', () => {
  it('AC-A7: Kwartier — role="img" met aria-label, datatabel als sibling (niet erin), kleuren uit tokens, geen hex', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.kwartier)
    const img = k.querySelector('[role="img"]')!
    expect(img.getAttribute('aria-label')).toContain('1–15: 2')
    expect(img.getAttribute('aria-label')).toContain('90+: 2')
    expect(k.querySelectorAll('[role="img"] table').length).toBe(0)
    const tbl = k.querySelector('table.sr-only')!
    expect(tbl.querySelector('caption')!.textContent).toBe(img.getAttribute('aria-label'))
    expect([...tbl.querySelectorAll('th')].map((th) => th.textContent)).toEqual([i.minutenKolom, nl.insights.countLabel])
    expect(k.innerHTML).toContain('var(--chip-green-fg)')
    expect(k.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('AC-A7: Tegendoelpunten — role="img", datatabel met per-soort-kolommen, soort ook als tekst (legenda), kleuren uit tokens, geen hex', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.tegen)
    const img = k.querySelector('[role="img"]')!
    expect(img.getAttribute('aria-label')).toContain('16–30: 2')
    expect(k.querySelectorAll('[role="img"] table').length).toBe(0)
    const s = nl.analysis.tegendoelpuntSoorten
    expect([...k.querySelectorAll('table.sr-only th')].map((th) => th.textContent)).toEqual([i.minutenKolom, s.set_piece, s.open_play, i.totaalLabel])
    expect(k).toHaveTextContent(s.set_piece)
    expect(k).toHaveTextContent(s.open_play)
    // Twee reeksen uit thema-tokens, elk met een eigen kleur (nu blauw + rood,
    // zie .chart-fill-blue in app/globals.css); nooit een vaste kleurwaarde.
    const tokens = new Set(k.innerHTML.match(/var\(--(?:chip|panel)-[a-z]+-fg\)/g) ?? [])
    expect(tokens.size).toBeGreaterThanOrEqual(2)
    expect(k.innerHTML).toContain('var(--chip-red-fg)')
    const vullingen = [...k.querySelectorAll('path.recharts-rectangle')].map((p) => p.getAttribute('fill') ?? '')
    expect(vullingen.length).toBeGreaterThan(0)
    for (const v of vullingen) expect(v).toMatch(/^var\(--/)
    expect(k.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('AC-A7: de tabelkaarten hebben echte kolomkoppen met uitleg (abbr title) en rijkoppen', async () => {
    await renderInzichten(hoofdDb())
    for (const t of [T.thuisUit, T.formatie]) {
      const k = kaart(t)
      expect(within(k).getAllByRole('columnheader').length).toBe(7)
      expect(k.querySelectorAll('thead abbr[title]').length).toBe(6)
      expect(k.querySelector('abbr[title="Punten per wedstrijd"]')).not.toBeNull()
    }
  })
})

describe('1. Thuis vs. uit en kernmaten', () => {
  it('AC-1.1 / AC-1.2 / AC-1.5: voor thuis en uit apart W/G/V (uitslagregel), punten p/w en doelsaldo', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.thuisUit)
    // kolommen: gespeeld, W, G, V, ptn/w, saldo
    expect(rij(k, i.thuisLabel)).toEqual(['3', '1', '2', '0', '1.67', '+2'])
    expect(rij(k, i.uitLabel)).toEqual(['2', '1', '0', '1', '1.50', '-1'])
  })

  it('AC-1.3: wedstrijden zonder uitslag tellen nergens mee (m6: wél opstelling, geen uitslag)', async () => {
    await renderInzichten(hoofdDb())
    const totaal = rij(kaart(T.thuisUit), i.totaalLabel)
    expect(totaal[0]).toBe('6') // 7 wedstrijden, 1 zonder uitslag
    expect(kaart(T.thuisUit)).toHaveTextContent(fmt(i.cleanSheets, { n: 2, totaal: 6 }))
  })

  it('AC-1.4 / AC-1.5: totaal — punten p/w, clean sheets (0 tegen), zonder eigen doelpunt (0 voor), doelsaldo uit de uitslagen', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.thuisUit)
    expect(rij(k, i.totaalLabel)).toEqual(['6', '3', '2', '1', '1.83', '+3'])
    expect(k).toHaveTextContent(fmt(i.cleanSheets, { n: 2, totaal: 6 }))
    expect(k).toHaveTextContent(fmt(i.zonderEigenDoelpunt, { n: 1, totaal: 6 }))
  })

  it('AC-1.6 (V1): onbekend thuis/uit telt in het totaal, niet in thuis of uit; aparte regel "Onbekend" alleen als zulke wedstrijden bestaan', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.thuisUit)
    expect(rijLabels(k)).toEqual([i.thuisLabel, i.uitLabel, i.onbekendLabel, i.totaalLabel])
    expect(rij(k, i.onbekendLabel)).toEqual(['1', '1', '0', '0', '3.00', '+2'])
    expect(rij(k, i.thuisLabel)[0]).toBe('3') // m5 niet meegeteld als thuis
    cleanup()
    const db = hoofdDb()
    db.events = db.events.filter((e) => e.id !== 'm5')
    await renderInzichten(db)
    expect(rijLabels(kaart(T.thuisUit))).toEqual([i.thuisLabel, i.uitLabel, i.totaalLabel])
  })

  it('AC-1.7 (V3): alle wedstrijdtypen tellen mee en het typefilter van de doelpuntengrafiek wijzigt deze kaart niet', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.thuisUit)
    const voor = k.textContent
    // m4 is een bekerwedstrijd, m7 een oefenwedstrijd: beide zitten in de 6
    expect(rij(k, i.totaalLabel)[0]).toBe('6')
    const doelpunten = kaart(i.doelpuntenTitle)
    fireEvent.click(within(doelpunten).getByRole('button', { name: nl.event.matchTypes.cup }))
    expect(within(doelpunten).getByRole('button', { name: nl.event.matchTypes.cup })).toHaveAttribute('aria-pressed', 'true')
    expect(kaart(T.thuisUit).textContent).toBe(voor)
    expect(kaart(T.formatie)).toHaveTextContent('4-1-4-1X')
  })

  it('AC-1.8 (V8): punten 3/1/0 — één winst 3.00, één gelijkspel 1.00, één verlies 0.00 per wedstrijd', async () => {
    for (const [gf, ga, verwacht] of [[2, 1, '3.00'], [1, 1, '1.00'], [0, 1, '0.00']] as const) {
      cleanup()
      await renderInzichten(leegDb({ events: [ev('e1', '2026-09-05', { goals_for: gf, goals_against: ga })] }))
      expect(rij(kaart(T.thuisUit), i.totaalLabel)[4]).toBe(verwacht)
    }
  })

  it('AC-1 edge (≤1 wedstrijd): nergens een percentage in de Thuis/uit-kaart', async () => {
    await renderInzichten(leegDb({ events: [ev('e1', '2026-09-05', { goals_for: 1, goals_against: 0 })] }))
    expect(kaart(T.thuisUit).textContent).not.toContain('%')
    expect(rij(kaart(T.thuisUit), i.uitLabel)).toEqual(['0', '0', '0', '0', '—', '0'])
  })

  it('AC-1 edge (limiet): bij 201 uitslagen in het venster geen cijfers maar een melding (Thuis/uit en Formatie); bij precies 200 wel', async () => {
    const maak = (n: number) =>
      Array.from({ length: n }, (_, k) =>
        ev(`w${String(k).padStart(3, '0')}`, new Date(Date.UTC(2026, 7, 1 + k)).toISOString().slice(0, 10), { goals_for: 1, goals_against: 0 }),
      )
    expect(MAX_SEIZOEN_WEDSTRIJDEN).toBe(200)
    await renderInzichten(leegDb({ events: maak(MAX_SEIZOEN_WEDSTRIJDEN + 1) }))
    expect(kaart(T.thuisUit)).toHaveTextContent(i.afgekapt)
    expect(kaart(T.thuisUit).querySelector('table')).toBeNull()
    expect(kaart(T.formatie)).toHaveTextContent(i.afgekapt)
    cleanup()
    await renderInzichten(leegDb({ events: maak(MAX_SEIZOEN_WEDSTRIJDEN) }))
    expect(kaart(T.thuisUit)).not.toHaveTextContent(i.afgekapt)
    expect(rij(kaart(T.thuisUit), i.totaalLabel)[0]).toBe('200')
  })

  it('AC-1 edge (limiet, koppeling SQL): de SQL-limit is MAX_SEIZOEN_WEDSTRIJDEN + 1', () => {
    const sql = readFileSync(join(__dirname, 'supabase/inzichten-metrics.sql'), 'utf8')
    expect(sql).toMatch(new RegExp(`limit\\s+${MAX_SEIZOEN_WEDSTRIJDEN + 1}\\b`))
  })
})

describe('2. Topscorers en betrokkenheid', () => {
  it('AC-2.1 / AC-2.2: ranglijst op doelpunten aflopend, betrokkenheid = doelpunten + assists, gelijke stand stabiel (naam)', async () => {
    await renderInzichten(hoofdDb())
    const regels = lijst(kaart(T.top))
    const w = (g: number, a: number) => fmt(i.topscorersWaarde, { doelpunten: g, assists: a, betrokken: g + a })
    expect(regels).toEqual([
      `Bram Beer${w(3, 2)}`,
      `Anna Aap${w(3, 1)}`,
      `Guus Gast${i.gastLabel}${w(2, 0)}`,
      `Cor Cobra${w(1, 0)}`,
      `Eva Ezel${w(1, 0)}`,
      `Dirk Duif${w(0, 1)}`,
    ])
  })

  it('AC-2.1 (stabiel): de volgorde hangt niet af van de volgorde waarin de database de rijen levert', async () => {
    const omgekeerd: Harness['handlers'] = {
      ...METRICS_HANDLERS,
      inzichten_speler_momenten: (db, args) => [...METRICS_HANDLERS.inzichten_speler_momenten(db, args)].reverse(),
    }
    await renderInzichten(hoofdDb(), { over: { handlers: omgekeerd } })
    const namen = lijst(kaart(T.top)).map((l) => l.split(/\d/)[0].replace(i.gastLabel, ''))
    expect(namen).toEqual(['Bram Beer', 'Anna Aap', 'Guus Gast', 'Cor Cobra', 'Eva Ezel', 'Dirk Duif'])
  })

  it('AC-2.3 (V5): percentage doelpunten met assist = assists / doelpunten (4 / 10), als benadering gelabeld', async () => {
    await renderInzichten(hoofdDb())
    expect(kaart(T.top)).toHaveTextContent(fmt(i.assistPercentage, { pct: 40 }))
    expect(kaart(T.top)).toHaveTextContent('benadering')
  })

  it('AC-2.3 (V5, begrensd): meer assists dan doelpunten geeft maximaal 100%', async () => {
    const db = leegDb({
      events: [ev('e1', '2026-09-05')],
      players: [speler('p-a', 'Anna Aap')],
      match_events: [me('e1', 'p-a', 'goal', 5), me('e1', 'p-a', 'assist', 5), me('e1', 'p-a', 'assist', 6), me('e1', 'p-a', 'assist', 7)],
    })
    await renderInzichten(db)
    expect(kaart(T.top)).toHaveTextContent(fmt(i.assistPercentage, { pct: 100 }))
    expect(kaart(T.top).textContent).not.toContain('300')
  })

  it('AC-2.4: 0 doelpunten (alleen assists) -> lege staat, geen deling door nul', async () => {
    const db = leegDb({
      events: [ev('e1', '2026-09-05')],
      players: [speler('p-a', 'Anna Aap')],
      match_events: [me('e1', 'p-a', 'assist', 5)],
    })
    await renderInzichten(db)
    expect(kaart(T.top)).toHaveTextContent(i.topscorersEmpty)
    expect(kaart(T.top).textContent).not.toMatch(/NaN|Infinity|%/)
  })

  it('AC-2.5 (V2): gasten (met label "gast") en inactieve spelers tellen mee', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.top)
    expect(k).toHaveTextContent('Guus Gast')
    expect(k).toHaveTextContent('Cor Cobra') // inactief
    const gast = lijst(k).find((l) => l.startsWith('Guus'))!
    expect(gast).toContain(i.gastLabel)
    expect(lijst(k).find((l) => l.startsWith('Cor'))).not.toContain(i.gastLabel)
  })

  it('AC-2.6: spelersdoelpunten (10) wijken af van de som van de uitslagen (9) — uitslag leidt de totalen, momenten de toewijzing, geen fout', async () => {
    await renderInzichten(hoofdDb())
    // totalen uit de uitslagen: 9 voor, 6 tegen -> +3 (m6 heeft een doelpunt van Bram maar geen uitslag)
    expect(rij(kaart(T.thuisUit), i.totaalLabel)[5]).toBe('+3')
    expect(lijst(kaart(T.top)).find((l) => l.startsWith('Bram'))).toContain('3 doelpunten')
    expect(screen.queryByText(i.bronFout)).toBeNull()
  })
})

describe('3. Eigen doelpunten per kwartier', () => {
  it('AC-3.1 / AC-3.3 (V4): bakken 1–15 … 76–90 en 90+, met de grenzen 0, 15, 16, 45, 47 (45+2), 60, 90, 91, 130', async () => {
    await renderInzichten(hoofdDb())
    expect(dataTabel(kaart(T.kwartier))).toEqual([
      ['1-15', '2'],   // minuut 0 en 15
      ['16-30', '1'],  // 16
      ['31-45', '1'],  // 45
      ['46-60', '2'],  // 47 (45+2) en 60
      ['61-75', '0'],
      ['76-90', '1'],  // 90
      ['90+', '2'],    // 91 en 130
    ])
  })

  it('AC-3.2 (V4): doelpunt zonder minuut zit in geen bak; de kaart toont "x van y doelpunten met minuut"', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.kwartier)
    expect(k).toHaveTextContent(fmt(i.kwartierDekking, { x: 9, y: 10 }))
    const som = dataTabel(k).reduce((s, r) => s + Number(r[1]), 0)
    expect(som).toBe(9)
    expect(dataTabel(k)).toHaveLength(7) // geen aparte kolom "onbekend"
  })

  it('AC-3.4: geen doelpunten met minuut (alleen doelpunten zonder minuut) -> lege staat', async () => {
    const db = leegDb({
      events: [ev('e1', '2026-09-05')],
      players: [speler('p-a', 'Anna Aap')],
      match_events: [me('e1', 'p-a', 'goal', null)],
    })
    await renderInzichten(db)
    expect(kaart(T.kwartier)).toHaveTextContent(i.kwartierEmpty)
    expect(kaart(T.kwartier).querySelector('table')).toBeNull()
  })
})

describe('4. Resultaten per formatie', () => {
  it('AC-4.1: per formatie wedstrijden, W/G/V, punten p/w, doelsaldo — gesorteerd op aantal wedstrijden, dan formatie', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.formatie)
    expect(rijLabels(k)).toEqual(['4-3-3', '3-5-2', '4-1-4-1X'])
    expect(rij(k, '4-3-3')).toEqual(['2', '1', '0', '1', '1.50', '0'])
    expect(rij(k, '3-5-2')).toEqual(['1', '0', '1', '0', '1.00', '0'])
  })

  it('AC-4.2: zonder opstelling (m5), zonder uitslag (m6) of met lege opstelling (m7) telt een wedstrijd niet mee', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.formatie)
    const totaalGespeeld = rijLabels(k).reduce((s, l) => s + Number(rij(k, l)[0]), 0)
    expect(totaalGespeeld).toBe(4) // m1, m2, m3, m4
    expect(rij(k, '4-3-3')[0]).toBe('2') // m6 (4-3-3 zonder uitslag) telt niet mee
  })

  it('AC-4.3: een onbekende formatie wordt met de ingevoerde waarde getoond', async () => {
    await renderInzichten(hoofdDb())
    expect(rij(kaart(T.formatie), '4-1-4-1X')).toEqual(['1', '1', '0', '0', '3.00', '+1'])
  })

  it('AC-4.4: geen wedstrijd met uitslag én formatie -> lege staat', async () => {
    const db = leegDb({ events: [ev('e1', '2026-09-05', { goals_for: 1, goals_against: 0 }), ev('e2', '2026-09-12')], lineups: [lineup('e2', '4-4-2')] })
    await renderInzichten(db)
    expect(kaart(T.formatie)).toHaveTextContent(i.formatieEmpty)
  })

  it('AC-4.5 (V3): alle wedstrijdtypen tellen mee — de bekerwedstrijd (m4) staat in de formatiekaart', async () => {
    await renderInzichten(hoofdDb())
    expect(kaart(T.formatie)).toHaveTextContent('4-1-4-1X')
  })
})

describe('5. Kaartenoverzicht per speler', () => {
  it('AC-5.1 / AC-5.3: per speler gele en rode kaarten, meeste kaarten (dan rood) eerst; spelers zonder kaarten niet getoond', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.kaarten)
    const w = (g: number, r: number) => fmt(i.kaartenWaarde, { geel: g, rood: r })
    expect(lijst(k)).toEqual([
      `Guus Gast${i.gastLabel}${w(1, 1)}`,
      `Anna Aap${w(2, 0)}`,
      `Bram Beer${w(0, 1)}`,
      `Cor Cobra${w(1, 0)}`,
    ])
    expect(k).not.toHaveTextContent('Eva Ezel')
    expect(k).not.toHaveTextContent('Dirk Duif')
  })

  it('AC-5.2: uitsluitend aantallen — geen schorsingsgrens of waarschuwing', async () => {
    await renderInzichten(hoofdDb())
    expect(kaart(T.kaarten).textContent).not.toMatch(/schors|suspen|waarschuw|geschorst|grens/i)
    expect(kaart(T.kaarten).querySelector('[role="alert"]')).toBeNull()
  })

  it('AC-5.3: geen kaarten in de periode -> lege staat', async () => {
    const db = hoofdDb()
    db.match_events = db.match_events.filter((m) => m.kind === 'goal' || m.kind === 'assist')
    await renderInzichten(db)
    expect(kaart(T.kaarten)).toHaveTextContent(i.kaartenEmpty)
  })

  it('AC-5.4 (V2): gast (Guus) en inactieve speler (Cor) staan in het kaartenoverzicht, de gast met label', async () => {
    await renderInzichten(hoofdDb())
    const regels = lijst(kaart(T.kaarten))
    expect(regels.find((l) => l.startsWith('Guus'))).toContain(i.gastLabel)
    expect(regels.some((l) => l.startsWith('Cor'))).toBe(true)
  })
})

describe('6. Tegendoelpunten op /inzichten', () => {
  it('AC-6.8 / AC-6.11 (V4): per kwartier en per soort, "x van y met minuut", totalen per soort', async () => {
    await renderInzichten(hoofdDb())
    const k = kaart(T.tegen)
    expect(dataTabel(k)).toEqual([
      ['1-15', '0', '0', '0'],
      ['16-30', '1', '1', '2'],
      ['31-45', '0', '0', '0'],
      ['46-60', '0', '0', '0'],
      ['61-75', '0', '0', '0'],
      ['76-90', '0', '1', '1'], // minuut 90
      ['90+', '1', '0', '1'],   // minuut 91
    ])
    expect(k).toHaveTextContent(fmt(i.tegenDekking, { x: 4, y: 5 }))
    expect(k).toHaveTextContent(fmt(i.tegenPerSoort, { standaard: 2, open: 3 }))
  })

  it('AC-6.9: wedstrijden met alleen een totaal tellen niet mee in de detailkaart; de totalen elders komen uit de uitslag', async () => {
    await renderInzichten(hoofdDb())
    // uitslagen: 6 tegendoelpunten in totaal, in de detailkaart zijn er maar 5 vastgelegd
    expect(rij(kaart(T.thuisUit), i.totaalLabel)[5]).toBe('+3') // 9 voor - 6 tegen
    expect(kaart(T.tegen)).toHaveTextContent(fmt(i.tegenDekking, { x: 4, y: 5 }))
    expect(screen.queryByText(i.bronFout)).toBeNull()
  })
})

describe('Afgeleide randvoorwaarden', () => {
  it('V6: de nieuwe kaarten komen niet in het print-/seizoensrapport', async () => {
    await renderInzichten(hoofdDb())
    configure({ defaultIgnore: STANDAARD_IGNORE })
    const print = [...document.querySelectorAll('[data-print-only]')].map((n) => n.textContent).join(' ')
    for (const t of [T.thuisUit, T.formatie, T.top, T.kaarten, T.kwartier, T.tegen]) {
      expect(print).not.toContain(t)
    }
  })

  it('AC-A2 (opruimen): tegendoelpunten staat in TEAM_TABELLEN vóór events, en in beide blok-22-lussen van het verificatiescript', () => {
    expect(TEAM_TABELLEN).toContain('tegendoelpunten')
    expect(TEAM_TABELLEN.indexOf('tegendoelpunten')).toBeLessThan(TEAM_TABELLEN.indexOf('events'))
    const sql = readFileSync(join(__dirname, 'supabase/team-rls-verificatie.sql'), 'utf8')
    const lussen = (sql.match(/foreach v_tabel in array array\[[^\]]*\]/g) ?? []).filter((l) => l.includes("'match_events'"))
    expect(lussen.length).toBeGreaterThanOrEqual(2)
    for (const lus of lussen) expect(lus).toContain("'tegendoelpunten'")
  })
})

// ═══════════════════════════════════════════════════════════════════════
// DEEL B — wedstrijdanalyse: tegendoelpunten vastleggen (echte pagina + echte actions)
// ═══════════════════════════════════════════════════════════════════════
const EV_MATCH = '0e000000-0000-4000-8000-000000000001' // uitslag 1-2, thuis
const EV_OLD = '0e000000-0000-4000-8000-000000000002' // oude wedstrijd, alleen totaal (tegen 2)
const EV_TRAIN = '0e000000-0000-4000-8000-000000000003'
const EV_OTHER = '0e000000-0000-4000-8000-000000000004' // team-2
const EV_ONBEKEND = '0e000000-0000-4000-8000-0000000000ff'
const TD_ID = (n: number) => `0d000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const a = nl.analysis

function analyseDb(over: Partial<Db> = {}): Db {
  return {
    team_members: [owner()],
    settings: [],
    events: [
      { id: EV_MATCH, team_id: TEAM, type: 'match', date: '2026-09-05', opponent: 'Ajax', home_away: 'home', goals_for: 1, goals_against: 2 },
      { id: EV_OLD, team_id: TEAM, type: 'match', date: '2026-09-12', opponent: 'PSV', home_away: 'away', goals_for: 0, goals_against: 2 },
      { id: EV_TRAIN, team_id: TEAM, type: 'training', date: '2026-09-10', opponent: null, home_away: null, goals_for: null, goals_against: null },
      { id: EV_OTHER, team_id: OTHER, type: 'match', date: '2026-09-05', opponent: 'Feyenoord', home_away: 'home', goals_for: 0, goals_against: 0 },
    ],
    attendance: [
      { team_id: TEAM, event_id: EV_MATCH, player_id: 'p1', status: 'present' },
      { team_id: TEAM, event_id: EV_OLD, player_id: 'p1', status: 'present' },
    ],
    players: [{
      id: 'p1', team_id: TEAM, name: 'Piet Peters', position: 'Spits', secondary_positions: [], jersey_number: 9,
      active: true, injured: false, type: 'regular', rating: null, created_at: '2026-01-01T00:00:00Z',
    }],
    match_ratings: [], match_events: [],
    speelminuten: [],
    tegendoelpunten: [],
    ...over,
  }
}

async function openAnalyse(eventId: string) {
  const bouw = () => AnalysisPage({ params: Promise.resolve({ id: eventId }) })
  const eerste = await bouw()
  function Shell() {
    const [el, setEl] = useState(eerste)
    useEffect(() => {
      state.refresh = () => {
        void bouw().then(setEl)
      }
    }, [])
    return (
      <DictProvider dict={nl}>
        <ToastProvider teamId={TEAM}>{el}</ToastProvider>
      </DictProvider>
    )
  }
  return render(<Shell />)
}

const sectie = () => within(screen.getByRole('region', { name: a.tegendoelpunten }))
const soortKnop = (k: 'set_piece' | 'open_play') => sectie().getByRole('button', { name: a.tegendoelpuntSoorten[k] })
const toevoegKnop = () => sectie().getByRole('button', { name: a.addTegendoelpunt })
const minuutVeld = () => sectie().getByPlaceholderText(a.minuteOptional)
const rijenIn = (db: Db, event = EV_MATCH) => db.tegendoelpunten.filter((r) => r.event_id === event)

let uuidN = 0
beforeEach(() => {
  uuidN = 0
  vi.stubGlobal('crypto', { randomUUID: () => TD_ID(900 + ++uuidN) })
})

describe('6.1 — tegendoelpunt toevoegen en terugzien', () => {
  it('AC-6.1: met bewerkrecht toevoegen met type en minuut -> direct in de lijst en nog aanwezig na herladen', async () => {
    const db = analyseDb()
    setup(db)
    const { unmount } = await openAnalyse(EV_MATCH)
    expect(sectie().getByText(a.noTegendoelpunten)).toBeInTheDocument()
    fireEvent.click(soortKnop('set_piece'))
    fireEvent.change(minuutVeld(), { target: { value: '33' } })
    fireEvent.click(toevoegKnop())

    await waitFor(() => expect(rijenIn(db)).toHaveLength(1))
    expect(rijenIn(db)[0]).toMatchObject({ team_id: TEAM, event_id: EV_MATCH, soort: 'set_piece', minute: 33 })
    await waitFor(() => expect(sectie().getByText('33′')).toBeInTheDocument())
    expect(sectie().getByText(a.tegendoelpuntSoorten.set_piece, { selector: 'span.flex-1' })).toBeInTheDocument()
    // formulier is leeg en de soortkeuze gereset
    expect(minuutVeld()).toHaveValue(null)
    expect(soortKnop('set_piece')).toHaveAttribute('aria-pressed', 'false')

    // herladen = nieuwe pagina-render vanuit de database
    unmount()
    await openAnalyse(EV_MATCH)
    expect(sectie().getByText('33′')).toBeInTheDocument()
    expect(sectie().getByText(a.tegendoelpuntSoorten.set_piece, { selector: 'span.flex-1' })).toBeInTheDocument()
  })

  it('AC-6.1 / AC-A2: de analysepagina toont alleen tegendoelpunten van het eigen team (vreemde rij op hetzelfde event_id blijft onzichtbaar)', async () => {
    const db = analyseDb({
      tegendoelpunten: [
        { id: TD_ID(1), team_id: TEAM, event_id: EV_MATCH, soort: 'open_play', minute: 70, created_at: '2026-09-05T10:00:00+00:00' },
        { id: TD_ID(2), team_id: OTHER, event_id: EV_MATCH, soort: 'set_piece', minute: 11, created_at: '2026-09-05T10:00:00+00:00' },
      ],
    })
    setup(db)
    await openAnalyse(EV_MATCH)
    expect(sectie().getByText('70′')).toBeInTheDocument()
    expect(sectie().queryByText('11′')).toBeNull()
  })
})

describe('6.2 — type: precies twee waarden', () => {
  it('AC-6.2: het formulier biedt precies twee typen (standaardsituatie, open spel), zonder voorselectie', async () => {
    setup(analyseDb())
    await openAnalyse(EV_MATCH)
    const knoppen = within(sectie().getByRole('group', { name: a.tegendoelpuntSoortLabel })).getAllByRole('button')
    expect(knoppen.map((b) => b.textContent)).toEqual([a.tegendoelpuntSoorten.set_piece, a.tegendoelpuntSoorten.open_play])
    for (const b of knoppen) expect(b).toHaveAttribute('aria-pressed', 'false')
    expect(toevoegKnop()).toBeDisabled() // type is verplicht (V7)
  })

  it.each([['anders'], [''], [null], ['goal'], ['SET_PIECE']])('AC-6.2: de server weigert soort %j met een melding en slaat niets op', async (soort) => {
    const db = analyseDb()
    const h = setup(db)
    await expect(addTegendoelpunt(TD_ID(1), EV_MATCH, soort as never, 10)).rejects.toThrow('Ongeldig tegendoelpunt')
    expect(h.inserts).toEqual([])
    expect(db.tegendoelpunten).toEqual([])
  })
})

describe('6.3 — minuut 0–130', () => {
  it.each(['131', '-1', '12.5'])('AC-6.3: minuut %s in het formulier -> melding, niets opgeslagen', async (waarde) => {
    const db = analyseDb()
    const h = setup(db)
    await openAnalyse(EV_MATCH)
    fireEvent.click(soortKnop('open_play'))
    fireEvent.change(minuutVeld(), { target: { value: waarde } })
    fireEvent.click(toevoegKnop())
    expect(await sectie().findByRole('alert')).toHaveTextContent(a.tegendoelpuntOngeldigeMinuut)
    expect(h.inserts).toEqual([])
    expect(db.tegendoelpunten).toEqual([])
  })

  it.each([131, -1, 12.5, '12', Number.NaN])('AC-6.3: de server weigert minuut %j en slaat niets op', async (minuut) => {
    const db = analyseDb()
    const h = setup(db)
    await expect(addTegendoelpunt(TD_ID(1), EV_MATCH, 'open_play', minuut as never)).rejects.toThrow('Ongeldig tegendoelpunt')
    expect(h.inserts).toEqual([])
  })

  it.each([0, 130])('AC-6.3 (grens): minuut %i is geldig', async (minuut) => {
    const db = analyseDb()
    setup(db)
    await addTegendoelpunt(TD_ID(1), EV_MATCH, 'open_play', minuut)
    expect(rijenIn(db)[0].minute).toBe(minuut)
  })
})

describe('6.4 — verwijderen met ongedaan maken', () => {
  it('AC-6.4: verwijderen haalt de rij weg, de toast biedt "Ongedaan maken" en herstelt dezelfde rij', async () => {
    const rij1 = { id: TD_ID(1), team_id: TEAM, event_id: EV_MATCH, soort: 'open_play', minute: 70, created_at: '2026-09-05T10:00:00+00:00' }
    const db = analyseDb({ tegendoelpunten: [rij1] })
    setup(db)
    await openAnalyse(EV_MATCH)
    fireEvent.click(sectie().getByRole('button', { name: a.delete }))
    await waitFor(() => expect(db.tegendoelpunten).toHaveLength(0))
    await waitFor(() => expect(sectie().getByText(a.noTegendoelpunten)).toBeInTheDocument())

    fireEvent.click(await screen.findByRole('button', { name: nl.undo.action }))
    await waitFor(() => expect(db.tegendoelpunten).toHaveLength(1))
    expect(db.tegendoelpunten[0]).toMatchObject({ id: TD_ID(1), team_id: TEAM, event_id: EV_MATCH, soort: 'open_play', minute: 70 })
    expect(new Date(db.tegendoelpunten[0].created_at as string).getTime()).toBe(new Date(rij1.created_at).getTime())
    await waitFor(() => expect(sectie().getByText('70′')).toBeInTheDocument())
  })

  it('AC-6.4: een tegendoelpunt van een ander team kan niet worden verwijderd', async () => {
    const db = analyseDb({ tegendoelpunten: [{ id: TD_ID(5), team_id: OTHER, event_id: EV_OTHER, soort: 'open_play', minute: 5, created_at: '2026-09-05T10:00:00+00:00' }] })
    setup(db)
    await expect(deleteTegendoelpunt(TD_ID(5))).rejects.toThrow('Tegendoelpunt niet gevonden')
    expect(db.tegendoelpunten).toHaveLength(1)
  })

  it('AC-6.4 / AC-6.6: herstel met een vreemd teamId wordt geweigerd en schrijft niets', async () => {
    const db = analyseDb()
    const h = setup(db)
    const snapshot: HerstelTegendoelpunt = {
      soort: 'tegendoelpunt', teamId: OTHER, id: TD_ID(7), eventId: EV_MATCH, doelpuntSoort: 'open_play', minute: 5, createdAt: null,
    }
    await expect(herstelTegendoelpunt(snapshot)).rejects.toThrow()
    expect(h.inserts).toEqual([])
    expect(db.tegendoelpunten).toEqual([])
  })
})

describe('6.5 — alleen met bewerkrecht (V9: onderdeel "wedstrijd")', () => {
  const assistent = (rechten: Row) => [{ team_id: TEAM, user_id: 'user-a', rol: 'assistent', ...rechten }]

  it('AC-6.5: zonder wedstrijdrecht geen formulier en geen verwijderknoppen, wel de lijst', async () => {
    const db = analyseDb({
      team_members: assistent({ mag_agenda_bewerken: true }),
      tegendoelpunten: [{ id: TD_ID(1), team_id: TEAM, event_id: EV_MATCH, soort: 'open_play', minute: 70, created_at: '2026-09-05T10:00:00+00:00' }],
    })
    setup(db, { userId: 'user-a' })
    await openAnalyse(EV_MATCH)
    expect(sectie().getByText('70′')).toBeInTheDocument()
    expect(sectie().queryByRole('button', { name: a.addTegendoelpunt })).toBeNull()
    expect(sectie().queryByRole('button', { name: a.delete })).toBeNull()
  })

  it('AC-6.5: zonder wedstrijdrecht weigert de server toevoegen en verwijderen ("Geen toegang"), niets verandert', async () => {
    const bestaand = { id: TD_ID(1), team_id: TEAM, event_id: EV_MATCH, soort: 'open_play', minute: 70, created_at: '2026-09-05T10:00:00+00:00' }
    const db = analyseDb({ team_members: assistent({ mag_agenda_bewerken: true, mag_training_bewerken: true }), tegendoelpunten: [bestaand] })
    const h = setup(db, { userId: 'user-a' })
    await expect(addTegendoelpunt(TD_ID(2), EV_MATCH, 'open_play', 5)).rejects.toThrow('Geen toegang')
    await expect(deleteTegendoelpunt(TD_ID(1))).rejects.toThrow('Geen toegang')
    expect(h.inserts).toEqual([])
    expect(db.tegendoelpunten).toEqual([bestaand])
  })

  it('AC-6.5 (V9) / AC-A2: een assistent MET mag_wedstrijd_bewerken mag toevoegen; de rij krijgt het team-id (niet het user-id)', async () => {
    const db = analyseDb({ team_members: assistent({ mag_wedstrijd_bewerken: true }) })
    setup(db, { userId: 'user-a' })
    await openAnalyse(EV_MATCH)
    fireEvent.click(soortKnop('open_play'))
    fireEvent.click(toevoegKnop())
    await waitFor(() => expect(rijenIn(db)).toHaveLength(1))
    expect(rijenIn(db)[0]).toMatchObject({ team_id: TEAM, soort: 'open_play', minute: null })
  })
})

describe('6.6 — alleen bij een wedstrijd van het eigen team', () => {
  it.each([
    ['wedstrijd van een ander team', EV_OTHER],
    ['training van het eigen team', EV_TRAIN],
    ['niet-bestaand event', EV_ONBEKEND],
  ])('AC-6.6: %s -> algemene foutmelding, niets opgeslagen', async (_n, event) => {
    const db = analyseDb()
    const h = setup(db)
    await expect(addTegendoelpunt(TD_ID(1), event, 'open_play', 5)).rejects.toThrow('Event niet gevonden')
    expect(h.inserts).toEqual([])
    expect(db.tegendoelpunten).toEqual([])
  })

  it('AC-6.6: een id dat al bij een ander team bestaat (23505) wordt niet als succes behandeld en lekt geen DB-tekst', async () => {
    const vreemd = { id: TD_ID(9), team_id: OTHER, event_id: EV_OTHER, soort: 'open_play', minute: 5, created_at: '2026-09-05T10:00:00+00:00' }
    const db = analyseDb({ tegendoelpunten: [vreemd] })
    setup(db)
    const fout = await addTegendoelpunt(TD_ID(9), EV_MATCH, 'open_play', 5).catch((e: Error) => e)
    expect(fout).toBeInstanceOf(Error)
    expect((fout as Error).message).toBe(GENERIC_ERROR_MESSAGE)
    expect((fout as Error).message).not.toMatch(/duplicate|pkey|constraint/)
    expect(db.tegendoelpunten).toEqual([vreemd])
  })
})

describe('6.7 — dubbel indienen', () => {
  it('AC-6.7: tijdens opslaan is het formulier niet opnieuw te versturen; precies één tegendoelpunt', async () => {
    const db = analyseDb()
    let los: () => void = () => {}
    const h = setup(db, { insertGate: new Promise<void>((r) => { los = r }) })
    await openAnalyse(EV_MATCH)
    fireEvent.click(soortKnop('open_play'))
    fireEvent.change(minuutVeld(), { target: { value: '40' } })
    fireEvent.click(toevoegKnop())
    await waitFor(() => expect(toevoegKnop()).toBeDisabled())
    expect(soortKnop('open_play')).toBeDisabled()
    expect(minuutVeld()).toBeDisabled()
    fireEvent.click(toevoegKnop()) // tweede klik tijdens pending
    los()
    await waitFor(() => expect(rijenIn(db)).toHaveLength(1))
    expect(h.inserts).toHaveLength(1)
  })

  it('AC-6.7: bij een mislukte poging blijft de id gelijk — de retry levert geen dubbel tegendoelpunt op', async () => {
    const db = analyseDb()
    let kapot = true
    const h = setup(db, { insertError: () => (kapot ? { code: 'XX000', message: 'RAW_DB_DETAIL' } : null) })
    await openAnalyse(EV_MATCH)
    fireEvent.click(soortKnop('set_piece'))
    fireEvent.change(minuutVeld(), { target: { value: '12' } })
    fireEvent.click(toevoegKnop())
    expect(await sectie().findByRole('alert')).toHaveTextContent(a.tegendoelpuntOpslaanFout)
    expect(document.body.textContent).not.toContain('RAW_DB_DETAIL')
    expect(db.tegendoelpunten).toEqual([])
    kapot = false
    fireEvent.click(toevoegKnop())
    await waitFor(() => expect(rijenIn(db)).toHaveLength(1))
    expect(h.inserts).toHaveLength(2)
    expect(h.inserts[1].payload.id).toBe(h.inserts[0].payload.id) // zelfde id
  })

  it('AC-6.7: dezelfde aanroep twee keer (netwerk-retry met dezelfde id) geeft één rij; een nieuwe id geeft een tweede rij', async () => {
    const db = analyseDb()
    setup(db)
    await addTegendoelpunt(TD_ID(1), EV_MATCH, 'open_play', 20)
    await expect(addTegendoelpunt(TD_ID(1), EV_MATCH, 'open_play', 20)).resolves.toBeUndefined()
    expect(rijenIn(db)).toHaveLength(1)
    await addTegendoelpunt(TD_ID(2), EV_MATCH, 'open_play', 20)
    expect(rijenIn(db)).toHaveLength(2)
  })
})

describe('6.9 / 6.10 / 6.12 — bestaande wedstrijden, verplichte velden, afwijkingshint, migratie ontbreekt', () => {
  it('AC-6.10 (V7): minuut is optioneel — alleen een type is genoeg en geeft een rij zonder minuut', async () => {
    const db = analyseDb()
    setup(db)
    await openAnalyse(EV_MATCH)
    fireEvent.click(soortKnop('open_play'))
    fireEvent.click(toevoegKnop())
    await waitFor(() => expect(rijenIn(db)).toHaveLength(1))
    expect(rijenIn(db)[0].minute).toBeNull()
  })

  it('AC-6.9 / AC-6.10 (O1): oude wedstrijd met alleen een totaal (tegen 2, 0 vastgelegd) werkt en toont GEEN afwijkingshint', async () => {
    setup(analyseDb())
    await openAnalyse(EV_OLD)
    expect(sectie().getByText(a.noTegendoelpunten)).toBeInTheDocument()
    expect(screen.queryByText(a.tegendoelpuntSumHint)).toBeNull()
    expect(toevoegKnop()).toBeInTheDocument()
  })

  it('AC-6.10 (V7/O1): 1 vastgelegd bij uitslag 2 -> waarschuwing, geen blokkade (toevoegen blijft kunnen); bij 2 vastgelegd verdwijnt de hint', async () => {
    const db = analyseDb({
      tegendoelpunten: [{ id: TD_ID(1), team_id: TEAM, event_id: EV_MATCH, soort: 'open_play', minute: 10, created_at: '2026-09-05T10:00:00+00:00' }],
    })
    setup(db)
    await openAnalyse(EV_MATCH)
    expect(sectie().getByText(a.tegendoelpuntSumHint)).toBeInTheDocument()
    fireEvent.click(soortKnop('set_piece'))
    fireEvent.click(toevoegKnop())
    await waitFor(() => expect(rijenIn(db)).toHaveLength(2))
    await waitFor(() => expect(sectie().queryByText(a.tegendoelpuntSumHint)).toBeNull())
  })

  it('AC-6.12: ontbreekt de tabel/migratie (leesfout), dan blijft de analysepagina werken met een lege lijst en zonder technische details', async () => {
    const db = analyseDb()
    setup(db, { selectErrors: { tegendoelpunten: { code: '42P01', message: 'relation "tegendoelpunten" does not exist RAW_DETAIL' } } })
    await openAnalyse(EV_MATCH)
    expect(sectie().getByText(a.noTegendoelpunten)).toBeInTheDocument()
    expect(screen.getByText(a.title)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/RAW_DETAIL|42P01/)
  })
})
