import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { HERSTEL_FOUT, type HerstelTegendoelpunt } from '@/lib/herstel'
import type { TegendoelpuntSoort } from '@/lib/types'
import {
  addTegendoelpunt,
  deleteTegendoelpunt,
  herstelTegendoelpunt,
} from '@/app/actions/tegendoelpunten'

// Mock-patroon uit app/actions/match-analysis.test.ts: een chainable stub die
// filters NIET toepast, maar elke .from(), .eq(), insert en delete vastlegt.
// Wat RLS doet bewijst alleen supabase/team-rls-verificatie.sql (blok 26).

type TableResult = { data?: unknown; error?: unknown }
type Eq = { col: string; val: unknown }

const TEAM = 'team-1'
const EVENT = '0e000000-0000-4000-8000-000000000001'
const ID = '0d000000-0000-4000-8000-000000000001'
const CREATED = '2026-10-25T08:15:30.123456+00:00'

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
    select: [] as { table: string; eqs: Eq[] }[],
    insert: [] as { table: string; payload: Record<string, unknown> }[],
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
    c.select = () => { calls.select.push({ table, eqs }); return c }
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    c.in = () => c
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push({ table, payload }); return c }
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

// Eigen wedstrijd; tegendoelpunten-queue bepaalt de antwoorden op insert en
// de eventuele bestaan-check.
function eigenWedstrijd(tegendoelpunten: TableResult[] = [{ error: null }], events: TableResult = { data: { id: EVENT, type: 'match' }, error: null }) {
  return makeSupabase({ tables: { events }, queues: { tegendoelpunten } })
}

function zonderWedstrijdRecht() {
  return makeSupabase({
    tables: {
      team_members: { data: [{ team_id: TEAM, user_id: TEAM, rol: 'assistent', mag_agenda_bewerken: true }], error: null },
    },
  })
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

function logged() {
  return consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
}

function nietTeamTabellen(calls: ReturnType<typeof makeSupabase>['calls']) {
  return calls.from.filter((t) => t !== 'team_members' && t !== 'settings')
}

describe('addTegendoelpunt', () => {
  it('voegt team-gescoped toe met de client-id en team_id uit de sessie', async () => {
    const m = eigenWedstrijd()
    use(m)

    await addTegendoelpunt(ID, EVENT, 'set_piece', 12)

    expect(m.calls.insert).toEqual([{
      table: 'tegendoelpunten',
      payload: { id: ID, team_id: TEAM, event_id: EVENT, soort: 'set_piece', minute: 12 },
    }])
    // De event-check is team-gescoped.
    const eventSelect = m.calls.select.find((s) => s.table === 'events')!
    expect(eventSelect.eqs).toContainEqual({ col: 'team_id', val: TEAM })
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}/analysis`)
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}`)
  })

  it.each([[null], [0], [130]])('accepteert minuut %s', async (minute) => {
    const m = eigenWedstrijd()
    use(m)
    await addTegendoelpunt(ID, EVENT, 'open_play', minute)
    expect(m.calls.insert[0].payload.minute).toBe(minute)
  })

  it.each([['anders'], [''], [null], ['goal'], [undefined]])('weigert soort %s zonder insert (AC-6.2)', async (soort) => {
    const m = eigenWedstrijd()
    use(m)
    await expect(addTegendoelpunt(ID, EVENT, soort as unknown as TegendoelpuntSoort, 10)).rejects.toThrow('Ongeldig tegendoelpunt')
    expect(m.calls.insert).toHaveLength(0)
  })

  it.each([[131], [-1], [12.5], ['12'], [NaN]])('weigert minuut %s zonder insert (AC-6.3)', async (minute) => {
    const m = eigenWedstrijd()
    use(m)
    await expect(addTegendoelpunt(ID, EVENT, 'open_play', minute as unknown as number)).rejects.toThrow('Ongeldig tegendoelpunt')
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert een id of eventId dat geen uuid is', async () => {
    const m = eigenWedstrijd()
    use(m)
    await expect(addTegendoelpunt('t1', EVENT, 'open_play', 10)).rejects.toThrow('Ongeldig tegendoelpunt')
    await expect(addTegendoelpunt(ID, 'e1', 'open_play', 10)).rejects.toThrow('Ongeldig tegendoelpunt')
    expect(m.calls.insert).toHaveLength(0)
  })

  it('zonder Wedstrijd-recht: "Geen toegang", geen select en geen insert (AC-6.5)', async () => {
    const m = zonderWedstrijdRecht()
    use(m)
    await expect(addTegendoelpunt(ID, EVENT, 'open_play', 10)).rejects.toThrow('Geen toegang')
    expect(nietTeamTabellen(m.calls)).toEqual([])
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(addTegendoelpunt(ID, EVENT, 'open_play', 10)).rejects.toThrow('Niet ingelogd')
    expect(m.calls.insert).toHaveLength(0)
  })

  it.each([
    ['een event van een ander team of niet-bestaand', { data: null, error: null }],
    ['een training', { data: { id: EVENT, type: 'training' }, error: null }],
    ['een meting', { data: { id: EVENT, type: 'meting' }, error: null }],
  ])('weigert %s met "Event niet gevonden" en zonder insert (AC-6.6)', async (_label, events) => {
    const m = eigenWedstrijd(undefined, events)
    use(m)
    await expect(addTegendoelpunt(ID, EVENT, 'open_play', 10)).rejects.toThrow('Event niet gevonden')
    expect(m.calls.insert).toHaveLength(0)
  })

  it('23505 terwijl de eigen rij bestaat → resolve, insert precies één keer (AC-6.7)', async () => {
    const m = eigenWedstrijd([{ error: { code: '23505', message: 'duplicate key value violates unique constraint' } }, { data: { id: ID }, error: null }])
    use(m)
    await expect(addTegendoelpunt(ID, EVENT, 'open_play', 10)).resolves.toBeUndefined()
    expect(m.calls.insert).toHaveLength(1)
    // De bestaan-check is gescoped op id, team én event.
    const check = m.calls.select.filter((s) => s.table === 'tegendoelpunten').at(-1)!
    expect(check.eqs).toEqual([
      { col: 'id', val: ID },
      { col: 'team_id', val: TEAM },
      { col: 'event_id', val: EVENT },
    ])
  })

  it('23505 zonder eigen rij (id elders bezet) → generieke fout', async () => {
    use(eigenWedstrijd([{ error: { code: '23505', message: 'duplicate key' } }, { data: null, error: null }]))
    await expect(addTegendoelpunt(ID, EVENT, 'open_play', 10)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
  })

  it('DB-fout 42501 → generieke melding, zonder ruwe tekst naar client of log', async () => {
    use(eigenWedstrijd([{ error: { code: '42501', message: 'new row violates row-level security policy for table "tegendoelpunten"' } }]))
    const fout = await addTegendoelpunt(ID, EVENT, 'open_play', 10).catch((e: Error) => e)
    expect(fout).toBeInstanceOf(Error)
    expect((fout as Error).message).toBe(GENERIC_ERROR_MESSAGE)
    expect((fout as Error).message).not.toContain('row-level security')
    expect(logged()).toContain('tegendoelpunten.addTegendoelpunt')
    expect(logged()).not.toContain('row-level security')
  })
})

