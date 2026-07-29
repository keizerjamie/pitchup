import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import type { Player, TrainingOefeningWithData } from '@/lib/types'

vi.mock('@/app/actions/training-plan', () => ({
  saveDoelstelling: vi.fn().mockResolvedValue(undefined),
  removeOefeningFromTraining: vi.fn().mockResolvedValue(undefined),
  updateKoppeling: vi.fn().mockResolvedValue(undefined),
  reorderKoppelingen: vi.fn().mockResolvedValue(undefined),
  saveSpelerindeling: vi.fn(),
  addOefeningToTraining: vi.fn().mockResolvedValue(undefined),
  createAndAddOefening: vi.fn().mockResolvedValue(undefined),
}))

import { saveSpelerindeling } from '@/app/actions/training-plan'
const mockSave = saveSpelerindeling as unknown as ReturnType<typeof vi.fn>

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
      teams: [{ grootte: 1, formatie: null }],
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
