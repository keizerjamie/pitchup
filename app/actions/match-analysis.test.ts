import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import {
  saveMatchResult,
  saveMatchRating,
  addMatchEvent,
  deleteMatchEvent,
} from '@/app/actions/match-analysis'

type TableResult = { data?: unknown; error?: unknown }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  type Eq = { col: string; val: unknown }
  const calls = {
    insert: [] as { table: string; payload: Record<string, unknown> }[],
    update: [] as { table: string; payload: Record<string, unknown>; eqs: Eq[] }[],
    upsert: [] as { table: string; payload: Record<string, unknown> }[],
    delete: [] as { table: string; eqs: Eq[] }[],
  }

  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const eqs: Eq[] = []
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push({ table, payload }); return c }
    c.update = (payload: Record<string, unknown>) => { calls.update.push({ table, payload, eqs }); return c }
    c.upsert = (payload: Record<string, unknown>) => { calls.upsert.push({ table, payload }); return c }
    c.delete = () => { calls.delete.push({ table, eqs }); return c }
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

// Standaard: eigen event e1 en eigen speler; mutaties slagen.
function eigenTeam(extra: Record<string, TableResult> = {}) {
  return makeSupabase({
    tables: {
      events: { data: { id: 'e1' }, error: null },
      players: { data: { id: PLAYER_A }, error: null },
      match_ratings: { data: null, error: null },
      match_events: { data: null, error: null },
      ...extra,
    },
  })
}

// assertOwnEvent/assertOwnPlayer lezen dezelfde tabel als de mutatie erna;
// `data` blijft daarom gevuld zodat de tenant-check slaagt en pas de mutatie faalt.
const eventsFout = {
  data: { id: 'e1' },
  error: { code: '42501', message: 'permission denied for table events' },
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

describe('saveMatchResult', () => {
  it('slaat de doelpunten team-gescoped op', async () => {
    const m = eigenTeam()
    use(m)

    await saveMatchResult('e1', 3, 1)

    const update = m.calls.update.find((u) => u.table === 'events')!
    expect(update.payload).toEqual({ goals_for: 3, goals_against: 1 })
    expect(update.eqs).toEqual([
      { col: 'id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
      { col: 'type', val: 'match' },
    ])
  })

  it('weigert een event van een ander team', async () => {
    const m = eigenTeam({ events: { data: null, error: null } })
    use(m)

    await expect(saveMatchResult('vreemd', 1, 0)).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    use(makeSupabase({ user: null }))
    await expect(saveMatchResult('e1', 1, 0)).rejects.toThrow('Niet ingelogd')
  })

  it('geeft een generieke melding bij een databasefout', async () => {
    use(eigenTeam({ events: eventsFout }))

    await expect(saveMatchResult('e1', 1, 0)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('matchAnalysis.saveMatchResult')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
  })
})

describe('saveMatchRating', () => {
  it('slaat een rating team-gescoped op', async () => {
    const m = eigenTeam()
    use(m)

    await saveMatchRating('e1', PLAYER_A, 7)

    const upsert = m.calls.upsert.find((u) => u.table === 'match_ratings')!
    expect(upsert.payload).toEqual({ event_id: 'e1', player_id: PLAYER_A, rating: 7, team_id: 'team-1' })
  })

  it('verwijdert de rating bij null, team-gescoped', async () => {
    const m = eigenTeam()
    use(m)

    await saveMatchRating('e1', PLAYER_A, null)

    const del = m.calls.delete.find((d) => d.table === 'match_ratings')!
    expect(del.eqs).toEqual([
      { col: 'event_id', val: 'e1' },
      { col: 'player_id', val: PLAYER_A },
      { col: 'team_id', val: 'team-1' },
    ])
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('weigert een speler van een ander team', async () => {
    const m = eigenTeam({ players: { data: null, error: null } })
    use(m)

    await expect(saveMatchRating('e1', PLAYER_A, 7)).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('weigert een ongeldige rating', async () => {
    use(eigenTeam())
    await expect(saveMatchRating('e1', PLAYER_A, 99)).rejects.toThrow('Ongeldige rating')
  })

  it('geeft een generieke melding bij een databasefout op de upsert', async () => {
    use(eigenTeam({
      match_ratings: { data: null, error: { code: '23503', message: 'Key (player_id)=(...) is not present' } },
    }))

    await expect(saveMatchRating('e1', PLAYER_A, 7)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('matchAnalysis.saveMatchRating')
    expect(logged()).not.toContain('is not present')
  })

  it('geeft een generieke melding bij een databasefout op de delete', async () => {
    use(eigenTeam({
      match_ratings: { data: null, error: { code: '42501', message: 'permission denied for table match_ratings' } },
    }))

    await expect(saveMatchRating('e1', PLAYER_A, null)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('matchAnalysis.saveMatchRating.delete')
    expect(logged()).not.toContain('permission denied')
  })
})

describe('addMatchEvent', () => {
  it('voegt de gebeurtenis team-gescoped toe', async () => {
    const m = eigenTeam()
    use(m)

    await addMatchEvent('e1', PLAYER_A, 'goal', 12)

    const insert = m.calls.insert.find((i) => i.table === 'match_events')!
    expect(insert.payload).toEqual({
      event_id: 'e1', player_id: PLAYER_A, kind: 'goal', minute: 12, team_id: 'team-1',
    })
  })

  it('weigert een onbekende soort en een ongeldige minuut', async () => {
    use(eigenTeam())
    await expect(addMatchEvent('e1', PLAYER_A, 'onzin' as 'goal', 5)).rejects.toThrow('Ongeldige gebeurtenis')
    await expect(addMatchEvent('e1', PLAYER_A, 'goal', 999)).rejects.toThrow('Ongeldige minuut')
  })

  it('geeft een generieke melding bij een databasefout', async () => {
    use(eigenTeam({
      match_events: { data: null, error: { code: '23514', message: 'violates check constraint match_events_minute_check' } },
    }))

    await expect(addMatchEvent('e1', PLAYER_A, 'goal', 12)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('matchAnalysis.addMatchEvent')
    expect(logged()).not.toContain('check constraint')
  })
})

describe('deleteMatchEvent', () => {
  it('verwijdert team-gescoped', async () => {
    const m = eigenTeam()
    use(m)

    await deleteMatchEvent('me1', 'e1')

    const del = m.calls.delete.find((d) => d.table === 'match_events')!
    expect(del.eqs).toEqual([
      { col: 'id', val: 'me1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    use(makeSupabase({ user: null }))
    await expect(deleteMatchEvent('me1', 'e1')).rejects.toThrow('Niet ingelogd')
  })

  it('geeft een generieke melding bij een databasefout', async () => {
    use(eigenTeam({
      match_events: { data: null, error: { code: '42501', message: 'permission denied for table match_events' } },
    }))

    await expect(deleteMatchEvent('me1', 'e1')).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('matchAnalysis.deleteMatchEvent')
    expect(logged()).not.toContain('permission denied')
  })
})
