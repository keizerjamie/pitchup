import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { nl } from '@/messages/nl'
import DoelpuntenChart from '@/components/inzichten/DoelpuntenChart'
import type { DoelpuntItem } from '@/lib/inzichten'

const ITEMS: DoelpuntItem[] = [
  { id: 'a', date: '2026-09-05', opponent: 'DVC', match_type: 'league', goals_for: 3, goals_against: 1 },
  { id: 'b', date: '2026-09-12', opponent: 'FC Oost', match_type: 'friendly', goals_for: 1, goals_against: 1 },
  { id: 'c', date: '2026-09-19', opponent: 'SC West', match_type: 'cup', goals_for: 0, goals_against: 2 },
]

function table(): HTMLTableElement {
  return document.querySelector('table') as HTMLTableElement
}

function tableRows(): string[] {
  return Array.from(table().querySelectorAll('tbody tr')).map((r) => r.textContent ?? '')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DoelpuntenChart', () => {
  it('toont standaard alle wedstrijden (filter "all")', () => {
    render(<DoelpuntenChart items={ITEMS} t={nl} />)
    expect(tableRows()).toHaveLength(3)
  })

  it('klik op "Competitie" → alleen league-wedstrijden in de sr-only tabel, geen navigatie/reload', () => {
    const reloadSpy = vi.fn()
    // Er is geen navigatie-API om op te controleren behalve dat de knoppen
    // gewone type="button"-knoppen zijn (geen <a>/formulier-submit).
    render(<DoelpuntenChart items={ITEMS} t={nl} />)
    const button = screen.getByRole('button', { name: nl.event.matchTypes.league })
    expect(button).toHaveAttribute('type', 'button')

    fireEvent.click(button)

    expect(tableRows()).toHaveLength(1)
    expect(tableRows()[0]).toMatch(/DVC/)
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('filterknoppen hebben aria-pressed dat meebeweegt met de selectie', () => {
    render(<DoelpuntenChart items={ITEMS} t={nl} />)
    const allBtn = screen.getByRole('button', { name: nl.insights.filterAll })
    const leagueBtn = screen.getByRole('button', { name: nl.event.matchTypes.league })
    expect(allBtn).toHaveAttribute('aria-pressed', 'true')
    expect(leagueBtn).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(leagueBtn)
    expect(allBtn).toHaveAttribute('aria-pressed', 'false')
    expect(leagueBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('filteren naar een lege dataset → lege staat, geen foutmelding', () => {
    render(<DoelpuntenChart items={[ITEMS[0]]} t={nl} />)
    fireEvent.click(screen.getByRole('button', { name: nl.event.matchTypes.cup }))
    expect(screen.getByText(nl.insights.doelpuntenFilterEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
    // De filterknoppen blijven staan zodat je terug kan naar "Alle".
    expect(screen.getByRole('button', { name: nl.insights.filterAll })).toBeInTheDocument()
  })

  it('helemaal geen wedstrijden → pagina-brede lege staat voor deze kaart, geen filterknoppen', () => {
    render(<DoelpuntenChart items={[]} t={nl} />)
    expect(screen.getByText(nl.insights.doelpuntenEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('elke waarde (voor/tegen) staat als tekst in de sr-only tabel, niet uitsluitend als kleur', () => {
    render(<DoelpuntenChart items={ITEMS} t={nl} />)
    const row = tableRows().find((r) => r.includes('DVC'))!
    expect(row).toMatch(/3/)
    expect(row).toMatch(/1/)
  })

  it('role="img" heeft een niet-lege aria-label', () => {
    render(<DoelpuntenChart items={ITEMS} t={nl} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBeTruthy()
  })

  // Dekt hex in SVG-presentatie-attributen (bv. recharts' eigen fill/stroke-
  // defaults). Dekt NIET inline style-props: jsdom normaliseert die altijd
  // naar rgb() zodra React ze als style-object zet, dus een hex-literal als
  // `style={{ color: '#fff' }}` verschijnt hier nooit als hex in de HTML —
  // zie de bron-check hieronder die dat gat wél dicht.
  it('regressie: geen hardcoded hex-kleuren in de gerenderde markup', () => {
    const { container } = render(<DoelpuntenChart items={ITEMS} t={nl} />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  // Bron-check: leest het componentbestand zelf, niet de gerenderde DOM.
  // Nodig omdat jsdom elke `style={{ ... }}`-kleur normaliseert naar rgb()
  // (geverifieerd: een hex-literal in een React style-object verschijnt nooit
  // als hex in container.innerHTML), waardoor de DOM-based test hierboven
  // blind is voor hardcoded hex in inline style-attributen.
  it('regressie (bron): geen hardcoded hex-kleuren in style={{...}}-blokken', () => {
    const source = readFileSync(path.join(process.cwd(), 'components/inzichten/DoelpuntenChart.tsx'), 'utf-8')
    const styleBlocks = source.match(/style=\{\{[\s\S]*?\}\}/g) ?? []
    for (const block of styleBlocks) {
      expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
  })
})
