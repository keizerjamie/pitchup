// Acceptatietests — Kleine teamgroottes (1 en 2 spelers) bij het samenstellen
// van een oefening (user story: "Als een trainer wil ik teams van 1 of 2
// spelers kunnen instellen bij het samenstellen van een oefening, zodat ik
// ook kleine oefenvormen (bijvoorbeeld 1v1 of 2v2) met neutralen kan
// indelen, wat nu niet mogelijk is.").
//
// Dit is een ONAFHANKELIJKE verificatie (test-verifier), geschreven los van
// de test-aannames van backend- en frontend-engineer. Elk blok hieronder
// verwijst naar het genummerde acceptatiecriterium (AC1-AC11) uit de
// goedgekeurde story. Getest van buitenaf:
//   - UI-flow via OefeningEditor (React Testing Library), zoals een trainer
//     de editor gebruikt.
//   - UI-flow via TeamIndelingEditor, zoals een trainer spelers indeelt.
//   - Het publieke server-action-contract (createOefening), met UITSLUITEND
//     de Supabase-client (@/lib/supabase/server) gemockt — de echte validatie
//     (lib/oefening.ts, lib/formaties.ts) draait ongewijzigd.
//
// Verwachte gedragingen worden waar mogelijk vanuit eerste principes herleid
// (bv. "veldspelers = grootte - keeper" en "partijen_groot vereist V>=1,
// M>=1, A>=1, dus minimaal 3 veldspelers") in plaats van simpelweg dezelfde
// bibliotheekfunctie aan te roepen die de productiecode ook gebruikt — zo
// toetst dit bestand het gedrag, niet de implementatie.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { OefeningInput } from '@/lib/oefening'
import type { OefeningTeam, Player } from '@/lib/types'
import { OEFENING_CATEGORIES } from '@/lib/types'
import { VALID_TEAM_SIZES, formatiesVoorTeam } from '@/lib/formaties'
import OefeningEditor from '@/components/OefeningEditor'
import TeamIndelingEditor from '@/components/TeamIndelingEditor'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/app/actions/training-plan', () => ({
  saveSpelerindeling: vi.fn().mockResolvedValue(undefined),
}))

import { createClient } from '@/lib/supabase/server'
import { createOefening } from '@/app/actions/oefening-library'
import { saveSpelerindeling } from '@/app/actions/training-plan'

// ── Gedeelde Supabase-mock, zelfde patroon als de bestaande
// action-/acceptatietests (oefening-formatie-catalogus.acceptance.test.tsx). ──
type TableResult = { data?: unknown; error?: unknown; count?: number }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const calls = {
    insert: [] as { table: string; payload: Record<string, unknown> }[],
  }
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
    auth: { getUser: async () => ({ data: { user } }) },
  }
  return { supabase, calls }
}

