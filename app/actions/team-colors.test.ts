import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { saveTeamColor, resetTeamColor } from '@/app/actions/team-colors'

// ────────────────────────────────────────────────
// Mocks (opzet overgenomen uit app/actions/team-logo.test.ts, zonder het
// storage-dubbel — clubkleuren raken alleen de settings-tabel)
// ────────────────────────────────────────────────

type TableResult = { data?: unknown; error?: unknown }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  type Eq = { col: string; val: unknown }
  const calls = {
    upsert: [] as { table: string; payload: Record<string, unknown>; options: unknown }[],
    delete: [] as { table: string; eqs: Eq[] }[],
  }

  function chain(table: string) {
    const result = tables[table] ?? { data: null, error: null }
    const eqs: Eq[] = []
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    c.upsert = (payload: Record<string, unknown>, options?: unknown) => {
      calls.upsert.push({ table, payload, options })
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

// ────────────────────────────────────────────────
// saveTeamColor — succes
// ────────────────────────────────────────────────

describe('saveTeamColor — succespad', () => {
  it('schrijft precies één settings-rij, team-gescoped, met de juiste key', async () => {
    const m = makeSupabase()
    use(m)

    const result = await saveTeamColor('primary', '#a1b2c3')

    expect(result).toEqual({ error: null, value: '#a1b2c3' })
    expect(m.calls.upsert).toHaveLength(1)
    expect(m.calls.upsert[0].table).toBe('settings')
    expect(m.calls.upsert[0].payload).toEqual({
      team_id: 'team-1',
      key: 'team_color_primary',
      value: '#a1b2c3',
    })
    expect(m.calls.upsert[0].options).toEqual({ onConflict: 'team_id,key' })
  })

  it('schrijft voor de secundaire kleur alleen team_color_secondary', async () => {
    const m = makeSupabase()
    use(m)

    const result = await saveTeamColor('secondary', '#ffcc00')

    expect(result).toEqual({ error: null, value: '#ffcc00' })
    expect(m.calls.upsert).toHaveLength(1)
    expect(m.calls.upsert[0].payload.key).toBe('team_color_secondary')
    expect(m.calls.upsert[0].payload.value).toBe('#ffcc00')
  })

  it('revalideert /settings en niet de layout — kleuren zitten niet in de layout', async () => {
    use(makeSupabase())

    await saveTeamColor('primary', '#a1b2c3')

    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledTimes(1)
    expect(revalidatePath).not.toHaveBeenCalledWith('/', 'layout')
  })

  it('slaat de genormaliseerde waarde op, niet de ruwe invoer', async () => {
    const m = makeSupabase()
    use(m)

    const result = await saveTeamColor('primary', ' A1B2C3 ')

    expect(m.calls.upsert[0].payload.value).toBe('#a1b2c3')
    expect(result).toEqual({ error: null, value: '#a1b2c3' })
  })

  it('expandeert een 3-cijferige hex vóór opslag', async () => {
    const m = makeSupabase()
    use(m)

    const result = await saveTeamColor('primary', '#abc')

    expect(m.calls.upsert[0].payload.value).toBe('#aabbcc')
    expect(result).toEqual({ error: null, value: '#aabbcc' })
  })

  it('verwijdert niets bij het opslaan', async () => {
    const m = makeSupabase()
    use(m)

    await saveTeamColor('primary', '#a1b2c3')

    expect(m.calls.delete).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────
// saveTeamColor — weigeringen
// ────────────────────────────────────────────────

describe('saveTeamColor — weigeringen', () => {
  it('weigert zonder ingelogde gebruiker en schrijft niets', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    const result = await saveTeamColor('primary', '#a1b2c3')

    expect(result.error).toBeTruthy()
    expect(m.calls.upsert).toHaveLength(0)
    expect(m.calls.delete).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each(['groen', '#12345', '#12345g', '', 'rgb(0,0,0)', '#', '##abc'])(
    'weigert een ongeldige kleurcode (%s) en schrijft niets',
    async (invoer) => {
      const m = makeSupabase()
      use(m)

      const result = await saveTeamColor('primary', invoer)

      expect(result.error).toBeTruthy()
      expect(result.value).toBeUndefined()
      expect(m.calls.upsert).toHaveLength(0)
      expect(revalidatePath).not.toHaveBeenCalled()
    },
  )

  // Dragend: zonder de slot-whitelist kan een client elke andere settings-key
  // van zijn team overschrijven (bijv. team_logo_url of season_start).
  it.each(['tertiary', 'team_logo_url', '__proto__', 'team_color_primary', ''])(
    'weigert een onbekende slot (%s) en schrijft niets',
    async (slot) => {
      const m = makeSupabase()
      use(m)

      const result = await saveTeamColor(slot, '#a1b2c3')

      expect(result.error).toBeTruthy()
      expect(m.calls.upsert).toHaveLength(0)
      expect(m.calls.delete).toHaveLength(0)
      expect(revalidatePath).not.toHaveBeenCalled()
    },
  )

  it('controleert de slot vóór de kleur — een onbekende slot met geldige kleur schrijft niets', async () => {
    const m = makeSupabase()
    use(m)

    const result = await saveTeamColor('season_start', '#a1b2c3')

    expect(result.error).toBe('Onbekende kleurinstelling.')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('geeft een generieke melding bij een DB-fout en lekt niets', async () => {
    const m = makeSupabase({
      tables: {
        settings: {
          data: null,
          error: { code: '23505', message: 'Key (team_id, key)=(team-1, team_color_primary) already exists' },
        },
      },
    })
    use(m)

    const result = await saveTeamColor('primary', '#a1b2c3')

    expect(result.error).toBe(GENERIC_ERROR_MESSAGE)
    expect(result.value).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('already exists')
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(logged()).toContain('team-colors.saveTeamColor')
    expect(logged()).toContain('23505')
    expect(logged()).not.toContain('already exists')
    expect(logged()).not.toContain('team-1')
  })
})

// ────────────────────────────────────────────────
// resetTeamColor
// ────────────────────────────────────────────────

describe('resetTeamColor', () => {
  it('verwijdert precies de eigen rij voor die ene key', async () => {
    const m = makeSupabase()
    use(m)

    const result = await resetTeamColor('primary')

    expect(result).toEqual({ error: null })
    expect(m.calls.delete).toHaveLength(1)
    expect(m.calls.delete[0].table).toBe('settings')
    expect(m.calls.delete[0].eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'key', val: 'team_color_primary' },
    ])
  })

  it('verwijdert voor de secundaire kleur alleen team_color_secondary', async () => {
    const m = makeSupabase()
    use(m)

    await resetTeamColor('secondary')

    expect(m.calls.delete[0].eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'key', val: 'team_color_secondary' },
    ])
  })

  it('schrijft geen lege waarde weg, maar verwijdert de rij', async () => {
    const m = makeSupabase()
    use(m)

    await resetTeamColor('primary')

    expect(m.calls.upsert).toHaveLength(0)
  })

  it('revalideert /settings en niet de layout', async () => {
    use(makeSupabase())

    await resetTeamColor('primary')

    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledTimes(1)
    expect(revalidatePath).not.toHaveBeenCalledWith('/', 'layout')
  })

  it('weigert zonder ingelogde gebruiker en raakt niets aan', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    const result = await resetTeamColor('primary')

    expect(result.error).toBeTruthy()
    expect(m.calls.delete).toHaveLength(0)
    expect(m.calls.upsert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each(['tertiary', 'team_logo_url', '__proto__', 'season_start', ''])(
    'weigert een onbekende slot (%s) en verwijdert niets',
    async (slot) => {
      const m = makeSupabase()
      use(m)

      const result = await resetTeamColor(slot)

      expect(result.error).toBe('Onbekende kleurinstelling.')
      expect(m.calls.delete).toHaveLength(0)
      expect(m.calls.upsert).toHaveLength(0)
      expect(revalidatePath).not.toHaveBeenCalled()
    },
  )

  // Bewuste afwijking van deleteTeamLogo (dat een settings-delete-fout wél
  // slikt): daar was het bestand al weg, hier is de rij de enige resource.
  it('meldt een generieke fout als de delete faalt en lekt niets', async () => {
    const m = makeSupabase({
      tables: {
        settings: { data: null, error: { code: '42501', message: 'permission denied for table settings' } },
      },
    })
    use(m)

    const result = await resetTeamColor('primary')

    expect(result.error).toBe(GENERIC_ERROR_MESSAGE)
    expect(JSON.stringify(result)).not.toContain('permission denied')
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(logged()).toContain('team-colors.resetTeamColor')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
  })
})

// ────────────────────────────────────────────────
// Randgevallen
// ────────────────────────────────────────────────

describe('clubkleuren — randgevallen', () => {
  it('staat toe dat primair en secundair dezelfde kleur krijgen', async () => {
    const m = makeSupabase()
    use(m)

    const eerste = await saveTeamColor('primary', '#123456')
    const tweede = await saveTeamColor('secondary', '#123456')

    expect(eerste).toEqual({ error: null, value: '#123456' })
    expect(tweede).toEqual({ error: null, value: '#123456' })
    expect(m.calls.upsert.map((u) => u.payload.key)).toEqual(['team_color_primary', 'team_color_secondary'])
    expect(m.calls.upsert.every((u) => u.payload.value === '#123456')).toBe(true)
  })

  it('overschrijft dezelfde slot zonder fout bij twee saves achter elkaar', async () => {
    const m = makeSupabase()
    use(m)

    const eerste = await saveTeamColor('primary', '#111111')
    const tweede = await saveTeamColor('primary', '#222222')

    expect(eerste).toEqual({ error: null, value: '#111111' })
    expect(tweede).toEqual({ error: null, value: '#222222' })
    expect(m.calls.upsert).toHaveLength(2)
    expect(m.calls.upsert.every((u) => u.payload.key === 'team_color_primary')).toBe(true)
    expect(m.calls.upsert.every((u) => u.options && typeof u.options === 'object')).toBe(true)
  })

  it('kan na een reset weer opslaan', async () => {
    const m = makeSupabase()
    use(m)

    await saveTeamColor('primary', '#111111')
    await resetTeamColor('primary')
    const opnieuw = await saveTeamColor('primary', '#222222')

    expect(opnieuw).toEqual({ error: null, value: '#222222' })
    expect(m.calls.delete).toHaveLength(1)
    expect(m.calls.upsert).toHaveLength(2)
  })
})
