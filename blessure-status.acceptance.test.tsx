// Acceptatietests — Blessure als eigen aanwezigheidsstatus (deel A van de story
// "aanwezigheidsoverzicht + blessure als eigen status").
//
// Dekt van buitenaf: AC14–AC19 en besluiten 5, 7, 8, 11 en V3 (zie dekking per
// describe-blok). Deel B (het overzicht op /players) staat in
// aanwezigheidsoverzicht.acceptance.test.tsx.
//
// ── Testmethode ──
// Eén gedeelde, FILTERENDE in-memory Supabase-engine (zelfde precedent als
// afmeldperiode.acceptance.test.tsx) waar zowel de ECHTE server components
// (EventDetailPage, PlayerProfilePage, LineupPage, MatchSquadPage,
// TrainingPlanPage) als de ECHTE server actions (updateAttendance,
// markAllPresent, markInjured, markRecovered, markAbsentForPeriod,
// revokeAbsencePeriod, createEvent) tegenaan draaien. Een klik in de UI loopt
// dus echt door naar de actie en de database-mutatie; daarna wordt de pagina
// opnieuw gerenderd ("router.refresh()"), zoals een trainer het ervaart.
//
// Niet dekbaar in jsdom (zie rapport): de echte SQL (supabase/blessure-status.sql:
// CHECK-constraint, dataconversie besluit 12, de drie aangepaste RPC's) wordt
// hier NIET tegen Postgres gedraaid. De percentages in /inzichten, het profiel
// en het dashboard worden bewezen in inzichten-, spelersprofiel- en
// gastspelers.acceptance.test.tsx tegen een RPC-nabootsing van die SQL.
//
// "Vandaag" is vastgezet op 2026-10-15 (lokaal) met alleen `Date` gefaked, zodat
// echte timers (waitFor) blijven werken.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { randomUUID } from 'node:crypto'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

const routerRefresh = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
  notFound: vi.fn(() => { throw new Error('__notFound__') }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: routerRefresh }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import {
  markAbsentForPeriod, markAllPresent, revokeAbsencePeriod, updateAttendance,
} from '@/app/actions/attendance'
import { createEvent } from '@/app/actions/events'
import { markInjured, markRecovered } from '@/app/actions/players'
import EventDetailPage from '@/app/events/[id]/page'
import PlayerProfilePage from '@/app/players/[id]/page'
import LineupPage from '@/app/events/[id]/lineup/page'
import MatchSquadPage from '@/app/events/[id]/squad/page'
import TrainingPlanPage from '@/app/events/[id]/training-plan/page'

type Row = Record<string, unknown>

const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'
const NOW = new Date(2026, 9, 15, 12, 0, 0) // 15 okt 2026, lokaal
const VERLEDEN = '2026-10-01'
const VANDAAG = '2026-10-15'
const TOEKOMST = '2026-10-22'
const TOEKOMST2 = '2026-10-29'

// Profielroute eist een uuid (AC26 van het spelersprofiel).
const PX = '00000000-0000-4000-8000-0000000000a1' // de geblesseerde speler
const PY = '00000000-0000-4000-8000-0000000000a2'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ── team_members: teamcontext van elke page en server action ──
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

