import { describe, it, expect } from 'vitest'
import { nl, type Dict } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { es } from '@/messages/es'
import { fr } from '@/messages/fr'
import { POSITIONS } from '@/lib/types'
import {
  bepaalSignalen,
  bepaalStijgersDalers,
  dekkingPerPositie,
  maandLabel,
  toMaandOpkomst,
  type RatingVormRij,
  type Signaal,
  type SignaalInvoer,
  type SpelerPositieRij,
  type TeamRatingRij,
} from '@/lib/inzichten'
import { vulSignaalIn } from '@/lib/signaal-tekst'

const TALEN: [string, Dict][] = [['nl', nl], ['en', en], ['de', de], ['es', es], ['fr', fr]]

// Een Dict met één extra sjabloon, zodat het invulmechanisme te toetsen is los
// van welke sleutels er in messages staan.
function metSjabloon(t: Dict, sleutel: string, sjabloon: string): Dict {
  return { ...t, insights: { ...t.insights, [sleutel]: sjabloon } } as Dict
}

const leeg: SignaalInvoer = {
  maanden: [],
  trainingenPerMaand: {},
  aanwezigheidPerSpeler: [],
  teamRating: [],
  saldo: { voor: 0, tegen: 0, saldo: 0, wedstrijden: 0 },
  uitslagenAfgekapt: false,
  stijgersDalers: { stijgers: [], dalers: [], meegeteld: 0 },
  dekking: [],
  posities: [],
  heeftSpelers: false,
  bronFout: {
    maandOpkomst: false, trainingTelling: false, aanwezigheidPerSpeler: false,
    teamRating: false, uitslagen: false, ratingVorm: false, posities: false,
  },
}

const vormRij = (id: string, naam: string, seizoen: number, recent: number): RatingVormRij => ({
  player_id: id, naam, aantal: 8, seizoen_gemiddelde: seizoen, recent_gemiddelde: recent,
})
const posRij = (id: string, position: string, secondary: string[] = []): SpelerPositieRij => ({
  id, name: id, position, secondary_positions: secondary, injured: true,
})
const ratingRijen = (eerst: number, daarna: number): TeamRatingRij[] =>
  [...Array(5).fill(eerst), ...Array(5).fill(daarna)].map((g, i) => ({
    event_id: `e${i}`, datum: `2026-02-${String(i + 1).padStart(2, '0')}`, tegenstander: null, gemiddelde: g, aantal: 11,
  }))
const posities = (rijen: SpelerPositieRij[]) => ({ posities: rijen, dekking: dekkingPerPositie(rijen), heeftSpelers: true })

// Elk signaal dat bepaalSignalen kan maken, met echte waarden uit de functie
// zelf (dus ook in de echte sleutelvolgorde).
function alleSignalen(): Signaal[] {
  const fixtures: SignaalInvoer[] = [
    { ...leeg, aanwezigheidPerSpeler: [{ player_id: 'p1', naam: 'Wim', aanwezig: 1, afwezig: 4 }] },
    {
      ...leeg,
      aanwezigheidPerSpeler: [
        { player_id: 'p1', naam: 'Wim', aanwezig: 1, afwezig: 4 },
        { player_id: 'p2', naam: 'Bas', aanwezig: 1, afwezig: 4 },
      ],
    },
    { ...leeg, maanden: toMaandOpkomst([{ maand: '2026-02', aanwezig: 7, afwezig: 3 }]), trainingenPerMaand: { '2026-02': 3 } },
    {
      ...leeg,
      maanden: toMaandOpkomst([{ maand: '2026-01', aanwezig: 8, afwezig: 2 }, { maand: '2026-02', aanwezig: 6, afwezig: 4 }]),
      trainingenPerMaand: { '2026-02': 3 },
    },
    { ...leeg, maanden: toMaandOpkomst([{ maand: '2026-02', aanwezig: 9, afwezig: 1 }]), trainingenPerMaand: { '2026-02': 3 } },
    { ...leeg, teamRating: ratingRijen(6, 8) },
    { ...leeg, teamRating: ratingRijen(8, 6) },
    { ...leeg, saldo: { voor: 9, tegen: 2, saldo: 7, wedstrijden: 5 } },
    { ...leeg, saldo: { voor: 2, tegen: 9, saldo: -7, wedstrijden: 5 } },
    { ...leeg, stijgersDalers: bepaalStijgersDalers([vormRij('s1', 'Sara', 7.0, 7.5), vormRij('d1', 'Daan', 7.0, 6.5)]) },
    {
      ...leeg,
      stijgersDalers: bepaalStijgersDalers([
        vormRij('s1', 'Sara', 7.0, 7.5), vormRij('s2', 'Stijn', 7.0, 7.4),
        vormRij('d1', 'Daan', 7.0, 6.5), vormRij('d2', 'Dirk', 7.0, 6.6),
      ]),
    },
    { ...leeg, ...posities([posRij('k1', 'Keeper')]) },
    { ...leeg, ...posities([posRij('s1', 'Spits', ['Linksbuiten'])]) },
  ]
  return fixtures.flatMap((f) => bepaalSignalen(f))
}

