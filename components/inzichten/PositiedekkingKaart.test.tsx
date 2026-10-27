import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import { dekkingPerPositie, type SpelerPositieRij } from '@/lib/inzichten'
import PositiedekkingKaart from './PositiedekkingKaart'

const sp = (o: Partial<SpelerPositieRij>): SpelerPositieRij => ({
  id: 'p', name: 'Piet', position: 'Keeper', secondary_positions: null, injured: false, ...o,
})
const i = nl.insights

function rijVan(positie: string): HTMLElement {
  return screen.getByRole('rowheader', { name: positie }).closest('tr') as HTMLElement
}

describe('PositiedekkingKaart', () => {
  it('toont alle 12 posities met fit-tekst, namen en secundair-achtervoegsel', () => {
    const spelers = [
      sp({ id: 'k', name: 'Kees', position: 'Keeper' }),
      sp({ id: 'a', name: 'Anna', position: 'Linksachter', secondary_positions: ['Keeper'] }),
      sp({ id: 'b', name: 'Bram', position: 'Linksachter' }),
    ]
    render(<PositiedekkingKaart dekking={dekkingPerPositie(spelers)} heeftSpelers fout={false} t={nl} />)
    expect(screen.getAllByRole('rowheader')).toHaveLength(12)
    const keeper = rijVan(nl.players.positions.Keeper)
    expect(keeper).toHaveTextContent(i.dekkingMeer.replace('{n}', '2'))
    expect(keeper).toHaveTextContent(`Kees, Anna ${i.dekkingSecundair}`)
    const links = rijVan(nl.players.positions.Linksachter)
    expect(links).toHaveTextContent(i.dekkingMeer.replace('{n}', '2'))
  })

  it('geen fitte speler en één fitte speler', () => {
    render(
      <PositiedekkingKaart dekking={dekkingPerPositie([sp({ position: 'Keeper' })])} heeftSpelers fout={false} t={nl} />,
    )
    expect(within(rijVan(nl.players.positions.Keeper)).getByText(i.dekkingEen)).toBeInTheDocument()
    expect(within(rijVan(nl.players.positions.Linksachter)).getByText(i.dekkingGeen)).toBeInTheDocument()
  })

  it('geblesseerde speler telt niet mee', () => {
    render(
      <PositiedekkingKaart dekking={dekkingPerPositie([sp({ injured: true })])} heeftSpelers fout={false} t={nl} />,
    )
    expect(within(rijVan(nl.players.positions.Keeper)).getByText(i.dekkingGeen)).toBeInTheDocument()
    expect(screen.queryByText('Piet')).toBeNull()
  })

  it('geen spelers in de bron: lege staat', () => {
    render(<PositiedekkingKaart dekking={dekkingPerPositie([])} heeftSpelers={false} fout={false} t={nl} />)
    expect(screen.getByText(i.dekkingEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('foutstaat', () => {
    render(<PositiedekkingKaart dekking={dekkingPerPositie([])} heeftSpelers={false} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByText(i.dekkingEmpty)).toBeNull()
  })

  it('kolomkoppen zijn semantisch en er staat geen kleur of icoon in', () => {
    const { container } = render(
      <PositiedekkingKaart dekking={dekkingPerPositie([sp({})])} heeftSpelers fout={false} t={nl} />,
    )
    expect(screen.getByRole('columnheader', { name: i.kolomPositie })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: i.kolomFit })).toBeInTheDocument()
    expect(container.querySelector('.ms')).toBeNull()
  })
})
