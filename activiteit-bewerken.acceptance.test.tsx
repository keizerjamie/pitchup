// Acceptatietests — Activiteit (training/wedstrijd) bewerken (goedgekeurde story
// "activiteit-bewerken", 24 acceptatiecriteria + beslissingen B1-B9 + edge cases;
// goedgekeurde technische brief §5.3).
//
// ── Testmethode ──
// Van buitenaf, zoals een trainer de feature ervaart: de ECHTE, geëxporteerde
// EventDetailPage (knop "Bewerken"), EditEventPage (server component) met
// EditEventForm/EventFormFields, en de ECHTE updateEvent (plus createEvent en
// createBulkMatches voor de aanmaak-kant) draaien tegen een tabel-engine die
// filters ÉCHT toepast (.eq/.neq/.in/.gte/.lte/...) en update/insert/delete ÉCHT
// muteert. Eigen kopie van de engine in dit bestand (repo-conventie, zie
// geheugen.md "Testmocks bestaan in twee smaken"; patroon uit
// assistent-fase1-fundament.acceptance.test.ts en gastspelers.acceptance.test.tsx).
// De action-unit-tests (app/actions/events.test.ts) gebruiken een stub die
// filters negeert; HIER wordt bewezen dat de .eq('team_id')- en .eq('type')-filters
// van de update echt werken (zie "filters van de update" bij AC19/AC20) en dat
// gekoppelde rijen na een datumwijziging diep-gelijk blijven (AC5/AC13).
//
// team_id ≠ user.id in ELK scenario: TEAM_ID is een eigen uuid, los van de
// user-id's (conventie na assistent-trainers fase 2).
//
// ── Wat in vitest NIET te bewijzen is ──
// - De RLS-laag (policy "events: recht mag wijzigen"): geen Postgres in vitest;
//   kolombegrenzing bestaat alleen in de app-laag (risico R1, geaccepteerd).
// - De echte Next-runtime: dat revalidatePath de cache écht ververst en dat
//   redirect() onder Turbopack/in de browser het formulier laat navigeren. Hier
//   wordt alleen bewezen dat de juiste paden worden gerevalideerd en dat de
//   redirect-throw (met NEXT_REDIRECT-digest, zoals Next hem gooit) geen
//   foutmelding toont. Een handmatige rooktest in de echte app blijft nodig
//   (brief §5.5).
// - <input type="date|time"> in een echte browser (jsdom saneert die velden
//   anders); ongeldige datum-/tijdstrings worden daarom via de action zelf
//   aangeboden (AC11/AC22), zoals een handgemaakte request dat zou doen.
// - AC4 "zonder handmatig te verversen": bewezen op het niveau van de
//   revalidatePath-aanroepen + het opnieuw renderen van detail/agenda/dashboard
//   op de gemuteerde data; de echte cache-invalidatie is Next-gedrag.
// - Edge case "cyclusweek en stap-telling schuiven mee": dat is afgeleide
//   logica in bestaande code (geen eigen code in deze feature); zie de
//   dekkingstabel in het rapport.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { ACTIVE_TEAM_COOKIE } from '@/lib/team-context'
import { GEEN_RECHTEN, rechtenNaarKolommen, type TeamRechten } from '@/lib/team-rechten'
import type { EventUpdateErrorCode } from '@/lib/event-input'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// redirect() gooit in Next een fout met een NEXT_REDIRECT-digest; de mock doet
// dat na, zodat het formulier de redirect precies zo ziet als in productie.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error(`__redirect__:${to}`), { digest: `NEXT_REDIRECT;push;${to};307;` })
  }),
  notFound: vi.fn(() => { throw new Error('__notFound__') }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// Niet onder test; alleen nodig zodat de imports van de gerenderde
// clientcomponenten resolven. (@/app/actions/events blijft ECHT.)
vi.mock('@/app/actions/attendance', () => ({
  updateAttendance: vi.fn().mockResolvedValue(undefined),
  markAllPresent: vi.fn().mockResolvedValue(undefined),
  saveLineup: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/players', () => ({
  markInjured: vi.fn().mockResolvedValue(undefined),
  markRecovered: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/training-plan', () => ({ saveMeting: vi.fn().mockResolvedValue(undefined) }))

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { updateEvent, createEvent } from '@/app/actions/events'
import { createBulkMatches } from '@/app/actions/events-bulk'
import EventDetailPage from '@/app/events/[id]/page'
import EditEventPage from '@/app/events/[id]/edit/page'
import EditEventForm from '@/components/EditEventForm'
import EventsPage from '@/app/events/page'
import DashboardPage from '@/app/page'

// ────────────────────────────────────────────────
// Tabel-engine met ECHTE filtering en ECHTE mutatie.
// ────────────────────────────────────────────────
type Row = Record<string, unknown>
type Write = { table: string; op: 'insert' | 'update' | 'upsert' | 'delete' | 'rpc'; payload?: unknown }
type DbOpts = {
  user: { id: string } | null
  members: Row[]
  tables?: Record<string, Row[]>
  // Houdt de update vast tot de gate vrijkomt (dubbel-indienen, AC24).
  updateGate?: Promise<void>
  // Technische fout op de update / de lookup (AC23).
  updateError?: { message: string; code?: string }
  lookupError?: { message: string; code?: string }
  // Draait één keer, direct nadat de events-lookup van updateEvent zijn rij
  // heeft teruggegeven en VÓÓR de update: simuleert een race tussen lookup en
  // update. Bewijst dat de eigen filters van de update echt werken.
  afterEventsLookup?: (events: Row[]) => void
}

let genTeller = 0

function makeDb(opts: DbOpts) {
  const tables: Record<string, Row[]> = {
    team_members: opts.members,
    settings: [],
    ...(opts.tables ?? {}),
  }
  const accesses: string[] = []
  const writes: Write[] = []
  let hookDone = false

  function table(name: string, rows: Row[]) {
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
    let limitN: number | null = null
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
    let payload: Row | null = null
    let inserted: Row[] = []

    const matched = (): Row[] => {
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

    const one = async () => {
      if (op === 'insert') return { data: inserted[0] ?? null, error: null }
      if (name === 'events' && opts.lookupError) return { data: null, error: opts.lookupError }
      const hit = matched()[0] ?? null
      const copy = hit ? { ...hit } : null
      if (name === 'events' && opts.afterEventsLookup && !hookDone) {
        hookDone = true
        opts.afterEventsLookup(rows)
      }
      return { data: copy, error: null }
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return chain },
      neq: (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return chain },
      gt: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) > (val as string | number)); return chain },
      gte: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) >= (val as string | number)); return chain },
      lt: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) < (val as string | number)); return chain },
      lte: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) <= (val as string | number)); return chain },
      in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return chain },
      order: (col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
        orders.push({ col, ascending: o.ascending ?? true, nullsFirst: o.nullsFirst ?? false })
        return chain
      },
      limit: (n: number) => { limitN = n; return chain },
      maybeSingle: one,
      single: one,
      insert: (p: Row | Row[]) => {
        op = 'insert'
        writes.push({ table: name, op: 'insert', payload: p })
        const items = (Array.isArray(p) ? p : [p]).map((x) => ({ id: (x as Row).id ?? `gen-${name}-${genTeller++}`, ...x }))
        for (const item of items) rows.push(item)
        inserted = items
        return chain
      },
      upsert: (p: Row) => {
        op = 'upsert'
        writes.push({ table: name, op: 'upsert', payload: p })
        rows.push({ ...p })
        return Promise.resolve({ data: null, error: null })
      },
      update: (p: Row) => {
        op = 'update'
        payload = p
        writes.push({ table: name, op: 'update', payload: p })
        return chain
      },
      delete: () => {
        op = 'delete'
        writes.push({ table: name, op: 'delete' })
        return chain
      },
    }
    ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const run = async () => {
        if (op === 'insert') return { data: inserted, error: null }
        if (op === 'update') {
          if (opts.updateGate) await opts.updateGate
          if (name === 'events' && opts.updateError) return { data: null, error: opts.updateError }
          const hits = matched()
          for (const r of hits) Object.assign(r, payload)
          return { data: hits.map((r) => ({ ...r })), error: null }
        }
        if (op === 'delete') {
          const hits = matched()
          for (const r of hits) { const i = rows.indexOf(r); if (i >= 0) rows.splice(i, 1) }
          return { data: hits, error: null }
        }
        return { data: matched().map((r) => ({ ...r })), error: null }
      }
      return run().then(resolve, reject)
    }
    return chain
  }

  const supabase = {
    auth: { getUser: async () => ({ data: { user: opts.user } }) },
    from: (t: string) => {
      accesses.push(t)
      if (!tables[t]) tables[t] = []
      return table(t, tables[t])
    },
    rpc: async (fn: string, args?: unknown) => {
      writes.push({ table: `rpc:${fn}`, op: 'rpc', payload: args })
      return { data: null, error: null }
    },
  }
  return { supabase, tables, accesses, writes }
}

type Db = ReturnType<typeof makeDb>

