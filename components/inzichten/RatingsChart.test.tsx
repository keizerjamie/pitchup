import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { nl } from '@/messages/nl'
import RatingsChart from '@/components/inzichten/RatingsChart'
import type { TeamRatingRij, SpelerOptie } from '@/lib/inzichten'

vi.mock('@/app/actions/inzichten', () => ({
  getSpelerRatingReeks: vi.fn(),
}))

import { getSpelerRatingReeks } from '@/app/actions/inzichten'
const mockGetReeks = getSpelerRatingReeks as unknown as ReturnType<typeof vi.fn>

const TEAM_DATA: TeamRatingRij[] = [
  { event_id: 'e1', datum: '2026-09-05', tegenstander: 'DVC', gemiddelde: 7.2, aantal: 11 },
  { event_id: 'e2', datum: '2026-09-12', tegenstander: 'FC Oost', gemiddelde: 6.8, aantal: 10 },
]

const SPELERS: SpelerOptie[] = [
  { id: 'p1', name: 'Piet Peters' },
  { id: 'p2', name: 'Jan Jansen' },
]

async function selectPlayer(name: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(nl.insights.spelerSelectLabel), {
      target: { value: SPELERS.find((s) => s.name === name)!.id },
    })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RatingsChart', () => {
  it('toont de teamrating-grafiek met role="img", een niet-lege aria-label, en de waarden ook als tekst (sr-only tabel)', () => {
    render(<RatingsChart teamData={TEAM_DATA} spelers={SPELERS} t={nl} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBeTruthy()
    expect(screen.getAllByText(/5 sep/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('7.2').length).toBeGreaterThan(0)
  })

  it('inactieve spelers komen niet in de selector voor (props bevatten alleen wat de pagina meegeeft)', () => {
    render(<RatingsChart teamData={TEAM_DATA} spelers={[{ id: 'p1', name: 'Piet Peters' }]} t={nl} />)
    expect(screen.queryByText('Jan Jansen')).toBeNull()
  })

  it('spelerkeuze roept de server action aan met het juiste speler-id en toont de reeks', async () => {
    mockGetReeks.mockResolvedValue([
      { event_id: 'e1', datum: '2026-09-05', tegenstander: 'DVC', rating: 8 },
    ])
    render(<RatingsChart teamData={TEAM_DATA} spelers={SPELERS} t={nl} />)

    await selectPlayer('Piet Peters')

    expect(mockGetReeks).toHaveBeenCalledWith('p1')
    expect(screen.getAllByRole('img')).toHaveLength(2) // team + speler
  })

  it('lege reeks (geldige lege array) → lege staat, geen foutmelding', async () => {
    mockGetReeks.mockResolvedValue([])
    render(<RatingsChart teamData={TEAM_DATA} spelers={SPELERS} t={nl} />)

    await selectPlayer('Jan Jansen')

    expect(screen.getByText(nl.insights.spelerEmpty)).toBeInTheDocument()
    expect(screen.queryByText(nl.insights.spelerError)).toBeNull()
  })

  it('server action gooit → generieke foutstaat, nooit de ruwe melding', async () => {
    mockGetReeks.mockRejectedValue(new Error('Speler niet gevonden'))
    render(<RatingsChart teamData={TEAM_DATA} spelers={SPELERS} t={nl} />)

    await selectPlayer('Piet Peters')

    expect(screen.getByText(nl.insights.spelerError)).toBeInTheDocument()
    expect(screen.queryByText('Speler niet gevonden')).toBeNull()
  })

  it('teamData leeg → lege staat voor de hele kaart', () => {
    render(<RatingsChart teamData={[]} spelers={SPELERS} t={nl} />)
    expect(screen.getByText(nl.insights.ratingsEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  // Dekt hex in SVG-presentatie-attributen (bv. recharts' eigen fill/stroke-
  // defaults). Dekt NIET inline style-props: jsdom normaliseert die altijd
  // naar rgb() zodra React ze als style-object zet, dus een hex-literal als
  // `style={{ color: '#fff' }}` verschijnt hier nooit als hex in de HTML —
  // zie de bron-check hieronder die dat gat wél dicht.
  it('regressie: geen hardcoded hex-kleuren in de gerenderde markup', () => {
    const { container } = render(<RatingsChart teamData={TEAM_DATA} spelers={SPELERS} t={nl} />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  // Bron-check: leest het componentbestand zelf, niet de gerenderde DOM.
  // Nodig omdat jsdom elke `style={{ ... }}`-kleur normaliseert naar rgb()
  // (geverifieerd: een hex-literal in een React style-object verschijnt nooit
  // als hex in container.innerHTML), waardoor de DOM-based test hierboven
  // blind is voor hardcoded hex in inline style-attributen.
  it('regressie (bron): geen hardcoded hex-kleuren in style={{...}}-blokken', () => {
    const source = readFileSync(path.join(process.cwd(), 'components/inzichten/RatingsChart.tsx'), 'utf-8')
    const styleBlocks = source.match(/style=\{\{[\s\S]*?\}\}/g) ?? []
    for (const block of styleBlocks) {
      expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
  })
})
