import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-policy'

vi.mock('@/app/actions/auth', () => ({ signUp: vi.fn() }))

import RegisterPage from '@/app/register/page'

function renderPage() {
  return render(
    <DictProvider dict={nl}>
      <RegisterPage />
    </DictProvider>,
  )
}

describe('RegisterPage', () => {
  it('koppelt de minimale wachtwoordlengte van het invoerveld aan MIN_PASSWORD_LENGTH (geen losstaande hardcoded waarde)', () => {
    renderPage()
    const input = screen.getByPlaceholderText(nl.auth.passwordMinLength)
    expect(input).toHaveAttribute('minlength', String(MIN_PASSWORD_LENGTH))
  })

  it('toont de wachtwoord-hint uit de vertaaltabel (huidige minimumlengte)', () => {
    renderPage()
    expect(screen.getByPlaceholderText(`Minimaal ${MIN_PASSWORD_LENGTH} tekens`)).toBeInTheDocument()
  })
})
