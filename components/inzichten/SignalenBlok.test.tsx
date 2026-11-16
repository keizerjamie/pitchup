import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { nl } from '@/messages/nl'
import type { Signaal } from '@/lib/inzichten'
import SignalenBlok from './SignalenBlok'
import type { Conclusie } from '@/lib/inzichten-indeling'

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

  describe('met bijlagen', () => {
    const conclusie: Conclusie = { signaalId: 'rating-daling', kaart: 'ratings', actie: 'spelers', zelfdeGrafiek: false }
    const kaarten = { ratings: <section data-testid="kaart">Ratingkaart</section> }

    it('toont tekst, kaart en actielink binnen de conclusielaag', () => {
      const { container } = render(<SignalenBlok signalen={[signaal]} bijlagen={{ conclusies: [conclusie], kaarten }} t={nl} />)
      const li = container.querySelector('[data-signaal="rating-daling"]') as HTMLElement
      expect(li.querySelector('[data-signaal-teken]')).not.toBeNull()
      expect(li.querySelector('[data-signaal-tekst]')?.textContent).toContain('De teamrating daalt')
      const kaartVak = li.querySelector('[data-signaal-kaart]') as HTMLElement
      expect(kaartVak).toContainElement(screen.getByTestId('kaart'))
      const link = screen.getByRole('link', { name: i.signaalActieSpelers })
      expect(link.getAttribute('href')).toBe('/players')
      expect(container.querySelector('[data-conclusielaag="signalen"]')).toContainElement(link)
    })

    it('linkt kalenderacties naar /events', () => {
      const kal: Conclusie = { signaalId: 'rating-daling', kaart: null, actie: 'kalender', zelfdeGrafiek: false }
      render(<SignalenBlok signalen={[signaal]} bijlagen={{ conclusies: [kal], kaarten: {} }} t={nl} />)
      expect(screen.getByRole('link', { name: i.signaalActieKalender }).getAttribute('href')).toBe('/events')
    })

    it('toont bij zelfdeGrafiek de verwijzing en geen tweede kaart', () => {
      const dubbel: Conclusie = { signaalId: 'rating-daling', kaart: null, actie: 'spelers', zelfdeGrafiek: true }
      const { container } = render(<SignalenBlok signalen={[signaal]} bijlagen={{ conclusies: [dubbel], kaarten }} t={nl} />)
      expect(screen.getByText(i.signaalZelfdeGrafiek)).toBeInTheDocument()
      expect(container.querySelector('[data-signaal-kaart]')).toBeNull()
      expect(screen.getByRole('link', { name: i.signaalActieSpelers })).toBeInTheDocument()
    })

    it('toont geen link en geen kaart bij een onbekende koppeling', () => {
      const onbekend: Conclusie = { signaalId: 'rating-daling', kaart: null, actie: null, zelfdeGrafiek: false }
      const { container } = render(<SignalenBlok signalen={[signaal]} bijlagen={{ conclusies: [onbekend], kaarten }} t={nl} />)
      expect(screen.queryByRole('link')).toBeNull()
      expect(container.querySelector('[data-signaal-kaart]')).toBeNull()
      expect(screen.getByText(/De teamrating daalt/)).toBeInTheDocument()
    })

    it('houdt de onvolledig-melding als laatste kind en zonder alert', () => {
      const { container } = render(
        <SignalenBlok signalen={[signaal]} onvolledig bijlagen={{ conclusies: [conclusie], kaarten }} t={nl} />,
      )
      const root = container.querySelector('[data-conclusielaag="signalen"]') as HTMLElement
      expect(root.lastElementChild?.tagName).toBe('P')
      expect(root.lastElementChild?.textContent).toBe(i.signalenOnvolledig)
      expect(container.querySelector('[role="alert"]')).toBeNull()
    })
  })
})
