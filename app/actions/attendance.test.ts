import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { saveLineup } from '@/app/actions/attendance'

type TableResult = { data?: unknown; error?: unknown }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  type Eq = { col: string; val: unknown }
  const calls = {
    select: [] as { table: string; eqs: Eq[] }[],
    upsert: [] as { table: string; payload: Record<string, unknown>; eqs: Eq[] }[],
  }

  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const eqs: Eq[] = []
    const c: Record<string, unknown> = {}
    c.select = () => { calls.select.push({ table, eqs }); return c }
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    c.upsert = (payload: Record<string, unknown>) => { calls.upsert.push({ table, payload, eqs }); return c }
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

// Standaard: eigen event e1 en twee eigen spelers.
function eigenTeam(extra: Record<string, TableResult> = {}) {
  return makeSupabase({
    tables: {
      events: { data: { id: 'e1' }, error: null },
      players: { data: [{ id: PLAYER_A }, { id: PLAYER_B }], error: null },
      lineups: { data: null, error: null },
      ...extra,
    },
  })
}

const PLAYER_A = '11111111-1111-4111-8111-111111111111'
const PLAYER_B = '22222222-2222-4222-8222-222222222222'
const VREEMDE_SPELER = '33333333-3333-4333-8333-333333333333'

function positie(playerId: string | null) {
  return { player_id: playerId, x: 50, y: 50, position_label: 'CM', position_number: 8 }
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('saveLineup', () => {
  it('slaat eigen spelers op, team-gescoped', async () => {
    const m = eigenTeam()
    use(m)

    await saveLineup('e1', '4-3-3', [positie(PLAYER_A), positie(null)])

    const upsert = m.calls.upsert.find((u) => u.table === 'lineups')!
    expect(upsert.payload.team_id).toBe('team-1')
    expect(upsert.payload.event_id).toBe('e1')
    expect(upsert.payload.positions).toEqual([
      { player_id: PLAYER_A, x: 50, y: 50, position_label: 'CM', position_number: 8 },
      { player_id: null, x: 50, y: 50, position_label: 'CM', position_number: 8 },
    ])
  })

  it('haalt de spelerslijst team-gescoped op', async () => {
    const m = eigenTeam()
    use(m)

    await saveLineup('e1', '4-3-3', [positie(PLAYER_A)])

    const playersSelect = m.calls.select.find((s) => s.table === 'players')!
    expect(playersSelect.eqs).toEqual([{ col: 'team_id', val: 'team-1' }])
  })

  it('weigert een player_id van een ander team', async () => {
    const m = eigenTeam()
    use(m)

    await expect(saveLineup('e1', '4-3-3', [positie(VREEMDE_SPELER)]))
      .rejects.toThrow('Speler niet gevonden')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('weigert een player_id dat geen UUID is', async () => {
    const m = eigenTeam()
    use(m)

    await expect(saveLineup('e1', '4-3-3', [positie('niet-een-uuid')]))
      .rejects.toThrow('Ongeldige speler')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('weigert een absurd lange player_id (geen ongelimiteerde JSONB-waarde)', async () => {
    const m = eigenTeam()
    use(m)

    await expect(saveLineup('e1', '4-3-3', [positie('x'.repeat(100_000))]))
      .rejects.toThrow('Ongeldige speler')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('weigert een opstelling voor een event van een ander team', async () => {
    const m = eigenTeam({ events: { data: null, error: null } })
    use(m)

    await expect(saveLineup('vreemd', '4-3-3', [positie(PLAYER_A)]))
      .rejects.toThrow('Event niet gevonden')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('houdt de bestaande grenzen op formatie en aantal posities aan', async () => {
    use(eigenTeam())

    await expect(saveLineup('e1', 'x'.repeat(21), [])).rejects.toThrow('Ongeldige formatie')
    await expect(saveLineup('e1', '4-3-3', Array.from({ length: 31 }, () => positie(null))))
      .rejects.toThrow('Ongeldige opstelling')
  })

  it('normaliseert coördinaten, label en rugnummer', async () => {
    const m = eigenTeam()
    use(m)

    await saveLineup('e1', '4-3-3', [{
      player_id: PLAYER_B,
      x: 999,
      y: -20,
      position_label: 'een-veel-te-lang-label',
      position_number: 1.5,
    }])

    const upsert = m.calls.upsert.find((u) => u.table === 'lineups')!
    expect(upsert.payload.positions).toEqual([{
      player_id: PLAYER_B,
      x: 100,
      y: 0,
      position_label: 'een-veel-t',
      position_number: undefined,
    }])
  })

  it('geeft een generieke melding bij een databasefout', async () => {
    use(eigenTeam({ lineups: { data: null, error: { code: '42501', message: 'permission denied for table lineups' } } }))

    await expect(saveLineup('e1', '4-3-3', [positie(PLAYER_A)])).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    const logged = consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
    expect(logged).toContain('attendance.saveLineup')
    expect(logged).not.toContain('permission denied')
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    use(makeSupabase({ user: null }))

    await expect(saveLineup('e1', '4-3-3', [])).rejects.toThrow('Niet ingelogd')
  })
})
