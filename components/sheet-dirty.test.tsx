import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import OefeningEditor from '@/components/OefeningEditor'
import CyclusWeekCorrectie from '@/components/CyclusWeekCorrectie'
import NulmetingManager from '@/components/NulmetingManager'
import KopieerVorigeTraining from '@/components/KopieerVorigeTraining'

vi.mock('@/app/actions/periodisering', () => ({
  saveCyclusWeekCorrectie: vi.fn(),
  deleteCyclusWeekCorrectie: vi.fn(),
  saveCategorieMeting: vi.fn(),
  deleteCategorieMeting: vi.fn(),
}))
vi.mock('@/app/actions/training-plan', () => ({ kopieerTrainingsplan: vi.fn() }))

// Dirty-waarschuwing per formuliersheet (V-D: ook bij achtergrondtik).
// De veeg-variant zit in components/ui/BottomSheet.test.tsx.

function scrimVan(container: HTMLElement) {
  return container.querySelector('.anim-scrim') as HTMLElement
}

let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(() => vi.restoreAllMocks())

describe('OefeningEditor — dirty via bouwInput()', () => {
  function renderEditor() {
    const onCancel = vi.fn()
    const { container } = render(
      <DictProvider dict={nl}>
        <OefeningEditor onCancel={onCancel} onSubmit={vi.fn().mockResolvedValue(undefined)} />
      </DictProvider>,
    )
    return { onCancel, container }
  }

  it('schoon: scrimtik sluit zonder vraag', () => {
    const { onCancel, container } = renderEditor()
    fireEvent.click(scrimVan(container))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('na een wijziging vraagt scrimtik om bevestiging; nee houdt open', () => {
    const { onCancel, container } = renderEditor()
    fireEvent.change(document.getElementById('oefening-naam')!, { target: { value: 'Nieuwe naam' } })
    fireEvent.click(scrimVan(container))
    expect(confirmSpy).toHaveBeenCalledWith(nl.sheet.discardConfirm)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('terug naar de beginwaarde is weer schoon', () => {
    const { onCancel, container } = renderEditor()
    const naam = document.getElementById('oefening-naam')!
    fireEvent.change(naam, { target: { value: 'x' } })
    fireEvent.change(naam, { target: { value: '' } })
    fireEvent.click(scrimVan(container))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('de sluitknop sluit altijd zonder vraag', () => {
    const { onCancel } = renderEditor()
    fireEvent.change(document.getElementById('oefening-naam')!, { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: nl.common.close }))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('CyclusWeekCorrectie — dirty = andere week gekozen', () => {
  function renderCyclus() {
    return render(
      <DictProvider dict={nl}>
        <CyclusWeekCorrectie huidigeWeek={2} heeftCorrectie={false} />
      </DictProvider>,
    )
  }

  it('schoon sluit scrimtik direct; andere week vraagt bevestiging', () => {
    const { container } = renderCyclus()
    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))
    fireEvent.click(scrimVan(container))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))
    fireEvent.click(screen.getAllByRole('radio')[4])
    fireEvent.click(scrimVan(container))
    expect(confirmSpy).toHaveBeenCalledWith(nl.sheet.discardConfirm)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('NulmetingManager — dirty = datum/stap/notities gewijzigd', () => {
  function renderManager() {
    return render(
      <DictProvider dict={nl}>
        <NulmetingManager metingen={[]} peildatumExclusief="2026-10-01" />
      </DictProvider>,
    )
  }

  it('schoon sluit scrimtik direct; getypte notitie vraagt bevestiging', () => {
    const { container } = renderManager()
    fireEvent.click(screen.getAllByText(nl.periodization.measureCta)[0])
    fireEvent.click(scrimVan(container))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getAllByText(nl.periodization.measureCta)[0])
    fireEvent.change(document.getElementById('nulmeting-notitie')!, { target: { value: 'tekst' } })
    fireEvent.click(scrimVan(container))
    expect(confirmSpy).toHaveBeenCalledWith(nl.sheet.discardConfirm)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('KopieerVorigeTraining — geen waarschuwing, geen sluitknop', () => {
  it('scrimtik sluit zonder vraag en de kop heeft geen sluitknop', () => {
    const { container } = render(
      <DictProvider dict={nl}>
        <KopieerVorigeTraining eventId="e1" opties={[{ id: 'b1', date: '2026-10-01', aantal: 3 }]} />
      </DictProvider>,
    )
    fireEvent.click(screen.getByText(nl.trainingPlan.copyPrevious))
    expect(screen.queryByRole('button', { name: nl.common.close })).toBeNull()
    fireEvent.click(scrimVan(container))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
