import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import { MEETBARE_CATEGORIES } from '@/lib/types'
import type { OnderdeelVoortgang, PeriodiseringVoortgang } from '@/lib/inzichten'
import PeriodiseringVoortgangKaart from './PeriodiseringVoortgangKaart'

const i = nl.insights

const ongemeten = (key: OnderdeelVoortgang['key']): OnderdeelVoortgang => ({
  key, maxStap: 6, gemeten: false, nulmeting: null, huidig: null, verschil: null,
  geenVoortgang: false, punten: [], trainingen: 0,
})

const gemeten = (key: OnderdeelVoortgang['key'], o: Partial<OnderdeelVoortgang> = {}): OnderdeelVoortgang => ({
  key, maxStap: 6, gemeten: true,
  nulmeting: { datum: '2026-09-01', stap: 2 }, huidig: { stap: 4 }, verschil: 2, geenVoortgang: false,
  punten: [
    { datum: '2026-09-01', stap: 2, bron: 'meting', handmatig: false, eventId: null },
    { datum: '2026-09-08', stap: 2, bron: 'training', handmatig: false, eventId: 'e1' },
    { datum: '2026-09-15', stap: 5, bron: 'training', handmatig: true, eventId: 'e2' },
  ],
  trainingen: 2,
  ...o,
})

const data = (onderdelen: OnderdeelVoortgang[], o: Partial<PeriodiseringVoortgang> = {}): PeriodiseringVoortgang => ({
  onderdelen, afgekapt: false, onbekend: 0, ...o,
})

const [A, B] = MEETBARE_CATEGORIES
const naam = (k: string) => nl.periodization.categories[k]

