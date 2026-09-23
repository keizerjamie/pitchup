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

// ── COMPONENTCONTRACT (bijgewerkt voor de gastspelers-uit-afwezigheidscijfers
// feature, zie BRIEF.md sectie "5.4 components/AttendanceSummary.tsx — BEWUST
// ONGEWIJZIGD") ──
// AttendanceSummary rendert domweg de `present`/`absent`-props die het
// krijgt, inclusief het "(Gast)"-printlabel voor elke speler met
// `type === 'guest'` — de component filtert zelf GEEN gasten weg, ook niet
// een afwezige gast in de `absent`-prop. Dat weglaten is de verantwoordelijk-
// heid van de AANROEPER: `splitsAanwezigheid` (lib/aanwezigheid-telling.ts)
// haalt afwezige/onbekende gasten er al vóór het doorgeven uit. Deze test
// bewijst dus uitsluitend het componentcontract ("ik render wat je me geeft,
// ik ken zelf geen gast-regel") — géén acceptatiecriterium op zich. Dat
// AttendanceSummary in de ECHTE trainingsplan-pagina nooit een afwezige gast
// te zien krijgt, staat in gastspelers.acceptance.test.tsx, describe-blok
// "AC15/AC3 — ...", met name de test "AC3 — een AFWEZIGE gast staat NERGENS
// in het printblok...".
describe('componentcontract — AttendanceSummary rendert wat het krijgt, filtert zelf niet', () => {
  it('geeft de "(Gast)"-suffix in het printblok door voor élke speler met type "guest" in de meegegeven props, ook als de aanroeper (per ongeluk) een afwezige gast in `absent` zou doorgeven', () => {
    const present = [makePlayer({ id: 'p1', name: 'Present Gast', type: 'guest' })]
    const absent = [makePlayer({ id: 'p2', name: 'Afwezige Gast', type: 'guest' })]
    render(<AttendanceSummary present={present} absent={absent} eventId="e1" t={nl} />)

    // Twee losse teksten (dual-markup: scherm-blok bevat de naam zonder
    // suffix, print-blok mét) — zoek specifiek op de print-suffix-tekst. Dit
    // bewijst NIET dat een afwezige gast in het echt in `absent` terechtkomt
    // (dat voorkomt splitsAanwezigheid vóór deze component wordt aangeroepen,
    // zie AC3 hierboven) — alleen dat de component zelf geen tweede filter
    // toepast.
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
