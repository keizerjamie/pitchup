// Acceptatietests — Oefening-bibliotheek (user story: oefeningen opslaan in
// een herbruikbare bibliotheek, team-/formatiekeuzes, hergebruik in
// trainingen, live-koppeling i.p.v. snapshot).
//
// Dit bestand dekt de acceptatiecriteria (AC1-AC26 uit de goedgekeurde story)
// die NOG NIET door de bestaande tests werden gedekt. De al gedekte criteria
// (o.a. AC3, AC4, AC5, AC11, AC18, AC19, AC21) staan al aantoonbaar groen in:
//   - app/actions/oefening-library.test.ts
//   - app/actions/training-plan.test.ts
//   - lib/formations.test.ts / lib/periodization.test.ts
//   - components/OefeningEditor.test.tsx / OefeningLibrary.test.tsx / FormationField.test.tsx
// Zie het testverificatierapport voor de volledige criteria-op-test-mapping.
//
// Net als de bestaande action-tests wordt hier UITSLUITEND de Supabase-client
// (@/lib/supabase/server) gemockt — de server actions, validatie (lib/oefening,
// lib/authz, lib/periodization) en componenten draaien ongewijzigd, dus dit
// test het publieke gedrag "van buitenaf" (UI-interactie of het action-
// contract), niet losse interne functies.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { OefeningInput } from '@/lib/oefening'
import type { Oefening, TrainingOefeningWithData } from '@/lib/types'
import { formationsForSize } from '@/lib/types'
import FormationField from '@/components/FormationField'
import OefeningEditor from '@/components/OefeningEditor'
import OefeningPicker from '@/components/OefeningPicker'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import { countCategoryOccurrences } from '@/lib/periodization'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createOefening, updateOefening, countOefeningKoppelingen } from '@/app/actions/oefening-library'
import { addOefeningToTraining, updateKoppeling, saveSpelerindeling } from '@/app/actions/training-plan'

// ── Gedeelde Supabase-mock, zelfde patroon als de bestaande action-tests. ──
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

const baseInput = (over: Partial<OefeningInput> = {}): OefeningInput => ({
  naam: 'Rondo',
  categorie: 'partijen_klein',
  teams: [],
  aantal_neutralen: 0,
  ...over,
})

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

function makeKoppeling(overrides: Partial<TrainingOefeningWithData> & { oefening?: Partial<Oefening> } = {}): TrainingOefeningWithData {
  const { oefening, ...rest } = overrides
  return {
    id: 'k1',
    team_id: 'team-1',
    event_id: 'e1',
    oefening_id: 'o1',
    volgorde: 0,
    stap_override: null,
    genest_in: null,
    spelerindeling: [],
    created_at: '2024-01-01T00:00:00Z',
    oefeningen: makeOefening(oefening),
    ...rest,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ────────────────────────────────────────────────
// AC1 — nieuwe oefening opslaan → in de bibliotheek, zonder verplichte
// training-koppeling.
// ────────────────────────────────────────────────
describe('AC1 — oefening opslaan zonder verplichte training-koppeling', () => {
  it('createOefening slaagt zonder eventId-parameter en koppelt niets aan een training', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'new-id' }, error: null } } })
    use(m)
    const res = await createOefening(baseInput())
    expect(res).toEqual({ id: 'new-id' })
    expect(m.calls.insert.some((i) => i.table === 'training_oefeningen')).toBe(false)
  })
})

