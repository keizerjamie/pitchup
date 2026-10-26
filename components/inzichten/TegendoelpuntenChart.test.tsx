import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import { telTegendoelpunten } from '@/lib/inzichten'
import TegendoelpuntenChart from './TegendoelpuntenChart'

const i = nl.insights
const soorten = nl.analysis.tegendoelpuntSoorten

describe('TegendoelpuntenChart', () => {
  const telling = telTegendoelpunten([
    { minuut: 20, soort: 'set_piece', aantal: 1 },
    { minuut: 70, soort: 'open_play', aantal: 2 },
    { minuut: null, soort: 'open_play', aantal: 1 },
  ])

  it('HTML-legenda met tekst, role="img", datatabel als sibling met totaalkolom', () => {
    const { container } = render(<TegendoelpuntenChart telling={telling} fout={false} t={nl} />)
    // Legenda staat als tekst (niet alleen kleur) boven het diagram.
    const legenda = screen.getByRole('list')
    expect(within(legenda).getByText(soorten.set_piece)).toBeInTheDocument()
    expect(within(legenda).getByText(soorten.open_play)).toBeInTheDocument()
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toContain('16–30: 1')
    expect(img.querySelector('table')).toBeNull()
    const tabel = container.querySelector('table.sr-only') as HTMLElement
    expect(within(tabel).getByRole('columnheader', { name: i.totaalLabel })).toBeInTheDocument()
    expect(screen.getByText('1 standaardsituatie · 3 open spel')).toBeInTheDocument()
    expect(screen.getByText('3 van 4 tegendoelpunten met minuut')).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    // Standaardsituatie blauw, open spel rood (palette-validatie light).
    expect(container.querySelector('.chart-fill-blue')).not.toBeNull()
    expect(container.querySelector('.chart-fill-red')).not.toBeNull()
    expect(container.querySelector('.chart-fill-amber')).toBeNull()
  })

  it('geen tegendoelpunten: lege staat', () => {
    render(<TegendoelpuntenChart telling={telTegendoelpunten([])} fout={false} t={nl} />)
    expect(screen.getByText(i.tegenEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('foutstaat', () => {
    render(<TegendoelpuntenChart telling={telTegendoelpunten([])} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
  })
})
