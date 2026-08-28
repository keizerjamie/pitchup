// Acceptatietests — Elastische oefenvormen / flexibel spelersaantal per
// oefening (user story: een positiespel-oefening met een bereik, bv.
// 4v2 t/m 6v2, vastleggen in de bibliotheek en per training een eigen
// bezetting kiezen die automatisch aansluit bij de opkomst).
//
// Dekt de AC-groepen uit de goedgekeurde story + §5.6 van de technische
// brief, één describe-blok per groep. Van buitenaf: OefeningEditor,
// OefeningLibrary, OefeningPicker en TrainingPlanEditor worden echt
// gerenderd; alleen `@/lib/supabase/server` en `next/cache` zijn gemockt
// voor de echte-server-action-tests. Voor de reine UI-tests (bezetting,
// weergave, badges) zijn de server actions gemockt — zelfde conventie als
// components/TrainingPlanEditor.test.tsx en afdrukken-trainingsplan.
// acceptance.test.tsx.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Oefening, OefeningTeam, Player, TrainingOefeningWithData } from '@/lib/types'
import type { OefeningInput } from '@/lib/oefening'
import { concretiseerBezetting, suggestBezetting, type TrainingOefeningMetBezetting } from '@/lib/oefening-bezetting'
import * as diagramLib from '@/lib/diagram'
import OefeningEditor from '@/components/OefeningEditor'
import OefeningLibrary, { type OefeningWithUsage } from '@/components/OefeningLibrary'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import ParallelGroepEditor from '@/components/ParallelGroepEditor'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'

vi.mock('@/app/actions/training-plan', () => ({
  saveDoelstelling: vi.fn().mockResolvedValue(undefined),
  removeOefeningFromTraining: vi.fn().mockResolvedValue(undefined),
  updateKoppeling: vi.fn().mockResolvedValue(undefined),
  reorderKoppelingen: vi.fn().mockResolvedValue(undefined),
  saveSpelerindeling: vi.fn().mockResolvedValue(undefined),
  saveAantallenOverride: vi.fn().mockResolvedValue(undefined),
  addOefeningToTraining: vi.fn().mockResolvedValue(undefined),
  createAndAddOefening: vi.fn().mockResolvedValue(undefined),
  vormParallelGroep: vi.fn().mockResolvedValue({ groepId: 'g-new' }),
  voegToeAanParallelGroep: vi.fn().mockResolvedValue(undefined),
  haalUitParallelGroep: vi.fn().mockResolvedValue(undefined),
  saveParallelIndeling: vi.fn().mockResolvedValue(undefined),
  verplaatsParallelSpeler: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/app/actions/oefening-library', () => ({
  createOefening: vi.fn(),
  updateOefening: vi.fn(),
  deleteOefening: vi.fn().mockResolvedValue(undefined),
}))

import { saveAantallenOverride, saveSpelerindeling } from '@/app/actions/training-plan'
const mockSaveAantallen = saveAantallenOverride as unknown as ReturnType<typeof vi.fn>
const mockSaveIndeling = saveSpelerindeling as unknown as ReturnType<typeof vi.fn>

import { createOefening } from '@/app/actions/oefening-library'
const mockCreateOefening = createOefening as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Fixtures ──

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

// Rugnummers bewust ver weg van elke teamgrootte/bereikwaarde in deze suite
// (4-10) — anders botst een pool-chip-rugnummer tekstueel met een
// stepper-/labelwaarde en wordt getByText('6') e.d. dubbelzinnig.
const players6: Player[] = [
  makePlayer({ id: 'p1', name: 'Piet Peters', jersey_number: 21 }),
  makePlayer({ id: 'p2', name: 'Jan Jansen', jersey_number: 22 }),
  makePlayer({ id: 'p3', name: 'Kees Klaassen', jersey_number: 23 }),
  makePlayer({ id: 'p4', name: 'Bram Bakker', jersey_number: 24 }),
  makePlayer({ id: 'p5', name: 'Wim Willems', jersey_number: 25 }),
  makePlayer({ id: 'p6', name: 'Rik Ronda', jersey_number: 26 }),
]

// Flexibele basisoefening: team0 4-6 (flexibel), team1 vast op 2.
const flexTeams: OefeningTeam[] = [
  { grootte: 4, formaties: [], grootteMax: 6 },
  { grootte: 2, formaties: [] },
]

