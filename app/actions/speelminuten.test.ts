import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { HERSTEL_FOUT, type HerstelSpeelminuten } from '@/lib/herstel'
import {
  deleteSpeelminuten,
  herstelSpeelminuten,
  saveSpeelminuten,
} from '@/app/actions/speelminuten'

// Mock-patroon uit app/actions/tegendoelpunten.test.ts: een chainable stub die
// filters NIET toepast, maar elke .from(), .eq(), insert, upsert en delete
// vastlegt. Wat RLS doet bewijst alleen supabase/team-rls-verificatie.sql
// (blok 28).

type TableResult = { data?: unknown; error?: unknown }
type Eq = { col: string; val: unknown }

const TEAM = 'team-1'
const EVENT = '0e000000-0000-4000-8000-000000000001'
const PLAYER = '0a000000-0000-4000-8000-000000000001'
const ID = '0d000000-0000-4000-8000-000000000001'
const CREATED = '2026-10-25T08:15:30.123456+00:00'

// Vaste klok: 27 oktober 2026, 11:00 in Amsterdam (10:00 UTC).
const NU = new Date('2026-10-27T10:00:00Z')
const VANDAAG = '2026-10-27'
const GISTEREN = '2026-10-26'
const MORGEN = '2026-10-28'

function teamMembersFixture(userId: string | undefined) {
  if (!userId) return { data: [], error: null }
  return { data: [{ team_id: userId, user_id: userId, rol: 'owner' }], error: null }
}

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
  queues?: Record<string, TableResult[]>
} = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const tables = opts.tables ?? {}
  const queues = opts.queues ?? {}
  const calls = {
    from: [] as string[],
    select: [] as { table: string; cols: unknown; eqs: Eq[] }[],
    insert: [] as { table: string; payload: Record<string, unknown> }[],
    upsert: [] as { table: string; payload: Record<string, unknown>; options: unknown }[],
    update: [] as { table: string }[],
    delete: [] as { table: string; eqs: Eq[] }[],
  }

  function nextResult(table: string): TableResult {
    const queue = queues[table]
    if (queue && queue.length > 0) return queue.length === 1 ? queue[0] : queue.shift()!
    return tables[table] ?? (table === 'team_members' ? teamMembersFixture(user?.id) : { data: null, error: null })
  }

  function chain(table: string) {
    const eqs: Eq[] = []
    const c: Record<string, unknown> = {}
    c.select = (cols: unknown) => { calls.select.push({ table, cols, eqs }); return c }
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    c.in = () => c
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push({ table, payload }); return c }
    c.upsert = (payload: Record<string, unknown>, options: unknown) => { calls.upsert.push({ table, payload, options }); return c }
    c.update = () => { calls.update.push({ table }); return c }
    c.delete = () => { calls.delete.push({ table, eqs }); return c }
    c.maybeSingle = () => Promise.resolve(nextResult(table))
    c.single = () => Promise.resolve(nextResult(table))
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(nextResult(table))
    return c
  }

  const supabase = {
    from: (t: string) => { calls.from.push(t); return chain(t) },
    rpc: async () => ({ data: null, error: null }),
    auth: { getUser: async () => ({ data: { user } }) },
  }
  return { supabase, calls }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

const EIGEN_WEDSTRIJD: TableResult = { data: { id: EVENT, type: 'match', date: VANDAAG }, error: null }
const EIGEN_SPELER: TableResult = { data: { id: PLAYER }, error: null }

// Eigen gespeelde wedstrijd + eigen speler; de speelminuten-queue bepaalt de
// antwoorden op upsert/insert en de eventuele bestaan-checks.
function eigenWedstrijd(opts: { events?: TableResult; players?: TableResult; speelminuten?: TableResult[] } = {}) {
  return makeSupabase({
    tables: { events: opts.events ?? EIGEN_WEDSTRIJD, players: opts.players ?? EIGEN_SPELER },
    queues: { speelminuten: opts.speelminuten ?? [{ error: null }] },
  })
}

function wedstrijdOp(date: string): TableResult {
  return { data: { id: EVENT, type: 'match', date }, error: null }
}

function zonderWedstrijdRecht() {
  return makeSupabase({
    tables: {
      team_members: { data: [{ team_id: TEAM, user_id: TEAM, rol: 'assistent', mag_agenda_bewerken: true, mag_spelers_bewerken: true }], error: null },
    },
  })
}

let consoleError: ReturnType<typeof vi.spyOn>
const OORSPRONKELIJKE_TZ = process.env.TZ

beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.TZ = 'Europe/Amsterdam'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NU)
})