function useSupabase(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

const baseInput = (over: Partial<OefeningInput> = {}): OefeningInput => ({
  naam: 'Rondo',
  categorie: 'partijen_klein',
  teams: [],
  aantal_neutralen: 0,
  ...over,
})

function renderEditor() {
  const onCancel = vi.fn()
  render(
    <DictProvider dict={nl}>
      <OefeningEditor onCancel={onCancel} onSubmit={createOefening} />
    </DictProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════
// AC1 — Teamgrootte-keuzelijst toont 1 en 2 naast de bestaande 3-11.
// ════════════════════════════════════════════════════════════════════════
describe('AC1 — teamgrootte-keuzelijst bevat 1 en 2 naast 3-11', () => {
  it('de select toont exact de opties 1 t/m 11, in oplopende volgorde', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    const select = screen.getAllByLabelText(nl.oefeningen.teamSize)[0]

    const values = within(select)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== '') // "— geen —"-placeholder overslaan

    expect(values).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'])
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC2/AC3 — Teamgrootte 2 resp. 1 kiezen en opslaan → slaagt, geen
// 'Ongeldige teamgrootte'-fout.
// ════════════════════════════════════════════════════════════════════════
describe('AC2/AC3 — teamgrootte 2 of 1 kiezen en opslaan slaagt zonder foutmelding', () => {
  it.each([2, 1])('AC2/AC3: grootte %i opslaan slaagt, geen "Ongeldige teamgrootte"', async (grootte) => {
    const mock = makeSupabase({ tables: { oefeningen: { data: { id: 'nieuw-id' }, error: null } } })
    useSupabase(mock)
    renderEditor()

    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: `Kleine vorm ${grootte}` } })
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: String(grootte) } })

    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() => expect(mock.calls.insert).toHaveLength(1))
    expect(mock.calls.insert[0].payload.teams).toEqual([
      { grootte, formaties: [], keeperInGrootte: true },
    ])
    // Geen enkele foutmelding zichtbaar, met name niet de validatiefout die
    // vóór deze feature bij grootte 1/2 zou zijn opgetreden.
    expect(screen.queryByText('Ongeldige teamgrootte')).not.toBeInTheDocument()
    expect(screen.queryByText(nl.oefeningen.genericError)).not.toBeInTheDocument()
  })

  // AC4 + AC2 gecombineerd: bij grootte 2 zonder keeper is er (zoals AC4
  // aantoont) minstens één beschikbare formatie; dit blok bewijst dat een
  // daadwerkelijk GEKOZEN formatie-chip ('1-1', d.w.z. 1 verdediger + 1
  // aanvaller) ook echt wordt opgeslagen en canoniek genormaliseerd — precies
  // hetzelfde pad dat voor grootte 6 al bewezen is in
  // app/actions/oefening-library.test.ts:94-102 ("slaat een binnengekomen
  // label canoniek op als key"). Tot nu toe gebruikten alle server-tests voor
  // de nieuwe groottes een lege formatie-selectie (`formaties: []`); dit is
  // de ontbrekende variant met een echt gekozen formatie.
  it('AC2+AC4: grootte 2 zonder keeper, gekozen formatie "1-1" wordt opgeslagen als canonieke key "1-0-1"', async () => {
    // Eerst vaststellen dat '1-1' (label voor v=1,a=1) daadwerkelijk in de
    // catalogus zit voor dit team+deze categorie — geen giswerk over de key.
    const team = { grootte: 2 as const, keeperInGrootte: false }
    const beschikbaar = formatiesVoorTeam(team, 'partijen_klein')
    const gekozen = beschikbaar.find((f) => f.label === '1-1')
    expect(gekozen).toBeDefined()

    const mock = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    useSupabase(mock)
    await createOefening(baseInput({
      categorie: 'partijen_klein',
      teams: [{ grootte: 2, keeperInGrootte: false, formaties: [gekozen!.label] }],
    }))

    expect(mock.calls.insert[0].payload.teams).toEqual([
      { grootte: 2, formaties: ['1-0-1'], keeperInGrootte: false },
    ])
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC4 — Team grootte 2, keeper uit, categorie ≠ partijen_groot → minstens
// één beschikbare formatie (geen disabled "geen formaties beschikbaar").
// ════════════════════════════════════════════════════════════════════════
describe('AC4 — grootte 2, keeper uit, niet-partijen_groot: minstens één formatie beschikbaar', () => {
  it('toont een gevulde formatie-chipgroep, geen disabled leeg-status', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'partijen_klein' } })
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '2' } })

    const keeperGroup = screen.getByRole('group', { name: nl.oefeningen.keeperLabel })
    fireEvent.click(within(keeperGroup).getByRole('button', { name: nl.oefeningen.keeperExcluded }))

    expect(screen.queryByTestId('geen-formaties-0')).not.toBeInTheDocument()
    const group = screen.getByRole('group', { name: nl.oefeningen.formation })
    const opties = within(group).getAllByRole('button')
    expect(opties.length).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC5 — Team grootte 1 of 2 → neutralen indelen (spelers toewijzen) in
// TeamIndelingEditor werkt zoals bij elke andere teamgrootte.
// ════════════════════════════════════════════════════════════════════════
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

