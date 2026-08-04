// Acceptatietests — Oefening-picker filters (user story: filterrij in de
// "oefening toevoegen aan training"-bottom-sheet: categorie, veldzone,
// aantal spelers (min/max), duur (min/max), combineren met AND, ook met de
// bestaande naam-zoekbalk).
//
// Dit bestand dekt de 18 goedgekeurde acceptatiecriteria (AC1-AC18), stuk
// voor stuk, en test VAN BUITENAF: we renderen de echte oudercomponent
// TrainingPlanEditor, openen de picker zoals een gebruiker dat doet (klik op
// "+ Oefening toevoegen"), en simuleren interacties via testing-library op
// de zichtbare DOM (selects, inputs, kaarten, meldingen). We testen dus geen
// interne functies van lib/oefening-filter.ts of losse componentprops.
//
// Bewust NIET hetzelfde als:
//  - components/OefeningPicker.test.tsx (component-tests van de
//    frontend-engineer, rendert OefeningPicker rechtstreeks met de
//    actions-module gemockt — dat zijn geen acceptatietests).
//  - oefening-bibliotheek.acceptance.test.tsx (dekt de bredere
//    bibliotheek-story, niet deze filter-feature).
// Om AC16 (filters resetten bij sluiten/heropenen) écht van buitenaf te
// kunnen bewijzen, moet de picker via zijn ouder ge(de)mount worden — vandaar
// TrainingPlanEditor als ingang i.p.v. OefeningPicker rechtstreeks.
//
// Net als de bestaande acceptatietests wordt uitsluitend de Supabase-client
// (@/lib/supabase/server) gemockt; de echte server actions en componenten
// draaien ongewijzigd.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Oefening } from '@/lib/types'
import { OEFENING_CATEGORIES, VALID_VELDZONES } from '@/lib/types'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'

// ── Zelfde Supabase-mock-patroon als oefening-bibliotheek.acceptance.test.tsx. ──
type TableResult = { data?: unknown; error?: unknown; count?: number }

