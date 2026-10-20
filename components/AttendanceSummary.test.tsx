import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
    render(<AttendanceSummary present={present} absent={absent} injured={[]} eventId="e1" t={nl} />)

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
    render(<AttendanceSummary present={present} absent={[]} injured={[]} eventId="e1" t={nl} />)
    expect(screen.getByText((_c, el) => el?.tagName === 'LI' && el.textContent?.replace(/\s+/g, ' ').trim() === '9 Reguliere Speler')).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(`Reguliere Speler \\(${nl.players.guestBadge}\\)`))).not.toBeInTheDocument()
  })

  it('toont het scherm-blok (chips) zonder de "(Gast)"-tekst — alleen de voornaam in de chip', () => {
    const present = [makePlayer({ id: 'p1', name: 'Present Gast', type: 'guest' })]
    render(<AttendanceSummary present={present} absent={[]} injured={[]} eventId="e1" t={nl} />)
    // De chip toont alleen de voornaam, zonder suffix.
    expect(screen.getByText('Present')).toBeInTheDocument()
    expect(screen.queryByText('Present (Gast)')).not.toBeInTheDocument()
  })
})

// ── Blessure als eigen status (injured) ──
describe('geblesseerde spelers', () => {
  const present = [makePlayer({ id: 'p1', name: 'Aanwezig Aad', jersey_number: 1 })]
  const absent = [makePlayer({ id: 'p2', name: 'Afwezig Bas', jersey_number: 2 })]
  const injured = [makePlayer({ id: 'p3', name: 'Blessure Cor', jersey_number: 3, injured: true })]

  it('scherm: toont een blok "Geblesseerd (n)" met een chip in de rode tone, apart van Afwezig', () => {
    const { container } = render(<AttendanceSummary present={present} absent={absent} injured={injured} eventId="e1" t={nl} />)
    const screenBlock = container.querySelector('.print\\:hidden') as HTMLElement
    const kop = within(screenBlock).getByText(`${nl.event.injuredStat} (1)`)
    expect(kop).toBeInTheDocument()
    const chip = within(screenBlock).getByText('Blessure')
    expect(chip.className).toContain('bg-panel-red')
    expect(chip.className).toContain('text-panel-red-ink')
    expect(chip.className).toContain('border-panel-red-edge')
    expect(within(chip).getByText('healing')).toBeInTheDocument()
    // Afwezig-blok blijft apart
    expect(within(screenBlock).getByText(`${nl.event.absentStat} (1)`)).toBeInTheDocument()
  })

  it('scherm: de teller is aanwezig/(aanwezig+afwezig+geblesseerd)', () => {
    const { container } = render(<AttendanceSummary present={present} absent={absent} injured={injured} eventId="e1" t={nl} />)
    const screenBlock = container.querySelector('.print\\:hidden') as HTMLElement
    expect(within(screenBlock).getByText('1/3')).toBeInTheDocument()
  })

  it('print: een derde lijst "Geblesseerd (n)" met rugnummer en naam', () => {
    const { container } = render(<AttendanceSummary present={present} absent={absent} injured={injured} eventId="e1" t={nl} />)
    const printBlock = container.querySelector('.print\\:block') as HTMLElement
    expect(within(printBlock).getByText(`${nl.event.injuredStat} (1)`)).toBeInTheDocument()
    expect(within(printBlock).getByText((_c, el) => el?.tagName === 'LI' && el.textContent?.replace(/\s+/g, ' ').trim() === '3 Blessure Cor')).toBeInTheDocument()
    expect(within(printBlock).getByText(`${nl.event.attendance} (1/3)`)).toBeInTheDocument()
  })

  it('zonder geblesseerden: geen blok Geblesseerd op scherm of in print', () => {
    render(<AttendanceSummary present={present} absent={absent} injured={[]} eventId="e1" t={nl} />)
    expect(screen.queryByText(new RegExp(`^${nl.event.injuredStat} \\(`))).not.toBeInTheDocument()
  })
})
