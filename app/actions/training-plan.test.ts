import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import {
  addOefeningToTraining,
  createAndAddOefening,
  removeOefeningFromTraining,
  updateKoppeling,
  reorderKoppelingen,
  saveSpelerindeling,
} from '@/app/actions/training-plan'

type TableResult = { data?: unknown; error?: unknown }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const calls = {
    insert: [] as { table: string; payload: Record<string, unknown> }[],
    update: [] as { table: string; payload: Record<string, unknown> }[],
    delete: [] as { table: string }[],
    eq: [] as { table: string; col: string; val: unknown }[],
  }
  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq']) {
      c[m] = () => c
    }
    c.eq = (col: string, val: unknown) => { calls.eq.push({ table, col, val }); return c }
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push({ table, payload }); return c }
    c.update = (payload: Record<string, unknown>) => { calls.update.push({ table, payload }); return c }
    c.delete = () => { calls.delete.push({ table }); return c }
    c.single = () => Promise.resolve(result)
    c.maybeSingle = () => Promise.resolve(result)
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('addOefeningToTraining', () => {
  it('gebruikt volgorde = max + 1', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o1' } },
        training_oefeningen: { data: { volgorde: 4 }, error: null },
      },
    })
    use(m)
    await addOefeningToTraining('e1', 'o1')
    const insert = m.calls.insert.find((i) => i.table === 'training_oefeningen')!
    expect(insert.payload.volgorde).toBe(5)
    expect(insert.payload.team_id).toBe('team-1')
    expect(insert.payload.event_id).toBe('e1')
    expect(insert.payload.oefening_id).toBe('o1')
  })

  it('gooit "Oefening niet gevonden" bij een oefening van een ander team', async () => {
    use(makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: null },
      },
    }))
    await expect(addOefeningToTraining('e1', 'vreemd')).rejects.toThrow('Oefening niet gevonden')
  })

  it('handelt een UNIQUE-conflict idempotent af (geen error)', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o1' } },
        training_oefeningen: { data: null, error: { code: '23505', message: 'duplicate' } },
      },
    })
    use(m)
    await expect(addOefeningToTraining('e1', 'o1')).resolves.toBeUndefined()
  })
})

describe('updateKoppeling', () => {
  it('raakt alleen de opgegeven koppeling van dit team', async () => {
    const m = makeSupabase({ tables: { training_oefeningen: { data: { id: 'k1' }, error: null } } })
    use(m)
    await updateKoppeling('k1', 'e1', { stap_override: 5 })
    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].table).toBe('training_oefeningen')
    expect(m.calls.update[0].payload.stap_override).toBe(5)
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'id', val: 'k1' })
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'team_id', val: 'team-1' })
  })
})

describe('removeOefeningFromTraining', () => {
  it('verwijdert alleen de koppeling, niet het bibliotheekitem', async () => {
    const m = makeSupabase({ tables: { training_oefeningen: { error: null } } })
    use(m)
    await removeOefeningFromTraining('k1', 'e1')
    expect(m.calls.delete).toContainEqual({ table: 'training_oefeningen' })
    expect(m.calls.delete.some((d) => d.table === 'oefeningen')).toBe(false)
  })
})

describe('reorderKoppelingen', () => {
  it('werkt volgorde per koppeling bij, tenant-gescoped', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k' }, error: null },
      },
    })
    use(m)
    await reorderKoppelingen('e1', ['k3', 'k1', 'k2'])

    // Eén update per koppeling, met de nieuwe index als volgorde.
    expect(m.calls.update).toHaveLength(3)
    expect(m.calls.update.every((u) => u.table === 'training_oefeningen')).toBe(true)
    expect(m.calls.update.map((u) => u.payload.volgorde)).toEqual([0, 1, 2])

    // Elke update is gescoped op id + event_id + team_id.
    for (const id of ['k3', 'k1', 'k2']) {
      expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'id', val: id })
    }
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'event_id', val: 'e1' })
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'team_id', val: 'team-1' })
  })

  it('respecteert assertOwnEvent (event van ander team → niet gevonden)', async () => {
    const m = makeSupabase({ tables: { events: { data: null } } })
    use(m)
    await expect(reorderKoppelingen('vreemd', ['k1'])).rejects.toThrow('Event niet gevonden')
    // Geen enkele koppeling aangeraakt.
    expect(m.calls.update).toHaveLength(0)
  })
})

