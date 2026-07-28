import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import OefeningEditor from '@/components/OefeningEditor'
import type { OefeningInput } from '@/lib/oefening'

function renderEditor(overrides: Partial<Parameters<typeof OefeningEditor>[0]> = {}) {
  const onSubmit = vi.fn<(input: OefeningInput) => Promise<void>>().mockResolvedValue(undefined)
  const onCancel = vi.fn()
  render(
    <DictProvider dict={nl}>
      <OefeningEditor onCancel={onCancel} onSubmit={onSubmit} {...overrides} />
    </DictProvider>,
  )
  return { onSubmit, onCancel }
}

describe('OefeningEditor — teams (dynamische lijst)', () => {
  it('voegt een team toe en weer verwijdert die', () => {
    renderEditor()

    expect(screen.getByText(nl.oefeningen.noTeamsHint)).toBeInTheDocument()

    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    expect(screen.queryByText(nl.oefeningen.noTeamsHint)).not.toBeInTheDocument()
    expect(screen.getAllByLabelText(nl.oefeningen.teamSize)).toHaveLength(1)

    fireEvent.click(screen.getByLabelText(nl.oefeningen.removeTeamAria))
    expect(screen.getByText(nl.oefeningen.noTeamsHint)).toBeInTheDocument()
  })

  it('grootte 7 kiezen → alleen 7v7-formaties selecteerbaar, niet-passende afwezig', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))

    const sizeSelect = screen.getAllByLabelText(nl.oefeningen.teamSize)[0]
    fireEvent.change(sizeSelect, { target: { value: '7' } })

    const formatieSelect = screen.getAllByLabelText(nl.oefeningen.formation)[0] as HTMLSelectElement
    expect(formatieSelect.disabled).toBe(false)

    const optionLabels = within(formatieSelect).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    // 7v7-formaties (uit FORMATIONS_BY_TEAM_SIZE[7]) moeten aanwezig zijn...
    expect(optionLabels).toContain('2-3-1')
    expect(optionLabels).toContain('3-2-1')
    // ...maar een 11-tal formatie die niet bij grootte 7 past, niet.
    expect(optionLabels).not.toContain('4-3-3')
    expect(optionLabels).not.toContain('4-4-2')
  })

  it('reset de formatie wanneer de teamgrootte wijzigt naar een niet-passende maat', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))

    const sizeSelect = screen.getAllByLabelText(nl.oefeningen.teamSize)[0]
    fireEvent.change(sizeSelect, { target: { value: '7' } })
    const formatieSelect = screen.getAllByLabelText(nl.oefeningen.formation)[0] as HTMLSelectElement
    fireEvent.change(formatieSelect, { target: { value: '2-3-1' } })
    expect(formatieSelect.value).toBe('2-3-1')

    // Wissel naar grootte 6 — '2-3-1' bestaat niet voor 6, dus moet resetten naar leeg.
    fireEvent.change(sizeSelect, { target: { value: '6' } })
    const formatieSelectAfter = screen.getAllByLabelText(nl.oefeningen.formation)[0] as HTMLSelectElement
    expect(formatieSelectAfter.value).toBe('')
  })

  it('ondersteunt meerdere teams met verschillende groottes tegelijk (asymmetrie)', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))

    const sizeSelects = screen.getAllByLabelText(nl.oefeningen.teamSize)
    expect(sizeSelects).toHaveLength(3)

    fireEvent.change(sizeSelects[0], { target: { value: '4' } })
    fireEvent.change(sizeSelects[1], { target: { value: '6' } })
    fireEvent.change(sizeSelects[2], { target: { value: '8' } })

    const formatieSelects = screen.getAllByLabelText(nl.oefeningen.formation) as HTMLSelectElement[]
    fireEvent.change(formatieSelects[0], { target: { value: '2-1' } })
    fireEvent.change(formatieSelects[1], { target: { value: '3-2' } })
    // Team 3 blijft zonder formatie (mag leeg).

    expect((screen.getAllByLabelText(nl.oefeningen.teamSize)[0] as HTMLSelectElement).value).toBe('4')
    expect((screen.getAllByLabelText(nl.oefeningen.teamSize)[1] as HTMLSelectElement).value).toBe('6')
    expect((screen.getAllByLabelText(nl.oefeningen.teamSize)[2] as HTMLSelectElement).value).toBe('8')
  })

  it('respecteert het maximum van 6 teams', () => {
    renderEditor()
    for (let i = 0; i < 8; i++) {
      fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    }
    expect(screen.getAllByLabelText(nl.oefeningen.teamSize)).toHaveLength(6)
  })
})

