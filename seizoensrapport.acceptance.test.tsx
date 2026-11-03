// Acceptatietests voor het print-only seizoensrapport (/inzichten → afdrukken).
//
// Testmethode: het component wordt rechtstreeks gerenderd met kale props —
// zelfde aanpak als de wedstrijdselectie-PDF (wedstrijdselectie-pdf.acceptance
// .test.tsx). Het rapport is een pure presentatielaag: alle rekenwerk zit in
// lib/inzichten.ts en wordt daar al getoetst.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import {
  OPKOMST_DOEL,
  bepaalSignalen,
  doelsaldo,
  laatsteMaandTrend,
  bepaalTopscorers,
  evaluatiesPerWeek,
  kaartenPerSpeler,
  KWARTIER_BAKKEN,
  splitsThuisUit,
  telPerKwartier,
  telTegendoelpunten,
  verdeelSpeelminuten,
  teamRatingTrend,
  toMaandOpkomst,
  topWorstAanwezigheid,
  topWorstRating,
  type AanwezigheidPerSpelerRij,
  type DoelpuntItem,
  type RatingPerSpelerRij,
  type EvaluatieOverzicht,
  type SpeelminutenRij,
  type SpelerMomentenRij,
  type TeamRatingRij,
  type TrainingEvaluatieRij,
  type WedstrijdUitslagRij,
} from '@/lib/inzichten'
import SeizoensrapportPrint from '@/components/inzichten/SeizoensrapportPrint'

const blokKpis = (blok: HTMLElement) => Array.from(blok.querySelectorAll('[data-rapport-kpi]'))

const uitslag = (o: Partial<WedstrijdUitslagRij>): WedstrijdUitslagRij => ({
  event_id: 'e', datum: '2026-09-01', home_away: 'home', goals_for: 1, goals_against: 0, formatie: null, ...o,
})
const uitslagen: WedstrijdUitslagRij[] = [
  uitslag({ event_id: 'u1', goals_for: 3, goals_against: 0 }),
  uitslag({ event_id: 'u2', goals_for: 1, goals_against: 1, home_away: 'away' }),
  uitslag({ event_id: 'u3', goals_for: 2, goals_against: 1, home_away: 'away' }),
]

const moment = (o: Partial<SpelerMomentenRij>): SpelerMomentenRij => ({
  player_id: 's', naam: 'Speler', gast: false, doelpunten: 0, assists: 0, geel: 0, rood: 0, ...o,
})
const scorers = (n: number) =>
  Array.from({ length: n }, (_, k) => moment({ player_id: `s${k}`, naam: `Scorer ${k + 1}`, doelpunten: 20 - k, assists: k }))

const maanden = toMaandOpkomst([
  { maand: '2026-08', aanwezig: 92, afwezig: 8 }, // 92% — boven de norm
  { maand: '2026-09', aanwezig: 71, afwezig: 29 }, // 71% — onder de norm
])

const teamRating: TeamRatingRij[] = [7.0, 7.2, 7.4].map((g, i) => ({
  event_id: `e${i}`, datum: `2026-09-0${i + 1}`, tegenstander: 'DVC', gemiddelde: g, aantal: 11,
}))

const doelpunten: DoelpuntItem[] = [
  { id: 'm1', date: '2026-09-01', opponent: 'DVC', match_type: 'league', goals_for: 3, goals_against: 1 },
  { id: 'm2', date: '2026-09-08', opponent: 'HBS', match_type: 'league', goals_for: 2, goals_against: 0 },
]

const ratingRijen: RatingPerSpelerRij[] = [
  { player_id: 'p1', naam: 'Anna Appel', gemiddelde: 8.25, aantal: 4 },
  { player_id: 'p2', naam: 'Bram Bakker', gemiddelde: 6.1, aantal: 3 },
]

const aanwezigheidRijen: AanwezigheidPerSpelerRij[] = [
  { player_id: 'p1', naam: 'Anna Appel', aanwezig: 18, afwezig: 2 },
  { player_id: 'p2', naam: 'Bram Bakker', aanwezig: 4, afwezig: 16 },
]

function renderRapport(overrides: Partial<Parameters<typeof SeizoensrapportPrint>[0]> = {}) {
  const props: Parameters<typeof SeizoensrapportPrint>[0] = {
    t: nl,
    teamName: 'VV Berkel JO15-1',
    teamLogoUrl: null,
    venster: { start: '2026-08-01', end: '2026-12-31' },
    periodeLabel: nl.insights.periodeSeizoen,
    opkomst: laatsteMaandTrend(maanden),
    maanden,
    aanwezigheidPercentage: 79,
    rating: teamRatingTrend(teamRating),
    saldo: doelsaldo(doelpunten),
    signalen: bepaalSignalen({
      maanden,
      trainingenPerMaand: { '2026-08': 4, '2026-09': 4 },
      aanwezigheidPerSpeler: aanwezigheidRijen,
      teamRating,
      saldo: doelsaldo(doelpunten),
      uitslagenAfgekapt: false,
      stijgersDalers: { stijgers: [], dalers: [], meegeteld: 0 },
      dekking: [],
      posities: [],
      heeftSpelers: false,
      bronFout: {
        maandOpkomst: false,
        trainingTelling: false,
        aanwezigheidPerSpeler: false,
        teamRating: false,
        uitslagen: false,
        ratingVorm: false,
        posities: false,
      },
    }),
    ratingTopWorst: topWorstRating(ratingRijen),
    aanwezigheidTopWorst: topWorstAanwezigheid(aanwezigheidRijen),
    vormTelling: { win: 3, gelijk: 1, verlies: 1, onbekend: 0 },
    primaryColor: '#0d3d38',
    secondaryColor: '#14b8a6',
    ...overrides,
  }
  const { container } = render(<SeizoensrapportPrint {...props} />)
  return container.querySelector('[data-print-only]') as HTMLElement
}

describe('seizoensrapport — kop en huisstijl', () => {
  it('is een print-only blok en zet beide clubkleuren als CSS-variabele', () => {
    const blok = renderRapport({ primaryColor: '#a1b2c3', secondaryColor: '#4d4dff' })
    expect(blok.className).toContain('hidden')
    expect(blok.className).toContain('print:block')
    const style = blok.getAttribute('style') ?? ''
    expect(style).toContain('--club-primary: #a1b2c3')
    expect(style).toContain('--club-secondary: #4d4dff')
  })

  it('toont teamnaam, rapporttitel, het seizoensbereik en het periodelabel', () => {
    const blok = renderRapport()
    // Teamnaam staat twee keer: in de kop én in de footer. Beide horen er,
    // dus scopen op de kop in plaats van een unieke treffer verwachten.
    const kop = blok.querySelector('.rapport-kop') as HTMLElement
    expect(within(kop).getByText('VV Berkel JO15-1')).toBeInTheDocument()
    expect(within(blok).getByText(nl.insights.rapportTitle)).toBeInTheDocument()
    // Bereik en periodelabel staan samen op één regel.
    expect(blok.textContent).toContain(nl.insights.periodeSeizoen)
    expect(blok.textContent).toMatch(/2026/)
  })

  // Scoped op de kop (.rapport-kop), niet op het hele blok: sinds de
  // voetstrook-uitbreiding staat er altijd een (vast, decoratief)
  // Pitchup-logo in de voet, los van teamLogoUrl — zelfde precedent als de
  // kop-scoping in wedstrijdselectie-pdf.acceptance.test.tsx.
  it('zonder clublogo verschijnt er geen <img> en geen placeholder in de kop', () => {
    const kop = renderRapport({ teamLogoUrl: null }).querySelector('.rapport-kop') as HTMLElement
    expect(kop).not.toBeNull()
    expect(kop.querySelector('img')).toBeNull()
  })

  it('met clublogo staat er een <img> met die src in de kop', () => {
    const kop = renderRapport({ teamLogoUrl: 'https://cdn.example.com/logo.png' }).querySelector('.rapport-kop') as HTMLElement
    expect(kop.querySelector('img')?.getAttribute('src')).toContain('logo.png')
  })

  it('de voetstrook draagt het vaste, decoratieve Pitchup-logo en (indien meegegeven) de generatiedatum', () => {
    const blok = renderRapport({ teamLogoUrl: null, generatedOn: '24 aug 2026' })
    const voet = blok.querySelector('.rapport-voet') as HTMLElement
    const merkLogo = voet.querySelector('img') as HTMLImageElement
    expect(merkLogo.getAttribute('src')).toBe('/logo.png')
    expect(merkLogo.getAttribute('alt')).toBe('')
    expect(merkLogo.getAttribute('aria-hidden')).toBe('true')
    expect(within(voet).getByText('24 aug 2026')).toBeInTheDocument()
  })

  it('zonder generatedOn staat er geen datum-span in de voet (gedrag van vóór de uitbreiding)', () => {
    const blok = renderRapport({ teamLogoUrl: null })
    expect(blok.querySelector('.rapport-voet-datum')).toBeNull()
  })

  it('toont de laatste-5-reeks als W/G/V-badges in dezelfde vaste kleurenfamilie, meest recent eerst', () => {
    const blok = renderRapport({
      vormItems: [
        { id: 'v1', result: 'win' },
        { id: 'v2', result: 'draw' },
        { id: 'v3', result: 'loss' },
        { id: 'v4', result: 'unknown' },
      ],
    })
    const badges = Array.from(blok.querySelectorAll('.rapport-vorm-badge'))
    expect(badges.map((b) => b.textContent)).toEqual([
      nl.home.formLetterWin,
      nl.home.formLetterDraw,
      nl.home.formLetterLoss,
      nl.home.formLetterUnknown,
    ])
    expect(badges[0].className).toContain('rapport-vorm-badge-win')
    expect(badges[1].className).toContain('rapport-vorm-badge-draw')
    expect(badges[2].className).toContain('rapport-vorm-badge-loss')
    expect(badges[3].className).toContain('rapport-vorm-badge-unknown')
  })

  it('zonder vormItems geen badge-rij; de leesbare telregel blijft altijd staan', () => {
    const blok = renderRapport()
    expect(blok.querySelector('.rapport-vorm-badges')).toBeNull()
    expect(blok.textContent).toContain(
      nl.insights.vormSummary.replace('{win}', '3').replace('{gelijk}', '1').replace('{verlies}', '1'),
    )
  })

  it('zonder teamnaam crasht het rapport niet en blijft de titel staan', () => {
    const blok = renderRapport({ teamName: null })
    expect(within(blok).getByText(nl.insights.rapportTitle)).toBeInTheDocument()
  })
})

