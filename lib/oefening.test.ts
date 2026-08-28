import { describe, it, expect } from 'vitest'
import { validateOefening, type OefeningInput } from '@/lib/oefening'

// Dit bestand dekt bewust ALLEEN de regels rond flexibele oefenvormen
// (grootteMax / aantal_neutralen_max). De overige validatie van
// validateOefening is al gedekt via app/actions/oefening-library.test.ts en de
// acceptatietests; die dekking wordt hier niet gekopieerd.

const baseInput = (over: Partial<OefeningInput> = {}): OefeningInput => ({
  naam: 'Rondo',
  categorie: 'partijen_klein',
  teams: [],
  aantal_neutralen: 0,
  ...over,
})

describe('validateOefening — grootteMax', () => {
  it('bewaart een geldig bereik op een team zonder formatie', () => {
    const v = validateOefening(baseInput({ teams: [{ grootte: 4, formaties: [], grootteMax: 6 }] }))
    expect(v.teams).toEqual([{ grootte: 4, formaties: [], keeperInGrootte: true, grootteMax: 6 }])
  })

  it('laat het veld WEG zonder bereik (byte-identieke JSONB als vóór de feature)', () => {
    const v = validateOefening(baseInput({ teams: [{ grootte: 4, formaties: [] }] }))
    expect(v.teams).toEqual([{ grootte: 4, formaties: [], keeperInGrootte: true }])
    expect(Object.keys(v.teams[0]).sort()).toEqual(['formaties', 'grootte', 'keeperInGrootte'])

    // Expliciete null telt óók als "geen bereik".
    const metNull = validateOefening(
      baseInput({ teams: [{ grootte: 4, formaties: [], grootteMax: null }] }),
    )
    expect(Object.keys(metNull.teams[0]).sort()).toEqual(['formaties', 'grootte', 'keeperInGrootte'])
  })

  it('staat een bereik toe dat gelijk is aan de grootte', () => {
    const v = validateOefening(baseInput({ teams: [{ grootte: 4, formaties: [], grootteMax: 4 }] }))
    expect(v.teams[0].grootteMax).toBe(4)
  })

  it('weigert een formatie samen met een bereik', () => {
    expect(() =>
      validateOefening(baseInput({ teams: [{ grootte: 4, formaties: ['2-0-1'], grootteMax: 6 }] })),
    ).toThrow('Formatie kan niet samen met een spelersbereik')
  })

  it('weigert een bovengrens onder de teamgrootte', () => {
    expect(() =>
      validateOefening(baseInput({ teams: [{ grootte: 4, formaties: [], grootteMax: 3 }] })),
    ).toThrow('Bovengrens kleiner dan de teamgrootte')
  })

  it('weigert een bovengrens buiten VALID_TEAM_SIZES', () => {
    expect(() =>
      validateOefening(baseInput({ teams: [{ grootte: 4, formaties: [], grootteMax: 12 }] })),
    ).toThrow('Ongeldige teamgrootte')
    expect(() =>
      validateOefening(
        baseInput({ teams: [{ grootte: 4, formaties: [], grootteMax: 'zes' }] as never }),
      ),
    ).toThrow('Ongeldige teamgrootte')
  })
})

describe('validateOefening — aantal_neutralen_max', () => {
  it('bewaart basis 0 met een geldige bovengrens (0 is een echte basiswaarde)', () => {
    const v = validateOefening(baseInput({ aantal_neutralen: 0, aantal_neutralen_max: 4 }))
    expect(v.aantal_neutralen).toBe(0)
    expect(v.aantal_neutralen_max).toBe(4)
  })

  it('geeft null zonder bovengrens', () => {
    expect(validateOefening(baseInput({ aantal_neutralen: 2 })).aantal_neutralen_max).toBeNull()
    expect(
      validateOefening(baseInput({ aantal_neutralen: 2, aantal_neutralen_max: null }))
        .aantal_neutralen_max,
    ).toBeNull()
  })

  it('staat een bovengrens 0 toe bij een basis van 0', () => {
    const v = validateOefening(baseInput({ aantal_neutralen: 0, aantal_neutralen_max: 0 }))
    expect(v.aantal_neutralen_max).toBe(0)
  })

  it('weigert een bovengrens onder het basisaantal', () => {
    expect(() =>
      validateOefening(baseInput({ aantal_neutralen: 3, aantal_neutralen_max: 1 })),
    ).toThrow('Bovengrens kleiner dan het aantal neutralen')
  })

  it('clamt een bovengrens boven de kolomgrens van 30', () => {
    expect(validateOefening(baseInput({ aantal_neutralen: 2, aantal_neutralen_max: 99 }))
      .aantal_neutralen_max).toBe(30)
  })
})
