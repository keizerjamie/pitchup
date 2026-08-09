import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`__redirect__:${to}`) },
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// getDefaultAttendance leest zelf settings; hier vastgezet zodat deze tests
// alleen over events gaan.
vi.mock('@/app/actions/settings', () => ({ getDefaultAttendance: vi.fn(async () => 'present') }))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { createEvent, updateGatherTime } from '@/app/actions/events'

// ────────────────────────────────────────────────
// Mocks (opzet overgenomen uit app/actions/match-squad.test.ts)
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
    select: [] as { table: string; eqs: Eq[] }[],
    insert: [] as { table: string; payload: unknown }[],
    update: [] as { table: string; payload: Record<string, unknown>; eqs: Eq[] }[],
    delete: [] as { table: string; eqs: Eq[] }[],
  }

  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const eqs: Eq[] = []
    const c: Record<string, unknown> = {}
    c.select = () => { calls.select.push({ table, eqs }); return c }
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    c.insert = (payload: unknown) => { calls.insert.push({ table, payload }); return c }
    c.update = (payload: Record<string, unknown>) => {
      calls.update.push({ table, payload, eqs })
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

// Standaard: eigen wedstrijd e1; insert/update slagen.
function eigenTeam(extra: Record<string, TableResult> = {}) {
  return makeSupabase({
    tables: {
      events: { data: { id: 'e1', type: 'match' }, error: null },
      players: { data: [], error: null },
      attendance: { data: null, error: null },
      ...extra,
    },
  })
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const WEDSTRIJD = {
  type: 'match',
  date: '2026-09-12',
  time: '14:30',
  match_type: 'league',
  home_away: 'home',
  opponent: 'DVC',
}

const TRAINING = { type: 'training', date: '2026-09-10', time: '19:00' }

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

function eventsPayload(m: ReturnType<typeof makeSupabase>): Record<string, unknown> {
  return m.calls.insert.find((i) => i.table === 'events')!.payload as Record<string, unknown>
}

// ────────────────────────────────────────────────
// createEvent — gather_time
// ────────────────────────────────────────────────

describe('createEvent — verzameltijd', () => {
  it('schrijft de verzameltijd weg bij een wedstrijd', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form({ ...WEDSTRIJD, gather_time: '13:45' })))
      .rejects.toThrow('__redirect__:/events/e1')

    const payload = eventsPayload(m)
    expect(payload.gather_time).toBe('13:45')
    expect(payload.time).toBe('14:30')
    expect(payload.team_id).toBe('team-1')
  })

  it('zet de verzameltijd op null als het veld leeg blijft', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form({ ...WEDSTRIJD, gather_time: '' })))
      .rejects.toThrow('__redirect__:/events/e1')

    expect(eventsPayload(m).gather_time).toBeNull()
  })

  it('zet de verzameltijd op null als het veld helemaal ontbreekt', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form(WEDSTRIJD))).rejects.toThrow('__redirect__:/events/e1')

    expect(eventsPayload(m).gather_time).toBeNull()
  })

  it('geeft een training nooit een verzameltijd, ook niet als het veld wordt meegestuurd', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form({ ...TRAINING, gather_time: '18:30' })))
      .rejects.toThrow('__redirect__:/events/e1')

    const payload = eventsPayload(m)
    expect(payload).not.toHaveProperty('gather_time')
    expect(payload.type).toBe('training')
  })

  it('weigert een ongeldige verzameltijd en schrijft niets weg', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form({ ...WEDSTRIJD, gather_time: '25:00' })))
      .rejects.toThrow('Ongeldig tijdstip')
    expect(m.calls.insert).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────
// updateGatherTime
// ────────────────────────────────────────────────

describe('updateGatherTime — succes', () => {
  it('werkt de verzameltijd bij met alle drie de filters, inclusief team_id', async () => {
    const m = eigenTeam()
    use(m)

    await updateGatherTime('e1', '13:45')

    const update = m.calls.update.find((u) => u.table === 'events')!
    expect(update.payload).toEqual({ gather_time: '13:45' })
    expect(update.eqs).toEqual([
      { col: 'id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
      { col: 'type', val: 'match' },
    ])
  })

  it('wist de verzameltijd met null', async () => {
    const m = eigenTeam()
    use(m)

    await updateGatherTime('e1', null)

    expect(m.calls.update.find((u) => u.table === 'events')!.payload).toEqual({ gather_time: null })
  })

  it('behandelt een lege string als wissen, niet als ongeldige invoer', async () => {
    const m = eigenTeam()
    use(m)

    await updateGatherTime('e1', '')

    expect(m.calls.update.find((u) => u.table === 'events')!.payload).toEqual({ gather_time: null })
  })

  it('accepteert de randen van de dag', async () => {
    const m = eigenTeam()
    use(m)

    await updateGatherTime('e1', '00:00')
    await updateGatherTime('e1', '23:59')

    expect(m.calls.update.map((u) => u.payload)).toEqual([
      { gather_time: '00:00' },
      { gather_time: '23:59' },
    ])
  })

  it('haalt het event team-gescoped op vóór het bijwerken', async () => {
    const m = eigenTeam()
    use(m)

    await updateGatherTime('e1', '13:45')

    const eventsSelect = m.calls.select.find((s) => s.table === 'events')!
    expect(eventsSelect.eqs).toEqual([
      { col: 'id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('revalideert de selectiepagina én de eventpagina', async () => {
    use(eigenTeam())

    await updateGatherTime('e1', '13:45')

    expect(revalidatePath).toHaveBeenCalledWith('/events/e1/squad')
    expect(revalidatePath).toHaveBeenCalledWith('/events/e1')
  })
})

describe('updateGatherTime — weigeringen', () => {
  it('weigert zonder ingelogde gebruiker', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(updateGatherTime('e1', '13:45')).rejects.toThrow('Niet ingelogd')
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een event van een ander team', async () => {
    const m = eigenTeam({ events: { data: null, error: null } })
    use(m)

    await expect(updateGatherTime('vreemd', '13:45')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een event dat geen wedstrijd is', async () => {
    const m = eigenTeam({ events: { data: { id: 'e1', type: 'training' }, error: null } })
    use(m)

    await expect(updateGatherTime('e1', '13:45')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('weigert een uur buiten het bereik', async () => {
    const m = eigenTeam()
    use(m)

    await expect(updateGatherTime('e1', '25:00')).rejects.toThrow('Ongeldig tijdstip')
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert tekst als tijdstip', async () => {
    const m = eigenTeam()
    use(m)

    await expect(updateGatherTime('e1', 'abc')).rejects.toThrow('Ongeldig tijdstip')
    expect(m.calls.update).toHaveLength(0)
  })

  it('weigert een tijd zonder leidende nullen', async () => {
    const m = eigenTeam()
    use(m)

    await expect(updateGatherTime('e1', '9:5')).rejects.toThrow('Ongeldig tijdstip')
    expect(m.calls.update).toHaveLength(0)
  })

  it('geeft een generieke melding bij een databasefout en lekt niets', async () => {
    use(eigenTeam({
      events: { data: { id: 'e1', type: 'match' }, error: { code: '42501', message: 'permission denied for table events' } },
    }))

    await expect(updateGatherTime('e1', '13:45')).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('events.updateGatherTime')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
