import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Player } from '@/lib/types'
import type { SpelerStatistieken } from '@/lib/inzichten'
import PlayerProfile from '@/components/players/PlayerProfile'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh }),
}))

const markInjured = vi.fn()
const markRecovered = vi.fn()
vi.mock('@/app/actions/players', () => ({
  markInjured: (...args: unknown[]) => markInjured(...args),
  markRecovered: (...args: unknown[]) => markRecovered(...args),
}))

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Piet Peters',
    position: 'Spits',
    secondary_positions: [],
    jersey_number: 9,
    active: true,
    injured: false,
    type: 'regular',
    rating: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const stats: SpelerStatistieken = {
  aanwezig: 5,
  afwezig: 1,
  aanwezigheidPercentage: 83,
  ratingReeks: [],
  gemiddeldeRating: null,
  tellingen: { doelpunten: 1, assists: 0, geel: 0, rood: 0 },
}

function renderProfile(overrides: Partial<Player> = {}) {
  return render(
    <DictProvider dict={nl}>
      <PlayerProfile
        player={makePlayer(overrides)}
        initialTab="info"
        events={[]}
        periods={[]}
        defaultStatus="present"
        stats={stats}
        statsError={false}
        t={nl}
        canEditSpelers
        canEditAanwezigheid
      />
    </DictProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Tabs (AC9/AC10)', () => {
  it('de actieve tabknop draagt aria-pressed="true" en de var(--primary)-achtergrond', () => {
    renderProfile()
    const infoTab = screen.getByRole('button', { name: nl.players.profileTabInfo })
    expect(infoTab).toHaveAttribute('aria-pressed', 'true')
    expect(infoTab.getAttribute('style')).toContain('var(--primary)')

    const statsTab = screen.getByRole('button', { name: nl.players.profileTabStats })
    expect(statsTab).toHaveAttribute('aria-pressed', 'false')
  })

  it('wisselt tab zonder navigatie (geen router.push/refresh)', () => {
    renderProfile()
    expect(screen.getByText(nl.players.profileInfoTitle)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: nl.players.profileTabStats }))

    expect(screen.queryByText(nl.players.profileInfoTitle)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.players.profileTabStats })).toHaveAttribute('aria-pressed', 'true')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('"Afmelden" wisselt naar de Aanwezigheid-tab (AC22)', () => {
    renderProfile()
    fireEvent.click(screen.getByRole('button', { name: nl.players.signOff }))
    expect(screen.getByRole('button', { name: nl.players.profileTabAttendance })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(nl.players.attendanceTitle)).toBeInTheDocument()
  })
})

describe('Blessure-actie (AC19/AC20)', () => {
  it('de blessureknop is disabled tijdens isPending', async () => {
    let resolvePromise: () => void = () => {}
    markInjured.mockImplementation(
      () => new Promise<void>((resolve) => { resolvePromise = resolve }),
    )
    renderProfile({ injured: false })

    const button = screen.getByRole('button', { name: nl.players.reportInjury })
    fireEvent.click(button)

    expect(button).toBeDisabled()

    resolvePromise()
    await Promise.resolve()
  })

  it('faaltak: toont de generieke actionError-tekst, nooit de rauwe foutmelding; de knop is weer enabled en de pil blijft op de laatst opgeslagen status (validator-bevinding 1)', async () => {
    // PlayerProfileActions.tsx vangt de fout af met een kale `catch {}` — wat
    // de action ook teruggeeft, de UI toont altijd t.players.actionError en
    // nooit error.message. Een herkenbare rauwe string bewijst dat die tekst
    // nergens in de DOM belandt.
    markInjured.mockRejectedValue(new Error('RAUWE DB FOUT'))
    renderProfile({ injured: false })

    const button = screen.getByRole('button', { name: nl.players.reportInjury })
    fireEvent.click(button)
    expect(button).toBeDisabled()

    await waitFor(() => expect(button).not.toBeDisabled())

    expect(screen.getByText(nl.players.actionError)).toBeInTheDocument()
    expect(screen.queryByText('RAUWE DB FOUT')).not.toBeInTheDocument()
    expect(screen.queryByText(/RAUWE DB FOUT/)).not.toBeInTheDocument()

    // Geen optimistische pil (brief §2.3): de knop staat nog op "Blessure
    // melden" en de beschikbaarheidspil in de kop toont nog "Beschikbaar" —
    // exact de laatst opgeslagen (ongewijzigde) status, want router.refresh()
    // is bij een gefaalde actie bewust niet aangeroepen.
    expect(screen.getByRole('button', { name: nl.players.reportInjury })).toBeInTheDocument()
    expect(screen.getByText(nl.players.availableBadge)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('bij een geslaagde actie wordt router.refresh() precies één keer aangeroepen (validator-bevinding 2)', async () => {
    markInjured.mockResolvedValue(undefined)
    renderProfile({ injured: false })

    fireEvent.click(screen.getByRole('button', { name: nl.players.reportInjury }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(markInjured).toHaveBeenCalledTimes(1)
  })
})
