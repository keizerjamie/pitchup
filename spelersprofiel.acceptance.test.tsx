// Acceptatietests — Spelersprofielpagina `/players/[id]` (user story: als
// trainer op één profielpagina de basisgegevens, aanwezigheid en statistieken
// van een speler zien en er direct de blessure-, bewerk- en afmeldacties op
// kunnen uitvoeren).
//
// ── Testmethode ──
// Zelfde precedent als inzichten.acceptance.test.tsx / afmeldperiode.acceptance
// .test.tsx: de ECHTE server- en client-componenten (PlayerProfilePage,
// PlayerAbsencePage, EditPlayerPage, PlayerList) worden rechtstreeks aange-
// roepen/gerenderd tegen een generieke, MUTEERBARE in-memory Supabase-
// tabel-engine (kopie van het `makeDb`-precedent uit afmeldperiode.acceptance
// .test.tsx, hier uitgebreid met een `rpc()`-handler) die de ECHTE
// `.eq/.neq/.gte/.lte/.in/.is/.order/.limit`-chain en `.insert/.upsert/.update`
// toepast. Een vergeten `.eq('team_id', …)` of een verkeerd RPC-argument in de
// productiecode laat deze tests dus net zo hard vallen als tegen een echte
// Postgres-database.
//
// ── AC → test-mapping (nummering exact zoals in de goedgekeurde story) ──
//   AC1  → 'AC1 — spelerslijst'
//   AC2  → 'AC2 — terugknop'
//   AC3  → 'AC3 — /players/[id]/edit blijft zelfstandig werken'
//   AC4  → 'AC4 — oude /players/[id]/absence-link'
//   AC5  → VERVALLEN (amendementen.md #1) — geen test, geen gat.
//   AC6/AC8 → 'AC6/AC8 — profielkop'
//   AC7  → NIET DEKBAAR IN JSDOM (zie testverslag): full-bleed edge-to-edge
//          layout is een geometrisch/visueel kenmerk (geen zichtbare zij-
//          marges op een echt scherm) dat jsdom niet layout't (geen
//          getBoundingClientRect/CSS-cascade op viewportbreedte). Een
//          classname-aanwezigheidscheck zou niets bewijzen over het
//          daadwerkelijke resultaat en dus een vals-groene test zijn.
//   AC9  → 'AC9 — standaardtab'
//   AC10 → 'AC10 — tabwissel'
//   AC11/AC12 → 'AC11/AC12 — Info-tab'
//   AC13 → 'AC13 — Aanwezigheid-tab'
//   AC14/AC15/AC16 → 'AC14/AC15/AC16 — Statistieken'
//   AC17 → 'AC17 — geen match_events-rijen'
//   AC18 → 'AC18 — geen (geldig) seizoensvenster'
//   AC19/AC20 → 'AC19/AC20 — blessure melden / hersteld melden'
//   AC21 → 'AC21 — "Speler bewerken"-link'
//   AC22 → 'AC22 — "Afmelden"-knop'
//   AC23 → 'AC23 — tenant-isolatie: notFound'
//   AC24 → 'AC24 — broncontract: elke query tenant-gescoped'
//   AC25 → 'AC25 — niet-ingelogde gebruiker'
//   AC26 → 'AC26 — ongeldig id (geen uuid)'
//   Edge → 'Edge case — …'-blokken (secundaire posities/rugnummer/rating
//          ontbrekend, geen toekomstige events, match_events buiten scope,
//          gast/inactief, onbekende/dubbele ?tab)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Player } from '@/lib/types'

const routerBack = vi.fn()
const routerPush = vi.fn()
const routerRefresh = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('__notFound__')
  }),
  useRouter: () => ({ back: routerBack, push: routerPush, refresh: routerRefresh }),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import PlayerProfilePage from '@/app/players/[id]/page'
import PlayerAbsencePage from '@/app/players/[id]/absence/page'
import EditPlayerPage from '@/app/players/[id]/edit/page'
import PlayerList from '@/components/PlayerList'

// ── team_members: de teamcontext van élke page en server action ──
// lib/team-context.ts (requireTeamContext) leest team_members vóór alles;
// zonder lidmaatschapsrij komt geen enkele pagina of action voorbij zijn
// eerste regel ('Geen team'). Deze ene tabel wordt daarom apart bediend, los
// van de mock hieronder. In fase 1 is elke gebruiker owner van precies één
// team en geldt teams.id === user.id — vanaf fase 2 kan team_id daarvan
// afwijken en is dit de plek om dat na te bootsen.
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


const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'
// Echte UUID's: isUuid() (lib/authz.ts) eist exact dit formaat, en de pagina
// controleert dat vóór elke databasetoegang (AC26).
const PLAYER = '11111111-1111-1111-1111-111111111111'
const PLAYER_OTHER_TEAM = '22222222-2222-2222-2222-222222222222'
const OTHER_PLAYER_SAME_TEAM = '55555555-5555-5555-5555-555555555555'
const INVALID_ID = 'niet-een-uuid'

// Vaste "vandaag": todayLocal() (lib/utils.ts) leest de systeemklok, en
// verledenSeizoensVenster klemt de aanwezigheid af op gisteren. Een vaste
// klok is dus nodig om AC14 (aanwezigheid t/m gisteren) deterministisch te
// maken. Middag-tijdstip (geen "Z") zoals het bestaande precedent
// (inzichten.acceptance.test.tsx), zodat de lokale tijdzone van de test-
// runner de kalenderdag niet kan laten omslaan.
const TODAY = '2026-03-15'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════
// ── Generieke, MUTEERBARE Supabase-tabel-engine ──
// Kopie van het `makeDb`-precedent uit afmeldperiode.acceptance.test.tsx
// (elk acceptatiebestand houdt zijn eigen kopie — geen gedeelde test-utils-
// module in deze repo), uitgebreid met een `rpc()`-handler en een
// `queryLog` die elke SELECT-query vastlegt (tabel + welke `.eq()`-filters
// zijn toegepast) — nodig om AC24 als broncontract te kunnen bewijzen.
// ═══════════════════════════════════════════════════════════════════════
type Row = Record<string, unknown>

