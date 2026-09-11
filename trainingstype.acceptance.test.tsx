// Acceptatietests — Trainingstype (VCT / Teamtactisch), deel A van de brief
// "Trainingstype (A) + duur per koppeling (B)".
//
// ── Dekking (5C in de technische brief) ──
//   - aanmaakformulier: precies twee opties, VCT vooraf geselecteerd, blok
//     afwezig bij type=match.
//   - schakelaar staat bovenaan het trainingsplan en toont het opgeslagen type.
//   - VCT → Teamtactisch: stapblok/-badge/print-stapregel verdwijnen; terug
//     naar VCT: stap_override is bewaard, content verschijnt weer.
//   - bij Teamtactisch krijgt een generieke categorie (warming_up) geen extra
//     stapveld (blijft precies zoals het was, achter "Bewerken").
//   - mislukte save: rollback + generieke i18n-melding, nooit de rauwe fout.
//   - event zonder trainingstype in de mock (migratie niet gedraaid) gedraagt
//     zich als VCT (de `?? 'vct'`-fallback op app/events/[id]/training-plan/page.tsx).
//   - sectie 8 (goedgekeurde scope-uitbreiding): cyclusweek-suggestieblok
//     afwezig bij Teamtactisch, aanwezig bij VCT.
//
// ── Aanpak ──
// `app/events/new/page.tsx` wordt echt gerenderd (alleen next/navigation
// gemockt, zoals gebruikelijk voor 'use client'-pagina's). `TrainingPlanEditor`
// wordt echt gerenderd met de server actions als vi.fn()-mocks (zelfde patroon
// als components/TrainingPlanEditor.test.tsx) — dat bewijst de UI-kant zonder
// een Supabase-tabel-engine te hoeven nabouwen voor iets dat hier niet de kern is.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Oefening, OefeningCategorie, Player, TrainingOefeningWithData } from '@/lib/types'
import { concretiseerBezetting, type TrainingOefeningMetBezetting } from '@/lib/oefening-bezetting'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/app/actions/training-plan', () => ({
  saveDoelstelling: vi.fn().mockResolvedValue(undefined),
  removeOefeningFromTraining: vi.fn().mockResolvedValue(undefined),
  updateKoppeling: vi.fn().mockResolvedValue(undefined),
  reorderKoppelingen: vi.fn().mockResolvedValue(undefined),
  saveSpelerindeling: vi.fn().mockResolvedValue(undefined),
  addOefeningToTraining: vi.fn().mockResolvedValue(undefined),
  createAndAddOefening: vi.fn().mockResolvedValue(undefined),
  vormParallelGroep: vi.fn().mockResolvedValue({ groepId: 'g-new' }),
  voegToeAanParallelGroep: vi.fn().mockResolvedValue(undefined),
  haalUitParallelGroep: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/oefening-library', () => ({
  createOefening: vi.fn(),
  updateOefening: vi.fn().mockResolvedValue(undefined),
  deleteOefening: vi.fn(),
}))
vi.mock('@/app/actions/events', () => ({
  createEvent: vi.fn(),
  updateTrainingstype: vi.fn().mockResolvedValue(undefined),
}))

import NewEventPage from '@/app/events/new/page'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import { updateTrainingstype } from '@/app/actions/events'

const mockUpdateTrainingstype = updateTrainingstype as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateTrainingstype.mockResolvedValue(undefined)
})

