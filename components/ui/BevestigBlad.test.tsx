import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import BevestigBlad from '@/components/ui/BevestigBlad'

function renderBlad(props: Partial<React.ComponentProps<typeof BevestigBlad>> = {}) {
  const onBevestig = vi.fn()
  const onAnnuleer = vi.fn()
  render(
    <DictProvider dict={nl}>
      <BevestigBlad
        titel="Zeker weten?"
        bevestigLabel="Ja, doen"
        annuleerLabel="Nee, laat maar"
        onBevestig={onBevestig}
        onAnnuleer={onAnnuleer}
        {...props}
      />
    </DictProvider>,
  )
  return { onBevestig, onAnnuleer }
}

describe('BevestigBlad', () => {
  it('toont een dialoog met titel, optionele tekst en twee knoppen met eigen labels', () => {
    renderBlad({ tekst: 'Dit kan niet terug.' })
    const dialoog = screen.getByRole('dialog', { name: 'Zeker weten?' })
    expect(dialoog).toBeInTheDocument()
    expect(screen.getByText('Dit kan niet terug.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ja, doen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nee, laat maar' })).toBeInTheDocument()
  })

  it('zet annuleren links en bevestigen rechts', () => {
    renderBlad()
    const knoppen = screen.getAllByRole('button').filter((b) => ['Ja, doen', 'Nee, laat maar'].includes(b.textContent ?? ''))
    expect(knoppen.map((b) => b.textContent)).toEqual(['Nee, laat maar', 'Ja, doen'])
  })

  it('roept onBevestig bij bevestigen en onAnnuleer bij annuleren', () => {
    const { onBevestig, onAnnuleer } = renderBlad()
    fireEvent.click(screen.getByRole('button', { name: 'Ja, doen' }))
    expect(onBevestig).toHaveBeenCalledTimes(1)
    expect(onAnnuleer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Nee, laat maar' }))
    expect(onAnnuleer).toHaveBeenCalledTimes(1)
  })

  it('de sluitknop van het blad geldt als annuleren', () => {
    const { onAnnuleer, onBevestig } = renderBlad()
    fireEvent.click(screen.getByRole('button', { name: nl.common.close }))
    expect(onAnnuleer).toHaveBeenCalledTimes(1)
    expect(onBevestig).not.toHaveBeenCalled()
  })

  it('gevaar kleurt de bevestigknop als destructief', () => {
    renderBlad({ gevaar: true })
    expect(screen.getByRole('button', { name: 'Ja, doen' }).className).toContain('btn-danger')
    expect(screen.getByRole('button', { name: 'Nee, laat maar' }).className).not.toContain('btn-danger')
  })

  it('zonder gevaar is de bevestigknop primair', () => {
    renderBlad()
    expect(screen.getByRole('button', { name: 'Ja, doen' }).className).toContain('btn-primary')
  })

  it('nadruk="annuleer": annuleren primair, bevestigen secundair met rode tekst en rand (niet gevuld)', () => {
    const { onBevestig, onAnnuleer } = renderBlad({ gevaar: true, nadruk: 'annuleer' })
    const annuleer = screen.getByRole('button', { name: 'Nee, laat maar' })
    const bevestig = screen.getByRole('button', { name: 'Ja, doen' })
    expect(annuleer.className).toContain('btn-primary')
    expect(bevestig.className).not.toContain('btn-danger')
    expect(bevestig.className).toContain('btn-secondary')
    expect(bevestig.style.color).toBe('var(--danger)')
    const knoppen = screen.getAllByRole('button').filter((b) => ['Ja, doen', 'Nee, laat maar'].includes(b.textContent ?? ''))
    expect(knoppen.map((b) => b.textContent)).toEqual(['Nee, laat maar', 'Ja, doen'])
    fireEvent.click(bevestig)
    expect(onBevestig).toHaveBeenCalledTimes(1)
    fireEvent.click(annuleer)
    expect(onAnnuleer).toHaveBeenCalledTimes(1)
  })
})
