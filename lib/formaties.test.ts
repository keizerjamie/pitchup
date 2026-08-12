import { describe, it, expect } from 'vitest'
import {
  MAX_VERDEDIGERS,
  MAX_MIDDENVELDERS,
  MAX_AANVALLERS,
  VALID_TEAM_SIZES,
  aantalVeldspelers,
  basisFormatieDef,
  formatieKey,
  formatieLabel,
  formatiesVoorTeam,
  genereerFormaties,
  isFormatieGeldigVoorTeam,
  layoutPosities,
} from '@/lib/formaties'
import { OEFENING_CATEGORIES, formationsForSize, type OefeningCategorie } from '@/lib/types'

// Alle categorieën waarin élke linie gevuld moet zijn, versus de rest.
const ALLE_LINIES: OefeningCategorie = 'partijen_groot'
const VRIJE_LINIES: OefeningCategorie = 'partijen_klein'

// Hulpje: de compositie terug uitlezen uit een canonieke key "V-M-A".
function compositieVanKey(key: string) {
  const [v, m, a] = key.split('-').map(Number)
  return { v, m, a }
}

describe('formatieLabel / formatieKey', () => {
  it('key is altijd V-M-A met drie getallen', () => {
    expect(formatieKey({ v: 2, m: 0, a: 3 })).toBe('2-0-3')
    expect(formatieKey({ v: 0, m: 0, a: 0 })).toBe('0-0-0')
    expect(formatieKey({ v: 1, m: 1, a: 1 })).toBe('1-1-1')
  })

  it('label laat nulle linies weg, in volgorde V,M,A', () => {
    expect(formatieLabel({ v: 0, m: 2, a: 3 })).toBe('2-3')
    expect(formatieLabel({ v: 2, m: 0, a: 3 })).toBe('2-3')
    expect(formatieLabel({ v: 4, m: 0, a: 0 })).toBe('4')
    expect(formatieLabel({ v: 1, m: 1, a: 1 })).toBe('1-1-1')
  })
})

describe('genereerFormaties — controle-uitkomsten', () => {
  it('2 veldspelers, vrije linies → 1-1 en 2', () => {
    const lijst = genereerFormaties(2, false)
    expect(lijst.map((f) => f.label)).toEqual(['1-1', '2'])
    expect(lijst.map((f) => f.key)).toEqual(['1-0-1', '2-0-0'])
  })

  it('2 veldspelers, alle linies gevuld → leeg (N < 3 kan geen V+M+A>=1 vullen)', () => {
    expect(genereerFormaties(2, true)).toEqual([])
  })

  it('3 veldspelers, alle linies gevuld → alleen 1-1-1', () => {
    expect(genereerFormaties(3, true).map((f) => f.label)).toEqual(['1-1-1'])
  })

  it('10 veldspelers, vrije linies → de verwachte 10 opties in alfabetische volgorde', () => {
    expect(genereerFormaties(10, false).map((f) => f.label)).toEqual([
      '2-5-3', '3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-2-3', '5-3-2', '5-4-1', '5-5',
    ])
  })

  it('niet-positieve of niet-gehele N → lege lijst', () => {
    expect(genereerFormaties(0, false)).toEqual([])
    expect(genereerFormaties(-3, false)).toEqual([])
    expect(genereerFormaties(4.5, false)).toEqual([])
    expect(genereerFormaties(Number.NaN, false)).toEqual([])
  })
})

