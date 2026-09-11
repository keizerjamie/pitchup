// Acceptatietests — Duur per koppeling, deel B van de brief "Trainingstype
// (A) + duur per koppeling (B)".
//
// ── Dekking (5C in de technische brief) ──
//   - oefening koppelen: het duurveld toont de bibliotheekduur.
//   - handmatig wijzigen: updateKoppeling({ duur_min }), nooit updateOefening.
//   - stap kiezen (partijen_*): duurveld springt naar de berekende waarde +
//     auto-hint; daarna handmatig aanpassen blijft staan; stap wissen laat de
//     duur met rust.
//   - stap kiezen op een categorie zonder rekentabel (sprints_*): duur blijft
//     ongemoeid.
//   - sessietijdlijn telt de koppelingduur, niet de bibliotheekduur; legacy-
//     koppeling (geen eigen duur) valt terug op de bibliotheek.
//   - duur 0 = "geen duur": geen duursegment op de print-kopregel, telt mee in
//     blokkenZonderDuur.
//   - dezelfde bibliotheek-oefening twee keer gekoppeld: onafhankelijke duren.
//   - mislukte save: rollback + generieke melding.
//   - regressie: '0' intypen levert 0 op, niet null (parseInt || null-bug).
//
// ── Aanpak ──
// Render de ECHTE `TrainingPlanEditor` met de server actions als vi.fn()-mocks
// (zelfde patroon als components/TrainingPlanEditor.test.tsx / trainingstype.
// acceptance.test.tsx) — de client-kant (debounce, optimistische state,
// rollback, client-side vooruitrekenen met de ECHTE berekenDuurUitStap/
// clampDuurMin uit lib/) is hier de kern, niet de server-roundtrip zelf (die
// is gedekt in app/actions/training-plan.test.ts).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Oefening, Player, TrainingOefeningWithData } from '@/lib/types'
import { concretiseerBezetting, type TrainingOefeningMetBezetting } from '@/lib/oefening-bezetting'
import { STANDAARD_SESSIEDUUR_MIN } from '@/lib/sessie-tijdlijn'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

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

import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import { updateKoppeling } from '@/app/actions/training-plan'
import { updateOefening } from '@/app/actions/oefening-library'

const mockUpdateKoppeling = updateKoppeling as unknown as ReturnType<typeof vi.fn>
const mockUpdateOefening = updateOefening as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateKoppeling.mockResolvedValue(undefined)
  mockUpdateOefening.mockResolvedValue(undefined)
  // shouldAdvanceTime: true — laat testing-library's eigen waitFor-polling
  // (die op echte setTimeout leunt) gewoon doorlopen naast de expliciet
  // geadvancete debounce-timer (zelfde patroon als app/reset-password/page.test.tsx).
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

// ── Fixtures ──
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

function makeKoppeling(
  overrides: Partial<TrainingOefeningWithData> & { oefening?: Partial<Oefening> } = {},
): TrainingOefeningMetBezetting {
  const { oefening, ...rest } = overrides
  const basis = { ...makeOefeningFixture(), ...oefening }
  const koppeling: TrainingOefeningWithData = {
    id: 'k1',
    team_id: 'team1',
    event_id: 'e1',
    oefening_id: 'o1',
    volgorde: 0,
    stap_override: null,
    genest_in: null,
    spelerindeling: [],
    duur_min: null,
    created_at: '2024-01-01T00:00:00Z',
    oefeningen: basis,
    ...rest,
  }
  return { ...koppeling, bezetting: concretiseerBezetting(koppeling.oefeningen, koppeling.aantallen_override ?? null) }
}

function renderPlan(koppelingen: TrainingOefeningMetBezetting[], startTijd: string | null = null) {
  return render(
    <DictProvider dict={nl}>
      <TrainingPlanEditor
        eventId="e1"
        initialDoelstelling={null}
        initialOefeningen={koppelingen}
        library={[]}
        currentSteps={{}}
        hasNulmeting={true}
        suggestion={null}
        players={[] as Player[]}
        presentPlayerIds={[]}
        startTijd={startTijd}
        kopieerOpties={[]}
        initialTrainingstype="vct"
      />
    </DictProvider>,
  )
}

function duurInput(koppelingId: string): HTMLInputElement {
  return document.getElementById(`duur-${koppelingId}`) as HTMLInputElement
}

async function advanceDebounce() {
  await vi.advanceTimersByTimeAsync(500)
}

