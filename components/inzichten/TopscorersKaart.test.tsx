import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { nl } from '@/messages/nl'
import { bepaalTopscorers, type SpelerMomentenRij } from '@/lib/inzichten'
import TopscorersKaart from './TopscorersKaart'

const speler = (o: Partial<SpelerMomentenRij>): SpelerMomentenRij => ({
  player_id: 'p', naam: 'Piet', gast: false, doelpunten: 0, assists: 0, geel: 0, rood: 0, ...o,
})
const i = nl.insights

describe('TopscorersKaart', () => {
  it('toont naam, waarde, gastlabel en assistpercentage', () => {
    const data = bepaalTopscorers([
      speler({ player_id: 'a', naam: 'Anna', doelpunten: 2, assists: 1 }),
      speler({ player_id: 'g', naam: 'Gijs', gast: true, doelpunten: 1 }),
    ])
    render(<TopscorersKaart data={data} fout={false} t={nl} />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Anna')
    expect(items[0]).toHaveTextContent('2 doelpunten · 1 assists · 3 betrokken')
    expect(items[1]).toHaveTextContent(i.gastLabel)
    expect(screen.getByText(/Ongeveer 33% van de doelpunten/)).toBeInTheDocument()
  })

  it('geen doelpunten: lege staat, ook als er assists zijn, en nooit NaN', () => {
    const data = bepaalTopscorers([speler({ assists: 2 })])
    const { container } = render(<TopscorersKaart data={data} fout={false} t={nl} />)
    expect(screen.getByText(i.topscorersEmpty)).toBeInTheDocument()
    expect(container.textContent).not.toContain('NaN')
  })

  it('foutstaat', () => {
    render(<TopscorersKaart data={bepaalTopscorers([])} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
  })
})
