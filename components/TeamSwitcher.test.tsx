import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { ALLE_RECHTEN } from '@/lib/team-rechten'
import type { TeamLidmaatschap } from '@/lib/team-context'
import TeamSwitcher from '@/components/TeamSwitcher'

vi.mock('@/app/actions/team', () => ({
  setActiveTeam: vi.fn(),
  createTeam: vi.fn(),
}))

import { setActiveTeam, createTeam } from '@/app/actions/team'
const mockSetActiveTeam = setActiveTeam as unknown as ReturnType<typeof vi.fn>
const mockCreateTeam = createTeam as unknown as ReturnType<typeof vi.fn>

function team(overrides: Partial<TeamLidmaatschap> = {}): TeamLidmaatschap {
  return { teamId: 't1', naam: 'FC Voorbeeld', rol: 'owner', rechten: ALLE_RECHTEN, ...overrides }
}

function renderSwitcher(teams: TeamLidmaatschap[], activeTeamId: string, variant: 'desktop' | 'mobile' = 'desktop') {
  return render(
    <DictProvider dict={nl}>
      <TeamSwitcher teams={teams} activeTeamId={activeTeamId} variant={variant} />
    </DictProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSetActiveTeam.mockResolvedValue(undefined)
  mockCreateTeam.mockResolvedValue(undefined)
})

describe('TeamSwitcher — één team', () => {
  it('toont alleen de teamnaam als platte tekst, geen knop (validatiebevinding 11)', () => {
    renderSwitcher([team()], 't1')
    expect(screen.getByText('FC Voorbeeld')).toBeInTheDocument()
    // Geen knop bij één team: een disabled knop met aria-label zou een
    // schermlezer een onbeschikbare actie melden i.p.v. gewoon de naam.
    expect(screen.queryByRole('button', { name: nl.team.switcherLabel })).not.toBeInTheDocument()
  })

  it('geen teams → rendert niets', () => {
    const { container } = renderSwitcher([], 't1')
    expect(container.firstChild).toBeNull()
  })
})

describe('TeamSwitcher — meerdere teams', () => {
  const teams = [team({ teamId: 't1', naam: 'FC Alpha' }), team({ teamId: 't2', naam: 'FC Beta', rol: 'assistent' })]

  it('opent het menu en toont beide teams als los te kiezen item', () => {
    renderSwitcher(teams, 't1')
    fireEvent.click(screen.getByRole('button', { name: nl.team.switcherLabel }))
    expect(screen.getByRole('menuitemradio', { name: nl.team.switchTo.replace('{team}', 'FC Alpha') })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: nl.team.switchTo.replace('{team}', 'FC Beta') })).toBeInTheDocument()
  })

  it('Escape sluit het menu en brengt de focus terug naar de trigger (validatiebevinding 11)', () => {
    renderSwitcher(teams, 't1')
    const trigger = screen.getByRole('button', { name: nl.team.switcherLabel })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(trigger).toHaveFocus()
  })

  it('een klik buiten het paneel (desktop) sluit het menu maar trekt de focus NIET terug naar de trigger (coordinator-ronde 2)', () => {
    renderSwitcher(teams, 't1')
    const trigger = screen.getByRole('button', { name: nl.team.switcherLabel })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    // Focus staat ergens anders — de gebruiker klikte bewust weg van het paneel.
    document.body.focus()
    fireEvent.mouseDown(document.body)
    expect(trigger).not.toHaveFocus()
  })

  it('markeert het actieve team met aria-checked', () => {
    renderSwitcher(teams, 't2')
    fireEvent.click(screen.getByRole('button', { name: nl.team.switcherLabel }))
    expect(screen.getByRole('menuitemradio', { name: nl.team.switchTo.replace('{team}', 'FC Alpha') })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: nl.team.switchTo.replace('{team}', 'FC Beta') })).toHaveAttribute('aria-checked', 'true')
  })

  it('klikken op een ander team roept setActiveTeam aan met dat team-id', async () => {
    renderSwitcher(teams, 't1')
    fireEvent.click(screen.getByRole('button', { name: nl.team.switcherLabel }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: nl.team.switchTo.replace('{team}', 'FC Beta') }))
    await waitFor(() => expect(mockSetActiveTeam).toHaveBeenCalledWith('t2'))
  })

  it('een mislukte wissel toont de foutmelding', async () => {
    mockSetActiveTeam.mockRejectedValueOnce(new Error('Team niet gevonden'))
    renderSwitcher(teams, 't1')
    fireEvent.click(screen.getByRole('button', { name: nl.team.switcherLabel }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: nl.team.switchTo.replace('{team}', 'FC Beta') }))
    await waitFor(() => expect(screen.getByText(nl.team.switchFailed)).toBeInTheDocument())
  })

  it('"Team aanmaken" toont het naamveld en roept createTeam aan met de ingevulde naam', async () => {
    renderSwitcher(teams, 't1')
    fireEvent.click(screen.getByRole('button', { name: nl.team.switcherLabel }))
    fireEvent.click(screen.getByText(nl.team.createTeam))
    const input = screen.getByLabelText(nl.team.createTeamNameLabel)
    fireEvent.change(input, { target: { value: 'FC Gamma' } })
    fireEvent.click(screen.getByRole('button', { name: nl.team.createTeam }))
    await waitFor(() => expect(mockCreateTeam).toHaveBeenCalledWith('FC Gamma'))
  })

  it('een mislukte teamaanmaak toont de vaste i18n-melding, nooit de rauwe actiefout (validatiebevinding 8)', async () => {
    mockCreateTeam.mockRejectedValueOnce(new Error('Vul een teamnaam in'))
    renderSwitcher(teams, 't1')
    fireEvent.click(screen.getByRole('button', { name: nl.team.switcherLabel }))
    fireEvent.click(screen.getByText(nl.team.createTeam))
    fireEvent.change(screen.getByLabelText(nl.team.createTeamNameLabel), { target: { value: 'FC Gamma' } })
    fireEvent.click(screen.getByRole('button', { name: nl.team.createTeam }))
    await waitFor(() => expect(screen.getByText(nl.team.switchFailed)).toBeInTheDocument())
    expect(screen.queryByText('Vul een teamnaam in')).not.toBeInTheDocument()
  })

  it('lege naam blokkeert de aanmaakknop', () => {
    renderSwitcher(teams, 't1')
    fireEvent.click(screen.getByRole('button', { name: nl.team.switcherLabel }))
    fireEvent.click(screen.getByText(nl.team.createTeam))
    const submit = screen.getByRole('button', { name: nl.team.createTeam })
    expect(submit).toBeDisabled()
  })
})
