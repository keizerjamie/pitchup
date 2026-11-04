// Acceptatietests — "Kloppende cijfers en meldingen" (user story goedgekeurd
// 2026-11-04, 6 punten). Van buitenaf: de ECHTE server-pagina's (DashboardPage,
// EventsPage, EventDetailPage, LineupPage, InzichtenPage, AnalysisPage) en de
// ECHTE server action saveLineup draaien tegen één in-memory Supabase-engine
// (zelfde precedent als gastspelers.acceptance.test.tsx en
// inactieve-spelers-tellingen.acceptance.test.tsx; elk acceptatiebestand houdt
// zijn eigen kopie van de engine).
//
// De engine is strenger dan de oudere kopieën:
//   * ELKE query wordt afgekapt op 1000 rijen (PostgREST max-rows) en logt of
//     er afgekapt is — zo bewijst AC1.6 dat er niets stilzwijgend wegvalt;
//   * upsert heeft echte semantiek (ignoreDuplicates slaat over, anders merge);
//   * elke query logt zijn eq-filters, zodat tenant-scoping (AC4.10) hard te
//     toetsen is en niet alleen via zaaidata.
//
// ── AC → test-mapping (nummering exact zoals in 02-story.md) ──
//   AC1.1–AC1.8  → describe('Punt 1 — ...')
//   AC2.1–AC2.7  → describe('Punt 2 — ...')
//   AC3.1–AC3.5  → describe('Punt 3 — ...')
//   AC4.1–AC4.10 → describe('Punt 4 — ...')
//   AC5.1–AC5.6  → describe('Punt 5 — ...')  (deels niet netjes te dekken in jsdom)
//   AC6.1–AC6.4  → describe('Punt 6 — ...')
//   AC7.1        → describe('Algemeen — AC7.1 ...')
//   AC7.2        → geen test: bewezen door typecheck, lint, npm test, test:node (zie rapport)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'
import { FORMATIONS } from '@/lib/types'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
  notFound: vi.fn(() => { throw new Error('__notFound__') }),
  useRouter: vi.fn(() => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn(), replace: vi.fn() })),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}))
// Mutabel zodat een test een locale-cookie ('en') of een CSP-nonce kan zetten.
const omgeving: { locale: string | undefined; nonce: string | null } = { locale: undefined, nonce: null }
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: (naam: string) => (naam === 'locale' && omgeving.locale ? { value: omgeving.locale } : undefined) })),
  headers: vi.fn(async () => ({ get: (naam: string) => (naam === 'x-nonce' ? omgeving.nonce : null) })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// saveLineup is ECHT (dat is de publieke API van punt 4); de overige
// attendance-actions worden nooit aangeroepen en zijn gestubd.
vi.mock('@/app/actions/attendance', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/app/actions/attendance')>()
  return {
    ...echt,
    updateAttendance: vi.fn().mockResolvedValue(undefined),
    markAllPresent: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock('@/app/actions/players', () => ({
  markInjured: vi.fn().mockResolvedValue(undefined),
  markRecovered: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/events', () => ({
  deleteEvent: vi.fn().mockResolvedValue(undefined),
  updateGatherTime: vi.fn().mockResolvedValue(undefined),
}))

import { createClient } from '@/lib/supabase/server'
import DashboardPage from '@/app/page'
import EventsPage from '@/app/events/page'
import EventDetailPage from '@/app/events/[id]/page'
import LineupPage from '@/app/events/[id]/lineup/page'
import AnalysisPage from '@/app/events/[id]/analysis/page'
import InzichtenPage from '@/app/inzichten/page'
import { saveLineup } from '@/app/actions/attendance'
import Begroeting from '@/components/dashboard/Begroeting'
import ActionBar from '@/components/ui/ActionBar'
import { begroetingVoorUur, lokaalUur } from '@/lib/begroeting'
import { telOpstelling } from '@/lib/lineup-compleet'

const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'

type Row = Record<string, unknown>

// player_id's moeten UUID's zijn (assertKnownPlayerId in saveLineup).
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const eigenId = (i: number) => uuid(100 + i)
const vreemdId = (i: number) => uuid(900 + i)

// ═══════════════════════════════════════════════════════════════════════
// Engine
// ═══════════════════════════════════════════════════════════════════════
const MAX_ROWS = 1000

interface QueryLog {
  table: string
  rows: number
  truncated: boolean
  eqs: [string, unknown][]
  ins: [string, unknown[]][]
}
interface Db {
  tables: Record<string, Row[]>
  log: QueryLog[]
  rpcCalls: { name: string; args: Row }[]
  upserts: { table: string; payload: Row[]; options: Row }[]
  failRead: Set<string>
  failWrite: Set<string>
  rpcError: boolean
}

function nieuweDb(tables: Record<string, Row[]> = {}): Db {
  return { tables, log: [], rpcCalls: [], upserts: [], failRead: new Set(), failWrite: new Set(), rpcError: false }
}
const rowsVan = (db: Db, t: string): Row[] => (db.tables[t] ??= [])

const DB_FOUT = { code: 'XX000', message: 'SECRET-DB-DETAIL kolom p.x' }

function teamMembersChain(userId: string | undefined) {
  const rows = userId ? [{ team_id: userId, user_id: userId, rol: 'owner' }] : []
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'neq', 'in', 'is', 'not', 'gt', 'gte', 'lt', 'lte', 'order', 'limit']) chain[op] = () => chain
  chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  chain.single = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null, count: rows.length })
  return chain
}

function tableChain(db: Db, table: string) {
  const filters: ((r: Row) => boolean)[] = []
  const eqs: [string, unknown][] = []
  const ins: [string, unknown[]][] = []
  const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
  let limitN: number | null = null

  function resolveRows(): Row[] {
    let out = rowsVan(db, table).filter((r) => filters.every((f) => f(r)))
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
    // PostgREST max-rows: ELKE query levert hooguit 1000 rijen.
    const truncated = out.length > MAX_ROWS
    if (truncated) out = out.slice(0, MAX_ROWS)
    db.log.push({ table, rows: out.length, truncated, eqs, ins })
    return out
  }
  const lees = () => {
    if (db.failRead.has(table)) { db.log.push({ table, rows: 0, truncated: false, eqs, ins }); return { data: null, error: DB_FOUT } }
    return { data: resolveRows(), error: null }
  }
  const leesEen = () => {
    if (db.failRead.has(table)) { db.log.push({ table, rows: 0, truncated: false, eqs, ins }); return { data: null, error: DB_FOUT } }
    return { data: resolveRows()[0] ?? null, error: null }
  }

  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: unknown) => { eqs.push([col, val]); filters.push((r) => r[col] === val); return chain },
    neq: (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return chain },
    gt: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) > (val as string | number)); return chain },
    gte: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) >= (val as string | number)); return chain },
    lte: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) <= (val as string | number)); return chain },
    lt: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) < (val as string | number)); return chain },
    in: (col: string, vals: unknown[]) => { ins.push([col, vals]); filters.push((r) => vals.includes(r[col])); return chain },
    not: (col: string, op: string, val: unknown) => {
      if (op === 'is') filters.push((r) => (val === null ? r[col] !== null && r[col] !== undefined : r[col] !== val))
      return chain
    },
    order: (col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
      orders.push({ col, ascending: opts.ascending ?? true, nullsFirst: opts.nullsFirst ?? false })
      return chain
    },
    limit: (n: number) => { limitN = n; return chain },
    maybeSingle: () => Promise.resolve(leesEen()),
    single: () => Promise.resolve(leesEen()),
    insert: () => Promise.resolve({ data: null, error: null }),
    // Echte upsert-semantiek: botsing + ignoreDuplicates → overslaan; botsing
    // zonder → merge (zoals ON CONFLICT DO UPDATE).
    upsert: (payload: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
      const nieuw = Array.isArray(payload) ? payload : [payload]
      db.upserts.push({ table, payload: nieuw, options: options as Row })
      if (db.failWrite.has(table)) return Promise.resolve({ data: null, error: DB_FOUT })
      const sleutels = (options.onConflict ?? 'id').split(',').map((k) => k.trim())
      const rows = rowsVan(db, table)
      for (const rij of nieuw) {
        const bestaand = rows.find((b) => sleutels.every((k) => b[k] === rij[k]))
        if (bestaand) {
          if (options.ignoreDuplicates) continue
          Object.assign(bestaand, rij)
          continue
        }
        rows.push({ ...rij })
      }
      return Promise.resolve({ data: null, error: null })
    },
    then: (resolve: (v: unknown) => unknown) => resolve(lees()),
  }
  return chain
}

