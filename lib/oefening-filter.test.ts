import { describe, it, expect } from 'vitest'
import {
  EMPTY_OEFENING_FILTERS,
  filterOefeningen,
  matchesOefeningFilters,
  matchesRange,
  totaalAantalSpelers,
  type OefeningFilters,
} from '@/lib/oefening-filter'
import type { Oefening } from '@/lib/types'

// Minimale, complete Oefening-fixture; alleen de velden die het filter raakt
// worden per test overschreven.
function makeOefening(over: Partial<Oefening> & { id: string }): Oefening {
  return {
    id: over.id,
    team_id: over.team_id ?? 'team-1',
    naam: over.naam ?? over.id,
    beschrijving: over.beschrijving ?? null,
    categorie: over.categorie ?? 'positiespel',
    duur_min: over.duur_min ?? null,
    breedte_m: over.breedte_m ?? null,
    lengte_m: over.lengte_m ?? null,
    orientatie: over.orientatie ?? 'vrij',
    veldzone: over.veldzone ?? null,
    teams: over.teams ?? [],
    aantal_neutralen: over.aantal_neutralen ?? 0,
    diagram: over.diagram ?? null,
    created_at: over.created_at ?? '2026-01-01T00:00:00Z',
  }
}

// Helper: filters opbouwen vanaf de neutrale beginstand.
function filters(over: Partial<OefeningFilters> = {}): OefeningFilters {
  return { ...EMPTY_OEFENING_FILTERS, ...over }
}

const ids = (list: Oefening[]) => list.map((o) => o.id)

// ────────────────────────────────────────────────
// totaalAantalSpelers
// ────────────────────────────────────────────────
describe('totaalAantalSpelers', () => {
  it('telt de teamgroottes op bij de neutralen', () => {
    const o = makeOefening({
      id: 'a',
      teams: [
        { grootte: 5, formaties: [] },
        { grootte: 5, formaties: [] },
      ],
      aantal_neutralen: 2,
    })
    expect(totaalAantalSpelers(o)).toBe(12)
  })

  it('geeft bij een lege teams-array alleen de neutralen (warming-up)', () => {
    expect(totaalAantalSpelers(makeOefening({ id: 'a', teams: [], aantal_neutralen: 4 }))).toBe(4)
  })

  it('geeft 0 als er geen teams en geen neutralen zijn', () => {
    expect(totaalAantalSpelers(makeOefening({ id: 'a', teams: [], aantal_neutralen: 0 }))).toBe(0)
  })

  it('telt geen andere velden mee (afmetingen, oriëntatie, diagram)', () => {
    const o = makeOefening({
      id: 'a',
      teams: [{ grootte: 3, formaties: [] }],
      aantal_neutralen: 1,
      breedte_m: 40,
      lengte_m: 60,
      orientatie: 'breedte',
      diagram: { markers: [], materiaal: [], lijnen: [] },
    })
    expect(totaalAantalSpelers(o)).toBe(4)
  })

  it('is defensief tegen ontbrekende/rommelige teams en neutralen', () => {
    const rommel = {
      teams: [{ grootte: 5, formaties: [] }, null, { formaties: [] }],
      aantal_neutralen: null,
    } as unknown as Pick<Oefening, 'teams' | 'aantal_neutralen'>
    expect(totaalAantalSpelers(rommel)).toBe(5)

    const zonderTeams = { aantal_neutralen: 3 } as unknown as Pick<
      Oefening,
      'teams' | 'aantal_neutralen'
    >
    expect(totaalAantalSpelers(zonderTeams)).toBe(3)
  })
})

