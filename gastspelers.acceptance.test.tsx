// Acceptatietests — Gastspelers (user story: als trainer een gastspeler kunnen
// toevoegen via hetzelfde spelerformulier, herkenbaar aan een "Gast"-badge,
// standaard afwezig, en uitgesloten van teambrede statistieken).
//
// ── Scope van dit bestand (zie 03-brief.md §5.2/§5.3/§7.4 en de opdracht
// van de test-verifier-run) ──
// De meeste van de 25 acceptatiecriteria zijn al op unit-niveau bewezen door
// de bouwers (validatie, statusregels, RPC-mocks, server-actionpayloads —
// zie het testverslag voor de volledige kruisverwijzing). Dit bestand dekt
// UITSLUITEND wat van-buitenaf (via de ECHTE pagina's, niet via losse
// component-props) bewezen moet worden en dat nog niet was:
//   AC2/AC20/AC24 — Gast-badge in de ECHTE /players-route (niet alleen
//     component-niveau zoals components/PlayerList.test.tsx al deed)
//   AC8            — backfill op de ECHTE /events/<id>-route
//   AC15           — "Gast" in het printblok via de ECHTE
//     /events/<id>/training-plan-route (niet alleen AttendanceSummary
//     los gerenderd, zoals components/AttendanceSummary.test.tsx al deed)
//   AC23           — tenant-isolatie van gastspelers op de /players-route
//   O1 (brief §8)  — dashboard-opkomst met/zonder gast levert hetzelfde %,
//     via de ECHTE dashboardpagina (app/page.tsx)
//
// Bewust NIET hier gedupliceerd (zie testverslag voor waar het wél staat):
//   AC1,4,17,18,19,21,22 — app/actions/players.test.ts (server action = de
//     publieke API, er is geen aparte REST-laag erboven)
//   AC3      — app/actions/attendance.test.ts
//   AC5-7    — app/actions/{events,settings,events-bulk}.test.ts
//   AC9      — lib/attendance-rows.test.ts (volledige 8-combinatie-matrix)
//   AC10-12  — inzichten.acceptance.test.tsx (apart uitgebreid, zie
//     testverslag: de zes RPC-mock-functies daar misten het gast-filter)
//   AC13/14/16 — wedstrijdselectie.acceptance.test.tsx /
//     wedstrijdselectie-pdf.acceptance.test.tsx (apart uitgebreid)
//   O2 (markRecovered/revokeAbsencePeriod) — al volledig gedekt in
//     app/actions/players.test.ts ("markRecovered — gastspeler") en
//     app/actions/attendance.test.ts ("revokeAbsencePeriod — gastspeler"),
//     inclusief de exacte gevraagde vergelijking (gast blijft absent,
//     reguliere speler gaat naar defaultStatus, in dezelfde soort call).
//
// ── Testmethode ──
// Zelfde precedent als dashboard-vorm.acceptance.test.tsx /
// inzichten.acceptance.test.tsx / wedstrijdselectie.acceptance.test.tsx:
// de ECHTE server components (PlayersPage, EventDetailPage,
// TrainingPlanPage, DashboardPage) worden rechtstreeks aangeroepen en
// gerenderd, tegen een generieke in-memory Supabase-tabel-engine die de
// ECHTE `.eq/.neq/.gt/.gte/.lte/.lt/.in/.order/.limit`-method-chain
// toepast. Een vergeten `.eq('type','regular')` of `.eq('team_id', …)` in
// de productiecode laat deze tests dus net zo hard vallen als tegen een
// echte Postgres-database — geen call-recording-mock die alleen registreert
// dát een filter ooit is aangeroepen.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
  notFound: vi.fn(() => { throw new Error('__notFound__') }),
  useRouter: vi.fn(() => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() })),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// Nooit daadwerkelijk aangeroepen in deze tests (geen enkele test klikt een
// knop) — puur nodig zodat de imports in de gerenderde clientcomponenten
// resolven.
vi.mock('@/app/actions/attendance', () => ({
  updateAttendance: vi.fn().mockResolvedValue(undefined),
  markAllPresent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/players', () => ({
  markInjured: vi.fn().mockResolvedValue(undefined),
  markRecovered: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/events', () => ({
  deleteEvent: vi.fn().mockResolvedValue(undefined),
  updateGatherTime: vi.fn().mockResolvedValue(undefined),
}))

