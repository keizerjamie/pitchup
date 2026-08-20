// Acceptatietests — Parallelle oefeningen (user story: twee of meer oefeningen
// naast elkaar inplannen en de beschikbare spelers exact over die parallelle
// oefeningen verdelen, zodat de trainer in één oogopslag ziet dat elke speler
// een plek heeft, zonder tekort, overschot of dubbele indeling).
//
// Dit bestand dekt AC1 t/m AC25 van de goedgekeurde story expliciet, per
// criterium een eigen describe-blok — zelfde conventie als
// teamindeling.acceptance.test.tsx. Van buitenaf: waar de trainer een UI-actie
// zou nemen (grouperen via het "Parallel aan"-veld, slepen/klikken in
// ParallelGroepEditor) wordt de ECHTE component gerenderd en de ECHTE server
// action aangeroepen, met uitsluitend `@/lib/supabase/server` gemockt
// (wachtrij-patroon per tabel-aanroep, zoals app/actions/training-plan.test.ts
// en teamindeling.acceptance.test.tsx). Voor server-only criteria (tenant-
// isolatie, foutpaden die niet via de UI te forceren zijn) wordt de server
// action rechtstreeks aangeroepen — ook dat is het publieke, "van buitenaf"
// contract, niet een interne functie.
//
// Player-id's zijn overal geldige UUID's: lib/parallel-groep.ts se
// validateParallelSpelers keurt niet-UUID-vormige id's al af vóór de
// tenant-check, dus alleen UUID's demonstreren het ECHTE gedrag van de
// server action via de UI-flow.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Oefening, Player, TrainingOefeningWithData } from '@/lib/types'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import ParallelGroepEditor from '@/components/ParallelGroepEditor'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import {
  vormParallelGroep,
  voegToeAanParallelGroep,
  haalUitParallelGroep,
  saveParallelIndeling,
} from '@/app/actions/training-plan'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Gedeelde Supabase-mock, wachtrij-patroon per tabel-aanroep — zelfde
// opzet als app/actions/training-plan.test.ts en teamindeling.acceptance.test.tsx. ──
type Eq = { col: string; val: unknown }
type TableResult = { data?: unknown; error?: unknown }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
  queues?: Record<string, TableResult[]>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const queues = opts.queues ?? {}
  const calls = {
    insert: [] as { table: string; payload: Record<string, unknown> }[],
    update: [] as { table: string; payload: Record<string, unknown>; eqs: Eq[] }[],
    delete: [] as { table: string }[],
    eq: [] as { table: string; col: string; val: unknown }[],
  }

  function nextResult(table: string): TableResult {
    const queue = queues[table]
    if (queue && queue.length > 0) return queue.length === 1 ? queue[0] : queue.shift()!
    return tables[table] ?? { data: [], error: null }
  }

  function chain(table: string) {
    const eqs: Eq[] = []
    const c: Record<string, unknown> = {}
    for (const m of ['gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq']) {
      c[m] = () => c
    }
    c.select = () => c
    c.eq = (col: string, val: unknown) => { calls.eq.push({ table, col, val }); eqs.push({ col, val }); return c }
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push({ table, payload }); return c }
    c.update = (payload: Record<string, unknown>) => { calls.update.push({ table, payload, eqs }); return c }
    c.delete = () => { calls.delete.push({ table }); return c }
    c.single = () => Promise.resolve(nextResult(table))
    c.maybeSingle = () => Promise.resolve(nextResult(table))
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(nextResult(table))
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

// ── Fixtures ──
const P1 = '11111111-1111-4111-8111-111111111111' // Piet Peters
const P2 = '22222222-2222-4222-8222-222222222222' // Jan Jansen
const P3 = '33333333-3333-4333-8333-333333333333' // Kees Klaassen
const P4 = '44444444-4444-4444-8444-444444444444' // Bram Bakker
const P_VREEMD = '99999999-9999-4999-8999-999999999999'
const P_GHOST = '77777777-7777-4777-8777-777777777777' // hard verwijderd, staat niet meer in players

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: P1,
    name: 'Piet Peters',
    position: 'Spits',
    secondary_positions: [],
    jersey_number: 1,
    active: true,
    injured: false,
    type: 'regular',
    rating: 5,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const players4: Player[] = [
  makePlayer({ id: P1, name: 'Piet Peters', jersey_number: 1 }),
  makePlayer({ id: P2, name: 'Jan Jansen', jersey_number: 2 }),
  makePlayer({ id: P3, name: 'Kees Klaassen', jersey_number: 3 }),
  makePlayer({ id: P4, name: 'Bram Bakker', jersey_number: 4 }),
]

