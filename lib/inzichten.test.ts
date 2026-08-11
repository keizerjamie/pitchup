import { describe, it, expect } from 'vitest'
import {
  MAX_SEIZOEN_WEDSTRIJDEN,
  berekenAanwezigheidPercentage,
  filterDoelpunten,
  isGeldigSeizoensvenster,
  seizoensVenster,
  telVorm,
  toMaandOpkomst,
  type DoelpuntItem,
} from '@/lib/inzichten'

// De W/G/V-uitkomst komt uit de echte matchResult() (lib/match-analysis.mjs);
// die wordt hier bewust NIET gemockt, zodat deze test breekt zodra de
// inzichtenpagina en het dashboard uit elkaar gaan lopen.

const wedstrijd = (over: Partial<DoelpuntItem> = {}): DoelpuntItem => ({
  id: 'e1',
  date: '2026-09-05',
  opponent: 'DVC',
  match_type: 'league',
  goals_for: 3,
  goals_against: 1,
  ...over,
})

describe('berekenAanwezigheidPercentage', () => {
  it('rondt af op hele procenten, net als het dashboard', () => {
    expect(berekenAanwezigheidPercentage(3, 1)).toBe(75)
  })

  it('rondt 2/3 naar 67 (Math.round, niet afkappen)', () => {
    expect(berekenAanwezigheidPercentage(2, 1)).toBe(67)
  })

  it('rondt 1/3 naar 33', () => {
    expect(berekenAanwezigheidPercentage(1, 2)).toBe(33)
  })

  it('geeft 100 bij alleen aanwezigen en 0 bij alleen afwezigen', () => {
    expect(berekenAanwezigheidPercentage(5, 0)).toBe(100)
    expect(berekenAanwezigheidPercentage(0, 5)).toBe(0)
  })

  it('werkt met één datapunt', () => {
    expect(berekenAanwezigheidPercentage(1, 0)).toBe(100)
    expect(berekenAanwezigheidPercentage(0, 1)).toBe(0)
  })

  it('geeft null bij noemer 0 — geen verzonnen 0%', () => {
    expect(berekenAanwezigheidPercentage(0, 0)).toBeNull()
  })

  it('geeft null bij onmogelijke invoer (negatief of niet-eindig)', () => {
    expect(berekenAanwezigheidPercentage(-1, 3)).toBeNull()
    expect(berekenAanwezigheidPercentage(3, -1)).toBeNull()
    expect(berekenAanwezigheidPercentage(Number.NaN, 1)).toBeNull()
    expect(berekenAanwezigheidPercentage(1, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('toMaandOpkomst', () => {
  it('rekent per maand het percentage uit', () => {
    expect(
      toMaandOpkomst([
        { maand: '2026-09', aanwezig: 18, afwezig: 2 },
        { maand: '2026-10', aanwezig: 15, afwezig: 5 },
      ]),
    ).toEqual([
      { maand: '2026-09', aanwezig: 18, afwezig: 2, percentage: 90 },
      { maand: '2026-10', aanwezig: 15, afwezig: 5, percentage: 75 },
    ])
  })

  it('geeft percentage null als een maand-rij 0 aanwezig én 0 afwezig heeft', () => {
    const [maand] = toMaandOpkomst([{ maand: '2026-12', aanwezig: 0, afwezig: 0 }])
    expect(maand.percentage).toBeNull()
    expect(maand.aanwezig).toBe(0)
  })

  it('houdt de volgorde van de RPC aan — geen eigen sortering', () => {
    const maanden = toMaandOpkomst([
      { maand: '2026-09', aanwezig: 1, afwezig: 1 },
      { maand: '2026-10', aanwezig: 1, afwezig: 1 },
      { maand: '2027-01', aanwezig: 1, afwezig: 1 },
    ])
    expect(maanden.map((m) => m.maand)).toEqual(['2026-09', '2026-10', '2027-01'])
  })

  it('geeft een lege lijst voor lege invoer', () => {
    expect(toMaandOpkomst([])).toEqual([])
  })

  it('muteert de invoer niet', () => {
    const rows = [{ maand: '2026-09', aanwezig: 3, afwezig: 1 }]
    const kopie = structuredClone(rows)

    toMaandOpkomst(rows)

    expect(rows).toEqual(kopie)
  })
})

describe('filterDoelpunten', () => {
  const items = [
    wedstrijd({ id: 'competitie', match_type: 'league' }),
    wedstrijd({ id: 'oefen', match_type: 'friendly' }),
    wedstrijd({ id: 'beker', match_type: 'cup' }),
    wedstrijd({ id: 'zonder-soort', match_type: null }),
  ]

  it("geeft bij 'all' alles terug, inclusief wedstrijden zonder match_type", () => {
    expect(filterDoelpunten(items, 'all').map((i) => i.id)).toEqual([
      'competitie',
      'oefen',
      'beker',
      'zonder-soort',
    ])
  })

  it('matcht een specifiek filter exact', () => {
    expect(filterDoelpunten(items, 'league').map((i) => i.id)).toEqual(['competitie'])
    expect(filterDoelpunten(items, 'friendly').map((i) => i.id)).toEqual(['oefen'])
    expect(filterDoelpunten(items, 'cup').map((i) => i.id)).toEqual(['beker'])
  })

  it('laat match_type null buiten elk specifiek filter vallen', () => {
    for (const filter of ['league', 'friendly', 'cup'] as const) {
      expect(filterDoelpunten(items, filter).some((i) => i.match_type === null)).toBe(false)
    }
  })

  it('geeft een lege lijst bij een onbekende filterwaarde — geen stille terugval op alles', () => {
    expect(filterDoelpunten(items, 'onzin' as 'league')).toEqual([])
  })

  it('geeft een lege lijst voor lege invoer', () => {
    expect(filterDoelpunten([], 'all')).toEqual([])
    expect(filterDoelpunten([], 'cup')).toEqual([])
  })

  it('muteert de invoer niet en geeft bij "all" een nieuwe array terug', () => {
    const rows = [wedstrijd()]
    const kopie = structuredClone(rows)

    const resultaat = filterDoelpunten(rows, 'all')
    resultaat.pop()

    expect(rows).toEqual(kopie)
    expect(rows).toHaveLength(1)
  })
})

describe('telVorm', () => {
  it('telt winst, gelijk, verlies en onbekend', () => {
    expect(
      telVorm([
        wedstrijd({ goals_for: 2, goals_against: 0 }),
        wedstrijd({ goals_for: 3, goals_against: 1 }),
        wedstrijd({ goals_for: 1, goals_against: 1 }),
        wedstrijd({ goals_for: 0, goals_against: 4 }),
        wedstrijd({ goals_for: null, goals_against: null }),
      ]),
    ).toEqual({ win: 2, gelijk: 1, verlies: 1, onbekend: 1 })
  })

  it('telt 0-0 als gelijkspel, niet als ontbrekende uitslag', () => {
    expect(telVorm([wedstrijd({ goals_for: 0, goals_against: 0 })])).toEqual({
      win: 0,
      gelijk: 1,
      verlies: 0,
      onbekend: 0,
    })
  })

  it('telt een half ingevulde uitslag als onbekend', () => {
    expect(
      telVorm([
        wedstrijd({ goals_for: 2, goals_against: null }),
        wedstrijd({ goals_for: null, goals_against: 2 }),
      ]),
    ).toEqual({ win: 0, gelijk: 0, verlies: 0, onbekend: 2 })
  })

  it('geeft overal 0 voor lege invoer', () => {
    expect(telVorm([])).toEqual({ win: 0, gelijk: 0, verlies: 0, onbekend: 0 })
  })

  it('muteert de invoer niet', () => {
    const rows = [wedstrijd()]
    const kopie = structuredClone(rows)

    telVorm(rows)

    expect(rows).toEqual(kopie)
  })
})

describe('isGeldigSeizoensvenster', () => {
  it('accepteert een normaal seizoen', () => {
    expect(isGeldigSeizoensvenster('2026-08-01', '2027-06-30')).toBe(true)
  })

  it('accepteert een venster van één dag', () => {
    expect(isGeldigSeizoensvenster('2026-08-01', '2026-08-01')).toBe(true)
  })

  it('weigert een einddatum vóór de startdatum (O4)', () => {
    expect(isGeldigSeizoensvenster('2027-06-30', '2026-08-01')).toBe(false)
  })

  it('weigert een niet-bestaande datum', () => {
    expect(isGeldigSeizoensvenster('2026-02-30', '2026-06-30')).toBe(false)
    expect(isGeldigSeizoensvenster('2026-08-01', '2026-13-01')).toBe(false)
  })

  it('weigert een verkeerd formaat of ontbrekende waarde', () => {
    expect(isGeldigSeizoensvenster('01-08-2026', '2027-06-30')).toBe(false)
    expect(isGeldigSeizoensvenster('', '2027-06-30')).toBe(false)
    expect(isGeldigSeizoensvenster(undefined, '2027-06-30')).toBe(false)
    expect(isGeldigSeizoensvenster('2026-08-01', null)).toBe(false)
    expect(isGeldigSeizoensvenster(20260801, '2027-06-30')).toBe(false)
  })

  it('vergelijkt over de jaargrens heen correct', () => {
    expect(isGeldigSeizoensvenster('2026-12-31', '2027-01-01')).toBe(true)
    expect(isGeldigSeizoensvenster('2027-01-01', '2026-12-31')).toBe(false)
  })
})

describe('seizoensVenster', () => {
  it('leest start en eind uit de settings-map', () => {
    expect(seizoensVenster({ season_start: '2026-08-01', season_end: '2027-06-30' })).toEqual({
      start: '2026-08-01',
      end: '2027-06-30',
    })
  })

  it('negeert overige instellingen', () => {
    expect(
      seizoensVenster({
        season_start: '2026-08-01',
        season_end: '2027-06-30',
        training_days: '2,4',
        team_name: 'Pitchup',
      }),
    ).toEqual({ start: '2026-08-01', end: '2027-06-30' })
  })

  it('geeft null als er geen seizoen is ingesteld', () => {
    expect(seizoensVenster({})).toBeNull()
  })

  it('geeft null bij een half ingevuld seizoen', () => {
    expect(seizoensVenster({ season_start: '2026-08-01' })).toBeNull()
    expect(seizoensVenster({ season_end: '2027-06-30' })).toBeNull()
  })

  it('geeft null bij lege waarden', () => {
    expect(seizoensVenster({ season_start: '', season_end: '' })).toBeNull()
  })

  it('geeft null bij een omgekeerd venster (O4)', () => {
    expect(seizoensVenster({ season_start: '2027-06-30', season_end: '2026-08-01' })).toBeNull()
  })

  it('geeft null bij een niet-bestaande datum', () => {
    expect(seizoensVenster({ season_start: '2026-02-30', season_end: '2027-06-30' })).toBeNull()
  })
})

describe('MAX_SEIZOEN_WEDSTRIJDEN', () => {
  it('begrenst het aantal opgehaalde wedstrijdrijen', () => {
    expect(MAX_SEIZOEN_WEDSTRIJDEN).toBe(200)
  })
})
