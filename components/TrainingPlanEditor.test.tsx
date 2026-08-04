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
}))

import { saveSpelerindeling, updateKoppeling } from '@/app/actions/training-plan'
const mockSave = saveSpelerindeling as unknown as ReturnType<typeof vi.fn>
const mockUpdateKoppeling = updateKoppeling as unknown as ReturnType<typeof vi.fn>

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Piet Peters',
    position: 'Spits',
    secondary_positions: [],
    jersey_number: 9,
    active: true,
    injured: false,
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
