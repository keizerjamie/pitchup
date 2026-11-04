// Acceptatietests — inactieve spelers tellen niet mee in de overzichten
// (dashboard en agenda). Aanleiding (2026-11-04): een op inactief gezette
// speler hield zijn attendance-rijen voor komende events op 'present' en telde
// daardoor nog mee in de hero-ring en de opkomsttegel van het dashboard en in
// de "x/y"-teller per agendarij. De namenlijsten filterden al op active.
//
// Helpers zijn een kopie uit gastspelers.acceptance.test.tsx (repo-precedent:
// elk acceptatiebestand houdt zijn eigen kopie, er is geen gedeelde module).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

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

const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'

type Row = Record<string, unknown>

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

// Emulatie van inzichten_aanwezigheid (supabase/blessure-status.sql), kopie
// van rpcAanwezigheid in gastspelers.acceptance.test.tsx: alleen vaste
// spelers, injured = afwezig, type <> 'meting', datum in [p_start, p_end] —
// en bewust GEEN active-filter, precies zoals de echte functie (besluit V1).
function rpcAanwezigheid(tables: Record<string, Row[]>, args: Row) {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const events = new Map((tables.events ?? []).filter((e) => e.team_id === p_team_id).map((e) => [e.id as string, e]))
  const players = new Map((tables.players ?? []).filter((p) => p.team_id === p_team_id).map((p) => [p.id as string, p]))
  let aanwezig = 0
  let afwezig = 0
  for (const a of tables.attendance ?? []) {
    if (a.team_id !== p_team_id) continue
    const e = events.get(a.event_id as string)
    if (!e || e.type === 'meting') continue
    const datum = e.date as string
    if (datum < p_start || datum > p_end) continue
    const speler = players.get(a.player_id as string)
    if (!speler || speler.type !== 'regular') continue
    if (a.status === 'present') aanwezig++
    else if (a.status === 'absent' || a.status === 'injured') afwezig++
  }
  return [{ aanwezig, afwezig }]
}

function makeSupabase(user: { id: string } | null, tables: Record<string, Row[]>) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) =>
      t === 'team_members' ? teamMembersChain(user?.id) : tableFactory(tables[t] ?? [])(),
    rpc: (name: string, args: Row) => Promise.resolve(
      name === 'inzichten_aanwezigheid'
        ? { data: rpcAanwezigheid(tables, args), error: null }
        : { data: [], error: null },
    ),
  }
}

