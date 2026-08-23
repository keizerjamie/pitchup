// Acceptatietests voor het print-only seizoensrapport (/inzichten → afdrukken).
//
// Testmethode: het component wordt rechtstreeks gerenderd met kale props —
// zelfde aanpak als de wedstrijdselectie-PDF (wedstrijdselectie-pdf.acceptance
// .test.tsx). Het rapport is een pure presentatielaag: alle rekenwerk zit in
// lib/inzichten.ts en wordt daar al getoetst.
import { describe, it, expect } from 'vitest'
import { render, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import {
  OPKOMST_DOEL,
  bepaalSignalen,
  doelsaldo,
  laatsteMaandTrend,
  teamRatingTrend,
  toMaandOpkomst,
  topWorstAanwezigheid,
  topWorstRating,
  type AanwezigheidPerSpelerRij,
  type DoelpuntItem,
  type RatingPerSpelerRij,
  type TeamRatingRij,
} from '@/lib/inzichten'
import SeizoensrapportPrint from '@/components/inzichten/SeizoensrapportPrint'

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
    signalen: bepaalSignalen({ maanden, aanwezigheidPerSpeler: aanwezigheidRijen, teamRating, doelpunten }),
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

  it('zonder clublogo verschijnt er geen <img> en geen placeholder in de kop', () => {
    expect(renderRapport({ teamLogoUrl: null }).querySelector('img')).toBeNull()
  })

  it('met clublogo staat er een <img> met die src', () => {
    const blok = renderRapport({ teamLogoUrl: 'https://cdn.example.com/logo.png' })
    expect(blok.querySelector('img')?.getAttribute('src')).toContain('logo.png')
  })

  it('zonder teamnaam crasht het rapport niet en blijft de titel staan', () => {
    const blok = renderRapport({ teamName: null })
    expect(within(blok).getByText(nl.insights.rapportTitle)).toBeInTheDocument()
  })
})

describe('seizoensrapport — cijfers', () => {
  it('toont de vier kernkijfers met hun labels', () => {
    const blok = renderRapport()
    for (const label of [
      nl.insights.kpiOpkomstLabel,
      nl.insights.kpiAanwezigheidLabel,
      nl.insights.kpiRatingLabel,
      nl.insights.kpiDoelsaldoLabel,
    ]) {
      expect(within(blok).getByText(label)).toBeInTheDocument()
    }
    // Scopen op het cijferblok: 71% staat óók als waarde boven de
    // septemberbalk verderop in het rapport.
    const kpis = within(blok.querySelector('.rapport-kpis') as HTMLElement)
    expect(kpis.getByText('71%')).toBeInTheDocument() // laatste maand
    expect(kpis.getByText('79%')).toBeInTheDocument() // seizoen
    expect(kpis.getByText('7.2')).toBeInTheDocument() // gem. rating
    expect(kpis.getByText('+4')).toBeInTheDocument() // doelsaldo 5-1
  })

  it('ontbrekende cijfers tonen een streepje, nooit een verzonnen 0', () => {
    const blok = renderRapport({
      opkomst: null, maanden: [], aanwezigheidPercentage: null, rating: null,
      saldo: { voor: 0, tegen: 0, saldo: 0, wedstrijden: 0 },
    })
    expect(within(blok.querySelector('.rapport-kpis') as HTMLElement).getAllByText('—')).toHaveLength(4)
    expect(blok.textContent).not.toMatch(/\b0%/)
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
