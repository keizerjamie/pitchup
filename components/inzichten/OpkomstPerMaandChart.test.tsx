import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import OpkomstPerMaandChart from '@/components/inzichten/OpkomstPerMaandChart'
import type { MaandOpkomst } from '@/lib/inzichten'

const DATA: MaandOpkomst[] = [
  { maand: '2026-09', aanwezig: 18, afwezig: 2, percentage: 90 },
  { maand: '2026-10', aanwezig: 15, afwezig: 5, percentage: 75 },
  { maand: '2026-12', aanwezig: 0, afwezig: 0, percentage: null },
]

describe('OpkomstPerMaandChart', () => {
  it('rendert de maandlabels in de juiste volgorde (sr-only tabel), taal-specifiek', () => {
    render(<OpkomstPerMaandChart data={DATA} t={nl} />)
    const table = document.querySelector('table')!
    const headerCells = Array.from(table.querySelectorAll('tbody tr td:first-child')).map((td) => td.textContent)
    expect(headerCells).toEqual(['Sep 2026', 'Okt 2026', 'Dec 2026'])
  })

  it('gebruikt de browserLocale uit de dictionary voor de maandnaam (en i.p.v. nl)', () => {
    render(<OpkomstPerMaandChart data={[{ maand: '2026-09', aanwezig: 1, afwezig: 0, percentage: 100 }]} t={en} />)
    expect(screen.getAllByText(/Sep(t)?.*2026/).length).toBeGreaterThan(0)
  })

  it('maand met percentage null toont een streepje, nooit 0%', () => {
    render(<OpkomstPerMaandChart data={DATA} t={nl} />)
    const table = document.querySelector('table')!
    const rows = Array.from(table.querySelectorAll('tbody tr'))
    const decRow = rows.find((r) => r.textContent?.includes('Dec 2026'))!
    expect(decRow.textContent).toMatch(/—/)
    expect(decRow.textContent).not.toMatch(/0%/)
  })

  it('1-datapunt-geval rendert zonder crash', () => {
    expect(() =>
      render(<OpkomstPerMaandChart data={[{ maand: '2026-09', aanwezig: 4, afwezig: 1, percentage: 80 }]} t={nl} />),
    ).not.toThrow()
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('lege data → lege staat, geen role="img"', () => {
    render(<OpkomstPerMaandChart data={[]} t={nl} />)
    expect(screen.getByText(nl.insights.opkomstEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('role="img" heeft een niet-lege aria-label met een samenvatting', () => {
    render(<OpkomstPerMaandChart data={DATA} t={nl} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBeTruthy()
    expect(img.getAttribute('aria-label')).toMatch(/3/)
  })

  // Dekt hex in SVG-presentatie-attributen (bv. recharts' eigen fill/stroke-
  // defaults). Dekt NIET inline style-props: jsdom normaliseert die altijd
  // naar rgb() zodra React ze als style-object zet, dus een hex-literal als
  // `style={{ color: '#fff' }}` verschijnt hier nooit als hex in de HTML —
  // zie de bron-check hieronder die dat gat wél dicht.
  it('regressie: geen hardcoded hex-kleuren in de gerenderde markup', () => {
    const { container } = render(<OpkomstPerMaandChart data={DATA} t={nl} />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  // Bron-check: leest het componentbestand zelf, niet de gerenderde DOM.
  // Nodig omdat jsdom elke `style={{ ... }}`-kleur normaliseert naar rgb()
  // (geverifieerd: een hex-literal in een React style-object verschijnt nooit
  // als hex in container.innerHTML), waardoor de DOM-based test hierboven
  // blind is voor hardcoded hex in inline style-attributen.
  it('regressie (bron): geen hardcoded hex-kleuren in style={{...}}-blokken', () => {
    const source = readFileSync(path.join(process.cwd(), 'components/inzichten/OpkomstPerMaandChart.tsx'), 'utf-8')
    const styleBlocks = source.match(/style=\{\{[\s\S]*?\}\}/g) ?? []
    for (const block of styleBlocks) {
      expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
  })
})
