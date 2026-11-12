// Acceptatietests — F1 "Herhalende trainingen" — server-actions/publieke API.
//
// Dit bestand test de ECHTE, geëxporteerde server actions uit
// app/actions/events-bulk.ts (createRecurringTrainings, getExistingTrainingDates,
// getNewTrainingDefaults) tegen een tabel-engine die .eq/.in/.gte/.lte/.order
// (incl. nullsFirst)/.limit/.select(kolommen) ÉCHT toepast (geheugen.md: de
// stub-smaak in app/actions/*.test.ts negeert filters en bewijst dus niets over
// tenant of sortering; brief R5). Opzet vergelijkbaar met
// wedstrijden-bulk-toevoegen-serveracties.acceptance.test.ts, maar met een
// filterende engine in plaats van een vaste-resultaten-dubbel.
//
// Criteria-codes (AC1..AC21) verwijzen naar de goedgekeurde story
// (f1-02-story.md). UI-criteria (AC1-3, 5-7, 16) staan in
// herhalende-trainingen.acceptance.test.tsx; de rechtencase voor een assistent
// zonder agenda-recht staat in assistent-fase1-fundament.acceptance.test.ts.
//
// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// Sentinel 'unknown' (afwijkend van de interne fallback 'present'): bewijst dat
// de default-status uit dezelfde gedeelde helper komt als bij het enkele event.
vi.mock('@/app/actions/settings', () => ({ getDefaultAttendance: vi.fn(async () => 'unknown') }))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import {
  createRecurringTrainings,
  getExistingTrainingDates,
  getNewTrainingDefaults,
} from '@/app/actions/events-bulk'

// ────────────────────────────────────────────────
// Tabel-engine
// ────────────────────────────────────────────────

type Row = Record<string, unknown>
type Call = { table: string; op: 'select' | 'insert' }
type Fail = { table: string; op: 'select' | 'insert'; message?: string }

let idTeller = 0

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  return (a as string | number) < (b as string | number) ? -1 : 1
}

function makeSupabase(opts: {
  user?: { id: string } | null
  members?: Row[]
  tables?: Record<string, Row[]>
  fail?: Fail[]
}) {
  const user = opts.user === undefined ? null : opts.user
  const calls: Call[] = []
  const store: Record<string, Row[]> = { team_members: opts.members ?? [], settings: [], ...(opts.tables ?? {}) }

  function table(name: string) {
    if (!store[name]) store[name] = []
    const rows = store[name]
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
    let limitN: number | null = null
    let cols: string[] | null = null
    let op: 'select' | 'insert' = 'select'
    let inserted: Row[] = []
    const fail = (o: 'select' | 'insert') => (opts.fail ?? []).find((f) => f.table === name && f.op === o)

    const project = (r: Row): Row => {
      if (!cols) return { ...r }
      const out: Row = {}
      for (const c of cols) out[c] = r[c]
      return out
    }

    const c: Record<string, unknown> = {}
    c.select = (columns?: string) => {
      if (typeof columns === 'string' && columns.trim() !== '*') cols = columns.split(',').map((s) => s.trim())
      return c
    }
    c.eq = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return c }
    c.neq = (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return c }
    c.in = (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return c }
    c.gte = (col: string, val: unknown) => { filters.push((r) => r[col] != null && compare(r[col], val) >= 0); return c }
    c.lte = (col: string, val: unknown) => { filters.push((r) => r[col] != null && compare(r[col], val) <= 0); return c }
    c.gt = (col: string, val: unknown) => { filters.push((r) => r[col] != null && compare(r[col], val) > 0); return c }
    c.lt = (col: string, val: unknown) => { filters.push((r) => r[col] != null && compare(r[col], val) < 0); return c }
    // PostgREST-semantiek: nullsFirst default = true bij DESC, false bij ASC.
    c.order = (col: string, o?: { ascending?: boolean; nullsFirst?: boolean }) => {
      const ascending = o?.ascending !== false
      orders.push({ col, ascending, nullsFirst: o?.nullsFirst ?? !ascending })
      return c
    }
    c.limit = (n: number) => { limitN = n; return c }
    c.insert = (payload: Row | Row[]) => {
      op = 'insert'
      if (fail('insert')) return c
      const items = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
        id: `gen-${name}-${idTeller++}`,
        ...p,
      }))
      for (const item of items) rows.push(item)
      inserted = items
      return c
    }
    ;(c as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      calls.push({ table: name, op })
      const f = fail(op)
      if (f) {
        return Promise.resolve({ data: null, error: { message: f.message ?? 'db kapot', code: 'XX000' } }).then(resolve, reject)
      }
      if (op === 'insert') return Promise.resolve({ data: inserted.map(project), error: null }).then(resolve, reject)
      let out = rows.filter((r) => filters.every((fn) => fn(r)))
      if (orders.length > 0) {
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const av = a[o.col]
            const bv = b[o.col]
            const an = av === null || av === undefined
            const bn = bv === null || bv === undefined
            if (an && bn) continue
            if (an) return o.nullsFirst ? -1 : 1
            if (bn) return o.nullsFirst ? 1 : -1
            const cmp = compare(av, bv)
            if (cmp !== 0) return o.ascending ? cmp : -cmp
          }
          return 0
        })
      }
      if (limitN !== null) out = out.slice(0, limitN)
      return Promise.resolve({ data: out.map(project), error: null }).then(resolve, reject)
    }
    return c
  }

  const supabase = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) => table(t),
  }
  return { supabase, calls, store }
}