describe('genereerFormaties — constraints', () => {
  it('elke compositie telt op tot N en blijft binnen de maxima', () => {
    for (let n = 1; n <= 10; n++) {
      for (const alleLinies of [false, true]) {
        for (const f of genereerFormaties(n, alleLinies)) {
          const { v, m, a } = compositieVanKey(f.key)
          expect(v + m + a).toBe(n)
          expect(v).toBeLessThanOrEqual(MAX_VERDEDIGERS)
          expect(m).toBeLessThanOrEqual(MAX_MIDDENVELDERS)
          expect(a).toBeLessThanOrEqual(MAX_AANVALLERS)
          expect(Math.min(v, m, a)).toBeGreaterThanOrEqual(alleLinies ? 1 : 0)
        }
      }
    }
  })

  it('alle linies gevuld is een deelverzameling van de vrije variant (zelfde keys)', () => {
    for (let n = 1; n <= 10; n++) {
      const superset = new Set(genereerFormaties(n, false).map((f) => f.key))
      for (const f of genereerFormaties(n, true)) {
        expect(superset.has(f.key)).toBe(true)
      }
    }
  })

  it('labels zijn uniek en bevatten nooit een 0', () => {
    for (let n = 1; n <= 10; n++) {
      for (const alleLinies of [false, true]) {
        const labels = genereerFormaties(n, alleLinies).map((f) => f.label)
        expect(new Set(labels).size).toBe(labels.length)
        for (const label of labels) {
          expect(label.split('-').every((deel) => Number(deel) > 0)).toBe(true)
        }
      }
    }
  })

  it('sorteert alfabetisch op label', () => {
    for (let n = 1; n <= 10; n++) {
      const labels = genereerFormaties(n, false).map((f) => f.label)
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'nl')))
    }
  })

  it('geeft dezelfde (gecachete) array terug bij herhaald aanroepen', () => {
    expect(genereerFormaties(7, false)).toBe(genereerFormaties(7, false))
    expect(genereerFormaties(7, true)).toBe(genereerFormaties(7, true))
    expect(genereerFormaties(7, false)).not.toBe(genereerFormaties(7, true))
  })
})

describe('genereerFormaties — dedupe + tie-break (meeste V, dan meeste A)', () => {
  const tabel: { n: number; label: string; key: string }[] = [
    { n: 2, label: '1-1', key: '1-0-1' },
    { n: 3, label: '2-1', key: '2-0-1' },
    { n: 3, label: '1-2', key: '1-0-2' },
    { n: 5, label: '3-2', key: '3-0-2' },
    { n: 4, label: '4', key: '4-0-0' },
    { n: 6, label: '2-4', key: '2-4-0' },
  ]

  for (const { n, label, key } of tabel) {
    it(`N=${n}: label '${label}' → key '${key}'`, () => {
      const gevonden = genereerFormaties(n, false).find((f) => f.label === label)
      expect(gevonden?.key).toBe(key)
    })
  }

  it('reproduceert de gecureerde tweedelige formaties uit FORMATIONS_BY_TEAM_SIZE', () => {
    // '1-1' (grootte 3), '2-1'/'1-2' (grootte 4) en '3-2' (grootte 6) — inclusief
    // keeper, dus N = grootte - 1.
    for (const { grootte, label } of [
      { grootte: 3, label: '1-1' },
      { grootte: 4, label: '2-1' },
      { grootte: 4, label: '1-2' },
      { grootte: 6, label: '3-2' },
    ]) {
      const gegenereerd = genereerFormaties(grootte - 1, false).find((f) => f.label === label)
      expect(gegenereerd, `${grootte}: ${label}`).toBeDefined()
      // De gecureerde variant heeft hetzelfde label; de key is nu zelfbeschrijvend.
      expect(formationsForSize(grootte).some((f) => f.label === label)).toBe(true)
    }
  })
})

describe('layoutPosities', () => {
  it('met keeper: K-marker + één marker per veldspeler', () => {
    const pos = layoutPosities({ v: 2, m: 0, a: 1 }, true)
    expect(pos).toHaveLength(4)
    expect(pos[0]).toEqual({ x: 50, y: 90, position_label: 'K' })
    expect(pos.filter((p) => p.position_label === 'K')).toHaveLength(1)
    // Alleen de keeper is gelabeld; V/M/A krijgen géén tekst.
    expect(pos.slice(1).every((p) => p.position_label === '')).toBe(true)
  })

  it('zonder keeper: alleen veldspelers, GEEN K-marker', () => {
    const pos = layoutPosities({ v: 2, m: 0, a: 1 }, false)
    expect(pos).toHaveLength(3)
    expect(pos.every((p) => p.position_label === '')).toBe(true)
  })

  it('linies liggen op hun eigen hoogte, aanval het dichtst bij het doel van de tegenstander', () => {
    const pos = layoutPosities({ v: 1, m: 1, a: 1 }, true)
    const [keeper, verdediger, middenvelder, aanvaller] = pos
    expect(keeper.y).toBeGreaterThan(verdediger.y)
    expect(verdediger.y).toBeGreaterThan(middenvelder.y)
    expect(middenvelder.y).toBeGreaterThan(aanvaller.y)
  })

  it('één speler in een linie staat gecentreerd, meerdere symmetrisch rond 50', () => {
    expect(layoutPosities({ v: 1, m: 0, a: 0 }, false)).toEqual([
      { x: 50, y: 68, position_label: '' },
    ])
    const drie = layoutPosities({ v: 3, m: 0, a: 0 }, false).map((p) => p.x)
    expect(drie).toHaveLength(3)
    expect(drie[0] + drie[2]).toBeCloseTo(100, 5)
    expect(drie[1]).toBe(50)
  })

  it('alle x-posities blijven binnen [0,100]', () => {
    for (let k = 1; k <= 5; k++) {
      for (const p of layoutPosities({ v: k, m: 0, a: 0 }, false)) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(100)
      }
    }
  })

  it('lege compositie zonder keeper → geen posities', () => {
    expect(layoutPosities({ v: 0, m: 0, a: 0 }, false)).toEqual([])
  })
})