// Teamloos (`teams: []`) als default: voorkomt dat TeamIndelingEditor
// ongewild meerendert en spelersnamen dupliceert (die editor draait op
// dezelfde speler-namen), zodat generieke `getByText(naam)`-assertions
// ondubbelzinnig blijven. AC10/AC11/AC12 geven expliciet teams mee.
function makeOefening(overrides: Partial<Oefening> = {}): Oefening {
  return {
    id: 'oA',
    team_id: 'team-1',
    naam: 'Oefening A',
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

function makeKoppeling(
  overrides: Partial<TrainingOefeningWithData> & { oefening?: Partial<Oefening> } = {},
): TrainingOefeningWithData {
  const { oefening, ...rest } = overrides
  return {
    id: 'k1',
    team_id: 'team-1',
    event_id: 'e1',
    oefening_id: 'oA',
    volgorde: 0,
    stap_override: null,
    genest_in: null,
    spelerindeling: [],
    parallel_groep_id: null,
    parallel_spelers: [],
    created_at: '2024-01-01T00:00:00Z',
    oefeningen: makeOefening(oefening),
    ...rest,
  }
}

function renderPlan(
  koppelingen: TrainingOefeningWithData[],
  opts: { players?: Player[]; presentPlayerIds?: string[] } = {},
) {
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
        players={opts.players ?? players4}
        presentPlayerIds={opts.presentPlayerIds ?? players4.map((p) => p.id)}
      />
    </DictProvider>,
  )
}

function renderGroup(
  leden: TrainingOefeningWithData[],
  opts: { players?: Player[]; presentPlayerIds?: string[]; groepId?: string } = {},
) {
  return render(
    <DictProvider dict={nl}>
      <ParallelGroepEditor
        eventId="e1"
        groepId={opts.groepId ?? 'g1'}
        leden={leden}
        players={opts.players ?? players4}
        presentPlayerIds={opts.presentPlayerIds ?? players4.map((p) => p.id)}
      />
    </DictProvider>,
  )
}

// Blok-badges ("1", "2", "1a", "1b", ...) dragen als enige de
// `print-club-bg-primary`-klasse. Losse `getByText('2')`-checks zijn niet
// betrouwbaar zodra een groep gerenderd wordt: ParallelGroepEditor's pool
// toont dan óók rugnummers als tekst, en een rugnummer "2" (Jan Jansen) is
// tekstueel niet te onderscheiden van het blok-badge "2".
function blokBadges(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('span.print-club-bg-primary')).map((el) => el.textContent ?? '')
}

