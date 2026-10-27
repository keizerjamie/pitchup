import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { nl } from '@/messages/nl'
import { bepaalStijgersDalers, type RatingVormRij } from '@/lib/inzichten'
import StijgersDalersKaart from './StijgersDalersKaart'

const rij = (o: Partial<RatingVormRij>): RatingVormRij => ({
  player_id: 'p', naam: 'Piet', aantal: 10, seizoen_gemiddelde: 7, recent_gemiddelde: 7, ...o,
})
const i = nl.insights

describe('StijgersDalersKaart', () => {
  it('toont stijgers en dalers apart, met teken, 1 decimaal en zonder statuskleur', () => {
    const data = bepaalStijgersDalers([
      rij({ player_id: 'a', naam: 'Anna', seizoen_gemiddelde: 7, recent_gemiddelde: 7.4 }),
      rij({ player_id: 'd', naam: 'Daan', seizoen_gemiddelde: 7, recent_gemiddelde: 6.7 }),
    ])
    const { container } = render(<StijgersDalersKaart data={data} fout={false} t={nl} />)
    const lijsten = screen.getAllByRole('list')
    expect(lijsten).toHaveLength(2)
    expect(lijsten[0]).toHaveTextContent('Anna')
    expect(lijsten[0]).toHaveTextContent('+0.4 · recent 7.4 · seizoen 7.0 (10 wedstrijden)')
    expect(lijsten[1]).toHaveTextContent('Daan')
    expect(lijsten[1]).toHaveTextContent('−0.3 · recent 6.7 · seizoen 7.0 (10 wedstrijden)')
    expect(container.innerHTML).not.toMatch(/green|red|amber|#[0-9a-fA-F]{3,8}/)
  })

  it('een lege kant toont stijgersNiemand', () => {
    const data = bepaalStijgersDalers([rij({ naam: 'Anna', recent_gemiddelde: 7.5 })])
    render(<StijgersDalersKaart data={data} fout={false} t={nl} />)
    expect(screen.getByText(i.stijgersNiemand)).toBeInTheDocument()
  })

  it('meegeteld 0: stijgersTeWeinig met het minimum', () => {
    const data = bepaalStijgersDalers([rij({ aantal: 7, recent_gemiddelde: 9 })])
    render(<StijgersDalersKaart data={data} fout={false} t={nl} />)
    expect(screen.getByText(i.stijgersTeWeinig.replace('{min}', '8'))).toBeInTheDocument()
  })

  it('meegeteld > 0 maar niemand wijkt af: stijgersEmpty met de drempel', () => {
    const data = bepaalStijgersDalers([rij({})])
    render(<StijgersDalersKaart data={data} fout={false} t={nl} />)
    expect(screen.getByText(i.stijgersEmpty.replace('{drempel}', '0.3'))).toBeInTheDocument()
  })

  it('beschrijving noemt het venster en het minimum', () => {
    render(<StijgersDalersKaart data={bepaalStijgersDalers([])} fout={false} t={nl} />)
    expect(screen.getByText(i.stijgersDescription.replace('{n}', '5').replace('{min}', '8'))).toBeInTheDocument()
  })

  it('foutstaat', () => {
    render(<StijgersDalersKaart data={bepaalStijgersDalers([])} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByText(i.stijgersTeWeinig.replace('{min}', '8'))).toBeNull()
  })
})
