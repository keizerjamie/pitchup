// Acceptatietests — Teamindeling (user story: aanwezige spelers binnen een
// trainingsoefening handmatig of automatisch aan de teams van die oefening
// koppelen, zodat de trainer vóór de training al weet wie in welk team zit).
//
// Dit bestand dekt AC1 t/m AC19 van de goedgekeurde story expliciet, per
// criterium een eigen describe-blok. Voor de happy-path-criteria (AC1-AC6)
// wordt bewust NIET de server action gemockt (in tegenstelling tot
// components/TeamIndelingEditor.test.tsx, dat saveSpelerindeling stubt) —
// hier draait de ECHTE saveSpelerindeling + het ECHTE lib/spelerindeling,
// met uitsluitend de Supabase-client (@/lib/supabase/server) gemockt. Dat
// bewijst de volledige keten van buitenaf: klik in de UI → server action →
// (gemockte) database-call, precies zoals de brief het voor AC4 vraagt.
//
// Criteria die al aantoonbaar en zonder gat gedekt zijn door bestaande tests
// (components/TeamIndelingEditor.test.tsx, app/actions/training-plan.test.ts,
// lib/spelerindeling.test.ts) worden hier NIET gedupliceerd — voor die
// criteria staat een comment-blok met exacte verwijzing naar de dekkende
// test, dezelfde conventie als oefening-bibliotheek.acceptance.test.tsx en
// tactiekbord-diagram.acceptance.test.tsx.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Oefening, OefeningTeam, Player, TrainingOefeningWithData } from '@/lib/types'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { saveSpelerindeling } from '@/app/actions/training-plan'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Gedeelde Supabase-mock, zelfde patroon als de bestaande action-/
// acceptatietests (oefening-bibliotheek.acceptance.test.tsx). ──
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

// ── Fixtures (zelfde spelers/nummers als components/TeamIndelingEditor.test.tsx
// voor herkenbaarheid tussen de testbestanden). ──
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

const players4: Player[] = [
  makePlayer({ id: 'p1', name: 'Piet Peters', jersey_number: 1 }),
  makePlayer({ id: 'p2', name: 'Jan Jansen', jersey_number: 2 }),
  makePlayer({ id: 'p3', name: 'Kees Klaassen', jersey_number: 3 }),
  makePlayer({ id: 'p4', name: 'Bram Bakker', jersey_number: 4 }),
]

const twoTeams: OefeningTeam[] = [
  { grootte: 2, formaties: [] },
  { grootte: 2, formaties: [] },
]

