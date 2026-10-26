import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { nl } from '@/messages/nl'
import { resultatenPerFormatie, type WedstrijdUitslagRij } from '@/lib/inzichten'
import FormatieKaart from './FormatieKaart'

const rij = (o: Partial<WedstrijdUitslagRij>): WedstrijdUitslagRij => ({
  event_id: 'e', datum: '2026-09-01', home_away: 'home', goals_for: 1, goals_against: 0, formatie: '4-3-3', ...o,
})
const i = nl.insights

describe('FormatieKaart', () => {
  it('toont per formatie een rij, ook een onbekende schrijfwijze letterlijk', () => {
    const rijen = resultatenPerFormatie([rij({}), rij({}), rij({ formatie: 'mijn-eigen' })])
    render(<FormatieKaart rijen={rijen} fout={false} afgekapt={false} t={nl} />)
    expect(screen.getByRole('rowheader', { name: '4-3-3' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'mijn-eigen' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: i.formatieKolom })).toBeInTheDocument()
  })

  it('lege staat, foutstaat en afgekapt', () => {
    const { rerender } = render(<FormatieKaart rijen={[]} fout={false} afgekapt={false} t={nl} />)
    expect(screen.getByText(i.formatieEmpty)).toBeInTheDocument()
    rerender(<FormatieKaart rijen={[]} fout afgekapt={false} t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    rerender(<FormatieKaart rijen={resultatenPerFormatie([rij({})])} fout={false} afgekapt t={nl} />)
    expect(screen.getByText(i.afgekapt)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