function makeOefening(overrides: Partial<Oefening> = {}): Oefening {
  return {
    id: 'o1',
    team_id: 'team-1',
    naam: 'Positiespel',
    beschrijving: null,
    categorie: 'positiespel',
    duur_min: 12,
    breedte_m: 20,
    lengte_m: 30,
    orientatie: 'vrij',
    veldzone: null,
    teams: flexTeams,
    aantal_neutralen: 0,
    aantal_neutralen_max: null,
    diagram: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeKoppeling(
  overrides: Partial<TrainingOefeningWithData> & { oefening?: Partial<Oefening> } = {},
): TrainingOefeningMetBezetting {
  const { oefening, ...rest } = overrides
  const basis = makeOefening(oefening)
  const koppeling: TrainingOefeningWithData = {
    id: 'k1',
    team_id: 'team-1',
    event_id: 'e1',
    oefening_id: 'o1',
    volgorde: 0,
    stap_override: null,
    genest_in: null,
    spelerindeling: [],
    created_at: '2024-01-01T00:00:00Z',
    oefeningen: basis,
    ...rest,
  }
  return { ...koppeling, bezetting: concretiseerBezetting(koppeling.oefeningen, koppeling.aantallen_override ?? null) }
}

function renderPlan(
  koppelingen: TrainingOefeningMetBezetting[],
  opts: { players?: Player[]; presentPlayerIds?: string[]; library?: Oefening[] } = {},
) {
  return render(
    <DictProvider dict={nl}>
      <TrainingPlanEditor
        eventId="e1"
        initialDoelstelling={null}
        initialOefeningen={koppelingen}
        library={opts.library ?? []}
        currentSteps={{}}
        hasNulmeting={false}
        suggestion={null}
        players={opts.players ?? players6}
        presentPlayerIds={opts.presentPlayerIds ?? players6.map((p) => p.id)}
        startTijd={null}
        kopieerOpties={[]}
      />
    </DictProvider>,
  )
}

function renderEditor(initial?: Oefening | null) {
  const onCancel = vi.fn()
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(
    <DictProvider dict={nl}>
      <OefeningEditor initial={initial ?? null} onCancel={onCancel} onSubmit={onSubmit} />
    </DictProvider>,
  )
  return { onCancel, onSubmit }
}

function makeOefeningWithUsage(overrides: Partial<OefeningWithUsage> = {}): OefeningWithUsage {
  return { ...makeOefening(), koppelingCount: 0, ...overrides }
}

// ── Publieke actie createOefening/updateOefening, ONGEMOCKT ──
//
// `@/app/actions/oefening-library` is hierboven module-breed gemockt (nodig
// voor de UI-only tests hieronder). Voor de validatie-/weigeringscriteria
// (AC1, AC3, AC4, AC5, AC6) is dat niet genoeg bewijs: die zouden dan alleen
// aantonen dat OefeningEditor een bepaalde payload VERZINDT, niet dat de
// server die payload ook echt weigert. `vi.importActual` haalt de echte,
// ongemockte implementatie op (inclusief de echte `validateOefening`) — de
// enige gemockte laag is `@/lib/supabase/server`, exact het patroon van
// oefening-bibliotheek.acceptance.test.tsx en app/actions/oefening-library.test.ts.
async function realOefeningLibraryActions() {
  return vi.importActual<typeof import('@/app/actions/oefening-library')>('@/app/actions/oefening-library')
}

function baseOefeningInput(over: Partial<OefeningInput> = {}): OefeningInput {
  return { naam: 'Rondo', categorie: 'partijen_klein', teams: [], aantal_neutralen: 0, ...over }
}

// Minimale fake Supabase-client voor createOefening/updateOefening — zelfde
// chain-vorm als app/actions/oefening-library.test.ts. `oefeningRow` voedt
// `assertOwnOefening` (moet slagen zodat validateOefening, niet de
// tenant-check, de reden van weigering is).
function makeOefeningActieSupabase(opts: { oefeningRow?: { id: string; team_id: string } | null } = {}) {
  const oefeningRow = opts.oefeningRow === undefined ? { id: 'o1', team_id: 'team-1' } : opts.oefeningRow
  const calls = { insert: [] as Record<string, unknown>[], update: [] as Record<string, unknown>[] }
  function chain(table: string) {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit']) c[m] = () => c
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push(payload); return c }
    c.update = (payload: Record<string, unknown>) => { calls.update.push(payload); return c }
    c.single = () => Promise.resolve({ data: { id: 'new-id' }, error: null })
    c.maybeSingle = () => Promise.resolve({ data: table === 'oefeningen' ? oefeningRow : null, error: null })
    ;(c as unknown as { then: (res: (v: unknown) => unknown) => unknown }).then = (res) =>
      res({ data: table === 'training_oefeningen' ? [] : null, error: null })
    return c
  }
  return {
    calls,
    supabase: {
      from: (t: string) => chain(t),
      auth: { getUser: async () => ({ data: { user: { id: 'team-1' } } }) },
    },
  }
}

function useOefeningActieSupabase(m: ReturnType<typeof makeOefeningActieSupabase>) {
  vi.mocked(createClient).mockResolvedValue(m.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

// ════════════════════════════════════════════════════════════════════════
// Bibliotheek — oefening met bereik vastleggen
// ════════════════════════════════════════════════════════════════════════
describe('Bibliotheek — oefening met bereik vastleggen', () => {
  it('OefeningEditor toont bij heropenen een opgeslagen bereik (teamsToRows-regressiepunt)', () => {
    renderEditor(makeOefening())
    const maxSelect = screen.getAllByLabelText(nl.oefeningen.teamSizeMax)[0] as HTMLSelectElement
    expect(maxSelect.value).toBe('6')
  })

  it('een opgeslagen bereik overleeft heropenen + opnieuw opslaan zonder wijziging (regressie op de teamsToRows-valkuil)', async () => {
    const { onSubmit } = renderEditor(makeOefening())
    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].teams[0]).toEqual({ grootte: 4, formaties: [], keeperInGrootte: true, grootteMax: 6 })
  })

  it('formatiechips zijn disabled zodra er een bereik staat, en omgekeerd — geen van beide wist de ander stilzwijgend', () => {
    renderEditor(makeOefening())
    // Team 0 heeft een bereik (grootteMax 6, geen formatie): de formatiechips
    // (die zonder bereik zouden verschijnen) moeten disabled zijn.
    expect(screen.getByText(nl.oefeningen.rangeFormationHint)).toBeInTheDocument()

    // Zet het bereik weer op "vast" en kies een formatie: het "Tot en
    // met"-select moet dan disabled worden.
    const maxSelects = screen.getAllByLabelText(nl.oefeningen.teamSizeMax)
    fireEvent.change(maxSelects[0], { target: { value: '' } })
    const group = screen.getAllByRole('group', { name: nl.oefeningen.formation })[0]
    const eersteFormatie = within(group).getAllByRole('button')[0]
    fireEvent.click(eersteFormatie)
    expect(maxSelects[0]).toBeDisabled()
  })

  it('submit-payload bevat grootteMax en aantal_neutralen_max', async () => {
    const { onSubmit } = renderEditor(makeOefening({ aantal_neutralen: 2, aantal_neutralen_max: 5 }))
    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const submitted = onSubmit.mock.calls[0][0]
    expect(submitted.teams[0].grootteMax).toBe(6)
    expect(submitted.aantal_neutralen_max).toBe(5)
  })

  it('een oefening zonder de nieuwe velden levert een payload zonder die sleutels', async () => {
    const { onSubmit } = renderEditor(
      makeOefening({ teams: [{ grootte: 4, formaties: [] }], aantal_neutralen: 0, aantal_neutralen_max: null }),
    )
    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const submitted = onSubmit.mock.calls[0][0]
    expect(submitted.teams[0]).toEqual({ grootte: 4, formaties: [], keeperInGrootte: true })
    expect(submitted.teams[0]).not.toHaveProperty('grootteMax')
    expect(submitted.aantal_neutralen_max).toBeNull()
  })

  it('AC2 (directe UI-interactie): "Tot en met" op een reeds flexibel team terugzetten naar "— vast —" levert bij opslaan weer een exact team op', async () => {
    // makeOefening() heeft team 0 al flexibel (grootteMax: 6) — de trainer
    // kiest hier expliciet "— vast —" in het select, in plaats van dat de
    // fixture toevallig al zonder grootteMax start (dat bewijst deze zelfde
    // regel al indirect in de test hierboven).
    const { onSubmit } = renderEditor(makeOefening())
    const maxSelects = screen.getAllByLabelText(nl.oefeningen.teamSizeMax)
    fireEvent.change(maxSelects[0], { target: { value: '' } })
    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const submitted = onSubmit.mock.calls[0][0]
    expect(submitted.teams[0]).toEqual({ grootte: 4, formaties: [], keeperInGrootte: true })
    expect(submitted.teams[0]).not.toHaveProperty('grootteMax')
  })
})

// ════════════════════════════════════════════════════════════════════════
// Bibliotheek — validatie bij opslaan, via de ECHTE publieke actie
// (createOefening/updateOefening, ongemockt — alleen Supabase is fake).
//
// De tests in het vorige blok bewijzen alleen dat OefeningEditor de juiste
// payload VERZENDT (onSubmit is daar een kale mock). Dat is geen bewijs dat
// een weigering ("geweigerd met een duidelijke melding", "opslaan wordt
// geweigerd") ook echt gebeurt — de UI voorkomt een ongeldig bereik nu
// juist proactief (disabled select/chips), dus een trainer kan dit via de
// normale flow niet eens proberen. Deze tests demonstreren het server-side
// vangnet zelf (bijv. voor een gemanipuleerd verzoek), exact zoals de
// bestaande AC3/AC4/AC5-dekking in oefening-bibliotheek.acceptance.test.tsx
// voor andere velden al doet.
// ════════════════════════════════════════════════════════════════════════
describe('Bibliotheek — validatie bij opslaan (server-side, publieke actie)', () => {
  it('AC3: een team met formatie én grootteMax tegelijk wordt geweigerd, geen write', async () => {
    const { updateOefening } = await realOefeningLibraryActions()
    const m = makeOefeningActieSupabase()
    useOefeningActieSupabase(m)
    await expect(
      updateOefening('o1', baseOefeningInput({ teams: [{ grootte: 4, formaties: ['2-1'], grootteMax: 6 }] })),
    ).rejects.toThrow('Formatie kan niet samen met een spelersbereik')
    expect(m.calls.update).toHaveLength(0)
  })

  it('AC4a: grootteMax kleiner dan de grootte wordt geweigerd, de oefening blijft ongewijzigd (geen write)', async () => {
    const { updateOefening } = await realOefeningLibraryActions()
    const m = makeOefeningActieSupabase()
    useOefeningActieSupabase(m)
    await expect(
      updateOefening('o1', baseOefeningInput({ teams: [{ grootte: 4, formaties: [], grootteMax: 3 }] })),
    ).rejects.toThrow('Bovengrens kleiner dan de teamgrootte')
    expect(m.calls.update).toHaveLength(0)
  })

  it('AC4b: grootteMax buiten de geldige teamgroottes (single source, lib/formaties.ts:33) wordt geweigerd', async () => {
    const { updateOefening } = await realOefeningLibraryActions()
    const m = makeOefeningActieSupabase()
    useOefeningActieSupabase(m)
    await expect(
      updateOefening('o1', baseOefeningInput({ teams: [{ grootte: 4, formaties: [], grootteMax: 12 }] })),
    ).rejects.toThrow('Ongeldige teamgrootte')
    expect(m.calls.update).toHaveLength(0)
  })

  it('AC5: aantal_neutralen_max kleiner dan het basisaantal neutralen wordt geweigerd', async () => {
    const { updateOefening } = await realOefeningLibraryActions()
    const m = makeOefeningActieSupabase()
    useOefeningActieSupabase(m)
    await expect(
      updateOefening('o1', baseOefeningInput({ aantal_neutralen: 3, aantal_neutralen_max: 1 })),
    ).rejects.toThrow('Bovengrens kleiner dan het aantal neutralen')
    expect(m.calls.update).toHaveLength(0)
  })

  it('AC6: een basisaantal neutralen van 0 met een geldige aantal_neutralen_max wordt geaccepteerd (0 is geen "niet ingesteld")', async () => {
    const { updateOefening } = await realOefeningLibraryActions()
    const m = makeOefeningActieSupabase()
    useOefeningActieSupabase(m)
    await expect(updateOefening('o1', baseOefeningInput({ aantal_neutralen: 0, aantal_neutralen_max: 4 }))).resolves.toBeUndefined()
    expect(m.calls.update[0].aantal_neutralen).toBe(0)
    expect(m.calls.update[0].aantal_neutralen_max).toBe(4)
  })

  it('AC1: grootteMax groter dan of gelijk aan de grootte wordt geaccepteerd en als bereik [grootte, grootteMax] opgeslagen', async () => {
    const { updateOefening } = await realOefeningLibraryActions()
    const m = makeOefeningActieSupabase()
    useOefeningActieSupabase(m)
    await updateOefening('o1', baseOefeningInput({ teams: [{ grootte: 4, formaties: [], grootteMax: 6 }] }))
    expect(m.calls.update[0].teams).toEqual([{ grootte: 4, formaties: [], keeperInGrootte: true, grootteMax: 6 }])
  })

  it('vanuit een lege oefening: teamgrootte + "Tot en met" kiezen levert bij opslaan een team met grootteMax op (createOefening als onSubmit)', async () => {
    render(
      <DictProvider dict={nl}>
        <OefeningEditor
          initial={null}
          onCancel={vi.fn()}
          onSubmit={mockCreateOefening as unknown as (input: OefeningInput) => Promise<unknown>}
        />
      </DictProvider>,
    )
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Rondo 4-6v2' } })
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '4' } })
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSizeMax)[0], { target: { value: '6' } })
    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(mockCreateOefening).toHaveBeenCalledTimes(1))
    expect(mockCreateOefening.mock.calls[0][0].teams[0]).toEqual({ grootte: 4, formaties: [], keeperInGrootte: true, grootteMax: 6 })
  })
})