// ── In-memory, filterende Supabase-engine met echte mutaties ──
// upsert volgt ON CONFLICT DO UPDATE SET: alleen de meegegeven kolommen
// veranderen. `.is`/`.not(.., 'is', null)` behandelen een ontbrekende sleutel
// als NULL (de kolomdefault).
function makeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }))
  let seq = 0
  const nextCreatedAt = () => new Date(Date.UTC(2020, 0, 1) + seq++).toISOString()
  const table = (name: string): Row[] => (tables[name] ??= [])

  function from(name: string) {
    const rows = table(name)
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
    let limitN: number | null = null
    let mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
    let payload: Row | Row[] | null = null
    let onConflictCols: string[] | null = null

    const matches = (r: Row) => filters.every((f) => f(r))
    function execSelect(): Row[] {
      let out = rows.filter(matches)
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
    function resolve(): { data: unknown; error: null } {
      const items = (Array.isArray(payload) ? payload : [payload]) as Row[]
      if (mode === 'insert') {
        const inserted = items.map((item) => ({ id: randomUUID(), created_at: nextCreatedAt(), ...item }))
        rows.push(...inserted)
        return { data: inserted, error: null }
      }
      if (mode === 'upsert') {
        const result: Row[] = []
        for (const item of items) {
          const existing = onConflictCols
            ? rows.find((r) => onConflictCols!.every((c) => r[c] === item[c]))
            : undefined
          if (existing) { Object.assign(existing, item); result.push(existing) }
          else {
            const row: Row = { id: randomUUID(), created_at: nextCreatedAt(), ...item }
            rows.push(row); result.push(row)
          }
        }
        return { data: result, error: null }
      }
      if (mode === 'update') {
        const targets = rows.filter(matches)
        for (const t of targets) Object.assign(t, payload)
        return { data: targets, error: null }
      }
      if (mode === 'delete') {
        const targets = rows.filter(matches)
        for (const t of targets) rows.splice(rows.indexOf(t), 1)
        if (name === 'absence_periods') {
          for (const t of targets) for (const a of table('attendance')) if (a.absence_period_id === t.id) a.absence_period_id = null
        }
        return { data: targets, error: null }
      }
      return { data: execSelect(), error: null }
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return chain },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return chain },
      gt: (c: string, v: unknown) => { filters.push((r) => (r[c] as string | number) > (v as string | number)); return chain },
      gte: (c: string, v: unknown) => { filters.push((r) => (r[c] as string | number) >= (v as string | number)); return chain },
      lt: (c: string, v: unknown) => { filters.push((r) => (r[c] as string | number) < (v as string | number)); return chain },
      lte: (c: string, v: unknown) => { filters.push((r) => (r[c] as string | number) <= (v as string | number)); return chain },
      in: (c: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[c])); return chain },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return chain },
      not: (c: string, op: string, v: unknown) => {
        if (op !== 'is') throw new Error(`mock: .not(${c}, '${op}') niet nagebootst`)
        filters.push((r) => (r[c] ?? null) !== v)
        return chain
      },
      order: (c: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
        orders.push({ col: c, ascending: o.ascending ?? true, nullsFirst: o.nullsFirst ?? false }); return chain
      },
      limit: (n: number) => { limitN = n; return chain },
      insert: (p: Row | Row[]) => { mode = 'insert'; payload = p; return chain },
      upsert: (p: Row | Row[], o: { onConflict?: string } = {}) => {
        mode = 'upsert'; payload = p; onConflictCols = o.onConflict ? o.onConflict.split(',') : null; return chain
      },
      update: (p: Row) => { mode = 'update'; payload = p; return chain },
      delete: () => { mode = 'delete'; return chain },
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
  return { tables, from }
}
type Db = ReturnType<typeof makeDb>

function koppelDb(db: Db) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: TEAM } } }) },
    from: (t: string) => (t === 'team_members' ? teamMembersChain(TEAM) : db.from(t)),
    rpc: async () => ({ data: [], error: null }),
  } as unknown as Awaited<ReturnType<typeof createClient>>)
}

// ── Fabrieken ──
function playerRow(o: Row = {}): Row {
  return {
    id: randomUUID(), team_id: TEAM, name: 'Speler', position: 'Spits', secondary_positions: [],
    jersey_number: 9, active: true, injured: false, type: 'regular', rating: 5,
    created_at: '2024-01-01T00:00:00Z', ...o,
  }
}
function eventRow(o: Row = {}): Row {
  return {
    id: randomUUID(), team_id: TEAM, type: 'training', date: TOEKOMST, time: '19:00', location: null,
    match_type: null, opponent: null, home_away: null, gather_time: null, notes: null,
    doelstelling: null, goals_for: null, goals_against: null, created_at: '2026-01-01T00:00:00Z', ...o,
  }
}
function attRow(event_id: string, player_id: string, status: string, o: Row = {}): Row {
  return {
    id: randomUUID(), team_id: TEAM, event_id, player_id, status, absence_period_id: null,
    created_at: '2026-01-01T00:00:00Z', ...o,
  }
}
function setting(key: string, value: string): Row {
  return { id: randomUUID(), team_id: TEAM, key, value }
}
const att = (db: Db, eventId: string, playerId: string) =>
  db.tables.attendance?.find((a) => a.event_id === eventId && a.player_id === playerId)
const statusOf = (db: Db, eventId: string, playerId: string) => att(db, eventId, playerId)?.status