import { createClient } from '@/lib/supabase/server'
import PlayersPage from '@/app/players/page'
import EventDetailPage from '@/app/events/[id]/page'
import TrainingPlanPage from '@/app/events/[id]/training-plan/page'
import DashboardPage from '@/app/page'

const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'

beforeEach(() => {
  // PlayerList gebruikt useReducedMotion (lib/use-reduced-motion.ts) voor de
  // bottom-sheet-animatie; jsdom kent window.matchMedia niet standaard.
  // Zelfde stub als components/PlayerList.test.tsx.
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
})

type Row = Record<string, unknown>

// ── Generieke Supabase-tabel-engine met ECHTE filtering (kopie, zelfde
// precedent als de andere *.acceptance.test.tsx-bestanden in deze repo —
// elk bestand houdt zijn eigen kopie, er is geen gedeelde test-utils-module).
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

function makeSupabase(user: { id: string } | null, tables: Record<string, Row[]>) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) => tableFactory(tables[t] ?? [])(),
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

// ═══════════════════════════════════════════════════════════════════════
// AC2/AC20/AC24 — Gast-badge in de ECHTE /players-lijst
// ═══════════════════════════════════════════════════════════════════════
describe('AC2/AC20/AC24 — Gast-badge zichtbaar op de echte /players-route', () => {
  async function renderPlayers(players: Row[]) {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ id: TEAM }, { players }) as unknown as Awaited<ReturnType<typeof createClient>>,
    )
    const el = await PlayersPage()
    return render(<DictProvider dict={nl}>{el}</DictProvider>)
  }

  it('AC2 — een actieve gastspeler krijgt de "Gast"-badge naast zijn naam, een reguliere speler niet', async () => {
    await renderPlayers([
      makePlayer({ id: 'p1', name: 'Gast Speler', type: 'guest' }),
      makePlayer({ id: 'p2', name: 'Vaste Speler', type: 'regular' }),
    ])
    const gastNaam = screen.getByText('Gast Speler')
    expect(within(gastNaam.parentElement as HTMLElement).getByText(nl.players.guestBadge)).toBeInTheDocument()

    const vasteNaam = screen.getByText('Vaste Speler')
    expect(within(vasteNaam.parentElement as HTMLElement).queryByText(nl.players.guestBadge)).not.toBeInTheDocument()
  })

  it('AC24 — een gast die ook geblesseerd is toont BEIDE badges tegelijk ("Gast" én "Geblesseerd")', async () => {
    await renderPlayers([
      makePlayer({ id: 'p1', name: 'Geblesseerde Gast', type: 'guest', injured: true }),
    ])
    const naam = screen.getByText('Geblesseerde Gast')
    const wrap = naam.parentElement as HTMLElement
    expect(within(wrap).getByText(nl.players.guestBadge)).toBeInTheDocument()
    expect(within(wrap).getByText(nl.players.injuredBadge)).toBeInTheDocument()
  })

  it('AC20 — een inactieve gast staat gedimd in de inactieve sectie, mét de "Gast"-badge', async () => {
    await renderPlayers([
      makePlayer({ id: 'p1', name: 'Oude Gast', type: 'guest', active: false }),
    ])
    // De inactief-sectiekop moet er staan (1 inactieve speler).
    expect(screen.getByText(nl.players.inactiveLabel)).toBeInTheDocument()

    const naam = screen.getByText('Oude Gast')
    const badgeWrap = naam.parentElement as HTMLElement
    expect(within(badgeWrap).getByText(nl.players.guestBadge)).toBeInTheDocument()

    // "Gedimd" = de rij-knop draagt de opacity-klasse die PlayerList voor elke
    // inactieve speler toepast (component-niveau al bewezen voor reguliere
    // spelers; hier bewijzen we dat een GAST hetzelfde gedrag krijgt, geen
    // uitzondering).
    const row = naam.closest('button')
    expect(row).not.toBeNull()
    expect(row!.className).toMatch(/opacity-55/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC23 — Tenant-isolatie: alleen gastspelers van het eigen team
// ═══════════════════════════════════════════════════════════════════════
describe('AC23 — tenant-isolatie op de /players-route', () => {
  it('een trainer van team A ziet geen gastspeler van team B in de spelerslijst', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ id: TEAM }, {
        players: [
          makePlayer({ id: 'p1', team_id: TEAM, name: 'Eigen Gast', type: 'guest' }),
          makePlayer({ id: 'p2', team_id: OTHER_TEAM, name: 'Andermans Gast', type: 'guest' }),
        ],
      }) as unknown as Awaited<ReturnType<typeof createClient>>,
    )
    const el = await PlayersPage()
    render(<DictProvider dict={nl}>{el}</DictProvider>)

    expect(screen.getByText('Eigen Gast')).toBeInTheDocument()
    expect(screen.queryByText('Andermans Gast')).not.toBeInTheDocument()
  })

  it('niet ingelogd → redirect naar /login, geen enkele spelersrij (ook geen gast) wordt getoond', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase(null, {
        players: [makePlayer({ id: 'p1', team_id: TEAM, type: 'guest' })],
      }) as unknown as Awaited<ReturnType<typeof createClient>>,
    )
    await expect(PlayersPage()).rejects.toThrow('__redirect__:/login')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC8 — Backfill op de echte /events/<id>-route
// ═══════════════════════════════════════════════════════════════════════
function baseEventRow(overrides: Row = {}): Row {
  return {
    id: 'e1',
    team_id: TEAM,
    type: 'training',
    date: '2026-08-20',
    time: null,
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

async function renderEventPage(opts: {
  user?: { id: string } | null
  event?: Row | null
  players?: Row[]
  attendance?: Row[]
  absencePeriods?: Row[]
  id?: string
} = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const eventRows = opts.event === undefined ? [baseEventRow()] : opts.event === null ? [] : [opts.event]
  const tables: Record<string, Row[]> = {
    events: eventRows,
    players: opts.players ?? [],
    attendance: opts.attendance ?? [],
    lineups: [],
    metingen: [],
    training_oefeningen: [],
    match_ratings: [],
    match_events: [],
    match_squad: [],
    absence_periods: opts.absencePeriods ?? [],
  }
  vi.mocked(createClient).mockResolvedValue(
    makeSupabase(user, tables) as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  const el = await EventDetailPage({ params: Promise.resolve({ id: opts.id ?? 'e1' }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

// TrainingAttendance (components/TrainingAttendance.tsx) toont per speler
// precies twee statusknoppen (Aanwezig/Afwezig, aria-pressed); geen enkele
// knop pressed = 'unknown'. We lezen de rij via de naam en klimmen naar de
// rij-container — gooit een duidelijke fout als de structuur ooit wijzigt,
// i.p.v. stil een verkeerd element te matchen.
function attendanceRowFor(name: string): HTMLElement {
  const nameEl = screen.getByText(name)
  const row = nameEl.parentElement?.parentElement
  if (!row || within(row).queryAllByRole('button').length !== 2) {
    throw new Error(`Aanwezigheidsrij voor "${name}" niet gevonden in TrainingAttendance`)
  }
  return row
}
function statusOf(name: string): 'present' | 'absent' | 'unknown' {
  const row = attendanceRowFor(name)
  const pressed = within(row).queryByRole('button', { pressed: true })
  if (!pressed) return 'unknown'
  return pressed.textContent?.includes(nl.event.absentStat) ? 'absent' : 'present'
}

describe('AC8 — backfill op de eventpagina geeft een gast "absent", niet de teamdefault/"unknown"', () => {
  it('bij ontbrekende attendance-rijen krijgt een gast "absent" en een reguliere speler "unknown" (nooit de teamdefault)', async () => {
    await renderEventPage({
      players: [
        makePlayer({ id: 'p1', team_id: TEAM, name: 'Backfill Gast', type: 'guest', active: true }),
        makePlayer({ id: 'p2', team_id: TEAM, name: 'Backfill Regulier', type: 'regular', active: true }),
      ],
      attendance: [], // geen enkele rij → backfill-pad in app/events/[id]/page.tsx
    })

    expect(statusOf('Backfill Gast')).toBe('absent')
    expect(statusOf('Backfill Regulier')).toBe('unknown')
  })

  it('AC9 (backfill-pad) — een gast die ook geblesseerd is EN binnen een lopende afmeldperiode valt, blijft gewoon "absent" (geen tegenstrijdige uitkomst)', async () => {
    await renderEventPage({
      event: baseEventRow({ date: '2026-08-20' }),
      players: [
        makePlayer({ id: 'p1', team_id: TEAM, name: 'Complexe Gast', type: 'guest', active: true, injured: true }),
      ],
      attendance: [],
      absencePeriods: [
        { id: 'period-1', team_id: TEAM, player_id: 'p1', from_date: '2026-08-01', to_date: '2026-08-31', created_at: '2026-01-01T00:00:00Z' },
      ],
    })

    expect(statusOf('Complexe Gast')).toBe('absent')
  })

  it('een reeds bestaande attendance-rij van een gast wordt door de backfill met rust gelaten (alleen ONTBREKENDE rijen worden ingevuld)', async () => {
    await renderEventPage({
      players: [
        makePlayer({ id: 'p1', team_id: TEAM, name: 'Handmatig Aanwezige Gast', type: 'guest', active: true }),
      ],
      attendance: [
        { event_id: 'e1', team_id: TEAM, player_id: 'p1', status: 'present' },
      ],
    })
    // Bestaat er al een rij (bv. de trainer had de gast handmatig op aanwezig
    // gezet — AC3), dan mag de backfill die niet overschrijven.
    expect(statusOf('Handmatig Aanwezige Gast')).toBe('present')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC15 — "Gast" in het printblok van AttendanceSummary, via de echte
// /events/<id>/training-plan-route (aanwezig- én afwezig-lijst)
// ═══════════════════════════════════════════════════════════════════════
async function renderTrainingPlanPage(opts: {
  user?: { id: string } | null
  event?: Row | null
  players?: Row[]
  attendance?: Row[]
  id?: string
} = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const eventRows = opts.event === undefined
    ? [baseEventRow({ id: 'e1' })]
    : opts.event === null ? [] : [opts.event]
  const tables: Record<string, Row[]> = {
    events: eventRows,
    players: opts.players ?? [],
    attendance: opts.attendance ?? [],
    settings: [],
    metingen: [],
    training_oefeningen: [],
    oefeningen: [],
  }
  vi.mocked(createClient).mockResolvedValue(
    makeSupabase(user, tables) as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  const el = await TrainingPlanPage({ params: Promise.resolve({ id: opts.id ?? 'e1' }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

describe('AC15 — "Gast" op de afdruk van de aanwezig-/afwezigheidslijst (trainingsplan-pagina)', () => {
  it('toont "(Gast)" achter de naam van een AANWEZIGE gast in het printblok', async () => {
    await renderTrainingPlanPage({
      players: [
        makePlayer({ id: 'p1', team_id: TEAM, name: 'Aanwezige Gast', type: 'guest', jersey_number: 21 }),
      ],
      attendance: [{ event_id: 'e1', team_id: TEAM, player_id: 'p1', status: 'present' }],
    })
    expect(screen.getByText(`21 Aanwezige Gast (${nl.players.guestBadge})`)).toBeInTheDocument()
  })

  it('toont "(Gast)" achter de naam van een AFWEZIGE gast in het printblok', async () => {
    await renderTrainingPlanPage({
      players: [
        makePlayer({ id: 'p1', team_id: TEAM, name: 'Afwezige Gast', type: 'guest', jersey_number: 22 }),
      ],
      attendance: [], // geen 'present'-rij → valt in absentPlayers
    })
    expect(screen.getByText(`22 Afwezige Gast (${nl.players.guestBadge})`)).toBeInTheDocument()
  })

  it('een reguliere speler krijgt géén "(Gast)"-suffix, aanwezig noch afwezig', async () => {
    await renderTrainingPlanPage({
      players: [
        makePlayer({ id: 'p1', team_id: TEAM, name: 'Reguliere Aanwezige', type: 'regular', jersey_number: 5 }),
        makePlayer({ id: 'p2', team_id: TEAM, name: 'Reguliere Afwezige', type: 'regular', jersey_number: 6 }),
      ],
      attendance: [{ event_id: 'e1', team_id: TEAM, player_id: 'p1', status: 'present' }],
    })
    expect(screen.getByText('5 Reguliere Aanwezige')).toBeInTheDocument()
    expect(screen.getByText('6 Reguliere Afwezige')).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(`Reguliere .* \\(${nl.players.guestBadge}\\)`))).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// O1 (brief §8) — dashboard-opkomst met en zonder gast levert hetzelfde %
// ═══════════════════════════════════════════════════════════════════════
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

// Fout die de gast-query oplevert als hij faalt. `message`/`details` staan er
// bewust in: ze mogen NIET in de log belanden (lib/errors.ts logt alleen het
// statische label plus de waardevrije code).
const GUEST_QUERY_ERROR = {
  code: 'PGRST301',
  message: 'permission denied for table players',
  details: 'geheime-implementatiedetails',
  hint: null,
}

// Laat UITSLUITEND de gast-query (players + .eq('type','guest')) falen; de
// andere players-query op dezelfde tabel blijft gewoon rijen leveren. Zo
// simuleren we precies de situatie uit de bevinding: guestPlayerRows is null
// terwijl er wél attendance-rijen zijn.
function withFailingGuestQuery(supabase: ReturnType<typeof makeSupabase>): ReturnType<typeof makeSupabase> {
  return {
    ...supabase,
    from: (t: string) => {
      const chain = supabase.from(t)
      if (t !== 'players') return chain
      let isGuestQuery = false
      const origEq = chain.eq as (col: string, val: unknown) => unknown
      const origThen = chain.then as (resolve: (v: unknown) => unknown) => unknown
      chain.eq = (col: string, val: unknown) => {
        if (col === 'type' && val === 'guest') isGuestQuery = true
        origEq(col, val)
        return chain
      }
      chain.then = (resolve: (v: unknown) => unknown) => (
        isGuestQuery ? resolve({ data: null, error: GUEST_QUERY_ERROR }) : origThen(resolve)
      )
      return chain
    },
  }
}

async function renderDashboard(opts: {
  user?: { id: string } | null
  events?: Row[]
  players?: Row[]
  attendance?: Row[]
  failGuestQuery?: boolean
} = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const tables: Record<string, Row[]> = {
    events: opts.events ?? [dashboardEventRow()],
    players: opts.players ?? [],
    settings: [],
    attendance: opts.attendance ?? [],
    training_oefeningen: [],
    task_overrides: [],
    lineups: [],
    match_ratings: [],
    match_events: [],
  }
  const supabase = opts.failGuestQuery
    ? withFailingGuestQuery(makeSupabase(user, tables))
    : makeSupabase(user, tables)
  vi.mocked(createClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  const el = await DashboardPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

function attendancePercentage(): string {
  const label = screen.getByText(nl.home.statAttendance)
  const card = label.closest('.surface-card') as HTMLElement
  const el = within(card).getByText(/^(\d+%|—)$/)
  return el.textContent ?? ''
}

describe('O1 (brief §8) — dashboard-opkomst met en zonder gast levert hetzelfde percentage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T10:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('een aanwezige gast erbij verandert het opkomstpercentage niet', async () => {
    const regulars = [
      makePlayer({ id: 'r1', team_id: TEAM, name: 'Reg 1', type: 'regular' }),
      makePlayer({ id: 'r2', team_id: TEAM, name: 'Reg 2', type: 'regular' }),
    ]
    const baseAttendance: Row[] = [
      { event_id: 'ev1', team_id: TEAM, player_id: 'r1', status: 'present' },
      { event_id: 'ev1', team_id: TEAM, player_id: 'r2', status: 'absent' },
    ]

    const { unmount } = await renderDashboard({ players: regulars, attendance: baseAttendance })
    const zonderGast = attendancePercentage()
    unmount()

    const guest = makePlayer({ id: 'g1', team_id: TEAM, name: 'Gast 1', type: 'guest' })
    const attendanceMetGast: Row[] = [
      ...baseAttendance,
      { event_id: 'ev1', team_id: TEAM, player_id: 'g1', status: 'present' },
    ]
    await renderDashboard({ players: [...regulars, guest], attendance: attendanceMetGast })
    const metGast = attendancePercentage()

    expect(zonderGast).not.toBe('—') // sanity: er is daadwerkelijk een percentage berekend
    expect(metGast).toBe(zonderGast)
  })

  it('een afwezige gast erbij verandert het opkomstpercentage evenmin (telt niet mee in de noemer)', async () => {
    const regulars = [makePlayer({ id: 'r1', team_id: TEAM, name: 'Reg 1', type: 'regular' })]
    const baseAttendance: Row[] = [
      { event_id: 'ev1', team_id: TEAM, player_id: 'r1', status: 'present' },
    ]

    const { unmount } = await renderDashboard({ players: regulars, attendance: baseAttendance })
    const zonderGast = attendancePercentage()
    unmount()

    const guest = makePlayer({ id: 'g1', team_id: TEAM, name: 'Gast 1', type: 'guest' })
    const attendanceMetGast: Row[] = [
      ...baseAttendance,
      { event_id: 'ev1', team_id: TEAM, player_id: 'g1', status: 'absent' },
    ]
    await renderDashboard({ players: [...regulars, guest], attendance: attendanceMetGast })
    const metGast = attendancePercentage()

    expect(zonderGast).toBe('100%')
    expect(metGast).toBe(zonderGast)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Validator-bevinding — faalt de gast-query, dan toont de opkomsttegel GEEN
// percentage (fail-safe) in plaats van stilzwijgend een getal mét gasten
// ═══════════════════════════════════════════════════════════════════════
describe('opkomsttegel is fail-safe als de gast-query faalt', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T10:00:00'))
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
    vi.useRealTimers()
  })

  const regulars = [
    makePlayer({ id: 'r1', team_id: TEAM, name: 'Reg 1', type: 'regular' }),
    makePlayer({ id: 'r2', team_id: TEAM, name: 'Reg 2', type: 'regular' }),
  ]
  const guest = makePlayer({ id: 'g1', team_id: TEAM, name: 'Gast 1', type: 'guest' })
  // 1 aanwezige regulier + 1 afwezige regulier (= 50%) + 1 aanwezige gast.
  // Zou de gast meetellen, dan werd het 67% — precies het verkeerde getal dat
  // de tegel nooit mag tonen.
  const attendance: Row[] = [
    { event_id: 'ev1', team_id: TEAM, player_id: 'r1', status: 'present' },
    { event_id: 'ev1', team_id: TEAM, player_id: 'r2', status: 'absent' },
    { event_id: 'ev1', team_id: TEAM, player_id: 'g1', status: 'present' },
  ]
  const players = [...regulars, guest]

  it('slaagt de gast-query wél, dan staat er gewoon een percentage zonder de gast (sanity)', async () => {
    await renderDashboard({ players, attendance })
    expect(attendancePercentage()).toBe('50%')
  })

  it('faalt de gast-query, dan toont de tegel "—" in plaats van het te hoge percentage mét gast', async () => {
    await renderDashboard({ players, attendance, failGuestQuery: true })
    expect(attendancePercentage()).toBe('—')
    expect(attendancePercentage()).not.toBe('67%')
  })

  it('faalt de gast-query, dan wordt alleen het statische label plus de code gelogd — geen ruwe Supabase-melding', async () => {
    await renderDashboard({ players, attendance, failGuestQuery: true })

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const logged = String(errorSpy.mock.calls[0][0])
    expect(logged).toContain('[dashboard.guestPlayers]')
    expect(logged).toContain(GUEST_QUERY_ERROR.code)
    expect(logged).not.toContain(GUEST_QUERY_ERROR.message)
    expect(logged).not.toContain(GUEST_QUERY_ERROR.details)
  })
})
