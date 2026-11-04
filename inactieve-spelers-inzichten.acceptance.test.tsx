// Acceptatietests — inactieve spelers tellen niet mee in de TEAM-aanwezigheids-
// cijfers van Inzichten en het dashboard (story: ff-inactief-inzichten,
// 02-user-story.md, AC1–AC15).
//
// Methode (zelfde als inzichten.acceptance.test.tsx / kloppende-cijfers):
// de ECHTE server components app/inzichten/page.tsx en app/page.tsx (en
// app/events/page.tsx voor de agenda) worden gerenderd met alleen
// @/lib/supabase/server en next/* gestubd. De twee team-RPC's
// (inzichten_aanwezigheid, inzichten_training_opkomst_per_maand) en de
// per-speler-RPC worden hieronder in TS nagebootst, in exact de vorm van
// supabase/inzichten-inactieve-spelers.sql.
//
// EERLIJKE BEPERKING: de SQL zelf draait niet in jsdom. Het SQL-gedrag is hier
// alleen te dekken via (a) deze emulatie en (b) een statische controle van het
// migratiebestand onderaan dit bestand (+ inzichten-inactieve-spelers-
// migratie.acceptance.test.ts). Een fout in de echte SQL die buiten die
// patronen valt, blijft ongedekt tot de rooktest op productie (AC6).
//
// ── AC → test-mapping ──
//   AC1  → 'AC1/AC7/AC8'      (Inzichten-KPI zonder inactieve rijen)
//   AC2  → 'AC2'              (dashboard-KPI zonder inactieve speler)
//   AC3  → 'AC3/AC15'         (dashboard-% = Inzichten-% bij ?periode=4w)
//   AC4  → 'AC4'              (maandgrafiek, laatsteMaandTrend/KPI opkomst)
//   AC5  → 'AC5'              (print-rapport = scherm; PDF-route zelf: zie rapport)
//   AC6  → NIET DEKBAAR       (productiereferentie, rooktest)
//   AC7  → 'AC1/AC7/AC8' + statische SQL-test
//   AC8  → 'AC1/AC7/AC8'      (actief verleden telt niet mee)
//   AC9  → 'AC9'              (heractiveren, niets verwijderd)
//   AC10 → 'AC10'             (gast, ook inactief, blijft uitgesloten)
//   AC11 → 'AC11'             (tenant) + statische SQL-test
//   AC12 → 'AC12'             (alleen-'unknown')
//   AC13 → 'AC13'             ('—', lege staat, nergens 0%/NaN)
//   AC14 → statische SQL-test (is_team_member); niet-lid-gedrag zelf is SQL
//   AC15 → 'AC3/AC15'         (per-speler-lijst, hero, agenda)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup, configure } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { maandLabel } from '@/lib/inzichten'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
  notFound: vi.fn(() => { throw new Error('__notFound__') }),
  useRouter: vi.fn(() => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn(), replace: vi.fn() })),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
  headers: vi.fn().mockResolvedValue({ get: () => null }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import DashboardPage from '@/app/page'
import EventsPage from '@/app/events/page'
import InzichtenPage from '@/app/inzichten/page'

const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'
const NU = '2026-08-19T10:00:00' // 4-wekenvenster: 2026-07-22 t/m 2026-08-18

type Row = Record<string, unknown>
type RpcCall = { name: string; args: Row }

// ── Mock-engine (kopie van het precedent in inactieve-spelers-tellingen) ──
function teamMembersChain(userId: string | undefined) {
  const rows = userId ? [{ team_id: userId, user_id: userId, rol: 'owner' }] : []
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'neq', 'in', 'is', 'not', 'gt', 'gte', 'lt', 'lte', 'order', 'limit']) {
    chain[op] = () => chain
  }
  chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  chain.single = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: rows, error: null, count: rows.length })
  return chain
}

