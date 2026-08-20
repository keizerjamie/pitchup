import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import type { Oefening, OefeningCategorie, Player, TrainingOefeningWithData } from '@/lib/types'

vi.mock('@/app/actions/training-plan', () => ({
  saveDoelstelling: vi.fn().mockResolvedValue(undefined),
  removeOefeningFromTraining: vi.fn().mockResolvedValue(undefined),
  updateKoppeling: vi.fn().mockResolvedValue(undefined),
  reorderKoppelingen: vi.fn().mockResolvedValue(undefined),
  saveSpelerindeling: vi.fn(),
  addOefeningToTraining: vi.fn().mockResolvedValue(undefined),
  createAndAddOefening: vi.fn().mockResolvedValue(undefined),
  vormParallelGroep: vi.fn().mockResolvedValue({ groepId: 'g-new' }),
  voegToeAanParallelGroep: vi.fn().mockResolvedValue(undefined),
  haalUitParallelGroep: vi.fn().mockResolvedValue(undefined),
  saveParallelIndeling: vi.fn().mockResolvedValue(undefined),
}))

import { saveSpelerindeling, updateKoppeling, reorderKoppelingen, vormParallelGroep, voegToeAanParallelGroep, haalUitParallelGroep } from '@/app/actions/training-plan'
const mockSave = saveSpelerindeling as unknown as ReturnType<typeof vi.fn>
const mockUpdateKoppeling = updateKoppeling as unknown as ReturnType<typeof vi.fn>
const mockReorder = reorderKoppelingen as unknown as ReturnType<typeof vi.fn>
const mockVormGroep = vormParallelGroep as unknown as ReturnType<typeof vi.fn>
const mockVoegToe = voegToeAanParallelGroep as unknown as ReturnType<typeof vi.fn>
const mockHaalUit = haalUitParallelGroep as unknown as ReturnType<typeof vi.fn>

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Piet Peters',
    position: 'Spits',
    secondary_positions: [],
    jersey_number: 9,
    active: true,
    injured: false,
    type: 'regular',
    rating: 5,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const players: Player[] = [makePlayer({ id: 'p1', name: 'Piet Peters', jersey_number: 1 })]

function makeKoppeling(overrides: Partial<TrainingOefeningWithData> = {}): TrainingOefeningWithData {
  return {
    id: 'k1',
    team_id: 'team1',
    event_id: 'e1',
    oefening_id: 'o1',
    volgorde: 0,
    stap_override: null,
    genest_in: null,
    // Simuleert een niet-gemigreerde `spelerindeling`-kolom: server levert
    // `undefined` op i.p.v. een array (zie TrainingPlanEditor.tsx `?? EMPTY_INDELING`).
    spelerindeling: undefined as unknown as string[][],
    created_at: '2024-01-01T00:00:00Z',
    oefeningen: {
      id: 'o1',
      team_id: 'team1',
      naam: 'Positiespel',
      beschrijving: null,
      categorie: 'positiespel',
      duur_min: 10,
      breedte_m: null,
      lengte_m: null,
      orientatie: 'vrij',
      veldzone: null,
      teams: [{ grootte: 1, formaties: [] }],
      aantal_neutralen: 0,
      diagram: null,
      created_at: '2024-01-01T00:00:00Z',
    },
    ...overrides,
  }
}

function renderPlan(koppelingen: TrainingOefeningWithData[]) {
  return render(
    <DictProvider dict={nl}>
      <TrainingPlanEditor
        eventId="e1"
        initialDoelstelling={null}
        initialOefeningen={koppelingen}
        library={[]}
        currentSteps={{}}
        hasNulmeting={false}
        suggestion={null}
        players={players}
        presentPlayerIds={['p1']}
      />
    </DictProvider>,
  )
}

