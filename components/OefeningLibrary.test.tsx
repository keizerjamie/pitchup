import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import OefeningLibrary, { OefeningWithUsage } from '@/components/OefeningLibrary'

vi.mock('@/app/actions/oefening-library', () => ({
  createOefening: vi.fn(),
  updateOefening: vi.fn(),
  deleteOefening: vi.fn().mockResolvedValue(undefined),
}))

import { deleteOefening } from '@/app/actions/oefening-library'

function makeOefening(overrides: Partial<OefeningWithUsage> = {}): OefeningWithUsage {
  return {
    id: 'o1',
    team_id: 'team-1',
    naam: 'Rondo',
    beschrijving: null,
    categorie: 'partijen_klein',
    duur_min: 10,
    breedte_m: null,
    lengte_m: null,
    orientatie: 'vrij',
    veldzone: null,
    teams: [],
    aantal_neutralen: 0,
    diagram: null,
    created_at: '2024-01-01T00:00:00Z',
    koppelingCount: 0,
    ...overrides,
  }
}

function renderLibrary(oefeningen: OefeningWithUsage[]) {
  render(
    <DictProvider dict={nl}>
      <OefeningLibrary oefeningen={oefeningen} />
    </DictProvider>,
  )
}

describe('OefeningLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('toont de lege staat zonder oefeningen', () => {
    renderLibrary([])
    expect(screen.getByText(nl.oefeningen.empty)).toBeInTheDocument()
  })

  it('N=0: verwijdert direct zonder bevestigingsdialoog (AC21)', async () => {
    renderLibrary([makeOefening({ id: 'o1', koppelingCount: 0 })])
    fireEvent.click(screen.getByLabelText(nl.oefeningen.deleteAria))

    // Geen bevestigingsbox/waarschuwing zichtbaar op enig moment.
    expect(screen.queryByText(nl.oefeningen.deleteConfirm)).not.toBeInTheDocument()
    expect(screen.queryByText(nl.oefeningen.deleteButton)).not.toBeInTheDocument()

    await waitFor(() => expect(deleteOefening).toHaveBeenCalledWith('o1'))
    await waitFor(() => expect(screen.queryByText('Rondo')).not.toBeInTheDocument())
  })

  it('N>=1: toont de waarschuwing met het aantal trainingen vóór verwijderen', () => {
    renderLibrary([makeOefening({ koppelingCount: 3 })])
    fireEvent.click(screen.getByLabelText(nl.oefeningen.deleteAria))
    expect(screen.getByText(nl.oefeningen.deleteConfirmUsage.replace('{n}', '3'))).toBeInTheDocument()
    // deleteOefening pas na expliciete bevestiging, niet meteen bij het klikken op het prullenbak-icoon.
    expect(deleteOefening).not.toHaveBeenCalled()
  })

  it('annuleren (N>=1) laat de oefening staan (geen deleteOefening aangeroepen)', () => {
    renderLibrary([makeOefening({ koppelingCount: 2 })])
    fireEvent.click(screen.getByLabelText(nl.oefeningen.deleteAria))
    fireEvent.click(screen.getByText(nl.trainingPlan.cancel))
    expect(screen.getByText('Rondo')).toBeInTheDocument()
    expect(deleteOefening).not.toHaveBeenCalled()
  })

  it('bevestigen (N>=1) roept deleteOefening aan en verwijdert de kaart', async () => {
    renderLibrary([makeOefening({ id: 'o1', koppelingCount: 1 })])
    fireEvent.click(screen.getByLabelText(nl.oefeningen.deleteAria))
    fireEvent.click(screen.getByText(nl.oefeningen.deleteButton))
    await waitFor(() => expect(deleteOefening).toHaveBeenCalledWith('o1'))
    await waitFor(() => expect(screen.queryByText('Rondo')).not.toBeInTheDocument())
  })

  it('filtert op naam via het zoekveld', () => {
    renderLibrary([makeOefening({ id: 'o1', naam: 'Rondo' }), makeOefening({ id: 'o2', naam: 'Positiespel' })])
    fireEvent.change(screen.getByPlaceholderText(nl.oefeningen.searchPlaceholder), { target: { value: 'rondo' } })
    expect(screen.getByText('Rondo')).toBeInTheDocument()
    expect(screen.queryByText('Positiespel')).not.toBeInTheDocument()
  })

  it('toont een neutralen-badge wanneer aantal_neutralen > 0', () => {
    renderLibrary([makeOefening({ aantal_neutralen: 4 })])
    expect(screen.getByText(nl.oefeningen.neutralsBadge.replace('{n}', '4'))).toBeInTheDocument()
  })
})
