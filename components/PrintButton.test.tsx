import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import PrintButton from '@/components/PrintButton'

describe('PrintButton', () => {
  // Expliciete signatuur: vitest 4 typeert een generieke vi.fn() als
  // Procedure | Constructable, wat niet op window.print past.
  let printSpy: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    printSpy = vi.fn<() => void>()
    window.print = printSpy
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderButton() {
    return render(
      <DictProvider dict={nl}>
        <PrintButton />
      </DictProvider>,
    )
  }

  it('toont een knop met het label uit de dictionary', () => {
    renderButton()
    expect(screen.getByRole('button', { name: nl.trainingPlan.print })).toBeInTheDocument()
  })

  it('roept window.print() precies één keer aan bij een klik, zonder navigatie', () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
    expect(printSpy).toHaveBeenCalledTimes(1)
  })

  it('is een knop van type "button" (geen submit, geen link/navigatie)', () => {
    renderButton()
    const button = screen.getByRole('button', { name: nl.trainingPlan.print })
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
  })

  it('is verborgen op de afdruk zelf (print:hidden) — de knop is bedieningselement, geen inhoud', () => {
    renderButton()
    const button = screen.getByRole('button', { name: nl.trainingPlan.print })
    expect(button.className).toContain('print:hidden')
  })

  it('zonder disabled-prop: ongewijzigd gedrag — knop is niet disabled', () => {
    renderButton()
    const button = screen.getByRole('button', { name: nl.trainingPlan.print })
    expect(button).not.toBeDisabled()
  })

  describe('iOS-beginscherm-app (navigator.standalone)', () => {
    let openSpy: ReturnType<typeof vi.fn<typeof window.open>>

    beforeEach(() => {
      openSpy = vi.fn<typeof window.open>()
      window.open = openSpy
      Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true })
    })

    afterEach(() => {
      delete (window.navigator as Navigator & { standalone?: boolean }).standalone
    })

    it('opent de huidige pagina in een nieuwe (Safari-)weergave in plaats van window.print()', () => {
      renderButton()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
      expect(openSpy).toHaveBeenCalledTimes(1)
      expect(openSpy).toHaveBeenCalledWith(window.location.href, '_blank', 'noopener')
      expect(printSpy).not.toHaveBeenCalled()
    })

    it('navigator.standalone === false (Safari zelf): gewoon window.print()', () => {
      Object.defineProperty(window.navigator, 'standalone', { value: false, configurable: true })
      renderButton()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
      expect(printSpy).toHaveBeenCalledTimes(1)
      expect(openSpy).not.toHaveBeenCalled()
    })
  })

  it('disabled={true}: de knop heeft het disabled-attribuut en een klik roept window.print() niet aan', () => {
    render(
      <DictProvider dict={nl}>
        <PrintButton disabled />
      </DictProvider>,
    )
    const button = screen.getByRole('button', { name: nl.trainingPlan.print })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(printSpy).not.toHaveBeenCalled()
  })
})