describe('aantalVeldspelers', () => {
  it('keeperInGrootte ontbreekt → default true → grootte - 1', () => {
    expect(aantalVeldspelers({ grootte: 7 })).toBe(6)
    expect(aantalVeldspelers({ grootte: 7, keeperInGrootte: true })).toBe(6)
  })

  it('keeperInGrootte false → grootte veldspelers', () => {
    expect(aantalVeldspelers({ grootte: 7, keeperInGrootte: false })).toBe(7)
  })

  it('11-tal forceert inclusief keeper', () => {
    expect(aantalVeldspelers({ grootte: 11, keeperInGrootte: false })).toBe(10)
  })
})

describe('formatiesVoorTeam', () => {
  it('11-tal → de gecureerde lijst, ongeacht categorie of keeper-stand', () => {
    for (const categorie of OEFENING_CATEGORIES) {
      expect(formatiesVoorTeam({ grootte: 11 }, categorie)).toBe(formationsForSize(11))
      expect(formatiesVoorTeam({ grootte: 11, keeperInGrootte: false }, categorie)).toBe(
        formationsForSize(11),
      )
    }
  })

  it('elke formatie heeft exact `grootte` posities — met én zonder keeper', () => {
    for (const grootte of VALID_TEAM_SIZES) {
      for (const keeperInGrootte of [true, false]) {
        for (const categorie of [ALLE_LINIES, VRIJE_LINIES]) {
          for (const f of formatiesVoorTeam({ grootte, keeperInGrootte }, categorie)) {
            expect(f.positions, `${grootte}/${keeperInGrootte}/${categorie}`).toHaveLength(grootte)
          }
        }
      }
    }
  })

  it('keeper-stand bepaalt of er een K-marker is, maar nooit de key of het label', () => {
    const met = formatiesVoorTeam({ grootte: 6, keeperInGrootte: true }, VRIJE_LINIES)
    const zonder = formatiesVoorTeam({ grootte: 6, keeperInGrootte: false }, VRIJE_LINIES)
    // Andere catalogus (5 vs. 6 veldspelers), maar binnen één stand geldt:
    expect(met.every((f) => f.positions.some((p) => p.position_label === 'K'))).toBe(true)
    expect(zonder.every((f) => f.positions.every((p) => p.position_label !== 'K'))).toBe(true)

    // Zelfde catalogus (7 zonder keeper = 6 met keeper → 6 veldspelers):
    const a = formatiesVoorTeam({ grootte: 7, keeperInGrootte: true }, VRIJE_LINIES)
    const b = formatiesVoorTeam({ grootte: 6, keeperInGrootte: false }, VRIJE_LINIES)
    expect(a.map((f) => f.key)).toEqual(b.map((f) => f.key))
    expect(a.map((f) => f.label)).toEqual(b.map((f) => f.label))
  })

  it('partijen_groot is strenger dan de overige categorieën', () => {
    const groot = formatiesVoorTeam({ grootte: 6 }, ALLE_LINIES).map((f) => f.key)
    const klein = formatiesVoorTeam({ grootte: 6 }, VRIJE_LINIES).map((f) => f.key)
    expect(groot.length).toBeLessThan(klein.length)
    expect(klein).toEqual(expect.arrayContaining(groot))
    // Concreet: '3-0-2' (geen middenvelder) mag niet bij partijen_groot.
    expect(klein).toContain('3-0-2')
    expect(groot).not.toContain('3-0-2')
  })

  it('grootte 10 levert nu wél formaties op (was leeg in de gecureerde lijst)', () => {
    expect(formationsForSize(10)).toEqual([])
    expect(formatiesVoorTeam({ grootte: 10 }, VRIJE_LINIES).length).toBeGreaterThan(0)
  })

  // De onderliggende regel: een combinatie is leeg dan en slechts dan als er geen
  // veldspelers over zijn (N <= 0), of als partijen_groot alle drie de linies eist
  // terwijl er minder dan 3 veldspelers zijn. Het 11-tal gebruikt de gecureerde
  // lijst en is daarom nooit leeg.
  it('leeg ⟺ N <= 0 of (partijen_groot en N < 3) — exhaustief over alle groottes', () => {
    for (const grootte of VALID_TEAM_SIZES) {
      for (const keeperInGrootte of [true, false]) {
        const N = aantalVeldspelers({ grootte, keeperInGrootte })
        for (const categorie of OEFENING_CATEGORIES) {
          const leeg = formatiesVoorTeam({ grootte, keeperInGrootte }, categorie).length === 0
          const verwachtLeeg =
            grootte !== 11 && (N <= 0 || (categorie === 'partijen_groot' && N < 3))
          expect(leeg, `${grootte}/${keeperInGrootte}/${categorie}`).toBe(verwachtLeeg)
        }
      }
    }
  })

  it('de volledige set lege combinaties, expliciet benoemd', () => {
    const leegVerwacht: [number, boolean, OefeningCategorie[]][] = [
      // grootte 1 inclusief keeper → 0 veldspelers → nooit een formatie.
      [1, true, [...OEFENING_CATEGORIES]],
      // Te weinig veldspelers voor V>=1, M>=1 én A>=1.
      [1, false, ['partijen_groot']],
      [2, true, ['partijen_groot']],
      [2, false, ['partijen_groot']],
      [3, true, ['partijen_groot']],
    ]
    for (const [grootte, keeperInGrootte, categorieen] of leegVerwacht) {
      for (const categorie of categorieen) {
        expect(
          formatiesVoorTeam({ grootte, keeperInGrootte }, categorie),
          `${grootte}/${keeperInGrootte}/${categorie}`,
        ).toHaveLength(0)
      }
    }
  })

  it('kleine groottes leveren buiten partijen_groot wél formaties op', () => {
    for (const categorie of OEFENING_CATEGORIES.filter((c) => c !== 'partijen_groot')) {
      // 1 zonder keeper = 1 veldspeler, 2 zonder keeper = 2, 2 met keeper = 1.
      expect(
        formatiesVoorTeam({ grootte: 1, keeperInGrootte: false }, categorie).length,
        `1/false/${categorie}`,
      ).toBeGreaterThan(0)
      expect(
        formatiesVoorTeam({ grootte: 2, keeperInGrootte: true }, categorie).length,
        `2/true/${categorie}`,
      ).toBeGreaterThan(0)
      expect(
        formatiesVoorTeam({ grootte: 2, keeperInGrootte: false }, categorie).length,
        `2/false/${categorie}`,
      ).toBeGreaterThan(0)
    }
    // En bij 3 zonder keeper (N=3) is zelfs partijen_groot haalbaar: 1-1-1.
    expect(formatiesVoorTeam({ grootte: 3, keeperInGrootte: false }, 'partijen_groot').map((f) => f.key))
      .toEqual(['1-1-1'])
  })
})

