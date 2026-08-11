import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { getSpelerRatingReeks } from '@/app/actions/inzichten'

type TableResult = { data?: unknown; error?: unknown }

const PLAYER_A = '11111111-1111-4111-8111-111111111111'

const SEIZOEN_ROWS = [
  { key: 'season_start', value: '2026-08-01' },
  { key: 'season_end', value: '2027-06-30' },
]

const RATING_ROWS = [
  { event_id: 'e1', datum: '2026-09-05', tegenstander: 'DVC', rating: 7 },
  { event_id: 'e2', datum: '2026-09-12', tegenstander: 'SVW', rating: 8 },
]

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
  rpc?: TableResult
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const rpcResult = opts.rpc ?? { data: [], error: null }
  type Eq = { col: string; val: unknown }
  const calls = {
    select: [] as { table: string; eqs: Eq[] }[],
    rpc: [] as { fn: string; args: Record<string, unknown> }[],
  }

  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const eqs: Eq[] = []
    const c: Record<string, unknown> = {}
    c.select = () => { calls.select.push({ table, eqs }); return c }
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    c.maybeSingle = () => Promise.resolve(result)
    c.single = () => Promise.resolve(result)
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
    return c
  }

  const supabase = {
    from: (t: string) => chain(t),
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push({ fn, args })
      return Promise.resolve(rpcResult)
    },
  }
  return { supabase, calls }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

