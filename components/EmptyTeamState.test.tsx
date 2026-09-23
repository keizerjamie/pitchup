import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

// EmptyTeamState.tsx is een async server component (getDict()). Zelfde
// techniek als app/settings/page.tsx in de acceptatietests: eerst awaiten,
// dan het resultaat met RTL renderen — zie de toelichting in
// app/settings/page.tsx bij `stafSection`.
vi.mock('@/lib/i18n', () => ({ getDict: vi.fn() }))
import { getDict } from '@/lib/i18n'
import EmptyTeamState from '@/components/EmptyTeamState'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getDict).mockResolvedValue(nl)
})

async function renderEmptyState() {
  const el = await EmptyTeamState()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

describe('EmptyTeamState', () => {
  it('toont de kop, uitleg en de uitnodigingshint', async () => {
    await renderEmptyState()
    expect(screen.getByText(nl.team.noTeamTitle)).toBeInTheDocument()
    expect(screen.getByText(nl.team.noTeamBody)).toBeInTheDocument()
    expect(screen.getByText(nl.team.noTeamInviteHint)).toBeInTheDocument()
  })

  it('toont de primaire "Team aanmaken"-knop', async () => {
    await renderEmptyState()
    expect(screen.getByRole('button', { name: nl.team.createTeam })).toBeInTheDocument()
  })

  it('toont een link naar Instellingen (bereikbaarheid zonder bottom-nav)', async () => {
    await renderEmptyState()
    const link = screen.getByRole('link', { name: nl.nav.settings })
    expect(link).toHaveAttribute('href', '/settings')
  })
})
