import { describe, it, expect } from 'vitest'
import {
  formationsForSize,
  normalizeOefeningTeam,
  normalizeOefeningTeams,
  FORMATIONS,
  FORMATIONS_BY_TEAM_SIZE,
} from '@/lib/types'

// basisFormatieDef en isFormatieGeldigVoorTeam (voorheen isFormationValidForSize)
// zijn verhuisd naar lib/formaties.ts; hun tests staan in lib/formaties.test.ts.

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

describe('normalizeOefeningTeam (dual-read)', () => {
  it('legacy formatie-string → array van één', () => {
    expect(normalizeOefeningTeam({ grootte: 4, formatie: '2-1' })).toEqual({
      grootte: 4,
      formaties: ['2-1'],
      keeperInGrootte: true,
    })
  })

  it('legacy formatie null/lege string → lege array', () => {
    expect(normalizeOefeningTeam({ grootte: 4, formatie: null })).toEqual({
      grootte: 4,
      formaties: [],
      keeperInGrootte: true,
    })
    expect(normalizeOefeningTeam({ grootte: 4, formatie: '' })).toEqual({
      grootte: 4,
      formaties: [],
      keeperInGrootte: true,
    })
  })

  it('nieuwe vorm blijft behouden', () => {
    expect(normalizeOefeningTeam({ grootte: 4, formaties: ['2-1', '1-2'] })).toEqual({
      grootte: 4,
      formaties: ['2-1', '1-2'],
      keeperInGrootte: true,
    })
  })

  it('formaties heeft voorrang op een meegestuurd legacy formatie-veld', () => {
    expect(normalizeOefeningTeam({ grootte: 4, formaties: ['1-2'], formatie: '2-1' })).toEqual({
      grootte: 4,
      formaties: ['1-2'],
      keeperInGrootte: true,
    })
  })

  it('ontdubbelt en gooit niet-strings/lege strings weg', () => {
    expect(
      normalizeOefeningTeam({ grootte: 4, formaties: ['2-1', '2-1', '', 7, null, '1-2'] }),
    ).toEqual({ grootte: 4, formaties: ['2-1', '1-2'], keeperInGrootte: true })
  })

  it('stript onbekende velden', () => {
    const t = normalizeOefeningTeam({ grootte: 6, formaties: ['3-2'], foo: 'bar' })
    expect(Object.keys(t).sort()).toEqual(['formaties', 'grootte', 'keeperInGrootte'])
  })

  it('tolerant voor null/undefined/rommel', () => {
    expect(normalizeOefeningTeam(null).formaties).toEqual([])
    expect(normalizeOefeningTeam(undefined).formaties).toEqual([])
    expect(Number.isNaN(normalizeOefeningTeam({}).grootte)).toBe(true)
  })
})

describe('normalizeOefeningTeam (keeperInGrootte)', () => {
  it('ontbrekend veld → true (bestaande rijen tellen de keeper mee)', () => {
    expect(normalizeOefeningTeam({ grootte: 6, formaties: [] }).keeperInGrootte).toBe(true)
  })

  it('expliciet false blijft false', () => {
    expect(normalizeOefeningTeam({ grootte: 6, keeperInGrootte: false }).keeperInGrootte).toBe(false)
  })

  it('niet-booleaanse rommel valt terug op de default true', () => {
    for (const raw of ['false', 0, null, [], {}]) {
      expect(normalizeOefeningTeam({ grootte: 6, keeperInGrootte: raw }).keeperInGrootte).toBe(true)
    }
  })

  it('grootte 11 forceert true, ongeacht de invoer', () => {
    expect(normalizeOefeningTeam({ grootte: 11, keeperInGrootte: false }).keeperInGrootte).toBe(true)
  })
})

describe('normalizeOefeningTeams', () => {
  it('normaliseert een gemengde legacy/nieuwe lijst', () => {
    expect(
      normalizeOefeningTeams([
        { grootte: 4, formatie: '2-1' },
        { grootte: 6, formaties: ['3-2', '2-2-1'], keeperInGrootte: false },
        { grootte: 8, formatie: null },
      ]),
    ).toEqual([
      { grootte: 4, formaties: ['2-1'], keeperInGrootte: true },
      { grootte: 6, formaties: ['3-2', '2-2-1'], keeperInGrootte: false },
      { grootte: 8, formaties: [], keeperInGrootte: true },
    ])
  })

  it('niet-array → lege lijst; kapt af op 6 teams', () => {
    expect(normalizeOefeningTeams(null)).toEqual([])
    expect(normalizeOefeningTeams('x')).toEqual([])
    expect(normalizeOefeningTeams(Array.from({ length: 9 }, () => ({ grootte: 3 })))).toHaveLength(6)
  })
})
