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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
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
import QuickActions from '@/components/dashboard/QuickActions'
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`))
})

afterEach(() => {
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
  return { id: 'p1', team_id: TEAM, name: 'Piet Peters', active: true, ...overrides }
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

function rpcAanwezigheid(db: Db, args: Row) {
  const { p_start, p_end } = args as { p_start: string; p_end: string }
  const events = new Map(db.events.map((e) => [e.id as string, e]))
  let aanwezig = 0
  let afwezig = 0
  for (const a of db.attendance) {
    if (a.team_id !== TEAM) continue
    const e = events.get(a.event_id as string)
    if (!e || e.team_id !== TEAM || e.type === 'meting') continue
    if (!inRange(e.date as string, p_start, p_end)) continue
    if (a.status === 'present') aanwezig++
    else if (a.status === 'absent') afwezig++
  }
  return [{ aanwezig, afwezig }]
}

function rpcMaandOpkomst(db: Db, args: Row) {
  const { p_start, p_end } = args as { p_start: string; p_end: string }
  const events = new Map(db.events.map((e) => [e.id as string, e]))
  const byMaand = new Map<string, { aanwezig: number; afwezig: number }>()
  for (const a of db.attendance) {
    if (a.team_id !== TEAM) continue
    const e = events.get(a.event_id as string)
    if (!e || e.team_id !== TEAM || e.type !== 'training') continue
    if (!inRange(e.date as string, p_start, p_end)) continue
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
    if (!p || p.team_id !== TEAM || !p.active) continue
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
  if (!p || p.team_id !== TEAM || !p.active) return []
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
} = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const db: Db = {
    events: opts.events ?? [],
    attendance: opts.attendance ?? [],
    match_ratings: opts.matchRatings ?? [],
    players: opts.players ?? [],
  }
  const eventsFactory = tableFactory(db.events, () => opts.eventsError ?? null)
  const playersFactory = tableFactory(db.players)
  const settingsFactory = tableFactory(opts.settings ?? [])
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

async function renderInzichten(opts: Parameters<typeof makeSupabaseMock>[0] = {}) {
  const mock = makeSupabaseMock(opts)
  vi.mocked(createClient).mockResolvedValue(mock as unknown as Awaited<ReturnType<typeof createClient>>)
  const el = await InzichtenPage()
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
      players: [playerRow({ id: 'p1', name: 'Piet Peters', active: true })],
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
      players: [playerRow({ id: PLAYER_ACTIVE })],
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
      players: [playerRow({ id: PLAYER_ACTIVE, active: true, name: 'Piet Peters' })],
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
// AC1/AC2 — toegang via de dashboardtegel
// ═══════════════════════════════════════════════════════════════════════
describe('AC1/AC2 — toegang via dashboardtegel', () => {
  it('AC2: QuickActions (dashboard "/") bevat een tegel naar /inzichten, analoog aan de bestaande tegel naar /periodisering', () => {
    render(<DictProvider dict={nl}><QuickActions t={nl} /></DictProvider>)
    // De tegel-<a> bevat ook een icoon-ligature-span; de accessible name is
    // dus "monitoring Periodisering" i.p.v. exact het label, vandaar
    // getByText (op het label-span) + closest('a') i.p.v. getByRole('link').
    const periodiseringLink = screen.getByText(nl.home.qaPeriodization).closest('a')
    const inzichtenLink = screen.getByText(nl.home.qaInsights).closest('a')
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

  it('AC8: geen aanwezigheidsdata binnen het venster → lege staat, geen verzonnen 0%', async () => {
    await renderInzichten({ settings })
    expect(screen.getByText(nl.insights.aanwezigheidEmpty)).toBeInTheDocument()
    expect(aanwezigheidPercentage()).toBeNull()
  })

  it('AC21: geen trainingen/aanwezigheidsregistraties binnen het venster → opkomst-per-maand toont zijn lege staat', async () => {
    await renderInzichten({ settings })
    expect(screen.getByText(nl.insights.opkomstEmpty)).toBeInTheDocument()
  })

  it('AC25: geen match_ratings van actieve spelers binnen het venster → team- én per-speler-weergave allebei leeg (selector verschijnt niet eens)', async () => {
    await renderInzichten({ settings, players: [playerRow({ id: PLAYER_ACTIVE, active: true })] })
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
      attendance: [attendanceRow({ event_id: 'training-1', status: 'present' })],
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