// ────────────────────────────────────────────────
// AC2 — team-/formatiekeuzes bewaard en getoond bij het heropenen van een
// bestaande oefening (bewerk-modus van OefeningEditor).
// ────────────────────────────────────────────────
describe('AC2 — team-/formatiekeuzes worden getoond bij het heropenen van een oefening', () => {
  it('OefeningEditor toont bij bewerken de opgeslagen teamgrootte, meerdere formaties (toggles aan) en aantal neutralen', () => {
    const existing = makeOefening({
      naam: 'Positiespel',
      teams: [{ grootte: 7, formaties: ['2-3-1', '3-2-1'] }],
      aantal_neutralen: 2,
    })
    render(
      <DictProvider dict={nl}>
        <OefeningEditor initial={existing} onCancel={vi.fn()} onSubmit={vi.fn().mockResolvedValue(undefined)} />
      </DictProvider>,
    )
    expect((screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`) as HTMLInputElement).value).toBe('Positiespel')
    expect((screen.getAllByLabelText(nl.oefeningen.teamSize)[0] as HTMLSelectElement).value).toBe('7')
    expect(screen.getByRole('button', { name: '2-3-1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '3-2-1' })).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText(nl.oefeningen.neutralsLabel) as HTMLInputElement).value).toBe('2')
  })
})

// ────────────────────────────────────────────────
// AC6 / AC12 / AC13 — bestaande bibliotheek-oefening aan een training
// koppelen (geen kopie), toegang alleen tot eigen team, "niet gevonden" bij
// onbestaande/verwijderde oefening.
// ────────────────────────────────────────────────
describe('AC6 — bestaande bibliotheek-oefening toevoegen aan een training, geen aparte kopie', () => {
  it('addOefeningToTraining koppelt het bestaande id, zonder nieuwe rij in `oefeningen`', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o1' } },
        training_oefeningen: { data: { volgorde: -1 }, error: null },
      },
    })
    use(m)
    await addOefeningToTraining('e1', 'o1')
    expect(m.calls.insert.some((i) => i.table === 'oefeningen')).toBe(false)
    const link = m.calls.insert.find((i) => i.table === 'training_oefeningen')!
    expect(link.payload.oefening_id).toBe('o1')
  })

  it('(UI) klikken op een bibliotheek-item roept de echte addOefeningToTraining aan, niet createAndAddOefening', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o1' } },
        training_oefeningen: { data: { volgorde: -1 }, error: null },
      },
    })
    use(m)
    const library = [makeOefening({ id: 'o1', naam: 'Rondo 4v2' })]
    const onClose = vi.fn()
    render(
      <DictProvider dict={nl}>
        <OefeningPicker eventId="e1" library={library} onClose={onClose} />
      </DictProvider>,
    )
    fireEvent.click(screen.getByText('Rondo 4v2'))
    await waitFor(() => expect(m.calls.insert.some((i) => i.table === 'training_oefeningen')).toBe(true))
    expect(m.calls.insert.some((i) => i.table === 'oefeningen')).toBe(false)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('(UI) "+ Nieuwe oefening aanmaken" maakt een bibliotheek-item aan én koppelt het meteen', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'new-1' }, error: null },
        training_oefeningen: { data: { volgorde: -1 }, error: null },
      },
    })
    use(m)
    const onClose = vi.fn()
    render(
      <DictProvider dict={nl}>
        <OefeningPicker eventId="e1" library={[]} onClose={onClose} />
      </DictProvider>,
    )
    fireEvent.click(screen.getByText(nl.oefeningen.pickerCreateNew))
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Sprint 30m' } })
    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(m.calls.insert.some((i) => i.table === 'oefeningen')).toBe(true))
    await waitFor(() => expect(
      m.calls.insert.some((i) => i.table === 'training_oefeningen' && i.payload.oefening_id === 'new-1'),
    ).toBe(true))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('(UI) trainingsschema toont de opgeslagen team-/formatiekeuzes van de gekoppelde oefening', () => {
    const koppeling = makeKoppeling({
      oefening: { naam: 'Positiespel', teams: [{ grootte: 6, formaties: ['3-2'] }] },
    })
    render(
      <DictProvider dict={nl}>
        <TrainingPlanEditor
          eventId="e1" initialDoelstelling={null} initialOefeningen={[koppeling]} library={[]}
          currentSteps={{}} hasNulmeting={false} suggestion={null}
          players={[]} presentPlayerIds={[]}
        />
      </DictProvider>,
    )
    // TrainingPlanEditor rendert de naam twee keer in de DOM (een
    // scherm-variant en een print-only kopregel, zie TrainingPlanEditor.tsx)
    // — jsdom past geen `print:`-media toe, dus beide zijn hier tegelijk
    // aanwezig. Zonder duur/afmetingen/stap (zoals in deze fixture) is de
    // print-kopregel nu kaal de naam (categorie is er bewust uitgehaald,
    // print-review FOUT2), dus die twee knopen hebben hier toevallig
    // identieke tekst. `getAllByText` i.p.v. `getByText` om dat te
    // verdragen — zelfde patroon als poolLabel/poolLabelPrint elders.
    expect(screen.getAllByText('Positiespel').length).toBeGreaterThan(0)
    expect(screen.getByText('6 · 3-2')).toBeInTheDocument()
  })
})

describe('AC12 — bibliotheek-oefening van een ander team: geen toegang (behandeld als niet gevonden)', () => {
  it('addOefeningToTraining met andermans oefening-id geeft "Oefening niet gevonden" en voegt niets toe', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } }, oefeningen: { data: null } },
    })
    use(m)
    await expect(addOefeningToTraining('e1', 'vreemd')).rejects.toThrow('Oefening niet gevonden')
    expect(m.calls.insert.some((i) => i.table === 'training_oefeningen')).toBe(false)
  })
})

describe('AC13 — niet-bestaande/verwijderde oefening aan een training toevoegen', () => {
  it('geeft "niet gevonden" en er wordt niets ingevoegd', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } }, oefeningen: { data: null } },
    })
    use(m)
    await expect(addOefeningToTraining('e1', 'verwijderd-id')).rejects.toThrow('niet gevonden')
    expect(m.calls.insert).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────
// AC7 / AC15 — wijzigingen in de bibliotheek zijn live overal zichtbaar,
// óók in historische trainingen (geen snapshot).
// ────────────────────────────────────────────────
describe('AC7/AC15 — wijzigingen in een bibliotheek-oefening zijn direct overal zichtbaar (geen snapshot)', () => {
  it('updateOefening revalidateert de bibliotheek én elke gekoppelde training (ook oudere)', async () => {
    const m = makeSupabase({
      tables: {
        oefeningen: { data: { id: 'o1' }, error: null },
        training_oefeningen: { data: [{ event_id: 'e-oud' }, { event_id: 'e-nieuw' }], error: null },
      },
    })
    use(m)
    await updateOefening('o1', baseInput({ naam: 'Nieuwe naam' }))
    expect(revalidatePath).toHaveBeenCalledWith('/oefeningen')
    expect(revalidatePath).toHaveBeenCalledWith('/events/e-oud/training-plan')
    expect(revalidatePath).toHaveBeenCalledWith('/events/e-nieuw/training-plan')
  })

  it('updateOefening schrijft alleen de rij in `oefeningen`, nooit in `training_oefeningen` (geen kopie/snapshot)', async () => {
    const m = makeSupabase({
      tables: { oefeningen: { data: { id: 'o1' }, error: null }, training_oefeningen: { data: [], error: null } },
    })
    use(m)
    await updateOefening('o1', baseInput({ naam: 'Andere naam' }))
    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].table).toBe('oefeningen')
  })
})

// ────────────────────────────────────────────────
// AC8 / AC17 — volgorde/stap_override/genest_in zijn training-specifiek: ze
// raken nooit de bibliotheek-oefening of een andere training/koppeling, en
// nesten kan alleen binnen dezelfde training.
// ────────────────────────────────────────────────
describe('AC8/AC17 — volgorde/stap_override/genest_in zijn training-specifiek', () => {
  it('updateKoppeling raakt alleen `training_oefeningen`, nooit de bibliotheektabel `oefeningen`', async () => {
    const m = makeSupabase({ tables: { training_oefeningen: { data: { id: 'k1' }, error: null } } })
    use(m)
    await updateKoppeling('k1', 'e1', { volgorde: 3 })
    expect(m.calls.update.every((u) => u.table === 'training_oefeningen')).toBe(true)
  })

  it('weigert nesting in zichzelf', async () => {
    use(makeSupabase())
    await expect(updateKoppeling('k1', 'e1', { genest_in: 'k1' })).rejects.toThrow('Kan niet in zichzelf nesten')
  })

  it('weigert nesting naar een koppeling die niet in deze training/dit team bestaat', async () => {
    use(makeSupabase({ tables: { training_oefeningen: { data: null } } }))
    await expect(updateKoppeling('k1', 'e1', { genest_in: 'ander-event-koppeling' }))
      .rejects.toThrow('Ongeldige nesting')
  })

  it('(UI) stap-override wijzigen op één oefening in de training raakt alleen die koppeling', async () => {
    const m = makeSupabase({ tables: { training_oefeningen: { data: { id: 'k1' }, error: null } } })
    use(m)
    const koppelingA = makeKoppeling({ id: 'k1', oefening: { naam: 'Oefening A' } })
    const koppelingB = makeKoppeling({ id: 'k2', oefening_id: 'o2', oefening: { naam: 'Oefening B' } })
    render(
      <DictProvider dict={nl}>
        <TrainingPlanEditor
          eventId="e1" initialDoelstelling={null} initialOefeningen={[koppelingA, koppelingB]} library={[]}
          currentSteps={{}} hasNulmeting={false} suggestion={null}
          players={[]} presentPlayerIds={[]}
        />
      </DictProvider>,
    )
    // partijen_klein heeft stap-inhoud (heeftStapInhoud), dus het stapveld
    // staat al direct op de kaart — geen "Bewerken"-klik meer nodig. Beide
    // koppelingen tonen zo'n veld (zelfde placeholder "auto"), dus scopen op
    // de kaart van k1 via zijn eigen data-testid om ondubbelzinnig het juiste
    // veld te raken (anders "Found multiple elements").
    const stepInput = within(screen.getByTestId('stap-inhoud-k1')).getByPlaceholderText(nl.trainingPlan.stepAuto)
    fireEvent.change(stepInput, { target: { value: '9' } })

    await waitFor(() => expect(m.calls.update.some((u) => u.table === 'training_oefeningen')).toBe(true))
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'id', val: 'k1' })
    expect(m.calls.eq.some((e) => e.col === 'id' && e.val === 'k2')).toBe(false)
  })
})

// ────────────────────────────────────────────────
// AC8/AC17 (vervolg) — de training-specifieke spelerindeling is ook
// training-specifiek: saveSpelerindeling schrijft alleen in de koppeltabel
// `training_oefeningen`, nooit in de bibliotheektabel `oefeningen`.
// ────────────────────────────────────────────────
describe('AC8/AC17 — spelerindeling raakt alleen de koppeling, nooit de bibliotheek-oefening', () => {
  it('saveSpelerindeling schrijft uitsluitend in training_oefeningen', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: {
          data: { id: 'k1', oefeningen: { teams: [{ grootte: 6, formaties: [] }, { grootte: 6, formaties: [] }] } },
          error: null,
        },
        players: { data: [{ id: 'p1' }, { id: 'p2' }] },
      },
    })
    use(m)
    await saveSpelerindeling('k1', 'e1', [['p1'], ['p2']])
    expect(m.calls.update.every((u) => u.table === 'training_oefeningen')).toBe(true)
    expect(m.calls.update.some((u) => u.table === 'oefeningen')).toBe(false)
  })
})

// ────────────────────────────────────────────────
// AC10 — dubbele oefeningnamen binnen een team toegestaan.
// ────────────────────────────────────────────────
describe('AC10 — dubbele oefeningnamen binnen hetzelfde team toegestaan', () => {
  it('twee oefeningen met dezelfde naam kunnen allebei worden aangemaakt', async () => {
    const m1 = makeSupabase({ tables: { oefeningen: { data: { id: 'a' }, error: null } } })
    use(m1)
    await expect(createOefening(baseInput({ naam: 'Rondo' }))).resolves.toEqual({ id: 'a' })

    const m2 = makeSupabase({ tables: { oefeningen: { data: { id: 'b' }, error: null } } })
    use(m2)
    await expect(createOefening(baseInput({ naam: 'Rondo' }))).resolves.toEqual({ id: 'b' })
  })
})

// ────────────────────────────────────────────────
// AC14 — bibliotheek-oefening is niet gebonden aan één training: nul, één of
// meer koppelingen zijn allemaal geldig.
// ────────────────────────────────────────────────
describe('AC14 — bibliotheek-oefening niet gebonden aan één training (0/1/N koppelingen)', () => {
  it('countOefeningKoppelingen geeft 0 terug wanneer de oefening nergens gekoppeld is', async () => {
    use(makeSupabase({ tables: { training_oefeningen: { count: 0 } } }))
    await expect(countOefeningKoppelingen('o1')).resolves.toBe(0)
  })

  it('countOefeningKoppelingen geeft het exacte aantal training-koppelingen terug', async () => {
    use(makeSupabase({ tables: { training_oefeningen: { count: 4 } } }))
    await expect(countOefeningKoppelingen('o1')).resolves.toBe(4)
  })
})

// ────────────────────────────────────────────────
// AC16 — periodiserings-/trainingslogtelling telt de KOPPELING; wijziging
// aan naam/beschrijving/formatie verandert de telling niet, loskoppelen wél.
// ────────────────────────────────────────────────
describe('AC16 — periodiseringstelling telt de koppeling, niet naam/beschrijving/formatie', () => {
  it('telling blijft gelijk ongeacht naam/beschrijving/team-data op de gejoinde oefening', async () => {
    const before = makeSupabase({
      tables: {
        events: { data: [{ id: 't1' }] },
        training_oefeningen: {
          data: [{ event_id: 't1', oefeningen: { categorie: 'partijen_groot', naam: 'Rondo', beschrijving: 'v1', teams: [{ grootte: 6, formaties: ['3-2'] }] } }],
        },
      },
    })
    const occBefore = await countCategoryOccurrences(before.supabase as unknown as SupabaseClient, 'team-1', '2026-01-01', '2026-02-01')

    const after = makeSupabase({
      tables: {
        events: { data: [{ id: 't1' }] },
        training_oefeningen: {
          data: [{ event_id: 't1', oefeningen: { categorie: 'partijen_groot', naam: 'Andere naam', beschrijving: 'v2', teams: [{ grootte: 4, formaties: ['2-1'] }] } }],
        },
      },
    })
    const occAfter = await countCategoryOccurrences(after.supabase as unknown as SupabaseClient, 'team-1', '2026-01-01', '2026-02-01')

    expect(occBefore.partijen_groot).toBe(1)
    expect(occAfter.partijen_groot).toBe(1)
  })

  it('loskoppelen van de oefening (koppeling weg) verlaagt de telling wél', async () => {
    const withLink = makeSupabase({
      tables: {
        events: { data: [{ id: 't1' }] },
        training_oefeningen: { data: [{ event_id: 't1', oefeningen: { categorie: 'partijen_groot' } }] },
      },
    })
    const occWithLink = await countCategoryOccurrences(withLink.supabase as unknown as SupabaseClient, 'team-1', '2026-01-01', '2026-02-01')
    expect(occWithLink.partijen_groot).toBe(1)

    const withoutLink = makeSupabase({
      tables: {
        events: { data: [{ id: 't1' }] },
        training_oefeningen: { data: [] }, // na removeOefeningFromTraining bestaat de rij niet meer
      },
    })
    const occWithoutLink = await countCategoryOccurrences(withoutLink.supabase as unknown as SupabaseClient, 'team-1', '2026-01-01', '2026-02-01')
    expect(occWithoutLink.partijen_groot ?? 0).toBe(0)
  })
})

// ────────────────────────────────────────────────
// AC20 — formatie is uitsluitend de vorm per team (visueel), nooit
// individuele spelers.
// ────────────────────────────────────────────────
describe('AC20 — formatie is alleen de vorm per team (visueel), nooit individuele spelers', () => {
  it('formatieposities uit de catalogus bevatten geen speler-koppeling (geen player_id)', () => {
    for (const n of [3, 4, 5, 6, 7, 8, 9, 11]) {
      for (const f of formationsForSize(n)) {
        for (const pos of f.positions) {
          expect('player_id' in pos).toBe(false)
        }
      }
    }
  })

  it('FormationField rendert de formatie read-only: geen klikbare/interactieve spelerselectie', () => {
    const positions = formationsForSize(6).find((f) => f.key === '3-2')!.positions
    render(<FormationField positions={positions} label="6 · 3-2" />)
    const field = screen.getByTestId('formation-field')
    expect(field.querySelectorAll('button, input, select')).toHaveLength(0)
  })
})
