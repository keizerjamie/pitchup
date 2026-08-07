import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Player } from '@/lib/types'
import MatchSquadEditor from '@/components/MatchSquadEditor'

vi.mock('@/app/actions/match-squad', () => ({
  toggleSquadPlayer: vi.fn().mockResolvedValue(undefined),
}))

import { toggleSquadPlayer } from '@/app/actions/match-squad'
const mockToggle = toggleSquadPlayer as unknown as ReturnType<typeof vi.fn>

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Piet Peters',
    position: 'Spits',
    secondary_positions: [],
    jersey_number: 9,
    active: true,
    injured: false,
    rating: 5,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const players: Player[] = [
  makePlayer({ id: 'p1', name: 'Piet Peters' }),
  makePlayer({ id: 'p2', name: 'Jan Jansen' }),
  makePlayer({ id: 'p3', name: 'Kees Klaassen' }),
]

function renderEditor(overrides: Partial<Parameters<typeof MatchSquadEditor>[0]> = {}) {
  return render(
    <DictProvider dict={nl}>
      <MatchSquadEditor
        eventId="e1"
        players={overrides.players ?? players}
        initialSelectedIds={overrides.initialSelectedIds ?? []}
        presentPlayerIds={overrides.presentPlayerIds ?? []}
        hasAnyActivePlayers={overrides.hasAnyActivePlayers ?? true}
        opponent={'opponent' in overrides ? overrides.opponent ?? null : 'FC Rivalen'}
        dateLabel={overrides.dateLabel ?? 'zondag 9 augustus 2026'}
      />
    </DictProvider>,
  )
}

function stubPrint() {
  const printSpy = vi.fn()
  Object.defineProperty(window, 'print', { value: printSpy, writable: true, configurable: true })
  return printSpy
}

// De toggle-actie loopt via een React 19 async-transition (startTransition
// met een promise): isPending blijft true totdat die promise settelt. Klikken
// wrappen we daarom in act(async) zodat de microtask vóór de volgende
// assertie/klik is afgehandeld (anders blijft de knop van de VORIGE klik nog
// even disabled en gaat een opvolgende klik verloren).
async function clickToggle(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('toggle', () => {
  it('zet aria-pressed om en roept de gemockte server action aan met de nieuwe waarde', async () => {
    renderEditor()
    const btn = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Piet Peters` })
    expect(btn).toHaveAttribute('aria-pressed', 'false')

    await clickToggle(`${nl.matchSquad.toggleLabel}: Piet Peters`)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(mockToggle).toHaveBeenCalledWith('e1', 'p1', true)

    await clickToggle(`${nl.matchSquad.toggleLabel}: Piet Peters`)
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(mockToggle).toHaveBeenCalledWith('e1', 'p1', false)
  })

  it('de teller loopt mee met de selectie', async () => {
    renderEditor()
    expect(screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '0'))).toBeInTheDocument()

    await clickToggle(`${nl.matchSquad.toggleLabel}: Piet Peters`)
    expect(screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '1'))).toBeInTheDocument()

    await clickToggle(`${nl.matchSquad.toggleLabel}: Jan Jansen`)
    expect(screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '2'))).toBeInTheDocument()
  })
})

describe('mislukte save', () => {
  it('rolt de optimistische state terug en toont een foutmelding als de server action wordt afgewezen', async () => {
    mockToggle.mockRejectedValueOnce(new Error('Niet ingelogd'))
    renderEditor()
    const btn = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Piet Peters` })
    expect(btn).toHaveAttribute('aria-pressed', 'false')

    await clickToggle(`${nl.matchSquad.toggleLabel}: Piet Peters`)

    // Rollback: de speler staat weer op niet-geselecteerd, teller weer op 0.
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '0'))).toBeInTheDocument()
    // Foutmelding zichtbaar, geen rauwe servertekst.
    expect(screen.getByText(nl.matchSquad.saveError)).toBeInTheDocument()
    expect(screen.queryByText('Niet ingelogd')).not.toBeInTheDocument()
  })

  it('een volgende, geslaagde toggle wist de eerdere foutmelding', async () => {
    mockToggle.mockRejectedValueOnce(new Error('Niet ingelogd'))
    renderEditor()

    await clickToggle(`${nl.matchSquad.toggleLabel}: Piet Peters`)
    expect(screen.getByText(nl.matchSquad.saveError)).toBeInTheDocument()

    await clickToggle(`${nl.matchSquad.toggleLabel}: Jan Jansen`)
    expect(screen.queryByText(nl.matchSquad.saveError)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Jan Jansen` })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

describe('exportknop', () => {
  it('is disabled bij 0 geselecteerd, en een klik roept window.print() niet aan', () => {
    const printSpy = stubPrint()
    renderEditor()
    const printButton = screen.getByRole('button', { name: nl.trainingPlan.print })
    expect(printButton).toBeDisabled()
    fireEvent.click(printButton)
    expect(printSpy).not.toHaveBeenCalled()
    expect(screen.getByText(nl.matchSquad.emptyExportHint)).toBeInTheDocument()
  })

  it('wordt bruikbaar zodra er minstens 1 speler geselecteerd is', async () => {
    const printSpy = stubPrint()
    renderEditor()
    await clickToggle(`${nl.matchSquad.toggleLabel}: Piet Peters`)
    const printButton = screen.getByRole('button', { name: nl.trainingPlan.print })
    expect(printButton).not.toBeDisabled()
    fireEvent.click(printButton)
    expect(printSpy).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(nl.matchSquad.emptyExportHint)).not.toBeInTheDocument()
  })
})

describe('lege staat', () => {
  it('players: [] en hasAnyActivePlayers: false toont de kaart-met-link-naar-/players/new, geen crash', () => {
    expect(() => renderEditor({ players: [], hasAnyActivePlayers: false })).not.toThrow()
    expect(screen.getByText(nl.matchSquad.emptyTeam)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.players.add })).toHaveAttribute('href', '/players/new')
    expect(screen.queryByRole('button', { name: nl.trainingPlan.print })).not.toBeInTheDocument()
  })

  it('players: [] en hasAnyActivePlayers: true toont de "meld eerst aanwezigheid"-copy, niet de "voeg speler toe"-copy', () => {
    expect(() => renderEditor({ players: [], hasAnyActivePlayers: true })).not.toThrow()
    expect(screen.getByText(nl.matchSquad.emptyNoAttendance)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.matchSquad.emptyNoAttendanceLink })).toHaveAttribute('href', '/events/e1')
    expect(screen.queryByText(nl.matchSquad.emptyTeam)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: nl.players.add })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: nl.trainingPlan.print })).not.toBeInTheDocument()
  })
})

describe('regressiebewaking op de bewuste eenvoud', () => {
  it('de scherm-rij bevat geen rugnummer en geen positie-afkorting', () => {
    renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Piet Peters', jersey_number: 9, position: 'Spits' })],
    })
    // Scope op het scherm-blok: het print-blok mag hier niet meetellen (er is
    // niets geselecteerd, dus is dat sowieso leeg — maar dit blijft expliciet).
    const screenBlock = screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '0')).closest('div')?.parentElement as HTMLElement
    expect(within(screenBlock).queryByText('#9')).not.toBeInTheDocument()
    expect(within(screenBlock).queryByText('9')).not.toBeInTheDocument()
    expect(within(screenBlock).queryByText('ST')).not.toBeInTheDocument()
  })
})

describe('inactieve speler', () => {
  it('een geselecteerde inactieve speler blijft zichtbaar met het inactief-label', () => {
    renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Oud Gediende', active: false })],
      initialSelectedIds: ['p1'],
    })
    // Scope op de scherm-rij (naam + toggle), niet het print-blok — beide
    // bevatten "Oud Gediende" in de DOM (jsdom past geen @media print toe).
    const toggle = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Oud Gediende` })
    const row = toggle.parentElement as HTMLElement
    expect(within(row).getByText('Oud Gediende')).toBeInTheDocument()
    expect(within(row).getByText(`(${nl.players.inactiveLabel})`)).toBeInTheDocument()
  })
})

