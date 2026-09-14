import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { getSpelerRatingReeks, getSpelerStatistieken } from '@/app/actions/inzichten'

type TableResult = { data?: unknown; error?: unknown }

// getSpelerStatistieken doet twee verschillende RPC's
// (inzichten_aanwezigheid_per_speler en, via getSpelerRatingReeks,
// inzichten_rating_speler). De harness accepteert daarom zowel het oude,
// gedeelde resultaat als een map per functienaam.
type RpcOptie = TableResult | Record<string, TableResult>

const LEEG: TableResult = { data: [], error: null }

function rpcResultaat(optie: RpcOptie | undefined, fn: string): TableResult {
  if (!optie) return LEEG
  // Een TableResult herken je aan zijn eigen velden; alles anders is een map
  // van functienaam naar resultaat.
  if ('data' in optie || 'error' in optie) return optie as TableResult
  return (optie as Record<string, TableResult>)[fn] ?? LEEG
}

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
  rpc?: RpcOptie
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  type Eq = { col: string; val: unknown }
  type Filter = { op: string; col: string; val: unknown }
  const calls = {
    select: [] as { table: string; eqs: Eq[]; filters: Filter[] }[],
    rpc: [] as { fn: string; args: Record<string, unknown> }[],
  }

  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const eqs: Eq[] = []
    const filters: Filter[] = []
    const c: Record<string, unknown> = {}
    c.select = () => { calls.select.push({ table, eqs, filters }); return c }
    c.eq = (col: string, val: unknown) => {
      eqs.push({ col, val })
      filters.push({ op: 'eq', col, val })
      return c
    }
    // LET OP: deze stub past de filters NIET toe (geheugen.md) — hij legt ze
    // alleen vast, zodat een test kan bewijzen dat ze meegaan.
    for (const op of ['neq', 'gte', 'lte', 'in', 'is']) {
      c[op] = (col: string, val: unknown) => { filters.push({ op, col, val }); return c }
    }
    c.limit = (val: unknown) => { filters.push({ op: 'limit', col: '', val }); return c }
    c.order = () => c
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
      return Promise.resolve(rpcResultaat(opts.rpc, fn))
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
  rpc?: RpcOptie
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

// ────────────────────────────────────────────────
// getSpelerStatistieken

// Vastgezette klok: verledenSeizoensVenster() klemt het aanwezigheidsvenster op
// gisteren via todayLocal(), dus zonder vaste datum is er niets te bewijzen.
const VANDAAG = '2026-09-13'
const GISTEREN = '2026-09-12'

const AANWEZIGHEID_ROWS = [{ player_id: PLAYER_A, naam: 'Ravi', aanwezig: 9, afwezig: 3 }]

const MATCH_EVENT_ROWS = [
  { kind: 'goal' },
  { kind: 'goal' },
  { kind: 'assist' },
  { kind: 'yellow' },
]

const RPC_STANDAARD: Record<string, TableResult> = {
  inzichten_aanwezigheid_per_speler: { data: AANWEZIGHEID_ROWS, error: null },
  inzichten_rating_speler: { data: RATING_ROWS, error: null },
}

// Eigen speler, geldig seizoen, één wedstrijd met vier match_events.
function statsTeam(over: {
  tables?: Record<string, TableResult>
  rpc?: RpcOptie
} = {}) {
  return makeSupabase({
    tables: {
      players: { data: { id: PLAYER_A }, error: null },
      settings: { data: SEIZOEN_ROWS, error: null },
      events: { data: [{ id: 'm1' }], error: null },
      match_events: { data: MATCH_EVENT_ROWS, error: null },
      ...over.tables,
    },
    rpc: over.rpc ?? RPC_STANDAARD,
  })
}

