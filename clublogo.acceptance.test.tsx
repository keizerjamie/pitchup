// Acceptatietests — Clublogo in de zijbalk/mobiele header (user story: het
// teamlogo vervangt het Pitchup-logo overal in de AppShell-chrome zodra een
// team er één heeft geüpload; zonder logo blijft het Pitchup-logo staan).
//
// Testmethode: rendert de ECHTE AppShell (components/AppShell.tsx) rechtstreeks
// met RTL, met uitsluitend 'next/navigation' gestubd (usePathname) — zelfde
// precedent als de overige acceptatietests in dit bestand (renderPage()-stijl
// uit afdrukken-trainingsplan.acceptance.test.tsx / dashboard-vorm.acceptance
// .test.tsx), hier toegepast op een client component i.p.v. een async server
// component.

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import AppShell from '@/components/AppShell'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

// PageTransition gebruikt React's experimentele <ViewTransition>, dat in de
// hier geïnstalleerde React-versie niet als bruikbaar component beschikbaar
// is buiten de Next.js-runtime. Voor deze tests is de transition-laag
// irrelevant (we toetsen het logo in de zijbalk/mobiele header, niet de
// paginaovergang) — vervangen door een kale passthrough.
vi.mock('@/components/PageTransition', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}))

// Navigation en GlobalFab zijn voor déze story irrelevant (bottom-nav resp.
// zwevende actieknop, geen van beide toont het logo) en leunen op
// browser-only API's die jsdom niet implementeert (ResizeObserver,
// createPortal-doelen e.d.) — weggemockt om de test gefocust te houden op
// waar het hier om gaat: het logo in de zijbalk/mobiele header.
vi.mock('@/components/Navigation', () => ({ default: () => null }))
vi.mock('@/components/GlobalFab', () => ({ default: () => null }))

function renderShell(teamLogoUrl: string | null, teamName: string | null = 'FC Voorbeeld') {
  return render(
    <DictProvider dict={nl}>
      <AppShell teamName={teamName} teamLogoUrl={teamLogoUrl} userEmail="coach@example.com">
        <div>Inhoud</div>
      </AppShell>
    </DictProvider>,
  )
}

describe('Team met logo — zijbalk en mobiele header tonen het teamlogo', () => {
  it('de zijbalk toont een <img> met de teamlogo-URL als src (geen "Pitchup"-alt-tekst meer op die plek)', () => {
    const { container } = renderShell('https://cdn.example.com/team-logos/abc/logo?v=123')
    const sidebar = container.querySelector('.anchor-sidebar') as HTMLElement
    const img = sidebar.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src).toBe('https://cdn.example.com/team-logos/abc/logo?v=123')
    expect(img.alt).not.toBe('Pitchup')
  })

  it('de mobiele header toont hetzelfde teamlogo', () => {
    const { container } = renderShell('https://cdn.example.com/team-logos/abc/logo?v=123')
    const mobileHeader = container.querySelector('.anchor-mobile-header') as HTMLElement
    const img = mobileHeader.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src).toBe('https://cdn.example.com/team-logos/abc/logo?v=123')
  })

  it('het logo-element gebruikt object-contain binnen een vast kader (nooit uitrekken/bijsnijden)', () => {
    const { container } = renderShell('https://cdn.example.com/team-logos/abc/logo?v=123')
    const sidebar = container.querySelector('.anchor-sidebar') as HTMLElement
    const img = sidebar.querySelector('img') as HTMLImageElement
    expect(img.className).toContain('object-contain')
    // Vast kader: de buitenste TeamLogo-wrapper heeft een expliciete
    // width/height (via inline style), niet enkel de <img> zelf.
    const frame = img.parentElement as HTMLElement
    expect(frame.style.width).toBe('40px')
    expect(frame.style.height).toBe('40px')
  })

  it('geen loading="lazy" op het logo (moet bij window.print() al binnen zijn)', () => {
    const { container } = renderShell('https://cdn.example.com/team-logos/abc/logo?v=123')
    const sidebar = container.querySelector('.anchor-sidebar') as HTMLElement
    const img = sidebar.querySelector('img') as HTMLImageElement
    expect(img).not.toHaveAttribute('loading')
  })
})

describe('Team zonder logo — regressie: het Pitchup-logo blijft overal staan', () => {
  it('de zijbalk toont het Pitchup-logo (alt="Pitchup") wanneer er geen teamLogoUrl is', () => {
    const { container } = renderShell(null)
    const sidebar = container.querySelector('.anchor-sidebar') as HTMLElement
    const img = sidebar.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.alt).toBe('Pitchup')
  })

  it('de mobiele header toont ook het Pitchup-logo wanneer er geen teamLogoUrl is', () => {
    const { container } = renderShell(null)
    const mobileHeader = container.querySelector('.anchor-mobile-header') as HTMLElement
    const img = mobileHeader.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.alt).toBe('Pitchup')
  })

  it('de teamnaam blijft, zoals voorheen, gewoon zichtbaar naast het (Pitchup-)logo', () => {
    const { container } = renderShell(null, 'FC Voorbeeld')
    const sidebar = container.querySelector('.anchor-sidebar') as HTMLElement
    // Scope op de zijbalk-kop (logo + teamnaam): SidebarNav toont de
    // teamnaam verderop nogmaals (gebruikersinfo), dus niet op documentniveau
    // zoeken.
    expect(within(sidebar).getAllByText('FC Voorbeeld').length).toBeGreaterThanOrEqual(1)
  })
})

describe('Logo laadfout — valt terug op het Pitchup-logo, nooit een kapot icoon', () => {
  it('een onError op de <img> (bv. een settings-rij die naar een verwijderd bestand wijst) toont daarna het Pitchup-logo', () => {
    const { container } = renderShell('https://cdn.example.com/team-logos/abc/logo?v=123')
    const sidebar = container.querySelector('.anchor-sidebar') as HTMLElement
    let img = sidebar.querySelector('img') as HTMLImageElement
    expect(img.alt).not.toBe('Pitchup')

    fireEvent.error(img)

    img = sidebar.querySelector('img') as HTMLImageElement
    expect(img.alt).toBe('Pitchup')
  })
})
