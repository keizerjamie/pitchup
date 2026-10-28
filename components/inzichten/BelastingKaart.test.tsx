import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import { PERIODIZATION_CATEGORIES } from '@/lib/types'
import type { BelastingOverzicht, BelastingWeek } from '@/lib/inzichten'
import BelastingKaart from './BelastingKaart'

const i = nl.insights

function nullen() {
  return Object.fromEntries(PERIODIZATION_CATEGORIES.map((c) => [c.key, 0])) as NonNullable<BelastingWeek['perCategorie']>
}

const week = (o: Partial<BelastingWeek> = {}): BelastingWeek => ({
  maandag: '2026-10-05', isoJaar: 2026, isoWeek: 41, deelweekBegin: false, deelweekEind: false,
  trainingen: 1, trainingenZonderOefeningen: 0,
  perCategorie: { ...nullen(), warming_up: 20, positiespel: 35 },
  trainingstotaalMin: 55, blokkenZonderDuur: 0, oefeningenZonderDuur: 0, oefeningenOnbekend: 0, totaalAandeel: 1,
  ...o,
})

const overzicht = (weken: BelastingWeek[], o: Partial<BelastingOverzicht> = {}): BelastingOverzicht => ({
  weken, afgekapt: false, heeftTrainingen: true, heeftMinuten: true, totaalPerCategorie: nullen(), ...o,
})