const RIJ = { id: ID, event_id: EVENT, soort: 'open_play', minute: 77, created_at: CREATED }

describe('deleteTegendoelpunt', () => {
  function teVerwijderen(opts: { rij?: TableResult; schrijf?: TableResult } = {}) {
    return makeSupabase({
      queues: {
        tegendoelpunten: [opts.rij ?? { data: RIJ, error: null }, opts.schrijf ?? { data: null, error: null }],
      },
    })
  }

  it('leest en verwijdert met id + team_id, en geeft de volledige snapshot terug', async () => {
    const m = teVerwijderen()
    use(m)

    const herstel = await deleteTegendoelpunt(ID)

    const lees = m.calls.select.find((s) => s.table === 'tegendoelpunten')!
    expect(lees.eqs).toEqual([{ col: 'id', val: ID }, { col: 'team_id', val: TEAM }])
    const del = m.calls.delete.find((d) => d.table === 'tegendoelpunten')!
    expect(del.eqs).toEqual([{ col: 'id', val: ID }, { col: 'team_id', val: TEAM }])
    expect(herstel).toEqual({
      soort: 'tegendoelpunt',
      teamId: TEAM,
      id: ID,
      eventId: EVENT,
      doelpuntSoort: 'open_play',
      minute: 77,
      createdAt: CREATED,
    })
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}/analysis`)
  })

  it('een rij van een ander team (of onbekend) → "Tegendoelpunt niet gevonden", geen delete', async () => {
    const m = teVerwijderen({ rij: { data: null, error: null } })
    use(m)
    await expect(deleteTegendoelpunt(ID)).rejects.toThrow('Tegendoelpunt niet gevonden')
    expect(m.calls.delete).toHaveLength(0)
  })

  it('een id dat geen uuid is → niet gevonden, zonder query', async () => {
    const m = teVerwijderen()
    use(m)
    await expect(deleteTegendoelpunt('t1')).rejects.toThrow('Tegendoelpunt niet gevonden')
    expect(m.calls.from).not.toContain('tegendoelpunten')
    expect(m.calls.delete).toHaveLength(0)
  })

  it('zonder Wedstrijd-recht: "Geen toegang", geen select en geen delete', async () => {
    const m = zonderWedstrijdRecht()
    use(m)
    await expect(deleteTegendoelpunt(ID)).rejects.toThrow('Geen toegang')
    expect(nietTeamTabellen(m.calls)).toEqual([])
    expect(m.calls.delete).toHaveLength(0)
  })

  it('DB-fout bij de delete → generieke melding, zonder ruwe tekst', async () => {
    use(teVerwijderen({ schrijf: { data: null, error: { code: '42501', message: 'permission denied for table tegendoelpunten' } } }))
    await expect(deleteTegendoelpunt(ID)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(logged()).toContain('tegendoelpunten.deleteTegendoelpunt')
    expect(logged()).not.toContain('permission denied')
  })

  it('DB-fout bij het lezen → generieke melding, geen delete', async () => {
    const m = teVerwijderen({ rij: { data: null, error: { code: '57014', message: 'canceling statement' } } })
    use(m)
    await expect(deleteTegendoelpunt(ID)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(m.calls.delete).toHaveLength(0)
  })
})

describe('herstelTegendoelpunt', () => {
  const SNAPSHOT: HerstelTegendoelpunt = {
    soort: 'tegendoelpunt',
    teamId: TEAM,
    id: ID,
    eventId: EVENT,
    doelpuntSoort: 'set_piece',
    minute: 33,
    createdAt: CREATED,
  }

  // tegendoelpunten: eerst de bestaan-check, dan de insert (en evt. hercontrole).
  function teHerstellen(tegendoelpunten: TableResult[] = [{ data: null }, { error: null }], events: TableResult = { data: { id: EVENT, type: 'match' }, error: null }) {
    return makeSupabase({ tables: { events }, queues: { tegendoelpunten } })
  }

  it('zet de rij terug met originele id en created_at, team_id uit de sessie', async () => {
    const m = teHerstellen()
    use(m)
    await herstelTegendoelpunt(SNAPSHOT)
    expect(m.calls.insert).toEqual([{
      table: 'tegendoelpunten',
      payload: { id: ID, team_id: TEAM, event_id: EVENT, soort: 'set_piece', minute: 33, created_at: CREATED },
    }])
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}/analysis`)
  })

  it('laat created_at weg bij null (DB-default) en accepteert minuut null', async () => {
    const m = teHerstellen()
    use(m)
    await herstelTegendoelpunt({ ...SNAPSHOT, createdAt: null, minute: null })
    expect(m.calls.insert[0].payload).not.toHaveProperty('created_at')
    expect(m.calls.insert[0].payload.minute).toBeNull()
  })

  it('weigert een snapshot van een ander team, zonder iets te schrijven', async () => {
    const m = teHerstellen()
    use(m)
    await expect(herstelTegendoelpunt({ ...SNAPSHOT, teamId: 'ander-team' })).rejects.toThrow(HERSTEL_FOUT)
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert ongeldige ids, soort, minuut, created_at of discriminator', async () => {
    const m = teHerstellen()
    use(m)
    for (const fout of [
      { ...SNAPSHOT, id: 't1' },
      { ...SNAPSHOT, eventId: 'e1' },
      { ...SNAPSHOT, doelpuntSoort: 'anders' as never },
      { ...SNAPSHOT, minute: 131 },
      { ...SNAPSHOT, minute: 12.5 },
      { ...SNAPSHOT, createdAt: 'gisteren' },
      { ...SNAPSHOT, soort: 'wedstrijdmoment' as never },
      null as unknown as HerstelTegendoelpunt,
    ]) {
      await expect(herstelTegendoelpunt(fout)).rejects.toThrow(HERSTEL_FOUT)
    }
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert als het event geen eigen wedstrijd (meer) is', async () => {
    const m = teHerstellen(undefined, { data: { id: EVENT, type: 'training' }, error: null })
    use(m)
    await expect(herstelTegendoelpunt(SNAPSHOT)).rejects.toThrow(HERSTEL_FOUT)
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert zonder Wedstrijd-recht met "Geen toegang"', async () => {
    const m = zonderWedstrijdRecht()
    use(m)
    await expect(herstelTegendoelpunt(SNAPSHOT)).rejects.toThrow('Geen toegang')
    expect(m.calls.insert).toHaveLength(0)
  })

  it('is idempotent: een rij die al terug is levert geen insert op', async () => {
    const m = teHerstellen([{ data: { id: ID } }])
    use(m)
    await herstelTegendoelpunt(SNAPSHOT)
    expect(m.calls.insert).toHaveLength(0)
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}`)
  })

  it('23505 en de rij bestaat in dit team → succes', async () => {
    use(teHerstellen([{ data: null }, { error: { code: '23505' } }, { data: { id: ID } }]))
    await expect(herstelTegendoelpunt(SNAPSHOT)).resolves.toBeUndefined()
  })

  it('23505 zonder eigen rij → HERSTEL_FOUT', async () => {
    use(teHerstellen([{ data: null }, { error: { code: '23505' } }, { data: null }]))
    await expect(herstelTegendoelpunt(SNAPSHOT)).rejects.toThrow(HERSTEL_FOUT)
  })

  it('andere databasefout → generieke melding zonder ruwe tekst', async () => {
    use(teHerstellen([{ data: null }, { error: { code: '42501', message: 'permission denied' } }]))
    await expect(herstelTegendoelpunt(SNAPSHOT)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(logged()).toContain('tegendoelpunten.herstelTegendoelpunt')
    expect(logged()).not.toContain('permission denied')
  })
})