interface QueryLogEntry {
  table: string
  eqFilters: [string, unknown][]
}

function makeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }))
  const queryLog: QueryLogEntry[] = []

  function table(name: string): Row[] {
    if (!tables[name]) tables[name] = []
    return tables[name]
  }

  function from(name: string) {
    const rows = table(name)
    const filters: ((r: Row) => boolean)[] = []
    const eqFilters: [string, unknown][] = []
    const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
    let limitN: number | null = null
    let mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
    let payload: Row | Row[] | null = null
    let onConflictCols: string[] | null = null

    function matches(r: Row) {
      return filters.every((f) => f(r))
    }
    function applyOrder(list: Row[]): Row[] {
      if (orders.length === 0) return list
      return [...list].sort((a, b) => {
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
    function execSelect(): Row[] {
      let out = rows.filter(matches)
      out = applyOrder(out)
      if (limitN !== null) out = out.slice(0, limitN)
      return out
    }
    function execInsert() {
      const items = (Array.isArray(payload) ? payload : [payload]) as Row[]
      const inserted: Row[] = []
      for (const item of items) {
        const row: Row = { id: `row-${rows.length}-${inserted.length}`, created_at: new Date().toISOString(), ...item }
        rows.push(row)
        inserted.push(row)
      }
      return { data: inserted, error: null }
    }
    function execUpsert() {
      const items = (Array.isArray(payload) ? payload : [payload]) as Row[]
      const result: Row[] = []
      for (const item of items) {
        let existing: Row | undefined
        if (onConflictCols) existing = rows.find((r) => onConflictCols!.every((c) => r[c] === item[c]))
        if (existing) {
          Object.assign(existing, item)
          result.push(existing)
        } else {
          const row: Row = { id: `row-${rows.length}`, created_at: new Date().toISOString(), ...item }
          rows.push(row)
          result.push(row)
        }
      }
      return { data: result, error: null }
    }
    function execUpdate() {
      const targets = rows.filter(matches)
      for (const t of targets) Object.assign(t, payload)
      return { data: targets, error: null }
    }
    function execDelete() {
      const targets = rows.filter(matches)
      for (const t of targets) {
        const idx = rows.indexOf(t)
        if (idx >= 0) rows.splice(idx, 1)
      }
      return { data: targets, error: null }
    }
    function resolve() {
      if (mode === 'select') queryLog.push({ table: name, eqFilters: [...eqFilters] })
      if (mode === 'insert') return execInsert()
      if (mode === 'upsert') return execUpsert()
      if (mode === 'update') return execUpdate()
      if (mode === 'delete') return execDelete()
      return { data: execSelect(), error: null }
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
        eqFilters.push([col, val])
        return chain
      },
      neq: (col: string, val: unknown) => {
        filters.push((r) => r[col] !== val)
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
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]))
        return chain
      },
      is: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
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
      insert: (p: Row | Row[]) => {
        mode = 'insert'
        payload = p
        return chain
      },
      upsert: (p: Row | Row[], opts: { onConflict?: string } = {}) => {
        mode = 'upsert'
        payload = p
        onConflictCols = opts.onConflict ? opts.onConflict.split(',') : null
        return chain
      },
      update: (p: Row) => {
        mode = 'update'
        payload = p
        return chain
      },
      delete: () => {
        mode = 'delete'
        return chain
      },
      single: async () => {
        const { data, error } = resolve()
        const arr = Array.isArray(data) ? data : [data]
        return { data: arr[0] ?? null, error }
      },
      maybeSingle: async () => {
        const { data, error } = resolve()
        const arr = Array.isArray(data) ? data : [data]
        return { data: arr[0] ?? null, error }
      },
      then: (onres: (v: { data: unknown; error: unknown }) => unknown, onrej?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onres, onrej),
    }
    return chain
  }

  return { tables, from, queryLog }
}

// ── RPC-engine: herberekent de twee gebruikte aggregaties
// (inzichten_aanwezigheid_per_speler, inzichten_rating_speler) vanuit de
// in-memory rijen, gefilterd op p_start/p_end/p_player én — zoals de ECHTE
// `security invoker`-RPC — op de team_id van de INGELOGDE gebruiker. Geen
// canned uitkomsten: een verkeerd doorgegeven filter/param breekt dit net zo
// hard als een echte database. ──
function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}

function rpcAanwezigheidPerSpeler(tables: Record<string, Row[]>, args: Row, actingTeam: string | null): Row[] {
  const { p_start, p_end, p_player } = args as { p_start: string; p_end: string; p_player?: string }
  const events = new Map((tables.events ?? []).map((e) => [e.id as string, e]))
  const players = new Map((tables.players ?? []).map((p) => [p.id as string, p]))
  const byPlayer = new Map<string, { aanwezig: number; afwezig: number }>()
  for (const a of tables.attendance ?? []) {
    if (a.team_id !== actingTeam) continue
    const e = events.get(a.event_id as string)
    if (!e || e.team_id !== actingTeam || e.type === 'meting') continue
    if (!inRange(e.date as string, p_start, p_end)) continue
    const p = players.get(a.player_id as string)
    if (!p || p.team_id !== actingTeam || !p.active || p.type !== 'regular') continue
    if (p_player && a.player_id !== p_player) continue
    const cur = byPlayer.get(a.player_id as string) ?? { aanwezig: 0, afwezig: 0 }
    if (a.status === 'present') cur.aanwezig++
    else if (a.status === 'absent') cur.afwezig++
    byPlayer.set(a.player_id as string, cur)
  }
  return Array.from(byPlayer.entries()).map(([playerId, v]) => ({
    player_id: playerId,
    naam: players.get(playerId)?.name ?? '',
    ...v,
  }))
}