describe('TrainingPlanEditor — stabiele fallback voor ontbrekende spelerindeling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('een re-render van de parent (bv. doelstelling typen) laat een actief foutbanner in TeamIndelingEditor niet voortijdig verdwijnen', async () => {
    mockSave.mockRejectedValueOnce(new Error('boom'))
    renderPlan([makeKoppeling()])

    // Trigger een save die faalt, zodat het foutbanner verschijnt.
    fireEvent.click(screen.getByRole('button', { name: /Piet/ }))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 1')))

    await waitFor(() => expect(screen.getByText(nl.teamIndeling.saveError)).toBeInTheDocument())

    // Trigger een re-render van TrainingPlanEditor die niets met de
    // spelerindeling te maken heeft (doelstelling typen). Zonder de stabiele
    // `EMPTY_INDELING`-fallback zou dit een nieuwe array-identiteit voor
    // `initialIndeling` opleveren, waardoor TeamIndelingEditor onterecht
    // resynct en het foutbanner wegvaagt.
    fireEvent.change(screen.getByPlaceholderText(nl.trainingPlan.objectivePlaceholder), {
      target: { value: 'Nieuw doel' },
    })

    expect(screen.getByText(nl.teamIndeling.saveError)).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Stap-inhoud direct op de kaart (periodisering-stappen, backend-contract
// @/lib/periodization-stappen). Dekt: zichtbaarheid buiten "Bewerken" voor de
// 5 tabel-categorieën + steigerungs, ontbrekende series/rustSeries-kolommen,
// ongewijzigd gedrag voor non-brondata-categorieën, synchrone content-update,
// stille clamp-correctie bij laden, vertaalde steigerungs-tekst en het
// print/scherm-klassencontract (dual markup).
// ────────────────────────────────────────────────────────────────────────────
function makeOefeningFixture(overrides: Partial<Oefening> = {}): Oefening {
  return {
    id: 'o1',
    team_id: 'team1',
    naam: 'Oefening',
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

function makeKoppelingFor(
  categorie: OefeningCategorie,
  stap_override: number | null,
  overrides: Partial<TrainingOefeningWithData> = {},
): TrainingOefeningWithData {
  return {
    id: 'k1',
    team_id: 'team1',
    event_id: 'e1',
    oefening_id: 'o1',
    volgorde: 0,
    stap_override,
    genest_in: null,
    spelerindeling: [],
    created_at: '2024-01-01T00:00:00Z',
    oefeningen: makeOefeningFixture({ categorie }),
    ...overrides,
  }
}

function renderPlanWith(koppeling: TrainingOefeningWithData) {
  return render(
    <DictProvider dict={nl}>
      <TrainingPlanEditor
        eventId="e1"
        initialDoelstelling={null}
        initialOefeningen={[koppeling]}
        library={[]}
        currentSteps={{}}
        hasNulmeting={false}
        suggestion={null}
        players={players}
        presentPlayerIds={['p1']}
      />
    </DictProvider>,
  )
}

// Zelfde klasse-contract-proxy als afdrukken-trainingsplan.acceptance.test.tsx
// ('print:hidden' onvindbaar via jsdom, dus we lopen de voorouderketen af).
function hasPrintHiddenAncestor(el: HTMLElement | null): boolean {
  let node: HTMLElement | null = el
  while (node) {
    if (node.classList.contains('print:hidden')) return true
    node = node.parentElement
  }
  return false
}

describe('Stap-inhoud direct op de kaart (heeftStapInhoud-categorieën)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('partijen_klein: het stapveld is zichtbaar zonder op "Bewerken" te klikken, max-attribuut is 13, en de 5 labels+waarden van stap 1 staan op de kaart', () => {
    renderPlanWith(makeKoppelingFor('partijen_klein', 1))

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveAttribute('max', '13')
    expect((input as HTMLInputElement).value).toBe('1')

    // Geen klik op "Bewerken" nodig: het content-blok staat er al.
    const kaart = screen.getByTestId('stap-inhoud-k1')
    expect(kaart.textContent).toContain(`${nl.periodization.stepWork}: 1 min`)
    expect(kaart.textContent).toContain(`${nl.periodization.stepReps}: 6`)
    expect(kaart.textContent).toContain(`${nl.periodization.stepRestReps}: 3 min`)
    expect(kaart.textContent).toContain(`${nl.periodization.stepSeries}: 2`)
    expect(kaart.textContent).toContain(`${nl.periodization.stepRestSeries}: 4 min`)
  })

  it('sprints_veel_rust: geen "Series"-label (die kolom bestaat niet), wel "Rust series"', () => {
    renderPlanWith(makeKoppelingFor('sprints_veel_rust', 1))
    const kaart = screen.getByTestId('stap-inhoud-k1')
    expect(kaart.textContent).not.toContain(`${nl.periodization.stepSeries}:`)
    expect(kaart.textContent).toContain(`${nl.periodization.stepRestSeries}:`)
  })

  it('partijen_groot: geen "Series"- en geen "Rust series"-label (geen van beide kolommen bestaat)', () => {
    renderPlanWith(makeKoppelingFor('partijen_groot', 1))
    const kaart = screen.getByTestId('stap-inhoud-k1')
    expect(kaart.textContent).not.toContain(`${nl.periodization.stepSeries}:`)
    expect(kaart.textContent).not.toContain(`${nl.periodization.stepRestSeries}:`)
  })

  it('partijen_midden: geen "Series"- en geen "Rust series"-label', () => {
    renderPlanWith(makeKoppelingFor('partijen_midden', 1))
    const kaart = screen.getByTestId('stap-inhoud-k1')
    expect(kaart.textContent).not.toContain(`${nl.periodization.stepSeries}:`)
    expect(kaart.textContent).not.toContain(`${nl.periodization.stepRestSeries}:`)
  })

  it('warming_up: het stapveld staat nog steeds achter "Bewerken" — ongewijzigd gedrag, geen content-blok zichtbaar zonder die klik', () => {
    renderPlanWith(makeKoppelingFor('warming_up', null))

    expect(screen.queryByTestId('stap-inhoud-k1')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(nl.trainingPlan.detailsToggle))
    expect(screen.getByRole('spinbutton')).toBeInTheDocument()
  })

  it('stap-override wijzigen (6 → 9 voor partijen_klein) laat de content SYNCHROON updaten, vóór de server-call resolved', () => {
    mockUpdateKoppeling.mockReturnValueOnce(new Promise(() => {})) // nooit resolvende call
    renderPlanWith(makeKoppelingFor('partijen_klein', 6))

    const kaart = screen.getByTestId('stap-inhoud-k1')
    // Stap 6: arbeid '1,5 min'.
    expect(kaart.textContent).toContain(`${nl.periodization.stepWork}: 1,5 min`)

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '9' } })

    // Stap 9: arbeid '3 min', herhalingen '6' — update al zichtbaar terwijl
    // de (nooit resolvende) server-call nog "hangt".
    expect(kaart.textContent).toContain(`${nl.periodization.stepWork}: 3 min`)
    expect(kaart.textContent).toContain(`${nl.periodization.stepReps}: 6`)
  })

  it('stap_override: 40 bij partijen_klein (boven het echte max 13) toont bij render direct 13 (niet 40) — stille correctie bij laden, geen save-call puur door te renderen', () => {
    renderPlanWith(makeKoppelingFor('partijen_klein', 40))

    const input = screen.getByRole('spinbutton') as HTMLInputElement
    expect(input.value).toBe('13')

    // Stap 13: arbeid '3 min', herhalingen '10'.
    const kaart = screen.getByTestId('stap-inhoud-k1')
    expect(kaart.textContent).toContain(`${nl.periodization.stepWork}: 3 min`)
    expect(kaart.textContent).toContain(`${nl.periodization.stepReps}: 10`)

    // Puur renderen mag geen server-call triggeren.
    expect(mockUpdateKoppeling).not.toHaveBeenCalled()
  })

  it('steigerungs met een ingevulde override toont de vertaalde tekst uit t.periodization.steigerungsSteps, niet een hardgecodeerde string', () => {
    renderPlanWith(makeKoppelingFor('steigerungs', 3))
    const kaart = screen.getByTestId('stap-inhoud-k1')
    expect(kaart.textContent).toContain(nl.periodization.steigerungsSteps[2])
  })

  it('print: het print-only stap-inhoud-element heeft geen print:hidden-voorouder, het scherm-element wel', () => {
    renderPlanWith(makeKoppelingFor('partijen_klein', 1))

    const screenBlok = screen.getByTestId('stap-inhoud-k1')
    expect(hasPrintHiddenAncestor(screenBlok)).toBe(true)

    const printBlok = screen.getByTestId('stap-inhoud-print-k1')
    expect(hasPrintHiddenAncestor(printBlok)).toBe(false)
    expect(printBlok.className).toContain('hidden')
    expect(printBlok.className).toContain('print:block')
    expect(printBlok.textContent).toContain(`${nl.periodization.stepWork}: 1 min`)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Parallelle groepen (blokken) — blokkenVanKoppelingen als render-eenheid.
// ────────────────────────────────────────────────────────────────────────────
describe('TrainingPlanEditor — parallelle groepen (blokken)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('een parallelle groep rendert de leden naast elkaar met badges 1a/1b', () => {
    const basisOefening = makeKoppeling().oefeningen
    const k1 = makeKoppeling({
      id: 'k1', oefening_id: 'o1', volgorde: 0, parallel_groep_id: 'g1', parallel_spelers: [],
      created_at: '2024-01-01T00:00:00Z',
      oefeningen: { ...basisOefening, id: 'o1', naam: 'Oefening A' },
    })
    const k2 = makeKoppeling({
      id: 'k2', oefening_id: 'o2', volgorde: 0, parallel_groep_id: 'g1', parallel_spelers: [],
      created_at: '2024-01-02T00:00:00Z',
      oefeningen: { ...basisOefening, id: 'o2', naam: 'Oefening B' },
    })
    renderPlan([k1, k2])

    expect(screen.getByText('1a')).toBeInTheDocument()
    expect(screen.getByText('1b')).toBeInTheDocument()
    // "Oefening A/B" komt zowel in de koppelingkaart als in de
    // ParallelGroepEditor-ledenkaart voor — dus getAllByText i.p.v. getByText.
    expect(screen.getAllByText('Oefening A').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Oefening B').length).toBeGreaterThan(0)
  })

  it('move-up/down verplaatst het hele blok en stuurt een platgeslagen orderedIds naar reorderKoppelingen', async () => {
    const basisOefening = makeKoppeling().oefeningen
    const k1 = makeKoppeling({
      id: 'k1', oefening_id: 'o1', volgorde: 0, parallel_groep_id: 'g1',
      created_at: '2024-01-01T00:00:00Z', oefeningen: { ...basisOefening, id: 'o1', naam: 'Oefening A' },
    })
    const k2 = makeKoppeling({
      id: 'k2', oefening_id: 'o2', volgorde: 0, parallel_groep_id: 'g1',
      created_at: '2024-01-02T00:00:00Z', oefeningen: { ...basisOefening, id: 'o2', naam: 'Oefening B' },
    })
    const k3 = makeKoppeling({
      id: 'k3', oefening_id: 'o3', volgorde: 1,
      created_at: '2024-01-03T00:00:00Z', oefeningen: { ...basisOefening, id: 'o3', naam: 'Oefening C' },
    })
    renderPlan([k1, k2, k3])

    // Blok 0 = {k1, k2} (groep g1), blok 1 = {k3}. Klik op de EERSTE
    // "naar beneden"-knop (bij lid k1, onderdeel van blok 0) verplaatst het
    // hele blok — niet alleen k1.
    const moveDownButtons = screen.getAllByLabelText(nl.trainingPlan.moveDown)
    fireEvent.click(moveDownButtons[0])

    await waitFor(() => expect(mockReorder).toHaveBeenCalledTimes(1))
    expect(mockReorder).toHaveBeenCalledWith('e1', ['k3', 'k1', 'k2'])
  })
})