describe('AC5 — teamindeling bij grootte 1/2 werkt zoals bij elke andere teamgrootte', () => {
  const players: Player[] = [
    makePlayer({ id: 'p1', name: 'Piet Peters', jersey_number: 1 }),
    makePlayer({ id: 'p2', name: 'Jan Jansen', jersey_number: 2 }),
    makePlayer({ id: 'p3', name: 'Kees Klaassen', jersey_number: 3 }),
  ]
  const teams: OefeningTeam[] = [
    { grootte: 1, formaties: [] },
    { grootte: 2, formaties: [] },
  ]

  function renderIndeling() {
    render(
      <DictProvider dict={nl}>
        <TeamIndelingEditor
          koppelingId="k1"
          eventId="e1"
          teams={teams}
          initialIndeling={[]}
          players={players}
          presentPlayerIds={['p1', 'p2', 'p3']}
        />
      </DictProvider>,
    )
  }

  it('een speler naar het grootte-1-team slepen/klikken plaatst hem daar, net als bij elke andere teamgrootte', async () => {
    renderIndeling()
    // Teamkaart toont normaal de grootte (geen "losse plaatsing"-uitzondering).
    expect(screen.getByText(`Team 1 · 1`)).toBeInTheDocument()
    expect(screen.getByText(`Team 2 · 2`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Piet/ }))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 1')))

    expect(screen.getByText('Piet')).toBeInTheDocument()
    await waitFor(() => expect(saveSpelerindeling).toHaveBeenCalledWith('k1', 'e1', [['p1'], []]))
    // Precies gevuld (1/1): geen "meer spelers dan teamgrootte"-waarschuwing.
    expect(screen.queryByText(nl.teamIndeling.sizeWarning.replace('{n}', '1'))).not.toBeInTheDocument()
  })

  it('een tweede speler aan hetzelfde grootte-1-team toevoegen toont dezelfde overvol-waarschuwing als bij elke andere teamgrootte', async () => {
    renderIndeling()
    fireEvent.click(screen.getByRole('button', { name: /Piet/ }))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 1')))
    await waitFor(() => expect(saveSpelerindeling).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /Jan/ }))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 1')))
    await waitFor(() => expect(saveSpelerindeling).toHaveBeenCalledWith('k1', 'e1', [['p1', 'p2'], []]))

    expect(screen.getByText(nl.teamIndeling.sizeWarning.replace('{n}', '1'))).toBeInTheDocument()
  })

  it('het grootte-2-team accepteert twee spelers zonder waarschuwing, een derde geeft wel de waarschuwing', async () => {
    renderIndeling()
    fireEvent.click(screen.getByRole('button', { name: /Piet/ }))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 2')))
    await waitFor(() => expect(saveSpelerindeling).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /Jan/ }))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 2')))
    await waitFor(() => expect(saveSpelerindeling).toHaveBeenCalledWith('k1', 'e1', [[], ['p1', 'p2']]))
    expect(screen.queryByText(nl.teamIndeling.sizeWarning.replace('{n}', '2'))).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Kees/ }))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 2')))
    await waitFor(() => expect(saveSpelerindeling).toHaveBeenCalledWith('k1', 'e1', [[], ['p1', 'p2', 'p3']]))
    expect(screen.getByText(nl.teamIndeling.sizeWarning.replace('{n}', '2'))).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC6 — Teamgrootte buiten toegestaan bereik (bv. 0 of 12) → geweigerd met
// bestaande foutmelding 'Ongeldige teamgrootte' — ongewijzigd.
// ════════════════════════════════════════════════════════════════════════
describe('AC6 — teamgrootte buiten 1-11 wordt geweigerd (ongewijzigd faalpad)', () => {
  it.each([0, 12])('grootte %i wordt geweigerd met "Ongeldige teamgrootte", geen insert uitgevoerd', async (grootte) => {
    const mock = makeSupabase()
    useSupabase(mock)
    await expect(createOefening(baseInput({ teams: [{ grootte, formaties: [] }] })))
      .rejects.toThrow('Ongeldige teamgrootte')
    expect(mock.calls.insert).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC7 — Team grootte 1, keeper AAN → in élke categorie 0 veldspelers, dus de
// disabled "geen formaties beschikbaar"-status.
// ════════════════════════════════════════════════════════════════════════
describe('AC7 — grootte 1 + keeper aan: in elke categorie 0 veldspelers, dus disabled', () => {
  it.each(OEFENING_CATEGORIES)('categorie %s: geen formatie-chipgroep, wel de disabled-status', (categorie) => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: categorie } })
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '1' } })
    // Keeper staat standaard "aan" (inclusief) — geen extra klik nodig.
    const keeperGroup = screen.getByRole('group', { name: nl.oefeningen.keeperLabel })
    expect(within(keeperGroup).getByRole('button', { name: nl.oefeningen.keeperIncluded })).toHaveAttribute('aria-pressed', 'true')

    expect(screen.queryByRole('group', { name: nl.oefeningen.formation })).not.toBeInTheDocument()
    const status = screen.getByTestId('geen-formaties-0')
    expect(status).toHaveTextContent(nl.oefeningen.noFormationsAvailable)
    expect(status).toHaveAttribute('aria-disabled', 'true')
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC8 — Team grootte 1 of 2 (met of zonder keeper) in categorie
// "partijen_groot" → disabled "geen formaties beschikbaar"-status
// (rekenkundig onmogelijk: minimaal 3 veldspelers nodig voor V>=1,M>=1,A>=1).
// ════════════════════════════════════════════════════════════════════════
describe('AC8 — grootte 1/2 in partijen_groot is altijd onmogelijk (min. 3 veldspelers nodig)', () => {
  const scenarios = [
    { grootte: 1, keeperUit: false },
    { grootte: 1, keeperUit: true },
    { grootte: 2, keeperUit: false },
    { grootte: 2, keeperUit: true },
  ]

  it.each(scenarios)('grootte $grootte, keeperUit=$keeperUit, partijen_groot: disabled-status', ({ grootte, keeperUit }) => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    // Standaardcategorie van de editor is al 'partijen_groot'.
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: String(grootte) } })
    if (keeperUit) {
      const keeperGroup = screen.getByRole('group', { name: nl.oefeningen.keeperLabel })
      fireEvent.click(within(keeperGroup).getByRole('button', { name: nl.oefeningen.keeperExcluded }))
    }

    expect(screen.queryByRole('group', { name: nl.oefeningen.formation })).not.toBeInTheDocument()
    const status = screen.getByTestId('geen-formaties-0')
    expect(status).toHaveTextContent(nl.oefeningen.noFormationsAvailable)
    expect(status).toHaveAttribute('aria-disabled', 'true')
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC9 — VALID_TEAM_SIZES is de enige bron van waarheid: UI, server-validatie
// én diagram-filter lezen er allemaal uit.
// ════════════════════════════════════════════════════════════════════════
describe('AC9 — VALID_TEAM_SIZES is uitgebreid naar [1..11] en wordt door alle drie de lezers gebruikt', () => {
  it('de bron van waarheid zelf is [1,2,...,11] (lib/formaties.ts:33)', () => {
    expect(VALID_TEAM_SIZES).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  // UI-lezer: al aangetoond in AC1 (select toont 1-11).
  // Server-validatie-lezer: al aangetoond in AC2/AC3 (accepteert) en AC6 (weigert).
  // Hieronder de derde lezer die de brief noemt: het diagram-filter
  // (lib/diagram.ts: `VALID_TEAM_SIZES.includes(team.grootte)`), end-to-end via
  // de UI: een team van grootte 2 mag vóór deze feature nooit in de tekening
  // verschijnen kunnen (grootte 2 was geen geldige teamgrootte); nu wél.
  it('diagram-filter: een team van grootte 2 wordt niet uitgefilterd en levert exact 2 markers op de tekening', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'overig' } })
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '2' } })

    // Tekening openen laat het diagram automatisch genereren uit de teams.
    // De knoptekst bevat een ▸/▾-prefix, vandaar een substring-matcher.
    fireEvent.click(screen.getByText((content) => content.includes(nl.oefeningen.diagramToggle)))

    const markers = screen.getAllByTestId(/^diagram-marker-\d+$/)
    expect(markers).toHaveLength(2)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC10 — Geen database-migratie nodig (geen CHECK-constraint op grootte).
