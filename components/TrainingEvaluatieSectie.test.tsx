import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { ToastProvider } from '@/components/ui/Toast'
import TrainingEvaluatieSectie from '@/components/TrainingEvaluatieSectie'
import type { HerstelTrainingOordeel, HerstelTrainingRpe } from '@/lib/herstel'

vi.mock('@/app/actions/training-evaluatie', () => ({
  saveTrainingRpe: vi.fn(),
  wisTrainingRpe: vi.fn(),
  herstelTrainingRpe: vi.fn(),
  saveTrainingOordeel: vi.fn(),
  wisTrainingOordeel: vi.fn(),
  herstelTrainingOordeel: vi.fn(),
}))
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: mockRefresh }),
}))

import {
  saveTrainingRpe, wisTrainingRpe, herstelTrainingRpe,
  saveTrainingOordeel, wisTrainingOordeel, herstelTrainingOordeel,
} from '@/app/actions/training-evaluatie'
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>
const mockSaveRpe = fn(saveTrainingRpe)
const mockWisRpe = fn(wisTrainingRpe)
const mockHerstelRpe = fn(herstelTrainingRpe)
const mockSaveOordeel = fn(saveTrainingOordeel)
const mockWisOordeel = fn(wisTrainingOordeel)
const mockHerstelOordeel = fn(herstelTrainingOordeel)

const e = nl.event
const SNAP_RPE: HerstelTrainingRpe = { soort: 'training_rpe', teamId: 't1', eventId: 'ev1', rpe: 6 }
const SNAP_OORDEEL: HerstelTrainingOordeel = { soort: 'training_oordeel', teamId: 't1', eventId: 'ev1', oordeel: 'deels' }

beforeEach(() => {
  vi.clearAllMocks()
  mockSaveRpe.mockResolvedValue(undefined)
  mockSaveOordeel.mockResolvedValue(undefined)
  mockWisRpe.mockResolvedValue(SNAP_RPE)
  mockWisOordeel.mockResolvedValue(SNAP_OORDEEL)
  mockHerstelRpe.mockResolvedValue(undefined)
  mockHerstelOordeel.mockResolvedValue(undefined)
})

function renderSectie(o: Partial<React.ComponentProps<typeof TrainingEvaluatieSectie>> = {}) {
  return render(
    <DictProvider dict={nl}>
      <ToastProvider teamId="t1">
        <TrainingEvaluatieSectie
          eventId="ev1"
          initial={{ rpe: null, oordeel: null }}
          doelstelling="Opbouwen van achteruit"
          canEdit
          trainingGehouden
          bronFout={false}
          {...o}
        />
      </ToastProvider>
    </DictProvider>,
  )
}

const rpeGroep = () => screen.getByRole('group', { name: e.rpeLabel })
const oordeelGroep = () => screen.getByRole('group', { name: e.oordeelLabel })
const rpeKnop = (n: number) => within(rpeGroep()).getByRole('button', { name: new RegExp(`^RPE ${n}( –|$)`) })
const oordeelKnop = (naam: string) => within(oordeelGroep()).getByRole('button', { name: naam })

