// Acceptatietests — Oefening inline bewerken vanaf de trainingskaart en de
// oefening-picker (goedgekeurde story AC1 t/m AC11, zie
// scratchpad/ff/02-story-goedgekeurd.md + 04-brief-goedgekeurd.md).
//
// Beide nieuwe aanroeppunten openen hetzelfde bestaande `OefeningEditor` en
// roepen dezelfde bestaande server action `updateOefening` aan
// (app/actions/oefening-library.ts) — er is GEEN backend-wijziging in deze
// feature. Deze tests draaien dus, net als oefening-bibliotheek.acceptance.
// test.tsx, tegen de ECHTE `updateOefening`/`addOefeningToTraining` en
// mocken UITSLUITEND `next/cache` en `@/lib/supabase/server` (zelfde patroon,
// zie oefening-bibliotheek.acceptance.test.tsx:35-82). Alles wordt van
// buitenaf getest: renderen van `TrainingPlanEditor`/`OefeningPicker` en
// klikken/typen zoals een trainer dat doet.
//
// Eén blok per acceptatiecriterium (AC1–AC11); edge cases uit de story staan
// in aparte, expliciet gelabelde blokken. Het "twee tabbladen/sessies
// tegelijk"-edge case (geen locking, laatste wint) is bewust NIET als test
// opgenomen: van buitenaf is er niets te simuleren dat een tweede sessie
// voorstelt zonder een eigen browser-tab, en het onderliggende gedrag
// ("laatste write wint") volgt al uit de gewone update-toets hieronder — een
// aparte test zou niets extra bewijzen.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl, type Dict } from '@/messages/nl'
import { en } from '@/messages/en'
import type { Oefening, TrainingOefeningWithData } from '@/lib/types'
import { concretiseerBezetting, type TrainingOefeningMetBezetting } from '@/lib/oefening-bezetting'
import OefeningPicker from '@/components/OefeningPicker'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import OefeningLibrary, { type OefeningWithUsage } from '@/components/OefeningLibrary'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

// ── Gedeelde Supabase-mock, exact het patroon van
// oefening-bibliotheek.acceptance.test.tsx:35-82. ──
type TableResult = { data?: unknown; error?: unknown; count?: number }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const calls = {
    insert: [] as { table: string; payload: Record<string, unknown> }[],
    update: [] as { table: string; payload: Record<string, unknown> }[],
    delete: [] as { table: string }[],
    eq: [] as { table: string; col: string; val: unknown }[],
  }
  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq']) {
      c[m] = () => c
    }
    c.eq = (col: string, val: unknown) => { calls.eq.push({ table, col, val }); return c }
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push({ table, payload }); return c }
    c.update = (payload: Record<string, unknown>) => { calls.update.push({ table, payload }); return c }
    c.delete = () => { calls.delete.push({ table }); return c }
    c.single = () => Promise.resolve(result)
    c.maybeSingle = () => Promise.resolve(result)
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
    return c
  }
  const supabase = {
    from: (t: string) => chain(t),
    auth: { getUser: async () => ({ data: { user } }) },
  }
  return { supabase, calls }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