describe('seizoensrapport — cijfers', () => {
  const kpiIds = (blok: HTMLElement) =>
    Array.from(blok.querySelectorAll('[data-rapport-kpi]')).map((e) => e.getAttribute('data-rapport-kpi'))

  it('toont de zes kerncijfers met hun labels, in de volgorde van het scherm', () => {
    const blok = renderRapport({ resultaten: splitsThuisUit(uitslagen) })
    for (const label of [
      nl.insights.kpiOpkomstLabel,
      nl.insights.kpiAanwezigheidLabel,
      nl.insights.kpiRatingLabel,
      nl.insights.kpiDoelsaldoLabel,
      nl.insights.kpiPuntenLabel,
      nl.insights.kpiCleanSheetsLabel,
    ]) {
      expect(within(blok).getByText(label)).toBeInTheDocument()
    }
    expect(kpiIds(blok)).toEqual(['opkomst', 'aanwezigheid', 'rating', 'doelsaldo', 'punten', 'cleansheets'])
    // Scopen op het cijferblok: 71% staat óók als waarde boven de
    // septemberbalk verderop in het rapport.
    const kpis = within(blok.querySelector('.rapport-kpis') as HTMLElement)
    expect(kpis.getByText('71%')).toBeInTheDocument() // laatste maand
    expect(kpis.getByText('79%')).toBeInTheDocument() // seizoen
    expect(kpis.getByText('7.2')).toBeInTheDocument() // gem. rating
    expect(kpis.getByText('+4')).toBeInTheDocument() // doelsaldo 5-1
    expect(kpis.getByText('2.33')).toBeInTheDocument() // punten per wedstrijd
  })

  it('geen tegel erbij of eraf: precies zes, met en zonder resultaten (nooit >=)', () => {
    expect(blokKpis(renderRapport())).toHaveLength(6)
    expect(blokKpis(renderRapport({ resultaten: splitsThuisUit([]) }))).toHaveLength(6)
  })

  it('elke tegel toont label, venster, waarde en detail als vier <p> in vaste volgorde', () => {
    const blok = renderRapport({ resultaten: splitsThuisUit(uitslagen) })
    const opkomst = blok.querySelector('[data-rapport-kpi="opkomst"]') as HTMLElement
    expect(Array.from(opkomst.querySelectorAll('p')).map((p) => p.className.split(' ')[0])).toEqual([
      'rapport-kpi-label', 'rapport-kpi-venster', 'rapport-kpi-waarde', 'rapport-kpi-detail',
    ])
    expect(opkomst.querySelector('.rapport-kpi-venster')?.textContent).toContain('Sep 2026')
    expect(opkomst.querySelector('.rapport-kpi-detail')?.textContent).toBe(
      nl.insights.kpiDeltaMaand.replace('{delta}', '-21'),
    )
    const punten = blok.querySelector('[data-rapport-kpi="punten"]') as HTMLElement
    expect(punten.querySelector('.rapport-kpi-venster')?.textContent).toBe(nl.insights.periodeSeizoen)
  })

  it('ontbrekende cijfers tonen een streepje, nooit een verzonnen 0', () => {
    const blok = renderRapport({
      opkomst: null, maanden: [], aanwezigheidPercentage: null, rating: null,
      saldo: { voor: 0, tegen: 0, saldo: 0, wedstrijden: 0 },
    })
    // Zonder `resultaten` tonen ook punten en clean sheets "—".
    expect(within(blok.querySelector('.rapport-kpis') as HTMLElement).getAllByText('—')).toHaveLength(6)
    expect(blok.textContent).not.toMatch(/\b0%/)
    expect(blok.querySelector('.rapport-kpis')?.textContent).not.toMatch(/0\.00|\b0\b/)
  })

  it('een negatief doelsaldo houdt zijn minteken en krijgt er geen plus bij', () => {
    const blok = renderRapport({ saldo: { voor: 3, tegen: 9, saldo: -6, wedstrijden: 5 } })
    expect(within(blok).getByText('-6')).toBeInTheDocument()
    expect(blok.textContent).not.toContain('+-6')
  })
})

describe('seizoensrapport — signalen, maandbalken en spelerslijsten', () => {
  it('schrijft elk signaal uit als volledige zin, zonder onvervangen {placeholders}', () => {
    const blok = renderRapport()
    expect(within(blok).getByText(nl.insights.signalenTitle)).toBeInTheDocument()
    expect(blok.textContent).not.toMatch(/\{[a-z]+\}/)
  })

  it('zonder signalen verdwijnt het hele blok, niet alleen de regels', () => {
    const blok = renderRapport({ signalen: [] })
    expect(within(blok).queryByText(nl.insights.signalenTitle)).toBeNull()
  })

  it('elke maand met een percentage krijgt een balk; maanden onder de norm een afwijkende', () => {
    const blok = renderRapport()
    const balken = blok.querySelectorAll('.rapport-bar')
    expect(balken).toHaveLength(2)
    // 92% ligt boven OPKOMST_DOEL, 71% eronder.
    expect(balken[0].className).not.toContain('rapport-bar-onder')
    expect(balken[1].className).toContain('rapport-bar-onder')
    expect((balken[1] as HTMLElement).style.height).toBe('71%')
    expect(OPKOMST_DOEL).toBe(85)
  })

  it('maanden zonder registraties leveren geen balk op (geen verzonnen 0%)', () => {
    const blok = renderRapport({ maanden: toMaandOpkomst([{ maand: '2026-08', aanwezig: 0, afwezig: 0 }]) })
    expect(blok.querySelectorAll('.rapport-bar')).toHaveLength(0)
  })

  it('toont beide spelerslijsten met de nieuwe, neutralere koppen', () => {
    const blok = renderRapport()
    expect(within(blok).getByText(nl.insights.topWorstRatingsTitle)).toBeInTheDocument()
    expect(within(blok).getByText(nl.insights.topWorstAanwezigheidTitle)).toBeInTheDocument()
    // Vier sublijstjes: uitblinkers/aandachtspunten × rating/aanwezigheid.
    expect(within(blok).getAllByText(nl.insights.bestLabel)).toHaveLength(2)
    expect(within(blok).getAllByText(nl.insights.worstLabel)).toHaveLength(2)
    expect(within(blok).getAllByText('Anna Appel').length).toBeGreaterThan(0)
  })

  it('rondt de spelerrating op één decimaal af, net als het scherm', () => {
    const blok = renderRapport()
    // 8.25 → 8.3 (Math.round op één decimaal), nooit 8.25 in het rapport.
    expect(blok.textContent).toContain('8.3')
    expect(blok.textContent).not.toContain('8.25')
  })

  it('lege spelerslijsten renderen helemaal geen sublijst', () => {
    const blok = renderRapport({
      ratingTopWorst: { top: [], worst: [] },
      aanwezigheidTopWorst: { top: [], worst: [] },
    })
    expect(within(blok).queryByText(nl.insights.bestLabel)).toBeNull()
  })

  it('toont de vormtelling als leesbare regel en de footer met het Pitchup-merk', () => {
    const blok = renderRapport()
    expect(within(blok).getByText(nl.insights.vormTitle)).toBeInTheDocument()
    expect(blok.textContent).toContain(
      nl.insights.vormSummary.replace('{win}', '3').replace('{gelijk}', '1').replace('{verlies}', '1'),
    )
    expect(within(blok).getByText(nl.matchSquad.footerGenerated)).toBeInTheDocument()
  })
})

