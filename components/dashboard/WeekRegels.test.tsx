import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import WeekRegels from '@/components/dashboard/WeekRegels'
import { nl } from '@/messages/nl'
import { formatDate } from '@/lib/utils'
import type { KaartEvent, VandaagKaart } from '@/lib/vandaag-scherm'

const VANDAAG = '2026-11-16'

function kaart(o: Omit<Partial<VandaagKaart>, 'event'> & { event?: Partial<KaartEvent> } = {}): VandaagKaart {
  const { event, ...rest } = o
  return {
    soort: 'squad',
    open: true,
    href: '/events/e1/squad',
    doelTaak: 'squad',
    legePosities: null,
    ...rest,
    event: {
      id: 'e1', type: 'match', date: '2026-11-18', time: '14:30:00', opponent: 'Diemen', home_away: 'away',
      ...event,
    },
  }
}

function toon(regels: VandaagKaart[]) {
  return render(<WeekRegels regels={regels} vandaag={VANDAAG} t={nl} />)
}

describe('WeekRegels', () => {
  it('rendert niets bij 0 regels', () => {
    const { container } = toon([])
    expect(container).toBeEmptyDOMElement()
  })

  it('heeft een kop "Komende week" en een link per regel naar de doelpagina', () => {
    toon([kaart(), kaart({ event: { id: 'e2', type: 'training', home_away: null, opponent: null }, soort: 'training_plan', doelTaak: 'training_plan', href: '/events/e2/training-plan' })])
    expect(screen.getByRole('region', { name: nl.vandaag.weekTitle })).toBeInTheDocument()
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/events/e1/squad', '/events/e2/training-plan'])
  })

  it('wedstrijdtitel uit/thuis, tijd, subregel en Open-chip', () => {
    toon([kaart()])
    const link = screen.getByRole('link')
    expect(within(link).getByText(nl.vandaag.matchAway.replace('{tegenstander}', 'Diemen'))).toBeInTheDocument()
    expect(within(link).getByText(`14:30 · ${nl.vandaag.lineSquad}`)).toBeInTheDocument()
    expect(within(link).getByText(nl.vandaag.statusOpen)).toBeInTheDocument()
    expect(within(link).getByText(formatDate("2026-11-18", nl.browserLocale))).toBeInTheDocument()
  })

  it('thuiswedstrijd en wedstrijd zonder home_away', () => {
    toon([kaart({ event: { home_away: 'home' } }), kaart({ event: { id: 'e3', home_away: null } })])
    expect(screen.getByText(nl.vandaag.matchHome.replace('{tegenstander}', 'Diemen'))).toBeInTheDocument()
    expect(screen.getByText('Diemen')).toBeInTheDocument()
  })

  it('klaar-regel: "Klaar" met check-icoon, zonder subregel', () => {
    toon([kaart({ open: false })])
    const chip = screen.getByText(nl.vandaag.statusDone)
    expect(chip.querySelector('.ms')?.textContent).toBe('check')
    expect(screen.queryByText(nl.vandaag.statusOpen)).not.toBeInTheDocument()
    expect(screen.queryByText(nl.vandaag.lineSquad)).not.toBeInTheDocument()
  })

  it('onvolledige opstelling: chip met aantal (1, n) of zonder aantal', () => {
    const lineup = (n: number | null, id: string) =>
      kaart({ soort: 'lineup_onvolledig', doelTaak: 'lineup', href: `/events/${id}/lineup`, legePosities: n, event: { id } })
    toon([lineup(1, 'a'), lineup(3, 'b'), lineup(null, 'c')])
    expect(screen.getByText(nl.vandaag.lineupMissingOne)).toBeInTheDocument()
    expect(screen.getByText(nl.vandaag.lineupMissingMany.replace('{n}', '3'))).toBeInTheDocument()
    expect(screen.getByText(nl.vandaag.lineupIncomplete)).toBeInTheDocument()
    expect(screen.queryByText(nl.vandaag.statusOpen)).not.toBeInTheDocument()
  })

  it('titel wordt niet afgekapt (geen truncate) en tijd staat in de subregel', () => {
    toon([kaart({ event: { opponent: 'Eemdijk 2 een hele lange naam' } })])
    const titel = screen.getByText(/Eemdijk 2 een hele lange naam/)
    expect(titel.className).toMatch(/break-words/)
    expect(titel.className).not.toMatch(/truncate/)
    expect(titel.textContent).not.toMatch(/14:30/)
  })

  it('klaar-regel met tijd: alleen tijd in de subregel; zonder tijd geen subregel', () => {
    toon([kaart({ open: false }), kaart({ open: false, event: { id: 'z', time: null } })])
    expect(screen.getAllByText('14:30')).toHaveLength(1)
    expect(screen.getAllByRole('link')[1].textContent).not.toMatch(/·/)
  })

  it('stip: wedstrijd- en trainingskleur', () => {
    toon([kaart(), kaart({ event: { id: 'e2', type: 'training', opponent: null, home_away: null } })])
    const stippen = screen.getAllByTestId('week-regel-stip')
    expect(stippen[0]).toHaveStyle({ background: 'var(--event-match)' })
    expect(stippen[1]).toHaveStyle({ background: 'var(--event-training)' })
  })

  it('wanneer-kolom: Vandaag, Gisteren, en datum verder weg', () => {
    toon([
      kaart({ event: { id: 'a', date: VANDAAG } }),
      kaart({ event: { id: 'b', date: '2026-11-15' } }),
      kaart({ event: { id: 'c', date: '2026-11-21' } }),
    ])
    expect(screen.getByText(nl.dashboard.today)).toBeInTheDocument()
    expect(screen.getByText(nl.vandaag.whenYesterdayCap)).toBeInTheDocument()
    expect(screen.getByText(formatDate('2026-11-21', nl.browserLocale))).toBeInTheDocument()
  })

  it('linknamen zijn niet de To-do-taaklabels en geen hover:bg op de regels', () => {
    toon([kaart(), kaart({ event: { id: 'e2' }, soort: 'lineup', doelTaak: 'lineup', href: '/events/e2/lineup' })])
    const taalabels = [nl.todo.taskSquad, nl.todo.taskLineup, nl.todo.taskAnalysis, nl.todo.taskTraining, nl.todo.taskSelfReview]
    for (const link of screen.getAllByRole('link')) {
      const naam = link.textContent ?? ''
      for (const label of taalabels) expect(naam).not.toBe(label)
      expect(link.className).not.toMatch(/hover:bg/)
    }
    expect(screen.queryByRole('link', { name: nl.todo.taskSquad })).toBeNull()
  })
})