function tableFactory(rows: Row[]) {
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
      eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return chain },
      neq: (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return chain },
      gt: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) > (val as string | number)); return chain },
      gte: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) >= (val as string | number)); return chain },
      lte: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) <= (val as string | number)); return chain },
      lt: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) < (val as string | number)); return chain },
      in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return chain },
      not: (col: string, _op: string, val: unknown) => { filters.push((r) => r[col] !== val); return chain },
      order: (col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
        orders.push({ col, ascending: opts.ascending ?? true, nullsFirst: opts.nullsFirst ?? false })
        return chain
      },
      limit: (n: number) => { limitN = n; return chain },
      maybeSingle: () => Promise.resolve({ data: resolveRows()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: resolveRows()[0] ?? null, error: null }),
      insert: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: resolveRows(), error: null }),
    }
    return chain
  }
}

// ── RPC-emulaties: exact de filters van supabase/inzichten-inactieve-spelers.sql ──
// p.team_id, a.team_id, e.team_id = p_team_id; p.active = true; p.type = 'regular';
// injured telt als afwezig; 'unknown' telt nergens.
function spelerTelt(speler: Row | undefined, teamId: string): boolean {
  return !!speler && speler.team_id === teamId && speler.active === true && speler.type === 'regular'
}

function rpcAanwezigheid(t: Record<string, Row[]>, args: Row) {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const events = new Map((t.events ?? []).map((e) => [e.id as string, e]))
  const players = new Map((t.players ?? []).map((p) => [p.id as string, p]))
  let aanwezig = 0
  let afwezig = 0
  for (const a of t.attendance ?? []) {
    if (a.team_id !== p_team_id) continue
    const e = events.get(a.event_id as string)
    if (!e || e.team_id !== p_team_id || e.type === 'meting') continue
    if ((e.date as string) < p_start || (e.date as string) > p_end) continue
    if (!spelerTelt(players.get(a.player_id as string), p_team_id)) continue
    if (a.status === 'present') aanwezig++
    else if (a.status === 'absent' || a.status === 'injured') afwezig++
  }
  return [{ aanwezig, afwezig }]
}

function rpcMaandOpkomst(t: Record<string, Row[]>, args: Row) {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const events = new Map((t.events ?? []).map((e) => [e.id as string, e]))
  const players = new Map((t.players ?? []).map((p) => [p.id as string, p]))
  const perMaand = new Map<string, { aanwezig: number; afwezig: number }>()
  for (const a of t.attendance ?? []) {
    if (a.team_id !== p_team_id) continue
    const e = events.get(a.event_id as string)
    if (!e || e.team_id !== p_team_id || e.type !== 'training') continue
    if ((e.date as string) < p_start || (e.date as string) > p_end) continue
    if (!spelerTelt(players.get(a.player_id as string), p_team_id)) continue
    const maand = (e.date as string).slice(0, 7)
    const cur = perMaand.get(maand) ?? { aanwezig: 0, afwezig: 0 }
    if (a.status === 'present') cur.aanwezig++
    else if (a.status === 'absent' || a.status === 'injured') cur.afwezig++
    perMaand.set(maand, cur)
  }
  return [...perMaand.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([maand, v]) => ({ maand, ...v }))
}

// inzichten_aanwezigheid_per_speler (was al correct; nodig voor AC15-pariteit).
function rpcPerSpeler(t: Record<string, Row[]>, args: Row) {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const events = new Map((t.events ?? []).map((e) => [e.id as string, e]))
  const players = new Map((t.players ?? []).map((p) => [p.id as string, p]))
  const per = new Map<string, { aanwezig: number; afwezig: number }>()
  for (const a of t.attendance ?? []) {
    if (a.team_id !== p_team_id) continue
    const e = events.get(a.event_id as string)
    if (!e || e.team_id !== p_team_id || e.type === 'meting') continue
    if ((e.date as string) < p_start || (e.date as string) > p_end) continue
    const p = players.get(a.player_id as string)
    if (!spelerTelt(p, p_team_id)) continue
    const cur = per.get(p!.id as string) ?? { aanwezig: 0, afwezig: 0 }
    if (a.status === 'present') cur.aanwezig++
    else if (a.status === 'absent' || a.status === 'injured') cur.afwezig++
    per.set(p!.id as string, cur)
  }
  return [...per.entries()].map(([id, v]) => ({ player_id: id, naam: players.get(id)!.name, ...v }))
}

