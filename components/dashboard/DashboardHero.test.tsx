import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DashboardHero from '@/components/dashboard/DashboardHero'
import { nl } from '@/messages/nl'
import type { FootballEvent } from '@/lib/types'

const event = {
  id: 'ev1', team_id: 'team1', type: 'training', date: '2099-01-10', time: '19:30', location: 'Sportpark Noord',
} as unknown as FootballEvent

type Telling = { present: number; absent: number; injured: number; squadSize: number }

function renderHero(
  telling: Telling | null,
  o: { vandaag?: string; tone?: 'normaal' | 'probleem' | 'klaar'; eyebrow?: string; ev?: FootballEvent } = {},
) {
  return render(
    <DashboardHero
      event={o.ev ?? event}
      vandaag={o.vandaag ?? '2099-01-09'}
      eyebrow={o.eyebrow ?? nl.vandaag.eyebrowTodo}
      tone={o.tone ?? 'normaal'}
      title="Training morgen"
      t={nl}
      telling={telling}
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

describe('DashboardHero — hoofdkaart', () => {
  it('rel komt uit de vandaag-prop: dag erna = Morgen, dezelfde dag = Vandaag, gisteren = Gisteren', () => {
    const { unmount } = renderHero({ present: 1, absent: 0, injured: 0, squadSize: 2 }, { vandaag: '2099-01-09' })
    expect(screen.getAllByText(nl.dashboard.tomorrow).length).toBeGreaterThan(0)
    unmount()
    const b = renderHero({ present: 1, absent: 0, injured: 0, squadSize: 2 }, { vandaag: '2099-01-10' })
    expect(screen.getAllByText(nl.dashboard.today).length).toBeGreaterThan(0)
    b.unmount()
    renderHero({ present: 1, absent: 0, injured: 0, squadSize: 2 }, { vandaag: '2099-01-11' })
    expect(screen.getAllByText(nl.vandaag.whenYesterdayCap).length).toBeGreaterThan(0)
  })

  it('zonder telling: geen ring, geen "x/y aanwezig", geen aanmeldblok; knop blijft', () => {
    const { container } = renderHero(null)
    expect(screen.queryByText(new RegExp(`^\\d+/\\d+ ${nl.home.present}$`))).not.toBeInTheDocument()
    expect(screen.queryByText(nl.home.signups)).not.toBeInTheDocument()
    expect(container.querySelector('[style*="conic-gradient"]')).toBeNull()
    expect(container.textContent).not.toContain('NaN')
    expect(screen.getAllByRole('link', { name: new RegExp(nl.home.makeTrainingPlan) })).toHaveLength(2)
  })

  it('mobiele regel blijft exact "x/y aanwezig"; onbekend staat in een losse span en alleen bij > 0', () => {
    const { unmount } = renderHero({ present: 19, absent: 0, injured: 0, squadSize: 21 })
    expect(screen.getByText(`19/21 ${nl.home.present}`)).toBeInTheDocument()
    expect(screen.getByText(`· ${nl.vandaag.unknownCount.replace('{n}', '2')}`)).toBeInTheDocument()
    unmount()
    renderHero({ present: 21, absent: 0, injured: 0, squadSize: 21 })
    expect(screen.getByText(`21/21 ${nl.home.present}`)).toBeInTheDocument()
    expect(screen.queryByText(/onbekend/)).not.toBeInTheDocument()
  })

  it('eyebrow-chip: normaal groen, probleem oranje, klaar met check-icoon', () => {
    const { unmount } = renderHero(null, { tone: 'normaal' })
    const normaal = screen.getAllByText(nl.vandaag.eyebrowTodo)[0]
    expect(normaal).toHaveStyle({ color: '#4ade80' })
    unmount()
    const p = renderHero(null, { tone: 'probleem', eyebrow: 'Opstelling mist 2 posities' })
    expect(screen.getAllByText('Opstelling mist 2 posities')[0]).toHaveStyle({ color: '#fdba74' })
    p.unmount()
    renderHero(null, { tone: 'klaar', eyebrow: nl.vandaag.eyebrowAllDone })
    const klaar = screen.getAllByText(nl.vandaag.eyebrowAllDone)[0]
    expect(klaar.querySelector('.ms')?.textContent).toBe('check')
    expect(klaar.querySelector('.ms')).toHaveAttribute('aria-hidden', 'true')
  })

  it('toont de titel van de pagina', () => {
    renderHero(null)
    expect(screen.getAllByText('Training morgen').length).toBeGreaterThan(0)
  })
})
