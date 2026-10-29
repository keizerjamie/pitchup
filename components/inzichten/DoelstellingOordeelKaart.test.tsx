import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nl } from '@/messages/nl'
import type { EvaluatieOverzicht, EvaluatieWeek } from '@/lib/inzichten'
import DoelstellingOordeelKaart from './DoelstellingOordeelKaart'

const i = nl.insights

const week = (o: Partial<EvaluatieWeek> = {}): EvaluatieWeek => ({
  maandag: '2026-10-05', isoJaar: 2026, isoWeek: 41, deelweekBegin: false, deelweekEind: false,
  trainingen: 4, metRpe: 0, zonderDuur: 0, onvolledigeDuur: 0, srpe: null, srpeAandeel: null,
  ja: 2, deels: 1, nee: 0, metDoelstelling: 4, metDoelstellingZonderOordeel: 1,
  ...o,
})

function overzicht(weken: EvaluatieWeek[], o: Partial<EvaluatieOverzicht> = {}): EvaluatieOverzicht {
  const t = { trainingen: 0, metRpe: 0, zonderDuur: 0, onvolledigeDuur: 0, ja: 0, deels: 0, nee: 0, metDoelstelling: 0, metDoelstellingZonderOordeel: 0 }
  for (const w of weken) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += w[k]
  return { weken, afgekaptEvaluaties: false, afgekaptDuur: false, heeftTrainingen: true, heeftInvoer: true, totaal: t, ...o }
}

const renderKaart = (data: EvaluatieOverzicht, fout = false) =>
  render(<DoelstellingOordeelKaart data={data} fout={fout} t={nl} />)

describe('DoelstellingOordeelKaart', () => {
  it('toont de periode-samenvatting en de weektabel met vijf kolommen', () => {
    renderKaart(overzicht([week(), week({ maandag: '2026-10-12', isoWeek: 42, ja: 1, deels: 0, nee: 1, metDoelstelling: 2, metDoelstellingZonderOordeel: 0 })]))
    const dl = document.querySelector('dl')!
    expect([...dl.querySelectorAll('dt')].map((x) => x.textContent)).toEqual([i.kolomJa, i.kolomDeels, i.kolomNee, i.kolomZonderOordeel])
    expect([...dl.querySelectorAll('dd')].map((x) => x.textContent)).toEqual(['3', '1', '1', '1'])
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      i.kolomWeek, i.kolomJa, i.kolomDeels, i.kolomNee, i.kolomZonderOordeel,
    ])
    const rij = screen.getByRole('rowheader', { name: /wk 41/ }).closest('tr')!
    expect([...rij.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['2', '1', '0', '1'])
    expect(screen.getByText(i.oordeelDescription)).toBeInTheDocument()
    expect(screen.getByText(i.oordeelZonderUitleg)).toBeInTheDocument()
  })

  it('fout, afgekapt, leeg en geen-doelstellingen-staat (in die volgorde)', () => {
    const { unmount } = renderKaart(overzicht([week()]), true)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    unmount()
    const a = renderKaart(overzicht([], { afgekaptEvaluaties: true }))
    expect(screen.getByText(i.afgekaptTraining)).toBeInTheDocument()
    a.unmount()
    const l = renderKaart(overzicht([], { heeftTrainingen: false, heeftInvoer: false }))
    expect(screen.getByText(i.oordeelEmpty)).toBeInTheDocument()
    l.unmount()
    renderKaart(overzicht([week({ ja: 0, deels: 0, nee: 0, metDoelstelling: 0, metDoelstellingZonderOordeel: 0 })]))
    expect(screen.getByText(i.oordeelGeenDoelstellingen)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('een oordeel zonder huidige doelstelling (O1) telt mee en toont dus de tabel', () => {
    renderKaart(overzicht([week({ ja: 1, deels: 0, nee: 0, metDoelstelling: 0, metDoelstellingZonderOordeel: 0 })]))
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByText(i.oordeelGeenDoelstellingen)).toBeNull()
  })

  it('week zonder trainingen: geenGegevens in alle vier cellen; een echte 0 blijft "0"', () => {
    const leeg = week({ maandag: '2026-10-12', isoWeek: 42, trainingen: 0, ja: 0, deels: 0, nee: 0, metDoelstelling: 0, metDoelstellingZonderOordeel: 0 })
    const nul = week({ maandag: '2026-10-19', isoWeek: 43, trainingen: 1, ja: 0, deels: 0, nee: 0, metDoelstelling: 0, metDoelstellingZonderOordeel: 0 })
    renderKaart(overzicht([week(), leeg, nul]))
    const r42 = screen.getByRole('rowheader', { name: /wk 42/ }).closest('tr')!
    expect(within(r42).getAllByText(i.geenGegevens)).toHaveLength(4)
    const r43 = screen.getByRole('rowheader', { name: /wk 43/ }).closest('tr')!
    expect([...r43.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['0', '0', '0', '0'])
  })

  it('"zonder oordeel" staat in een eigen kolom en wordt niet bij nee geteld', () => {
    renderKaart(overzicht([week({ ja: 0, deels: 0, nee: 0, metDoelstelling: 3, metDoelstellingZonderOordeel: 3 })]))
    const rij = screen.getByRole('rowheader', { name: /wk 41/ }).closest('tr')!
    expect([...rij.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['0', '0', '0', '3'])
  })

  it('deelweekbadge', () => {
    renderKaart(overzicht([week({ deelweekEind: true })]))
    expect(screen.getByText(i.deelweekLabel)).toBeInTheDocument()
  })

  it('geen role=alert, geen grafiek, geen links/knoppen, geen kleur per oordeel, geen #hex', () => {
    const { container } = renderKaart(overzicht([week()]))
    expect(container.querySelectorAll('[role="alert"], [role="img"], a, button')).toHaveLength(0)
    expect(container.querySelectorAll('[style*="background"], [style*="color"]')).toHaveLength(0)
    const src = readFileSync(join(process.cwd(), 'components/inzichten/DoelstellingOordeelKaart.tsx'), 'utf8')
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