describe('basisFormatieDef', () => {
  it('lege/null/undefined selectie → null (= geen formatie)', () => {
    expect(basisFormatieDef({ grootte: 4, formaties: [] })).toBeNull()
    expect(basisFormatieDef({ grootte: 4, formaties: null })).toBeNull()
    expect(basisFormatieDef({ grootte: 4 })).toBeNull()
    expect(basisFormatieDef(null)).toBeNull()
    expect(basisFormatieDef(undefined)).toBeNull()
  })

  it('één selectie op key → die formatie', () => {
    expect(basisFormatieDef({ grootte: 4, formaties: ['2-0-1'] })?.key).toBe('2-0-1')
  })

  it('accepteert ook labels in plaats van keys', () => {
    expect(basisFormatieDef({ grootte: 4, formaties: ['2-1'] })?.key).toBe('2-0-1')
    expect(basisFormatieDef({ grootte: 6, formaties: ['3-2'] })?.key).toBe('3-0-2')
  })

  it('resolvet categorie-onafhankelijk: dezelfde key bij elke categorie', () => {
    const def = basisFormatieDef({ grootte: 6, formaties: ['2-2-1'] })
    expect(def?.key).toBe('2-2-1')
    // '2-2-1' hoort bij partijen_groot én bij de vrije categorieën.
    expect(isFormatieGeldigVoorTeam('2-2-1', { grootte: 6 }, ALLE_LINIES)).toBe(true)
    expect(isFormatieGeldigVoorTeam('2-2-1', { grootte: 6 }, VRIJE_LINIES)).toBe(true)
  })

  it('volgt de keeper-stand voor de posities, niet voor de key', () => {
    const met = basisFormatieDef({ grootte: 4, formaties: ['2-0-1'], keeperInGrootte: true })!
    const zonder = basisFormatieDef({ grootte: 3, formaties: ['2-0-1'], keeperInGrootte: false })!
    expect(met.key).toBe(zonder.key)
    expect(met.positions).toHaveLength(4)
    expect(zonder.positions).toHaveLength(3)
    expect(met.positions.some((p) => p.position_label === 'K')).toBe(true)
    expect(zonder.positions.some((p) => p.position_label === 'K')).toBe(false)
  })

  it('11-tal gebruikt de gecureerde lijst', () => {
    expect(basisFormatieDef({ grootte: 11, formaties: ['4-3-3'] })?.key).toBe('4-3-3')
    expect(basisFormatieDef({ grootte: 11, formaties: ['4-3-3'] })?.positions).toHaveLength(11)
  })

  it('meerdere waarden (oude multi-select-data) → de alfabetisch eerste', () => {
    expect(basisFormatieDef({ grootte: 4, formaties: ['2-0-1', '1-0-2'] })?.label).toBe('1-2')
    expect(basisFormatieDef({ grootte: 4, formaties: ['1-0-2', '2-0-1'] })?.label).toBe('1-2')
    expect(basisFormatieDef({ grootte: 11, formaties: ['5-3-2', '4-4-2', '3-4-3'] })?.key).toBe(
      '3-4-3',
    )
  })

  it('legacy-vangnet: oude gecureerde key 2-0+K blijft resolvebaar', () => {
    expect(basisFormatieDef({ grootte: 3, formaties: ['2-0+K'] })?.key).toBe('2-0+K')
  })

  it('onbekende key of onbekende grootte → null', () => {
    expect(basisFormatieDef({ grootte: 4, formaties: ['4-3-3'] })).toBeNull()
    expect(basisFormatieDef({ grootte: 4, formaties: ['onzin'] })).toBeNull()
    expect(basisFormatieDef({ grootte: 99, formaties: ['2-0-1'] })).toBeNull()
  })
})

