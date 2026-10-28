import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import type { InvulDiscipline } from '@/lib/inzichten'
import InvulDisciplineKaart from './InvulDisciplineKaart'

const i = nl.insights

const data = (o: Partial<InvulDiscipline> = {}): InvulDiscipline => ({
  wedstrijden: 4, metAnalyse: 3, metUitslag: 4, analyseHandmatig: 0,
  trainingen: 10, metPlan: 6, planHandmatig: 0, afgekapt: false, ...o,
})

describe('InvulDisciplineKaart', () => {
  it('toont de drie x-van-y-maten en de aanwezigheidsnoot', () => {
    render(<InvulDisciplineKaart data={data()} fout={false} t={nl} />)
    expect(screen.getByText('3 van 4 gespeelde wedstrijden hebben een analyse')).toBeInTheDocument()
    expect(screen.getByText('4 van 4 gespeelde wedstrijden hebben een uitslag')).toBeInTheDocument()
    expect(screen.getByText('6 van 10 trainingen hebben een trainingsplan')).toBeInTheDocument()
    expect(screen.getByText(i.disciplineAanwezigheid)).toBeInTheDocument()
    expect(screen.getByText(i.disciplineDescription)).toBeInTheDocument()
  })

  it('meters zijn aria-hidden en hebben de juiste breedte', () => {
    const { container } = render(<InvulDisciplineKaart data={data()} fout={false} t={nl} />)
    const meters = Array.from(container.querySelectorAll('[aria-hidden="true"]'))
    expect(meters).toHaveLength(3)
    const vullingen = meters.map((m) => (m.firstElementChild as HTMLElement).style.width)
    expect(vullingen).toEqual(['75%', '100%', '60%'])
  })

  it('handmatig afgevinkt staat apart onder analyse en plan, alleen bij n > 0', () => {
    const { rerender } = render(<InvulDisciplineKaart data={data()} fout={false} t={nl} />)
    expect(screen.queryByText(/handmatig afgevinkt/)).toBeNull()
    rerender(<InvulDisciplineKaart data={data({ analyseHandmatig: 2, planHandmatig: 1 })} fout={false} t={nl} />)
    expect(screen.getByText('2 handmatig afgevinkt (telt niet als ingevuld)')).toBeInTheDocument()
    expect(screen.getByText('1 handmatig afgevinkt (telt niet als ingevuld)')).toBeInTheDocument()
  })

  it('noemer 0 per maat: wedstrijden zonder trainingen en andersom, zonder meter', () => {
    const { container, rerender } = render(
      <InvulDisciplineKaart data={data({ wedstrijden: 0, metAnalyse: 0, metUitslag: 0 })} fout={false} t={nl} />,
    )
    expect(screen.getAllByText(i.disciplineGeenWedstrijden)).toHaveLength(2)
    expect(screen.getByText('6 van 10 trainingen hebben een trainingsplan')).toBeInTheDocument()
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1)
    rerender(<InvulDisciplineKaart data={data({ trainingen: 0, metPlan: 0 })} fout={false} t={nl} />)
    expect(screen.getByText(i.disciplineGeenTrainingen)).toBeInTheDocument()
    expect(screen.getByText('3 van 4 gespeelde wedstrijden hebben een analyse')).toBeInTheDocument()
  })

  it('"0 van y" blijft een echte nul, met een lege meter', () => {
    const { container } = render(
      <InvulDisciplineKaart data={data({ metAnalyse: 0, metUitslag: 0, metPlan: 0 })} fout={false} t={nl} />,
    )
    expect(screen.getByText('0 van 4 gespeelde wedstrijden hebben een analyse')).toBeInTheDocument()
    const eerste = container.querySelector('[aria-hidden="true"]')!.firstElementChild as HTMLElement
    expect(eerste.style.width).toBe('0%')
  })

  it('lege staat als er geen wedstrijden en geen trainingen zijn', () => {
    render(<InvulDisciplineKaart data={data({ wedstrijden: 0, trainingen: 0, metAnalyse: 0, metUitslag: 0, metPlan: 0 })} fout={false} t={nl} />)
    expect(screen.getByText(i.disciplineEmpty)).toBeInTheDocument()
    expect(screen.queryByText(i.disciplineAanwezigheid)).toBeNull()
  })

  it('foutstaat en afgekapt tonen een melding en geen cijfers; afgekapt gaat vóór leeg', () => {
    const { rerender } = render(<InvulDisciplineKaart data={data()} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByText(i.disciplineAanwezigheid)).toBeNull()
    rerender(<InvulDisciplineKaart data={data({ afgekapt: true })} fout={false} t={nl} />)
    expect(screen.getByText(i.afgekaptTraining)).toBeInTheDocument()
    expect(screen.queryByText(/gespeelde wedstrijden hebben/)).toBeNull()
    rerender(<InvulDisciplineKaart data={data({ afgekapt: true, wedstrijden: 0, trainingen: 0 })} fout={false} t={nl} />)
    expect(screen.getByText(i.afgekaptTraining)).toBeInTheDocument()
    expect(screen.queryByText(i.disciplineEmpty)).toBeNull()
  })

  it('geen links, knoppen, #hex of oordeel-alert', () => {
    const { container } = render(<InvulDisciplineKaart data={data({ analyseHandmatig: 1 })} fout={false} t={nl} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    const dl = container.querySelector('dl')!
    expect(within(dl as HTMLElement).getAllByRole('term')).toHaveLength(3)
  })
})
