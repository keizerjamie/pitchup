import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import { splitsThuisUit, type WedstrijdUitslagRij } from '@/lib/inzichten'
import ThuisUitKaart from './ThuisUitKaart'

const rij = (o: Partial<WedstrijdUitslagRij>): WedstrijdUitslagRij => ({
  event_id: 'e', datum: '2026-09-01', home_away: 'home', goals_for: 1, goals_against: 0, formatie: null, ...o,
})
const i = nl.insights

describe('ThuisUitKaart', () => {
  it('toont thuis, uit en totaal als tabel met afkortingen en lange naam als title', () => {
    const data = splitsThuisUit([rij({ goals_for: 2, goals_against: 0 }), rij({ home_away: 'away', goals_for: 0, goals_against: 1 })])
    render(<ThuisUitKaart data={data} fout={false} afgekapt={false} t={nl} />)
    const kop = screen.getByText(i.kolomPpw)
    expect(kop.tagName).toBe('ABBR')
    expect(kop).toHaveAttribute('title', i.kolomPpwLang)
    expect(screen.getByRole('rowheader', { name: i.thuisLabel })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: i.totaalLabel })).toBeInTheDocument()
    expect(screen.queryByRole('rowheader', { name: i.onbekendLabel })).toBeNull()
  })

  it('toont "—" voor punten per wedstrijd bij een groep zonder wedstrijden', () => {
    const data = splitsThuisUit([rij({})])
    render(<ThuisUitKaart data={data} fout={false} afgekapt={false} t={nl} />)
    const uit = screen.getByRole('rowheader', { name: i.uitLabel }).closest('tr') as HTMLElement
    expect(within(uit).getByText('—')).toBeInTheDocument()
  })

  it('lege staat zonder wedstrijden', () => {
    render(<ThuisUitKaart data={splitsThuisUit([])} fout={false} afgekapt={false} t={nl} />)
    expect(screen.getByText(i.thuisUitEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('foutstaat toont bronFout en geen icoon', () => {
    const { container } = render(<ThuisUitKaart data={splitsThuisUit([])} fout afgekapt={false} t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(container.querySelector('.ms')).toBeNull()
  })

  it('afgekapt toont de melding in plaats van cijfers, ook al zijn er rijen', () => {
    render(<ThuisUitKaart data={splitsThuisUit([rij({})])} fout={false} afgekapt t={nl} />)
    expect(screen.getByText(i.afgekapt)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('fout gaat voor afgekapt', () => {
    render(<ThuisUitKaart data={splitsThuisUit([])} fout afgekapt t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByText(i.afgekapt)).toBeNull()
  })
})