function gebruikMock(m: { supabase: unknown }) {
  vi.mocked(createClient).mockResolvedValue(m.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

const TEAM_A = '11111111-1111-4111-8111-111111111111'
const TEAM_B = '22222222-2222-4222-8222-222222222222'

function owner(teamId: string): Row {
  return { team_id: teamId, user_id: teamId, rol: 'owner' }
}

// Standaardwereld: ingelogd als hoofdtrainer van team A; team B bestaat ernaast.
function wereld(tables: Record<string, Row[]> = {}, fail: Fail[] = []) {
  const m = makeSupabase({
    user: { id: TEAM_A },
    members: [owner(TEAM_A)],
    tables,
    fail,
  })
  gebruikMock(m)
  return m
}

function recForm(over: Record<string, string | null> = {}): FormData {
  const fd = new FormData()
  const base: Record<string, string> = {
    date: '2026-11-02', // maandag
    time: '19:00',
    location: 'Veld 2',
    notes: 'Neem bidon mee',
    trainingstype: 'teamtactisch',
    repeat_until: '2026-11-29', // zondag
    repeat_days: '2,4', // di + do
  }
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) fd.set(k, v)
  return fd
}

const writes = (m: ReturnType<typeof makeSupabase>, table: string) =>
  m.calls.filter((c) => c.table === table && c.op === 'insert')

beforeEach(() => {
  vi.clearAllMocks()
  idTeller = 0
})

// ────────────────────────────────────────────────
// AC4 / AC8 — happy path
// ────────────────────────────────────────────────

describe('createRecurringTrainings — AC4/AC8 (reeks aanmaken)', () => {
  it('AC4: di+do van 2026-11-02 t/m 2026-11-29 maakt 8 trainingen met dezelfde tijd, locatie, trainingstype en notities; AC8: resultaat created=8, skipped=0', async () => {
    const m = wereld({ events: [], players: [] })
    const res = await createRecurringTrainings(recForm())
    expect(res).toEqual({ ok: true, created: 8, skipped: 0, attendanceFailed: false })

    const events = m.store.events
    expect(events.map((e) => e.date)).toEqual([
      '2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12',
      '2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26',
    ])
    for (const e of events) {
      expect(e).toMatchObject({
        type: 'training', time: '19:00', location: 'Veld 2', notes: 'Neem bidon mee',
        trainingstype: 'teamtactisch', team_id: TEAM_A,
      })
    }
    // Eén multi-row insert (alles-of-niets), geen 8 losse.
    expect(writes(m, 'events')).toHaveLength(1)
    expect(revalidatePath).toHaveBeenCalledWith('/events')
  })

  it('AC4: einddatum is inclusief; eind = start op een gekozen weekdag geeft precies één training', async () => {
    const m = wereld({ events: [], players: [] })
    // 2026-11-03 is een dinsdag.
    const res = await createRecurringTrainings(recForm({ date: '2026-11-03', repeat_until: '2026-11-03', repeat_days: '2' }))
    expect(res).toEqual({ ok: true, created: 1, skipped: 0, attendanceFailed: false })
    expect(m.store.events.map((e) => e.date)).toEqual(['2026-11-03'])
  })

  it('AC4/OV3: startdatum op een niet-gekozen weekdag → de reeks begint op de eerste gekozen weekdag erna', async () => {
    const m = wereld({ events: [], players: [] })
    // 2026-11-04 = woensdag, alleen dinsdag gekozen → eerste = 2026-11-10.
    const res = await createRecurringTrainings(recForm({ date: '2026-11-04', repeat_until: '2026-11-17', repeat_days: '2' }))
    expect(res).toMatchObject({ ok: true, created: 2 })
    expect(m.store.events.map((e) => e.date)).toEqual(['2026-11-10', '2026-11-17'])
  })

  it('OV3b: een startdatum in het verleden is toegestaan', async () => {
    const m = wereld({ events: [], players: [] })
    const res = await createRecurringTrainings(recForm({ date: '2020-01-06', repeat_until: '2020-01-20', repeat_days: '1' }))
    expect(res).toMatchObject({ ok: true, created: 3 })
    expect(m.store.events.map((e) => e.date)).toEqual(['2020-01-06', '2020-01-13', '2020-01-20'])
  })

  it('AC4: ontbrekend trainingstype wordt vct; lege tijd/locatie/notities worden null', async () => {
    const m = wereld({ events: [], players: [] })
    await createRecurringTrainings(recForm({ trainingstype: null, time: '', location: '', notes: '', repeat_until: '2026-11-03', date: '2026-11-03', repeat_days: '2' }))
    expect(m.store.events[0]).toMatchObject({ trainingstype: 'vct', time: null, location: null, notes: null })
  })

  it('AC8 (edge): bereik zonder één gekozen weekdag erin → ok, niets aangemaakt, geen insert', async () => {
    const m = wereld({ events: [], players: [] })
    // wo 4 t/m ma 9 nov, alleen dinsdag gekozen → geen datum.
    const res = await createRecurringTrainings(recForm({ date: '2026-11-04', repeat_until: '2026-11-09', repeat_days: '2' }))
    expect(res).toEqual({ ok: true, created: 0, skipped: 0, attendanceFailed: false })
    expect(writes(m, 'events')).toHaveLength(0)
  })

  it('edge: team zonder spelers → geen fout, geen attendance-insert, attendanceFailed=false', async () => {
    const m = wereld({ events: [], players: [], absence_periods: [] })
    const res = await createRecurringTrainings(recForm())
    expect(res).toMatchObject({ ok: true, created: 8, attendanceFailed: false })
    expect(writes(m, 'attendance')).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────
// AC9 — aanwezigheidsrijen per eventdatum
// ────────────────────────────────────────────────

describe('createRecurringTrainings — AC9 (aanwezigheid per eventdatum: blessure > gast > afmeldperiode > default)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-06T12:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('elke training krijgt per actieve eigen speler één rij; status per datum volgens de prioriteit', async () => {
    const m = wereld({
      events: [],
      players: [
        { id: 'p-normaal', team_id: TEAM_A, active: true, injured: false, type: 'player' },
        { id: 'p-geblesseerd', team_id: TEAM_A, active: true, injured: true, type: 'player' },
        { id: 'p-gast', team_id: TEAM_A, active: true, injured: false, type: 'guest' },
        { id: 'p-periode', team_id: TEAM_A, active: true, injured: false, type: 'player' },
        { id: 'p-inactief', team_id: TEAM_A, active: false, injured: false, type: 'player' },
        { id: 'p-ander-team', team_id: TEAM_B, active: true, injured: false, type: 'player' },
      ],
      absence_periods: [
        // Dekt alleen 2026-11-10 (niet 2026-11-03).
        { id: 'per-1', team_id: TEAM_A, player_id: 'p-periode', from_date: '2026-11-08', to_date: '2026-11-11', created_at: '2026-11-01T00:00:00Z' },
        // Periode van een speler uit ander team: mag nooit meetellen.
        { id: 'per-vreemd', team_id: TEAM_B, player_id: 'p-normaal', from_date: '2026-11-01', to_date: '2026-11-30', created_at: '2026-11-01T00:00:00Z' },
      ],
    })
    // Alleen di 3 en di 10 november.
    const res = await createRecurringTrainings(recForm({ repeat_days: '2', repeat_until: '2026-11-10' }))
    expect(res).toMatchObject({ ok: true, created: 2, attendanceFailed: false })

    const ev = Object.fromEntries(m.store.events.map((e) => [e.date as string, e.id as string]))
    const rows = m.store.attendance
    // 4 actieve eigen spelers × 2 trainingen; inactief en andere team: geen rij.
    expect(rows).toHaveLength(8)
    expect(rows.some((r) => r.player_id === 'p-inactief' || r.player_id === 'p-ander-team')).toBe(false)
    expect(rows.every((r) => r.team_id === TEAM_A)).toBe(true)

    const rij = (date: string, speler: string) => rows.find((r) => r.event_id === ev[date] && r.player_id === speler)!
    // default (sentinel 'unknown')
    expect(rij('2026-11-03', 'p-normaal')).toMatchObject({ status: 'unknown', absence_period_id: null })
    expect(rij('2026-11-10', 'p-normaal')).toMatchObject({ status: 'unknown', absence_period_id: null })
    // blessure telt vanaf vandaag (2026-11-06): verleden-datum geen 'injured', toekomstige wel
    expect(rij('2026-11-03', 'p-geblesseerd').status).toBe('unknown')
    expect(rij('2026-11-10', 'p-geblesseerd').status).toBe('injured')
    // gast: afwezig
    expect(rij('2026-11-03', 'p-gast').status).toBe('absent')
    expect(rij('2026-11-10', 'p-gast').status).toBe('absent')
    // afmeldperiode: alleen de datum die de periode dekt
    expect(rij('2026-11-03', 'p-periode')).toMatchObject({ status: 'unknown', absence_period_id: null })
    expect(rij('2026-11-10', 'p-periode')).toMatchObject({ status: 'absent', absence_period_id: 'per-1' })
  })
})

// ────────────────────────────────────────────────
// AC17 — bestaande trainingen
// ────────────────────────────────────────────────

describe('createRecurringTrainings — AC17 (bestaande training op een datum → overslaan)', () => {
  it('deels bestaand: alleen de ontbrekende datums worden aangemaakt; telling created/skipped klopt; wedstrijd en ander team tellen niet als dubbel', async () => {
    const m = wereld({
      events: [
        { id: 'e-bestaand', team_id: TEAM_A, type: 'training', date: '2026-11-10' },
        // Trainingsschema-training (andere velden, geen trainingstype) telt ook als bestaand.
        { id: 'e-schema', team_id: TEAM_A, type: 'training', date: '2026-11-12', time: '18:00', trainingstype: null },
        { id: 'e-match', team_id: TEAM_A, type: 'match', date: '2026-11-03' },
        { id: 'e-ander-team', team_id: TEAM_B, type: 'training', date: '2026-11-05' },
      ],
      players: [],
    })
    const res = await createRecurringTrainings(recForm())
    expect(res).toEqual({ ok: true, created: 6, skipped: 2, attendanceFailed: false })

    const nieuw = m.store.events.filter((e) => String(e.id).startsWith('gen-')).map((e) => e.date)
    expect(nieuw).toEqual(['2026-11-03', '2026-11-05', '2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26'])
    // Bestaande trainingen niet aangeraakt, er is geen tweede op dezelfde datum.
    const teamATrainingen = m.store.events.filter((e) => e.team_id === TEAM_A && e.type === 'training')
    const datums = teamATrainingen.map((e) => e.date)
    expect(new Set(datums).size).toBe(datums.length)
  })

  it('alles bezet: created=0, skipped=aantal datums, geen insert (expliciet te melden in de UI)', async () => {
    const dates = ['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12', '2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26']
    const m = wereld({
      events: dates.map((date, i) => ({ id: `e${i}`, team_id: TEAM_A, type: 'training', date })),
      players: [{ id: 'p', team_id: TEAM_A, active: true, injured: false, type: 'player' }],
    })
    const res = await createRecurringTrainings(recForm())
    expect(res).toEqual({ ok: true, created: 0, skipped: 8, attendanceFailed: false })
    expect(writes(m, 'events')).toHaveLength(0)
    expect(writes(m, 'attendance')).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────
// AC10-AC13 — faalpaden zonder insert
// ────────────────────────────────────────────────

describe('createRecurringTrainings — AC10-AC13 (validatiefouten: niets aangemaakt)', () => {
  const cases: { naam: string; over: Record<string, string | null>; code: string }[] = [
    { naam: 'AC10: geen weekdag (leeg)', over: { repeat_days: '' }, code: 'no_weekdays' },
    { naam: 'AC10: weekdag-veld ontbreekt', over: { repeat_days: null }, code: 'no_weekdays' },
    { naam: 'AC10: alleen onzin-weekdagen (7, a)', over: { repeat_days: '7,a' }, code: 'no_weekdays' },
    { naam: 'AC11: einddatum vóór startdatum', over: { repeat_until: '2026-11-01' }, code: 'end_before_start' },
    { naam: 'AC11/AC6: einddatum ontbreekt (verplicht)', over: { repeat_until: null }, code: 'invalid_end_date' },
    { naam: 'AC12: einddatum geen kalenderdatum (2026-02-30)', over: { repeat_until: '2026-02-30' }, code: 'invalid_end_date' },
    { naam: 'AC12: ongeldige startdatum', over: { date: '2026-13-40' }, code: 'invalid_date' },
    { naam: 'AC12: lege startdatum', over: { date: '' }, code: 'invalid_date' },
    { naam: 'AC12: ongeldige tijd', over: { time: '25:99' }, code: 'invalid_time' },
    { naam: 'AC12: locatie van 201 tekens', over: { location: 'x'.repeat(201) }, code: 'location_too_long' },
    { naam: 'AC12: notities van 2001 tekens', over: { notes: 'x'.repeat(2001) }, code: 'notes_too_long' },
    { naam: 'AC12: ongeldig trainingstype', over: { trainingstype: 'hack' }, code: 'invalid_trainingstype' },
    { naam: 'AC12: lege trainingstype-string', over: { trainingstype: '' }, code: 'invalid_trainingstype' },
    { naam: 'AC13: reeks van 801 dagen', over: { date: '2026-01-01', repeat_until: '2028-03-11' }, code: 'too_long' },
  ]
  for (const c of cases) {
    it(`${c.naam} → { ok:false, error:'${c.code}' } en er wordt niets geschreven`, async () => {
      const m = wereld({ events: [], players: [{ id: 'p', team_id: TEAM_A, active: true, injured: false, type: 'player' }] })
      const res = await createRecurringTrainings(recForm(c.over))
      expect(res).toEqual({ ok: false, error: c.code })
      expect(writes(m, 'events')).toHaveLength(0)
      expect(writes(m, 'attendance')).toHaveLength(0)
      expect(m.store.events).toHaveLength(0)
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  }

  it('AC13 grens: een reeks van exact 800 dagen is wél toegestaan', async () => {
    const m = wereld({ events: [], players: [] })
    const res = await createRecurringTrainings(recForm({ date: '2026-01-01', repeat_until: '2028-03-10', repeat_days: '1' }))
    expect(res.ok).toBe(true)
    expect(m.store.events.length).toBeGreaterThan(100)
  })

  it('AC12 grens: locatie van exact 200 en notities van exact 2000 tekens worden niet afgekapt', async () => {
    const m = wereld({ events: [], players: [] })
    const res = await createRecurringTrainings(recForm({
      location: 'l'.repeat(200), notes: 'n'.repeat(2000), date: '2026-11-03', repeat_until: '2026-11-03', repeat_days: '2',
    }))
    expect(res).toMatchObject({ ok: true, created: 1 })
    expect((m.store.events[0].location as string).length).toBe(200)
    expect((m.store.events[0].notes as string).length).toBe(2000)
  })
})

// ────────────────────────────────────────────────
// AC14 / AC21 — niet ingelogd
// ────────────────────────────────────────────────

describe('createRecurringTrainings — AC14 (niet ingelogd)', () => {
  it('niet ingelogd → "Niet ingelogd", niets aangemaakt', async () => {
    const m = makeSupabase({ user: null, tables: { events: [] } })
    gebruikMock(m)
    await expect(createRecurringTrainings(recForm())).rejects.toThrow('Niet ingelogd')
    expect(writes(m, 'events')).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────
// AC15 / AC18 — serverfouten
// ────────────────────────────────────────────────

describe('createRecurringTrainings — AC15/AC18 (serverfout)', () => {
  it('AC15: mislukte insert → generieke melding, nooit de ruwe databasefout; niets in events', async () => {
    const m = wereld({ events: [], players: [] }, [{ table: 'events', op: 'insert', message: 'duplicate key value violates constraint "geheim_tabel_x"' }])
    const fout = await createRecurringTrainings(recForm()).catch((e: Error) => e)
    expect(fout).toBeInstanceOf(Error)
    expect((fout as Error).message).toBe(GENERIC_ERROR_MESSAGE)
    expect((fout as Error).message).not.toContain('geheim_tabel_x')
    expect(m.store.events).toHaveLength(0)
  })

  it('AC15: mislukte bestaande-check (select) → generieke melding, niets aangemaakt', async () => {
    const m = wereld({ events: [], players: [] }, [{ table: 'events', op: 'select', message: 'interne fout 42' }])
    const fout = await createRecurringTrainings(recForm()).catch((e: Error) => e)
    expect((fout as Error).message).toBe(GENERIC_ERROR_MESSAGE)
    expect(writes(m, 'events')).toHaveLength(0)
  })

  for (const [naam, fail] of [
    ['AC18: attendance-insert mislukt', { table: 'attendance', op: 'insert' }],
    ['AC18: spelerslijst-select mislukt', { table: 'players', op: 'select' }],
    ['AC18: afmeldperiodes-select mislukt', { table: 'absence_periods', op: 'select' }],
  ] as [string, Fail][]) {
    it(`${naam} → events blijven staan, ok:true met attendanceFailed:true, geen throw`, async () => {
      const m = wereld({
        events: [],
        players: [{ id: 'p', team_id: TEAM_A, active: true, injured: false, type: 'player' }],
        absence_periods: [],
      }, [fail])
      const res = await createRecurringTrainings(recForm())
      expect(res).toEqual({ ok: true, created: 8, skipped: 0, attendanceFailed: true })
      expect(m.store.events).toHaveLength(8)
    })
  }
})

// ────────────────────────────────────────────────
// AC19 — tijdzone-onafhankelijk
// ────────────────────────────────────────────────

describe('createRecurringTrainings — AC19 (kale datums, weekdag onafhankelijk van servertijdzone)', () => {
  const ORIGINAL_TZ = process.env.TZ
  afterEach(() => { process.env.TZ = ORIGINAL_TZ })

  for (const tz of ['America/Los_Angeles', 'Pacific/Auckland', 'Europe/Amsterdam', 'UTC']) {
    it(`in tijdzone ${tz}: DST-wissel 2026-03-29 en 2026-10-25, schrikkeldag 2028-02-29 en jaarwisseling geven dezelfde datums`, async () => {
      process.env.TZ = tz
      // Zondagen rond de zomertijdwissels (2026-03-29 en 2026-10-25 zijn zondag).
      let m = wereld({ events: [], players: [] })
      let res = await createRecurringTrainings(recForm({ date: '2026-03-22', repeat_until: '2026-04-05', repeat_days: '0' }))
      expect(res).toMatchObject({ created: 3 })
      expect(m.store.events.map((e) => e.date)).toEqual(['2026-03-22', '2026-03-29', '2026-04-05'])

      m = wereld({ events: [], players: [] })
      res = await createRecurringTrainings(recForm({ date: '2026-10-18', repeat_until: '2026-11-01', repeat_days: '0' }))
      expect(m.store.events.map((e) => e.date)).toEqual(['2026-10-18', '2026-10-25', '2026-11-01'])

      // 2028-02-29 = dinsdag
      m = wereld({ events: [], players: [] })
      await createRecurringTrainings(recForm({ date: '2028-02-22', repeat_until: '2028-03-07', repeat_days: '2' }))
      expect(m.store.events.map((e) => e.date)).toEqual(['2028-02-22', '2028-02-29', '2028-03-07'])

      // jaarwisseling: do 2026-12-31 en do 2027-01-07
      m = wereld({ events: [], players: [] })
      await createRecurringTrainings(recForm({ date: '2026-12-28', repeat_until: '2027-01-08', repeat_days: '4' }))
      expect(m.store.events.map((e) => e.date)).toEqual(['2026-12-31', '2027-01-07'])
    })
  }
})

// ────────────────────────────────────────────────
// AC20 — tenant
// ────────────────────────────────────────────────

describe('createRecurringTrainings — AC20 (team uit de sessie, nooit uit de aanvraag)', () => {
  it('een meegestuurde team_id en type in de aanvraag worden genegeerd: alles op team A, type training; spelers/periodes van team B krijgen geen rijen', async () => {
    const m = wereld({
      events: [],
      players: [
        { id: 'pa', team_id: TEAM_A, active: true, injured: false, type: 'player' },
        { id: 'pb', team_id: TEAM_B, active: true, injured: false, type: 'player' },
      ],
      absence_periods: [{ id: 'perB', team_id: TEAM_B, player_id: 'pb', from_date: '2026-11-01', to_date: '2026-11-30', created_at: '2026-11-01T00:00:00Z' }],
    })
    const fd = recForm({ team_id: TEAM_B, type: 'match' })
    const res = await createRecurringTrainings(fd)
    expect(res).toMatchObject({ ok: true, created: 8 })
    expect(m.store.events.every((e) => e.team_id === TEAM_A && e.type === 'training')).toBe(true)
    expect(m.store.attendance.every((r) => r.player_id === 'pa' && r.team_id === TEAM_A)).toBe(true)
    expect(m.store.attendance).toHaveLength(8)
  })

  it('een training van een ander team op dezelfde datum telt niet als dubbel', async () => {
    const m = wereld({
      events: [{ id: 'x', team_id: TEAM_B, type: 'training', date: '2026-11-03' }],
      players: [],
    })
    const res = await createRecurringTrainings(recForm())
    expect(res).toMatchObject({ created: 8, skipped: 0 })
    expect(m.store.events.filter((e) => e.team_id === TEAM_A && e.date === '2026-11-03')).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────
// getExistingTrainingDates (teller-bron, AC5/AC17/AC20)
// ────────────────────────────────────────────────

describe('getExistingTrainingDates — AC5/AC17/AC20', () => {
  it('geeft unieke, oplopende datums van trainingen van het eigen team binnen het bereik (inclusief); geen wedstrijden, geen ander team, niets buiten bereik', async () => {
    wereld({
      events: [
        { id: '1', team_id: TEAM_A, type: 'training', date: '2026-11-12' },
        { id: '2', team_id: TEAM_A, type: 'training', date: '2026-11-03' },
        { id: '3', team_id: TEAM_A, type: 'training', date: '2026-11-03' },
        { id: '4', team_id: TEAM_A, type: 'match', date: '2026-11-05' },
        { id: '5', team_id: TEAM_B, type: 'training', date: '2026-11-10' },
        { id: '6', team_id: TEAM_A, type: 'training', date: '2026-10-31' },
        { id: '7', team_id: TEAM_A, type: 'training', date: '2026-11-30' },
        { id: '8', team_id: TEAM_A, type: 'training', date: '2026-11-29' },
      ],
    })
    expect(await getExistingTrainingDates('2026-11-02', '2026-11-29')).toEqual(['2026-11-03', '2026-11-12', '2026-11-29'])
  })

  it('onbruikbare invoer (geen datum, to < from, > 800 dagen) → [] zonder databasevraag', async () => {
    const m = wereld({ events: [{ id: '1', team_id: TEAM_A, type: 'training', date: '2026-11-03' }] })
    expect(await getExistingTrainingDates('2026-02-30', '2026-11-29')).toEqual([])
    expect(await getExistingTrainingDates('2026-11-29', '2026-11-02')).toEqual([])
    expect(await getExistingTrainingDates('2026-01-01', '2028-03-11')).toEqual([])
    expect(await getExistingTrainingDates('x', 'y')).toEqual([])
    expect(m.calls.filter((c) => c.table === 'events')).toHaveLength(0)
  })

  it('niet ingelogd → geweigerd; databasefout → generieke melding', async () => {
    gebruikMock(makeSupabase({ user: null }))
    await expect(getExistingTrainingDates('2026-11-02', '2026-11-29')).rejects.toThrow('Niet ingelogd')
    wereld({ events: [] }, [{ table: 'events', op: 'select', message: 'kapotte kolom z' }])
    const fout = await getExistingTrainingDates('2026-11-02', '2026-11-29').catch((e: Error) => e)
    expect((fout as Error).message).toBe(GENERIC_ERROR_MESSAGE)
  })
})

// ────────────────────────────────────────────────
// getNewTrainingDefaults (AC6 / AC7 / OV1 / OV2)
// ────────────────────────────────────────────────

function setting(team: string, key: string, value: string): Row {
  return { team_id: team, key, value }
}

describe('getNewTrainingDefaults — AC6/AC7 (OV1: laatst aangemaakte training, terugval Trainingsschema; OV2: seizoenseinde)', () => {
  it('AC7/OV1: tijd en locatie komen van de training met de JONGSTE created_at (niet de laatste trainingsdatum); tijd als HH:MM', async () => {
    wereld({
      events: [
        { id: 'a', team_id: TEAM_A, type: 'training', date: '2027-05-01', time: '18:00:00', location: 'Oud veld', created_at: '2026-01-01T10:00:00Z' },
        { id: 'b', team_id: TEAM_A, type: 'training', date: '2026-01-10', time: '19:30:00', location: '  Nieuw veld  ', created_at: '2026-10-01T10:00:00Z' },
        { id: 'c', team_id: TEAM_A, type: 'training', date: '2026-12-01', time: '17:00:00', location: 'Midden', created_at: '2026-06-01T10:00:00Z' },
      ],
    })
    expect(await getNewTrainingDefaults()).toEqual({ time: '19:30', location: 'Nieuw veld', seasonEnd: null })
  })

  it('R5/OV1: een training met created_at NULL wint nooit van een training met tijdstempel (ook niet bij de hoogste id)', async () => {
    wereld({
      events: [
        { id: 'a', team_id: TEAM_A, type: 'training', time: '18:00:00', location: 'Met stempel', created_at: '2026-01-01T10:00:00Z' },
        { id: 'z-null', team_id: TEAM_A, type: 'training', time: '21:00:00', location: 'Zonder stempel', created_at: null },
      ],
    })
    expect(await getNewTrainingDefaults()).toMatchObject({ time: '18:00', location: 'Met stempel' })
  })

  it('OV1: bij gelijke created_at beslist de hoogste id (deterministisch)', async () => {
    wereld({
      events: [
        { id: 'a', team_id: TEAM_A, type: 'training', time: '18:00:00', location: 'A', created_at: '2026-01-01T10:00:00Z' },
        { id: 'b', team_id: TEAM_A, type: 'training', time: '20:00:00', location: 'B', created_at: '2026-01-01T10:00:00Z' },
      ],
    })
    expect(await getNewTrainingDefaults()).toMatchObject({ time: '20:00', location: 'B' })
  })

  it('OV1: een wedstrijd of een training van een ander team telt niet als "laatste training"', async () => {
    wereld({
      events: [
        { id: 'a', team_id: TEAM_A, type: 'training', time: '18:00:00', location: 'Eigen', created_at: '2026-01-01T10:00:00Z' },
        { id: 'm', team_id: TEAM_A, type: 'match', time: '11:00:00', location: 'Uit', created_at: '2026-11-01T10:00:00Z' },
        { id: 'b', team_id: TEAM_B, type: 'training', time: '21:00:00', location: 'Vreemd', created_at: '2026-11-02T10:00:00Z' },
      ],
    })
    expect(await getNewTrainingDefaults()).toMatchObject({ time: '18:00', location: 'Eigen' })
  })

  it('OV1: geen training → terugval op Trainingsschema (settings training_time/training_location); settings van een ander team tellen niet', async () => {
    const m = wereld({ events: [] })
    m.store.settings.push(
      setting(TEAM_A, 'training_time', '18:45'), setting(TEAM_A, 'training_location', 'Sportpark Schema'),
      setting(TEAM_B, 'training_time', '09:00'), setting(TEAM_B, 'training_location', 'Elders'),
    )
    expect(await getNewTrainingDefaults()).toEqual({ time: '18:45', location: 'Sportpark Schema', seasonEnd: null })
  })

  it('V3: per veld terugvallen: laatste training zonder locatie → locatie uit instellingen, tijd uit de training', async () => {
    const m = wereld({
      events: [{ id: 'a', team_id: TEAM_A, type: 'training', time: '19:00:00', location: null, created_at: '2026-01-01T10:00:00Z' }],
    })
    m.store.settings.push(setting(TEAM_A, 'training_time', '18:00'), setting(TEAM_A, 'training_location', 'Schema-veld'))
    expect(await getNewTrainingDefaults()).toMatchObject({ time: '19:00', location: 'Schema-veld' })
  })

  it('OV1: geen training en geen instellingen → alles null (leeg)', async () => {
    wereld({ events: [] })
    expect(await getNewTrainingDefaults()).toEqual({ time: null, location: null, seasonEnd: null })
  })

  it('OV1: een ongeldige training_time in de instellingen (wordt niet gevalideerd bij opslaan) levert null op, niet de rommel', async () => {
    const m = wereld({ events: [] })
    m.store.settings.push(setting(TEAM_A, 'training_time', '25:99'))
    expect((await getNewTrainingDefaults()).time).toBeNull()
  })

  it('AC12/OV1: een bestaande locatie langer dan 200 tekens wordt niet voorgevuld (zou zelf op location_too_long stuklopen)', async () => {
    wereld({
      events: [{ id: 'a', team_id: TEAM_A, type: 'training', time: '19:00:00', location: 'x'.repeat(201), created_at: '2026-01-01T10:00:00Z' }],
    })
    expect((await getNewTrainingDefaults()).location).toBeNull()
  })

  it('AC6: seizoenseinde komt uit settings season_end van het eigen team; ongeldige waarde of ander team → null (OV2: einddatum dan leeg)', async () => {
    let m = wereld({ events: [] })
    m.store.settings.push(setting(TEAM_A, 'season_end', '2027-06-30'), setting(TEAM_B, 'season_end', '2030-01-01'))
    expect((await getNewTrainingDefaults()).seasonEnd).toBe('2027-06-30')

    m = wereld({ events: [] })
    m.store.settings.push(setting(TEAM_A, 'season_end', '2027-02-30'))
    expect((await getNewTrainingDefaults()).seasonEnd).toBeNull()

    m = wereld({ events: [] })
    m.store.settings.push(setting(TEAM_B, 'season_end', '2030-01-01'))
    expect((await getNewTrainingDefaults()).seasonEnd).toBeNull()
  })

  it('niet ingelogd → geweigerd; databasefout → generieke melding (de pagina vangt dit op met lege defaults)', async () => {
    gebruikMock(makeSupabase({ user: null }))
    await expect(getNewTrainingDefaults()).rejects.toThrow('Niet ingelogd')
    wereld({ events: [] }, [{ table: 'events', op: 'select', message: 'intern lek' }])
    const fout = await getNewTrainingDefaults().catch((e: Error) => e)
    expect((fout as Error).message).toBe(GENERIC_ERROR_MESSAGE)
  })
})
