import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { nl } from '@/messages/nl'
import VolgendeStap from '@/components/wedstrijd/VolgendeStap'
import type { WedstrijdStapperData } from '@/lib/wedstrijd-stappen'

function data(overrides: Partial<WedstrijdStapperData> = {}): WedstrijdStapperData {
  return {
    eventId: 'e1',
    huidig: 'beschikbaar',
    aanwezigheid: { aanwezig: 0, geenReactie: 0 },
    selectie: 'open',
    opstelling: 'open',
    analyse: 'open',
    analyseVergrendeld: false,
    ...overrides,
  }
}

const renderVolgende = (d: WedstrijdStapperData) => render(<VolgendeStap data={d} t={nl} />)

describe('VolgendeStap', () => {
  it.each([
    ['beschikbaar', nl.wedstrijdFlow.volgendeSelectie, '/events/e1/squad'],
    ['selectie', nl.wedstrijdFlow.volgendeOpstelling, '/events/e1/lineup'],
    ['opstelling', nl.wedstrijdFlow.volgendeAnalyse, '/events/e1/analysis'],
  ] as const)('op %s: link "%s" naar %s', (huidig, label, href) => {
    renderVolgende(data({ huidig }))
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
  })

  it('rendert niets op de laatste stap (analyse)', () => {
    const { container } = renderVolgende(data({ huidig: 'analyse' }))
    expect(container).toBeEmptyDOMElement()
  })

  it('vergrendelde analyse: uitgeschakelde knop (geen link) met de reden zichtbaar', () => {
    renderVolgende(data({ huidig: 'opstelling', analyseVergrendeld: true }))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    const knop = screen.getByRole('button', { name: nl.wedstrijdFlow.volgendeAnalyse })
    expect(knop).toBeDisabled()
    expect(screen.getByText(nl.event.analysisAfterMatch)).toBeInTheDocument()
    expect(knop).toHaveAttribute('aria-describedby', screen.getByText(nl.event.analysisAfterMatch).id)
  })

  it('vergrendeling speelt alleen bij de stap naar analyse', () => {
    renderVolgende(data({ huidig: 'selectie', analyseVergrendeld: true }))
    expect(screen.getByRole('link', { name: nl.wedstrijdFlow.volgendeOpstelling })).toBeInTheDocument()
  })

  it('is niet sticky en verborgen bij printen', () => {
    const { container } = renderVolgende(data())
    expect(container.innerHTML).not.toMatch(/sticky|fixed/)
    expect(container.firstElementChild).toHaveClass('print:hidden')
  })
})