describe('TrainingPlanEditor — "Parallel aan"-veld', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is disabled bij een training met maar 1 koppeling (geen enkele optie naast "— niet parallel —")', () => {
    renderPlan([makeKoppeling({ id: 'k1' })])

    fireEvent.click(screen.getByLabelText(nl.trainingPlan.detailsToggle))

    const select = screen.getByText(nl.trainingPlan.parallelLabel).closest('div')?.querySelector('select')
    expect(select).toBeDisabled()
  })

  it('is niet disabled zodra er een andere, niet-gegroepeerde koppeling bestaat om naast te zetten', () => {
    const basisOefening = makeKoppeling().oefeningen
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'o1', volgorde: 0, oefeningen: { ...basisOefening, id: 'o1', naam: 'Oefening A' } })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'o2', volgorde: 1, oefeningen: { ...basisOefening, id: 'o2', naam: 'Oefening B' } })
    renderPlan([k1, k2])

    const toggles = screen.getAllByLabelText(nl.trainingPlan.detailsToggle)
    fireEvent.click(toggles[0])

    const select = screen.getByText(nl.trainingPlan.parallelLabel).closest('div')?.querySelector('select')
    expect(select).not.toBeDisabled()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Faalpaden van de groep-mutatie-acties (validator-bevinding 3): vormParallelGroep,
