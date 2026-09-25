import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import CopyOefeningButton from '@/components/CopyOefeningButton'

vi.mock('@/app/actions/oefening-library', () => ({
  kopieerOefeningNaarBibliotheek: vi.fn(),
}))

import { kopieerOefeningNaarBibliotheek } from '@/app/actions/oefening-library'
const mockKopieer = kopieerOefeningNaarBibliotheek as unknown as ReturnType<typeof vi.fn>

function renderButton() {
  return render(
    <DictProvider dict={nl}>
      <CopyOefeningButton oefeningId="o-1" />
    </DictProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CopyOefeningButton', () => {
  it('toont idle het label "Kopiëren naar mijn bibliotheek"', () => {
    renderButton()
    expect(screen.getByRole('button', { name: nl.oefeningen.copyToLibrary })).toBeInTheDocument()
  })

  it('roept kopieerOefeningNaarBibliotheek aan met de oefening-id en toont "Gekopieerd"', async () => {
    mockKopieer.mockResolvedValue({ id: 'nieuw-1' })
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: nl.oefeningen.copyToLibrary }))
    expect(mockKopieer).toHaveBeenCalledWith('o-1')
    await waitFor(() => expect(screen.getByRole('button', { name: nl.oefeningen.copied })).toBeInTheDocument())
  })

  it('valt na de bevestiging terug naar idle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockKopieer.mockResolvedValue({ id: 'nieuw-1' })
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: nl.oefeningen.copyToLibrary }))
    await waitFor(() => expect(screen.getByRole('button', { name: nl.oefeningen.copied })).toBeInTheDocument())
    vi.advanceTimersByTime(1700)
    await waitFor(() => expect(screen.getByRole('button', { name: nl.oefeningen.copyToLibrary })).toBeInTheDocument())
    vi.useRealTimers()
  })

  it('een mislukte kopie toont de vaste i18n-melding, nooit de rauwe actiefout', async () => {
    mockKopieer.mockRejectedValueOnce(new Error('Oefening niet gevonden'))
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: nl.oefeningen.copyToLibrary }))
    await waitFor(() => expect(screen.getByRole('button', { name: nl.oefeningen.copyFailed })).toBeInTheDocument())
    expect(screen.queryByText('Oefening niet gevonden')).not.toBeInTheDocument()
  })

  it('is disabled tijdens het kopiëren', async () => {
    let resolvePromise: (v: { id: string }) => void = () => {}
    mockKopieer.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve }))
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: nl.oefeningen.copyToLibrary }))
    await waitFor(() => expect(screen.getByRole('button', { name: nl.oefeningen.copying })).toBeDisabled())
    resolvePromise({ id: 'nieuw-1' })
    await waitFor(() => expect(screen.getByRole('button', { name: nl.oefeningen.copied })).toBeInTheDocument())
  })
})

afterEach(() => {
  vi.useRealTimers()
})
