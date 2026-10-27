import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { ToastProvider } from '@/components/ui/Toast'
import SpeelminutenSectie from '@/components/SpeelminutenSectie'
import type { Player, Speelminuten } from '@/lib/types'
import type { HerstelSpeelminuten } from '@/lib/herstel'

vi.mock('@/app/actions/speelminuten', () => ({
  saveSpeelminuten: vi.fn(),
  deleteSpeelminuten: vi.fn(),
  herstelSpeelminuten: vi.fn(),
}))
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: mockRefresh }),
}))

import { saveSpeelminuten, deleteSpeelminuten, herstelSpeelminuten } from '@/app/actions/speelminuten'
const mockSave = saveSpeelminuten as unknown as ReturnType<typeof vi.fn>
const mockDelete = deleteSpeelminuten as unknown as ReturnType<typeof vi.fn>
const mockHerstel = herstelSpeelminuten as unknown as ReturnType<typeof vi.fn>

const a = nl.analysis
const PIET: Player = {
  id: 'p1', name: 'Piet Peters', position: 'Spits', secondary_positions: [], jersey_number: 9,
  active: true, injured: false, type: 'regular', rating: null, created_at: '2026-01-01T00:00:00Z',
}
const JAN: Player = { ...PIET, id: 'p2', name: 'Jan Jansen', jersey_number: 4 }
const rij = (o: Partial<Speelminuten>): Speelminuten => ({
  id: 'r1', event_id: 'e1', player_id: 'p1', minuten: 60, wissels: 1, created_at: '2026-09-01T10:00:00Z', ...o,
})
const SNAPSHOT: HerstelSpeelminuten = {
  soort: 'speelminuten', teamId: 't1', id: 'r1', eventId: 'e1', playerId: 'p1', minuten: 60, wissels: 1, createdAt: '2026-09-01T10:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSave.mockResolvedValue(undefined)
})

function renderSectie(o: Partial<React.ComponentProps<typeof SpeelminutenSectie>> = {}) {
  return render(
    <DictProvider dict={nl}>
      <ToastProvider teamId="t1">
        <SpeelminutenSectie
          eventId="e1"
          spelers={[PIET, JAN]}
          initialSpeelminuten={[]}
          overigeNamen={{}}
          canEdit
          wedstrijdGespeeld
          bronFout={false}
          {...o}
        />
      </ToastProvider>
    </DictProvider>,
  )
}

const minuten = (naam: string) => screen.getByLabelText(`${naam} – ${a.minutenLabel}`) as HTMLInputElement
const wissels = (naam: string) => screen.getByLabelText(`${naam} – ${a.wisselsLabel}`) as HTMLInputElement
const opslaan = (naam: string) => minuten(naam).closest('form')!.querySelector('button[type="submit"]') as HTMLButtonElement
const typ = (el: HTMLInputElement, v: string) => fireEvent.change(el, { target: { value: v } })

