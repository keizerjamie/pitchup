import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import InviteConfirm from './InviteConfirm'

vi.mock('@/app/actions/team-invites', () => ({
  acceptInvite: vi.fn(),
}))

import { acceptInvite } from '@/app/actions/team-invites'
const mockAcceptInvite = acceptInvite as unknown as ReturnType<typeof vi.fn>

function renderConfirm() {
  return render(
    <DictProvider dict={nl}>
      <InviteConfirm token="abc123" teamNaam="FC Voorbeeld" />
    </DictProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('InviteConfirm', () => {
  it('toont de bevestigingsknop met de teamnaam erin', () => {
    renderConfirm()
    expect(
      screen.getByRole('button', { name: nl.invite.confirmJoin.replace('{team}', 'FC Voorbeeld') }),
    ).toBeInTheDocument()
  })

  it('already_member → toont de "al lid"-melding, geen navigatie nodig', async () => {
    mockAcceptInvite.mockResolvedValue({ status: 'already_member', teamId: 't1' })
    renderConfirm()
    fireEvent.click(screen.getByRole('button', { name: nl.invite.confirmJoin.replace('{team}', 'FC Voorbeeld') }))
    await waitFor(() => expect(screen.getByText(nl.invite.alreadyMember)).toBeInTheDocument())
  })

  it('invalid → toont de neutrale ongeldig-melding', async () => {
    mockAcceptInvite.mockResolvedValue({ status: 'invalid', teamId: null })
    renderConfirm()
    fireEvent.click(screen.getByRole('button', { name: nl.invite.confirmJoin.replace('{team}', 'FC Voorbeeld') }))
    await waitFor(() => expect(screen.getByText(nl.invite.invalid)).toBeInTheDocument())
  })

  it('rate_limited → toont de rate-limit-melding en de knop blijft klikbaar', async () => {
    mockAcceptInvite.mockResolvedValue({ status: 'rate_limited', teamId: null })
    renderConfirm()
    fireEvent.click(screen.getByRole('button', { name: nl.invite.confirmJoin.replace('{team}', 'FC Voorbeeld') }))
    await waitFor(() => expect(screen.getByText(nl.invite.rateLimited)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: nl.invite.confirmJoin.replace('{team}', 'FC Voorbeeld') })).not.toBeDisabled()
  })

  it('een onverwachte fout (geen NEXT_REDIRECT) toont de generieke melding', async () => {
    mockAcceptInvite.mockRejectedValueOnce(new Error('Niet ingelogd'))
    renderConfirm()
    fireEvent.click(screen.getByRole('button', { name: nl.invite.confirmJoin.replace('{team}', 'FC Voorbeeld') }))
    await waitFor(() => expect(screen.getByText(nl.auth.genericError)).toBeInTheDocument())
  })

  it('status "ok" (NEXT_REDIRECT-achtig) geeft geen zichtbare fout — de redirect zelf wordt niet getest hier', async () => {
    // acceptInvite eindigt normaal in redirect(); we simuleren dat door de
    // NEXT_REDIRECT-throw die Next.js' redirect() intern gooit.
    mockAcceptInvite.mockRejectedValueOnce(new Error('NEXT_REDIRECT'))
    renderConfirm()
    fireEvent.click(screen.getByRole('button', { name: nl.invite.confirmJoin.replace('{team}', 'FC Voorbeeld') }))
    await waitFor(() => expect(mockAcceptInvite).toHaveBeenCalledWith('abc123'))
    expect(screen.queryByText(nl.auth.genericError)).not.toBeInTheDocument()
  })
})