// inzichten_training_opkomst_per_speler (supabase/inzichten-metrics-fase2.sql, W3): bewust GEEN
// active-filter en gasten mee (met vlag); alleen trainingen; unknown telt niet.
function rpcTrainingOpkomstPerSpeler(t: Record<string, Row[]>, args: Row) {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const events = new Map((t.events ?? []).map((e) => [e.id as string, e]))
  const players = new Map((t.players ?? []).filter((p) => p.team_id === p_team_id).map((p) => [p.id as string, p]))
  const per = new Map<string, { aanwezig: number; afwezig: number }>()
  for (const a of t.attendance ?? []) {
    if (a.team_id !== p_team_id) continue
    const e = events.get(a.event_id as string)
    if (!e || e.team_id !== p_team_id || e.type !== 'training') continue
    if ((e.date as string) < p_start || (e.date as string) > p_end) continue
    const p = players.get(a.player_id as string)
    if (!p) continue
    const cur = per.get(p.id as string) ?? { aanwezig: 0, afwezig: 0 }
    if (a.status === 'present') cur.aanwezig++
    else if (a.status === 'absent' || a.status === 'injured') cur.afwezig++
    per.set(p.id as string, cur)
  }
  return [...per.entries()].map(([id, v]) => ({ player_id: id, naam: players.get(id)!.name, gast: players.get(id)!.type === 'guest', ...v }))
}

const RPC: Record<string, (t: Record<string, Row[]>, a: Row) => Row[]> = {
  inzichten_aanwezigheid: rpcAanwezigheid,
  inzichten_training_opkomst_per_maand: rpcMaandOpkomst,
  inzichten_aanwezigheid_per_speler: rpcPerSpeler,
  inzichten_training_opkomst_per_speler: rpcTrainingOpkomstPerSpeler,
}

let rpcCalls: RpcCall[] = []

function mockSupabase(tables: Record<string, Row[]>) {
  rpcCalls = []
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: TEAM } } }) },
    from: (t: string) => (t === 'team_members' ? teamMembersChain(TEAM) : tableFactory(tables[t] ?? [])()),
    rpc: (name: string, args: Row) => {
      rpcCalls.push({ name, args })
      const h = RPC[name]
      return Promise.resolve({ data: h ? h(tables, args) : [], error: null })
    },
  }
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>)
}

// ── Fixtures ──
function speler(id: string, naam: string, o: Row = {}): Row {
  return {
    id, team_id: TEAM, name: naam, position: 'Spits', secondary_positions: [], jersey_number: 9,
    active: true, injured: false, type: 'regular', rating: 5, created_at: '2024-01-01T00:00:00Z', ...o,
  }
}
function evt(id: string, date: string, o: Row = {}): Row {
  return {
    id, team_id: TEAM, type: 'training', date, time: '19:00', location: null, opponent: null, match_type: null,
    home_away: null, notes: null, doelstelling: null, goals_for: null, goals_against: null, gather_time: null,
    created_at: '2026-01-01T00:00:00Z', trainingstype: 'vct', ...o,
  }
}
const att = (event: string, player: string, status: string, team = TEAM): Row =>
  ({ event_id: event, team_id: team, player_id: player, status })

const SEIZOEN: Row[] = [
  { team_id: TEAM, key: 'season_start', value: '2026-06-01' },
  { team_id: TEAM, key: 'season_end', value: '2027-06-30' },
]

const A1 = speler('a1', 'Actief Een', { jersey_number: 1 })
const A2 = speler('a2', 'Actief Twee', { jersey_number: 2 })
const I1 = speler('i1', 'Oud Lid', { jersey_number: 3, active: false })

// Scenario: twee trainingen.
//  - juni  (tr-0615): ALLEEN de (inactieve) I1 heeft een rij → buiten het 4w-venster.
//  - juli  (tr-0729): A1 present, A2 absent, I1 present → binnen het 4w-venster.
// Met filter: 1/2 = 50% (aanwezigheid én juli-opkomst), alleen maand 2026-07.
// Zonder filter (oud gedrag): 3 present / 1 absent = 75% totaal; 4w: 2/3 = 67%.
const EVENTS = [evt('tr-0615', '2026-06-15'), evt('tr-0729', '2026-07-29')]
const ATTENDANCE = [
  att('tr-0615', 'i1', 'present'),
  att('tr-0729', 'a1', 'present'),
  att('tr-0729', 'a2', 'absent'),
  att('tr-0729', 'i1', 'present'),
]