describe('niet-aanwezige, al-geselecteerde speler', () => {
  it('een geselecteerde speler die niet in presentPlayerIds staat, toont het niet-aanwezig-label', () => {
    renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Wim Wieling', active: true })],
      initialSelectedIds: ['p1'],
      presentPlayerIds: [],
    })
    const toggle = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Wim Wieling` })
    const row = toggle.parentElement as HTMLElement
    expect(within(row).getByText('Wim Wieling')).toBeInTheDocument()
    expect(within(row).getByText(`(${nl.matchSquad.notPresentLabel})`)).toBeInTheDocument()
    // Nog steeds gewoon te de-selecteren (niet uitgeschakeld).
    expect(toggle).not.toBeDisabled()
  })

  it('een geselecteerde, actieve én aanwezige speler toont geen enkel label', () => {
    renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Kees Kramer', active: true })],
      initialSelectedIds: ['p1'],
      presentPlayerIds: ['p1'],
    })
    const toggle = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Kees Kramer` })
    const row = toggle.parentElement as HTMLElement
    expect(within(row).queryByText(`(${nl.matchSquad.notPresentLabel})`)).not.toBeInTheDocument()
    expect(within(row).queryByText(`(${nl.players.inactiveLabel})`)).not.toBeInTheDocument()
  })

  it('een speler die zowel inactief als niet-aanwezig is, toont uitsluitend het inactief-label (geen dubbel label)', () => {
    renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Oud En Weg', active: false })],
      initialSelectedIds: ['p1'],
      presentPlayerIds: [],
    })
    const toggle = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Oud En Weg` })
    const row = toggle.parentElement as HTMLElement
    expect(within(row).getByText(`(${nl.players.inactiveLabel})`)).toBeInTheDocument()
    expect(within(row).queryByText(`(${nl.matchSquad.notPresentLabel})`)).not.toBeInTheDocument()
  })
})