describe('BelastingKaart', () => {
  it('toont tien categoriekolommen in vaste volgorde plus week en trainingstotaal', () => {
    render(<BelastingKaart data={overzicht([week()])} fout={false} t={nl} />)
    const koppen = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(koppen).toEqual([
      i.kolomWeek,
      ...PERIODIZATION_CATEGORIES.map((c) => nl.periodization.categories[c.key]),
      i.kolomTrainingstotaal,
    ])
    expect(koppen).toHaveLength(12)
    const rij = screen.getByRole('rowheader', { name: /wk 41/ }).closest('tr')!
    expect(within(rij).getByText('20')).toBeInTheDocument()
    expect(within(rij).getByText('35')).toBeInTheDocument()
    expect(within(rij).getByText('55')).toBeInTheDocument()
    expect(screen.getByText(i.belastingDescription)).toBeInTheDocument()
  })

  it('week zonder trainingen: geenGegevens in elke cel, een week met trainingen toont 0 als "0"', () => {
    const leeg = week({
      maandag: '2026-10-12', isoWeek: 42, trainingen: 0, perCategorie: null,
      trainingstotaalMin: null, totaalAandeel: null,
    })
    render(<BelastingKaart data={overzicht([week(), leeg])} fout={false} t={nl} />)
    const lege = screen.getByRole('rowheader', { name: /wk 42/ }).closest('tr')!
    expect(within(lege).getAllByText(i.geenGegevens)).toHaveLength(11)
    const gevulde = screen.getByRole('rowheader', { name: /wk 41/ }).closest('tr')!
    expect(within(gevulde).getAllByText('0').length).toBeGreaterThan(0)
    expect(within(gevulde).queryByText(i.geenGegevens)).toBeNull()
  })

  it('totaalstaven: role=img met label, geen staaf voor een lege week, deelweek op halve dekking', () => {
    const leeg = week({ maandag: '2026-10-12', isoWeek: 42, perCategorie: null, trainingstotaalMin: null, totaalAandeel: null })
    const deel = week({ maandag: '2026-10-19', isoWeek: 43, deelweekEind: true, totaalAandeel: 0.5 })
    render(<BelastingKaart data={overzicht([week(), leeg, deel])} fout={false} t={nl} />)
    const grafiek = screen.getByRole('img')
    expect(grafiek).toHaveAttribute('aria-label', i.belastingGrafiekLabel.replace('{n}', '3'))
    const staven = Array.from(grafiek.querySelectorAll<HTMLElement>('div[style*="height"]'))
    // 3 weken, 1 zonder trainingen → 2 staven
    expect(staven).toHaveLength(2)
    expect(staven[0].style.height).toBe('100%')
    expect(staven[0].style.opacity).toBe('1')
    expect(staven[1].style.height).toBe('50%')
    expect(staven[1].style.opacity).toBe('0.5')
  })

  it('deelweeklabel staat in tekst bij begin- en eindweek, niet bij een hele week', () => {
    render(
      <BelastingKaart
        data={overzicht([
          week({ maandag: '2026-10-05', isoWeek: 41, deelweekBegin: true }),
          week({ maandag: '2026-10-12', isoWeek: 42 }),
          week({ maandag: '2026-10-19', isoWeek: 43, deelweekEind: true }),
        ])}
        fout={false}
        t={nl}
      />,
    )
    expect(within(screen.getByRole('rowheader', { name: /wk 41/ })).getByText(i.deelweekLabel)).toBeInTheDocument()
    expect(within(screen.getByRole('rowheader', { name: /wk 42/ })).queryByText(i.deelweekLabel)).toBeNull()
    expect(within(screen.getByRole('rowheader', { name: /wk 43/ })).getByText(i.deelweekLabel)).toBeInTheDocument()
  })

  it('voetnoot bij blokken zonder duur: sterretje bij het totaal en de uitleg', () => {
    render(<BelastingKaart data={overzicht([week({ blokkenZonderDuur: 1 })])} fout={false} t={nl} />)
    expect(screen.getByText('55 *')).toBeInTheDocument()
    expect(screen.getByText(i.belastingTotaalOnvolledig)).toBeInTheDocument()
  })

  it('voettekst: alleen regels met n > 0 (som over het venster); uitleg en momentopname altijd', () => {
    const { rerender } = render(<BelastingKaart data={overzicht([week()])} fout={false} t={nl} />)
    expect(screen.queryByText(/zonder oefeningen/)).toBeNull()
    expect(screen.queryByText(/zonder duur/)).toBeNull()
    expect(screen.queryByText(/zonder leesbare categorie/)).toBeNull()
    expect(screen.queryByText(i.belastingTotaalOnvolledig)).toBeNull()
    expect(screen.getByText(i.belastingSomUitleg)).toBeInTheDocument()
    expect(screen.getByText(i.belastingMomentopname)).toBeInTheDocument()

    rerender(
      <BelastingKaart
        data={overzicht([
          week({ trainingenZonderOefeningen: 1, oefeningenZonderDuur: 2, oefeningenOnbekend: 1 }),
          week({ maandag: '2026-10-12', isoWeek: 42, trainingenZonderOefeningen: 2, oefeningenZonderDuur: 1, oefeningenOnbekend: 3 }),
        ])}
        fout={false}
        t={nl}
      />,
    )
    expect(screen.getByText('3 trainingen zonder oefeningen (tellen niet mee)')).toBeInTheDocument()
    expect(screen.getByText('3 oefeningen zonder duur (tellen niet mee)')).toBeInTheDocument()
    expect(screen.getByText('4 oefeningen zonder leesbare categorie')).toBeInTheDocument()
  })

  it('lege staat zonder trainingen', () => {
    render(<BelastingKaart data={overzicht([], { heeftTrainingen: false, heeftMinuten: false })} fout={false} t={nl} />)
    expect(screen.getByText(i.belastingEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('foutstaat toont bronFout, geen tabel en geen ruwe tekst', () => {
    render(<BelastingKaart data={overzicht([week()])} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByText(i.belastingEmpty)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('afgekapt gaat vóór leeg: melding in plaats van cijfers, ook als de vlaggen gevuld zijn', () => {
    render(<BelastingKaart data={overzicht([], { afgekapt: true })} fout={false} t={nl} />)
    expect(screen.getByText(i.afgekaptTraining)).toBeInTheDocument()
    expect(screen.queryByText(i.belastingEmpty)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('fout gaat vóór afgekapt', () => {
    render(<BelastingKaart data={overzicht([], { afgekapt: true })} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByText(i.afgekaptTraining)).toBeNull()
  })

  it('geen #hex en geen role=alert; alleen tokens', () => {
    const { container } = render(<BelastingKaart data={overzicht([week()])} fout={false} t={nl} />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