describe('seizoensrapport — Resultaten en Topscorers', () => {
  const sectie = (blok: HTMLElement, titel: string) =>
    within(blok).getByText(titel).closest('.rapport-sectie') as HTMLElement

  it('Resultaten: zeven kolommen, rijen Thuis, Uit en Totaal en de clean-sheetsregel; geen Onbekend', () => {
    const blok = renderRapport({ resultaten: splitsThuisUit(uitslagen) })
    const s = sectie(blok, nl.insights.rapportResultatenTitle)
    expect(s.querySelectorAll('thead th')).toHaveLength(7)
    expect(Array.from(s.querySelectorAll('tbody th')).map((e) => e.textContent)).toEqual([
      nl.insights.thuisLabel, nl.insights.uitLabel, nl.insights.totaalLabel,
    ])
    expect(s.textContent).toContain(nl.insights.cleanSheets.replace('{n}', '1').replace('{totaal}', '3'))
    expect(s.textContent).not.toContain(nl.insights.zonderEigenDoelpunt.replace('{n}', '0').replace('{totaal}', '3'))
  })

  it('Resultaten: de rij Onbekend verschijnt alleen als er onbekende wedstrijden zijn', () => {
    const blok = renderRapport({ resultaten: splitsThuisUit([...uitslagen, uitslag({ event_id: 'u4', home_away: null })]) })
    expect(within(sectie(blok, nl.insights.rapportResultatenTitle)).getByText(nl.insights.onbekendLabel)).toBeInTheDocument()
  })

  it('Resultaten: 0 wedstrijden toont thuisUitEmpty onder de kop, geen tabel', () => {
    const blok = renderRapport({ resultaten: splitsThuisUit([]) })
    const s = sectie(blok, nl.insights.rapportResultatenTitle)
    expect(s.textContent).toContain(nl.insights.thuisUitEmpty)
    expect(s.querySelector('table')).toBeNull()
  })

  it('Resultaten: afgekapt en fout tonen alleen een melding, fout gaat voor afgekapt; geen cijfers', () => {
    const afgekapt = sectie(renderRapport({ resultaten: splitsThuisUit(uitslagen), uitslagenAfgekapt: true }), nl.insights.rapportResultatenTitle)
    expect(afgekapt.textContent).toContain(nl.insights.afgekapt)
    expect(afgekapt.querySelector('table')).toBeNull()
    const stuk = sectie(
      renderRapport({ resultaten: splitsThuisUit(uitslagen), uitslagenAfgekapt: true, fout: { uitslagen: true } }),
      nl.insights.rapportResultatenTitle,
    )
    expect(stuk.textContent).toContain(nl.insights.bronFout)
    expect(stuk.textContent).not.toContain(nl.insights.afgekapt)
    expect(stuk.querySelector('table')).toBeNull()
  })

  it('Topscorers: vier kolommen, gast met label en sortering van bepaalTopscorers', () => {
    const rijen = [
      moment({ player_id: 'a', naam: 'Anna', doelpunten: 2, assists: 1 }),
      moment({ player_id: 'b', naam: 'Gijs', gast: true, doelpunten: 5, assists: 0 }),
    ]
    const blok = renderRapport({ topscorers: bepaalTopscorers(rijen) })
    const s = sectie(blok, nl.insights.rapportTopscorersTitle)
    expect(Array.from(s.querySelectorAll('thead th')).map((e) => e.textContent)).toEqual([
      nl.insights.kolomSpeler, nl.players.statsGoals, nl.players.statsAssists, nl.insights.rapportKolomBetrokken,
    ])
    const rows = Array.from(s.querySelectorAll('tbody tr'))
    expect(rows.map((r) => r.querySelector('th')?.textContent)).toEqual([`Gijs(${nl.insights.gastLabel})`, 'Anna'])
    expect(Array.from(rows[0].querySelectorAll('td')).map((e) => e.textContent)).toEqual(['5', '0', '5'])
    expect(s.querySelector('.rapport-gast')?.textContent).toBe(`(${nl.insights.gastLabel})`)
  })

  it('Topscorers: precies 6 spelers geeft geen Top-regel, 7 geeft 6 rijen plus "Top 6 van 7"', () => {
    const zes = sectie(renderRapport({ topscorers: bepaalTopscorers(scorers(6)) }), nl.insights.rapportTopscorersTitle)
    expect(zes.querySelectorAll('tbody tr')).toHaveLength(6)
    expect(zes.querySelector('.rapport-noot')).toBeNull()
    const zeven = sectie(renderRapport({ topscorers: bepaalTopscorers(scorers(7)) }), nl.insights.rapportTopscorersTitle)
    expect(zeven.querySelectorAll('tbody tr')).toHaveLength(6)
    expect(zeven.textContent).toContain(nl.insights.rapportTopscorersAfgekort.replace('{n}', '6').replace('{totaal}', '7'))
    expect(zeven.textContent).not.toContain('Scorer 7')
  })

  it('Topscorers: 0 doelpunten toont topscorersEmpty; fout toont bronFout', () => {
    const leeg = sectie(renderRapport({ topscorers: bepaalTopscorers([]) }), nl.insights.rapportTopscorersTitle)
    expect(leeg.textContent).toContain(nl.insights.topscorersEmpty)
    expect(leeg.querySelector('table')).toBeNull()
    const stuk = sectie(
      renderRapport({ topscorers: bepaalTopscorers(scorers(3)), fout: { spelerMomenten: true } }),
      nl.insights.rapportTopscorersTitle,
    )
    expect(stuk.textContent).toContain(nl.insights.bronFout)
    expect(stuk.querySelector('table')).toBeNull()
  })

  it('Topscorers: een naam met {drempel} blijft letterlijk staan', () => {
    const blok = renderRapport({ topscorers: bepaalTopscorers([moment({ naam: 'Jan {drempel}', doelpunten: 1 })]) })
    expect(blok.textContent).toContain('Jan {drempel}')
  })

  it('zonder de nieuwe props ontbreken beide secties', () => {
    const blok = renderRapport()
    expect(within(blok).queryByText(nl.insights.rapportResultatenTitle)).toBeNull()
    expect(within(blok).queryByText(nl.insights.rapportTopscorersTitle)).toBeNull()
  })

  it('Resultaten en Topscorers staan naast elkaar vóór de Vorm, en die vóór Opkomst per maand', () => {
    const blok = renderRapport({ resultaten: splitsThuisUit(uitslagen), topscorers: bepaalTopscorers(scorers(2)) })
    const volgorde = Array.from(blok.querySelectorAll('.rapport-sectiekop')).map((e) => e.textContent)
    expect(volgorde.indexOf(nl.insights.rapportResultatenTitle)).toBeLessThan(volgorde.indexOf(nl.insights.vormTitle))
    expect(volgorde.indexOf(nl.insights.rapportTopscorersTitle)).toBe(volgorde.indexOf(nl.insights.rapportResultatenTitle) + 1)
    expect(volgorde.indexOf(nl.insights.vormTitle)).toBeLessThan(volgorde.indexOf(nl.insights.opkomstTitle))
  })
})