// ────────────────────────────────────────────────
// matchesRange
// ────────────────────────────────────────────────
describe('matchesRange', () => {
  it('laat alles door als min en max beide null zijn (filter inactief)', () => {
    expect(matchesRange(7, null, null)).toBe(true)
    expect(matchesRange(null, null, null)).toBe(true)
  })

  it('sluit een null-waarde uit zodra een grens actief is', () => {
    expect(matchesRange(null, 5, null)).toBe(false)
    expect(matchesRange(null, null, 5)).toBe(false)
    expect(matchesRange(null, 5, 10)).toBe(false)
  })

  it('past alleen de ingevulde grens toe', () => {
    expect(matchesRange(4, 5, null)).toBe(false)
    expect(matchesRange(6, 5, null)).toBe(true)
    expect(matchesRange(6, null, 5)).toBe(false)
    expect(matchesRange(4, null, 5)).toBe(true)
  })

  it('rekent de grenzen inclusief', () => {
    expect(matchesRange(5, 5, 10)).toBe(true)
    expect(matchesRange(10, 5, 10)).toBe(true)
    expect(matchesRange(4, 5, 10)).toBe(false)
    expect(matchesRange(11, 5, 10)).toBe(false)
  })

  it('behandelt 0 als een geldige actieve grens (geen falsy-zero bug)', () => {
    // min = 0 is een ECHT filter: een null-waarde valt af.
    expect(matchesRange(null, 0, null)).toBe(false)
    expect(matchesRange(0, 0, null)).toBe(true)
    // max = 0 laat alleen 0 door.
    expect(matchesRange(0, null, 0)).toBe(true)
    expect(matchesRange(1, null, 0)).toBe(false)
  })

  it('geeft bij min > max altijd false, zonder exception', () => {
    expect(() => matchesRange(7, 10, 5)).not.toThrow()
    expect(matchesRange(7, 10, 5)).toBe(false)
    expect(matchesRange(10, 10, 5)).toBe(false)
    expect(matchesRange(5, 10, 5)).toBe(false)
  })
})

// ────────────────────────────────────────────────
// matchesOefeningFilters / filterOefeningen — losse dimensies
// ────────────────────────────────────────────────
describe('filterOefeningen — categorie', () => {
  const list = [
    makeOefening({ id: 'w', categorie: 'warming_up' }),
    makeOefening({ id: 'p', categorie: 'positiespel' }),
    makeOefening({ id: 'p2', categorie: 'positiespel' }),
  ]

  it('houdt alleen de exacte match over', () => {
    expect(ids(filterOefeningen(list, filters({ categorie: 'positiespel' })))).toEqual(['p', 'p2'])
  })

  it('laat alles door als het filter inactief is (null)', () => {
    expect(ids(filterOefeningen(list, filters({ categorie: null })))).toEqual(['w', 'p', 'p2'])
  })
})

describe('filterOefeningen — veldzone', () => {
  const list = [
    makeOefening({ id: 'links', veldzone: 'links' }),
    makeOefening({ id: 'midden', veldzone: 'midden' }),
    makeOefening({ id: 'geen', veldzone: null }),
  ]

  it('houdt alleen de exacte match over', () => {
    expect(ids(filterOefeningen(list, filters({ veldzone: 'links' })))).toEqual(['links'])
  })

  it('laat een oefening zonder veldzone afvallen zodra het filter actief is', () => {
    expect(ids(filterOefeningen(list, filters({ veldzone: 'midden' })))).toEqual(['midden'])
  })

  it('laat alles door als het filter inactief is (null)', () => {
    expect(ids(filterOefeningen(list, filters({ veldzone: null })))).toEqual([
      'links',
      'midden',
      'geen',
    ])
  })
})

describe('filterOefeningen — aantal spelers', () => {
  // Totalen: 4, 8, 12 (teams + neutralen).
  const list = [
    makeOefening({ id: 'vier', teams: [{ grootte: 2, formaties: [] }], aantal_neutralen: 2 }),
    makeOefening({ id: 'acht', teams: [{ grootte: 4, formaties: [] }], aantal_neutralen: 4 }),
    makeOefening({
      id: 'twaalf',
      teams: [
        { grootte: 5, formaties: [] },
        { grootte: 5, formaties: [] },
      ],
      aantal_neutralen: 2,
    }),
  ]

  it('filtert op alleen een minimum', () => {
    expect(ids(filterOefeningen(list, filters({ aantalMin: 8 })))).toEqual(['acht', 'twaalf'])
  })

  it('filtert op alleen een maximum', () => {
    expect(ids(filterOefeningen(list, filters({ aantalMax: 8 })))).toEqual(['vier', 'acht'])
  })

  it('filtert op min én max samen', () => {
    expect(ids(filterOefeningen(list, filters({ aantalMin: 5, aantalMax: 12 })))).toEqual([
      'acht',
      'twaalf',
    ])
  })

  it('matcht grenswaarden die exact gelijk zijn aan min of max (inclusief)', () => {
    expect(ids(filterOefeningen(list, filters({ aantalMin: 8, aantalMax: 8 })))).toEqual(['acht'])
  })

  it('geeft een lege lijst bij min > max, zonder exception', () => {
    expect(() => filterOefeningen(list, filters({ aantalMin: 12, aantalMax: 4 }))).not.toThrow()
    expect(filterOefeningen(list, filters({ aantalMin: 12, aantalMax: 4 }))).toEqual([])
  })

  it('behandelt aantalMin: 0 als actief filter (0 is niet "geen filter")', () => {
    // Alle totalen zijn >= 0, dus met alleen min: 0 blijft alles over…
    expect(ids(filterOefeningen(list, filters({ aantalMin: 0 })))).toEqual([
      'vier',
      'acht',
      'twaalf',
    ])
    // …maar min: 0 + max: 0 laat alleen een oefening zonder spelers door.
    const metNul = [...list, makeOefening({ id: 'nul', teams: [], aantal_neutralen: 0 })]
    expect(ids(filterOefeningen(metNul, filters({ aantalMin: 0, aantalMax: 0 })))).toEqual(['nul'])
  })
})