describe('vulSignaalIn', () => {
  it('dekt elke tekstsleutel van bepaalSignalen (de fixture is volledig)', () => {
    expect(new Set(alleSignalen().map((s) => s.tekstSleutel))).toEqual(new Set([
      'signaalSpelerWegblijver', 'signaalSpelersWegblijvers',
      'signaalOpkomstOnderDoel', 'signaalOpkomstOnderDoelDaling', 'signaalOpkomstBovenDoel',
      'signaalRatingStijging', 'signaalRatingDaling',
      'signaalDoelsaldoPositief', 'signaalDoelsaldoNegatief',
      'signaalSpelerStijger', 'signaalSpelersStijgers', 'signaalSpelerDaler', 'signaalSpelersDalers',
      'signaalPositieZonderFit', 'signaalPositiesZonderFit',
    ]))
  })

  it.each(TALEN)('%s: elke signaalsleutel staat in t.insights en laat geen {placeholder} achter', (_taal, t) => {
    for (const signaal of alleSignalen()) {
      const sjablonen = t.insights as unknown as Record<string, string>
      expect(sjablonen[signaal.tekstSleutel], signaal.tekstSleutel).toEqual(expect.any(String))
      const tekst = vulSignaalIn(t, signaal)
      expect(tekst, signaal.tekstSleutel).not.toMatch(/[{}]/)
    }
  })

  it('een naam met {drempel} erin blijft letterlijk staan (naam is de laatste sleutel)', () => {
    const [signaal] = bepaalSignalen({
      ...leeg,
      aanwezigheidPerSpeler: [{ player_id: 'p1', naam: 'Rare {drempel}{aantal} Naam', aanwezig: 1, afwezig: 4 }],
    })
    expect(vulSignaalIn(nl, signaal)).toContain('Rare {drempel}{aantal} Naam')
  })

  it('ook bij stijger en daler blijft een naam met {venster}/{verschil} letterlijk staan', () => {
    const signalen = bepaalSignalen({
      ...leeg,
      stijgersDalers: bepaalStijgersDalers([vormRij('s1', '{venster}', 7.0, 7.5), vormRij('d1', '{verschil}', 7.0, 6.5)]),
    })
    let t = nl
    for (const s of signalen) t = metSjabloon(t, s.tekstSleutel, '{naam}|{venster}|{verschil}|{aantal}')
    expect(signalen.map((s) => vulSignaalIn(t, s))).toEqual(['{verschil}|5|0.5|1', '{venster}|5|0.5|1'])
  })

  it.each(TALEN)('%s: positie wordt vertaald via t.players.positions', (_taal, t) => {
    const dict = metSjabloon(t, 'testPositie', '<{positie}>')
    for (const positie of POSITIONS) {
      const tekst = vulSignaalIn(dict, { id: 'x', toon: 'letop', tekstSleutel: 'testPositie', waarden: { positie } })
      expect(tekst).toBe(`<${t.players.positions[positie]}>`)
    }
  })

  it('een onbekende positiewaarde valt terug op de kale waarde', () => {
    const dict = metSjabloon(nl, 'testPositie', '<{positie}>')
    expect(vulSignaalIn(dict, { id: 'x', toon: 'letop', tekstSleutel: 'testPositie', waarden: { positie: 'Libero' } }))
      .toBe('<Libero>')
  })

  it('alleen de sleutel `positie` wordt vertaald; maand blijft een maandlabel, de rest blijft kaal', () => {
    const dict = metSjabloon(en, 'testMix', '{naam}|{maand}|{positie}')
    const tekst = vulSignaalIn(dict, {
      id: 'x', toon: 'letop', tekstSleutel: 'testMix',
      waarden: { maand: '2026-02', positie: 'Keeper', naam: 'Keeper' },
    })
    expect(tekst).toBe(`Keeper|${maandLabel('2026-02', en.browserLocale)}|${en.players.positions['Keeper']}`)
  })

  it('het positiesignaal uit bepaalSignalen draagt de kale Position, de vertaling gebeurt hier', () => {
    const [signaal] = bepaalSignalen({ ...leeg, ...posities([posRij('k1', 'Keeper')]) })
    expect(signaal.waarden).toEqual({ positie: 'Keeper' })
    const dict = metSjabloon(de, signaal.tekstSleutel, 'Für {positie}')
    expect(vulSignaalIn(dict, signaal)).toBe(`Für ${de.players.positions['Keeper']}`)
  })
})
