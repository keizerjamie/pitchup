import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import WedstrijdStapper from '@/components/wedstrijd/WedstrijdStapper'
import type { WedstrijdStapperData } from '@/lib/wedstrijd-stappen'

function data(overrides: Partial<WedstrijdStapperData> = {}): WedstrijdStapperData {
  return {
    eventId: 'e1',
    huidig: 'selectie',
    aanwezigheid: { aanwezig: 9, geenReactie: 3 },
    selectie: 'open',
    opstelling: 'open',
    analyse: 'open',
    analyseVergrendeld: false,
    ...overrides,
  }
}

const renderStapper = (d: WedstrijdStapperData) => render(<WedstrijdStapper data={d} t={nl} />)

describe('WedstrijdStapper', () => {
  it('toont vier stappen als links naar de bestaande paden, in volgorde', () => {
    renderStapper(data())
    const nav = screen.getByRole('navigation', { name: nl.wedstrijdFlow.stapperLabel })
    const links = within(nav).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/events/e1',
      '/events/e1/squad',
      '/events/e1/lineup',
      '/events/e1/analysis',
    ])
    expect(links[0]).toHaveTextContent(nl.wedstrijdFlow.stapBeschikbaar)
    expect(links[3]).toHaveTextContent(nl.wedstrijdFlow.stapAnalyse)
  })

  it('zet aria-current="step" alleen op de huidige stap', () => {
    renderStapper(data({ huidig: 'opstelling' }))
    const huidig = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'step')
    expect(huidig).toHaveLength(1)
    expect(huidig[0]).toHaveAttribute('href', '/events/e1/lineup')
  })

  it('toont een vinkje en schermlezertekst bij een klare stap, "nog open" bij een open stap', () => {
    renderStapper(data({ huidig: 'beschikbaar', selectie: 'klaar', opstelling: 'open' }))
    const selectie = screen.getByRole('link', { name: new RegExp(nl.wedstrijdFlow.stapSelectie) })
    expect(within(selectie).getByText('check')).toBeInTheDocument()
    expect(within(selectie).getByText(nl.wedstrijdFlow.stapKlaarSr)).toBeInTheDocument()
    const opstelling = screen.getByRole('link', { name: new RegExp(nl.wedstrijdFlow.stapOpstelling) })
    expect(within(opstelling).queryByText('check')).not.toBeInTheDocument()
    expect(within(opstelling).getByText(nl.wedstrijdFlow.stapOpenSr)).toBeInTheDocument()
  })

  it('geeft Beschikbaar nooit een vinkje, ook niet als de rest klaar is', () => {
    renderStapper(data({ huidig: 'analyse', selectie: 'klaar', opstelling: 'klaar', analyse: 'klaar' }))
    const beschikbaar = screen.getByRole('link', { name: new RegExp(nl.wedstrijdFlow.stapBeschikbaar) })
    expect(within(beschikbaar).queryByText('check')).not.toBeInTheDocument()
    expect(screen.getAllByText('check')).toHaveLength(3)
  })

  it('onbekend: geen vinkje en geen schermlezerstatus', () => {
    renderStapper(data({ huidig: 'beschikbaar', selectie: 'onbekend' }))
    const selectie = screen.getByRole('link', { name: new RegExp(nl.wedstrijdFlow.stapSelectie) })
    expect(within(selectie).queryByText('check')).not.toBeInTheDocument()
    expect(within(selectie).queryByText(nl.wedstrijdFlow.stapKlaarSr)).not.toBeInTheDocument()
    expect(within(selectie).queryByText(nl.wedstrijdFlow.stapOpenSr)).not.toBeInTheDocument()
  })

  it('vergrendelde analyse: geen link, aria-disabled en de reden zichtbaar', () => {
    renderStapper(data({ huidig: 'beschikbaar', analyseVergrendeld: true }))
    expect(screen.getAllByRole('link')).toHaveLength(3)
    expect(screen.queryByRole('link', { name: new RegExp(nl.wedstrijdFlow.stapAnalyse) })).not.toBeInTheDocument()
    const slot = document.querySelector('[aria-disabled="true"]') as HTMLElement
    expect(slot).toHaveTextContent(nl.wedstrijdFlow.stapAnalyse)
    expect(within(slot).getByText(nl.event.analysisAfterMatch)).toBeInTheDocument()
  })

  it('op de analysepagina zelf blijft de huidige stap een link, ook bij vergrendeling', () => {
    renderStapper(data({ huidig: 'analyse', analyseVergrendeld: true }))
    const huidig = screen.getByRole('link', { name: new RegExp(nl.wedstrijdFlow.stapAnalyse) })
    expect(huidig).toHaveAttribute('aria-current', 'step')
  })

  it('toont de samenvatting en koppelt hem aan stap 1 via aria-describedby', () => {
    renderStapper(data())
    const tekst = nl.wedstrijdFlow.beschikbaarSamenvatting.replace('{aanwezig}', '9').replace('{geenReactie}', '3')
    const regel = screen.getByText(tekst)
    const beschikbaar = screen.getByRole('link', { name: new RegExp(nl.wedstrijdFlow.stapBeschikbaar) })
    expect(beschikbaar).toHaveAttribute('aria-describedby', regel.id)
  })

  it('is verborgen bij printen en gebruikt geen animatie of transitie', () => {
    const { container } = renderStapper(data())
    expect(container.querySelector('nav')).toHaveClass('print:hidden')
    expect(container.innerHTML).not.toMatch(/transition|animate-|anim-/)
  })
})