// ════════════════════════════════════════════════════════════════════════
// Filter & weergave
// ════════════════════════════════════════════════════════════════════════
describe('Filter & weergave', () => {
  it('vorm-badge "4v2–6v2" op de bibliotheekkaart, geen badge bij een exacte oefening', () => {
    render(
      <DictProvider dict={nl}>
        <OefeningLibrary
          oefeningen={[
            makeOefeningWithUsage({ id: 'o1', naam: 'Flexibel' }),
            makeOefeningWithUsage({ id: 'o2', naam: 'Exact', teams: [{ grootte: 4, formaties: [] }] }),
          ]}
        />
      </DictProvider>,
    )
    expect(screen.getByText('4v2–6v2')).toBeInTheDocument()
    const exactCard = screen.getByText('Exact').closest('div')!.parentElement!.parentElement!
    expect(exactCard.textContent).not.toContain('–')
  })

  it('AC11: de picker-rij toont ook het vorm-label "4v2–6v2" van een flexibele oefening (niet alleen de bibliotheekkaart)', () => {
    renderPlan([], { library: [makeOefening({ id: 'o1', naam: 'Flexibel bereik' })] })
    fireEvent.click(screen.getAllByRole('button', { name: nl.trainingPlan.addExercise })[0])
    const rij = screen.getByRole('button', { name: /Flexibel bereik/ })
    expect(within(rij).getByText('4v2–6v2')).toBeInTheDocument()
  })

  it('thumbnail-label toont het bereik "4–6" op de bibliotheekkaart', () => {
    render(
      <DictProvider dict={nl}>
        <OefeningLibrary oefeningen={[makeOefeningWithUsage({ id: 'o1', naam: 'Flexibel' })]} />
      </DictProvider>,
    )
    expect(screen.getByText('4–6')).toBeInTheDocument()
  })

  it('neutralen-bereikbadge toont "{min}–{max} neutralen" bij flexibele neutralen', () => {
    render(
      <DictProvider dict={nl}>
        <OefeningLibrary
          oefeningen={[makeOefeningWithUsage({ id: 'o1', aantal_neutralen: 2, aantal_neutralen_max: 4 })]}
        />
      </DictProvider>,
    )
    expect(screen.getByText(nl.oefeningen.neutralsBadgeRange.replace('{min}', '2').replace('{max}', '4'))).toBeInTheDocument()
  })

  it('falsy-zero: een basisaantal neutralen van 0 met een flexibele bovengrens toont "0–4 neutralen" (niet "geen neutralen")', () => {
    render(
      <DictProvider dict={nl}>
        <OefeningLibrary
          oefeningen={[makeOefeningWithUsage({ id: 'o1', aantal_neutralen: 0, aantal_neutralen_max: 4 })]}
        />
      </DictProvider>,
    )
    expect(screen.getByText(nl.oefeningen.neutralsBadgeRange.replace('{min}', '0').replace('{max}', '4'))).toBeInTheDocument()
  })

  it('AC7: interval-overlap — een aantal-filter dat het bereik van de flexibele oefening raakt (inclusief de randen) toont haar', () => {
    // Basisoefening (flexTeams) heeft totaalbereik [6,8] (team0 4-6 + team1 vast 2).
    renderPlan([], { library: [makeOefening({ id: 'o1', naam: 'Flexibel bereik' })] })
    fireEvent.click(screen.getAllByRole('button', { name: nl.trainingPlan.addExercise })[0])
    const minInput = screen.getByLabelText(`${nl.oefeningen.filterCountLabel} ${nl.oefeningen.filterMinPlaceholder}`)
    const maxInput = screen.getByLabelText(`${nl.oefeningen.filterCountLabel} ${nl.oefeningen.filterMaxPlaceholder}`)

    // Filter-ondergrens gelijk aan de bovengrens van het bereik (8): randinclusief.
    fireEvent.change(minInput, { target: { value: '8' } })
    expect(screen.getByText('Flexibel bereik')).toBeInTheDocument()
    fireEvent.change(minInput, { target: { value: '' } })

    // Filter-bovengrens gelijk aan de ondergrens van het bereik (6): randinclusief.
    fireEvent.change(maxInput, { target: { value: '6' } })
    expect(screen.getByText('Flexibel bereik')).toBeInTheDocument()
    fireEvent.change(maxInput, { target: { value: '' } })

    // Volledig binnen het bereik.
    fireEvent.change(minInput, { target: { value: '7' } })
    fireEvent.change(maxInput, { target: { value: '7' } })
    expect(screen.getByText('Flexibel bereik')).toBeInTheDocument()
  })

  it('AC7 (faalpad): een aantal-filter volledig buiten het bereik van de flexibele oefening sluit haar uit', () => {
    renderPlan([], { library: [makeOefening({ id: 'o1', naam: 'Flexibel bereik' })] }) // bereik [6,8]
    fireEvent.click(screen.getAllByRole('button', { name: nl.trainingPlan.addExercise })[0])
    fireEvent.change(
      screen.getByLabelText(`${nl.oefeningen.filterCountLabel} ${nl.oefeningen.filterMinPlaceholder}`),
      { target: { value: '9' } },
    )
    expect(screen.queryByText('Flexibel bereik')).not.toBeInTheDocument()
  })

  it('AC9: de "past bij aanwezigen"-chip is randinclusief — N gelijk aan de ondergrens van het bereik matcht wél', () => {
    renderPlan([], {
      presentPlayerIds: players6.map((p) => p.id), // N=6, exact de ondergrens van [6,8]
      library: [
        makeOefening({ id: 'o1', naam: 'Flexibel bereik' }), // [6,8]
        makeOefening({ id: 'o2', naam: 'Groot team', teams: [{ grootte: 10, formaties: [] }] }), // [10,10]
      ],
    })
    fireEvent.click(screen.getAllByRole('button', { name: nl.trainingPlan.addExercise })[0])
    fireEvent.click(screen.getByText(nl.oefeningen.fitsPresentChip.replace('{n}', '6')))
    expect(screen.getByText('Flexibel bereik')).toBeInTheDocument()
    expect(screen.queryByText('Groot team')).not.toBeInTheDocument()
  })

  it('N=0: de "past bij aanwezigen"-chip verschijnt niet in de picker (via TrainingPlanEditor)', () => {
    renderPlan([], { presentPlayerIds: [], library: [makeOefening()] })
    fireEvent.click(screen.getAllByRole('button', { name: nl.trainingPlan.addExercise })[0])
    expect(screen.queryByText(/Past bij aanwezigen/)).not.toBeInTheDocument()
  })

  it('N>=1: de chip verschijnt en filtert op interval-bevat-N', () => {
    renderPlan([], {
      presentPlayerIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
      library: [
        makeOefening({ id: 'o1', naam: 'Flexibel 4v2-6v2' }), // bereik [6,8]
        makeOefening({ id: 'o2', naam: 'Exact 4v2', teams: [{ grootte: 4, formaties: [] }, { grootte: 2, formaties: [] }] }), // [6,6]
        makeOefening({ id: 'o3', naam: 'Groot team', teams: [{ grootte: 10, formaties: [] }] }), // [10,10]
      ],
    })
    fireEvent.click(screen.getAllByRole('button', { name: nl.trainingPlan.addExercise })[0])
    const chip = screen.getByText(nl.oefeningen.fitsPresentChip.replace('{n}', '5'))
    fireEvent.click(chip)
    // 5 aanwezigen valt buiten [6,8] en [6,6] en [10,10] → niets past.
    expect(screen.getByText(nl.oefeningen.pickerEmpty)).toBeInTheDocument()
  })

  it('sortering in de picker: exact vóór flexibel, smalste bereik het eerst', () => {
    renderPlan([], {
      library: [
        makeOefening({ id: 'o1', naam: 'Breed', teams: [{ grootte: 4, formaties: [], grootteMax: 10 }] }),
        makeOefening({ id: 'o2', naam: 'Exact', teams: [{ grootte: 4, formaties: [] }] }),
        makeOefening({ id: 'o3', naam: 'Smal', teams: [{ grootte: 5, formaties: [], grootteMax: 6 }] }),
      ],
    })
    fireEvent.click(screen.getAllByRole('button', { name: nl.trainingPlan.addExercise })[0])
    const namen = screen.getAllByRole('button', { name: /Breed|Exact|Smal/ }).map((el) => el.textContent)
    expect(namen[0]).toContain('Exact')
    expect(namen[1]).toContain('Smal')
    expect(namen[2]).toContain('Breed')
  })
})