// voegToeAanParallelGroep en haalUitParallelGroep tonen bij een serverfout allemaal
// de generieke i18n-melding trainingPlan.parallelOpslaanMislukt (nooit de rauwe
// Error) via handleParallelChange in TrainingPlanEditor.tsx. Alleen de
// ontkoppel-tak (raw === '') werkt optimistisch vóór de server-call en heeft dus
// een echte rollback nodig; de andere twee takken werken pas ná een geslaagde
// await op `koppelingen`, dus daar is er niets om terug te draaien — zie het
// bijbehorende rapport.
// ────────────────────────────────────────────────────────────────────────────
describe('TrainingPlanEditor — "Parallel aan": faalpaden groep-mutaties', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('haalUitParallelGroep faalt: generieke melding (niet de rauwe fout) en de optimistische ontkoppeling rolt terug naar "Groep 1"', async () => {
    const basisOefening = makeKoppeling().oefeningen
    const k1 = makeKoppeling({
      id: 'k1', oefening_id: 'o1', volgorde: 0, parallel_groep_id: 'g1', parallel_spelers: [],
      created_at: '2024-01-01T00:00:00Z', oefeningen: { ...basisOefening, id: 'o1', naam: 'Oefening A' },
    })
    const k2 = makeKoppeling({
      id: 'k2', oefening_id: 'o2', volgorde: 0, parallel_groep_id: 'g1', parallel_spelers: [],
      created_at: '2024-01-02T00:00:00Z', oefeningen: { ...basisOefening, id: 'o2', naam: 'Oefening B' },
    })
    mockHaalUit.mockRejectedValueOnce(new Error('interne db-foutmelding'))
    renderPlan([k1, k2])

    // k1 is het eerste lid van het (enige) blok, dus de eerste toggle.
    const toggles = screen.getAllByLabelText(nl.trainingPlan.detailsToggle)
    fireEvent.click(toggles[0])

    const getSelect = () =>
      screen.getByText(nl.trainingPlan.parallelLabel).closest('div')?.querySelector('select') as HTMLSelectElement

    // Al gekoppeld: het veld toont de bestaande groep.
    expect(getSelect().value).toBe('groep:g1')

    // Ontkoppelen ("— niet parallel —"): optimistisch al bijgewerkt vóór de
    // server reageert.
    fireEvent.change(getSelect(), { target: { value: '' } })
    expect(getSelect().value).toBe('')

    await waitFor(() => expect(mockHaalUit).toHaveBeenCalledWith('e1', 'k1'))
    await waitFor(() => expect(screen.getByText(nl.trainingPlan.parallelOpslaanMislukt)).toBeInTheDocument())

    // Nooit de rauwe serverfout.
    expect(screen.queryByText('interne db-foutmelding')).not.toBeInTheDocument()

    // Rollback: het veld toont weer de oorspronkelijke groep.
    expect(getSelect().value).toBe('groep:g1')
  })

  it('voegToeAanParallelGroep faalt: generieke melding, koppeling blijft (nooit optimistisch gewijzigd) op "niet parallel"', async () => {
    const basisOefening = makeKoppeling().oefeningen
    const k1 = makeKoppeling({
      id: 'k1', oefening_id: 'o1', volgorde: 0, parallel_groep_id: 'g1', parallel_spelers: [],
      created_at: '2024-01-01T00:00:00Z', oefeningen: { ...basisOefening, id: 'o1', naam: 'Oefening A' },
    })
    const k2 = makeKoppeling({
      id: 'k2', oefening_id: 'o2', volgorde: 0, parallel_groep_id: 'g1', parallel_spelers: [],
      created_at: '2024-01-02T00:00:00Z', oefeningen: { ...basisOefening, id: 'o2', naam: 'Oefening B' },
    })
    const k3 = makeKoppeling({
      id: 'k3', oefening_id: 'o3', volgorde: 1,
      created_at: '2024-01-03T00:00:00Z', oefeningen: { ...basisOefening, id: 'o3', naam: 'Oefening C' },
    })
    mockVoegToe.mockRejectedValueOnce(new Error('interne db-foutmelding'))
    renderPlan([k1, k2, k3])

    // Blok 0 = groep {k1, k2} (2 toggles), blok 1 = los k3 (3e toggle).
    const toggles = screen.getAllByLabelText(nl.trainingPlan.detailsToggle)
    fireEvent.click(toggles[2])

    const getSelect = () =>
      screen.getByText(nl.trainingPlan.parallelLabel).closest('div')?.querySelector('select') as HTMLSelectElement

    expect(getSelect().value).toBe('')
    fireEvent.change(getSelect(), { target: { value: 'groep:g1' } })

    await waitFor(() => expect(mockVoegToe).toHaveBeenCalledWith('e1', 'k3', 'g1'))
    await waitFor(() => expect(screen.getByText(nl.trainingPlan.parallelOpslaanMislukt)).toBeInTheDocument())

    expect(screen.queryByText('interne db-foutmelding')).not.toBeInTheDocument()

    // Deze tak werkt pas ná een geslaagde server-call: bij een fout is de
    // koppeling nooit optimistisch gewijzigd, dus het veld staat nog steeds op
    // "niet parallel" (geen aparte rollback-state nodig om te verifiëren).
    expect(getSelect().value).toBe('')
  })

  it('vormParallelGroep faalt (trainer probeert een koppeling los te maken/samen te voegen): generieke melding, geen van beide koppelingen wordt gegroepeerd', async () => {
    const basisOefening = makeKoppeling().oefeningen
    const k1 = makeKoppeling({
      id: 'k1', oefening_id: 'o1', volgorde: 0,
      created_at: '2024-01-01T00:00:00Z', oefeningen: { ...basisOefening, id: 'o1', naam: 'Oefening A' },
    })
    const k2 = makeKoppeling({
      id: 'k2', oefening_id: 'o2', volgorde: 1,
      created_at: '2024-01-02T00:00:00Z', oefeningen: { ...basisOefening, id: 'o2', naam: 'Oefening B' },
    })
    mockVormGroep.mockRejectedValueOnce(new Error('interne db-foutmelding'))
    renderPlan([k1, k2])

    const toggles = screen.getAllByLabelText(nl.trainingPlan.detailsToggle)
    fireEvent.click(toggles[0])

    const getSelect = () =>
      screen.getByText(nl.trainingPlan.parallelLabel).closest('div')?.querySelector('select') as HTMLSelectElement

    expect(getSelect().value).toBe('')
    fireEvent.change(getSelect(), { target: { value: 'naast:k2' } })

    await waitFor(() => expect(mockVormGroep).toHaveBeenCalledWith('e1', ['k1', 'k2']))
    await waitFor(() => expect(screen.getByText(nl.trainingPlan.parallelOpslaanMislukt)).toBeInTheDocument())

    expect(screen.queryByText('interne db-foutmelding')).not.toBeInTheDocument()

    // Geen groep gevormd: geen "1a"/"1b"-badges, beide blokken blijven los
    // genummerd ("1" en "2").
    expect(screen.queryByText('1a')).not.toBeInTheDocument()
    expect(getSelect().value).toBe('')
  })
})