// ────────────────────────────────────────────────────────────────────────────
// AC1 — twee of meer koppelingen tot een parallelle groep combineren: worden
// naast elkaar getoond i.p.v. onder elkaar.
// ────────────────────────────────────────────────────────────────────────────
describe('AC1 — een parallelle groep vormen toont de oefeningen naast elkaar', () => {
  it('via het "Parallel aan"-veld een groep vormen (echte vormParallelGroep) verandert de badges van "1"/"2" naar "1a"/"1b" en geeft beide kaarten de groepslay-outklasse', async () => {
    const oA = makeOefening({ id: 'oA', naam: 'Oefening A' })
    const oB = makeOefening({ id: 'oB', naam: 'Oefening B' })
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', volgorde: 0, created_at: '2024-01-01T00:00:00Z', oefeningen: oA })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', volgorde: 1, created_at: '2024-01-02T00:00:00Z', oefeningen: oB })

    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: [{ id: 'k1', parallel_groep_id: null }, { id: 'k2', parallel_groep_id: null }] }, // membership-check
          { error: null }, // update k1
          { error: null }, // update k2
          { data: [
            { id: 'k1', volgorde: 0, parallel_groep_id: 'g-nieuw', created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 0, parallel_groep_id: 'g-nieuw', created_at: '2024-01-02T00:00:00Z' },
          ] }, // normaliseerBlokVolgorde
        ],
      },
    })
    use(m)

    const { container } = renderPlan([k1, k2])

    // Vooraf: los onder elkaar, gewone nummer-badges.
    expect(blokBadges(container)).toEqual(['1', '2'])

    fireEvent.click(screen.getAllByLabelText(nl.trainingPlan.detailsToggle)[0])
    const select = screen.getByText(nl.trainingPlan.parallelLabel).closest('div')?.querySelector('select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'naast:k2' } })

    await waitFor(() => expect(blokBadges(container)).toEqual(['1a', '1b']))

    // Structureel naast elkaar: beide kaarten krijgen de groepslay-outklasse (flex-1).
    const cardA = screen.getAllByText('Oefening A')[0].closest('.rounded-xl') as HTMLElement
    const cardB = screen.getAllByText('Oefening B')[0].closest('.rounded-xl') as HTMLElement
    expect(cardA.className).toContain('flex-1')
    expect(cardB.className).toContain('flex-1')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC2 — een extra, nog niet-gegroepeerde koppeling aan een bestaande groep
// toevoegen: wordt onderdeel van dezelfde groep, naast de andere leden.
// ────────────────────────────────────────────────────────────────────────────
describe('AC2 — een koppeling toevoegen aan een bestaande parallelle groep', () => {
  it('via "Groep 1" kiezen (echte voegToeAanParallelGroep) wordt de derde koppeling lid van de groep, badge "1c" verschijnt naast "1a"/"1b"', async () => {
    const oA = makeOefening({ id: 'oA', naam: 'Oefening A' })
    const oB = makeOefening({ id: 'oB', naam: 'Oefening B' })
    const oC = makeOefening({ id: 'oC', naam: 'Oefening C' })
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-01T00:00:00Z', oefeningen: oA })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-02T00:00:00Z', oefeningen: oB })
    const k3 = makeKoppeling({ id: 'k3', oefening_id: 'oC', volgorde: 1, created_at: '2024-01-03T00:00:00Z', oefeningen: oC })

    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'k3', parallel_groep_id: null } }, // koppeling zelf
          { data: { id: 'k1' } }, // bestaand lid van g1
          { error: null }, // update
          { data: [
            { id: 'k1', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-02T00:00:00Z' },
            { id: 'k3', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-03T00:00:00Z' },
          ] },
        ],
      },
    })
    use(m)

    const { container } = renderPlan([k1, k2, k3])
    expect(blokBadges(container)).toEqual(['1a', '1b', '2']) // k3 nog los

    fireEvent.click(screen.getAllByLabelText(nl.trainingPlan.detailsToggle)[2]) // k3
    const select = screen.getByText(nl.trainingPlan.parallelLabel).closest('div')?.querySelector('select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'groep:g1' } })

    await waitFor(() => expect(blokBadges(container)).toEqual(['1a', '1b', '1c']))
    const cardC = screen.getAllByText('Oefening C')[0].closest('.rounded-xl') as HTMLElement
    expect(cardC.className).toContain('flex-1')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC3 — de groepsindeling blijft behouden als de trainer het trainingsplan
// opnieuw opent (persistente state).
// ────────────────────────────────────────────────────────────────────────────
describe('AC3 — de parallelle groep blijft behouden bij het opnieuw openen van het trainingsplan', () => {
  it('een verse render met server-data die al een parallel_groep_id bevat toont de groep meteen, zonder enige actie', () => {
    const oA = makeOefening({ id: 'oA', naam: 'Oefening A' })
    const oB = makeOefening({ id: 'oB', naam: 'Oefening B' })
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', volgorde: 0, parallel_groep_id: 'g1', parallel_spelers: [P1], created_at: '2024-01-01T00:00:00Z', oefeningen: oA })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', volgorde: 0, parallel_groep_id: 'g1', parallel_spelers: [], created_at: '2024-01-02T00:00:00Z', oefeningen: oB })

    renderPlan([k1, k2])

    expect(screen.getByText('1a')).toBeInTheDocument()
    expect(screen.getByText('1b')).toBeInTheDocument()
    expect(screen.getByTestId('parallelgroep-editor-g1')).toBeInTheDocument()
    // De eerder opgeslagen verdeling (Piet bij Oefening A) staat er meteen.
    expect(screen.getByText('Piet')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC4 — training met minder dan twee gekoppelde oefeningen: een parallelle
// groep vormen is niet mogelijk.
// ────────────────────────────────────────────────────────────────────────────
describe('AC4 — minder dan twee koppelingen: vormParallelGroep weigert', () => {
  it('vormParallelGroep met één koppeling-id wordt direct afgewezen', async () => {
    const m = makeSupabase({ tables: { events: { data: { id: 'e1' } } } })
    use(m)
    await expect(vormParallelGroep('e1', ['k1'])).rejects.toThrow('Minimaal twee oefeningen voor een parallelle groep')
    expect(m.calls.update).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC5 — koppelingen die niet tot dezelfde training (event_id) of trainer
// (team_id) behoren, worden bij groeperen afgewezen.
// ────────────────────────────────────────────────────────────────────────────
describe('AC5 — koppelingen buiten deze training/dit team worden geweigerd bij groeperen', () => {
  it('vormParallelGroep wijst een koppeling-id af dat niet bij dit event/team hoort ("Koppeling niet gevonden")', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        // Alleen k1 komt terug — 'k-vreemd' is (via RLS) onzichtbaar voor dit team/event.
        training_oefeningen: { data: [{ id: 'k1', parallel_groep_id: null }] },
      },
    })
    use(m)
    await expect(vormParallelGroep('e1', ['k1', 'k-vreemd'])).rejects.toThrow('Koppeling niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('voegToeAanParallelGroep wijst een groepId af die niet binnen dit event/team bestaat ("Ongeldige parallelle groep")', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'k3', parallel_groep_id: null } },
          { data: null }, // geen enkel lid van 'groep-ander-team' binnen dit event/team
        ],
      },
    })
    use(m)
    await expect(voegToeAanParallelGroep('e1', 'k3', 'groep-ander-team')).rejects.toThrow('Ongeldige parallelle groep')
    expect(m.calls.update).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC6 (V5) — een groep mag gevormd worden uit oefeningen die niet naast
// elkaar stonden; tussenliggende oefeningen schuiven vanzelf op.
// ────────────────────────────────────────────────────────────────────────────
describe('AC6 — groep vormen uit niet-aangrenzende oefeningen: tussenliggende oefening schuift op', () => {
  it('vormParallelGroep(k1,k3) trekt k3\'s volgorde gelijk met k1; k2 (ertussenin) wordt niet aangeraakt maar komt na het blok', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: [{ id: 'k1', parallel_groep_id: null }, { id: 'k3', parallel_groep_id: null }] }, // membership
          { error: null }, // update k1
          { error: null }, // update k3
          { data: [ // haalKoppelingRijen: k1/k3 delen nu groep 'g-x', maar nog hun oude volgorde
            { id: 'k1', volgorde: 0, parallel_groep_id: 'g-x', created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 1, parallel_groep_id: null, created_at: '2024-01-02T00:00:00Z' },
            { id: 'k3', volgorde: 2, parallel_groep_id: 'g-x', created_at: '2024-01-03T00:00:00Z' },
          ] },
          { error: null }, // update k3 → volgorde 0
        ],
      },
    })
    use(m)

    await vormParallelGroep('e1', ['k1', 'k3'])

    const k3Update = m.calls.update.find((u) => u.eqs.some((e) => e.col === 'id' && e.val === 'k3') && 'volgorde' in u.payload)
    expect(k3Update?.payload).toEqual({ volgorde: 0 })
    // k2 wordt geen enkele keer geüpdatet: zijn volgorde stond al goed voor het volgende blok.
    expect(m.calls.update.some((u) => u.eqs.some((e) => e.col === 'id' && e.val === 'k2'))).toBe(false)
  })

  it('een verse render van het resultaat toont k1 en k3 naast elkaar (1a/1b), k2 als los blok ná de groep', () => {
    const oA = makeOefening({ id: 'oA', naam: 'Oefening A' })
    const oB = makeOefening({ id: 'oB', naam: 'Oefening B' })
    const oC = makeOefening({ id: 'oC', naam: 'Oefening C' })
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', volgorde: 0, parallel_groep_id: 'g-x', created_at: '2024-01-01T00:00:00Z', oefeningen: oA })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', volgorde: 1, created_at: '2024-01-02T00:00:00Z', oefeningen: oB })
    const k3 = makeKoppeling({ id: 'k3', oefening_id: 'oC', volgorde: 0, parallel_groep_id: 'g-x', created_at: '2024-01-03T00:00:00Z', oefeningen: oC })

    const { container } = renderPlan([k1, k2, k3])

    expect(blokBadges(container)).toEqual(['1a', '1b', '2'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC7 — een beschikbare speler toewijzen aan één oefening binnen de groep:
// staat op dat moment aan niet meer dan één oefening in die groep toegewezen.
// ────────────────────────────────────────────────────────────────────────────
describe('AC7 — een speler toewijzen aan één lid van de groep, nooit aan meer dan één tegelijk', () => {
  it('een pool-speler toewijzen aan lid A (echte saveParallelIndeling) plaatst hem daar en nergens anders in de groep', async () => {
    const oA = makeOefening({ id: 'oA', naam: 'Oefening A' })
    const oB = makeOefening({ id: 'oB', naam: 'Oefening B' })
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', parallel_groep_id: 'g1', oefeningen: oA })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', parallel_groep_id: 'g1', oefeningen: oB })

    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        players: { data: players4.map((p) => ({ id: p.id })) },
      },
      queues: {
        training_oefeningen: [
          { data: { id: 'k1', parallel_groep_id: 'g1' } },
          { data: [{ id: 'k2', parallel_spelers: [] }] },
          { error: null },
        ],
      },
    })
    use(m)

    const { container } = renderGroup([k1, k2])
    const pool = container.querySelector('[data-testid="parallelgroep-pool"]') as HTMLElement
    fireEvent.click(within(pool).getByRole('button', { name: /Piet/ }))
    fireEvent.click(screen.getByText(nl.parallelGroep.moveTo.replace('{target}', 'Oefening A')))

    await waitFor(() => expect(m.calls.update).toHaveLength(1))
    expect(m.calls.update[0].payload).toEqual({ parallel_spelers: [P1] })

    const lidA = container.querySelector('[data-testid="parallelgroep-lid-k1"]') as HTMLElement
    const lidB = container.querySelector('[data-testid="parallelgroep-lid-k2"]') as HTMLElement
    expect(lidA.textContent).toContain('Piet')
    expect(lidB.textContent).not.toContain('Piet')
    expect(within(pool).queryByText('Piet')).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC8 — Kernregel: een poging om dezelfde speler aan een tweede/derde/vierde
// oefening binnen dezelfde groep toe te wijzen wordt bij opslaan afgewezen,
// ongeacht groepsgrootte.
// ────────────────────────────────────────────────────────────────────────────
describe('AC8 — Kernregel: dubbele indeling binnen dezelfde groep wordt bij opslaan geweigerd', () => {
  it('saveParallelIndeling wijst een speler af die al bij een ANDER lid van een groep van vier staat', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        players: { data: [{ id: P1 }, { id: P2 }, { id: P3 }, { id: P4 }] },
      },
      queues: {
        training_oefeningen: [
          { data: { id: 'k1', parallel_groep_id: 'g1' } },
          { data: [
            { id: 'k2', parallel_spelers: [] },
            { id: 'k3', parallel_spelers: [P2] },
            { id: 'k4', parallel_spelers: [] },
          ] },
        ],
      },
    })
    use(m)

    await expect(saveParallelIndeling('k1', 'e1', [P1, P2])).rejects.toThrow('Speler in meerdere oefeningen')
    expect(m.calls.update).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC9 — een speler die niet bij het eigen team van de trainer hoort wordt
// afgewezen (tenant-isolatie).
// ────────────────────────────────────────────────────────────────────────────
describe('AC9 — een speler buiten het eigen team wordt geweigerd (tenant-isolatie)', () => {
  it('saveParallelIndeling wijst een player_id af dat niet in de eigen spelerslijst voorkomt', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        players: { data: [{ id: P1 }] },
      },
      queues: {
        training_oefeningen: [
          { data: { id: 'k1', parallel_groep_id: 'g1' } },
          { data: [{ id: 'k2', parallel_spelers: [] }] },
        ],
      },
    })
    use(m)
    await expect(saveParallelIndeling('k1', 'e1', [P_VREEMD])).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.update).toHaveLength(0)
    expect(m.calls.eq).toContainEqual({ table: 'players', col: 'team_id', val: 'team-1' })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC10 — toewijzen aan een oefening binnen een groep zet een speler NIET
// automatisch in een team binnen die oefening (los van TeamIndelingEditor).
// ────────────────────────────────────────────────────────────────────────────
describe('AC10 — toewijzen aan de parallelle groep raakt de teamindeling van die oefening niet aan', () => {
  it('na toewijzing via ParallelGroepEditor blijft de TeamIndelingEditor-pool van dezelfde oefening ongewijzigd, en wordt nooit spelerindeling geschreven', async () => {
    const oA = makeOefening({ id: 'oA', naam: 'Oefening A', teams: [{ grootte: 2, formaties: [] }, { grootte: 2, formaties: [] }] })
    const oB = makeOefening({ id: 'oB', naam: 'Oefening B', teams: [{ grootte: 2, formaties: [] }] })
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', parallel_groep_id: 'g1', spelerindeling: [[], []], oefeningen: oA })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', parallel_groep_id: 'g1', spelerindeling: [[]], oefeningen: oB })

    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        players: { data: players4.map((p) => ({ id: p.id })) },
      },
      queues: {
        training_oefeningen: [
          { data: { id: 'k1', parallel_groep_id: 'g1' } },
          { data: [{ id: 'k2', parallel_spelers: [] }] },
          { error: null },
        ],
      },
    })
    use(m)

    const { container } = renderPlan([k1, k2])
    const parallelPool = container.querySelector('[data-testid="parallelgroep-pool"]') as HTMLElement
    fireEvent.click(within(parallelPool).getByRole('button', { name: /Piet/ }))
    fireEvent.click(screen.getByText(nl.parallelGroep.moveTo.replace('{target}', 'Oefening A')))

    await waitFor(() => expect(m.calls.update).toHaveLength(1))
    expect(m.calls.update[0].payload).toEqual({ parallel_spelers: [P1] })
    // Nooit spelerindeling geschreven — alleen de parallelle verdeling.
    expect(m.calls.update.some((u) => 'spelerindeling' in u.payload)).toBe(false)

    // Piet staat nog steeds als selecteerbare, niet-ingedeelde speler in de
    // TeamIndeling-pool van Oefening A: teamindeling blijft volledig los.
    const teamPools = container.querySelectorAll('[data-testid="teamindeling-pool"]')
    expect(teamPools.length).toBe(2)
    expect((teamPools[0] as HTMLElement).textContent).toContain('Piet')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC11 — bij een oefening met teamopbouw toont het systeem of het aantal
