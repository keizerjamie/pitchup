import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { nl } from '@/messages/nl'
import type { NaastElkaarRegel } from '@/lib/inzichten'
import OpkomstSelectieRatingKaart from './OpkomstSelectieRatingKaart'

const regel = (o: Partial<NaastElkaarRegel>): NaastElkaarRegel => ({
  player_id: 'p', naam: 'Piet', gast: false, opkomst: null, selectie: null, rating: null, ...o,
})
const i = nl.insights

function rijVan(naam: string): HTMLElement {
  return screen.getByRole('rowheader', { name: new RegExp(naam) }).closest('tr') as HTMLElement
}

describe('OpkomstSelectieRatingKaart', () => {
  it('toont opkomst, selectie en rating naast elkaar', () => {
    render(
      <OpkomstSelectieRatingKaart
        regels={[
          regel({
            naam: 'Anna',
            opkomst: { aanwezig: 8, totaal: 10, percentage: 80 },
            selectie: { selectie: 3, noemer: 4 },
            rating: { gemiddelde: 7.25, aantal: 4 },
          }),
        ]}
        fout={false}
        t={nl}
      />,
    )
    const r = rijVan('Anna')
    expect(r).toHaveTextContent('80% (8 van 10 trainingen)')
    expect(r).toHaveTextContent('3 van 4 wedstrijden')
    expect(r).toHaveTextContent('7.3 (4 wedstrijden)')
  })

  it('null per kolom geeft geenGegevens', () => {
    render(
      <OpkomstSelectieRatingKaart
        regels={[regel({ naam: 'Anna', selectie: { selectie: 1, noemer: 2 } })]}
        fout={false}
        t={nl}
      />,
    )
    const cellen = rijVan('Anna').querySelectorAll('td')
    expect(cellen[0]).toHaveTextContent(i.geenGegevens)
    expect(cellen[2]).toHaveTextContent(i.geenGegevens)
  })

  it('gast: alleen "x keer aanwezig", geen noemer en geen percentage (O3), met gastbadge', () => {
    const { container } = render(
      <OpkomstSelectieRatingKaart
        regels={[regel({ naam: 'Gijs', gast: true, opkomst: { aanwezig: 1, totaal: null, percentage: null } })]}
        fout={false}
        t={nl}
      />,
    )
    const r = rijVan('Gijs')
    expect(r).toHaveTextContent('1 keer aanwezig')
    expect(r).toHaveTextContent(i.gastLabel)
    expect(container.textContent).not.toMatch(/1 van \d+/)
    expect(container.textContent).not.toContain('%')
    expect(container.textContent).not.toContain('null')
  })

  it('kolomkoppen zijn semantisch; geen rangnummers', () => {
    render(<OpkomstSelectieRatingKaart regels={[regel({ rating: { gemiddelde: 8, aantal: 1 } })]} fout={false} t={nl} />)
    for (const k of [i.kolomSpeler, i.kolomTrainingsopkomst, i.kolomInSelectie, i.ratingLabel]) {
      expect(screen.getByRole('columnheader', { name: k })).toBeInTheDocument()
    }
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('geen regels: lege staat', () => {
    render(<OpkomstSelectieRatingKaart regels={[]} fout={false} t={nl} />)
    expect(screen.getByText(i.naastElkaarEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('foutstaat', () => {
    render(<OpkomstSelectieRatingKaart regels={[]} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByText(i.naastElkaarEmpty)).toBeNull()
  })
})
