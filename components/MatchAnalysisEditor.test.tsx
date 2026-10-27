import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { ToastProvider } from '@/components/ui/Toast'
import MatchAnalysisEditor from '@/components/MatchAnalysisEditor'
import type { MatchEvent, Player } from '@/lib/types'
import type { HerstelWedstrijdMoment } from '@/lib/herstel'

vi.mock('@/app/actions/match-analysis', () => ({
  saveMatchResult: vi.fn().mockResolvedValue(undefined),
  saveMatchRating: vi.fn().mockResolvedValue(undefined),
  addMatchEvent: vi.fn().mockResolvedValue(undefined),
  deleteMatchEvent: vi.fn(),
  herstelWedstrijdMoment: vi.fn(),
}))

// De editor rendert nu ook TegendoelpuntenSectie, dat deze acties importeert.
vi.mock('@/app/actions/tegendoelpunten', () => ({
  addTegendoelpunt: vi.fn().mockResolvedValue(undefined),
  deleteTegendoelpunt: vi.fn(),
  herstelTegendoelpunt: vi.fn(),
}))

// En SpeelminutenSectie (fase 2b), met eigen acties.
vi.mock('@/app/actions/speelminuten', () => ({
  saveSpeelminuten: vi.fn().mockResolvedValue(undefined),
  deleteSpeelminuten: vi.fn(),
  herstelSpeelminuten: vi.fn(),
}))

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: mockRefresh }),
}))

import { deleteMatchEvent, herstelWedstrijdMoment } from '@/app/actions/match-analysis'
const mockDelete = deleteMatchEvent as unknown as ReturnType<typeof vi.fn>
const mockHerstel = herstelWedstrijdMoment as unknown as ReturnType<typeof vi.fn>

const PIET: Player = {
  id: 'p1', name: 'Piet Peters', position: 'Spits', secondary_positions: [], jersey_number: 9,
  active: true, injured: false, type: 'regular', rating: null, created_at: '2026-01-01T00:00:00Z',
}
const JAN: Player = { ...PIET, id: 'p2', name: 'Jan Jansen', jersey_number: 4 }

const EVENTS: MatchEvent[] = [
  { id: 'm1', event_id: 'e1', player_id: 'p1', kind: 'goal', minute: 12, created_at: '2026-09-01T10:00:00Z' },
  { id: 'm2', event_id: 'e1', player_id: 'p2', kind: 'yellow', minute: 30, created_at: '2026-09-01T10:10:00Z' },
]

const SNAPSHOT: HerstelWedstrijdMoment = {
  soort: 'wedstrijdmoment', teamId: 't1', id: 'm1', eventId: 'e1', playerId: 'p1',
  kind: 'goal', minute: 12, createdAt: '2026-09-01T10:00:00Z',
}

function renderEditor(initialEvents: MatchEvent[] = EVENTS) {
  return render(
    <DictProvider dict={nl}>
      <ToastProvider teamId="t1">
        <MatchAnalysisEditor
          eventId="e1"
          presentPlayers={[PIET, JAN]}
          teamName="Pitchup"
          opponent="Ajax"
          homeAway="home"
          initialGoalsFor={1}
          initialGoalsAgainst={0}
          initialRatings={[]}
          initialEvents={initialEvents}
        />
      </ToastProvider>
    </DictProvider>,
  )
}

// Alleen de soort-labels in de gebeurtenissenlijst (niet de <option>s van het formulier).
const queryKind = (label: string) => screen.queryByText(label, { selector: 'span.text-faint' })
const kindVolgorde = () =>
  screen
    .getAllByText(new RegExp(`^(${nl.analysis.kinds.goal}|${nl.analysis.kinds.yellow})$`), { selector: 'span.text-faint' })
    .map((e) => e.textContent)

const verwijderKnoppen = () => screen.getAllByRole('button', { name: nl.analysis.delete })

beforeEach(() => {
  vi.clearAllMocks()
  mockDelete.mockResolvedValue(SNAPSHOT)
  mockHerstel.mockResolvedValue(undefined)
})

describe('MatchAnalysisEditor — tegendoelpunten-sectie', () => {
  it('rendert de sectie, zonder prop met lege staat (bestaande aanroepers breken niet)', () => {
    renderEditor()
    expect(screen.getByText(nl.analysis.noTegendoelpunten)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.analysis.tegendoelpuntSoorten.set_piece })).toBeInTheDocument()
  })
})

describe('MatchAnalysisEditor: gebeurtenis verwijderen met undo', () => {
  it('verwijdert direct zonder bevestiging, ververst en toont een undo-toast', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderEditor()
    await act(async () => {
      fireEvent.click(verwijderKnoppen()[0])
    })
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledWith('m1', 'e1')
    expect(queryKind(nl.analysis.kinds.goal)).not.toBeInTheDocument()
    expect(mockRefresh).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(nl.undo.deleted)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('"Ongedaan maken" roept herstelWedstrijdMoment met de snapshot aan, zet de gebeurtenis terug op haar plek en ververst', async () => {
    renderEditor()
    await act(async () => {
      fireEvent.click(verwijderKnoppen()[0])
    })
    mockRefresh.mockClear()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nl.undo.action }))
    })
    expect(mockHerstel).toHaveBeenCalledWith(SNAPSHOT)
    expect(mockRefresh).toHaveBeenCalled()
    // Terug op de eerste plek: doelpunt vóór kaart.
    const soorten = kindVolgorde()
    expect(soorten[0]).toBe(nl.analysis.kinds.goal)
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  it('herstel faalt: fouttoast, de gebeurtenis blijft weg', async () => {
    mockHerstel.mockRejectedValueOnce(new Error('Herstel niet mogelijk'))
    renderEditor()
    await act(async () => {
      fireEvent.click(verwijderKnoppen()[0])
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nl.undo.action }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent(nl.undo.restoreError)
    expect(queryKind(nl.analysis.kinds.goal)).not.toBeInTheDocument()
  })

  it('verwijderen faalt: rollback, inline foutmelding (role=alert), geen toast en geen refresh', async () => {
    mockDelete.mockRejectedValueOnce(new Error('Gebeurtenis niet gevonden'))
    renderEditor()
    await act(async () => {
      fireEvent.click(verwijderKnoppen()[0])
    })
    expect(screen.getByRole('alert')).toHaveTextContent(nl.undo.deleteError)
    // Geen rauwe serverstring.
    expect(screen.queryByText('Gebeurtenis niet gevonden')).not.toBeInTheDocument()
    // Terug op de oorspronkelijke plek.
    expect(kindVolgorde()[0]).toBe(nl.analysis.kinds.goal)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('een volgende verwijdering wist de eerdere foutmelding', async () => {
    mockDelete.mockRejectedValueOnce(new Error('x'))
    renderEditor()
    await act(async () => {
      fireEvent.click(verwijderKnoppen()[0])
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(verwijderKnoppen()[1])
    })
    expect(screen.queryByText(nl.undo.deleteError)).not.toBeInTheDocument()
  })
})
