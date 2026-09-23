import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import InviteLinkCard from '@/components/settings/InviteLinkCard'

vi.mock('@/app/actions/team-invites', () => ({
  createInvite: vi.fn(),
}))

import { createInvite } from '@/app/actions/team-invites'
const mockCreateInvite = createInvite as unknown as ReturnType<typeof vi.fn>

function renderCard(initialActiveInvite: { verlooptOp: string } | null = null) {
  return render(
    <DictProvider dict={nl}>
      <InviteLinkCard initialActiveInvite={initialActiveInvite} />
    </DictProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

describe('InviteLinkCard — geen actieve link', () => {
  it('toont de "genereren"-knop en geen URL-veld', () => {
    renderCard(null)
    expect(screen.getByRole('button', { name: nl.staf.generateLink })).toBeInTheDocument()
    expect(screen.queryByLabelText(nl.staf.linkLabel)).not.toBeInTheDocument()
  })

  it('genereren toont de volle URL één keer, met kopieerknop', async () => {
    mockCreateInvite.mockResolvedValue({ url: 'https://pitchup.app/invite/abc123', verlooptOp: '2026-10-01T12:00:00.000Z' })
    renderCard(null)
    fireEvent.click(screen.getByRole('button', { name: nl.staf.generateLink }))
    await waitFor(() => expect(screen.getByDisplayValue('https://pitchup.app/invite/abc123')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: nl.staf.copy })).toBeInTheDocument()
    // Na het genereren staat de knop nu op "Nieuwe link genereren".
    expect(screen.getByRole('button', { name: nl.staf.regenerateLink })).toBeInTheDocument()
  })

  it('een mislukte generatie toont de vaste i18n-melding, nooit de rauwe actiefout (validatiebevinding 8)', async () => {
    // Next saneert server-action-fouten in productie sowieso al tot een
    // generieke Engelse tekst — err.message is dus nooit een betrouwbare
    // bron. Deze test bewijst dat de UI hem sowieso negeert.
    mockCreateInvite.mockRejectedValueOnce(new Error('Uitnodigen is nu niet mogelijk. Neem contact op met de beheerder.'))
    renderCard(null)
    fireEvent.click(screen.getByRole('button', { name: nl.staf.generateLink }))
    await waitFor(() => expect(screen.getByText(nl.auth.genericError)).toBeInTheDocument())
    expect(screen.queryByText('Uitnodigen is nu niet mogelijk. Neem contact op met de beheerder.')).not.toBeInTheDocument()
  })
})

describe('InviteLinkCard — actieve link, na herladen (geen token meer bekend)', () => {
  it('toont de vervaldatum en "Nieuwe link genereren", geen URL-veld', () => {
    renderCard({ verlooptOp: '2026-10-01T12:00:00.000Z' })
    expect(screen.getByRole('button', { name: nl.staf.regenerateLink })).toBeInTheDocument()
    expect(screen.queryByLabelText(nl.staf.linkLabel)).not.toBeInTheDocument()
    expect(screen.getByText(nl.staf.activeInviteExists, { exact: false })).toBeInTheDocument()
  })
})

describe('InviteLinkCard — kopieerknop', () => {
  it('kopieert via de clipboard-API en toont tijdelijk "Gekopieerd"', async () => {
    mockCreateInvite.mockResolvedValue({ url: 'https://pitchup.app/invite/abc123', verlooptOp: '2026-10-01T12:00:00.000Z' })
    renderCard(null)
    fireEvent.click(screen.getByRole('button', { name: nl.staf.generateLink }))
    await waitFor(() => screen.getByRole('button', { name: nl.staf.copy }))
    fireEvent.click(screen.getByRole('button', { name: nl.staf.copy }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://pitchup.app/invite/abc123'))
    await waitFor(() => expect(screen.getByRole('button', { name: nl.staf.copied })).toBeInTheDocument())
  })

  it('valt terug op selecteren wanneer navigator.clipboard ontbreekt', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    mockCreateInvite.mockResolvedValue({ url: 'https://pitchup.app/invite/abc123', verlooptOp: '2026-10-01T12:00:00.000Z' })
    renderCard(null)
    fireEvent.click(screen.getByRole('button', { name: nl.staf.generateLink }))
    await waitFor(() => screen.getByRole('button', { name: nl.staf.copy }))
    fireEvent.click(screen.getByRole('button', { name: nl.staf.copy }))
    await waitFor(() => expect(screen.getByRole('button', { name: nl.staf.copyFailed })).toBeInTheDocument())
  })
})
