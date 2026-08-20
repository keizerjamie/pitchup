import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// getDefaultAttendance leest zelf de settings-tabel; hier vastgezet zodat deze
// tests alleen over players gaan (zelfde aanpak als app/actions/events.test.ts).
vi.mock('@/app/actions/settings', () => ({ getDefaultAttendance: vi.fn(async () => 'present') }))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { createPlayer, markRecovered, updatePlayer } from '@/app/actions/players'

type TableResult = { data?: unknown; error?: unknown }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  type Filter = { op: string; col: string; val: unknown }
  const calls = {
    select: [] as { table: string; filters: Filter[] }[],
    insert: [] as { table: string; payload: unknown }[],
    update: [] as { table: string; payload: Record<string, unknown>; filters: Filter[] }[],
    upsert: [] as { table: string; payload: unknown }[],
  }

  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const filters: Filter[] = []
    const c: Record<string, unknown> = {}
    c.select = () => { calls.select.push({ table, filters }); return c }
    // `.is()` hoort erbij sinds markRecovered rijen met een afmeldperiode
    // overslaat; zonder deze regel zou de mock stilzwijgend een andere query
    // testen dan de code doet.
    for (const op of ['eq', 'neq', 'gte', 'lte', 'in', 'is']) {
      c[op] = (col: string, val: unknown) => { filters.push({ op, col, val }); return c }
    }
    c.insert = (payload: unknown) => { calls.insert.push({ table, payload }); return c }
    c.update = (payload: Record<string, unknown>) => { calls.update.push({ table, payload, filters }); return c }
    c.upsert = (payload: unknown) => { calls.upsert.push({ table, payload }); return c }
    c.maybeSingle = () => Promise.resolve(result)
    c.single = () => Promise.resolve(result)
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
    return c
  }

  const supabase = {
    from: (t: string) => chain(t),
    auth: { getUser: async () => ({ data: { user } }) },
  }
  return { supabase, calls }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

const PLAYER_A = '11111111-1111-4111-8111-111111111111'

