import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { OefeningInput } from '@/lib/oefening'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
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
        { grootte: 4, formaties: ['2-0-1'] },
        { grootte: 6, formaties: ['3-0-2'] },
        { grootte: 8, formaties: [] },
      ],
    }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 4, formaties: ['2-0-1'], keeperInGrootte: true },
      { grootte: 6, formaties: ['3-0-2'], keeperInGrootte: true },
      { grootte: 8, formaties: [], keeperInGrootte: true },
    ])
  })

  it('slaat een binnengekomen label canoniek op als key', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    // '3-2' is het LABEL van compositie 3V-0M-2A.
    await createOefening(baseInput({ teams: [{ grootte: 6, formaties: ['3-2'] }] }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 6, formaties: ['3-0-2'], keeperInGrootte: true },
    ])
  })

  it('weigert meer dan één formatie per team', async () => {
    use(makeSupabase())
    await expect(createOefening(baseInput({ teams: [{ grootte: 4, formaties: ['2-0-1', '1-0-2'] }] })))
      .rejects.toThrow('Maximaal één formatie per team')
  })

  it('weigert meer dan één formatie ook bij een 11-tal', async () => {
    use(makeSupabase())
    await expect(
      createOefening(baseInput({ teams: [{ grootte: 11, formaties: ['5-3-2', '3-4-3'] }] })),
    ).rejects.toThrow('Maximaal één formatie per team')
  })

  it('ontdubbelt herhaalde formaties (blijft daarmee binnen het maximum van 1)', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({ teams: [{ grootte: 6, formaties: ['3-0-2', '3-0-2'] }] }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 6, formaties: ['3-0-2'], keeperInGrootte: true },
    ])
  })

  it('een lege selectie blijft een lege array (= geen formatie)', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({ teams: [{ grootte: 6, formaties: [] }] }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 6, formaties: [], keeperInGrootte: true },
    ])
  })

  it('dual-read: legacy invoer {grootte, formatie} wordt als nieuwe vorm weggeschreven', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({
      teams: [
        { grootte: 4, formatie: '2-1' },
        { grootte: 6, formatie: null },
      ] as unknown as OefeningInput['teams'],
    }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 4, formaties: ['2-0-1'], keeperInGrootte: true },
      { grootte: 6, formaties: [], keeperInGrootte: true },
    ])
  })

  it('slaat keeperInGrootte false op: het team speelt zonder keeper', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    // Zonder keeper zijn er 6 veldspelers, dus '3-2-1' past (met keeper zou dat niet).
    await createOefening(baseInput({
      teams: [{ grootte: 6, formaties: ['3-2-1'], keeperInGrootte: false }],
    }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 6, formaties: ['3-2-1'], keeperInGrootte: false },
    ])
  })

  it('een formatie die alleen zonder keeper past, faalt met keeper', async () => {
    use(makeSupabase())
    await expect(
      createOefening(baseInput({ teams: [{ grootte: 6, formaties: ['3-2-1'] }] })),
    ).rejects.toThrow('Formatie past niet bij teamgrootte')
  })

  it('grootte 11 forceert keeperInGrootte true, ongeacht de invoer', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({
      teams: [{ grootte: 11, formaties: ['4-3-3'], keeperInGrootte: false }],
    }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 11, formaties: ['4-3-3'], keeperInGrootte: true },
    ])
  })

  it('accepteert grootte 10 (nieuw: gedekt door de gegenereerde catalogus)', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({ teams: [{ grootte: 10, formaties: ['4-4-1'] }] }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 10, formaties: ['4-4-1'], keeperInGrootte: true },
    ])
  })

  it('valideert categorie-afhankelijk: partijen_groot eist alle drie de linies', async () => {
    // '3-0-2' (geen middenvelder) mag wél bij partijen_klein...
    const ok = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(ok)
    await createOefening(baseInput({
      categorie: 'partijen_klein',
      teams: [{ grootte: 6, formaties: ['3-0-2'] }],
    }))
    expect(ok.calls.insert[0].payload.teams).toEqual([
      { grootte: 6, formaties: ['3-0-2'], keeperInGrootte: true },
    ])

    // ...maar niet bij partijen_groot.
    use(makeSupabase())
    await expect(
      createOefening(baseInput({
        categorie: 'partijen_groot',
        teams: [{ grootte: 6, formaties: ['3-0-2'] }],
      })),
    ).rejects.toThrow('Formatie past niet bij teamgrootte')
  })

  it('dual-read: een legacy formatie die niet bij de grootte past faalt nog steeds', async () => {
    use(makeSupabase())
    await expect(
      createOefening(baseInput({
        teams: [{ grootte: 6, formatie: '4-3-3' }] as unknown as OefeningInput['teams'],
      })),
    ).rejects.toThrow('Formatie past niet bij teamgrootte')
  })

  it('slaagt met aantal_neutralen > 0', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({ aantal_neutralen: 3 }))
    expect(m.calls.insert[0].payload.aantal_neutralen).toBe(3)
  })

  it('faalt wanneer de formatie niet bij de teamgrootte past', async () => {
    use(makeSupabase())
    await expect(createOefening(baseInput({ teams: [{ grootte: 6, formaties: ['4-3-3'] }] })))
      .rejects.toThrow('Formatie past niet bij teamgrootte')
  })

  it('de max-1-check gaat vóór de per-waarde-validatie (geen stille afkap)', async () => {
    for (const formaties of [
      ['3-0-2', '4-3-3'],            // fout achteraan
      ['4-3-3', '3-0-2'],            // fout vooraan
      ['3-0-2', '4-3-3', '2-2-1'],   // fout in het midden
    ]) {
      use(makeSupabase())
      await expect(createOefening(baseInput({ teams: [{ grootte: 6, formaties }] })))
        .rejects.toThrow('Maximaal één formatie per team')
    }
  })

  it('faalt bij een ongeldige teamgrootte', async () => {
    for (const grootte of [0, 12]) {
      use(makeSupabase())
      await expect(createOefening(baseInput({ teams: [{ grootte, formaties: [] }] })))
        .rejects.toThrow('Ongeldige teamgrootte')
    }
  })

  it('accepteert grootte 1 en 2 (nieuw: kleine oefenvormen als 1v1/2v2)', async () => {
    for (const grootte of [1, 2]) {
      const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
      use(m)
      await createOefening(baseInput({ teams: [{ grootte, formaties: [] }] }))
      expect(m.calls.insert[0].payload.teams).toEqual([
        { grootte, formaties: [], keeperInGrootte: true },
      ])
    }
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
      teams: Array.from({ length: 8 }, () => ({ grootte: 3, formaties: [] })),
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
      teams: [{ grootte: 6, formaties: [], foo: 'bar' } as unknown as OefeningInput['teams'][number]],
    }))
    const team = (m.calls.insert[0].payload.teams as Record<string, unknown>[])[0]
    expect(team).toEqual({ grootte: 6, formaties: [], keeperInGrootte: true })
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

describe('generieke foutafhandeling (geen ruwe databasemelding)', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  function logged() {
    return consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
  }

  // data blijft gevuld zodat assertOwnOefening slaagt; de mutatie zelf faalt.
  const dbFout = {
    data: { id: 'o1' },
    error: { code: '23505', message: 'Key (naam)=(Rondo) already exists' },
  }

  it('createOefening: generieke melding, context in de log, geen ruwe tekst', async () => {
    use(makeSupabase({ tables: { oefeningen: dbFout } }))

    await expect(createOefening(baseInput())).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('oefeningLibrary.createOefening')
    expect(logged()).toContain('23505')
    expect(logged()).not.toContain('Rondo')
  })

  it('updateOefening: generieke melding met eigen context', async () => {
    use(makeSupabase({ tables: { oefeningen: dbFout } }))

    await expect(updateOefening('o1', baseInput())).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('oefeningLibrary.updateOefening')
    expect(logged()).not.toContain('already exists')
  })

  it('deleteOefening: generieke melding met eigen context', async () => {
    use(makeSupabase({ tables: { oefeningen: dbFout } }))

    await expect(deleteOefening('o1')).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('oefeningLibrary.deleteOefening')
    expect(logged()).not.toContain('already exists')
  })
})