function rpcRatingSpeler(tables: Record<string, Row[]>, args: Row, actingTeam: string | null): Row[] {
  const { p_player, p_start, p_end } = args as { p_player: string; p_start: string; p_end: string }
  const events = new Map((tables.events ?? []).map((e) => [e.id as string, e]))
  const players = new Map((tables.players ?? []).map((p) => [p.id as string, p]))
  const p = players.get(p_player)
  if (!p || p.team_id !== actingTeam || !p.active || p.type !== 'regular') return []
  const rows: Row[] = []
  for (const r of tables.match_ratings ?? []) {
    if (r.team_id !== actingTeam || r.player_id !== p_player) continue
    const e = events.get(r.event_id as string)
    if (!e || e.team_id !== actingTeam || e.type !== 'match') continue
    if (!inRange(e.date as string, p_start, p_end)) continue
    rows.push({ event_id: e.id, datum: e.date, tegenstander: e.opponent ?? null, rating: r.rating })
  }
  rows.sort((a, b) =>
    a.datum === b.datum
      ? String(a.event_id).localeCompare(String(b.event_id))
      : String(a.datum) < String(b.datum) ? -1 : 1,
  )
  return rows
}

const RPC_HANDLERS: Record<string, (tables: Record<string, Row[]>, args: Row, actingTeam: string | null) => Row[]> = {
  inzichten_aanwezigheid_per_speler: rpcAanwezigheidPerSpeler,
  inzichten_rating_speler: rpcRatingSpeler,
}

// `rpcErrors`: laat een met naam genoemde RPC `{ data: null, error }`
// teruggeven i.p.v. de herberekende rijen — nodig om het foutpad van
// getSpelerStatistieken (app/actions/inzichten.ts) via de ECHTE actie te
// bewijzen (validator-vervolgopdracht: statsError), zonder een productie-
// bestand of `@/app/actions/inzichten` te mocken.
function makeClient(
  db: ReturnType<typeof makeDb>,
  user: { id: string } | null,
  rpcErrors: Record<string, unknown> = {},
) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) =>
      t === 'team_members' ? teamMembersChain(user?.id) : db.from(t),
    rpc: (name: string, args: Row) => {
      if (rpcErrors[name]) return Promise.resolve({ data: null, error: rpcErrors[name] })
      const handler = RPC_HANDLERS[name]
      if (!handler) throw new Error(`Onbekende RPC in test: "${name}"`)
      return Promise.resolve({ data: handler(db.tables, args, user?.id ?? null), error: null })
    },
  }
}

function useDb(
  db: ReturnType<typeof makeDb>,
  user: { id: string } | null = { id: TEAM },
  rpcErrors: Record<string, unknown> = {},
) {
  vi.mocked(createClient).mockResolvedValue(
    makeClient(db, user, rpcErrors) as unknown as Awaited<ReturnType<typeof createClient>>,
  )
}

