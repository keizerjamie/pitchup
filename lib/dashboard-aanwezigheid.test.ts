import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { haalStatussenPerEvent } from '@/lib/dashboard-aanwezigheid'
import { MAX_RIJEN_PER_REQUEST, eventBatchGrootte } from '@/lib/attendance-batches'

type Rij = { team_id: string; event_id: string; player_id: string; status: string }
interface Query { table: string; select: string; eq: [string, unknown][]; in: [string, unknown[]][] }

// Minimale fake van de query-chain: past .eq/.in echt toe, kapt (net als
// PostgREST) af op 1000 rijen en legt elke query vast.
function maakClient(rijen: Rij[], faalBatch?: (q: Query) => boolean) {
  const queries: Query[] = []
  const client = {
    from: (table: string) => {
      const q: Query = { table, select: '', eq: [], in: [] }
      queries.push(q)
      const chain = {
        select: (s: string) => { q.select = s; return chain },
        eq: (c: string, v: unknown) => { q.eq.push([c, v]); return chain },
        in: (c: string, v: unknown[]) => { q.in.push([c, [...v]]); return chain },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          if (faalBatch?.(q)) return Promise.resolve({ data: null, error: { code: '57014', message: 'geheim detail' } }).then(res, rej)
          const data = rijen
            .filter((r) => q.eq.every(([c, v]) => (r as Record<string, unknown>)[c] === v))
            .filter((r) => q.in.every(([c, v]) => v.includes((r as Record<string, unknown>)[c])))
            .slice(0, MAX_RIJEN_PER_REQUEST)
          return Promise.resolve({ data, error: null }).then(res, rej)
        },
      }
      return chain
    },
  }
  return { client: client as unknown as SupabaseClient, queries }
}

const TEAM = 'team-1'
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)

beforeEach(() => { vi.restoreAllMocks() })

describe('haalStatussenPerEvent', () => {
  it('filtert elke batch op team_id, event_id en actieve player_id', async () => {
    const { client, queries } = maakClient([])
    await haalStatussenPerEvent(client, TEAM, ['e1', 'e2'], ['p1', 'p2'])
    expect(queries).toHaveLength(1)
    expect(queries[0]).toEqual({
      table: 'attendance',
      select: 'event_id, player_id, status',
      eq: [['team_id', TEAM]],
      in: [['event_id', ['e1', 'e2']], ['player_id', ['p1', 'p2']]],
    })
  })

  it('geeft een entry per event, ook zonder rijen, met player → status', async () => {
    const { client } = maakClient([
      { team_id: TEAM, event_id: 'e1', player_id: 'p1', status: 'present' },
      { team_id: TEAM, event_id: 'e1', player_id: 'p2', status: 'injured' },
    ])
    const uit = await haalStatussenPerEvent(client, TEAM, ['e1', 'e2'], ['p1', 'p2'])
    expect([...uit.keys()].sort()).toEqual(['e1', 'e2'])
    expect(Object.fromEntries(uit.get('e1')!)).toEqual({ p1: 'present', p2: 'injured' })
    expect(uit.get('e2')!.size).toBe(0)
  })

  it('rijen van een andere tenant en van inactieve spelers tellen niet', async () => {
    const { client } = maakClient([
      { team_id: 'ander-team', event_id: 'e1', player_id: 'p1', status: 'present' },
      { team_id: TEAM, event_id: 'e1', player_id: 'inactief', status: 'present' },
      { team_id: TEAM, event_id: 'e1', player_id: 'p2', status: 'absent' },
    ])
    const uit = await haalStatussenPerEvent(client, TEAM, ['e1'], ['p1', 'p2'])
    expect(Object.fromEntries(uit.get('e1')!)).toEqual({ p2: 'absent' })
  })

  it('0 events of 0 spelers → lege Map en geen enkele query', async () => {
    const a = maakClient([])
    expect((await haalStatussenPerEvent(a.client, TEAM, [], ['p1'])).size).toBe(0)
    expect(a.queries).toHaveLength(0)
    const b = maakClient([])
    expect((await haalStatussenPerEvent(b.client, TEAM, ['e1'], [])).size).toBe(0)
    expect(b.queries).toHaveLength(0)
  })

  it('dubbele event-ids worden één keer opgevraagd', async () => {
    const { client, queries } = maakClient([])
    await haalStatussenPerEvent(client, TEAM, ['e1', 'e1', 'e2'], ['p1'])
    expect(queries[0].in[0]).toEqual(['event_id', ['e1', 'e2']])
  })

  it('batchgrootte volgt eventBatchGrootte(aantal spelers)', async () => {
    const spelers = ids('p', 34)
    const { client, queries } = maakClient([])
    await haalStatussenPerEvent(client, TEAM, ids('e', 30), spelers)
    const grootte = eventBatchGrootte(34)
    expect(queries.map((q) => (q.in[0][1] as unknown[]).length)).toEqual([grootte, 30 - grootte])
  })

  it('60 events × 34 spelers: meerdere batches ≤ 1000 rijen, niets afgekapt', async () => {
    const events = ids('e', 60)
    const spelers = ids('p', 34)
    const rijen: Rij[] = events.flatMap((e) => spelers.map((p) => ({ team_id: TEAM, event_id: e, player_id: p, status: 'present' })))
    const { client, queries } = maakClient(rijen)
    const uit = await haalStatussenPerEvent(client, TEAM, events, spelers)
    expect(queries.length).toBeGreaterThan(1)
    for (const q of queries) {
      expect((q.in[0][1] as unknown[]).length * spelers.length).toBeLessThanOrEqual(MAX_RIJEN_PER_REQUEST)
      expect(q.eq).toEqual([['team_id', TEAM]])
    }
    expect(uit.size).toBe(60)
    for (const e of events) expect(uit.get(e)!.size).toBe(34)
  })

  it('gefaalde batch: geen entry voor zijn events, statisch label in de log, rest blijft', async () => {
    const fout = vi.spyOn(console, 'error').mockImplementation(() => {})
    const spelers = ids('p', 34)
    const events = ids('e', 40)
    const { client } = maakClient(
      [{ team_id: TEAM, event_id: 'e40', player_id: 'p1', status: 'present' }],
      (q) => (q.in[0][1] as unknown[]).includes('e1'),
    )
    const uit = await haalStatussenPerEvent(client, TEAM, events, spelers)
    const eersteBatch = events.slice(0, eventBatchGrootte(34))
    for (const e of eersteBatch) expect(uit.has(e)).toBe(false)
    expect(uit.get('e40')!.get('p1')).toBe('present')
    expect(fout).toHaveBeenCalledTimes(1)
    const gelogd = String(fout.mock.calls[0][0])
    expect(gelogd).toContain('[dashboard.attendanceBatch]')
    expect(gelogd).not.toContain('geheim detail')
  })
})