// ────────────────────────────────────────────────────────────────────────────
// Aanmaakformulier
// ────────────────────────────────────────────────────────────────────────────
describe('aanmaakformulier — trainingstype-keuze bij type=training', () => {
  function renderNewEventPage() {
    return render(
      <DictProvider dict={nl}>
        <NewEventPage />
      </DictProvider>,
    )
  }

  it('toont precies twee opties (VCT / Teamtactisch), VCT vooraf geselecteerd', () => {
    renderNewEventPage()

    const vct = screen.getByRole('button', { name: nl.event.trainingstypeVct })
    const teamtactisch = screen.getByRole('button', { name: nl.event.trainingstypeTeamtactisch })
    expect(vct).toHaveAttribute('aria-pressed', 'true')
    expect(teamtactisch).toHaveAttribute('aria-pressed', 'false')
  })

  it('het blok is afwezig zodra het eventtype op Wedstrijd staat', () => {
    renderNewEventPage()
    fireEvent.click(screen.getByRole('button', { name: nl.event.match }))

    expect(screen.queryByText(nl.event.trainingstype)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: nl.event.trainingstypeVct })).not.toBeInTheDocument()
  })

  it('kiezen van Teamtactisch zet het verborgen trainingstype-veld op teamtactisch', () => {
    renderNewEventPage()
    fireEvent.click(screen.getByRole('button', { name: nl.event.trainingstypeTeamtactisch }))

    const hidden = document.querySelector('input[name="trainingstype"]') as HTMLInputElement
    expect(hidden.value).toBe('teamtactisch')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Fixtures voor TrainingPlanEditor
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
): TrainingOefeningMetBezetting {
  const { oefeningen, ...rest } = overrides
  const basis = { ...makeOefeningFixture({ categorie }), ...oefeningen }
  const koppeling: TrainingOefeningWithData = {
    id: 'k1',
    team_id: 'team1',
    event_id: 'e1',
    oefening_id: 'o1',
    volgorde: 0,
    stap_override,
    genest_in: null,
    spelerindeling: [],
    created_at: '2024-01-01T00:00:00Z',
    oefeningen: basis,
    ...rest,
  }
  return { ...koppeling, bezetting: concretiseerBezetting(koppeling.oefeningen, koppeling.aantallen_override ?? null) }
}

const players: Player[] = []

function renderPlan(
  koppelingen: TrainingOefeningMetBezetting[],
  opts: {
    initialTrainingstype?: 'vct' | 'teamtactisch'
    suggestion?: { week: number; items: { key: string; step: number | null }[] } | null
    currentSteps?: Record<string, number | null>
  } = {},
) {
  return render(
    <DictProvider dict={nl}>
      <TrainingPlanEditor
        eventId="e1"
        initialDoelstelling={null}
        initialOefeningen={koppelingen}
        library={[]}
        currentSteps={opts.currentSteps ?? {}}
        hasNulmeting={true}
        suggestion={opts.suggestion ?? null}
        players={players}
        presentPlayerIds={[]}
        startTijd={null}
        kopieerOpties={[]}
        initialTrainingstype={opts.initialTrainingstype ?? 'vct'}
      />
    </DictProvider>,
  )
}

function schakelaar() {
  return {
    vct: screen.getByRole('button', { name: nl.event.trainingstypeVct }),
    teamtactisch: screen.getByRole('button', { name: nl.event.trainingstypeTeamtactisch }),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Schakelaar bovenaan + opgeslagen waarde
// ────────────────────────────────────────────────────────────────────────────
describe('schakelaar bovenaan het trainingsplan', () => {
  it('staat vóór het doelstellingblok en toont het opgeslagen type', () => {
    renderPlan([], { initialTrainingstype: 'teamtactisch' })

    const { teamtactisch } = schakelaar()
    expect(teamtactisch).toHaveAttribute('aria-pressed', 'true')

    // "Bovenaan": de schakelaar staat vóór het doelstellingblok in de DOM.
    const schakelaarNode = screen.getByText(nl.event.trainingstype)
    const doelBlock = screen.getByTestId('doelstelling-block')
    // compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING (4) betekent dat
    // doelBlock ná schakelaarNode komt.
    expect(schakelaarNode.compareDocumentPosition(doelBlock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('wijzigen roept updateTrainingstype(eventId, next) aan', async () => {
    renderPlan([], { initialTrainingstype: 'vct' })
    fireEvent.click(schakelaar().teamtactisch)

    await waitFor(() => expect(mockUpdateTrainingstype).toHaveBeenCalledWith('e1', 'teamtactisch'))
  })

  it('mislukte save: rollback naar de vorige waarde + generieke i18n-melding, nooit de rauwe serverfout', async () => {
    mockUpdateTrainingstype.mockRejectedValueOnce(new Error('interne db-foutmelding'))
    renderPlan([], { initialTrainingstype: 'vct' })

    fireEvent.click(schakelaar().teamtactisch)
    // Optimistisch al bijgewerkt vóór de server reageert.
    expect(schakelaar().teamtactisch).toHaveAttribute('aria-pressed', 'true')

    await waitFor(() => expect(screen.getByText(nl.trainingPlan.trainingstypeOpslaanMislukt)).toBeInTheDocument())
    expect(screen.queryByText('interne db-foutmelding')).not.toBeInTheDocument()

    // Rollback: VCT staat weer actief.
    expect(schakelaar().vct).toHaveAttribute('aria-pressed', 'true')
    expect(schakelaar().teamtactisch).toHaveAttribute('aria-pressed', 'false')
  })

  it('een event zonder trainingstype in de mock (migratie niet gedraaid) gedraagt zich als VCT (fallback ?? \'vct\' op app/events/[id]/training-plan/page.tsx)', () => {
    // De server-pagina rekent `event.trainingstype ?? 'vct'` uit vóórdat hij de
    // prop doorgeeft (app/events/[id]/training-plan/page.tsx) — dat gedrag zelf
    // is server-scope en niet hier te testen; dit bewijst dat de component zich
    // met die uitgerekende waarde ('vct') gedraagt als een normale VCT-training.
    renderPlan([makeKoppelingFor('partijen_klein', 1)], { initialTrainingstype: 'vct' })

    expect(schakelaar().vct).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('stap-inhoud-k1')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Stapblok / -badge / print-stapregel volgen het trainingstype
// ────────────────────────────────────────────────────────────────────────────
describe('stapblok, -badge en print-stapregel volgen het trainingstype', () => {
  it('VCT → Teamtactisch: het stapblok verdwijnt voor partijen_*, sprints_* en steigerungs; terug naar VCT: verschijnt weer MET dezelfde waarde', () => {
    const k = makeKoppelingFor('partijen_klein', 6)
    renderPlan([k], { initialTrainingstype: 'vct' })

    expect(screen.getByTestId('stap-inhoud-k1')).toBeInTheDocument()
    expect((document.getElementById('stap-override-k1') as HTMLInputElement).value).toBe('6')

    fireEvent.click(schakelaar().teamtactisch)
    expect(screen.queryByTestId('stap-inhoud-k1')).not.toBeInTheDocument()
    expect(document.getElementById('stap-override-k1')).not.toBeInTheDocument()

    fireEvent.click(schakelaar().vct)
    // Terug op VCT: het blok verschijnt weer, en de eerder ingestelde stap (6)
    // staat er nog — stap_override is nooit weggeschreven of gewist door het
    // wisselen van trainingstype.
    expect(screen.getByTestId('stap-inhoud-k1')).toBeInTheDocument()
    expect((document.getElementById('stap-override-k1') as HTMLInputElement).value).toBe('6')
  })

  it('bij Teamtactisch is de stap-badge weg én de print-only stapregel, en bevat de print-kopregel geen "Stap"-segment', () => {
    const k = makeKoppelingFor('sprints_weinig_rust', 2, { oefeningen: makeOefeningFixture({ categorie: 'sprints_weinig_rust', naam: 'Sprintjes' }) })
    renderPlan([k], { initialTrainingstype: 'vct', currentSteps: { sprints_weinig_rust: 2 } })

    // Op VCT: badge + print-stapregel aanwezig (twee treffers: de badge in de
    // badgerij én het · Stap-segment in de print-kopregel).
    expect(screen.getAllByText(new RegExp(`${nl.trainingPlan.stepBadge} 2`)).length).toBe(2)
    expect(screen.getByTestId('stap-inhoud-print-k1')).toBeInTheDocument()

    fireEvent.click(schakelaar().teamtactisch)

    expect(screen.queryAllByText(new RegExp(`${nl.trainingPlan.stepBadge} 2`)).length).toBe(0)
    expect(screen.queryByTestId('stap-inhoud-print-k1')).not.toBeInTheDocument()
    // Print-kopregel: geen " · Stap"-segment meer.
    const kopregelMeta = document.querySelector('.print-poster-meta') as HTMLElement
    expect(kopregelMeta.textContent).not.toContain(nl.trainingPlan.stepBadge)
  })

  it('bij Teamtactisch krijgt een warming_up-oefening (geen brondata) géén extra stapveld in het uitklap-paneel — het generieke veld gedraagt zich precies zoals bij VCT', () => {
    const k = makeKoppelingFor('warming_up', null)
    renderPlan([k], { initialTrainingstype: 'teamtactisch' })

    // Vóór "Bewerken": geen enkel stapveld.
    expect(document.getElementById('stap-generic-k1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('stap-inhoud-k1')).not.toBeInTheDocument()

    // Na "Bewerken": het (ongewijzigde) generieke veld verschijnt — dit is
    // categorie-only gedrag (heeftStapInhoud), trainingstype verandert dat niet.
    fireEvent.click(screen.getByLabelText(nl.trainingPlan.detailsToggle))
    expect(document.getElementById('stap-generic-k1')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Sectie 8 — cyclusweek-suggestieblok verborgen bij teamtactisch
// ────────────────────────────────────────────────────────────────────────────
describe('sectie 8 — cyclusweek-suggestieblok volgt het trainingstype', () => {
  const suggestion = { week: 1, items: [{ key: 'partijen_groot', step: 3 }] }

  it('is aanwezig bij VCT en afwezig bij Teamtactisch, en verschijnt weer bij terugschakelen', () => {
    renderPlan([], { initialTrainingstype: 'vct', suggestion })

    expect(screen.getByTestId('cyclusweek-suggestie')).toBeInTheDocument()

    fireEvent.click(schakelaar().teamtactisch)
    expect(screen.queryByTestId('cyclusweek-suggestie')).not.toBeInTheDocument()

    fireEvent.click(schakelaar().vct)
    expect(screen.getByTestId('cyclusweek-suggestie')).toBeInTheDocument()
  })

  it('de "Huidige periodiseringstatus"-kaart blijft staan bij Teamtactisch (sectie 8: daarover is niets besloten)', () => {
    renderPlan([], { initialTrainingstype: 'vct', suggestion })
    fireEvent.click(schakelaar().teamtactisch)

    expect(screen.getByText(`${nl.periodization.currentSteps} ${nl.periodization.forTraining}`)).toBeInTheDocument()
  })
})
