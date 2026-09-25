import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import TeamsSection from '@/components/settings/TeamsSection'

vi.mock('@/app/actions/team', () => ({
  getTeamDeleteInfo: vi.fn(),
  deleteTeam: vi.fn(),
}))

import { getTeamDeleteInfo, deleteTeam } from '@/app/actions/team'
const mockGetInfo = getTeamDeleteInfo as unknown as ReturnType<typeof vi.fn>
const mockDeleteTeam = deleteTeam as unknown as ReturnType<typeof vi.fn>

const teams = [
  { teamId: 'team-1', naam: 'De Kampioenen' },
  { teamId: 'team-2', naam: 'FC Reserve' },
]

function renderSection(list = teams) {
  return render(
    <DictProvider dict={nl}>
      <TeamsSection teams={list} />
    </DictProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TeamsSection', () => {
  it('rendert niets zonder eigen teams', () => {
    const { container } = renderSection([])
    expect(container).toBeEmptyDOMElement()
  })

  it('toont elk team met een "Team verwijderen"-knop', () => {
    renderSection()
    expect(screen.getByText('De Kampioenen')).toBeInTheDocument()
    expect(screen.getByText('FC Reserve')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: nl.teamsBeheer.deleteTeam })).toHaveLength(2)
  })

  it('haalt bij het openen getTeamDeleteInfo op en toont teamnaam + aantal assistenten in de bevestigingstekst', async () => {
    mockGetInfo.mockResolvedValue({ naam: 'De Kampioenen', aantalAssistenten: 3 })
    renderSection()
    fireEvent.click(screen.getAllByRole('button', { name: nl.teamsBeheer.deleteTeam })[0])
    expect(mockGetInfo).toHaveBeenCalledWith('team-1')
    await waitFor(() => expect(screen.getByLabelText(nl.settings.deleteConfirmPrompt)).toBeInTheDocument())
    // "De Kampioenen" staat zowel in de teamregel als in de bevestigingstekst
    // (deleteTeamHint) — vandaar minimaal twee treffers i.p.v. getByText.
    expect(screen.getAllByText('De Kampioenen', { exact: false }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(nl.teamsBeheer.deleteTeamAssistants.replace('{n}', '3'))).toBeInTheDocument()
  })

  it('houdt de bevestigknop disabled totdat VERWIJDER exact getypt is', async () => {
    mockGetInfo.mockResolvedValue({ naam: 'De Kampioenen', aantalAssistenten: 0 })
    renderSection()
    fireEvent.click(screen.getAllByRole('button', { name: nl.teamsBeheer.deleteTeam })[0])
    await waitFor(() => screen.getByLabelText(nl.settings.deleteConfirmPrompt))

    const confirmButton = screen.getByRole('button', { name: nl.settings.deleteConfirmFinal })
    expect(confirmButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText(nl.settings.deleteConfirmPrompt), { target: { value: 'verwijder' } })
    expect(confirmButton).not.toBeDisabled()
  })

  it('roept deleteTeam aan zodra bevestigd, met een pending-state', async () => {
    mockGetInfo.mockResolvedValue({ naam: 'De Kampioenen', aantalAssistenten: 1 })
    let resolveDelete: () => void = () => {}
    mockDeleteTeam.mockReturnValue(new Promise<void>((resolve) => { resolveDelete = resolve }))
    renderSection()
    fireEvent.click(screen.getAllByRole('button', { name: nl.teamsBeheer.deleteTeam })[0])
    await waitFor(() => screen.getByLabelText(nl.settings.deleteConfirmPrompt))
    fireEvent.change(screen.getByLabelText(nl.settings.deleteConfirmPrompt), { target: { value: 'VERWIJDER' } })

    fireEvent.click(screen.getByRole('button', { name: nl.settings.deleteConfirmFinal }))
    expect(mockDeleteTeam).toHaveBeenCalledWith('team-1')
    await waitFor(() => expect(screen.getByRole('button', { name: nl.teamsBeheer.deleting })).toBeDisabled())
    resolveDelete()
  })

  it('een mislukte deleteTeam houdt het bevestigingsblok open met de fout erin (DeleteAccountSection-patroon) en wist de getypte bevestiging', async () => {
    mockGetInfo.mockResolvedValue({ naam: 'De Kampioenen', aantalAssistenten: 0 })
    mockDeleteTeam.mockRejectedValueOnce(new Error('Geen toegang'))
    renderSection()
    fireEvent.click(screen.getAllByRole('button', { name: nl.teamsBeheer.deleteTeam })[0])
    await waitFor(() => screen.getByLabelText(nl.settings.deleteConfirmPrompt))
    fireEvent.change(screen.getByLabelText(nl.settings.deleteConfirmPrompt), { target: { value: 'VERWIJDER' } })
    fireEvent.click(screen.getByRole('button', { name: nl.settings.deleteConfirmFinal }))

    await waitFor(() => expect(screen.getByText(nl.teamsBeheer.deleteFailed)).toBeInTheDocument())
    expect(screen.queryByText('Geen toegang')).not.toBeInTheDocument()
    // Het blok blijft open (het typ-VERWIJDER-veld is nog steeds te vinden)
    // en de eerder getypte bevestiging is gewist, dus de knop staat niet
    // meteen weer scherp.
    const input = screen.getByLabelText(nl.settings.deleteConfirmPrompt) as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.value).toBe('')
    expect(screen.getByRole('button', { name: nl.settings.deleteConfirmFinal })).toBeDisabled()
  })

  it('een mislukte getTeamDeleteInfo toont een eigen melding (niet "Verwijderen mislukt") en opent geen bevestigingsblok', async () => {
    mockGetInfo.mockRejectedValueOnce(new Error('Geen toegang'))
    renderSection()
    fireEvent.click(screen.getAllByRole('button', { name: nl.teamsBeheer.deleteTeam })[0])
    await waitFor(() => expect(screen.getByText(nl.teamsBeheer.infoFailed)).toBeInTheDocument())
    expect(screen.queryByText(nl.teamsBeheer.deleteFailed)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(nl.settings.deleteConfirmPrompt)).not.toBeInTheDocument()
  })

  it('tijdens het ophalen van de team-info blijft de knop staan met aria-busy/disabled en een schermlezertekst (geen focusverlies)', async () => {
    let resolveInfo: (v: { naam: string; aantalAssistenten: number }) => void = () => {}
    mockGetInfo.mockReturnValue(new Promise((resolve) => { resolveInfo = resolve }))
    renderSection()
    const trigger = screen.getAllByRole('button', { name: nl.teamsBeheer.deleteTeam })[0]
    trigger.focus()
    fireEvent.click(trigger)

    // Zelfde knop-node: nog steeds vindbaar via dezelfde accessible name,
    // nu disabled + aria-busy, met een sr-only statustekst — geen "…" die de
    // knop uit de DOM haalt.
    await waitFor(() => expect(trigger).toBeDisabled())
    expect(trigger).toHaveAttribute('aria-busy', 'true')
    expect(trigger).toHaveTextContent(nl.teamsBeheer.loadingInfo)
    expect(document.activeElement).toBe(trigger)

    resolveInfo({ naam: 'De Kampioenen', aantalAssistenten: 0 })
    await waitFor(() => expect(screen.getByLabelText(nl.settings.deleteConfirmPrompt)).toBeInTheDocument())
  })
})