// ── Testdata-fabrieken ──
function playerRow(overrides: Row = {}): Row {
  return {
    id: PLAYER,
    team_id: TEAM,
    name: 'Jan de Tester',
    position: 'Spits',
    secondary_positions: [],
    jersey_number: 9,
    active: true,
    injured: false,
    type: 'regular',
    rating: 7,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function eventRow(overrides: Row = {}): Row {
  return {
    id: 'e',
    team_id: TEAM,
    type: 'training',
    date: '2026-01-01',
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
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function attendanceRow(overrides: Row = {}): Row {
  return {
    id: 'a',
    team_id: TEAM,
    event_id: 'e',
    player_id: PLAYER,
    status: 'unknown',
    injury_set: false,
    absence_period_id: null,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function seasonSettings(start: string, end: string): Row[] {
  return [
    { team_id: TEAM, key: 'season_start', value: start },
    { team_id: TEAM, key: 'season_end', value: end },
  ]
}

async function renderProfile(id: string, sp: Record<string, string | string[]> = {}) {
  const el = await PlayerProfilePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

// Vindt de numerieke waarde in dezelfde stat-tegel als het gegeven label
// (components/players/PlayerStatsTab.tsx: StatTegel = icoon + waarde + label
// in één wrapper-div).
function statTegelValue(label: string): string {
  const labelEl = screen.getByText(label)
  const value = within(labelEl.parentElement as HTMLElement).getByText(/^\d+$/)
  return value.textContent ?? ''
}

// ═══════════════════════════════════════════════════════════════════════
// AC1 — spelerslijst: tik op naam navigeert direct, geen bottom-sheet
// ═══════════════════════════════════════════════════════════════════════
describe('AC1 — spelerslijst navigeert direct naar het profiel', () => {
  it('elke rij is een link naar /players/<id>; er verschijnt geen actiemenu (bottom-sheet)', () => {
    const player: Player = {
      id: PLAYER,
      name: 'Jan Jansen',
      position: 'Spits',
      secondary_positions: [],
      jersey_number: 9,
      active: true,
      injured: false,
      type: 'regular',
      rating: 7,
      created_at: '2024-01-01T00:00:00Z',
    }
    render(
      <DictProvider dict={nl}>
        <PlayerList active={[player]} inactive={[]} canEdit />
      </DictProvider>,
    )
    const row = screen.getByText('Jan Jansen').closest('a')
    expect(row).not.toBeNull()
    expect(row).toHaveAttribute('href', `/players/${PLAYER}`)

    // Geen bottom-sheet-menu meer: de actieknoppen bestaan hier niet.
    expect(screen.queryByText(nl.players.reportInjury)).not.toBeInTheDocument()
    expect(screen.queryByText(nl.players.signOff)).not.toBeInTheDocument()
    expect(screen.queryByText(nl.players.editLabel)).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC2 — terugknop keert terug naar de spelerslijst
// ═══════════════════════════════════════════════════════════════════════
describe('AC2 — terugknop keert terug naar de vorige pagina', () => {
  it('tikken op de terugknop roept router.back() aan', async () => {
    const db = makeDb({ players: [playerRow()] })
    useDb(db)
    await renderProfile(PLAYER)

    // Simuleer bestaande navigatiehistorie zodat BackButton (component/
    // BackButton.tsx) voor router.back() kiest i.p.v. de fallback-push.
    history.pushState({}, '', '/players')
    history.pushState({}, '', `/players/${PLAYER}`)

    fireEvent.click(screen.getByRole('button', { name: nl.nav.back }))
    expect(routerBack).toHaveBeenCalledTimes(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC3 — /players/[id]/edit blijft zelfstandig oproepbaar
// ═══════════════════════════════════════════════════════════════════════
describe('AC3 — /players/[id]/edit blijft zelfstandig werken', () => {
  it('rendert de bestaande bewerkvelden onveranderd', async () => {
    const db = makeDb({ players: [playerRow({ name: 'Jan de Tester', jersey_number: 9 })] })
    useDb(db)
    const el = await EditPlayerPage({ params: Promise.resolve({ id: PLAYER }) })
    render(<DictProvider dict={nl}>{el}</DictProvider>)

    expect(screen.getByDisplayValue('Jan de Tester')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.players.save })).toBeInTheDocument()
    expect(screen.getByText(nl.players.deletePlayer)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC4 — oude /players/[id]/absence-link: pure redirect, geen query
// ═══════════════════════════════════════════════════════════════════════
describe('AC4 — oude /players/[id]/absence-link redirect direct naar het profiel', () => {
  it('redirect naar /players/<id>?tab=aanwezigheid, zonder enige databasetoegang', async () => {
    await expect(PlayerAbsencePage({ params: Promise.resolve({ id: PLAYER }) })).rejects.toThrow(
      `__redirect__:/players/${PLAYER}?tab=aanwezigheid`,
    )
    // Geen tussenscherm, geen guard hier: /players/[id]/absence/page.tsx
    // importeert zelfs geen supabase-client (brief §2.2).
    expect(createClient).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC6/AC8 — profielkop: naam, positie, avatar-initialen, beschikbaarheidspil
// ═══════════════════════════════════════════════════════════════════════
describe('AC6/AC8 — profielkop toont naam, positie, avatar en de juiste beschikbaarheidspil', () => {
  it('injured=false ⇒ "Beschikbaar"', async () => {
    const db = makeDb({ players: [playerRow({ name: 'Jan de Tester', position: 'Spits', injured: false })] })
    useDb(db)
    await renderProfile(PLAYER)

    const header = document.querySelector('header') as HTMLElement
    expect(header).not.toBeNull()
    expect(within(header).getByText('Jan de Tester')).toBeInTheDocument()
    expect(within(header).getByText(nl.players.positions['Spits'])).toBeInTheDocument()
    // initialsOf('Jan de Tester') = eerste letter eerste woord + eerste letter laatste woord.
    expect(within(header).getByText('JT')).toBeInTheDocument()
    expect(within(header).getByText(nl.players.availableBadge)).toBeInTheDocument()
  })

  it('injured=true ⇒ "Geblesseerd"', async () => {
    const db = makeDb({ players: [playerRow({ injured: true })] })
    useDb(db)
    await renderProfile(PLAYER)

    const header = document.querySelector('header') as HTMLElement
    expect(within(header).getByText(nl.players.injuredBadge)).toBeInTheDocument()
    expect(within(header).queryByText(nl.players.availableBadge)).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC9 — standaardtab is Info, tenzij via de redirect (?tab=aanwezigheid)
// ═══════════════════════════════════════════════════════════════════════
describe('AC9 — standaard-geopende tab', () => {
  it('zonder ?tab is Info actief', async () => {
    const db = makeDb({ players: [playerRow()] })
    useDb(db)
    await renderProfile(PLAYER)
    expect(screen.getByRole('button', { name: nl.players.profileTabInfo })).toHaveAttribute('aria-pressed', 'true')
  })

  it('met ?tab=aanwezigheid (zoals de redirect vanaf de oude afmeldlink) is Aanwezigheid actief', async () => {
    const db = makeDb({ players: [playerRow()] })
    useDb(db)
    await renderProfile(PLAYER, { tab: 'aanwezigheid' })
    expect(screen.getByRole('button', { name: nl.players.profileTabAttendance })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC10 — tabwissel client-side, zonder page reload
// ═══════════════════════════════════════════════════════════════════════
describe('AC10 — tikken op een andere tab wisselt zonder de pagina te herladen', () => {
  it('klik op Statistieken activeert die tab en de Info-inhoud verdwijnt uit de DOM', async () => {
    const db = makeDb({ players: [playerRow()] })
    useDb(db)
    await renderProfile(PLAYER)

    expect(screen.getByText(nl.players.profileInfoTitle)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: nl.players.profileTabStats }))

    expect(screen.getByRole('button', { name: nl.players.profileTabStats })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(nl.players.profileInfoTitle)).not.toBeInTheDocument()
    // "Zonder de pagina te herladen": geen navigatie- of refresh-call.
    expect(routerPush).not.toHaveBeenCalled()
    expect(routerRefresh).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC11/AC12 — Info-tab: labels/waarden + thema-tokens i.p.v. POSITION_COLORS
// ═══════════════════════════════════════════════════════════════════════
describe('AC11/AC12 — Info-tab toont alle velden, positie via thema-tokens', () => {
  it('toont naam, positie, nevenposities, rugnummer, beoordeling, spelertype en actief-in-selectie', async () => {
    const db = makeDb({
      players: [
        playerRow({
          name: 'Jan de Tester',
          position: 'Spits',
          secondary_positions: ['Rechtsbuiten'],
          jersey_number: 9,
          rating: 7,
          type: 'regular',
          active: true,
        }),
      ],
    })
    useDb(db)
    await renderProfile(PLAYER)

    const infoCard = screen.getByText(nl.players.profileInfoTitle).closest('.surface-card') as HTMLElement
    expect(infoCard).not.toBeNull()
    expect(within(infoCard).getByText('Jan de Tester')).toBeInTheDocument()
    expect(within(infoCard).getByText(nl.players.positions['Spits'])).toBeInTheDocument()
    expect(within(infoCard).getByText(nl.players.positions['Rechtsbuiten'])).toBeInTheDocument()
    expect(within(infoCard).getByText('9')).toBeInTheDocument()
    expect(within(infoCard).getByText('7')).toBeInTheDocument()
    expect(within(infoCard).getByText(nl.players.typeRegular)).toBeInTheDocument()
    expect(within(infoCard).getByText(nl.players.profileYes)).toBeInTheDocument()
  })

  it('AC12: de positiebadge gebruikt --panel-tokens, geen POSITION_COLORS-Tailwind-klassen', async () => {
    // 'Spits' hoort bij de groep Aanvallers → --panel-red-tokens
    // (components/players/PlayerInfoTab.tsx POSITIE_GROEP_TOKENS), terwijl
    // POSITION_COLORS (lib/types.ts) daarvoor de hardcoded 'bg-red-100
    // text-red-800' gebruikt — precies wat AC12 verbiedt.
    const db = makeDb({ players: [playerRow({ position: 'Spits' })] })
    useDb(db)
    await renderProfile(PLAYER)

    const infoCard = screen.getByText(nl.players.profileInfoTitle).closest('.surface-card') as HTMLElement
    const badge = within(infoCard).getByText(nl.players.positions['Spits'])
    expect(badge.getAttribute('style') ?? '').toMatch(/var\(--panel-red/)
    expect(badge.className).not.toMatch(/bg-(red|blue|green|yellow|amber)-100/)
  })

  it('Edge case: ontbrekende nevenposities/rugnummer/beoordeling tonen "—", geen crash', async () => {
    const db = makeDb({
      players: [playerRow({ secondary_positions: [], jersey_number: null, rating: null })],
    })
    useDb(db)
    await renderProfile(PLAYER)

    const infoCard = screen.getByText(nl.players.profileInfoTitle).closest('.surface-card') as HTMLElement
    expect(within(infoCard).getAllByText('—')).toHaveLength(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC13 — Aanwezigheid-tab: zelfde data/component als /players/[id]/absence
// ═══════════════════════════════════════════════════════════════════════
describe('AC13 — Aanwezigheid-tab rendert PlayerAbsenceList met dezelfde data', () => {
  it('toont het aankomende event en de afmeldperiode uit de fixture', async () => {
    const db = makeDb({
      players: [playerRow()],
      events: [eventRow({ id: 'ev-upcoming', type: 'match', date: '2026-03-20', opponent: 'FC Toekomst' })],
      attendance: [attendanceRow({ event_id: 'ev-upcoming', status: 'present' })],
      absence_periods: [{ id: 'per1', team_id: TEAM, player_id: PLAYER, from_date: '2026-04-01', to_date: '2026-04-10' }],
    })
    useDb(db)
    await renderProfile(PLAYER, { tab: 'aanwezigheid' })

    expect(screen.getByText(nl.players.attendanceTitle)).toBeInTheDocument()
    expect(screen.getByText('vs FC Toekomst')).toBeInTheDocument()
  })

  it('Edge case: geen toekomstige events ⇒ de bestaande lege staat (noUpcomingEvents)', async () => {
    const db = makeDb({ players: [playerRow()] })
    useDb(db)
    await renderProfile(PLAYER, { tab: 'aanwezigheid' })
    expect(screen.getByText(nl.players.noUpcomingEvents)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC14/AC15/AC16 — Statistieken: percentage, gemiddelde + reeks, tellingen
// ═══════════════════════════════════════════════════════════════════════
describe('AC14/AC15/AC16 — Statistieken-tab toont de juiste cijfers uit de fixture', () => {
  it('aanwezigheidspercentage, gemiddelde beoordeling + reeks, en vier tellingen kloppen', async () => {
    const db = makeDb({
      players: [playerRow()],
      settings: seasonSettings('2025-07-01', '2026-06-30'),
      events: [
        eventRow({ id: 'train-1', type: 'training', date: '2025-08-01' }),
        eventRow({ id: 'train-2', type: 'training', date: '2025-08-08' }),
        eventRow({ id: 'train-3', type: 'training', date: '2025-08-15' }),
        eventRow({ id: 'train-4', type: 'training', date: '2025-08-22' }),
        eventRow({ id: 'match-1', type: 'match', date: '2025-09-05', opponent: 'FC Alpha' }),
        eventRow({ id: 'match-2', type: 'match', date: '2025-10-10', opponent: 'FC Beta' }),
      ],
      attendance: [
        attendanceRow({ event_id: 'train-1', status: 'present' }),
        attendanceRow({ event_id: 'train-2', status: 'present' }),
        attendanceRow({ event_id: 'train-3', status: 'present' }),
        attendanceRow({ event_id: 'train-4', status: 'absent' }),
      ],
      match_ratings: [
        { id: 'r1', team_id: TEAM, event_id: 'match-1', player_id: PLAYER, rating: 7 },
        { id: 'r2', team_id: TEAM, event_id: 'match-2', player_id: PLAYER, rating: 9 },
      ],
      match_events: [
        { id: 'me1', team_id: TEAM, event_id: 'match-1', player_id: PLAYER, kind: 'goal' },
        { id: 'me2', team_id: TEAM, event_id: 'match-1', player_id: PLAYER, kind: 'goal' },
        { id: 'me3', team_id: TEAM, event_id: 'match-2', player_id: PLAYER, kind: 'assist' },
        { id: 'me4', team_id: TEAM, event_id: 'match-2', player_id: PLAYER, kind: 'yellow' },
      ],
    })
    useDb(db)
    await renderProfile(PLAYER, { tab: 'statistieken' })

    // AC14: 3 aanwezig / 1 afwezig (venster t/m gisteren, 2026-03-14 — alle
    // vier trainingen liggen in augustus 2025 en vallen ruim binnen) = 75%.
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(
      screen.getByText(nl.players.statsAttendanceDetail.replace('{aanwezig}', '3').replace('{totaal}', '4')),
    ).toBeInTheDocument()

    // AC15: (7+9)/2 = 8.0, reeks toont beide wedstrijden.
    expect(screen.getByText('8.0')).toBeInTheDocument()
    expect(screen.getByText(/FC Alpha/)).toBeInTheDocument()
    expect(screen.getByText(/FC Beta/)).toBeInTheDocument()

    // AC16: 2 doelpunten, 1 assist, 1 gele kaart, 0 rode kaarten.
    expect(statTegelValue(nl.players.statsGoals)).toBe('2')
    expect(statTegelValue(nl.players.statsAssists)).toBe('1')
    expect(statTegelValue(nl.players.statsYellow)).toBe('1')
    expect(statTegelValue(nl.players.statsRed)).toBe('0')
  })

  it('Edge case: match_events van een andere speler, een ander team, of buiten het seizoen tellen niet mee', async () => {
    const db = makeDb({
      players: [playerRow(), playerRow({ id: OTHER_PLAYER_SAME_TEAM, name: 'Andere Speler' })],
      settings: seasonSettings('2025-07-01', '2026-06-30'),
      events: [
        eventRow({ id: 'match-in-season', type: 'match', date: '2025-09-01' }),
        eventRow({ id: 'match-other-team', type: 'match', date: '2025-09-01', team_id: OTHER_TEAM }),
        eventRow({ id: 'match-buiten-seizoen', type: 'match', date: '2024-01-01' }),
      ],
      match_events: [
        // Telt mee: eigen speler, eigen team, binnen het seizoen.
        { id: 'me1', team_id: TEAM, event_id: 'match-in-season', player_id: PLAYER, kind: 'goal' },
        // Telt niet mee: andere speler.
        { id: 'me2', team_id: TEAM, event_id: 'match-in-season', player_id: OTHER_PLAYER_SAME_TEAM, kind: 'goal' },
        // Telt niet mee: ander team (event zelf valt al buiten de team-gescoped events-query).
        { id: 'me3', team_id: OTHER_TEAM, event_id: 'match-other-team', player_id: PLAYER, kind: 'goal' },
        // Telt niet mee: wedstrijd buiten het seizoensvenster.
        { id: 'me4', team_id: TEAM, event_id: 'match-buiten-seizoen', player_id: PLAYER, kind: 'goal' },
      ],
    })
    useDb(db)
    await renderProfile(PLAYER, { tab: 'statistieken' })

    expect(statTegelValue(nl.players.statsGoals)).toBe('1')
    expect(statTegelValue(nl.players.statsAssists)).toBe('0')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC17 — speler zonder match_events-rijen: vier keer "0", een echte telling
// ═══════════════════════════════════════════════════════════════════════
describe('AC17 — speler zonder match_events-rijen binnen het seizoen', () => {
  it('toont vier keer "0" voor doelpunten/assists/gele/rode kaarten', async () => {
    const db = makeDb({
      players: [playerRow()],
      settings: seasonSettings('2025-07-01', '2026-06-30'),
    })
    useDb(db)
    await renderProfile(PLAYER, { tab: 'statistieken' })

    expect(statTegelValue(nl.players.statsGoals)).toBe('0')
    expect(statTegelValue(nl.players.statsAssists)).toBe('0')
    expect(statTegelValue(nl.players.statsYellow)).toBe('0')
    expect(statTegelValue(nl.players.statsRed)).toBe('0')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC18 — geen (geldig) seizoensvenster: lege staat, geen cijfers
// ═══════════════════════════════════════════════════════════════════════
describe('AC18 — geen geldig seizoensvenster', () => {
  it.each([
    ['geen instellingen', [] as Row[]],
    ['ongeldig seizoen (einddatum vóór startdatum)', seasonSettings('2026-08-01', '2026-01-01')],
  ])('%s ⇒ lege staat met link naar /settings, geen percentage of cijfer', async (_label, settingsRows) => {
    const db = makeDb({ players: [playerRow()], settings: settingsRows })
    useDb(db)
    await renderProfile(PLAYER, { tab: 'statistieken' })

    expect(screen.getByText(nl.insights.noSeason)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.noSeasonHint)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.insights.goToSettings })).toHaveAttribute('href', '/settings')
    expect(screen.queryByText(nl.players.statsGoals)).not.toBeInTheDocument()
    expect(screen.queryByText('75%')).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Foutpad van de statistieken (statsError) — validator-vervolgopdracht
// (app/players/[id]/page.tsx: getSpelerStatistieken(id) staat in een
// try/catch; bij een throw blijft stats=null en gaat statsError=true naar
// PlayerProfile/PlayerStatsTab, die dan t.players.statsLoadError toont —
// losgetrokken van "geen seizoen", en zonder de rest van het profiel om te
// laten kiepen). Dit is GEEN apart AC-nummer uit de story, maar rechtstreeks
// door de validator gevraagde dekking van een door de bouwers toegevoegde
// faaltoestand.
// ═══════════════════════════════════════════════════════════════════════
describe('Foutpad — RPC-fout tijdens het laden van de statistieken (statsError)', () => {
  it('de pagina rendert gewoon (kop, Info-tab, tabs); de Statistieken-tab toont statsLoadError, geen rauwe melding en geen "geen seizoen"-link', async () => {
    // Een geldig seizoen is bewust gezet: anders zou seizoensVenster() al vóór
    // de RPC-aanroep null teruggeven en zou deze test per ongeluk het AC18-pad
    // (lege staat) bewijzen in plaats van het foutpad.
    const db = makeDb({
      players: [playerRow({ name: 'Jan de Tester' })],
      settings: seasonSettings('2025-07-01', '2026-06-30'),
    })
    // De ECHTE getSpelerStatistieken (app/actions/inzichten.ts) doet de RPC-
    // aanroep zelf; door hem hier te laten falen wordt genericError() +
    // Promise.allSettled + het bovenliggende try/catch in de pagina allemaal
    // écht doorlopen — geen enkel productiebestand of `@/app/actions/inzichten`
    // is gemockt.
    useDb(db, { id: TEAM }, { inzichten_aanwezigheid_per_speler: { message: 'RAUWE RPC FOUT', code: 'XX000' } })
    // genericError() logt via console.error — stil houden, dat is verwacht
    // gedrag (lib/errors.ts) en geen testfout.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await renderProfile(PLAYER)

    // De rest van het profiel blijft functioneren: geen onbeheerde crash.
    const header = document.querySelector('header') as HTMLElement
    expect(within(header).getByText('Jan de Tester')).toBeInTheDocument()
    expect(screen.getByText(nl.players.profileInfoTitle)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.players.profileTabInfo })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.players.profileTabAttendance })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.players.profileTabStats })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: nl.players.profileTabStats }))

    expect(screen.getByText(nl.players.statsLoadError)).toBeInTheDocument()
    expect(screen.queryByText('RAUWE RPC FOUT')).not.toBeInTheDocument()
    expect(screen.queryByText(/RAUWE RPC FOUT/)).not.toBeInTheDocument()
    // Onderscheiden van AC18 (geen seizoen): geen /settings-link, geen lege-
    // staattekst, geen cijfers.
    expect(screen.queryByText(nl.insights.noSeason)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: nl.insights.goToSettings })).not.toBeInTheDocument()
    expect(screen.queryByText(nl.players.statsGoals)).not.toBeInTheDocument()

    consoleError.mockRestore()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC19/AC20 — blessure melden / hersteld melden
// ═══════════════════════════════════════════════════════════════════════
describe('AC19/AC20 — blessure melden en hersteld melden muteren de speler écht', () => {
  it('AC19: "Blessure melden" zet de speler op geblesseerd; een volgende weergave toont "Geblesseerd" + "Hersteld melden"', async () => {
    // Geen toekomstige events: houdt de mutatie-test gefocust op de pil/knop
    // (het future-events-attendance-pad van markInjured is al gedekt in
    // app/actions/players.test.ts, backend.md).
    const db = makeDb({ players: [playerRow({ injured: false })] })
    useDb(db)
    const { unmount } = await renderProfile(PLAYER)

    fireEvent.click(screen.getByRole('button', { name: nl.players.reportInjury }))
    // beforeEach draait vi.useFakeTimers(): waitFor()'s eigen polling gebruikt
    // dezelfde (nu fake) timer-functies en komt dus nooit vanzelf op gang.
    // advanceTimersByTimeAsync(0) flusht de microtaskqueue (de action's
    // await-ketens) zonder de systeemklok te verzetten.
    await vi.advanceTimersByTimeAsync(0)
    expect((db.tables.players.find((p) => p.id === PLAYER) as Row).injured).toBe(true)
    unmount()

    // router.refresh() laat de server-pagina opnieuw renderen — hier
    // gesimuleerd door de ECHTE (nu gemuteerde) pagina opnieuw op te halen.
    await renderProfile(PLAYER)
    const header = document.querySelector('header') as HTMLElement
    expect(within(header).getByText(nl.players.injuredBadge)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.players.reportRecovered })).toBeInTheDocument()
  })

  it('AC20: "Hersteld melden" zet de speler op beschikbaar; een volgende weergave toont "Beschikbaar" + "Blessure melden"', async () => {
    const db = makeDb({ players: [playerRow({ injured: true })] })
    useDb(db)
    const { unmount } = await renderProfile(PLAYER)

    fireEvent.click(screen.getByRole('button', { name: nl.players.reportRecovered }))
    await vi.advanceTimersByTimeAsync(0)
    expect((db.tables.players.find((p) => p.id === PLAYER) as Row).injured).toBe(false)
    unmount()

    await renderProfile(PLAYER)
    const header = document.querySelector('header') as HTMLElement
    expect(within(header).getByText(nl.players.availableBadge)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.players.reportInjury })).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC21 — "Speler bewerken" linkt naar /players/[id]/edit
// ═══════════════════════════════════════════════════════════════════════
describe('AC21 — "Speler bewerken"-knop', () => {
  it('is een link naar /players/<id>/edit', async () => {
    const db = makeDb({ players: [playerRow()] })
    useDb(db)
    await renderProfile(PLAYER)
    expect(screen.getByRole('link', { name: nl.players.editLabel })).toHaveAttribute(
      'href',
      `/players/${PLAYER}/edit`,
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC22 — "Afmelden" wisselt naar de Aanwezigheid-tab, geen navigatie
// ═══════════════════════════════════════════════════════════════════════
describe('AC22 — "Afmelden"-knop start dezelfde afmeldflow als vandaag (= Aanwezigheid-tab)', () => {
  it('wisselt naar de Aanwezigheid-tab zonder te navigeren', async () => {
    const db = makeDb({ players: [playerRow()] })
    useDb(db)
    await renderProfile(PLAYER)

    fireEvent.click(screen.getByRole('button', { name: nl.players.signOff }))
    expect(screen.getByRole('button', { name: nl.players.profileTabAttendance })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText(nl.players.attendanceTitle)).toBeInTheDocument()
    expect(routerPush).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC23 — tenant-isolatie: speler van een ander team of niet-bestaand
// ═══════════════════════════════════════════════════════════════════════
describe('AC23 — tenant-isolatie op /players/[id]', () => {
  it('een speler-id van een ander team levert notFound() op, en de fixture bevat écht twee teams', async () => {
    const db = makeDb({
      players: [
        playerRow({ id: PLAYER, team_id: TEAM, name: 'Eigen Speler' }),
        playerRow({
          id: PLAYER_OTHER_TEAM,
          team_id: OTHER_TEAM,
          name: 'Geheime Speler Van Ander Team',
          jersey_number: 77,
        }),
      ],
    })
    useDb(db)

    await expect(PlayerProfilePage({ params: Promise.resolve({ id: PLAYER_OTHER_TEAM }) })).rejects.toThrow(
      '__notFound__',
    )

    // De players-tabel is écht bevraagd (bewijst dat de team_id-fixture de
    // engine daadwerkelijk laat filteren, niet toevallig leeg is) — de rij
    // van het andere team komt nooit als geldige speler terug.
    expect(db.queryLog.some((q) => q.table === 'players')).toBe(true)
    expect(screen.queryByText('Geheime Speler Van Ander Team')).not.toBeInTheDocument()
    expect(screen.queryByText('77')).not.toBeInTheDocument()
  })

  it('een niet-bestaand id levert notFound() op', async () => {
    const db = makeDb({ players: [playerRow()] })
    useDb(db)
    const nonExisting = '99999999-9999-9999-9999-999999999999'
    await expect(PlayerProfilePage({ params: Promise.resolve({ id: nonExisting }) })).rejects.toThrow('__notFound__')
  })

  it('de oude /players/[id]/absence-link met een vreemd id belandt ook op notFound() (via de redirect + de guard op /players/[id])', async () => {
    const db = makeDb({
      players: [playerRow({ id: PLAYER_OTHER_TEAM, team_id: OTHER_TEAM })],
    })
    useDb(db)
    await expect(PlayerAbsencePage({ params: Promise.resolve({ id: PLAYER_OTHER_TEAM }) })).rejects.toThrow(
      `__redirect__:/players/${PLAYER_OTHER_TEAM}?tab=aanwezigheid`,
    )
    // De absence-pagina zelf doet geen guard (AC4); de doelpagina wel — apart
    // getest hierboven ("een speler-id van een ander team"). Deze test
    // bewijst alleen dat de redirect-URL zelf klopt voor een vreemd id.
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC24 — broncontract: elke query is tenant-gescoped
// ═══════════════════════════════════════════════════════════════════════
describe('AC24 — alle getoonde gegevens zijn beperkt tot het eigen team', () => {
  it('players, events, attendance, absence_periods en match_events krijgen allemaal eq(team_id, TEAM) mee', async () => {
    const db = makeDb({
      players: [playerRow()],
      settings: seasonSettings('2025-07-01', '2026-06-30'),
      events: [eventRow({ id: 'm1', type: 'match', date: '2025-09-01' })],
      match_events: [{ id: 'me1', team_id: TEAM, event_id: 'm1', player_id: PLAYER, kind: 'goal' }],
      attendance: [attendanceRow({ event_id: 'm1', status: 'present' })],
      absence_periods: [{ id: 'per1', team_id: TEAM, player_id: PLAYER, from_date: '2025-08-01', to_date: '2025-08-05' }],
    })
    useDb(db)
    await renderProfile(PLAYER)

    for (const table of ['players', 'events', 'attendance', 'absence_periods', 'match_events']) {
      const queries = db.queryLog.filter((q) => q.table === table)
      expect(queries.length).toBeGreaterThan(0)
      for (const q of queries) {
        expect(q.eqFilters.some(([col, val]) => col === 'team_id' && val === TEAM)).toBe(true)
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC25 — niet-ingelogde gebruiker
// ═══════════════════════════════════════════════════════════════════════
describe('AC25 — niet-ingelogde gebruiker', () => {
  it('wordt doorgestuurd naar /login, zonder enige databasequery', async () => {
    const db = makeDb({ players: [playerRow()] })
    useDb(db, null)

    await expect(PlayerProfilePage({ params: Promise.resolve({ id: PLAYER }) })).rejects.toThrow('__redirect__:/login')
    expect(db.queryLog.length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC26 — ongeldig id (geen uuid)
// ═══════════════════════════════════════════════════════════════════════
describe('AC26 — ongeldig id', () => {
  it('geeft notFound() zonder enige databasequery (isUuid draait vóór elke DB-aanroep)', async () => {
    const db = makeDb({ players: [playerRow()] })
    useDb(db)

    await expect(PlayerProfilePage({ params: Promise.resolve({ id: INVALID_ID }) })).rejects.toThrow('__notFound__')
    // De teamcontext (lib/team-context.ts) leest vóór élke pagina team_members
    // en de teamnaam uit settings; die twee staan los van deze pagina. Waar het
    // hier om gaat: geen enkele query naar spelerdata.
    expect(db.queryLog.filter((q) => q.table !== 'settings')).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Edge cases — gast- en inactieve speler
// ═══════════════════════════════════════════════════════════════════════
describe('Edge case — gastspeler en inactieve speler', () => {
  it('gastspeler: Info toont typeGuest; Statistieken toont statsExcludedHint en geen percentage/gemiddelde', async () => {
    const db = makeDb({
      players: [playerRow({ type: 'guest', active: true })],
      settings: seasonSettings('2025-07-01', '2026-06-30'),
      events: [eventRow({ id: 'ev1', type: 'training', date: '2025-08-01' })],
      attendance: [attendanceRow({ event_id: 'ev1', status: 'present' })],
    })
    useDb(db)
    await renderProfile(PLAYER)

    const infoCard = screen.getByText(nl.players.profileInfoTitle).closest('.surface-card') as HTMLElement
    expect(within(infoCard).getByText(nl.players.typeGuest)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: nl.players.profileTabStats }))
    // De RPC's filteren p.type = 'regular' (supabase/inzichten.sql) — een gast
    // levert dus geen aanwezigheids-/ratingrij op. Verwacht gedrag, geen bug
    // (brief §5.1, amendementen.md #2).
    expect(screen.getByText(nl.players.statsExcludedHint)).toBeInTheDocument()
    expect(screen.getByText(nl.players.statsAttendanceEmpty)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.spelerEmpty)).toBeInTheDocument()
  })

  it('inactieve speler: Info toont profileNo; aanwezigheidspercentage is leeg (p.active = true in de RPC)', async () => {
    const db = makeDb({
      players: [playerRow({ active: false, type: 'regular' })],
      settings: seasonSettings('2025-07-01', '2026-06-30'),
      events: [eventRow({ id: 'ev1', type: 'training', date: '2025-08-01' })],
      attendance: [attendanceRow({ event_id: 'ev1', status: 'present' })],
    })
    useDb(db)
    await renderProfile(PLAYER)

    const infoCard = screen.getByText(nl.players.profileInfoTitle).closest('.surface-card') as HTMLElement
    expect(within(infoCard).getByText(nl.players.profileNo)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: nl.players.profileTabStats }))
    expect(screen.getByText(nl.players.statsExcludedHint)).toBeInTheDocument()
    expect(screen.getByText(nl.players.statsAttendanceEmpty)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Edge cases — ?tab=onzin en ?tab=a&tab=b vallen terug op Info
// ═══════════════════════════════════════════════════════════════════════
describe('Edge case — onbekende of dubbele ?tab-waarde', () => {
  it.each([
    ['onzin', { tab: 'onzin' }],
    ['een array (?tab=a&tab=b)', { tab: ['a', 'b'] }],
  ])('%s ⇒ Info blijft actief', async (_label, sp) => {
    const db = makeDb({ players: [playerRow()] })
    useDb(db)
    await renderProfile(PLAYER, sp as Record<string, string | string[]>)
    expect(screen.getByRole('button', { name: nl.players.profileTabInfo })).toHaveAttribute('aria-pressed', 'true')
  })
})
