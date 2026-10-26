import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { ToastProvider } from '@/components/ui/Toast'
import TegendoelpuntenSectie from '@/components/TegendoelpuntenSectie'
import type { Tegendoelpunt } from '@/lib/types'
import type { HerstelTegendoelpunt } from '@/lib/herstel'

vi.mock('@/app/actions/tegendoelpunten', () => ({
  addTegendoelpunt: vi.fn(),
  deleteTegendoelpunt: vi.fn(),
  herstelTegendoelpunt: vi.fn(),
}))
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: mockRefresh }),
}))

import { addTegendoelpunt, deleteTegendoelpunt, herstelTegendoelpunt } from '@/app/actions/tegendoelpunten'
const mockAdd = addTegendoelpunt as unknown as ReturnType<typeof vi.fn>
const mockDelete = deleteTegendoelpunt as unknown as ReturnType<typeof vi.fn>
const mockHerstel = herstelTegendoelpunt as unknown as ReturnType<typeof vi.fn>

const a = nl.analysis
const LIJST: Tegendoelpunt[] = [
  { id: 'b', event_id: 'e1', soort: 'open_play', minute: null, created_at: '2026-09-01T10:00:00Z' },
  { id: 'c', event_id: 'e1', soort: 'open_play', minute: 70, created_at: '2026-09-01T10:05:00Z' },
  { id: 'd', event_id: 'e1', soort: 'set_piece', minute: 20, created_at: '2026-09-01T10:10:00Z' },
]
const SNAPSHOT: HerstelTegendoelpunt = {
  soort: 'tegendoelpunt', teamId: 't1', id: 'd', eventId: 'e1', doelpuntSoort: 'set_piece', minute: 20, createdAt: '2026-09-01T10:10:00Z',
}