function makeOefening(overrides: Partial<Oefening> = {}): Oefening {
  return {
    id: 'o1',
    team_id: 'team-1',
    naam: 'Rondo',
    beschrijving: null,
    categorie: 'partijen_klein',
    duur_min: null,
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

function makeKoppeling(overrides: Partial<TrainingOefeningWithData> & { oefening?: Partial<Oefening> } = {}): TrainingOefeningMetBezetting {
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
  opts: {
    eventId?: string
    library?: Oefening[]
    dict?: Dict
    suggestion?: { week: number; items: { key: string; step: number | null }[] }
  } = {},
) {
  return render(
    <DictProvider dict={opts.dict ?? nl}>
      <TrainingPlanEditor
        eventId={opts.eventId ?? 'e1'}
        initialDoelstelling={null}
        initialOefeningen={koppelingen}
        library={opts.library ?? []}
        currentSteps={{}}
        hasNulmeting={false}
        suggestion={opts.suggestion ?? null}
        players={[]}
        presentPlayerIds={[]}
        startTijd={null}
        kopieerOpties={[]} initialTrainingstype="vct"
      />
    </DictProvider>,
  )
}

function makeOefeningWithUsage(overrides: Partial<OefeningWithUsage> = {}): OefeningWithUsage {
  return { ...makeOefening(overrides), koppelingCount: 0, ...overrides }
}

function renderPicker(library: Oefening[], opts: { eventId?: string; dict?: Dict } = {}) {
  return render(
    <DictProvider dict={opts.dict ?? nl}>
      <OefeningPicker eventId={opts.eventId ?? 'e1'} library={library} onClose={vi.fn()} aanwezigAantal={0} />
    </DictProvider>,
  )
}

// Regex op het aria-label-PREFIX van `oefeningen.editAriaNamed` ("Oefening
// bewerken: {name}"), afgeleid van de dictionary zelf i.p.v. hardcoded — zo
// blijft de test gekoppeld aan de echte sleutel i.p.v. een eigen kopie van de
// Nederlandse tekst.
function editAriaPattern(dict: Dict): RegExp {
  const [prefix] = dict.oefeningen.editAriaNamed.split('{name}')
  return new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ────────────────────────────────────────────────
// AC1 — potlood op een gekoppelde oefening-kaart opent het bewerkformulier
// vooringevuld met alle velden.
// ────────────────────────────────────────────────
describe('AC1 — trainingskaart: potlood opent het bewerkformulier vooringevuld', () => {
  it('naam, beschrijving, categorie, duur, veldafmetingen, veldzone, teams/formaties/keeper, neutralen en diagram staan vooringevuld', () => {
    const oefening = makeOefening({
      id: 'o1',
      naam: 'Positiespel 7v7',
      beschrijving: 'Twee vakken met overtal',
      categorie: 'partijen_klein',
      duur_min: 25,
      breedte_m: 40,
      lengte_m: 60,
      veldzone: 'midden',
      teams: [
        { grootte: 7, formaties: ['2-3-1', '3-2-1'], keeperInGrootte: true },
        { grootte: 9, formaties: [], keeperInGrootte: false },
      ],
      aantal_neutralen: 2,
      diagram: { markers: [], materiaal: [], lijnen: [] },
    })
    const koppeling = makeKoppeling({ id: 'k1', oefening_id: 'o1', oefeningen: oefening })
    renderPlan([koppeling])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Positiespel 7v7')))

    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
    // Beslispunt 1-A: statische hint dat de wijziging overal doorwerkt.
    expect(screen.getByText(nl.oefeningen.editSharedHint)).toBeInTheDocument()

    // Gescoped op de editor-modal: de onderliggende trainingskaart heeft nu
    // óók een duurveld (deel B, trainingstype-en-koppeling-duur) dat toevallig
    // dezelfde waarde (25) kan tonen — zonder scope zou getByDisplayValue('25')
    // dus dubbel matchen.
    const editor = screen.getByText(nl.oefeningen.editTitle).closest('.relative') as HTMLElement
    expect(within(editor).getByLabelText(`${nl.trainingPlan.exerciseName} *`)).toHaveValue('Positiespel 7v7')
    expect(within(editor).getByDisplayValue('Twee vakken met overtal')).toBeInTheDocument()
    expect(within(editor).getByLabelText(nl.trainingPlan.category)).toHaveValue('partijen_klein')
    expect(within(editor).getByDisplayValue('25')).toBeInTheDocument() // duur_min
    expect(within(editor).getByDisplayValue('40')).toBeInTheDocument() // breedte_m
    expect(within(editor).getByDisplayValue('60')).toBeInTheDocument() // lengte_m
    expect(within(editor).getByRole('button', { name: nl.trainingPlan.fieldZones.midden })).toHaveClass('bg-warning')
    expect(within(editor).getByLabelText(nl.oefeningen.neutralsLabel)).toHaveValue(2)

    // Teams (2) + hun formaties.
    const teamSizeSelects = screen.getAllByLabelText(nl.oefeningen.teamSize)
    expect(teamSizeSelects).toHaveLength(2)
    expect(teamSizeSelects[0]).toHaveValue('7')
    expect(teamSizeSelects[1]).toHaveValue('9')
    expect(screen.getByRole('button', { name: '2-3-1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '3-2-1' })).toHaveAttribute('aria-pressed', 'false')

    // Keeper-schakelaar per team (team 1 mét, team 2 zonder keeper).
    const keeperGroups = screen.getAllByRole('group', { name: nl.oefeningen.keeperLabel })
    expect(keeperGroups).toHaveLength(2)
    expect(within(keeperGroups[0]).getByText(nl.oefeningen.keeperIncluded)).toHaveAttribute('aria-pressed', 'true')
    expect(within(keeperGroups[1]).getByText(nl.oefeningen.keeperExcluded)).toHaveAttribute('aria-pressed', 'true')

    // Tactiekbord-diagram: de opgeslagen tekening staat als voorbeeld klaar.
    expect(screen.getByLabelText(nl.oefeningen.diagramSection)).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC2 — geldige wijzigingen opslaan vanaf de trainingskaart: bibliotheek
// bijgewerkt, formulier sluit, kaart toont nieuwe gegevens zonder
// handmatige refresh (gesimuleerd via een verse `initialOefeningen`-prop,
// zoals de server na revalidatie zou leveren).
// ────────────────────────────────────────────────
describe('AC2 — trainingskaart: opslaan werkt de oefening bij en sluit het formulier', () => {
  it('roept de echte updateOefening aan; na sluiten toont de kaart de bijgewerkte naam zonder page-reload', async () => {
    const m = makeSupabase({
      tables: {
        oefeningen: { data: { id: 'o1' }, error: null },
        training_oefeningen: { data: [], error: null },
      },
    })
    use(m)
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo' })
    const koppeling = makeKoppeling({ id: 'k1', oefening_id: 'o1', oefeningen: oefening })
    const { rerender } = renderPlan([koppeling])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Rondo bijgewerkt' } })
    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() =>
      expect(m.calls.update.some((u) => u.table === 'oefeningen' && u.payload.naam === 'Rondo bijgewerkt')).toBe(true),
    )
    await waitFor(() => expect(screen.queryByText(nl.oefeningen.editTitle)).not.toBeInTheDocument())

    // Simuleert de door de server aangeleverde verse `initialOefeningen`-prop
    // ná revalidatie — geen handmatige refresh nodig.
    rerender(
      <DictProvider dict={nl}>
        <TrainingPlanEditor
          eventId="e1" initialDoelstelling={null}
          initialOefeningen={[makeKoppeling({ id: 'k1', oefening_id: 'o1', oefeningen: { ...oefening, naam: 'Rondo bijgewerkt' } })]}
          library={[]} currentSteps={{}} hasNulmeting={false} suggestion={null}
          players={[]} presentPlayerIds={[]} startTijd={null} kopieerOpties={[]} initialTrainingstype="vct"
        />
      </DictProvider>,
    )
    expect(screen.getAllByText('Rondo bijgewerkt').length).toBeGreaterThan(0)
  })
})

// ────────────────────────────────────────────────
// AC3 — potlood bij een oefening in de picker-lijst opent hetzelfde
// bewerkformulier, vooringevuld.
// ────────────────────────────────────────────────
describe('AC3 — picker: potlood op een rij opent hetzelfde bewerkformulier, vooringevuld', () => {
  it('editor vervangt de sheet-inhoud (pickerTitle weg), velden vooringevuld, hint zichtbaar', () => {
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo 4v2', beschrijving: 'Klein grid', categorie: 'partijen_klein', duur_min: 12 })
    renderPicker([oefening])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo 4v2')))

    expect(screen.queryByText(nl.oefeningen.pickerTitle)).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.editSharedHint)).toBeInTheDocument() // beslispunt 1-A
    expect(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`)).toHaveValue('Rondo 4v2')
    expect(screen.getByLabelText(nl.trainingPlan.category)).toHaveValue('partijen_klein')
    expect(screen.getByDisplayValue('Klein grid')).toBeInTheDocument()
    expect(screen.getByDisplayValue('12')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC4 — geldige wijzigingen opslaan vanaf de picker: bijgewerkt, en na
// sluiten van het formulier toont de picker-lijst de bijgewerkte gegevens
// (verse `library`-prop, picker blijft gemount).
// ────────────────────────────────────────────────
describe('AC4 — picker: opslaan werkt de oefening bij; lijst toont na sluiten de nieuwe gegevens', () => {
  it('roept de echte updateOefening aan; na sluiten staat de lijst er weer, een verse library-prop toont de nieuwe naam', async () => {
    const m = makeSupabase({
      tables: {
        oefeningen: { data: { id: 'o1' }, error: null },
        training_oefeningen: { data: [], error: null },
      },
    })
    use(m)
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo' })
    const { rerender } = renderPicker([oefening])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Rondo bijgewerkt' } })
    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() =>
      expect(m.calls.update.some((u) => u.table === 'oefeningen' && u.payload.naam === 'Rondo bijgewerkt')).toBe(true),
    )
    await waitFor(() => expect(screen.getByText(nl.oefeningen.pickerTitle)).toBeInTheDocument())

    rerender(
      <DictProvider dict={nl}>
        <OefeningPicker eventId="e1" library={[{ ...oefening, naam: 'Rondo bijgewerkt' }]} onClose={vi.fn()} aanwezigAantal={0} />
      </DictProvider>,
    )
    expect(screen.getByText('Rondo bijgewerkt')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC5 — verplicht veld leeg / ongeldige waarde: formulier blijft open, niets
// opgeslagen, bestaande validatiefeedback. Twee gevallen: client-side
// (naam leeg, knop disabled) en server-side (echte validateOefening-fout).
// ────────────────────────────────────────────────
describe('AC5 — verplicht veld leeg of ongeldige waarde: formulier blijft open, niets opgeslagen', () => {
  it('naam leegmaken schakelt de opslaan-knop client-side uit; er gebeurt geen server-call', () => {
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo' })
    const koppeling = makeKoppeling({ id: 'k1', oefening_id: 'o1', oefeningen: oefening })
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'o1' }, error: null } } })
    use(m)
    renderPlan([koppeling])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: '' } })

    expect(screen.getByText(nl.trainingPlan.save)).toBeDisabled()
    expect(m.calls.update).toHaveLength(0)
  })

  it('een ongeldige waarde die de UI niet blokkeert (bovengrens neutralen < aantal neutralen) faalt op de echte serverside validatie: formulier blijft open met de melding', async () => {
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo', aantal_neutralen: 0 })
    const koppeling = makeKoppeling({ id: 'k1', oefening_id: 'o1', oefeningen: oefening })
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'o1' }, error: null } } })
    use(m)
    renderPlan([koppeling])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    fireEvent.change(screen.getByLabelText(nl.oefeningen.neutralsLabel), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText(nl.oefeningen.neutralsMaxLabel), { target: { value: '2' } })
    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() => expect(screen.getByText('Bovengrens kleiner dan het aantal neutralen')).toBeInTheDocument())
    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
    expect(m.calls.update).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────
// AC6 — serverfout bij opslaan: generieke foutmelding (geen ruwe
// serverfout), formulier blijft open.
// ────────────────────────────────────────────────
describe('AC6 — serverfout bij opslaan: generieke melding, geen ruwe serverfout, formulier blijft open', () => {
  it('een echte DB-fout op de update wordt via genericError() vertaald naar de vaste, niet-onthullende melding', async () => {
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo' })
    const koppeling = makeKoppeling({ id: 'k1', oefening_id: 'o1', oefeningen: oefening })
    const m = makeSupabase({
      tables: {
        // assertOwnOefening kijkt alleen naar `data` (niet naar `error`) en
        // slaagt dus; de daaropvolgende .update()-call op dezelfde
        // tabelconfig faalt wél op `error`.
        oefeningen: { data: { id: 'o1' }, error: { message: 'column "foo" does not exist', code: '42703' } },
      },
    })
    use(m)
    renderPlan([koppeling])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() => expect(screen.getByText(GENERIC_ERROR_MESSAGE)).toBeInTheDocument())
    expect(screen.queryByText(/does not exist/)).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC7 — oefening van een ander team (gemanipuleerd verzoek): geweigerd,
// geen inzicht in andermans oefeningen. Dekt tegelijk het edge case uit
// vraag 7 (oefening tussen openen en opslaan al ontkoppeld/verwijderd,
// beslispunt 5-A): `assertOwnOefening` kan "bestaat niet" en "is van een
// ander team" niet uit elkaar houden, dus dat scenario loopt door exact
// hetzelfde faalpad — een los testgeval zou niets extra's bewijzen.
// ────────────────────────────────────────────────
describe('AC7 — oefening van een ander team (of tussentijds verwijderd): geweigerd, geen update, geen revalidatie', () => {
  it('Supabase geeft {data:null} voor `oefeningen`: assertOwnOefening weigert vóór de update', async () => {
    const oefening = makeOefening({ id: 'vreemd', naam: 'Andermans oefening' })
    const koppeling = makeKoppeling({ id: 'k1', oefening_id: 'vreemd', oefeningen: oefening })
    const m = makeSupabase({ tables: { oefeningen: { data: null } } })
    use(m)
    renderPlan([koppeling])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Andermans oefening')))
    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() => expect(screen.getByText('Oefening niet gevonden')).toBeInTheDocument())
    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────
// AC8 — annuleren vanaf beide entrypoints: niets opgeslagen, terug naar
// kaart resp. picker-lijst in ongewijzigde staat.
// ────────────────────────────────────────────────
describe('AC8 — annuleren vanaf beide entrypoints: niets opgeslagen, ongewijzigde staat', () => {
  it('trainingskaart: annuleren sluit de editor zonder call, de kaart toont nog de oude naam', () => {
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo' })
    const koppeling = makeKoppeling({ id: 'k1', oefening_id: 'o1', oefeningen: oefening })
    renderPlan([koppeling])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Andere naam' } })
    fireEvent.click(screen.getByText(nl.trainingPlan.cancel))

    expect(screen.queryByText(nl.oefeningen.editTitle)).not.toBeInTheDocument()
    // "Rondo" staat zowel in het scherm- als het print-only kopregel-element
    // (dual markup, zie de afdrukken-trainingsplan-feature) — getAllByText.
    expect(screen.getAllByText('Rondo').length).toBeGreaterThan(0)
    expect(screen.queryByText('Andere naam')).not.toBeInTheDocument()
  })

  it('picker: annuleren gaat terug naar de lijst met de filters nog intact, geen call', () => {
    renderPicker([
      makeOefening({ id: 'o1', naam: 'Rondo', categorie: 'partijen_klein' }),
      makeOefening({ id: 'o2', naam: 'Positiespel', categorie: 'positiespel' }),
    ])
    fireEvent.change(screen.getByLabelText(nl.oefeningen.filterCategoryLabel), { target: { value: 'partijen_klein' } })
    // Filter actief: precies één rij (Rondo) over — geteld via het aantal
    // potloden, want de categorie-tekst "Positiespel" staat ook als
    // dropdown-optie in de select en zou getByText/queryByText verstoren.
    expect(screen.getAllByLabelText(editAriaPattern(nl))).toHaveLength(1)

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    fireEvent.click(screen.getByText(nl.trainingPlan.cancel))

    expect(screen.getByText(nl.oefeningen.pickerTitle)).toBeInTheDocument()
    expect(screen.getAllByLabelText(editAriaPattern(nl))).toHaveLength(1) // filter nog actief
    expect(screen.getByText('Rondo')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC9 — oefening in meerdere trainingen: wijziging geldt voor alle
// trainingen (live referentie, geen kopie).
// ────────────────────────────────────────────────
describe('AC9 — oefening in meerdere trainingen: wijziging werkt overal door, geen kopie', () => {
  it('precies één update-rij in `oefeningen`, en revalidatie van élke gekoppelde trainingspagina', async () => {
    const m = makeSupabase({
      tables: {
        oefeningen: { data: { id: 'o1' }, error: null },
        training_oefeningen: { data: [{ event_id: 'e1' }, { event_id: 'e2' }], error: null },
      },
    })
    use(m)
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo' })
    const koppeling = makeKoppeling({ id: 'k1', oefening_id: 'o1', oefeningen: oefening })
    renderPlan([koppeling], { eventId: 'e1' })

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Rondo bijgewerkt' } })
    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() => expect(revalidatePath).toHaveBeenCalledWith('/events/e1/training-plan'))
    expect(revalidatePath).toHaveBeenCalledWith('/events/e2/training-plan')
    expect(revalidatePath).toHaveBeenCalledWith('/oefeningen')
    expect(m.calls.update.filter((u) => u.table === 'oefeningen')).toHaveLength(1)
    expect(m.calls.insert.some((i) => i.table === 'oefeningen')).toBe(false)
  })
})

// ────────────────────────────────────────────────
// AC10 — klik op de picker-rij zelf blijft "toevoegen aan training"; de
// bewerk-actie is een apart bedieningselement dat toevoegen niet per
// ongeluk triggert. Geen <button> genest in een <button>.
// ────────────────────────────────────────────────
describe('AC10 — picker: rij-klik blijft "toevoegen", potlood is een apart bedieningselement', () => {
  it('rij-klik roept de echte addOefeningToTraining aan (insert in training_oefeningen), niet updateOefening', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o1' } },
        training_oefeningen: { data: { volgorde: -1 }, error: null },
      },
    })
    use(m)
    renderPicker([makeOefening({ id: 'o1', naam: 'Rondo' })])

    fireEvent.click(screen.getByText('Rondo'))

    await waitFor(() => expect(m.calls.insert.some((i) => i.table === 'training_oefeningen')).toBe(true))
    expect(m.calls.update.some((u) => u.table === 'oefeningen')).toBe(false)
    expect(screen.queryByText(nl.oefeningen.editTitle)).not.toBeInTheDocument()
  })

  it('potlood-klik opent de bewerk-editor en triggert geen addOefeningToTraining', () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o1' } },
        training_oefeningen: { data: { volgorde: -1 }, error: null },
      },
    })
    use(m)
    renderPicker([makeOefening({ id: 'o1', naam: 'Rondo' })])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))

    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
    expect(m.calls.insert.some((i) => i.table === 'training_oefeningen')).toBe(false)
  })

  it('structuurcontract: geen <button> genest in een <button> (rij is een wrapper-div met twee zusterknoppen)', () => {
    const { container } = renderPicker([makeOefening({ id: 'o1', naam: 'Rondo' })])
    expect(container.querySelectorAll('button button').length).toBe(0)
  })
})

// ────────────────────────────────────────────────
// AC11 — na succesvol opslaan worden de bibliotheekpagina én elke
// trainingsplan-pagina met die oefening bijgewerkt (bestaand
// revalidatiegedrag van updateOefening). Inclusief het edge case "oefening
// zonder koppelingen" (dan alleen de bibliotheekpagina).
// ────────────────────────────────────────────────
describe('AC11 — revalidatie van de bibliotheekpagina en elke gekoppelde trainingspagina', () => {
  it('vanuit de picker: revalidatePath("/oefeningen") + revalidatePath per gekoppelde training', async () => {
    const m = makeSupabase({
      tables: {
        oefeningen: { data: { id: 'o1' }, error: null },
        training_oefeningen: { data: [{ event_id: 'e5' }], error: null },
      },
    })
    use(m)
    renderPicker([makeOefening({ id: 'o1', naam: 'Rondo' })])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() => expect(revalidatePath).toHaveBeenCalledWith('/oefeningen'))
    expect(revalidatePath).toHaveBeenCalledWith('/events/e5/training-plan')
  })

  it('edge case — oefening zonder koppelingen: alleen de bibliotheekpagina wordt gerevalideerd', async () => {
    const m = makeSupabase({
      tables: {
        oefeningen: { data: { id: 'o1' }, error: null },
        training_oefeningen: { data: [], error: null },
      },
    })
    use(m)
    renderPicker([makeOefening({ id: 'o1', naam: 'Rondo' })])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() => expect(revalidatePath).toHaveBeenCalledWith('/oefeningen'))
    expect(revalidatePath).not.toHaveBeenCalledWith(expect.stringMatching(/^\/events\//))
  })
})

// ────────────────────────────────────────────────
// Edge case (story) — "Eén editor tegelijk: editor open vanuit kaart +
// picker openen (of andersom) — geen geneste modals."
// ────────────────────────────────────────────────
describe('Edge case — geen geneste modals', () => {
  it('picker intern: bij het openen van de bewerk-editor verdwijnt pickerTitle volledig (editor vervangt de sheet, staat er nooit bovenop)', () => {
    renderPicker([makeOefening({ id: 'o1', naam: 'Rondo' })])
    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))

    expect(screen.queryByText(nl.oefeningen.pickerTitle)).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
  })

  it('trainingskaart: bewerken vanaf een kaart terwijl de picker openstaat sluit de picker eerst (nooit beide tegelijk)', () => {
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo' })
    const koppeling = makeKoppeling({ id: 'k1', oefening_id: 'o1', oefeningen: oefening })
    renderPlan([koppeling])

    fireEvent.click(screen.getAllByText(nl.trainingPlan.addExercise)[0])
    expect(screen.getByText(nl.oefeningen.pickerTitle)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))

    expect(screen.queryByText(nl.oefeningen.pickerTitle)).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
  })

  // Validator-bevinding 1 (ronde 1): het contract gold pas in één richting
  // (editor-open → picker-open sloot de editor niet). `openPicker` en
  // `openSuggestedPicker` zetten nu `setEditingOefening(null)`
  // (TrainingPlanEditor.tsx:146-155) — dit dekt de ontbrekende richting via
  // beide manieren om de picker te openen.
  it('trainingskaart: "+ Oefening toevoegen" klikken terwijl de editor openstaat sluit de editor eerst (nooit beide tegelijk)', () => {
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo' })
    const koppeling = makeKoppeling({ id: 'k1', oefening_id: 'o1', oefeningen: oefening })
    renderPlan([koppeling])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()

    fireEvent.click(screen.getAllByText(nl.trainingPlan.addExercise)[0])

    expect(screen.queryByText(nl.oefeningen.editTitle)).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.pickerTitle)).toBeInTheDocument()
  })

  it('trainingskaart: de cyclusweek-suggestieknop ("+ Voeg toe", openSuggestedPicker) sluit de openstaande editor eerst', () => {
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo' })
    const koppeling = makeKoppeling({ id: 'k1', oefening_id: 'o1', oefeningen: oefening })
    renderPlan([koppeling], { suggestion: { week: 2, items: [{ key: 'warming_up', step: 3 }] } })

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()

    fireEvent.click(screen.getByText(`+ ${nl.periodization.suggestAdd}`))

    expect(screen.queryByText(nl.oefeningen.editTitle)).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.pickerTitle)).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// Regressie (validator-aanbeveling 3, ronde 1) — beslispunt 1-A geeft de
// hint alleen mee vanuit TrainingPlanEditor en OefeningPicker, NIET vanuit
// OefeningLibrary (`components/OefeningLibrary.tsx:420` geeft geen `hint`-
// prop door aan `OefeningEditor`). AC1 (regel ~194) en AC3 (regel ~281)
// bewijzen al dat de hint WEL verschijnt vanaf de trainingskaart resp. de
// picker; dit blok bewijst het ontbreken ervan in de bibliotheekpagina zelf.
// ────────────────────────────────────────────────
describe('Regressie — OefeningLibrary geeft géén editSharedHint mee', () => {
  it('bewerken vanuit de bibliotheekpagina (potlood, editAria) toont het formulier ZONDER de gedeelde-hint-tekst', () => {
    const oefening = makeOefeningWithUsage({ id: 'o1', naam: 'Rondo' })
    render(
      <DictProvider dict={nl}>
        <OefeningLibrary oefeningen={[oefening]} />
      </DictProvider>,
    )

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAria))

    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
    expect(screen.queryByText(nl.oefeningen.editSharedHint)).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// Faalpaden via het picker-entrypoint (validator-aanbeveling 4, ronde 1) —
// AC6/AC7 waren tot nu toe alleen via de trainingskaart getest. `handleUpdate`
// in OefeningPicker.tsx:89-92 catcht de fout NIET zelf (OefeningEditor toont
// hem in zijn eigen banner) en roept `setEditing(null)` pas ná een geslaagde
// await aan — dus bij een fout blijft de editor open en springt de picker
// niet terug naar de lijst.
// ────────────────────────────────────────────────
describe('Faalpaden vanuit de picker (AC6/AC7 via het picker-entrypoint)', () => {
  it('AC6 via de picker: een echte DB-fout op de update toont de generieke melding, editor blijft open (geen sprong terug naar de lijst)', async () => {
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo' })
    const m = makeSupabase({
      tables: {
        // assertOwnOefening kijkt alleen naar `data` (niet naar `error`) en
        // slaagt dus; de daaropvolgende .update()-call op dezelfde
        // tabelconfig faalt wél op `error` (zelfde opzet als AC6 hierboven).
        oefeningen: { data: { id: 'o1' }, error: { message: 'column "foo" does not exist', code: '42703' } },
      },
    })
    use(m)
    renderPicker([oefening])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo')))
    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() => expect(screen.getByText(GENERIC_ERROR_MESSAGE)).toBeInTheDocument())
    expect(screen.queryByText(/does not exist/)).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
    expect(screen.queryByText(nl.oefeningen.pickerTitle)).not.toBeInTheDocument()
  })

  it('AC7 via de picker: een oefening van een ander team (of tussentijds verwijderd) wordt geweigerd, editor blijft open, geen update/revalidatie', async () => {
    const oefening = makeOefening({ id: 'vreemd', naam: 'Andermans oefening' })
    const m = makeSupabase({ tables: { oefeningen: { data: null } } })
    use(m)
    renderPicker([oefening])

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Andermans oefening')))
    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() => expect(screen.getByText('Oefening niet gevonden')).toBeInTheDocument())
    expect(screen.getByText(nl.oefeningen.editTitle)).toBeInTheDocument()
    expect(screen.queryByText(nl.oefeningen.pickerTitle)).not.toBeInTheDocument()
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────
// Edge case (story) — "Meertaligheid: knop/aria-tekst in alle 5 talen, ook
// als de knop meerdere keren op één scherm staat."  (Vijf talen zijn hier
// niet stuk voor stuk doorgemeten — dat is een i18n-volledigheidscheck, geen
// gedragscriterium — maar het gedrag met een niet-NL dictionary en met
// meerdere potloden tegelijk wordt hier wél bewezen.)
// ────────────────────────────────────────────────
describe('Edge case — meertaligheid en meerdere potloden op één scherm', () => {
  it('het aria-label van het potlood komt uit de actieve dictionary (en) en bevat de oefeningnaam', () => {
    const oefening = makeOefening({ id: 'o1', naam: 'Rondo' })
    const koppeling = makeKoppeling({ id: 'k1', oefening_id: 'o1', oefeningen: oefening })
    renderPlan([koppeling], { dict: en })

    expect(screen.getByLabelText(en.oefeningen.editAriaNamed.replace('{name}', 'Rondo'))).toBeInTheDocument()
  })

  it('meerdere oefening-kaarten op één scherm: elk potlood heeft zijn eigen aria-label en opent de bijbehorende oefening', () => {
    const o1 = makeOefening({ id: 'o1', naam: 'Rondo' })
    const o2 = makeOefening({ id: 'o2', naam: 'Positiespel' })
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'o1', oefeningen: o1 })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'o2', oefeningen: o2 })
    renderPlan([k1, k2])

    expect(screen.getAllByLabelText(editAriaPattern(nl))).toHaveLength(2)

    fireEvent.click(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Positiespel')))
    expect(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`)).toHaveValue('Positiespel')
  })
})
