import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import { verdeelSpeelminuten, type SpeelminutenRij } from '@/lib/inzichten'
import SpeelminutenKaart from './SpeelminutenKaart'

const rij = (o: Partial<SpeelminutenRij>): SpeelminutenRij => ({
  player_id: 'p', naam: 'Piet', gast: false, wedstrijden: 0, minuten: null, wissels: null, noemer: 3, ...o,
})
const i = nl.insights

describe('SpeelminutenKaart', () => {
  it('toont minuten, gemiddelde, wissels en "x van y wedstrijden met minuten"', () => {
    const data = verdeelSpeelminuten([
      rij({ player_id: 'a', naam: 'Anna', wedstrijden: 2, minuten: 135, wissels: 3 }),
    ])
    render(<SpeelminutenKaart data={data} fout={false} t={nl} />)
    const row = screen.getByRole('rowheader', { name: 'Anna' }).closest('tr')!
    expect(row).toHaveTextContent('2 van 3 wedstrijden met minuten')
    expect(within(row).getByText('135')).toBeInTheDocument()
    expect(within(row).getByText('68')).toBeInTheDocument() // afgerond gemiddelde
    expect(within(row).getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: i.kolomWissels })).toBeInTheDocument()
    expect(screen.getByText(i.speelminutenDescription)).toBeInTheDocument()
  })

  it('lege staat bij noemer 0', () => {
    render(<SpeelminutenKaart data={verdeelSpeelminuten([])} fout={false} t={nl} />)
    expect(screen.getByText(i.speelminutenEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('foutstaat toont bronFout en geen tabel', () => {
    render(<SpeelminutenKaart data={{ regels: [], noemer: 0 }} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByText(i.speelminutenEmpty)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('geen rij: geenGegevens en "0 van y", geen meter; ingevoerde 0 blijft "0"', () => {
    const data = verdeelSpeelminuten([
      rij({ player_id: 'a', naam: 'Anna', wedstrijden: 1, minuten: 0, wissels: 0 }),
      rij({ player_id: 'b', naam: 'Bram', wedstrijden: 0 }),
    ])
    const { container } = render(<SpeelminutenKaart data={data} fout={false} t={nl} />)
    const bram = screen.getByRole('rowheader', { name: 'Bram' }).closest('tr')!
    expect(bram).toHaveTextContent('0 van 3 wedstrijden met minuten')
    expect(within(bram).getAllByText(i.geenGegevens)).toHaveLength(3)
    expect(bram.querySelector('[aria-hidden="true"]')).toBeNull()
    const anna = screen.getByRole('rowheader', { name: 'Anna' }).closest('tr')!
    expect(within(anna).getAllByText('0').length).toBeGreaterThanOrEqual(3)
    expect(container.textContent).not.toContain('NaN')
  })

  it('gast krijgt het label, een niet-gast niet', () => {
    const data = verdeelSpeelminuten([
      rij({ player_id: 'a', naam: 'Anna', wedstrijden: 1, minuten: 60, wissels: 1 }),
      rij({ player_id: 'g', naam: 'Gijs', gast: true, wedstrijden: 1, minuten: 30, wissels: 0 }),
    ])
    render(<SpeelminutenKaart data={data} fout={false} t={nl} />)
    expect(within(screen.getByRole('rowheader', { name: new RegExp('Gijs') })).getByText(i.gastLabel)).toBeInTheDocument()
    expect(within(screen.getByRole('rowheader', { name: 'Anna' })).queryByText(i.gastLabel)).toBeNull()
  })

  it('meter is aria-hidden, gebruikt tokens en geen #hex', () => {
    const data = verdeelSpeelminuten([rij({ player_id: 'a', naam: 'Anna', wedstrijden: 1, minuten: 90, wissels: 1 })])
    const { container } = render(<SpeelminutenKaart data={data} fout={false} t={nl} />)
    const meter = container.querySelector('[aria-hidden="true"]')!
    expect(meter).not.toBeNull()
    expect(container.innerHTML).toContain('var(--brand-accent)')
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