let uuidTeller = 0
beforeEach(() => {
  vi.clearAllMocks()
  uuidTeller = 0
  vi.stubGlobal('crypto', { randomUUID: () => `uuid-${++uuidTeller}` })
  mockAdd.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

function renderSectie(o: { lijst?: Tegendoelpunt[]; goalsAgainst?: number | null; canEdit?: boolean } = {}) {
  return render(
    <DictProvider dict={nl}>
      <ToastProvider teamId="t1">
        <TegendoelpuntenSectie
          eventId="e1"
          initialTegendoelpunten={o.lijst ?? []}
          goalsAgainst={o.goalsAgainst === undefined ? null : o.goalsAgainst}
          canEdit={o.canEdit ?? true}
        />
      </ToastProvider>
    </DictProvider>,
  )
}

const soortKnop = (naam: string) => screen.getByRole('button', { name: naam })
const toevoegKnop = () => screen.getByRole('button', { name: a.addTegendoelpunt })
const minuutInput = () => screen.getByPlaceholderText(a.minuteOptional)

describe('TegendoelpuntenSectie', () => {
  it('lege staat', () => {
    renderSectie()
    expect(screen.getByText(a.noTegendoelpunten)).toBeInTheDocument()
  })

  it('lijst: minuut oplopend, zonder minuut achteraan, met soortlabel', () => {
    renderSectie({ lijst: LIJST })
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toContain(`${a.tegendoelpuntSoorten.set_piece}20′`)
    expect(items[1]).toContain('70′')
    expect(items[2]).not.toContain('′')
  })

  it('zonder soort is de toevoegknop disabled (geen voorselectie)', () => {
    renderSectie()
    expect(soortKnop(a.tegendoelpuntSoorten.set_piece)).toHaveAttribute('aria-pressed', 'false')
    expect(soortKnop(a.tegendoelpuntSoorten.open_play)).toHaveAttribute('aria-pressed', 'false')
    expect(toevoegKnop()).toBeDisabled()
    fireEvent.click(soortKnop(a.tegendoelpuntSoorten.set_piece))
    expect(toevoegKnop()).not.toBeDisabled()
  })

  it.each(['131', '12.5', '-1'])('minuut %s geeft de melding en roept de actie niet aan', (waarde) => {
    renderSectie()
    fireEvent.click(soortKnop(a.tegendoelpuntSoorten.open_play))
    fireEvent.change(minuutInput(), { target: { value: waarde } })
    fireEvent.click(toevoegKnop())
    expect(screen.getByRole('alert')).toHaveTextContent(a.tegendoelpuntOngeldigeMinuut)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('succes: stuurt id, event, soort en minuut; reset het formulier met een nieuwe id; ververst', async () => {
    renderSectie()
    fireEvent.click(soortKnop(a.tegendoelpuntSoorten.set_piece))
    fireEvent.change(minuutInput(), { target: { value: '33' } })
    fireEvent.click(toevoegKnop())
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1))
    const eerste = mockAdd.mock.calls[0]
    expect(eerste.slice(1)).toEqual(['e1', 'set_piece', 33])
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
    expect(minuutInput()).toHaveValue(null)
    expect(soortKnop(a.tegendoelpuntSoorten.set_piece)).toHaveAttribute('aria-pressed', 'false')
    // Tweede tegendoelpunt: nieuwe id.
    fireEvent.click(soortKnop(a.tegendoelpuntSoorten.set_piece))
    fireEvent.click(toevoegKnop())
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(2))
    expect(mockAdd.mock.calls[1][0]).not.toBe(eerste[0])
    expect(mockAdd.mock.calls[1][3]).toBeNull() // lege minuut → null
  })

  it('fout: toont de melding; een retry gebruikt dezelfde id; een andere soort geeft een nieuwe id', async () => {
    mockAdd.mockRejectedValueOnce(new Error('boom'))
    renderSectie()
    fireEvent.click(soortKnop(a.tegendoelpuntSoorten.open_play))
    fireEvent.click(toevoegKnop())
    expect(await screen.findByRole('alert')).toHaveTextContent(a.tegendoelpuntOpslaanFout)
    const id1 = mockAdd.mock.calls[0][0]
    expect(mockRefresh).not.toHaveBeenCalled()

    fireEvent.click(toevoegKnop()) // retry, ongewijzigde invoer
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(2))
    expect(mockAdd.mock.calls[1][0]).toBe(id1)
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled()) // retry is geslaagd

    // Nieuw formulier; na weer een fout geeft een gewijzigde soort een nieuwe id.
    mockAdd.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(soortKnop(a.tegendoelpuntSoorten.open_play))
    fireEvent.click(toevoegKnop())
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(3))
    const id3 = mockAdd.mock.calls[2][0]
    expect(id3).not.toBe(id1) // na succes was er al een nieuwe id
    await screen.findByRole('alert')
    fireEvent.click(soortKnop(a.tegendoelpuntSoorten.set_piece)) // invoer gewijzigd
    fireEvent.click(toevoegKnop())
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(4))
    expect(mockAdd.mock.calls[3][0]).not.toBe(id3)
  })

  it('zonder randomUUID: melding en geen aanroep (nooit een verzonnen id)', () => {
    vi.stubGlobal('crypto', {})
    renderSectie()
    fireEvent.click(soortKnop(a.tegendoelpuntSoorten.open_play))
    fireEvent.click(toevoegKnop())
    expect(screen.getByRole('alert')).toHaveTextContent(a.tegendoelpuntOpslaanFout)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('tijdens pending is alles disabled', async () => {
    let los: () => void = () => {}
    mockAdd.mockReturnValueOnce(new Promise<void>((r) => { los = r }))
    renderSectie({ lijst: LIJST })
    fireEvent.click(soortKnop(a.tegendoelpuntSoorten.open_play))
    fireEvent.click(toevoegKnop())
    await waitFor(() => expect(minuutInput()).toBeDisabled())
    expect(toevoegKnop()).toBeDisabled()
    expect(soortKnop(a.tegendoelpuntSoorten.open_play)).toBeDisabled()
    for (const k of screen.getAllByRole('button', { name: a.delete })) expect(k).toBeDisabled()
    await act(async () => { los() })
  })

  it('verwijderen: rij direct weg, toast met ongedaan maken, undo roept herstel aan en zet de rij terug', async () => {
    mockDelete.mockResolvedValue(SNAPSHOT)
    mockHerstel.mockResolvedValue(undefined)
    renderSectie({ lijst: LIJST })
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    fireEvent.click(screen.getAllByRole('button', { name: a.delete })[0]) // minuut 20 (id d)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('d'))
    fireEvent.click(await screen.findByRole('button', { name: nl.undo.action }))
    await waitFor(() => expect(mockHerstel).toHaveBeenCalledWith(SNAPSHOT))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
  })

  it('een falende delete zet de rij terug en toont de fout', async () => {
    mockDelete.mockRejectedValue(new Error('boom'))
    renderSectie({ lijst: LIJST })
    fireEvent.click(screen.getAllByRole('button', { name: a.delete })[0])
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.undo.deleteError)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('canEdit=false: geen formulier en geen verwijderknoppen, wel de lijst', () => {
    renderSectie({ lijst: LIJST, canEdit: false })
    expect(screen.queryByRole('button', { name: a.addTegendoelpunt })).toBeNull()
    expect(screen.queryByRole('button', { name: a.delete })).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  describe('afwijkingshint (O1)', () => {
    it('géén hint bij een oude wedstrijd: uitslag-tegen 2, 0 vastgelegd', () => {
      renderSectie({ goalsAgainst: 2 })
      expect(screen.queryByText(a.tegendoelpuntSumHint)).toBeNull()
    })
    it('wel een hint bij 1 vastgelegd en uitslag 2', () => {
      renderSectie({ lijst: [LIJST[0]], goalsAgainst: 2 })
      expect(screen.getByText(a.tegendoelpuntSumHint)).toBeInTheDocument()
    })
    it('geen hint als aantal klopt of er geen uitslag is', () => {
      const { unmount } = renderSectie({ lijst: [LIJST[0]], goalsAgainst: 1 })
      expect(screen.queryByText(a.tegendoelpuntSumHint)).toBeNull()
      unmount()
      renderSectie({ lijst: [LIJST[0]], goalsAgainst: null })
      expect(screen.queryByText(a.tegendoelpuntSumHint)).toBeNull()
    })
  })
})
