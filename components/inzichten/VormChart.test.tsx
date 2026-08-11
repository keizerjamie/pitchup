import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { nl } from '@/messages/nl'
import { matchResult } from '@/lib/match-analysis.mjs'
import VormChart from '@/components/inzichten/VormChart'
import { telVorm } from '@/lib/inzichten'
import type { FormStripItem } from '@/components/dashboard/FormStrip'

const ROWS = [
  { id: 'm1', goals_for: 3, goals_against: 1 }, // win
  { id: 'm2', goals_for: 1, goals_against: 1 }, // draw
  { id: 'm3', goals_for: 0, goals_against: 2 }, // loss
  { id: 'm4', goals_for: null, goals_against: null }, // unknown
]
const ITEMS: FormStripItem[] = ROWS.map((r) => ({ id: r.id, result: matchResult(r) }))
const TELLING = telVorm(ROWS)

describe('VormChart', () => {
  it('rendert de FormStrip-letters en de gestapelde verdelingsbalk', () => {
    const { container } = render(<VormChart items={ITEMS} telling={TELLING} t={nl} />)
    expect(container.textContent).toContain('WGV?')
  })

  it('de wedstrijd zonder uitslag telt mee als "?" (onbekend), niet als fout', () => {
    render(<VormChart items={ITEMS} telling={TELLING} t={nl} />)
    expect(screen.getByText(nl.home.formLetterUnknown)).toBeInTheDocument()
  })

  it('de verdelingsbalk heeft role="img" met een niet-lege aria-label', () => {
    render(<VormChart items={ITEMS} telling={TELLING} t={nl} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBeTruthy()
  })

  it('de samenvattingsbalk toont de W/G/V-telling als leesbare tekst', () => {
    render(<VormChart items={ITEMS} telling={TELLING} t={nl} />)
    const expected = nl.insights.vormSummary.replace('{win}', '1').replace('{gelijk}', '1').replace('{verlies}', '1')
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
  })

  it('lege lijst → lege staat, geen strip, geen crash', () => {
    render(<VormChart items={[]} telling={{ win: 0, gelijk: 0, verlies: 0, onbekend: 0 }} t={nl} />)
    expect(screen.getByText(nl.insights.vormEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('elke telling staat ook als tekst in de sr-only tabel', () => {
    render(<VormChart items={ITEMS} telling={TELLING} t={nl} />)
    const table = document.querySelector('table')!
    expect(table.textContent).toMatch(nl.home.formWin)
    expect(table.textContent).toMatch(nl.home.formLoss)
  })

  // Dekt hex in SVG-presentatie-attributen (bv. recharts' eigen fill/stroke-
  // defaults). Dekt NIET inline style-props: jsdom normaliseert die altijd
  // naar rgb() zodra React ze als style-object zet, dus een hex-literal als
  // `style={{ color: '#fff' }}` verschijnt hier nooit als hex in de HTML —
  // zie de bron-check hieronder die dat gat wél dicht.
  it('regressie: geen hardcoded hex-kleuren in de gerenderde markup', () => {
    const { container } = render(<VormChart items={ITEMS} telling={TELLING} t={nl} />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  // Bron-check: leest het componentbestand zelf, niet de gerenderde DOM.
  // Nodig omdat jsdom elke `style={{ ... }}`-kleur normaliseert naar rgb()
  // (geverifieerd: een hex-literal in een React style-object verschijnt nooit
  // als hex in container.innerHTML), waardoor de DOM-based test hierboven
  // blind is voor hardcoded hex in inline style-attributen.
  it('regressie (bron): geen hardcoded hex-kleuren in style={{...}}-blokken', () => {
    const source = readFileSync(path.join(process.cwd(), 'components/inzichten/VormChart.tsx'), 'utf-8')
    const styleBlocks = source.match(/style=\{\{[\s\S]*?\}\}/g) ?? []
    for (const block of styleBlocks) {
      expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
  })
})