async function renderEvent(id: string) {
  const el = await EventDetailPage({ params: Promise.resolve({ id }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}
async function renderProfile(id: string) {
  const el = await PlayerProfilePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

// Aanwezigheidsrij van één speler op de eventpagina (TrainingAttendance).
function spelerRij(naam: string): HTMLElement {
  const row = screen.getByText(naam).parentElement?.parentElement
  if (!row || within(row).queryAllByRole('button').length !== 3) {
    throw new Error(`Aanwezigheidsrij voor "${naam}" niet gevonden`)
  }
  return row
}
const knop = (naam: string, label: string) => within(spelerRij(naam)).getByRole('button', { name: label })
// De stat-kaart ("Aanwezig" e.d.) is de DIV met het label; de waarde staat in de volgende sibling.
function statWaarde(label: string): string {
  const div = screen.getAllByText(label).find((el) => el.tagName === 'DIV')
  if (!div) throw new Error(`Stat-kaart "${label}" niet gevonden`)
  return div.nextElementSibling?.textContent ?? ''
}
function opkomstWaarde(): string {
  return screen.getByText(nl.event.turnout).nextElementSibling?.textContent ?? ''
}

// ═══════════════════════════════════════════════════════════════════════
// AC14 — bij aanwezigheid invullen kies je uit aanwezig, afwezig, geblesseerd,
// onbekend; blessure is geen aparte vlag naast de status
// ═══════════════════════════════════════════════════════════════════════
describe('AC14 — vier keuzes op de eventpagina, blessure is een status en geen vlag', () => {
  function basis(): Db {
    return makeDb({
      players: [playerRow({ id: PX, name: 'Xander Xavier' })],
      events: [eventRow({ id: 'e1', date: TOEKOMST })],
      attendance: [attRow('e1', PX, 'unknown')],
    })
  }

  it('toont per speler drie knoppen Aanwezig / Afwezig / Geblesseerd; geen enkele ingedrukt = Onbekend', async () => {
    koppelDb(basis())
    await renderEvent('e1')
    const rij = spelerRij('Xander Xavier')
    const namen = within(rij).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(namen).toEqual([nl.event.presentStat, nl.event.absentStat, nl.event.injuredStat])
    for (const b of within(rij).getAllByRole('button')) expect(b).toHaveAttribute('aria-pressed', 'false')
    expect(statWaarde(nl.event.unknownStat)).toBe('1')
  })

  it('alle vier de toestanden zijn bereikbaar en worden echt opgeslagen: Aanwezig -> Afwezig -> Geblesseerd -> (nogmaals) Onbekend', async () => {
    const db = basis()
    koppelDb(db)
    await renderEvent('e1')

    fireEvent.click(knop('Xander Xavier', nl.event.presentStat))
    await waitFor(() => expect(statusOf(db, 'e1', PX)).toBe('present'))

    fireEvent.click(knop('Xander Xavier', nl.event.absentStat))
    await waitFor(() => expect(statusOf(db, 'e1', PX)).toBe('absent'))

    fireEvent.click(knop('Xander Xavier', nl.event.injuredStat))
    await waitFor(() => expect(statusOf(db, 'e1', PX)).toBe('injured'))
    expect(knop('Xander Xavier', nl.event.injuredStat)).toHaveAttribute('aria-pressed', 'true')
    expect(knop('Xander Xavier', nl.event.absentStat)).toHaveAttribute('aria-pressed', 'false')

    // Nogmaals op de actieve knop = terug naar onbekend.
    fireEvent.click(knop('Xander Xavier', nl.event.injuredStat))
    await waitFor(() => expect(statusOf(db, 'e1', PX)).toBe('unknown'))
  })

  it('blessure is geen aparte vlag: de rij heeft geen injury_set-kolom en players.injured (V7) blijft ongemoeid', async () => {
    const db = basis()
    koppelDb(db)
    await renderEvent('e1')
    fireEvent.click(knop('Xander Xavier', nl.event.injuredStat))
    await waitFor(() => expect(statusOf(db, 'e1', PX)).toBe('injured'))

    expect(att(db, 'e1', PX)).not.toHaveProperty('injury_set')
    expect(db.tables.players.find((p) => p.id === PX)?.injured).toBe(false)
  })

  it('een ongeldige status wordt door de actie geweigerd; "injured" is geldig', async () => {
    const db = basis()
    koppelDb(db)
    await expect(updateAttendance('e1', PX, 'bogus' as never)).rejects.toThrow('Ongeldige status')
    expect(statusOf(db, 'e1', PX)).toBe('unknown')
    await updateAttendance('e1', PX, 'injured')
    expect(statusOf(db, 'e1', PX)).toBe('injured')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC19 (eventpagina) + besluit 7 — eigen telling "geblesseerd" naast aanwezig/afwezig
// ═══════════════════════════════════════════════════════════════════════
describe('AC19 / besluit 7 — eventpagina toont een eigen telling Geblesseerd', () => {
  it('Aanwezig 1, Afwezig 1, Geblesseerd 1, Onbekend 1; Opkomst telt geblesseerd als afwezig (1 van 3 = 33%); een geblesseerde gast telt nergens', async () => {
    const db = makeDb({
      players: [
        playerRow({ id: 'pa', name: 'Anna Aanwezig' }),
        playerRow({ id: 'pb', name: 'Bram Afwezig' }),
        playerRow({ id: PX, name: 'Carl Geblesseerd' }),
        playerRow({ id: 'pd', name: 'Daan Onbekend' }),
        playerRow({ id: 'pg', name: 'Gerrit Gast', type: 'guest' }),
      ],
      events: [eventRow({ id: 'e1' })],
      attendance: [
        attRow('e1', 'pa', 'present'), attRow('e1', 'pb', 'absent'), attRow('e1', PX, 'injured'),
        attRow('e1', 'pd', 'unknown'), attRow('e1', 'pg', 'injured'),
      ],
    })
    koppelDb(db)
    await renderEvent('e1')

    expect(statWaarde(nl.event.presentStat)).toBe('1')
    expect(statWaarde(nl.event.absentStat)).toBe('1')
    expect(statWaarde(nl.event.injuredStat)).toBe('1')
    expect(statWaarde(nl.event.unknownStat)).toBe('1')
    // Noemer: aanwezig 1 / (aanwezig 1 + afwezig 1 + geblesseerd 1) = 33%; onbekend telt niet mee.
    expect(opkomstWaarde()).toBe('33%')
    expect(knop('Carl Geblesseerd', nl.event.injuredStat)).toHaveAttribute('aria-pressed', 'true')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// V3 — "Iedereen aanwezig" laat een geblesseerde staan
// ═══════════════════════════════════════════════════════════════════════
describe('V3 — Iedereen aanwezig laat geblesseerd staan', () => {
  it('na de klik blijft de geblesseerde speler geblesseerd (scherm én database); afwezig en onbekend worden aanwezig', async () => {
    const db = makeDb({
      players: [
        playerRow({ id: PX, name: 'Xander Xavier' }),
        playerRow({ id: 'pb', name: 'Bram Afwezig' }),
        playerRow({ id: 'pc', name: 'Cor Onbekend' }),
      ],
      events: [eventRow({ id: 'e1' }), eventRow({ id: 'e2', date: TOEKOMST2 })],
      attendance: [
        attRow('e1', PX, 'injured'), attRow('e1', 'pb', 'absent'), attRow('e1', 'pc', 'unknown'),
        attRow('e2', 'pb', 'absent'), // ander event: ongemoeid
      ],
    })
    koppelDb(db)
    await renderEvent('e1')

    fireEvent.click(screen.getByRole('button', { name: nl.event.markAllPresent }))
    await waitFor(() => expect(statusOf(db, 'e1', 'pc')).toBe('present'))

    expect(statusOf(db, 'e1', PX)).toBe('injured')
    expect(statusOf(db, 'e1', 'pb')).toBe('present')
    expect(statusOf(db, 'e2', 'pb')).toBe('absent')
    // Optimistische UI klopt met de database.
    expect(knop('Xander Xavier', nl.event.injuredStat)).toHaveAttribute('aria-pressed', 'true')
    expect(knop('Xander Xavier', nl.event.presentStat)).toHaveAttribute('aria-pressed', 'false')
    expect(knop('Bram Afwezig', nl.event.presentStat)).toHaveAttribute('aria-pressed', 'true')
    expect(statWaarde(nl.event.injuredStat)).toBe('1')
  })

  it('de actie zelf (publieke API) slaat injured-rijen over, ook zonder UI', async () => {
    const db = makeDb({
      players: [playerRow({ id: PX }), playerRow({ id: 'pb' })],
      events: [eventRow({ id: 'e1' })],
      attendance: [attRow('e1', PX, 'injured'), attRow('e1', 'pb', 'injured', { team_id: OTHER_TEAM })],
    })
    koppelDb(db)
    await markAllPresent('e1')
    expect(statusOf(db, 'e1', PX)).toBe('injured')
    // Ander team blijft ongemoeid (tenant-isolatie).
    expect(db.tables.attendance.find((a) => a.team_id === OTHER_TEAM)?.status).toBe('injured')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC15 — speler als geblesseerd markeren: events vanaf vandaag -> geblesseerd
// ═══════════════════════════════════════════════════════════════════════
describe('AC15 — Blessure melden via het spelersprofiel', () => {
  function basis(): Db {
    return makeDb({
      players: [playerRow({ id: PX, name: 'Xander Xavier' }), playerRow({ id: PY, name: 'Yara Yilmaz' })],
      events: [
        eventRow({ id: 'e-verleden', date: VERLEDEN }),
        eventRow({ id: 'e-vandaag', date: VANDAAG }),
        eventRow({ id: 'e-toekomst', date: TOEKOMST }),
        eventRow({ id: 'e-meting', date: TOEKOMST, type: 'meting' }),
        eventRow({ id: 'e-ander-team', date: TOEKOMST, team_id: OTHER_TEAM }),
      ],
      attendance: [
        attRow('e-verleden', PX, 'present'),
        attRow('e-vandaag', PX, 'present'),
        attRow('e-toekomst', PX, 'absent'), // handmatig afwezig: wordt geblesseerd (V2)
        attRow('e-toekomst', PY, 'present'),
        attRow('e-ander-team', PX, 'present', { team_id: OTHER_TEAM }),
      ],
      settings: [setting('default_attendance', 'present')],
    })
  }

  it('klik op "Blessure melden": alle events vanaf vandaag (ook zonder bestaande rij) krijgen geblesseerd; verleden, meting, andere speler en ander team blijven ongemoeid', async () => {
    const db = basis()
    koppelDb(db)
    await renderProfile(PX)

    fireEvent.click(screen.getByRole('button', { name: nl.players.reportInjury }))
    await waitFor(() => expect(db.tables.players.find((p) => p.id === PX)?.injured).toBe(true))
    await waitFor(() => expect(statusOf(db, 'e-toekomst', PX)).toBe('injured'))

    expect(statusOf(db, 'e-vandaag', PX)).toBe('injured') // grens: vandaag telt mee
    expect(statusOf(db, 'e-verleden', PX)).toBe('present')
    expect(att(db, 'e-meting', PX)).toBeUndefined()
    expect(statusOf(db, 'e-toekomst', PY)).toBe('present')
    expect(db.tables.attendance.find((a) => a.team_id === OTHER_TEAM)?.status).toBe('present')
    expect(att(db, 'e-toekomst', PX)).not.toHaveProperty('injury_set')
  })

  it('een trainer ziet het daarna terug op de eventpagina: Geblesseerd ingedrukt en telling 1', async () => {
    const db = basis()
    koppelDb(db)
    await markInjured(PX)

    await renderEvent('e-toekomst')
    expect(knop('Xander Xavier', nl.event.injuredStat)).toHaveAttribute('aria-pressed', 'true')
    expect(statWaarde(nl.event.injuredStat)).toBe('1')
    expect(statWaarde(nl.event.absentStat)).toBe('0')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC16 — hersteld melden: alleen toekomstige (vanaf vandaag) events veranderen
// ═══════════════════════════════════════════════════════════════════════
describe('AC16 — Hersteld melden raakt het verleden niet', () => {
  it('klik op "Hersteld melden": events vanaf vandaag gaan terug naar de standaard (met afmeldperiode: afwezig); een geblesseerd verleden-event blijft geblesseerd', async () => {
    const db = makeDb({
      players: [playerRow({ id: PX, name: 'Xander Xavier', injured: true })],
      events: [
        eventRow({ id: 'e-verleden', date: VERLEDEN }),
        eventRow({ id: 'e-verleden2', date: '2026-09-20', type: 'match' }),
        eventRow({ id: 'e-vandaag', date: VANDAAG }),
        eventRow({ id: 'e-toekomst', date: TOEKOMST }),
        eventRow({ id: 'e-periode', date: TOEKOMST2 }),
      ],
      attendance: [
        attRow('e-verleden', PX, 'injured'),
        attRow('e-verleden2', PX, 'injured'),
        attRow('e-vandaag', PX, 'injured'),
        attRow('e-toekomst', PX, 'injured'),
        attRow('e-periode', PX, 'injured', { absence_period_id: 'periode-1' }),
      ],
      absence_periods: [{ id: 'periode-1', team_id: TEAM, player_id: PX, from_date: TOEKOMST2, to_date: TOEKOMST2, created_at: '2026-01-01T00:00:00Z' }],
      settings: [setting('default_attendance', 'present')],
    })
    koppelDb(db)
    await renderProfile(PX)

    fireEvent.click(screen.getByRole('button', { name: nl.players.reportRecovered }))
    await waitFor(() => expect(db.tables.players.find((p) => p.id === PX)?.injured).toBe(false))
    await waitFor(() => expect(statusOf(db, 'e-toekomst', PX)).toBe('present'))

    expect(statusOf(db, 'e-vandaag', PX)).toBe('present')
    expect(statusOf(db, 'e-periode', PX)).toBe('absent') // periode dekt de datum nog
    expect(att(db, 'e-periode', PX)?.absence_period_id).toBe('periode-1')
    // Verleden blijft ongewijzigd.
    expect(statusOf(db, 'e-verleden', PX)).toBe('injured')
    expect(statusOf(db, 'e-verleden2', PX)).toBe('injured')
  })

  it('op de eventpagina van een verleden-event staat de speler na herstel nog steeds als Geblesseerd', async () => {
    const db = makeDb({
      players: [playerRow({ id: PX, name: 'Xander Xavier', injured: true })],
      events: [eventRow({ id: 'e-verleden', date: VERLEDEN }), eventRow({ id: 'e-toekomst', date: TOEKOMST })],
      attendance: [attRow('e-verleden', PX, 'injured'), attRow('e-toekomst', PX, 'injured')],
      settings: [setting('default_attendance', 'unknown')],
    })
    koppelDb(db)
    await markRecovered(PX)

    await renderEvent('e-verleden')
    expect(knop('Xander Xavier', nl.event.injuredStat)).toHaveAttribute('aria-pressed', 'true')
    expect(statWaarde(nl.event.injuredStat)).toBe('1')
    cleanup()

    await renderEvent('e-toekomst')
    expect(knop('Xander Xavier', nl.event.injuredStat)).toHaveAttribute('aria-pressed', 'false')
    expect(statWaarde(nl.event.injuredStat)).toBe('0')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC18 / besluit 8 — nieuw event voor een nu geblesseerde speler
// ═══════════════════════════════════════════════════════════════════════
describe('AC18 / besluit 8 — nieuw event: geblesseerd alleen vanaf vandaag', () => {
  async function maakTraining(date: string): Promise<string> {
    const fd = new FormData()
    fd.set('type', 'training'); fd.set('date', date); fd.set('time', '19:00')
    try {
      await createEvent(fd)
    } catch (e) {
      const m = (e as Error).message.match(/^__redirect__:\/events\/(.+)$/)
      if (m) return m[1]
      throw e
    }
    throw new Error('verwacht een redirect na createEvent')
  }
  const basis = () => makeDb({
    players: [playerRow({ id: PX, injured: true }), playerRow({ id: PY })],
    settings: [setting('default_attendance', 'present')],
  })

  it('event in de toekomst: geblesseerd (de fitte teamgenoot krijgt de standaard)', async () => {
    const db = basis(); koppelDb(db)
    const id = await maakTraining(TOEKOMST)
    expect(statusOf(db, id, PX)).toBe('injured')
    expect(statusOf(db, id, PY)).toBe('present')
  })

  it('event op vandaag: geblesseerd (grens is inclusief)', async () => {
    const db = basis(); koppelDb(db)
    const id = await maakTraining(VANDAAG)
    expect(statusOf(db, id, PX)).toBe('injured')
  })

  it('event in het verleden: GEEN geblesseerd, de speler krijgt de standaardstatus', async () => {
    const db = basis(); koppelDb(db)
    const id = await maakTraining(VERLEDEN)
    expect(statusOf(db, id, PX)).toBe('present')
    expect(statusOf(db, id, PY)).toBe('present')
  })

  it('event in het verleden met standaard "onbekend": nog steeds onbekend, niet geblesseerd', async () => {
    const db = makeDb({ players: [playerRow({ id: PX, injured: true })], settings: [setting('default_attendance', 'unknown')] })
    koppelDb(db)
    const id = await maakTraining('2026-09-01')
    expect(statusOf(db, id, PX)).toBe('unknown')
  })

  it('een nieuw event in het verleden telt op de eventpagina niet als Geblesseerd', async () => {
    const db = basis(); koppelDb(db)
    const id = await maakTraining(VERLEDEN)
    await renderEvent(id)
    expect(statWaarde(nl.event.injuredStat)).toBe('0')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Besluit 11 — afmeldperiode en blessure op dezelfde dag: geblesseerd wint
// ═══════════════════════════════════════════════════════════════════════
describe('Besluit 11 — afmeldperiode + blessure: geblesseerd wint', () => {
  const basis = () => makeDb({
    players: [playerRow({ id: PX })],
    events: [eventRow({ id: 'e1', date: TOEKOMST }), eventRow({ id: 'e2', date: TOEKOMST2 })],
    settings: [setting('default_attendance', 'present')],
  })

  it('eerst afmeldperiode, dan blessure: rij is geblesseerd en houdt de herkomst; na herstel valt hij terug op afwezig (de periode dekt de datum nog)', async () => {
    const db = basis(); koppelDb(db)
    const { periodId } = await markAbsentForPeriod(PX, TOEKOMST, TOEKOMST)
    expect(statusOf(db, 'e1', PX)).toBe('absent')

    await markInjured(PX)
    expect(att(db, 'e1', PX)).toMatchObject({ status: 'injured', absence_period_id: periodId })

    await markRecovered(PX)
    expect(att(db, 'e1', PX)).toMatchObject({ status: 'absent', absence_period_id: periodId })
    expect(statusOf(db, 'e2', PX)).toBe('present') // buiten de periode: standaard
  })

  it('eerst blessure, dan afmeldperiode over dezelfde dag: de rij blijft geblesseerd (alleen de herkomst wordt gezet)', async () => {
    const db = basis(); koppelDb(db)
    await markInjured(PX)
    const { periodId } = await markAbsentForPeriod(PX, TOEKOMST, TOEKOMST)
    expect(att(db, 'e1', PX)).toMatchObject({ status: 'injured', absence_period_id: periodId })
    expect(statusOf(db, 'e2', PX)).toBe('injured') // buiten de periode: blessure
  })

  it('periode intrekken terwijl de speler geblesseerd is: status blijft geblesseerd, alleen de herkomst verdwijnt', async () => {
    const db = basis(); koppelDb(db)
    await markInjured(PX)
    const { periodId } = await markAbsentForPeriod(PX, TOEKOMST, TOEKOMST)
    await revokeAbsencePeriod(periodId)
    expect(att(db, 'e1', PX)).toMatchObject({ status: 'injured', absence_period_id: null })
  })

  it('op de eventpagina telt zo\'n rij als Geblesseerd en niet als Afwezig', async () => {
    const db = basis(); koppelDb(db)
    await markAbsentForPeriod(PX, TOEKOMST, TOEKOMST)
    await markInjured(PX)
    await renderEvent('e1')
    expect(statWaarde(nl.event.injuredStat)).toBe('1')
    expect(statWaarde(nl.event.absentStat)).toBe('0')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC17 / besluit 7 — geblesseerde speler niet in opstelling-, teamindeling-
// en wedstrijdselectie-pool (zoals afwezigen)
// ═══════════════════════════════════════════════════════════════════════
describe('AC17 — geblesseerde speler staat niet in de keuzepools', () => {
  const MATCH = 'm1'
  const spelers = () => [
    playerRow({ id: 'pa', name: 'Anna Aanwezig', position: 'Spits', jersey_number: 7 }),
    playerRow({ id: PX, name: 'Xander Xavier', position: 'Spits', jersey_number: 8, injured: true }),
    playerRow({ id: 'pb', name: 'Bram Afwezig', position: 'Spits', jersey_number: 10 }),
  ]
  const matchDb = (extra: Record<string, Row[]> = {}) => makeDb({
    players: spelers(),
    events: [eventRow({ id: MATCH, type: 'match', match_type: 'league', opponent: 'FC Rivalen', home_away: 'home', date: TOEKOMST })],
    attendance: [attRow(MATCH, 'pa', 'present'), attRow(MATCH, PX, 'injured'), attRow(MATCH, 'pb', 'absent')],
    ...extra,
  })

  it('opstelling: geblesseerde speler is niet kiesbaar in de spelerspopup en staat onder "Afwezig"; de aanwezige speler wel kiesbaar', async () => {
    koppelDb(matchDb())
    const el = await LineupPage({ params: Promise.resolve({ id: MATCH }) })
    render(<DictProvider dict={nl}>{el}</DictProvider>)

    fireEvent.click(screen.getByText('CM'))
    const popup = screen.getAllByTestId('popup-speler').map((b) => b.textContent ?? '')
    expect(popup.some((t) => t.includes('Anna'))).toBe(true)
    expect(popup.some((t) => t.includes('Xander'))).toBe(false)
    expect(popup.some((t) => t.includes('Bram'))).toBe(false)

    // Geblesseerden blijven onder "Afwezig" (besluit V4: geen eigen kaart).
    const afwezig = screen.getByText(nl.event.absentStat).closest('.surface-card') as HTMLElement
    expect(within(afwezig).getByText('Xander')).toBeInTheDocument()
    expect(within(afwezig).getByText('Bram')).toBeInTheDocument()
  })

  it('wedstrijdselectie: een geblesseerde speler staat niet in de lijst; een aanwezige speler wel', async () => {
    koppelDb(matchDb())
    const el = await MatchSquadPage({ params: Promise.resolve({ id: MATCH }) })
    render(<DictProvider dict={nl}>{el}</DictProvider>)

    expect(screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Anna Aanwezig` })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `${nl.matchSquad.toggleLabel}: Xander Xavier` })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `${nl.matchSquad.toggleLabel}: Bram Afwezig` })).not.toBeInTheDocument()
  })

  it('wedstrijdselectie: een al geselecteerde speler die daarna geblesseerd raakt blijft zichtbaar met het label "niet aanwezig"', async () => {
    koppelDb(matchDb({ match_squad: [{ id: 's1', team_id: TEAM, event_id: MATCH, player_id: PX }] }))
    const el = await MatchSquadPage({ params: Promise.resolve({ id: MATCH }) })
    render(<DictProvider dict={nl}>{el}</DictProvider>)

    const toggle = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Xander Xavier` })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(within(toggle.parentElement as HTMLElement).getByText(`(${nl.matchSquad.notPresentLabel})`)).toBeInTheDocument()
  })

  describe('trainingsplan (teamindeling + aanwezigheidsoverzicht)', () => {
    const TRAIN = 't1'
    const koppeling = (): Row => ({
      id: 'k1', team_id: TEAM, event_id: TRAIN, oefening_id: 'o1', volgorde: 0, stap_override: null,
      genest_in: null, spelerindeling: [], aantallen_override: null, created_at: '2026-01-01T00:00:00Z',
      oefeningen: {
        id: 'o1', team_id: TEAM, naam: 'Positiespel', beschrijving: null, categorie: 'partijen_klein',
        duur_min: null, breedte_m: null, lengte_m: null, orientatie: 'vrij', veldzone: null,
        teams: [{ grootte: 2, formaties: [] }, { grootte: 2, formaties: [] }],
        aantal_neutralen: 0, diagram: null, created_at: '2024-01-01T00:00:00Z',
      },
    })
    const trainDb = () => makeDb({
      players: [
        playerRow({ id: 'pa', name: 'Anna Aanwezig', jersey_number: 7 }),
        playerRow({ id: 'pc', name: 'Cees Aanwezig', jersey_number: 11 }),
        playerRow({ id: PX, name: 'Xander Xavier', jersey_number: 8, injured: true }),
        playerRow({ id: 'pb', name: 'Bram Afwezig', jersey_number: 10 }),
      ],
      events: [eventRow({ id: TRAIN, type: 'training', date: TOEKOMST })],
      attendance: [
        attRow(TRAIN, 'pa', 'present'), attRow(TRAIN, 'pc', 'present'),
        attRow(TRAIN, PX, 'injured'), attRow(TRAIN, 'pb', 'absent'),
      ],
      training_oefeningen: [koppeling()],
    })

    async function renderPlan() {
      koppelDb(trainDb())
      const el = await TrainingPlanPage({ params: Promise.resolve({ id: TRAIN }) })
      return render(<DictProvider dict={nl}>{el}</DictProvider>)
    }

    it('teamindeling: de pool "Nog in te delen" bevat alleen aanwezige spelers, niet de geblesseerde of afwezige', async () => {
      await renderPlan()
      const pool = screen.getByText(nl.teamIndeling.poolLabel).parentElement as HTMLElement
      const namen = within(pool).getAllByRole('button').map((b) => b.textContent ?? '')
      expect(namen.some((n) => n.includes('Anna'))).toBe(true)
      expect(namen.some((n) => n.includes('Cees'))).toBe(true)
      expect(namen.some((n) => n.includes('Xander'))).toBe(false)
      expect(namen.some((n) => n.includes('Bram'))).toBe(false)
    })

    it('aanwezigheidsoverzicht (scherm): eigen blok "Geblesseerd (1)" met de speler; teller = aanwezig/(aanwezig+afwezig+geblesseerd)', async () => {
      const { container } = await renderPlan()
      const scherm = container.querySelector('.glass-card .print\\:hidden') as HTMLElement
      expect(within(scherm).getByText('2/4')).toBeInTheDocument()
      const kop = within(scherm).getByText(`${nl.event.injuredStat} (1)`)
      const blok = kop.parentElement as HTMLElement
      expect(within(blok).getByText('Xander')).toBeInTheDocument()
      const afwezigBlok = within(scherm).getByText(`${nl.event.absentStat} (1)`).parentElement as HTMLElement
      expect(within(afwezigBlok).queryByText('Xander')).not.toBeInTheDocument()
      expect(within(afwezigBlok).getByText('Bram')).toBeInTheDocument()
    })

    it('aanwezigheidsoverzicht (afdruk): derde lijst "Geblesseerd (1)" met de speler, niet onder Afwezig', async () => {
      const { container } = await renderPlan()
      const print = container.querySelector('.glass-card .hidden.print\\:block') as HTMLElement
      const injuredKop = within(print).getByText(`${nl.event.injuredStat} (1)`)
      expect(within(injuredKop.nextElementSibling as HTMLElement).getByText((_c, el) => el?.tagName === 'LI' && (el.textContent ?? '').includes('Xander Xavier'))).toBeInTheDocument()
      const absentKop = within(print).getByText(`${nl.event.absentStat} (1)`)
      const absentLijst = absentKop.nextElementSibling as HTMLElement
      expect(absentLijst.textContent).toContain('Bram Afwezig')
      expect(absentLijst.textContent).not.toContain('Xander')
    })
  })
})