function filtersVan(m: ReturnType<typeof makeSupabase>, table: string) {
  return m.calls.select.find((s) => s.table === table)?.filters
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(`${VANDAAG}T10:00:00`))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getSpelerStatistieken — succes', () => {
  it('bundelt aanwezigheid, ratings en tellingen tot één resultaat', async () => {
    use(statsTeam())

    await expect(getSpelerStatistieken(PLAYER_A)).resolves.toEqual({
      aanwezig: 9,
      afwezig: 3,
      aanwezigheidPercentage: 75,
      ratingReeks: RATING_ROWS,
      gemiddeldeRating: 7.5,
      tellingen: { doelpunten: 2, assists: 1, geel: 1, rood: 0 },
    })
  })

  it('vraagt de aanwezigheid op t/m GISTEREN — nooit toekomstige, nog niet gespeelde events', async () => {
    // Zonder dit klemmen keldert het percentage van elke geblesseerde speler:
    // markInjured zet 'absent' op toekomstige events (app/actions/players.ts).
    const m = statsTeam()
    use(m)

    await getSpelerStatistieken(PLAYER_A)

    const rpc = m.calls.rpc.find((r) => r.fn === 'inzichten_aanwezigheid_per_speler')!
    expect(rpc.args).toEqual({ p_start: '2026-08-01', p_end: GISTEREN, p_player: PLAYER_A })
  })

  it('stuurt bewust GEEN team_id naar de RPC — die filtert zelf op auth.uid()', async () => {
    const m = statsTeam()
    use(m)

    await getSpelerStatistieken(PLAYER_A)

    const rpc = m.calls.rpc.find((r) => r.fn === 'inzichten_aanwezigheid_per_speler')!
    expect(Object.keys(rpc.args)).toEqual(['p_start', 'p_end', 'p_player'])
  })

  it('haalt de wedstrijden over het VOLLE seizoen op — ratings en kaarten zijn per definitie verleden', async () => {
    const m = statsTeam()
    use(m)

    await getSpelerStatistieken(PLAYER_A)

    expect(filtersVan(m, 'events')).toEqual([
      { op: 'eq', col: 'team_id', val: 'team-1' },
      { op: 'eq', col: 'type', val: 'match' },
      { op: 'gte', col: 'date', val: '2026-08-01' },
      { op: 'lte', col: 'date', val: '2027-06-30' },
      { op: 'limit', col: '', val: 200 },
    ])
  })

  it('haalt de match_events team- én spelergescoped op, begrensd op MAX_SPELER_MATCH_EVENTS', async () => {
    const m = statsTeam()
    use(m)

    await getSpelerStatistieken(PLAYER_A)

    expect(filtersVan(m, 'match_events')).toEqual([
      { op: 'eq', col: 'team_id', val: 'team-1' },
      { op: 'eq', col: 'player_id', val: PLAYER_A },
      { op: 'in', col: 'event_id', val: ['m1'] },
      { op: 'limit', col: '', val: 500 },
    ])
  })
})