// Standaard: eigen speler, een geldig seizoen in settings en twee ratings.
function eigenTeam(over: {
  tables?: Record<string, TableResult>
  rpc?: TableResult
} = {}) {
  return makeSupabase({
    tables: {
      players: { data: { id: PLAYER_A }, error: null },
      settings: { data: SEIZOEN_ROWS, error: null },
      ...over.tables,
    },
    rpc: over.rpc ?? { data: RATING_ROWS, error: null },
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

describe('getSpelerRatingReeks — succes', () => {
  it('geeft de ratingreeks van de RPC terug', async () => {
    use(eigenTeam())

    await expect(getSpelerRatingReeks(PLAYER_A)).resolves.toEqual(RATING_ROWS)
  })

  it('roept de RPC aan met de speler en het seizoensvenster uit settings', async () => {
    const m = eigenTeam()
    use(m)

    await getSpelerRatingReeks(PLAYER_A)

    expect(m.calls.rpc).toEqual([
      {
        fn: 'inzichten_rating_speler',
        args: { p_player: PLAYER_A, p_start: '2026-08-01', p_end: '2027-06-30' },
      },
    ])
  })

  it('stuurt bewust GEEN team_id mee — de RPC filtert zelf op auth.uid()', async () => {
    const m = eigenTeam()
    use(m)

    await getSpelerRatingReeks(PLAYER_A)

    expect(Object.keys(m.calls.rpc[0].args)).toEqual(['p_player', 'p_start', 'p_end'])
  })

  it('controleert de speler team-gescoped voordat er data wordt opgehaald', async () => {
    const m = eigenTeam()
    use(m)

    await getSpelerRatingReeks(PLAYER_A)

    const playersSelect = m.calls.select.find((s) => s.table === 'players')!
    expect(playersSelect.eqs).toEqual([
      { col: 'id', val: PLAYER_A },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('leest de instellingen team-gescoped', async () => {
    const m = eigenTeam()
    use(m)

    await getSpelerRatingReeks(PLAYER_A)

    const settingsSelect = m.calls.select.find((s) => s.table === 'settings')!
    expect(settingsSelect.eqs).toEqual([{ col: 'team_id', val: 'team-1' }])
  })

  it('geeft een lege lijst voor een speler zonder ratings', async () => {
    use(eigenTeam({ rpc: { data: [], error: null } }))

    await expect(getSpelerRatingReeks(PLAYER_A)).resolves.toEqual([])
  })

  it('geeft een lege lijst voor een inactieve speler — de RPC filtert die weg, geen crash', async () => {
    // Een inactieve speler is nog steeds een eigen speler (assertOwnPlayer
    // slaagt), maar valt in de RPC weg door p.active = true.
    use(eigenTeam({ rpc: { data: [], error: null } }))

    await expect(getSpelerRatingReeks(PLAYER_A)).resolves.toEqual([])
  })

  it('geeft een lege lijst als de RPC null teruggeeft', async () => {
    use(eigenTeam({ rpc: { data: null, error: null } }))

    await expect(getSpelerRatingReeks(PLAYER_A)).resolves.toEqual([])
  })
})

describe('getSpelerRatingReeks — seizoensvenster', () => {
  it('geeft een lege lijst als er geen seizoen is ingesteld', async () => {
    const m = eigenTeam({ tables: { settings: { data: [], error: null } } })
    use(m)

    await expect(getSpelerRatingReeks(PLAYER_A)).resolves.toEqual([])
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('geeft een lege lijst bij een half ingevuld seizoen', async () => {
    const m = eigenTeam({
      tables: { settings: { data: [{ key: 'season_start', value: '2026-08-01' }], error: null } },
    })
    use(m)

    await expect(getSpelerRatingReeks(PLAYER_A)).resolves.toEqual([])
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('geeft een lege lijst bij een omgekeerd venster (O4), zonder RPC-aanroep', async () => {
    const m = eigenTeam({
      tables: {
        settings: {
          data: [
            { key: 'season_start', value: '2027-06-30' },
            { key: 'season_end', value: '2026-08-01' },
          ],
          error: null,
        },
      },
    })
    use(m)

    await expect(getSpelerRatingReeks(PLAYER_A)).resolves.toEqual([])
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('geeft een lege lijst bij een ongeldige datum in settings', async () => {
    const m = eigenTeam({
      tables: {
        settings: {
          data: [
            { key: 'season_start', value: '2026-02-30' },
            { key: 'season_end', value: '2027-06-30' },
          ],
          error: null,
        },
      },
    })
    use(m)

    await expect(getSpelerRatingReeks(PLAYER_A)).resolves.toEqual([])
    expect(m.calls.rpc).toHaveLength(0)
  })
})

describe('getSpelerRatingReeks — weigeringen', () => {
  it('weigert zonder ingelogde gebruiker', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(getSpelerRatingReeks(PLAYER_A)).rejects.toThrow('Niet ingelogd')
    expect(m.calls.select).toHaveLength(0)
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('weigert een ongeldige UUID zonder de database te raken', async () => {
    const m = eigenTeam()
    use(m)

    await expect(getSpelerRatingReeks('geen-uuid')).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.select).toHaveLength(0)
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('weigert een lege speler-id zonder de database te raken', async () => {
    const m = eigenTeam()
    use(m)

    await expect(getSpelerRatingReeks('')).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.select).toHaveLength(0)
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('weigert een speler van een ander team met dezelfde melding — verraadt het verschil niet', async () => {
    const m = eigenTeam({ tables: { players: { data: null, error: null } } })
    use(m)

    await expect(getSpelerRatingReeks(PLAYER_A)).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('geeft een generieke melding bij een RPC-fout en logt geen ruwe details', async () => {
    use(eigenTeam({
      rpc: {
        data: null,
        error: { code: '42883', message: 'function public.inzichten_rating_speler(uuid, date, date) does not exist' },
      },
    }))

    await expect(getSpelerRatingReeks(PLAYER_A)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('inzichten.getSpelerRatingReeks')
    expect(logged()).toContain('42883')
    expect(logged()).not.toContain('does not exist')
    expect(logged()).not.toContain(PLAYER_A)
  })

  it('lekt bij een permissiefout geen ruwe Postgres-melding', async () => {
    use(eigenTeam({
      rpc: { data: null, error: { code: '42501', message: 'permission denied for table match_ratings' } },
    }))

    await expect(getSpelerRatingReeks(PLAYER_A)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('inzichten.getSpelerRatingReeks')
    expect(logged()).not.toContain('permission denied')
  })
})
