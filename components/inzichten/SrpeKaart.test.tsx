import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nl } from '@/messages/nl'
import type { EvaluatieOverzicht, EvaluatieWeek } from '@/lib/inzichten'
import SrpeKaart from './SrpeKaart'

const i = nl.insights

const week = (o: Partial<EvaluatieWeek> = {}): EvaluatieWeek => ({
  maandag: '2026-10-05', isoJaar: 2026, isoWeek: 41, deelweekBegin: false, deelweekEind: false,
  trainingen: 2, metRpe: 2, zonderDuur: 0, onvolledigeDuur: 0,
  srpe: 480, srpeAandeel: 1, ja: 0, deels: 0, nee: 0, metDoelstelling: 0, metDoelstellingZonderOordeel: 0,
  ...o,
})

function overzicht(weken: EvaluatieWeek[], o: Partial<EvaluatieOverzicht> = {}): EvaluatieOverzicht {
  const som = (k: 'trainingen' | 'metRpe' | 'zonderDuur' | 'onvolledigeDuur') => weken.reduce((s, w) => s + w[k], 0)
  return {
    weken, afgekaptEvaluaties: false, afgekaptDuur: false, heeftTrainingen: true, heeftInvoer: true,
    totaal: {
      trainingen: som('trainingen'), metRpe: som('metRpe'), zonderDuur: som('zonderDuur'), onvolledigeDuur: som('onvolledigeDuur'),
      ja: 0, deels: 0, nee: 0, metDoelstelling: 0, metDoelstellingZonderOordeel: 0,
    },
    ...o,
  }
}

const renderKaart = (data: EvaluatieOverzicht, fout = false) => render(<SrpeKaart data={data} fout={fout} t={nl} />)