function makeOefening(overrides: Partial<Oefening> = {}): Oefening {
  return {
    id: 'o1',
    team_id: 'team-1',
    naam: 'Positiespel',
    beschrijving: null,
    categorie: 'partijen_klein',
    duur_min: null,
    breedte_m: null,
    lengte_m: null,
    orientatie: 'vrij',
    veldzone: null,
    teams: twoTeams,
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

function renderPlan(koppeling: TrainingOefeningWithData, opts: { players?: Player[]; presentPlayerIds?: string[] } = {}) {
  return render(
    <DictProvider dict={nl}>
      <TrainingPlanEditor
        eventId="e1"
        initialDoelstelling={null}
        initialOefeningen={[koppeling]}
        library={[]}
        currentSteps={{}}
        hasNulmeting={false}
        suggestion={null}
        players={opts.players ?? players4}
        presentPlayerIds={opts.presentPlayerIds ?? ['p1', 'p2', 'p3', 'p4']}
      />
    </DictProvider>,
  )
}

// Scopet queries tot de pool-sectie ("Nog in te delen"), zodat een
// jersey-nummer als "1" niet verward wordt met bijv. het stapnummer-badge
// van de oefening zelf (die ook los "1" rendert).
function poolContainer() {
  return screen.getByText(nl.teamIndeling.poolLabel).parentElement!
}

const tablesFor = (koppelingId: string, teams: OefeningTeam[], spelers: { id: string }[] = players4.map((p) => ({ id: p.id }))) => ({
  events: { data: { id: 'e1' } },
  training_oefeningen: { data: { id: koppelingId, oefeningen: { teams } }, error: null },
  players: { data: spelers },
})

// ────────────────────────────────────────────────────────────────────────────
// AC1 — per gekoppelde oefening met geconfigureerde teams: aparte kaart per
// team + pool met nog niet-ingedeelde AANWEZIGE spelers.
// ────────────────────────────────────────────────────────────────────────────
describe('AC1 — teamkaarten + pool met nog niet-ingedeelde aanwezige spelers', () => {
  it('toont per team een aparte kaart en een pool met alle aanwezige, nog niet-ingedeelde spelers', () => {
    const koppeling = makeKoppeling({ id: 'k1' })
    renderPlan(koppeling)

    expect(screen.getByText(/Team 1/)).toBeInTheDocument()
    expect(screen.getByText(/Team 2/)).toBeInTheDocument()
    expect(screen.getByText(nl.teamIndeling.poolLabel)).toBeInTheDocument()

    // Alle 4 aanwezige spelers staan in de pool (nog niets ingedeeld).
    for (const name of ['Piet', 'Jan', 'Kees', 'Bram']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('button', { name: /Piet|Jan|Kees|Bram/ })).toHaveLength(4)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC2 / AC4 — een aanwezige speler koppelen: verschijnt in de teamkaart,
// verdwijnt uit de pool, en de koppeling wordt ECHT gepersisteerd via
// saveSpelerindeling (server action + database-call), niet slechts lokale
// state.
// ────────────────────────────────────────────────────────────────────────────
describe('AC2 / AC4 — aanwezige speler koppelen aan een team, echt gepersisteerd via saveSpelerindeling', () => {
  it('klikken op een poolspeler en daarna "Verplaats naar Team 1" roept de echte saveSpelerindeling aan en werkt de UI bij', async () => {
    const m = makeSupabase({ tables: tablesFor('k1', twoTeams) })
    use(m)
    const koppeling = makeKoppeling({ id: 'k1' })
    renderPlan(koppeling)

    // Vooraf: jersey-badge "1" bestaat in de pool-weergave van Piet.
    expect(within(poolContainer()).getByText('1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Piet/ }))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 1')))

    // UI: Piet verschijnt nu als team-chip, en zijn jersey-badge in de pool
    // (die alleen daar gerenderd wordt) is weg — hij zit niet meer in de pool.
    expect(screen.getByText('Piet')).toBeInTheDocument()
    expect(within(poolContainer()).queryByText('1')).not.toBeInTheDocument()

    // Persistentie: de ECHTE server action heeft een update op
    // training_oefeningen gedaan, gescoped op deze koppeling + team, met de
    // nieuwe indeling.
    await waitFor(() => expect(m.calls.update).toHaveLength(1))
    expect(m.calls.update[0].table).toBe('training_oefeningen')
    expect(m.calls.update[0].payload.spelerindeling).toEqual([['p1'], []])
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'id', val: 'k1' })
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'team_id', val: 'team-1' })
  })

  it('een verse render (zoals na herladen / op een ander apparaat) toont een bestaande initialIndeling meteen correct terug', () => {
    // Simuleert wat de server-pagina na een herlaad/ander-apparaat-bezoek
    // aanlevert: een koppeling met een reeds opgeslagen spelerindeling.
    const koppeling = makeKoppeling({ id: 'k1', spelerindeling: [['p1'], ['p2']] })
    renderPlan(koppeling)

    // p1 en p2 staan meteen in hun team (niet in de pool: geen jersey-badges "1"/"2").
    expect(screen.getByText('Piet')).toBeInTheDocument()
    expect(screen.getByText('Jan')).toBeInTheDocument()
    expect(within(poolContainer()).queryByText('1')).not.toBeInTheDocument()
    expect(within(poolContainer()).queryByText('2')).not.toBeInTheDocument()

    // p3 en p4 zijn wél aanwezig en nog niet ingedeeld: staan in de pool.
    expect(screen.getByRole('button', { name: /Kees/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bram/ })).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC3 — "genereer automatisch" verdeelt de aanwezige, nog niet-ingedeelde
// spelers over de teams; daarna is de indeling nog steeds handmatig
// aanpasbaar (in tegenstelling tot components/TeamIndelingEditor.test.tsx,
// dat alleen de auto-verdeling zelf toetst, niet de handmatige vervolgstap).
// ────────────────────────────────────────────────────────────────────────────
describe('AC3 — automatisch genereren, en daarna handmatig aanpasbaar', () => {
  it('"genereer automatisch" verdeelt alle aanwezige spelers, en een automatisch ingedeelde speler kan daarna alsnog handmatig naar een ander team', async () => {
    const m = makeSupabase({ tables: tablesFor('k1', twoTeams) })
    use(m)
    const koppeling = makeKoppeling({ id: 'k1' })
    renderPlan(koppeling)

    fireEvent.click(screen.getByText(nl.teamIndeling.autoAssign))
    await waitFor(() => expect(m.calls.update).toHaveLength(1))
    const autoResult = m.calls.update[0].payload.spelerindeling as string[][]
    expect(autoResult.flat().sort()).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(autoResult[0]).toHaveLength(2)
    expect(autoResult[1]).toHaveLength(2)

    // Handmatig aanpasbaar: verplaats de eerste automatisch ingedeelde speler
    // van team 0 naar team 2.
    const movedId = autoResult[0][0]
    const movedPlayer = players4.find((p) => p.id === movedId)!
    const firstName = movedPlayer.name.split(' ')[0]
    fireEvent.click(screen.getByText(firstName))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 2')))

    await waitFor(() => expect(m.calls.update).toHaveLength(2))
    const manualResult = m.calls.update[1].payload.spelerindeling as string[][]
    expect(manualResult[1]).toContain(movedId)
    expect(manualResult[0]).not.toContain(movedId)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC5 — een speler uit een team verwijderen: hij staat weer in de pool
// (volledige integratie met de echte saveSpelerindeling).
// ────────────────────────────────────────────────────────────────────────────
describe('AC5 — speler uit een team verwijderen komt terug in de pool', () => {
  it('de "uit team halen"-knop koppelt de speler los via de echte saveSpelerindeling en hij wordt weer selecteerbaar in de pool', async () => {
    const m = makeSupabase({ tables: tablesFor('k1', twoTeams) })
    use(m)
    const koppeling = makeKoppeling({ id: 'k1', spelerindeling: [['p1'], []] })
    renderPlan(koppeling)

    fireEvent.click(screen.getByLabelText(`${nl.teamIndeling.remove}: Piet`))

    await waitFor(() => expect(m.calls.update).toHaveLength(1))
    expect(m.calls.update[0].payload.spelerindeling).toEqual([[], []])
    // Piet is weer een selecteerbare poolspeler (met jersey-badge).
    expect(screen.getByRole('button', { name: /Piet/ })).toBeInTheDocument()
    expect(within(poolContainer()).getByText('1')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC6 — dezelfde bibliotheek-oefening in training A en training B: de
// indelingen zijn onafhankelijk. Bewijs via een gedeelde, stateful mock dat
// de write scoped is op koppelingId (nooit op oefening_id), zodat wijzigen
// van koppeling A koppeling B nooit raakt.
// ────────────────────────────────────────────────────────────────────────────
describe('AC6 — twee koppelingen van dezelfde bibliotheek-oefening zijn onafhankelijk', () => {
  function makeTweeTrainingenSupabase() {
    const store: Record<string, { id: string; team_id: string; event_id: string; spelerindeling: string[][] }> = {
      kA: { id: 'kA', team_id: 'team-1', event_id: 'eA', spelerindeling: [] },
      kB: { id: 'kB', team_id: 'team-1', event_id: 'eB', spelerindeling: [] },
    }
    const events: Record<string, { id: string }> = { eA: { id: 'eA' }, eB: { id: 'eB' } }
    const teams: OefeningTeam[] = [{ grootte: 6, formaties: [] }, { grootte: 6, formaties: [] }]
    const calls = { update: [] as { id: string | null; teamIdEq: string | null; payload: Record<string, unknown> }[] }

    function eventsChain() {
      let idFilter: string | null = null
      let teamFilter: string | null = null
      const c: Record<string, unknown> = {
        select: () => c,
        eq: (col: string, val: unknown) => {
          if (col === 'id') idFilter = val as string
          if (col === 'team_id') teamFilter = val as string
          return c
        },
        maybeSingle: () => Promise.resolve({ data: idFilter && teamFilter === 'team-1' ? events[idFilter] ?? null : null }),
      }
      return c
    }

    function trainingOefeningenChain() {
      let idFilter: string | null = null
      let eventFilter: string | null = null
      let teamFilter: string | null = null
      let mode: 'select' | 'update' = 'select'
      let updatePayload: Record<string, unknown> | null = null
      const c: Record<string, unknown> = {
        select: () => { mode = 'select'; return c },
        update: (payload: Record<string, unknown>) => { mode = 'update'; updatePayload = payload; return c },
        eq: (col: string, val: unknown) => {
          if (col === 'id') idFilter = val as string
          if (col === 'event_id') eventFilter = val as string
          if (col === 'team_id') teamFilter = val as string
          return c
        },
        maybeSingle: () => {
          const row = idFilter ? store[idFilter] : undefined
          if (!row || row.team_id !== teamFilter || row.event_id !== eventFilter) return Promise.resolve({ data: null })
          return Promise.resolve({ data: { id: row.id, oefeningen: { teams } } })
        },
      }
      ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => {
        if (mode === 'update' && idFilter && updatePayload) {
          calls.update.push({ id: idFilter, teamIdEq: teamFilter, payload: updatePayload })
          const row = store[idFilter]
          if (row && row.team_id === teamFilter) {
            row.spelerindeling = updatePayload.spelerindeling as string[][]
          }
        }
        return res({ error: null })
      }
      return c
    }

    function playersChain() {
      const c: Record<string, unknown> = { select: () => c, eq: () => c }
      ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ data: [{ id: 'p1' }, { id: 'p2' }] })
      return c
    }

    const supabase = {
      from: (t: string) => {
        if (t === 'events') return eventsChain()
        if (t === 'training_oefeningen') return trainingOefeningenChain()
        if (t === 'players') return playersChain()
        throw new Error(`onverwachte tabel in AC6-mock: ${t}`)
      },
      auth: { getUser: async () => ({ data: { user: { id: 'team-1' } } }) },
    }
    return { supabase, store, calls }
  }

  it('saveSpelerindeling schrijft gescoped op koppelingId: koppeling A wijzigen raakt koppeling B niet, en omgekeerd', async () => {
    const { supabase, store, calls } = makeTweeTrainingenSupabase()
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>)

    await saveSpelerindeling('kA', 'eA', [['p1'], []])

    expect(store.kA.spelerindeling).toEqual([['p1'], []])
    expect(store.kB.spelerindeling).toEqual([]) // ongewijzigd
    expect(calls.update).toHaveLength(1)
    expect(calls.update[0].id).toBe('kA')
    expect(calls.update.some((u) => u.id === 'kB')).toBe(false)

    await saveSpelerindeling('kB', 'eB', [[], ['p2']])

    expect(store.kB.spelerindeling).toEqual([[], ['p2']])
    // De write op B heeft koppeling A niet aangeraakt.
    expect(store.kA.spelerindeling).toEqual([['p1'], []])
    expect(calls.update).toHaveLength(2)
    expect(calls.update[1].id).toBe('kB')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC7 — een niet-aanwezige speler staat niet in de pool (niet selecteerbaar).
// Reeds gedekt door components/TeamIndelingEditor.test.tsx, describe
// 'TeamIndelingEditor — pool en handmatig koppelen', it('een niet-aanwezige
// speler staat niet in de pool'). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// AC8 — player_id dat niet bij het eigen team hoort → 'Speler niet gevonden',
// geen update. Reeds gedekt door app/actions/training-plan.test.ts, describe
// 'saveSpelerindeling', it('gooit "Speler niet gevonden" bij een player_id
// buiten de tenant'). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// AC9 — koppeling die niet bij het eigen team/event hoort → 'Koppeling niet
// gevonden', geen update. Reeds gedekt door app/actions/training-plan.test.ts,
// describe 'saveSpelerindeling', it('gooit "Koppeling niet gevonden" bij een
// koppeling van een ander team'). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// AC10 — teamIndex buiten de teams-lengte → 'Team bestaat niet in deze
// oefening', niet stilzwijgend geaccepteerd. Reeds gedekt door
// app/actions/training-plan.test.ts, describe 'saveSpelerindeling', it('gooit
// "Team bestaat niet in deze oefening" bij een teamIndex buiten de
// teams-lengte'). Ook op puur-functieniveau in lib/spelerindeling.test.ts.
// Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// AC11 — niet ingelogd → 'Niet ingelogd', geen update. Reeds gedekt door
// app/actions/training-plan.test.ts, describe 'saveSpelerindeling', it('gooit
// "Niet ingelogd" zonder user'). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// AC12 — alleen spelers met attendance-status present zijn selecteerbaar,
// ook als input voor "genereer automatisch". Het niet-selecteerbaar zijn in
// de pool is al gedekt (zie AC7); hier het ontbrekende stuk: een afwezige
// speler wordt door de auto-knop ook niet in een team geplaatst, terwijl de
// echte server action + database-call meedraait.
// ────────────────────────────────────────────────────────────────────────────
describe('AC12 — alleen aanwezige spelers zijn input voor "genereer automatisch"', () => {
  it('"genereer automatisch" plaatst een niet-aanwezige speler nooit in een team', async () => {
    const teams: OefeningTeam[] = [{ grootte: 3, formaties: [] }]
    const m = makeSupabase({ tables: tablesFor('k1', teams, [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]) })
    use(m)
    const koppeling = makeKoppeling({ id: 'k1', oefening: { teams } })
    // p3 (Kees) is niet aanwezig.
    renderPlan(koppeling, { presentPlayerIds: ['p1', 'p2'] })

    fireEvent.click(screen.getByText(nl.teamIndeling.autoAssign))

    await waitFor(() => expect(m.calls.update).toHaveLength(1))
    const result = m.calls.update[0].payload.spelerindeling as string[][]
    expect(result.flat().sort()).toEqual(['p1', 'p2'])
    expect(result.flat()).not.toContain('p3')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC13 — speler die ná indeling afwezig wordt gemeld blijft in zijn team
// staan MET zichtbare waarschuwing. Reeds gedekt door
// components/TeamIndelingEditor.test.tsx, describe 'TeamIndelingEditor —
// waarschuwingen', it('toont een afwezig-waarschuwing voor een ingedeelde
// speler die niet meer aanwezig is, en verwijdert hem niet automatisch').
// Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// AC14 — speler die ná indeling inactief is (niet in de players-lijst)
// blijft staan als generieke "onbekende speler"-waarschuwingschip. Reeds
// gedekt door components/TeamIndelingEditor.test.tsx, describe
// 'TeamIndelingEditor — waarschuwingen', it('toont een generieke "onbekende
// speler"-waarschuwing voor een id die niet in players voorkomt, en
// verwijdert hem niet automatisch'). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// AC15 — teamgrootte-mismatch → waarschuwing op de teamkaart, indeling
// blijft ongewijzigd, niets stilzwijgend losgekoppeld. Reeds gedekt door
// components/TeamIndelingEditor.test.tsx, describe 'TeamIndelingEditor —
// waarschuwingen', it('toont een grootte-mismatch-waarschuwing zonder de
// indeling te wijzigen'). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// AC16 — "genereer automatisch" vult alleen open plekken; bestaande
// handmatige toewijzingen blijven staan. Reeds gedekt door
// components/TeamIndelingEditor.test.tsx, describe 'TeamIndelingEditor —
// genereer automatisch', it('vult alleen open plekken aan: bestaande
// handmatige toewijzing blijft staan'), en op puur-functieniveau door
// lib/spelerindeling.test.ts, it('vult alleen open plekken; bestaande
// toewijzingen blijven staan'). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// AC17 — een al ingedeelde speler aan een ander team koppelen: hij schuift
// automatisch mee, nooit in twee teams tegelijk. Reeds gedekt door
// components/TeamIndelingEditor.test.tsx, describe 'TeamIndelingEditor — pool
// en handmatig koppelen', it('een al ingedeelde speler naar een ander team
// koppelen schuift hem automatisch mee'). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// AC18 — team zonder vaste grootte ("losse plaatsing") ontvangt onbeperkt
// spelers; het overschot van "genereer automatisch" komt daarin terecht.
// De pure verdeellogica is al gedekt in lib/spelerindeling.test.ts, maar
// GEEN bestaande test toont dit via de daadwerkelijke UI + echte server
// action — dat gat wordt hier gedicht.
// ────────────────────────────────────────────────────────────────────────────
describe('AC18 — team zonder vaste grootte ontvangt onbeperkt het overschot van automatisch indelen', () => {
  it('"genereer automatisch" plaatst het overschot in het losse team, zonder groottewaarschuwing', async () => {
    const teams: OefeningTeam[] = [{ grootte: 1, formaties: [] }, { grootte: 0, formaties: [] }]
    const m = makeSupabase({ tables: tablesFor('k1', teams) })
    use(m)
    const koppeling = makeKoppeling({ id: 'k1', oefening: { teams } })
    renderPlan(koppeling)

    // Team 2 is een losse plaatsing (geen vaste grootte) — de tekst zit
    // gecombineerd in "Team 2 · Losse plaatsing", vandaar een regex-match.
    expect(screen.getByText(new RegExp(nl.teamIndeling.losseTeam))).toBeInTheDocument()

    fireEvent.click(screen.getByText(nl.teamIndeling.autoAssign))

    await waitFor(() => expect(m.calls.update).toHaveLength(1))
    const result = m.calls.update[0].payload.spelerindeling as string[][]
    expect(result[0]).toHaveLength(1) // team-met-grootte 1: exact vol
    expect(result[1]).toHaveLength(3) // losse team krijgt het volledige overschot
    expect(result.flat().sort()).toEqual(['p1', 'p2', 'p3', 'p4'])

    // Geen groottewaarschuwing: team 0 zit exact op zijn grootte (niet erover),
    // en het losse team kent per definitie geen groottelimiet.
    expect(screen.queryByText(nl.teamIndeling.sizeWarning.replace('{n}', '1'))).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC19 — lege staten: training zonder aanwezige spelers, en oefening zonder
// geconfigureerde teams — geen crash, nette lege staat. Reeds gedekt door
// components/TeamIndelingEditor.test.tsx, describe 'TeamIndelingEditor —
// lege staten' (beide gevallen). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────