describe('isFormatieGeldigVoorTeam', () => {
  it('een passende key of label is geldig', () => {
    expect(isFormatieGeldigVoorTeam('2-0-1', { grootte: 4 }, VRIJE_LINIES)).toBe(true)
    expect(isFormatieGeldigVoorTeam('2-1', { grootte: 4 }, VRIJE_LINIES)).toBe(true)
    expect(isFormatieGeldigVoorTeam('4-3-3', { grootte: 11 }, VRIJE_LINIES)).toBe(true)
  })

  it('dezelfde key kan bij partijen_groot ongeldig zijn en elders geldig', () => {
    expect(isFormatieGeldigVoorTeam('3-0-2', { grootte: 6 }, VRIJE_LINIES)).toBe(true)
    expect(isFormatieGeldigVoorTeam('3-0-2', { grootte: 6 }, ALLE_LINIES)).toBe(false)
  })

  it('de keeper-stand verandert de geldige keys', () => {
    // 6-tal inclusief keeper = 5 veldspelers; exclusief keeper = 6 veldspelers.
    expect(isFormatieGeldigVoorTeam('2-2-1', { grootte: 6, keeperInGrootte: true }, VRIJE_LINIES))
      .toBe(true)
    expect(isFormatieGeldigVoorTeam('2-2-1', { grootte: 6, keeperInGrootte: false }, VRIJE_LINIES))
      .toBe(false)
  })

  it('een niet-passende of onzinnige waarde is ongeldig', () => {
    expect(isFormatieGeldigVoorTeam('4-3-3', { grootte: 7 }, VRIJE_LINIES)).toBe(false)
    expect(isFormatieGeldigVoorTeam('', { grootte: 7 }, VRIJE_LINIES)).toBe(false)
    expect(isFormatieGeldigVoorTeam('2-0-1', { grootte: 99 }, VRIJE_LINIES)).toBe(false)
  })
})

describe('VALID_TEAM_SIZES', () => {
  it('1 t/m 11, inclusief 1 en 2 (kleine oefenvormen) en 10', () => {
    expect(VALID_TEAM_SIZES).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })
})
