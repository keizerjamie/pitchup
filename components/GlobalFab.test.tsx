import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { TeamContextClientProvider } from '@/lib/team-context-client'
import { nl } from '@/messages/nl'
import { ALLE_RECHTEN, GEEN_RECHTEN, type TeamRechten } from '@/lib/team-rechten'
import GlobalFab, { fabModeFor } from '@/components/GlobalFab'
import { NIEUWE_OEFENING_EVENT } from '@/lib/fab-events'

// Designronde 3: de FAB is contextueel en staat alleen op de hoofdschermen.
// De rechtenlogica zelf is gedekt in assistent-rechten.acceptance.test.tsx.

function renderFab(pathname: string, rechten: Partial<TeamRechten> = ALLE_RECHTEN, rol: 'owner' | 'assistent' = 'owner') {
  return render(
    <DictProvider dict={nl}>
      <TeamContextClientProvider value={{ teamId: 't1', rol, rechten: { ...GEEN_RECHTEN, ...rechten }, teams: [] }}>
        <GlobalFab pathname={pathname} />
      </TeamContextClientProvider>
    </DictProvider>,
  )
}

describe('fabModeFor', () => {
  it('kent alleen de vier hoofdschermen een FAB toe', () => {
    expect(fabModeFor('/')).toBe('menu')
    expect(fabModeFor('/events')).toBe('events')
    expect(fabModeFor('/players')).toBe('players')
    expect(fabModeFor('/oefeningen')).toBe('oefeningen')
    for (const p of ['/events/new', '/events/abc', '/events/abc/squad', '/players/new', '/players/abc', '/settings', '/inzichten', '/periodisering']) {
      expect(fabModeFor(p)).toBe('none')
    }
  })
})

describe('GlobalFab — contextueel', () => {
  it('op een formulier of subpagina rendert er geen FAB', () => {
    const { container } = renderFab('/events/new')
    expect(container).toBeEmptyDOMElement()
  })

  it('op het dashboard opent het volledige aanmaakmenu', () => {
    renderFab('/')
    fireEvent.click(screen.getByRole('button', { name: nl.fab.title }))
    expect(screen.getByRole('link', { name: nl.event.createTraining })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.players.add })).toBeInTheDocument()
  })

  it('op de kalender bevat het menu alleen de event-items', () => {
    renderFab('/events')
    fireEvent.click(screen.getByRole('button', { name: nl.fab.title }))
    expect(screen.getByRole('link', { name: nl.event.createTraining })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.event.createMatch })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.event.bulk.fabLabel })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: nl.players.add })).toBeNull()
  })

  it('op de kalender zonder agenda-recht verdwijnt de FAB', () => {
    const { container } = renderFab('/events', { spelers: true }, 'assistent')
    expect(container).toBeEmptyDOMElement()
  })

  it('op spelers is de FAB een directe link naar "Speler toevoegen"', () => {
    renderFab('/players')
    expect(screen.getByRole('link', { name: nl.players.add })).toHaveAttribute('href', '/players/new')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('op spelers zonder spelers-recht verdwijnt de FAB', () => {
    const { container } = renderFab('/players', { agenda: true }, 'assistent')
    expect(container).toBeEmptyDOMElement()
  })

  it('op oefeningen stuurt de FAB het nieuwe-oefening-signaal', () => {
    const listener = vi.fn()
    window.addEventListener(NIEUWE_OEFENING_EVENT, listener)
    renderFab('/oefeningen', {}, 'assistent')
    fireEvent.click(screen.getByRole('button', { name: nl.oefeningen.addNew.replace(/^\+\s*/, '') }))
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(NIEUWE_OEFENING_EVENT, listener)
  })
})
