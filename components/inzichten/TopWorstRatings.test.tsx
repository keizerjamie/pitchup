import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { nl } from '@/messages/nl'
import TopWorstRatings from '@/components/inzichten/TopWorstRatings'
import { topWorstRating } from '@/lib/inzichten'
import type { RatingPerSpelerRij } from '@/lib/inzichten'

const ROWS: RatingPerSpelerRij[] = [
  { player_id: 'p1', naam: 'Piet Peters', gemiddelde: 8.25, aantal: 4 },
  { player_id: 'p2', naam: 'Jan Jansen', gemiddelde: 7.6, aantal: 6 },
  { player_id: 'p3', naam: 'Kees Klaassen', gemiddelde: 6.0, aantal: 3 },
  { player_id: 'p4', naam: 'Bram Bakker', gemiddelde: 5.5, aantal: 2 },
  { player_id: 'p5', naam: 'Sam de Vries', gemiddelde: 5.1, aantal: 5 },
  { player_id: 'p6', naam: 'Tim Timmer', gemiddelde: 4.9, aantal: 4 },
]

describe('TopWorstRatings', () => {
  it('toont de beste en minste spelers met afgeronde rating en aantal wedstrijden', () => {
    const data = topWorstRating(ROWS, 5)
    render(<TopWorstRatings data={data} t={nl} />)

    // Beste (top): hoogste gemiddelde eerst, afgerond op 1 decimaal.
    expect(screen.getByText('Piet Peters')).toBeInTheDocument()
    expect(screen.getByText(nl.insights.topWorstRatingsWaarde.replace('{gemiddelde}', '8.3').replace('{aantal}', '4'))).toBeInTheDocument()

    // Minste (worst): laagste gemiddelde.
    expect(screen.getByText('Tim Timmer')).toBeInTheDocument()
    expect(screen.getByText(nl.insights.topWorstRatingsWaarde.replace('{gemiddelde}', '4.9').replace('{aantal}', '4'))).toBeInTheDocument()

    expect(screen.getByText(nl.insights.bestLabel)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.worstLabel)).toBeInTheDocument()
  })

  it('lege lijst (0 spelers) → lege staat, geen crash', () => {
    const data = topWorstRating([], 5)
    render(<TopWorstRatings data={data} t={nl} />)
    expect(screen.getByText(nl.insights.topWorstRatingsEmpty)).toBeInTheDocument()
    expect(screen.queryByText(nl.insights.bestLabel)).toBeNull()
  })

  it('1 speler → geen crash, dezelfde speler staat in beide lijstjes', () => {
    const enkeleRij: RatingPerSpelerRij[] = [{ player_id: 'p1', naam: 'Piet Peters', gemiddelde: 7.0, aantal: 3 }]
    const data = topWorstRating(enkeleRij, 5)
    render(<TopWorstRatings data={data} t={nl} />)
    expect(screen.getAllByText('Piet Peters')).toHaveLength(2)
    expect(screen.getByText(nl.insights.topWorstOverlapHint)).toBeInTheDocument()
  })

  it('bewust gedrag: bij een kleine selectie mag dezelfde speler in top én worst staan (geen filtering) en verschijnt de overlap-hint', () => {
    // 6 spelers, n=5 → top en worst overlappen voor minstens 4 spelers.
    const data = topWorstRating(ROWS, 5)
    render(<TopWorstRatings data={data} t={nl} />)
    expect(screen.getByText(nl.insights.topWorstOverlapHint)).toBeInTheDocument()
  })

  it('geen overlap-hint als top en worst geen gedeelde spelers hebben', () => {
    // 10 unieke spelers, n=5 → top en worst zijn disjunct.
    const veelSpelers: RatingPerSpelerRij[] = Array.from({ length: 10 }, (_, i) => ({
      player_id: `p${i}`,
      naam: `Speler ${i}`,
      gemiddelde: 10 - i,
      aantal: 3,
    }))
    const data = topWorstRating(veelSpelers, 5)
    render(<TopWorstRatings data={data} t={nl} />)
    expect(screen.queryByText(nl.insights.topWorstOverlapHint)).toBeNull()
  })

  it('regressie: geen hardcoded hex-kleuren in de gerenderde markup', () => {
    const data = topWorstRating(ROWS, 5)
    const { container } = render(<TopWorstRatings data={data} t={nl} />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('regressie (bron): geen hardcoded hex-kleuren in style={{...}}-blokken', () => {
    const source = readFileSync(path.join(process.cwd(), 'components/inzichten/TopWorstRatings.tsx'), 'utf-8')
    const styleBlocks = source.match(/style=\{\{[\s\S]*?\}\}/g) ?? []
    for (const block of styleBlocks) {
      expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
  })
})