describe('seizoensrapport — meldingen bij falende bronnen', () => {
  const sectie = (blok: HTMLElement, titel: string) =>
    within(blok).getByText(titel).closest('.rapport-sectie') as HTMLElement

  it.each([
    ['maandOpkomst', 'opkomst'],
    ['aanwezigheid', 'aanwezigheid'],
    ['teamRating', 'rating'],
  ] as const)('fout %s: alleen die tegel toont bronFout, neutraal, zonder cijfer', (vlag, id) => {
    const blok = renderRapport({ fout: { [vlag]: true } })
    const tegel = blok.querySelector(`[data-rapport-kpi="${id}"]`) as HTMLElement
    expect(tegel.className).toContain('rapport-kpi-neutraal')
    expect(tegel.querySelector('.rapport-melding')?.textContent).toBe(nl.insights.bronFout)
    expect(tegel.querySelector('.rapport-kpi-waarde')).toBeNull()
    expect(blok.querySelectorAll('.rapport-kpis .rapport-melding')).toHaveLength(1)
  })

  it('uitslagen-fout en afgekapt raken precies de drie uitslagtegels; nooit role="alert"', () => {
    const resultaten = splitsThuisUit(uitslagen)
    const stuk = renderRapport({ resultaten, fout: { uitslagen: true } })
    const afgekapt = renderRapport({ resultaten, uitslagenAfgekapt: true })
    for (const [blok, tekst] of [[stuk, nl.insights.bronFout], [afgekapt, nl.insights.afgekapt]] as const) {
      for (const id of ['doelsaldo', 'punten', 'cleansheets']) {
        expect(blok.querySelector(`[data-rapport-kpi="${id}"] .rapport-melding`)?.textContent).toBe(tekst)
      }
      expect(blok.querySelector('.rapport-kpis')?.textContent).not.toContain('+4')
      expect(blok.querySelector('[role="alert"]')).toBeNull()
    }
  })

  it('Opkomst per maand, Ratings per speler en Aanwezigheid per speler: kop blijft, melding in plaats van inhoud', () => {
    const blok = renderRapport({ fout: { maandOpkomst: true, ratingPerSpeler: true, aanwezigheidPerSpeler: true } })
    for (const titel of [nl.insights.opkomstTitle, nl.insights.topWorstRatingsTitle, nl.insights.topWorstAanwezigheidTitle]) {
      expect(sectie(blok, titel).querySelector('.rapport-melding')?.textContent).toBe(nl.insights.bronFout)
    }
    expect(blok.querySelectorAll('.rapport-bar')).toHaveLength(0)
    expect(within(blok).queryByText(nl.insights.bestLabel)).toBeNull()
  })

  it('Vorm met fout: melding, geen telregel met een verzonnen 0', () => {
    const blok = renderRapport({ vormTelling: { win: 0, gelijk: 0, verlies: 0, onbekend: 0 }, fout: { vorm: true } })
    const s = sectie(blok, nl.insights.vormTitle)
    expect(s.querySelector('.rapport-melding')?.textContent).toBe(nl.insights.bronFout)
    expect(s.querySelector('.rapport-vorm')).toBeNull()
    expect(blok.textContent).not.toContain('0 gewonnen')
  })

  it('signalenOnvolledig zonder signalen: blok met alleen de melding; zonder beide: blok weg', () => {
    const alleen = renderRapport({ signalen: [], signalenOnvolledig: true })
    const s = sectie(alleen, nl.insights.signalenTitle)
    expect(s.querySelectorAll('.rapport-signaal')).toHaveLength(0)
    expect(s.querySelector('.rapport-melding')?.textContent).toBe(nl.insights.signalenOnvolledig)
    expect(within(renderRapport({ signalen: [] })).queryByText(nl.insights.signalenTitle)).toBeNull()
  })

  it('signalenOnvolledig met signalen: de melding is geen .rapport-signaal', () => {
    const blok = renderRapport({ signalenOnvolledig: true })
    const s = sectie(blok, nl.insights.signalenTitle)
    expect(s.querySelectorAll('.rapport-melding')).toHaveLength(1)
    expect(Array.from(s.querySelectorAll('.rapport-signaal')).map((e) => e.textContent)).not.toContain(nl.insights.signalenOnvolledig)
  })
})

