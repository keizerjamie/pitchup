import { describe, it, expect } from 'vitest'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { maandLabel, splitsThuisUit, type MaandTrend, type RatingTrend, type WedstrijdUitslagRij } from '@/lib/inzichten'
import { KPI_VOLGORDE, bronMelding, kpiTegels, tekenTekst, type KpiFout } from './kpi-tekst'

const i = nl.insights
const rij = (o: Partial<WedstrijdUitslagRij>): WedstrijdUitslagRij => ({
  event_id: 'e', datum: '2026-09-01', home_away: 'home', goals_for: 1, goals_against: 0, formatie: null, ...o,
})
const GEEN_FOUT: KpiFout = { maandOpkomst: false, aanwezigheid: false, teamRating: false, uitslagen: false }
const PERIODE = 'Heel seizoen'
const opkomst: MaandTrend = { maand: '2026-09', percentage: 82, delta: 3, vorigePercentage: 79 }
const rating: RatingTrend = { gemiddelde: 7.44, delta: 0.2, aantal: 12 }
const totaal = splitsThuisUit([
  rij({ goals_for: 3, goals_against: 0 }),
  rij({ goals_for: 1, goals_against: 1, home_away: 'away' }),
  rij({ goals_for: 0, goals_against: 2 }),
]).totaal

function maak(o: Partial<Parameters<typeof kpiTegels>[0]> = {}, t = nl) {
  return kpiTegels(
    {
      opkomst,
      aanwezigheidPercentage: 88,
      rating,
      saldo: totaal,
      resultaat: totaal,
      uitslagenAfgekapt: false,
      periodeLabel: PERIODE,
      fout: GEEN_FOUT,
      ...o,
    },
    t,
  )
}

describe('kpiTegels: succes', () => {
  it('geeft alle zes tegels in KPI_VOLGORDE met het eigen id', () => {
    const tegels = maak()
    expect(KPI_VOLGORDE).toEqual(['opkomst', 'aanwezigheid', 'rating', 'doelsaldo', 'punten', 'cleansheets'])
    expect(Object.keys(tegels)).toEqual([...KPI_VOLGORDE])
    for (const id of KPI_VOLGORDE) expect(tegels[id].id).toBe(id)
  })

  it('opkomst toont het maandvenster, de rest het periodelabel', () => {
    const tegels = maak()
    expect(tegels.opkomst.venster).toBe(i.kpiVensterLaatsteMaand.replace('{maand}', maandLabel('2026-09', nl.browserLocale)))
    for (const id of ['aanwezigheid', 'rating', 'doelsaldo', 'punten', 'cleansheets'] as const) {
      expect(tegels[id].venster).toBe(PERIODE)
    }
  })

  it('geeft deltatekst bij opkomst en rating, en norm bij aanwezigheid', () => {
    const tegels = maak()
    expect(tegels.opkomst.waarde).toBe('82%')
    expect(tegels.opkomst.detail).toBe(i.kpiDeltaMaand.replace('{delta}', '+3'))
    expect(tegels.rating.waarde).toBe('7.4')
    expect(tegels.rating.detail).toContain('+0.2')
    expect(tegels.aanwezigheid.waarde).toBe('88%')
    expect(tegels.aanwezigheid.detail).toBe(i.kpiOpkomstDoel.replace('{doel}', '85'))
  })

  it('punten met twee decimalen, saldo met plusteken, clean sheets als aantal', () => {
    const tegels = maak()
    expect(tegels.punten.waarde).toBe('1.33')
    expect(tegels.doelsaldo.waarde).toBe('+1')
    expect(tegels.cleansheets.waarde).toBe('1')
    for (const id of KPI_VOLGORDE) expect(tegels[id].melding).toBeUndefined()
  })

  it('volgt de taal van de dict', () => {
    expect(maak({}, en).doelsaldo.label).toBe(en.insights.kpiDoelsaldoLabel)
  })
})