describe('PeriodiseringVoortgangKaart', () => {
  it('toont per onderdeel nulmeting, huidige stap met max en voortgang met teken', () => {
    render(<PeriodiseringVoortgangKaart data={data([gemeten(A)])} fout={false} t={nl} />)
    const rij = screen.getByRole('rowheader', { name: naam(A) }).closest('tr')!
    expect(rij).toHaveTextContent('stap 2 ·')
    expect(rij).toHaveTextContent('stap 4')
    expect(rij).toHaveTextContent('max 6')
    expect(rij).toHaveTextContent('+2 stappen sinds nulmeting')
    for (const k of [i.kolomOnderdeel, i.kolomNulmeting, i.kolomHuidigeStap, i.kolomVoortgang]) {
      expect(screen.getByRole('columnheader', { name: k })).toBeInTheDocument()
    }
    expect(screen.getByText(i.periodiseringDescription)).toBeInTheDocument()
  })

  it('negatief en nul verschil: echte tekens, "0" blijft 0', () => {
    render(
      <PeriodiseringVoortgangKaart
        data={data([gemeten(A, { verschil: -1, huidig: { stap: 1 } }), gemeten(B, { verschil: 0, huidig: { stap: 2 } })])}
        fout={false}
        t={nl}
      />,
    )
    expect(screen.getByRole('rowheader', { name: naam(A) }).closest('tr')).toHaveTextContent('−1 stappen sinds nulmeting')
    expect(screen.getByRole('rowheader', { name: naam(B) }).closest('tr')).toHaveTextContent('0 stappen sinds nulmeting')
  })

  it('stap boven het maximum wordt getoond zoals hij is', () => {
    render(<PeriodiseringVoortgangKaart data={data([gemeten(A, { huidig: { stap: 8 } })])} fout={false} t={nl} />)
    const rij = screen.getByRole('rowheader', { name: naam(A) }).closest('tr')!
    expect(rij).toHaveTextContent('stap 8')
    expect(rij).toHaveTextContent('max 6')
  })

  it('ongemeten onderdeel: "nog niet gemeten", nooit 0', () => {
    render(<PeriodiseringVoortgangKaart data={data([gemeten(A), ongemeten(B)])} fout={false} t={nl} />)
    const rij = screen.getByRole('rowheader', { name: naam(B) }).closest('tr')!
    expect(rij).toHaveTextContent(i.periodiseringNietGemeten)
    expect(rij.textContent).not.toMatch(/\b0\b/)
    expect(rij.querySelector('svg')).toBeNull()
  })

  it('geenVoortgang toont "nog geen voortgang te tonen" in plaats van een verschil', () => {
    render(
      <PeriodiseringVoortgangKaart
        data={data([gemeten(A, { geenVoortgang: true, verschil: 0, punten: [{ datum: '2026-09-01', stap: 2, bron: 'meting', handmatig: false, eventId: null }], trainingen: 0 })])}
        fout={false}
        t={nl}
      />,
    )
    const rij = screen.getByRole('rowheader', { name: naam(A) }).closest('tr')!
    expect(rij).toHaveTextContent(i.periodiseringGeenVoortgang)
    expect(rij).not.toHaveTextContent('stappen sinds nulmeting')
  })

  it('staplijn: aria-hidden svg, accent-stroke, markers alleen op meetpunten (r >= 4); één punt geeft geen lijn', () => {
    const { container, rerender } = render(<PeriodiseringVoortgangKaart data={data([gemeten(A)])} fout={false} t={nl} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg.getAttribute('width')).toBe('120')
    expect(svg.getAttribute('height')).toBe('24')
    const pad = svg.querySelector('path')!
    expect(pad.getAttribute('stroke')).toBe('var(--brand-accent)')
    expect(pad.getAttribute('stroke-width')).toBe('2')
    const markers = svg.querySelectorAll('circle')
    expect(markers).toHaveLength(1) // één meetpunt, twee trainingspunten
    expect(Number(markers[0].getAttribute('r'))).toBeGreaterThanOrEqual(4)
    expect(markers[0].getAttribute('fill')).toBe('var(--surface)')

    rerender(
      <PeriodiseringVoortgangKaart
        data={data([gemeten(A, { punten: [{ datum: '2026-09-01', stap: 2, bron: 'meting', handmatig: false, eventId: null }] })])}
        fout={false}
        t={nl}
      />,
    )
    expect(container.querySelector('svg path')).toBeNull()
    expect(container.querySelectorAll('svg circle')).toHaveLength(1)
  })

  it('details bevat alle punten met datum, stap en bron (meting / training / handmatig)', () => {
    const { container } = render(<PeriodiseringVoortgangKaart data={data([gemeten(A)])} fout={false} t={nl} />)
    const details = container.querySelector('details')!
    expect(within(details).getByText(i.reeksBekijken)).toBeInTheDocument()
    const rijen = within(details).getAllByRole('row').slice(1)
    expect(rijen).toHaveLength(3)
    expect(rijen[0]).toHaveTextContent(i.bronMeting)
    expect(rijen[1]).toHaveTextContent(i.bronTraining)
    expect(rijen[2]).toHaveTextContent(i.bronHandmatig)
    for (const k of [i.kolomDatum, i.kolomStap, i.kolomBron]) {
      expect(within(details).getByRole('columnheader', { name: k })).toBeInTheDocument()
    }
  })

  it('onbekend > 0 geeft de regel over oefeningen zonder leesbare categorie', () => {
    const { rerender } = render(<PeriodiseringVoortgangKaart data={data([gemeten(A)])} fout={false} t={nl} />)
    expect(screen.queryByText(/zonder leesbare categorie/)).toBeNull()
    rerender(<PeriodiseringVoortgangKaart data={data([gemeten(A)], { onbekend: 2 })} fout={false} t={nl} />)
    expect(screen.getByText('2 oefeningen zonder leesbare categorie')).toBeInTheDocument()
  })

  it('lege staat als geen enkel onderdeel gemeten is', () => {
    render(<PeriodiseringVoortgangKaart data={data([ongemeten(A), ongemeten(B)])} fout={false} t={nl} />)
    expect(screen.getByText(i.periodiseringEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('foutstaat; afgekapt (zonder onderdelen) toont de melding en niet de lege staat', () => {
    const { rerender } = render(<PeriodiseringVoortgangKaart data={data([gemeten(A)])} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    rerender(<PeriodiseringVoortgangKaart data={data([], { afgekapt: true })} fout={false} t={nl} />)
    expect(screen.getByText(i.periodiseringAfgekapt)).toBeInTheDocument()
    expect(screen.queryByText(i.afgekaptTraining)).toBeNull()
    expect(screen.queryByText(i.periodiseringEmpty)).toBeNull()
    expect(i.periodiseringAfgekapt).not.toMatch(/kortere periode/)
  })

  it('seizoen nog niet begonnen: tabel met nulmeting/huidig/verschil en de uitleg, zonder staplijn en details', () => {
    const { container } = render(
      <PeriodiseringVoortgangKaart
        data={data([gemeten(A, { punten: [], trainingen: 0 }), ongemeten(B)], { seizoenNogNietBegonnen: true })}
        fout={false}
        t={nl}
      />,
    )
    const rij = screen.getByRole('rowheader', { name: naam(A) }).closest('tr')!
    expect(rij).toHaveTextContent('stap 2 ·')
    expect(rij).toHaveTextContent('stap 4')
    expect(rij).toHaveTextContent('+2 stappen sinds nulmeting')
    expect(screen.getByRole('rowheader', { name: naam(B) }).closest('tr')).toHaveTextContent(i.periodiseringNietGemeten)
    expect(screen.getByText(i.seizoenNogNietBegonnen)).toBeInTheDocument()
    expect(screen.queryByText(i.periodiseringEmpty)).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('details')).toBeNull()
  })

  it('seizoen nog niet begonnen zonder enige meting: de gewone lege staat, geen uitleg', () => {
    render(
      <PeriodiseringVoortgangKaart data={data([ongemeten(A)], { seizoenNogNietBegonnen: true })} fout={false} t={nl} />,
    )
    expect(screen.getByText(i.periodiseringEmpty)).toBeInTheDocument()
    expect(screen.queryByText(i.seizoenNogNietBegonnen)).toBeNull()
  })

  it('de uitleg ontbreekt als het seizoen wel begonnen is', () => {
    render(<PeriodiseringVoortgangKaart data={data([gemeten(A)])} fout={false} t={nl} />)
    expect(screen.queryByText(i.seizoenNogNietBegonnen)).toBeNull()
  })

  it('geen #hex en geen role=alert', () => {
    const { container } = render(<PeriodiseringVoortgangKaart data={data([gemeten(A), ongemeten(B)])} fout={false} t={nl} />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