// ════════════════════════════════════════════════════════════════════════
// NIET NETJES VAN BUITENAF TE DEKKEN MET EEN ACCEPTATIETEST: dit is een
// negatieve/infrastructurele bewering over het DB-schema ("er is geen
// CHECK-constraint"), niet een gedrag dat via de UI of een server action
// waarneembaar is — de mocked-Supabase-opzet in dit bestand raakt de echte
// database sowieso niet, dus een groene test hier zou niets bewijzen over
// het schema. Geverifieerd via CODE-INSPECTIE (geen test, geen work-around):
//   - supabase/training-plan.sql:48 — `teams JSONB NOT NULL DEFAULT '[]'
//     CHECK (jsonb_array_length(teams) <= 6)` — alleen een grens op het AANTAL
//     teams, niet op de `grootte` van een individueel team.
//   - supabase/oefening-bibliotheek.sql:14-21 — voegt `teams` en de
//     `oefeningen_teams_max`-constraint toe (idem, alleen array-lengte); geen
//     constraint op `grootte`.
// Er is dus geen migratie nodig en geen bestaand schema-object dat déze
// wijziging zou blokkeren of raken.

// ════════════════════════════════════════════════════════════════════════
// AC11 — Bovengrens aantal_neutralen (0-30) blijft ongewijzigd.
// ════════════════════════════════════════════════════════════════════════
describe('AC11 — bovengrens aantal_neutralen (0-30) is ongewijzigd', () => {
  it('UI: het invoerveld klemt direct naar 30 resp. 0 buiten het bereik', () => {
    renderEditor()
    const input = screen.getByLabelText(nl.oefeningen.neutralsLabel) as HTMLInputElement

    fireEvent.change(input, { target: { value: '50' } })
    expect(input.value).toBe('30')

    fireEvent.change(input, { target: { value: '-10' } })
    expect(input.value).toBe('0')
  })

  it('server: createOefening klemt aantal_neutralen naar [0,30], ongeacht de (nieuwe) teamgrootte', async () => {
    const mockHoog = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    useSupabase(mockHoog)
    await createOefening(baseInput({ teams: [{ grootte: 1, formaties: [] }], aantal_neutralen: 999 }))
    expect(mockHoog.calls.insert[0].payload.aantal_neutralen).toBe(30)

    const mockLaag = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    useSupabase(mockLaag)
    await createOefening(baseInput({ teams: [{ grootte: 2, formaties: [] }], aantal_neutralen: -5 }))
    expect(mockLaag.calls.insert[0].payload.aantal_neutralen).toBe(0)
  })
})
