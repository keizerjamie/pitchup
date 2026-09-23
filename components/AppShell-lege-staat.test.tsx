// Acceptatietest — AC 16/52: een sessie zonder enkel teamlidmaatschap krijgt
// de lege staat (EmptyTeamState) i.p.v. de paginainhoud, met verborgen
// navigatie/FAB (behalve op /settings). Dit dekt validatiebevinding 1 (async
// server component EmptyTeamState mocht niet rechtstreeks vanuit de
// 'use client'-AppShell gerenderd worden) en bevinding 6 (SidebarNav-items
// moeten ook verdwijnen in de lege staat).
//
// EmptyTeamState is zelf een async server component — zelfde technique als
// app/settings/page.tsx (`stafSection = await StafSection()`): hier eerst
// `await EmptyTeamState()` en het resultaat als de nieuwe `emptyState`-prop
// aan de ECHTE AppShell geven, precies zoals app/layout.tsx dat nu ook doet.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import AppShell from '@/components/AppShell'
import EmptyTeamState from '@/components/EmptyTeamState'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}))
let mockPathname = () => '/'

vi.mock('@/lib/i18n', () => ({ getDict: vi.fn() }))
import { getDict } from '@/lib/i18n'
vi.mocked(getDict).mockResolvedValue(nl)

vi.mock('@/app/actions/team', () => ({
  createTeam: vi.fn(),
  setActiveTeam: vi.fn(),
}))

// Navigation/GlobalFab leunen op browser-only API's (ResizeObserver,
// createPortal-doelen) die hier niet ter zake doen — zelfde precedent als
// clublogo.acceptance.test.tsx. Bij hasTeam=false renderen ze toch al niet,
// maar het /settings-scenario hieronder gaat wél via showChrome=false, dus
// blijft ongemockt geen enkel verschil maken.
vi.mock('@/components/Navigation', () => ({ default: () => <div data-testid="navigation" /> }))
vi.mock('@/components/GlobalFab', () => ({ default: () => <div data-testid="global-fab" /> }))
vi.mock('@/components/PageTransition', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}))

async function renderLegeStaat(pathname = '/') {
  mockPathname = () => pathname
  const emptyState = await EmptyTeamState()
  return render(
    <DictProvider dict={nl}>
      <AppShell
        emptyState={emptyState}
        teamName={null}
        teamLogoUrl={null}
        userEmail="coach@example.com"
        hasTeam={false}
        teamId={null}
        rol={null}
        rechten={null}
        teams={[]}
      >
        <div data-testid="echte-pagina-inhoud">Dashboard</div>
      </AppShell>
    </DictProvider>,
  )
}

describe('AppShell — lege staat (AC 16/52)', () => {
  it('toont EmptyTeamState in plaats van children op de hoofdpagina', async () => {
    await renderLegeStaat('/')
    expect(screen.getByText(nl.team.noTeamTitle)).toBeInTheDocument()
    expect(screen.queryByTestId('echte-pagina-inhoud')).not.toBeInTheDocument()
  })

  it('verbergt Navigation en GlobalFab', async () => {
    await renderLegeStaat('/')
    expect(screen.queryByTestId('navigation')).not.toBeInTheDocument()
    expect(screen.queryByTestId('global-fab')).not.toBeInTheDocument()
  })

  it('verbergt de zijbalk-navigatielinks, behalve Instellingen', async () => {
    const { container } = await renderLegeStaat('/')
    const sidebar = container.querySelector('.anchor-sidebar') as HTMLElement
    expect(within(sidebar).queryByText(nl.nav.dashboard)).not.toBeInTheDocument()
    expect(within(sidebar).queryByText(nl.nav.players)).not.toBeInTheDocument()
    expect(within(sidebar).queryByText(nl.nav.calendar)).not.toBeInTheDocument()
    expect(within(sidebar).getByText(nl.nav.settings)).toBeInTheDocument()
  })

  it('/settings blijft de echte pagina-inhoud tonen (uitloggen/account verwijderen bereikbaar)', async () => {
    await renderLegeStaat('/settings')
    expect(screen.getByTestId('echte-pagina-inhoud')).toBeInTheDocument()
    expect(screen.queryByText(nl.team.noTeamTitle)).not.toBeInTheDocument()
  })

  it('geen teamnaam-fallback "Uitloggen" meer als zichtbare ondertitel in de gebruikerschip (regressie op de oude verrassing)', async () => {
    await renderLegeStaat('/')
    // De oude bug toonde t.settings.logout ALS TEKST onder de gebruikersnaam
    // wanneer teamName null was — dat mag nu niet meer. De uitlogknop zelf
    // (aria-label, geen zichtbare tekst) blijft uiteraard wel bereikbaar.
    expect(screen.queryByText(nl.settings.logout)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: nl.settings.logout }).length).toBeGreaterThan(0)
  })
})