function install(opts: DbOpts): Db {
  const db = makeDb(opts)
  vi.mocked(createClient).mockResolvedValue(db.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
  return db
}

// ────────────────────────────────────────────────
// Vaste ids — team_id is EXPLICIET geen user-id.
// ────────────────────────────────────────────────
const TEAM_ID = '33333333-3333-4333-8333-333333333333'
const ANDER_TEAM = '44444444-4444-4444-8444-444444444444'
const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const ASSISTENT_ID = '22222222-2222-4222-8222-222222222222'

function ownerMember(teamId = TEAM_ID, userId = OWNER_ID): Row {
  return { team_id: teamId, user_id: userId, rol: 'owner' }
}
function assistentMember(rechten: Partial<TeamRechten>, teamId = TEAM_ID): Row {
  return {
    team_id: teamId, user_id: ASSISTENT_ID, rol: 'assistent',
    ...rechtenNaarKolommen({ ...GEEN_RECHTEN, ...rechten } as TeamRechten),
  }
}

// ────────────────────────────────────────────────
// Fixtures (vers per test, want de engine muteert).
// ────────────────────────────────────────────────
function eventRow(over: Row): Row {
  return {
    id: 'x', team_id: TEAM_ID, type: 'training', date: '2026-10-14', time: null, location: null, notes: null,
    opponent: null, match_type: null, home_away: null, gather_time: null, doelstelling: null,
    goals_for: null, goals_against: null, trainingstype: null, created_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}
// Postgres geeft TIME terug als 'HH:MM:SS'.
function trainingRow(over: Row = {}): Row {
  return eventRow({
    id: 'e1', type: 'training', date: '2026-10-14', time: '18:30:00', location: 'Veld 1', notes: 'Pasoefening',
    trainingstype: 'teamtactisch', doelstelling: 'Positiespel', ...over,
  })
}
function matchRow(over: Row = {}): Row {
  return eventRow({
    id: 'm1', type: 'match', date: '2026-10-17', time: '10:00:00', location: 'Sportpark Noord', notes: 'Shirts mee',
    opponent: 'FC Oud', match_type: 'league', home_away: 'home', gather_time: '09:15:00',
    goals_for: 3, goals_against: 1, ...over,
  })
}
function playerRow(id: string, name: string, teamId = TEAM_ID): Row {
  return {
    id, team_id: teamId, name, position: 'Spits', secondary_positions: [], jersey_number: null,
    active: true, injured: false, type: 'regular', rating: 5, created_at: '2024-01-01T00:00:00Z',
  }
}

function baseTables(): Record<string, Row[]> {
  return {
    events: [
      trainingRow(),
      matchRow(),
      trainingRow({ id: 'e2', date: '2026-10-21', time: '19:00:00', location: 'Veld 2', notes: null, doelstelling: null }),
      eventRow({ id: 'meting1', type: 'meting', date: '2026-09-01', notes: 'Legacy nulmeting' }),
      // Team B: eigen activiteit, nooit zichtbaar of bewerkbaar voor team A.
      matchRow({ id: 'eB', team_id: ANDER_TEAM, opponent: 'Geheime Tegenstander', date: '2026-10-18' }),
    ],
    players: [playerRow('p1', 'Anna Aanwezig'), playerRow('p2', 'Bram Afgemeld'), playerRow('p3', 'Cees Anderteam', ANDER_TEAM)],
    absence_periods: [
      { id: 'ap1', team_id: TEAM_ID, player_id: 'p2', from_date: '2026-10-10', to_date: '2026-10-20', created_at: '2026-10-01T00:00:00Z' },
      { id: 'ap2', team_id: TEAM_ID, player_id: 'p1', from_date: '2026-12-05', to_date: '2026-12-10', created_at: '2026-10-01T00:00:00Z' },
    ],
    attendance: [
      { id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM_ID, status: 'present', absence_period_id: null },
      { id: 'a2', event_id: 'e1', player_id: 'p2', team_id: TEAM_ID, status: 'absent', absence_period_id: 'ap1' },
      { id: 'a3', event_id: 'm1', player_id: 'p1', team_id: TEAM_ID, status: 'injured', absence_period_id: null },
      { id: 'a4', event_id: 'm1', player_id: 'p2', team_id: TEAM_ID, status: 'absent', absence_period_id: 'ap1' },
      { id: 'a5', event_id: 'e2', player_id: 'p1', team_id: TEAM_ID, status: 'present', absence_period_id: null },
      { id: 'a6', event_id: 'e2', player_id: 'p2', team_id: TEAM_ID, status: 'present', absence_period_id: null },
      { id: 'a7', event_id: 'eB', player_id: 'p3', team_id: ANDER_TEAM, status: 'present', absence_period_id: null },
    ],
    lineups: [{ id: 'l1', event_id: 'm1', team_id: TEAM_ID, formation: '4-3-3', positions: { p1: 'GK' } }],
    match_squad: [{ id: 's1', event_id: 'm1', team_id: TEAM_ID, player_id: 'p1' }],
    match_ratings: [{ id: 'r1', event_id: 'm1', team_id: TEAM_ID, player_id: 'p1', rating: 8 }],
    match_events: [{ id: 'me1', event_id: 'm1', team_id: TEAM_ID, player_id: 'p1', type: 'goal', minute: 12 }],
    training_oefeningen: [{ id: 'to1', event_id: 'e1', team_id: TEAM_ID, oefening_id: 'o1', position: 1 }],
    metingen: [],
    settings: [{ team_id: TEAM_ID, key: 'team_name', value: 'JO13-1' }],
  }
}

const LINKED = [
  'attendance', 'lineups', 'match_squad', 'match_ratings', 'match_events', 'training_oefeningen', 'absence_periods',
] as const

function snapshotLinked(db: Db): Record<string, Row[]> {
  return Object.fromEntries(LINKED.map((t) => [t, structuredClone(db.tables[t] ?? [])]))
}
function eventById(db: Db, id: string): Row {
  const row = db.tables.events.find((r) => r.id === id)
  if (!row) throw new Error(`Event ${id} niet in store`)
  return row
}
function eventWrites(db: Db): Write[] {
  return db.writes.filter((w) => w.table === 'events')
}

// ────────────────────────────────────────────────
// Sessie-helpers
// ────────────────────────────────────────────────
let cookieWaarde: string | undefined
let taalCookie: string | undefined

beforeEach(() => {
  vi.clearAllMocks()
  cookieWaarde = undefined
  taalCookie = undefined
  vi.mocked(cookies).mockResolvedValue({
    get: (n: string) => {
      if (n === ACTIVE_TEAM_COOKIE && cookieWaarde !== undefined) return { value: cookieWaarde }
      if (n === 'locale' && taalCookie !== undefined) return { value: taalCookie }
      return undefined
    },
    set: vi.fn(),
  } as unknown as Awaited<ReturnType<typeof cookies>>)
  // "Vandaag" = 2026-10-02 (alleen Date; timers blijven echt voor RTL/promises).
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-02T10:00:00'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function asOwner(extra: Partial<DbOpts> = {}, tables: Record<string, Row[]> = baseTables()): Db {
  return install({ user: { id: OWNER_ID }, members: [ownerMember()], tables, ...extra })
}
function asAssistent(rechten: Partial<TeamRechten>, extra: Partial<DbOpts> = {}, tables: Record<string, Row[]> = baseTables()): Db {
  return install({ user: { id: ASSISTENT_ID }, members: [assistentMember(rechten)], tables, ...extra })
}

function fd(fields: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
const TRAINING_FIELDS = { date: '2026-10-15', time: '19:00', location: 'Veld 9', notes: 'Nieuwe notitie' }
const MATCH_FIELDS = {
  date: '2026-10-20', time: '11:30', location: 'Sportpark Zuid', notes: 'Nieuwe notitie',
  opponent: 'FC Nieuw', match_type: 'cup', home_away: 'away',
}

type Uitkomst =
  | { kind: 'redirect'; to: string }
  | { kind: 'result'; result: { error: EventUpdateErrorCode } }
  | { kind: 'throw'; message: string }

async function runUpdate(id: string, fields: Record<string, string>): Promise<Uitkomst> {
  try {
    const result = await updateEvent(id, fd(fields))
    return { kind: 'result', result }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.startsWith('__redirect__:')) return { kind: 'redirect', to: message.slice('__redirect__:'.length) }
    return { kind: 'throw', message }
  }
}

async function renderDetail(id: string, dict = nl) {
  const el = await EventDetailPage({ params: Promise.resolve({ id }) })
  return render(<DictProvider dict={dict}>{el}</DictProvider>)
}
async function renderEdit(id: string, dict = nl) {
  const el = await EditEventPage({ params: Promise.resolve({ id }) })
  return render(<DictProvider dict={dict}>{el}</DictProvider>)
}
function field(container: HTMLElement, name: string): HTMLInputElement | HTMLTextAreaElement {
  const el = container.querySelector(`[name="${name}"]`)
  if (!el) throw new Error(`Veld ${name} niet gevonden`)
  return el as HTMLInputElement | HTMLTextAreaElement
}
function setField(container: HTMLElement, name: string, value: string) {
  fireEvent.change(field(container, name), { target: { value } })
}
function chooseRadio(container: HTMLElement, name: string, value: string) {
  const el = container.querySelector(`input[name="${name}"][value="${value}"]`)
  if (!el) throw new Error(`Radio ${name}=${value} niet gevonden`)
  fireEvent.click(el)
}
async function submitForm(container: HTMLElement) {
  await act(async () => { fireEvent.submit(container.querySelector('form')!) })
}

// Rij-status op de detailpagina (TrainingAttendance: drie knoppen per speler).
function statusOf(name: string): 'present' | 'absent' | 'unknown' {
  const row = screen.getByText(name).parentElement?.parentElement
  if (!row || within(row).queryAllByRole('button').length !== 3) throw new Error(`Aanwezigheidsrij ${name} niet gevonden`)
  const pressed = within(row).queryByRole('button', { pressed: true })
  if (!pressed) return 'unknown'
  return pressed.textContent?.includes(nl.event.absentStat) ? 'absent' : 'present'
}

// ════════════════════════════════════════════════════════════════════════
// AC1 — knop "Bewerken" naast "Verwijderen" op de detailpagina
// ════════════════════════════════════════════════════════════════════════
describe('AC1 — knop "Bewerken" op de detailpagina', () => {
  it('AC1 — training: link "Bewerken" naar /events/e1/edit, direct naast "Event verwijderen"', async () => {
    asOwner()
    await renderDetail('e1')
    const link = screen.getByRole('link', { name: nl.event.editEvent })
    expect(link).toHaveAttribute('href', '/events/e1/edit')
    const verwijder = screen.getByRole('button', { name: nl.event.deleteEvent })
    expect(link.parentElement).toContainElement(verwijder)
  })

  it('AC1 — wedstrijd: link "Bewerken" naar /events/m1/edit, naast "Event verwijderen"', async () => {
    asOwner()
    await renderDetail('m1')
    const link = screen.getByRole('link', { name: nl.event.editEvent })
    expect(link).toHaveAttribute('href', '/events/m1/edit')
    expect(link.parentElement).toContainElement(screen.getByRole('button', { name: nl.event.deleteEvent }))
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC2 / AC3 — formulier met huidige waarden; tijd als HH:MM
// ════════════════════════════════════════════════════════════════════════
describe('AC2 — het bewerkformulier opent met de huidige waarden', () => {
  it('AC2 — training: datum, tijd, locatie en notities zijn ingevuld; geen wedstrijdvelden', async () => {
    asOwner()
    const { container } = await renderEdit('e1')
    expect(screen.getByRole('heading', { name: nl.event.editTitleTraining })).toBeInTheDocument()
    expect(field(container, 'date')).toHaveValue('2026-10-14')
    expect(field(container, 'time')).toHaveValue('18:30')
    expect(field(container, 'location')).toHaveValue('Veld 1')
    expect(field(container, 'notes')).toHaveValue('Pasoefening')
    expect(container.querySelector('[name="opponent"]')).toBeNull()
  })

  it('AC2 — wedstrijd: ook tegenstander, wedstrijdtype en thuis/uit zijn ingevuld', async () => {
    asOwner()
    const { container } = await renderEdit('m1')
    expect(screen.getByRole('heading', { name: nl.event.editTitleMatch })).toBeInTheDocument()
    expect(field(container, 'date')).toHaveValue('2026-10-17')
    expect(field(container, 'time')).toHaveValue('10:00')
    expect(field(container, 'location')).toHaveValue('Sportpark Noord')
    expect(field(container, 'notes')).toHaveValue('Shirts mee')
    expect(field(container, 'opponent')).toHaveValue('FC Oud')
    expect(container.querySelector('input[name="match_type"][value="league"]')).toBeChecked()
    expect(container.querySelector('input[name="match_type"]:checked')).toHaveAttribute('value', 'league')
    expect(container.querySelector('input[name="home_away"]:checked')).toHaveAttribute('value', 'home')
  })
})

describe('AC3 — tijd als HH:MM; opslaan zonder de tijd aan te raken wordt niet afgewezen', () => {
  it('AC3 — de database geeft 18:30:00, het veld toont 18:30 (zonder seconden)', async () => {
    asOwner()
    const { container } = await renderEdit('e1')
    expect(field(container, 'time')).toHaveValue('18:30')
  })

  it('AC3 — opslaan zonder de tijd aan te raken: geen foutmelding, redirect naar de detailpagina, tijd blijft 18:30', async () => {
    const db = asOwner()
    const { container } = await renderEdit('e1')
    setField(container, 'location', 'Veld 5')
    await submitForm(container)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(vi.mocked(redirect)).toHaveBeenCalledWith('/events/e1')
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/events/e1')
    expect(eventById(db, 'e1').time).toBe('18:30')
    expect(eventById(db, 'e1').location).toBe('Veld 5')
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC4 — na opslaan: redirect + nieuwe waarden overal + revalidatie
// ════════════════════════════════════════════════════════════════════════
describe('AC4 — na opslaan zie ik de nieuwe waarden op detailpagina, agenda en dashboard', () => {
  it('AC4 — de action eindigt met een redirect naar /events/<id> en revalideert agenda, dashboard en detail (wedstrijd)', async () => {
    asOwner()
    const uitkomst = await runUpdate('m1', MATCH_FIELDS)
    expect(uitkomst).toEqual({ kind: 'redirect', to: '/events/m1' })
    const paden = vi.mocked(revalidatePath).mock.calls.map((c) => c[0])
    for (const pad of ['/events', '/', '/events/m1', '/events/m1/edit', '/periodisering', '/inzichten', '/events/m1/squad', '/events/m1/lineup', '/events/m1/analysis']) {
      expect(paden).toContain(pad)
    }
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/players/[id]', 'page')
  })

  it('AC4 — training: revalideert ook alle trainingsplannen (stap-telling van latere trainingen)', async () => {
    asOwner()
    await runUpdate('e1', TRAINING_FIELDS)
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/events/[id]/training-plan', 'page')
    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toContain('/events')
  })

  it('AC4 — vanuit het formulier: opslaan en daarna toont de detailpagina de nieuwe waarden', async () => {
    const db = asOwner()
    const { container, unmount } = await renderEdit('m1')
    setField(container, 'date', '2026-10-20')
    setField(container, 'time', '11:30')
    setField(container, 'location', 'Sportpark Zuid')
    setField(container, 'opponent', 'FC Nieuw')
    chooseRadio(container, 'match_type', 'cup')
    chooseRadio(container, 'home_away', 'away')
    setField(container, 'notes', 'Nieuwe notitie')
    await submitForm(container)
    expect(screen.queryByRole('alert')).toBeNull()
    unmount()

    await renderDetail('m1')
    expect(screen.getByRole('heading', { name: 'vs FC Nieuw' })).toBeInTheDocument()
    expect(screen.getByText(/20 oktober 2026/)).toBeInTheDocument()
    expect(screen.getByText(/11:30/)).toBeInTheDocument()
    expect(screen.getByText(/Sportpark Zuid/)).toBeInTheDocument()
    expect(screen.getByText(/Uit/)).toBeInTheDocument()
    expect(screen.getByText(nl.event.matchTypes.cup)).toBeInTheDocument()
    expect(screen.getByText('Nieuwe notitie')).toBeInTheDocument()
    expect(eventById(db, 'm1').opponent).toBe('FC Nieuw')
  })

  it('AC4 — de agenda (events-lijst) toont de wedstrijd op de nieuwe datum met de nieuwe tegenstander', async () => {
    asOwner()
    await runUpdate('m1', MATCH_FIELDS)
    const { container } = render(<DictProvider dict={nl}>{await EventsPage()}</DictProvider>)
    expect(screen.getAllByText(/FC Nieuw/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/FC Oud/)).toBeNull()
    // Datum: de "komende"-lijst toont per rij "<weekdag> <dag> · <tijd>" en linkt naar /events/m1.
    const rij = container.querySelector('a[href="/events/m1"] .text-\\[11px\\]') as HTMLElement
    expect(rij).not.toBeNull()
    expect(rij.textContent).toMatch(/\b20\b/)
    expect(rij.textContent).toContain('11:30')
    expect(rij.textContent).not.toMatch(/\b17\b/)
  })

  it('AC4 — het dashboard toont de nieuwe tegenstander als eerstvolgende wedstrijd', async () => {
    asOwner()
    await runUpdate('m1', MATCH_FIELDS)
    render(<DictProvider dict={nl}>{await DashboardPage()}</DictProvider>)
    const tegel = screen.getByText(nl.home.nextMatch).closest('a') as HTMLElement
    expect(tegel).toHaveTextContent(/FC Nieuw/)
    expect(tegel).toHaveAttribute('href', '/events/m1')
    expect(screen.queryByText(/FC Oud/)).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC5 — gekoppelde gegevens blijven ongewijzigd, zelfde id
// ════════════════════════════════════════════════════════════════════════
describe('AC5 — alle gekoppelde gegevens blijven bestaan; dezelfde activiteit (zelfde id)', () => {
  it('AC5 — wedstrijd: opstelling, selectie, beoordelingen, gebeurtenissen, aanwezigheid, uitslag en verzameltijd diep-gelijk na een datumwijziging', async () => {
    const db = asOwner()
    const voor = snapshotLinked(db)
    const eventsVoor = db.tables.events.length
    const ander = structuredClone(db.tables.events.filter((r) => r.id !== 'm1'))

    expect((await runUpdate('m1', MATCH_FIELDS)).kind).toBe('redirect')

    expect(snapshotLinked(db)).toEqual(voor)
    expect(db.tables.events).toHaveLength(eventsVoor)
    const m1 = eventById(db, 'm1')
    expect(m1).toMatchObject({
      id: 'm1', type: 'match', team_id: TEAM_ID, date: '2026-10-20',
      goals_for: 3, goals_against: 1, gather_time: '09:15:00', created_at: '2026-01-01T00:00:00Z',
    })
    expect(db.tables.events.filter((r) => r.id !== 'm1')).toEqual(ander)
    expect(db.writes.filter((w) => w.table !== 'events')).toEqual([])
    expect(db.writes.filter((w) => w.op === 'insert' || w.op === 'delete' || w.op === 'rpc')).toEqual([])
  })

  it('AC5 — training: oefeningen, aanwezigheid, doelstelling en trainingstype blijven na een datumwijziging', async () => {
    const db = asOwner()
    const voor = snapshotLinked(db)
    expect((await runUpdate('e1', TRAINING_FIELDS)).kind).toBe('redirect')
    expect(snapshotLinked(db)).toEqual(voor)
    expect(eventById(db, 'e1')).toMatchObject({
      id: 'e1', type: 'training', trainingstype: 'teamtactisch', doelstelling: 'Positiespel', date: '2026-10-15',
    })
    expect(db.writes.filter((w) => w.table !== 'events')).toEqual([])
  })

  it('AC5 — de update schrijft exact één events-rij: een update, geen insert/delete', async () => {
    const db = asOwner()
    await runUpdate('e1', TRAINING_FIELDS)
    expect(eventWrites(db)).toEqual([
      { table: 'events', op: 'update', payload: { date: '2026-10-15', time: '19:00', location: 'Veld 9', notes: 'Nieuwe notitie' } },
    ])
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC6 / AC7
// ════════════════════════════════════════════════════════════════════════
describe('AC6 — opslaan zonder wijziging slaagt en verandert niets', () => {
  it('AC6 — formulier ongewijzigd opslaan (wedstrijd): geen fout, rij inhoudelijk gelijk (tijd 10:00:00 ≡ 10:00)', async () => {
    const db = asOwner()
    const voor = structuredClone(eventById(db, 'm1'))
    const linkedVoor = snapshotLinked(db)
    const { container } = await renderEdit('m1')
    await submitForm(container)
    expect(screen.queryByRole('alert')).toBeNull()
    const na = eventById(db, 'm1')
    // Postgres TIME '10:00:00' en '10:00' zijn dezelfde waarde; de engine slaat
    // de ingevoerde string op, dus normaliseren we alleen dat ene veld.
    expect({ ...na, time: String(na.time).slice(0, 5) }).toEqual({ ...voor, time: String(voor.time).slice(0, 5) })
    expect(snapshotLinked(db)).toEqual(linkedVoor)
  })

  it('AC6 — herhaald opslaan zonder wijziging (training) geeft steeds dezelfde rij', async () => {
    const db = asOwner()
    await runUpdate('e1', { date: '2026-10-14', time: '18:30', location: 'Veld 1', notes: 'Pasoefening' })
    const eerste = structuredClone(eventById(db, 'e1'))
    await runUpdate('e1', { date: '2026-10-14', time: '18:30', location: 'Veld 1', notes: 'Pasoefening' })
    expect(eventById(db, 'e1')).toEqual(eerste)
    expect(eerste).toMatchObject({ date: '2026-10-14', time: '18:30', location: 'Veld 1', notes: 'Pasoefening', doelstelling: 'Positiespel' })
  })
})

describe('AC7 — een ingevulde tijd leegmaken werkt en blijft leeg', () => {
  it('AC7 — tijd leegmaken in het formulier slaat null op; heropenen toont een leeg veld; detailpagina toont geen tijd', async () => {
    const db = asOwner()
    const { container, unmount } = await renderEdit('e1')
    setField(container, 'time', '')
    await submitForm(container)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(eventById(db, 'e1').time).toBeNull()
    unmount()

    const heropend = await renderEdit('e1')
    expect(field(heropend.container, 'time')).toHaveValue('')
    heropend.unmount()

    await renderDetail('e1')
    expect(screen.queryByText(/18:30/)).toBeNull()
  })

  it('AC7 — een ontbrekend tijdveld in de aanvraag telt ook als leeg (null), niet als fout', async () => {
    const db = asOwner()
    const { time: _weggelaten, ...zonderTijd } = TRAINING_FIELDS
    void _weggelaten
    expect((await runUpdate('e1', zonderTijd)).kind).toBe('redirect')
    expect(eventById(db, 'e1').time).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC8 / AC9 / AC10 — velden die er niet in horen
// ════════════════════════════════════════════════════════════════════════
const BUITEN_FORMULIER = ['type', 'gather_time', 'trainingstype', 'doelstelling', 'goals_for', 'goals_against', 'team_id']

describe('AC8 — geen velden voor type, verzameltijd, trainingstype, doelstelling of uitslag', () => {
  it.each(['e1', 'm1'])('AC8 — formulier van %s bevat geen van die velden (geen enkele input/textarea met die naam)', async (id) => {
    asOwner()
    const { container } = await renderEdit(id)
    for (const naam of BUITEN_FORMULIER) expect(container.querySelector(`[name="${naam}"]`)).toBeNull()
    expect(container.querySelector('input[type="hidden"]')).toBeNull()
    expect(screen.queryByText(nl.event.gatherTime)).toBeNull()
    expect(screen.queryByText(nl.event.trainingstype)).toBeNull()
  })

  it('AC8 — de actie wijzigt die kolommen niet als ze toch worden meegestuurd (wedstrijd)', async () => {
    const db = asOwner()
    await runUpdate('m1', {
      ...MATCH_FIELDS, gather_time: '08:00', trainingstype: 'vct', doelstelling: 'Hack', goals_for: '9', goals_against: '9',
      id: 'andere', created_at: '1999-01-01T00:00:00Z',
    })
    expect(eventById(db, 'm1')).toMatchObject({
      id: 'm1', gather_time: '09:15:00', trainingstype: null, doelstelling: null,
      goals_for: 3, goals_against: 1, created_at: '2026-01-01T00:00:00Z',
    })
    expect(Object.keys(eventWrites(db)[0].payload as Row).sort()).toEqual(
      ['date', 'home_away', 'location', 'match_type', 'notes', 'opponent', 'time'],
    )
  })

  it('AC8 — idem voor een training (trainingstype en doelstelling blijven)', async () => {
    const db = asOwner()
    await runUpdate('e1', { ...TRAINING_FIELDS, trainingstype: 'vct', doelstelling: 'Hack', gather_time: '08:00', goals_for: '5' })
    expect(eventById(db, 'e1')).toMatchObject({ trainingstype: 'teamtactisch', doelstelling: 'Positiespel', gather_time: null, goals_for: null })
    expect(Object.keys(eventWrites(db)[0].payload as Row).sort()).toEqual(['date', 'location', 'notes', 'time'])
  })
})

describe('AC9 — het type is vergrendeld', () => {
  it('AC9 — geen type-schakelaar: alleen terug- en opslaanknop, geen training/wedstrijd-keuze', async () => {
    asOwner()
    const { container } = await renderEdit('e1')
    const namen = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent)
    expect(namen).toEqual([nl.nav.back, nl.event.saveChanges])
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0)
  })

  it('AC9 — een meegestuurd type wordt genegeerd: training blijft training (en andersom)', async () => {
    const db = asOwner()
    await runUpdate('e1', { ...TRAINING_FIELDS, type: 'match', opponent: 'Hack', match_type: 'cup', home_away: 'away' })
    expect(eventById(db, 'e1')).toMatchObject({ type: 'training', opponent: null, match_type: null, home_away: null })
    await runUpdate('m1', { ...MATCH_FIELDS, type: 'training' })
    expect(eventById(db, 'm1')).toMatchObject({ type: 'match', opponent: 'FC Nieuw', match_type: 'cup' })
  })
})

describe('AC10 — bij een training worden wedstrijdvelden niet getoond en niet gewijzigd', () => {
  it('AC10 — training-formulier: geen tegenstander, wedstrijdtype of thuis/uit', async () => {
    asOwner()
    const { container } = await renderEdit('e1')
    for (const naam of ['opponent', 'match_type', 'home_away']) expect(container.querySelector(`[name="${naam}"]`)).toBeNull()
    expect(screen.queryByText(nl.event.opponent)).toBeNull()
    expect(screen.queryByText(nl.event.matchType)).toBeNull()
    expect(screen.queryByText(nl.event.homeAway)).toBeNull()
  })

  it('AC10 — meegestuurde wedstrijdvelden bij een training raken de kolommen niet', async () => {
    const db = asOwner()
    await runUpdate('e1', { ...TRAINING_FIELDS, opponent: 'FC Hack', match_type: 'cup', home_away: 'away' })
    expect(eventById(db, 'e1')).toMatchObject({ opponent: null, match_type: null, home_away: null })
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC11 — invoerregels gelijk aan aanmaken
// ════════════════════════════════════════════════════════════════════════
describe('AC11 — invoerregels gelijk aan aanmaken', () => {
  it('AC11 — geldige datum/tijd worden opgeslagen; locatie wordt op 200, notities op 2000, tegenstander op 100 tekens afgekapt (zoals bij aanmaken)', async () => {
    const db = asOwner()
    await runUpdate('m1', { ...MATCH_FIELDS, location: 'L'.repeat(201), notes: 'N'.repeat(2001), opponent: 'T'.repeat(101) })
    const m1 = eventById(db, 'm1')
    expect((m1.location as string).length).toBe(200)
    expect((m1.notes as string).length).toBe(2000)
    expect((m1.opponent as string).length).toBe(100)
  })

  it('AC11 — precies op de grens (200/2000/100) blijft alles ongemoeid', async () => {
    const db = asOwner()
    await runUpdate('m1', { ...MATCH_FIELDS, location: 'L'.repeat(200), notes: 'N'.repeat(2000), opponent: 'T'.repeat(100) })
    const m1 = eventById(db, 'm1')
    expect([m1.location, m1.notes, m1.opponent].map((v) => (v as string).length)).toEqual([200, 2000, 100])
  })

  it('AC11 — lege locatie en notities worden null', async () => {
    const db = asOwner()
    await runUpdate('m1', { ...MATCH_FIELDS, location: '', notes: '' })
    expect(eventById(db, 'm1')).toMatchObject({ location: null, notes: null })
  })

  it.each([
    ['datum 31 februari', { date: '2026-02-30' }, 'invalid_date'],
    ['datum maand 13', { date: '2026-13-01' }, 'invalid_date'],
    ['datum in verkeerd formaat', { date: '20-10-2026' }, 'invalid_date'],
    ['tijd 25:00', { time: '25:00' }, 'invalid_time'],
    ['tijd 9:5', { time: '9:5' }, 'invalid_time'],
    ['tijd met seconden 14:30:00', { time: '14:30:00' }, 'invalid_time'],
    ['tijd abc', { time: 'abc' }, 'invalid_time'],
    ['wedstrijdtype onzin', { match_type: 'onzin' }, 'invalid_match_type'],
    ['thuis/uit onzin', { home_away: 'onzin' }, 'invalid_home_away'],
    ['lege tegenstander', { opponent: '' }, 'opponent_required'],
    ['tegenstander alleen spaties', { opponent: '   ' }, 'opponent_required'],
  ] as [string, Record<string, string>, EventUpdateErrorCode][])('AC11/AC22 — %s wordt geweigerd met %s en laat de rij ongemoeid', async (_naam, afwijking, code) => {
    const db = asOwner()
    const voor = structuredClone(db.tables.events)
    const uitkomst = await runUpdate('m1', { ...MATCH_FIELDS, ...afwijking })
    expect(uitkomst).toEqual({ kind: 'result', result: { error: code } })
    expect(db.tables.events).toEqual(voor)
    expect(eventWrites(db)).toEqual([])
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled()
  })

  it('AC11 — wedstrijdtype en thuis/uit accepteren alle waarden uit de bestaande keuzelijsten', async () => {
    const db = asOwner()
    for (const mt of ['friendly', 'league', 'cup']) {
      for (const ha of ['home', 'away']) {
        expect((await runUpdate('m1', { ...MATCH_FIELDS, match_type: mt, home_away: ha })).kind).toBe('redirect')
        expect(eventById(db, 'm1')).toMatchObject({ match_type: mt, home_away: ha })
      }
    }
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC12 — wandklok, geen UTC-omrekening
// ════════════════════════════════════════════════════════════════════════
describe('AC12 — datum en tijd zijn lokale wandklokwaarden zonder UTC-omrekening', () => {
  it.each([
    ['2026-03-29', '02:30'], // EU-zomertijdswitch: 02:30 bestaat lokaal niet
    ['2026-10-25', '02:30'], // EU-wintertijdswitch: 02:30 bestaat twee keer
    ['2026-12-31', '23:59'],
    ['2027-01-01', '00:00'],
  ])('AC12 — %s %s wordt exact zo opgeslagen en teruggegeven', async (datum, tijd) => {
    const db = asOwner()
    await runUpdate('e1', { ...TRAINING_FIELDS, date: datum, time: tijd })
    expect(eventById(db, 'e1')).toMatchObject({ date: datum, time: tijd })
    const { container } = await renderEdit('e1')
    expect(field(container, 'date')).toHaveValue(datum)
    expect(field(container, 'time')).toHaveValue(tijd)
  })

  it('AC12 — de detailpagina toont de opgeslagen datum exact (31 december, geen verschuiving naar 30 december of 1 januari)', async () => {
    asOwner()
    await runUpdate('e1', { ...TRAINING_FIELDS, date: '2026-12-31', time: '23:59' })
    await renderDetail('e1')
    expect(screen.getByText(/31 december 2026/)).toBeInTheDocument()
    expect(screen.getByText(/23:59/)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC13 — aanwezigheid bij datumwijziging (B3)
// ════════════════════════════════════════════════════════════════════════
describe('AC13 — bij een datumwijziging blijven alle aanwezigheidsrijen exact zoals ze waren', () => {
  it('AC13 — status en absence_period_id van elke rij zijn diep-gelijk; geen rij erbij, weg of herberekend', async () => {
    const db = asOwner()
    const voor = structuredClone(db.tables.attendance)
    await runUpdate('e1', { ...TRAINING_FIELDS, date: '2026-12-01' })
    expect(db.tables.attendance).toEqual(voor)
    expect(db.tables.attendance.find((r) => r.id === 'a2')).toMatchObject({ status: 'absent', absence_period_id: 'ap1' })
    expect(db.writes.filter((w) => w.table === 'attendance' || w.table === 'absence_periods')).toEqual([])
  })

  it('AC13/B3 — verplaatst naar een dag BINNEN een andere afmeldperiode: de speler van die periode wordt NIET alsnog afgemeld', async () => {
    const db = asOwner()
    await runUpdate('e1', { ...TRAINING_FIELDS, date: '2026-12-07' }) // valt in ap2 van p1
    expect(db.tables.attendance.find((r) => r.id === 'a1')).toMatchObject({ status: 'present', absence_period_id: null })
    expect(db.writes.filter((w) => w.table === 'attendance')).toEqual([])
  })

  it('AC13/edge B3 — een verplaatste activiteit toont de afmelding die bij de oude datum hoorde (bewust)', async () => {
    asOwner()
    await runUpdate('e1', { ...TRAINING_FIELDS, date: '2026-12-01' }) // buiten ap1 (10-10..10-20)
    await renderDetail('e1')
    expect(statusOf('Bram Afgemeld')).toBe('absent')
    expect(statusOf('Anna Aanwezig')).toBe('present')
  })

  it('AC13 — detailpagina na datumwijziging maakt geen backfill-schrijfacties aan voor spelers die al een rij hebben', async () => {
    const db = asOwner()
    await runUpdate('e1', { ...TRAINING_FIELDS, date: '2026-12-01' })
    db.writes.length = 0
    await renderDetail('e1')
    expect(db.writes).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC14 — verleden met uitslag/beoordelingen; zelfde dag; geen waarschuwing
// ════════════════════════════════════════════════════════════════════════
describe('AC14 — datumwijziging in het verleden en naar een dag met een activiteit van hetzelfde type', () => {
  it('AC14 — wedstrijd in het verleden met uitslag en beoordelingen: datum wijzigen slaagt; uitslag en beoordelingen blijven', async () => {
    const db = asOwner({}, {
      ...baseTables(),
      events: [...baseTables().events, matchRow({ id: 'oud', date: '2026-05-02', opponent: 'FC Verleden', goals_for: 2, goals_against: 2 })],
      match_ratings: [{ id: 'r9', event_id: 'oud', team_id: TEAM_ID, player_id: 'p1', rating: 6 }],
    })
    const ratingsVoor = structuredClone(db.tables.match_ratings)
    const uitkomst = await runUpdate('oud', { ...MATCH_FIELDS, opponent: 'FC Verleden', date: '2026-05-09' })
    expect(uitkomst).toEqual({ kind: 'redirect', to: '/events/oud' })
    expect(eventById(db, 'oud')).toMatchObject({ date: '2026-05-09', goals_for: 2, goals_against: 2 })
    expect(db.tables.match_ratings).toEqual(ratingsVoor)
  })

  it('AC14 — naar een dag waar al een training staat: geen waarschuwing/blokkade, beide trainingen bestaan daarna', async () => {
    const db = asOwner()
    const { container } = await renderEdit('e1')
    setField(container, 'date', '2026-10-21') // e2 staat daar al (zelfde type)
    await submitForm(container)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(db.tables.events.filter((r) => r.type === 'training' && r.date === '2026-10-21').map((r) => r.id).sort()).toEqual(['e1', 'e2'])
    expect(eventById(db, 'e2')).toMatchObject({ date: '2026-10-21', location: 'Veld 2' })
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC15 — bulk-aangemaakte wedstrijden (B7)
// ════════════════════════════════════════════════════════════════════════
describe('AC15 — bulk-aangemaakte wedstrijden zijn op dezelfde manier bewerkbaar', () => {
  it('AC15 — wedstrijd aangemaakt via de echte createBulkMatches: knop, formulier en opslaan werken; aanwezigheid blijft', async () => {
    const db = asOwner()
    await createBulkMatches([
      { date: '2026-11-07', time: '14:00', opponent: 'Bulk FC', home_away: 'home', match_type: 'friendly', location: 'Veld 4', gather_time: '13:15', notes: null },
    ])
    const bulk = db.tables.events.find((r) => r.opponent === 'Bulk FC')!
    expect(bulk).toBeDefined()
    const attendanceVoor = structuredClone(db.tables.attendance.filter((r) => r.event_id === bulk.id))
    expect(attendanceVoor.length).toBeGreaterThan(0) // bulk maakt aanwezigheid per actieve speler

    const detail = await renderDetail(bulk.id as string)
    expect(screen.getByRole('link', { name: nl.event.editEvent })).toHaveAttribute('href', `/events/${bulk.id}/edit`)
    detail.unmount()

    const { container } = await renderEdit(bulk.id as string)
    expect(field(container, 'opponent')).toHaveValue('Bulk FC')
    setField(container, 'opponent', 'Bulk United')
    setField(container, 'date', '2026-11-14')
    await submitForm(container)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(eventById(db, bulk.id as string)).toMatchObject({ opponent: 'Bulk United', date: '2026-11-14', gather_time: '13:15', type: 'match' })
    expect(db.tables.attendance.filter((r) => r.event_id === bulk.id)).toEqual(attendanceVoor)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC16 — i18n in vijf talen
// ════════════════════════════════════════════════════════════════════════
describe('AC16 — alle nieuwe teksten bestaan in nl, en, de, fr en es', () => {
  const codes: EventUpdateErrorCode[] = ['not_found', 'invalid_date', 'invalid_time', 'invalid_match_type', 'invalid_home_away', 'opponent_required']
  const talen = { en, de, fr, es }

  it('AC16 — nl heeft alle sleutels, niet leeg', () => {
    for (const key of ['editEvent', 'editTitleTraining', 'editTitleMatch', 'saveChanges', 'saving', 'editErrorGeneric'] as const) {
      expect(nl.event[key].trim()).not.toBe('')
    }
    for (const code of codes) expect(nl.event.editErrors[code].trim()).not.toBe('')
  })

  it.each(Object.entries(talen))('AC16 — %s heeft alle sleutels, niet leeg en vertaald (anders dan het Nederlands)', (_taal, dict) => {
    for (const key of ['editEvent', 'editTitleTraining', 'editTitleMatch', 'saveChanges', 'saving', 'editErrorGeneric'] as const) {
      expect(typeof dict.event[key]).toBe('string')
      expect(dict.event[key].trim()).not.toBe('')
      expect(dict.event[key]).not.toBe(nl.event[key])
    }
    expect(Object.keys(dict.event.editErrors).sort()).toEqual([...codes].sort())
    for (const code of codes) {
      expect(dict.event.editErrors[code].trim()).not.toBe('')
      expect(dict.event.editErrors[code]).not.toBe(nl.event.editErrors[code])
    }
  })

  it.each(Object.entries(talen))('AC16 — %s: detailknop, formuliertitel en opslaanknop verschijnen in die taal', async (taal, dict) => {
    asOwner()
    taalCookie = taal // de detailpagina kiest zijn taal via de locale-cookie (getDict)
    const detail = await renderDetail('m1', dict)
    expect(screen.getByRole('link', { name: dict.event.editEvent })).toBeInTheDocument()
    detail.unmount()
    await renderEdit('m1', dict)
    expect(screen.getByRole('heading', { name: dict.event.editTitleMatch })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: dict.event.saveChanges })).toBeInTheDocument()
  })

  it.each(Object.entries({ nl, ...talen }))('AC16 — %s: een foutcode uit de action wordt in die taal getoond (opponent_required)', async (_taal, dict) => {
    asOwner()
    const { container } = await renderEdit('m1', dict)
    setField(container, 'opponent', '   ')
    await submitForm(container)
    expect(await screen.findByRole('alert')).toHaveTextContent(dict.event.editErrors.opponent_required)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC17 / AC18 — rechten
// ════════════════════════════════════════════════════════════════════════
describe('AC17 — zonder bewerkrecht op agenda: geen knop, pagina stuurt door, actie weigert', () => {
  it('AC17 — assistent zonder enig bewerkrecht: geen "Bewerken"-knop op training- of wedstrijddetail (en geen verwijderknop)', async () => {
    asAssistent({})
    const t = await renderDetail('e1')
    expect(screen.queryByRole('link', { name: nl.event.editEvent })).toBeNull()
    expect(screen.queryByRole('button', { name: nl.event.deleteEvent })).toBeNull()
    t.unmount()
    await renderDetail('m1')
    expect(screen.queryByRole('link', { name: nl.event.editEvent })).toBeNull()
  })

  it('AC17 — de bewerkpagina stuurt door naar de detailpagina', async () => {
    asAssistent({})
    await expect(EditEventPage({ params: Promise.resolve({ id: 'e1' }) })).rejects.toThrow('__redirect__:/events/e1')
  })

  it('AC17 — de actie weigert met "Geen toegang" VÓÓR enige query op events; de activiteit blijft ongewijzigd', async () => {
    const db = asAssistent({})
    const voor = structuredClone(db.tables.events)
    const uitkomst = await runUpdate('e1', TRAINING_FIELDS)
    expect(uitkomst).toEqual({ kind: 'throw', message: 'Geen toegang' })
    expect(db.tables.events).toEqual(voor)
    expect(db.accesses).not.toContain('events')
    expect(db.writes).toEqual([])
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled()
  })

  it('AC17 — zonder sessie: de actie gooit "Niet ingelogd" en schrijft niets', async () => {
    const db = install({ user: null, members: [], tables: baseTables() })
    expect(await runUpdate('e1', TRAINING_FIELDS)).toEqual({ kind: 'throw', message: 'Niet ingelogd' })
    expect(db.writes).toEqual([])
  })
})

describe('AC18 — assistent met alleen agenda-recht mag bewerken; alleen training/wedstrijd niet', () => {
  it('AC18 — alleen agenda: knop zichtbaar, pagina opent, actie slaagt', async () => {
    const db = asAssistent({ agenda: true })
    const detail = await renderDetail('m1')
    expect(screen.getByRole('link', { name: nl.event.editEvent })).toBeInTheDocument()
    detail.unmount()
    const { container, unmount } = await renderEdit('m1')
    expect(field(container, 'opponent')).toHaveValue('FC Oud')
    unmount()
    expect((await runUpdate('m1', MATCH_FIELDS)).kind).toBe('redirect')
    expect(eventById(db, 'm1')).toMatchObject({ opponent: 'FC Nieuw', date: '2026-10-20' })
  })

  it('AC18 — alleen training + wedstrijd (zonder agenda): geen knop, pagina stuurt door, actie weigert, rij ongewijzigd', async () => {
    const db = asAssistent({ training: true, wedstrijd: true, aanwezigheid: true, spelers: true, periodisering: true })
    const voor = structuredClone(db.tables.events)
    await renderDetail('m1')
    expect(screen.queryByRole('link', { name: nl.event.editEvent })).toBeNull()
    await expect(EditEventPage({ params: Promise.resolve({ id: 'm1' }) })).rejects.toThrow('__redirect__:/events/m1')
    expect(await runUpdate('m1', MATCH_FIELDS)).toEqual({ kind: 'throw', message: 'Geen toegang' })
    expect(db.tables.events).toEqual(voor)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC19 — tenant-isolatie
// ════════════════════════════════════════════════════════════════════════
describe('AC19 — een activiteit van een ander team is niet te openen of te bewerken en lekt niet', () => {
  it('AC19 — detailpagina en bewerkpagina van een andere-team-activiteit geven notFound (zelfde als een onbestaand id)', async () => {
    asOwner()
    await expect(EventDetailPage({ params: Promise.resolve({ id: 'eB' }) })).rejects.toThrow('__notFound__')
    await expect(EditEventPage({ params: Promise.resolve({ id: 'eB' }) })).rejects.toThrow('__notFound__')
    await expect(EditEventPage({ params: Promise.resolve({ id: 'bestaat-niet' }) })).rejects.toThrow('__notFound__')
  })

  it('AC19 — de actie op een andere-team-activiteit geeft dezelfde not_found als op een onbestaand id; de rij van team B blijft ongewijzigd', async () => {
    const db = asOwner()
    const voorB = structuredClone(eventById(db, 'eB'))
    const echt = await runUpdate('eB', MATCH_FIELDS)
    const nep = await runUpdate('bestaat-niet', MATCH_FIELDS)
    expect(echt).toEqual({ kind: 'result', result: { error: 'not_found' } })
    expect(echt).toEqual(nep)
    expect(eventById(db, 'eB')).toEqual(voorB)
    expect(eventWrites(db)).toEqual([])
  })

  it('AC19 — een meegestuurd team_id wordt genegeerd: eigen activiteit blijft van het eigen team, ook als team_id naar team B wijst', async () => {
    const db = asOwner()
    await runUpdate('m1', { ...MATCH_FIELDS, team_id: ANDER_TEAM })
    expect(eventById(db, 'm1').team_id).toBe(TEAM_ID)
    expect(Object.keys(eventWrites(db)[0].payload as Row)).not.toContain('team_id')
  })

  it('AC19 — een meegestuurd team_id van het EIGEN team opent geen toegang tot een activiteit van team B', async () => {
    const db = asOwner()
    expect(await runUpdate('eB', { ...MATCH_FIELDS, team_id: TEAM_ID })).toEqual({ kind: 'result', result: { error: 'not_found' } })
    expect(eventById(db, 'eB')).toMatchObject({ team_id: ANDER_TEAM, opponent: 'Geheime Tegenstander' })
  })

  it('AC19 — het team komt uit de sessie: lid van twee teams met actief team A kan de activiteit van team B niet bewerken, met actief team B wel (en niet die van A)', async () => {
    const db = install({
      user: { id: OWNER_ID },
      members: [ownerMember(TEAM_ID), ownerMember(ANDER_TEAM)],
      tables: baseTables(),
    })
    cookieWaarde = TEAM_ID
    expect((await runUpdate('eB', MATCH_FIELDS)).kind).toBe('result')
    expect(eventById(db, 'eB').opponent).toBe('Geheime Tegenstander')

    cookieWaarde = ANDER_TEAM
    expect((await runUpdate('eB', MATCH_FIELDS)).kind).toBe('redirect')
    expect(eventById(db, 'eB').opponent).toBe('FC Nieuw')
    expect(await runUpdate('m1', MATCH_FIELDS)).toEqual({ kind: 'result', result: { error: 'not_found' } })
    expect(eventById(db, 'm1').opponent).toBe('FC Oud')
  })

  it('AC19/filters van de update — race tussen lookup en update waarbij de rij van team wisselt: het team_id-filter van de update raakt 0 rijen (not_found), de rij blijft ongemoeid', async () => {
    const db = asOwner({
      afterEventsLookup: (events) => { events.find((r) => r.id === 'm1')!.team_id = ANDER_TEAM },
    })
    const uitkomst = await runUpdate('m1', MATCH_FIELDS)
    expect(uitkomst).toEqual({ kind: 'result', result: { error: 'not_found' } })
    expect(eventById(db, 'm1')).toMatchObject({ team_id: ANDER_TEAM, opponent: 'FC Oud', date: '2026-10-17' })
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC20 — legacy meting (B8)
// ════════════════════════════════════════════════════════════════════════
describe('AC20 — legacy-activiteit van type meting is niet bewerkbaar', () => {
  it('AC20 — detailpagina van een meting toont geen "Bewerken"-knop (wel de verwijderknop van de bestaande meting-tak)', async () => {
    asOwner()
    await renderDetail('meting1')
    expect(screen.queryByRole('link', { name: nl.event.editEvent })).toBeNull()
    expect(screen.getByRole('button', { name: nl.event.deleteEvent })).toBeInTheDocument()
  })

  it('AC20 — de bewerkpagina stuurt een meting door naar de detailpagina', async () => {
    asOwner()
    await expect(EditEventPage({ params: Promise.resolve({ id: 'meting1' }) })).rejects.toThrow('__redirect__:/events/meting1')
  })

  it('AC20 — de actie weigert een meting (not_found) en laat de rij ongemoeid', async () => {
    const db = asOwner()
    const voor = structuredClone(eventById(db, 'meting1'))
    expect(await runUpdate('meting1', TRAINING_FIELDS)).toEqual({ kind: 'result', result: { error: 'not_found' } })
    expect(eventById(db, 'meting1')).toEqual(voor)
    expect(eventWrites(db)).toEqual([])
  })

  it('AC20/filters van de update — race waarbij de rij tussen lookup en update van type wisselt: het type-filter van de update raakt 0 rijen, de datum blijft', async () => {
    const db = asOwner({
      afterEventsLookup: (events) => { events.find((r) => r.id === 'e1')!.type = 'meting' },
    })
    expect(await runUpdate('e1', TRAINING_FIELDS)).toEqual({ kind: 'result', result: { error: 'not_found' } })
    expect(eventById(db, 'e1')).toMatchObject({ type: 'meting', date: '2026-10-14', location: 'Veld 1' })
  })

  it('filters van de update — training die tijdens het bewerken een wedstrijd blijkt te zijn: type-filter voorkomt dat de wedstrijd met trainingsvelden wordt overschreven', async () => {
    const db = asOwner({
      afterEventsLookup: (events) => { events.find((r) => r.id === 'e1')!.type = 'match' },
    })
    expect(await runUpdate('e1', TRAINING_FIELDS)).toEqual({ kind: 'result', result: { error: 'not_found' } })
    expect(eventById(db, 'e1')).toMatchObject({ type: 'match', date: '2026-10-14' })
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC21 — activiteit bestaat niet (meer) bij opslaan
// ════════════════════════════════════════════════════════════════════════
describe('AC21 — activiteit bestaat niet meer bij opslaan: begrijpelijke melding, niets aangemaakt', () => {
  it('AC21 — event verwijderd terwijl het formulier openstond: melding "bestaat niet meer", niets aangemaakt, invoer blijft', async () => {
    const db = asOwner()
    const { container } = await renderEdit('e1')
    db.tables.events.splice(db.tables.events.findIndex((r) => r.id === 'e1'), 1) // door iemand anders verwijderd
    const aantal = db.tables.events.length
    setField(container, 'location', 'Veld 7')
    await submitForm(container)
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.event.editErrors.not_found)
    expect(db.tables.events).toHaveLength(aantal)
    expect(db.writes.filter((w) => w.op === 'insert')).toEqual([])
    expect(field(container, 'location')).toHaveValue('Veld 7')
    expect(screen.getByRole('button', { name: nl.event.saveChanges })).toBeEnabled()
  })

  it('AC21 — verwijderd TUSSEN lookup en update (0 rijen geraakt): not_found en nooit een insert', async () => {
    const db = asOwner({
      afterEventsLookup: (events) => { events.splice(events.findIndex((r) => r.id === 'e1'), 1) },
    })
    expect(await runUpdate('e1', TRAINING_FIELDS)).toEqual({ kind: 'result', result: { error: 'not_found' } })
    expect(db.writes.filter((w) => w.op === 'insert')).toEqual([])
    expect(db.tables.events.find((r) => r.id === 'e1')).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC22 — ongeldige invoer, duidelijke melding, niets gewijzigd
// ════════════════════════════════════════════════════════════════════════
describe('AC22 — bij ongeldige invoer: duidelijke foutmelding en de activiteit blijft ongewijzigd', () => {
  it('AC22 — lege datum in het formulier: melding "Vul een geldige datum in.", invoer blijft staan, rij ongemoeid', async () => {
    const db = asOwner()
    const voor = structuredClone(db.tables.events)
    const { container } = await renderEdit('e1')
    setField(container, 'date', '')
    setField(container, 'location', 'Blijft staan')
    await submitForm(container)
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.event.editErrors.invalid_date)
    expect(field(container, 'location')).toHaveValue('Blijft staan')
    expect(screen.getByRole('button', { name: nl.event.saveChanges })).toBeEnabled()
    expect(db.tables.events).toEqual(voor)
  })

  it('AC22 — lege tegenstander bij een wedstrijd (alleen spaties): melding "Vul een tegenstander in.", rij ongemoeid', async () => {
    const db = asOwner()
    const voor = structuredClone(db.tables.events)
    const { container } = await renderEdit('m1')
    setField(container, 'opponent', '   ')
    await submitForm(container)
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.event.editErrors.opponent_required)
    expect(db.tables.events).toEqual(voor)
  })

  it('AC22 — wedstrijd zonder bekend type/thuis-uit (NULL in de database): opslaan vraagt eerst om een keuze, rij ongemoeid (risico R6)', async () => {
    const db = asOwner({}, {
      ...baseTables(),
      events: [...baseTables().events, matchRow({ id: 'leeg', match_type: null, home_away: null })],
    })
    const voor = structuredClone(eventById(db, 'leeg'))
    const { container } = await renderEdit('leeg')
    expect(container.querySelectorAll('input[type="radio"]:checked')).toHaveLength(0)
    await submitForm(container)
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.event.editErrors.invalid_match_type)
    expect(eventById(db, 'leeg')).toEqual(voor)
    chooseRadio(container, 'match_type', 'cup')
    await submitForm(container)
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.event.editErrors.invalid_home_away)
    chooseRadio(container, 'home_away', 'home')
    await submitForm(container)
    expect(eventById(db, 'leeg')).toMatchObject({ match_type: 'cup', home_away: 'home' })
  })

  it('AC22 — bij een fout hoeft de trainer niet opnieuw te beginnen: foutmelding verdwijnt na een geslaagde tweede poging', async () => {
    const db = asOwner()
    const { container } = await renderEdit('e1')
    setField(container, 'date', '')
    await submitForm(container)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    setField(container, 'date', '2026-10-30')
    await submitForm(container)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(eventById(db, 'e1').date).toBe('2026-10-30')
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC23 — technische fout
// ════════════════════════════════════════════════════════════════════════
describe('AC23 — bij een technische fout een algemene melding; geen ruwe error of intern detail naar scherm of logs', () => {
  const GEHEIM = 'duplicate key value violates constraint "events_secret_idx" (SECRET-DETAIL)'

  it('AC23 — databasefout bij de update: formulier toont alleen de algemene melding; scherm en logs bevatten het ruwe detail niet', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = asOwner({ updateError: { message: GEHEIM, code: 'XX000' } })
    const voor = structuredClone(db.tables.events)
    const { container } = await renderEdit('e1')
    await submitForm(container)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(nl.event.editErrorGeneric)
    expect(document.body.textContent).not.toContain('SECRET-DETAIL')
    expect(document.body.textContent).not.toContain('constraint')
    expect(db.tables.events).toEqual(voor)
    const gelogd = JSON.stringify(logSpy.mock.calls)
    expect(gelogd).not.toContain('SECRET-DETAIL')
    expect(gelogd).not.toContain('constraint')
    expect(gelogd).toContain('events.updateEvent')
    expect(screen.getByRole('button', { name: nl.event.saveChanges })).toBeEnabled()
  })

  it('AC23 — de action zelf gooit uitsluitend de generieke melding (update- én lookup-fout)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    asOwner({ updateError: { message: GEHEIM, code: 'XX000' } })
    expect(await runUpdate('e1', TRAINING_FIELDS)).toEqual({ kind: 'throw', message: GENERIC_ERROR_MESSAGE })
    asOwner({ lookupError: { message: GEHEIM, code: 'XX000' } })
    expect(await runUpdate('e1', TRAINING_FIELDS)).toEqual({ kind: 'throw', message: GENERIC_ERROR_MESSAGE })
  })

  it('AC23/AC17 — recht ingetrokken terwijl het formulier openstond: de gegooide "Geen toegang" komt niet als ruwe melding in beeld, alleen de algemene', async () => {
    const db = asOwner()
    const { container } = await renderEdit('e1')
    const voor = structuredClone(db.tables.events)
    // Sessie wisselt naar een assistent zonder agenda-recht.
    install({ user: { id: ASSISTENT_ID }, members: [assistentMember({})], tables: db.tables })
    await submitForm(container)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(nl.event.editErrorGeneric)
    expect(alert).not.toHaveTextContent('Geen toegang')
    expect(db.tables.events).toEqual(voor)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC24 — opslaanknop geblokkeerd, dubbel indienen = één keer
// ════════════════════════════════════════════════════════════════════════
describe('AC24 — tijdens opslaan is de knop geblokkeerd; dubbel indienen geeft hetzelfde resultaat als één keer', () => {
  it('AC24 — tijdens opslaan: knop disabled, aria-busy en label "Opslaan..."; een tweede submit start geen tweede update', async () => {
    let los!: () => void
    const gate = new Promise<void>((res) => { los = res })
    const db = asOwner({ updateGate: gate })
    const { container } = await renderEdit('e1')
    setField(container, 'location', 'Veld 8')
    await submitForm(container)
    const knop = screen.getByRole('button', { name: nl.event.saving })
    expect(knop).toBeDisabled()
    expect(knop).toHaveAttribute('aria-busy', 'true')
    await submitForm(container) // tweede klik/enter tijdens het wachten
    expect(db.writes.filter((w) => w.table === 'events' && w.op === 'update')).toHaveLength(1)
    await act(async () => { los() })
    expect(eventById(db, 'e1').location).toBe('Veld 8')
    expect(db.writes.filter((w) => w.table === 'events' && w.op === 'update')).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('AC24 — dezelfde aanroep twee keer geeft dezelfde eindtoestand en dezelfde uitkomst als één keer (idempotent)', async () => {
    const db = asOwner()
    const eerste = await runUpdate('m1', MATCH_FIELDS)
    const naEen = structuredClone(db.tables.events)
    const tweede = await runUpdate('m1', MATCH_FIELDS)
    expect(tweede).toEqual(eerste)
    expect(db.tables.events).toEqual(naEen)
    expect(db.writes.filter((w) => w.op === 'insert' || w.op === 'delete')).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════════
// Edge cases uit de story
// ════════════════════════════════════════════════════════════════════════
describe('Edge — datumwijziging over een seizoensgrens of van verleden naar toekomst', () => {
  it('Edge — wedstrijd van vorig seizoen (juni) naar de toekomst (oktober): telt mee op de nieuwe datum in agenda en dashboard, niet meer op de oude', async () => {
    const tables = baseTables()
    tables.events = [...tables.events, matchRow({ id: 'juni', date: '2026-06-20', opponent: 'FC Juni' })]
    const db = asOwner({}, tables)

    const voor = render(<DictProvider dict={nl}>{await EventsPage()}</DictProvider>)
    expect(screen.queryByText(/FC Juni/)).toBeNull() // staat in juni, agenda toont oktober
    voor.unmount()

    expect((await runUpdate('juni', { ...MATCH_FIELDS, opponent: 'FC Juni', date: '2026-10-09' })).kind).toBe('redirect')
    expect(eventById(db, 'juni').date).toBe('2026-10-09')

    const agenda = render(<DictProvider dict={nl}>{await EventsPage()}</DictProvider>)
    expect(screen.getAllByText(/FC Juni/).length).toBeGreaterThan(0)
    const rij = agenda.container.querySelector('a[href="/events/juni"] .text-\\[11px\\]') as HTMLElement
    expect(rij.textContent).toMatch(/\b9\b/) // 9 oktober; de oude datum (20 juni) staat niet in de oktober-agenda
    agenda.unmount()

    render(<DictProvider dict={nl}>{await DashboardPage()}</DictProvider>)
    // De wedstrijd is nu de eerstvolgende activiteit: het "volgende wedstrijd"-label (hero en/of tegel) staat in een link naar FC Juni.
    const metJuni = screen.getAllByText(nl.home.nextMatch).filter((el) => el.closest('a')?.textContent?.includes('FC Juni'))
    expect(metJuni.length).toBeGreaterThan(0)
    expect(metJuni[0].closest('a')).toHaveAttribute('href', '/events/juni')
  })

  it('Edge — van de toekomst naar het verleden: de wedstrijd verdwijnt uit "volgende wedstrijd" op het dashboard', async () => {
    asOwner()
    await runUpdate('m1', { ...MATCH_FIELDS, date: '2026-06-20' })
    const { container } = render(<DictProvider dict={nl}>{await DashboardPage()}</DictProvider>)
    const label = screen.getByText(nl.home.nextMatch)
    const tegel = label.closest('a') as HTMLElement
    expect(tegel).not.toHaveTextContent(/FC Nieuw/)
    expect(container.querySelector('a[href="/events/m1"]')).toBeNull()
  })
})

describe('Edge — activiteit zonder gekoppelde data (net aangemaakt) bewerken', () => {
  it('Edge — net aangemaakte training (echte createEvent, geen spelers): bewerken werkt zonder bijzonderheden', async () => {
    const db = asOwner({}, { ...baseTables(), events: [], players: [], attendance: [] })
    await expect(createEvent(fd({ type: 'training', date: '2026-11-03', time: '18:00', trainingstype: 'vct' }))).rejects.toThrow('__redirect__:')
    const nieuw = db.tables.events[0]
    expect(db.tables.attendance).toEqual([])

    const { container, unmount } = await renderEdit(nieuw.id as string)
    expect(field(container, 'date')).toHaveValue('2026-11-03')
    expect(field(container, 'location')).toHaveValue('')
    setField(container, 'location', 'Nieuw veld')
    await submitForm(container)
    expect(screen.queryByRole('alert')).toBeNull()
    unmount()
    expect(eventById(db, nieuw.id as string)).toMatchObject({ location: 'Nieuw veld', trainingstype: 'vct', type: 'training' })
    expect(db.tables.attendance).toEqual([])
  })

  it('Edge — net aangemaakte wedstrijd (echte createEvent): bewerken werkt, uitslag blijft leeg', async () => {
    const db = asOwner({}, { ...baseTables(), events: [], players: [], attendance: [] })
    await expect(createEvent(fd({
      type: 'match', date: '2026-11-08', time: '10:00', opponent: 'Nieuw FC', match_type: 'league', home_away: 'home',
    }))).rejects.toThrow('__redirect__:')
    const nieuw = db.tables.events[0]
    const { container } = await renderEdit(nieuw.id as string)
    setField(container, 'opponent', 'Nieuw FC 2')
    await submitForm(container)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(eventById(db, nieuw.id as string)).toMatchObject({ opponent: 'Nieuw FC 2', type: 'match' })
  })
})

describe('Edge / B9 — gelijktijdig bewerken: de laatste opslag wint; zonder conflictdetectie', () => {
  it('B9 — twee bewerksessies met dezelfde beginstand: de tweede opslag overschrijft de eerste zonder fout of waarschuwing', async () => {
    const db = asOwner()
    const a = await renderEdit('e1')
    const formA = a.container
    a.unmount()
    const b = await renderEdit('e1')
    const formB = b.container

    setField(formB, 'location', 'Veld van B')
    await submitForm(formB)
    expect(eventById(db, 'e1').location).toBe('Veld van B')
    b.unmount()

    // Sessie A (verouderde stand, nog "Veld 1") slaat daarna op.
    const opnieuwA = render(<DictProvider dict={nl}><EditEventForm event={{
      id: 'e1', type: 'training', date: '2026-10-14', time: '18:30', location: 'Veld 1', notes: 'Pasoefening',
      opponent: '', matchType: null, homeAway: null,
    }} /></DictProvider>)
    setField(opnieuwA.container, 'location', 'Veld van A')
    await submitForm(opnieuwA.container)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(eventById(db, 'e1').location).toBe('Veld van A')
    void formA
  })
})
