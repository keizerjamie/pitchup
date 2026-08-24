import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import type { OefeningCategorie } from '@/lib/types'
import { nl } from '@/messages/nl'
import type { Oefening } from '@/lib/types'
import OefeningPicker from '@/components/OefeningPicker'

vi.mock('@/app/actions/training-plan', () => ({
  addOefeningToTraining: vi.fn().mockResolvedValue(undefined),
  createAndAddOefening: vi.fn(),
}))

import { addOefeningToTraining } from '@/app/actions/training-plan'

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

function renderPicker(library: Oefening[], onClose = vi.fn(), presetCategorie?: OefeningCategorie) {
  render(
    <DictProvider dict={nl}>
      <OefeningPicker eventId="event-1" library={library} onClose={onClose} presetCategorie={presetCategorie} />
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
})
