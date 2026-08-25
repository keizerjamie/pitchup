import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { nl } from '@/messages/nl'
import type { Player } from '@/lib/types'
import AttendanceSummary from '@/components/AttendanceSummary'

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
    rating: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('print-only Gast-label', () => {
  it('toont "(Gast)" achter de naam in het printblok voor zowel aanwezige als afwezige gasten', () => {
    const present = [makePlayer({ id: 'p1', name: 'Present Gast', type: 'guest' })]
    const absent = [makePlayer({ id: 'p2', name: 'Afwezige Gast', type: 'guest' })]
    render(<AttendanceSummary present={present} absent={absent} eventId="e1" t={nl} />)

    // Twee losse teksten (dual-markup: scherm-blok bevat de naam zonder
    // suffix, print-blok mét) — zoek specifiek op de print-suffix-tekst.
    expect(screen.getByText((_c, el) => el?.tagName === 'LI' && el.textContent?.replace(/\s+/g, ' ').trim() === `9 Present Gast (${nl.players.guestBadge})`)).toBeInTheDocument()
    expect(screen.getByText((_c, el) => el?.tagName === 'LI' && el.textContent?.replace(/\s+/g, ' ').trim() === `9 Afwezige Gast (${nl.players.guestBadge})`)).toBeInTheDocument()
  })

  it('toont geen "(Gast)"-suffix bij een reguliere speler', () => {
    const present = [makePlayer({ id: 'p1', name: 'Reguliere Speler', type: 'regular' })]
    render(<AttendanceSummary present={present} absent={[]} eventId="e1" t={nl} />)
    expect(screen.getByText((_c, el) => el?.tagName === 'LI' && el.textContent?.replace(/\s+/g, ' ').trim() === '9 Reguliere Speler')).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(`Reguliere Speler \\(${nl.players.guestBadge}\\)`))).not.toBeInTheDocument()
  })

  it('toont het scherm-blok (chips) zonder de "(Gast)"-tekst — alleen de voornaam in de chip', () => {
    const present = [makePlayer({ id: 'p1', name: 'Present Gast', type: 'guest' })]
    render(<AttendanceSummary present={present} absent={[]} eventId="e1" t={nl} />)
    // De chip toont alleen de voornaam, zonder suffix.
    expect(screen.getByText('Present')).toBeInTheDocument()
    expect(screen.queryByText('Present (Gast)')).not.toBeInTheDocument()
  })
})