function makeSupabase(opts: { tables?: Record<string, TableResult> } = {}) {
  const tables = opts.tables ?? {}
  const calls = { insert: [] as { table: string; payload: Record<string, unknown> }[] }
  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq', 'eq']) {
      c[m] = () => c
    }
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push({ table, payload }); return c }
    c.single = () => Promise.resolve(result)
    c.maybeSingle = () => Promise.resolve(result)
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
    return c
  }
  const supabase = {
    from: (t: string) => chain(t),
    auth: { getUser: async () => ({ data: { user: { id: 'team-1' } } }) },
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

function renderEditor(library: Oefening[]) {
  render(
    <DictProvider dict={nl}>
      <TrainingPlanEditor
        eventId="e1"
        initialDoelstelling={null}
        initialOefeningen={[]}
        library={library}
        currentSteps={{}}
        hasNulmeting={false}
        suggestion={null}
        players={[]}
        presentPlayerIds={[]}
      />
    </DictProvider>,
  )
}

// De picker wordt met twee identieke "+ Oefening toevoegen"-knoppen
// aangeboden (koptekst-link + onderste dashed-knop, beide roepen dezelfde
// openPicker() aan) — pak de eerste.
function openPicker() {
  fireEvent.click(screen.getAllByRole('button', { name: nl.trainingPlan.addExercise })[0])
  expect(screen.getByText(nl.oefeningen.pickerTitle)).toBeInTheDocument()
}

function closePicker() {
  const header = screen.getByText(nl.oefeningen.pickerTitle).closest('div')!
  fireEvent.click(within(header).getByRole('button'))
}

function categorieSelect() {
  return screen.getByLabelText(nl.oefeningen.filterCategoryLabel) as HTMLSelectElement
}
function veldzoneSelect() {
  return screen.getByLabelText(nl.oefeningen.filterZoneLabel) as HTMLSelectElement
}
function aantalMinInput() {
  return screen.getByLabelText(`${nl.oefeningen.filterCountLabel} ${nl.oefeningen.filterMinPlaceholder}`) as HTMLInputElement
}
function aantalMaxInput() {
  return screen.getByLabelText(`${nl.oefeningen.filterCountLabel} ${nl.oefeningen.filterMaxPlaceholder}`) as HTMLInputElement
}
function duurMinInput() {
  return screen.getByLabelText(`${nl.oefeningen.filterDurationLabel} ${nl.oefeningen.filterMinPlaceholder}`) as HTMLInputElement
}
function duurMaxInput() {
  return screen.getByLabelText(`${nl.oefeningen.filterDurationLabel} ${nl.oefeningen.filterMaxPlaceholder}`) as HTMLInputElement
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ────────────────────────────────────────────────
// AC1 — Filter op categorie → toont alleen oefeningen met exact die categorie.
// ────────────────────────────────────────────────
describe('AC1 — filter op categorie toont alleen exacte match', () => {
  it('selecteren van een categorie sluit andere categorieën uit', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Rondo klein', categorie: 'partijen_klein' }),
      makeOefening({ id: 'o2', naam: 'Positiespel groot', categorie: 'positiespel' }),
    ])
    openPicker()
    fireEvent.change(categorieSelect(), { target: { value: 'positiespel' } })
    expect(screen.queryByText('Rondo klein')).not.toBeInTheDocument()
    expect(screen.getByText('Positiespel groot')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC2 — Filter op veldzone → toont alleen oefeningen met exact die veldzone.
// ────────────────────────────────────────────────
describe('AC2 — filter op veldzone toont alleen exacte match', () => {
  it('selecteren van een veldzone sluit andere zones uit', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Links oefenen', veldzone: 'links' }),
      makeOefening({ id: 'o2', naam: 'Rechts oefenen', veldzone: 'rechts' }),
    ])
    openPicker()
    fireEvent.change(veldzoneSelect(), { target: { value: 'rechts' } })
    expect(screen.queryByText('Links oefenen')).not.toBeInTheDocument()
    expect(screen.getByText('Rechts oefenen')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC3 — Filter op aantallen (min/max, grenzen inclusief), werkt ook met
// alleen min of alleen max.
// ────────────────────────────────────────────────
describe('AC3 — filter op aantal spelers (bereik, inclusief, alleen-min/alleen-max)', () => {
  it('alleen min ingevuld sluit alles onder de grens uit, grens zelf telt mee', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Klein (5)', teams: [{ grootte: 4, formaties: [] }], aantal_neutralen: 1 }),
      makeOefening({ id: 'o2', naam: 'Grens (6)', teams: [{ grootte: 6, formaties: [] }], aantal_neutralen: 0 }),
      makeOefening({ id: 'o3', naam: 'Groot (10)', teams: [{ grootte: 10, formaties: [] }], aantal_neutralen: 0 }),
    ])
    openPicker()
    fireEvent.change(aantalMinInput(), { target: { value: '6' } })
    expect(screen.queryByText('Klein (5)')).not.toBeInTheDocument()
    expect(screen.getByText('Grens (6)')).toBeInTheDocument()
    expect(screen.getByText('Groot (10)')).toBeInTheDocument()
  })

  it('alleen max ingevuld sluit alles boven de grens uit, grens zelf telt mee', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Klein (5)', teams: [{ grootte: 5, formaties: [] }], aantal_neutralen: 0 }),
      makeOefening({ id: 'o2', naam: 'Grens (6)', teams: [{ grootte: 6, formaties: [] }], aantal_neutralen: 0 }),
      makeOefening({ id: 'o3', naam: 'Groot (10)', teams: [{ grootte: 10, formaties: [] }], aantal_neutralen: 0 }),
    ])
    openPicker()
    fireEvent.change(aantalMaxInput(), { target: { value: '6' } })
    expect(screen.getByText('Klein (5)')).toBeInTheDocument()
    expect(screen.getByText('Grens (6)')).toBeInTheDocument()
    expect(screen.queryByText('Groot (10)')).not.toBeInTheDocument()
  })

  it('min én max samen tonen alleen het gesloten bereik, beide grenzen inclusief', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Onder', teams: [{ grootte: 3, formaties: [] }], aantal_neutralen: 0 }),
      makeOefening({ id: 'o2', naam: 'Ondergrens', teams: [{ grootte: 4, formaties: [] }], aantal_neutralen: 0 }),
      makeOefening({ id: 'o3', naam: 'Bovengrens', teams: [{ grootte: 8, formaties: [] }], aantal_neutralen: 0 }),
      makeOefening({ id: 'o4', naam: 'Boven', teams: [{ grootte: 9, formaties: [] }], aantal_neutralen: 0 }),
    ])
    openPicker()
    fireEvent.change(aantalMinInput(), { target: { value: '4' } })
    fireEvent.change(aantalMaxInput(), { target: { value: '8' } })
    expect(screen.queryByText('Onder')).not.toBeInTheDocument()
    expect(screen.getByText('Ondergrens')).toBeInTheDocument()
    expect(screen.getByText('Bovengrens')).toBeInTheDocument()
    expect(screen.queryByText('Boven')).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC4 — Filter op duur (min/max in minuten), zelfde bereiklogica.
// ────────────────────────────────────────────────
describe('AC4 — filter op duur (bereik in minuten, inclusief, alleen-min/alleen-max)', () => {
  it('alleen min ingevuld sluit kortere duur uit, grens telt mee', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Kort', duur_min: 5 }),
      makeOefening({ id: 'o2', naam: 'Grens', duur_min: 10 }),
      makeOefening({ id: 'o3', naam: 'Lang', duur_min: 20 }),
    ])
    openPicker()
    fireEvent.change(duurMinInput(), { target: { value: '10' } })
    expect(screen.queryByText('Kort')).not.toBeInTheDocument()
    expect(screen.getByText('Grens')).toBeInTheDocument()
    expect(screen.getByText('Lang')).toBeInTheDocument()
  })

  it('min én max samen tonen alleen het gesloten duur-bereik', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Kort', duur_min: 4 }),
      makeOefening({ id: 'o2', naam: 'Ondergrens', duur_min: 5 }),
      makeOefening({ id: 'o3', naam: 'Bovengrens', duur_min: 15 }),
      makeOefening({ id: 'o4', naam: 'Lang', duur_min: 16 }),
    ])
    openPicker()
    fireEvent.change(duurMinInput(), { target: { value: '5' } })
    fireEvent.change(duurMaxInput(), { target: { value: '15' } })
    expect(screen.queryByText('Kort')).not.toBeInTheDocument()
    expect(screen.getByText('Ondergrens')).toBeInTheDocument()
    expect(screen.getByText('Bovengrens')).toBeInTheDocument()
    expect(screen.queryByText('Lang')).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC5 — Alle actieve filters combineren met AND.
