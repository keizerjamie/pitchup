// Acceptatietests — Meerdere formaties per oefening-team (user story: als
// trainer bij het samenstellen van een oefening per team alle vereenvoudigde
// formaties kunnen selecteren die bij de gekozen teamgrootte passen, i.p.v.
// precies één, alfabetisch gesorteerd, met "alles selecteren").
//
// ── Criterium → test-mapping ──
//   Happy path 1  → describe('Happy path 1 — ...alfabetisch...')
//   Happy path 2  → describe('Happy path 2 — meerdere aangevinkt blijft behouden; opslaan+heropenen')
//   Happy path 3  → describe('Happy path 3 — teamgrootte met maar 2 opties, beide los selecteerbaar')
//   Faalpad 1     → describe('Faalpad 1 — geen teamgrootte gekozen')
//   Faalpad 2     → describe('Faalpad 2 — teamgrootte wijzigen laat niet-passende formaties vervallen')
//   Faalpad 3     → describe('Faalpad 3 — server wijst een ongeldige formatie-key af, ongeacht positie')
//   Faalpad 4     → describe('Faalpad 4 — maximum van 6 teams per oefening blijft gehandhaafd')
//   Extra         → describe('Extra — "Alles selecteren"-knop')
//   Edge case 1   → describe('Edge case — 0 geselecteerde formaties ... / dual-read backward compat')
//   Businessregel → describe('Businessregel — tenant-isolatie blijft ongewijzigd')
//
// Net als oefening-bibliotheek.acceptance.test.tsx wordt hier UITSLUITEND de
// Supabase-client (@/lib/supabase/server) en (voor de page-niveau tests)
// next/navigation gemockt — de server actions/validatie (lib/oefening,
// lib/types) en componenten (OefeningEditor, OefeningLibrary) draaien
// ongewijzigd. Voor de twee page-niveau tests (dual-read/0-selectie) wordt de
// echte route app/oefeningen/page.tsx aangeroepen en gerenderd — zelfde
// precedent als afdrukken-trainingsplan.acceptance.test.tsx (renderPage()) en
// dashboard-vorm.acceptance.test.tsx (DashboardPage()), want dat is de enige
// manier om de dual-read-normalisatie in de leeslaag (niet in de component
// zelf) van buitenaf te bewijzen.
//
// Unit-niveau dekking van dezelfde functionaliteit bestaat al in
// components/OefeningEditor.test.tsx en app/actions/oefening-library.test.ts
// (frontend-/backend-engineer) — dit bestand duplicere die niet één-op-één,
// maar bewijst de acceptatiecriteria via de publieke UI-flow en/of het
// action-contract, inclusief een aantal die alléén end-to-end (UI → echte
// server action → her-render) aan te tonen zijn (opslaan+heropenen,
// teamgrootte-wissel die daadwerkelijk persisteert).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { OefeningInput } from '@/lib/oefening'
import type { Oefening, OefeningTeam } from '@/lib/types'
import OefeningEditor from '@/components/OefeningEditor'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
}))

import { createClient } from '@/lib/supabase/server'
import { createOefening, updateOefening } from '@/app/actions/oefening-library'
import OefeningenPage from '@/app/oefeningen/page'

// ── Gedeelde Supabase-mock, zelfde patroon als oefening-bibliotheek.acceptance.test.tsx ──
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
  }
  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq']) {
      c[m] = () => c
    }
    c.eq = () => c
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push({ table, payload }); return c }
    c.update = (payload: Record<string, unknown>) => { calls.update.push({ table, payload }); return c }
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

function installSupabase(mock: ReturnType<typeof makeSupabase>) {
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

// Ruwe DB-rij zoals `select('*')` hem teruggeeft — `teams` mag hier bewust de
// legacy vorm bevatten (dual-read wordt pas in app/oefeningen/page.tsx
// toegepast, niet door deze fixture).
function dbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...makeOefening(), ...overrides }
}