describe('kpiTegels: falen', () => {
  it.each([
    ['maandOpkomst', ['opkomst']],
    ['aanwezigheid', ['aanwezigheid']],
    ['teamRating', ['rating']],
    ['uitslagen', ['doelsaldo', 'punten', 'cleansheets']],
  ] as const)('fout %s geeft alleen bij %j een bronFout-melding', (vlag, ids) => {
    const tegels = maak({ fout: { ...GEEN_FOUT, [vlag]: true } })
    for (const id of KPI_VOLGORDE) {
      expect(tegels[id].melding).toBe(ids.includes(id as never) ? i.bronFout : undefined)
    }
  })

  it('uitslagenAfgekapt zet afgekapt op de drie uitslagtegels', () => {
    const tegels = maak({ uitslagenAfgekapt: true })
    for (const id of ['doelsaldo', 'punten', 'cleansheets'] as const) expect(tegels[id].melding).toBe(i.afgekapt)
    for (const id of ['opkomst', 'aanwezigheid', 'rating'] as const) expect(tegels[id].melding).toBeUndefined()
  })

  it('fout gaat voor afgekapt', () => {
    const tegels = maak({ uitslagenAfgekapt: true, fout: { ...GEEN_FOUT, uitslagen: true } })
    for (const id of ['doelsaldo', 'punten', 'cleansheets'] as const) expect(tegels[id].melding).toBe(i.bronFout)
  })

  it('bronMelding: fout, afgekapt, voorrang en niets', () => {
    expect(bronMelding(nl, true)).toBe(i.bronFout)
    expect(bronMelding(nl, false, true)).toBe(i.afgekapt)
    expect(bronMelding(nl, true, true)).toBe(i.bronFout)
    expect(bronMelding(nl, false)).toBeUndefined()
  })
})

describe('kpiTegels: edge', () => {
  it('null geeft "—" en kpiGeenData, nooit 0', () => {
    const leeg = splitsThuisUit([]).totaal
    const tegels = maak({ opkomst: null, aanwezigheidPercentage: null, rating: null, saldo: leeg, resultaat: leeg })
    for (const id of KPI_VOLGORDE) {
      expect(tegels[id].waarde).toBe('—')
      expect(tegels[id].detail).toBe(id === 'aanwezigheid' ? i.kpiOpkomstDoel.replace('{doel}', '85') : i.kpiGeenData)
    }
    expect(tegels.opkomst.venster).toBe(i.kpiVensterLaatsteMaandLeeg)
  })

  it('resultaat null geeft "—" op punten en clean sheets, ook met saldo.wedstrijden > 0', () => {
    const tegels = maak({ resultaat: null })
    expect(totaal.wedstrijden).toBeGreaterThan(0)
    for (const id of ['punten', 'cleansheets'] as const) {
      expect(tegels[id].waarde).toBe('—')
      expect(tegels[id].detail).toBe(i.kpiGeenData)
    }
    expect(tegels.doelsaldo.waarde).toBe('+1')
  })

  it('delta 0 geeft "0.0" zonder plusteken', () => {
    expect(tekenTekst(0, 1)).toBe('0.0')
    expect(maak({ rating: { gemiddelde: 7, delta: 0, aantal: 12 } }).rating.detail).toContain('0.0')
    expect(maak({ rating: { gemiddelde: 7, delta: 0, aantal: 12 } }).rating.detail).not.toContain('+0')
  })

  it('geen eerdere maand of te weinig wedstrijden: vergelijkingstekst', () => {
    expect(maak({ opkomst: { ...opkomst, delta: null, vorigePercentage: null } }).opkomst.detail).toBe(i.kpiGeenVergelijking)
    expect(maak({ rating: { gemiddelde: 7, delta: null, aantal: 3 } }).rating.detail).toBe(i.kpiRatingDetail.replace('{n}', '3'))
  })

  it('negatief saldo en negatieve delta krijgen een minteken, geen plus', () => {
    const verlies = splitsThuisUit([rij({ goals_for: 0, goals_against: 2 })]).totaal
    const tegels = maak({ saldo: verlies, resultaat: verlies })
    expect(tegels.doelsaldo.waarde).toBe('-2')
    expect(tekenTekst(-3)).toBe('-3')
  })
})