// ────────────────────────────────────────────────
describe('AC5 — actieve filters combineren met AND', () => {
  it('categorie + veldzone + aantal + duur samen tonen alleen de volledige doorsnede', () => {
    renderEditor([
      makeOefening({
        id: 'o1', naam: 'Match', categorie: 'positiespel', veldzone: 'midden',
        teams: [{ grootte: 6, formaties: [] }], aantal_neutralen: 0, duur_min: 15,
      }),
      makeOefening({ // verkeerde categorie, rest klopt
        id: 'o2', naam: 'Verkeerde categorie', categorie: 'partijen_klein', veldzone: 'midden',
        teams: [{ grootte: 6, formaties: [] }], aantal_neutralen: 0, duur_min: 15,
      }),
      makeOefening({ // verkeerde veldzone, rest klopt
        id: 'o3', naam: 'Verkeerde zone', categorie: 'positiespel', veldzone: 'links',
        teams: [{ grootte: 6, formaties: [] }], aantal_neutralen: 0, duur_min: 15,
      }),
      makeOefening({ // buiten aantalbereik
        id: 'o4', naam: 'Verkeerd aantal', categorie: 'positiespel', veldzone: 'midden',
        teams: [{ grootte: 20, formaties: [] }], aantal_neutralen: 0, duur_min: 15,
      }),
      makeOefening({ // buiten duurbereik
        id: 'o5', naam: 'Verkeerde duur', categorie: 'positiespel', veldzone: 'midden',
        teams: [{ grootte: 6, formaties: [] }], aantal_neutralen: 0, duur_min: 60,
      }),
    ])
    openPicker()
    fireEvent.change(categorieSelect(), { target: { value: 'positiespel' } })
    fireEvent.change(veldzoneSelect(), { target: { value: 'midden' } })
    fireEvent.change(aantalMinInput(), { target: { value: '4' } })
    fireEvent.change(aantalMaxInput(), { target: { value: '8' } })
    fireEvent.change(duurMinInput(), { target: { value: '10' } })
    fireEvent.change(duurMaxInput(), { target: { value: '20' } })

    expect(screen.getByText('Match')).toBeInTheDocument()
    expect(screen.queryByText('Verkeerde categorie')).not.toBeInTheDocument()
    expect(screen.queryByText('Verkeerde zone')).not.toBeInTheDocument()
    expect(screen.queryByText('Verkeerd aantal')).not.toBeInTheDocument()
    expect(screen.queryByText('Verkeerde duur')).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC6 — Naam-zoekbalk combineert ook met AND t.o.v. actieve filters.
// ────────────────────────────────────────────────
describe('AC6 — naam-zoekbalk combineert met AND t.o.v. filters', () => {
  it('zoekterm + categorie tonen alleen de doorsnede', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Rondo groot', categorie: 'positiespel' }),
      makeOefening({ id: 'o2', naam: 'Rondo klein', categorie: 'partijen_klein' }),
      makeOefening({ id: 'o3', naam: 'Positiespel apart', categorie: 'positiespel' }),
    ])
    openPicker()
    fireEvent.change(screen.getByPlaceholderText(nl.oefeningen.pickerSearchPlaceholder), { target: { value: 'rondo' } })
    fireEvent.change(categorieSelect(), { target: { value: 'positiespel' } })
    expect(screen.getByText('Rondo groot')).toBeInTheDocument()
    expect(screen.queryByText('Rondo klein')).not.toBeInTheDocument()
    expect(screen.queryByText('Positiespel apart')).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC7 — Elk filterveld heeft precies ÉÉN actieve waarde/bereik per keer
// (geen multi-select).
// ────────────────────────────────────────────────
describe('AC7 — elk filterveld is single-value, geen multi-select', () => {
  it('categorie- en veldzone-select zijn geen multi-select elementen', () => {
    renderEditor([makeOefening()])
    openPicker()
    expect(categorieSelect().multiple).toBe(false)
    expect(veldzoneSelect().multiple).toBe(false)
  })

  it('een nieuwe categoriekeuze vervangt de vorige i.p.v. toe te voegen', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Klein-item', categorie: 'partijen_klein' }),
      makeOefening({ id: 'o2', naam: 'Positie-item', categorie: 'positiespel' }),
    ])
    openPicker()
    fireEvent.change(categorieSelect(), { target: { value: 'partijen_klein' } })
    expect(screen.getByText('Klein-item')).toBeInTheDocument()
    expect(screen.queryByText('Positie-item')).not.toBeInTheDocument()
    // Wisselen naar een andere categorie: alleen de nieuwe match blijft over,
    // 'partijen_klein' wordt niet ook nog "erbij" gefilterd.
    fireEvent.change(categorieSelect(), { target: { value: 'positiespel' } })
    expect(screen.queryByText('Klein-item')).not.toBeInTheDocument()
    expect(screen.getByText('Positie-item')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC8 — Filter terugzetten naar "geen filter" → toont weer de (evt. op naam
// gefilterde) volledige bibliotheek.
// ────────────────────────────────────────────────
describe('AC8 — filter terugzetten naar "geen filter" toont de volledige (of naam-gefilterde) lijst', () => {
  it('categorie terugzetten naar "— alle —" toont weer alles', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Rondo', categorie: 'partijen_klein' }),
      makeOefening({ id: 'o2', naam: 'Balbezitoefening', categorie: 'positiespel' }),
    ])
    openPicker()
    fireEvent.change(categorieSelect(), { target: { value: 'positiespel' } })
    expect(screen.queryByText('Rondo')).not.toBeInTheDocument()
    fireEvent.change(categorieSelect(), { target: { value: '' } })
    expect(screen.getByText('Rondo')).toBeInTheDocument()
    expect(screen.getByText('Balbezitoefening')).toBeInTheDocument()
  })

  it('aantal-bereik wissen (min/max leeg) i.c.m. actieve zoekterm toont weer de naam-gefilterde lijst', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Rondo groot', teams: [{ grootte: 10, formaties: [] }] }),
      makeOefening({ id: 'o2', naam: 'Rondo klein', teams: [{ grootte: 2, formaties: [] }] }),
    ])
    openPicker()
    fireEvent.change(screen.getByPlaceholderText(nl.oefeningen.pickerSearchPlaceholder), { target: { value: 'rondo' } })
    fireEvent.change(aantalMinInput(), { target: { value: '9' } })
    expect(screen.queryByText('Rondo klein')).not.toBeInTheDocument()
    fireEvent.change(aantalMinInput(), { target: { value: '' } })
    expect(screen.getByText('Rondo groot')).toBeInTheDocument()
    expect(screen.getByText('Rondo klein')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC9 — Regressie: selecteren/toevoegen van een oefening verandert niet.
// addOefeningToTraining wordt nog aangeroepen, onClose nog getriggerd.
// ────────────────────────────────────────────────
describe('AC9 — regressie: oefening toevoegen werkt nog zoals voorheen', () => {
  it('klikken op een kaart (ook na filteren) koppelt de oefening en sluit de picker', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o1' } },
        training_oefeningen: { data: { volgorde: -1 }, error: null },
      },
    })
    use(m)
    renderEditor([makeOefening({ id: 'o1', naam: 'Rondo 4v2', categorie: 'positiespel' })])
    openPicker()
    fireEvent.change(categorieSelect(), { target: { value: 'positiespel' } })
    fireEvent.click(screen.getByText('Rondo 4v2'))
    // Picker is dicht: titel niet meer op het scherm (onClose is getriggerd).
    await waitFor(() => expect(screen.queryByText(nl.oefeningen.pickerTitle)).not.toBeInTheDocument())
    const link = m.calls.insert.find((i) => i.table === 'training_oefeningen')
    expect(link?.payload.oefening_id).toBe('o1')
  })
})

// ────────────────────────────────────────────────
// AC10 — Filters+zoekbalk leveren geen match op → pickerEmpty (niet
// pickerEmptyLibrary).
// ────────────────────────────────────────────────
describe('AC10 — geen match bij gevulde bibliotheek toont pickerEmpty, niet pickerEmptyLibrary', () => {
  it('filter zonder resultaat toont de juiste "geen resultaten"-melding', () => {
    renderEditor([makeOefening({ id: 'o1', naam: 'Rondo', categorie: 'partijen_klein' })])
    openPicker()
    fireEvent.change(categorieSelect(), { target: { value: 'positiespel' } })
    expect(screen.getByText(nl.oefeningen.pickerEmpty)).toBeInTheDocument()
    expect(screen.queryByText(nl.oefeningen.pickerEmptyLibrary)).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC11 — Lege bibliotheek → pickerEmptyLibrary; filters hebben dan geen effect.
// ────────────────────────────────────────────────
describe('AC11 — lege bibliotheek toont pickerEmptyLibrary, filters zonder effect', () => {
  it('library=[] toont pickerEmptyLibrary, ook met een ingevuld filter', () => {
    renderEditor([])
    openPicker()
    expect(screen.getByText(nl.oefeningen.pickerEmptyLibrary)).toBeInTheDocument()
    fireEvent.change(categorieSelect(), { target: { value: 'positiespel' } })
    fireEvent.change(aantalMinInput(), { target: { value: '5' } })
    expect(screen.getByText(nl.oefeningen.pickerEmptyLibrary)).toBeInTheDocument()
    expect(screen.queryByText(nl.oefeningen.pickerEmpty)).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC12 — Categoriefilter alleen vaste OEFENING_CATEGORIES, veldzonefilter
// alleen VALID_VELDZONES — geen vrije tekst.
// ────────────────────────────────────────────────
describe('AC12 — filtervelden bieden uitsluitend de vaste whitelist, geen vrije tekst', () => {
  it('categorie-select bevat exact OEFENING_CATEGORIES + "alle"-optie', () => {
    renderEditor([makeOefening()])
    openPicker()
    const values = Array.from(categorieSelect().options).map((o) => o.value)
    expect(values).toEqual(['', ...OEFENING_CATEGORIES])
    expect(categorieSelect().tagName).toBe('SELECT') // geen vrij-tekstveld
  })

  it('veldzone-select bevat exact VALID_VELDZONES + "alle"-optie', () => {
    renderEditor([makeOefening()])
    openPicker()
    const values = Array.from(veldzoneSelect().options).map((o) => o.value)
    expect(values).toEqual(['', ...VALID_VELDZONES])
    expect(veldzoneSelect().tagName).toBe('SELECT')
  })
})

// ────────────────────────────────────────────────
// AC13 — Som voor aantallen-filter = uitsluitend teams[].grootte +
// aantal_neutralen (niets anders, zoals duur/afmetingen).
// ────────────────────────────────────────────────
describe('AC13 — aantallen-som is uitsluitend teams[].grootte + aantal_neutralen', () => {
  it('grote duur/veldafmetingen tellen niet mee in het aantallen-bereik', () => {
    renderEditor([
      makeOefening({
        id: 'o1', naam: 'Groot veld klein team', teams: [{ grootte: 2, formaties: [] }],
        aantal_neutralen: 0, breedte_m: 90, lengte_m: 120, duur_min: 90,
      }),
      makeOefening({
        id: 'o2', naam: 'Team van drie', teams: [{ grootte: 3, formaties: [] }],
        aantal_neutralen: 0, breedte_m: null, lengte_m: null, duur_min: 5,
      }),
    ])
    openPicker()
    fireEvent.change(aantalMinInput(), { target: { value: '2' } })
    fireEvent.change(aantalMaxInput(), { target: { value: '2' } })
    expect(screen.getByText('Groot veld klein team')).toBeInTheDocument()
    expect(screen.queryByText('Team van drie')).not.toBeInTheDocument()
  })

  it('meerdere teams tellen samen op met aantal_neutralen', () => {
    renderEditor([
      makeOefening({
        id: 'o1', naam: 'Twee teams plus neutralen',
        teams: [{ grootte: 4, formaties: [] }, { grootte: 3, formaties: [] }], aantal_neutralen: 2, // 4+3+2=9
      }),
    ])
    openPicker()
    fireEvent.change(aantalMinInput(), { target: { value: '9' } })
    fireEvent.change(aantalMaxInput(), { target: { value: '9' } })
    expect(screen.getByText('Twee teams plus neutralen')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC14 — Filtering blijft binnen de al team-gescoped bibliotheek.
// Structureel geborgd (geen nieuwe data-fetch), zie rapport: niet apart
// end-to-end op componentniveau te testen. Proxy-check hieronder: filteren
// triggert geen enkele Supabase-aanroep (bewijst althans dat er geen nieuwe
// fetch bijkomt tijdens filteren binnen deze component).
// ────────────────────────────────────────────────
describe('AC14 — filtering blijft binnen de al geladen, team-gescoped bibliotheek', () => {
  it('filteren doet geen enkele Supabase-aanroep (geen nieuwe data-fetch, puur client-side op de meegegeven `library`-prop)', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Rondo', categorie: 'partijen_klein', veldzone: 'links', duur_min: 10 }),
    ])
    openPicker()
    fireEvent.change(categorieSelect(), { target: { value: 'partijen_klein' } })
    fireEvent.change(veldzoneSelect(), { target: { value: 'links' } })
    fireEvent.change(aantalMinInput(), { target: { value: '0' } })
    fireEvent.change(duurMinInput(), { target: { value: '5' } })
    expect(createClient).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────
// AC15 — Oefening zonder veldzone/duur_min (null): ALTIJD UITGESLOTEN zodra
// het betreffende filter actief is.
// ────────────────────────────────────────────────
describe('AC15 — null veldzone/duur_min wordt altijd uitgesloten zodra dat filter actief is', () => {
  it('veldzone: null verdwijnt zodra een veldzone geselecteerd wordt', () => {
    renderEditor([makeOefening({ id: 'o1', naam: 'Zonder zone', veldzone: null })])
    openPicker()
    expect(screen.getByText('Zonder zone')).toBeInTheDocument()
    fireEvent.change(veldzoneSelect(), { target: { value: 'links' } })
    expect(screen.queryByText('Zonder zone')).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.pickerEmpty)).toBeInTheDocument()
  })

  it('duur_min: null verdwijnt zodra een duurgrens ingevuld wordt (ook grens 0)', () => {
    renderEditor([makeOefening({ id: 'o1', naam: 'Zonder duur', duur_min: null })])
    openPicker()
    expect(screen.getByText('Zonder duur')).toBeInTheDocument()
    fireEvent.change(duurMinInput(), { target: { value: '0' } })
    expect(screen.queryByText('Zonder duur')).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.pickerEmpty)).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC16 — Filters resetten naar leeg zodra de picker gesloten en heropend
// wordt (unmount/remount-gedrag, via TrainingPlanEditor's conditionele render).
// ────────────────────────────────────────────────
describe('AC16 — filters resetten bij sluiten en heropenen van de picker', () => {
  it('een actief categoriefilter is weg na sluiten + heropenen; volledige lijst weer zichtbaar', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Rondo', categorie: 'partijen_klein' }),
      makeOefening({ id: 'o2', naam: 'Balbezitoefening', categorie: 'positiespel' }),
    ])
    openPicker()
    fireEvent.change(categorieSelect(), { target: { value: 'positiespel' } })
    expect(screen.queryByText('Rondo')).not.toBeInTheDocument()
    closePicker()
    expect(screen.queryByText(nl.oefeningen.pickerTitle)).not.toBeInTheDocument()

    openPicker()
    expect((categorieSelect()).value).toBe('')
    expect(screen.getByText('Rondo')).toBeInTheDocument()
    expect(screen.getByText('Balbezitoefening')).toBeInTheDocument()
  })

  it('ook aantal/duur-bereiken en de zoekbalk staan weer leeg na heropenen', () => {
    renderEditor([makeOefening({ id: 'o1', naam: 'Rondo', duur_min: 10, teams: [{ grootte: 6, formaties: [] }] })])
    openPicker()
    fireEvent.change(screen.getByPlaceholderText(nl.oefeningen.pickerSearchPlaceholder), { target: { value: 'iets anders' } })
    fireEvent.change(aantalMinInput(), { target: { value: '5' } })
    fireEvent.change(duurMaxInput(), { target: { value: '5' } })
    closePicker()
    openPicker()
    expect((screen.getByPlaceholderText(nl.oefeningen.pickerSearchPlaceholder) as HTMLInputElement).value).toBe('')
    expect(aantalMinInput().value).toBe('')
    expect(duurMaxInput().value).toBe('')
    expect(screen.getByText('Rondo')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC17 — Lege teams-array telt voor het aantallen-filter als 0 +
// aantal_neutralen.
// ────────────────────────────────────────────────
describe('AC17 — lege teams-array telt als 0 + aantal_neutralen', () => {
  it('oefening zonder teams maar met neutralen matcht op dat aantal', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Alleen neutralen', teams: [], aantal_neutralen: 3 }),
    ])
    openPicker()
    fireEvent.change(aantalMinInput(), { target: { value: '3' } })
    fireEvent.change(aantalMaxInput(), { target: { value: '3' } })
    expect(screen.getByText('Alleen neutralen')).toBeInTheDocument()
  })

  it('oefening zonder teams en zonder neutralen (totaal 0) matcht op bereik [0,0], niet op [1,5]', () => {
    renderEditor([
      makeOefening({ id: 'o1', naam: 'Helemaal leeg', teams: [], aantal_neutralen: 0 }),
    ])
    openPicker()
    fireEvent.change(aantalMinInput(), { target: { value: '0' } })
    fireEvent.change(aantalMaxInput(), { target: { value: '0' } })
    expect(screen.getByText('Helemaal leeg')).toBeInTheDocument()
    fireEvent.change(aantalMinInput(), { target: { value: '1' } })
    fireEvent.change(aantalMaxInput(), { target: { value: '5' } })
    expect(screen.queryByText('Helemaal leeg')).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC18 — Bereik met min > max levert nul matches op, geen foutmelding.
// ────────────────────────────────────────────────
describe('AC18 — min > max levert nul matches op zonder foutmelding', () => {
  it('aantal: min > max toont pickerEmpty, geen genericError', () => {
    renderEditor([makeOefening({ id: 'o1', naam: 'Rondo', teams: [{ grootte: 4, formaties: [] }] })])
    openPicker()
    fireEvent.change(aantalMinInput(), { target: { value: '10' } })
    fireEvent.change(aantalMaxInput(), { target: { value: '2' } })
    expect(screen.getByText(nl.oefeningen.pickerEmpty)).toBeInTheDocument()
    expect(screen.queryByText(nl.oefeningen.genericError)).not.toBeInTheDocument()
  })

  it('duur: min > max toont pickerEmpty, geen foutmelding', () => {
    renderEditor([makeOefening({ id: 'o1', naam: 'Rondo', duur_min: 10 })])
    openPicker()
    fireEvent.change(duurMinInput(), { target: { value: '20' } })
    fireEvent.change(duurMaxInput(), { target: { value: '5' } })
    expect(screen.getByText(nl.oefeningen.pickerEmpty)).toBeInTheDocument()
    expect(screen.queryByText(nl.oefeningen.genericError)).not.toBeInTheDocument()
  })
})
