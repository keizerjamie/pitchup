import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { markTaskDone, reopenTask } from '@/app/actions/todos'

type TableResult = { data?: unknown; error?: unknown }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  type Eq = { col: string; val: unknown }
  const calls = {
    upsert: [] as { table: string; payload: Record<string, unknown> }[],
    delete: [] as { table: string; eqs: Eq[] }[],
  }

  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const eqs: Eq[] = []
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
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

// Standaard: eigen event e1, de mutatie op task_overrides slaagt.
function eigenTeam(extra: Record<string, TableResult> = {}) {
  return makeSupabase({
    tables: {
      events: { data: { id: 'e1' }, error: null },
      task_overrides: { data: null, error: null },
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

describe('markTaskDone', () => {
  it('schrijft de override team-gescoped weg', async () => {
    const m = eigenTeam()
    use(m)

    await markTaskDone('e1', 'lineup')

    const upsert = m.calls.upsert.find((u) => u.table === 'task_overrides')!
    expect(upsert.payload).toEqual({ team_id: 'team-1', event_id: 'e1', task_type: 'lineup' })
  })

  it('weigert een event van een ander team', async () => {
    const m = eigenTeam({ events: { data: null, error: null } })
    use(m)

    await expect(markTaskDone('vreemd', 'lineup')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('weigert een onbekend taaktype', async () => {
    use(eigenTeam())
    await expect(markTaskDone('e1', 'onzin' as 'lineup')).rejects.toThrow('Ongeldige taak')
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    use(makeSupabase({ user: null }))
    await expect(markTaskDone('e1', 'lineup')).rejects.toThrow('Niet ingelogd')
  })

  it('geeft een generieke melding bij een databasefout', async () => {
    use(eigenTeam({
      task_overrides: { data: null, error: { code: '23505', message: 'Key (event_id)=(e1) already exists' } },
    }))

    await expect(markTaskDone('e1', 'lineup')).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('todos.markTaskDone')
    expect(logged()).toContain('23505')
    expect(logged()).not.toContain('already exists')
  })
})

describe('reopenTask', () => {
  it('verwijdert de override team-gescoped', async () => {
    const m = eigenTeam()
    use(m)

    await reopenTask('e1', 'analysis')

    const del = m.calls.delete.find((d) => d.table === 'task_overrides')!
    expect(del.eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'event_id', val: 'e1' },
      { col: 'task_type', val: 'analysis' },
    ])
  })

  it('weigert een event van een ander team', async () => {
    const m = eigenTeam({ events: { data: null, error: null } })
    use(m)

    await expect(reopenTask('vreemd', 'analysis')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.delete).toHaveLength(0)
  })

  it('geeft een generieke melding bij een databasefout', async () => {
    use(eigenTeam({
      task_overrides: { data: null, error: { code: '42501', message: 'permission denied for table task_overrides' } },
    }))

    await expect(reopenTask('e1', 'training_plan')).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('todos.reopenTask')
    expect(logged()).not.toContain('permission denied')
  })
})
