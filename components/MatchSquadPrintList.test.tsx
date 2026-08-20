import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Player } from '@/lib/types'
import MatchSquadPrintList from '@/components/MatchSquadPrintList'

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Piet Peters',
    position: 'Spits',
    secondary_positions: [],
    jersey_number: 9,
    active: true,
    injured: false,
    type: 'regular',
    rating: 5,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderPrintList(players: Player[]) {
  return render(
    <DictProvider dict={nl}>
      <MatchSquadPrintList
        players={players}
        opponent="FC Rivalen"
        dateLabel="zondag 9 augustus 2026"
        teamName="FC Voorbeeld"
        teamLogoUrl={null}
        homeAway="home"
        gatherTime="17:30"
        kickoffTime="19:00"
        selectedCount={players.length}
        formItems={[]}
        primaryColor="#004f3b"
        secondaryColor="#009966"
      />
    </DictProvider>,
  )
}

describe('Gast-suffix op de wedstrijdselectie-PDF', () => {
  it('toont "(Gast)" achter de naam van een gastspeler in de selectielijst', () => {
    const { container } = renderPrintList([
      makePlayer({ id: 'p1', name: 'Gast Speler', type: 'guest' }),
    ])
    const li = container.querySelector('li')
    expect(li?.textContent).toBe(`Gast Speler (${nl.players.guestBadge})`)
  })

  it('toont geen suffix bij een reguliere speler', () => {
    const { container } = renderPrintList([
      makePlayer({ id: 'p1', name: 'Reguliere Speler', type: 'regular' }),
    ])
    const li = container.querySelector('li')
    expect(li?.textContent).toBe('Reguliere Speler')
  })
})