describe('getSpelerStatistieken — weigeringen', () => {
  it('weigert zonder ingelogde gebruiker en raakt de database niet', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(getSpelerStatistieken(PLAYER_A)).rejects.toThrow('Niet ingelogd')
    expect(m.calls.select).toHaveLength(0)
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('weigert een ongeldige UUID zonder de database te raken', async () => {
    const m = statsTeam()
    use(m)

    await expect(getSpelerStatistieken('geen-uuid')).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.select).toHaveLength(0)
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('weigert een lege speler-id zonder de database te raken', async () => {
    const m = statsTeam()
    use(m)

    await expect(getSpelerStatistieken('')).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.select).toHaveLength(0)
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('weigert een speler van een ander team met dezelfde melding en doet geen RPC', async () => {
    const m = statsTeam({ tables: { players: { data: null, error: null } } })
    use(m)

    await expect(getSpelerStatistieken(PLAYER_A)).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('controleert de speler team-gescoped voordat er data wordt opgehaald', async () => {
    const m = statsTeam()
    use(m)

    await getSpelerStatistieken(PLAYER_A)

    expect(m.calls.select.find((s) => s.table === 'players')!.eqs).toEqual([
      { col: 'id', val: PLAYER_A },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('geeft een generieke melding bij een fout in de aanwezigheids-RPC', async () => {
    // Precies wat er gebeurt als de migratie (supabase/speler-statistieken.sql)
    // nog niet gedraaid is: de 3-arg-signatuur bestaat dan niet.
    use(statsTeam({
      rpc: {
        ...RPC_STANDAARD,
        inzichten_aanwezigheid_per_speler: {
          data: null,
          error: { code: 'PGRST202', message: 'function public.inzichten_aanwezigheid_per_speler(date, date, uuid) does not exist' },
        },
      },
    }))

    await expect(getSpelerStatistieken(PLAYER_A)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('inzichten.getSpelerStatistieken.aanwezigheid')
    expect(logged()).toContain('PGRST202')
    expect(logged()).not.toContain('does not exist')
    expect(logged()).not.toContain(PLAYER_A)
  })

  it('geeft een generieke melding bij een fout op de wedstrijden-query', async () => {
    use(statsTeam({
      tables: { events: { data: null, error: { code: '42501', message: 'permission denied for table events' } } },
    }))

    await expect(getSpelerStatistieken(PLAYER_A)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('inzichten.getSpelerStatistieken.events')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
  })

  it('geeft een generieke melding bij een fout op de match_events-query', async () => {
    use(statsTeam({
      tables: { match_events: { data: null, error: { code: '42501', message: 'permission denied for table match_events' } } },
    }))

    await expect(getSpelerStatistieken(PLAYER_A)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('inzichten.getSpelerStatistieken.matchEvents')
    expect(logged()).not.toContain('permission denied')
  })
})

describe('getSpelerStatistieken — randgevallen', () => {
  it('geeft null zonder ingesteld seizoen, en doet geen enkele RPC', async () => {
    const m = statsTeam({ tables: { settings: { data: [], error: null } } })
    use(m)

    await expect(getSpelerStatistieken(PLAYER_A)).resolves.toBeNull()
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('geeft null bij een omgekeerd seizoensvenster', async () => {
    const m = statsTeam({
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

    await expect(getSpelerStatistieken(PLAYER_A)).resolves.toBeNull()
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('geeft 0/0 en percentage null bij een leeg RPC-resultaat — nooit 0%', async () => {
    use(statsTeam({
      rpc: { ...RPC_STANDAARD, inzichten_aanwezigheid_per_speler: { data: [], error: null } },
    }))

    const stats = (await getSpelerStatistieken(PLAYER_A))!
    expect(stats.aanwezig).toBe(0)
    expect(stats.afwezig).toBe(0)
    expect(stats.aanwezigheidPercentage).toBeNull()
  })

  it('geeft gemiddeldeRating null bij een lege ratingreeks — niet 0 en niet NaN', async () => {
    use(statsTeam({
      rpc: { ...RPC_STANDAARD, inzichten_rating_speler: { data: [], error: null } },
    }))

    const stats = (await getSpelerStatistieken(PLAYER_A))!
    expect(stats.ratingReeks).toEqual([])
    expect(stats.gemiddeldeRating).toBeNull()
  })

  it('telt vier nullen zonder wedstrijden in het venster, en doet dan geen match_events-query', async () => {
    const m = statsTeam({ tables: { events: { data: [], error: null } } })
    use(m)

    const stats = (await getSpelerStatistieken(PLAYER_A))!
    expect(stats.tellingen).toEqual({ doelpunten: 0, assists: 0, geel: 0, rood: 0 })
    expect(m.calls.select.some((s) => s.table === 'match_events')).toBe(false)
  })

  it('telt vier nullen als de speler geen match_events heeft (0 is een echte telling)', async () => {
    use(statsTeam({ tables: { match_events: { data: [], error: null } } }))

    const stats = (await getSpelerStatistieken(PLAYER_A))!
    expect(stats.tellingen).toEqual({ doelpunten: 0, assists: 0, geel: 0, rood: 0 })
  })
})
