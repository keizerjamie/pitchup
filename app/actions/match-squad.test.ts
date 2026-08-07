import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { toggleSquadPlayer } from '@/app/actions/match-squad'

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
    upsert: [] as { table: string; payload: Record<string, unknown>; options: unknown; eqs: Eq[] }[],
    delete: [] as { table: string; eqs: Eq[] }[],
  }

  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const eqs: Eq[] = []
    const c: Record<string, unknown> = {}
    c.select = () => { calls.select.push({ table, eqs }); return c }
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    c.upsert = (payload: Record<string, unknown>, options?: unknown) => {
      calls.upsert.push({ table, payload, options, eqs })
      return c
    }
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

// Standaard: eigen wedstrijd e1 en een eigen speler; de mutatie slaagt.
function eigenTeam(extra: Record<string, TableResult> = {}) {
  return makeSupabase({
    tables: {
      events: { data: { id: 'e1', type: 'match' }, error: null },
      players: { data: { id: PLAYER_A }, error: null },
      match_squad: { data: null, error: null },
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

describe('toggleSquadPlayer — selecteren', () => {
  it('schrijft de selectie team-gescoped weg', async () => {
    const m = eigenTeam()
    use(m)

    await toggleSquadPlayer('e1', PLAYER_A, true)

    const upsert = m.calls.upsert.find((u) => u.table === 'match_squad')!
    expect(upsert.payload).toEqual({ event_id: 'e1', player_id: PLAYER_A, team_id: 'team-1' })
    expect(m.calls.delete).toHaveLength(0)
  })

  it('haalt het event team-gescoped op', async () => {
    const m = eigenTeam()
    use(m)

    await toggleSquadPlayer('e1', PLAYER_A, true)

    const eventsSelect = m.calls.select.find((s) => s.table === 'events')!
    expect(eventsSelect.eqs).toEqual([
      { col: 'id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('revalideert de selectiepagina én de eventpagina', async () => {
    use(eigenTeam())

    await toggleSquadPlayer('e1', PLAYER_A, true)

    expect(revalidatePath).toHaveBeenCalledWith('/events/e1/squad')
    expect(revalidatePath).toHaveBeenCalledWith('/events/e1')
  })

  it('crasht niet als dezelfde speler twee keer wordt toegevoegd (onConflict)', async () => {
    const m = eigenTeam()
    use(m)

    await toggleSquadPlayer('e1', PLAYER_A, true)
    await toggleSquadPlayer('e1', PLAYER_A, true)

    expect(m.calls.upsert).toHaveLength(2)
    for (const upsert of m.calls.upsert) {
      expect(upsert.options).toEqual({ onConflict: 'event_id,player_id', ignoreDuplicates: true })
    }
  })
})

describe('toggleSquadPlayer — deselecteren', () => {
  it('verwijdert de rij met alle drie de filters, inclusief team_id', async () => {
    const m = eigenTeam()
    use(m)

    await toggleSquadPlayer('e1', PLAYER_A, false)

    const del = m.calls.delete.find((d) => d.table === 'match_squad')!
    expect(del.eqs).toEqual([
      { col: 'event_id', val: 'e1' },
      { col: 'player_id', val: PLAYER_A },
      { col: 'team_id', val: 'team-1' },
    ])
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('revalideert de selectiepagina én de eventpagina', async () => {
    use(eigenTeam())

    await toggleSquadPlayer('e1', PLAYER_A, false)

    expect(revalidatePath).toHaveBeenCalledWith('/events/e1/squad')
    expect(revalidatePath).toHaveBeenCalledWith('/events/e1')
  })
})

describe('toggleSquadPlayer — weigeringen', () => {
  it('weigert zonder ingelogde gebruiker', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(toggleSquadPlayer('e1', PLAYER_A, true)).rejects.toThrow('Niet ingelogd')
    expect(m.calls.upsert).toHaveLength(0)
    expect(m.calls.delete).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een event van een ander team', async () => {
    const m = eigenTeam({ events: { data: null, error: null } })
    use(m)

    await expect(toggleSquadPlayer('vreemd', PLAYER_A, true)).rejects.toThrow('Event niet gevonden')
    expect(m.calls.upsert).toHaveLength(0)
    expect(m.calls.delete).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een event dat geen wedstrijd is', async () => {
    const m = eigenTeam({ events: { data: { id: 'e1', type: 'training' }, error: null } })
    use(m)

    await expect(toggleSquadPlayer('e1', PLAYER_A, true)).rejects.toThrow('Event niet gevonden')
    expect(m.calls.upsert).toHaveLength(0)
    expect(m.calls.delete).toHaveLength(0)
  })

  it('weigert een speler van een ander team', async () => {
    const m = eigenTeam({ players: { data: null, error: null } })
    use(m)

    await expect(toggleSquadPlayer('e1', PLAYER_A, true)).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.upsert).toHaveLength(0)
    expect(m.calls.delete).toHaveLength(0)
  })

  it('weigert een selectie-waarde die geen boolean is', async () => {
    const m = eigenTeam()
    use(m)

    await expect(toggleSquadPlayer('e1', PLAYER_A, 'ja' as unknown as boolean))
      .rejects.toThrow('Ongeldige selectie')
    expect(m.calls.upsert).toHaveLength(0)
    expect(m.calls.delete).toHaveLength(0)
  })

  it('geeft een generieke melding bij een databasefout tijdens selecteren', async () => {
    use(eigenTeam({
      match_squad: { data: null, error: { code: '23505', message: 'Key (event_id, player_id)=(e1, p1) already exists' } },
    }))

    await expect(toggleSquadPlayer('e1', PLAYER_A, true)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('match-squad.toggleSquadPlayer')
    expect(logged()).toContain('23505')
    expect(logged()).not.toContain('already exists')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('geeft een generieke melding bij een databasefout tijdens deselecteren', async () => {
    use(eigenTeam({
      match_squad: { data: null, error: { code: '42501', message: 'permission denied for table match_squad' } },
    }))

    await expect(toggleSquadPlayer('e1', PLAYER_A, false)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('match-squad.toggleSquadPlayer')
    expect(logged()).not.toContain('permission denied')
  })
})
