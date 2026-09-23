import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { GEEN_RECHTEN } from '@/lib/team-rechten'
import RechtenToggles from '@/components/settings/RechtenToggles'

vi.mock('@/app/actions/team-members', () => ({
  updateMemberRights: vi.fn(),
}))

import { updateMemberRights } from '@/app/actions/team-members'
const mockUpdate = updateMemberRights as unknown as ReturnType<typeof vi.fn>

function renderToggles(initialRechten = GEEN_RECHTEN) {
  return render(
    <DictProvider dict={nl}>
      <RechtenToggles userId="assistent-1" initialRechten={initialRechten} />
    </DictProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue({ ok: true })
})

describe('RechtenToggles', () => {
  it('rendert alle zes onderdelen met de switch uit', () => {
    renderToggles()
    for (const onderdeel of ['spelers', 'agenda', 'aanwezigheid', 'wedstrijd', 'training', 'periodisering'] as const) {
      const toggle = screen.getByRole('switch', { name: nl.staf.onderdeel[onderdeel] })
      expect(toggle).toHaveAttribute('aria-checked', 'false')
    }
  })

  it('een toggle aanzetten roept updateMemberRights aan met exact dat ene recht op true, de rest op false', async () => {
    renderToggles()
    fireEvent.click(screen.getByRole('switch', { name: nl.staf.onderdeel.spelers }))
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('assistent-1', {
        spelers: true,
        agenda: false,
        aanwezigheid: false,
        wedstrijd: false,
        training: false,
        periodisering: false,
      }),
    )
    expect(screen.getByRole('switch', { name: nl.staf.onderdeel.spelers })).toHaveAttribute('aria-checked', 'true')
  })

  it('bij een mislukte save draait de toggle terug en verschijnt de foutmelding', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('Geen toegang'))
    renderToggles()
    fireEvent.click(screen.getByRole('switch', { name: nl.staf.onderdeel.agenda }))
    await waitFor(() => expect(screen.getByText(nl.staf.saveFailed)).toBeInTheDocument())
    expect(screen.getByRole('switch', { name: nl.staf.onderdeel.agenda })).toHaveAttribute('aria-checked', 'false')
  })

  it('toont de bestaande rechten bij het laden (initialRechten)', () => {
    renderToggles({ ...GEEN_RECHTEN, wedstrijd: true })
    expect(screen.getByRole('switch', { name: nl.staf.onderdeel.wedstrijd })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: nl.staf.onderdeel.spelers })).toHaveAttribute('aria-checked', 'false')
  })
})