describe('seizoensrapport — harde DOM-regels en CSS-anker', () => {
  it('geen h2, caption, sr-only, data-kpi of data-conclusielaag in het rapport', () => {
    const blok = renderRapport({
      resultaten: splitsThuisUit(uitslagen),
      topscorers: bepaalTopscorers(scorers(3)),
      fout: { vorm: true },
    })
    expect(blok.querySelector('h2')).toBeNull()
    expect(blok.querySelector('caption')).toBeNull()
    expect(blok.querySelector('.sr-only')).toBeNull()
    expect(blok.querySelector('[data-kpi]')).toBeNull()
    expect(blok.querySelector('[data-conclusielaag]')).toBeNull()
  })

  it('CSS-anker: .rapport-kpis is een raster van 3 kolommen (geen lay-outbewijs, wel een regressieanker)', () => {
    const css = readFileSync(join(__dirname, 'app/globals.css'), 'utf8')
    expect(css).toMatch(/\.rapport-kpis\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/)
  })

  it('CSS-anker: in de spelerlijsten mag de naam krimpen en afbreken, de waarde krimpt niet (lange namen zonder spaties)', () => {
    const css = readFileSync(join(__dirname, 'app/globals.css'), 'utf8')
    expect(css).toMatch(/\.rapport-lijst-rij\s*>\s*:first-child\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/\.rapport-lijst-waarde\s*\{[^}]*flex-shrink:\s*0/)
  })

  it('CSS-anker: .rapport met .rapport-kpis krijgt een kleine rechtermarge (rand van kolom 3 niet op de kniplijn); alleen via :has, dus niet voor andere rapporten', () => {
    const css = readFileSync(join(__dirname, 'app/globals.css'), 'utf8')
    expect(css).toMatch(/\.rapport:has\(\.rapport-kpis\)\s*\{\s*padding-right:\s*0\.5mm;\s*\}/)
    // geen ongeconditioneerde padding op .rapport zelf
    expect(css).not.toMatch(/\.rapport\s*\{[^}]*padding-right/)
  })

  it('de tegellabels krijgen geen nowrap of ellipsis', () => {
    const css = readFileSync(join(__dirname, 'app/globals.css'), 'utf8')
    for (const klasse of ['rapport-kpi', 'rapport-kpi-label']) {
      const regel = css.match(new RegExp(`\\.${klasse}\\s*\\{[^}]*\\}`))?.[0] ?? ''
      expect(regel).not.toMatch(/nowrap|ellipsis/)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Uitbreiding: Speelminuten, Kaarten, Kwartieroverzicht, Doelstelling behaald
// Bron: ff-inzichten-metrics/rapport-uitbreiding/02-user-story.md (AC1..AC30)
// en 03-technische-brief.md (X1..X12). Dit bestand dekt AC1-AC18, AC22 (CSS-
// anker), AC26, AC27, AC29. AC20 (PDF) is een meting buiten vitest
// (Chromium, A4): 12 van 14 dataset-taalcombinaties zijn <= 2 pagina's; D-de en
// E-fr zijn 3 A4 en door Jamie geaccepteerd (U6). Hier alleen de CSS-ankers
// (AC21 niet toegepast, AC22). AC19, AC23-AC25, AC28 en AC30: andere bestanden.
// ═══════════════════════════════════════════════════════════════════════
const INS = nl.insights
const VENSTER = { start: '2026-08-01', end: '2026-12-31' }
const sectieBy = (blok: HTMLElement, titel: string) =>
  Array.from(blok.querySelectorAll('.rapport-sectie')).find(
    (e) => e.querySelector(':scope > .rapport-sectiekop')?.textContent === titel,
  ) as HTMLElement | undefined
const kopjes = (blok: HTMLElement) =>
  Array.from(blok.querySelectorAll('.rapport-sectiekop')).map((e) => e.textContent)
const NIEUWE_TITELS = [INS.rapportSpeelminutenTitle, INS.rapportKaartenTitle, INS.rapportKwartierTitle, INS.rapportOordeelTitle]
const ALLE_NIEUWE_VLAGGEN = { doelpuntMinuten: true, tegendoelpunten: true, speelminuten: true, spelerMomenten: true, evaluaties: true }

const smRij = (o: Partial<SpeelminutenRij>): SpeelminutenRij => ({
  player_id: 'p', naam: 'Speler', gast: false, wedstrijden: 3, minuten: 200, wissels: 1, noemer: 10, ...o,
})
const evRij = (i: number, oordeel: TrainingEvaluatieRij['oordeel'], doelstelling: string | null = 'Opbouwen'): TrainingEvaluatieRij => ({
  event_id: `ev${i}`, datum: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, doelstelling, rpe: null, oordeel, totaal: 0,
})
const evOverzicht = (rijen: TrainingEvaluatieRij[], o: Partial<EvaluatieOverzicht> = {}): EvaluatieOverzicht => ({
  ...evaluatiesPerWeek(rijen, [], VENSTER), ...o,
})
const voorRijen = [{ minuut: 5, aantal: 4 }, { minuut: 20, aantal: 2 }, { minuut: 50, aantal: 8 }, { minuut: 95, aantal: 1 }, { minuut: null, aantal: 3 }]
const tegenRijen = [
  { minuut: 5, soort: 'open_play' as const, aantal: 1 },
  { minuut: 5, soort: 'set_piece' as const, aantal: 1 },
  { minuut: 50, soort: 'open_play' as const, aantal: 4 },
  { minuut: null, soort: 'open_play' as const, aantal: 2 },
]
const volleProps = () => ({
  kwartieren: telPerKwartier(voorRijen),
  tegenKwartieren: telTegendoelpunten(tegenRijen),
  speelminuten: verdeelSpeelminuten([
    smRij({ player_id: 'a', naam: 'Anna', minuten: 300, wedstrijden: 5 }),
    smRij({ player_id: 'b', naam: 'Bram', minuten: 200, wedstrijden: 4 }),
  ]),
  kaarten: kaartenPerSpeler([moment({ player_id: 'k', naam: 'Kees', geel: 2, rood: 1 })]),
  evaluaties: evOverzicht([evRij(1, 'ja'), evRij(2, 'ja'), evRij(3, 'deels'), evRij(4, 'nee'), evRij(5, null)]),
})
const cellen = (tr: Element) => Array.from(tr.querySelectorAll('th, td')).map((c) => c.textContent)

describe('seizoensrapport uitbreiding — AC1 / AC18 kwartierblok', () => {
  it('AC1: 7 bak-labels in de volgorde van KWARTIER_BAKKEN; waarden per reeks = perBak (tegen = set_piece + open_play); geen soort-tekst', () => {
    const p = volleProps()
    const blok = renderRapport(p)
    const sec = sectieBy(blok, INS.rapportKwartierTitle)!
    expect(Array.from(sec.querySelectorAll('.rapport-kwartier-labels .rapport-bar-label')).map((e) => e.textContent)).toEqual([...KWARTIER_BAKKEN])
    const kolommen = Array.from(sec.querySelectorAll('.rapport-kwartier-labels > .rapport-kwartier-kolom'))
    expect(kolommen).toHaveLength(7)
    kolommen.forEach((k, i) => {
      const bak = KWARTIER_BAKKEN[i]
      const [voor, tegen] = Array.from(k.querySelectorAll('.rapport-kwartier-waarde')).map((e) => e.textContent)
      expect(voor).toBe(String(p.kwartieren.perBak[bak]))
      expect(tegen).toBe(String(p.tegenKwartieren.perBak[bak].set_piece + p.tegenKwartieren.perBak[bak].open_play))
    })
    expect(sec.textContent).not.toMatch(/standaardsituatie|open spel|set.?piece|open.?play/i)
    expect(sec.textContent).not.toContain(nl.analysis.tegendoelpuntSoorten.set_piece)
  })

  it('AC1 / X6: hoogste bak = 100%, een halve bak = 50%, een bak met 0 heeft geen balk maar wel het getal 0; één gedeelde schaal over beide reeksen', () => {
    const blok = renderRapport({
      kwartieren: telPerKwartier([{ minuut: 5, aantal: 8 }, { minuut: 50, aantal: 4 }]),
      tegenKwartieren: telTegendoelpunten([{ minuut: 20, soort: 'open_play', aantal: 2 }]),
    })
    const sec = sectieBy(blok, INS.rapportKwartierTitle)!
    const kolom = (i: number) => sec.querySelectorAll('.rapport-kwartier-bars > .rapport-kwartier-kolom')[i]
    const voor = (i: number) => kolom(i).querySelector('.rapport-kwartier-bar-voor') as HTMLElement | null
    const tegen = (i: number) => kolom(i).querySelector('.rapport-kwartier-bar-tegen') as HTMLElement | null
    expect(voor(0)!.style.height).toBe('100%')
    expect(voor(3)!.style.height).toBe('50%')
    expect(tegen(1)!.style.height).toBe('25%')
    expect(voor(2)).toBeNull()
    expect(tegen(0)).toBeNull()
    const labels = sec.querySelectorAll('.rapport-kwartier-labels > .rapport-kwartier-kolom')[2]
    expect(Array.from(labels.querySelectorAll('.rapport-kwartier-waarde')).map((e) => e.textContent)).toEqual(['0', '0'])
    expect(sec.querySelectorAll('.rapport-kwartier-bar').length).toBe(3)
  })

  it('AC18: dekkingsregel per reeks met x = metMinuut en y = totaal; doelpunten zonder minuut staan in geen bak', () => {
    const p = volleProps()
    const blok = renderRapport(p)
    const sec = sectieBy(blok, INS.rapportKwartierTitle)!
    const tekst = sec.textContent ?? ''
    expect(tekst).toContain(INS.kwartierDekking.replace('{x}', '15').replace('{y}', '18'))
    expect(tekst).toContain(INS.tegenDekking.replace('{x}', '6').replace('{y}', '8'))
    const somVoor = Array.from(sec.querySelectorAll('.rapport-kwartier-labels > .rapport-kwartier-kolom'))
      .reduce((n, k) => n + Number(k.querySelectorAll('.rapport-kwartier-waarde')[0].textContent), 0)
    expect(somVoor).toBe(15)
  })

  it('AC1 (legenda): de regel per reeks heeft label Voor / Tegen, in die volgorde', () => {
    const sec = sectieBy(renderRapport(volleProps()), INS.rapportKwartierTitle)!
    expect(Array.from(sec.querySelectorAll('.rapport-kwartier-reeks')).map((e) => e.textContent)).toEqual([INS.rapportKwartierVoor, INS.rapportKwartierTegen])
  })
})

describe('seizoensrapport uitbreiding — AC2 speelminuten', () => {
  it('AC2: kopteksten exact [kolomSpeler, kolomMinutenTotaal, kolomWedstrijdenMetMinuten]; rijen [naam, minuten, wedstrijden] in de volgorde van verdeelSpeelminuten', () => {
    const rijen = [
      smRij({ player_id: 'a', naam: 'Anna', minuten: 100, wedstrijden: 2 }),
      smRij({ player_id: 'b', naam: 'Bram', minuten: 500, wedstrijden: 7 }),
      smRij({ player_id: 'c', naam: 'Cees', minuten: 300, wedstrijden: 4 }),
    ]
    const verdeling = verdeelSpeelminuten(rijen)
    const sec = sectieBy(renderRapport({ speelminuten: verdeling }), INS.rapportSpeelminutenTitle)!
    expect(cellen(sec.querySelector('thead tr')!)).toEqual([INS.kolomSpeler, INS.kolomMinutenTotaal, INS.kolomWedstrijdenMetMinuten])
    const body = Array.from(sec.querySelectorAll('tbody tr')).map(cellen)
    expect(body).toEqual([['Bram', '500', '7'], ['Cees', '300', '4'], ['Anna', '100', '2']])
    expect(body.map((r) => r[0])).toEqual(verdeling.regels.map((r) => r.naam))
  })
})

describe('seizoensrapport uitbreiding — AC3 kaarten', () => {
  it('AC3: lijstrijen = naam + kaartenWaarde; volgorde totaal, dan rood, dan naam; alleen spelers met een kaart; alleen rood = "0 geel · 1 rood"', () => {
    const kaarten = kaartenPerSpeler([
      moment({ player_id: '1', naam: 'Zoe', geel: 1, rood: 1 }),
      moment({ player_id: '2', naam: 'Aad', geel: 2, rood: 0 }),
      moment({ player_id: '3', naam: 'Bo', geel: 0, rood: 2 }),
      moment({ player_id: '4', naam: 'Cor', geel: 0, rood: 1 }),
      moment({ player_id: '5', naam: 'Geenkaart', doelpunten: 9 }),
    ])
    const sec = sectieBy(renderRapport({ kaarten }), INS.rapportKaartenTitle)!
    const rijen = Array.from(sec.querySelectorAll('.rapport-lijst-rij')).map((r) => Array.from(r.children).map((c) => c.textContent))
    expect(rijen).toEqual([
      ['Bo', '0 geel · 2 rood'],
      ['Zoe', '1 geel · 1 rood'],
      ['Aad', '2 geel · 0 rood'],
      ['Cor', '0 geel · 1 rood'],
    ])
    expect(sec.textContent).not.toContain('Geenkaart')
  })
})

describe('seizoensrapport uitbreiding — AC4 doelstelling', () => {
  it('AC4: vier labels + waarden uit totaal + rapportOordeelNoot; geen weektabel, geen weekLabel', () => {
    const ev = evOverzicht([evRij(1, 'ja'), evRij(2, 'ja'), evRij(3, 'deels'), evRij(4, 'nee'), evRij(5, null)])
    const sec = sectieBy(renderRapport({ evaluaties: ev }), INS.rapportOordeelTitle)!
    const vakjes = Array.from(sec.querySelectorAll('.rapport-oordeel > div')).map((d) => Array.from(d.querySelectorAll('p')).map((p) => p.textContent))
    expect(vakjes).toEqual([
      [INS.kolomJa, '2'], [INS.kolomDeels, '1'], [INS.kolomNee, '1'], [INS.kolomZonderOordeel, '1'],
    ])
    expect(ev.totaal.ja).toBe(2)
    expect(sec.textContent).toContain(INS.rapportOordeelNoot)
    expect(sec.querySelector('table')).toBeNull()
    expect(sec.textContent).not.toMatch(/\bwk \d/)
    expect(sec.textContent).not.toContain(INS.deelweekLabel)
  })
})

describe('seizoensrapport uitbreiding — AC5 titels', () => {
  it('AC5: de vier titels zijn p.rapport-sectiekop; de vier verboden schermtitels komen niet voor', () => {
    const blok = renderRapport(volleProps())
    for (const titel of NIEUWE_TITELS) {
      const el = Array.from(blok.querySelectorAll('.rapport-sectiekop')).find((e) => e.textContent === titel)
      expect(el, titel).toBeDefined()
      expect(el!.tagName).toBe('P')
    }
    for (const verboden of ['Thuis en uit', 'Gele en rode kaarten', 'Eigen doelpunten per kwartier', 'Tegendoelpunten per kwartier']) {
      expect(blok.textContent).not.toContain(verboden)
    }
  })
})

describe('seizoensrapport uitbreiding — AC6 / AC7 / AC16 rijlimiet, afkapregel en gasten', () => {
  const spelers = (n: number, o: (i: number) => Partial<SpeelminutenRij> = () => ({})) =>
    Array.from({ length: n }, (_, i) => smRij({ player_id: `s${i}`, naam: `Sp${i + 1}`, minuten: 1000 - i * 10, wedstrijden: 5, ...o(i) }))
  const kaartSpelers = (n: number, o: (i: number) => Partial<SpelerMomentenRij> = () => ({})) =>
    Array.from({ length: n }, (_, i) => moment({ player_id: `k${i}`, naam: `Kp${i + 1}`, geel: 20 - i, ...o(i) }))

  it('AC6: 6 regels geeft 6 rijen en geen afkapregel; 7 geeft 6 rijen plus "Top 6 van 7 spelers" (speelminuten)', () => {
    const zes = sectieBy(renderRapport({ speelminuten: verdeelSpeelminuten(spelers(6)) }), INS.rapportSpeelminutenTitle)!
    expect(zes.querySelectorAll('tbody tr')).toHaveLength(6)
    expect(zes.querySelector('.rapport-noot')).toBeNull()
    const zeven = sectieBy(renderRapport({ speelminuten: verdeelSpeelminuten(spelers(7)) }), INS.rapportSpeelminutenTitle)!
    expect(zeven.querySelectorAll('tbody tr')).toHaveLength(6)
    expect(zeven.textContent).toContain(INS.rapportTopscorersAfgekort.replace('{n}', '6').replace('{totaal}', '7'))
    expect(zeven.textContent).toContain('Top 6 van 7 spelers')
    expect(zeven.textContent).not.toContain('Sp7')
  })

  it('AC6 / AC7: hetzelfde voor kaarten, los van speelminuten', () => {
    const zes = sectieBy(renderRapport({ kaarten: kaartenPerSpeler(kaartSpelers(6)) }), INS.rapportKaartenTitle)!
    expect(zes.querySelectorAll('.rapport-lijst-rij')).toHaveLength(6)
    expect(zes.querySelector('.rapport-noot')).toBeNull()
    const twaalf = sectieBy(renderRapport({ kaarten: kaartenPerSpeler(kaartSpelers(12)) }), INS.rapportKaartenTitle)!
    expect(twaalf.querySelectorAll('.rapport-lijst-rij')).toHaveLength(6)
    expect(twaalf.textContent).toContain('Top 6 van 12 spelers')
    expect(twaalf.textContent).toContain('Kp6')
    expect(twaalf.textContent).not.toContain('Kp7')
  })

  it('AC16: een gast op positie 6 staat erin met .rapport-gast "(gast)"; een gast op positie 7 niet; inactieve spelers krijgen geen label', () => {
    const sm = sectieBy(renderRapport({ speelminuten: verdeelSpeelminuten(spelers(8, (i) => ({ gast: i === 5 || i === 6 }))) }), INS.rapportSpeelminutenTitle)!
    const gasten = Array.from(sm.querySelectorAll('.rapport-gast'))
    expect(gasten).toHaveLength(1)
    expect(gasten[0].textContent).toBe(`(${INS.gastLabel})`)
    expect(gasten[0].closest('tr')!.textContent).toContain('Sp6')
    const kt = sectieBy(renderRapport({ kaarten: kaartenPerSpeler(kaartSpelers(8, (i) => ({ gast: i === 5 || i === 6 }))) }), INS.rapportKaartenTitle)!
    expect(kt.querySelectorAll('.rapport-gast')).toHaveLength(1)
    expect(kt.querySelector('.rapport-gast')!.closest('.rapport-lijst-rij')!.textContent).toContain('Kp6')
    const zonder = sectieBy(renderRapport({ speelminuten: verdeelSpeelminuten(spelers(3)) }), INS.rapportSpeelminutenTitle)!
    expect(zonder.querySelector('.rapport-gast')).toBeNull()
  })

  it('AC6: een naam met {drempel} blijft letterlijk staan', () => {
    const sec = sectieBy(renderRapport({ speelminuten: verdeelSpeelminuten([smRij({ naam: 'Jan {drempel} {n}' })]) }), INS.rapportSpeelminutenTitle)!
    expect(sec.textContent).toContain('Jan {drempel} {n}')
  })
})

describe('seizoensrapport uitbreiding — AC8 afgekapte bron', () => {
  it('AC8: afgekaptEvaluaties toont afkapmelding, geen totalen en geen "0"-vakjes', () => {
    const ev = evOverzicht([evRij(1, 'ja')], { afgekaptEvaluaties: true })
    const sec = sectieBy(renderRapport({ evaluaties: ev }), INS.rapportOordeelTitle)!
    expect(rapportMeldingen(sec)).toEqual([INS.afgekaptTraining])
    expect(sec.querySelector('.rapport-oordeel')).toBeNull()
    expect(sec.textContent).not.toMatch(/\b0\b/)
  })
  it('AC8: alleen afgekaptDuur toont de totalen wel (de duurbron raakt de oordelen niet)', () => {
    const ev = evOverzicht([evRij(1, 'ja'), evRij(2, 'nee')], { afgekaptDuur: true })
    const sec = sectieBy(renderRapport({ evaluaties: ev }), INS.rapportOordeelTitle)!
    expect(sec.querySelector('.rapport-oordeel')).not.toBeNull()
    expect(sec.querySelector('.rapport-melding')).toBeNull()
  })
  it('AC8: de andere secties tonen nooit een afkapmelding', () => {
    const blok = renderRapport({ ...volleProps(), evaluaties: evOverzicht([evRij(1, 'ja')], { afgekaptEvaluaties: true }) })
    for (const t of [INS.rapportSpeelminutenTitle, INS.rapportKaartenTitle, INS.rapportKwartierTitle]) {
      expect(sectieBy(blok, t)!.textContent).not.toContain(INS.afgekaptTraining)
    }
  })
})

const rapportMeldingen = (el: Element | undefined) => Array.from(el?.querySelectorAll('.rapport-melding') ?? []).map((e) => e.textContent)

describe('seizoensrapport uitbreiding — AC9 / AC10 / AC11 faalpaden', () => {
  const sectiePerVlag: [string, string][] = [
    ['speelminuten', INS.rapportSpeelminutenTitle],
    ['spelerMomenten', INS.rapportKaartenTitle],
    ['evaluaties', INS.rapportOordeelTitle],
  ]
  it.each(sectiePerVlag)('AC9: vlag %s zet alleen de eigen sectie op bronFout; kop blijft; de andere secties zijn ongewijzigd', (vlag, titel) => {
    const gezond = renderRapport(volleProps())
    const stuk = renderRapport({ ...volleProps(), fout: { [vlag]: true } })
    expect(rapportMeldingen(sectieBy(stuk, titel))).toEqual([INS.bronFout])
    for (const t of NIEUWE_TITELS.filter((x) => x !== titel)) {
      expect(sectieBy(stuk, t)!.outerHTML).toBe(sectieBy(gezond, t)!.outerHTML)
    }
  })
  it('AC9: een vlag kan ook alleen één sectie raken als de rest van het rapport hetzelfde blijft (spelerMomenten raakt Kaarten, niet Speelminuten)', () => {
    const stuk = renderRapport({ ...volleProps(), fout: { spelerMomenten: true } })
    expect(sectieBy(stuk, INS.rapportSpeelminutenTitle)!.querySelector('.rapport-melding')).toBeNull()
  })
  it('AC9: fout gaat voor afgekapt en voor leeg', () => {
    const a = sectieBy(renderRapport({ evaluaties: evOverzicht([evRij(1, 'ja')], { afgekaptEvaluaties: true }), fout: { evaluaties: true } }), INS.rapportOordeelTitle)!
    expect(rapportMeldingen(a)).toEqual([INS.bronFout])
    const b = sectieBy(renderRapport({ speelminuten: verdeelSpeelminuten([]), fout: { speelminuten: true } }), INS.rapportSpeelminutenTitle)!
    expect(rapportMeldingen(b)).toEqual([INS.bronFout])
    expect(b.textContent).not.toContain(INS.speelminutenEmpty)
    const c = sectieBy(renderRapport({ kaarten: [], fout: { spelerMomenten: true } }), INS.rapportKaartenTitle)!
    expect(rapportMeldingen(c)).toEqual([INS.bronFout])
  })
  it('AC10 / U9: alleen doelpuntMinuten stuk → tegenbalken, geen voorbalk, meldregel met label Voor; de andere secties zijn byte-gelijk', () => {
    const gezond = renderRapport(volleProps())
    const stuk0 = renderRapport({ ...volleProps(), fout: { doelpuntMinuten: true } })
    for (const t of [INS.rapportSpeelminutenTitle, INS.rapportKaartenTitle, INS.rapportOordeelTitle]) {
      expect(sectieBy(stuk0, t)!.outerHTML).toBe(sectieBy(gezond, t)!.outerHTML)
    }
    const sec = sectieBy(renderRapport({ ...volleProps(), fout: { doelpuntMinuten: true } }), INS.rapportKwartierTitle)!
    expect(sec.querySelectorAll('.rapport-kwartier-bar-tegen').length).toBeGreaterThan(0)
    expect(sec.querySelector('.rapport-kwartier-bar-voor')).toBeNull()
    const regel = Array.from(sec.querySelectorAll('.rapport-kwartier-regel')).find((r) => r.textContent?.includes(INS.rapportKwartierVoor))!
    expect(regel.querySelector('.rapport-melding')!.textContent).toBe(INS.bronFout)
    expect(rapportMeldingen(sec)).toEqual([INS.bronFout])
  })
  it('AC10 / U9: alleen tegendoelpunten stuk → voorbalken, geen tegenbalk, meldregel met label Tegen; de andere secties zijn byte-gelijk', () => {
    const gezond = renderRapport(volleProps())
    const stuk0 = renderRapport({ ...volleProps(), fout: { tegendoelpunten: true } })
    for (const t of [INS.rapportSpeelminutenTitle, INS.rapportKaartenTitle, INS.rapportOordeelTitle]) {
      expect(sectieBy(stuk0, t)!.outerHTML).toBe(sectieBy(gezond, t)!.outerHTML)
    }
    const sec = sectieBy(renderRapport({ ...volleProps(), fout: { tegendoelpunten: true } }), INS.rapportKwartierTitle)!
    expect(sec.querySelectorAll('.rapport-kwartier-bar-voor').length).toBeGreaterThan(0)
    expect(sec.querySelector('.rapport-kwartier-bar-tegen')).toBeNull()
    const regel = Array.from(sec.querySelectorAll('.rapport-kwartier-regel')).find((r) => r.textContent?.includes(INS.rapportKwartierTegen))!
    expect(regel.querySelector('.rapport-melding')!.textContent).toBe(INS.bronFout)
  })
  it('AC11: alle nieuwe vlaggen aan → elke nieuwe sectie heeft een melding, 0 kwartierbalken, en geen kop zonder melding of inhoud', () => {
    const blok = renderRapport({ ...volleProps(), fout: ALLE_NIEUWE_VLAGGEN })
    for (const t of NIEUWE_TITELS) expect(rapportMeldingen(sectieBy(blok, t)).length, t).toBeGreaterThan(0)
    expect(rapportMeldingen(sectieBy(blok, INS.rapportKwartierTitle))).toEqual([INS.bronFout, INS.bronFout])
    expect(blok.querySelectorAll('.rapport-kwartier-bar')).toHaveLength(0)
    for (const sec of Array.from(blok.querySelectorAll('.rapport-sectie'))) {
      expect(sec.querySelectorAll(':scope > :not(.rapport-sectiekop)').length, sec.textContent ?? '').toBeGreaterThan(0)
    }
  })
})

describe('seizoensrapport uitbreiding — AC12 t/m AC15 lege staten', () => {
  it('AC12: voor met metMinuut 0 → kwartierEmpty en geen voorbalk', () => {
    const sec = sectieBy(renderRapport({ kwartieren: telPerKwartier([{ minuut: null, aantal: 3 }]) }), INS.rapportKwartierTitle)!
    expect(sec.textContent).toContain(INS.kwartierEmpty)
    expect(sec.querySelector('.rapport-kwartier-bars')).toBeNull()
  })
  it('AC12: tegen met totaal 0 → tegenEmpty', () => {
    const sec = sectieBy(renderRapport({ tegenKwartieren: telTegendoelpunten([]) }), INS.rapportKwartierTitle)!
    expect(sec.textContent).toContain(INS.tegenEmpty)
    expect(sec.querySelector('.rapport-kwartier-bars')).toBeNull()
  })
  it('AC12 / X4 (V1): tegen met totaal 3 maar metMinuut 0 → "0 van 3 tegendoelpunten met minuut", geen balk en niet tegenEmpty', () => {
    const sec = sectieBy(renderRapport({ tegenKwartieren: telTegendoelpunten([{ minuut: null, soort: 'open_play', aantal: 3 }]) }), INS.rapportKwartierTitle)!
    expect(sec.textContent).toContain(INS.tegenDekking.replace('{x}', '0').replace('{y}', '3'))
    expect(sec.textContent).not.toContain(INS.tegenEmpty)
    expect(sec.querySelector('.rapport-kwartier-bar')).toBeNull()
  })
  it('AC12: beide reeksen niet getekend → geen .rapport-kwartier-bars', () => {
    const sec = sectieBy(renderRapport({ kwartieren: telPerKwartier([]), tegenKwartieren: telTegendoelpunten([]) }), INS.rapportKwartierTitle)!
    expect(sec.querySelector('.rapport-kwartier-bars')).toBeNull()
    expect(sec.textContent).toContain(INS.kwartierEmpty)
    expect(sec.textContent).toContain(INS.tegenEmpty)
  })
  it('AC12: één gevulde reeks naast één lege toont wel balken van de gevulde, zonder verzonnen nullen-balken van de lege', () => {
    const sec = sectieBy(renderRapport({ kwartieren: telPerKwartier([{ minuut: 5, aantal: 2 }]), tegenKwartieren: telTegendoelpunten([]) }), INS.rapportKwartierTitle)!
    expect(sec.querySelectorAll('.rapport-kwartier-bar-voor')).toHaveLength(1)
    expect(sec.querySelector('.rapport-kwartier-bar-tegen')).toBeNull()
    expect(sec.querySelectorAll('.rapport-kwartier-labels .rapport-kwartier-waarde')).toHaveLength(7)
  })
  it('AC13: noemer 0 → speelminutenEmpty', () => {
    const sec = sectieBy(renderRapport({ speelminuten: verdeelSpeelminuten([]) }), INS.rapportSpeelminutenTitle)!
    expect(sec.textContent).toContain(INS.speelminutenEmpty)
    expect(sec.querySelector('table')).toBeNull()
  })
  it('AC14: geen kaarten → kaartenEmpty als .rapport-noot en geen .rapport-melding', () => {
    const sec = sectieBy(renderRapport({ kaarten: [] }), INS.rapportKaartenTitle)!
    expect(sec.querySelector('.rapport-noot')!.textContent).toBe(INS.kaartenEmpty)
    expect(sec.querySelector('.rapport-melding')).toBeNull()
  })
  it('AC15: de vier oordeelstaten in volgorde, elk met de eigen tekst', () => {
    const doe = (ev: EvaluatieOverzicht, fout = false) => sectieBy(renderRapport({ evaluaties: ev, fout: { evaluaties: fout } }), INS.rapportOordeelTitle)!
    expect(rapportMeldingen(doe(evOverzicht([evRij(1, 'ja')]), true))).toEqual([INS.bronFout])
    expect(rapportMeldingen(doe(evOverzicht([evRij(1, 'ja')], { afgekaptEvaluaties: true })))).toEqual([INS.afgekaptTraining])
    expect(doe(evOverzicht([])).textContent).toContain(INS.oordeelEmpty)
    const geenDoel = doe(evOverzicht([evRij(1, null, null), evRij(2, null, null)]))
    expect(geenDoel.textContent).toContain(INS.oordeelGeenDoelstellingen)
    expect(geenDoel.querySelector('.rapport-oordeel')).toBeNull()
    expect(doe(evOverzicht([evRij(1, 'ja')])).querySelector('.rapport-oordeel')).not.toBeNull()
  })
})

describe('seizoensrapport uitbreiding — AC17 geen verzonnen 0', () => {
  it('AC17: wedstrijden 0 → minuten geenGegevens en wedstrijden "0"; nergens NaN of undefined', () => {
    const sec = sectieBy(renderRapport({ speelminuten: verdeelSpeelminuten([smRij({ player_id: 'a', naam: 'Aad', wedstrijden: 4, minuten: 300 }), smRij({ player_id: 'b', naam: 'Bea', wedstrijden: 0, minuten: null, wissels: null })]) }), INS.rapportSpeelminutenTitle)!
    const rijen = Array.from(sec.querySelectorAll('tbody tr')).map(cellen)
    expect(rijen).toEqual([['Aad', '300', '4'], ['Bea', INS.geenGegevens, '0']])
    expect(sec.textContent).not.toMatch(/NaN|undefined|null/)
  })
  it('AC17: een handgebouwde verdeling met wedstrijden 2 en minuten null → geenGegevens (geen 0)', () => {
    const verdeling = {
      noemer: 5,
      regels: [{ ...smRij({ player_id: 'x', naam: 'Xavi', wedstrijden: 2, minuten: null, wissels: null, noemer: 5 }), gemiddelde: null, minutenAandeel: null }],
    }
    const sec = sectieBy(renderRapport({ speelminuten: verdeling }), INS.rapportSpeelminutenTitle)!
    expect(cellen(sec.querySelector('tbody tr')!)).toEqual(['Xavi', INS.geenGegevens, '2'])
  })
})

describe('seizoensrapport uitbreiding — AC26 / AC27 / AC29 DOM, props en CSS', () => {
  it('AC27: zonder de nieuwe props staat geen van de vier titels in het rapport', () => {
    const blok = renderRapport()
    for (const t of NIEUWE_TITELS) expect(kopjes(blok)).not.toContain(t)
  })
  it('AC27: elke prop heeft een eigen sectie (Kwartier: één reeks is genoeg; zonder beide reeksen geen sectie)', () => {
    expect(kopjes(renderRapport({ speelminuten: volleProps().speelminuten }))).toContain(INS.rapportSpeelminutenTitle)
    expect(kopjes(renderRapport({ kaarten: [] }))).toContain(INS.rapportKaartenTitle)
    expect(kopjes(renderRapport({ evaluaties: volleProps().evaluaties }))).toContain(INS.rapportOordeelTitle)
    expect(kopjes(renderRapport({ kwartieren: volleProps().kwartieren }))).toContain(INS.rapportKwartierTitle)
    expect(kopjes(renderRapport({ tegenKwartieren: volleProps().tegenKwartieren }))).toContain(INS.rapportKwartierTitle)
    expect(kopjes(renderRapport())).not.toContain(INS.rapportKwartierTitle)
  })
  it('AC26: met alles gevuld geen h2, caption, sr-only, role=img/alert, data-kpi, data-conclusielaag of svg; zes data-rapport-kpi blijven', () => {
    const blok = renderRapport({ ...volleProps(), fout: { speelminuten: true } })
    for (const sel of ['h2', 'caption', '.sr-only', '[role="img"]', '[role="alert"]', '[data-kpi]', '[data-conclusielaag]', 'svg']) {
      expect(blok.querySelector(sel), sel).toBeNull()
    }
    expect(blokKpis(blok)).toHaveLength(6)
    for (const t of NIEUWE_TITELS) {
      expect(sectieBy(blok, t)!.outerHTML).not.toMatch(/print:/)
    }
  })
  it('AC26: de kwartierbalken zijn gewone span-balken met een percentagehoogte', () => {
    const bar = sectieBy(renderRapport(volleProps()), INS.rapportKwartierTitle)!.querySelector('.rapport-kwartier-bar') as HTMLElement
    expect(bar.tagName).toBe('SPAN')
    expect(bar.style.height).toMatch(/%$/)
  })
  it('AC28 / X1: de nieuwe sectie-rijen staan tussen Ratings | Aanwezigheid en de voet, in de volgorde Speelminuten, Kaarten, Kwartier, Doelstelling', () => {
    const blok = renderRapport(volleProps())
    const k = kopjes(blok)
    const vanaf = k.indexOf(INS.rapportSpeelminutenTitle)
    expect(k.slice(vanaf)).toEqual(NIEUWE_TITELS.slice(0, 2).concat(INS.rapportKwartierTitle, INS.rapportOordeelTitle))
    expect(blok.lastElementChild!.classList.contains('rapport-voet')).toBe(true)
  })

  const css = () => readFileSync(join(__dirname, 'app/globals.css'), 'utf8')
  const printBlokCss = () => {
    const c = css()
    const start = c.indexOf('@media print')
    return { c, start, regel: (naam: string) => c.indexOf(naam) }
  }
  it('AC22 / AC29: .rapport-sectie heeft break-inside: avoid; de nieuwe klassen staan na @media print {', () => {
    expect(css()).toMatch(/\.rapport-sectie\s*\{[^}]*break-inside:\s*avoid/)
    const { start, regel } = printBlokCss()
    expect(start).toBeGreaterThan(-1)
    for (const k of ['.rapport-kwartier-bars {', '.rapport-kwartier-bar-tegen {', '.rapport-oordeel {', '.rapport-kwartier-regel {']) {
      expect(regel(k), k).toBeGreaterThan(start)
    }
  })
  it('AC21 / U6: de balkhoogtes blijven op 32 mm (.rapport-bars) en 20 mm (.rapport-kwartier-bars), AC21-terugval is niet toegepast', () => {
    expect(css()).toMatch(/\.rapport-bars\s*\{[^}]*height:\s*32mm/)
    expect(css()).toMatch(/\.rapport-kwartier-bars\s*\{[^}]*height:\s*20mm/)
  })
  it('AC29: de tegenbalk is omlijnd en de voorbalk gevuld (onderscheid ook in zwart-wit); het oordeelraster heeft vier kolommen', () => {
    expect(css()).toMatch(/\.rapport-kwartier-bar-tegen\s*\{[^}]*border:/)
    expect(css()).toMatch(/\.rapport-kwartier-bar-voor\s*\{[^}]*background:/)
    expect(css()).toMatch(/\.rapport-oordeel\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/)
  })
  it('AC29: de oordeelvakjes lijnen hun waarde uit op één lijn (flex column, space-between)', () => {
    expect(css()).toMatch(/\.rapport-oordeel\s*>\s*div\s*\{[^}]*flex-direction:\s*column;[^}]*justify-content:\s*space-between/)
  })
})
