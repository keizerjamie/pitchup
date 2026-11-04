import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DashboardHero from '@/components/dashboard/DashboardHero'
import { nl } from '@/messages/nl'
import type { FootballEvent } from '@/lib/types'

const event = {
  id: 'ev1', team_id: 'team1', type: 'training', date: '2099-01-10', time: '19:30', location: 'Sportpark Noord',
} as unknown as FootballEvent

function renderHero(o: { present: number; absent: number; injured: number; squadSize: number }) {
  return render(
    <DashboardHero
      event={event}
      kind="training"
      title="Training"
      t={nl}
      {...o}
      primaryHref="/events/ev1/training-plan"
      primaryLabel={nl.home.makeTrainingPlan}
      primaryIcon="assignment"
      secondaryHref="/events/ev1"
      secondaryLabel={nl.home.viewEvent}
    />,
  )
}

// De desktop-legenda rendert "<n> <label>" als eigen tekstnode.
// textContent van de rij bevat bij geblesseerd ook de (decoratieve) icoontekst,
// dus lees alleen de eigen tekstnode.
const legenda = (label: string) =>
  Array.from(screen.getByText(new RegExp(`^\\d+ ${label}$`)).childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join('')

describe('DashboardHero — legenda met geblesseerden', () => {
  it('19 aanwezig / 1 afwezig / 10 geblesseerd / 0 nog niet gereageerd (30 spelers)', () => {
    renderHero({ present: 19, absent: 1, injured: 10, squadSize: 30 })
    expect(legenda(nl.home.present)).toBe(`19 ${nl.home.present}`)
    expect(legenda(nl.home.absent)).toBe(`1 ${nl.home.absent}`)
    expect(legenda(nl.home.injuredLegend)).toBe(`10 ${nl.home.injuredLegend}`)
    expect(legenda(nl.home.noResponse)).toBe(`0 ${nl.home.noResponse}`)
    // Geblesseerden zijn niet langer bij "afwezig" opgeteld.
    expect(screen.queryByText(`11 ${nl.home.absent}`)).not.toBeInTheDocument()
  })

  it('de ring blijft x/y van de aanmeldingen: 19 van 30', () => {
    renderHero({ present: 19, absent: 1, injured: 10, squadSize: 30 })
    expect(screen.getByText(nl.home.ofCount.replace('{n}', '30'))).toBeInTheDocument()
  })

  it('geblesseerd krijgt een healing-icoon (decoratief) in plaats van een stip', () => {
    renderHero({ present: 1, absent: 0, injured: 2, squadSize: 3 })
    const regel = screen.getByText(`2 ${nl.home.injuredLegend}`)
    const icoon = regel.querySelector('span.ms')
    expect(icoon?.textContent).toBe('healing')
    expect(icoon).toHaveAttribute('aria-hidden', 'true')
  })

  it('volgorde: aanwezig, afwezig, geblesseerd, nog niet gereageerd', () => {
    renderHero({ present: 4, absent: 3, injured: 2, squadSize: 12 })
    const regels = [nl.home.present, nl.home.absent, nl.home.injuredLegend, nl.home.noResponse]
      .map((l) => screen.getByText(new RegExp(`^\\d+ ${l}$`)))
    for (let i = 0; i < regels.length - 1; i++) {
      expect(regels[i].compareDocumentPosition(regels[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(legenda(nl.home.noResponse)).toBe(`3 ${nl.home.noResponse}`)
  })

  it('nog niet gereageerd wordt nooit negatief en squadSize 0 geeft geen NaN/deling door nul', () => {
    const { container } = renderHero({ present: 0, absent: 1, injured: 1, squadSize: 0 })
    expect(legenda(nl.home.noResponse)).toBe(`0 ${nl.home.noResponse}`)
    expect(container.textContent).not.toContain('NaN')
  })
})