afterEach(() => {
  consoleError.mockRestore()
  vi.useRealTimers()
  if (OORSPRONKELIJKE_TZ === undefined) delete process.env.TZ
  else process.env.TZ = OORSPRONKELIJKE_TZ
})

function logged() {
  return consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
}

function nietTeamTabellen(calls: ReturnType<typeof makeSupabase>['calls']) {
  return calls.from.filter((t) => t !== 'team_members' && t !== 'settings')
}

describe('saveSpeelminuten', () => {
  it('upsert team-gescoped op (event_id, player_id) met team_id uit de sessie', async () => {
    const m = eigenWedstrijd()
    use(m)

    await saveSpeelminuten(EVENT, PLAYER, 72, 2)

    expect(m.calls.upsert).toEqual([{
      table: 'speelminuten',
      payload: { team_id: TEAM, event_id: EVENT, player_id: PLAYER, minuten: 72, wissels: 2 },
      options: { onConflict: 'event_id,player_id' },
    }])
    expect(m.calls.insert).toHaveLength(0)
    // Wedstrijd- en spelercheck zijn allebei team-gescoped.
    const eventSelect = m.calls.select.find((s) => s.table === 'events')!
    expect(eventSelect.eqs).toEqual([{ col: 'id', val: EVENT }, { col: 'team_id', val: TEAM }])
    expect(String(eventSelect.cols)).toContain('date')
    const spelerSelect = m.calls.select.find((s) => s.table === 'players')!
    expect(spelerSelect.eqs).toEqual([{ col: 'id', val: PLAYER }, { col: 'team_id', val: TEAM }])
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}/analysis`)
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}`)
  })

  it.each([[0, 0], [130, 99], [90, 0], [0, 3]])('accepteert %s minuten en %s wissels', async (minuten, wissels) => {
    const m = eigenWedstrijd()
    use(m)
    await saveSpeelminuten(EVENT, PLAYER, minuten, wissels)
    expect(m.calls.upsert[0].payload).toMatchObject({ minuten, wissels })
  })

  it('een wedstrijd van vandaag en van gisteren mag', async () => {
    for (const date of [VANDAAG, GISTEREN]) {
      const m = eigenWedstrijd({ events: wedstrijdOp(date) })
      use(m)
      await saveSpeelminuten(EVENT, PLAYER, 45, 1)
      expect(m.calls.upsert).toHaveLength(1)
    }
  })

  it.each([
    ['minuten 131', 131, 0],
    ['minuten -1', -1, 0],
    ['minuten 12.5', 12.5, 0],
    ["minuten '12'", '12', 0],
    ['minuten null', null, 0],
    ['minuten NaN', NaN, 0],
    ['wissels 100', 60, 100],
    ['wissels -1', 60, -1],
    ['wissels 1.5', 60, 1.5],
    ['wissels null', 60, null],
    ['wissels undefined', 60, undefined],
  ])('weigert %s zonder select en zonder upsert (AC-M.6)', async (_label, minuten, wissels) => {
    const m = eigenWedstrijd()
    use(m)
    await expect(saveSpeelminuten(EVENT, PLAYER, minuten as number, wissels as number)).rejects.toThrow('Ongeldige speelminuten')
    expect(nietTeamTabellen(m.calls)).toEqual([])
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('weigert een eventId of playerId dat geen uuid is, zonder DB-aanroep', async () => {
    const m = eigenWedstrijd()
    use(m)
    await expect(saveSpeelminuten('e1', PLAYER, 10, 0)).rejects.toThrow('Ongeldige speelminuten')
    await expect(saveSpeelminuten(EVENT, 'p1', 10, 0)).rejects.toThrow('Ongeldige speelminuten')
    expect(nietTeamTabellen(m.calls)).toEqual([])
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('zonder Wedstrijd-recht: "Geen toegang", geen DB-aanroep en geen upsert (AC-M.7)', async () => {
    const m = zonderWedstrijdRecht()
    use(m)
    await expect(saveSpeelminuten(EVENT, PLAYER, 10, 0)).rejects.toThrow('Geen toegang')
    expect(nietTeamTabellen(m.calls)).toEqual([])
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(saveSpeelminuten(EVENT, PLAYER, 10, 0)).rejects.toThrow('Niet ingelogd')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it.each([
    ['een event van een ander team of niet-bestaand', { data: null, error: null }],
    ['een training', { data: { id: EVENT, type: 'training', date: GISTEREN }, error: null }],
    ['een meting', { data: { id: EVENT, type: 'meting', date: GISTEREN }, error: null }],
  ])('weigert %s met "Event niet gevonden" en zonder upsert', async (_label, events) => {
    const m = eigenWedstrijd({ events })
    use(m)
    await expect(saveSpeelminuten(EVENT, PLAYER, 10, 0)).rejects.toThrow('Event niet gevonden')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('een speler van een ander team: "Speler niet gevonden", geen upsert (AC-A2)', async () => {
    const m = eigenWedstrijd({ players: { data: null, error: null } })
    use(m)
    await expect(saveSpeelminuten(EVENT, PLAYER, 10, 0)).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('een wedstrijd in de toekomst: "Wedstrijd nog niet gespeeld", geen upsert (M5)', async () => {
    const m = eigenWedstrijd({ events: wedstrijdOp(MORGEN) })
    use(m)
    await expect(saveSpeelminuten(EVENT, PLAYER, 10, 0)).rejects.toThrow('Wedstrijd nog niet gespeeld')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('een wedstrijd zonder bruikbare datum wordt fail-safe als niet gespeeld geweigerd', async () => {
    const m = eigenWedstrijd({ events: { data: { id: EVENT, type: 'match', date: null }, error: null } })
    use(m)
    await expect(saveSpeelminuten(EVENT, PLAYER, 10, 0)).rejects.toThrow('Wedstrijd nog niet gespeeld')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('tijdzone (R2): 00:30 in Amsterdam op de wedstrijddag met een UTC-serverklok → nog geweigerd (fail-safe)', async () => {
    // 2026-10-26T23:30Z = 27 okt 00:30 in Amsterdam (CET), maar nog 26 okt in UTC.
    vi.setSystemTime(new Date('2026-10-26T23:30:00Z'))
    process.env.TZ = 'UTC'
    const m = eigenWedstrijd({ events: wedstrijdOp(VANDAAG) })
    use(m)
    await expect(saveSpeelminuten(EVENT, PLAYER, 10, 0)).rejects.toThrow('Wedstrijd nog niet gespeeld')
    expect(m.calls.upsert).toHaveLength(0)

    // Hetzelfde moment op een server in Europe/Amsterdam is het al de wedstrijddag.
    process.env.TZ = 'Europe/Amsterdam'
    const m2 = eigenWedstrijd({ events: wedstrijdOp(VANDAAG) })
    use(m2)
    await saveSpeelminuten(EVENT, PLAYER, 10, 0)
    expect(m2.calls.upsert).toHaveLength(1)
  })

  it('twee keer opslaan geeft twee upserts en nooit een insert (laatste wint, AC-M.3)', async () => {
    const m = eigenWedstrijd()
    use(m)
    await saveSpeelminuten(EVENT, PLAYER, 60, 1)
    await saveSpeelminuten(EVENT, PLAYER, 70, 2)
    expect(m.calls.upsert.map((u) => u.payload.minuten)).toEqual([60, 70])
    expect(m.calls.upsert.every((u) => (u.options as { onConflict: string }).onConflict === 'event_id,player_id')).toBe(true)
    expect(m.calls.insert).toHaveLength(0)
  })

  it('DB-fout 42501 → generieke melding, zonder ruwe tekst naar client of log', async () => {
    use(eigenWedstrijd({ speelminuten: [{ error: { code: '42501', message: 'new row violates row-level security policy for table "speelminuten"' } }] }))
    const fout = await saveSpeelminuten(EVENT, PLAYER, 10, 0).catch((e: Error) => e)
    expect(fout).toBeInstanceOf(Error)
    expect((fout as Error).message).toBe(GENERIC_ERROR_MESSAGE)
    expect((fout as Error).message).not.toContain('row-level security')
    expect(logged()).toContain('speelminuten.saveSpeelminuten')
    expect(logged()).not.toContain('row-level security')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

const RIJ = { id: ID, event_id: EVENT, player_id: PLAYER, minuten: 77, wissels: 2, created_at: CREATED }

describe('deleteSpeelminuten', () => {
  function teVerwijderen(opts: { rij?: TableResult; schrijf?: TableResult } = {}) {
    return makeSupabase({
      queues: {
        speelminuten: [opts.rij ?? { data: RIJ, error: null }, opts.schrijf ?? { data: null, error: null }],
      },
    })
  }

  it('leest en verwijdert met event + player + team, en geeft de volledige snapshot terug', async () => {
    const m = teVerwijderen()
    use(m)

    const herstel = await deleteSpeelminuten(EVENT, PLAYER)

    const drieFilters = [
      { col: 'event_id', val: EVENT },
      { col: 'player_id', val: PLAYER },
      { col: 'team_id', val: TEAM },
    ]
    const lees = m.calls.select.find((s) => s.table === 'speelminuten')!
    expect(lees.eqs).toEqual(drieFilters)
    const del = m.calls.delete.find((d) => d.table === 'speelminuten')!
    expect(del.eqs).toEqual(drieFilters)
    expect(herstel).toEqual({
      soort: 'speelminuten',
      teamId: TEAM,
      id: ID,
      eventId: EVENT,
      playerId: PLAYER,
      minuten: 77,
      wissels: 2,
      createdAt: CREATED,
    })
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}/analysis`)
  })

  it('doet BEWUST geen wedstrijd-, toekomst-, aanwezigheids- of spelercheck (O2: opruimen kan altijd)', async () => {
    const m = teVerwijderen()
    use(m)
    await deleteSpeelminuten(EVENT, PLAYER)
    expect(nietTeamTabellen(m.calls)).toEqual(['speelminuten', 'speelminuten'])
  })

  it('created_at null in de rij → createdAt null in de snapshot', async () => {
    use(teVerwijderen({ rij: { data: { ...RIJ, created_at: null }, error: null } }))
    const herstel = await deleteSpeelminuten(EVENT, PLAYER)
    expect(herstel.createdAt).toBeNull()
  })

  it('een rij van een ander team (of onbekend) → "Speelminuten niet gevonden", geen delete', async () => {
    const m = teVerwijderen({ rij: { data: null, error: null } })
    use(m)
    await expect(deleteSpeelminuten(EVENT, PLAYER)).rejects.toThrow('Speelminuten niet gevonden')
    expect(m.calls.delete).toHaveLength(0)
  })

  it('een id dat geen uuid is → niet gevonden, zonder query', async () => {
    const m = teVerwijderen()
    use(m)
    await expect(deleteSpeelminuten('e1', PLAYER)).rejects.toThrow('Speelminuten niet gevonden')
    await expect(deleteSpeelminuten(EVENT, 'p1')).rejects.toThrow('Speelminuten niet gevonden')
    expect(m.calls.from).not.toContain('speelminuten')
    expect(m.calls.delete).toHaveLength(0)
  })

  it('zonder Wedstrijd-recht: "Geen toegang", geen select en geen delete', async () => {
    const m = zonderWedstrijdRecht()
    use(m)
    await expect(deleteSpeelminuten(EVENT, PLAYER)).rejects.toThrow('Geen toegang')
    expect(nietTeamTabellen(m.calls)).toEqual([])
    expect(m.calls.delete).toHaveLength(0)
  })

  it('DB-fout bij de delete → generieke melding, zonder ruwe tekst', async () => {
    use(teVerwijderen({ schrijf: { data: null, error: { code: '42501', message: 'permission denied for table speelminuten' } } }))
    await expect(deleteSpeelminuten(EVENT, PLAYER)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(logged()).toContain('speelminuten.deleteSpeelminuten')
    expect(logged()).not.toContain('permission denied')
  })

  it('DB-fout bij het lezen → generieke melding, geen delete', async () => {
    const m = teVerwijderen({ rij: { data: null, error: { code: '57014', message: 'canceling statement' } } })
    use(m)
    await expect(deleteSpeelminuten(EVENT, PLAYER)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(m.calls.delete).toHaveLength(0)
  })
})

describe('herstelSpeelminuten', () => {
  const SNAPSHOT: HerstelSpeelminuten = {
    soort: 'speelminuten',
    teamId: TEAM,
    id: ID,
    eventId: EVENT,
    playerId: PLAYER,
    minuten: 64,
    wissels: 1,
    createdAt: CREATED,
  }

  // speelminuten: eerst de bestaan-check, dan de insert (en evt. hercontrole).
  function teHerstellen(opts: { speelminuten?: TableResult[]; events?: TableResult; players?: TableResult } = {}) {
    return makeSupabase({
      tables: { events: opts.events ?? EIGEN_WEDSTRIJD, players: opts.players ?? EIGEN_SPELER },
      queues: { speelminuten: opts.speelminuten ?? [{ data: null }, { error: null }] },
    })
  }

  it('zet de rij terug met originele id en created_at, team_id uit de sessie (plain insert)', async () => {
    const m = teHerstellen()
    use(m)
    await herstelSpeelminuten(SNAPSHOT)
    expect(m.calls.insert).toEqual([{
      table: 'speelminuten',
      payload: { id: ID, team_id: TEAM, event_id: EVENT, player_id: PLAYER, minuten: 64, wissels: 1, created_at: CREATED },
    }])
    expect(m.calls.upsert).toHaveLength(0)
    const check = m.calls.select.find((s) => s.table === 'speelminuten')!
    expect(check.eqs).toEqual([
      { col: 'team_id', val: TEAM },
      { col: 'event_id', val: EVENT },
      { col: 'player_id', val: PLAYER },
    ])
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}/analysis`)
  })

  it('laat created_at weg bij null (DB-default) en accepteert 0 minuten en 0 wissels', async () => {
    const m = teHerstellen()
    use(m)
    await herstelSpeelminuten({ ...SNAPSHOT, createdAt: null, minuten: 0, wissels: 0 })
    expect(m.calls.insert[0].payload).not.toHaveProperty('created_at')
    expect(m.calls.insert[0].payload).toMatchObject({ minuten: 0, wissels: 0 })
  })

  it('weigert een snapshot van een ander team, zonder iets te schrijven', async () => {
    const m = teHerstellen()
    use(m)
    await expect(herstelSpeelminuten({ ...SNAPSHOT, teamId: 'ander-team' })).rejects.toThrow(HERSTEL_FOUT)
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert ongeldige ids, waarden, created_at of discriminator', async () => {
    const m = teHerstellen()
    use(m)
    for (const fout of [
      { ...SNAPSHOT, id: 'x1' },
      { ...SNAPSHOT, eventId: 'e1' },
      { ...SNAPSHOT, playerId: 'p1' },
      { ...SNAPSHOT, minuten: 131 },
      { ...SNAPSHOT, minuten: -1 },
      { ...SNAPSHOT, minuten: 12.5 },
      { ...SNAPSHOT, minuten: null as unknown as number },
      { ...SNAPSHOT, wissels: 100 },
      { ...SNAPSHOT, wissels: -1 },
      { ...SNAPSHOT, createdAt: 'gisteren' },
      { ...SNAPSHOT, soort: 'tegendoelpunt' as never },
      null as unknown as HerstelSpeelminuten,
    ]) {
      await expect(herstelSpeelminuten(fout)).rejects.toThrow(HERSTEL_FOUT)
    }
    expect(m.calls.insert).toHaveLength(0)
  })

  it.each([
    ['geen eigen wedstrijd (meer)', { events: { data: { id: EVENT, type: 'training', date: GISTEREN }, error: null } }],
    ['een wedstrijd in de toekomst', { events: wedstrijdOp(MORGEN) }],
    ['een speler van een ander team', { players: { data: null, error: null } }],
  ])('weigert bij %s met HERSTEL_FOUT', async (_label, opts) => {
    const m = teHerstellen(opts)
    use(m)
    await expect(herstelSpeelminuten(SNAPSHOT)).rejects.toThrow(HERSTEL_FOUT)
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert zonder Wedstrijd-recht met "Geen toegang"', async () => {
    const m = zonderWedstrijdRecht()
    use(m)
    await expect(herstelSpeelminuten(SNAPSHOT)).rejects.toThrow('Geen toegang')
    expect(m.calls.insert).toHaveLength(0)
  })

  it('overschrijft nooit: staat er al een (nieuwere) rij, dan geen insert en een resolve', async () => {
    const m = teHerstellen({ speelminuten: [{ data: { id: 'nieuwer' } }] })
    use(m)
    await expect(herstelSpeelminuten(SNAPSHOT)).resolves.toBeUndefined()
    expect(m.calls.insert).toHaveLength(0)
    expect(m.calls.upsert).toHaveLength(0)
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}`)
  })

  it('23505 en daarna een bestaande rij in dit team → resolve', async () => {
    use(teHerstellen({ speelminuten: [{ data: null }, { error: { code: '23505' } }, { data: { id: ID } }] }))
    await expect(herstelSpeelminuten(SNAPSHOT)).resolves.toBeUndefined()
  })

  it('23505 zonder rij (id elders bezet) → HERSTEL_FOUT', async () => {
    use(teHerstellen({ speelminuten: [{ data: null }, { error: { code: '23505' } }, { data: null }] }))
    await expect(herstelSpeelminuten(SNAPSHOT)).rejects.toThrow(HERSTEL_FOUT)
  })

  it('andere databasefout → generieke melding zonder ruwe tekst', async () => {
    use(teHerstellen({ speelminuten: [{ data: null }, { error: { code: '42501', message: 'permission denied' } }] }))
    await expect(herstelSpeelminuten(SNAPSHOT)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(logged()).toContain('speelminuten.herstelSpeelminuten')
    expect(logged()).not.toContain('permission denied')
  })
})
