import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { nl } from '@/messages/nl'
import TopWorstAanwezigheid from '@/components/inzichten/TopWorstAanwezigheid'
import { topWorstAanwezigheid } from '@/lib/inzichten'
import type { AanwezigheidPerSpelerRij } from '@/lib/inzichten'

const ROWS: AanwezigheidPerSpelerRij[] = [
  { player_id: 'p1', naam: 'Piet Peters', aanwezig: 9, afwezig: 2 }, // 82%
  { player_id: 'p2', naam: 'Jan Jansen', aanwezig: 8, afwezig: 3 }, // 73%
  { player_id: 'p3', naam: 'Kees Klaassen', aanwezig: 6, afwezig: 5 }, // 55%
  { player_id: 'p4', naam: 'Bram Bakker', aanwezig: 4, afwezig: 7 }, // 36%
  { player_id: 'p5', naam: 'Sam de Vries', aanwezig: 3, afwezig: 8 }, // 27%
  { player_id: 'p6', naam: 'Tim Timmer', aanwezig: 2, afwezig: 9 }, // 18%
]

describe('TopWorstAanwezigheid', () => {
  it('toont de beste en minste aanwezigheid met percentage en aanwezig/totaal', () => {
    const data = topWorstAanwezigheid(ROWS, 5)
    render(<TopWorstAanwezigheid data={data} t={nl} />)

    expect(screen.getByText('Piet Peters')).toBeInTheDocument()
    expect(
      screen.getByText(
        nl.insights.topWorstAanwezigheidWaarde.replace('{percentage}', '82').replace('{aanwezig}', '9').replace('{totaal}', '11'),
      ),
    ).toBeInTheDocument()

    expect(screen.getByText('Tim Timmer')).toBeInTheDocument()
    expect(
      screen.getByText(
        nl.insights.topWorstAanwezigheidWaarde.replace('{percentage}', '18').replace('{aanwezig}', '2').replace('{totaal}', '11'),
      ),
    ).toBeInTheDocument()

    expect(screen.getByText(nl.insights.bestLabel)).toBeInTheDocument()
    expect(screen.getByText(nl.insights.worstLabel)).toBeInTheDocument()
  })

  it('lege lijst (0 spelers met percentage) → lege staat, geen crash', () => {
    const data = topWorstAanwezigheid([], 5)
    render(<TopWorstAanwezigheid data={data} t={nl} />)
    expect(screen.getByText(nl.insights.topWorstAanwezigheidEmpty)).toBeInTheDocument()
    expect(screen.queryByText(nl.insights.bestLabel)).toBeNull()
  })

  it('spelers zonder registratie (0/0) tellen niet mee en leveren geen crash op', () => {
    const data = topWorstAanwezigheid([{ player_id: 'p9', naam: 'Nieuwe Speler', aanwezig: 0, afwezig: 0 }], 5)
    render(<TopWorstAanwezigheid data={data} t={nl} />)
    expect(screen.getByText(nl.insights.topWorstAanwezigheidEmpty)).toBeInTheDocument()
  })

  it('1 speler → geen crash, dezelfde speler staat in beide lijstjes', () => {
    const enkeleRij: AanwezigheidPerSpelerRij[] = [{ player_id: 'p1', naam: 'Piet Peters', aanwezig: 5, afwezig: 1 }]
    const data = topWorstAanwezigheid(enkeleRij, 5)
    render(<TopWorstAanwezigheid data={data} t={nl} />)
    expect(screen.getAllByText('Piet Peters')).toHaveLength(2)
    expect(screen.getByText(nl.insights.topWorstOverlapHint)).toBeInTheDocument()
  })

  it('bewust gedrag: bij een kleine selectie mag dezelfde speler in top én worst staan (geen filtering) en verschijnt de overlap-hint', () => {
    const data = topWorstAanwezigheid(ROWS, 5) // 6 spelers, n=5 → overlap
    render(<TopWorstAanwezigheid data={data} t={nl} />)
    expect(screen.getByText(nl.insights.topWorstOverlapHint)).toBeInTheDocument()
  })

  it('geen overlap-hint als top en worst geen gedeelde spelers hebben', () => {
    const veelSpelers: AanwezigheidPerSpelerRij[] = Array.from({ length: 10 }, (_, i) => ({
      player_id: `p${i}`,
      naam: `Speler ${i}`,
      aanwezig: 10 - i,
      afwezig: i,
    }))
    const data = topWorstAanwezigheid(veelSpelers, 5)
    render(<TopWorstAanwezigheid data={data} t={nl} />)
    expect(screen.queryByText(nl.insights.topWorstOverlapHint)).toBeNull()
  })

  it('grote selectie met gelijke waarden op de top/worst-grens toont toch de overlap-hint (niet alleen bij een kleine selectie)', () => {
    // 12 spelers (> 2x n=5, dus geen "kleine selectie"), waarvan 8 exact
    // 100% aanwezigheid hebben. De alfabetisch eerste van die 8 ("Aad ...")
    // komt door de vaste naam-tie-break in snijTopWorst() zowel in de top 5
    // (hoogste 5 van de 8) als in de worst 5 (laagste 4 + de eerste van de
    // 100%-groep) terecht — puur toeval op de grens, niet door groepsgrootte.
    const grotSelectie: AanwezigheidPerSpelerRij[] = [
      { player_id: 'z1', naam: 'Zeno Zwart', aanwezig: 1, afwezig: 9 }, // 10%
      { player_id: 'z2', naam: 'Yara IJsma', aanwezig: 2, afwezig: 8 }, // 20%
      { player_id: 'z3', naam: 'Xander Xaas', aanwezig: 3, afwezig: 7 }, // 30%
      { player_id: 'z4', naam: 'Wouter Wijn', aanwezig: 4, afwezig: 6 }, // 40%
      ...Array.from({ length: 8 }, (_, i) => ({
        player_id: `a${i}`,
        naam: `Aad Speler ${i}`,
        aanwezig: 10,
        afwezig: 0,
      })), // 100%, alfabetisch: Aad Speler 0 < Aad Speler 1 < ...
    ]
    const data = topWorstAanwezigheid(grotSelectie, 5)

    expect(data.top.map((r) => r.naam)).toEqual([
      'Aad Speler 0',
      'Aad Speler 1',
      'Aad Speler 2',
      'Aad Speler 3',
      'Aad Speler 4',
    ])
    expect(data.worst.map((r) => r.naam)).toEqual(['Zeno Zwart', 'Yara IJsma', 'Xander Xaas', 'Wouter Wijn', 'Aad Speler 0'])

    render(<TopWorstAanwezigheid data={data} t={nl} />)
    expect(screen.getByText(nl.insights.topWorstOverlapHint)).toBeInTheDocument()
  })

  it('regressie: geen hardcoded hex-kleuren in de gerenderde markup', () => {
    const data = topWorstAanwezigheid(ROWS, 5)
    const { container } = render(<TopWorstAanwezigheid data={data} t={nl} />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('regressie (bron): geen hardcoded hex-kleuren in style={{...}}-blokken', () => {
    const source = readFileSync(path.join(process.cwd(), 'components/inzichten/TopWorstAanwezigheid.tsx'), 'utf-8')
    const styleBlocks = source.match(/style=\{\{[\s\S]*?\}\}/g) ?? []
    for (const block of styleBlocks) {
      expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
  })
})
