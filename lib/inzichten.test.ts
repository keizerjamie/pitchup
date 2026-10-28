import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  MAX_SEIZOEN_WEDSTRIJDEN,
  MAX_SPELER_MATCH_EVENTS,
  TOP_WORST_AANTAL,
  berekenAanwezigheidPercentage,
  filterDoelpunten,
  isGeldigSeizoensvenster,
  seizoensVenster,
  telMatchEvents,
  telVorm,
  toMaandOpkomst,
  topWorstAanwezigheid,
  topWorstRating,
  verledenSeizoensVenster,
  KWARTIER_BAKKEN,
  PUNTEN_PER_UITSLAG,
  bepaalTopscorers,
  kaartenPerSpeler,
  kwartierBak,
  resultatenPerFormatie,
  splitsThuisUit,
  telPerKwartier,
  telTegendoelpunten,
  type SpelerMomentenRij,
  type TegendoelpuntMinuutRij,
  type WedstrijdUitslagRij,
  type AanwezigheidPerSpelerRij,
  type DoelpuntItem,
  type RatingPerSpelerRij,
  RATING_TREND_DREMPEL,
  STIJGER_MIN_BEOORDELINGEN,
  aandeel,
  bepaalStijgersDalers,
  blessuresPerMaand,
  dekkingPerPositie,
  maandenInVenster,
  naastElkaarPerSpeler,
  verdeelSpeelkansen,
  type BlessuresPerMaandRij,
  type RatingVormRij,
  type SpeelkansenRij,
  type SpelerPositieRij,
  type TrainingOpkomstPerSpelerRij,
} from '@/lib/inzichten'
import { POSITIONS } from '@/lib/types'

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

// ── verledenSeizoensVenster: geen toekomstige events in de opkomstcijfers ──
describe('verledenSeizoensVenster', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const seizoen = { start: '2026-08-01', end: '2027-06-30' }

  it('knipt een seizoenseinde in de toekomst af op gisteren', () => {
    expect(verledenSeizoensVenster(seizoen, '2026-10-15')).toEqual({
      start: '2026-08-01',
      end: '2026-10-14',
    })
  })

  it('laat een seizoenseinde dat al voorbij is ongemoeid', () => {
    expect(verledenSeizoensVenster({ start: '2025-08-01', end: '2026-06-30' }, '2026-10-15')).toEqual({
      start: '2025-08-01',
      end: '2026-06-30',
    })
  })

  it('sluit vandaag zelf uit — dezelfde grens als de vorm-cutoff (.lt("date", today))', () => {
    const { end } = verledenSeizoensVenster(seizoen, '2026-10-15')
    expect(end < '2026-10-15').toBe(true)
    expect(end).toBe('2026-10-14')
  })

  it('knipt een einde van precies vandaag terug naar gisteren', () => {
    expect(verledenSeizoensVenster({ start: '2026-09-01', end: '2026-10-15' }, '2026-10-15').end).toBe(
      '2026-10-14',
    )
  })

  it('laat een einde van gisteren ongewijzigd (grensgeval)', () => {
    expect(verledenSeizoensVenster({ start: '2026-09-01', end: '2026-10-14' }, '2026-10-15').end).toBe(
      '2026-10-14',
    )
  })

  it('rekent over de maand- en jaargrens heen correct', () => {
    expect(verledenSeizoensVenster(seizoen, '2026-11-01').end).toBe('2026-10-31')
    expect(verledenSeizoensVenster(seizoen, '2027-01-01').end).toBe('2026-12-31')
    expect(verledenSeizoensVenster({ start: '2028-01-01', end: '2028-12-31' }, '2028-03-01').end).toBe(
      '2028-02-29',
    )
  })

  it('geeft bij een seizoen dat volledig in de toekomst ligt een eind vóór de start terug — geen crash', () => {
    const venster = verledenSeizoensVenster({ start: '2027-08-01', end: '2028-06-30' }, '2026-10-15')
    expect(venster).toEqual({ start: '2027-08-01', end: '2026-10-14' })
    // Zo'n venster levert in SQL nul rijen op; de kaarten tonen hun lege staat.
    expect(venster.end < venster.start).toBe(true)
  })

  it('muteert het meegegeven venster niet', () => {
    const origineel = { start: '2026-08-01', end: '2027-06-30' }
    const kopie = structuredClone(origineel)

    const resultaat = verledenSeizoensVenster(origineel, '2026-10-15')

    expect(origineel).toEqual(kopie)
    expect(resultaat).not.toBe(origineel)
  })

  it('gebruikt zonder tweede argument de lokale dag van vandaag (todayLocal)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T00:30:00'))

    // Lokale middernacht-marge: toISOString() zou hier in NL nog 14 oktober
    // geven en dus een dag te weinig afknippen.
    expect(verledenSeizoensVenster(seizoen).end).toBe('2026-10-14')
  })
})

// ── Top 5 / worst 5 per speler ───────────────────────────────────────
const ratingRij = (over: Partial<RatingPerSpelerRij> = {}): RatingPerSpelerRij => ({
  player_id: 'p1',
  naam: 'Speler 1',
  gemiddelde: 7,
  aantal: 3,
  ...over,
})

const aanwezigheidRij = (
  over: Partial<AanwezigheidPerSpelerRij> = {},
): AanwezigheidPerSpelerRij => ({
  player_id: 'p1',
  naam: 'Speler 1',
  aanwezig: 8,
  afwezig: 2,
  ...over,
})

describe('TOP_WORST_AANTAL', () => {
  it('is 5 — top 5 en worst 5', () => {
    expect(TOP_WORST_AANTAL).toBe(5)
  })
})

describe('topWorstRating', () => {
  const zesSpelers: RatingPerSpelerRij[] = [
    ratingRij({ player_id: 'a', naam: 'A', gemiddelde: 5 }),
    ratingRij({ player_id: 'b', naam: 'B', gemiddelde: 8.5 }),
    ratingRij({ player_id: 'c', naam: 'C', gemiddelde: 6 }),
    ratingRij({ player_id: 'd', naam: 'D', gemiddelde: 9 }),
    ratingRij({ player_id: 'e', naam: 'E', gemiddelde: 4 }),
    ratingRij({ player_id: 'f', naam: 'F', gemiddelde: 7 }),
  ]

  it('geeft de 5 hoogste aflopend en de 5 laagste oplopend', () => {
    const { top, worst } = topWorstRating(zesSpelers)
    expect(top.map((r) => r.naam)).toEqual(['D', 'B', 'F', 'C', 'A'])
    expect(worst.map((r) => r.naam)).toEqual(['E', 'A', 'C', 'F', 'B'])
  })

  it('houdt het cijfer bij de naam, ongewijzigd (geen afronding in de lib)', () => {
    const { top } = topWorstRating(zesSpelers, 2)
    expect(top).toEqual([
      ratingRij({ player_id: 'd', naam: 'D', gemiddelde: 9 }),
      ratingRij({ player_id: 'b', naam: 'B', gemiddelde: 8.5 }),
    ])
  })

  it('respecteert een eigen n', () => {
    expect(topWorstRating(zesSpelers, 2).top.map((r) => r.naam)).toEqual(['D', 'B'])
    expect(topWorstRating(zesSpelers, 2).worst.map((r) => r.naam)).toEqual(['E', 'A'])
  })

  it('laat top en worst overlappen bij minder dan 2n spelers — bewuste, simpele regel', () => {
    const drie = zesSpelers.slice(0, 3)
    const { top, worst } = topWorstRating(drie)
    expect(top.map((r) => r.naam)).toEqual(['B', 'C', 'A'])
    expect(worst.map((r) => r.naam)).toEqual(['A', 'C', 'B'])
  })

  it('geeft twee lege lijsten voor lege invoer', () => {
    expect(topWorstRating([])).toEqual({ top: [], worst: [] })
  })

  it('zet één speler in beide lijstjes', () => {
    const { top, worst } = topWorstRating([ratingRij({ player_id: 'a', naam: 'A', gemiddelde: 6 })])
    expect(top.map((r) => r.naam)).toEqual(['A'])
    expect(worst.map((r) => r.naam)).toEqual(['A'])
  })

  it('sorteert gelijke gemiddeldes deterministisch op naam, daarna op player_id', () => {
    const gelijk = [
      ratingRij({ player_id: 'p2', naam: 'Zoe', gemiddelde: 7 }),
      ratingRij({ player_id: 'p3', naam: 'Bram', gemiddelde: 7 }),
      ratingRij({ player_id: 'p1', naam: 'Bram', gemiddelde: 7 }),
    ]
    expect(topWorstRating(gelijk).top.map((r) => r.player_id)).toEqual(['p1', 'p3', 'p2'])
    expect(topWorstRating(gelijk).worst.map((r) => r.player_id)).toEqual(['p1', 'p3', 'p2'])
  })

  it('muteert de invoer niet (geen in-place sort)', () => {
    const rows = [...zesSpelers]
    const kopie = structuredClone(rows)

    topWorstRating(rows)

    expect(rows).toEqual(kopie)
  })
})

