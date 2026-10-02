import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import EventFormFields from '@/components/EventFormFields'

function renderFields(props: Parameters<typeof EventFormFields>[0]) {
  return render(
    <DictProvider dict={nl}>
      <EventFormFields {...props} />
    </DictProvider>,
  )
}

describe('EventFormFields', () => {
  it('training: toont datum, tijd, locatie en notities, geen wedstrijdvelden', () => {
    const { container } = renderFields({ type: 'training' })
    expect(container.querySelector('input[name="date"]')).toBeRequired()
    expect(container.querySelector('input[name="time"]')).toBeInTheDocument()
    expect(container.querySelector('input[name="location"]')).toBeInTheDocument()
    expect(container.querySelector('textarea[name="notes"]')).toHaveAttribute('placeholder', nl.event.notesTrainingPlaceholder)
    expect(container.querySelector('input[name="opponent"]')).toBeNull()
    expect(container.querySelector('input[name="match_type"]')).toBeNull()
    expect(container.querySelector('input[name="home_away"]')).toBeNull()
    expect(container.querySelector('input[name="type"]')).toBeNull()
    expect(container.querySelector('input[name="gather_time"]')).toBeNull()
  })

  it('wedstrijd: tegenstander is verplicht en notities krijgen de wedstrijd-placeholder', () => {
    const { container } = renderFields({ type: 'match' })
    expect(screen.getByLabelText(nl.event.opponent)).toBeRequired()
    expect(container.querySelectorAll('input[name="match_type"]')).toHaveLength(3)
    expect(container.querySelectorAll('input[name="home_away"]')).toHaveLength(2)
    expect(container.querySelector('textarea[name="notes"]')).toHaveAttribute('placeholder', nl.event.notesMatchPlaceholder)
  })

  it('vult de defaults in en selecteert de juiste radio’s', () => {
    const { container } = renderFields({
      type: 'match',
      defaults: { date: '2026-10-03', time: '14:30', location: 'Veld 2', notes: 'Let op', opponent: 'FC Test', matchType: 'cup', homeAway: 'away' },
    })
    expect(container.querySelector('input[name="date"]')).toHaveValue('2026-10-03')
    expect(container.querySelector('input[name="time"]')).toHaveValue('14:30')
    expect(container.querySelector('input[name="location"]')).toHaveValue('Veld 2')
    expect(container.querySelector('textarea[name="notes"]')).toHaveValue('Let op')
    expect(container.querySelector('input[name="opponent"]')).toHaveValue('FC Test')
    expect(container.querySelector('input[name="match_type"][value="cup"]')).toBeChecked()
    expect(container.querySelector('input[name="match_type"][value="league"]')).not.toBeChecked()
    expect(container.querySelector('input[name="home_away"][value="away"]')).toBeChecked()
  })

  it('geen radio voorgeselecteerd bij null (wedstrijd zonder type/thuis-uit)', () => {
    const { container } = renderFields({ type: 'match', defaults: { matchType: null, homeAway: null } })
    expect(container.querySelectorAll('input[type="radio"]:checked')).toHaveLength(0)
  })

  it('labels zijn aan hun veld gekoppeld', () => {
    renderFields({ type: 'training', defaults: { date: '2026-10-03' } })
    expect(screen.getByLabelText(nl.event.date)).toHaveValue('2026-10-03')
    expect(screen.getByLabelText(nl.event.time)).toBeInTheDocument()
  })

  it('rendert matchExtra alleen bij een wedstrijd, vóór notities', () => {
    const extra = <input name="extra" data-testid="extra" />
    const { container, unmount } = renderFields({ type: 'match', matchExtra: extra })
    const extraEl = screen.getByTestId('extra')
    const notes = container.querySelector('textarea[name="notes"]')!
    expect(extraEl.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    unmount()
    renderFields({ type: 'training', matchExtra: extra })
    expect(screen.queryByTestId('extra')).toBeNull()
  })
})
