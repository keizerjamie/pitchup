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
  splitsThuisUit,
  teamRatingTrend,
  toMaandOpkomst,
  topWorstAanwezigheid,
  topWorstRating,
  type AanwezigheidPerSpelerRij,
  type DoelpuntItem,
  type RatingPerSpelerRij,
  type SpelerMomentenRij,
  type TeamRatingRij,
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