describe('OefeningEditor — overige velden', () => {
  it('het aantal_neutralen-veld accepteert een getal', () => {
    renderEditor()
    const input = screen.getByLabelText(nl.oefeningen.neutralsLabel) as HTMLInputElement
    fireEvent.change(input, { target: { value: '5' } })
    expect(input.value).toBe('5')
  })

  it('opslaan blijft mogelijk zonder teams (knop niet geblokkeerd)', async () => {
    const { onSubmit } = renderEditor()
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Rondo 4v2' } })

    const saveButton = screen.getByText(nl.trainingPlan.save)
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const submitted = onSubmit.mock.calls[0][0]
    expect(submitted.teams).toEqual([])
    expect(submitted.naam).toBe('Rondo 4v2')
  })

  it('de opslaan-knop is uitgeschakeld zonder naam', () => {
    renderEditor()
    expect(screen.getByText(nl.trainingPlan.save)).toBeDisabled()
  })

  it('filtert onvolledige team-rijen (zonder gekozen grootte) uit de submit-payload', async () => {
    const { onSubmit } = renderEditor()
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Positiespel' } })
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    const sizeSelects = screen.getAllByLabelText(nl.oefeningen.teamSize)
    fireEvent.change(sizeSelects[0], { target: { value: '5' } })
    // Tweede team blijft zonder grootte gekozen.

    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].teams).toEqual([{ grootte: 5, formatie: null }])
  })

  it('toont een foutmelding wanneer onSubmit faalt, zonder de sheet te sluiten', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Naam verplicht'))
    render(
      <DictProvider dict={nl}>
        <OefeningEditor onCancel={vi.fn()} onSubmit={onSubmit} />
      </DictProvider>,
    )
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'X' } })
    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(screen.getByText('Naam verplicht')).toBeInTheDocument())
  })

  it('preset categorie/naam vullen het formulier vooraf in create-modus', () => {
    renderEditor({ presetCategorie: 'sprints_veel_rust', presetNaam: 'Sprints Veel Rust' })
    expect((screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`) as HTMLInputElement).value).toBe('Sprints Veel Rust')
  })

  it('opslaan zonder teams werkt ook mét een tekening: de speler-tool laat spelers plaatsen zonder team, en dat diagram gaat mee in de OefeningInput', async () => {
    const onSubmit = vi.fn<(input: OefeningInput) => Promise<void>>().mockResolvedValue(undefined)
    const { container } = render(
      <DictProvider dict={nl}>
        <OefeningEditor onCancel={vi.fn()} onSubmit={onSubmit} />
      </DictProvider>,
    )
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Vrij oefenen' } })

    // Tekening-editor openklappen (0 teams — geen team nodig om te tekenen).
    fireEvent.click(screen.getByText(new RegExp(nl.oefeningen.diagramToggle)))
    const svg = container.querySelector('[data-testid="diagram-svg"]') as SVGSVGElement
    svg.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 140, width: 100, height: 140, toJSON() {} }) as DOMRect

    fireEvent.click(screen.getByText(nl.oefeningen.toolSpeler))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    const event = new Event('pointerdown', { bubbles: true, cancelable: true })
    Object.assign(event, { clientX: 25, clientY: 35, pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true })
    fireEvent(bg, event)

    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))

    const submitted = onSubmit.mock.calls[0][0]
    expect(submitted.teams).toEqual([])
    expect(submitted.diagram?.markers).toEqual([{ x: 25, y: 35, teamIndex: 0, rol: 'speler' }])
  })
})
