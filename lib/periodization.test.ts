import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  countCategoryOccurrences,
  getTrainingLog,
} from '@/lib/periodization'
import { berekenStap, MetingData } from '@/lib/types'

// Minimale, chainbare supabase-mock: elke query-methode geeft de builder terug
// en de builder is awaitable; `from(table)` bepaalt welke dataset terugkomt.
function makeSupabase(byTable: Record<string, { data: unknown }>): SupabaseClient {
  function chain(table: string) {
    const result = byTable[table] ?? { data: [] }
    const c: Record<string, unknown> = {}
    const methods = [
      'select', 'eq', 'gt', 'lt', 'gte', 'lte', 'in', 'order', 'neq', 'limit',
    ]
    for (const m of methods) c[m] = () => c
    c.single = () => Promise.resolve(result)
    c.maybeSingle = () => Promise.resolve(result)
    ;(c as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(result)
    return c
  }
  return { from: (t: string) => chain(t) } as unknown as SupabaseClient
}

const meting: MetingData = {
  id: 'm1',
  event_id: 'nul',
  team_id: 'team-1',
  partijen_groot_stap: 3,
  partijen_midden_stap: 1,
  partijen_klein_stap: 1,
  sprints_weinig_rust_stap: 1,
  sprints_veel_rust_stap: 1,
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
}

describe('countCategoryOccurrences', () => {
  it('telt de koppeling: 1x per categorie per training', async () => {
    const supabase = makeSupabase({
      events: { data: [{ id: 't1' }, { id: 't2' }] },
      training_oefeningen: {
        data: [
          // t1 heeft twee partijen_groot-koppelingen -> telt als 1
          { event_id: 't1', oefeningen: { categorie: 'partijen_groot' } },
          { event_id: 't1', oefeningen: { categorie: 'partijen_groot' } },
          // t2 heeft er één -> +1
          { event_id: 't2', oefeningen: { categorie: 'partijen_groot' } },
        ],
      },
    })

    const occ = await countCategoryOccurrences(supabase, 'team-1', '2026-01-01', '2026-02-01')
    expect(occ.partijen_groot).toBe(2)
  })
})

describe('getTrainingLog', () => {
  it('override wint van berekende stap; telt 1x per categorie per training', async () => {
    const supabase = makeSupabase({
      events: { data: [{ id: 't1', date: '2026-01-10' }, { id: 't2', date: '2026-01-17' }] },
      training_oefeningen: {
        data: [
          { event_id: 't1', stap_override: null, oefeningen: { categorie: 'partijen_groot' } },
          { event_id: 't1', stap_override: 7, oefeningen: { categorie: 'partijen_groot' } },
          { event_id: 't2', stap_override: null, oefeningen: { categorie: 'partijen_klein' } },
        ],
      },
    })

    const { log, occurrences, lastByCategory } = await getTrainingLog(
      supabase, 'team-1', meting, '2026-01-01', '2026-02-01',
    )

    // Nieuwste eerst.
    expect(log[0].eventId).toBe('t2')

    const t1 = log.find((e) => e.eventId === 't1')!
    expect(t1.items).toHaveLength(1)
    const pg = t1.items[0]
    expect(pg.key).toBe('partijen_groot')
    expect(pg.override).toBe(true)
    expect(pg.step).toBe(7) // handmatige override wint

    expect(occurrences.partijen_groot).toBe(1)
    expect(lastByCategory.partijen_klein.date).toBe('2026-01-17')
  })
})

describe('berekenStap (regressie)', () => {
  it('verzwaren-en-herhalen: N + floor(k/2)', () => {
    expect(berekenStap(3, 0)).toBe(3)
    expect(berekenStap(3, 1)).toBe(3)
    expect(berekenStap(3, 2)).toBe(4)
    expect(berekenStap(3, 5)).toBe(5)
  })
})
