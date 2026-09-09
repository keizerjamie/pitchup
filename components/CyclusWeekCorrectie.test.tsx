import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import CyclusWeekCorrectie from '@/components/CyclusWeekCorrectie'
import { saveCyclusWeekCorrectie, deleteCyclusWeekCorrectie } from '@/app/actions/periodisering'

vi.mock('@/app/actions/periodisering', () => ({
  saveCyclusWeekCorrectie: vi.fn(),
  deleteCyclusWeekCorrectie: vi.fn(),
}))

const mockedSave = vi.mocked(saveCyclusWeekCorrectie)
const mockedDelete = vi.mocked(deleteCyclusWeekCorrectie)

beforeEach(() => {
  mockedSave.mockReset().mockResolvedValue(undefined)
  mockedDelete.mockReset().mockResolvedValue(undefined)
})

function renderComponent(overrides: Partial<Parameters<typeof CyclusWeekCorrectie>[0]> = {}) {
  return render(
    <DictProvider dict={nl}>
      <CyclusWeekCorrectie huidigeWeek={2} heeftCorrectie={false} {...overrides} />
    </DictProvider>,
  )
}

describe('CyclusWeekCorrectie — trigger en sheet', () => {
  it('toont de trigger-knop en opent de sheet met de huidige week voorgeselecteerd', () => {
    renderComponent({ huidigeWeek: 3 })
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))

    expect(screen.getByText(nl.periodization.adjustWeekTitle)).toBeInTheDocument()
    const radiogroup = screen.getByRole('radiogroup', { name: nl.periodization.adjustWeekLegend })
    const options = screen.getAllByRole('radio')
    expect(options).toHaveLength(6)
    expect(options[2]).toHaveAttribute('aria-checked', 'true') // week 3
    expect(radiogroup).toBeInTheDocument()
  })

  it('huidigeWeek null valt terug op week 1', () => {
    renderComponent({ huidigeWeek: null })
    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))
    const options = screen.getAllByRole('radio')
    expect(options[0]).toHaveAttribute('aria-checked', 'true')
  })

  it('Annuleren sluit de sheet zonder de action aan te roepen', () => {
    renderComponent()
    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))
    fireEvent.click(screen.getByText(nl.trainingPlan.cancel))
    expect(screen.queryByText(nl.periodization.adjustWeekTitle)).not.toBeInTheDocument()
    expect(mockedSave).not.toHaveBeenCalled()
  })

  it('een andere week kiezen en opslaan roept saveCyclusWeekCorrectie aan en sluit de sheet', async () => {
    renderComponent({ huidigeWeek: 2 })
    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))

    const options = screen.getAllByRole('radio')
    fireEvent.click(options[5]) // Week 6
    expect(options[5]).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByText(nl.periodization.saveWeek))
    await waitFor(() => expect(mockedSave).toHaveBeenCalledWith(6))
    await waitFor(() => expect(screen.queryByText(nl.periodization.adjustWeekTitle)).not.toBeInTheDocument())
  })

  it('"Terug naar automatisch" alleen zichtbaar met heeftCorrectie=true, roept deleteCyclusWeekCorrectie aan', async () => {
    renderComponent({ heeftCorrectie: false })
    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))
    expect(screen.queryByText(nl.periodization.backToAutomatic)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(nl.trainingPlan.cancel))

    renderComponent({ heeftCorrectie: true })
    fireEvent.click(screen.getAllByText(nl.periodization.adjustWeekCta)[1])
    fireEvent.click(screen.getByText(nl.periodization.backToAutomatic))
    await waitFor(() => expect(mockedDelete).toHaveBeenCalledTimes(1))
  })

  it('ongeldige-week-fout van de server wordt vertaald naar errorInvalidWeek, sheet blijft open', async () => {
    mockedSave.mockRejectedValueOnce(new Error('Ongeldige cyclusweek'))
    renderComponent()
    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))
    fireEvent.click(screen.getByText(nl.periodization.saveWeek))

    await waitFor(() => expect(screen.getByText(nl.periodization.errorInvalidWeek)).toBeInTheDocument())
    expect(screen.getByText(nl.periodization.adjustWeekTitle)).toBeInTheDocument()
  })

  it('overige serverfouten vallen terug op de generieke foutmelding', async () => {
    mockedSave.mockRejectedValueOnce(new Error('Niet ingelogd'))
    renderComponent()
    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))
    fireEvent.click(screen.getByText(nl.periodization.saveWeek))

    await waitFor(() => expect(screen.getByText(nl.oefeningen.genericError)).toBeInTheDocument())
  })

  it('backdrop-klik sluit de sheet', () => {
    const { container } = renderComponent()
    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))
    expect(screen.getByText(nl.periodization.adjustWeekTitle)).toBeInTheDocument()

    const backdrop = container.querySelector('.backdrop-blur-sm') as HTMLElement
    fireEvent.click(backdrop)
    expect(screen.queryByText(nl.periodization.adjustWeekTitle)).not.toBeInTheDocument()
  })
})