describe('filterOefeningen — duur', () => {
  const list = [
    makeOefening({ id: 'kort', duur_min: 10 }),
    makeOefening({ id: 'midden', duur_min: 20 }),
    makeOefening({ id: 'lang', duur_min: 30 }),
    makeOefening({ id: 'onbekend', duur_min: null }),
  ]

  it('filtert op alleen een minimum', () => {
    expect(ids(filterOefeningen(list, filters({ duurMin: 20 })))).toEqual(['midden', 'lang'])
  })

  it('filtert op alleen een maximum', () => {
    expect(ids(filterOefeningen(list, filters({ duurMax: 20 })))).toEqual(['kort', 'midden'])
  })

  it('filtert op min én max samen', () => {
    expect(ids(filterOefeningen(list, filters({ duurMin: 15, duurMax: 30 })))).toEqual([
      'midden',
      'lang',
    ])
  })

  it('matcht grenswaarden exact gelijk aan min of max (inclusief)', () => {
    expect(ids(filterOefeningen(list, filters({ duurMin: 10, duurMax: 10 })))).toEqual(['kort'])
    expect(ids(filterOefeningen(list, filters({ duurMin: 30, duurMax: 30 })))).toEqual(['lang'])
  })

  it('laat duur_min = null afvallen zodra een grens actief is', () => {
    expect(ids(filterOefeningen(list, filters({ duurMin: 5 })))).not.toContain('onbekend')
    expect(ids(filterOefeningen(list, filters({ duurMax: 999 })))).not.toContain('onbekend')
    // Zonder actief duurfilter blijft hij gewoon staan.
    expect(ids(filterOefeningen(list, filters()))).toContain('onbekend')
  })

  it('geeft een lege lijst bij min > max, zonder exception', () => {
    expect(() => filterOefeningen(list, filters({ duurMin: 30, duurMax: 10 }))).not.toThrow()
    expect(filterOefeningen(list, filters({ duurMin: 30, duurMax: 10 }))).toEqual([])
  })

  it('behandelt duurMin: 0 als actief filter (0 is niet "geen filter")', () => {
    // duurMin: 0 is actief: de oefening zonder duur valt af, de rest blijft.
    expect(ids(filterOefeningen(list, filters({ duurMin: 0 })))).toEqual(['kort', 'midden', 'lang'])
    const metNul = [...list, makeOefening({ id: 'nulmin', duur_min: 0 })]
    expect(ids(filterOefeningen(metNul, filters({ duurMin: 0, duurMax: 0 })))).toEqual(['nulmin'])
  })
})

// ────────────────────────────────────────────────
// query + combinaties (AND)
// ────────────────────────────────────────────────
describe('filterOefeningen — query', () => {
  const list = [
    makeOefening({ id: 'a', naam: 'Rondo 5 tegen 2' }),
    makeOefening({ id: 'b', naam: 'Positiespel 4v4' }),
    makeOefening({ id: 'c', naam: 'RONDO opwarming' }),
  ]

  it('zoekt case-insensitief op substring in de naam', () => {
    expect(ids(filterOefeningen(list, filters({ query: 'rondo' })))).toEqual(['a', 'c'])
    expect(ids(filterOefeningen(list, filters({ query: 'RoNdO' })))).toEqual(['a', 'c'])
    expect(ids(filterOefeningen(list, filters({ query: 'tegen' })))).toEqual(['a'])
  })

  it('trimt de query en behandelt spaties/lege string als geen filter', () => {
    expect(ids(filterOefeningen(list, filters({ query: '  rondo  ' })))).toEqual(['a', 'c'])
    expect(ids(filterOefeningen(list, filters({ query: '   ' })))).toEqual(['a', 'b', 'c'])
    expect(ids(filterOefeningen(list, filters({ query: '' })))).toEqual(['a', 'b', 'c'])
  })

  it('geeft een lege lijst als niets matcht', () => {
    expect(filterOefeningen(list, filters({ query: 'zzz' }))).toEqual([])
  })
})

