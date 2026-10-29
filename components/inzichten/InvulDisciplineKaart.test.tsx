import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import type { EvaluatieDiscipline, InvulDiscipline } from '@/lib/inzichten'
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

// ── Fase 3b: optionele prop `evaluatie` (RPE- en oordeel-maten) ─────────
const evalData = (o: Partial<EvaluatieDiscipline> = {}): EvaluatieDiscipline => ({
  trainingen: 10, metRpe: 7, metDoelstelling: 8, metOordeelBijDoelstelling: 5, afgekapt: false, ...o,
})
const evalProp = (o: Partial<EvaluatieDiscipline> = {}, fout = false) => ({ data: evalData(o), fout })

describe('InvulDisciplineKaart met evaluatie-prop', () => {
  it('toont 5 meters en 5 termen met de juiste teksten en noemers', () => {
    const { container } = render(<InvulDisciplineKaart data={data()} fout={false} evaluatie={evalProp()} t={nl} />)
    const dl = container.querySelector('dl') as HTMLElement
    const termen = within(dl).getAllByRole('term').map((x) => x.textContent)
    expect(termen).toEqual([
      '3 van 4 gespeelde wedstrijden hebben een analyse',
      '4 van 4 gespeelde wedstrijden hebben een uitslag',
      '6 van 10 trainingen hebben een trainingsplan',
      '7 van 10 trainingen hebben een RPE',
      '5 van 8 trainingen met doelstelling hebben een oordeel',
    ])
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(5)
    expect(screen.getByText('3 trainingen zonder RPE')).toBeInTheDocument()
    expect(screen.getByText('3 trainingen met doelstelling zonder oordeel')).toBeInTheDocument()
    expect(screen.getByText(i.disciplineAanwezigheid)).toBeInTheDocument()
  })

  it('de zonder-regels staan alleen bij n > 0', () => {
    render(<InvulDisciplineKaart data={data()} fout={false} evaluatie={evalProp({ metRpe: 10, metOordeelBijDoelstelling: 8 })} t={nl} />)
    expect(screen.queryByText(/zonder RPE/)).toBeNull()
    expect(screen.queryByText(/zonder oordeel/)).toBeNull()
  })

  it('noemer 0 geeft de geen-tekst per maat, zonder meter', () => {
    const { container } = render(
      <InvulDisciplineKaart
        data={data()}
        fout={false}
        evaluatie={evalProp({ trainingen: 0, metRpe: 0, metDoelstelling: 0, metOordeelBijDoelstelling: 0 })}
        t={nl}
      />,
    )
    const termen = within(container.querySelector('dl') as HTMLElement).getAllByRole('term').map((x) => x.textContent)
    expect(termen.slice(3)).toEqual([i.disciplineGeenTrainingen, i.disciplineGeenDoelstelling])
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3)
  })

  it('D.2 gebruikt de doelstelling-noemer, niet alle trainingen', () => {
    render(<InvulDisciplineKaart data={data()} fout={false} evaluatie={evalProp({ metDoelstelling: 2, metOordeelBijDoelstelling: 1 })} t={nl} />)
    expect(screen.getByText('1 van 2 trainingen met doelstelling hebben een oordeel')).toBeInTheDocument()
    expect(screen.getByText('1 trainingen met doelstelling zonder oordeel')).toBeInTheDocument()
  })

  it('evaluatiebron faalt: alleen één regel; de 3a-maten blijven identiek', () => {
    const zonder = render(<InvulDisciplineKaart data={data()} fout={false} t={nl} />)
    const drieA = [...zonder.container.querySelectorAll('dl > div')].map((d) => d.innerHTML)
    zonder.unmount()
    const { container } = render(<InvulDisciplineKaart data={data()} fout={false} evaluatie={evalProp({}, true)} t={nl} />)
    expect([...container.querySelectorAll('dl > div')].map((d) => d.innerHTML)).toEqual(drieA)
    expect(screen.getByText(i.disciplineEvaluatieFout)).toBeInTheDocument()
    expect(screen.queryByText(/hebben een RPE/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('evaluatiebron afgekapt: alleen de afgekapt-regel onder de 3a-maten', () => {
    const { container } = render(<InvulDisciplineKaart data={data()} fout={false} evaluatie={evalProp({ afgekapt: true })} t={nl} />)
    expect(container.querySelectorAll('dl > div')).toHaveLength(3)
    expect(screen.getByText(i.afgekaptTraining)).toBeInTheDocument()
    expect(screen.queryByText(/hebben een RPE/)).toBeNull()
  })

  it('de 3a-bron blijft leidend: 3a-fout of 3a-afgekapt toont alleen de kaartmelding', () => {
    const { rerender } = render(<InvulDisciplineKaart data={data()} fout evaluatie={evalProp()} t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByText(/hebben een RPE/)).toBeNull()
    expect(screen.queryByText(i.disciplineEvaluatieFout)).toBeNull()
    rerender(<InvulDisciplineKaart data={data({ afgekapt: true })} fout={false} evaluatie={evalProp()} t={nl} />)
    expect(screen.getByText(i.afgekaptTraining)).toBeInTheDocument()
    expect(screen.queryByText(/hebben een RPE/)).toBeNull()
  })

  it('geen links, knoppen of alerts met de prop', () => {
    render(<InvulDisciplineKaart data={data()} fout={false} evaluatie={evalProp()} t={nl} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('zonder prop is de render identiek aan fase 3a (regressiebewaker)', () => {
    const { container } = render(<InvulDisciplineKaart data={data({ analyseHandmatig: 1, planHandmatig: 2 })} fout={false} t={nl} />)
    expect(container.innerHTML).toMatchInlineSnapshot(`"<div class="surface-card overflow-hidden"><div class="px-5 py-4" style="border-bottom: 1px solid var(--border-soft);"><h2 class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint">Invul-discipline</h2><p class="text-xs font-semibold text-muted mt-1">Hoe volledig wedstrijden en trainingen in deze periode t/m gisteren zijn ingevuld. Context bij de cijfers, geen oordeel.</p></div><div class="px-5 py-4"><div class="flex flex-col gap-4"><dl class="flex flex-col gap-4"><div><dt class="text-sm font-semibold text-ink tabular-nums">3 van 4 gespeelde wedstrijden hebben een analyse</dt><dd class="mt-1"><div aria-hidden="true" class="h-1.5 w-full rounded-full" style="background: var(--track);"><div class="h-full rounded-full" style="width: 75%; background: var(--brand-accent);"></div></div><p class="mt-1 text-[12.5px] text-faint">1 handmatig afgevinkt (telt niet als ingevuld)</p></dd></div><div><dt class="text-sm font-semibold text-ink tabular-nums">4 van 4 gespeelde wedstrijden hebben een uitslag</dt><dd class="mt-1"><div aria-hidden="true" class="h-1.5 w-full rounded-full" style="background: var(--track);"><div class="h-full rounded-full" style="width: 100%; background: var(--brand-accent);"></div></div></dd></div><div><dt class="text-sm font-semibold text-ink tabular-nums">6 van 10 trainingen hebben een trainingsplan</dt><dd class="mt-1"><div aria-hidden="true" class="h-1.5 w-full rounded-full" style="background: var(--track);"><div class="h-full rounded-full" style="width: 60%; background: var(--brand-accent);"></div></div><p class="mt-1 text-[12.5px] text-faint">2 handmatig afgevinkt (telt niet als ingevuld)</p></dd></div></dl><p class="text-[12.5px] text-faint">Aanwezigheid meten we hier niet: elke speler staat standaard op aanwezig, dus "niet ingevuld" is niet te herkennen.</p></div></div></div>"`)
  })
})
