import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { nl } from '@/messages/nl'
import AanwezigheidChart from '@/components/inzichten/AanwezigheidChart'

describe('AanwezigheidChart', () => {
  it('toont het percentage, de rauwe aantallen en een role="img" met een niet-lege aria-label', () => {
    render(<AanwezigheidChart data={{ aanwezig: 18, afwezig: 2, percentage: 90 }} t={nl} />)
    expect(screen.getByText('90%')).toBeInTheDocument()
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBeTruthy()
    expect(img.getAttribute('aria-label')).toMatch(/90%/)
  })

  it('elke waarde is ook vindbaar via getByText, buiten de SVG om (sr-only tabel)', () => {
    render(<AanwezigheidChart data={{ aanwezig: 18, afwezig: 2, percentage: 90 }} t={nl} />)
    // De sr-only <table> herhaalt de exacte cijfers als tekst.
    expect(screen.getAllByText('18').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
  })

  it('data === null (RPC-fout of geen data) → lege staat, geen crash, geen 0%', () => {
    render(<AanwezigheidChart data={null} t={nl} />)
    expect(screen.getByText(nl.insights.aanwezigheidEmpty)).toBeInTheDocument()
    expect(screen.queryByText('0%')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('percentage === null (totaal 0) → lege staat, NOOIT als 0% getoond', () => {
    render(<AanwezigheidChart data={{ aanwezig: 0, afwezig: 0, percentage: null }} t={nl} />)
    expect(screen.getByText(nl.insights.aanwezigheidEmpty)).toBeInTheDocument()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('titel en toelichting komen uit de dictionary', () => {
    render(<AanwezigheidChart data={{ aanwezig: 5, afwezig: 5, percentage: 50 }} t={nl} />)
    expect(screen.getByText(nl.insights.aanwezigheidTitle)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.aanwezigheidDescription)).toBeInTheDocument()
  })

  // Dekt hex in SVG-presentatie-attributen (bv. recharts' eigen fill/stroke-
  // defaults). Dekt NIET inline style-props: jsdom normaliseert die altijd
  // naar rgb() zodra React ze als style-object zet, dus een hex-literal als
  // `style={{ color: '#fff' }}` verschijnt hier nooit als hex in de HTML —
  // zie de bron-check hieronder die dat gat wél dicht.
  it('regressie: geen hardcoded hex-kleuren in de gerenderde markup', () => {
    const { container } = render(<AanwezigheidChart data={{ aanwezig: 7, afwezig: 3, percentage: 70 }} t={nl} />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  // Bron-check: leest het componentbestand zelf, niet de gerenderde DOM.
  // Nodig omdat jsdom elke `style={{ ... }}`-kleur normaliseert naar rgb()
  // (geverifieerd: een hex-literal in een React style-object verschijnt nooit
  // als hex in container.innerHTML), waardoor de DOM-based test hierboven
  // blind is voor hardcoded hex in inline style-attributen.
  it('regressie (bron): geen hardcoded hex-kleuren in style={{...}}-blokken', () => {
    const source = readFileSync(path.join(process.cwd(), 'components/inzichten/AanwezigheidChart.tsx'), 'utf-8')
    const styleBlocks = source.match(/style=\{\{[\s\S]*?\}\}/g) ?? []
    for (const block of styleBlocks) {
      expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
  })
})