const STANDAARD_IGNORE = 'script, style'
const NEGEER_PRINTBLOK = `${STANDAARD_IGNORE}, [data-print-only], [data-print-only] *`

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NU))
  // De Inzichten-pagina rendert scherm én print-rapport; schermqueries slaan het printblok over.
  configure({ defaultIgnore: NEGEER_PRINTBLOK })
})
afterEach(() => {
  configure({ defaultIgnore: STANDAARD_IGNORE })
  vi.useRealTimers()
  cleanup()
})

// ── Render- en leeshulpen ──
async function renderInzichten(tables: Record<string, Row[]>, periode?: string) {
  mockSupabase(tables)
  const el = periode === undefined
    ? await InzichtenPage()
    : await InzichtenPage({ searchParams: Promise.resolve({ periode }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}
async function renderDashboard(tables: Record<string, Row[]>) {
  mockSupabase(tables)
  const el = await DashboardPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}
async function renderAgenda(tables: Record<string, Row[]>) {
  mockSupabase(tables)
  const el = await EventsPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

function basis(over: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    events: EVENTS, players: [A1, A2, I1], attendance: ATTENDANCE, settings: SEIZOEN,
    training_oefeningen: [], task_overrides: [], lineups: [], match_ratings: [], match_events: [],
    categorie_metingen: [], ...over,
  }
}

// De KPI-strook (niet het print-rapport: dat heeft geen [data-kpi]).
function kpiWaarde(container: HTMLElement, id: 'opkomst' | 'aanwezigheid'): string {
  const tegel = container.querySelector(`[data-kpi="${id}"]`) as HTMLElement
  expect(tegel, `KPI-tegel ${id} ontbreekt`).not.toBeNull()
  return tegel.querySelector('p.font-display')?.textContent ?? '(geen waarde: melding)'
}
// Maanden in de sr-only tabel van de opkomst-per-maand-kaart.
function maandRijen(): string[] {
  const kaart = screen.getByText(nl.insights.opkomstTitle).closest('.surface-card') as HTMLElement
  return Array.from(kaart.querySelectorAll('table tbody tr')).map((r) => r.textContent ?? '')
}
function dashboardKpi(): string {
  const card = screen.getByText(nl.home.statAttendance).closest('.surface-card') as HTMLElement
  return within(card).getByText(/^(\d+%|—)$/).textContent ?? ''
}
const JUL = maandLabel('2026-07', nl.browserLocale)
const JUN = maandLabel('2026-06', nl.browserLocale)

// ═══════════════════════════════════════════════════════════════════════
describe('AC1/AC7/AC8 — Inzichten: inactieve speler telt niet mee in de team-aanwezigheid', () => {
  it('AC1+AC7: KPI "Totale aanwezigheid" over het seizoen is 1/2 = 50%, niet 3/4 = 75% (inactieve rijen in teller én noemer weg)', async () => {
    const { container } = await renderInzichten(basis())
    expect(kpiWaarde(container, 'aanwezigheid')).toBe('50%')
    // De donut-kaart toont hetzelfde getal.
    const kaart = screen.getByText(nl.insights.aanwezigheidTitle).closest('.surface-card') as HTMLElement
    expect(within(kaart).getByText(/^\d+%$/, { selector: 'span.font-display' }).textContent).toBe('50%')
  })

  it('AC8 (terugwerkend): de inactieve speler had in juli een actieve periode met present-rijen; die tellen niet meer mee (4w: 50%, niet 67%)', async () => {
    const { container } = await renderInzichten(basis(), '4w')
    expect(kpiWaarde(container, 'aanwezigheid')).toBe('50%')
  })

  it('AC1: de RPC krijgt het eigen team en dezelfde argumenten als altijd (contract ongewijzigd)', async () => {
    await renderInzichten(basis())
    const call = rpcCalls.find((c) => c.name === 'inzichten_aanwezigheid')!
    expect(Object.keys(call.args).sort()).toEqual(['p_end', 'p_start', 'p_team_id'])
    expect(call.args.p_team_id).toBe(TEAM)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC2 — dashboard-KPI "Aanwezigheid · laatste 4 weken" zonder de inactieve speler', () => {
  it('AC2: 1/2 = 50% (niet 2/3 = 67%)', async () => {
    await renderDashboard(basis())
    expect(dashboardKpi()).toBe('50%')
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC3/AC15 — pariteit dashboard ↔ Inzichten ↔ per-speler-lijst ↔ hero ↔ agenda', () => {
  it('AC3: dashboard-% = Inzichten-% (?periode=4w), zelfde RPC-argumenten, en beide zijn 50%', async () => {
    await renderDashboard(basis())
    const dashPct = dashboardKpi()
    const dashRpc = rpcCalls.find((c) => c.name === 'inzichten_aanwezigheid')!
    cleanup()

    const { container } = await renderInzichten(basis(), '4w')
    const inzRpc = rpcCalls.find((c) => c.name === 'inzichten_aanwezigheid')!
    expect(inzRpc.args).toEqual(dashRpc.args)
    expect(kpiWaarde(container, 'aanwezigheid')).toBe(dashPct)
    expect(dashPct).toBe('50%')
  })

  it('AC15 (per-speler-lijst): de inactieve speler staat niet in de per-speler-lijst en de lijst telt op tot het team-% (1 present + 1 absent)', async () => {
    await renderInzichten(basis(), '4w')
    // Alleen de aanwezigheid-per-speler-kaart: de trainingsopkomst-per-speler (W3) telt inactieven bewust wél.
    const kaart = screen.getByText(nl.insights.topWorstAanwezigheidTitle).closest('.surface-card') as HTMLElement
    expect(within(kaart).queryByText('Oud Lid')).not.toBeInTheDocument()
    expect(within(kaart).getAllByText('Actief Een').length).toBeGreaterThan(0)
    expect(within(kaart).getAllByText('Actief Twee').length).toBeGreaterThan(0)
    // Sommatie van de per-speler-RPC = de team-RPC (zelfde bronpopulatie).
    const t = basis()
    const args = { p_team_id: TEAM, p_start: '2026-07-22', p_end: '2026-08-18' }
    const som = rpcPerSpeler(t, args).reduce(
      (s, r) => ({ aanwezig: s.aanwezig + (r.aanwezig as number), afwezig: s.afwezig + (r.afwezig as number) }),
      { aanwezig: 0, afwezig: 0 },
    )
    expect(som).toEqual(rpcAanwezigheid(t, args)[0])
  })

  it('AC15 (hero + agenda): een komend event met de inactieve speler op "present" telt in hero en agendateller niet mee (x/y over actieve spelers)', async () => {
    const komend = [evt('ev-komend', '2026-08-19')]
    const tabellen = basis({
      events: [...EVENTS, ...komend],
      attendance: [...ATTENDANCE, att('ev-komend', 'a1', 'present'), att('ev-komend', 'a2', 'absent'), att('ev-komend', 'i1', 'present')],
    })
    await renderDashboard(tabellen)
    expect(screen.getAllByText(`1/2 ${nl.home.present}`).length).toBeGreaterThan(0)
    expect(screen.queryByText(`2/3 ${nl.home.present}`)).not.toBeInTheDocument()
    cleanup()
    await renderAgenda(tabellen)
    expect(screen.getAllByText(/^\d+\/\d+$/).map((e) => e.textContent)).toContain('1/2')
    expect(screen.queryByText('2/3')).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC4 — maandgrafiek trainingsopkomst, laatsteMaandTrend en KPI opkomst', () => {
  it('AC4: de juni-maand (alleen rijen van de inactieve speler) bestaat niet; juli = 1/2 = 50%', async () => {
    const { container } = await renderInzichten(basis())
    const rijen = maandRijen()
    expect(rijen).toHaveLength(1)
    expect(rijen[0]).toContain(JUL)
    expect(rijen[0]).toContain('50%')
    expect(rijen.join('|')).not.toContain(JUN)
    // KPI trainingsopkomst = laatste maand (juli) = 50%; zonder filter was dat 67%.
    expect(kpiWaarde(container, 'opkomst')).toBe('50%')
  })

  it('AC4: een maand waarin alleen de inactieve speler rijen heeft geeft geen delta/vergelijking met die maand (vorige maand ontbreekt)', async () => {
    const { container } = await renderInzichten(basis())
    const tegel = container.querySelector('[data-kpi="opkomst"]') as HTMLElement
    // Met filter is er maar één maand → geen vorige maand om mee te vergelijken.
    expect(tegel.textContent).not.toContain(JUN)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC5 — rapport/print gebruikt dezelfde cijfers als het scherm', () => {
  it('AC5: het print-rapport bevat 50% en geen 75%/67% aanwezigheid; de juni-maand komt er niet in voor', async () => {
    const { container } = await renderInzichten(basis())
    const print = container.querySelector('[data-print-only]') as HTMLElement
    expect(print, 'print-blok ontbreekt').not.toBeNull()
    expect(print.textContent).toContain('50%')
    expect(print.textContent).not.toContain('75%')
    expect(print.textContent).not.toContain('67%')
    expect(print.textContent).not.toContain(JUN)
    expect(print.textContent).toContain(JUL)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC9 — heractiveren: speler telt weer volledig mee, historisch, niets verwijderd', () => {
  it('AC9: zelfde data met active = true → 75% totaal, 67% juli-opkomst, juni weer zichtbaar; dashboard 67%', async () => {
    const heractief = { ...I1, active: true }
    const tabellen = basis({ players: [A1, A2, heractief] })
    const { container } = await renderInzichten(tabellen)
    expect(kpiWaarde(container, 'aanwezigheid')).toBe('75%')
    expect(kpiWaarde(container, 'opkomst')).toBe('67%')
    const rijen = maandRijen()
    expect(rijen).toHaveLength(2)
    expect(rijen.join('|')).toContain(JUN)
    cleanup()
    await renderDashboard(tabellen)
    expect(dashboardKpi()).toBe('67%')
  })

  it('AC9: er wordt niets verwijderd — de attendance-rijen van de inactieve speler blijven in de bron staan', async () => {
    const t = basis()
    await renderInzichten(t)
    expect(t.attendance.filter((r) => r.player_id === 'i1')).toHaveLength(2)
    expect(t.players.find((p) => p.id === 'i1')).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC10 — gastspelers blijven uitgesloten', () => {
  it('AC10: een gast (actief) en een inactieve gast veranderen de teamcijfers niet (nog steeds 50%)', async () => {
    const gast = speler('g1', 'Gast Actief', { type: 'guest', active: true })
    const inactieveGast = speler('g2', 'Gast Inactief', { type: 'guest', active: false })
    const tabellen = basis({
      players: [A1, A2, I1, gast, inactieveGast],
      attendance: [...ATTENDANCE, att('tr-0729', 'g1', 'present'), att('tr-0729', 'g2', 'present'), att('tr-0615', 'g1', 'present')],
    })
    const { container } = await renderInzichten(tabellen)
    expect(kpiWaarde(container, 'aanwezigheid')).toBe('50%')
    expect(maandRijen()).toHaveLength(1)
    cleanup()
    await renderDashboard(tabellen)
    expect(dashboardKpi()).toBe('50%')
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC11 — tenant-isolatie', () => {
  it('AC11: alleen het opgevraagde team telt; een inactieve speler / rijen van een ander team veranderen niets; elke RPC-call heeft p_team_id = eigen team', async () => {
    const tabellen = basis({
      events: [...EVENTS, evt('v-ev', '2026-07-29', { team_id: OTHER_TEAM })],
      players: [
        A1, A2, I1,
        speler('v-a', 'Vreemd Actief', { team_id: OTHER_TEAM }),
        speler('v-i', 'Vreemd Inactief', { team_id: OTHER_TEAM, active: false }),
      ],
      attendance: [
        ...ATTENDANCE,
        att('v-ev', 'v-a', 'present', OTHER_TEAM), att('v-ev', 'v-i', 'present', OTHER_TEAM),
        // vreemde attendance-rij op eigen event en eigen speler
        att('tr-0729', 'a2', 'present', OTHER_TEAM),
        // eigen team-rij op een vreemd event
        att('v-ev', 'a1', 'present', TEAM),
      ],
      settings: [...SEIZOEN, { team_id: OTHER_TEAM, key: 'season_start', value: '2026-01-01' }],
    })
    const { container } = await renderInzichten(tabellen)
    expect(kpiWaarde(container, 'aanwezigheid')).toBe('50%')
    expect(rpcCalls.length).toBeGreaterThan(0)
    expect(rpcCalls.every((c) => c.args.p_team_id === TEAM)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe("AC12 — alleen-'unknown' van actieve spelers ongewijzigd", () => {
  it("AC12: rijen met status 'unknown' (actief of inactief) tellen niet; geen telbare rijen → '—', geen 0%", async () => {
    const tabellen = basis({
      attendance: [att('tr-0729', 'a1', 'unknown'), att('tr-0729', 'a2', 'unknown'), att('tr-0729', 'i1', 'unknown')],
    })
    const { container } = await renderInzichten(tabellen)
    expect(kpiWaarde(container, 'aanwezigheid')).toBe('—')
    expect(container.textContent).not.toMatch(/NaN/)
    cleanup()
    await renderDashboard(tabellen)
    expect(dashboardKpi()).toBe('—')
  })

  it("AC12: 'unknown' van een actieve speler naast echte rijen verandert de uitkomst niet", async () => {
    const tabellen = basis({ attendance: [...ATTENDANCE, att('tr-0729', 'a1', 'unknown')] })
    const { container } = await renderInzichten(tabellen)
    expect(kpiWaarde(container, 'aanwezigheid')).toBe('50%')
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe("AC13 — niets telbaars over na filtering: '—', geen 0%, geen foutmelding", () => {
  // Team met ALLEEN inactieve spelers die wel rijen hebben.
  const alleenInactief = (over: Record<string, Row[]> = {}) => basis({
    players: [I1, speler('i2', 'Oud Lid Twee', { active: false })],
    attendance: [att('tr-0615', 'i1', 'present'), att('tr-0729', 'i1', 'present'), att('tr-0729', 'i2', 'absent')],
    ...over,
  })
  // Een wedstrijd met uitslag zorgt dat de pagina niet in de pagina-brede lege staat valt,
  // zodat de KPI-strook en kaarten zichtbaar zijn.
  const metUitslag = [
    ...EVENTS,
    evt('m1', '2026-07-20', { type: 'match', opponent: 'DVC', match_type: 'league', home_away: 'home', goals_for: 2, goals_against: 1 }),
  ]

  it("AC13: Inzichten (met een uitslag aanwezig) toont '—' in de aanwezigheid-KPI, een lege donut en lege maandgrafiek; nergens 0%/NaN", async () => {
    const { container } = await renderInzichten(alleenInactief({ events: metUitslag }))
    expect(kpiWaarde(container, 'aanwezigheid')).toBe('—')
    expect(screen.getByText(nl.insights.aanwezigheidEmpty)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.opkomstEmpty)).toBeInTheDocument()
    const tegels = Array.from(container.querySelectorAll('[data-kpi="aanwezigheid"], [data-kpi="opkomst"]')).map((e) => e.textContent).join(' ')
    expect(tegels).not.toMatch(/\b0%/)
    expect(container.textContent).not.toMatch(/NaN/)
  })

  it("AC13: KpiStrip krijgt null voor opkomst én aanwezigheid en toont '—' als waarde, zonder bronfoutmelding", async () => {
    const { container } = await renderInzichten(alleenInactief({ events: metUitslag }))
    for (const id of ['opkomst', 'aanwezigheid']) {
      const tegel = container.querySelector(`[data-kpi="${id}"]`) as HTMLElement
      expect(tegel, `tegel ${id}`).not.toBeNull()
      expect(tegel.querySelector('p.font-display')?.textContent).toBe('—')
      expect(tegel.textContent).not.toContain(nl.insights.bronFout)
    }
  })

  it("AC13: alleen inactieve spelers MET trainingsrijen (W3 telt hen in de per-speler-trainingsopkomst wél mee) → pagina niet leeg: KPI-strook met '—', geen 0%/NaN", async () => {
    const { container } = await renderInzichten(alleenInactief())
    expect(screen.queryByText(nl.insights.geenDataTitle)).not.toBeInTheDocument()
    expect(kpiWaarde(container, 'aanwezigheid')).toBe('—')
    expect(kpiWaarde(container, 'opkomst')).toBe('—')
    const tegels = Array.from(container.querySelectorAll('[data-kpi="aanwezigheid"], [data-kpi="opkomst"]')).map((e) => e.textContent).join(' ')
    expect(tegels).not.toMatch(/\b0%/)
    expect(container.textContent).not.toMatch(/NaN/)
  })

  it('AC13: team zonder enige trainingsrijen, alleen inactieve spelers met rijen op een meting-event → pagina-brede lege staat, nergens 0%/NaN', async () => {
    const { container } = await renderInzichten(alleenInactief({
      events: [evt('meting-1', '2026-07-20', { type: 'meting' })],
      attendance: [att('meting-1', 'i1', 'present'), att('meting-1', 'i2', 'absent')],
    }))
    expect(screen.getByText(nl.insights.geenDataTitle)).toBeInTheDocument()
    expect(container.querySelector('[data-kpi]')).toBeNull()
    expect(container.textContent).not.toMatch(/NaN|\b0%/)
  })

  it("AC13: dashboard-KPI toont '—' (geen 0%, geen NaN)", async () => {
    const { container } = await renderDashboard(alleenInactief())
    expect(dashboardKpi()).toBe('—')
    expect(container.textContent).not.toMatch(/NaN/)
    const tegel = screen.getByText(nl.home.statAttendance).closest('.surface-card') as HTMLElement
    expect(tegel.textContent).not.toMatch(/\b0%/ )
  })
})

// ═══════════════════════════════════════════════════════════════════════
// SQL-niveau (AC7, AC11, AC14): statisch, want jsdom draait geen Postgres.
describe('AC7/AC11/AC14 — statische controle van supabase/inzichten-inactieve-spelers.sql', () => {
  const sql = readFileSync(join(__dirname, 'supabase/inzichten-inactieve-spelers.sql'), 'utf8')
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  const norm = (s: string) => s.replace(/\s+/g, ' ')

  it('AC7: beide functies filteren op p.active = true (precies 2 keer) en op p.type = regular', () => {
    expect(code.match(/p\.active = true/g)).toHaveLength(2)
    expect(code.match(/p\.type = 'regular'/g)).toHaveLength(2)
  })

  it('AC11: tenantregels ongewijzigd — is_team_member + team_id van attendance, events én players op p_team_id, security invoker', () => {
    expect(code.match(/where is_team_member\(p_team_id\)/g)).toHaveLength(2)
    for (const alias of ['a', 'e', 'p']) {
      expect(code.match(new RegExp(`${alias}\\.team_id = p_team_id`, 'g'))).toHaveLength(2)
    }
    expect(norm(code)).not.toMatch(/security definer/i)
    expect(norm(code).match(/security invoker/g)).toHaveLength(2)
  })

  it('AC14: niet-lid → is_team_member(p_team_id) staat als eerste voorwaarde in de where van beide functies (lege set; gedrag zelf is Postgres/RLS en hier niet uitvoerbaar)', () => {
    const wheres = code.match(/where is_team_member\(p_team_id\)\s+and a\.team_id/g)
    expect(wheres).toHaveLength(2)
  })

  it('contract ongewijzigd: geen drop/grant/revoke, signatuur (uuid, date, date)', () => {
    expect(code).not.toMatch(/drop function|\bgrant\b|\brevoke\b/i)
    expect(code.match(/p_team_id uuid,\s*p_start date,\s*p_end date/g)).toHaveLength(2)
  })
})

// AC6 is een productiereferentie (CSW 2, meting 2026-11-04: 43,6% i.p.v. 44,9%;
// 53,9% i.p.v. 54,9%) voor de rooktest en bewust niet geautomatiseerd (geen test).
