import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-policy'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))

const updatePassword = vi.fn()
vi.mock('@/app/actions/auth', () => ({ updatePassword: (...args: unknown[]) => updatePassword(...args) }))

import ResetPasswordPage from '@/app/reset-password/page'

function renderPage() {
  return render(
    <DictProvider dict={nl}>
      <ResetPasswordPage />
    </DictProvider>,
  )
}

function fillAndSubmit(password: string) {
  fireEvent.change(screen.getByPlaceholderText(nl.auth.passwordMinLength), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: nl.auth.updatePassword }))
}

beforeEach(() => {
  replace.mockClear()
  updatePassword.mockReset()
})

describe('ResetPasswordPage', () => {
  it('koppelt de minimale wachtwoordlengte van het invoerveld aan MIN_PASSWORD_LENGTH (geen losstaande hardcoded waarde)', () => {
    renderPage()
    const input = screen.getByPlaceholderText(nl.auth.passwordMinLength)
    expect(input).toHaveAttribute('minlength', String(MIN_PASSWORD_LENGTH))
  })

  it('toont de wachtwoord-hint uit de vertaaltabel (huidige minimumlengte)', () => {
    renderPage()
    expect(screen.getByPlaceholderText(`Minimaal ${MIN_PASSWORD_LENGTH} tekens`)).toBeInTheDocument()
  })

  describe('geslaagde wachtwoordwijziging', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
    afterEach(() => vi.useRealTimers())

    it('toont een bevestiging en navigeert daarna terug naar de startpagina', async () => {
      updatePassword.mockResolvedValue({ error: null })
      renderPage()

      fillAndSubmit('een-geldig-nieuw-wachtwoord')

      await waitFor(() => expect(screen.getByText(nl.auth.passwordUpdated)).toBeInTheDocument())
      expect(updatePassword).toHaveBeenCalledTimes(1)
      expect(replace).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1500)
      expect(replace).toHaveBeenCalledWith('/')
    })
  })

  it('toont de server-side foutmelding uit het action-contract en navigeert niet', async () => {
    updatePassword.mockResolvedValue({ error: 'Wachtwoord bijwerken is niet gelukt. Probeer het opnieuw.' })
    renderPage()

    fillAndSubmit('een-geldig-nieuw-wachtwoord')

    await waitFor(() =>
      expect(screen.getByText('Wachtwoord bijwerken is niet gelukt. Probeer het opnieuw.')).toBeInTheDocument(),
    )
    expect(screen.queryByText(nl.auth.passwordUpdated)).not.toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })
})
