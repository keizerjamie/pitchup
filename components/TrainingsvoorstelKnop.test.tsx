import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { ToastProvider } from '@/components/ui/Toast'
import TrainingsvoorstelKnop from '@/components/TrainingsvoorstelKnop'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('@/app/actions/training-plan', () => ({ stelTrainingVoor: vi.fn() }))

import { stelTrainingVoor } from '@/app/actions/training-plan'
const mockStel = stelTrainingVoor as unknown as ReturnType<typeof vi.fn>

function renderKnop(props: Partial<{ heeftCyclusweek: boolean; bibliotheekLeeg: boolean }> = {}, dict = nl) {
  return render(
    <DictProvider dict={dict}>
      <ToastProvider teamId="t1">
        <TrainingsvoorstelKnop eventId="e1" heeftCyclusweek={props.heeftCyclusweek ?? true} bibliotheekLeeg={props.bibliotheekLeeg ?? false} />
      </ToastProvider>
    </DictProvider>,
  )
}

describe('TrainingsvoorstelKnop', () => {
  beforeEach(() => vi.clearAllMocks())

  it('zonder cyclusweek: uitleg, geen knop', () => {
    renderKnop({ heeftCyclusweek: false })
    expect(screen.getByText(nl.trainingPlan.voorstelGeenCyclusweek)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lege bibliotheek: uitleg + link naar /oefeningen, geen knop', () => {
    renderKnop({ bibliotheekLeeg: true })
    expect(screen.getByText(nl.trainingPlan.voorstelLegeBibliotheek)).toBeTruthy()
    expect(screen.getByRole('link', { name: nl.trainingPlan.voorstelNaarBibliotheek }).getAttribute('href')).toBe('/oefeningen')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('tik roept stelTrainingVoor(eventId) aan; knop is disabled en toont bezig-label tijdens laden', async () => {
    let klaar!: (v: unknown) => void
    mockStel.mockReturnValue(new Promise((r) => { klaar = r }))
    renderKnop()
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.voorstelKnop }))
    const bezig = await screen.findByRole('button', { name: nl.trainingPlan.voorstelBezig })
    expect((bezig as HTMLButtonElement).disabled).toBe(true)
    expect(mockStel).toHaveBeenCalledTimes(1)
    expect(mockStel).toHaveBeenCalledWith('e1')
    klaar({ ok: true, aantal: 2, overgeslagen: [] })
    await waitFor(() => expect(screen.getByRole('button', { name: nl.trainingPlan.voorstelKnop })).toBeTruthy())
  })

  it('succes met overgeslagen categorie: toast met categorienaam', async () => {
    mockStel.mockResolvedValue({ ok: true, aantal: 1, overgeslagen: ['steigerungs'] })
    renderKnop()
    fireEvent.click(screen.getByRole('button'))
    const verwacht = nl.trainingPlan.voorstelOvergeslagen
      .replace('{n}', '1')
      .replace('{categorieen}', nl.periodization.categories.steigerungs)
    expect(await screen.findByText(verwacht)).toBeTruthy()
  })

  it.each(['niets_passend', 'geen_cyclusweek', 'lege_bibliotheek', 'teamtactisch', 'plan_niet_leeg'] as const)(
    'foutcode %s toont de vertaalde melding in een alert',
    async (code) => {
      mockStel.mockResolvedValue({ ok: false, error: code })
      renderKnop()
      fireEvent.click(screen.getByRole('button'))
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe(nl.trainingPlan.voorstelFout[code])
      if (code === 'plan_niet_leeg') expect(refresh).toHaveBeenCalledTimes(1)
      else expect(refresh).not.toHaveBeenCalled()
    },
  )

  it('throw: toont de algemene melding, nooit de servertekst', async () => {
    mockStel.mockRejectedValue(new Error('Geen toegang'))
    renderKnop()
    fireEvent.click(screen.getByRole('button'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(nl.trainingPlan.voorstelFout.algemeen)
    expect(screen.queryByText('Geen toegang')).toBeNull()
  })

  it('Engelse dictionary', () => {
    renderKnop({}, en)
    expect(screen.getByRole('button', { name: en.trainingPlan.voorstelKnop })).toBeTruthy()
  })
})