// ────────────────────────────────────────────────────────────────────────────
describe('duurveld toont de juiste waarde', () => {
  it('een net gekoppelde oefening (eenmalige kopie, duur_min op de koppeling gelijk aan de bibliotheek) toont de bibliotheekduur', () => {
    const k = makeKoppeling({ duur_min: 25, oefening: { duur_min: 25 } })
    renderPlan([k])
    expect(duurInput('k1').value).toBe('25')
  })

  it('een legacy-koppeling zonder eigen duur (duur_min: null) valt terug op de bibliotheekduur — "geen duur" is de invulwaarde, geen apart teken', () => {
    const k = makeKoppeling({ duur_min: null, oefening: { duur_min: 18 } })
    renderPlan([k])
    expect(duurInput('k1').value).toBe('18')
  })

  it('bibliotheek-oefening zonder duur_min, gekoppeld zonder eigen duur: het veld is leeg ("geen duur")', () => {
    const k = makeKoppeling({ duur_min: null, oefening: { duur_min: null } })
    renderPlan([k])
    expect(duurInput('k1').value).toBe('')
  })
})

describe('duur handmatig wijzigen', () => {
  it('roept na de debounce updateKoppeling(id, eventId, { duur_min }) aan; updateOefening (bibliotheek) wordt NOOIT aangeroepen', async () => {
    const k = makeKoppeling({ duur_min: 10, oefening: { duur_min: 10 } })
    renderPlan([k])

    fireEvent.change(duurInput('k1'), { target: { value: '35' } })
    expect(duurInput('k1').value).toBe('35') // optimistisch, meteen zichtbaar

    await advanceDebounce()
    await waitFor(() => expect(mockUpdateKoppeling).toHaveBeenCalledWith('k1', 'e1', { duur_min: 35 }))
    expect(mockUpdateOefening).not.toHaveBeenCalled()
  })

  it('regressie (parseInt || null-bug): "0" intypen levert duur_min 0 op, niet null', async () => {
    const k = makeKoppeling({ duur_min: 10, oefening: { duur_min: 10 } })
    renderPlan([k])

    fireEvent.change(duurInput('k1'), { target: { value: '0' } })
    expect(duurInput('k1').value).toBe('0')

    await advanceDebounce()
    await waitFor(() => expect(mockUpdateKoppeling).toHaveBeenCalledWith('k1', 'e1', { duur_min: 0 }))
  })

  it('leegmaken stuurt duur_min: null (val terug op de bibliotheek)', async () => {
    const k = makeKoppeling({ duur_min: 30, oefening: { duur_min: 10 } })
    renderPlan([k])

    fireEvent.change(duurInput('k1'), { target: { value: '' } })
    await advanceDebounce()
    await waitFor(() => expect(mockUpdateKoppeling).toHaveBeenCalledWith('k1', 'e1', { duur_min: null }))
  })

  it('mislukte save: rollback naar de laatst bevestigde waarde + generieke i18n-melding, nooit de rauwe serverfout', async () => {
    mockUpdateKoppeling.mockRejectedValueOnce(new Error('interne db-foutmelding'))
    const k = makeKoppeling({ duur_min: 10, oefening: { duur_min: 10 } })
    renderPlan([k])

    fireEvent.change(duurInput('k1'), { target: { value: '99' } })
    await advanceDebounce()

    await waitFor(() => expect(screen.getByText(nl.trainingPlan.duurOpslaanMislukt)).toBeInTheDocument())
    expect(screen.queryByText('interne db-foutmelding')).not.toBeInTheDocument()
    expect(duurInput('k1').value).toBe('10')
  })
})

describe('auto-berekening bij stapkeuze (alleen partijen_*)', () => {
  it('stap kiezen op partijen_groot: het duurveld springt naar de berekende waarde en toont de auto-hint', () => {
    const k = makeKoppeling({ duur_min: 10, oefening: { categorie: 'partijen_groot', duur_min: 10 } })
    renderPlan([k])

    fireEvent.change(document.getElementById('stap-override-k1') as HTMLInputElement, { target: { value: '1' } })

    // Stap 1, partijen_groot: 10*2 + 2*1 = 22 (brief 5A).
    expect(duurInput('k1').value).toBe('22')
    expect(screen.getByText(nl.trainingPlan.duurAutoHint)).toBeInTheDocument()
  })

  it('daarna handmatig aanpassen: de handmatige waarde blijft staan (overschrijft de auto-berekening)', async () => {
    const k = makeKoppeling({ duur_min: 10, oefening: { categorie: 'partijen_groot', duur_min: 10 } })
    renderPlan([k])

    fireEvent.change(document.getElementById('stap-override-k1') as HTMLInputElement, { target: { value: '1' } })
    expect(duurInput('k1').value).toBe('22')

    fireEvent.change(duurInput('k1'), { target: { value: '45' } })
    expect(duurInput('k1').value).toBe('45')
    await advanceDebounce()
    await waitFor(() => expect(mockUpdateKoppeling).toHaveBeenCalledWith('k1', 'e1', { duur_min: 45 }))
  })

  it('stap wissen laat de laatst berekende duur met rust', () => {
    const k = makeKoppeling({ duur_min: 10, oefening: { categorie: 'partijen_groot', duur_min: 10 }, stap_override: 1 })
    renderPlan([k])
    expect(duurInput('k1').value).toBe('10') // nog niet berekend, dit is de initiële waarde

    fireEvent.change(document.getElementById('stap-override-k1') as HTMLInputElement, { target: { value: '' } })
    // Stap gewist: geen berekening (value === null), dus de duur blijft exact
    // zoals hij was vóór het wissen.
    expect(duurInput('k1').value).toBe('10')
  })

  it('stap kiezen op sprints_weinig_rust (geen rekentabel): het duurveld verandert niet', () => {
    const k = makeKoppeling({ duur_min: 12, oefening: { categorie: 'sprints_weinig_rust', duur_min: 12 } })
    renderPlan([k])

    fireEvent.change(document.getElementById('stap-override-k1') as HTMLInputElement, { target: { value: '2' } })
    expect(duurInput('k1').value).toBe('12')
    expect(screen.queryByText(nl.trainingPlan.duurAutoHint)).not.toBeInTheDocument()
  })
})

