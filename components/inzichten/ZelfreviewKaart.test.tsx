import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import type { ZelfreviewOverzicht, ZelfreviewWeek } from '@/lib/inzichten'
import ZelfreviewKaart from './ZelfreviewKaart'

const i = nl.insights

const leeg = { uitleg: null, organisatie: null, coaching: null, sfeer: null, tijdsbewaking: null }
const week = (o: Partial<ZelfreviewWeek> = {}): ZelfreviewWeek => ({
  maandag: '2026-10-05', isoJaar: 2026, isoWeek: 41, deelweekBegin: false, deelweekEind: false,
  aantal: 1,
  gemiddelde: { uitleg: 4, organisatie: 3.5, coaching: 5, sfeer: 2, tijdsbewaking: 3 },
  totaal: 3.5,
  ...o,
})
const legeWeek = (maandag: string, isoWeek: number): ZelfreviewWeek =>
  week({ maandag, isoWeek, aantal: 0, gemiddelde: { ...leeg }, totaal: null })

function overzicht(weken: ZelfreviewWeek[], o: Partial<ZelfreviewOverzicht> = {}): ZelfreviewOverzicht {
  return {
    weken, aantalReviews: weken.reduce((s, w) => s + w.aantal, 0), afgekapt: false, genoegVoorTrend: true, ...o,
  }
}

const drieWeken = () => [
  week({ maandag: '2026-10-05', isoWeek: 41, totaal: 3.5 }),
  legeWeek('2026-10-12', 42),
  week({ maandag: '2026-10-19', isoWeek: 43, totaal: 4.25, aantal: 2 }),
  week({ maandag: '2026-10-26', isoWeek: 44, totaal: 5, deelweekEind: true }),
]

const renderKaart = (data: ZelfreviewOverzicht, fout = false) => render(<ZelfreviewKaart data={data} fout={fout} t={nl} />)

describe('ZelfreviewKaart', () => {
  it('toont titel, beschrijving, kolommen en de twee voetnoten', () => {
    renderKaart(overzicht(drieWeken()))
    expect(screen.getByText(i.zelfreviewTitle)).toBeInTheDocument()
    expect(screen.getByText(i.zelfreviewDescription)).toBeInTheDocument()
    const k = i.zelfreviewKolommen
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      i.kolomWeek, k.uitleg, k.organisatie, k.coaching, k.sfeer, k.tijdsbewaking, i.zelfreviewKolomTotaal,
    ])
    expect(screen.getByText(i.zelfreviewPrive)).toBeInTheDocument()
    expect(screen.getByText(i.zelfreviewVolgendeDag)).toBeInTheDocument()
  })

  it('tabel: alleen weken met review, nieuwste eerst, 1 decimaal', () => {
    renderKaart(overzicht(drieWeken()))
    const rijen = screen.getAllByRole('rowheader')
    expect(rijen.map((r) => /wk (\d+)/.exec(r.textContent ?? '')?.[1])).toEqual(['44', '43', '41'])
    const rij41 = rijen[2].closest('tr')!
    expect(within(rij41).getAllByRole('cell').map((c) => c.textContent)).toEqual(['4,0', '3,5', '5,0', '2,0', '3,0', '3,5'])
    expect(within(rijen[0].closest('tr')!).getByText(i.deelweekLabel)).toBeInTheDocument()
  })

  it('grafiek: role=img met label, een punt per week met review en onderbroken lijn bij een lege week', () => {
    renderKaart(overzicht(drieWeken()))
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('aria-label', i.zelfreviewGrafiekLabel.replace('{n}', '4'))
    expect(svg.querySelectorAll('circle')).toHaveLength(3)
    // 3 rasterlijnen + alleen het segment week 43 -> 44 (41 -> 42 en 42 -> 43 grenzen aan een lege week)
    expect(svg.querySelectorAll('line[stroke="var(--brand-accent)"]')).toHaveLength(1)
    expect(svg.querySelectorAll('line[stroke="var(--track)"]')).toHaveLength(3)
    // deelweek is lichter
    const circles = [...svg.querySelectorAll('circle')]
    expect(circles[2]).toHaveAttribute('opacity', '0.5')
    expect(circles[0]).toHaveAttribute('opacity', '1')
    expect(svg.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  it('fout geeft alleen bronFout', () => {
    renderKaart(overzicht(drieWeken()), true)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('afgekapt geeft afgekaptTraining, ook als er ook te weinig reviews zijn', () => {
    renderKaart(overzicht([], { afgekapt: true, aantalReviews: 5, genoegVoorTrend: false }))
    expect(screen.getByText(i.afgekaptTraining)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('minder dan 3 reviews geeft de "te weinig"-melding met het aantal', () => {
    renderKaart(overzicht([week()], { genoegVoorTrend: false, aantalReviews: 2 }))
    expect(screen.getByText(i.zelfreviewTeWeinig.replace('{n}', '2'))).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('geen reviews: 0 van minimaal 3', () => {
    renderKaart(overzicht([], { aantalReviews: 0, genoegVoorTrend: false }))
    expect(screen.getByText(i.zelfreviewTeWeinig.replace('{n}', '0'))).toBeInTheDocument()
  })
})
