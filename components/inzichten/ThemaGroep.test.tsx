import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { nl } from '@/messages/nl'
import ThemaGroep from './ThemaGroep'

const i = nl.insights

function groep(props: Partial<React.ComponentProps<typeof ThemaGroep>> = {}) {
  return (
    <ThemaGroep sleutel="team" titel="Team" aantal={3} onvolledig={0} standaardOpen={false} resetSleutel="seizoen" t={nl} {...props}>
      <p>kaartinhoud</p>
    </ThemaGroep>
  )
}

describe('ThemaGroep', () => {
  it('rendert een details met summary en titel, zonder koppen-element', () => {
    const { container } = render(groep())
    const details = container.querySelector('details[data-thema="team"]') as HTMLDetailsElement
    expect(details).not.toBeNull()
    expect(details.querySelector('summary')).not.toBeNull()
    expect(screen.getByText('Team')).toBeInTheDocument()
    expect(container.querySelector('h1,h2,h3,h4')).toBeNull()
  })

  it('toont enkelvoud en meervoud van het aantal', () => {
    const { rerender } = render(groep({ aantal: 1 }))
    expect(screen.getByText(i.themaAantalEen)).toBeInTheDocument()
    rerender(groep({ aantal: 5 }))
    expect(screen.getByText(i.themaAantal.replace('{n}', '5'))).toBeInTheDocument()
  })

  it('toont onvolledig alleen bij n > 0 en zonder role=alert', () => {
    const { container, rerender } = render(groep({ onvolledig: 0 }))
    expect(container.querySelectorAll('[data-themameta]')).toHaveLength(1)
    rerender(groep({ onvolledig: 2 }))
    expect(container.querySelectorAll('[data-themameta]')).toHaveLength(2)
    expect(screen.getByText(i.themaOnvolledig.replace('{n}', '2'))).toBeInTheDocument()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('houdt de kinderen in de DOM als het thema dicht is', () => {
    const { container } = render(groep({ standaardOpen: false }))
    expect(screen.getByText('kaartinhoud')).toBeInTheDocument()
    expect((container.querySelector('details') as HTMLDetailsElement).open).toBe(false)
  })

  it('staat open volgens standaardOpen', () => {
    const { container } = render(groep({ standaardOpen: true }))
    expect((container.querySelector('details') as HTMLDetailsElement).open).toBe(true)
  })

  it('zet de standaardstand terug bij een nieuwe resetSleutel, zonder remount', () => {
    const { container, rerender } = render(groep({ standaardOpen: false, resetSleutel: 'seizoen' }))
    const details = container.querySelector('details') as HTMLDetailsElement
    details.open = true
    rerender(groep({ standaardOpen: false, resetSleutel: '4w' }))
    const na = container.querySelector('details') as HTMLDetailsElement
    expect(na).toBe(details)
    expect(na.open).toBe(false)
  })

  it('laat de stand ongemoeid zolang resetSleutel gelijk blijft', () => {
    const { container, rerender } = render(groep({ standaardOpen: false, resetSleutel: 'seizoen' }))
    const details = container.querySelector('details') as HTMLDetailsElement
    details.open = true
    rerender(groep({ standaardOpen: false, resetSleutel: 'seizoen' }))
    expect(details.open).toBe(true)
  })
})
