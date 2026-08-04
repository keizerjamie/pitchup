import { describe, it, expect } from 'vitest'
import {
  formationsForSize,
  isFormationValidForSize,
  basisFormatieDef,
  normalizeOefeningTeam,
  normalizeOefeningTeams,
  FORMATIONS,
  FORMATIONS_BY_TEAM_SIZE,
} from '@/lib/types'

const SIZES = [3, 4, 5, 6, 7, 8, 9, 11]

describe('formationsForSize', () => {
  it('geeft minstens één formatie per ondersteunde grootte', () => {
    for (const n of SIZES) {
      const list = formationsForSize(n)
      expect(list.length).toBeGreaterThan(0)
    }
  })

  it('elke formatie heeft evenveel posities als de teamgrootte', () => {
    for (const n of SIZES) {
      for (const f of formationsForSize(n)) {
        expect(f.positions.length).toBe(n)
      }
    }
  })

  it('geeft een lege lijst voor een niet-ondersteunde grootte', () => {
    expect(formationsForSize(10)).toEqual([])
    expect(formationsForSize(0)).toEqual([])
  })

  it('11-tal hergebruikt de bestaande FORMATIONS-vormen', () => {
    const keys = FORMATIONS_BY_TEAM_SIZE[11].map((f) => f.key)
    expect(keys).toContain('4-3-3')
    expect(keys).toContain('4-4-2')
  })

  it('geeft de formaties alfabetisch op label terug', () => {
    for (const n of SIZES) {
      const labels = formationsForSize(n).map((f) => f.label)
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'nl')))
    }
    // Concreet: 11-tal staat in FORMATIONS in invoervolgorde, gesorteerd anders.
    expect(formationsForSize(11).map((f) => f.key)).toEqual(
      ['3-4-3', '4-2-3-1', '4-3-3', '4-4-2', '5-3-2'],
    )
    // En grootte 4: '1-2' vóór '2-1' (was omgekeerd in de bron).
    expect(formationsForSize(4).map((f) => f.key)).toEqual(['1-2', '2-1'])
  })

  it('muteert FORMATIONS_BY_TEAM_SIZE en FORMATIONS niet (LineupBuilder-volgorde blijft)', () => {
    // Bronvolgorde is de invoervolgorde, niet de alfabetische.
    expect(FORMATIONS_BY_TEAM_SIZE[4].map((f) => f.key)).toEqual(['2-1', '1-2'])
    expect(FORMATIONS_BY_TEAM_SIZE[11].map((f) => f.key)).toEqual(
      ['4-3-3', '4-4-2', '4-2-3-1', '3-4-3', '5-3-2'],
    )
    expect(Object.keys(FORMATIONS)).toEqual(['4-3-3', '4-4-2', '4-2-3-1', '3-4-3', '5-3-2'])
  })

  it('geeft dezelfde (stabiele) array terug bij herhaald aanroepen', () => {
    expect(formationsForSize(7)).toBe(formationsForSize(7))
    expect(formationsForSize(10)).toEqual([])
  })
})

describe('basisFormatieDef', () => {
  it('lege/null/undefined selectie → null (= geen formatie)', () => {
    expect(basisFormatieDef(4, [])).toBeNull()
    expect(basisFormatieDef(4, null)).toBeNull()
    expect(basisFormatieDef(4, undefined)).toBeNull()
  })

  it('één selectie → die formatie', () => {
    expect(basisFormatieDef(4, ['2-1'])?.key).toBe('2-1')
  })

  it('meerdere selecties → de alfabetisch eerste, ongeacht invoervolgorde', () => {
    expect(basisFormatieDef(4, ['2-1', '1-2'])?.key).toBe('1-2')
    expect(basisFormatieDef(4, ['1-2', '2-1'])?.key).toBe('1-2')
    expect(basisFormatieDef(11, ['5-3-2', '4-4-2', '3-4-3'])?.key).toBe('3-4-3')
  })

  it('accepteert ook labels in plaats van keys', () => {
    expect(basisFormatieDef(6, ['3-2'])?.key).toBe('3-2')
  })

  it('onbekende keys of onbekende grootte → null', () => {
    expect(basisFormatieDef(4, ['4-3-3'])).toBeNull()
    expect(basisFormatieDef(99, ['2-1'])).toBeNull()
  })
})