function makePlayer(overrides: Row = {}): Row {
  return {
    id: 'p1',
    team_id: TEAM,
    name: 'Regulier Speler',
    position: 'Spits',
    secondary_positions: [],
    jersey_number: 9,
    active: true,
    injured: false,
    type: 'regular',
    rating: 5,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function dashboardEventRow(overrides: Row = {}): Row {
  return {
    id: 'ev1',
    team_id: TEAM,
    type: 'training',
    date: '2026-08-19',
    time: null,
    location: null,
    opponent: null,
    match_type: null,
    home_away: null,
    notes: null,
    doelstelling: null,
    goals_for: null,
    goals_against: null,
    gather_time: null,
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function agendaEventRow(overrides: Row = {}): Row {
  return {
    id: 'agenda-e1',
    team_id: TEAM,
    type: 'training',
    date: '2026-08-19',
    time: '19:00',
    location: null,
    match_type: null,
    opponent: null,
    home_away: null,
    gather_time: null,
    notes: null,
    doelstelling: null,
    goals_for: null,
    goals_against: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function mockSupabase(tables: Record<string, Row[]>) {
  vi.mocked(createClient).mockResolvedValue(
    makeSupabase({ id: TEAM }, tables) as unknown as Awaited<ReturnType<typeof createClient>>,
  )
}

// De KPI-tegel komt sinds kloppende cijfers uit de RPC over de laatste 4
// weken t/m gisteren. Daarom een seizoen en een afgelopen event: dezelfde
// rijen staan ook op dat event, zodat hero (vandaag) en KPI (verleden) over
// dezelfde situatie gaan.
async function renderDashboard(players: Row[], attendance: Row[]) {
  mockSupabase({
    events: [dashboardEventRow(), dashboardEventRow({ id: 'ev-verleden', date: '2026-08-12' })],
    players,
    settings: [
      { team_id: TEAM, key: 'season_start', value: '2026-07-01' },
      { team_id: TEAM, key: 'season_end', value: '2027-06-30' },
    ],
    attendance: [...attendance, ...attendance.map((r) => ({ ...r, event_id: 'ev-verleden' }))],
    training_oefeningen: [],
    task_overrides: [],
    lineups: [],
    match_ratings: [],
    match_events: [],
  })
  const el = await DashboardPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

function attendancePercentage(): string {
  const card = screen.getByText(nl.home.statAttendance).closest('.surface-card') as HTMLElement
  return within(card).getByText(/^(\d+%|—)$/).textContent ?? ''
}

// Twee vaste spelers (1 aanwezig, 1 afwezig) plus één INACTIEVE speler die nog
// op 'present' staat — precies de situatie uit de productiedata.
const actief1 = makePlayer({ id: 'a1', name: 'Actief Een', jersey_number: 1 })
const actief2 = makePlayer({ id: 'a2', name: 'Actief Twee', jersey_number: 2 })
const inactief = makePlayer({ id: 'i1', name: 'Oud Lid', jersey_number: 3, active: false })

describe('dashboard: een inactieve speler telt niet mee', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T10:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const attendance: Row[] = [
    { event_id: 'ev1', team_id: TEAM, player_id: 'a1', status: 'present' },
    { event_id: 'ev1', team_id: TEAM, player_id: 'a2', status: 'absent' },
    { event_id: 'ev1', team_id: TEAM, player_id: 'i1', status: 'present' },
  ]

  // Kloppende cijfers, besluit V1 (bewust aangepast): de opkomsttegel neemt
  // de Inzichten-RPC exact over, en die filtert NIET op p.active. De
  // inactieve speler telt in de KPI dus mee (67%), gelijk aan /inzichten. Het
  // corrigeren van de RPC is een aparte vervolgstory.
  it('de opkomsttegel volgt de inzichten-RPC (V1): de inactieve speler telt daar mee → 67%', async () => {
    await renderDashboard([actief1, actief2, inactief], attendance)
    expect(attendancePercentage()).toBe('67%')
  })

  it('de hero toont 1/2 aanwezig — de inactieve speler zit niet in de teller', async () => {
    await renderDashboard([actief1, actief2, inactief], attendance)
    expect(screen.getAllByText(`1/2 ${nl.home.present}`).length).toBeGreaterThan(0)
    expect(screen.queryByText(`2/2 ${nl.home.present}`)).not.toBeInTheDocument()
  })

  it('de naam van de inactieve speler staat nergens op het dashboard', async () => {
    await renderDashboard([actief1, actief2, inactief], attendance)
    expect(screen.queryByText('Oud Lid')).not.toBeInTheDocument()
  })

  it('wordt de speler weer actief, dan telt hij gewoon weer mee', async () => {
    await renderDashboard([actief1, actief2, { ...inactief, active: true }], attendance)
    expect(attendancePercentage()).toBe('67%')
  })
})

describe('agenda (/events): een inactieve speler telt niet mee in de rijteller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T10:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function renderEventsPage(players: Row[], attendance: Row[]) {
    mockSupabase({ events: [agendaEventRow()], players, attendance })
    const el = await EventsPage()
    return render(<DictProvider dict={nl}>{el}</DictProvider>)
  }

  const attendance: Row[] = [
    { event_id: 'agenda-e1', team_id: TEAM, player_id: 'a1', status: 'present' },
    { event_id: 'agenda-e1', team_id: TEAM, player_id: 'a2', status: 'absent' },
    { event_id: 'agenda-e1', team_id: TEAM, player_id: 'i1', status: 'present' },
  ]

  it('toont 1/2, niet 2/3', async () => {
    await renderEventsPage([actief1, actief2, inactief], attendance)
    expect(screen.getByText(/^\d+\/\d+$/).textContent).toBe('1/2')
  })

  it('tenant-isolatie: een inactieve speler van een ANDER team met hetzelfde id-patroon filtert niets weg bij dit team', async () => {
    // De inactief-query is op team_id gescoped; een inactieve rij van team B
    // mag de telling van team A niet beïnvloeden.
    const andermansInactief = makePlayer({ id: 'a1', team_id: OTHER_TEAM, active: false })
    await renderEventsPage([actief1, actief2, andermansInactief], attendance.slice(0, 2))
    expect(screen.getByText(/^\d+\/\d+$/).textContent).toBe('1/2')
  })
})