describe('topWorstAanwezigheid', () => {
  const zesSpelers: AanwezigheidPerSpelerRij[] = [
    aanwezigheidRij({ player_id: 'a', naam: 'A', aanwezig: 5, afwezig: 5 }), // 50%
    aanwezigheidRij({ player_id: 'b', naam: 'B', aanwezig: 9, afwezig: 1 }), // 90%
    aanwezigheidRij({ player_id: 'c', naam: 'C', aanwezig: 6, afwezig: 4 }), // 60%
    aanwezigheidRij({ player_id: 'd', naam: 'D', aanwezig: 10, afwezig: 0 }), // 100%
    aanwezigheidRij({ player_id: 'e', naam: 'E', aanwezig: 0, afwezig: 10 }), // 0%
    aanwezigheidRij({ player_id: 'f', naam: 'F', aanwezig: 7, afwezig: 3 }), // 70%
  ]

  it('rangschikt op percentage: hoogste bovenaan in top, laagste bovenaan in worst', () => {
    const { top, worst } = topWorstAanwezigheid(zesSpelers)
    expect(top.map((r) => r.naam)).toEqual(['D', 'B', 'F', 'C', 'A'])
    expect(worst.map((r) => r.naam)).toEqual(['E', 'A', 'C', 'F', 'B'])
  })

  it('rekent het percentage per rij uit met dezelfde afronding als de rest van de app', () => {
    const { top } = topWorstAanwezigheid([aanwezigheidRij({ player_id: 'a', naam: 'A', aanwezig: 2, afwezig: 1 })])
    expect(top[0]).toEqual({ player_id: 'a', naam: 'A', aanwezig: 2, afwezig: 1, percentage: 67 })
  })

  it('telt 0% wél mee — dat is een echt cijfer, geen ontbrekende data', () => {
    const { worst } = topWorstAanwezigheid(zesSpelers, 1)
    expect(worst[0].naam).toBe('E')
    expect(worst[0].percentage).toBe(0)
  })

  it('sluit spelers zonder registraties (percentage null) uit van beide lijstjes', () => {
    const rows = [
      ...zesSpelers,
      aanwezigheidRij({ player_id: 'g', naam: 'G', aanwezig: 0, afwezig: 0 }),
    ]
    const { top, worst } = topWorstAanwezigheid(rows)
    expect(top.map((r) => r.naam)).not.toContain('G')
    expect(worst.map((r) => r.naam)).not.toContain('G')
    // Zonder de uitsluiting zou G als "0%" onderaan de worst-lijst staan.
    expect(worst[0].naam).toBe('E')
  })

  it('geeft twee lege lijsten als geen enkele speler een registratie heeft', () => {
    expect(
      topWorstAanwezigheid([
        aanwezigheidRij({ player_id: 'a', naam: 'A', aanwezig: 0, afwezig: 0 }),
        aanwezigheidRij({ player_id: 'b', naam: 'B', aanwezig: 0, afwezig: 0 }),
      ]),
    ).toEqual({ top: [], worst: [] })
  })

  it('laat top en worst overlappen bij minder dan 2n spelers', () => {
    const drie = zesSpelers.slice(0, 3)
    const { top, worst } = topWorstAanwezigheid(drie)
    expect(top.map((r) => r.naam)).toEqual(['B', 'C', 'A'])
    expect(worst.map((r) => r.naam)).toEqual(['A', 'C', 'B'])
  })

  it('geeft twee lege lijsten voor lege invoer', () => {
    expect(topWorstAanwezigheid([])).toEqual({ top: [], worst: [] })
  })

  it('sorteert gelijke percentages deterministisch op naam, daarna op player_id', () => {
    const gelijk = [
      aanwezigheidRij({ player_id: 'p2', naam: 'Zoe', aanwezig: 1, afwezig: 1 }),
      aanwezigheidRij({ player_id: 'p3', naam: 'Bram', aanwezig: 2, afwezig: 2 }),
      aanwezigheidRij({ player_id: 'p1', naam: 'Bram', aanwezig: 3, afwezig: 3 }),
    ]
    expect(topWorstAanwezigheid(gelijk).top.map((r) => r.player_id)).toEqual(['p1', 'p3', 'p2'])
    expect(topWorstAanwezigheid(gelijk).worst.map((r) => r.player_id)).toEqual(['p1', 'p3', 'p2'])
  })

  it('muteert de invoer niet', () => {
    const rows = [...zesSpelers]
    const kopie = structuredClone(rows)

    topWorstAanwezigheid(rows)

    expect(rows).toEqual(kopie)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Samenvattingscijfers en signalen (de bovenste laag van /inzichten)
// ═══════════════════════════════════════════════════════════════════════

import {
  OPKOMST_DOEL,
  SPELER_ZORGDREMPEL,
  MAX_SIGNALEN,
  RATING_TREND_VENSTER,
  PERIODE_STANDAARD,
  isPeriode,
  periodeVenster,
  bepaalSignalen,
  doelsaldo,
  laatsteMaandTrend,
  teamRatingTrend,
  type MaandOpkomst,
  type SignaalInvoer,
  type TeamRatingRij,
} from '@/lib/inzichten'

function trendMaand(m: string, aanwezig: number, afwezig: number): MaandOpkomst {
  return { maand: m, aanwezig, afwezig, percentage: berekenAanwezigheidPercentage(aanwezig, afwezig) }
}

function trendRatingRij(datum: string, gemiddelde: number): TeamRatingRij {
  return { event_id: `e-${datum}`, datum, tegenstander: null, gemiddelde, aantal: 11 }
}

function trendWedstrijd(id: string, voor: number | null, tegen: number | null): DoelpuntItem {
  return { id, date: '2026-03-01', opponent: null, match_type: 'league', goals_for: voor, goals_against: tegen }
}

describe('laatsteMaandTrend', () => {
  it('geeft de laatste maand met een percentage plus het verschil met de maand daarvoor', () => {
    const trend = laatsteMaandTrend([trendMaand('2026-01', 8, 2), trendMaand('2026-02', 6, 4)])
    expect(trend).toEqual({ maand: '2026-02', percentage: 60, vorigePercentage: 80, delta: -20 })
  })

  it('slaat maanden zonder percentage over in plaats van ze als 0% mee te tellen', () => {
    // 2026-02 heeft geen enkele registratie (0/0) → percentage null. De
    // vergelijking hoort dan tegen januari te gaan, niet tegen "0%".
    const trend = laatsteMaandTrend([trendMaand('2026-01', 8, 2), trendMaand('2026-02', 0, 0), trendMaand('2026-03', 9, 1)])
    expect(trend).toEqual({ maand: '2026-03', percentage: 90, vorigePercentage: 80, delta: 10 })
  })

  it('één maand: geen vergelijking, delta blijft null (geen 0)', () => {
    expect(laatsteMaandTrend([trendMaand('2026-01', 8, 2)])).toEqual({
      maand: '2026-01', percentage: 80, vorigePercentage: null, delta: null,
    })
  })

  it('geen enkele maand met data → null', () => {
    expect(laatsteMaandTrend([])).toBeNull()
    expect(laatsteMaandTrend([trendMaand('2026-01', 0, 0)])).toBeNull()
  })
})

describe('teamRatingTrend', () => {
  it('berekent het gemiddelde over alle wedstrijden en de trend tussen de twee laatste vensters', () => {
    // Eerste 5 gemiddeld 6.0, laatste 5 gemiddeld 7.0 → delta +1.0.
    const rows = [
      ...[6, 6, 6, 6, 6].map((g, i) => trendRatingRij(`2026-01-0${i + 1}`, g)),
      ...[7, 7, 7, 7, 7].map((g, i) => trendRatingRij(`2026-02-0${i + 1}`, g)),
    ]
    const trend = teamRatingTrend(rows)
    expect(trend?.aantal).toBe(10)
    expect(trend?.gemiddelde).toBeCloseTo(6.5, 5)
    expect(trend?.delta).toBeCloseTo(1, 5)
  })

  it('te weinig wedstrijden voor twee volle vensters → gemiddelde wel, delta null', () => {
    const rows = [6, 7, 8].map((g, i) => trendRatingRij(`2026-01-0${i + 1}`, g))
    const trend = teamRatingTrend(rows)
    expect(trend?.gemiddelde).toBeCloseTo(7, 5)
    expect(trend?.delta).toBeNull()
  })

  it('geen wedstrijden → null', () => {
    expect(teamRatingTrend([])).toBeNull()
  })

  it('muteert de invoer niet (de RPC-volgorde blijft oplopend op datum)', () => {
    const rows = [trendRatingRij('2026-01-01', 5), trendRatingRij('2026-01-02', 9)]
    const kopie = rows.map((r) => ({ ...r }))
    teamRatingTrend(rows)
    expect(rows).toEqual(kopie)
  })
})

describe('doelsaldo', () => {
  it('telt alleen wedstrijden met een volledige uitslag', () => {
    expect(doelsaldo([trendWedstrijd('a', 3, 1), trendWedstrijd('b', 0, 2), trendWedstrijd('c', 4, null), trendWedstrijd('d', null, null)]))
      .toEqual({ voor: 3, tegen: 3, saldo: 0, wedstrijden: 2 })
  })

  it('lege lijst → alles nul, geen deling door nul', () => {
    expect(doelsaldo([])).toEqual({ voor: 0, tegen: 0, saldo: 0, wedstrijden: 0 })
  })
})

describe('bepaalSignalen', () => {
  const leeg: SignaalInvoer = { maanden: [], aanwezigheidPerSpeler: [], teamRating: [], doelpunten: [] }

  it('zonder enige data: geen signalen (het blok hoort dan helemaal weg te blijven)', () => {
    expect(bepaalSignalen(leeg)).toEqual([])
  })

  it('een speler onder de zorgdrempel levert een zorg-signaal met naam en aantal', () => {
    const signalen = bepaalSignalen({
      ...leeg,
      aanwezigheidPerSpeler: [
        { player_id: 'p1', naam: 'Sem de Vries', aanwezig: 4, afwezig: 6 }, // 40%
        { player_id: 'p2', naam: 'Tim Jansen', aanwezig: 9, afwezig: 1 }, // 90%
      ],
    })
    expect(signalen).toHaveLength(1)
    expect(signalen[0].toon).toBe('zorg')
    expect(signalen[0].tekstSleutel).toBe('signaalSpelerWegblijver')
    expect(signalen[0].waarden).toMatchObject({ aantal: 1, naam: 'Sem de Vries', drempel: SPELER_ZORGDREMPEL })
  })

  it('spelers zonder enige registratie tellen niet als wegblijver (geen data is geen 0%)', () => {
    const signalen = bepaalSignalen({
      ...leeg,
      aanwezigheidPerSpeler: [{ player_id: 'p1', naam: 'Nieuw Lid', aanwezig: 0, afwezig: 0 }],
    })
    expect(signalen).toEqual([])
  })

  it('opkomst onder de norm levert een let-op; precies op de norm juist een compliment', () => {
    const onder = bepaalSignalen({ ...leeg, maanden: [trendMaand('2026-02', 8, 2)] }) // 80%
    expect(onder[0].toon).toBe('letop')
    expect(onder[0].waarden.doel).toBe(OPKOMST_DOEL)

    const op = bepaalSignalen({ ...leeg, maanden: [trendMaand('2026-02', 85, 15)] }) // exact 85%
    expect(op[0].toon).toBe('goed')
    expect(op[0].tekstSleutel).toBe('signaalOpkomstBovenDoel')
  })

  it('opkomst onder de norm én gedaald gebruikt de dalingsvariant met het aantal punten', () => {
    const signalen = bepaalSignalen({ ...leeg, maanden: [trendMaand('2026-01', 8, 2), trendMaand('2026-02', 6, 4)] })
    expect(signalen[0].tekstSleutel).toBe('signaalOpkomstOnderDoelDaling')
    expect(signalen[0].waarden.daling).toBe(20)
  })

  it('een ratingverschil onder de ruisdrempel levert geen signaal op', () => {
    const rows = [
      ...[7.0, 7.0, 7.0, 7.0, 7.0].map((g, i) => trendRatingRij(`2026-01-0${i + 1}`, g)),
      ...[7.1, 7.1, 7.1, 7.1, 7.1].map((g, i) => trendRatingRij(`2026-02-0${i + 1}`, g)),
    ]
    expect(bepaalSignalen({ ...leeg, teamRating: rows })).toEqual([])
  })

  it('doelsaldo telt pas mee vanaf genoeg wedstrijden', () => {
    const weinig = Array.from({ length: RATING_TREND_VENSTER - 1 }, (_, i) => trendWedstrijd(`w${i}`, 3, 0))
    expect(bepaalSignalen({ ...leeg, doelpunten: weinig })).toEqual([])

    const genoeg = Array.from({ length: RATING_TREND_VENSTER }, (_, i) => trendWedstrijd(`w${i}`, 3, 0))
    const signalen = bepaalSignalen({ ...leeg, doelpunten: genoeg })
    expect(signalen[0].tekstSleutel).toBe('signaalDoelsaldoPositief')
  })

  it('een zorgsignaal verdringt een compliment, nooit andersom, en het blok blijft op MAX_SIGNALEN', () => {
    const signalen = bepaalSignalen({
      // 3 wegblijvers, opkomst boven de norm, ratingstijging, positief saldo:
      // meer treffers dan MAX_SIGNALEN.
      maanden: [trendMaand('2026-02', 95, 5)],
      aanwezigheidPerSpeler: [
        { player_id: 'p1', naam: 'A', aanwezig: 1, afwezig: 9 },
        { player_id: 'p2', naam: 'B', aanwezig: 2, afwezig: 8 },
      ],
      teamRating: [
        ...[6, 6, 6, 6, 6].map((g, i) => trendRatingRij(`2026-01-0${i + 1}`, g)),
        ...[8, 8, 8, 8, 8].map((g, i) => trendRatingRij(`2026-02-0${i + 1}`, g)),
      ],
      doelpunten: Array.from({ length: 6 }, (_, i) => trendWedstrijd(`w${i}`, 3, 0)),
    })
    expect(signalen).toHaveLength(MAX_SIGNALEN)
    expect(signalen[0].toon).toBe('zorg')
    // Het positieve doelsaldo is het laatste compliment in de vaste volgorde
    // en valt daarmee als eerste af.
    expect(signalen.map((s) => s.id)).not.toContain('doelsaldo-positief')
  })
})


describe('isPeriode', () => {
  it('accepteert alleen de drie bekende waarden', () => {
    expect(isPeriode('4w')).toBe(true)
    expect(isPeriode('8w')).toBe(true)
    expect(isPeriode('seizoen')).toBe(true)
  })

  it('weigert alles daarbuiten, inclusief niet-strings', () => {
    for (const waarde of ['4W', '4 weken', '', '2w', null, undefined, 4, {}, ['4w']]) {
      expect(isPeriode(waarde)).toBe(false)
    }
  })
})

describe('periodeVenster', () => {
  const seizoen = { start: '2026-07-01', end: '2026-12-31' }

  it("'seizoen' laat het venster ongemoeid", () => {
    expect(periodeVenster(seizoen, 'seizoen', '2026-10-15')).toEqual(seizoen)
    expect(PERIODE_STANDAARD).toBe('seizoen')
  })

  it("'4w' knipt de start af op 28 dagen terug, inclusief vandaag", () => {
    // 2026-10-15 min 27 dagen = 2026-09-18; dat is dag 1 van 28 t/m vandaag.
    expect(periodeVenster(seizoen, '4w', '2026-10-15')).toEqual({ start: '2026-09-18', end: '2026-12-31' })
  })

  it("'8w' knipt de start af op 56 dagen terug", () => {
    expect(periodeVenster(seizoen, '8w', '2026-10-15')).toEqual({ start: '2026-08-21', end: '2026-12-31' })
  })

  it('de start gaat nooit vóór de seizoensstart', () => {
    // Seizoen begint pas twee dagen geleden: "laatste 8 weken" mag niet
    // buiten het seizoen om data ophalen.
    const kort = { start: '2026-10-13', end: '2026-12-31' }
    expect(periodeVenster(kort, '8w', '2026-10-15')).toEqual(kort)
  })

  it('een seizoen dat al voorbij is levert een leeg (start > end) venster op, geen crash', () => {
    const afgelopen = { start: '2025-08-01', end: '2025-12-31' }
    const venster = periodeVenster(afgelopen, '4w', '2026-10-15')
    expect(venster.start > venster.end).toBe(true)
  })

  it('muteert het meegegeven venster niet', () => {
    const origineel = { start: '2026-07-01', end: '2026-12-31' }
    periodeVenster(origineel, '4w', '2026-10-15')
    expect(origineel).toEqual({ start: '2026-07-01', end: '2026-12-31' })
  })
})

describe('telMatchEvents', () => {
  it('telt een lege lijst als vier nullen — 0 is een echte telling, geen "onbekend"', () => {
    expect(telMatchEvents([])).toEqual({ doelpunten: 0, assists: 0, geel: 0, rood: 0 })
  })

  it('telt gemengde kinds per soort', () => {
    const rows = [
      { kind: 'goal' },
      { kind: 'assist' },
      { kind: 'goal' },
      { kind: 'yellow' },
      { kind: 'red' },
      { kind: 'goal' },
    ]

    expect(telMatchEvents(rows)).toEqual({ doelpunten: 3, assists: 1, geel: 1, rood: 1 })
  })

  it('negeert een onbekende kind en laat de andere tellingen ongemoeid', () => {
    // De CHECK-constraint op match_events laat zo'n waarde niet toe, maar een
    // onbekende soort mag nooit stilzwijgend als doelpunt meetellen.
    const rows = [{ kind: 'goal' }, { kind: 'wissel' }, { kind: 'yellow' }]

    expect(telMatchEvents(rows)).toEqual({ doelpunten: 1, assists: 0, geel: 1, rood: 0 })
  })

  it('muteert de invoer niet', () => {
    const rows = [{ kind: 'goal' }, { kind: 'assist' }]

    telMatchEvents(rows)

    expect(rows).toEqual([{ kind: 'goal' }, { kind: 'assist' }])
  })

  it('begrenst het aantal opgehaalde rijen met een vaste bovengrens', () => {
    // Zelfde gedachte als MAX_SEIZOEN_WEDSTRIJDEN: de seizoenslengte is door de
    // gebruiker bepaald en mag het geheugen niet sturen.
    expect(MAX_SPELER_MATCH_EVENTS).toBe(500)
  })
})

// ── Inzichten-metrics fase 1 ─────────────────────────────────────────

const uitslag = (over: Partial<WedstrijdUitslagRij> = {}): WedstrijdUitslagRij => ({
  event_id: 'e1',
  datum: '2026-09-05',
  home_away: 'home',
  goals_for: 2,
  goals_against: 1,
  formatie: null,
  ...over,
})

const momenten = (over: Partial<SpelerMomentenRij> = {}): SpelerMomentenRij => ({
  player_id: 'p1',
  naam: 'Anna',
  gast: false,
  doelpunten: 0,
  assists: 0,
  geel: 0,
  rood: 0,
  ...over,
})

describe('PUNTEN_PER_UITSLAG', () => {
  it('is 3/1/0 (V8)', () => {
    expect(PUNTEN_PER_UITSLAG).toEqual({ win: 3, draw: 1, loss: 0 })
  })
})

describe('kwartierBak', () => {
  it.each([
    [0, '1-15'], [1, '1-15'], [14, '1-15'], [15, '1-15'],
    [16, '16-30'], [30, '16-30'],
    [31, '31-45'], [45, '31-45'],
    [46, '46-60'], [47, '46-60'], [60, '46-60'],
    [61, '61-75'], [75, '61-75'],
    [76, '76-90'], [90, '76-90'],
    [91, '90+'], [130, '90+'],
  ])('minuut %s → %s', (minuut, bak) => {
    expect(kwartierBak(minuut)).toBe(bak)
  })

  it.each([[131], [-1], [12.5], [null], [undefined], ['12'], [NaN], [Infinity]])('%s → null', (minuut) => {
    expect(kwartierBak(minuut)).toBeNull()
  })

  it('heeft zeven bakken in vaste volgorde', () => {
    expect([...KWARTIER_BAKKEN]).toEqual(['1-15', '16-30', '31-45', '46-60', '61-75', '76-90', '90+'])
  })
})

describe('splitsThuisUit', () => {
  it('splitst thuis en uit met 3/1/0-punten, saldo, clean sheets en zonder eigen doelpunt', () => {
    const rows = [
      uitslag({ event_id: 'e1', home_away: 'home', goals_for: 3, goals_against: 0 }), // W, clean sheet
      uitslag({ event_id: 'e2', home_away: 'home', goals_for: 1, goals_against: 1 }), // G
      uitslag({ event_id: 'e3', home_away: 'away', goals_for: 0, goals_against: 2 }), // V, zonder eigen
      uitslag({ event_id: 'e4', home_away: 'away', goals_for: 0, goals_against: 0 }), // G, beide
    ]
    const r = splitsThuisUit(rows)

    expect(r.thuis).toEqual({
      wedstrijden: 2, win: 1, gelijk: 1, verlies: 0, punten: 4, puntenPerWedstrijd: 2,
      voor: 4, tegen: 1, saldo: 3,
    })
    expect(r.uit).toEqual({
      wedstrijden: 2, win: 0, gelijk: 1, verlies: 1, punten: 1, puntenPerWedstrijd: 0.5,
      voor: 0, tegen: 2, saldo: -2,
    })
    expect(r.onbekend).toBeNull()
    expect(r.totaal).toEqual({
      wedstrijden: 4, win: 1, gelijk: 2, verlies: 1, punten: 5, puntenPerWedstrijd: 1.25,
      voor: 4, tegen: 3, saldo: 1, cleanSheets: 2, zonderEigenDoelpunt: 2,
    })
  })

  it('telt home_away = null als "onbekend" en wél in het totaal, nooit als thuis', () => {
    const r = splitsThuisUit([
      uitslag({ event_id: 'e1', home_away: 'home', goals_for: 1, goals_against: 0 }),
      uitslag({ event_id: 'e2', home_away: null, goals_for: 0, goals_against: 1 }),
    ])
    expect(r.thuis.wedstrijden).toBe(1)
    expect(r.thuis.verlies).toBe(0)
    expect(r.onbekend).toEqual({
      wedstrijden: 1, win: 0, gelijk: 0, verlies: 1, punten: 0, puntenPerWedstrijd: 0,
      voor: 0, tegen: 1, saldo: -1,
    })
    expect(r.totaal.wedstrijden).toBe(2)
    expect(r.totaal.saldo).toBe(0)
  })

  it('geeft bij 0 wedstrijden lege groepen met puntenPerWedstrijd null (nooit NaN)', () => {
    const r = splitsThuisUit([])
    expect(r.thuis.puntenPerWedstrijd).toBeNull()
    expect(r.uit.puntenPerWedstrijd).toBeNull()
    expect(r.totaal.puntenPerWedstrijd).toBeNull()
    expect(r.totaal.wedstrijden).toBe(0)
    expect(r.onbekend).toBeNull()
  })

  it('slaat rijen zonder bruikbare uitslag over', () => {
    const r = splitsThuisUit([
      uitslag({ goals_for: null as unknown as number }),
      uitslag({ goals_against: NaN }),
      uitslag({ goals_for: 1, goals_against: 0 }),
    ])
    expect(r.totaal.wedstrijden).toBe(1)
    expect(r.thuis.wedstrijden).toBe(1)
  })

  it('totaal saldo is gelijk aan doelsaldo() over dezelfde wedstrijden (KPI)', () => {
    const rows = [
      uitslag({ event_id: 'e1', goals_for: 4, goals_against: 2 }),
      uitslag({ event_id: 'e2', home_away: 'away', goals_for: 1, goals_against: 3 }),
      uitslag({ event_id: 'e3', home_away: null, goals_for: 2, goals_against: 2 }),
    ]
    const kpi = doelsaldo(rows.map((r) => ({
      id: r.event_id, date: r.datum, opponent: null, match_type: null,
      goals_for: r.goals_for, goals_against: r.goals_against,
    })))
    expect(splitsThuisUit(rows).totaal.saldo).toBe(kpi.saldo)
  })

  it('muteert de invoer niet', () => {
    const rows = [uitslag(), uitslag({ event_id: 'e2', home_away: null })]
    const kopie = structuredClone(rows)
    splitsThuisUit(rows)
    expect(rows).toEqual(kopie)
  })
})

describe('resultatenPerFormatie', () => {
  it('groepeert per formatie, sorteert op wedstrijden aflopend en dan formatie', () => {
    const r = resultatenPerFormatie([
      uitslag({ event_id: 'e1', formatie: '4-3-3', goals_for: 2, goals_against: 0 }),
      uitslag({ event_id: 'e2', formatie: '4-4-2', goals_for: 0, goals_against: 1 }),
      uitslag({ event_id: 'e3', formatie: '4-3-3', goals_for: 1, goals_against: 1 }),
      uitslag({ event_id: 'e4', formatie: '3-5-2', goals_for: 1, goals_against: 0 }),
    ])
    expect(r.map((g) => g.formatie)).toEqual(['4-3-3', '3-5-2', '4-4-2'])
    expect(r[0]).toEqual({
      formatie: '4-3-3', wedstrijden: 2, win: 1, gelijk: 1, verlies: 0, punten: 4, puntenPerWedstrijd: 2,
      voor: 3, tegen: 1, saldo: 2,
    })
    expect(r[2].verlies).toBe(1)
    expect(r[2].punten).toBe(0)
  })

  it('slaat null en lege formaties over, en houdt een onbekende string letterlijk', () => {
    const r = resultatenPerFormatie([
      uitslag({ event_id: 'e1', formatie: null }),
      uitslag({ event_id: 'e2', formatie: '' }),
      uitslag({ event_id: 'e3', formatie: '   ' }),
      uitslag({ event_id: 'e4', formatie: 'Eigen ruit' }),
    ])
    expect(r).toHaveLength(1)
    expect(r[0].formatie).toBe('Eigen ruit')
  })

  it('geeft een lege lijst zonder formaties', () => {
    expect(resultatenPerFormatie([])).toEqual([])
  })
})

describe('bepaalTopscorers', () => {
  it('neemt gasten en spelers met alleen assists mee, en sorteert doelpunten → betrokken → naam → id', () => {
    const r = bepaalTopscorers([
      momenten({ player_id: 'p1', naam: 'Anna', doelpunten: 2, assists: 0 }),
      momenten({ player_id: 'p2', naam: 'Bram', doelpunten: 2, assists: 3 }),
      momenten({ player_id: 'p3', naam: 'Gast', gast: true, doelpunten: 1 }),
      momenten({ player_id: 'p4', naam: 'Daan', assists: 1 }),
      momenten({ player_id: 'p5', naam: 'Eva', geel: 1 }),
    ])
    expect(r.spelers.map((s) => s.player_id)).toEqual(['p2', 'p1', 'p3', 'p4'])
    expect(r.spelers[2]).toMatchObject({ gast: true, betrokken: 1 })
    expect(r.spelers[0].betrokken).toBe(5)
    expect(r.doelpunten).toBe(5)
    expect(r.assists).toBe(4)
    expect(r.assistPercentage).toBe(80)
  })

  it('geeft bij gelijke stand een stabiele volgorde: naam, dan player_id', () => {
    const r = bepaalTopscorers([
      momenten({ player_id: 'pb', naam: 'Zoë', doelpunten: 1 }),
      momenten({ player_id: 'pz', naam: 'Anna', doelpunten: 1 }),
      momenten({ player_id: 'pa', naam: 'Anna', doelpunten: 1 }),
    ])
    expect(r.spelers.map((s) => s.player_id)).toEqual(['pa', 'pz', 'pb'])
  })

  it('0 doelpunten → assistPercentage null, nooit NaN', () => {
    const r = bepaalTopscorers([momenten({ assists: 2 })])
    expect(r.assistPercentage).toBeNull()
    expect(bepaalTopscorers([]).assistPercentage).toBeNull()
  })

  it('begrenst het assistpercentage op 100 als er meer assists dan doelpunten zijn', () => {
    expect(bepaalTopscorers([momenten({ doelpunten: 1, assists: 3 })]).assistPercentage).toBe(100)
  })

  it('rondt het assistpercentage af', () => {
    expect(bepaalTopscorers([momenten({ doelpunten: 3, assists: 2 })]).assistPercentage).toBe(67)
  })

  it('negeert niet-eindige tellingen', () => {
    const r = bepaalTopscorers([momenten({ doelpunten: NaN, assists: Infinity })])
    expect(r.spelers).toEqual([])
    expect(r.doelpunten).toBe(0)
  })

  it('muteert de invoer niet', () => {
    const rows = [momenten({ doelpunten: 1 }), momenten({ player_id: 'p2', doelpunten: 2 })]
    const kopie = structuredClone(rows)
    bepaalTopscorers(rows)
    expect(rows).toEqual(kopie)
  })
})

describe('kaartenPerSpeler', () => {
  it('alleen spelers met een kaart, gesorteerd op totaal → rood → naam → id', () => {
    const r = kaartenPerSpeler([
      momenten({ player_id: 'p1', naam: 'Anna', geel: 2 }),
      momenten({ player_id: 'p2', naam: 'Bram', geel: 1, rood: 1 }),
      momenten({ player_id: 'p3', naam: 'Cas', doelpunten: 4 }),
      momenten({ player_id: 'p4', naam: 'Gast', gast: true, geel: 1 }),
      momenten({ player_id: 'p0', naam: 'Gast', gast: true, geel: 1 }),
    ])
    expect(r.map((s) => s.player_id)).toEqual(['p2', 'p1', 'p0', 'p4'])
    expect(r[2].gast).toBe(true)
  })

  it('geeft een lege lijst zonder kaarten en muteert de invoer niet', () => {
    const rows = [momenten({ doelpunten: 1 })]
    const kopie = structuredClone(rows)
    expect(kaartenPerSpeler(rows)).toEqual([])
    expect(rows).toEqual(kopie)
  })
})

describe('telPerKwartier', () => {
  it('telt per bak, met alle zeven bakken (ook bij 0), en houdt "zonder minuut" apart', () => {
    const r = telPerKwartier([
      { minuut: 0, aantal: 1 },
      { minuut: 15, aantal: 2 },
      { minuut: 16, aantal: 1 },
      { minuut: 90, aantal: 1 },
      { minuut: 91, aantal: 3 },
      { minuut: null, aantal: 4 },
    ])
    expect(r.perBak).toEqual({
      '1-15': 3, '16-30': 1, '31-45': 0, '46-60': 0, '61-75': 0, '76-90': 1, '90+': 3,
    })
    expect(r.metMinuut).toBe(8)
    expect(r.totaal).toBe(12)
  })

  it('negeert niet-eindige aantallen en zet een ongeldige minuut niet in een bak', () => {
    const r = telPerKwartier([
      { minuut: 10, aantal: NaN },
      { minuut: 131, aantal: 1 },
    ])
    expect(r.metMinuut).toBe(0)
    expect(r.totaal).toBe(1)
  })

  it('geeft bij geen data nul overal', () => {
    const r = telPerKwartier([])
    expect(Object.values(r.perBak)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(r.metMinuut).toBe(0)
    expect(r.totaal).toBe(0)
  })
})

describe('telTegendoelpunten', () => {
  it('telt per bak en soort, per soort en houdt "zonder minuut" apart', () => {
    const r = telTegendoelpunten([
      { minuut: 10, soort: 'set_piece', aantal: 1 },
      { minuut: 10, soort: 'open_play', aantal: 2 },
      { minuut: 88, soort: 'open_play', aantal: 1 },
      { minuut: null, soort: 'set_piece', aantal: 2 },
    ])
    expect(r.perBak['1-15']).toEqual({ set_piece: 1, open_play: 2 })
    expect(r.perBak['76-90']).toEqual({ set_piece: 0, open_play: 1 })
    expect(r.perBak['90+']).toEqual({ set_piece: 0, open_play: 0 })
    expect(r.perSoort).toEqual({ set_piece: 3, open_play: 3 })
    expect(r.metMinuut).toBe(4)
    expect(r.totaal).toBe(6)
  })

  it('negeert een onbekende soort volledig', () => {
    const r = telTegendoelpunten([
      { minuut: 10, soort: 'anders', aantal: 5 } as unknown as TegendoelpuntMinuutRij,
      { minuut: 10, soort: 'set_piece', aantal: 1 },
    ])
    expect(r.totaal).toBe(1)
    expect(r.metMinuut).toBe(1)
    expect(r.perSoort).toEqual({ set_piece: 1, open_play: 0 })
  })

  it('muteert de invoer niet', () => {
    const rows: TegendoelpuntMinuutRij[] = [{ minuut: 5, soort: 'open_play', aantal: 1 }]
    const kopie = structuredClone(rows)
    telTegendoelpunten(rows)
    expect(rows).toEqual(kopie)
  })
})

// ── Fase 2a: spelers ─────────────────────────────────────────────────

const kans = (over: Partial<SpeelkansenRij> = {}): SpeelkansenRij => ({
  player_id: 'p1', naam: 'Anna', gast: false, noemer: 4, selectie: 2, basis: 1, ...over,
})

describe('STIJGER_MIN_BEOORDELINGEN', () => {
  it('is 8 (W5)', () => {
    expect(STIJGER_MIN_BEOORDELINGEN).toBe(8)
  })
})

describe('aandeel', () => {
  it('geeft teller/noemer, ongerond en begrensd op 1', () => {
    expect(aandeel(1, 3)).toBeCloseTo(1 / 3, 10)
    expect(aandeel(5, 4)).toBe(1)
    expect(aandeel(0, 4)).toBe(0)
  })

  it('geeft null bij noemer 0, negatief of niet-eindig — nooit NaN', () => {
    expect(aandeel(0, 0)).toBeNull()
    expect(aandeel(1, -1)).toBeNull()
    expect(aandeel(Number.NaN, 2)).toBeNull()
    expect(aandeel(1, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('verdeelSpeelkansen', () => {
  it('berekent de aandelen en behoudt de gastvlag', () => {
    const [r] = verdeelSpeelkansen([kans({ gast: true, noemer: 4, selectie: 3, basis: 2 })])
    expect(r.selectieAandeel).toBe(0.75)
    expect(r.basisAandeel).toBe(0.5)
    expect(r.gast).toBe(true)
    expect(r.noemer).toBe(4)
  })

  it('noemer 0 geeft null-aandelen (AC-A8), en die spelers staan achteraan', () => {
    const r = verdeelSpeelkansen([
      kans({ player_id: 'a', naam: 'Aad', noemer: 0, selectie: 0, basis: 0 }),
      kans({ player_id: 'z', naam: 'Zoë', noemer: 5, selectie: 0, basis: 0 }),
    ])
    expect(r.map((x) => x.player_id)).toEqual(['z', 'a'])
    expect(r[1].selectieAandeel).toBeNull()
    expect(r[1].basisAandeel).toBeNull()
    expect(r[0].selectieAandeel).toBe(0)
  })

  it('sorteert op selectie-aandeel, dan basis-aandeel aflopend, dan naam en id (O5)', () => {
    const r = verdeelSpeelkansen([
      kans({ player_id: 'p4', naam: 'Bram', noemer: 4, selectie: 2, basis: 1 }),
      kans({ player_id: 'p3', naam: 'Bram', noemer: 4, selectie: 2, basis: 1 }),
      kans({ player_id: 'p2', naam: 'Anna', noemer: 4, selectie: 2, basis: 2 }),
      kans({ player_id: 'p1', naam: 'Cas', noemer: 2, selectie: 2, basis: 0 }),
      kans({ player_id: 'p5', naam: 'Aad', noemer: 4, selectie: 2, basis: 1 }),
    ])
    expect(r.map((x) => x.player_id)).toEqual(['p1', 'p2', 'p5', 'p3', 'p4'])
  })

  it('begrenst basis > noemer via aandeel en telt ongeldige waarden als 0', () => {
    const [r] = verdeelSpeelkansen([kans({ noemer: 2, basis: 3, selectie: -1 as number })])
    expect(r.basisAandeel).toBe(1)
    expect(r.selectie).toBe(0)
  })

  it('muteert de invoer niet', () => {
    const rows = [kans({ player_id: 'b', naam: 'B' }), kans({ player_id: 'a', naam: 'A', selectie: 4 })]
    const kopie = structuredClone(rows)
    verdeelSpeelkansen(rows)
    expect(rows).toEqual(kopie)
  })
})

const vorm = (over: Partial<RatingVormRij> = {}): RatingVormRij => ({
  player_id: 'p1', naam: 'Anna', aantal: 10, seizoen_gemiddelde: 7, recent_gemiddelde: 7, ...over,
})

describe('bepaalStijgersDalers', () => {
  it('gebruikt standaard RATING_TREND_DREMPEL en STIJGER_MIN_BEOORDELINGEN', () => {
    expect(RATING_TREND_DREMPEL).toBe(0.3)
    const r = bepaalStijgersDalers([vorm({ aantal: 8, recent_gemiddelde: 7.3 })])
    expect(r.stijgers).toHaveLength(1)
  })

  it('scheidt stijgers en dalers en sorteert op grootte (grootste eerst)', () => {
    const r = bepaalStijgersDalers([
      vorm({ player_id: 's1', naam: 'S1', recent_gemiddelde: 7.4 }),
      vorm({ player_id: 's2', naam: 'S2', recent_gemiddelde: 8 }),
      vorm({ player_id: 'd1', naam: 'D1', recent_gemiddelde: 6.5 }),
      vorm({ player_id: 'd2', naam: 'D2', recent_gemiddelde: 6.6 }),
      vorm({ player_id: 'n', naam: 'N', recent_gemiddelde: 7.1 }),
    ])
    expect(r.stijgers.map((x) => x.player_id)).toEqual(['s2', 's1'])
    expect(r.dalers.map((x) => x.player_id)).toEqual(['d1', 'd2'])
    expect(r.stijgers[0].verschil).toBe(1)
    expect(r.dalers[0].verschil).toBe(-0.5)
    expect(r.meegeteld).toBe(5)
  })

  it('grenzen: 0,30 doet mee, 0,29 niet, −0,30 is een daler; 7,3 − 7,0 telt als 0,3', () => {
    const r = bepaalStijgersDalers([
      vorm({ player_id: 'a', naam: 'A', seizoen_gemiddelde: 7.0, recent_gemiddelde: 7.3 }),
      vorm({ player_id: 'b', naam: 'B', seizoen_gemiddelde: 7.0, recent_gemiddelde: 7.29 }),
      vorm({ player_id: 'c', naam: 'C', seizoen_gemiddelde: 7.3, recent_gemiddelde: 7.0 }),
      vorm({ player_id: 'd', naam: 'D', seizoen_gemiddelde: 7.0, recent_gemiddelde: 6.71 }),
    ])
    expect(7.3 - 7.0).not.toBe(0.3) // de float-ruis waar het afronden voor is
    expect(r.stijgers.map((x) => x.player_id)).toEqual(['a'])
    expect(r.stijgers[0].verschil).toBe(0.3)
    expect(r.dalers.map((x) => x.player_id)).toEqual(['c'])
    expect(r.dalers[0].verschil).toBe(-0.3)
  })

  it('aantal 7 valt af, aantal 8 doet mee (W5); meegeteld telt alleen ≥ minimum', () => {
    const r = bepaalStijgersDalers([
      vorm({ player_id: 'zeven', naam: 'Z', aantal: 7, recent_gemiddelde: 9 }),
      vorm({ player_id: 'acht', naam: 'A', aantal: 8, recent_gemiddelde: 9 }),
    ])
    expect(r.stijgers.map((x) => x.player_id)).toEqual(['acht'])
    expect(r.meegeteld).toBe(1)
  })

  it('0 spelers boven het minimum: meegeteld 0 en twee lege lijsten', () => {
    const r = bepaalStijgersDalers([vorm({ aantal: 3, recent_gemiddelde: 9 })])
    expect(r).toEqual({ stijgers: [], dalers: [], meegeteld: 0 })
  })

  it('een niet-eindig gemiddelde valt af', () => {
    const r = bepaalStijgersDalers([
      vorm({ recent_gemiddelde: Number.NaN }),
      vorm({ player_id: 'p2', seizoen_gemiddelde: null as unknown as number }),
    ])
    expect(r).toEqual({ stijgers: [], dalers: [], meegeteld: 0 })
  })

  it('gelijke stand: naam, dan id', () => {
    const r = bepaalStijgersDalers([
      vorm({ player_id: 'p2', naam: 'Bo', recent_gemiddelde: 8 }),
      vorm({ player_id: 'p1', naam: 'Bo', recent_gemiddelde: 8 }),
      vorm({ player_id: 'p3', naam: 'Al', recent_gemiddelde: 8 }),
    ])
    expect(r.stijgers.map((x) => x.player_id)).toEqual(['p3', 'p1', 'p2'])
  })

  it('muteert de invoer niet', () => {
    const rows = [vorm({ recent_gemiddelde: 8 }), vorm({ player_id: 'p2', recent_gemiddelde: 6 })]
    const kopie = structuredClone(rows)
    bepaalStijgersDalers(rows)
    expect(rows).toEqual(kopie)
  })
})

const speler = (over: Partial<SpelerPositieRij> = {}): SpelerPositieRij => ({
  id: 'p1', name: 'Anna', position: 'Keeper', secondary_positions: [], injured: false, ...over,
})

describe('dekkingPerPositie', () => {
  it('geeft altijd alle 12 posities in de volgorde van POSITIONS, ook zonder spelers', () => {
    const r = dekkingPerPositie([])
    expect(r.map((x) => x.positie)).toEqual(POSITIONS)
    expect(r).toHaveLength(12)
    expect(r.every((x) => x.spelers.length === 0)).toBe(true)
  })

  it('telt secundair mee met de vlag; primair staat vóór secundair, elk op naam en id', () => {
    const r = dekkingPerPositie([
      speler({ id: 'a', name: 'Aad', position: 'Spits', secondary_positions: ['Linksbuiten'] }),
      speler({ id: 'z', name: 'Zoë', position: 'Linksbuiten' }),
      speler({ id: 'b2', name: 'Bas', position: 'Linksbuiten' }),
      speler({ id: 'b1', name: 'Bas', position: 'Linksbuiten' }),
    ])
    const lb = r.find((x) => x.positie === 'Linksbuiten')!
    expect(lb.spelers).toEqual([
      { player_id: 'b1', naam: 'Bas', secundair: false },
      { player_id: 'b2', naam: 'Bas', secundair: false },
      { player_id: 'z', naam: 'Zoë', secundair: false },
      { player_id: 'a', naam: 'Aad', secundair: true },
    ])
    expect(r.find((x) => x.positie === 'Spits')!.spelers).toEqual([{ player_id: 'a', naam: 'Aad', secundair: false }])
  })

  it('een geblesseerde speler telt nergens mee (AC-3.2); injured null telt wel', () => {
    const r = dekkingPerPositie([
      speler({ id: 'x', injured: true, secondary_positions: ['Spits'] }),
      speler({ id: 'y', name: 'Yara', injured: null }),
    ])
    expect(r.find((x) => x.positie === 'Keeper')!.spelers.map((s) => s.player_id)).toEqual(['y'])
    expect(r.find((x) => x.positie === 'Spits')!.spelers).toEqual([])
  })

  it('dezelfde positie primair én secundair telt één keer als primair; dubbele secundaire ook één keer', () => {
    const r = dekkingPerPositie([
      speler({ position: 'Spits', secondary_positions: ['Spits', 'Rechtsbuiten', 'Rechtsbuiten'] }),
    ])
    expect(r.find((x) => x.positie === 'Spits')!.spelers).toEqual([{ player_id: 'p1', naam: 'Anna', secundair: false }])
    expect(r.find((x) => x.positie === 'Rechtsbuiten')!.spelers).toHaveLength(1)
  })

  it('negeert onbekende posities en gebruikt GEEN fallbacks', () => {
    const r = dekkingPerPositie([
      speler({ position: 'Libero', secondary_positions: ['Voorstopper', 'Keeper'], injured: false }),
      speler({ id: 'p2', position: 'Centrale verdediger', secondary_positions: null }),
    ])
    const totaal = r.reduce((n, x) => n + x.spelers.length, 0)
    expect(totaal).toBe(2)
    expect(r.find((x) => x.positie === 'Keeper')!.spelers[0].secundair).toBe(true)
    // Een centrale verdediger dekt alleen zijn eigen positie, niet die van de backs.
    expect(r.find((x) => x.positie === 'Linksachter')!.spelers).toEqual([])
  })

  it('muteert de invoer niet', () => {
    const rows = [speler({ secondary_positions: ['Spits'] }), speler({ id: 'p0', name: 'Aad' })]
    const kopie = structuredClone(rows)
    dekkingPerPositie(rows)
    expect(rows).toEqual(kopie)
  })
})

const opk = (over: Partial<TrainingOpkomstPerSpelerRij> = {}): TrainingOpkomstPerSpelerRij => ({
  player_id: 'p1', naam: 'Anna', gast: false, aanwezig: 3, afwezig: 1, ...over,
})

describe('naastElkaarPerSpeler', () => {
  it('voegt drie bronnen per speler samen', () => {
    const r = naastElkaarPerSpeler({
      opkomst: [opk({ aanwezig: 3, afwezig: 1 })],
      speelkansen: [kans({ noemer: 5, selectie: 4 })],
      ratings: [{ player_id: 'p1', naam: 'Anna', gemiddelde: 7.25, aantal: 4 }],
    })
    expect(r).toEqual([
      {
        player_id: 'p1', naam: 'Anna', gast: false,
        opkomst: { aanwezig: 3, totaal: 4, percentage: 75 },
        selectie: { selectie: 4, noemer: 5 },
        rating: { gemiddelde: 7.25, aantal: 4 },
      },
    ])
  })

  it('sorteert op naam, dan id — geen rangorde (W4)', () => {
    const r = naastElkaarPerSpeler({
      opkomst: [opk({ player_id: 'p9', naam: 'Zoë' }), opk({ player_id: 'p2', naam: 'Bo' })],
      speelkansen: [kans({ player_id: 'p1', naam: 'Bo' })],
      ratings: [{ player_id: 'p3', naam: 'Aad', gemiddelde: 6, aantal: 1 }],
    })
    expect(r.map((x) => x.player_id)).toEqual(['p3', 'p1', 'p2', 'p9'])
  })

  it('null bij ontbrekende data: 0/0 opkomst, noemer 0, geen rating; spelers zonder iets vallen weg', () => {
    const r = naastElkaarPerSpeler({
      opkomst: [opk({ player_id: 'leeg', aanwezig: 0, afwezig: 0 }), opk({ player_id: 'p1', aanwezig: 0, afwezig: 2 })],
      speelkansen: [kans({ player_id: 'p1', noemer: 0, selectie: 0 }), kans({ player_id: 'leeg', noemer: 0 })],
      ratings: [{ player_id: 'leeg', naam: 'Anna', gemiddelde: Number.NaN, aantal: 2 }],
    })
    expect(r.map((x) => x.player_id)).toEqual(['p1'])
    expect(r[0].opkomst).toEqual({ aanwezig: 0, totaal: 2, percentage: 0 })
    expect(r[0].selectie).toBeNull()
    expect(r[0].rating).toBeNull()
  })

  it('gast (O3): alleen het aantal keer aanwezig, nooit een noemer of percentage', () => {
    const r = naastElkaarPerSpeler({
      opkomst: [opk({ player_id: 'g', naam: 'Gast', gast: true, aanwezig: 1, afwezig: 29 })],
      speelkansen: [kans({ player_id: 'g', naam: 'Gast', gast: true, noemer: 3, selectie: 1 })],
      ratings: [],
    })
    expect(r).toHaveLength(1)
    expect(r[0].gast).toBe(true)
    expect(r[0].opkomst).toEqual({ aanwezig: 1, totaal: null, percentage: null })
    expect(r[0].selectie).toEqual({ selectie: 1, noemer: 3 })
  })

  it('gast met 0 keer aanwezig krijgt geen opkomst (afwezig is de standaard voor gasten)', () => {
    const r = naastElkaarPerSpeler({
      opkomst: [opk({ player_id: 'g', gast: true, aanwezig: 0, afwezig: 30 })],
      speelkansen: [],
      ratings: [],
    })
    expect(r).toEqual([])
  })

  it('gastvlag uit speelkansen dwingt ook de gast-vorm af in de opkomst', () => {
    const r = naastElkaarPerSpeler({
      opkomst: [opk({ player_id: 'g', gast: false, aanwezig: 2, afwezig: 8 })],
      speelkansen: [kans({ player_id: 'g', gast: true })],
      ratings: [],
    })
    expect(r[0].gast).toBe(true)
    expect(r[0].opkomst).toEqual({ aanwezig: 2, totaal: null, percentage: null })
  })

  it('muteert de invoer niet', () => {
    const invoer = {
      opkomst: [opk()],
      speelkansen: [kans()],
      ratings: [{ player_id: 'p1', naam: 'Anna', gemiddelde: 7, aantal: 1 }] as RatingPerSpelerRij[],
    }
    const kopie = structuredClone(invoer)
    naastElkaarPerSpeler(invoer)
    expect(invoer).toEqual(kopie)
  })
})

describe('maandenInVenster', () => {
  it('geeft de maanden van start t/m eind', () => {
    expect(maandenInVenster('2026-08-15', '2026-11-02')).toEqual(['2026-08', '2026-09', '2026-10', '2026-11'])
    expect(maandenInVenster('2026-10-01', '2026-10-31')).toEqual(['2026-10'])
  })

  it('over de jaargrens en over februari in een schrikkeljaar', () => {
    expect(maandenInVenster('2026-12-31', '2027-01-01')).toEqual(['2026-12', '2027-01'])
    expect(maandenInVenster('2028-01-31', '2028-03-01')).toEqual(['2028-01', '2028-02', '2028-03'])
    expect(maandenInVenster('2028-02-29', '2028-02-29')).toEqual(['2028-02'])
  })

  it('end < start of ongeldige strings → []', () => {
    expect(maandenInVenster('2026-10-01', '2026-09-30')).toEqual([])
    expect(maandenInVenster('2026-13-01', '2027-01-01')).toEqual([])
    expect(maandenInVenster('2026-02-30', '2026-03-01')).toEqual([])
    expect(maandenInVenster('', '2026-03-01')).toEqual([])
    expect(maandenInVenster('2026-01', '2026-03-01')).toEqual([])
  })
})

describe('blessuresPerMaand', () => {
  const venster = { start: '2026-08-20', end: '2026-11-03' }

  it('maand zonder rij → null ("geen gegevens"), rij met 0 → 0 (AC-5.4)', () => {
    const rows: BlessuresPerMaandRij[] = [
      { maand: '2026-08', geblesseerd: 2 },
      { maand: '2026-10', geblesseerd: 0 },
    ]
    expect(blessuresPerMaand(rows, venster)).toEqual([
      { maand: '2026-08', geblesseerd: 2 },
      { maand: '2026-09', geblesseerd: null },
      { maand: '2026-10', geblesseerd: 0 },
      { maand: '2026-11', geblesseerd: null },
    ])
  })

  it('negeert rijen buiten het venster; een ongeldig venster geeft []', () => {
    expect(blessuresPerMaand([{ maand: '2026-01', geblesseerd: 4 }], { start: '2026-10-01', end: '2026-10-10' }))
      .toEqual([{ maand: '2026-10', geblesseerd: null }])
    expect(blessuresPerMaand([{ maand: '2026-10', geblesseerd: 1 }], { start: '2026-10-10', end: '2026-10-01' })).toEqual([])
  })

  it('muteert de invoer niet', () => {
    const rows: BlessuresPerMaandRij[] = [{ maand: '2026-09', geblesseerd: 1 }]
    const kopie = structuredClone(rows)
    blessuresPerMaand(rows, venster)
    expect(rows).toEqual(kopie)
  })
})

// ── Fase 2b: speelminuten ────────────────────────────────────────────
import { verdeelSpeelminuten, type SpeelminutenRij } from '@/lib/inzichten'

function minutenRij(over: Partial<SpeelminutenRij> = {}): SpeelminutenRij {
  return { player_id: 'p1', naam: 'Speler', gast: false, wedstrijden: 1, minuten: 60, wissels: 1, noemer: 3, ...over }
}

describe('verdeelSpeelminuten', () => {
  it('rondt het gemiddelde af op hele minuten (135/2 → 68)', () => {
    const { regels, noemer } = verdeelSpeelminuten([minutenRij({ wedstrijden: 2, minuten: 135, wissels: 3, noemer: 2 })])
    expect(noemer).toBe(2)
    expect(regels[0].gemiddelde).toBe(68)
    expect(regels[0].minuten).toBe(135)
    expect(regels[0].wissels).toBe(3)
    expect(regels[0].minutenAandeel).toBe(1)
  })

  it('noemer 0 (of geen rijen) geeft de lege staat: geen regels', () => {
    expect(verdeelSpeelminuten([])).toEqual({ regels: [], noemer: 0 })
    expect(verdeelSpeelminuten([minutenRij({ noemer: 0 })])).toEqual({ regels: [], noemer: 0 })
  })

  it('wedstrijden 0 → minuten, wissels, gemiddelde en aandeel null — nooit 0 of NaN (AC-K.4)', () => {
    const { regels } = verdeelSpeelminuten([
      minutenRij({ player_id: 'a', wedstrijden: 2, minuten: 100, noemer: 2 }),
      minutenRij({ player_id: 'b', wedstrijden: 0, minuten: null, wissels: null, noemer: 2 }),
    ])
    const b = regels.find((r) => r.player_id === 'b')!
    expect(b.wedstrijden).toBe(0)
    expect(b.minuten).toBeNull()
    expect(b.wissels).toBeNull()
    expect(b.gemiddelde).toBeNull()
    expect(b.minutenAandeel).toBeNull()
    expect(b.noemer).toBe(2)
  })

  it('een ingevoerde 0 blijft 0; is iedereens totaal 0, dan geen meter (aandeel null)', () => {
    const { regels } = verdeelSpeelminuten([minutenRij({ wedstrijden: 1, minuten: 0, wissels: 0, noemer: 1 })])
    expect(regels[0].minuten).toBe(0)
    expect(regels[0].wissels).toBe(0)
    expect(regels[0].gemiddelde).toBe(0)
    expect(regels[0].minutenAandeel).toBeNull()
  })

  it('aandeel t.o.v. het hoogste totaal', () => {
    const { regels } = verdeelSpeelminuten([
      minutenRij({ player_id: 'a', minuten: 90 }),
      minutenRij({ player_id: 'b', minuten: 45 }),
    ])
    expect(regels.map((r) => r.minutenAandeel)).toEqual([1, 0.5])
  })

  it('sorteert: met minuten eerst, minuten aflopend, wedstrijden aflopend, naam, id (AC-A9)', () => {
    const { regels } = verdeelSpeelminuten([
      minutenRij({ player_id: 'p0', naam: 'Aad', wedstrijden: 0, minuten: null, wissels: null }),
      minutenRij({ player_id: 'p4', naam: 'Bram', wedstrijden: 2, minuten: 120 }),
      minutenRij({ player_id: 'p3', naam: 'Bram', wedstrijden: 2, minuten: 120 }),
      minutenRij({ player_id: 'p2', naam: 'Anna', wedstrijden: 2, minuten: 120 }),
      minutenRij({ player_id: 'p1', naam: 'Cas', wedstrijden: 3, minuten: 120 }),
      minutenRij({ player_id: 'p5', naam: 'Zoë', wedstrijden: 1, minuten: 130 }),
      minutenRij({ player_id: 'p6', naam: 'Ab', wedstrijden: 1, minuten: 0 }),
    ])
    expect(regels.map((r) => r.player_id)).toEqual(['p5', 'p1', 'p2', 'p3', 'p4', 'p6', 'p0'])
  })

  it('behoudt de gastvlag en maakt van iets anders dan true geen gast', () => {
    const { regels } = verdeelSpeelminuten([
      minutenRij({ player_id: 'g', gast: true }),
      minutenRij({ player_id: 'v', gast: 'ja' as unknown as boolean }),
    ])
    expect(regels.find((r) => r.player_id === 'g')!.gast).toBe(true)
    expect(regels.find((r) => r.player_id === 'v')!.gast).toBe(false)
  })

  it('onbekende of negatieve waarden tellen als 0; noemer = de grootste geldige', () => {
    const { regels, noemer } = verdeelSpeelminuten([
      minutenRij({ player_id: 'a', wedstrijden: 2, minuten: -5, wissels: 1.5 as number, noemer: 4 }),
      minutenRij({ player_id: 'b', wedstrijden: -1, minuten: 50, noemer: -3 }),
      minutenRij({ player_id: 'c', wedstrijden: Number.NaN, minuten: 50, noemer: Number.NaN }),
      null as unknown as SpeelminutenRij,
    ])
    expect(noemer).toBe(4)
    expect(regels).toHaveLength(3)
    const a = regels.find((r) => r.player_id === 'a')!
    expect(a.minuten).toBe(0)
    expect(a.wissels).toBe(0)
    expect(a.gemiddelde).toBe(0)
    for (const id of ['b', 'c']) {
      const r = regels.find((x) => x.player_id === id)!
      expect(r.wedstrijden).toBe(0)
      expect(r.minuten).toBeNull()
      expect(r.gemiddelde).toBeNull()
      expect(r.noemer).toBe(4)
    }
  })

  it('muteert de invoer niet', () => {
    const rows = [minutenRij({ player_id: 'b', naam: 'B', minuten: 10 }), minutenRij({ player_id: 'a', naam: 'A', minuten: 80 })]
    const kopie = structuredClone(rows)
    verdeelSpeelminuten(rows)
    expect(rows).toEqual(kopie)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Inzichten-metrics fase 3a — belasting, periodisering, invul-discipline
// ═══════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MAX_FASE3_RIJEN,
  belastingPerWeek,
  isAfgekapt,
  periodiseringVoortgang,
  telInvulDiscipline,
  type InvulDisciplineRij,
  type TrainingKoppelingRij,
} from '@/lib/inzichten'
import { blokkenVanKoppelingen } from '@/lib/parallel-groep'
import { berekenTijdlijn } from '@/lib/sessie-tijdlijn'
import { actueleMetingen, getTrainingLog } from '@/lib/periodization'
import { MEETBARE_CATEGORIES, PERIODIZATION_CATEGORIES, berekenStap } from '@/lib/types'
import type { CategorieMeting, Oefening, OefeningCategorie, TrainingOefeningWithData } from '@/lib/types'
import { analyseBestaat } from '@/lib/match-analysis.mjs'
import { hasTrainingPlanDone } from '@/lib/todos.mjs'

let kSeq = 0
// Eén RPC-rij van inzichten_training_koppelingen met een koppeling. Default:
// VCT, leesbare oefening 'positiespel' van 15 min, koppeling zonder eigen duur.
function kRij(eventId: string, datum: string, extra: Partial<TrainingKoppelingRij> = {}): TrainingKoppelingRij {
  kSeq++
  return {
    event_id: eventId,
    datum,
    trainingstype: 'vct',
    koppeling_id: `k${String(kSeq).padStart(4, '0')}`,
    volgorde: kSeq,
    aangemaakt: `2026-01-01T00:00:00.${String(kSeq).padStart(3, '0')}Z`,
    parallel_groep_id: null,
    koppeling_duur_min: null,
    oefening_duur_min: 15,
    categorie: 'positiespel',
    stap_override: null,
    oefening_leesbaar: true,
    totaal: 0,
    ...extra,
  }
}
// Training zonder koppeling: één rij met koppeling_id null (left join).
function legeTraining(eventId: string, datum: string, extra: Partial<TrainingKoppelingRij> = {}): TrainingKoppelingRij {
  return {
    ...kRij(eventId, datum, extra),
    koppeling_id: null,
    volgorde: null,
    aangemaakt: null,
    oefening_duur_min: null,
    categorie: null,
    oefening_leesbaar: false,
  }
}
// Zet `totaal` zoals count(*) over () dat doet.
function metTotaal(rijen: TrainingKoppelingRij[]): TrainingKoppelingRij[] {
  return rijen.map((r) => ({ ...r, totaal: rijen.length }))
}

const OKT = { start: '2026-10-01', end: '2026-10-26' } // do 1 okt t/m ma 26 okt

describe('isAfgekapt (AC-A12, T6)', () => {
  const n = (aantal: number, totaal: number) => Array.from({ length: aantal }, () => ({ totaal }))
  it('waar bij meer dan MAX_FASE3_RIJEN rijen (de limit van 901 is geraakt)', () => {
    expect(MAX_FASE3_RIJEN).toBe(900)
    expect(isAfgekapt(n(901, 901))).toBe(true)
    expect(isAfgekapt(n(900, 900))).toBe(false)
  })
  it('waar als totaal groter is dan wat er binnenkwam (max-rows of limit)', () => {
    expect(isAfgekapt(n(900, 905))).toBe(true)
    expect(isAfgekapt(n(2, 3))).toBe(true)
    expect(isAfgekapt(n(2, 2))).toBe(false)
  })
  it('lege of rare invoer is niet afgekapt', () => {
    expect(isAfgekapt([])).toBe(false)
    expect(isAfgekapt(null as unknown as [])).toBe(false)
    expect(isAfgekapt([{ totaal: Number.NaN }])).toBe(false)
  })
})

describe('belastingPerWeek', () => {
  const week = (o: ReturnType<typeof belastingPerWeek>, maandag: string) => o.weken.find((w) => w.maandag === maandag)!

  it('Q2: parallelle groep 20 + 30 → per categorie elk lid met eigen duur, trainingstotaal = langste (30)', () => {
    const rijen = metTotaal([
      kRij('t1', '2026-10-06', { volgorde: 1, parallel_groep_id: 'g1', koppeling_duur_min: 20, categorie: 'partijen_klein' }),
      kRij('t1', '2026-10-06', { volgorde: 1, parallel_groep_id: 'g1', koppeling_duur_min: 30, categorie: 'positiespel' }),
    ])
    const w = week(belastingPerWeek(rijen, OKT), '2026-10-05')
    expect(w.perCategorie!.partijen_klein).toBe(20)
    expect(w.perCategorie!.positiespel).toBe(30)
    expect(w.trainingstotaalMin).toBe(30)
  })

  it('Q2: twee parallelle leden van dezelfde categorie tellen allebei', () => {
    const rijen = metTotaal([
      kRij('t1', '2026-10-06', { volgorde: 1, parallel_groep_id: 'g1', koppeling_duur_min: 20 }),
      kRij('t1', '2026-10-06', { volgorde: 1, parallel_groep_id: 'g1', koppeling_duur_min: 30 }),
    ])
    const w = week(belastingPerWeek(rijen, OKT), '2026-10-05')
    expect(w.perCategorie!.positiespel).toBe(50)
    expect(w.trainingstotaalMin).toBe(30)
  })

  it('genest telt additief: een kind van 10 maakt het totaal 10 groter (genest_in wordt niet gelezen)', () => {
    const zonder = metTotaal([kRij('t1', '2026-10-06', { koppeling_duur_min: 30 })])
    const met = metTotaal([kRij('t1', '2026-10-06', { koppeling_duur_min: 30 }), kRij('t1', '2026-10-06', { koppeling_duur_min: 10 })])
    expect(week(belastingPerWeek(met, OKT), '2026-10-05').trainingstotaalMin).toBe(
      week(belastingPerWeek(zonder, OKT), '2026-10-05').trainingstotaalMin! + 10,
    )
  })

  it('teamtactische trainingen tellen mee', () => {
    const rijen = metTotaal([kRij('t1', '2026-10-06', { trainingstype: 'teamtactisch', koppeling_duur_min: 25 })])
    const w = week(belastingPerWeek(rijen, OKT), '2026-10-05')
    expect(w.trainingen).toBe(1)
    expect(w.trainingstotaalMin).toBe(25)
    expect(w.perCategorie!.positiespel).toBe(25)
  })

  it('koppeling NULL valt terug op de bibliotheekduur (15)', () => {
    const w = week(belastingPerWeek(metTotaal([kRij('t1', '2026-10-06')]), OKT), '2026-10-05')
    expect(w.perCategorie!.positiespel).toBe(15)
    expect(w.trainingstotaalMin).toBe(15)
  })

  it('koppeling 0 = geen duur: oefeningenZonderDuur +1 en de bibliotheekduur telt NIET', () => {
    const w = week(belastingPerWeek(metTotaal([kRij('t1', '2026-10-06', { koppeling_duur_min: 0 })]), OKT), '2026-10-05')
    expect(w.perCategorie!.positiespel).toBe(0)
    expect(w.oefeningenZonderDuur).toBe(1)
    expect(w.trainingstotaalMin).toBe(0)
    expect(w.blokkenZonderDuur).toBe(1)
  })

  it('een groep met één overgebleven lid is een los blok', () => {
    const rijen = metTotaal([
      kRij('t1', '2026-10-06', { volgorde: 1, parallel_groep_id: 'wees', koppeling_duur_min: 25 }),
      kRij('t1', '2026-10-06', { volgorde: 2, koppeling_duur_min: 10 }),
    ])
    expect(week(belastingPerWeek(rijen, OKT), '2026-10-05').trainingstotaalMin).toBe(35)
  })

  it('B.6: week zonder training = null ("geen gegevens"); met training maar zonder die categorie = 0', () => {
    const o = belastingPerWeek(metTotaal([kRij('t1', '2026-10-06', { koppeling_duur_min: 30 })]), OKT)
    expect(o.weken.map((w) => w.maandag)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    const leeg = week(o, '2026-10-12')
    expect(leeg.perCategorie).toBeNull()
    expect(leeg.trainingstotaalMin).toBeNull()
    expect(leeg.totaalAandeel).toBeNull()
    expect(leeg.trainingen).toBe(0)
    const vol = week(o, '2026-10-05')
    expect(vol.perCategorie!.sprints_veel_rust).toBe(0)
    expect(Object.keys(vol.perCategorie!)).toEqual(PERIODIZATION_CATEGORIES.map((c) => c.key))
  })

  it('deelweken: begin en eind gemarkeerd, middenweken niet', () => {
    const o = belastingPerWeek([], OKT)
    expect(o.weken.map((w) => [w.deelweekBegin, w.deelweekEind])).toEqual([
      [true, false], [false, false], [false, false], [false, false], [false, true],
    ])
  })

  it('een venster binnen één week: beide vlaggen waar', () => {
    const o = belastingPerWeek([], { start: '2026-10-20', end: '2026-10-22' })
    expect(o.weken).toHaveLength(1)
    expect(o.weken[0]).toMatchObject({ maandag: '2026-10-19', deelweekBegin: true, deelweekEind: true })
  })

  it('een volledige week ma–zo is geen deelweek', () => {
    const o = belastingPerWeek([], { start: '2026-10-19', end: '2026-10-25' })
    expect(o.weken).toHaveLength(1)
    expect(o.weken[0]).toMatchObject({ deelweekBegin: false, deelweekEind: false, isoJaar: 2026, isoWeek: 43 })
  })

  it('een training op zondag en een op maandag vallen in de juiste week (string-rekenen)', () => {
    const o = belastingPerWeek(
      metTotaal([kRij('zo', '2026-10-25', { koppeling_duur_min: 40 }), kRij('ma', '2026-10-26', { koppeling_duur_min: 50 })]),
      OKT,
    )
    expect(week(o, '2026-10-19').trainingstotaalMin).toBe(40)
    expect(week(o, '2026-10-26').trainingstotaalMin).toBe(50)
  })

  it('over de jaarwisseling: weken 52, 53 en 1 met het juiste ISO-jaar', () => {
    const o = belastingPerWeek(
      metTotaal([kRij('a', '2026-12-31', { koppeling_duur_min: 20 }), kRij('b', '2027-01-04', { koppeling_duur_min: 30 })]),
      { start: '2026-12-21', end: '2027-01-10' },
    )
    expect(o.weken.map((w) => [w.isoJaar, w.isoWeek])).toEqual([[2026, 52], [2026, 53], [2027, 1]])
    expect(week(o, '2026-12-28').trainingstotaalMin).toBe(20)
    expect(week(o, '2027-01-04').trainingstotaalMin).toBe(30)
  })

  it('niet-leesbare oefening met eigen duur: telt in het totaal, niet in een categorie, oefeningenOnbekend +1', () => {
    const rijen = metTotaal([
      kRij('t1', '2026-10-06', { koppeling_duur_min: 12, oefening_leesbaar: false, categorie: null, oefening_duur_min: null }),
    ])
    const o = belastingPerWeek(rijen, OKT)
    const w = week(o, '2026-10-05')
    expect(w.trainingstotaalMin).toBe(12)
    expect(w.oefeningenOnbekend).toBe(1)
    expect(Object.values(w.perCategorie!).every((v) => v === 0)).toBe(true)
    expect(o.heeftMinuten).toBe(true)
  })

  it('niet-leesbare oefening zonder eigen duur valt NIET terug op een (onzichtbare) bibliotheekduur', () => {
    const rijen = metTotaal([kRij('t1', '2026-10-06', { oefening_leesbaar: false, oefening_duur_min: 99, categorie: 'overig' })])
    const w = week(belastingPerWeek(rijen, OKT), '2026-10-05')
    expect(w.trainingstotaalMin).toBe(0)
    expect(w.blokkenZonderDuur).toBe(1)
    expect(w.oefeningenOnbekend).toBe(1)
    expect(w.perCategorie!.overig).toBe(0)
  })

  it('B.5: training zonder koppeling → trainingenZonderOefeningen +1, geen minuten', () => {
    const o = belastingPerWeek(metTotaal([legeTraining('t1', '2026-10-06')]), OKT)
    const w = week(o, '2026-10-05')
    expect(w.trainingen).toBe(1)
    expect(w.trainingenZonderOefeningen).toBe(1)
    expect(w.trainingstotaalMin).toBe(0)
    expect(o.heeftTrainingen).toBe(true)
    expect(o.heeftMinuten).toBe(false)
  })

  it('AC-A5: alleen ingeplande trainingen zonder duur → heeftTrainingen maar niet heeftMinuten', () => {
    const o = belastingPerWeek(metTotaal([kRij('t1', '2026-10-06', { oefening_duur_min: null })]), OKT)
    expect(o.heeftTrainingen).toBe(true)
    expect(o.heeftMinuten).toBe(false)
    expect(week(o, '2026-10-05').oefeningenZonderDuur).toBe(1)
  })

  it('rijen buiten het venster of met een ongeldige datum worden genegeerd', () => {
    const o = belastingPerWeek(
      metTotaal([
        kRij('voor', '2026-09-30', { koppeling_duur_min: 99 }),
        kRij('na', '2026-10-27', { koppeling_duur_min: 99 }),
        kRij('kapot', '2026-02-30', { koppeling_duur_min: 99 }),
        kRij('in', '2026-10-01', { koppeling_duur_min: 10 }),
      ]),
      OKT,
    )
    expect(o.weken.reduce((s, w) => s + w.trainingen, 0)).toBe(1)
    expect(o.totaalPerCategorie.positiespel).toBe(10)
  })

  it('totaalAandeel t.o.v. het hoogste weektotaal; totaalPerCategorie over het venster', () => {
    const o = belastingPerWeek(
      metTotaal([
        kRij('a', '2026-10-06', { koppeling_duur_min: 60 }),
        kRij('b', '2026-10-13', { koppeling_duur_min: 30, categorie: 'warming_up' }),
      ]),
      OKT,
    )
    expect(week(o, '2026-10-05').totaalAandeel).toBe(1)
    expect(week(o, '2026-10-12').totaalAandeel).toBe(0.5)
    expect(o.totaalPerCategorie).toMatchObject({ positiespel: 60, warming_up: 30, overig: 0 })
  })

  it('de invoer wordt niet gemuteerd en er komt nooit NaN uit', () => {
    const rijen = metTotaal([
      kRij('t1', '2026-10-06', { koppeling_duur_min: Number.NaN, oefening_duur_min: Number.NaN }),
      kRij('t1', '2026-10-06', { koppeling_duur_min: 'abc' as unknown as number, volgorde: Number.NaN }),
      kRij('t2', '2026-10-07', { koppeling_duur_min: 5 }),
    ])
    const kopie = structuredClone(rijen)
    const o = belastingPerWeek(rijen, OKT)
    expect(rijen).toEqual(kopie)
    expect(JSON.stringify(o)).not.toMatch(/NaN|null,"isoWeek":null/)
    for (const w of o.weken) {
      for (const v of [w.trainingstotaalMin, w.totaalAandeel, ...Object.values(w.perCategorie ?? {})]) {
        if (v !== null) expect(Number.isFinite(v)).toBe(true)
      }
    }
    expect(week(o, '2026-10-05').trainingstotaalMin).toBe(5)
  })

  it('AC-A12: afgekapt → weken [], ook bij totaal > aantal rijen (max-rows)', () => {
    const rijen = [kRij('t1', '2026-10-06', { totaal: 3 }), kRij('t2', '2026-10-07', { totaal: 3 })]
    const o = belastingPerWeek(rijen, OKT)
    expect(o.afgekapt).toBe(true)
    expect(o.weken).toEqual([])
    const veel = Array.from({ length: 901 }, (_, i) => kRij(`t${i}`, '2026-10-06', { totaal: 901 }))
    expect(belastingPerWeek(veel, OKT)).toMatchObject({ afgekapt: true, weken: [] })
  })

  it('ongeldig venster → geen weken, geen crash', () => {
    expect(belastingPerWeek([kRij('t1', '2026-10-06')], { start: '2026-10-26', end: '2026-10-01' }).weken).toEqual([])
    expect(belastingPerWeek([], { start: 'x', end: 'y' }).weken).toEqual([])
  })
})

// ── Pariteit belasting ↔ planner (Q2: nooit een ander trainingstotaal) ──
function oefening(id: string, categorie: OefeningCategorie, duur: number | null): Oefening {
  return {
    id, team_id: 'eigenaar-1', naam: id, beschrijving: null, categorie, duur_min: duur,
    breedte_m: null, lengte_m: null, orientatie: 'vrij', veldzone: null, teams: [], aantal_neutralen: 0,
    diagram: null, created_at: '2026-01-01T00:00:00Z',
  }
}
function koppeling(
  id: string, volgorde: number, oef: Oefening | null, extra: Partial<TrainingOefeningWithData> = {},
): TrainingOefeningWithData {
  return {
    id, team_id: 'team-1', event_id: 'ev-1', oefening_id: oef?.id ?? 'onleesbaar', volgorde, stap_override: null,
    genest_in: null, spelerindeling: [], parallel_groep_id: null, parallel_spelers: [], aantallen_override: null,
    duur_min: null, created_at: `2026-01-01T00:00:0${volgorde}Z`,
    // Een oefening zonder leesrecht komt uit de planner-join als null; het
    // plannertype kent dat niet, vandaar deze ene cast in de fixture.
    oefeningen: oef as Oefening,
    ...extra,
  }
}
// Dezelfde koppeling zoals inzichten_training_koppelingen hem levert (§1.1).
function alsRpcRij(k: TrainingOefeningWithData, datum: string): TrainingKoppelingRij {
  const oef = k.oefeningen as Oefening | null
  return {
    event_id: k.event_id, datum, trainingstype: 'vct', koppeling_id: k.id, volgorde: k.volgorde,
    aangemaakt: k.created_at, parallel_groep_id: k.parallel_groep_id ?? null, koppeling_duur_min: k.duur_min ?? null,
    oefening_duur_min: oef ? oef.duur_min : null, categorie: oef ? oef.categorie : null,
    stap_override: k.stap_override, oefening_leesbaar: oef !== null, totaal: 0,
  }
}

describe('pariteit belasting ↔ berekenTijdlijn (planner)', () => {
  const fx: TrainingOefeningWithData[] = [
    koppeling('k1', 1, oefening('o1', 'warming_up', 15)), // NULL → bibliotheek 15
    koppeling('k2', 2, oefening('o2', 'partijen_klein', 20), { parallel_groep_id: 'g1', duur_min: 20 }),
    koppeling('k3', 2, oefening('o3', 'positiespel', 10), { parallel_groep_id: 'g1', duur_min: 30 }),
    koppeling('k4', 3, oefening('o4', 'pass_trap', 12), { genest_in: 'k1', duur_min: 10 }), // genest
    koppeling('k5', 4, oefening('o5', 'sprints_veel_rust', 8), { parallel_groep_id: 'wees' }), // weeskind
    koppeling('k6', 5, oefening('o6', 'overig', 25), { duur_min: 0 }), // 0 = geen duur
    koppeling('k7', 6, null, { duur_min: 7 }), // niet leesbaar, eigen duur
    koppeling('k8', 7, oefening('o8', 'steigerungs', null)), // nergens een duur
  ]

  it('trainingstotaal en blokken zonder duur zijn identiek, ook in een andere rijvolgorde', () => {
    const planner = berekenTijdlijn(blokkenVanKoppelingen(fx), null)
    const rijen = metTotaal([...fx].reverse().map((k) => alsRpcRij(k, '2026-10-06')))
    const w = belastingPerWeek(rijen, OKT).weken.find((x) => x.maandag === '2026-10-05')!
    expect(w.trainingstotaalMin).toBe(planner.totaalMin)
    expect(w.blokkenZonderDuur).toBe(planner.blokkenZonderDuur)
    // 15 + max(20,30) + 10 + 8 + 7 = 70; k6 en k8 zonder duur.
    expect(planner.totaalMin).toBe(70)
    expect(planner.blokkenZonderDuur).toBe(2)
    expect(w.perCategorie).toMatchObject({ warming_up: 15, partijen_klein: 20, positiespel: 30, pass_trap: 10, sprints_veel_rust: 8, overig: 0, steigerungs: 0 })
    expect(w.oefeningenZonderDuur).toBe(2)
    expect(w.oefeningenOnbekend).toBe(1)
  })
})

// ── periodiseringVoortgang ────────────────────────────────────────────
function meting(categorie: string, datum: string, stap: number): CategorieMeting {
  return { id: `${categorie}@${datum}`, team_id: 'team-1', categorie, datum, stap, notes: null, created_at: '2026-01-01T00:00:00Z' }
}
const SEIZOEN = { start: '2026-08-01', end: '2026-10-26' }
const VANDAAG = '2026-10-27'
const pg = (rijen: TrainingKoppelingRij[], metingen: CategorieMeting[], weergave = SEIZOEN, vandaag = VANDAAG) =>
  periodiseringVoortgang(metTotaal(rijen), metingen, weergave, vandaag)
const onderdeel = (o: ReturnType<typeof periodiseringVoortgang>, key: string) => o.onderdelen.find((x) => x.key === key)!
const groot = (eventId: string, datum: string, extra: Partial<TrainingKoppelingRij> = {}) =>
  kRij(eventId, datum, { categorie: 'partijen_groot', ...extra })
const trainingStappen = (o: ReturnType<typeof onderdeel>) => o.punten.filter((p) => p.bron === 'training').map((p) => p.stap)

describe('periodiseringVoortgang', () => {
  it('P.1/P.2: één meting stap 3 en vijf trainingen → stappen 3, 3, 4, 4, 5; huidig 5, verschil +2', () => {
    const rijen = ['02', '03', '04', '05', '06'].map((d) => groot(`t${d}`, `2026-09-${d}`))
    const o = onderdeel(pg(rijen, [meting('partijen_groot', '2026-09-01', 3)]), 'partijen_groot')
    expect(trainingStappen(o)).toEqual([3, 3, 4, 4, 5])
    expect(o.punten[0]).toEqual({ datum: '2026-09-01', stap: 3, bron: 'meting', handmatig: false, eventId: null })
    expect(o.nulmeting).toEqual({ datum: '2026-09-01', stap: 3 })
    expect(o.huidig).toEqual({ stap: 5 })
    expect(o.verschil).toBe(2)
    expect(o.geenVoortgang).toBe(false)
    expect(o.trainingen).toBe(5)
    expect(o.gemeten).toBe(true)
    expect(o.maxStap).toBe(21)
  })

  it('P.2: een tweede meting halverwege zet k terug; eerdere punten veranderen niet; op de meetdatum eerst de training', () => {
    const rijen = ['02', '03', '04', '05', '06'].map((d) => groot(`t${d}`, `2026-09-${d}`))
    const metingen = [meting('partijen_groot', '2026-09-01', 3), meting('partijen_groot', '2026-09-04', 2)]
    const o = onderdeel(pg(rijen, metingen), 'partijen_groot')
    expect(trainingStappen(o)).toEqual([3, 3, 4, 2, 2])
    expect(o.punten.map((p) => `${p.datum.slice(8)}:${p.bron[0]}`)).toEqual(['01:m', '02:t', '03:t', '04:t', '04:m', '05:t', '06:t'])
    expect(o.nulmeting).toEqual({ datum: '2026-09-01', stap: 3 }) // eerste ooit, niet de nieuwste
    expect(o.huidig).toEqual({ stap: 3 }) // 2 + floor(2/2)
    expect(o.verschil).toBe(0)
  })

  it('P.6: een training op de (eerste) meetdatum en ervóór krijgt geen punt', () => {
    const rijen = [groot('a', '2026-08-30'), groot('b', '2026-09-01'), groot('c', '2026-09-02')]
    const o = onderdeel(pg(rijen, [meting('partijen_groot', '2026-09-01', 4)]), 'partijen_groot')
    expect(o.punten.filter((p) => p.bron === 'training').map((p) => p.eventId)).toEqual(['c'])
    expect(trainingStappen(o)).toEqual([4])
  })

  it('twee trainingen op dezelfde dag krijgen dezelfde k (dezelfde dag telt niet voor elkaar)', () => {
    const rijen = [groot('x', '2026-09-02'), groot('a', '2026-09-03'), groot('b', '2026-09-03'), groot('c', '2026-09-04')]
    const o = onderdeel(pg(rijen, [meting('partijen_groot', '2026-09-01', 3)]), 'partijen_groot')
    // x: k=0 → 3; a,b: k=1 → 3 (telden ze elkaar mee: k=2 → 4); c: k=3 → 4.
    expect(trainingStappen(o)).toEqual([3, 3, 3, 4])
    expect(o.punten.filter((p) => p.bron === 'training').map((p) => p.eventId)).toEqual(['x', 'a', 'b', 'c'])
  })

  it('stap_override wint (handmatig) en k loopt door; de eerste niet-null override in koppelingsvolgorde', () => {
    const rijen = [
      groot('a', '2026-09-02'),
      groot('b', '2026-09-03', { volgorde: 2, stap_override: 8 }),
      groot('b', '2026-09-03', { volgorde: 1 }),
      groot('b', '2026-09-03', { volgorde: 3, stap_override: 11 }),
      groot('c', '2026-09-04'),
    ]
    const o = onderdeel(pg(rijen, [meting('partijen_groot', '2026-09-01', 3)]), 'partijen_groot')
    const t = o.punten.filter((p) => p.bron === 'training')
    expect(t.map((p) => [p.stap, p.handmatig])).toEqual([[3, false], [8, true], [4, false]])
  })

  it('P.7: teamtactische trainingen tellen niet mee in k en krijgen geen punt', () => {
    const rijen = [
      groot('a', '2026-09-02', { trainingstype: 'teamtactisch' }),
      groot('b', '2026-09-03', { trainingstype: 'teamtactisch' }),
      groot('c', '2026-09-04'),
    ]
    const o = onderdeel(pg(rijen, [meting('partijen_groot', '2026-09-01', 3)]), 'partijen_groot')
    expect(trainingStappen(o)).toEqual([3])
    expect(o.huidig).toEqual({ stap: 3 })
  })

  it('Q3: een stap boven maxStap wordt niet begrensd', () => {
    const rijen = [kRij('a', '2026-09-02', { categorie: 'partijen_klein' }), kRij('b', '2026-09-03', { categorie: 'partijen_klein' }), kRij('c', '2026-09-04', { categorie: 'partijen_klein' })]
    const o = onderdeel(pg(rijen, [meting('partijen_klein', '2026-09-01', 13)]), 'partijen_klein')
    expect(o.maxStap).toBe(13)
    expect(trainingStappen(o)).toEqual([13, 13, 14])
    expect(o.huidig).toEqual({ stap: 14 })
  })

  it('P.5: een ongemeten onderdeel → gemeten false en overal null, nooit 0', () => {
    const o = pg([groot('a', '2026-09-02')], [meting('partijen_groot', '2026-09-01', 3)])
    const ongemeten = onderdeel(o, 'sprints_weinig_rust')
    expect(ongemeten).toEqual({
      key: 'sprints_weinig_rust', maxStap: 14, gemeten: false, nulmeting: null, huidig: null, verschil: null,
      geenVoortgang: false, punten: [], trainingen: 0,
    })
  })

  it('P.4: één meting zonder trainingen → geenVoortgang, huidig = de meting', () => {
    const o = onderdeel(pg([], [meting('partijen_midden', '2026-09-01', 5)]), 'partijen_midden')
    expect(o.geenVoortgang).toBe(true)
    expect(o.huidig).toEqual({ stap: 5 })
    expect(o.verschil).toBe(0)
    expect(o.punten).toEqual([{ datum: '2026-09-01', stap: 5, bron: 'meting', handmatig: false, eventId: null }])
  })

  it('meting vóór de seizoensstart: k telt de trainingen vóór het seizoen mee, maar die staan niet in punten', () => {
    const rijen = [groot('a', '2026-07-10'), groot('b', '2026-07-11'), groot('c', '2026-08-05')]
    const o = onderdeel(pg(rijen, [meting('partijen_groot', '2026-07-01', 3)]), 'partijen_groot')
    expect(o.punten).toEqual([{ datum: '2026-08-05', stap: 4, bron: 'training', handmatig: false, eventId: 'c' }])
    expect(o.nulmeting).toEqual({ datum: '2026-07-01', stap: 3 })
    expect(o.trainingen).toBe(1)
    expect(o.geenVoortgang).toBe(false)
  })

  it('een meting van vandaag of later, en een training van vandaag, tellen niet (O3: t/m gisteren)', () => {
    const rijen = [groot('a', '2026-10-20'), groot('b', '2026-10-21'), groot('vandaag', VANDAAG)]
    const metingen = [meting('partijen_groot', '2026-10-01', 3), meting('partijen_groot', VANDAAG, 9), meting('partijen_groot', '2026-11-01', 9)]
    const o = onderdeel(pg(rijen, metingen), 'partijen_groot')
    expect(o.huidig).toEqual({ stap: 4 })
    expect(o.punten.some((p) => p.datum >= VANDAAG)).toBe(false)
    expect(o.punten.filter((p) => p.bron === 'meting')).toHaveLength(1)
  })

  it('ook als de weergave voorbij vandaag loopt, tellen vandaag en later nergens mee', () => {
    const rijen = [groot('a', '2026-10-20'), groot('b', '2026-10-21'), groot('c', '2026-10-22'), groot('vandaag', VANDAAG), groot('morgen', '2026-10-28')]
    const metingen = [meting('partijen_groot', '2026-10-01', 3), meting('partijen_groot', VANDAAG, 9)]
    const o = onderdeel(pg(rijen, metingen, { start: '2026-08-01', end: '2026-12-31' }), 'partijen_groot')
    expect(o.huidig).toEqual({ stap: 4 })
    expect(o.punten.map((p) => p.datum)).toEqual(['2026-10-01', '2026-10-20', '2026-10-21', '2026-10-22'])
    expect(o.geenVoortgang).toBe(false)
  })

  it('alleen meetbare onderdelen, in de vaste volgorde van PERIODIZATION_CATEGORIES (AC-A9)', () => {
    const o = pg([], [meting('sprints_veel_rust', '2026-09-01', 2), meting('partijen_groot', '2026-09-01', 2), meting('warming_up', '2026-09-01', 2)])
    expect(o.onderdelen.map((x) => x.key)).toEqual(MEETBARE_CATEGORIES)
    expect(o.onderdelen.map((x) => x.key)).toEqual(PERIODIZATION_CATEGORIES.filter((c) => c.hasMeting).map((c) => c.key))
  })

  it('niet-leesbare koppelingen in VCT-trainingen worden als onbekend geteld, niet stil weggelaten', () => {
    const rijen = [
      groot('a', '2026-09-02', { oefening_leesbaar: false, categorie: null }),
      groot('a', '2026-09-02'),
      groot('t', '2026-09-03', { trainingstype: 'teamtactisch', oefening_leesbaar: false, categorie: null }),
    ]
    const o = pg(rijen, [meting('partijen_groot', '2026-09-01', 3)])
    expect(o.onbekend).toBe(1)
    expect(trainingStappen(onderdeel(o, 'partijen_groot'))).toEqual([3])
  })

  it('afgekapt → geen onderdelen, alleen de vlag', () => {
    const rijen = [groot('a', '2026-09-02', { totaal: 5 })]
    expect(periodiseringVoortgang(rijen, [meting('partijen_groot', '2026-09-01', 3)], SEIZOEN, VANDAAG)).toEqual({
      onderdelen: [], afgekapt: true, onbekend: 0, seizoenNogNietBegonnen: false,
    })
  })

  it('de invoer wordt niet gemuteerd; volgorde van punten op dezelfde datum is deterministisch', () => {
    const rijen = metTotaal([groot('z', '2026-09-02'), groot('a', '2026-09-02')])
    const metingen = [meting('partijen_groot', '2026-09-01', 3)]
    const kopie = structuredClone([rijen, metingen])
    const een = periodiseringVoortgang(rijen, metingen, SEIZOEN, VANDAAG)
    const twee = periodiseringVoortgang([...rijen].reverse(), [...metingen].reverse(), SEIZOEN, VANDAAG)
    expect([rijen, metingen]).toEqual(kopie)
    expect(een).toEqual(twee)
    expect(onderdeel(een, 'partijen_groot').punten.map((p) => p.eventId)).toEqual([null, 'a', 'z'])
  })

  it('ongeldige vandaag of weergave → alles ongemeten, geen crash', () => {
    const o = periodiseringVoortgang([], [meting('partijen_groot', '2026-09-01', 3)], SEIZOEN, 'x')
    expect(o.onderdelen.every((x) => !x.gemeten)).toBe(true)
    expect(o.seizoenNogNietBegonnen).toBe(false)
    const kapot = periodiseringVoortgang([], [meting('partijen_groot', '2026-09-01', 3)], { start: 'x', end: 'y' }, VANDAAG)
    expect(kapot.onderdelen.every((x) => !x.gemeten)).toBe(true)
    expect(kapot.seizoenNogNietBegonnen).toBe(false)
  })
})

// ── Pariteit periodisering ↔ getTrainingLog (planner/dashboard) ───────
// Mock die, anders dan makeSupabase in lib/periodization.test.ts, ook de
// datumfilters (gt/lt) en order uitvoert: zonder die filters zou de pariteit
// niets bewijzen over "strikt ná de meting" en "strikt vóór de training".
function plannerSupabase(tabellen: Record<string, Record<string, unknown>[]>): SupabaseClient {
  function chain(tabel: string) {
    const filters: ((r: Record<string, unknown>) => boolean)[] = []
    let volgorde: string | null = null
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = (k: string, v: unknown) => { filters.push((r) => r[k] === v); return c }
    c.in = (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return c }
    c.gt = (k: string, v: string) => { filters.push((r) => String(r[k]) > v); return c }
    c.lt = (k: string, v: string) => { filters.push((r) => String(r[k]) < v); return c }
    c.order = (k: string) => { volgorde = k; return c }
    ;(c as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
      const rijen = (tabellen[tabel] ?? []).filter((r) => filters.every((f) => f(r)))
      if (volgorde) rijen.sort((a, b) => String(a[volgorde!]).localeCompare(String(b[volgorde!])))
      return resolve({ data: rijen, error: null })
    }
    return c
  }
  return { from: (t: string) => chain(t) } as unknown as SupabaseClient
}

describe('pariteit periodiseringVoortgang ↔ getTrainingLog', () => {
  // Eén meting per onderdeel, verschillende meetdatums; geen overrides (R5).
  const metingen = [
    meting('partijen_groot', '2026-08-03', 3),
    meting('sprints_weinig_rust', '2026-08-10', 5),
    meting('partijen_klein', '2026-07-20', 13), // vóór het seizoen
  ]
  const plan: [string, string, string, OefeningCategorie[]][] = [
    ['t01', '2026-07-25', 'vct', ['partijen_klein']],
    ['t02', '2026-08-03', 'vct', ['partijen_groot', 'partijen_klein']], // op de meetdatum van groot
    ['t03', '2026-08-05', 'vct', ['partijen_groot', 'partijen_groot', 'positiespel']],
    ['t04', '2026-08-05', 'vct', ['partijen_groot']], // zelfde dag
    ['t05', '2026-08-10', 'vct', ['sprints_weinig_rust', 'partijen_groot']],
    ['t06', '2026-08-12', 'teamtactisch', ['partijen_groot', 'sprints_weinig_rust']],
    ['t07', '2026-08-14', 'vct', ['sprints_weinig_rust', 'partijen_klein']],
    ['t08', '2026-08-20', 'vct', ['partijen_groot', 'sprints_weinig_rust', 'partijen_klein']],
    ['t09', '2026-09-01', 'vct', []],
    ['t10', '2026-09-02', 'vct', ['partijen_groot']],
    ['t11', '2026-10-26', 'vct', ['partijen_groot', 'sprints_weinig_rust']], // gisteren
  ]
  const rijen = plan.flatMap(([id, datum, type, cats]) =>
    cats.length === 0
      ? [legeTraining(id, datum, { trainingstype: type })]
      : cats.map((categorie) => kRij(id, datum, { trainingstype: type, categorie })),
  )
  const supabase = plannerSupabase({
    events: plan.map(([id, date, trainingstype]) => ({ id, date, trainingstype, team_id: 'team-1', type: 'training' })),
    training_oefeningen: rijen
      .filter((r) => r.koppeling_id !== null)
      .map((r) => ({ event_id: r.event_id, team_id: 'team-1', stap_override: null, oefeningen: { categorie: r.categorie } })),
  })
  const uitkomst = pg(rijen, metingen, { start: '2026-07-01', end: '2026-10-26' })

  it('elke trainingsstap = getTrainingLog(actueleMetingen(metingen, d), d).currentSteps', async () => {
    let vergeleken = 0
    for (const o of uitkomst.onderdelen.filter((x) => x.gemeten)) {
      for (const p of o.punten.filter((x) => x.bron === 'training')) {
        const log = await getTrainingLog(supabase, 'team-1', actueleMetingen(metingen, p.datum), p.datum)
        expect(p.stap, `${o.key} op ${p.datum}`).toBe(log.currentSteps[o.key])
        expect(p.stap).toBe(berekenStap(actueleMetingen(metingen, p.datum)[o.key].stap, 0) + Math.floor(
          (log.occurrences[o.key] ?? 0) / 2,
        ))
        vergeleken++
      }
    }
    expect(vergeleken).toBeGreaterThanOrEqual(10)
  })

  it('huidig = getTrainingLog(actueleMetingen(metingen, vandaag), vandaag).currentSteps', async () => {
    const log = await getTrainingLog(supabase, 'team-1', actueleMetingen(metingen, VANDAAG), VANDAAG)
    for (const o of uitkomst.onderdelen) {
      expect(o.huidig?.stap ?? null, o.key).toBe(log.currentSteps[o.key])
    }
    expect(onderdeel(uitkomst, 'partijen_groot').huidig).toEqual({ stap: 3 + Math.floor(6 / 2) })
  })
})

// ── telInvulDiscipline ────────────────────────────────────────────────
let dSeq = 0
function dRij(soort: string, extra: Partial<InvulDisciplineRij> = {}): InvulDisciplineRij {
  dSeq++
  return {
    event_id: `e${dSeq}`, soort, datum: '2026-10-10', goals_for: null, goals_against: null, doelstelling: null,
    aantal_ratings: 0, aantal_momenten: 0, aantal_oefeningen: 0, handmatig: false, totaal: 0, ...extra,
  }
}

describe('telInvulDiscipline', () => {
  it('D.1/D.2: uitslag alleen → analyse én uitslag; alleen een rating → analyse, geen uitslag', () => {
    const t = telInvulDiscipline([dRij('match', { goals_for: 2, goals_against: 1 }), dRij('match', { aantal_ratings: 3 })])
    expect(t).toMatchObject({ wedstrijden: 2, metAnalyse: 2, metUitslag: 1 })
  })

  it('een rating plus alleen goals_for: analyse ja, uitslag nee; een moment telt als analyse', () => {
    const t = telInvulDiscipline([dRij('match', { aantal_ratings: 1, goals_for: 2 }), dRij('match', { aantal_momenten: 1 })])
    expect(t).toMatchObject({ wedstrijden: 2, metAnalyse: 2, metUitslag: 0 })
  })

  it('D.3: doelstelling "" met 0 oefeningen = geen plan; " " = wél plan; ≥1 oefening = plan', () => {
    const t = telInvulDiscipline([
      dRij('training', { doelstelling: '' }),
      dRij('training', { doelstelling: ' ' }),
      dRij('training', { aantal_oefeningen: 2 }),
      dRij('training'),
    ])
    expect(t).toMatchObject({ trainingen: 4, metPlan: 2 })
  })

  it('Q4/O4: handmatig zonder auto telt apart en NIET als ingevuld; handmatig met auto telt niet extra', () => {
    const t = telInvulDiscipline([
      dRij('match', { handmatig: true }),
      dRij('match', { handmatig: true, goals_for: 1, goals_against: 1 }),
      dRij('training', { handmatig: true }),
      dRij('training', { handmatig: true, aantal_oefeningen: 1 }),
    ])
    expect(t).toEqual({
      wedstrijden: 2, metAnalyse: 1, metUitslag: 1, analyseHandmatig: 1,
      trainingen: 2, metPlan: 1, planHandmatig: 1, afgekapt: false,
    })
  })

  it('een ander soort (meting) wordt genegeerd; noemer 0 geeft nullen, geen NaN', () => {
    expect(telInvulDiscipline([dRij('meting', { aantal_ratings: 5, handmatig: true })])).toEqual({
      wedstrijden: 0, metAnalyse: 0, metUitslag: 0, analyseHandmatig: 0,
      trainingen: 0, metPlan: 0, planHandmatig: 0, afgekapt: false,
    })
    expect(telInvulDiscipline([]).wedstrijden).toBe(0)
  })

  it('afgekapt bij totaal > aantal rijen of > 900 rijen', () => {
    expect(telInvulDiscipline([dRij('match', { totaal: 4 })]).afgekapt).toBe(true)
    expect(telInvulDiscipline(Array.from({ length: 901 }, () => dRij('match', { totaal: 901 }))).afgekapt).toBe(true)
  })

  it('pariteit: elke rij geeft dezelfde boolean als de dashboardaanroep (analyseBestaat / hasTrainingPlanDone)', () => {
    const wedstrijden = [
      {}, { goals_for: 0, goals_against: 0 }, { goals_for: 1 }, { goals_against: 1 }, { aantal_ratings: 1 },
      { aantal_momenten: 2 }, { goals_for: 3, aantal_momenten: 1 },
    ].map((x) => dRij('match', x))
    for (const rij of wedstrijden) {
      const dashboard = analyseBestaat({
        goals_for: rij.goals_for, goals_against: rij.goals_against, ratingCount: rij.aantal_ratings, eventCount: rij.aantal_momenten,
      })
      expect(telInvulDiscipline([rij]).metAnalyse, JSON.stringify(rij)).toBe(dashboard ? 1 : 0)
    }
    const trainingen = [
      {}, { doelstelling: '' }, { doelstelling: ' ' }, { doelstelling: 'Omschakelen' }, { aantal_oefeningen: 1 },
    ].map((x) => dRij('training', x))
    for (const rij of trainingen) {
      expect(telInvulDiscipline([rij]).metPlan, JSON.stringify(rij)).toBe(
        hasTrainingPlanDone(rij.doelstelling, rij.aantal_oefeningen) ? 1 : 0,
      )
    }
  })

  it('de invoer wordt niet gemuteerd', () => {
    const rijen = [dRij('match', { goals_for: 1, goals_against: 0 }), dRij('training', { handmatig: true })]
    const kopie = structuredClone(rijen)
    telInvulDiscipline(rijen)
    expect(rijen).toEqual(kopie)
  })
})

// ── B1: seizoen nog niet begonnen (brief §9) ──────────────────────────
import { periodiseringOndergrens } from '@/lib/inzichten'

describe('periodiseringVoortgang — seizoen nog niet begonnen (B1)', () => {
  // verledenSeizoensVenster van een seizoen dat op 1 november begint, op 27 oktober.
  const NOG_NIET = { start: '2026-11-01', end: '2026-10-26' }

  it('gemeten onderdeel: nulmeting, huidig (t/m gisteren) en verschil, maar geen punten; vlag waar', () => {
    const rijen = ['02', '03', '04', '05'].map((d) => groot(`v${d}`, `2026-09-${d}`))
    const o = pg(rijen, [meting('partijen_groot', '2026-09-01', 3)], NOG_NIET)
    expect(o.seizoenNogNietBegonnen).toBe(true)
    expect(o.afgekapt).toBe(false)
    const g = onderdeel(o, 'partijen_groot')
    expect(g).toMatchObject({
      gemeten: true,
      nulmeting: { datum: '2026-09-01', stap: 3 },
      huidig: { stap: 5 },
      verschil: 2,
      punten: [],
      trainingen: 0,
      geenVoortgang: false,
    })
  })

  it('één meting zonder trainingen: geenVoortgang; ongemeten onderdelen blijven ongemeten', () => {
    const o = pg([], [meting('partijen_midden', '2026-10-01', 4)], NOG_NIET)
    expect(onderdeel(o, 'partijen_midden')).toMatchObject({ gemeten: true, huidig: { stap: 4 }, verschil: 0, geenVoortgang: true, punten: [] })
    expect(onderdeel(o, 'partijen_groot')).toMatchObject({ gemeten: false, nulmeting: null, huidig: null, verschil: null })
  })

  it('huidig telt een training of meting van vandaag niet mee', () => {
    const rijen = [groot('a', '2026-10-20'), groot('b', '2026-10-21'), groot('vandaag', VANDAAG)]
    const o = pg(rijen, [meting('partijen_groot', '2026-10-01', 3), meting('partijen_groot', VANDAAG, 9)], NOG_NIET)
    expect(onderdeel(o, 'partijen_groot').huidig).toEqual({ stap: 4 })
  })

  it('zonder enige meting: alles ongemeten (de kaart houdt de lege staat), vlag waar', () => {
    const o = pg([groot('a', '2026-09-02')], [], NOG_NIET)
    expect(o.onderdelen.every((x) => !x.gemeten)).toBe(true)
    expect(o.seizoenNogNietBegonnen).toBe(true)
  })

  it('gewoon lopend seizoen: vlag onwaar', () => {
    expect(pg([], [meting('partijen_groot', '2026-09-01', 3)]).seizoenNogNietBegonnen).toBe(false)
  })
})

// ── B2: ondergrens van de periodiseringsbron (brief §9) ───────────────
describe('periodiseringOndergrens (B2)', () => {
  const START = '2026-08-01'

  it('geen bruikbare meting of ongeldige start → null', () => {
    expect(periodiseringOndergrens([], START)).toBeNull()
    expect(periodiseringOndergrens([meting('warming_up', '2026-01-01', 1)], START)).toBeNull()
    expect(periodiseringOndergrens([meting('partijen_groot', '2026-02-30', 1)], START)).toBeNull()
    expect(periodiseringOndergrens([meting('partijen_groot', '2026-01-01', 1)], 'x')).toBeNull()
  })

  it('meerdere metingen vóór de start: de laatste daarvan', () => {
    const m = [meting('partijen_groot', '2025-08-01', 2), meting('partijen_groot', '2026-06-01', 4), meting('partijen_groot', '2026-01-10', 3)]
    expect(periodiseringOndergrens(m, START)).toBe('2026-06-01')
  })

  it('meting precies op de seizoensstart: de meting ervóór (een training op de startdag gebruikt die nog)', () => {
    const m = [meting('partijen_groot', '2025-08-05', 2), meting('partijen_groot', START, 5)]
    expect(periodiseringOndergrens(m, START)).toBe('2025-08-05')
    expect(periodiseringOndergrens([meting('partijen_groot', START, 5)], START)).toBe(START)
  })

  it('onderdeel zonder meting vóór de start begint bij zijn eerste meting; minimum over de onderdelen', () => {
    expect(periodiseringOndergrens([meting('sprints_veel_rust', '2026-09-15', 2), meting('sprints_veel_rust', '2026-09-01', 2)], START)).toBe('2026-09-01')
    const m = [meting('partijen_groot', '2026-06-01', 4), meting('sprints_veel_rust', '2026-09-01', 2), meting('partijen_klein', '2026-07-01', 3)]
    expect(periodiseringOndergrens(m, START)).toBe('2026-06-01')
  })

  it('nooit vóór de vroegste meting; de invoer wordt niet gemuteerd', () => {
    const m = [meting('partijen_klein', '2026-09-20', 2), meting('partijen_groot', '2026-09-10', 3)]
    const kopie = structuredClone(m)
    expect(periodiseringOndergrens(m, START)).toBe('2026-09-10')
    expect(m).toEqual(kopie)
  })
})

describe('pariteit: reconstructie vanaf periodiseringOndergrens = vanaf de vroegste meting (B2)', () => {
  const START = '2026-08-01'
  const WEERGAVE = { start: START, end: '2026-10-26' }
  const metingen = [
    meting('partijen_groot', '2025-08-05', 3),
    meting('partijen_groot', '2026-03-01', 5),
    meting('partijen_groot', START, 6), // precies op de seizoensstart
    meting('sprints_weinig_rust', '2025-09-01', 4),
    meting('sprints_weinig_rust', '2026-05-01', 5),
    meting('sprints_weinig_rust', '2026-09-10', 6),
    meting('partijen_klein', '2026-08-20', 2), // alleen ná de start
  ]
  const plan: [string, string, OefeningCategorie[]][] = [
    ['a01', '2025-08-10', ['partijen_groot']],
    ['a02', '2025-10-01', ['partijen_groot', 'sprints_weinig_rust']],
    ['a03', '2026-01-15', ['sprints_weinig_rust']],
    ['a04', '2026-03-15', ['partijen_groot']],
    ['a05', '2026-04-10', ['partijen_groot', 'sprints_weinig_rust']],
    ['a06', '2026-06-01', ['sprints_weinig_rust', 'partijen_groot']],
    ['a07', '2026-07-20', ['partijen_groot', 'partijen_klein']],
    ['s01', START, ['partijen_groot', 'sprints_weinig_rust']], // op de startdag
    ['s02', '2026-08-05', ['partijen_groot']],
    ['s03', '2026-08-21', ['partijen_klein', 'sprints_weinig_rust']],
    ['s04', '2026-09-10', ['sprints_weinig_rust']],
    ['s05', '2026-09-20', ['partijen_groot', 'partijen_klein', 'sprints_weinig_rust']],
    ['s06', '2026-10-26', ['partijen_groot']],
  ]
  const rijen = plan.flatMap(([id, datum, cats]) => cats.map((categorie) => kRij(id, datum, { categorie })))
  const ondergrens = periodiseringOndergrens(metingen, START)!
  const begrensd = rijen.filter((r) => r.datum >= ondergrens)

  it('de ondergrens knipt echt iets af (anders bewijst de test niets)', () => {
    expect(ondergrens).toBe('2026-03-01')
    expect(begrensd.length).toBeLessThan(rijen.length)
  })

  it('identieke uitkomst met en zonder ondergrens', () => {
    expect(pg(begrensd, metingen, WEERGAVE)).toEqual(pg(rijen, metingen, WEERGAVE))
  })

  it('met de ondergrens blijft elke stap gelijk aan getTrainingLog', async () => {
    const supabase = plannerSupabase({
      events: plan.map(([id, date]) => ({ id, date, trainingstype: 'vct', team_id: 'team-1', type: 'training' })),
      training_oefeningen: rijen.map((r) => ({ event_id: r.event_id, team_id: 'team-1', stap_override: null, oefeningen: { categorie: r.categorie } })),
    })
    const o = pg(begrensd, metingen, WEERGAVE)
    let vergeleken = 0
    for (const ond of o.onderdelen.filter((x) => x.gemeten)) {
      for (const p of ond.punten.filter((x) => x.bron === 'training')) {
        const log = await getTrainingLog(supabase, 'team-1', actueleMetingen(metingen, p.datum), p.datum)
        expect(p.stap, `${ond.key} op ${p.datum}`).toBe(log.currentSteps[ond.key])
        vergeleken++
      }
    }
    expect(vergeleken).toBeGreaterThanOrEqual(8)
    const nu = await getTrainingLog(supabase, 'team-1', actueleMetingen(metingen, VANDAAG), VANDAAG)
    for (const ond of o.onderdelen) expect(ond.huidig?.stap ?? null, ond.key).toBe(nu.currentSteps[ond.key])
  })

  it('een ondergrens "≤ seizoensstart" zou de stap op de startdag breken (waarom strikt vóór)', () => {
    const teKrap = rijen.filter((r) => r.datum >= '2026-05-01') // groot ≤ start = 08-01, sprints = 05-01
    const fout = onderdeel(pg(teKrap, metingen, WEERGAVE), 'partijen_groot').punten.find((p) => p.eventId === 's01')!
    const goed = onderdeel(pg(begrensd, metingen, WEERGAVE), 'partijen_groot').punten.find((p) => p.eventId === 's01')!
    // Meting 1-3 (stap 5) geldt op de startdag; k = a04, a05, a06, a07 = 4.
    expect(goed.stap).toBe(berekenStap(5, 4))
    // Vanaf 1-5 ontbreken a04 en a05: k = 2.
    expect(fout.stap).toBe(berekenStap(5, 2))
  })
})