describe('normalizeOefeningTeam (dual-read)', () => {
  it('legacy formatie-string → array van één', () => {
    expect(normalizeOefeningTeam({ grootte: 4, formatie: '2-1' })).toEqual({
      grootte: 4,
      formaties: ['2-1'],
    })
  })

  it('legacy formatie null/lege string → lege array', () => {
    expect(normalizeOefeningTeam({ grootte: 4, formatie: null })).toEqual({ grootte: 4, formaties: [] })
    expect(normalizeOefeningTeam({ grootte: 4, formatie: '' })).toEqual({ grootte: 4, formaties: [] })
  })

  it('nieuwe vorm blijft behouden', () => {
    expect(normalizeOefeningTeam({ grootte: 4, formaties: ['2-1', '1-2'] })).toEqual({
      grootte: 4,
      formaties: ['2-1', '1-2'],
    })
  })

  it('formaties heeft voorrang op een meegestuurd legacy formatie-veld', () => {
    expect(normalizeOefeningTeam({ grootte: 4, formaties: ['1-2'], formatie: '2-1' })).toEqual({
      grootte: 4,
      formaties: ['1-2'],
    })
  })

  it('ontdubbelt en gooit niet-strings/lege strings weg', () => {
    expect(
      normalizeOefeningTeam({ grootte: 4, formaties: ['2-1', '2-1', '', 7, null, '1-2'] }),
    ).toEqual({ grootte: 4, formaties: ['2-1', '1-2'] })
  })

  it('stript onbekende velden', () => {
    const t = normalizeOefeningTeam({ grootte: 6, formaties: ['3-2'], foo: 'bar' })
    expect(Object.keys(t).sort()).toEqual(['formaties', 'grootte'])
  })

  it('tolerant voor null/undefined/rommel', () => {
    expect(normalizeOefeningTeam(null).formaties).toEqual([])
    expect(normalizeOefeningTeam(undefined).formaties).toEqual([])
    expect(Number.isNaN(normalizeOefeningTeam({}).grootte)).toBe(true)
  })
})

describe('normalizeOefeningTeams', () => {
  it('normaliseert een gemengde legacy/nieuwe lijst', () => {
    expect(
      normalizeOefeningTeams([
        { grootte: 4, formatie: '2-1' },
        { grootte: 6, formaties: ['3-2', '2-2-1'] },
        { grootte: 8, formatie: null },
      ]),
    ).toEqual([
      { grootte: 4, formaties: ['2-1'] },
      { grootte: 6, formaties: ['3-2', '2-2-1'] },
      { grootte: 8, formaties: [] },
    ])
  })

  it('niet-array → lege lijst; kapt af op 6 teams', () => {
    expect(normalizeOefeningTeams(null)).toEqual([])
    expect(normalizeOefeningTeams('x')).toEqual([])
    expect(normalizeOefeningTeams(Array.from({ length: 9 }, () => ({ grootte: 3 })))).toHaveLength(6)
  })
})

describe('isFormationValidForSize', () => {
  it('null formatie is altijd geldig', () => {
    expect(isFormationValidForSize(7, null)).toBe(true)
    expect(isFormationValidForSize(null, null)).toBe(true)
  })

  it('een passende formatie (key) is geldig', () => {
    expect(isFormationValidForSize(7, '2-3-1')).toBe(true)
    expect(isFormationValidForSize(6, '2-2-1')).toBe(true)
    expect(isFormationValidForSize(11, '4-3-3')).toBe(true)
  })

  it('een niet-passende formatie is ongeldig', () => {
    expect(isFormationValidForSize(7, '4-3-3')).toBe(false)
    expect(isFormationValidForSize(3, '2-3-1')).toBe(false)
  })

  it('een formatie zonder grootte is ongeldig', () => {
    expect(isFormationValidForSize(null, '4-3-3')).toBe(false)
  })
})
