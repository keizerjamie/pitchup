import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import { verdeelSpeelkansen, type SpeelkansenRij } from '@/lib/inzichten'
import SpeelkansenKaart from './SpeelkansenKaart'

const rij = (o: Partial<SpeelkansenRij>): SpeelkansenRij => ({
  player_id: 'p', naam: 'Piet', gast: false, noemer: 0, selectie: 0, basis: 0, ...o,
})
const i = nl.insights

describe('SpeelkansenKaart', () => {
  it('toont "x van y wedstrijden" voor selectie en basis, met gastbadge en uitleg', () => {
    const regels = verdeelSpeelkansen([
      rij({ player_id: 'a', naam: 'Anna', noemer: 4, selectie: 3, basis: 2 }),
      rij({ player_id: 'g', naam: 'Gijs', gast: true, noemer: 4, selectie: 1, basis: 1 }),
    ])
    render(<SpeelkansenKaart regels={regels} fout={false} t={nl} />)
    const rows = screen.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Anna')
    expect(rows[1]).toHaveTextContent('3 van 4 wedstrijden')
    expect(rows[1]).toHaveTextContent('2 van 4 wedstrijden')
    expect(within(rows[2]).getByText(i.gastLabel)).toBeInTheDocument()
    expect(within(rows[1]).queryByText(i.gastLabel)).toBeNull()
    expect(screen.getByText(i.speelkansenUitleg)).toBeInTheDocument()
    expect(screen.getByText(/Voor inactieve spelers telt alleen hun periode bij het team\./)).toBeInTheDocument()
  })

  it('kolomkoppen en rijkop zijn semantisch', () => {
    render(<SpeelkansenKaart regels={verdeelSpeelkansen([rij({ noemer: 2, selectie: 1 })])} fout={false} t={nl} />)
    expect(screen.getByRole('columnheader', { name: i.kolomSpeler })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: i.kolomInSelectie })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: i.kolomInBasis })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Piet' })).toBeInTheDocument()
  })

  it('noemer 0 bij een speler: geenGegevens, geen meter en nooit NaN', () => {
    const regels = verdeelSpeelkansen([
      rij({ player_id: 'a', naam: 'Anna', noemer: 2, selectie: 1 }),
      rij({ player_id: 'b', naam: 'Bram', noemer: 0 }),
    ])
    const { container } = render(<SpeelkansenKaart regels={regels} fout={false} t={nl} />)
    const bram = screen.getByRole('rowheader', { name: 'Bram' }).closest('tr')!
    expect(bram).toHaveTextContent(i.geenGegevens)
    expect(bram.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(container.textContent).not.toContain('NaN')
  })

  it('meters zijn aria-hidden en gebruiken alleen tokens', () => {
    const { container } = render(
      <SpeelkansenKaart regels={verdeelSpeelkansen([rij({ noemer: 4, selectie: 1, basis: 2 })])} fout={false} t={nl} />,
    )
    const meters = container.querySelectorAll('[aria-hidden="true"]')
    expect(meters).toHaveLength(2)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect((meters[0].firstElementChild as HTMLElement).style.width).toBe('25%')
    expect((meters[1].firstElementChild as HTMLElement).style.width).toBe('50%')
  })

  it('geen enkele noemer > 0: lege staat', () => {
    render(<SpeelkansenKaart regels={verdeelSpeelkansen([rij({ noemer: 0 })])} fout={false} t={nl} />)
    expect(screen.getByText(i.speelkansenEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('foutstaat', () => {
    render(<SpeelkansenKaart regels={[]} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByText(i.speelkansenEmpty)).toBeNull()
  })
})