async function renderOefeningenPage(opts: {
  user?: { id: string } | null
  oefeningenRows?: Record<string, unknown>[]
  koppelingen?: { oefening_id: string }[]
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const m = makeSupabase({
    user,
    tables: {
      oefeningen: { data: opts.oefeningenRows ?? [] },
      training_oefeningen: { data: opts.koppelingen ?? [] },
    },
  })
  installSupabase(m)
  const el = await OefeningenPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════
// Happy path 1 — bij een gekozen teamgrootte toont het formatie-veld alle
// bijbehorende formaties, alfabetisch gesorteerd op label, als losse
// aan/uit-toggles.
// ═══════════════════════════════════════════════════════════════════════
describe('Happy path 1 — formatie-veld toont alle bijbehorende formaties als toggles, alfabetisch gesorteerd', () => {
  it('grootte 8 kiezen toont beide 8v8-formaties als toggle-knoppen, in alfabetische volgorde (niet de definitievolgorde)', () => {
    render(
      <DictProvider dict={nl}>
        <OefeningEditor onCancel={vi.fn()} onSubmit={vi.fn()} />
      </DictProvider>,
    )
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '8' } })

    const group = screen.getByRole('group', { name: nl.oefeningen.formations })
    const buttons = within(group).getAllByRole('button')
    // FORMATIONS_BY_TEAM_SIZE[8] definieert '3-3-1' vóór '3-2-2' — de UI moet
    // dat dus daadwerkelijk hersorteren, niet toevallig al goed staan.
    expect(buttons.map((b) => b.textContent)).toEqual(['3-2-2', '3-3-1'])
    // Allemaal losse aan/uit-toggles (aria-pressed), niet één <select>.
    buttons.forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'false'))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Happy path 2 — meerdere aangevinkte formaties blijven allemaal zichtbaar
// als geselecteerd; opslaan en opnieuw openen toont exact dezelfde selectie
// terug.
// ═══════════════════════════════════════════════════════════════════════
describe('Happy path 2 — meerdere aangevinkte formaties blijven behouden; opslaan+heropenen toont exact dezelfde selectie', () => {
  it('twee toggles blijven tegelijk aan staan, en na een echte save + heropenen staan exact diezelfde twee weer aan', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'new-1' }, error: null } } })
    installSupabase(m)

    const { unmount } = render(
      <DictProvider dict={nl}>
        <OefeningEditor onCancel={vi.fn()} onSubmit={createOefening} />
      </DictProvider>,
    )
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Positiespel 8v8' } })
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '8' } })

    // Bewust in omgekeerde (niet-alfabetische) klikvolgorde.
    fireEvent.click(screen.getByRole('button', { name: '3-3-1' }))
    fireEvent.click(screen.getByRole('button', { name: '3-2-2' }))

    // Beide blijven tegelijk zichtbaar als geselecteerd (geen wederzijdse uitsluiting).
    expect(screen.getByRole('button', { name: '3-3-1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '3-2-2' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(m.calls.insert).toHaveLength(1))

    // De echte server action (validateOefening) schrijft canoniek alfabetisch weg.
    const savedTeams = m.calls.insert[0].payload.teams as OefeningTeam[]
    expect(savedTeams).toEqual([{ grootte: 8, formaties: ['3-2-2', '3-3-1'] }])
    unmount()

    // "Opnieuw openen": de editor in bewerk-modus met exact de opgeslagen
    // (canonieke) data, zoals de app zou doen na een her-fetch.
    const reopened = makeOefening({ naam: 'Positiespel 8v8', teams: savedTeams })
    render(
      <DictProvider dict={nl}>
        <OefeningEditor initial={reopened} onCancel={vi.fn()} onSubmit={vi.fn().mockResolvedValue(undefined)} />
      </DictProvider>,
    )
    const group = screen.getByRole('group', { name: nl.oefeningen.formations })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['3-2-2', '3-3-1'])
    expect(within(group).getByRole('button', { name: '3-2-2' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: '3-3-1' })).toHaveAttribute('aria-pressed', 'true')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Happy path 3 — bij een teamgrootte met maar 2 opties zijn beide los
// selecteerbaar (geen kunstmatige beperking tot 1).
// ═══════════════════════════════════════════════════════════════════════
describe('Happy path 3 — teamgrootte met maar 2 opties, beide onafhankelijk selecteerbaar', () => {
  it('grootte 4 heeft precies 2 formatie-opties; beide tegelijk aanzetten werkt zonder dat de één de ander uitzet', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    installSupabase(m)
    render(
      <DictProvider dict={nl}>
        <OefeningEditor onCancel={vi.fn()} onSubmit={createOefening} />
      </DictProvider>,
    )
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Positiespel 4v4' } })
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '4' } })

    const group = screen.getByRole('group', { name: nl.oefeningen.formations })
    const buttons = within(group).getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons.map((b) => b.textContent)).toEqual(['1-2', '2-1']) // alfabetisch

    fireEvent.click(within(group).getByRole('button', { name: '1-2' }))
    fireEvent.click(within(group).getByRole('button', { name: '2-1' }))

    // Geen artificiële beperking tot 1: beide staan tegelijk aan.
    expect(within(group).getByRole('button', { name: '1-2' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: '2-1' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(m.calls.insert).toHaveLength(1))
    expect(m.calls.insert[0].payload.teams).toEqual([{ grootte: 4, formaties: ['1-2', '2-1'] }])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Faalpad 1 — geen teamgrootte gekozen → formatie-veld uitgeschakeld.
// ═══════════════════════════════════════════════════════════════════════
describe('Faalpad 1 — geen teamgrootte gekozen', () => {
  it('formatie-veld is uitgeschakeld: geen toggle-groep zichtbaar, "Alles selecteren" is disabled', () => {
    render(
      <DictProvider dict={nl}>
        <OefeningEditor onCancel={vi.fn()} onSubmit={vi.fn()} />
      </DictProvider>,
    )
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))

    expect(screen.queryByRole('group', { name: nl.oefeningen.formations })).not.toBeInTheDocument()
    expect(screen.getByText(nl.oefeningen.selectAllFormations)).toBeDisabled()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Faalpad 2 — teamgrootte wijzigen → formaties die niet bij de nieuwe
// grootte horen, vervallen automatisch uit de selectie (en dat is ook wat
// er echt persisteert, niet alleen een visueel effect).
// ═══════════════════════════════════════════════════════════════════════
describe('Faalpad 2 — teamgrootte wijzigen laat niet-passende formaties automatisch vervallen', () => {
  it('een aangevinkte 8v8-formatie vervalt zodra de grootte naar 6 wisselt, en de save persisteert die lege selectie ook echt', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    installSupabase(m)
    render(
      <DictProvider dict={nl}>
        <OefeningEditor onCancel={vi.fn()} onSubmit={createOefening} />
      </DictProvider>,
    )
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Wissel van grootte' } })
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    const sizeSelect = screen.getAllByLabelText(nl.oefeningen.teamSize)[0]
    fireEvent.change(sizeSelect, { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: '3-3-1' }))
    expect(screen.getByRole('button', { name: '3-3-1' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(sizeSelect, { target: { value: '6' } })
    const group = screen.getByRole('group', { name: nl.oefeningen.formations })
    within(group).getAllByRole('button').forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'false'))

    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(m.calls.insert).toHaveLength(1))
    expect(m.calls.insert[0].payload.teams).toEqual([{ grootte: 6, formaties: [] }])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Faalpad 3 — server-side: een formatie-key die niet bij de opgegeven
// teamgrootte hoort, wordt afgewezen — validatie voor ÉLKE waarde in de
// selectie, niet alleen de eerste. Rechtstreeks via de publieke action
// (zoals de UI dat ook zou moeten opsturen als iemand de client omzeilt).
// ═══════════════════════════════════════════════════════════════════════
describe('Faalpad 3 — server wijst een ongeldige formatie-key af, ongeacht positie in de selectie', () => {
  it('faalt wanneer de ongeldige key als tweede (niet eerste) in de array staat', async () => {
    installSupabase(makeSupabase())
    await expect(
      createOefening(baseInput({ teams: [{ grootte: 6, formaties: ['3-2', '4-3-3'] }] })),
    ).rejects.toThrow('Formatie past niet bij teamgrootte')
  })

  it('faalt wanneer de ongeldige key als laatste in de array staat', async () => {
    installSupabase(makeSupabase())
    await expect(
      createOefening(baseInput({ teams: [{ grootte: 6, formaties: ['2-2-1', '3-2', '4-3-3'] }] })),
    ).rejects.toThrow('Formatie past niet bij teamgrootte')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Faalpad 4 — bestaand maximum van 6 teams per oefening blijft gehandhaafd,
// ook met de nieuwe meervoudige formatiekeuze per team.
// ═══════════════════════════════════════════════════════════════════════
describe('Faalpad 4 — maximum van 6 teams per oefening blijft gehandhaafd', () => {
  it('de UI staat maximaal 6 team-rijen toe, en wat écht wordt opgeslagen blijft ook op 6 staan', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    installSupabase(m)
    render(
      <DictProvider dict={nl}>
        <OefeningEditor onCancel={vi.fn()} onSubmit={createOefening} />
      </DictProvider>,
    )
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Zes teams' } })
    for (let i = 0; i < 8; i++) fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    const sizeSelects = screen.getAllByLabelText(nl.oefeningen.teamSize)
    expect(sizeSelects).toHaveLength(6)

    const sizes = [3, 4, 5, 6, 7, 8]
    sizes.forEach((size, i) => fireEvent.change(sizeSelects[i], { target: { value: String(size) } }))

    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(m.calls.insert).toHaveLength(1))
    const savedTeams = m.calls.insert[0].payload.teams as OefeningTeam[]
    expect(savedTeams).toHaveLength(6)
    expect(savedTeams.map((t) => t.grootte)).toEqual(sizes)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Extra — de "alles selecteren"-knop.
// ═══════════════════════════════════════════════════════════════════════
describe('Extra — "Alles selecteren"-knop', () => {
  it('zet alle formaties van de gekozen grootte aan, submit bevat alle keys (canoniek), en de knop wordt disabled zodra alles al aan staat', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    installSupabase(m)
    render(
      <DictProvider dict={nl}>
        <OefeningEditor onCancel={vi.fn()} onSubmit={createOefening} />
      </DictProvider>,
    )
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Partij 8v8' } })
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '8' } })

    const selectAll = screen.getByText(nl.oefeningen.selectAllFormations)
    expect(selectAll).not.toBeDisabled()
    fireEvent.click(selectAll)

    expect(screen.getByRole('button', { name: '3-2-2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '3-3-1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(nl.oefeningen.selectAllFormations)).toBeDisabled()

    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(m.calls.insert).toHaveLength(1))
    expect(m.calls.insert[0].payload.teams).toEqual([{ grootte: 8, formaties: ['3-2-2', '3-3-1'] }])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Edge case — 0 geselecteerde formaties gedraagt zich functioneel identiek
// aan "geen formatie" (los/zonder labels), én dual-read/backward compat: een
// bestaande oefening met de oude enkelvoudige `formatie`-vorm wordt correct
// getoond en is correct bewerkbaar. Beide via de echte route
// app/oefeningen/page.tsx, want de dual-read-normalisatie zit in de leeslaag
// (page.tsx), niet in het component zelf.
// ═══════════════════════════════════════════════════════════════════════
describe('Edge case — 0 geselecteerde formaties = "geen formatie"; dual-read/backward compat', () => {
  it('een moderne lege selectie ({formaties: []}) en een legacy null-formatie ({formatie: null}) renderen identiek: alleen de grootte, geen formatie-label, geen posities getekend', async () => {
    await renderOefeningenPage({
      oefeningenRows: [
        dbRow({ id: 'o-modern', naam: 'Modern leeg', teams: [{ grootte: 6, formaties: [] }] }),
        dbRow({ id: 'o-legacy', naam: 'Legacy null', teams: [{ grootte: 6, formatie: null }] }),
      ],
    })

    for (const naam of ['Modern leeg', 'Legacy null']) {
      const card = screen.getByText(naam).closest('.bg-surface') as HTMLElement
      expect(card).not.toBeNull()
      // Alleen de grootte als label, geen "· <formatie>"-achtervoegsel.
      expect(within(card).getByText('6')).toBeInTheDocument()
      expect(within(card).queryByText(/6 ·/)).not.toBeInTheDocument()
      // Geen enkele positie-marker getekend (los/zonder labels, zoals "geen formatie").
      expect(within(card).queryAllByTestId('formation-marker')).toHaveLength(0)
    }
  })

  it('een bestaande oefening met de oude enkelvoudige `formatie`-vorm ("3-2") wordt getoond mét het label en is correct bewerkbaar (toggle staat aan)', async () => {
    await renderOefeningenPage({
      oefeningenRows: [
        dbRow({ id: 'o-legacy-single', naam: 'Legacy 6 tegen 6', teams: [{ grootte: 6, formatie: '3-2' }] }),
      ],
    })

    const card = screen.getByText('Legacy 6 tegen 6').closest('.bg-surface') as HTMLElement
    expect(within(card).getByText('6 · 3-2')).toBeInTheDocument()

    // Openen om te bewerken: de dual-read normalisatie (page.tsx) moet de
    // legacy vorm al hebben omgezet vóórdat de editor hem ziet.
    fireEvent.click(within(card).getByLabelText(nl.oefeningen.editAria))
    expect((screen.getAllByLabelText(nl.oefeningen.teamSize)[0] as HTMLSelectElement).value).toBe('6')
    expect(screen.getByRole('button', { name: '3-2' })).toHaveAttribute('aria-pressed', 'true')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Businessregel — tenant-isolatie (assertOwnOefening) blijft ongewijzigd,
// ook met de nieuwe `formaties`-array-vorm in de payload.
// ═══════════════════════════════════════════════════════════════════════
describe('Businessregel — tenant-isolatie blijft ongewijzigd met de nieuwe formaties-array', () => {
  it('updateOefening op andermans oefening met een meervoudige formatiekeuze geeft "niet gevonden" en muteert niets', async () => {
    installSupabase(makeSupabase({ tables: { oefeningen: { data: null } } }))
    await expect(
      updateOefening('vreemde-oefening', baseInput({ teams: [{ grootte: 6, formaties: ['2-2-1', '3-2'] }] })),
    ).rejects.toThrow('Oefening niet gevonden')
  })
})
