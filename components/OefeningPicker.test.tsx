import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import type { OefeningCategorie } from '@/lib/types'
import { nl, type Dict } from '@/messages/nl'
import { en } from '@/messages/en'
import type { Oefening } from '@/lib/types'
import OefeningPicker from '@/components/OefeningPicker'

vi.mock('@/app/actions/training-plan', () => ({
  addOefeningToTraining: vi.fn().mockResolvedValue(undefined),
  createAndAddOefening: vi.fn(),
}))

// Verplichte mock voor de nieuwe inline-bewerken-feature (zoals
// OefeningLibrary.test.tsx:7-11).
vi.mock('@/app/actions/oefening-library', () => ({
  createOefening: vi.fn(),
  updateOefening: vi.fn().mockResolvedValue(undefined),
  deleteOefening: vi.fn(),
}))

import { addOefeningToTraining } from '@/app/actions/training-plan'
import { updateOefening } from '@/app/actions/oefening-library'
const mockUpdateOefening = updateOefening as unknown as ReturnType<typeof vi.fn>

function makeOefening(overrides: Partial<Oefening> = {}): Oefening {
  return {
    id: 'o1',
    team_id: 'team-1',
    naam: 'Rondo',
    beschrijving: null,
    categorie: 'partijen_klein',
    duur_min: 10,
    breedte_m: null,
    lengte_m: null,
    orientatie: 'vrij',
    veldzone: null,
    teams: [],
    aantal_neutralen: 0,
    diagram: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderPicker(
  library: Oefening[],
  onClose = vi.fn(),
  presetCategorie?: OefeningCategorie,
  aanwezigAantal = 0,
  dict: Dict = nl,
) {
  render(
    <DictProvider dict={dict}>
      <OefeningPicker
        eventId="event-1"
        library={library}
        onClose={onClose}
        presetCategorie={presetCategorie}
        aanwezigAantal={aanwezigAantal}
      />
    </DictProvider>,
  )
  return { onClose }
}

describe('OefeningPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('toont alle bibliotheek-oefeningen zonder actieve filters', () => {
    renderPicker([
      makeOefening({ id: 'o1', naam: 'Rondo' }),
      makeOefening({ id: 'o2', naam: 'Balbezitoefening', categorie: 'positiespel' }),
    ])
    expect(screen.getByText('Rondo')).toBeInTheDocument()
    expect(screen.getByText('Balbezitoefening')).toBeInTheDocument()
  })

  it('categorie-select op één waarde toont alleen matches', () => {
    renderPicker([
      makeOefening({ id: 'o1', naam: 'Rondo', categorie: 'partijen_klein' }),
      makeOefening({ id: 'o2', naam: 'Balbezitoefening', categorie: 'positiespel' }),
    ])
    fireEvent.change(screen.getByLabelText(nl.oefeningen.filterCategoryLabel), { target: { value: 'positiespel' } })
    expect(screen.queryByText('Rondo')).not.toBeInTheDocument()
    expect(screen.getByText('Balbezitoefening')).toBeInTheDocument()
  })

  it('veldzone-select toont alleen matches', () => {
    renderPicker([
      makeOefening({ id: 'o1', naam: 'Links oefenen', veldzone: 'links' }),
      makeOefening({ id: 'o2', naam: 'Rechts oefenen', veldzone: 'rechts' }),
    ])
    fireEvent.change(screen.getByLabelText(nl.oefeningen.filterZoneLabel), { target: { value: 'rechts' } })
    expect(screen.queryByText('Links oefenen')).not.toBeInTheDocument()
    expect(screen.getByText('Rechts oefenen')).toBeInTheDocument()
  })

  it('aantallen min/max tonen alleen oefeningen binnen bereik, grenzen inclusief', () => {
    renderPicker([
      makeOefening({ id: 'o1', naam: 'Kleine oefening', teams: [{ grootte: 2, formaties: [] }], aantal_neutralen: 0 }), // 2
      makeOefening({ id: 'o2', naam: 'Middelgrote oefening', teams: [{ grootte: 4, formaties: [] }], aantal_neutralen: 0 }), // 4
      makeOefening({ id: 'o3', naam: 'Grote oefening', teams: [{ grootte: 8, formaties: [] }], aantal_neutralen: 0 }), // 8
    ])
    const minLabel = `${nl.oefeningen.filterCountLabel} ${nl.oefeningen.filterMinPlaceholder}`
    const maxLabel = `${nl.oefeningen.filterCountLabel} ${nl.oefeningen.filterMaxPlaceholder}`
    fireEvent.change(screen.getByLabelText(minLabel), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(maxLabel), { target: { value: '4' } })
    expect(screen.getByText('Kleine oefening')).toBeInTheDocument()
    expect(screen.getByText('Middelgrote oefening')).toBeInTheDocument()
    expect(screen.queryByText('Grote oefening')).not.toBeInTheDocument()
  })

  it('duur min/max tonen alleen oefeningen binnen bereik, grenzen inclusief', () => {
    renderPicker([
      makeOefening({ id: 'o1', naam: 'Korte oefening', duur_min: 5 }),
      makeOefening({ id: 'o2', naam: 'Middellange oefening', duur_min: 10 }),
      makeOefening({ id: 'o3', naam: 'Lange oefening', duur_min: 20 }),
    ])
    const minLabel = `${nl.oefeningen.filterDurationLabel} ${nl.oefeningen.filterMinPlaceholder}`
    const maxLabel = `${nl.oefeningen.filterDurationLabel} ${nl.oefeningen.filterMaxPlaceholder}`
    fireEvent.change(screen.getByLabelText(minLabel), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText(maxLabel), { target: { value: '10' } })
    expect(screen.getByText('Korte oefening')).toBeInTheDocument()
    expect(screen.getByText('Middellange oefening')).toBeInTheDocument()
    expect(screen.queryByText('Lange oefening')).not.toBeInTheDocument()
  })

  it('categorie + duur samen tonen alleen de doorsnede (AND)', () => {
    renderPicker([
      makeOefening({ id: 'o1', naam: 'Match', categorie: 'positiespel', duur_min: 10 }),
      makeOefening({ id: 'o2', naam: 'Verkeerde categorie', categorie: 'partijen_klein', duur_min: 10 }),
      makeOefening({ id: 'o3', naam: 'Verkeerde duur', categorie: 'positiespel', duur_min: 30 }),
    ])
    fireEvent.change(screen.getByLabelText(nl.oefeningen.filterCategoryLabel), { target: { value: 'positiespel' } })
    const maxLabel = `${nl.oefeningen.filterDurationLabel} ${nl.oefeningen.filterMaxPlaceholder}`
    fireEvent.change(screen.getByLabelText(maxLabel), { target: { value: '15' } })
    expect(screen.getByText('Match')).toBeInTheDocument()
    expect(screen.queryByText('Verkeerde categorie')).not.toBeInTheDocument()
    expect(screen.queryByText('Verkeerde duur')).not.toBeInTheDocument()
  })

  it('zoekbalk + categorie samen tonen alleen de doorsnede (AND)', () => {
    renderPicker([
      makeOefening({ id: 'o1', naam: 'Rondo groot', categorie: 'positiespel' }),
      makeOefening({ id: 'o2', naam: 'Rondo klein', categorie: 'partijen_klein' }),
      makeOefening({ id: 'o3', naam: 'Positiespel apart', categorie: 'positiespel' }),
    ])
    fireEvent.change(screen.getByPlaceholderText(nl.oefeningen.pickerSearchPlaceholder), { target: { value: 'rondo' } })
    fireEvent.change(screen.getByLabelText(nl.oefeningen.filterCategoryLabel), { target: { value: 'positiespel' } })
    expect(screen.getByText('Rondo groot')).toBeInTheDocument()
    expect(screen.queryByText('Rondo klein')).not.toBeInTheDocument()
    expect(screen.queryByText('Positiespel apart')).not.toBeInTheDocument()
  })

  it('filter terugzetten naar "alle"/leeg geeft de volledige lijst terug', () => {
    renderPicker([
      makeOefening({ id: 'o1', naam: 'Rondo', categorie: 'partijen_klein' }),
      makeOefening({ id: 'o2', naam: 'Balbezitoefening', categorie: 'positiespel' }),
    ])
    const select = screen.getByLabelText(nl.oefeningen.filterCategoryLabel)
    fireEvent.change(select, { target: { value: 'positiespel' } })
    expect(screen.queryByText('Rondo')).not.toBeInTheDocument()
    fireEvent.change(select, { target: { value: '' } })
    expect(screen.getByText('Rondo')).toBeInTheDocument()
    expect(screen.getByText('Balbezitoefening')).toBeInTheDocument()
  })

  it('klik op een kaart roept addOefeningToTraining aan en houdt de picker OPEN (meerdere achter elkaar toevoegen)', async () => {
    const { onClose } = renderPicker([makeOefening({ id: 'o1', naam: 'Rondo' })])
    fireEvent.click(screen.getByText('Rondo'))
    await waitFor(() => expect(addOefeningToTraining).toHaveBeenCalledWith('event-1', 'o1'))
    // GEWIJZIGD GEDRAG (bewust): toevoegen sloot de sheet, waardoor je hem voor
    // elke oefening van een training opnieuw moest openen én opnieuw filteren.
    // De sheet blijft nu staan; sluiten doet de gebruiker zelf.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Rondo')).toBeInTheDocument()
  })

  it('de sluitknop onderaan sluit de sheet en toont hoeveel er is toegevoegd', async () => {
    const { onClose } = renderPicker([makeOefening({ id: 'o1', naam: 'Rondo' })])
    // Vóór het toevoegen: kale "Klaar".
    expect(screen.getByText(nl.oefeningen.pickerDone)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Rondo'))
    await waitFor(() => expect(addOefeningToTraining).toHaveBeenCalled())
    const klaar = await screen.findByText(nl.oefeningen.pickerDoneCount.replace('{n}', '1'))
    fireEvent.click(klaar)
    expect(onClose).toHaveBeenCalled()
  })

  // ────────────────────────────────────────────────────────────────
  // Periodiseringssuggestie ("+ Voeg toe" op de trainingsplanner).
  //
  // GEWIJZIGD GEDRAG (bewust): een suggestie opende hiervóór meteen het
  // "nieuwe oefening"-formulier. Dat duwde je naar iets nieuws maken terwijl
  // je die categorie waarschijnlijk allang in je bibliotheek hebt — in een
  // tweede seizoen is opnieuw intypen precies het verkeerde antwoord. De
  // suggestie opent nu de bibliotheek, voorgefilterd op die categorie.
  // ────────────────────────────────────────────────────────────────
  it('een suggestie opent de bibliotheek voorgefilterd op die categorie, niet het nieuwe-oefening-formulier', () => {
    renderPicker(
      [
        makeOefening({ id: 'o1', naam: 'Rondo', categorie: 'positiespel' }),
        makeOefening({ id: 'o2', naam: 'Sprintserie', categorie: 'sprints_veel_rust' }),
      ],
      vi.fn(),
      'sprints_veel_rust',
    )
    // De lijst staat er (niet het formulier)...
    expect(screen.getByText(nl.oefeningen.pickerTitle)).toBeInTheDocument()
    expect(screen.queryByLabelText(`${nl.trainingPlan.exerciseName} *`)).toBeNull()
    // ...met het categoriefilter al gezet...
    expect((screen.getByLabelText(nl.oefeningen.filterCategoryLabel) as HTMLSelectElement).value).toBe('sprints_veel_rust')
    // ...en dus alleen de passende oefening.
    expect(screen.getByText('Sprintserie')).toBeInTheDocument()
    expect(screen.queryByText('Rondo')).toBeNull()
    // Nieuw maken blijft één klik weg, als tweede keuze.
    expect(screen.getByText(nl.oefeningen.pickerCreateNew)).toBeInTheDocument()
  })

  it('annuleren in het nieuwe-oefening-formulier gaat terug naar de lijst, ook bij een suggestie', () => {
    const { onClose } = renderPicker([makeOefening({ id: 'o1', naam: 'Rondo' })], vi.fn(), 'sprints_veel_rust')
    fireEvent.click(screen.getByText(nl.oefeningen.pickerCreateNew))
    expect(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`)).toBeInTheDocument()
    fireEvent.click(screen.getByText(nl.trainingPlan.cancel))
    // Terug in de lijst — annuleren betekent "toch geen nieuwe maken", niet
    // "laat de hele training met rust".
    expect(screen.getByText(nl.oefeningen.pickerTitle)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('filters zonder match bij gevulde bibliotheek tonen pickerEmpty, niet pickerEmptyLibrary', () => {
    renderPicker([makeOefening({ id: 'o1', naam: 'Rondo', categorie: 'partijen_klein' })])
    fireEvent.change(screen.getByLabelText(nl.oefeningen.filterCategoryLabel), { target: { value: 'positiespel' } })
    expect(screen.getByText(nl.oefeningen.pickerEmpty)).toBeInTheDocument()
    expect(screen.queryByText(nl.oefeningen.pickerEmptyLibrary)).not.toBeInTheDocument()
  })

  it('library={[]} toont pickerEmptyLibrary, ook met een ingevuld filter', () => {
    renderPicker([])
    fireEvent.change(screen.getByLabelText(nl.oefeningen.filterCategoryLabel), { target: { value: 'positiespel' } })
    expect(screen.getByText(nl.oefeningen.pickerEmptyLibrary)).toBeInTheDocument()
  })

  it('aantalMin > aantalMax geeft een lege lijst met pickerEmpty, geen foutmelding-element', () => {
    renderPicker([makeOefening({ id: 'o1', naam: 'Rondo', teams: [{ grootte: 4, formaties: [] }] })])
    const minLabel = `${nl.oefeningen.filterCountLabel} ${nl.oefeningen.filterMinPlaceholder}`
    const maxLabel = `${nl.oefeningen.filterCountLabel} ${nl.oefeningen.filterMaxPlaceholder}`
    fireEvent.change(screen.getByLabelText(minLabel), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText(maxLabel), { target: { value: '2' } })
    expect(screen.getByText(nl.oefeningen.pickerEmpty)).toBeInTheDocument()
    expect(screen.queryByText(nl.oefeningen.genericError)).not.toBeInTheDocument()
  })

  it('oefening met veldzone: null verdwijnt zodra veldzonefilter actief wordt', () => {
    renderPicker([makeOefening({ id: 'o1', naam: 'Zonder zone', veldzone: null })])
    fireEvent.change(screen.getByLabelText(nl.oefeningen.filterZoneLabel), { target: { value: 'links' } })
    expect(screen.queryByText('Zonder zone')).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.pickerEmpty)).toBeInTheDocument()
  })

  it('oefening met duur_min: null verdwijnt zodra duurgrens ingevuld wordt', () => {
    renderPicker([makeOefening({ id: 'o1', naam: 'Zonder duur', duur_min: null })])
    const minLabel = `${nl.oefeningen.filterDurationLabel} ${nl.oefeningen.filterMinPlaceholder}`
    fireEvent.change(screen.getByLabelText(minLabel), { target: { value: '0' } })
    expect(screen.queryByText('Zonder duur')).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.pickerEmpty)).toBeInTheDocument()
  })

  it('categorie-select bevat exact de vaste categorieën + "alle"-optie, geen vrije tekst', () => {
    renderPicker([makeOefening()])
    const select = screen.getByLabelText(nl.oefeningen.filterCategoryLabel) as HTMLSelectElement
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toEqual([
      '',
      'warming_up',
      'partijen_groot', 'partijen_midden', 'partijen_klein',
      'positiespel', 'pass_trap',
      'sprints_weinig_rust', 'sprints_veel_rust', 'steigerungs', 'overig',
    ])
  })

  it('veldzone-select bevat exact de vaste zones + "alle"-optie, geen vrije tekst', () => {
    renderPicker([makeOefening()])
    const select = screen.getByLabelText(nl.oefeningen.filterZoneLabel) as HTMLSelectElement
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toEqual([
      '', 'links', 'midden', 'rechts', 'strafschopgebied_links', 'strafschopgebied_rechts',
    ])
  })

  // ────────────────────────────────────────────────────────────────
  // "Past bij aanwezigen"-chip (eigenaarsbesluiten 3/4): verborgen bij N=0,
  // filtert op interval-bevat-N zodra actief, sortering exact-eerst/smalst-
  // eerst, en de vorm-badge op de rij bij een flexibele oefening.
  // ────────────────────────────────────────────────────────────────
  it('N=0: de "past bij aanwezigen"-chip wordt niet gerenderd', () => {
    renderPicker([makeOefening()], vi.fn(), undefined, 0)
    expect(screen.queryByText(/Past bij aanwezigen/)).not.toBeInTheDocument()
  })

  it('N>=1: de chip verschijnt, toggelt aria-pressed en filtert op bereik-bevat-N', () => {
    renderPicker(
      [
        makeOefening({ id: 'o1', naam: 'Exact 6', teams: [{ grootte: 6, formaties: [] }] }),
        makeOefening({ id: 'o2', naam: 'Flexibel 4-6', teams: [{ grootte: 4, formaties: [], grootteMax: 6 }] }),
        makeOefening({ id: 'o3', naam: 'Exact 10', teams: [{ grootte: 10, formaties: [] }] }),
      ],
      vi.fn(),
      undefined,
      5,
    )
    const chip = screen.getByText(nl.oefeningen.fitsPresentChip.replace('{n}', '5'))
    expect(chip).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Exact 6')).not.toBeInTheDocument()
    expect(screen.getByText('Flexibel 4-6')).toBeInTheDocument()
    expect(screen.queryByText('Exact 10')).not.toBeInTheDocument()

    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Exact 6')).toBeInTheDocument()
  })

  it('sortering: exacte oefeningen vóór flexibele, en binnen de flexibele het smalste bereik eerst', () => {
    renderPicker([
      makeOefening({ id: 'o1', naam: 'Breed bereik', teams: [{ grootte: 4, formaties: [], grootteMax: 10 }] }),
      makeOefening({ id: 'o2', naam: 'Exact', teams: [{ grootte: 6, formaties: [] }] }),
      makeOefening({ id: 'o3', naam: 'Smal bereik', teams: [{ grootte: 5, formaties: [], grootteMax: 6 }] }),
    ])
    // Filtert de potlood-knoppen (aria-label "Oefening bewerken: …") eruit:
    // die matchen de naam-regex ook, maar hebben zelf geen aria-label-vrije
    // toevoeg-tekst.
    const namen = screen
      .getAllByRole('button', { name: /Breed bereik|Exact|Smal bereik/ })
      .filter((el) => !el.hasAttribute('aria-label'))
      .map((el) => el.textContent)
    expect(namen[0]).toContain('Exact')
    expect(namen[1]).toContain('Smal bereik')
    expect(namen[2]).toContain('Breed bereik')
  })

  it('vorm-badge "4v2–6v2" op de rij bij een flexibele oefening, geen badge bij een exacte oefening', () => {
    renderPicker([
      makeOefening({ id: 'o1', naam: 'Flexibel', teams: [{ grootte: 4, formaties: [], grootteMax: 6 }, { grootte: 2, formaties: [] }] }),
      makeOefening({ id: 'o2', naam: 'Exact', teams: [{ grootte: 4, formaties: [] }] }),
    ])
    expect(screen.getByText('4v2–6v2')).toBeInTheDocument()
    const exactRow = screen.getByText('Exact').closest('button')!
    expect(exactRow.textContent).not.toMatch(/–/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Oefening bewerken vanaf de picker-rij (AC3, AC4, AC8, AC10). Zelfde
// bewerkformulier (OefeningEditor) en server action (updateOefening) als de
// trainingskaart — hier het tweede NIEUWE aanroeppunt.
// ────────────────────────────────────────────────────────────────────────────
describe('OefeningPicker — oefening bewerken vanaf een rij', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('AC3/AC4: potlood opent de editor (pickerTitle weg, vooringevuld), opslaan sluit hem en de verse library-prop toont de nieuwe naam', async () => {
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo' })
    const { rerender } = render(
      <DictProvider dict={nl}>
        <OefeningPicker eventId="event-1" library={[oefening]} onClose={vi.fn()} aanwezigAantal={0} />
      </DictProvider>,
    )

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    expect(screen.queryByText(nl.oefeningen.pickerTitle)).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
    expect(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`)).toHaveValue('Rondo')

    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Rondo bijgewerkt' } })
    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() => expect(mockUpdateOefening).toHaveBeenCalledWith('o1', expect.objectContaining({ naam: 'Rondo bijgewerkt' })))
    await waitFor(() => expect(screen.getByText(nl.oefeningen.pickerTitle)).toBeInTheDocument())

    // Server revalideert; de parent (TrainingPlanEditor) geeft een verse
    // `library`-prop door — de picker blijft gemount (showPicker is
    // parent-state) en toont meteen de nieuwe naam.
    rerender(
      <DictProvider dict={nl}>
        <OefeningPicker eventId="event-1" library={[{ ...oefening, naam: 'Rondo bijgewerkt' }]} onClose={vi.fn()} aanwezigAantal={0} />
      </DictProvider>,
    )
    expect(screen.getByText('Rondo bijgewerkt')).toBeInTheDocument()
  })

  it('AC10: klik op de rij (toevoegen) roept addOefeningToTraining aan, niet updateOefening', () => {
    renderPicker([makeOefening({ id: 'o1', naam: 'Rondo' })])
    fireEvent.click(screen.getByText('Rondo'))
    expect(addOefeningToTraining).toHaveBeenCalledWith('event-1', 'o1')
    expect(mockUpdateOefening).not.toHaveBeenCalled()
  })

  it('AC10: klik op het potlood opent de editor en roept addOefeningToTraining niet aan', () => {
    renderPicker([makeOefening({ id: 'o1', naam: 'Rondo' })])
    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    expect(addOefeningToTraining).not.toHaveBeenCalled()
    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
  })

  it('AC10 structuurcontract: geen <button> genest in een <button> (rij is een wrapper-div met twee zusterknoppen)', () => {
    const { container } = render(
      <DictProvider dict={nl}>
        <OefeningPicker eventId="event-1" library={[makeOefening({ id: 'o1', naam: 'Rondo' })]} onClose={vi.fn()} aanwezigAantal={0} />
      </DictProvider>,
    )
    expect(container.querySelectorAll('button button').length).toBe(0)
  })

  it('AC8: annuleren in de bewerk-editor gaat terug naar de lijst met de filters nog intact', () => {
    renderPicker([
      makeOefening({ id: 'o1', naam: 'Rondo', categorie: 'partijen_klein' }),
      makeOefening({ id: 'o2', naam: 'Positiespel', categorie: 'positiespel' }),
    ])
    fireEvent.change(screen.getByLabelText(nl.oefeningen.filterCategoryLabel), { target: { value: 'partijen_klein' } })
    // Alleen het categorie-select-optie-element "Positiespel" blijft over
    // (t.periodization.categories); de rij zelf is uitgefilterd.
    expect(screen.queryByRole('option', { name: 'Positiespel' })).toBeInTheDocument()
    expect(screen.queryByText('Rondo')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    fireEvent.click(screen.getByText(nl.trainingPlan.cancel))

    expect(screen.getByText(nl.oefeningen.pickerTitle)).toBeInTheDocument()
    expect((screen.getByLabelText(nl.oefeningen.filterCategoryLabel) as HTMLSelectElement).value).toBe('partijen_klein')
    // De uitgefilterde rij "Positiespel" toont geen eigen bewerk-potlood —
    // het filter is dus behouden na annuleren.
    expect(screen.queryByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Positiespel'))).not.toBeInTheDocument()
    expect(mockUpdateOefening).not.toHaveBeenCalled()
  })

  it('geen geneste modals: bewerken toont nooit tegelijk pickerTitle, en de editor toont editTitle (niet newTitle)', () => {
    renderPicker([makeOefening({ id: 'o1', naam: 'Rondo' })])
    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    expect(screen.queryByText(nl.oefeningen.pickerTitle)).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
    expect(screen.queryByText(nl.oefeningen.newTitle)).not.toBeInTheDocument()
  })

  it('meertaligheid: potlood-aria-label en editor-titel/-hint gebruiken de Engelse dictionary', () => {
    renderPicker([makeOefening({ id: 'o1', naam: 'Rondo' })], vi.fn(), undefined, 0, en)
    fireEvent.click(screen.getByLabelText(en.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    expect(screen.getByText(en.oefeningen.editTitle)).toBeInTheDocument()
    expect(screen.getByText(en.oefeningen.editSharedHint)).toBeInTheDocument()
  })

  it('meerdere potloden: elke rij heeft een eigen aria-label en opent de juiste oefening', () => {
    renderPicker([
      makeOefening({ id: 'o1', naam: 'Oefening A' }),
      makeOefening({ id: 'o2', naam: 'Oefening B' }),
    ])
    const potloden = screen.getAllByLabelText(/Oefening bewerken: /)
    expect(potloden).toHaveLength(2)

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Oefening B')))
    expect(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`)).toHaveValue('Oefening B')
  })
})