// toegewezen spelers exact overeenkomt met de som van teamgroottes +
// neutralen, met duidelijke tekort/overschot-melding indien niet.
// ────────────────────────────────────────────────────────────────────────────
describe('AC11 — tekort/overschot-melding bij een oefening met teamopbouw', () => {
  it('toont "1 te weinig" bij een tekort en "1 te veel" bij een overschot, met het exacte toegewezen/benodigd-aantal op de kaart', () => {
    const oA = makeOefening({ id: 'oA', naam: 'Oefening A', teams: [{ grootte: 2, formaties: [] }] }) // benodigd 2
    const oB = makeOefening({ id: 'oB', naam: 'Oefening B', teams: [{ grootte: 2, formaties: [] }] }) // benodigd 2
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', parallel_groep_id: 'g1', parallel_spelers: [P1], oefeningen: oA }) // 1/2 → tekort 1
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', parallel_groep_id: 'g1', parallel_spelers: [P2, P3, P4], oefeningen: oB }) // 3/2 → overschot 1

    const { container } = renderGroup([k1, k2])

    expect(screen.getByText(nl.parallelGroep.tekort.replace('{n}', '1'))).toBeInTheDocument()
    expect(screen.getByText(nl.parallelGroep.overschot.replace('{n}', '1'))).toBeInTheDocument()

    const lidA = container.querySelector('[data-testid="parallelgroep-lid-k1"]') as HTMLElement
    const lidB = container.querySelector('[data-testid="parallelgroep-lid-k2"]') as HTMLElement
    expect(lidA.textContent).toContain('1/2')
    expect(lidB.textContent).toContain('3/2')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC12 — bij een oefening zonder teamopbouw (bv. warming-up) geen
// tekort/overschot-indicatie; de dubbele-indeling-regel blijft wel gelden.
// ────────────────────────────────────────────────────────────────────────────
describe('AC12 — geen tekort/overschot zonder teamopbouw, maar de dubbele-indeling-regel blijft gelden', () => {
  it('een lid zonder teams toont "Geen vast aantal" i.p.v. tekort/overschot, en saveParallelIndeling weigert alsnog een dubbele indeling voor dat lid', async () => {
    const oWarmup = makeOefening({ id: 'oW', naam: 'Warming-up', teams: [] })
    const oA = makeOefening({ id: 'oA', naam: 'Oefening A', teams: [{ grootte: 2, formaties: [] }] })
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oW', parallel_groep_id: 'g1', parallel_spelers: [P1, P2, P3], oefeningen: oWarmup })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oA', parallel_groep_id: 'g1', parallel_spelers: [], oefeningen: oA })

    const { container } = renderGroup([k1, k2])
    const lidW = container.querySelector('[data-testid="parallelgroep-lid-k1"]') as HTMLElement
    expect(lidW.textContent).toContain(nl.parallelGroep.geenEis)
    expect(lidW.textContent).not.toMatch(/te (weinig|veel)/)

    // Dubbele-indeling-regel blijft server-side gelden, ook voor een lid zonder teamopbouw.
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        players: { data: [{ id: P1 }, { id: P2 }, { id: P3 }] },
      },
      queues: {
        training_oefeningen: [
          { data: { id: 'k1', parallel_groep_id: 'g1' } },
          { data: [{ id: 'k2', parallel_spelers: [P1] }] }, // P1 zit al bij het andere lid
        ],
      },
    })
    use(m)
    await expect(saveParallelIndeling('k1', 'e1', [P1])).rejects.toThrow('Speler in meerdere oefeningen')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC13 — niet alle beschikbare spelers ingedeeld: het systeem toont hoeveel
// spelers nog niet zijn ingedeeld.
// ────────────────────────────────────────────────────────────────────────────
describe('AC13 — toont hoeveel aanwezige spelers nog niet zijn ingedeeld', () => {
  it('toont "2 speler(s) nog niet ingedeeld" als 2 van de 4 aanwezige spelers nog in de pool staan', () => {
    const oA = makeOefening({ id: 'oA', naam: 'Oefening A', teams: [{ grootte: 1, formaties: [] }] })
    const oB = makeOefening({ id: 'oB', naam: 'Oefening B', teams: [{ grootte: 1, formaties: [] }] })
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', parallel_groep_id: 'g1', parallel_spelers: [P1], oefeningen: oA })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', parallel_groep_id: 'g1', parallel_spelers: [P2], oefeningen: oB })

    renderGroup([k1, k2], { presentPlayerIds: [P1, P2, P3, P4] })

    expect(screen.getByText(nl.parallelGroep.nietIngedeeld.replace('{n}', '2'))).toBeInTheDocument()
    expect(screen.queryByText(nl.parallelGroep.compleet)).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC14 — een volledig sluitende verdeling: het systeem toont expliciet dat
// de verdeling compleet en correct is.
// ────────────────────────────────────────────────────────────────────────────
describe('AC14 — toont expliciet dat de verdeling compleet en correct is', () => {
  it('toont "Verdeling compleet" zodra alle aanwezige spelers precies op de benodigde aantallen staan, zonder dubbele indeling', () => {
    const oA = makeOefening({ id: 'oA', naam: 'Oefening A', teams: [{ grootte: 1, formaties: [] }] })
    const oB = makeOefening({ id: 'oB', naam: 'Oefening B', teams: [{ grootte: 1, formaties: [] }] })
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', parallel_groep_id: 'g1', parallel_spelers: [P1], oefeningen: oA })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', parallel_groep_id: 'g1', parallel_spelers: [P2], oefeningen: oB })

    renderGroup([k1, k2], { presentPlayerIds: [P1, P2] })

    expect(screen.getByText(nl.parallelGroep.compleet)).toBeInTheDocument()
    expect(screen.queryByText(/nog niet ingedeeld/)).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC15 — verdelen gebeurt uitsluitend handmatig (drag&drop of gelijkwaardig);
// geen automatische verdeelknop in deze release.
// ────────────────────────────────────────────────────────────────────────────
describe('AC15 — verdelen gebeurt uitsluitend handmatig: geen automatische verdeelknop', () => {
  it('de parallelle-verdeel-editor bevat geen "automatisch verdelen"-knop', () => {
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', parallel_groep_id: 'g1', oefeningen: makeOefening({ id: 'oA', naam: 'Oefening A' }) })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', parallel_groep_id: 'g1', oefeningen: makeOefening({ id: 'oB', naam: 'Oefening B' }) })

    const { container } = renderGroup([k1, k2])
    const editor = container.querySelector('[data-testid="parallelgroep-editor-g1"]') as HTMLElement
    const buttons = Array.from(editor.querySelectorAll('button'))
    expect(buttons.some((b) => /automat/i.test(b.textContent ?? ''))).toBe(false)
    expect(within(editor).queryByText(nl.teamIndeling.autoAssign)).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC16 — ongeldige invoer bij opslaan → generieke foutmelding, laatst
// bevestigde verdeling blijft zichtbaar (geen rauwe serverfout).
// ────────────────────────────────────────────────────────────────────────────
describe('AC16 — ongeldige invoer bij opslaan: generieke foutmelding, rollback naar de laatst bevestigde verdeling', () => {
  it('als de server "Speler niet gevonden" gooit (speler net hard verwijderd), toont de UI de generieke melding en valt de speler terug naar de pool', async () => {
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', parallel_groep_id: 'g1', oefeningen: makeOefening({ id: 'oA', naam: 'Oefening A' }) })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', parallel_groep_id: 'g1', oefeningen: makeOefening({ id: 'oB', naam: 'Oefening B' }) })

    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        players: { data: [] }, // simuleert een speler die vlak vóór het opslaan hard verwijderd is
      },
      queues: {
        training_oefeningen: [
          { data: { id: 'k1', parallel_groep_id: 'g1' } },
          { data: [{ id: 'k2', parallel_spelers: [] }] },
        ],
      },
    })
    use(m)

    const { container } = renderGroup([k1, k2])
    const pool = container.querySelector('[data-testid="parallelgroep-pool"]') as HTMLElement
    fireEvent.click(within(pool).getByRole('button', { name: /Piet/ }))
    fireEvent.click(screen.getByText(nl.parallelGroep.moveTo.replace('{target}', 'Oefening A')))

    await waitFor(() => expect(screen.getByText(nl.parallelGroep.saveError)).toBeInTheDocument())
    expect(screen.queryByText(/Speler niet gevonden/)).not.toBeInTheDocument()
    // Rollback: Piet staat weer gewoon selecteerbaar in de pool.
    expect(within(pool).getByRole('button', { name: /Piet/ })).toBeInTheDocument()
    expect(m.calls.update).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC17 — een koppeling die niet bestaat of niet bij deze trainer/training
// hoort wordt afgewezen bij opslaan van een verdeling.
// ────────────────────────────────────────────────────────────────────────────
describe('AC17 — een koppeling die niet bestaat of niet bij deze trainer/training hoort wordt geweigerd bij opslaan', () => {
  it('saveParallelIndeling gooit exact "Koppeling niet gevonden" en schrijft niets', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } }, training_oefeningen: { data: null } },
    })
    use(m)
    await expect(saveParallelIndeling('k-vreemd', 'e1', [])).rejects.toThrow('Koppeling niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC18 — training met precies 1 gekoppelde oefening: "parallelle groep
// vormen" is niet mogelijk (UI-actie onbeschikbaar / server weigert).
// ────────────────────────────────────────────────────────────────────────────
describe('AC18 — training met precies 1 gekoppelde oefening: groeperen is niet mogelijk', () => {
  it('het "Parallel aan"-veld is disabled zolang er maar 1 koppeling in de training zit', () => {
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', oefeningen: makeOefening({ id: 'oA', naam: 'Oefening A' }) })
    renderPlan([k1])

    fireEvent.click(screen.getByLabelText(nl.trainingPlan.detailsToggle))
    const select = screen.getByText(nl.trainingPlan.parallelLabel).closest('div')?.querySelector('select') as HTMLSelectElement
    expect(select).toBeDisabled()
  })

  it('en de server weigert ook bij een directe aanroep met die ene koppeling', async () => {
    const m = makeSupabase({ tables: { events: { data: { id: 'e1' } } } })
    use(m)
    await expect(vormParallelGroep('e1', ['k1'])).rejects.toThrow('Minimaal twee oefeningen voor een parallelle groep')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC19 — groep van 3, vierde oefening toegevoegd: nieuwkomer start leeg,
// bestaande verdeling van de andere 3 blijft ongewijzigd.
// ────────────────────────────────────────────────────────────────────────────
describe('AC19 — een vierde koppeling toevoegen aan een groep van 3: start leeg, de andere 3 blijven ongewijzigd', () => {
  it('voegToeAanParallelGroep zet alleen de nieuwkomer met een lege verdeling in de groep; k1/k2/k3 worden geen enkele keer geüpdatet', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'k4', parallel_groep_id: null } },
          { data: { id: 'k1' } },
          { error: null },
          { data: [
            { id: 'k1', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-02T00:00:00Z' },
            { id: 'k3', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-03T00:00:00Z' },
            { id: 'k4', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-04T00:00:00Z' },
          ] },
        ],
      },
    })
    use(m)

    await voegToeAanParallelGroep('e1', 'k4', 'g1')

    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].payload).toEqual({ parallel_groep_id: 'g1', parallel_spelers: [] })
    expect(m.calls.update[0].eqs).toContainEqual({ col: 'id', val: 'k4' })
    expect(m.calls.update.some((u) => u.eqs.some((e) => e.col === 'id' && ['k1', 'k2', 'k3'].includes(e.val as string)))).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC20 — een speler die na het verdelen als afwezig gemarkeerd wordt blijft
// zichtbaar ingedeeld staan MET waarschuwing (geen stille verwijdering).
// ────────────────────────────────────────────────────────────────────────────
describe('AC20 — een na verdelen afwezig gemarkeerde speler blijft zichtbaar ingedeeld staan met waarschuwing', () => {
  it('toont de "Afgemeld"-waarschuwing en verwijdert de speler niet stilzwijgend', () => {
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', parallel_groep_id: 'g1', parallel_spelers: [P1], oefeningen: makeOefening({ id: 'oA', naam: 'Oefening A' }) })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', parallel_groep_id: 'g1', oefeningen: makeOefening({ id: 'oB', naam: 'Oefening B' }) })

    const { container } = renderGroup([k1, k2], { presentPlayerIds: [P2, P3, P4] }) // P1 niet (meer) aanwezig

    expect(screen.getByText(nl.parallelGroep.absentWarning)).toBeInTheDocument()
    const lidA = container.querySelector('[data-testid="parallelgroep-lid-k1"]') as HTMLElement
    expect(lidA.textContent).toContain('Piet')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC21 — een speler die hard verwijderd is nadat hij al was ingedeeld valt
// vanzelf uit de geldige set, geen crash.
// ────────────────────────────────────────────────────────────────────────────
describe('AC21 — een hard verwijderde, al ingedeelde speler valt uit de geldige set, geen crash', () => {
  it('rendert zonder te crashen en toont een "Onbekende speler"-label voor een id dat niet meer in de spelerslijst voorkomt', () => {
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', parallel_groep_id: 'g1', parallel_spelers: [P1, P_GHOST], oefeningen: makeOefening({ id: 'oA', naam: 'Oefening A' }) })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', parallel_groep_id: 'g1', oefeningen: makeOefening({ id: 'oB', naam: 'Oefening B' }) })

    expect(() => renderGroup([k1, k2])).not.toThrow()
    expect(screen.getByText(nl.parallelGroep.unknownPlayer)).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC22 — een oefening uit een parallelle groep halen: verdeling van die
// oefening vervalt, rest van de groep blijft intact.
// ────────────────────────────────────────────────────────────────────────────
describe('AC22 — een oefening uit de groep halen laat de rest van de groep intact', () => {
  it('haalUitParallelGroep wist alleen de verdeling van de verwijderde koppeling; de overige twee groepsleden worden niet geüpdatet', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'k2', parallel_groep_id: 'g1' } },
          { error: null },
          { data: [{ id: 'k1' }, { id: 'k3' }] }, // nog 2 leden over: groep blijft bestaan
          { data: [
            { id: 'k1', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 1, parallel_groep_id: null, created_at: '2024-01-02T00:00:00Z' },
            { id: 'k3', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-03T00:00:00Z' },
          ] },
        ],
      },
    })
    use(m)

    await haalUitParallelGroep('e1', 'k2')

    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].eqs).toContainEqual({ col: 'id', val: 'k2' })
    expect(m.calls.update[0].payload).toEqual({ parallel_groep_id: null, parallel_spelers: [] })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC23 — een groep die door verwijdering nog maar 1 lid overhoudt: de
// parallelle status vervalt automatisch (weer een gewone koppeling).
// ────────────────────────────────────────────────────────────────────────────
describe('AC23 — een groep met nog maar 1 overgebleven lid vervalt automatisch', () => {
  it('haalUitParallelGroep wist parallel_groep_id bij BEIDE leden zodra er nog maar 1 zou overblijven', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'k1', parallel_groep_id: 'g1' } },
          { error: null },
          { data: [{ id: 'k2' }] }, // nog maar 1 lid over
          { error: null }, // ruimEenzameGroepOp wist ook k2
          { data: [
            { id: 'k1', volgorde: 0, parallel_groep_id: null, created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 1, parallel_groep_id: null, created_at: '2024-01-02T00:00:00Z' },
          ] },
        ],
      },
    })
    use(m)

    await haalUitParallelGroep('e1', 'k1')

    expect(m.calls.update).toHaveLength(2)
    expect(m.calls.update[1].eqs).toContainEqual({ col: 'id', val: 'k2' })
    expect(m.calls.update[1].payload).toEqual({ parallel_groep_id: null, parallel_spelers: [] })
  })

  it('een verse render van het resultaat toont de voormalige groepsleden weer als gewone, losse blokken', () => {
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', volgorde: 0, parallel_groep_id: null, created_at: '2024-01-01T00:00:00Z', oefeningen: makeOefening({ id: 'oA', naam: 'Oefening A' }) })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', volgorde: 1, parallel_groep_id: null, created_at: '2024-01-02T00:00:00Z', oefeningen: makeOefening({ id: 'oB', naam: 'Oefening B' }) })

    renderPlan([k1, k2])

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('1a')).not.toBeInTheDocument()
    expect(screen.queryByTestId(/parallelgroep-editor-/)).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC24 — een groep van 5 of meer leden: alle leden gerenderd, geen
// kunstmatige limiet-melding.
// ────────────────────────────────────────────────────────────────────────────
describe('AC24 — een groep van 5+ leden rendert alle leden, zonder kunstmatige limiet', () => {
  it('vijf gegroepeerde koppelingen krijgen allemaal een eigen sub-letter-badge (1a t/m 1e) en worden allemaal getoond', () => {
    const letters = ['A', 'B', 'C', 'D', 'E']
    const koppelingen = letters.map((letter, i) =>
      makeKoppeling({
        id: `k${i + 1}`,
        oefening_id: `o${letter}`,
        volgorde: 0,
        parallel_groep_id: 'g1',
        created_at: `2024-01-0${i + 1}T00:00:00Z`,
        oefeningen: makeOefening({ id: `o${letter}`, naam: `Oefening ${letter}` }),
      }),
    )

    const { container } = renderPlan(koppelingen)

    for (const label of ['1a', '1b', '1c', '1d', '1e']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    const editor = container.querySelector('[data-testid="parallelgroep-editor-g1"]') as HTMLElement
    expect(editor.querySelectorAll('[data-testid^="parallelgroep-lid-"]').length).toBe(5)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC25 — print-contract: groepswrapper draagt print:break-inside-avoid; het
// print-only verdelingsblok toont alleen namen (geen tekort/overschot, V6) en
// draagt zowel hidden als print:block.
// ────────────────────────────────────────────────────────────────────────────
describe('AC25 — print-contract: groepswrapper-klasse en print-only verdelingsblok (alleen namen)', () => {
  it('de groepswrapper heeft print:break-inside-avoid; het print-blok draagt hidden + print:block en toont alleen namen, geen tekort/overschot', () => {
    const oA = makeOefening({ id: 'oA', naam: 'Oefening A', teams: [{ grootte: 2, formaties: [] }] }) // benodigd 2, 1 toegewezen → tekort op scherm
    const oB = makeOefening({ id: 'oB', naam: 'Oefening B' })
    const k1 = makeKoppeling({ id: 'k1', oefening_id: 'oA', parallel_groep_id: 'g1', parallel_spelers: [P1], oefeningen: oA })
    const k2 = makeKoppeling({ id: 'k2', oefening_id: 'oB', parallel_groep_id: 'g1', oefeningen: oB })

    renderPlan([k1, k2])

    const editor = screen.getByTestId('parallelgroep-editor-g1')
    expect(editor.parentElement?.className).toContain('print:break-inside-avoid')

    // Scherm: tekort-melding is wél zichtbaar (contrast met het print-blok hieronder).
    expect(screen.getByText(nl.parallelGroep.tekort.replace('{n}', '1'))).toBeInTheDocument()

    const printBlok = screen.getByTestId('parallelgroep-print')
    expect(printBlok.className).toContain('hidden')
    expect(printBlok.className).toContain('print:block')
    expect(printBlok.textContent).toContain('Piet Peters')
    expect(printBlok.textContent).not.toContain(nl.parallelGroep.tekort.replace('{n}', '1'))
    expect(printBlok.textContent).not.toContain(nl.parallelGroep.overschot.replace('{n}', '1'))
  })
})
