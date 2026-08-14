import { describe, it, expect } from 'vitest'
import { toMatchFormItems, orderedScore } from '@/lib/match-form'
import type { MatchFormItem } from '@/lib/match-form'

// De W/G/V-uitkomst komt uit de echte matchResult() (lib/match-analysis.mjs);
// die wordt hier bewust NIET gemockt, zodat deze test breekt als de mapping en
// de uitslaglogica uit elkaar gaan lopen.

const rij = (over: Partial<Parameters<typeof toMatchFormItems>[0][number]> = {}) => ({
  id: 'e1',
  date: '2026-08-01',
  opponent: 'DVC',
  goals_for: 3,
  goals_against: 1,
  home_away: 'home' as 'home' | 'away' | null,
  ...over,
})

describe('toMatchFormItems', () => {
  it('mapt alle velden naar de weergavevorm', () => {
    expect(toMatchFormItems([rij()])).toEqual([
      { id: 'e1', result: 'win', goalsFor: 3, goalsAgainst: 1, opponent: 'DVC', date: '2026-08-01', homeAway: 'home' },
    ])
  })

  it('mapt home_away naar homeAway, inclusief uit en onbekend', () => {
    const items = toMatchFormItems([
      rij({ id: 'thuis', home_away: 'home' }),
      rij({ id: 'uit', home_away: 'away' }),
      rij({ id: 'onbekend', home_away: null }),
    ])
    expect(items.map((i) => i.homeAway)).toEqual(['home', 'away', null])
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

const item = (over: Partial<MatchFormItem> = {}): MatchFormItem => ({
  id: 'm1',
  result: 'win',
  goalsFor: 3,
  goalsAgainst: 1,
  opponent: 'DVC',
  date: '2026-08-01',
  homeAway: 'home',
  ...over,
})

describe('orderedScore', () => {
  it('draait de score om bij een uitwedstrijd: thuisploeg (tegenstander) eerst', () => {
    // Bugmelding: uit tegen Nederhorst met 5-2 verloren (goals_for 2,
    // goals_against 5) hoort als "5–2" te tonen, niet als "2–5".
    expect(orderedScore(item({ homeAway: 'away', result: 'loss', goalsFor: 2, goalsAgainst: 5 }))).toEqual({
      first: 5,
      second: 2,
    })
  })

  it('houdt bij een thuiswedstrijd het eigen team eerst', () => {
    expect(orderedScore(item({ homeAway: 'home', goalsFor: 3, goalsAgainst: 1 }))).toEqual({ first: 3, second: 1 })
  })

  it('valt zonder bekende thuis/uit terug op eigen team eerst', () => {
    expect(orderedScore(item({ homeAway: null, result: 'draw', goalsFor: 2, goalsAgainst: 2 }))).toEqual({
      first: 2,
      second: 2,
    })
  })

  it('draait ook een uitzege om (niet alleen verlies)', () => {
    expect(orderedScore(item({ homeAway: 'away', goalsFor: 4, goalsAgainst: 0 }))).toEqual({ first: 0, second: 4 })
  })

  it('houdt 0-0 kloppend in elke thuis/uit-variant', () => {
    for (const homeAway of ['home', 'away', null] as const) {
      expect(orderedScore(item({ homeAway, result: 'draw', goalsFor: 0, goalsAgainst: 0 }))).toEqual({
        first: 0,
        second: 0,
      })
    }
  })

  it('geeft null zodra een van beide doelpuntenaantallen ontbreekt', () => {
    for (const homeAway of ['home', 'away', null] as const) {
      expect(orderedScore(item({ homeAway, result: 'unknown', goalsFor: null, goalsAgainst: 2 }))).toBeNull()
      expect(orderedScore(item({ homeAway, result: 'unknown', goalsFor: 2, goalsAgainst: null }))).toBeNull()
      expect(orderedScore(item({ homeAway, result: 'unknown', goalsFor: null, goalsAgainst: null }))).toBeNull()
    }
  })
})
