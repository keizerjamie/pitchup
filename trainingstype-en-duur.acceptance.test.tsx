// Onafhankelijke acceptatietests — Trainingstype (VCT/Teamtactisch) + Duur per
// koppeling (technische brief "Trainingstype (A) + duur per koppeling (B)").
//
// Dit bestand is de ONAFHANKELIJKE verificatie van de test-verifier, los van
// trainingstype.acceptance.test.tsx en duur-per-koppeling.acceptance.test.tsx
// die de bouwers zelf al schreven (wel gelezen, niet gekopieerd — eigen
// fixtures, eigen aanpak waar dat sterker bewijst).
//
// ── Aanpak ──
// UI-criteria: de ECHTE `TrainingPlanEditor` / `app/events/new/page.tsx`
// gerenderd tegen een gemockte Supabase-TABEL-ENGINE die `.eq/.gt/.lt/.in/
// .order/.limit` ECHT toepast én insert/update ECHT muteert (patroon van
// inzichten.acceptance.test.tsx / dashboard-vorm.acceptance.test.tsx,
// uitgebreid met mutatie). De server actions (`updateKoppeling`,
// `updateTrainingstype`, ...) zijn NERGENS in dit bestand gemockt — het zijn
// de echte functies uit app/actions/*, die tegen de gemockte
// `createClient()` draaien. Dat bewijst de volledige keten van buitenaf:
// klikken/typen → client-optimistisch → echte server action → gemuteerde
// (gemockte) database → weergave.
// Server-criteria (telling, tenant-isolatie, kopie, voorrang) roepen dezelfde
// server actions / lib-functies rechtstreeks aan, met dezelfde tabel-engine.
//
// ── Criterium → testnaam ──
// A1  → describe('A1 — aanmaakformulier')
// A2  → describe('A2 — trainingstype wordt opgeslagen') (server) +
//        describe('A2/A3 — schakelaar toont het opgeslagen type')
// A3  → describe('A3 — schakelaar wijzigt het type')
// A4  → describe('A4 — stapveld volgt trainingstype per categorie')
// A5  → describe('A5 — teamtactische trainingen tellen niet mee')
// A6  → describe('A6 — afdruk toont geen stapinformatie bij teamtactisch')
// A7  → describe('A7 — stap_override blijft bewaard bij wisselen')
// A8  → describe('A8 — validatie en tenant-isolatie')
// A9  → describe('A5 — teamtactische trainingen tellen niet mee') (server, geen
//        terugwerkende kracht) + describe('A9 — training zonder trainingstype
//        gedraagt zich als VCT') (UI)
// A10 → describe('A10 — mislukte save van trainingstype')
// A11 → describe('A11 — cyclusweek-suggestie volgt trainingstype')
// Edge teamtactisch zonder oefeningen / mix categorieën →
//        describe('A5 — teamtactische trainingen tellen niet mee')
// Edge gekopieerd plan, stap_override zonder effect →
//        describe('Edge A — gekopieerd stap_override zonder effect bij teamtactisch')
// Edge warming_up geen extra stapveld →
//        describe('Edge A — warming_up krijgt geen extra stapveld bij teamtactisch')
//
// B1  → describe('B1 — koppeling krijgt eenmalig de bibliotheekduur')
// B2  → describe('B2 — handmatig wijzigen raakt alleen de koppeling')
// B3  → describe('B3 — auto-berekening bij stapkeuze (partijen_*)')
// B4  → describe('B4 — handmatige aanpassing na auto-berekening blijft staan')
// B5  → describe('B5 — stap wissen laat de duur met rust')
// B6  → describe('B6 — geen auto-berekening buiten partijen_*')
// B7  → describe('B7 — legacy-koppeling valt terug op de bibliotheekduur')
// B8  → describe('B8 — kopiëren neemt de koppeling-duur mee')
// B9  → describe('B9 — duur 0 is "geen duur"; \'0\' blijft 0')
// B10 → describe('B10 — clamp en tenant-isolatie op de duur')
// B11 → zie testverslag: niet apart in dit bestand, bevestigd doordat de
//        bestaande oefening-bibliotheek/oefening-picker-filters-suites
//        ongewijzigd groen blijven (npm test) en B2 bewijst dat de bibliotheek
//        nooit geraakt wordt.
// B12 → describe('B12 — mislukte save van de duur')
// B13 → describe('B13 — voorrang: berekening wint van een gelijktijdige duur_min')
// Edge bibliotheek zonder duur, gekoppeld zonder stap →
//        describe('Edge B — bibliotheek-oefening zonder duur, geen stap')
// Edge parallelle groep, langste effectieve duur →
//        describe('Edge B — parallelle groep telt de langste effectieve duur')
// Edge dezelfde oefening meerdere keren, onafhankelijk →
//        describe('Edge B — dezelfde bibliotheek-oefening twee keer gekoppeld')

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Oefening, OefeningCategorie, Player, TrainingOefeningWithData, TrainingsType } from '@/lib/types'
import { concretiseerBezetting, type TrainingOefeningMetBezetting } from '@/lib/oefening-bezetting'
import { effectieveDuurMin } from '@/lib/sessie-tijdlijn'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { countCategoryOccurrences, getTrainingLog, type ActueleMeting } from '@/lib/periodization'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// Geïsoleerd van deze feature, zelfde reden als app/actions/events.test.ts.
vi.mock('@/app/actions/settings', () => ({ getDefaultAttendance: vi.fn(async () => 'present') }))

import { createClient } from '@/lib/supabase/server'
import { createEvent, updateTrainingstype } from '@/app/actions/events'
import { addOefeningToTraining, updateKoppeling, kopieerTrainingsplan } from '@/app/actions/training-plan'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import NewEventPage from '@/app/events/new/page'

const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'