// Eigen speler, één toekomstig event.
function eigenTeam(extra: Record<string, TableResult> = {}) {
  return makeSupabase({
    tables: {
      players: { data: { id: PLAYER_A }, error: null },
      events: { data: [{ id: 'e1' }], error: null },
      attendance: { data: null, error: null },
      ...extra,
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

// De eerste attendance-update is het herstel naar de standaardstatus, de tweede
// het opschonen van de blessurevlag (app/actions/players.ts:191-211).
function updates(m: ReturnType<typeof makeSupabase>) {
  return m.calls.update.filter((u) => u.table === 'attendance')
}

describe('markRecovered', () => {
  it('zet alleen door-blessure-gezette rijen ZONDER afmeldperiode terug naar de standaardstatus', async () => {
    const m = eigenTeam()
    use(m)

    await markRecovered(PLAYER_A)

    const restore = updates(m)[0]
    expect(restore.payload).toEqual({ status: 'present', injury_set: false })
    expect(restore.filters).toContainEqual({ op: 'is', col: 'absence_period_id', val: null })
  })

  it('werkt team- en spelergescoped bij, alleen voor toekomstige events', async () => {
    const m = eigenTeam()
    use(m)

    await markRecovered(PLAYER_A)

    expect(updates(m)[0].filters).toEqual([
      { op: 'eq', col: 'team_id', val: 'team-1' },
      { op: 'eq', col: 'player_id', val: PLAYER_A },
      { op: 'eq', col: 'injury_set', val: true },
      { op: 'eq', col: 'status', val: 'absent' },
      { op: 'is', col: 'absence_period_id', val: null },
      { op: 'in', col: 'event_id', val: ['e1'] },
    ])
  })

  it('laat een rij MET afmeldperiode op absent staan: die krijgt alleen de blessurevlag uit', async () => {
    // De rij valt buiten de herstel-update (die filtert op absence_period_id IS
    // NULL) en wordt daarna alleen nog opgeschoond — zonder status-wijziging,
    // want de afmeldperiode houdt de speler afwezig.
    const m = eigenTeam()
    use(m)

    await markRecovered(PLAYER_A)

    const clear = updates(m)[1]
    expect(clear.payload).toEqual({ injury_set: false })
    expect(clear.payload).not.toHaveProperty('status')
    expect(clear.filters).toEqual([
      { op: 'eq', col: 'team_id', val: 'team-1' },
      { op: 'eq', col: 'player_id', val: PLAYER_A },
      { op: 'eq', col: 'injury_set', val: true },
    ])
  })

  it('schoont de blessurevlag ook op zonder toekomstige events', async () => {
    const m = eigenTeam({ events: { data: [], error: null } })
    use(m)

    await markRecovered(PLAYER_A)

    expect(updates(m)).toHaveLength(1)
    expect(updates(m)[0].payload).toEqual({ injury_set: false })
  })

  it('zet de speler op hersteld en revalideert', async () => {
    const m = eigenTeam()
    use(m)

    await markRecovered(PLAYER_A)

    const player = m.calls.update.find((u) => u.table === 'players')!
    expect(player.payload).toEqual({ injured: false })
    expect(player.filters).toEqual([
      { op: 'eq', col: 'id', val: PLAYER_A },
      { op: 'eq', col: 'team_id', val: 'team-1' },
    ])
    expect(revalidatePath).toHaveBeenCalledWith('/players')
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('weigert een speler van een ander team en werkt dan niets bij', async () => {
    const m = eigenTeam({ players: { data: null, error: null } })
    use(m)

    await expect(markRecovered(PLAYER_A)).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    use(makeSupabase({ user: null }))

    await expect(markRecovered(PLAYER_A)).rejects.toThrow('Niet ingelogd')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('geeft een generieke melding bij een databasefout en lekt niets', async () => {
    use(eigenTeam({
      attendance: { data: null, error: { code: '42501', message: 'permission denied for table attendance' } },
    }))

    await expect(markRecovered(PLAYER_A)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('players.markRecovered.restore')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────
// markRecovered — gastspelers (O2)
// ────────────────────────────────────────────────
// Herstellen van een blessure zet toekomstige rijen terug naar de
// teamstandaard. Voor een gastspeler is die standaard 'absent': hij komt alleen
// op 'present' als de trainer hem daar handmatig op zet.

describe('markRecovered — gastspeler', () => {
  it('zet de rijen van een GAST terug naar absent in plaats van de teamstandaard', async () => {
    const m = eigenTeam({ players: { data: { id: PLAYER_A, type: 'guest' }, error: null } })
    use(m)

    await markRecovered(PLAYER_A)

    expect(updates(m)[0].payload).toEqual({ status: 'absent', injury_set: false })
  })

  it('zet de rijen van een REGULIERE speler wél terug naar de teamstandaard', async () => {
    // Zelfde call, alleen een ander type: het verschil zit uitsluitend in de
    // statusregel uit lib/attendance-rows.ts.
    const m = eigenTeam({ players: { data: { id: PLAYER_A, type: 'regular' }, error: null } })
    use(m)

    await markRecovered(PLAYER_A)

    expect(updates(m)[0].payload).toEqual({ status: 'present', injury_set: false })
  })

  it('haalt het type team-gescoped op', async () => {
    const m = eigenTeam({ players: { data: { id: PLAYER_A, type: 'guest' }, error: null } })
    use(m)

    await markRecovered(PLAYER_A)

    // Twee players-selects: assertOwnPlayer en de type-query. Beide dragen
    // id + team_id.
    const playerSelects = m.calls.select.filter((s) => s.table === 'players')
    expect(playerSelects).toHaveLength(2)
    for (const sel of playerSelects) {
      expect(sel.filters).toEqual([
        { op: 'eq', col: 'id', val: PLAYER_A },
        { op: 'eq', col: 'team_id', val: 'team-1' },
      ])
    }
  })

  it('laat de blessurevlag-opschoning ongemoeid voor een gast (status blijft absent)', async () => {
    const m = eigenTeam({ players: { data: { id: PLAYER_A, type: 'guest' }, error: null } })
    use(m)

    await markRecovered(PLAYER_A)

    const clear = updates(m)[1]
    expect(clear.payload).toEqual({ injury_set: false })
    expect(clear.payload).not.toHaveProperty('status')
  })
})

// ────────────────────────────────────────────────
// createPlayer / updatePlayer — spelertype (AC1, AC4, AC17, AC21, AC22)
// ────────────────────────────────────────────────

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const BASIS = { name: 'Piet Peters', position: 'Spits' }

function inserts(m: ReturnType<typeof makeSupabase>) {
  return m.calls.insert.filter((i) => i.table === 'players')
}

describe('createPlayer — spelertype', () => {
  it('slaat een gastspeler op als type guest, actief en team-gescoped (AC1)', async () => {
    const m = eigenTeam()
    use(m)

    await createPlayer(form({ ...BASIS, type: 'guest' }))

    expect(inserts(m)).toHaveLength(1)
    expect(inserts(m)[0].payload).toMatchObject({
      name: 'Piet Peters',
      position: 'Spits',
      type: 'guest',
      // Een gast is gewoon actief; type staat los van active.
      active: true,
      team_id: 'team-1',
    })
  })

  it('valt terug op regular als het formulier geen type meestuurt', async () => {
    const m = eigenTeam()
    use(m)

    await createPlayer(form(BASIS))

    expect((inserts(m)[0].payload as Record<string, unknown>).type).toBe('regular')
  })

  it('behandelt een leeg type als regular', async () => {
    const m = eigenTeam()
    use(m)

    await createPlayer(form({ ...BASIS, type: '' }))

    expect((inserts(m)[0].payload as Record<string, unknown>).type).toBe('regular')
  })

  it('weigert een type buiten de whitelist en maakt niets aan (AC21)', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createPlayer(form({ ...BASIS, type: 'vip' }))).rejects.toThrow('Ongeldig spelertype')
    expect(m.calls.insert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('houdt position verplicht, ook voor een gast (AC4)', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createPlayer(form({ name: 'Piet Peters', type: 'guest' })))
      .rejects.toThrow('Ongeldige positie')
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert zonder ingelogde gebruiker en raakt de database niet (AC22)', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(createPlayer(form({ ...BASIS, type: 'guest' }))).rejects.toThrow('Niet ingelogd')
    expect(m.calls.insert).toHaveLength(0)
    expect(m.calls.select).toHaveLength(0)
  })
})

describe('updatePlayer — spelertype', () => {
  it('schrijft een gewijzigd type weg, gescoped op id én team_id (AC17)', async () => {
    const m = eigenTeam()
    use(m)

    await updatePlayer(PLAYER_A, form({ ...BASIS, type: 'regular', active: 'true' }))

    const update = m.calls.update.find((u) => u.table === 'players')!
    expect(update.payload).toMatchObject({ type: 'regular', active: true })
    expect(update.filters).toEqual([
      { op: 'eq', col: 'id', val: PLAYER_A },
      { op: 'eq', col: 'team_id', val: 'team-1' },
    ])
  })

  it('kan een reguliere speler alsnog gast maken', async () => {
    const m = eigenTeam()
    use(m)

    await updatePlayer(PLAYER_A, form({ ...BASIS, type: 'guest', active: 'true' }))

    expect(m.calls.update.find((u) => u.table === 'players')!.payload).toMatchObject({ type: 'guest' })
  })

  it('weigert een ongeldig type en werkt niets bij (AC21)', async () => {
    const m = eigenTeam()
    use(m)

    await expect(updatePlayer(PLAYER_A, form({ ...BASIS, type: 'vip' })))
      .rejects.toThrow('Ongeldig spelertype')
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert zonder ingelogde gebruiker (AC22)', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(updatePlayer(PLAYER_A, form({ ...BASIS, type: 'guest' }))).rejects.toThrow('Niet ingelogd')
    expect(m.calls.update).toHaveLength(0)
  })
})
