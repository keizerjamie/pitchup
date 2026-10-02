import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/app/actions/events', () => ({
  updateEvent: vi.fn(),
}))

import EditEventForm from '@/components/EditEventForm'
import { updateEvent } from '@/app/actions/events'

const mockedUpdate = vi.mocked(updateEvent)

const training = {
  id: 'e1', type: 'training' as const, date: '2026-10-03', time: '18:30',
  location: 'Veld 1', notes: 'Notitie', opponent: '', matchType: null, homeAway: null,
}
const match = {
  id: 'e2', type: 'match' as const, date: '2026-10-10', time: '',
  location: '', notes: '', opponent: 'FC Test', matchType: 'cup' as const, homeAway: 'away' as const,
}

function renderForm(event: Parameters<typeof EditEventForm>[0]['event'] = training) {
  return render(
    <DictProvider dict={nl}>
      <EditEventForm event={event} />
    </DictProvider>,
  )
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`${nl.event.saveChanges}|${nl.event.saving}`) }))
}

beforeEach(() => {
  mockedUpdate.mockReset()
})

describe('EditEventForm — weergave', () => {
  it('training: titel, vooringevulde velden, geen typeschakelaar of hidden type', () => {
    const { container } = renderForm()
    expect(screen.getByRole('heading', { name: nl.event.editTitleTraining })).toBeInTheDocument()
    expect(container.querySelector('input[name="date"]')).toHaveValue('2026-10-03')
    expect(container.querySelector('input[name="time"]')).toHaveValue('18:30')
    expect(container.querySelector('input[name="location"]')).toHaveValue('Veld 1')
    expect(container.querySelector('textarea[name="notes"]')).toHaveValue('Notitie')
    expect(container.querySelector('input[name="type"]')).toBeNull()
    expect(container.querySelector('input[name="gather_time"]')).toBeNull()
    expect(container.querySelector('input[name="trainingstype"]')).toBeNull()
    expect(container.querySelector('input[name="opponent"]')).toBeNull()
    expect(screen.getByRole('button', { name: nl.event.saveChanges })).toBeEnabled()
  })

  it('wedstrijd: titel, tegenstander, radio’s voorgeselecteerd, lege tijd blijft leeg', () => {
    const { container } = renderForm(match)
    expect(screen.getByRole('heading', { name: nl.event.editTitleMatch })).toBeInTheDocument()
    expect(container.querySelector('input[name="opponent"]')).toHaveValue('FC Test')
    expect(container.querySelector('input[name="match_type"][value="cup"]')).toBeChecked()
    expect(container.querySelector('input[name="home_away"][value="away"]')).toBeChecked()
    expect(container.querySelector('input[name="time"]')).toHaveValue('')
  })

  it('wedstrijd zonder match_type/home_away: geen radio voorgeselecteerd', () => {
    const { container } = renderForm({ ...match, matchType: null, homeAway: null })
    expect(container.querySelectorAll('input[type="radio"]:checked')).toHaveLength(0)
  })
})

describe('EditEventForm — opslaan', () => {
  it('roept updateEvent aan met id en de formuliergegevens (zonder type)', async () => {
    mockedUpdate.mockReturnValue(new Promise(() => {}))
    const { container } = renderForm()
    fireEvent.change(container.querySelector('input[name="location"]')!, { target: { value: 'Veld 3' } })
    submit()
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1))
    const [id, fd] = mockedUpdate.mock.calls[0]
    expect(id).toBe('e1')
    expect(fd.get('date')).toBe('2026-10-03')
    expect(fd.get('time')).toBe('18:30')
    expect(fd.get('location')).toBe('Veld 3')
    expect(fd.get('notes')).toBe('Notitie')
    expect(fd.has('type')).toBe(false)
  })

  it('bezig-state: knop disabled, aria-busy en label "Opslaan..."; tweede submit doet niets', async () => {
    mockedUpdate.mockReturnValue(new Promise(() => {}))
    const { container } = renderForm()
    submit()
    const busy = await screen.findByRole('button', { name: nl.event.saving })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    fireEvent.submit(container.querySelector('form')!)
    expect(mockedUpdate).toHaveBeenCalledTimes(1)
  })

  it('redirect (NEXT_REDIRECT-rejectie) toont geen fout en blijft in de bezig-state', async () => {
    const redirectError = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;push;/events/e1;303;' })
    mockedUpdate.mockRejectedValue(redirectError)
    renderForm()
    submit()
    const busy = await screen.findByRole('button', { name: nl.event.saving })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(busy).toBeDisabled()
    expect(screen.queryByText('NEXT_REDIRECT')).toBeNull()
  })

  it.each([
    'not_found', 'invalid_date', 'invalid_time', 'invalid_match_type', 'invalid_home_away', 'opponent_required',
  ] as const)('fout %s: toont de vertaalde melding, knop weer actief, invoer blijft', async (code) => {
    mockedUpdate.mockResolvedValue({ error: code })
    const { container } = renderForm()
    fireEvent.change(container.querySelector('input[name="location"]')!, { target: { value: 'Nieuw veld' } })
    submit()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(nl.event.editErrors[code])
    expect(screen.getByRole('button', { name: nl.event.saveChanges })).toBeEnabled()
    expect(container.querySelector('input[name="location"]')).toHaveValue('Nieuw veld')
  })

  it('gegooide fout: algemene melding, nooit err.message, knop weer actief', async () => {
    mockedUpdate.mockRejectedValue(new Error('Geen toegang'))
    renderForm()
    submit()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(nl.event.editErrorGeneric)
    expect(screen.queryByText(/Geen toegang/)).toBeNull()
    expect(screen.getByRole('button', { name: nl.event.saveChanges })).toBeEnabled()
  })

  it('niet-Error rejectie geeft ook de algemene melding', async () => {
    mockedUpdate.mockRejectedValue('boom')
    renderForm()
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.event.editErrorGeneric)
  })

  it('een nieuwe poging na een fout wist de melding en roept opnieuw aan', async () => {
    mockedUpdate.mockResolvedValueOnce({ error: 'invalid_date' }).mockReturnValue(new Promise(() => {}))
    renderForm()
    submit()
    await screen.findByRole('alert')
    submit()
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(mockedUpdate).toHaveBeenCalledTimes(2)
  })
})