describe('filterOefeningen — combinaties zijn AND, niet OR', () => {
  const rondoLinks = makeOefening({
    id: 'rondo-links',
    naam: 'Rondo links',
    categorie: 'positiespel',
    veldzone: 'links',
    teams: [{ grootte: 5, formaties: [] }],
    aantal_neutralen: 2,
    duur_min: 15,
  })
  const rondoMidden = makeOefening({
    id: 'rondo-midden',
    naam: 'Rondo midden',
    categorie: 'positiespel',
    veldzone: 'midden',
    teams: [{ grootte: 5, formaties: [] }],
    aantal_neutralen: 2,
    duur_min: 15,
  })
  const partijLinks = makeOefening({
    id: 'partij-links',
    naam: 'Partij links',
    categorie: 'partijen_groot',
    veldzone: 'links',
    teams: [
      { grootte: 9, formaties: [] },
      { grootte: 9, formaties: [] },
    ],
    aantal_neutralen: 0,
    duur_min: 30,
  })
  const list = [rondoLinks, rondoMidden, partijLinks]

  it('sluit een oefening uit die op één dimensie matcht maar niet op een andere', () => {
    // categorie matcht wel (positiespel), veldzone niet.
    expect(
      matchesOefeningFilters(rondoMidden, filters({ categorie: 'positiespel', veldzone: 'links' })),
    ).toBe(false)
    // veldzone matcht wel (links), categorie niet.
    expect(
      matchesOefeningFilters(partijLinks, filters({ categorie: 'positiespel', veldzone: 'links' })),
    ).toBe(false)
    expect(
      ids(filterOefeningen(list, filters({ categorie: 'positiespel', veldzone: 'links' }))),
    ).toEqual(['rondo-links'])
  })

  it('combineert query met de overige filters als AND', () => {
    expect(ids(filterOefeningen(list, filters({ query: 'rondo', veldzone: 'midden' })))).toEqual([
      'rondo-midden',
    ])
    // Query matcht, maar de categorie niet → niets over.
    expect(filterOefeningen(list, filters({ query: 'rondo', categorie: 'partijen_groot' }))).toEqual(
      [],
    )
  })

  it('combineert alle dimensies tegelijk', () => {
    const alles = filters({
      query: 'rondo',
      categorie: 'positiespel',
      veldzone: 'links',
      aantalMin: 5,
      aantalMax: 10,
      duurMin: 10,
      duurMax: 20,
    })
    expect(ids(filterOefeningen(list, alles))).toEqual(['rondo-links'])
    // Eén dimensie buiten bereik (duur) → niets over.
    expect(filterOefeningen(list, { ...alles, duurMin: 20, duurMax: 25 })).toEqual([])
    // Eén dimensie buiten bereik (aantal spelers) → niets over.
    expect(filterOefeningen(list, { ...alles, aantalMin: 20 })).toEqual([])
  })
})

// ────────────────────────────────────────────────
// EMPTY_OEFENING_FILTERS
// ────────────────────────────────────────────────
describe('EMPTY_OEFENING_FILTERS', () => {
  it('heeft alle velden neutraal', () => {
    expect(EMPTY_OEFENING_FILTERS).toEqual({
      query: '',
      categorie: null,
      veldzone: null,
      aantalMin: null,
      aantalMax: null,
      duurMin: null,
      duurMax: null,
    })
  })

  it('levert de ongefilterde lijst op', () => {
    const list = [
      makeOefening({ id: 'a', veldzone: null, duur_min: null }),
      makeOefening({ id: 'b', categorie: 'warming_up', teams: [], aantal_neutralen: 12 }),
      makeOefening({ id: 'c', veldzone: 'rechts', duur_min: 45 }),
    ]
    const result = filterOefeningen(list, EMPTY_OEFENING_FILTERS)
    expect(result).toEqual(list)
    expect(ids(result)).toEqual(['a', 'b', 'c'])
  })

  it('geeft een nieuwe array terug en muteert de invoer niet', () => {
    const list = [makeOefening({ id: 'a' })]
    const result = filterOefeningen(list, EMPTY_OEFENING_FILTERS)
    expect(result).not.toBe(list)
    expect(list).toHaveLength(1)
  })

  it('geeft een lege lijst terug voor een lege invoerlijst', () => {
    expect(filterOefeningen([], EMPTY_OEFENING_FILTERS)).toEqual([])
  })
})