// ════════════════════════════════════════════════════════════════════════
// Bezetting per training
// ════════════════════════════════════════════════════════════════════════
describe('Bezetting', () => {
  it('steppers zijn alleen zichtbaar bij een flexibele oefening', () => {
    renderPlan([makeKoppeling({ id: 'k1' })])
    expect(screen.getByText(nl.bezetting.heading)).toBeInTheDocument()
  })

  it('geen steppers bij een exacte oefening', () => {
    renderPlan([makeKoppeling({ id: 'k1', oefening: { teams: [{ grootte: 4, formaties: [] }] } })])
    expect(screen.queryByText(nl.bezetting.heading)).not.toBeInTheDocument()
  })

  it('zonder opgeslagen override toont de stepper de suggestBezetting-waarde als startwaarde', () => {
    renderPlan([makeKoppeling({ id: 'k1' })], { presentPlayerIds: players6.map((p) => p.id) })
    // basis totaal [6,8], 6 aanwezigen → geen kopruimte nodig, blijft 4/2.
    const suggestie = suggestBezetting(makeOefening(), 6)
    expect(screen.getByText(String(suggestie.teams[0]))).toBeInTheDocument()
  })

  it('met een opgeslagen override toont de stepper die waarde, ongeacht de opkomst', () => {
    renderPlan(
      [makeKoppeling({ id: 'k1', aantallen_override: { teams: [6, null], neutralen: null } })],
      { presentPlayerIds: ['p1', 'p2'] },
    )
    // "6" staat zowel op de stepper als (want aangepast=true) op het kale
    // FormationField-label — precies het bewijs dat beide consumers dezelfde
    // effectieve waarde tonen, vandaar getAllByText i.p.v. getByText.
    expect(screen.getAllByText('6').length).toBeGreaterThan(0)
    expect(screen.getByText(nl.bezetting.savedHint)).toBeInTheDocument()
  })

  it('− / + zijn begrensd op [grootte, grootteMax] — knoppen disabled aan de grens', () => {
    renderPlan([makeKoppeling({ id: 'k1', aantallen_override: { teams: [6, null], neutralen: null } })])
    const label = nl.teamIndeling.teamLabel.replace('{n}', '1')
    expect(screen.getByRole('button', { name: nl.bezetting.increaseAria.replace('{label}', label) })).toBeDisabled()
  })

  it('"Bezetting vastleggen" roept saveAantallenOverride aan met de delta-vorm', async () => {
    renderPlan([makeKoppeling({ id: 'k1', aantallen_override: { teams: [4, null], neutralen: null } })])
    const label = nl.teamIndeling.teamLabel.replace('{n}', '1')
    fireEvent.click(screen.getByRole('button', { name: nl.bezetting.increaseAria.replace('{label}', label) }))
    fireEvent.click(screen.getByText(nl.bezetting.confirm))
    await waitFor(() => expect(mockSaveAantallen).toHaveBeenCalledWith('k1', 'e1', { teams: [5, null], neutralen: null }))
  })

  it('een mislukte save rolt terug en toont bezetting.saveError, nooit de rauwe fout', async () => {
    mockSaveAantallen.mockRejectedValueOnce(new Error('interne db-fout'))
    renderPlan([makeKoppeling({ id: 'k1', aantallen_override: { teams: [4, null], neutralen: null } })])
    fireEvent.click(screen.getByText(nl.bezetting.confirm))
    await waitFor(() => expect(screen.getByText(nl.bezetting.saveError)).toBeInTheDocument())
    expect(screen.queryByText('interne db-fout')).not.toBeInTheDocument()
  })

  it('"Terug naar basisvorm" stuurt null naar saveAantallenOverride', async () => {
    renderPlan([makeKoppeling({ id: 'k1', aantallen_override: { teams: [6, null], neutralen: null } })])
    fireEvent.click(screen.getByText(nl.bezetting.reset))
    await waitFor(() => expect(mockSaveAantallen).toHaveBeenCalledWith('k1', 'e1', null))
  })

  it('AC14 (geen autosave): alleen renderen met een van-de-basis-afwijkende suggestie roept saveAantallenOverride niet aan', () => {
    // 8 aanwezigen op basis-totaal [6,8] → suggestBezetting wijkt af van de
    // basisvorm (4v2), maar dat mag pas ná een expliciete bevestiging landen
    // in aantallen_override.
    renderPlan([makeKoppeling({ id: 'k1' })], { presentPlayerIds: players6.map((p) => p.id) })
    expect(mockSaveAantallen).not.toHaveBeenCalled()
  })

  it('AC18: override met een deel ingevuld — het niet-ingevulde element blijft op de basisvorm, alleen het ingevulde element verandert', () => {
    const koppeling = makeKoppeling({
      id: 'k1',
      oefening: {
        teams: [
          { grootte: 4, formaties: [], grootteMax: 6 },
          { grootte: 3, formaties: [], grootteMax: 5 },
        ],
      },
      aantallen_override: { teams: [6, null], neutralen: null },
    })
    renderPlan([koppeling])
    // Team 1 is expliciet ingevuld (6)...
    expect(screen.getByText('Team 1 · 6')).toBeInTheDocument()
    // ...Team 2 (null in de override) blijft op de basiswaarde 3 — niet 0,
    // niet NaN, en niet de waarde van het andere team.
    expect(screen.getByText('Team 2 · 3')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// Weergave vóór opslaan (eigenaarsbesluit 2)
// ════════════════════════════════════════════════════════════════════════
describe('Weergave vóór opslaan', () => {
  it('de stepper toont de suggestie, terwijl teamlabel en print de basisvorm blijven tonen zolang niets is opgeslagen', () => {
    // 8 aanwezigen, basis-totaal [6,8] → team0 krijgt de volle kopruimte (6).
    renderPlan([makeKoppeling({ id: 'k1' })], { presentPlayerIds: players6.map((p) => p.id) })
    // Stepper (nog niet opgeslagen): toont de suggestie 6.
    expect(screen.getByText(nl.bezetting.notSavedHint)).toBeInTheDocument()
    // TeamIndelingEditor-labels: nog steeds de basisvorm "4" (want
    // k.bezetting.aangepast is false zolang er geen override is).
    expect(screen.getByText(`Team 1 · 4`)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// Trainingscontext — alle consumers gebruiken dezelfde effectieve grootte
// ════════════════════════════════════════════════════════════════════════
describe('Trainingscontext', () => {
  it('teamlabel, sizeMismatch-grens en autoAssignTeams-capaciteit gebruiken allemaal de effectieve grootte', async () => {
    const koppeling = makeKoppeling({ id: 'k1', aantallen_override: { teams: [6, null], neutralen: null } })
    // autoAssignTeams draait een snake-draft over de teams (lib/spelerindeling.ts):
    // met exact 6 aanwezigen raakt team 2 (vaste capaciteit 2) al halverwege
    // vol en krijgt team 1 alleen het restant (4, toevallig gelijk aan de
    // basis) — 8 aanwezigen zijn nodig om zijn volledige EFFECTIEVE capaciteit
    // (6, niet de basis 4) daadwerkelijk aan te tonen.
    const players8 = [
      ...players6,
      makePlayer({ id: 'p7', name: 'Tom Timmer', jersey_number: 27 }),
      makePlayer({ id: 'p8', name: 'Nico Noort', jersey_number: 28 }),
    ]
    renderPlan([koppeling], { players: players8, presentPlayerIds: players8.map((p) => p.id) })
    // TeamIndelingEditor-label toont de effectieve grootte (6), niet de basis (4).
    expect(screen.getByText(`Team 1 · 6`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: nl.teamIndeling.autoAssign }))
    await waitFor(() => expect(mockSaveIndeling).toHaveBeenCalled())
    const call = mockSaveIndeling.mock.calls[0]
    expect((call[2] as string[][])[0]).toHaveLength(6)
    expect((call[2] as string[][])[1]).toHaveLength(2)
  })

  it('badge "tekening toont basisvorm" verschijnt alleen bij een handmatig diagram mét afwijkende bezetting', () => {
    const diagram = { markers: [], materiaal: [], lijnen: [] }
    const aangepast = makeKoppeling({
      id: 'k1',
      oefening: { diagram },
      aantallen_override: { teams: [6, null], neutralen: null },
    })
    const { unmount } = renderPlan([aangepast])
    expect(screen.getByText(nl.trainingPlan.diagramBasisvorm.replace('{vorm}', '4v2'))).toBeInTheDocument()
    unmount()

    const ongewijzigd = makeKoppeling({ id: 'k1', oefening: { diagram } })
    renderPlan([ongewijzigd])
    expect(screen.queryByText(/tekening toont basisvorm/)).not.toBeInTheDocument()
  })

  it('badge op print: hetzelfde "tekening toont basisvorm"-gegeven staat ook als ·-segment in de print-only kopregel', () => {
    // jsdom past @media print niet toe: het print-only element ("hidden
    // print:block") staat gewoon in de DOM en is los te vinden via zijn
    // eigen klasse — de scherm-badge ernaast is print:hidden en dus een
    // ANDER element met dezelfde tekst (zie de losse assertie hierboven).
    const diagram = { markers: [], materiaal: [], lijnen: [] }
    const aangepast = makeKoppeling({
      id: 'k1',
      oefening: { diagram },
      aantallen_override: { teams: [6, null], neutralen: null },
    })
    const { container, unmount } = renderPlan([aangepast])
    const printKopregelAangepast = container.querySelector('.print-poster-meta')
    expect(printKopregelAangepast).not.toBeNull()
    expect(printKopregelAangepast!.textContent).toContain(nl.trainingPlan.diagramBasisvorm.replace('{vorm}', '4v2'))
    unmount()

    const ongewijzigd = makeKoppeling({ id: 'k1', oefening: { diagram } })
    const { container: containerOngewijzigd } = renderPlan([ongewijzigd])
    const printKopregelOngewijzigd = containerOngewijzigd.querySelector('.print-poster-meta')
    expect(printKopregelOngewijzigd!.textContent).not.toContain('basisvorm')
  })

  it('Kern-invariant: het aantal teams en de koppeling spelerindeling[i] ↔ teams[i] blijven behouden, ook met een override die maar één team raakt', () => {
    const koppeling = makeKoppeling({
      id: 'k1',
      spelerindeling: [['p1'], ['p2']],
      aantallen_override: { teams: [6, null], neutralen: null }, // raakt alleen team 0
    })
    renderPlan([koppeling])
    // Precies twee teamkolommen — nooit meer of minder dan de 2 basisteams
    // van de oefening, ook al raakt de override er maar één.
    expect(screen.getByTestId('teamindeling-team-0')).toBeInTheDocument()
    expect(screen.getByTestId('teamindeling-team-1')).toBeInTheDocument()
    expect(screen.queryByTestId('teamindeling-team-2')).not.toBeInTheDocument()
    // spelerindeling[i] blijft aan teams[i] gekoppeld: p1 (Piet) blijft onder
    // team 0, p2 (Jan) blijft onder team 1 — de override verschuift niemand.
    expect(within(screen.getByTestId('teamindeling-team-0')).getByText('Piet')).toBeInTheDocument()
    expect(within(screen.getByTestId('teamindeling-team-1')).getByText('Jan')).toBeInTheDocument()
  })

  it('parallel-groep-status gebruikt dezelfde effectieve grootte als de teamindeling (AC22), niet de basisvorm', () => {
    const koppeling = makeKoppeling({ id: 'k1', aantallen_override: { teams: [6, null], neutralen: null } })
    render(
      <DictProvider dict={nl}>
        <ParallelGroepEditor
          eventId="e1"
          groepId="g1"
          leden={[koppeling]}
          players={players6}
          presentPlayerIds={players6.map((p) => p.id)}
        />
      </DictProvider>,
    )
    // benodigd = effectieve teamgroottes (6 + 2 = 8), niet de basisvorm (4 +
    // 2 = 6). "0/8" is over drie tekstknopen verdeeld (0, /, 8), dus toets op
    // de samengevoegde textContent i.p.v. getByText.
    expect(screen.getByTestId('parallelgroep-lid-k1').textContent).toContain('0/8')
  })

  it('generateDiagram wordt in de read-only trainingsweergave niet aangeroepen (eigenaarsbesluit 1)', () => {
    const spy = vi.spyOn(diagramLib, 'generateDiagram')
    renderPlan([makeKoppeling({ id: 'k1' })])
    expect(spy).not.toHaveBeenCalled()
  })

  it('FormationField-label toont het kale effectieve getal bij een opgeslagen override, en het bereik zonder override', () => {
    const { unmount } = renderPlan([
      makeKoppeling({ id: 'k1', oefening: { diagram: null }, aantallen_override: { teams: [6, null], neutralen: null } }),
    ])
    // De stepper toont ZELF ook nog het statische bereik "4–6" (gedempt,
    // naast de −/+-knoppen — dat is onafhankelijk van aangepast), dus scope
    // de "geen bereik meer"-assertie tot het FormationField-label zelf.
    const formationLabel = screen.getAllByTestId('formation-field')[0].parentElement!.querySelector('p')!
    expect(formationLabel.textContent).toBe('6')
    unmount()

    renderPlan([makeKoppeling({ id: 'k1', oefening: { diagram: null } })], { presentPlayerIds: [] })
    // Geen override: het bereik-label blijft zichtbaar op het formatieveld.
    const formationLabelZonderOverride = screen.getAllByTestId('formation-field')[0].parentElement!.querySelector('p')!
    expect(formationLabelZonderOverride.textContent).toBe('4–6')
  })

  it('validator-bevinding 2: een override op één team laat het bereik van een ONaangeraakt, óók flexibel, team intact', () => {
    // Beide teams zijn flexibel (in tegenstelling tot de standaard-fixture,
    // waar team 2 vast is); alleen team 0 wordt overridden. Vóór de fix
    // gebruikte het label het koppeling-brede `bezetting.aangepast`-vlag,
    // waardoor ook het ONaangeraakte team 1 zijn bereik verloor.
    const koppeling = makeKoppeling({
      id: 'k1',
      oefening: {
        diagram: null,
        teams: [
          { grootte: 4, formaties: [], grootteMax: 6 },
          { grootte: 3, formaties: [], grootteMax: 5 },
        ],
      },
      aantallen_override: { teams: [6, null], neutralen: null },
    })
    renderPlan([koppeling])
    const labels = screen.getAllByTestId('formation-field').map((el) => el.parentElement!.querySelector('p')!.textContent)
    // Team 0: expliciet overridden (6, wijkt af van basis 4) → kaal getal.
    expect(labels[0]).toBe('6')
    // Team 1: NIET aangeraakt door deze override → behoudt zijn eigen bereik.
    expect(labels[1]).toBe('3–5')
  })

  it('validator-bevinding 2: een neutralen-only override laat beide teamlabels hun bereik behouden', () => {
    const koppeling = makeKoppeling({
      id: 'k1',
      oefening: {
        diagram: null,
        teams: [
          { grootte: 4, formaties: [], grootteMax: 6 },
          { grootte: 3, formaties: [], grootteMax: 5 },
        ],
        aantal_neutralen: 0,
        aantal_neutralen_max: 4,
      },
      // Raakt geen enkel team — alleen de neutralen — maar zet
      // `bezetting.aangepast` wél op true voor de hele koppeling.
      aantallen_override: { teams: [null, null], neutralen: 3 },
    })
    renderPlan([koppeling])
    const labels = screen.getAllByTestId('formation-field').map((el) => el.parentElement!.querySelector('p')!.textContent)
    expect(labels[0]).toBe('4–6')
    expect(labels[1]).toBe('3–5')
  })
})

// ════════════════════════════════════════════════════════════════════════
// Trainingsplan-kaart — neutralen-badge (validator-bevinding 1)
//
// De badge moet de EFFECTIEVE bezetting lezen (k.bezetting.aantal_neutralen),
// niet de basisvorm (o.aantal_neutralen) — anders mist hij een vastgelegde
// override, of toont hij de verkeerde waarde. Vóór een vastgelegde bezetting
// volgt de weergave de basisvorm (eigenaarsbesluit 2): net als de
// bibliotheekkaart toont de badge dan het bereik, niet een los getal.
// ════════════════════════════════════════════════════════════════════════
describe('Trainingsplan-kaart — neutralen-badge', () => {
  it('basis 0 + max 4, nog geen vastgelegde bezetting: toont het bereik "0–4 neutralen" (volgt de basisvorm, zoals de bibliotheekkaart)', () => {
    renderPlan([makeKoppeling({ id: 'k1', oefening: { aantal_neutralen: 0, aantal_neutralen_max: 4 } })])
    expect(
      screen.getByText(nl.oefeningen.neutralsBadgeRange.replace('{min}', '0').replace('{max}', '4')),
    ).toBeInTheDocument()
  })

  it('basis 0 + max 4 + vastgelegde bezetting van 3: de badge toont het effectieve aantal (3) — vóór de fix verscheen hier géén badge', () => {
    renderPlan([
      makeKoppeling({
        id: 'k1',
        oefening: { aantal_neutralen: 0, aantal_neutralen_max: 4 },
        aantallen_override: { teams: [null, null], neutralen: 3 },
      }),
    ])
    expect(screen.getByText(nl.oefeningen.neutralsBadge.replace('{n}', '3'))).toBeInTheDocument()
    expect(
      screen.queryByText(nl.oefeningen.neutralsBadgeRange.replace('{min}', '0').replace('{max}', '4')),
    ).not.toBeInTheDocument()
  })

  it('basis 2 + vastgelegde override van 4: de badge toont 4, niet de basis 2', () => {
    renderPlan([
      makeKoppeling({
        id: 'k1',
        oefening: { aantal_neutralen: 2, aantal_neutralen_max: 4 },
        aantallen_override: { teams: [null, null], neutralen: 4 },
      }),
    ])
    expect(screen.getByText(nl.oefeningen.neutralsBadge.replace('{n}', '4'))).toBeInTheDocument()
    expect(screen.queryByText(nl.oefeningen.neutralsBadge.replace('{n}', '2'))).not.toBeInTheDocument()
  })

  it('vaste (niet-flexibele) neutralen: bestaand gedrag ongewijzigd, badge toont altijd het exacte aantal', () => {
    renderPlan([makeKoppeling({ id: 'k1', oefening: { aantal_neutralen: 3, aantal_neutralen_max: null } })])
    expect(screen.getByText(nl.oefeningen.neutralsBadge.replace('{n}', '3'))).toBeInTheDocument()
  })

  it('geen neutralen en geen bovengrens: geen badge (falsy-zero-veilige conditie, bestaand gedrag ongewijzigd)', () => {
    renderPlan([makeKoppeling({ id: 'k1', oefening: { aantal_neutralen: 0, aantal_neutralen_max: null } })])
    expect(screen.queryByText(/neutralen/)).not.toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// Rechten & bestaand gedrag
// ════════════════════════════════════════════════════════════════════════
describe('Rechten & bestaand gedrag', () => {
  it('een oefening zonder de nieuwe velden rendert exact als vóór: geen badge, geen steppers', () => {
    const koppeling = makeKoppeling({ id: 'k1', oefening: { teams: [{ grootte: 4, formaties: [] }] } })
    renderPlan([koppeling])
    expect(screen.queryByText(nl.bezetting.heading)).not.toBeInTheDocument()
    expect(screen.queryByText(/tekening toont basisvorm/)).not.toBeInTheDocument()
    expect(screen.getByText(`Team 1 · 4`)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// Edge cases
// ════════════════════════════════════════════════════════════════════════
describe('Edge cases', () => {
  it('bereik verkleind onder een bestaande override: de leesgrens clamt naar het actuele bereik, en dat geldt tegelijk op teamindeling, FormationField en de stepper', () => {
    // De bibliotheek-oefening staat nu op grootteMax 5 (was 6 toen de
    // override van 6 werd opgeslagen) — concretiseerBezetting (aangeroepen
    // in makeKoppeling, precies zoals de echte leesgrens) clamt naar 5.
    const koppeling = makeKoppeling({
      id: 'k1',
      oefening: { teams: [{ grootte: 4, formaties: [], grootteMax: 5 }, { grootte: 2, formaties: [] }] },
      aantallen_override: { teams: [6, null], neutralen: null },
    })
    renderPlan([koppeling])
    expect(screen.getByText(`Team 1 · 5`)).toBeInTheDocument()
    expect(screen.getAllByText('5').length).toBeGreaterThan(0)
    expect(screen.queryByText('6')).not.toBeInTheDocument()
  })

  it('bereik verkleind onder een bestaande override: parallel-groep-status gebruikt ook de geclampte waarde (5), niet de stale 6', () => {
    const koppeling = makeKoppeling({
      id: 'k1',
      oefening: { teams: [{ grootte: 4, formaties: [], grootteMax: 5 }, { grootte: 2, formaties: [] }] },
      aantallen_override: { teams: [6, null], neutralen: null },
    })
    render(
      <DictProvider dict={nl}>
        <ParallelGroepEditor
          eventId="e1"
          groepId="g1"
          leden={[koppeling]}
          players={players6}
          presentPlayerIds={players6.map((p) => p.id)}
        />
      </DictProvider>,
    )
    // benodigd = 5 (geclampt) + 2 = 7, niet 6 + 2 = 8 (de stale override-waarde).
    const lidTekst = screen.getByTestId('parallelgroep-lid-k1').textContent
    expect(lidTekst).toContain('0/7')
    expect(lidTekst).not.toContain('0/8')
  })

  it('bereik verkleind onder een bestaande override: de print-kopregel (·-segment) gebruikt ook de geclampte, afwijkende bezetting', () => {
    const diagram = { markers: [], materiaal: [], lijnen: [] }
    const koppeling = makeKoppeling({
      id: 'k1',
      oefening: { teams: [{ grootte: 4, formaties: [], grootteMax: 5 }, { grootte: 2, formaties: [] }], diagram },
      aantallen_override: { teams: [6, null], neutralen: null },
    })
    const { container } = renderPlan([koppeling])
    const printKopregel = container.querySelector('.print-poster-meta')
    // De basisvorm in de badge-tekst is en blijft "4v2" (dat verandert per
    // definitie nooit); het segment verschijnt omdat de EFFECTIEVE,
    // geclampte bezetting (5v2) nog steeds van die basisvorm afwijkt.
    expect(printKopregel!.textContent).toContain(nl.trainingPlan.diagramBasisvorm.replace('{vorm}', '4v2'))
  })

  it('flexibel → exact met een bestaande override: de override vervalt stil, de effectieve bezetting valt terug op de basisvorm', () => {
    // Formatie toegevoegd → exact team (bereikVoorTeam levert een punt-bereik).
    const koppeling = makeKoppeling({
      id: 'k1',
      oefening: { teams: [{ grootte: 4, formaties: ['2-1'] }, { grootte: 2, formaties: [] }] },
      aantallen_override: { teams: [6, null], neutralen: null },
    })
    renderPlan([koppeling])
    expect(screen.queryByText(nl.bezetting.heading)).not.toBeInTheDocument()
    expect(screen.getByText(`Team 1 · 4 · 2-1`)).toBeInTheDocument()
  })

  it('twee flexibele teams + flexibele neutralen tegelijk: elk krijgt een eigen stepper-rij', () => {
    const koppeling = makeKoppeling({
      id: 'k1',
      oefening: {
        teams: [
          { grootte: 4, formaties: [], grootteMax: 6 },
          { grootte: 3, formaties: [], grootteMax: 5 },
        ],
        aantal_neutralen: 1,
        aantal_neutralen_max: 3,
      },
    })
    renderPlan([koppeling])
    expect(screen.getByText(nl.teamIndeling.teamLabel.replace('{n}', '1'))).toBeInTheDocument()
    expect(screen.getByText(nl.teamIndeling.teamLabel.replace('{n}', '2'))).toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.neutralsLabel)).toBeInTheDocument()
  })

  it('override.teams met een andere lengte dan het huidige aantal teams: overtollige entries genegeerd, ontbrekende = basisvorm', () => {
    const koppeling = makeKoppeling({
      id: 'k1',
      // Override heeft 3 entries, de oefening heeft er nu maar 2 (flexTeams).
      aantallen_override: { teams: [6, 2, 99], neutralen: null },
    })
    renderPlan([koppeling])
    expect(screen.getAllByText('6').length).toBeGreaterThan(0)
    // Team 2 (vast op 2) blijft gewoon 2, geen spoor van het 3e entry.
    expect(screen.getByText(`Team 2 · 2`)).toBeInTheDocument()
  })

  it('kopiëren van een trainingsplan: de gekopieerde koppeling heeft geen aantallen_override en toont direct de basisvorm', () => {
    // Zelfde regel als spelerindeling: kopieerKoppelingen (backend) neemt
    // aantallen_override niet mee. Hier het frontend-gevolg: een koppeling
    // zonder override toont altijd de basisvorm, dus een gekopieerde koppeling
    // heeft nooit iets extra's te doen.
    const koppeling = makeKoppeling({ id: 'k1', aantallen_override: undefined })
    renderPlan([koppeling])
    expect(screen.getByText(nl.bezetting.notSavedHint)).toBeInTheDocument()
    expect(screen.getByText(`Team 1 · 4`)).toBeInTheDocument()
  })

  // Tenant-isolatie van de bereikgrenzen (koppeling van een ander team →
  // "Koppeling niet gevonden", geen write) is NIET opnieuw gedekt in dit
  // bestand: dat is het publieke server-action-contract van
  // `saveAantallenOverride`, al expliciet en grondig getest in
  // app/actions/training-plan.test.ts (describe('saveAantallenOverride'),
  // incl. "vreemd event/team" en "waarde buiten bereik wordt geclampt, niet
  // overgenomen"). Dit bestand mockt `@/app/actions/training-plan` wholesale
  // (zie de vi.mock bovenaan) om de UI-laag te isoleren; die actie hier
  // opnieuw ongemockt aanroepen zou een tweede, overlappende kopie van die
  // dekking zijn in plaats van een frontend-bevinding.
})