describe('TrainingEvaluatieSectie', () => {
  it('toont kop, uitleg en 10 RPE-knoppen plus 3 oordeelknoppen', () => {
    renderSectie()
    expect(screen.getByRole('region', { name: e.evaluatieTitel })).toBeInTheDocument()
    expect(screen.getByText(e.evaluatieUitleg)).toBeInTheDocument()
    expect(within(rpeGroep()).getAllByRole('button')).toHaveLength(10)
    expect(within(oordeelGroep()).getAllByRole('button')).toHaveLength(3)
    expect(screen.getByText('Opbouwen van achteruit')).toBeInTheDocument()
  })

  it('vijf ankerlabels staan in de juiste cellen en zitten in de aria-label', () => {
    renderSectie()
    const ankers = e.rpeAnkers as Record<string, string>
    for (const n of [1, 3, 5, 7, 10]) {
      const knop = rpeKnop(n)
      expect(knop).toHaveAttribute('aria-label', `RPE ${n} – ${ankers[String(n)]}`)
      expect(knop.parentElement).toHaveTextContent(ankers[String(n)])
    }
    for (const n of [2, 4, 6, 8, 9]) {
      expect(rpeKnop(n)).toHaveAttribute('aria-label', `RPE ${n}`)
      expect(rpeKnop(n).parentElement!.querySelector('span')).toBeNull()
    }
    expect(Object.keys(ankers)).toEqual(['1', '3', '5', '7', '10'])
  })

  it('een tik op 7 roept saveTrainingRpe(id, 7) aan, selecteert en toont "saved"', async () => {
    renderSectie()
    fireEvent.click(rpeKnop(7))
    expect(rpeKnop(7)).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(mockSaveRpe).toHaveBeenCalledWith('ev1', 7))
    expect(await screen.findByText(nl.analysis.saved)).toBeInTheDocument()
    expect(mockRefresh).toHaveBeenCalled()
    expect(mockSaveOordeel).not.toHaveBeenCalled()
  })

  it('een tik op de huidige waarde doet geen aanroep', () => {
    renderSectie({ initial: { rpe: 5, oordeel: null } })
    expect(rpeKnop(5)).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(rpeKnop(5))
    expect(mockSaveRpe).not.toHaveBeenCalled()
  })

  it('tijdens pending zijn alle 10 knoppen en de wisknop disabled; twee tikken geven één aanroep (R.3)', async () => {
    let klaar!: () => void
    mockSaveRpe.mockReturnValue(new Promise<void>((r) => { klaar = r }))
    renderSectie({ initial: { rpe: 2, oordeel: null } })
    fireEvent.click(rpeKnop(7))
    fireEvent.click(rpeKnop(8))
    for (const b of within(rpeGroep()).getAllByRole('button')) expect(b).toBeDisabled()
    expect(screen.getByRole('button', { name: e.rpeWissen })).toBeDisabled()
    expect(mockSaveRpe).toHaveBeenCalledTimes(1)
    await act(async () => { klaar() })
    await waitFor(() => expect(rpeKnop(8)).toBeEnabled())
  })

  it('pending bij RPE blokkeert het oordeel niet', async () => {
    mockSaveRpe.mockReturnValue(new Promise<void>(() => {}))
    renderSectie()
    fireEvent.click(rpeKnop(4))
    expect(rpeKnop(1)).toBeDisabled()
    expect(oordeelKnop(e.oordeelJa)).toBeEnabled()
    fireEvent.click(oordeelKnop(e.oordeelJa))
    await waitFor(() => expect(mockSaveOordeel).toHaveBeenCalledWith('ev1', 'ja'))
  })

  it('een fout zet de oude selectie terug en toont evaluatieOpslaanFout (R.4)', async () => {
    mockSaveRpe.mockRejectedValue(new Error('x'))
    renderSectie({ initial: { rpe: 3, oordeel: null } })
    fireEvent.click(rpeKnop(9))
    expect(await screen.findByRole('alert')).toHaveTextContent(e.evaluatieOpslaanFout)
    expect(rpeKnop(3)).toHaveAttribute('aria-pressed', 'true')
    expect(rpeKnop(9)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText(nl.analysis.saved)).toBeNull()
  })

  it('de statusregel heeft een vaste plek (role=status, min-h) zodat er geen layoutsprong is', () => {
    renderSectie()
    const statussen = screen.getAllByRole('status')
    expect(statussen).toHaveLength(2)
    for (const s of statussen) expect(s.className).toContain('min-h-[18px]')
  })

  it('het oordeel werkt hetzelfde: ja/deels/nee', async () => {
    renderSectie({ initial: { rpe: null, oordeel: 'ja' } })
    expect(oordeelKnop(e.oordeelJa)).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(oordeelKnop(e.oordeelNee))
    expect(oordeelKnop(e.oordeelNee)).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(mockSaveOordeel).toHaveBeenCalledWith('ev1', 'nee'))
    expect(mockSaveRpe).not.toHaveBeenCalled()
  })

  it('een oordeel-fout zet de oude keuze terug', async () => {
    mockSaveOordeel.mockRejectedValue(new Error('x'))
    renderSectie({ initial: { rpe: null, oordeel: 'ja' } })
    fireEvent.click(oordeelKnop(e.oordeelDeels))
    expect(await screen.findByRole('alert')).toHaveTextContent(e.evaluatieOpslaanFout)
    expect(oordeelKnop(e.oordeelJa)).toHaveAttribute('aria-pressed', 'true')
  })

  it.each([[null], ['   '], ['']])('zonder doelstelling (%j): geen oordeelknoppen, wel de uitleg', (doel) => {
    renderSectie({ doelstelling: doel })
    expect(screen.queryByRole('group', { name: e.oordeelLabel })).toBeNull()
    expect(screen.getByText(e.oordeelGeenDoelstelling)).toBeInTheDocument()
    expect(screen.queryByText(e.oordeelJa)).toBeNull()
    // RPE blijft bruikbaar
    expect(within(rpeGroep()).getAllByRole('button')).toHaveLength(10)
  })

  it('een gewiste doelstelling met bestaand oordeel: alleen-lezen, uitleg en wisknop, geen keuzes', () => {
    renderSectie({ doelstelling: null, initial: { rpe: null, oordeel: 'deels' } })
    expect(screen.queryByRole('group', { name: e.oordeelLabel })).toBeNull()
    expect(screen.getByText(e.oordeelDeels)).toBeInTheDocument()
    expect(screen.getByText(e.oordeelZonderDoelstelling)).toBeInTheDocument()
    expect(screen.queryByText(e.oordeelGeenDoelstelling)).toBeNull()
    expect(screen.getByRole('button', { name: e.oordeelWissen })).toBeInTheDocument()
  })

  it('wissen van het oordeel zonder doelstelling werkt met undo', async () => {
    renderSectie({ doelstelling: null, initial: { rpe: null, oordeel: 'deels' } })
    fireEvent.click(screen.getByRole('button', { name: e.oordeelWissen }))
    await waitFor(() => expect(mockWisOordeel).toHaveBeenCalledWith('ev1'))
    expect(screen.queryByText(e.oordeelDeels)).toBeNull()
  })

  it('wissen toont de toast; undo roept herstelTrainingRpe aan en zet de waarde terug', async () => {
    renderSectie({ initial: { rpe: 6, oordeel: null } })
    fireEvent.click(screen.getByRole('button', { name: e.rpeWissen }))
    expect(rpeKnop(6)).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(mockWisRpe).toHaveBeenCalledWith('ev1'))
    fireEvent.click(await screen.findByRole('button', { name: nl.undo.action }))
    await waitFor(() => expect(mockHerstelRpe).toHaveBeenCalledWith(SNAP_RPE))
    await waitFor(() => expect(rpeKnop(6)).toHaveAttribute('aria-pressed', 'true'))
  })

  it('undo van het oordeel roept herstelTrainingOordeel aan', async () => {
    renderSectie({ initial: { rpe: null, oordeel: 'deels' } })
    fireEvent.click(screen.getByRole('button', { name: e.oordeelWissen }))
    await waitFor(() => expect(mockWisOordeel).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: nl.undo.action }))
    await waitFor(() => expect(mockHerstelOordeel).toHaveBeenCalledWith(SNAP_OORDEEL))
    await waitFor(() => expect(oordeelKnop(e.oordeelDeels)).toHaveAttribute('aria-pressed', 'true'))
  })

  it('een falende wis zet de waarde terug en toont undo.deleteError', async () => {
    mockWisRpe.mockRejectedValue(new Error('x'))
    renderSectie({ initial: { rpe: 6, oordeel: null } })
    fireEvent.click(screen.getByRole('button', { name: e.rpeWissen }))
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.undo.deleteError)
    expect(rpeKnop(6)).toHaveAttribute('aria-pressed', 'true')
  })

  it('de wisknop staat alleen bij een bestaande waarde', () => {
    renderSectie()
    expect(screen.queryByRole('button', { name: e.rpeWissen })).toBeNull()
    expect(screen.queryByRole('button', { name: e.oordeelWissen })).toBeNull()
  })

  it('canEdit=false: alleen tekst, geen knoppen (R.6/O.5)', () => {
    renderSectie({ canEdit: false, initial: { rpe: 7, oordeel: 'nee' } })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText(`RPE 7 · ${(e.rpeAnkers as Record<string, string>)['7']}`)).toBeInTheDocument()
    expect(screen.getByText(e.oordeelNee)).toBeInTheDocument()
  })

  it('canEdit=false zonder waarden: niet-ingevuld-teksten; zonder doelstelling de uitleg', () => {
    const { rerender } = renderSectie({ canEdit: false })
    expect(screen.getByText(e.rpeNietIngevuld)).toBeInTheDocument()
    expect(screen.getByText(e.oordeelNietIngevuld)).toBeInTheDocument()
    rerender(
      <DictProvider dict={nl}>
        <ToastProvider teamId="t1">
          <TrainingEvaluatieSectie eventId="ev1" initial={{ rpe: null, oordeel: null }} doelstelling={null} canEdit={false} trainingGehouden bronFout={false} />
        </ToastProvider>
      </DictProvider>,
    )
    expect(screen.getByText(e.oordeelGeenDoelstelling)).toBeInTheDocument()
    expect(screen.queryByText(e.oordeelNietIngevuld)).toBeNull()
  })

  it('trainingGehouden=false geeft evaluatieToekomst zonder invoer', () => {
    renderSectie({ trainingGehouden: false })
    expect(screen.getByText(e.evaluatieToekomst)).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('bronFout geeft evaluatieNietBeschikbaar zonder invoer, ook als de training in de toekomst ligt', () => {
    renderSectie({ bronFout: true, trainingGehouden: false })
    expect(screen.getByText(e.evaluatieNietBeschikbaar)).toBeInTheDocument()
    expect(screen.queryByText(e.evaluatieToekomst)).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('volgt een nieuwe waarde uit de server na router.refresh (prop→state-sync)', () => {
    const { rerender } = renderSectie({ initial: { rpe: 4, oordeel: null } })
    const opnieuw = (rpe: number | null) => rerender(
      <DictProvider dict={nl}>
        <ToastProvider teamId="t1">
          <TrainingEvaluatieSectie eventId="ev1" initial={{ rpe, oordeel: null }} doelstelling="x" canEdit trainingGehouden bronFout={false} />
        </ToastProvider>
      </DictProvider>,
    )
    opnieuw(8)
    expect(rpeKnop(8)).toHaveAttribute('aria-pressed', 'true')
    opnieuw(null)
    expect(screen.queryByRole('button', { name: e.rpeWissen })).toBeNull()
  })

  it('geselecteerde keuze is --primary, nooit een kleur per oordeel; geen #hex in het bronbestand', () => {
    renderSectie({ initial: { rpe: null, oordeel: 'nee' } })
    expect(oordeelKnop(e.oordeelNee).style.background).toContain('var(--primary)')
    expect(oordeelKnop(e.oordeelJa).style.background).toBe('')
    const src = readFileSync(join(process.cwd(), 'components/TrainingEvaluatieSectie.tsx'), 'utf8')
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(src).not.toMatch(/transition-all/)
  })
})
