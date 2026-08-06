import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import OefeningEditor from '@/components/OefeningEditor'
import type { OefeningInput } from '@/lib/oefening'
import { formatiesVoorTeam } from '@/lib/formaties'

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

  it('grootte 7 kiezen (standaardcategorie partijen_groot, inclusief keeper) toont exact de door de generator geleverde formaties, alfabetisch gesorteerd', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))

    const sizeSelect = screen.getAllByLabelText(nl.oefeningen.teamSize)[0]
    fireEvent.change(sizeSelect, { target: { value: '7' } })

    const expected = formatiesVoorTeam({ grootte: 7, keeperInGrootte: true }, 'partijen_groot').map((f) => f.label)
    expect(expected.length).toBeGreaterThan(0)

    const group = screen.getByRole('group', { name: nl.oefeningen.formation })
    const buttonLabels = within(group).getAllByRole('button').map((b) => b.textContent)
    expect(buttonLabels).toEqual(expected)
    expect([...buttonLabels].sort((a, b) => (a ?? '').localeCompare(b ?? '', 'nl'))).toEqual(buttonLabels)
  })

  it('single-select: een chip aanklikken selecteert die, een andere chip aanklikken vervangt de selectie', async () => {
    const { onSubmit } = renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Positiespel' } })

    fireEvent.click(screen.getByRole('button', { name: '2-3-1' }))
    expect(screen.getByRole('button', { name: '2-3-1' })).toHaveAttribute('aria-pressed', 'true')

    // Andere chip aanklikken vervangt de selectie (geen multi-select meer).
    fireEvent.click(screen.getByRole('button', { name: '3-2-1' }))
    expect(screen.getByRole('button', { name: '2-3-1' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '3-2-1' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].teams).toEqual([{ grootte: 7, formaties: ['3-2-1'], keeperInGrootte: true }])
  })

  it('dezelfde chip nogmaals aanklikken maakt de selectie leeg ("geen formatie")', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '7' } })

    fireEvent.click(screen.getByRole('button', { name: '2-3-1' }))
    expect(screen.getByRole('button', { name: '2-3-1' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '2-3-1' }))
    expect(screen.getByRole('button', { name: '2-3-1' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('de "Alles selecteren"-knop bestaat niet meer', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '7' } })
    expect(screen.queryByText('Alles selecteren')).not.toBeInTheDocument()
  })

  it('teamgrootte wijzigen naar een niet-passende maat laat een niet-passende formatie automatisch vervallen', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))

    const sizeSelect = screen.getAllByLabelText(nl.oefeningen.teamSize)[0]
    fireEvent.change(sizeSelect, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: '2-3-1' }))
    expect(screen.getByRole('button', { name: '2-3-1' })).toHaveAttribute('aria-pressed', 'true')

    // Wissel naar grootte 6 — '2-3-1' bestaat niet in die catalogus, dus moet vervallen.
    fireEvent.change(sizeSelect, { target: { value: '6' } })
    const expected6 = formatiesVoorTeam({ grootte: 6, keeperInGrootte: true }, 'partijen_groot').map((f) => f.label)
    expect(expected6).not.toContain('2-3-1')
    const group = screen.getByRole('group', { name: nl.oefeningen.formation })
    within(group).getAllByRole('button').forEach((b) => {
      expect(b).toHaveAttribute('aria-pressed', 'false')
    })
  })

  it('categoriewissel (oefening-breed) filtert de selectie van ALLE teamrijen tegelijk', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    const sizeSelects = screen.getAllByLabelText(nl.oefeningen.teamSize)
    fireEvent.change(sizeSelects[0], { target: { value: '7' } })
    fireEvent.change(sizeSelects[1], { target: { value: '7' } })

    const groups = screen.getAllByRole('group', { name: nl.oefeningen.formation })
    // '1-5' bestaat alleen bij categorie 'overig' (lege linie toegestaan), niet bij 'partijen_groot'.
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'overig' } })
    fireEvent.click(within(groups[0]).getByRole('button', { name: '1-5' }))
    fireEvent.click(within(groups[1]).getByRole('button', { name: '1-5' }))
    expect(within(groups[0]).getByRole('button', { name: '1-5' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(groups[1]).getByRole('button', { name: '1-5' })).toHaveAttribute('aria-pressed', 'true')

    // Terug naar 'partijen_groot': '1-5' bestaat daar niet (2 gevulde linies), dus beide rijen vervallen stilzwijgend.
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'partijen_groot' } })
    within(groups[0]).getAllByRole('button').forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'false'))
    within(groups[1]).getAllByRole('button').forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'false'))
  })

  it('categorie "partijen_groot" toont alleen formaties met 3 gevulde linies; categorie "overig" toont ook formaties met een lege linie', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '7' } })

    let group = screen.getByRole('group', { name: nl.oefeningen.formation })
    let labels = within(group).getAllByRole('button').map((b) => b.textContent)
    expect(labels.every((l) => (l ?? '').split('-').length === 3)).toBe(true)

    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'overig' } })
    group = screen.getByRole('group', { name: nl.oefeningen.formation })
    labels = within(group).getAllByRole('button').map((b) => b.textContent)
    expect(labels.some((l) => (l ?? '').split('-').length === 2)).toBe(true)
  })

  it('keeper-schakelaar per team: wijzigen van team A raakt team B niet, en is verborgen bij een 11-tal', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    const sizeSelects = screen.getAllByLabelText(nl.oefeningen.teamSize)
    fireEvent.change(sizeSelects[0], { target: { value: '4' } })
    fireEvent.change(sizeSelects[1], { target: { value: '4' } })

    const keeperGroups = screen.getAllByRole('group', { name: nl.oefeningen.keeperLabel })
    expect(keeperGroups).toHaveLength(2)
    // Default: inclusief keeper.
    expect(within(keeperGroups[0]).getByRole('button', { name: nl.oefeningen.keeperIncluded })).toHaveAttribute('aria-pressed', 'true')
    expect(within(keeperGroups[1]).getByRole('button', { name: nl.oefeningen.keeperIncluded })).toHaveAttribute('aria-pressed', 'true')

    // Selecteer een formatie op team 1 (grootte 4, inclusief keeper, partijen_groot → precies 1 optie: '1-1-1').
    const formationGroups = screen.getAllByRole('group', { name: nl.oefeningen.formation })
    fireEvent.click(within(formationGroups[0]).getByRole('button', { name: '1-1-1' }))
    expect(within(formationGroups[0]).getByRole('button', { name: '1-1-1' })).toHaveAttribute('aria-pressed', 'true')

    // Team 2 wisselen naar exclusief keeper raakt team 1 niet.
    fireEvent.click(within(keeperGroups[1]).getByRole('button', { name: nl.oefeningen.keeperExcluded }))
    expect(within(keeperGroups[1]).getByRole('button', { name: nl.oefeningen.keeperExcluded })).toHaveAttribute('aria-pressed', 'true')
    expect(within(keeperGroups[0]).getByRole('button', { name: nl.oefeningen.keeperIncluded })).toHaveAttribute('aria-pressed', 'true')
    expect(within(formationGroups[0]).getByRole('button', { name: '1-1-1' })).toHaveAttribute('aria-pressed', 'true')

    // Bij een 11-tal wordt de keeper-schakelaar niet getoond.
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[2], { target: { value: '11' } })
    expect(screen.getAllByRole('group', { name: nl.oefeningen.keeperLabel })).toHaveLength(2)
  })

  it('keeper-schakelaar wisselen filtert de bestaande selectie van díe rij (isFormatieGeldigVoorTeam)', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '4' } })

    const formationGroup = screen.getByRole('group', { name: nl.oefeningen.formation })
    fireEvent.click(within(formationGroup).getByRole('button', { name: '1-1-1' }))
    expect(within(formationGroup).getByRole('button', { name: '1-1-1' })).toHaveAttribute('aria-pressed', 'true')

    const keeperGroup = screen.getByRole('group', { name: nl.oefeningen.keeperLabel })
    fireEvent.click(within(keeperGroup).getByRole('button', { name: nl.oefeningen.keeperExcluded }))

    // '1-1-1' bestaat niet in de exclusief-keeper-catalogus van grootte 4 (dat is '1-1-2'/'1-2-1'/'2-1-1').
    const expectedExcl = formatiesVoorTeam({ grootte: 4, keeperInGrootte: false }, 'partijen_groot').map((f) => f.label)
    expect(expectedExcl).not.toContain('1-1-1')
    const groupAfter = screen.getByRole('group', { name: nl.oefeningen.formation })
    within(groupAfter).getAllByRole('button').forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'false'))
  })

  it('teamgrootte 3 + partijen_groot + inclusief keeper (lege catalogus, AC18): geen formatie-opties, disabled-staat i.p.v. een lege chip-groep', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '3' } })

    expect(formatiesVoorTeam({ grootte: 3, keeperInGrootte: true }, 'partijen_groot')).toHaveLength(0)
    expect(screen.queryByRole('group', { name: nl.oefeningen.formation })).not.toBeInTheDocument()
    expect(screen.getByTestId('geen-formaties-0')).toHaveTextContent(nl.oefeningen.noFormationsAvailable)

    // Exclusief keeper geeft wél opties (bv. '1-1-1').
    const keeperGroup = screen.getByRole('group', { name: nl.oefeningen.keeperLabel })
    fireEvent.click(within(keeperGroup).getByRole('button', { name: nl.oefeningen.keeperExcluded }))
    expect(screen.getByRole('group', { name: nl.oefeningen.formation })).toBeInTheDocument()
  })

  it('teamgrootte 10 is nu gewoon bruikbaar (toont formatie-opties)', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '10' } })

    const group = screen.getByRole('group', { name: nl.oefeningen.formation })
    expect(within(group).getAllByRole('button').length).toBeGreaterThan(0)
  })

  it('geen teamgrootte gekozen → geen formatie-chips en geen keeper-schakelaar zichtbaar', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))

    expect(screen.queryByRole('group', { name: nl.oefeningen.formation })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: nl.oefeningen.keeperLabel })).not.toBeInTheDocument()
  })

  it('nieuw team start met een lege formaties-selectie (niets auto-geselecteerd) en inclusief keeper', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '7' } })

    const group = screen.getByRole('group', { name: nl.oefeningen.formation })
    within(group).getAllByRole('button').forEach((b) => {
      expect(b).toHaveAttribute('aria-pressed', 'false')
    })
    const keeperGroup = screen.getByRole('group', { name: nl.oefeningen.keeperLabel })
    expect(within(keeperGroup).getByRole('button', { name: nl.oefeningen.keeperIncluded })).toHaveAttribute('aria-pressed', 'true')
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

    const groups = screen.getAllByRole('group', { name: nl.oefeningen.formation })
    fireEvent.click(within(groups[0]).getByRole('button', { name: '1-1-1' }))
    fireEvent.click(within(groups[1]).getByRole('button', { name: '1-1-3' }))
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
    expect(onSubmit.mock.calls[0][0].teams).toEqual([{ grootte: 5, formaties: [], keeperInGrootte: true }])
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
