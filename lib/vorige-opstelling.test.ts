import { describe, it, expect } from 'vitest'
import { bepaalVorigeOpstelling } from '@/lib/vorige-opstelling'
import { FORMATIONS } from '@/lib/types'

const FORMATIE = '4-3-3'
const SLOTS = FORMATIONS[FORMATIE].positions
const ANDERE = '4-4-2'

function spelers(n: number, prefix = 'p'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`)
}

// Een bronopstelling met (bewust afwijkende) oude coördinaten: de overname moet
// de huidige basisvorm uit FORMATIONS gebruiken.
function bron(ids: (string | null)[], formatie = FORMATIE) {
  return FORMATIONS[formatie].positions.map((s, i) => ({ ...s, x: 1, y: 1, player_id: ids[i] ?? null }))
}

const K = [
  { id: 'e3', date: '2026-11-09' },
  { id: 'e2', date: '2026-11-02' },
  { id: 'e1', date: '2026-10-26' },
]

describe('bepaalVorigeOpstelling — bron kiezen', () => {
  it('neemt de eerste kandidaat met een lineups-rij', () => {
    const ids = spelers(11)
    const r = bepaalVorigeOpstelling({
      kandidaten: K,
      lineupRijen: [
        { event_id: 'e1', formation: ANDERE, positions: bron(ids, ANDERE) },
        { event_id: 'e3', formation: FORMATIE, positions: bron(ids) },
      ],
      beschikbareSpelerIds: new Set(ids),
    })
    expect(r).toMatchObject({ beschikbaar: true, bronEventId: 'e3', bronDatum: '2026-11-09', formation: FORMATIE, leegGelaten: 0 })
    if (!r.beschikbaar) throw new Error('verwacht beschikbaar')
    expect(r.positions.map((p) => p.player_id)).toEqual(ids)
    // Huidige coördinaten van de formatie, niet die van de bron.
    expect(r.positions).toEqual(SLOTS.map((s, i) => ({ ...s, player_id: ids[i] })))
  })

  it('slaat een kandidaat zonder rij over', () => {
    const ids = spelers(11)
    const r = bepaalVorigeOpstelling({
      kandidaten: K,
      lineupRijen: [{ event_id: 'e2', formation: FORMATIE, positions: bron(ids) }],
      beschikbareSpelerIds: new Set(ids),
    })
    expect(r).toMatchObject({ beschikbaar: true, bronEventId: 'e2' })
  })

  it('geen kandidaten of geen rijen = geen', () => {
    expect(bepaalVorigeOpstelling({ kandidaten: [], lineupRijen: [], beschikbareSpelerIds: new Set() }))
      .toEqual({ beschikbaar: false, reden: 'geen' })
    expect(bepaalVorigeOpstelling({ kandidaten: K, lineupRijen: [], beschikbareSpelerIds: new Set() }))
      .toEqual({ beschikbaar: false, reden: 'geen' })
  })

  it('negeert een rij van een event buiten de kandidaten (tenant)', () => {
    const ids = spelers(11)
    const r = bepaalVorigeOpstelling({
      kandidaten: K,
      lineupRijen: [{ event_id: 'ander-team', formation: FORMATIE, positions: bron(ids) }],
      beschikbareSpelerIds: new Set(ids),
    })
    expect(r).toEqual({ beschikbaar: false, reden: 'geen' })
  })

  it('een opgeslagen rij met 0 spelers telt als bron', () => {
    const r = bepaalVorigeOpstelling({
      kandidaten: K,
      lineupRijen: [{ event_id: 'e3', formation: FORMATIE, positions: bron([]) }],
      beschikbareSpelerIds: new Set(),
    })
    expect(r).toMatchObject({ beschikbaar: true, bronEventId: 'e3', leegGelaten: 0 })
  })
})

describe('bepaalVorigeOpstelling — onleesbaar, geen fallback', () => {
  it('onbekende formatie = onleesbaar, ook als een oudere wedstrijd wel leesbaar is', () => {
    const ids = spelers(11)
    const r = bepaalVorigeOpstelling({
      kandidaten: K,
      lineupRijen: [
        { event_id: 'e3', formation: 'bestaat-niet', positions: bron(ids) },
        { event_id: 'e2', formation: FORMATIE, positions: bron(ids) },
      ],
      beschikbareSpelerIds: new Set(ids),
    })
    expect(r).toEqual({ beschikbaar: false, reden: 'onleesbaar' })
  })

  it('positions geen array = onleesbaar', () => {
    const r = bepaalVorigeOpstelling({
      kandidaten: K,
      lineupRijen: [{ event_id: 'e3', formation: FORMATIE, positions: { kapot: true } }],
      beschikbareSpelerIds: new Set(),
    })
    expect(r).toEqual({ beschikbaar: false, reden: 'onleesbaar' })
  })

  it('gooit niet bij kapotte invoer', () => {
    expect(() => bepaalVorigeOpstelling({
      kandidaten: K,
      lineupRijen: [null, 5, { event_id: 'e3', formation: FORMATIE, positions: [null, 'x', 7] }] as unknown as Parameters<typeof bepaalVorigeOpstelling>[0]['lineupRijen'],
      beschikbareSpelerIds: new Set(),
    })).not.toThrow()
  })
})

describe('bepaalVorigeOpstelling — spelers filteren', () => {
  it('een niet-beschikbare speler geeft een leeg slot en telt in leegGelaten', () => {
    const ids = spelers(11)
    const beschikbaar = new Set(ids.filter((id) => id !== 'p2' && id !== 'p7'))
    const r = bepaalVorigeOpstelling({
      kandidaten: K,
      lineupRijen: [{ event_id: 'e3', formation: FORMATIE, positions: bron(ids) }],
      beschikbareSpelerIds: beschikbaar,
    })
    if (!r.beschikbaar) throw new Error('verwacht beschikbaar')
    expect(r.positions[2].player_id).toBeNull()
    expect(r.positions[7].player_id).toBeNull()
    expect(r.positions[0].player_id).toBe('p0')
    expect(r.leegGelaten).toBe(2)
  })

  it('een slot dat in de bron al leeg was telt niet als leeggelaten', () => {
    const ids: (string | null)[] = spelers(11)
    ids[4] = null
    const r = bepaalVorigeOpstelling({
      kandidaten: K,
      lineupRijen: [{ event_id: 'e3', formation: FORMATIE, positions: bron(ids) }],
      beschikbareSpelerIds: new Set(spelers(11)),
    })
    if (!r.beschikbaar) throw new Error('verwacht beschikbaar')
    expect(r.positions[4].player_id).toBeNull()
    expect(r.leegGelaten).toBe(0)
  })

  it('een dubbele speler wordt één keer geplaatst', () => {
    const ids: (string | null)[] = spelers(11)
    ids[5] = 'p1'
    const r = bepaalVorigeOpstelling({
      kandidaten: K,
      lineupRijen: [{ event_id: 'e3', formation: FORMATIE, positions: bron(ids) }],
      beschikbareSpelerIds: new Set(spelers(11)),
    })
    if (!r.beschikbaar) throw new Error('verwacht beschikbaar')
    expect(r.positions[1].player_id).toBe('p1')
    expect(r.positions[5].player_id).toBeNull()
    expect(r.positions.filter((p) => p.player_id === 'p1')).toHaveLength(1)
    expect(r.leegGelaten).toBe(1)
  })

  it('kortere bron-positions: ontbrekende slots blijven leeg', () => {
    const r = bepaalVorigeOpstelling({
      kandidaten: K,
      lineupRijen: [{ event_id: 'e3', formation: FORMATIE, positions: [{ player_id: 'p0' }] }],
      beschikbareSpelerIds: new Set(['p0']),
    })
    if (!r.beschikbaar) throw new Error('verwacht beschikbaar')
    expect(r.positions).toHaveLength(SLOTS.length)
    expect(r.positions[0].player_id).toBe('p0')
    expect(r.positions.slice(1).every((p) => p.player_id === null)).toBe(true)
  })
})
