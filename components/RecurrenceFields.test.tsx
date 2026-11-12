import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import RecurrenceFields, { recurringErrorText } from '@/components/RecurrenceFields'
import { planRecurringTrainings } from '@/lib/recurring-trainings'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

type Props = React.ComponentProps<typeof RecurrenceFields>

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    enabled: true,
    onEnabledChange: vi.fn(),
    days: [],
    onDaysChange: vi.fn(),
    until: '',
    onUntilChange: vi.fn(),
    startDate: '2026-11-02',
    plan: null,
    existingCheckFailed: false,
    showEndDateHint: false,
    ...over,
  }
  const view = render(
    <DictProvider dict={nl}>
      <form data-testid="form"><RecurrenceFields {...props} /></form>
    </DictProvider>,
  )
  return { props, ...view }
}

describe('RecurrenceFields', () => {
  it('toont alleen de schakelaar als herhalen uit staat', () => {
    setup({ enabled: false })
    const toggle = screen.getByRole('switch', { name: nl.event.recurring.repeatToggle })
    expect(toggle).not.toBeChecked()
    expect(screen.queryByRole('group')).toBeNull()
    expect(document.querySelector('input[name="repeat_until"]')).toBeNull()
  })

  it('meldt het aanzetten van de schakelaar', () => {
    const { props } = setup({ enabled: false })
    fireEvent.click(screen.getByRole('switch'))
    expect(props.onEnabledChange).toHaveBeenCalledWith(true)
  })

  it('toont zeven weekdagknoppen ma..zo met aria-pressed', () => {
    setup({ days: [2, 4] })
    const group = screen.getByRole('group', { name: nl.event.recurring.weekdaysLabel })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(
      ['false', 'true', 'false', 'true', 'false', 'false', 'false'],
    )
  })

  it('zet een dag aan en uit via onDaysChange', () => {
    const { props } = setup({ days: [2] })
    fireEvent.click(screen.getByRole('button', { name: 'Do' }))
    expect(props.onDaysChange).toHaveBeenLastCalledWith([2, 4])
    fireEvent.click(screen.getByRole('button', { name: 'Di' }))
    expect(props.onDaysChange).toHaveBeenLastCalledWith([])
  })

  it('zondag (0) is de laatste knop en wordt als 0 doorgegeven', () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Zo' }))
    expect(props.onDaysChange).toHaveBeenCalledWith([0])
  })

  it('schrijft repeat_days en repeat_until mee in de form-data', () => {
    setup({ days: [2, 4], until: '2026-12-01' })
    const fd = new FormData(screen.getByTestId('form') as HTMLFormElement)
    expect(fd.get('repeat_days')).toBe('2,4')
    expect(fd.get('repeat_until')).toBe('2026-12-01')
  })

  it('einddatum is verplicht en heeft min = startdatum', () => {
    setup({ startDate: '2026-11-02' })
    const input = screen.getByLabelText(nl.event.recurring.endDateLabel)
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('min', '2026-11-02')
  })

  it('meldt een wijziging van de einddatum', () => {
    const { props } = setup()
    fireEvent.change(screen.getByLabelText(nl.event.recurring.endDateLabel), { target: { value: '2026-12-01' } })
    expect(props.onUntilChange).toHaveBeenCalledWith('2026-12-01')
  })

  it('toont de hint zonder seizoenseinde zolang de einddatum leeg is', () => {
    const { rerender, props } = setup({ showEndDateHint: true })
    expect(screen.getByText(nl.event.recurring.endDateRequiredHint)).toBeTruthy()
    rerender(
      <DictProvider dict={nl}><form><RecurrenceFields {...props} showEndDateHint until="2026-12-01" /></form></DictProvider>,
    )
    expect(screen.queryByText(nl.event.recurring.endDateRequiredHint)).toBeNull()
  })

  it('toont geen hint als er wel een seizoenseinde is', () => {
    setup({ showEndDateHint: false })
    expect(screen.queryByText(nl.event.recurring.endDateRequiredHint)).toBeNull()
  })

  it('teller toont aantal, dagnamen en het aantal overgeslagen', () => {
    // di + do, 2 t/m 15 november 2026: 4 datums; 1 bestaat al.
    const plan = planRecurringTrainings('2026-11-02', '2026-11-15', [2, 4], new Set(['2026-11-03']))
    setup({ days: [2, 4], until: '2026-11-15', plan })
    const counter = screen.getByText(/worden aangemaakt/)
    expect(counter.textContent).toContain('3 trainingen worden aangemaakt')
    expect(counter.textContent).toContain('Di + Do')
    expect(counter.textContent).toContain('1 overgeslagen')
    expect(counter.closest('[aria-live="polite"]')).toBeTruthy()
  })

  it('toont de waarschuwing als de bestaande-check mislukte', () => {
    const plan = planRecurringTrainings('2026-11-02', '2026-11-15', [2])
    setup({ days: [2], until: '2026-11-15', plan, existingCheckFailed: true })
    expect(screen.getByText(nl.event.recurring.counterCheckFailed)).toBeTruthy()
  })

  it('toont een inline foutmelding bij een ongeldig plan', () => {
    const plan = planRecurringTrainings('2026-11-02', '2026-10-01', [2])
    setup({ days: [2], until: '2026-10-01', plan })
    expect(screen.getByText(nl.event.recurring.errors.end_before_start)).toBeTruthy()
  })

  it('toont no_weekdays zonder gekozen dagen', () => {
    const plan = planRecurringTrainings('2026-11-02', '2026-11-15', [])
    setup({ until: '2026-11-15', plan })
    expect(screen.getByText(nl.event.recurring.errors.no_weekdays)).toBeTruthy()
  })

  it('toont geen fout voor een nog lege einddatum', () => {
    const plan = planRecurringTrainings('2026-11-02', '', [2])
    setup({ days: [2], until: '', plan })
    expect(screen.queryByText(nl.event.recurring.errors.invalid_end_date)).toBeNull()
  })

  it('vult {max} in bij too_long', () => {
    expect(recurringErrorText(nl, 'too_long')).toMatch(/800/)
    expect(recurringErrorText(nl, 'too_long')).not.toContain('{max}')
  })

  it('gebruikt enkelvoud bij precies 1 training', () => {
    const plan = planRecurringTrainings('2026-11-02', '2026-11-02', [1])
    setup({ days: [1], until: '2026-11-02', plan })
    expect(screen.getByText(/1 training wordt aangemaakt/)).toBeTruthy()
  })

  it('legt uit dat er geen gekozen weekdag in de periode valt', () => {
    // alleen dinsdag, woensdag 4 t/m maandag 9 november: geen dinsdag erin
    const plan = planRecurringTrainings('2026-11-04', '2026-11-09', [2])
    setup({ days: [2], startDate: '2026-11-04', until: '2026-11-09', plan })
    expect(screen.getByText(nl.event.recurring.counterNoDays)).toBeTruthy()
  })

  it('toont een eigen hint als het seizoenseinde al voorbij is', () => {
    setup({ seasonEndPast: true })
    expect(screen.getByText(nl.event.recurring.endDateSeasonOverHint)).toBeTruthy()
    expect(screen.queryByText(nl.event.recurring.endDateRequiredHint)).toBeNull()
  })
})