describe('SrpeKaart', () => {
  it('toont kolommen, "x van y", sRPE en de altijd-zichtbare voetregels', () => {
    renderKaart(overzicht([week({ trainingen: 3, metRpe: 2 })]))
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([i.kolomWeek, i.kolomMetRpe, i.kolomSrpe])
    const rij = screen.getByRole('rowheader', { name: /wk 41/ }).closest('tr')!
    expect(within(rij).getByText('2 van 3')).toBeInTheDocument()
    expect(within(rij).getByText('480')).toBeInTheDocument()
    expect(screen.getByText(i.srpeDescription)).toBeInTheDocument()
    expect(screen.getByText(i.srpeMomentopname)).toBeInTheDocument()
    expect(screen.getByText(i.srpeVolgendeDag)).toBeInTheDocument()
  })

  it('fout geeft bronFout; afgekapt (evaluaties of duur) geeft afgekaptTraining; leeg geeft de eigen lege staat', () => {
    const { unmount } = renderKaart(overzicht([week()]), true)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    unmount()
    for (const vlag of ['afgekaptEvaluaties', 'afgekaptDuur'] as const) {
      const r = renderKaart(overzicht([], { [vlag]: true }))
      expect(screen.getByText(i.afgekaptTraining)).toBeInTheDocument()
      expect(screen.queryByRole('table')).toBeNull()
      r.unmount()
    }
    renderKaart(overzicht([], { heeftTrainingen: false, heeftInvoer: false }))
    expect(screen.getByText(i.srpeEmpty)).toBeInTheDocument()
  })

  it('fout gaat voor afgekapt, afgekapt voor leeg', () => {
    const { unmount } = renderKaart(overzicht([], { afgekaptDuur: true, heeftTrainingen: false }), true)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByText(i.afgekaptTraining)).toBeNull()
    unmount()
    renderKaart(overzicht([], { afgekaptEvaluaties: true, heeftTrainingen: false }))
    expect(screen.getByText(i.afgekaptTraining)).toBeInTheDocument()
    expect(screen.queryByText(i.srpeEmpty)).toBeNull()
  })

  it('geenGegevens (week zonder trainingen of zonder RPE) tegenover een echte nul', () => {
    const leeg = week({ maandag: '2026-10-12', isoWeek: 42, trainingen: 0, metRpe: 0, srpe: null, srpeAandeel: null })
    const zonderRpe = week({ maandag: '2026-10-19', isoWeek: 43, trainingen: 2, metRpe: 0, srpe: null, srpeAandeel: null })
    const nul = week({ maandag: '2026-10-26', isoWeek: 44, trainingen: 1, metRpe: 0, srpe: 0, srpeAandeel: 0 })
    renderKaart(overzicht([week(), leeg, zonderRpe, nul]))
    const r42 = screen.getByRole('rowheader', { name: /wk 42/ }).closest('tr')!
    expect(within(r42).getAllByText(i.geenGegevens)).toHaveLength(2)
    const r43 = screen.getByRole('rowheader', { name: /wk 43/ }).closest('tr')!
    expect(within(r43).getByText('0 van 2')).toBeInTheDocument() // dekking blijft zichtbaar
    expect(within(r43).getAllByText(i.geenGegevens)).toHaveLength(1)
    const r44 = screen.getByRole('rowheader', { name: /wk 44/ }).closest('tr')!
    expect(within(r44).getByText('0')).toBeInTheDocument()
    expect(within(r44).queryByText(i.geenGegevens)).toBeNull()
  })

  it('deelweekbadge bij een begin- of eindweek', () => {
    renderKaart(overzicht([week({ deelweekBegin: true }), week({ maandag: '2026-10-12', isoWeek: 42 })]))
    expect(screen.getAllByText(i.deelweekLabel)).toHaveLength(1)
  })

  it('voetnoot * en voetregels alleen bij n > 0', () => {
    const { unmount } = renderKaart(overzicht([week()]))
    expect(screen.queryByText(/zonder RPE \(tellen niet mee\)/)).toBeNull()
    expect(screen.queryByText(/zonder geplande duur/)).toBeNull()
    expect(screen.queryByText(i.srpeOnvolledig)).toBeNull()
    expect(screen.queryByText(/ \*$/)).toBeNull()
    unmount()
    renderKaart(overzicht([
      week({ trainingen: 4, metRpe: 2, zonderDuur: 1, onvolledigeDuur: 1 }),
    ]))
    expect(screen.getByText('2 trainingen zonder RPE (tellen niet mee)')).toBeInTheDocument()
    expect(screen.getByText('1 trainingen met RPE maar zonder geplande duur (tellen niet mee)')).toBeInTheDocument()
    expect(screen.getByText(i.srpeOnvolledig)).toBeInTheDocument()
    expect(screen.getByText('480 *')).toBeInTheDocument()
  })

  it('staven: role=img met label, geen staaf bij een week zonder sRPE, deelweek halfdoorzichtig', () => {
    const w = [
      week({ srpeAandeel: 1, deelweekBegin: true }),
      week({ maandag: '2026-10-12', isoWeek: 42, srpe: null, srpeAandeel: null }),
      week({ maandag: '2026-10-19', isoWeek: 43, srpe: 240, srpeAandeel: 0.5 }),
    ]
    renderKaart(overzicht(w))
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('aria-label', 'sRPE in AU per week, 3 weken')
    const staven = [...img.querySelectorAll<HTMLElement>('div[style*="height"]')]
    expect(staven).toHaveLength(2)
    expect(staven[0].style.height).toBe('100%')
    expect(staven[0].style.opacity).toBe('0.5')
    expect(staven[1].style.height).toBe('50%')
    expect(staven[1].style.opacity).toBe('1')
    expect(staven[0].style.background).toContain('var(--brand-accent)')
  })

  it('geen role=alert, geen links/knoppen, geen #hex, geen oordeelskleur', () => {
    const { container } = renderKaart(overzicht([week()]))
    expect(container.querySelectorAll('[role="alert"], a, button')).toHaveLength(0)
    const src = readFileSync(join(process.cwd(), 'components/inzichten/SrpeKaart.tsx'), 'utf8')
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
