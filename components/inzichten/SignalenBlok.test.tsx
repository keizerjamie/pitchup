import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { nl } from '@/messages/nl'
import type { Signaal } from '@/lib/inzichten'
import SignalenBlok from './SignalenBlok'

const i = nl.insights
const signaal: Signaal = {
  id: 'rating-daling',
  toon: 'letop',
  tekstSleutel: 'signaalRatingDaling',
  waarden: { verschil: '0.5', venster: 5 },
}

describe('SignalenBlok', () => {
  it('rendert niets bij nul signalen en niet onvolledig', () => {
    const { container } = render(<SignalenBlok signalen={[]} t={nl} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('toont bij nul signalen en onvolledig alleen de melding, zonder lijst', () => {
    const { container } = render(<SignalenBlok signalen={[]} onvolledig t={nl} />)
    expect(screen.getByText(i.signalenOnvolledig)).toBeInTheDocument()
    expect(container.querySelector('[data-conclusielaag="signalen"]')).not.toBeNull()
    expect(container.querySelector('li')).toBeNull()
  })

  it('zet de melding onder de signalen, als meta-regel zonder alert', () => {
    const { container } = render(<SignalenBlok signalen={[signaal]} onvolledig t={nl} />)
    const melding = screen.getByText(i.signalenOnvolledig)
    const lijst = container.querySelector('ul') as HTMLElement
    expect(lijst.compareDocumentPosition(melding) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(melding.getAttribute('role')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelectorAll('li')).toHaveLength(1)
    expect(melding.getAttribute('style')).toContain('border-top')
  })

  it('toont zonder onvolledig geen melding', () => {
    render(<SignalenBlok signalen={[signaal]} t={nl} />)
    expect(screen.queryByText(i.signalenOnvolledig)).toBeNull()
    expect(screen.getByText('De teamrating daalt met 0.5 over de laatste 5 wedstrijden.')).toBeInTheDocument()
  })
})
