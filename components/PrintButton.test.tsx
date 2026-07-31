import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import PrintButton from '@/components/PrintButton'

describe('PrintButton', () => {
  let printSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    printSpy = vi.fn()
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
})