describe('sessietijdlijn telt de effectieve (koppeling-)duur', () => {
  it('telt de koppelingduur, niet de bibliotheekduur', () => {
    const k = makeKoppeling({ duur_min: 40, oefening: { duur_min: 10 } })
    renderPlan([k])
    expect(screen.getByText(nl.trainingPlan.sessionPlanned.replace('{n}', '40'))).toBeInTheDocument()
  })

  it('een legacy-koppeling zonder eigen duur telt de bibliotheekduur mee (fallback)', () => {
    const k = makeKoppeling({ duur_min: null, oefening: { duur_min: 15 } })
    renderPlan([k])
    expect(screen.getByText(nl.trainingPlan.sessionPlanned.replace('{n}', '15'))).toBeInTheDocument()
  })

  it('duur 0 telt als "geen duur": de oefening zit in blokkenZonderDuur, niet in het totaal', () => {
    const k = makeKoppeling({ duur_min: 0, oefening: { duur_min: 20 } })
    renderPlan([k])
    // Totaal 0 min, en de "1 oefening zonder duur"-hint staat er (0 telt niet
    // als "gebruik dan de bibliotheekduur" — 0 wint altijd, ook als "leeg").
    expect(screen.getByText(nl.trainingPlan.sessionPlanned.replace('{n}', '0'))).toBeInTheDocument()
    expect(screen.getByText(nl.trainingPlan.sessionNoDurationOne)).toBeInTheDocument()
  })
})

describe('print-kopregel gebruikt de effectieve duur', () => {
  it('duur 0 → geen duursegment op de print-kopregel', () => {
    const k = makeKoppeling({ duur_min: 0, oefening: { naam: 'Rondo', duur_min: 20 } })
    renderPlan([k])
    const kopregelMeta = document.querySelector('.print-poster-meta') as HTMLElement
    expect(kopregelMeta.textContent).not.toContain('min')
  })

  it('een positieve duur staat wél op de print-kopregel', () => {
    const k = makeKoppeling({ duur_min: 33, oefening: { naam: 'Rondo' } })
    renderPlan([k])
    const kopregelMeta = document.querySelector('.print-poster-meta') as HTMLElement
    expect(kopregelMeta.textContent).toContain('33 min')
  })
})

describe('meerdere koppelingen van dezelfde bibliotheek-oefening', () => {
  it('twee koppelingen van dezelfde oefening met verschillende duren tonen elk hun eigen waarde; één wijzigen raakt de ander niet', async () => {
    const basis = makeOefeningFixture({ id: 'o1', naam: 'Rondo', duur_min: 10 })
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'o1', duur_min: 15, oefeningen: basis })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'o1', duur_min: 25, oefeningen: basis, volgorde: 1 })
    renderPlan([k1, k2])

    expect(duurInput('k1').value).toBe('15')
    expect(duurInput('k2').value).toBe('25')

    fireEvent.change(duurInput('k1'), { target: { value: '60' } })
    expect(duurInput('k1').value).toBe('60')
    expect(duurInput('k2').value).toBe('25') // ongemoeid

    await advanceDebounce()
    await waitFor(() => expect(mockUpdateKoppeling).toHaveBeenCalledWith('k1', 'e1', { duur_min: 60 }))
    expect(mockUpdateKoppeling).not.toHaveBeenCalledWith('k2', 'e1', expect.anything())
  })
})

// Zeker stellen dat de referentieduur die de sessietijdlijn hanteert bestaat
// (module-import-check: een verkeerd pad zou hierboven al stil gefaald hebben
// op undefined, niet hard).
describe('sanity', () => {
  it('STANDAARD_SESSIEDUUR_MIN is 90', () => {
    expect(STANDAARD_SESSIEDUUR_MIN).toBe(90)
  })
})