beforeEach(() => {
  vi.clearAllMocks()
  // shouldAdvanceTime: true — laat testing-library's eigen waitFor-polling
  // (echte setTimeout) doorlopen naast de expliciet geadvancete debounce-
  // timer van het duurveld. Zelfde precedent als duur-per-koppeling.
  // acceptance.test.tsx. Raakt de server-only tests niet (die leunen op
  // Promises, niet op timers).
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

// ════════════════════════════════════════════════════════════════════════
// Gedeelde, MUTERENDE tabel-engine. `.eq/.gt/.lt/.gte/.lte/.in/.order/.limit`
// passen ECHT filters/sortering toe op de in-memory rijen; `.insert`/
// `.update` muteren die rijen ECHT. Zonder deze mutatie zou een test niet
// kunnen bewijzen dat bv. `.eq('team_id', user.id)` een update op andermans
// rij daadwerkelijk buiten schot houdt (B10/A8) — met een canned-response
// mock zou de test slagen ongeacht wat de productiecode aan filters gebruikt.
//
// `.eq()` sluit een rij NIET uit als de kolom er domweg niet op staat (zelfde
// regel als lib/periodization.test.ts) — nodig voor de A9-rand ("training
// zonder trainingstype in de rij gedraagt zich als VCT"). Elke fixture zet
// desondanks altijd expliciet `team_id`/`id`/`type`/`event_id`, zodat deze
// coulance de tenant-isolatie-bewijzen niet verzwakt.
type Row = Record<string, unknown>
type Seed = { events?: Row[]; training_oefeningen?: Row[]; oefeningen?: Row[] }

function maakEngine(opts: {
  user?: { id: string } | null
  seed?: Seed
  // Laat precies de EERSTVOLGENDE insert/update op deze tabel een fout
  // teruggeven i.p.v. de mutatie toe te passen — simuleert een echte,
  // eenmalige DB-fout voor de rollback-tests (A10/B12).
  failOnce?: { table: string; op: 'insert' | 'update' }
} = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const db: Record<string, Row[]> = {
    events: opts.seed?.events ?? [],
    training_oefeningen: opts.seed?.training_oefeningen ?? [],
    oefeningen: opts.seed?.oefeningen ?? [],
  }
  let fail = opts.failOnce ?? null

  function chain(table: string) {
    if (!db[table]) db[table] = []
    const rows = db[table]
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean }[] = []
    let limitN: number | null = null
    let pendingInsert: Row[] | null = null
    let pendingUpdate: Row | null = null

    function matched(): Row[] {
      let out = rows.filter((r) => filters.every((f) => f(r)))
      if (orders.length > 0) {
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const av = a[o.col] as string | number | undefined
            const bv = b[o.col] as string | number | undefined
            if (av === bv) continue
            if (av === undefined || av === null) return o.ascending ? -1 : 1
            if (bv === undefined || bv === null) return o.ascending ? 1 : -1
            return av < bv ? (o.ascending ? -1 : 1) : o.ascending ? 1 : -1
          }
          return 0
        })
      }
      if (limitN !== null) out = out.slice(0, limitN)
      return out
    }

    function execute(single: boolean): { data: unknown; error: unknown } {
      if (pendingInsert) {
        if (fail && fail.table === table && fail.op === 'insert') {
          fail = null
          return { data: null, error: { message: 'RUWE_TESTFOUT_insert' } }
        }
        const created = pendingInsert.map((r, i) => ({ id: (r.id as string) ?? `gen-${table}-${rows.length}-${i}`, ...r }))
        rows.push(...created)
        return single ? { data: created[0] ?? null, error: null } : { data: created, error: null }
      }
      if (pendingUpdate) {
        if (fail && fail.table === table && fail.op === 'update') {
          fail = null
          return { data: null, error: { message: 'RUWE_TESTFOUT_update' } }
        }
        for (const t of matched()) Object.assign(t, pendingUpdate)
        return { data: null, error: null }
      }
      const out = matched()
      return single ? { data: out[0] ?? null, error: null } : { data: out, error: null }
    }

    const c: Record<string, unknown> = {
      select: () => c,
      eq: (col: string, val: unknown) => { filters.push((r) => !(col in r) || r[col] === val); return c },
      neq: (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return c },
      gt: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) > (val as string | number)); return c },
      gte: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) >= (val as string | number)); return c },
      lt: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) < (val as string | number)); return c },
      lte: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) <= (val as string | number)); return c },
      in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return c },
      order: (col: string, o: { ascending?: boolean } = {}) => { orders.push({ col, ascending: o.ascending ?? true }); return c },
      limit: (n: number) => { limitN = n; return c },
      insert: (payload: Row | Row[]) => { pendingInsert = Array.isArray(payload) ? payload : [payload]; return c },
      update: (payload: Row) => { pendingUpdate = payload; return c },
      maybeSingle: () => Promise.resolve(execute(true)),
      single: () => Promise.resolve(execute(true)),
      then: (resolve: (v: unknown) => unknown) => resolve(execute(false)),
    }
    return c
  }

  const supabase = { from: (t: string) => chain(t), auth: { getUser: async () => ({ data: { user } }) } }
  return { db, supabase }
}