// Is deze query tenant-gescoped: eq('team_id', TEAM) of een in('team_id', ...)
// die uitsluitend het eigen team bevat (de lidmaatschapslookup van
// lib/team-context.ts op settings gebruikt die tweede vorm).
function isTeamGescoped(q: QueryLog): boolean {
  return q.eqs.some(([k, v]) => k === 'team_id' && v === TEAM)
    || q.ins.some(([k, vals]) => k === 'team_id' && vals.length > 0 && vals.every((v) => v === TEAM))
}

// Emulatie van inzichten_aanwezigheid (supabase/blessure-status.sql): alleen
// vaste spelers, injured = afwezig, type <> 'meting', datum in [p_start,
// p_end], GEEN active-filter (besluit V1), alleen p_team_id.
function rpcAanwezigheid(db: Db, args: Row) {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const events = new Map(rowsVan(db, 'events').filter((e) => e.team_id === p_team_id).map((e) => [e.id as string, e]))
  const players = new Map(rowsVan(db, 'players').filter((p) => p.team_id === p_team_id).map((p) => [p.id as string, p]))
  let aanwezig = 0
  let afwezig = 0
  for (const a of rowsVan(db, 'attendance')) {
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

function gebruik(db: Db, user: { id: string } | null = { id: TEAM }) {
  const supabase = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) => (t === 'team_members' ? teamMembersChain(user?.id) : tableChain(db, t)),
    rpc: (name: string, args: Row) => {
      db.rpcCalls.push({ name, args })
      if (name === 'inzichten_aanwezigheid') {
        if (db.rpcError) return Promise.resolve({ data: null, error: DB_FOUT })
        return Promise.resolve({ data: rpcAanwezigheid(db, args), error: null })
      }
      return Promise.resolve({ data: [], error: null })
    },
  }
  vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

// ── Fixtures ──
function speler(i: number, o: Row = {}): Row {
  return {
    id: eigenId(i), team_id: TEAM, name: `Speler ${i}`, position: 'Spits', secondary_positions: [],
    jersey_number: i, active: true, injured: false, type: 'regular', rating: 5, created_at: '2024-01-01T00:00:00Z', ...o,
  }
}
function vreemdeSpeler(i: number, o: Row = {}): Row {
  return speler(i, { id: vreemdId(i), team_id: OTHER_TEAM, name: `Vreemd ${i}`, ...o })
}
function evenement(id: string, date: string, o: Row = {}): Row {
  return {
    id, team_id: TEAM, type: 'training', date, time: null, location: null, opponent: null, match_type: null,
    home_away: null, notes: null, doelstelling: null, goals_for: null, goals_against: null, gather_time: null,
    created_at: '2026-01-01T00:00:00Z', ...o,
  }
}
const aanw = (eventId: string, playerId: string, status: string, team = TEAM): Row =>
  ({ event_id: eventId, team_id: team, player_id: playerId, status })

// Event met 30 actieve vaste spelers: 19 aanwezig, 1 afwezig, 10 geblesseerd.
function dertigSpelers(): { players: Row[]; attendance: Row[] } {
  const players: Row[] = []
  const attendance: Row[] = []
  for (let i = 1; i <= 30; i++) {
    players.push(speler(i))
    attendance.push(aanw('ev1', eigenId(i), i <= 19 ? 'present' : i === 20 ? 'absent' : 'injured'))
  }
  return { players, attendance }
}

const BASIS_TABELLEN = [
  'events', 'players', 'settings', 'attendance', 'match_squad', 'lineups', 'match_ratings', 'match_events',
  'training_oefeningen', 'task_overrides', 'categorie_metingen', 'metingen', 'absence_periods',
  'training_evaluaties', 'tegendoelpunten', 'speelminuten',
]
function basisDb(tables: Record<string, Row[]>): Db {
  const alles: Record<string, Row[]> = {}
  for (const t of BASIS_TABELLEN) alles[t] = []
  return nieuweDb({ ...alles, ...tables })
}

const SEIZOEN: Row[] = [
  { team_id: TEAM, key: 'season_start', value: '2026-07-01' },
  { team_id: TEAM, key: 'season_end', value: '2027-06-30' },
]

// ── Render-helpers ──
async function renderDashboard(dict = nl) {
  const el = await DashboardPage()
  return render(<DictProvider dict={dict}>{el}</DictProvider>)
}
async function renderAgenda() {
  const el = await EventsPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}
async function renderEventDetail(id: string) {
  const el = await EventDetailPage({ params: Promise.resolve({ id }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

// Alleen de eigen tekstnode: de geblesseerd-regel heeft ook een decoratief
// healing-icoon (aria-hidden) waarvan de ligatuurtekst in textContent staat.
function heroLegendText(label: string): string {
  return Array.from(screen.getByText(new RegExp(`^\\d+ ${label}$`)).childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join('')
}
function kpiTegel(): HTMLElement {
  return screen.getByText(nl.home.statAttendance).closest('.surface-card') as HTMLElement
}
function kpiWaarde(): string {
  return within(kpiTegel()).getByText(/^(\d+%|—)$/).textContent ?? ''
}
// href → "x/y" voor alle agendarijen
function agendaTellers(): Map<string, string> {
  const m = new Map<string, string>()
  for (const span of screen.getAllByText(/^\d+\/\d+$/)) {
    const href = span.closest('a')?.getAttribute('href')
    if (href) m.set(href, span.textContent ?? '')
  }
  return m
}
// De hero toont geen percentagetekst: alleen een conic-gradient-ring, en jsdom
// gooit die stijl weg. Het percentage van de hero is dus alleen af te leiden uit
// de getoonde teller en noemer ("x/y aanwezig" en "van y") met dezelfde afronding
// als de ring (Math.round(present / squadSize * 100)).
function heroPercentage(): number {
  const m = screen.getAllByText(new RegExp(`^\\d+/\\d+ ${nl.home.present}$`))[0].textContent!.match(/^(\d+)\/(\d+)/)!
  return Math.round((Number(m[1]) / Number(m[2])) * 100)
}

beforeEach(() => {
  omgeving.locale = undefined
  omgeving.nonce = null
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-19T10:00:00'))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════
// PUNT 1 — één telling, overal gelijk
// ═══════════════════════════════════════════════════════════════════════
describe('Punt 1 — aanwezigheidstelling (30 vaste spelers: 19 aanwezig, 1 afwezig, 10 geblesseerd, 0 onbekend)', () => {
  function dataset(extra: { players?: Row[]; attendance?: Row[]; events?: Row[] } = {}): Db {
    const { players, attendance } = dertigSpelers()
    return basisDb({
      events: [evenement('ev1', '2026-08-20'), ...(extra.events ?? [])],
      players: [...players, ...(extra.players ?? [])],
      attendance: [...attendance, ...(extra.attendance ?? [])],
      settings: SEIZOEN,
    })
  }

  it('AC1.1 — dashboard, kalenderlijst en eventdetail tonen 19 aanwezig met noemer 30 (kalender "19/30")', async () => {
    gebruik(dataset())
    await renderDashboard()
    expect(screen.getAllByText(`19/30 ${nl.home.present}`).length).toBeGreaterThan(0)
    expect(screen.getByText(nl.home.ofCount.replace('{n}', '30'))).toBeInTheDocument()
    cleanup()

    await renderAgenda()
    expect(agendaTellers().get('/events/ev1')).toBe('19/30')
    cleanup()

    await renderEventDetail('ev1')
    expect(screen.getByText(nl.event.turnoutScopeSub.replace('{present}', '19').replace('{total}', '30'))).toBeInTheDocument()
  })

  it('AC1.2 — percentage overal gelijk aan eventdetail (63%); geblesseerd telt in het percentage als afwezig', async () => {
    gebruik(dataset())
    await renderEventDetail('ev1')
    const kaart = screen.getByText(nl.event.turnout).parentElement as HTMLElement
    // Telde geblesseerd NIET mee in de noemer, dan stond hier 19/20 = 95%.
    expect(within(kaart).getByText('63%')).toBeInTheDocument()
    cleanup()

    await renderDashboard()
    // Dashboardhero: zelfde 63% (afgeleid uit 19/30, de ring zelf is niet leesbaar in jsdom).
    expect(heroPercentage()).toBe(63)
  })

  it('AC1.3 — noemer = alle actieve vaste spelers, ook zonder attendance-record; ontbrekend record = onbekend', async () => {
    const { players, attendance } = dertigSpelers()
    // Alleen de eerste 20 spelers hebben een record; 10 ontbreken (de geblesseerden).
    gebruik(basisDb({
      events: [evenement('ev1', '2026-08-20')],
      players,
      attendance: attendance.slice(0, 20),
      settings: SEIZOEN,
    }))
    await renderAgenda()
    expect(agendaTellers().get('/events/ev1')).toBe('19/30')
    cleanup()

    await renderDashboard()
    expect(screen.getAllByText(`19/30 ${nl.home.present}`).length).toBeGreaterThan(0)
    expect(heroLegendText(nl.home.absent)).toBe(`1 ${nl.home.absent}`)
    expect(heroLegendText(nl.home.injuredLegend)).toBe(`0 ${nl.home.injuredLegend}`)
    // Ontbrekende records = 10x "nog niet gereageerd".
    expect(heroLegendText(nl.home.noResponse)).toBe(`10 ${nl.home.noResponse}`)
  })

  it('AC1.4 — aanwezige gast, afwezige gast en inactieve spelers (met present-rij) tellen niet mee in noemer of percentage', async () => {
    const db = dataset({
      players: [
        speler(31, { type: 'guest', name: 'Aanwezige Gast' }),
        speler(32, { type: 'guest', name: 'Afwezige Gast' }),
        speler(33, { active: false, name: 'Inactief Een' }),
        speler(34, { active: false, name: 'Inactief Twee' }),
      ],
      attendance: [
        aanw('ev1', eigenId(31), 'present'),
        aanw('ev1', eigenId(32), 'absent'),
        aanw('ev1', eigenId(33), 'present'),
        aanw('ev1', eigenId(34), 'present'),
      ],
    })
    gebruik(db)

    await renderAgenda()
    expect(agendaTellers().get('/events/ev1')).toBe('19/30') // niet 20/31 of 21/32
    cleanup()

    await renderDashboard()
    expect(screen.getAllByText(`19/30 ${nl.home.present}`).length).toBeGreaterThan(0)
    expect(screen.queryByText(`20/31 ${nl.home.present}`)).not.toBeInTheDocument()
    expect(heroPercentage()).toBe(63)
    cleanup()

    await renderEventDetail('ev1')
    expect(screen.getByText(nl.event.turnoutScopeSub.replace('{present}', '19').replace('{total}', '30'))).toBeInTheDocument()
    const kaart = screen.getByText(nl.event.turnout).parentElement as HTMLElement
    expect(within(kaart).getByText('63%')).toBeInTheDocument()
    // Eventdetail toont de aanwezige gast nog wel als "+1 gast" (besluit V2).
    expect(screen.getByText(nl.event.presentGuestSubOne)).toBeInTheDocument()
  })

  it('AC1.5 — dashboardhero toont geblesseerd apart: 19 aanwezig, 1 afwezig, 10 geblesseerd, 0 nog niet gereageerd; "11 afwezig" verdwijnt', async () => {
    gebruik(dataset())
    await renderDashboard()
    expect(heroLegendText(nl.home.present)).toBe(`19 ${nl.home.present}`)
    expect(heroLegendText(nl.home.absent)).toBe(`1 ${nl.home.absent}`)
    expect(heroLegendText(nl.home.injuredLegend)).toBe(`10 ${nl.home.injuredLegend}`)
    expect(heroLegendText(nl.home.noResponse)).toBe(`0 ${nl.home.noResponse}`)
    expect(screen.queryByText(`11 ${nl.home.absent}`)).not.toBeInTheDocument()
    // Legenda bevat de extra categorie: vier regels, niet drie.
    const legenda = screen.getByText(`10 ${nl.home.injuredLegend}`).parentElement as HTMLElement
    expect(legenda.children).toHaveLength(4)
  })

  it('AC1.6 — team met >1000 attendance-rijen (110 events × 34 spelers = 3740): elke kalenderrij toont de complete telling, ook als ELKE query op 1000 rijen wordt afgekapt', async () => {
    const players: Row[] = []
    for (let i = 1; i <= 34; i++) players.push(speler(i))
    const events: Row[] = []
    const attendance: Row[] = []
    for (let e = 0; e < 110; e++) {
      const id = `ev-${e}`
      events.push(evenement(id, `2026-08-${String(1 + (e % 28)).padStart(2, '0')}`))
      // Event e: (e % 34) + 1 aanwezig, de rest afwezig → elk event een eigen getal.
      for (let p = 1; p <= 34; p++) attendance.push(aanw(id, eigenId(p), p <= (e % 34) + 1 ? 'present' : 'absent'))
    }
    expect(attendance).toHaveLength(3740)
    const db = basisDb({ events, players, attendance })
    gebruik(db)

    await renderAgenda()
    const tellers = agendaTellers()
    for (let e = 0; e < 110; e++) {
      expect(tellers.get(`/events/ev-${e}`), `event ev-${e}`).toBe(`${(e % 34) + 1}/34`)
    }
    const attLog = db.log.filter((q) => q.table === 'attendance')
    // Geen enkele attendance-query is afgekapt en samen leveren ze alle 3740 rijen.
    expect(attLog.every((q) => !q.truncated)).toBe(true)
    expect(Math.max(...attLog.map((q) => q.rows))).toBeLessThanOrEqual(1000)
    expect(attLog.reduce((som, q) => som + q.rows, 0)).toBe(3740)
  })

  it('AC1.7 — faalpad: spelersquery faalt → kalender behoudt het terugval-gedrag (records-telling), geen crash, geen ruwe fout in de log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = basisDb({
      events: [evenement('ev1', '2026-08-20')],
      players: [speler(1), speler(2), speler(3)],
      attendance: [aanw('ev1', eigenId(1), 'present'), aanw('ev1', eigenId(2), 'present'), aanw('ev1', eigenId(3), 'absent')],
    })
    db.failRead.add('players')
    gebruik(db)

    await renderAgenda()
    // Terugval = oude telling op de records zelf: 2 aanwezig van 3 records.
    expect(agendaTellers().get('/events/ev1')).toBe('2/3')
    const gelogd = spy.mock.calls.map((a) => a.join(' ')).join('\n')
    expect(gelogd).toContain('events.players')
    expect(gelogd).not.toContain('SECRET-DB-DETAIL')
  })

  it('AC1.7 — faalt een attendance-batch, dan krijgt die rij géén teller (liever geen getal dan een fout getal)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = dataset()
    db.failRead.add('attendance')
    gebruik(db)
    await renderAgenda()
    expect(screen.queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument()
  })

  it('AC1.8 — tenant-isolatie: records en spelers van een ander team (zelfde event_id, forse tegenstrijdige statussen) tellen nooit mee', async () => {
    const { players, attendance } = dertigSpelers()
    const db = basisDb({
      events: [evenement('ev1', '2026-08-20'), evenement('ev-vreemd', '2026-08-21', { team_id: OTHER_TEAM })],
      players: [
        ...players,
        ...Array.from({ length: 5 }, (_, i) => vreemdeSpeler(i + 1)),
      ],
      attendance: [
        ...attendance,
        // Vreemd team zet op ev1 de afwezige/geblesseerde spelers van TEAM op present…
        ...[20, 21, 22, 23].map((i) => aanw('ev1', eigenId(i), 'present', OTHER_TEAM)),
        // …en eigen spelers van het vreemde team op ev1.
        ...[1, 2, 3, 4, 5].map((i) => aanw('ev1', vreemdId(i), 'present', OTHER_TEAM)),
        aanw('ev-vreemd', vreemdId(1), 'present', OTHER_TEAM),
      ],
      settings: SEIZOEN,
    })
    gebruik(db)

    await renderAgenda()
    expect(agendaTellers().get('/events/ev1')).toBe('19/30')
    expect(agendaTellers().has('/events/ev-vreemd')).toBe(false)
    cleanup()

    await renderDashboard()
    expect(screen.getAllByText(`19/30 ${nl.home.present}`).length).toBeGreaterThan(0)
    expect(heroLegendText(nl.home.injuredLegend)).toBe(`10 ${nl.home.injuredLegend}`)
    cleanup()

    await renderEventDetail('ev1')
    const kaart = screen.getByText(nl.event.turnout).parentElement as HTMLElement
    expect(within(kaart).getByText('63%')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// PUNT 2 — KPI "Aanwezigheid · laatste 4 weken"
// ═══════════════════════════════════════════════════════════════════════
describe('Punt 2 — KPI laatste 4 weken (peildatum 2026-08-19, venster 2026-07-23 t/m 2026-08-18)', () => {
  // 4 vaste spelers. In het venster: 08-12 (3 aanwezig, 1 afwezig), 08-05 (1
  // aanwezig, 2 afwezig, 1 geblesseerd), 07-29 (4 aanwezig) → 8 aanwezig, 4
  // afwezig → 67%. Buiten het venster: 07-10 (4 afwezig) en de komende hero
  // (4 aanwezig) — nemen we die mee, dan wordt het 50% resp. 75%.
  function kpiDb(extra: Record<string, Row[]> = {}): Db {
    const players = [1, 2, 3, 4].map((i) => speler(i))
    const [a, b, c, d] = [1, 2, 3, 4].map(eigenId)
    return basisDb({
      events: [
        evenement('e-0812', '2026-08-12'), evenement('e-0805', '2026-08-05'), evenement('e-0729', '2026-07-29'),
        evenement('e-0710', '2026-07-10'), evenement('ev1', '2026-08-20'),
      ],
      players,
      settings: SEIZOEN,
      attendance: [
        aanw('e-0812', a, 'present'), aanw('e-0812', b, 'present'), aanw('e-0812', c, 'absent'), aanw('e-0812', d, 'present'),
        aanw('e-0805', a, 'present'), aanw('e-0805', b, 'absent'), aanw('e-0805', c, 'absent'), aanw('e-0805', d, 'injured'),
        aanw('e-0729', a, 'present'), aanw('e-0729', b, 'present'), aanw('e-0729', c, 'present'), aanw('e-0729', d, 'present'),
        aanw('e-0710', a, 'absent'), aanw('e-0710', b, 'absent'), aanw('e-0710', c, 'absent'), aanw('e-0710', d, 'absent'),
        aanw('ev1', a, 'present'), aanw('ev1', b, 'present'), aanw('ev1', c, 'present'), aanw('ev1', d, 'present'),
      ],
      ...extra,
    })
  }

  it('AC2.1 — de KPI is de aanwezigheid van de laatste 4 weken (alleen het venster, t/m gisteren; niet het komende event of oudere events)', async () => {
    const db = kpiDb()
    gebruik(db)
    await renderDashboard()
    expect(kpiWaarde()).toBe('67%')
    const call = db.rpcCalls.find((c) => c.name === 'inzichten_aanwezigheid')!
    expect(call.args).toEqual({ p_team_id: TEAM, p_start: '2026-07-23', p_end: '2026-08-18' })
  })

  it('AC2.2 — zelfde team en datum: dashboard-% = Inzichten-% voor "Laatste 4 weken" (zelfde RPC-argumenten)', async () => {
    const db = kpiDb()
    gebruik(db)
    await renderDashboard()
    const dashboardPct = kpiWaarde()
    const dashboardRpc = db.rpcCalls.find((c) => c.name === 'inzichten_aanwezigheid')!
    cleanup()

    db.rpcCalls.length = 0
    const el = await InzichtenPage({ searchParams: Promise.resolve({ periode: '4w' }) })
    render(<DictProvider dict={nl}>{el}</DictProvider>)
    const label = screen.getAllByText(nl.insights.kpiAanwezigheidLabel)[0]
    // Zoek omhoog tot de eerste voorouder die een waarde (% of —) bevat: de KPI-tegel.
    let node: HTMLElement | null = label.parentElement
    let inzichtenPct: string | null = null
    let tegelTekst = ''
    while (node && !inzichtenPct) {
      const m = node.textContent?.match(/(\d+%|—)/)
      if (m) { inzichtenPct = m[1]; tegelTekst = node.textContent ?? '' }
      node = node.parentElement
    }
    // We hebben echt de aanwezigheidstegel te pakken (niet een andere KPI).
    expect(tegelTekst).toContain(nl.insights.kpiAanwezigheidLabel)
    expect(tegelTekst).not.toContain(nl.insights.kpiRatingLabel)
    const inzichtenRpc = db.rpcCalls.find((c) => c.name === 'inzichten_aanwezigheid')!
    expect(inzichtenRpc.args).toEqual(dashboardRpc.args)
    expect(inzichtenPct).toBe(dashboardPct)
    expect(dashboardPct).toBe('67%')
  })

  it('AC2.3 — label noemt de periode (nl+en) en leest niet als voorspelling of seizoensresultaat', async () => {
    gebruik(kpiDb())
    await renderDashboard()
    expect(screen.getByText('Aanwezigheid · laatste 4 weken')).toBeInTheDocument()
    cleanup()
    // Alle talen noemen "4" in het label en geen seizoen/voorspelling.
    expect(nl.home.statAttendance).toBe('Aanwezigheid · laatste 4 weken')
    expect(en.home.statAttendance).toBe('Attendance · last 4 weeks')
    for (const d of [nl, en, de, fr, es]) {
      expect(d.home.statAttendance).toMatch(/4/)
      expect(d.home.statAttendance).not.toMatch(/seizoen|season|saison|temporada|Saison|voorspel|forecast|verwacht|expected/i)
    }
  })

  it('AC2.3 — Engelse locale: de dashboardpagina toont "Attendance · last 4 weeks"', async () => {
    omgeving.locale = 'en'
    gebruik(kpiDb())
    await renderDashboard(en)
    expect(screen.getByText('Attendance · last 4 weeks')).toBeInTheDocument()
  })

  it('AC2.4 — "Doel 85%" blijft', async () => {
    gebruik(kpiDb())
    await renderDashboard()
    expect(within(kpiTegel()).getByText(nl.home.attendanceGoal.replace('{n}', '85'))).toBeInTheDocument()
  })

  it('AC2.5 — de tegel linkt naar /inzichten?periode=4w', async () => {
    gebruik(kpiDb())
    await renderDashboard()
    expect(kpiTegel().closest('a')?.getAttribute('href') ?? kpiTegel().querySelector('a')?.getAttribute('href')).toBe('/inzichten?periode=4w')
  })

  it('AC2.5 — de "—"-terugval blijft: RPC-fout en geen seizoen geven "—" (zonder RPC-call bij geen seizoen), de link blijft', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const metFout = kpiDb()
    metFout.rpcError = true
    gebruik(metFout)
    await renderDashboard()
    expect(kpiWaarde()).toBe('—')
    expect(kpiTegel().closest('a')?.getAttribute('href') ?? kpiTegel().querySelector('a')?.getAttribute('href')).toBe('/inzichten?periode=4w')
    cleanup()

    const geenSeizoen = kpiDb({ settings: [] })
    gebruik(geenSeizoen)
    await renderDashboard()
    expect(kpiWaarde()).toBe('—')
    expect(geenSeizoen.rpcCalls.filter((c) => c.name === 'inzichten_aanwezigheid')).toHaveLength(0)
  })

  it('AC2.6 — geen events in de laatste 4 weken: bestaande lege toestand ("—", balk 0%), nooit NaN%', async () => {
    gebruik(basisDb({
      events: [evenement('ev1', '2026-08-20')],
      players: [speler(1)],
      settings: SEIZOEN,
      attendance: [aanw('ev1', eigenId(1), 'present')],
    }))
    const { container } = await renderDashboard()
    expect(kpiWaarde()).toBe('—')
    expect(container.textContent).not.toMatch(/NaN/)
    const balk = kpiTegel().querySelector('div[style*="linear-gradient"]') as HTMLElement
    expect(balk.style.width).toBe('0%')
  })

  it('AC2.6 — seizoen jonger dan 4 weken: venster start bij de seizoensstart en eindigt gisteren', async () => {
    const db = kpiDb({ settings: [
      { team_id: TEAM, key: 'season_start', value: '2026-08-10' },
      { team_id: TEAM, key: 'season_end', value: '2027-06-30' },
    ] })
    gebruik(db)
    await renderDashboard()
    expect(db.rpcCalls.find((c) => c.name === 'inzichten_aanwezigheid')!.args)
      .toEqual({ p_team_id: TEAM, p_start: '2026-08-10', p_end: '2026-08-18' })
  })

  it('AC2.7 — tenant-isolatie op de bron: de RPC krijgt het eigen team; aanwezigheid van een ander team verandert het getal niet', async () => {
    const db = kpiDb()
    // Vreemd team: zelfde event-id's niet nodig; eigen events + alleen "present".
    rowsVan(db, 'events').push(evenement('v-ev', '2026-08-10', { team_id: OTHER_TEAM }))
    for (let i = 1; i <= 10; i++) {
      rowsVan(db, 'players').push(vreemdeSpeler(i))
      rowsVan(db, 'attendance').push(aanw('v-ev', vreemdId(i), 'present', OTHER_TEAM))
    }
    // Forge: vreemde rijen op EIGEN event, voor eigen spelers.
    rowsVan(db, 'attendance').push(aanw('e-0710', eigenId(1), 'present', OTHER_TEAM))
    rowsVan(db, 'attendance').push(aanw('e-0812', eigenId(3), 'present', OTHER_TEAM))
    rowsVan(db, 'settings').push({ team_id: OTHER_TEAM, key: 'season_start', value: '2026-01-01' })
    gebruik(db)
    await renderDashboard()
    expect(kpiWaarde()).toBe('67%')
    expect(db.rpcCalls.every((c) => c.args.p_team_id === TEAM)).toBe(true)
    // De settings-query is team-gescoped.
    expect(db.log.filter((q) => q.table === 'settings').every(isTeamGescoped)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// PUNT 3 — analysekaart vóór de wedstrijd
// ═══════════════════════════════════════════════════════════════════════
describe('Punt 3 — analysekaart vóór de wedstrijd (klok: 2026-08-19 10:00 lokaal)', () => {
  function wedstrijdDb(date: string, o: Row = {}): Db {
    return basisDb({ events: [evenement('m1', date, { type: 'match', opponent: 'FC Test', ...o })] })
  }
  const kaartTitel = () => screen.queryByText(nl.event.analysis)
  const analyseLink = () => document.querySelector('a[href="/events/m1/analysis"]')

  it('AC3.1 — wedstrijd na vandaag zonder analyse: grijze, vergrendelde kaart met "Beschikbaar na de wedstrijd"; geen oranje oproep, geen link', async () => {
    gebruik(wedstrijdDb('2026-08-20'))
    const { container } = await renderEventDetail('m1')
    expect(screen.getByText(nl.event.analysisAfterMatch)).toBeInTheDocument()
    expect(nl.event.analysisAfterMatch).toBe('Beschikbaar na de wedstrijd')
    expect(screen.queryByText(nl.event.analysisCta)).not.toBeInTheDocument()
    expect(analyseLink()).toBeNull()
    const kaart = kaartTitel()!.closest('[aria-disabled="true"]') as HTMLElement
    expect(kaart).not.toBeNull()
    // Grijs: geen oranje accent (--warning) en geen CTA-balk / chevron op deze kaart.
    expect(kaart.outerHTML).not.toContain('--warning')
    expect(within(kaart).queryByText('bolt')).not.toBeInTheDocument()
    expect(within(kaart).queryByText('chevron_right')).not.toBeInTheDocument()
    expect(container.querySelectorAll('[aria-disabled="true"]')).toHaveLength(1)
  })

  it('AC3.1 — Engelse tekst "Available after the match"', async () => {
    expect(en.event.analysisAfterMatch).toBe('Available after the match')
    omgeving.locale = 'en'
    gebruik(wedstrijdDb('2026-08-20'))
    const el = await EventDetailPage({ params: Promise.resolve({ id: 'm1' }) })
    render(<DictProvider dict={en}>{el}</DictProvider>)
    expect(screen.getByText('Available after the match')).toBeInTheDocument()
    expect(screen.queryByText(en.event.analysisCta)).not.toBeInTheDocument()
  })

  it.each([['vandaag', '2026-08-19'], ['gisteren', '2026-08-18'], ['vorige maand', '2026-07-01']])(
    'AC3.2 — wedstrijd %s zonder analyse: de oproep (oranje CTA, link) zoals nu',
    async (_naam, datum) => {
      gebruik(wedstrijdDb(datum))
      await renderEventDetail('m1')
      expect(screen.getByText(nl.event.analysisCta)).toBeInTheDocument()
      expect(analyseLink()).not.toBeNull()
      expect(screen.queryByText(nl.event.analysisAfterMatch)).not.toBeInTheDocument()
      expect(analyseLink()!.getAttribute('style')).toContain('--warning')
    },
  )

  it('AC3.3 — bestaande analyse: kaart afgerond, ook bij een wedstrijd in de toekomst (en vandaag, en eerder)', async () => {
    for (const datum of ['2026-08-25', '2026-08-19', '2026-08-01']) {
      gebruik(wedstrijdDb(datum, { goals_for: 2, goals_against: 1 }))
      await renderEventDetail('m1')
      expect(screen.getByText(nl.event.analysisView), datum).toBeInTheDocument()
      expect(screen.queryByText(nl.event.analysisAfterMatch), datum).not.toBeInTheDocument()
      expect(screen.queryByText(nl.event.analysisCta), datum).not.toBeInTheDocument()
      expect(analyseLink(), datum).not.toBeNull()
      cleanup()
    }
  })

  it('AC3.4 — datum is een YYYY-MM-DD-string, vergeleken met de "vandaag"-bepaling: rond middernacht schakelt de kaart exact op de dagwissel', async () => {
    // 23:59:59 op 19 aug: een wedstrijd op 20 aug is nog toekomst.
    vi.setSystemTime(new Date('2026-08-19T23:59:59'))
    gebruik(wedstrijdDb('2026-08-20'))
    await renderEventDetail('m1')
    expect(screen.getByText(nl.event.analysisAfterMatch)).toBeInTheDocument()
    cleanup()

    // 00:00:01 op 20 aug: dezelfde wedstrijd is nu "vandaag" → oproep.
    vi.setSystemTime(new Date('2026-08-20T00:00:01'))
    gebruik(wedstrijdDb('2026-08-20'))
    await renderEventDetail('m1')
    expect(screen.getByText(nl.event.analysisCta)).toBeInTheDocument()
    expect(screen.queryByText(nl.event.analysisAfterMatch)).not.toBeInTheDocument()
    cleanup()

    // Wedstrijd van 19 aug om 00:00:01 op 20 aug: verleden → oproep.
    gebruik(wedstrijdDb('2026-08-19'))
    await renderEventDetail('m1')
    expect(screen.getByText(nl.event.analysisCta)).toBeInTheDocument()
  })

  it('AC3.5 — to-do-zichtbaarheid ongewijzigd: open analyse pas vanaf de wedstrijddag; wedstrijd morgen heeft (nog) geen analysetaak', async () => {
    // Wedstrijd morgen: wél selectie/opstelling-taak, géén analysetaak.
    gebruik(basisDb({ events: [evenement('m1', '2026-08-20', { type: 'match', opponent: 'FC Test' })] }))
    await renderDashboard()
    expect(screen.queryByRole('button', { name: nl.todo.taskAnalysis })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.todo.taskSquad })).toBeInTheDocument()
    cleanup()

    // Wedstrijd vandaag zonder analyse: analysetaak open zichtbaar.
    gebruik(basisDb({ events: [evenement('m1', '2026-08-19', { type: 'match', opponent: 'FC Test' })] }))
    await renderDashboard()
    expect(screen.getByRole('button', { name: nl.todo.taskAnalysis })).toHaveAttribute('aria-pressed', 'false')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// PUNT 4 — opstelling "gemaakt", opslaan, automatische selectie
// ═══════════════════════════════════════════════════════════════════════
function positiesVoor(formatie: string, spelerIds: (string | null)[]): Row[] {
  return FORMATIONS[formatie].positions.map((p, i) => ({ ...p, player_id: spelerIds[i] ?? null }))
}
const elfIds = (van = 1) => Array.from({ length: 11 }, (_, i) => eigenId(van + i))
const lijnupRij = (formation: string, positions: Row[], eventId = 'm1', team = TEAM): Row =>
  ({ event_id: eventId, team_id: team, formation, positions })

describe('Punt 4 — opstelling: compleet, opslaan en wedstrijdselectie', () => {
  const lineupTaak = () => screen.getByRole('button', { name: nl.todo.taskLineup })
  function wedstrijdMetLineup(lineups: Row[], extra: Record<string, Row[]> = {}): Db {
    return basisDb({
      events: [evenement('m1', '2026-08-21', { type: 'match', opponent: 'FC Test' })],
      players: Array.from({ length: 16 }, (_, i) => speler(i + 1)),
      lineups,
      ...extra,
    })
  }

  it('AC4.1 — compleet = elke positie van de gekozen formatie heeft een speler; het aantal komt uit de formatie (alle 15 formaties)', async () => {
    const sleutels = Object.keys(FORMATIONS)
    expect(sleutels.length).toBeGreaterThan(1)
    for (const f of sleutels) {
      const totaal = FORMATIONS[f].positions.length
      const volledig = positiesVoor(f, Array.from({ length: totaal }, (_, i) => eigenId(i + 1)))
      gebruik(wedstrijdMetLineup([lijnupRij(f, volledig)]))
      await renderEventDetail('m1')
      expect(screen.getByText(nl.event.lineupView), `${f} vol`).toBeInTheDocument()
      cleanup()

      const metGat = positiesVoor(f, Array.from({ length: totaal }, (_, i) => (i === totaal - 1 ? null : eigenId(i + 1))))
      gebruik(wedstrijdMetLineup([lijnupRij(f, metGat)]))
      await renderEventDetail('m1')
      expect(screen.getByText(nl.event.lineupCta), `${f} met gat`).toBeInTheDocument()
      cleanup()
    }
  })

  it('AC4.2 — lege positie → niet "gemaakt" op dashboard (taak open), eventdetail (kaart) en de taak', async () => {
    const metGat = positiesVoor('4-3-3', [...elfIds().slice(0, 10), null])
    gebruik(wedstrijdMetLineup([lijnupRij('4-3-3', metGat)]))
    await renderDashboard()
    expect(lineupTaak()).toHaveAttribute('aria-pressed', 'false')
    cleanup()
    await renderEventDetail('m1')
    expect(screen.getByText(nl.event.lineupCta)).toBeInTheDocument()
    expect(screen.queryByText(nl.event.lineupView)).not.toBeInTheDocument()
  })

  it('AC4.2 — dubbele speler (elf vakjes, tien spelers) en een te korte positions-lijst zijn niet "gemaakt"', async () => {
    const dubbel = positiesVoor('4-3-3', [...elfIds().slice(0, 10), eigenId(1)])
    gebruik(wedstrijdMetLineup([lijnupRij('4-3-3', dubbel)]))
    await renderDashboard()
    expect(lineupTaak()).toHaveAttribute('aria-pressed', 'false')
    cleanup()

    gebruik(wedstrijdMetLineup([lijnupRij('4-3-3', positiesVoor('4-3-3', elfIds()).slice(0, 10))]))
    await renderDashboard()
    expect(lineupTaak()).toHaveAttribute('aria-pressed', 'false')
  })

  it('AC4.3 — alle posities gevuld → overal "gemaakt" (dashboard-taak afgevinkt, eventdetail "Bekijk opstelling")', async () => {
    gebruik(wedstrijdMetLineup([lijnupRij('4-3-3', positiesVoor('4-3-3', elfIds()))]))
    await renderDashboard()
    expect(lineupTaak()).toHaveAttribute('aria-pressed', 'true')
    cleanup()
    await renderEventDetail('m1')
    expect(screen.getByText(nl.event.lineupView)).toBeInTheDocument()
  })

  it('AC4.4 — onbekende formatiesleutel (en kapotte positions) → niet compleet, geen crash/fout', async () => {
    gebruik(wedstrijdMetLineup([lijnupRij('9-9-9', positiesVoor('4-3-3', elfIds()))]))
    await renderDashboard()
    expect(lineupTaak()).toHaveAttribute('aria-pressed', 'false')
    cleanup()
    await renderEventDetail('m1')
    expect(screen.getByText(nl.event.lineupCta)).toBeInTheDocument()
    cleanup()

    gebruik(wedstrijdMetLineup([{ event_id: 'm1', team_id: TEAM, formation: '4-3-3', positions: 'kapot' }]))
    await renderDashboard()
    expect(lineupTaak()).toHaveAttribute('aria-pressed', 'false')
    cleanup()
    // Ook de publieke API gooit niet op een onbekende formatie.
    expect(() => telOpstelling('9-9-9', [])).not.toThrow()
    expect(telOpstelling('9-9-9', [])).toEqual({ totaal: null, leeg: null, compleet: false })
  })

  // ── saveLineup (publieke API) ──
  function saveDb(extra: Record<string, Row[]> = {}): Db {
    return basisDb({
      events: [
        evenement('m1', '2026-08-21', { type: 'match', opponent: 'FC Test' }),
        evenement('m-vreemd', '2026-08-22', { type: 'match', team_id: OTHER_TEAM }),
      ],
      players: [...Array.from({ length: 16 }, (_, i) => speler(i + 1)), ...Array.from({ length: 3 }, (_, i) => vreemdeSpeler(i + 1))],
      // 14 aanwezig (1..14), 15 afwezig, 16 onbekend (geen rij).
      attendance: [
        ...Array.from({ length: 14 }, (_, i) => aanw('m1', eigenId(i + 1), 'present')),
        aanw('m1', eigenId(15), 'absent'),
      ],
      ...extra,
    })
  }
  const squadIds = (db: Db, team = TEAM) =>
    rowsVan(db, 'match_squad').filter((r) => r.event_id === 'm1' && r.team_id === team).map((r) => r.player_id as string).sort()

  it('AC4.5 — onvolledige opstelling opslaan lukt (concept), resultaat meldt het aantal lege posities; taak blijft open', async () => {
    const db = saveDb()
    gebruik(db)
    const posities = positiesVoor('4-3-3', [...elfIds().slice(0, 8), null, null, null]) as Parameters<typeof saveLineup>[2]
    const r = await saveLineup('m1', '4-3-3', posities)
    expect(r.legePosities).toBe(3)
    expect(rowsVan(db, 'lineups')).toHaveLength(1)
    expect(rowsVan(db, 'lineups')[0].team_id).toBe(TEAM)
    gebruik(db)
    await renderDashboard()
    expect(lineupTaak()).toHaveAttribute('aria-pressed', 'false')
  })

  it('AC4.5 — UI: opslaan met 3 lege posities toont de melding (meervoud), met 1 lege positie het enkelvoud, met 0 geen melding', async () => {
    vi.useRealTimers() // waitFor werkt niet met vitest-faketimers
    const drie = saveDb({ lineups: [lijnupRij('4-3-3', positiesVoor('4-3-3', [...elfIds().slice(0, 8), null, null, null]))] })
    gebruik(drie)
    const el = await LineupPage({ params: Promise.resolve({ id: 'm1' }) })
    render(<DictProvider dict={nl}>{el}</DictProvider>)
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.save }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(nl.lineup.savedIncompleteMany.replace('{n}', '3')))
    cleanup()

    const een = saveDb({ lineups: [lijnupRij('4-3-3', positiesVoor('4-3-3', [...elfIds().slice(0, 10), null]))] })
    gebruik(een)
    render(<DictProvider dict={nl}>{await LineupPage({ params: Promise.resolve({ id: 'm1' }) })}</DictProvider>)
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.save }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(nl.lineup.savedIncompleteOne))
    cleanup()

    const nul = saveDb({ lineups: [lijnupRij('4-3-3', positiesVoor('4-3-3', elfIds()))] })
    gebruik(nul)
    render(<DictProvider dict={nl}>{await LineupPage({ params: Promise.resolve({ id: 'm1' }) })}</DictProvider>)
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.save }))
    await waitFor(() => expect(rowsVan(nul, 'match_squad').length).toBeGreaterThan(0))
    expect(screen.getByRole('status')).toBeEmptyDOMElement() // geen melding = lege live-region
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('AC4.5 — UI: mislukt opslaan toont de foutmelding (role=alert), geen ruwe fout', async () => {
    vi.useRealTimers() // waitFor werkt niet met vitest-faketimers
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = saveDb({ lineups: [lijnupRij('4-3-3', positiesVoor('4-3-3', elfIds()))] })
    gebruik(db)
    render(<DictProvider dict={nl}>{await LineupPage({ params: Promise.resolve({ id: 'm1' }) })}</DictProvider>)
    db.failWrite.add('lineups')
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.save }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(nl.lineup.saveError))
    expect(document.body.textContent).not.toContain('SECRET-DB-DETAIL')
  })

  it('AC4.6 — opslaan bij lege selectie: opgestelde spelers + bank (aanwezig ∩ actief − opgesteld) worden de selectie, via de UI', async () => {
    vi.useRealTimers() // waitFor werkt niet met vitest-faketimers
    const db = saveDb({ lineups: [lijnupRij('4-3-3', positiesVoor('4-3-3', elfIds()))] })
    gebruik(db)
    render(<DictProvider dict={nl}>{await LineupPage({ params: Promise.resolve({ id: 'm1' }) })}</DictProvider>)
    expect(rowsVan(db, 'match_squad')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.save }))
    // 11 opgesteld (1..11) + bank 12,13,14 (aanwezig); 15 afwezig en 16 onbekend niet.
    await waitFor(() => expect(squadIds(db)).toHaveLength(14))
    expect(squadIds(db)).toEqual(Array.from({ length: 14 }, (_, i) => eigenId(i + 1)).sort())
    expect(rowsVan(db, 'match_squad').every((r) => r.team_id === TEAM)).toBe(true)
  })

  it('AC4.6 — resultaat meldt selectieAutomatischGevuld; een inactieve aanwezige speler komt NIET in de bank, een aanwezige gast wel', async () => {
    const db = saveDb()
    rowsVan(db, 'players').find((p) => p.id === eigenId(13))!.active = false
    rowsVan(db, 'players').find((p) => p.id === eigenId(14))!.type = 'guest'
    gebruik(db)
    const r = await saveLineup('m1', '4-3-3', positiesVoor('4-3-3', elfIds()) as Parameters<typeof saveLineup>[2])
    expect(r).toEqual({ legePosities: 0, selectieAutomatischGevuld: true, selectieFout: false })
    expect(squadIds(db)).not.toContain(eigenId(13))
    expect(squadIds(db)).toContain(eigenId(14))
    expect(squadIds(db)).toContain(eigenId(12))
  })

  it('AC4.7 — opslaan bij niet-lege selectie: selectie blijft exact ongewijzigd (geen toevoegen, geen verwijderen)', async () => {
    const bestaand = [eigenId(2), eigenId(14)].map((p) => ({ event_id: 'm1', player_id: p, team_id: TEAM }))
    const db = saveDb({ match_squad: structuredClone(bestaand) })
    gebruik(db)
    const r = await saveLineup('m1', '4-3-3', positiesVoor('4-3-3', elfIds()) as Parameters<typeof saveLineup>[2])
    expect(r.selectieAutomatischGevuld).toBe(false)
    expect(rowsVan(db, 'match_squad')).toEqual(bestaand)
    expect(db.upserts.filter((u) => u.table === 'match_squad')).toHaveLength(0)
  })

  it('AC4.8 — lege posities/bankplaatsen komen niet in de selectie en er staan geen dubbele spelers in', async () => {
    const db = saveDb()
    gebruik(db)
    // Speler 1 staat twee keer opgesteld; 4 lege posities.
    const posities = positiesVoor('4-3-3', [eigenId(1), eigenId(1), eigenId(2), eigenId(3), eigenId(4), eigenId(5), eigenId(6), null, null, null, null]) as Parameters<typeof saveLineup>[2]
    const r = await saveLineup('m1', '4-3-3', posities)
    const ids = rowsVan(db, 'match_squad').map((x) => x.player_id)
    expect(ids.every((x) => typeof x === 'string' && x.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    expect(r.legePosities).toBe(5) // 6 unieke spelers van 11 posities
    // 6 opgesteld + 8 bank (7..14) = 14 unieke spelers.
    expect(ids).toHaveLength(14)
  })

  it('AC4.8 — opstelling met alleen lege posities (alleen bank): geen auto-selectie', async () => {
    const db = saveDb()
    gebruik(db)
    const r = await saveLineup('m1', '4-3-3', positiesVoor('4-3-3', []) as Parameters<typeof saveLineup>[2])
    expect(r.selectieAutomatischGevuld).toBe(false)
    expect(rowsVan(db, 'match_squad')).toHaveLength(0)
    expect(r.legePosities).toBe(11)
  })

  it('AC4.8 — faalt het vullen van de selectie, dan is de opstelling wél opgeslagen en meldt het resultaat selectieFout (geen gooi)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = saveDb()
    db.failWrite.add('match_squad')
    gebruik(db)
    const r = await saveLineup('m1', '4-3-3', positiesVoor('4-3-3', elfIds()) as Parameters<typeof saveLineup>[2])
    expect(r.selectieFout).toBe(true)
    expect(r.selectieAutomatischGevuld).toBe(false)
    expect(rowsVan(db, 'lineups')).toHaveLength(1)
  })

  it('AC4.9 — een handmatig afgevinkte lineup-taak blijft leidend (ook bij een onvolledige opstelling)', async () => {
    const metGat = positiesVoor('4-3-3', [...elfIds().slice(0, 10), null])
    gebruik(wedstrijdMetLineup([lijnupRij('4-3-3', metGat)], {
      task_overrides: [{ event_id: 'm1', team_id: TEAM, task_type: 'lineup' }],
    }))
    await renderDashboard()
    expect(lineupTaak()).toHaveAttribute('aria-pressed', 'true')
    cleanup()

    // Zonder override is dezelfde opstelling open (controle op de contrastsituatie).
    gebruik(wedstrijdMetLineup([lijnupRij('4-3-3', metGat)]))
    await renderDashboard()
    expect(lineupTaak()).toHaveAttribute('aria-pressed', 'false')
    cleanup()

    // Een override van een ANDER team op hetzelfde event doet niets.
    gebruik(wedstrijdMetLineup([lijnupRij('4-3-3', metGat)], {
      task_overrides: [{ event_id: 'm1', team_id: OTHER_TEAM, task_type: 'lineup' }],
    }))
    await renderDashboard()
    expect(lineupTaak()).toHaveAttribute('aria-pressed', 'false')
  })

  it('AC4.10 — tenant-isolatie op schrijfacties: wedstrijd van een ander team en spelers van een ander team worden geweigerd, niets geschreven', async () => {
    const db = saveDb()
    gebruik(db)
    await expect(saveLineup('m-vreemd', '4-3-3', positiesVoor('4-3-3', elfIds()) as Parameters<typeof saveLineup>[2])).rejects.toThrow('Event niet gevonden')
    await expect(saveLineup('m1', '4-3-3', positiesVoor('4-3-3', [vreemdId(1), ...elfIds().slice(1)]) as Parameters<typeof saveLineup>[2])).rejects.toThrow('Speler niet gevonden')
    expect(rowsVan(db, 'lineups')).toHaveLength(0)
    expect(rowsVan(db, 'match_squad')).toHaveLength(0)
  })

  it('AC4.10 — tenant-isolatie op queries: rijen van een ander team op hetzelfde event tellen niet als selectie of bank en blijven onaangeroerd; alle queries zijn team-gescoped', async () => {
    const vreemdeSelectie = [{ event_id: 'm1', player_id: vreemdId(1), team_id: OTHER_TEAM }]
    const db = saveDb({ match_squad: structuredClone(vreemdeSelectie) })
    // Forged: aanwezig-rijen van het andere team op ons event.
    rowsVan(db, 'attendance').push(aanw('m1', vreemdId(2), 'present', OTHER_TEAM), aanw('m1', vreemdId(3), 'present', OTHER_TEAM))
    gebruik(db)
    db.log.length = 0
    const r = await saveLineup('m1', '4-3-3', positiesVoor('4-3-3', elfIds()) as Parameters<typeof saveLineup>[2])
    // De vreemde selectierij telt NIET als "selectie bestaat": eigen selectie wordt wel gevuld…
    expect(r.selectieAutomatischGevuld).toBe(true)
    expect(squadIds(db)).toHaveLength(14)
    // …zonder vreemde spelers in de bank, en de vreemde rij is onaangeroerd.
    expect(squadIds(db)).not.toContain(vreemdId(2))
    expect(rowsVan(db, 'match_squad').filter((x) => x.team_id === OTHER_TEAM)).toEqual(vreemdeSelectie)
    // Elke query op een tenant-tabel kende een team_id-filter van dit team.
    const tenantQueries = db.log.filter((q) => ['events', 'players', 'attendance', 'lineups', 'match_squad'].includes(q.table))
    expect(tenantQueries.length).toBeGreaterThan(0)
    for (const q of tenantQueries) expect(isTeamGescoped(q), `query op ${q.table}`).toBe(true)
    for (const u of db.upserts) {
      expect(u.payload.every((rij) => rij.team_id === TEAM), `upsert op ${u.table}`).toBe(true)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// PUNT 5 — mobiele schermen (deels niet in jsdom te bewijzen)
// ═══════════════════════════════════════════════════════════════════════
describe('Punt 5 — mobiel (structuur; echte 375px-weergave is niet in jsdom te bewijzen)', () => {
  const LANGE_NAAM = 'Maximiliaan Bartholomeus van der Westhuizen-Oosterbaan'

  it('AC5.1 (structuur) — analyse-beoordelingen: naam mag over twee regels (geen truncate), rij wrapt onder sm, knoppengroep staat op eigen regel; alle knoppen aanwezig', async () => {
    gebruik(basisDb({
      events: [evenement('m1', '2026-08-10', { type: 'match', opponent: 'FC Test' })],
      players: [speler(1, { name: LANGE_NAAM })],
      attendance: [aanw('m1', eigenId(1), 'present')],
    }))
    render(<DictProvider dict={nl}>{await AnalysisPage({ params: Promise.resolve({ id: 'm1' }) })}</DictProvider>)
    // De naam staat in de beoordelingen (en in andere secties); toets de beoordelingsrij.
    const naam = screen.getAllByText(LANGE_NAAM).find((el) => el.closest('[class*="max-sm:flex-wrap"]'))!
    expect(naam).toBeDefined()
    expect(naam.className).not.toMatch(/\btruncate\b|text-ellipsis/)
    expect(naam.className).toContain('break-words')
    const rij = naam.closest('[class*="max-sm:flex-wrap"]') as HTMLElement
    expect(rij).not.toBeNull()
    expect(rij.querySelector('[class*="max-sm:w-full"]')).not.toBeNull()
    const groep = rij.querySelector('[class*="max-sm:w-full"]') as HTMLElement
    expect(within(groep).getAllByRole('button').length).toBeGreaterThanOrEqual(3) // −, +, wissen
  })

  it('AC5.2 (structuur) — aanwezigheidslijst eventdetail: naam zonder truncate, drie statusknoppen per rij, knoppen krimpen niet', async () => {
    gebruik(basisDb({
      events: [evenement('ev1', '2026-08-20')],
      players: [speler(1, { name: LANGE_NAAM })],
      attendance: [aanw('ev1', eigenId(1), 'present')],
    }))
    await renderEventDetail('ev1')
    const naam = screen.getByText(LANGE_NAAM)
    expect(naam.className).not.toMatch(/\btruncate\b|text-ellipsis/)
    expect(naam.className).toContain('break-words')
    const rij = naam.parentElement!.parentElement as HTMLElement
    const knoppen = within(rij).getAllByRole('button')
    expect(knoppen).toHaveLength(3)
    expect((knoppen[0].parentElement as HTMLElement).className).toContain('flex-shrink-0')
  })

  it('AC5.4/AC5.5 (structuur) — ActionBar is vanaf md niet-sticky (onderaan het formulier) en blijft mobiel sticky; mobiele scroll-padding staat in globals.css', () => {
    const { container } = render(<ActionBar primary={<button>Opslaan</button>} secondary={<button>Annuleren</button>} />)
    const balk = container.querySelector('.action-bar') as HTMLElement
    expect(balk.className).toMatch(/\bsticky\b/)
    expect(balk.className).toContain('md:static')
    const css = readFileSync(`${process.cwd()}/app/globals.css`, 'utf8')
    expect(css).toMatch(/max-width:\s*767px[\s\S]*html:has\(\.action-bar\)[\s\S]*scroll-padding-bottom/)
  })

  it.todo('AC5.3 — NIET NETJES TE DEKKEN IN JSDOM: FAB bedekt geen inhoud op 375px (dashboard/spelers/kalender//oefeningen) — vereist layout (getBoundingClientRect), browserverificatie door orkestrator')
  it.todo('AC5.4 — NIET NETJES TE DEKKEN IN JSDOM: rugnummerveld zonder scrollen zichtbaar en niet achter de ActionBar op 1440x900 en 375px — browserverificatie door orkestrator')
  it.todo('AC5.5 — NIET NETJES TE DEKKEN IN JSDOM: idem voor nieuwe speler, nieuw event, event bewerken — browserverificatie door orkestrator')
  it.todo('AC5.6 — NIET NETJES TE DEKKEN: "geen visuele wijzigingen buiten wat nodig is" is een diff-/screenshotreview, geen geautomatiseerde test')
})

// ═══════════════════════════════════════════════════════════════════════
// PUNT 6 — begroeting op apparaatijd
// ═══════════════════════════════════════════════════════════════════════
describe('Punt 6 — begroeting volgt de tijdzone van het apparaat', () => {
  const labels = { morning: nl.home.greetingMorning, afternoon: nl.home.greetingAfternoon, evening: nl.home.greetingEvening }
  const origineleTz = process.env.TZ
  afterEach(() => {
    if (origineleTz === undefined) delete process.env.TZ
    else process.env.TZ = origineleTz
  })

  function voerScriptUit(container: HTMLElement) {
    const script = container.querySelector('script') as HTMLScriptElement
    new Function(script.textContent ?? '')()
  }

  it('AC6.2 — apparaat Europe/Amsterdam, servertijd 23:30 UTC → het uur is 00:30 lokaal en de begroeting hoort bij de ochtend (lokaalUur met instelbare tijdzone)', () => {
    const nu = new Date('2026-11-04T23:30:00Z')
    expect(nu.getUTCHours()).toBe(23)
    expect(begroetingVoorUur(nu.getUTCHours())).toBe('evening') // wat de server (UTC) zou zeggen
    expect(lokaalUur(nu, 'Europe/Amsterdam')).toBe(0)
    expect(begroetingVoorUur(lokaalUur(nu, 'Europe/Amsterdam'))).toBe('morning')
  })

  it('AC6.1/AC6.2 — dashboardflow: server (UTC) rendert "Goedenavond", het inline script op het Amsterdamse apparaat zet het vóór de eerste paint op "Goedemorgen"', async () => {
    process.env.TZ = 'UTC'
    vi.setSystemTime(new Date('2026-11-04T23:30:00Z'))
    omgeving.nonce = 'nonce-abc'
    gebruik(basisDb({}))
    const { container } = await renderDashboard()
    const span = container.querySelector('h1 span, span[id]') as HTMLElement
    const script = span.nextElementSibling as HTMLScriptElement
    // Servertijd (UTC 23:30) → avond.
    expect(span.textContent).toBe(nl.home.greetingEvening)
    // Het script staat direct na de span en draagt de CSP-nonce.
    expect(script.tagName).toBe('SCRIPT')
    expect(script.getAttribute('nonce')).toBe('nonce-abc')

    // Het apparaat staat in Amsterdam: 00:30 lokaal.
    process.env.TZ = 'Europe/Amsterdam'
    expect(new Date().getHours()).toBe(0) // voorwaarde: tijdzone-omschakeling werkt in deze omgeving
    new Function(script.textContent ?? '')()
    expect(span.textContent).toBe(nl.home.greetingMorning)
  })

  it.each([
    [0, 'morning'], [5, 'morning'], [11, 'morning'], [12, 'afternoon'], [17, 'afternoon'], [18, 'evening'], [23, 'evening'],
  ] as const)('AC6.3 — grens: om %s:30 lokaal is het %s (client-render én inline script)', (uur, dagdeel) => {
    process.env.TZ = 'Europe/Amsterdam'
    vi.setSystemTime(new Date(2026, 10, 4, uur, 30)) // lokale constructor
    const { container } = render(<Begroeting labels={labels} />)
    expect(container.querySelector('span')!.textContent).toBe(labels[dagdeel])
    // Script (zoals bij de eerste paint): eerst wissen, dan uitvoeren.
    container.querySelector('span')!.textContent = ''
    voerScriptUit(container)
    expect(container.querySelector('span')!.textContent).toBe(labels[dagdeel])
  })

  it('AC6.4 (deels) — na laden toont de begroeting de lokale periode; het script staat direct na de span (vóór de eerste paint uitvoerbaar)', () => {
    process.env.TZ = 'Europe/Amsterdam'
    vi.setSystemTime(new Date('2026-11-04T23:30:00Z'))
    const { container } = render(<Begroeting labels={labels} nonce="n1" />)
    const span = container.querySelector('span')!
    expect(span.textContent).toBe(labels.morning)
    expect(span.nextElementSibling?.tagName).toBe('SCRIPT')
    expect(span.nextElementSibling?.getAttribute('nonce')).toBe('n1')
  })

  it.todo('AC6.4 — het "geen zichtbare flits"-deel is NIET NETJES TE DEKKEN IN JSDOM (geen echte paint/hydratie): browserverificatie door orkestrator (TZ=UTC dev, browser Europe/Amsterdam, geen hydration-warning)')
})

// ═══════════════════════════════════════════════════════════════════════
// ALGEMEEN
// ═══════════════════════════════════════════════════════════════════════
describe('Algemeen — AC7.1 nieuwe teksten in alle talen', () => {
  const talen = { nl, en, de, fr, es }
  it.each(Object.entries(talen))('AC7.1 — %s heeft de 7 nieuwe/gewijzigde teksten, niet leeg', (_taal, d) => {
    for (const tekst of [
      d.home.statAttendance, d.home.injuredLegend, d.event.analysisAfterMatch,
      d.lineup.savedIncompleteOne, d.lineup.savedIncompleteMany, d.lineup.saveError, d.lineup.squadAutoFillError,
    ]) {
      expect(typeof tekst).toBe('string')
      expect(tekst.trim().length).toBeGreaterThan(0)
    }
    expect(d.lineup.savedIncompleteMany).toContain('{n}')
  })
  it('AC7.1 — de/fr/es zijn echt vertaald (niet gelijk aan het Nederlands)', () => {
    for (const d of [de, fr, es]) {
      expect(d.home.statAttendance).not.toBe(nl.home.statAttendance)
      expect(d.event.analysisAfterMatch).not.toBe(nl.event.analysisAfterMatch)
      expect(d.lineup.saveError).not.toBe(nl.lineup.saveError)
    }
  })
})
