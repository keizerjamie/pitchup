// Acceptatietest — Hero-tegel op het dashboard is op mobiel in zijn geheel
// tikbaar naar de eventpagina (aanwezigheid), terwijl de primaire knop
// ("Training maken" / "Opstelling maken") een eigen doel houdt.
//
// Testmethode: rendert de ECHTE DashboardHero (components/dashboard/
// DashboardHero.tsx) rechtstreeks met RTL, zonder mocks — het component is
// puur presentationeel. Layout-varianten (mobiel/desktop) leven in dezelfde
// DOM en worden via Tailwind-klassen (lg:hidden / hidden lg:flex)
// omgeschakeld; jsdom rekent geen CSS door, dus de test toetst de
// klassen-contracten en de DOM-structuur (geen geneste <a> in <a>).

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DashboardHero from '@/components/dashboard/DashboardHero'
import { nl } from '@/messages/nl'
import type { FootballEvent } from '@/lib/types'

const event = {
  id: 'ev1',
  team_id: 'team1',
  type: 'training',
  date: '2099-01-10',
  time: '19:30',
  location: 'Sportpark Noord',
} as unknown as FootballEvent

function renderHero() {
  return render(
    <DashboardHero
      event={event}
      kind="training"
      title="Training"
      t={nl}
      present={9}
      absent={2}
      squadSize={14}
      primaryHref="/events/ev1/training-plan"
      primaryLabel={nl.home.makeTrainingPlan}
      primaryIcon="assignment"
      secondaryHref="/events/ev1"
      secondaryLabel={nl.home.viewEvent}
    />
  )
}

describe('Hero-tegel: tik op de tegel opent het event (mobiel)', () => {
  it('heeft een uitgerekte link over de hele tegel naar /events/[id], alleen op mobiel', () => {
    renderHero()
    const tile = screen.getByTestId('hero-tile-link')
    expect(tile.tagName).toBe('A')
    expect(tile).toHaveAttribute('href', '/events/ev1')
    // Toegankelijke naam: het is een lege <a>, dus het label moet expliciet zijn.
    expect(tile).toHaveAttribute('aria-label', nl.home.viewEvent)
    // Vult de hele tegel en is op desktop verborgen (daar staat de losse knop).
    for (const cls of ['absolute', 'inset-0', 'lg:hidden', 'z-[1]']) {
      expect(tile.classList.contains(cls), `verwacht klasse ${cls}`).toBe(true)
    }
  })

  it('houdt de primaire knop als eigen link bóven de tegel-link (geen geneste <a>)', () => {
    renderHero()
    const primaries = screen.getAllByRole('link', { name: new RegExp(nl.home.makeTrainingPlan) })
    // Eén per layout (mobiel + desktop); beide naar het trainingsplan.
    expect(primaries.length).toBe(2)
    for (const a of primaries) expect(a).toHaveAttribute('href', '/events/ev1/training-plan')
    const mobilePrimary = primaries.find((a) => a.classList.contains('z-[2]'))
    expect(mobilePrimary, 'mobiele knop moet z-[2] hebben om boven de tegel-link te liggen').toBeTruthy()
    expect(mobilePrimary!.classList.contains('relative')).toBe(true)
    // Geen <a> binnen een <a>: de tegel-link is leeg en de knop is geen kind ervan.
    const tile = screen.getByTestId('hero-tile-link')
    expect(tile.querySelector('a')).toBeNull()
    expect(tile.contains(mobilePrimary!)).toBe(false)
  })

  it('desktop houdt de losse "Bekijk event"-knop naar dezelfde eventpagina', () => {
    renderHero()
    const links = screen.getAllByRole('link', { name: new RegExp(nl.home.viewEvent) })
    // Tegel-link (mobiel) + secundaire knop (desktop).
    expect(links.length).toBe(2)
    for (const a of links) expect(a).toHaveAttribute('href', '/events/ev1')
  })
})