describe('saveSpelerindeling', () => {
  const twoTeams = { teams: [{ grootte: 6, formatie: null }, { grootte: 6, formatie: null }] }

  it('schrijft de genormaliseerde indeling alleen naar training_oefeningen, tenant-gescoped', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k1', oefeningen: twoTeams }, error: null },
        players: { data: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] },
      },
    })
    use(m)
    await saveSpelerindeling('k1', 'e1', [['p1'], ['p2']])

    // Precies één update, uitsluitend op training_oefeningen (nooit oefeningen).
    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].table).toBe('training_oefeningen')
    expect(m.calls.update[0].payload.spelerindeling).toEqual([['p1'], ['p2']])
    expect(m.calls.update.some((u) => u.table === 'oefeningen')).toBe(false)

    // Update is gescoped op id + team_id.
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'id', val: 'k1' })
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'team_id', val: 'team-1' })
  })

  it('scoped de players-validatiequery (voor toegestane player_id\'s) op team_id van de ingelogde user', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k1', oefeningen: twoTeams }, error: null },
        players: { data: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] },
      },
    })
    use(m)
    await saveSpelerindeling('k1', 'e1', [['p1'], ['p2']])

    // Valt deze scoping ooit weg, dan accepteert validateSpelerindeling
    // player_id's van een ander team — alleen RLS zou dat dan nog afvangen.
    expect(m.calls.eq).toContainEqual({ table: 'players', col: 'team_id', val: 'team-1' })
  })

  it('gooit "Niet ingelogd" zonder user', async () => {
    use(makeSupabase({ user: null }))
    await expect(saveSpelerindeling('k1', 'e1', [])).rejects.toThrow('Niet ingelogd')
  })

  it('gooit "Event niet gevonden" bij een event van een ander team', async () => {
    const m = makeSupabase({ tables: { events: { data: null } } })
    use(m)
    await expect(saveSpelerindeling('k1', 'vreemd', [])).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Koppeling niet gevonden" bij een koppeling van een ander team', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: null },
      },
    })
    use(m)
    await expect(saveSpelerindeling('vreemd', 'e1', [])).rejects.toThrow('Koppeling niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Speler niet gevonden" bij een player_id buiten de tenant', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k1', oefeningen: twoTeams }, error: null },
        players: { data: [{ id: 'p1' }] },
      },
    })
    use(m)
    await expect(saveSpelerindeling('k1', 'e1', [['p1', 'vreemd']])).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Team bestaat niet in deze oefening" bij een teamIndex buiten de teams-lengte', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k1', oefeningen: { teams: [{ grootte: 6, formatie: null }] } }, error: null },
        players: { data: [{ id: 'p1' }, { id: 'p2' }] },
      },
    })
    use(m)
    await expect(saveSpelerindeling('k1', 'e1', [['p1'], ['p2']]))
      .rejects.toThrow('Team bestaat niet in deze oefening')
    expect(m.calls.update).toHaveLength(0)
  })
})

describe('createAndAddOefening', () => {
  const input = {
    naam: 'Rondo',
    categorie: 'partijen_klein' as const,
    teams: [],
    aantal_neutralen: 0,
  }

  it('propageert een fout bij het koppelen (geen halve staat)', async () => {
    // Oefening-insert slaagt (geeft id terug), maar de koppel-insert faalt.
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o-new' }, error: null },
        training_oefeningen: { data: null, error: { code: 'XXXXX', message: 'link kapot' } },
      },
    })
    use(m)
    await expect(createAndAddOefening('e1', input)).rejects.toThrow('link kapot')
    // De bibliotheek-oefening is wel aangemaakt; de koppeling-insert is geprobeerd.
    expect(m.calls.insert.some((i) => i.table === 'oefeningen')).toBe(true)
    expect(m.calls.insert.some((i) => i.table === 'training_oefeningen')).toBe(true)
  })
})