describe('SpeelminutenSectie', () => {
  it('toont per speler een regel; wissels start op 0 en opslaan is disabled', () => {
    renderSectie()
    expect(screen.getByText(a.speelminuten)).toBeInTheDocument()
    expect(minuten('Piet Peters').value).toBe('')
    expect(wissels('Piet Peters').value).toBe('0')
    expect(opslaan('Piet Peters')).toBeDisabled()
    expect(screen.getByText('#9 · ST', { exact: false })).toBeInTheDocument()
  })

  it('opslaan roept saveSpeelminuten met getallen aan en toont daarna "saved"', async () => {
    renderSectie()
    typ(minuten('Piet Peters'), '60')
    typ(wissels('Piet Peters'), '2')
    expect(opslaan('Piet Peters')).toBeEnabled()
    fireEvent.click(opslaan('Piet Peters'))
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('e1', 'p1', 60, 2))
    expect(await screen.findByText(a.saved)).toBeInTheDocument()
    expect(mockRefresh).toHaveBeenCalled()
    expect(opslaan('Piet Peters')).toBeDisabled()
  })

  it('alleen minuten invullen slaat wissels 0 op', async () => {
    renderSectie()
    typ(minuten('Jan Jansen'), '90')
    fireEvent.click(opslaan('Jan Jansen'))
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('e1', 'p2', 90, 0))
  })

  it('Enter in een veld (form submit) slaat op', async () => {
    renderSectie()
    typ(minuten('Piet Peters'), '45')
    fireEvent.submit(minuten('Piet Peters').closest('form')!)
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('e1', 'p1', 45, 0))
  })

  it.each([['131', '0'], ['-1', '0'], ['12.5', '0'], ['', '5'], ['60', ''], ['60', '100'], ['60', '1.5']])(
    'minuten %s / wissels %s geeft de melding zonder aanroep',
    (m, w) => {
      renderSectie()
      typ(minuten('Piet Peters'), m)
      typ(wissels('Piet Peters'), w)
      fireEvent.submit(minuten('Piet Peters').closest('form')!)
      expect(screen.getByRole('alert')).toHaveTextContent(a.speelminutenOngeldig)
      expect(mockSave).not.toHaveBeenCalled()
    },
  )

  it('het formulier heeft noValidate: klik op Opslaan met 131 toont de app-melding zonder aanroep', () => {
    renderSectie()
    typ(minuten('Piet Peters'), '131')
    expect(minuten('Piet Peters').closest('form')!.noValidate).toBe(true)
    fireEvent.click(opslaan('Piet Peters'))
    expect(screen.getByRole('alert')).toHaveTextContent(a.speelminutenOngeldig)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('de melding verdwijnt bij de volgende wijziging', () => {
    renderSectie()
    typ(minuten('Piet Peters'), '131')
    fireEvent.submit(minuten('Piet Peters').closest('form')!)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    typ(minuten('Piet Peters'), '90')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('een fout toont de melding; het concept blijft staan', async () => {
    mockSave.mockRejectedValue(new Error('x'))
    renderSectie({ initialSpeelminuten: [rij({})] })
    typ(minuten('Piet Peters'), '75')
    fireEvent.click(opslaan('Piet Peters'))
    expect(await screen.findByRole('alert')).toHaveTextContent(a.speelminutenOpslaanFout)
    expect(minuten('Piet Peters').value).toBe('75')
    expect(screen.queryByText(a.saved)).toBeNull()
  })

  it('tijdens pending is alles in de regel disabled en een dubbele submit geeft één aanroep; regel B blijft vrij', async () => {
    let los!: () => void
    mockSave.mockReturnValue(new Promise<void>((r) => { los = r }))
    renderSectie()
    typ(minuten('Piet Peters'), '60')
    const form = minuten('Piet Peters').closest('form')!
    fireEvent.submit(form)
    await waitFor(() => expect(minuten('Piet Peters')).toBeDisabled())
    fireEvent.submit(form)
    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(wissels('Piet Peters')).toBeDisabled()
    expect(opslaan('Piet Peters')).toBeDisabled()
    expect(minuten('Jan Jansen')).toBeEnabled()
    await act(async () => { los() })
    await waitFor(() => expect(minuten('Piet Peters')).toBeEnabled())
  })

  it('toont opgeslagen waarden; verwijderen toont de toast en undo roept herstelSpeelminuten aan', async () => {
    mockDelete.mockResolvedValue(SNAPSHOT)
    mockHerstel.mockResolvedValue(undefined)
    renderSectie({ initialSpeelminuten: [rij({})] })
    expect(minuten('Piet Peters').value).toBe('60')
    expect(wissels('Piet Peters').value).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: `${a.delete} – Piet Peters` }))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('e1', 'p1'))
    expect(minuten('Piet Peters').value).toBe('')
    expect(wissels('Piet Peters').value).toBe('0')
    fireEvent.click(await screen.findByRole('button', { name: nl.undo.action }))
    await waitFor(() => expect(mockHerstel).toHaveBeenCalledWith(SNAPSHOT))
    await waitFor(() => expect(minuten('Piet Peters').value).toBe('60'))
  })

  it('een falende delete zet de waarde terug en toont undo.deleteError', async () => {
    mockDelete.mockRejectedValue(new Error('x'))
    renderSectie({ initialSpeelminuten: [rij({})] })
    fireEvent.click(screen.getByRole('button', { name: `${a.delete} – Piet Peters` }))
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.undo.deleteError)
    expect(minuten('Piet Peters').value).toBe('60')
  })

  it('geen verwijderknop zolang er geen opgeslagen rij is', () => {
    renderSectie()
    expect(screen.queryByRole('button', { name: new RegExp(`^${a.delete}`) })).toBeNull()
  })

  it('canEdit=false: alleen tekst, geen inputs en geen knoppen', () => {
    renderSectie({ canEdit: false, initialSpeelminuten: [rij({})], overigeNamen: { p9: 'Oud Speler' } })
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('60 min · 1 wissels')).toBeInTheDocument()
    expect(screen.getByText(a.speelminutenNietIngevuld)).toBeInTheDocument()
  })

  it('wedstrijdGespeeld=false toont de toekomstmelding zonder inputs', () => {
    renderSectie({ wedstrijdGespeeld: false })
    expect(screen.getByText(a.speelminutenToekomst)).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('bronFout toont speelminutenNietBeschikbaar zonder inputs', () => {
    renderSectie({ bronFout: true })
    expect(screen.getByText(a.speelminutenNietBeschikbaar)).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('overige rijen zijn alleen-lezen maar verwijderbaar met undo (canEdit)', async () => {
    mockDelete.mockResolvedValue({ ...SNAPSHOT, playerId: 'p9', minuten: 30, wissels: 2 })
    mockHerstel.mockResolvedValue(undefined)
    renderSectie({
      initialSpeelminuten: [rij({ player_id: 'p9', minuten: 30, wissels: 2 })],
      overigeNamen: { p9: 'Oud Speler' },
    })
    expect(screen.getByText(a.speelminutenOverig)).toBeInTheDocument()
    expect(screen.getByText('Oud Speler')).toBeInTheDocument()
    expect(screen.getByText('30 min · 2 wissels')).toBeInTheDocument()
    expect(screen.getAllByRole('spinbutton')).toHaveLength(4) // alleen PIET en JAN
    fireEvent.click(screen.getByRole('button', { name: `${a.delete} – Oud Speler` }))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('e1', 'p9'))
    await waitFor(() => expect(screen.queryByText('Oud Speler')).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: nl.undo.action }))
    await waitFor(() => expect(mockHerstel).toHaveBeenCalled())
    expect(await screen.findByText('Oud Speler')).toBeInTheDocument()
  })

  it('een falende delete op een overige rij zet de rij terug en toont undo.deleteError', async () => {
    mockDelete.mockRejectedValue(new Error('x'))
    renderSectie({
      initialSpeelminuten: [rij({ player_id: 'p9', minuten: 30, wissels: 2 })],
      overigeNamen: { p9: 'Oud Speler' },
    })
    fireEvent.click(screen.getByRole('button', { name: `${a.delete} – Oud Speler` }))
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.undo.deleteError)
    expect(screen.getByText('Oud Speler')).toBeInTheDocument()
    expect(screen.getByText('30 min · 2 wissels')).toBeInTheDocument()
  })

  it('overige rijen zonder canEdit hebben geen verwijderknop; ontbrekende naam wordt "—"', () => {
    renderSectie({ canEdit: false, initialSpeelminuten: [rij({ player_id: 'p9' })] })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('pending in regel A blokkeert regel B niet (zie ook dubbele submit)', async () => {
    mockSave.mockReturnValue(new Promise<void>(() => {}))
    renderSectie()
    typ(minuten('Piet Peters'), '60')
    fireEvent.submit(minuten('Piet Peters').closest('form')!)
    await waitFor(() => expect(minuten('Piet Peters')).toBeDisabled())
    typ(minuten('Jan Jansen'), '30')
    expect(opslaan('Jan Jansen')).toBeEnabled()
  })
})