function koppelEngine(engine: ReturnType<typeof maakEngine>) {
  vi.mocked(createClient).mockResolvedValue(engine.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

// ── DB-fixtures (los van de UI-typen hieronder) ──
function eventRow(overrides: Row = {}): Row {
  return { id: 'e1', team_id: TEAM, type: 'training', date: '2026-01-10', trainingstype: 'vct', ...overrides }
}

// ── UI-fixtures (echte lib/types-vormen, zoals TrainingPlanEditor ze krijgt) ──
function maakOefening(overrides: Partial<Oefening> = {}): Oefening {
  return {
    id: 'o1', team_id: TEAM, naam: 'Oefening', beschrijving: null,
    categorie: 'partijen_klein', duur_min: 10, breedte_m: null, lengte_m: null,
    orientatie: 'vrij', veldzone: null, teams: [], aantal_neutralen: 0,
    diagram: null, created_at: '2024-01-01T00:00:00Z', ...overrides,
  }
}

function maakKoppeling(
  overrides: Partial<TrainingOefeningWithData> & { oefening?: Partial<Oefening> } = {},
): TrainingOefeningMetBezetting {
  const { oefening, ...rest } = overrides
  const basis = { ...maakOefening(), ...oefening }
  const koppeling: TrainingOefeningWithData = {
    id: 'k1', team_id: TEAM, event_id: 'e1', oefening_id: basis.id, volgorde: 0,
    stap_override: null, genest_in: null, spelerindeling: [], duur_min: null,
    created_at: '2024-01-01T00:00:00Z', oefeningen: basis, ...rest,
  }
  return { ...koppeling, bezetting: concretiseerBezetting(koppeling.oefeningen, koppeling.aantallen_override ?? null) }
}

// Dezelfde koppeling omgezet naar de vorm die de tabel-engine verwacht (de
// bibliotheek-oefening als embedded join, zoals PostgREST `oefeningen(...)`
// levert — zie lib/periodization.ts joinedCategorie).
function dbRowVoorKoppeling(k: TrainingOefeningMetBezetting): Row {
  return {
    id: k.id, team_id: k.team_id, event_id: k.event_id, oefening_id: k.oefening_id,
    volgorde: k.volgorde, stap_override: k.stap_override, duur_min: k.duur_min ?? null,
    parallel_groep_id: k.parallel_groep_id ?? null,
    oefeningen: { categorie: k.oefeningen.categorie },
  }
}

function dbRowVoorOefening(o: Oefening): Row {
  return { id: o.id, team_id: o.team_id, duur_min: o.duur_min, categorie: o.categorie }
}

function renderPlan(
  koppelingen: TrainingOefeningMetBezetting[],
  opts: {
    eventId?: string
    initialTrainingstype?: TrainingsType
    suggestion?: { week: number; items: { key: string; step: number | null }[] } | null
    currentSteps?: Record<string, number | null>
    failOnce?: { table: string; op: 'insert' | 'update' }
  } = {},
) {
  const eventId = opts.eventId ?? 'e1'
  const oefeningenById = new Map<string, Oefening>()
  for (const k of koppelingen) oefeningenById.set(k.oefeningen.id, k.oefeningen)

  const engine = maakEngine({
    seed: {
      events: [eventRow({ id: eventId, trainingstype: opts.initialTrainingstype ?? 'vct' })],
      training_oefeningen: koppelingen.map(dbRowVoorKoppeling),
      oefeningen: Array.from(oefeningenById.values()).map(dbRowVoorOefening),
    },
    failOnce: opts.failOnce,
  })
  koppelEngine(engine)

  const utils = render(
    <DictProvider dict={nl}>
      <TrainingPlanEditor
        eventId={eventId}
        initialDoelstelling={null}
        initialOefeningen={koppelingen}
        library={[]}
        currentSteps={opts.currentSteps ?? {}}
        hasNulmeting={true}
        suggestion={opts.suggestion ?? null}
        players={[] as Player[]}
        presentPlayerIds={[]}
        startTijd={null}
        kopieerOpties={[]}
        initialTrainingstype={opts.initialTrainingstype ?? 'vct'}
      />
    </DictProvider>,
  )
  return { engine, ...utils }
}

function schakelaar() {
  return {
    vct: screen.getByRole('button', { name: nl.event.trainingstypeVct }),
    teamtactisch: screen.getByRole('button', { name: nl.event.trainingstypeTeamtactisch }),
  }
}
function duurInput(id: string): HTMLInputElement {
  return document.getElementById(`duur-${id}`) as HTMLInputElement
}
function stapInput(id: string): HTMLInputElement {
  return document.getElementById(`stap-override-${id}`) as HTMLInputElement
}
async function advanceDebounce() {
  await vi.advanceTimersByTimeAsync(500)
}

// ════════════════════════════════════════════════════════════════════════
// DEEL A — Trainingstype
// ════════════════════════════════════════════════════════════════════════

describe('A1 — aanmaakformulier: precies twee opties, VCT default, afwezig bij wedstrijd', () => {
  function renderNew() {
    return render(<DictProvider dict={nl}><NewEventPage /></DictProvider>)
  }

  it('toont VCT en Teamtactisch, VCT vooraf actief (default)', () => {
    renderNew()
    const vct = screen.getByRole('button', { name: nl.event.trainingstypeVct })
    const teamtactisch = screen.getByRole('button', { name: nl.event.trainingstypeTeamtactisch })
    expect(vct).toHaveAttribute('aria-pressed', 'true')
    expect(teamtactisch).toHaveAttribute('aria-pressed', 'false')
    expect((document.querySelector('input[name="trainingstype"]') as HTMLInputElement).value).toBe('vct')
  })

  it('is afwezig zodra het eventtype Wedstrijd is', () => {
    renderNew()
    fireEvent.click(screen.getByRole('button', { name: nl.event.match }))
    expect(screen.queryByText(nl.event.trainingstype)).not.toBeInTheDocument()
    expect(document.querySelector('input[name="trainingstype"]')).not.toBeInTheDocument()
  })
})

describe('A2 — trainingstype wordt opgeslagen', () => {
  it('createEvent met trainingstype=teamtactisch schrijft die waarde weg op de training', async () => {
    const engine = maakEngine()
    koppelEngine(engine)
    await createEvent(form({ type: 'training', date: '2026-03-01', trainingstype: 'teamtactisch' }))
    expect(engine.db.events[0].trainingstype).toBe('teamtactisch')
    expect(engine.db.events[0].type).toBe('training')
  })

  it('createEvent zonder het veld default naar vct', async () => {
    const engine = maakEngine()
    koppelEngine(engine)
    await createEvent(form({ type: 'training', date: '2026-03-01' }))
    expect(engine.db.events[0].trainingstype).toBe('vct')
  })

  it('createEvent bij type=match neemt trainingstype nooit mee in de insert', async () => {
    const engine = maakEngine()
    koppelEngine(engine)
    await createEvent(form({ type: 'match', date: '2026-03-01', opponent: 'FC Test', match_type: 'league', home_away: 'home' }))
    expect('trainingstype' in engine.db.events[0]).toBe(false)
  })
})

describe('A2/A3 — schakelaar toont het opgeslagen type', () => {
  it('schakelaar toont het type dat als initialTrainingstype is meegegeven', () => {
    renderPlan([], { initialTrainingstype: 'teamtactisch' })
    expect(schakelaar().teamtactisch).toHaveAttribute('aria-pressed', 'true')
    expect(schakelaar().vct).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('A3 — schakelaar wijzigt het type via de echte updateTrainingstype', () => {
  it('staat bovenaan (vóór het doelstellingblok) en een klik roept de server aan, die de rij muteert', async () => {
    const { engine } = renderPlan([], { initialTrainingstype: 'vct' })

    const schakelaarNode = screen.getByText(nl.event.trainingstype)
    const doelBlock = screen.getByTestId('doelstelling-block')
    expect(schakelaarNode.compareDocumentPosition(doelBlock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(schakelaar().teamtactisch)
    await waitFor(() => expect(engine.db.events[0].trainingstype).toBe('teamtactisch'))
    expect(schakelaar().teamtactisch).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('A4 — stapveld volgt trainingstype per categorie', () => {
  const categorieen: OefeningCategorie[] = [
    'partijen_groot', 'partijen_midden', 'partijen_klein', 'sprints_weinig_rust', 'sprints_veel_rust', 'steigerungs',
  ]

  it.each(categorieen)('%s: stapblok zichtbaar bij VCT, verborgen bij Teamtactisch', (categorie) => {
    const k = maakKoppeling({ oefening: { categorie }, stap_override: 1 })

    const vct = renderPlan([k], { initialTrainingstype: 'vct' })
    expect(screen.getByTestId('stap-inhoud-k1')).toBeInTheDocument()
    vct.unmount()

    renderPlan([k], { initialTrainingstype: 'teamtactisch' })
    expect(screen.queryByTestId('stap-inhoud-k1')).not.toBeInTheDocument()
    expect(document.getElementById('stap-override-k1')).not.toBeInTheDocument()
  })
})

describe('A5 — teamtactische trainingen tellen niet mee in de VCT-periodisering', () => {
  function seed(): Seed {
    return {
      events: [
        eventRow({ id: 't-vct', date: '2026-01-05', trainingstype: 'vct' }),
        eventRow({ id: 't-team', date: '2026-01-06', trainingstype: 'teamtactisch' }),
        // Edge: teamtactisch zonder oefeningen — mag geen enkel verschil maken.
        eventRow({ id: 't-team-leeg', date: '2026-01-07', trainingstype: 'teamtactisch' }),
      ],
      training_oefeningen: [
        { id: 'k-vct', team_id: TEAM, event_id: 't-vct', oefeningen: { categorie: 'partijen_groot' }, stap_override: null },
        { id: 'k-team', team_id: TEAM, event_id: 't-team', oefeningen: { categorie: 'partijen_groot' }, stap_override: null },
        // Edge: mix van categorieën in een teamtactische training — niets telt.
        { id: 'k-team-2', team_id: TEAM, event_id: 't-team', oefeningen: { categorie: 'sprints_weinig_rust' }, stap_override: null },
      ],
    }
  }

  it('countCategoryOccurrences telt alleen de VCT-training; teamtactisch (mét of zonder oefeningen) telt niet mee', async () => {
    const engine = maakEngine({ seed: seed() })
    const occurrences = await countCategoryOccurrences(engine.supabase as unknown as SupabaseClient, TEAM, '2026-01-01', '2026-02-01')
    expect(occurrences.partijen_groot).toBe(1)
    expect(occurrences.sprints_weinig_rust).toBeUndefined()
  })

  it('getTrainingLog levert geen log-regel voor de teamtactische training', async () => {
    const engine = maakEngine({ seed: seed() })
    const actueel: Record<string, ActueleMeting> = {
      partijen_groot: { id: 'm1', categorie: 'partijen_groot', datum: '2025-12-01', stap: 1, notes: null },
    }
    const result = await getTrainingLog(engine.supabase as unknown as SupabaseClient, TEAM, actueel, '2026-02-01')
    expect(result.log).toHaveLength(1)
    expect(result.log[0].eventId).toBe('t-vct')
  })

  it('regressie: een dataset zonder teamtactische trainingen levert dezelfde telling als voorheen (geen terugwerkende kracht)', async () => {
    const engine = maakEngine({
      seed: {
        events: [eventRow({ id: 't1', date: '2026-01-05', trainingstype: 'vct' }), eventRow({ id: 't2', date: '2026-01-06', trainingstype: 'vct' })],
        training_oefeningen: [
          { id: 'ka', team_id: TEAM, event_id: 't1', oefeningen: { categorie: 'partijen_midden' } },
          { id: 'kb', team_id: TEAM, event_id: 't2', oefeningen: { categorie: 'partijen_midden' } },
        ],
      },
    })
    const occurrences = await countCategoryOccurrences(engine.supabase as unknown as SupabaseClient, TEAM, '2026-01-01', '2026-02-01')
    expect(occurrences.partijen_midden).toBe(2)
  })

  it('rand: een trainingsrij zonder trainingstype-kolom (migratie niet gedraaid) gedraagt zich als VCT en telt gewoon mee', async () => {
    const engine = maakEngine({
      seed: {
        events: [{ id: 't-legacy', team_id: TEAM, type: 'training', date: '2026-01-05' /* geen trainingstype-veld */ }],
        training_oefeningen: [{ id: 'kl', team_id: TEAM, event_id: 't-legacy', oefeningen: { categorie: 'partijen_klein' } }],
      },
    })
    const occurrences = await countCategoryOccurrences(engine.supabase as unknown as SupabaseClient, TEAM, '2026-01-01', '2026-02-01')
    expect(occurrences.partijen_klein).toBe(1)
  })
})

describe('A6 — afdruk toont geen stapinformatie bij teamtactisch (consistent met scherm)', () => {
  it('teamtactisch: geen print-only stapregel en geen "Stap"-segment in de print-kopregel', () => {
    const k = maakKoppeling({ oefening: { categorie: 'partijen_midden' }, stap_override: 3 })
    renderPlan([k], { initialTrainingstype: 'teamtactisch', currentSteps: { partijen_midden: 3 } })

    expect(screen.queryByTestId('stap-inhoud-print-k1')).not.toBeInTheDocument()
    const kop = document.querySelector('.print-poster-meta') as HTMLElement
    expect(kop.textContent).not.toContain(nl.trainingPlan.stepBadge)
  })

  it('VCT: dezelfde koppeling toont wél de print-only stapregel en het "Stap"-segment', () => {
    const k = maakKoppeling({ oefening: { categorie: 'partijen_midden' }, stap_override: 3 })
    renderPlan([k], { initialTrainingstype: 'vct', currentSteps: { partijen_midden: 3 } })

    expect(screen.getByTestId('stap-inhoud-print-k1')).toBeInTheDocument()
    const kop = document.querySelector('.print-poster-meta') as HTMLElement
    expect(kop.textContent).toContain(nl.trainingPlan.stepBadge)
  })
})

describe('A7 — stap_override blijft bewaard maar verborgen bij wisselen', () => {
  it('VCT → Teamtactisch → VCT: dezelfde stapwaarde staat er na terugschakelen weer', async () => {
    const k = maakKoppeling({ oefening: { categorie: 'partijen_klein' }, stap_override: 7 })
    const { engine } = renderPlan([k], { initialTrainingstype: 'vct' })

    expect(stapInput('k1').value).toBe('7')

    fireEvent.click(schakelaar().teamtactisch)
    await waitFor(() => expect(engine.db.events[0].trainingstype).toBe('teamtactisch'))
    expect(screen.queryByTestId('stap-inhoud-k1')).not.toBeInTheDocument()

    fireEvent.click(schakelaar().vct)
    await waitFor(() => expect(engine.db.events[0].trainingstype).toBe('vct'))
    expect(screen.getByTestId('stap-inhoud-k1')).toBeInTheDocument()
    expect(stapInput('k1').value).toBe('7')
    // stap_override is tijdens het wisselen zelf nooit als patch verstuurd:
    // de koppelingrij in de database bleef exact 7.
    expect(engine.db.training_oefeningen.find((r) => r.id === 'k1')!.stap_override).toBe(7)
  })
})

describe('A8 — validatie en tenant-isolatie', () => {
  it('createEvent weigert een ongeldig trainingstype, geen insert', async () => {
    const engine = maakEngine()
    koppelEngine(engine)
    await expect(createEvent(form({ type: 'training', date: '2026-03-01', trainingstype: 'onzin' }))).rejects.toThrow('Ongeldig trainingstype')
    expect(engine.db.events).toHaveLength(0)
  })

  it('updateTrainingstype zonder sessie gooit "Niet ingelogd", geen mutatie', async () => {
    const engine = maakEngine({ user: null, seed: { events: [eventRow()] } })
    koppelEngine(engine)
    await expect(updateTrainingstype('e1', 'teamtactisch')).rejects.toThrow('Niet ingelogd')
    expect(engine.db.events[0].trainingstype).toBe('vct')
  })

  it('updateTrainingstype weigert een ongeldige waarde vóór elke query', async () => {
    const engine = maakEngine({ seed: { events: [eventRow()] } })
    koppelEngine(engine)
    await expect(updateTrainingstype('e1', 'onzin' as TrainingsType)).rejects.toThrow('Ongeldig trainingstype')
    expect(engine.db.events[0].trainingstype).toBe('vct')
  })

  it('een training van een ander team kan niet gelezen/gewijzigd worden: "Event niet gevonden", geen mutatie', async () => {
    const engine = maakEngine({ seed: { events: [eventRow({ id: 'e-vreemd', team_id: OTHER_TEAM })] } })
    koppelEngine(engine)
    await expect(updateTrainingstype('e-vreemd', 'teamtactisch')).rejects.toThrow('Event niet gevonden')
    expect(engine.db.events[0].team_id).toBe(OTHER_TEAM)
    expect(engine.db.events[0].trainingstype).toBe('vct')
  })

  it('een wedstrijd-event (type=match) wordt geweigerd via dezelfde melding', async () => {
    const engine = maakEngine({ seed: { events: [eventRow({ id: 'e-match', type: 'match' })] } })
    koppelEngine(engine)
    await expect(updateTrainingstype('e-match', 'teamtactisch')).rejects.toThrow('Event niet gevonden')
  })

  it('eigen training van eigen team wordt wél gewijzigd', async () => {
    const engine = maakEngine({ seed: { events: [eventRow()] } })
    koppelEngine(engine)
    await updateTrainingstype('e1', 'teamtactisch')
    expect(engine.db.events[0].trainingstype).toBe('teamtactisch')
  })
})

describe('A9 — training zonder trainingstype gedraagt zich als VCT (UI-gevolg van de `event.trainingstype ?? \'vct\'`-fallback in app/events/[id]/training-plan/page.tsx)', () => {
  it('met de uitgerekende waarde "vct" gedraagt de pagina zich als een gewone VCT-training', () => {
    const k = maakKoppeling({ oefening: { categorie: 'partijen_klein' }, stap_override: 2 })
    renderPlan([k], { initialTrainingstype: 'vct' })
    expect(schakelaar().vct).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('stap-inhoud-k1')).toBeInTheDocument()
  })
})

describe('A10 — mislukte save van trainingstype: rollback + generieke melding, nooit de rauwe fout', () => {
  it('rolt terug naar de vorige waarde en toont alleen de i18n-melding', async () => {
    const { engine } = renderPlan([], { initialTrainingstype: 'vct', failOnce: { table: 'events', op: 'update' } })

    fireEvent.click(schakelaar().teamtactisch)
    // Optimistisch al bijgewerkt, vóór de mislukte server-respons.
    expect(schakelaar().teamtactisch).toHaveAttribute('aria-pressed', 'true')

    await waitFor(() => expect(screen.getByText(nl.trainingPlan.trainingstypeOpslaanMislukt)).toBeInTheDocument())
    expect(screen.queryByText(/RUWE_TESTFOUT/)).not.toBeInTheDocument()
    expect(screen.queryByText(GENERIC_ERROR_MESSAGE)).not.toBeInTheDocument()
    expect(schakelaar().vct).toHaveAttribute('aria-pressed', 'true')
    expect(schakelaar().teamtactisch).toHaveAttribute('aria-pressed', 'false')
    // De database is niet gemuteerd: de update is echt mislukt, niet alleen
    // de UI die per ongeluk toch terugrolt.
    expect(engine.db.events[0].trainingstype).toBe('vct')
  })
})

describe('A11 — cyclusweek-suggestie volgt trainingstype; periodiseringstatus-kaart blijft altijd', () => {
  const suggestion = { week: 2, items: [{ key: 'partijen_groot', step: 3 }] }

  it('aanwezig bij VCT, afwezig bij Teamtactisch, weer aanwezig na terugschakelen', async () => {
    const { engine } = renderPlan([], { initialTrainingstype: 'vct', suggestion })
    expect(screen.getByTestId('cyclusweek-suggestie')).toBeInTheDocument()

    fireEvent.click(schakelaar().teamtactisch)
    await waitFor(() => expect(engine.db.events[0].trainingstype).toBe('teamtactisch'))
    expect(screen.queryByTestId('cyclusweek-suggestie')).not.toBeInTheDocument()

    fireEvent.click(schakelaar().vct)
    await waitFor(() => expect(engine.db.events[0].trainingstype).toBe('vct'))
    expect(screen.getByTestId('cyclusweek-suggestie')).toBeInTheDocument()
  })

  it('de "Huidige periodiseringstatus"-kaart blijft staan bij Teamtactisch', () => {
    renderPlan([], { initialTrainingstype: 'teamtactisch', suggestion })
    expect(screen.getByText(`${nl.periodization.currentSteps} ${nl.periodization.forTraining}`)).toBeInTheDocument()
  })
})

describe('Edge A — gekopieerd stap_override zonder effect bij teamtactisch', () => {
  it('kopieerTrainingsplan neemt stap_override letterlijk over, ongeacht het trainingstype van de doeltraining', async () => {
    const engine = maakEngine({
      seed: {
        events: [eventRow({ id: 'e-bron' }), eventRow({ id: 'e-doel', trainingstype: 'teamtactisch' })],
        training_oefeningen: [
          { id: 'b1', team_id: TEAM, event_id: 'e-bron', oefening_id: 'o1', volgorde: 0, stap_override: 5, duur_min: 20, parallel_groep_id: null },
        ],
      },
    })
    koppelEngine(engine)
    await kopieerTrainingsplan('e-doel', 'e-bron')
    const kopie = engine.db.training_oefeningen.find((r) => r.event_id === 'e-doel')!
    expect(kopie.stap_override).toBe(5)
  })

  it('UI: een gekopieerde stap_override heeft geen zichtbaar effect zolang de training teamtactisch is', () => {
    const k = maakKoppeling({ oefening: { categorie: 'partijen_groot' }, stap_override: 5 })
    renderPlan([k], { initialTrainingstype: 'teamtactisch' })
    expect(screen.queryByTestId('stap-inhoud-k1')).not.toBeInTheDocument()
    expect(document.getElementById('stap-override-k1')).not.toBeInTheDocument()
  })
})

describe('Edge A — warming_up krijgt geen extra stapveld bij teamtactisch', () => {
  it('het generieke stapveld (categorie-only) gedraagt zich exact zoals bij VCT', () => {
    const k = maakKoppeling({ oefening: { categorie: 'warming_up' }, stap_override: null })
    renderPlan([k], { initialTrainingstype: 'teamtactisch' })

    expect(document.getElementById('stap-generic-k1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(nl.trainingPlan.detailsToggle))
    expect(document.getElementById('stap-generic-k1')).toBeInTheDocument()
    expect(screen.queryByTestId('stap-inhoud-k1')).not.toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// DEEL B — Duur per koppeling
// ════════════════════════════════════════════════════════════════════════

describe('B1 — koppeling krijgt eenmalig de bibliotheekduur (eenmalige kopie)', () => {
  it('addOefeningToTraining kopieert oefeningen.duur_min naar de nieuwe koppeling; een latere bibliotheekwijziging werkt niet meer door', async () => {
    const engine = maakEngine({
      seed: {
        events: [eventRow()],
        oefeningen: [{ id: 'o1', team_id: TEAM, duur_min: 18, categorie: 'partijen_klein' }],
      },
    })
    koppelEngine(engine)

    await addOefeningToTraining('e1', 'o1')
    expect(engine.db.training_oefeningen).toHaveLength(1)
    const koppeling = engine.db.training_oefeningen[0]
    expect(koppeling.duur_min).toBe(18)

    // Bibliotheek wijzigt NA het koppelen — de koppeling mag daar niet door bewegen.
    engine.db.oefeningen[0].duur_min = 99
    expect(engine.db.training_oefeningen[0].duur_min).toBe(18)
    expect(
      effectieveDuurMin({ duur_min: engine.db.training_oefeningen[0].duur_min as number, oefeningen: { duur_min: engine.db.oefeningen[0].duur_min as number } }),
    ).toBe(18)
  })

  it('tenant: een oefening van een ander team levert "Oefening niet gevonden", geen insert', async () => {
    const engine = maakEngine({
      seed: { events: [eventRow()], oefeningen: [{ id: 'o-vreemd', team_id: OTHER_TEAM, duur_min: 10 }] },
    })
    koppelEngine(engine)
    await expect(addOefeningToTraining('e1', 'o-vreemd')).rejects.toThrow('Oefening niet gevonden')
    expect(engine.db.training_oefeningen).toHaveLength(0)
  })

  it('tenant: een event van een ander team levert "Event niet gevonden", geen insert', async () => {
    const engine = maakEngine({
      seed: { events: [eventRow({ id: 'e-vreemd', team_id: OTHER_TEAM })], oefeningen: [{ id: 'o1', team_id: TEAM, duur_min: 10 }] },
    })
    koppelEngine(engine)
    await expect(addOefeningToTraining('e-vreemd', 'o1')).rejects.toThrow('Event niet gevonden')
    expect(engine.db.training_oefeningen).toHaveLength(0)
  })
})

describe('B2 — handmatig wijzigen raakt alleen de koppeling, nooit de bibliotheek', () => {
  it('na de debounce staat de nieuwe waarde op de koppeling en blijft de bibliotheekduur ongemoeid', async () => {
    const k = maakKoppeling({ duur_min: 10, oefening: { duur_min: 10 } })
    const { engine } = renderPlan([k])

    fireEvent.change(duurInput('k1'), { target: { value: '35' } })
    expect(duurInput('k1').value).toBe('35')

    await advanceDebounce()
    await waitFor(() => expect(engine.db.training_oefeningen.find((r) => r.id === 'k1')!.duur_min).toBe(35))
    expect(engine.db.oefeningen.find((r) => r.id === 'o1')!.duur_min).toBe(10)
  })
})

describe('B3 — auto-berekening bij stapkeuze (alleen partijen_groot/midden/klein), overschrijft altijd', () => {
  it('partijen_groot, stap 1 → 22 (10*2 + 2*1)', async () => {
    const engine = maakEngine({
      seed: {
        events: [eventRow()],
        training_oefeningen: [{ id: 'k1', team_id: TEAM, event_id: 'e1', oefening_id: 'o1', volgorde: 0, stap_override: null, duur_min: 5, oefeningen: { categorie: 'partijen_groot' } }],
      },
    })
    koppelEngine(engine)
    await updateKoppeling('k1', 'e1', { stap_override: 1 })
    const row = engine.db.training_oefeningen[0]
    expect(row.stap_override).toBe(1)
    expect(row.duur_min).toBe(22)
  })

  it('partijen_midden, stap 2 → 24 (4,5*4 + 2*3)', async () => {
    const engine = maakEngine({
      seed: {
        events: [eventRow()],
        training_oefeningen: [{ id: 'k1', team_id: TEAM, event_id: 'e1', oefening_id: 'o1', volgorde: 0, stap_override: null, duur_min: 5, oefeningen: { categorie: 'partijen_midden' } }],
      },
    })
    koppelEngine(engine)
    await updateKoppeling('k1', 'e1', { stap_override: 2 })
    expect(engine.db.training_oefeningen[0].duur_min).toBe(24)
  })

  it('partijen_klein, stap 2 → 41 ((1*6 + 2,5*5)*2 + 4*1)', async () => {
    const engine = maakEngine({
      seed: {
        events: [eventRow()],
        training_oefeningen: [{ id: 'k1', team_id: TEAM, event_id: 'e1', oefening_id: 'o1', volgorde: 0, stap_override: null, duur_min: 5, oefeningen: { categorie: 'partijen_klein' } }],
      },
    })
    koppelEngine(engine)
    await updateKoppeling('k1', 'e1', { stap_override: 2 })
    expect(engine.db.training_oefeningen[0].duur_min).toBe(41)
  })

  it('een client-verstuurde duur_min in dezelfde patch wordt door de berekening overschreven (server is leidend)', async () => {
    const engine = maakEngine({
      seed: {
        events: [eventRow()],
        training_oefeningen: [{ id: 'k1', team_id: TEAM, event_id: 'e1', oefening_id: 'o1', volgorde: 0, stap_override: null, duur_min: 5, oefeningen: { categorie: 'partijen_groot' } }],
      },
    })
    koppelEngine(engine)
    await updateKoppeling('k1', 'e1', { duur_min: 999, stap_override: 1 })
    expect(engine.db.training_oefeningen[0].duur_min).toBe(22)
  })
})

describe('B4 — handmatige aanpassing na auto-berekening blijft staan tot een nieuwe stap gekozen wordt', () => {
  it('client rekent vooruit bij stapkeuze; een daaropvolgende handmatige waarde overschrijft en wordt zo opgeslagen', async () => {
    const k = maakKoppeling({ duur_min: 5, oefening: { categorie: 'partijen_groot', duur_min: 5 } })
    const { engine } = renderPlan([k])

    fireEvent.change(stapInput('k1'), { target: { value: '1' } })
    expect(duurInput('k1').value).toBe('22')
    expect(screen.getByText(nl.trainingPlan.duurAutoHint)).toBeInTheDocument()

    fireEvent.change(duurInput('k1'), { target: { value: '50' } })
    expect(duurInput('k1').value).toBe('50')

    await advanceDebounce()
    await waitFor(() => expect(engine.db.training_oefeningen.find((r) => r.id === 'k1')!.duur_min).toBe(50))
  })
})

describe('B5 — stap wissen laat de laatst berekende duur met rust', () => {
  it('server: stap_override:null raakt duur_min niet aan', async () => {
    const engine = maakEngine({
      seed: {
        events: [eventRow()],
        training_oefeningen: [{ id: 'k1', team_id: TEAM, event_id: 'e1', oefening_id: 'o1', volgorde: 0, stap_override: 1, duur_min: 22, oefeningen: { categorie: 'partijen_groot' } }],
      },
    })
    koppelEngine(engine)
    await updateKoppeling('k1', 'e1', { stap_override: null })
    const row = engine.db.training_oefeningen[0]
    expect(row.stap_override).toBeNull()
    expect(row.duur_min).toBe(22)
  })

  it('UI: stap kiezen, dan wissen — de berekende duur blijft zichtbaar staan', async () => {
    const k = maakKoppeling({ duur_min: 5, oefening: { categorie: 'partijen_groot', duur_min: 5 } })
    renderPlan([k])

    fireEvent.change(stapInput('k1'), { target: { value: '1' } })
    expect(duurInput('k1').value).toBe('22')

    fireEvent.change(stapInput('k1'), { target: { value: '' } })
    expect(duurInput('k1').value).toBe('22')
  })
})

describe('B6 — geen auto-berekening buiten partijen_groot/midden/klein', () => {
  it('server: sprints_weinig_rust laat duur_min ongemoeid', async () => {
    const engine = maakEngine({
      seed: {
        events: [eventRow()],
        training_oefeningen: [{ id: 'k1', team_id: TEAM, event_id: 'e1', oefening_id: 'o1', volgorde: 0, stap_override: null, duur_min: 12, oefeningen: { categorie: 'sprints_weinig_rust' } }],
      },
    })
    koppelEngine(engine)
    await updateKoppeling('k1', 'e1', { stap_override: 2 })
    expect(engine.db.training_oefeningen[0].duur_min).toBe(12)
  })

  it('UI: stapveld wijzigen op sprints_weinig_rust verandert het duurveld niet en toont geen auto-hint', () => {
    const k = maakKoppeling({ duur_min: 12, oefening: { categorie: 'sprints_weinig_rust', duur_min: 12 } })
    renderPlan([k])
    fireEvent.change(stapInput('k1'), { target: { value: '2' } })
    expect(duurInput('k1').value).toBe('12')
    expect(screen.queryByText(nl.trainingPlan.duurAutoHint)).not.toBeInTheDocument()
  })
})

describe('B7 — legacy-koppeling (geen eigen duur) valt terug op de bibliotheekduur', () => {
  it('tijdlijn, duurveld en print tonen de bibliotheekduur', () => {
    const k = maakKoppeling({ duur_min: null, oefening: { naam: 'Rondo', duur_min: 22 } })
    renderPlan([k])

    expect(duurInput('k1').value).toBe('22')
    expect(screen.getByText(nl.trainingPlan.sessionPlanned.replace('{n}', '22'))).toBeInTheDocument()
    const kop = document.querySelector('.print-poster-meta') as HTMLElement
    expect(kop.textContent).toContain('22 min')
  })
})

describe('B8 — kopiëren neemt de koppeling-duur mee', () => {
  it('duur_min (inclusief null) gaat mee naar de nieuwe koppelingen', async () => {
    const engine = maakEngine({
      seed: {
        events: [eventRow({ id: 'e-bron' }), eventRow({ id: 'e-doel' })],
        training_oefeningen: [
          { id: 'b1', team_id: TEAM, event_id: 'e-bron', oefening_id: 'o1', volgorde: 0, stap_override: null, duur_min: 25, parallel_groep_id: null },
          { id: 'b2', team_id: TEAM, event_id: 'e-bron', oefening_id: 'o2', volgorde: 1, stap_override: null, duur_min: null, parallel_groep_id: null },
        ],
      },
    })
    koppelEngine(engine)

    const { aantal } = await kopieerTrainingsplan('e-doel', 'e-bron')
    expect(aantal).toBe(2)
    const kopie = engine.db.training_oefeningen.filter((r) => r.event_id === 'e-doel').sort((a, b) => (a.volgorde as number) - (b.volgorde as number))
    expect(kopie.map((r) => r.duur_min)).toEqual([25, null])
  })

  it('tenant: een doeltraining van een ander team levert "Event niet gevonden", geen insert', async () => {
    const engine = maakEngine({
      seed: {
        events: [eventRow({ id: 'e-bron' }), eventRow({ id: 'e-doel-vreemd', team_id: OTHER_TEAM })],
        training_oefeningen: [{ id: 'b1', team_id: TEAM, event_id: 'e-bron', oefening_id: 'o1', volgorde: 0, stap_override: null, duur_min: 25, parallel_groep_id: null }],
      },
    })
    koppelEngine(engine)
    await expect(kopieerTrainingsplan('e-doel-vreemd', 'e-bron')).rejects.toThrow('Event niet gevonden')
    expect(engine.db.training_oefeningen.filter((r) => r.event_id === 'e-doel-vreemd')).toHaveLength(0)
  })
})

describe('B9 — duur 0 telt als "geen duur"; \'0\' intypen levert 0, nooit null', () => {
  it('duur 0: geen duursegment in de print-kopregel, telt als "zonder duur" in de tijdlijn', () => {
    const k = maakKoppeling({ duur_min: 0, oefening: { naam: 'Rondo', duur_min: 20 } })
    renderPlan([k])

    const kop = document.querySelector('.print-poster-meta') as HTMLElement
    expect(kop.textContent).not.toContain('min')
    expect(screen.getByText(nl.trainingPlan.sessionPlanned.replace('{n}', '0'))).toBeInTheDocument()
    expect(screen.getByText(nl.trainingPlan.sessionNoDurationOne)).toBeInTheDocument()
  })

  it('regressie (parseInt || null-bug): "0" intypen slaat op als duur_min: 0, echt weggeschreven in de database', async () => {
    const k = maakKoppeling({ duur_min: 10, oefening: { duur_min: 10 } })
    const { engine } = renderPlan([k])

    fireEvent.change(duurInput('k1'), { target: { value: '0' } })
    expect(duurInput('k1').value).toBe('0')

    await advanceDebounce()
    await waitFor(() => expect(engine.db.training_oefeningen.find((r) => r.id === 'k1')!.duur_min).toBe(0))
    // Expliciet: geen null.
    expect(engine.db.training_oefeningen.find((r) => r.id === 'k1')!.duur_min).not.toBeNull()
  })

  it('leegmaken van het veld stuurt duur_min: null (val terug op de bibliotheek)', async () => {
    const k = maakKoppeling({ duur_min: 30, oefening: { duur_min: 10 } })
    const { engine } = renderPlan([k])

    fireEvent.change(duurInput('k1'), { target: { value: '' } })
    await advanceDebounce()
    await waitFor(() => expect(engine.db.training_oefeningen.find((r) => r.id === 'k1')!.duur_min).toBeNull())
  })
})

describe('B10 — clamp en tenant-isolatie op de duur', () => {
  it('boven 600 wordt geclampt naar 600', async () => {
    const engine = maakEngine({ seed: { events: [eventRow()], training_oefeningen: [{ id: 'k1', team_id: TEAM, event_id: 'e1', oefening_id: 'o1', volgorde: 0, stap_override: null, duur_min: 5 }] } })
    koppelEngine(engine)
    await updateKoppeling('k1', 'e1', { duur_min: 9999 })
    expect(engine.db.training_oefeningen[0].duur_min).toBe(600)
  })

  it('onder 0 wordt geclampt naar 0 (niet naar null)', async () => {
    const engine = maakEngine({ seed: { events: [eventRow()], training_oefeningen: [{ id: 'k1', team_id: TEAM, event_id: 'e1', oefening_id: 'o1', volgorde: 0, stap_override: null, duur_min: 5 }] } })
    koppelEngine(engine)
    await updateKoppeling('k1', 'e1', { duur_min: -4 })
    expect(engine.db.training_oefeningen[0].duur_min).toBe(0)
  })

  it('0 blijft 0', async () => {
    const engine = maakEngine({ seed: { events: [eventRow()], training_oefeningen: [{ id: 'k1', team_id: TEAM, event_id: 'e1', oefening_id: 'o1', volgorde: 0, stap_override: null, duur_min: 5 }] } })
    koppelEngine(engine)
    await updateKoppeling('k1', 'e1', { duur_min: 0 })
    expect(engine.db.training_oefeningen[0].duur_min).toBe(0)
  })

  it('een koppeling van een ander team wordt niet geraakt: 0 rijen gemuteerd, geen fout', async () => {
    const engine = maakEngine({
      seed: {
        events: [eventRow({ id: 'e-vreemd', team_id: OTHER_TEAM })],
        training_oefeningen: [{ id: 'k-vreemd', team_id: OTHER_TEAM, event_id: 'e-vreemd', oefening_id: 'o1', volgorde: 0, stap_override: null, duur_min: 5 }],
      },
    })
    koppelEngine(engine)
    await expect(updateKoppeling('k-vreemd', 'e-vreemd', { duur_min: 40 })).resolves.toBeUndefined()
    expect(engine.db.training_oefeningen[0].duur_min).toBe(5)
  })

  it('een onbekende koppeling in de stap-tak levert "Koppeling niet gevonden"', async () => {
    const engine = maakEngine({ seed: { events: [eventRow()], training_oefeningen: [] } })
    koppelEngine(engine)
    await expect(updateKoppeling('onbekend', 'e1', { stap_override: 2 })).rejects.toThrow('Koppeling niet gevonden')
  })
})

describe('B12 — mislukte save van de duur: rollback + generieke melding, nooit de rauwe fout', () => {
  it('rolt terug naar de laatst bevestigde waarde en toont alleen de i18n-melding', async () => {
    const k = maakKoppeling({ duur_min: 10, oefening: { duur_min: 10 } })
    const { engine } = renderPlan([k], { failOnce: { table: 'training_oefeningen', op: 'update' } })

    fireEvent.change(duurInput('k1'), { target: { value: '77' } })
    await advanceDebounce()

    await waitFor(() => expect(screen.getByText(nl.trainingPlan.duurOpslaanMislukt)).toBeInTheDocument())
    expect(screen.queryByText(/RUWE_TESTFOUT/)).not.toBeInTheDocument()
    expect(screen.queryByText(GENERIC_ERROR_MESSAGE)).not.toBeInTheDocument()
    expect(duurInput('k1').value).toBe('10')
    expect(engine.db.training_oefeningen.find((r) => r.id === 'k1')!.duur_min).toBe(10)
  })
})

describe('B13 — voorrang: berekening wint van een gelijktijdige duur_min in dezelfde patch', () => {
  it('server: patch met duur_min én een auto-berekenende stap_override → de berekende waarde wint', async () => {
    const engine = maakEngine({
      seed: {
        events: [eventRow()],
        training_oefeningen: [{ id: 'k1', team_id: TEAM, event_id: 'e1', oefening_id: 'o1', volgorde: 0, stap_override: null, duur_min: 5, oefeningen: { categorie: 'partijen_klein' } }],
      },
    })
    koppelEngine(engine)
    await updateKoppeling('k1', 'e1', { duur_min: 5, stap_override: 2 })
    // partijen_klein, stap 2 = 41 (zie B3) — wint van de meegestuurde 5.
    expect(engine.db.training_oefeningen[0].duur_min).toBe(41)
  })
})

describe('Edge B — bibliotheek-oefening zonder duur, gekoppeld zonder stap', () => {
  it('het duurveld toont leeg ("geen duur")', () => {
    const k = maakKoppeling({ duur_min: null, oefening: { duur_min: null } })
    renderPlan([k])
    expect(duurInput('k1').value).toBe('')
  })
})

describe('Edge B — parallelle groep telt de langste effectieve duur (met fallback)', () => {
  it('twee parallelle leden: 20 vs. (fallback) 30 → tijdlijn telt 30', () => {
    const k1 = maakKoppeling({ id: 'k1', oefening_id: 'o1', duur_min: 20, parallel_groep_id: 'g1', volgorde: 0, oefening: { id: 'o1' } })
    const k2 = maakKoppeling({ id: 'k2', oefening_id: 'o2', duur_min: null, parallel_groep_id: 'g1', volgorde: 0, oefening: { id: 'o2', duur_min: 30 } })
    renderPlan([k1, k2])
    expect(screen.getByText(nl.trainingPlan.sessionPlanned.replace('{n}', '30'))).toBeInTheDocument()
  })
})

describe('Edge B — dezelfde bibliotheek-oefening twee keer gekoppeld: onafhankelijke duren', () => {
  it('elke koppeling houdt zijn eigen waarde; wijzigen van de één raakt de ander niet (ook niet op de server)', async () => {
    const basis = maakOefening({ id: 'o1', naam: 'Rondo', duur_min: 10 })
    const k1 = maakKoppeling({ id: 'k1', oefening_id: 'o1', duur_min: 15, oefeningen: basis })
    const k2 = maakKoppeling({ id: 'k2', oefening_id: 'o1', duur_min: 25, oefeningen: basis, volgorde: 1 })
    const { engine } = renderPlan([k1, k2])

    expect(duurInput('k1').value).toBe('15')
    expect(duurInput('k2').value).toBe('25')

    fireEvent.change(duurInput('k1'), { target: { value: '60' } })
    expect(duurInput('k2').value).toBe('25')

    await advanceDebounce()
    await waitFor(() => expect(engine.db.training_oefeningen.find((r) => r.id === 'k1')!.duur_min).toBe(60))
    expect(engine.db.training_oefeningen.find((r) => r.id === 'k2')!.duur_min).toBe(25)
  })
})
