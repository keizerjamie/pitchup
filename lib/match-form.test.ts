import { describe, it, expect } from 'vitest'
import { toMatchFormItems } from '@/lib/match-form'

// De W/G/V-uitkomst komt uit de echte matchResult() (lib/match-analysis.mjs);
// die wordt hier bewust NIET gemockt, zodat deze test breekt als de mapping en
// de uitslaglogica uit elkaar gaan lopen.

const rij = (over: Partial<Parameters<typeof toMatchFormItems>[0][number]> = {}) => ({
  id: 'e1',
  date: '2026-08-01',
  opponent: 'DVC',
  goals_for: 3,
  goals_against: 1,
  ...over,
})

describe('toMatchFormItems', () => {
  it('mapt alle velden naar de weergavevorm', () => {
    expect(toMatchFormItems([rij()])).toEqual([
      { id: 'e1', result: 'win', goalsFor: 3, goalsAgainst: 1, opponent: 'DVC', date: '2026-08-01' },
    ])
  })

  it('leidt winst, gelijk en verlies af via matchResult', () => {
    const items = toMatchFormItems([
      rij({ id: 'w', goals_for: 2, goals_against: 0 }),
      rij({ id: 'g', goals_for: 1, goals_against: 1 }),
      rij({ id: 'v', goals_for: 0, goals_against: 4 }),
    ])
    expect(items.map((i) => i.result)).toEqual(['win', 'draw', 'loss'])
  })

  it('geeft "unknown" als de uitslag (deels) ontbreekt', () => {
    const items = toMatchFormItems([
      rij({ id: 'a', goals_for: null, goals_against: null }),
      rij({ id: 'b', goals_for: 2, goals_against: null }),
      rij({ id: 'c', goals_for: null, goals_against: 2 }),
    ])
    expect(items.map((i) => i.result)).toEqual(['unknown', 'unknown', 'unknown'])
    expect(items[1].goalsFor).toBe(2)
    expect(items[1].goalsAgainst).toBeNull()
  })

  it('telt 0-0 als gelijkspel, niet als ontbrekende uitslag', () => {
    expect(toMatchFormItems([rij({ goals_for: 0, goals_against: 0 })])[0].result).toBe('draw')
  })

  it('laat een ontbrekende tegenstander null (geen invaller-tekst hier)', () => {
    const items = toMatchFormItems([rij({ opponent: null })])
    expect(items[0].opponent).toBeNull()
  })

  it('behoudt de volgorde van de invoer — geen eigen sortering', () => {
    const items = toMatchFormItems([
      rij({ id: 'oud', date: '2026-01-01' }),
      rij({ id: 'nieuw', date: '2026-08-01' }),
      rij({ id: 'midden', date: '2026-04-01' }),
    ])
    expect(items.map((i) => i.id)).toEqual(['oud', 'nieuw', 'midden'])
  })

  it('filtert niets weg', () => {
    const rows = [rij({ id: 'a' }), rij({ id: 'b', goals_for: null, goals_against: null })]
    expect(toMatchFormItems(rows)).toHaveLength(2)
  })

  it('geeft een lege lijst voor lege invoer', () => {
    expect(toMatchFormItems([])).toEqual([])
  })

  it('muteert de invoer niet', () => {
    const rows = [rij()]
    const kopie = structuredClone(rows)

    toMatchFormItems(rows)

    expect(rows).toEqual(kopie)
  })
})
