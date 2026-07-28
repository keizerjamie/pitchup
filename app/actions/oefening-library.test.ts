import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OefeningInput } from '@/lib/oefening'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import {
  createOefening,
  updateOefening,
  deleteOefening,
} from '@/app/actions/oefening-library'

type TableResult = { data?: unknown; error?: unknown; count?: number }

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

const baseInput = (over: Partial<OefeningInput> = {}): OefeningInput => ({
  naam: 'Rondo',
  categorie: 'partijen_klein',
  teams: [],
  aantal_neutralen: 0,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createOefening', () => {
  it('slaagt zonder teams en geeft het nieuwe id terug', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'new-id' }, error: null } } })
    use(m)
    const res = await createOefening(baseInput())
    expect(res).toEqual({ id: 'new-id' })
    expect(m.calls.insert[0].payload.team_id).toBe('team-1')
    expect(m.calls.insert[0].payload.teams).toEqual([])
  })

  it('slaagt met asymmetrische teams van verschillende grootte', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({
      teams: [
        { grootte: 4, formatie: '2-1' },
        { grootte: 6, formatie: '3-2' },
        { grootte: 8, formatie: null },
      ],
    }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 4, formatie: '2-1' },
      { grootte: 6, formatie: '3-2' },
      { grootte: 8, formatie: null },
    ])
  })

  it('slaagt met aantal_neutralen > 0', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({ aantal_neutralen: 3 }))
    expect(m.calls.insert[0].payload.aantal_neutralen).toBe(3)
  })

  it('faalt wanneer de formatie niet bij de teamgrootte past', async () => {
    use(makeSupabase())
    await expect(createOefening(baseInput({ teams: [{ grootte: 6, formatie: '4-3-3' }] })))
      .rejects.toThrow('Formatie past niet bij teamgrootte')
  })

  it('faalt bij een ongeldige teamgrootte', async () => {
    use(makeSupabase())
    await expect(createOefening(baseInput({ teams: [{ grootte: 10, formatie: null }] })))
      .rejects.toThrow('Ongeldige teamgrootte')
  })

  it('faalt wanneer niet ingelogd', async () => {
    use(makeSupabase({ user: null }))
    await expect(createOefening(baseInput())).rejects.toThrow('Niet ingelogd')
  })

  it('accepteert de nieuwe categorieën warming_up/positiespel/pass_trap', async () => {
    for (const categorie of ['warming_up', 'positiespel', 'pass_trap'] as const) {
      const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
      use(m)
      await createOefening(baseInput({ categorie }))
      expect(m.calls.insert[0].payload.categorie).toBe(categorie)
    }
  })

  it('faalt bij een onbekende categorie', async () => {
    use(makeSupabase())
    await expect(
      createOefening(baseInput({ categorie: 'onzin' as OefeningInput['categorie'] })),
    ).rejects.toThrow('Ongeldige categorie')
  })

  it('clamped teams naar maximaal 6', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({
      teams: Array.from({ length: 8 }, () => ({ grootte: 3, formatie: null })),
    }))
    expect((m.calls.insert[0].payload.teams as unknown[]).length).toBe(6)
  })

  it('clamped aantal_neutralen naar 0..30', async () => {
    const hi = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(hi)
    await createOefening(baseInput({ aantal_neutralen: 99 }))
    expect(hi.calls.insert[0].payload.aantal_neutralen).toBe(30)

    const lo = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(lo)
    await createOefening(baseInput({ aantal_neutralen: -5 }))
    expect(lo.calls.insert[0].payload.aantal_neutralen).toBe(0)
  })

  it('clamped duur_min naar 0..600 en behoudt null', async () => {
    const hi = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(hi)
    await createOefening(baseInput({ duur_min: 5000 }))
    expect(hi.calls.insert[0].payload.duur_min).toBe(600)

    const nul = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(nul)
    await createOefening(baseInput({ duur_min: null }))
    expect(nul.calls.insert[0].payload.duur_min).toBeNull()
  })

  it('clamped breedte_m / lengte_m naar 0..999.9 (1 decimaal)', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({ breedte_m: 99999, lengte_m: -3.14 }))
    expect(m.calls.insert[0].payload.breedte_m).toBe(999.9)
    expect(m.calls.insert[0].payload.lengte_m).toBe(0)
  })

  it('stript onbekende velden uit een team', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({
      teams: [{ grootte: 6, formatie: null, foo: 'bar' } as unknown as OefeningInput['teams'][number]],
    }))
    const team = (m.calls.insert[0].payload.teams as Record<string, unknown>[])[0]
    expect(team).toEqual({ grootte: 6, formatie: null })
    expect('foo' in team).toBe(false)
  })
})

describe('updateOefening / deleteOefening (tenant-isolatie)', () => {
  it('update op een oefening van een ander team → niet gevonden', async () => {
    use(makeSupabase({ tables: { oefeningen: { data: null } } }))
    await expect(updateOefening('other', baseInput())).rejects.toThrow('Oefening niet gevonden')
  })

  it('delete op een oefening van een ander team → niet gevonden', async () => {
    use(makeSupabase({ tables: { oefeningen: { data: null } } }))
    await expect(deleteOefening('other')).rejects.toThrow('Oefening niet gevonden')
  })
})
