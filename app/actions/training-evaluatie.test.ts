import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { HERSTEL_FOUT, type HerstelTrainingOordeel, type HerstelTrainingRpe } from '@/lib/herstel'
import type { TrainingOordeel } from '@/lib/types'
import {
  herstelTrainingOordeel,
  herstelTrainingRpe,
  saveTrainingOordeel,
  saveTrainingRpe,
  wisTrainingOordeel,
  wisTrainingRpe,
} from '@/app/actions/training-evaluatie'

// Mock-patroon uit app/actions/speelminuten.test.ts: een chainable stub die
// filters NIET toepast, maar elke query vastlegt — inclusief .is() en de
// payload van update(), die het herstel- en wis-gedrag dragen (brief R5: een
// filter dat de stub negeert blijft anders stil groen). Wat RLS doet bewijst
// alleen supabase/team-rls-verificatie.sql (blok 30).

type TableResult = { data?: unknown; error?: unknown }
type Filter = { op: 'eq' | 'is'; col: string; val: unknown }
type Query = {
  table: string
  kind: 'select' | 'insert' | 'upsert' | 'update' | 'delete'
  cols?: unknown
  payload?: Record<string, unknown>
  options?: unknown
  filters: Filter[]
}

const TEAM = 'team-1'
const EVENT = '0e000000-0000-4000-8000-000000000001'

// Vaste klok: 27 oktober 2026, 11:00 in Amsterdam (10:00 UTC).
const NU = new Date('2026-10-27T10:00:00Z')
const VANDAAG = '2026-10-27'
const GISTEREN = '2026-10-26'
const MORGEN = '2026-10-28'

function teamMembersFixture(userId: string | undefined, extra: Record<string, unknown> = {}) {
  if (!userId) return { data: [], error: null }
  return { data: [{ team_id: userId, user_id: userId, rol: 'owner', ...extra }], error: null }
}

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
  queues?: Record<string, TableResult[]>
} = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const tables = opts.tables ?? {}
  const queues = opts.queues ?? {}
  const queries: Query[] = []

  function nextResult(table: string): TableResult {
    const queue = queues[table]
    if (queue && queue.length > 0) return queue.length === 1 ? queue[0] : queue.shift()!
    return tables[table] ?? (table === 'team_members' ? teamMembersFixture(user?.id) : { data: null, error: null })
  }

  function chain(table: string) {
    let q: Query = { table, kind: 'select', filters: [] }
    let geregistreerd = false
    const registreer = () => {
      if (!geregistreerd) { queries.push(q); geregistreerd = true }
    }
    const c: Record<string, unknown> = {}
    c.select = (cols: unknown) => {
      if (q.kind === 'select') q.cols = cols
      registreer()
      return c
    }
    c.eq = (col: string, val: unknown) => { q.filters.push({ op: 'eq', col, val }); return c }
    c.is = (col: string, val: unknown) => { q.filters.push({ op: 'is', col, val }); return c }
    c.in = () => c
    c.insert = (payload: Record<string, unknown>) => { q = { ...q, kind: 'insert', payload }; registreer(); return c }
    c.upsert = (payload: Record<string, unknown>, options: unknown) => { q = { ...q, kind: 'upsert', payload, options }; registreer(); return c }
    c.update = (payload: Record<string, unknown>) => { q = { ...q, kind: 'update', payload }; registreer(); return c }
    c.delete = () => { q = { ...q, kind: 'delete' }; registreer(); return c }
    c.maybeSingle = () => Promise.resolve(nextResult(table))
    c.single = () => Promise.resolve(nextResult(table))
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(nextResult(table))
    return c
  }

  const supabase = {
    from: (t: string) => chain(t),
    rpc: async () => ({ data: null, error: null }),
    auth: { getUser: async () => ({ data: { user } }) },
  }
  const op = (table: string, kind: Query['kind']) => queries.filter((x) => x.table === table && x.kind === kind)
  const evaluaties = () => queries.filter((x) => x.table === 'training_evaluaties')
  const nietTeam = () => queries.filter((x) => x.table !== 'team_members' && x.table !== 'settings')
  return { supabase, queries, op, evaluaties, nietTeam }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

function training(date: unknown = VANDAAG, doelstelling: unknown = 'Opbouw onder druk'): TableResult {
  return { data: { id: EVENT, type: 'training', date, doelstelling }, error: null }
}

function eigenTraining(opts: { events?: TableResult; evaluaties?: TableResult[] } = {}) {
  return makeSupabase({
    tables: { events: opts.events ?? training() },
    queues: { training_evaluaties: opts.evaluaties ?? [{ error: null }] },
  })
}

// Assistent met alleen de genoemde rechten (default: Spelers en Aanwezigheid,
// geen Training — R4).
function assistent(rechten: Record<string, boolean> = { mag_spelers_bewerken: true, mag_aanwezigheid_bewerken: true }) {
  return makeSupabase({
    tables: {
      team_members: teamMembersFixture(TEAM, { rol: 'assistent', ...rechten }),
      events: training(),
    },
  })
}

let consoleError: ReturnType<typeof vi.spyOn>
const OORSPRONKELIJKE_TZ = process.env.TZ

beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.TZ = 'Europe/Amsterdam'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NU)
})

afterEach(() => {
  consoleError.mockRestore()
  vi.useRealTimers()
  if (OORSPRONKELIJKE_TZ === undefined) delete process.env.TZ
  else process.env.TZ = OORSPRONKELIJKE_TZ
})

function logged() {
  return consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
}

const TEAM_FILTERS = [
  { op: 'eq', col: 'event_id', val: EVENT },
  { op: 'eq', col: 'team_id', val: TEAM },
]

// ── Opslaan ───────────────────────────────────────────────────────────

describe('saveTrainingRpe', () => {
  it('upsert EXACT { team_id, event_id, rpe } op event_id — geen oordeel-sleutel (R.9)', async () => {
    const m = eigenTraining()
    use(m)
    await saveTrainingRpe(EVENT, 7)

    const upserts = m.op('training_evaluaties', 'upsert')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].payload).toEqual({ team_id: TEAM, event_id: EVENT, rpe: 7 })
    expect(upserts[0].payload).not.toHaveProperty('oordeel')
    expect(upserts[0].options).toEqual({ onConflict: 'event_id' })
    const ev = m.op('events', 'select')[0]
    expect(ev.filters).toEqual([{ op: 'eq', col: 'id', val: EVENT }, { op: 'eq', col: 'team_id', val: TEAM }])
    expect(String(ev.cols)).toContain('date')
    expect(String(ev.cols)).toContain('type')
    expect(m.op('training_evaluaties', 'delete')).toHaveLength(0)
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}`)
  })

  it('een training van vandaag en van gisteren mag; ook zonder doelstelling', async () => {
    for (const date of [VANDAAG, GISTEREN]) {
      const m = eigenTraining({ events: training(date, null) })
      use(m)
      await saveTrainingRpe(EVENT, 5)
      expect(m.op('training_evaluaties', 'upsert')).toHaveLength(1)
    }
  })

  it.each([
    ['0', 0], ['11', 11], ['-1', -1], ['5.5', 5.5], ["'5'", '5'], ['null', null], ['NaN', NaN],
  ])('weigert RPE %s met "Ongeldige RPE", zonder select en zonder upsert (R.5)', async (_l, rpe) => {
    const m = eigenTraining()
    use(m)
    await expect(saveTrainingRpe(EVENT, rpe as number)).rejects.toThrow('Ongeldige RPE')
    expect(m.nietTeam()).toEqual([])
  })

  it('weigert een eventId dat geen uuid is, zonder DB-aanroep', async () => {
    const m = eigenTraining()
    use(m)
    await expect(saveTrainingRpe('e1', 5)).rejects.toThrow('Ongeldige RPE')
    expect(m.nietTeam()).toEqual([])
  })

  it.each([
    ['alleen Spelers en Aanwezigheid', { mag_spelers_bewerken: true, mag_aanwezigheid_bewerken: true }],
    ['alleen Spelers', { mag_spelers_bewerken: true }],
    ['alleen Aanwezigheid', { mag_aanwezigheid_bewerken: true }],
    ['Wedstrijd en Agenda', { mag_wedstrijd_bewerken: true, mag_agenda_bewerken: true }],
  ])('assistent met %s: "Geen toegang", zonder DB-aanroep (R4)', async (_l, rechten) => {
    const m = assistent(rechten)
    use(m)
    await expect(saveTrainingRpe(EVENT, 5)).rejects.toThrow('Geen toegang')
    await expect(saveTrainingOordeel(EVENT, 'ja')).rejects.toThrow('Geen toegang')
    await expect(wisTrainingRpe(EVENT)).rejects.toThrow('Geen toegang')
    await expect(wisTrainingOordeel(EVENT)).rejects.toThrow('Geen toegang')
    await expect(herstelTrainingRpe({ soort: 'training_rpe', teamId: TEAM, eventId: EVENT, rpe: 5 })).rejects.toThrow('Geen toegang')
    await expect(herstelTrainingOordeel({ soort: 'training_oordeel', teamId: TEAM, eventId: EVENT, oordeel: 'ja' })).rejects.toThrow('Geen toegang')
    expect(m.nietTeam()).toEqual([])
  })

  it('een assistent MET Trainingsrecht mag', async () => {
    const m = makeSupabase({
      tables: { team_members: teamMembersFixture(TEAM, { rol: 'assistent', mag_training_bewerken: true }), events: training() },
      queues: { training_evaluaties: [{ error: null }] },
    })
    use(m)
    await saveTrainingRpe(EVENT, 5)
    expect(m.op('training_evaluaties', 'upsert')).toHaveLength(1)
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(saveTrainingRpe(EVENT, 5)).rejects.toThrow('Niet ingelogd')
    expect(m.op('training_evaluaties', 'upsert')).toHaveLength(0)
  })

  it.each([
    ['een event van een ander team of niet-bestaand', { data: null, error: null }],
    ['een wedstrijd', { data: { id: EVENT, type: 'match', date: GISTEREN, doelstelling: null }, error: null }],
    ['een meting', { data: { id: EVENT, type: 'meting', date: GISTEREN, doelstelling: null }, error: null }],
  ])('weigert %s met "Event niet gevonden" en zonder upsert', async (_l, events) => {
    const m = eigenTraining({ events })
    use(m)
    await expect(saveTrainingRpe(EVENT, 5)).rejects.toThrow('Event niet gevonden')
    await expect(saveTrainingOordeel(EVENT, 'ja')).rejects.toThrow('Event niet gevonden')
    expect(m.op('training_evaluaties', 'upsert')).toHaveLength(0)
  })

  it('een training in de toekomst of zonder bruikbare datum: "Training nog niet gehouden" (R.10)', async () => {
    for (const date of [MORGEN, null, 20261027]) {
      const m = eigenTraining({ events: training(date) })
      use(m)
      await expect(saveTrainingRpe(EVENT, 5)).rejects.toThrow('Training nog niet gehouden')
      await expect(saveTrainingOordeel(EVENT, 'ja')).rejects.toThrow('Training nog niet gehouden')
      expect(m.op('training_evaluaties', 'upsert')).toHaveLength(0)
    }
  })

  it('twee keer opslaan geeft twee upserts en nooit een insert (laatste wint)', async () => {
    const m = eigenTraining()
    use(m)
    await saveTrainingRpe(EVENT, 4)
    await saveTrainingRpe(EVENT, 8)
    expect(m.op('training_evaluaties', 'upsert').map((u) => u.payload!.rpe)).toEqual([4, 8])
    expect(m.op('training_evaluaties', 'insert')).toHaveLength(0)
  })

  it('DB-fout → generieke melding, zonder ruwe tekst naar client of log', async () => {
    use(eigenTraining({ evaluaties: [{ error: { code: '42501', message: 'new row violates row-level security policy for table "training_evaluaties"' } }] }))
    const fout = await saveTrainingRpe(EVENT, 5).catch((e: Error) => e)
    expect((fout as Error).message).toBe(GENERIC_ERROR_MESSAGE)
    expect(logged()).toContain('trainingEvaluatie.saveTrainingRpe')
    expect(logged()).not.toContain('row-level security')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('saveTrainingOordeel', () => {
  it.each(['ja', 'deels', 'nee'] as TrainingOordeel[])('upsert EXACT { team_id, event_id, oordeel: %s } — geen rpe-sleutel (R.9)', async (oordeel) => {
    const m = eigenTraining()
    use(m)
    await saveTrainingOordeel(EVENT, oordeel)
    const u = m.op('training_evaluaties', 'upsert')
    expect(u).toHaveLength(1)
    expect(u[0].payload).toEqual({ team_id: TEAM, event_id: EVENT, oordeel })
    expect(u[0].payload).not.toHaveProperty('rpe')
    expect(u[0].options).toEqual({ onConflict: 'event_id' })
    expect(String(m.op('events', 'select')[0].cols)).toContain('doelstelling')
  })

  it.each([['Ja', 'Ja'], ['misschien', 'misschien'], ['leeg', ''], ['null', null], ['een getal', 1]])(
    'weigert oordeel %s met "Ongeldig oordeel", zonder DB-aanroep (O.4)',
    async (_l, oordeel) => {
      const m = eigenTraining()
      use(m)
      await expect(saveTrainingOordeel(EVENT, oordeel as TrainingOordeel)).rejects.toThrow('Ongeldig oordeel')
      expect(m.nietTeam()).toEqual([])
    },
  )

  it.each([['null', null], ['leeg', ''], ['alleen spaties', '   '], ['tab/newline', '\t\n']])(
    'doelstelling %s → "Geen doelstelling", geen upsert (R5.2)',
    async (_l, doelstelling) => {
      const m = eigenTraining({ events: training(GISTEREN, doelstelling) })
      use(m)
      await expect(saveTrainingOordeel(EVENT, 'ja')).rejects.toThrow('Geen doelstelling')
      expect(m.op('training_evaluaties', 'upsert')).toHaveLength(0)
    },
  )

  it('DB-fout → generieke melding met eigen label', async () => {
    use(eigenTraining({ evaluaties: [{ error: { code: '23514', message: 'violates check constraint' } }] }))
    await expect(saveTrainingOordeel(EVENT, 'ja')).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(logged()).toContain('trainingEvaluatie.saveTrainingOordeel')
    expect(logged()).not.toContain('check constraint')
  })
})

// ── Wissen ────────────────────────────────────────────────────────────

describe('wisTrainingRpe', () => {
  function teWissen(opts: { lees?: TableResult; schrijf?: TableResult; events?: TableResult } = {}) {
    return makeSupabase({
      tables: { events: opts.events ?? training(MORGEN, null) },
      queues: {
        training_evaluaties: [
          opts.lees ?? { data: { id: 'r1', rpe: 6 }, error: null },
          opts.schrijf ?? { data: [{ id: 'r1' }], error: null },
        ],
      },
    })
  }

  it('update { rpe: null } conditioneel op de gelezen waarde, nooit delete; geeft de snapshot terug', async () => {
    const m = teWissen()
    use(m)
    const herstel = await wisTrainingRpe(EVENT)

    const lees = m.op('training_evaluaties', 'select')[0]
    expect(lees.filters).toEqual(TEAM_FILTERS)
    expect(String(lees.cols)).toContain('rpe')
    const upd = m.op('training_evaluaties', 'update')
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toEqual({ rpe: null })
    expect(upd[0].filters).toEqual([...TEAM_FILTERS, { op: 'eq', col: 'rpe', val: 6 }])
    expect(m.op('training_evaluaties', 'delete')).toHaveLength(0)
    expect(herstel).toEqual({ soort: 'training_rpe', teamId: TEAM, eventId: EVENT, rpe: 6 })
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}`)
  })

  it('doet BEWUST geen trainings-, toekomst- of doelstellingscheck (opruimen kan altijd)', async () => {
    const m = teWissen()
    use(m)
    await wisTrainingRpe(EVENT)
    expect(m.nietTeam().map((q) => q.table)).toEqual(['training_evaluaties', 'training_evaluaties'])
  })

  it.each([
    ['geen rij', { data: null, error: null }],
    ['rpe al leeg', { data: { id: 'r1', rpe: null }, error: null }],
  ])('%s → "RPE niet gevonden", geen update', async (_l, lees) => {
    const m = teWissen({ lees })
    use(m)
    await expect(wisTrainingRpe(EVENT)).rejects.toThrow('RPE niet gevonden')
    expect(m.op('training_evaluaties', 'update')).toHaveLength(0)
  })

  it('intussen gewijzigd: de conditionele update raakt 0 rijen → "RPE niet gevonden"', async () => {
    use(teWissen({ schrijf: { data: [], error: null } }))
    await expect(wisTrainingRpe(EVENT)).rejects.toThrow('RPE niet gevonden')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('een id dat geen uuid is → niet gevonden, zonder query', async () => {
    const m = teWissen()
    use(m)
    await expect(wisTrainingRpe('e1')).rejects.toThrow('RPE niet gevonden')
    expect(m.nietTeam()).toEqual([])
  })

  it('DB-fout bij lezen of schrijven → generieke melding zonder ruwe tekst', async () => {
    const m = teWissen({ lees: { data: null, error: { code: '57014', message: 'canceling statement' } } })
    use(m)
    await expect(wisTrainingRpe(EVENT)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(m.op('training_evaluaties', 'update')).toHaveLength(0)
    use(teWissen({ schrijf: { data: null, error: { code: '42501', message: 'permission denied' } } }))
    await expect(wisTrainingRpe(EVENT)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(logged()).toContain('trainingEvaluatie.wisTrainingRpe')
    expect(logged()).not.toContain('permission denied')
  })
})

describe('wisTrainingOordeel', () => {
  it('update { oordeel: null } conditioneel, raakt rpe niet; ook zonder (huidige) doelstelling (R5.1)', async () => {
    const m = makeSupabase({
      tables: { events: training(GISTEREN, null) },
      queues: { training_evaluaties: [{ data: { id: 'r1', oordeel: 'deels' }, error: null }, { data: [{ id: 'r1' }], error: null }] },
    })
    use(m)
    const herstel = await wisTrainingOordeel(EVENT)
    const upd = m.op('training_evaluaties', 'update')[0]
    expect(upd.payload).toEqual({ oordeel: null })
    expect(upd.filters).toEqual([...TEAM_FILTERS, { op: 'eq', col: 'oordeel', val: 'deels' }])
    expect(m.op('training_evaluaties', 'delete')).toHaveLength(0)
    expect(herstel).toEqual({ soort: 'training_oordeel', teamId: TEAM, eventId: EVENT, oordeel: 'deels' })
  })

  it('zonder oordeel → "Oordeel niet gevonden"', async () => {
    use(makeSupabase({ queues: { training_evaluaties: [{ data: { id: 'r1', oordeel: null }, error: null }] } }))
    await expect(wisTrainingOordeel(EVENT)).rejects.toThrow('Oordeel niet gevonden')
  })
})

// ── Herstellen ────────────────────────────────────────────────────────

describe('herstelTrainingRpe', () => {
  const SNAPSHOT: HerstelTrainingRpe = { soort: 'training_rpe', teamId: TEAM, eventId: EVENT, rpe: 6 }

  function teHerstellen(evaluaties: TableResult[], events: TableResult = training()) {
    return makeSupabase({ tables: { events }, queues: { training_evaluaties: evaluaties } })
  }

  it('conditionele update met .is("rpe", null), team-gescoped; klaar bij 1 rij', async () => {
    const m = teHerstellen([{ data: [{ id: 'r1' }], error: null }])
    use(m)
    await herstelTrainingRpe(SNAPSHOT)
    const upd = m.op('training_evaluaties', 'update')
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toEqual({ rpe: 6 })
    expect(upd[0].filters).toEqual([...TEAM_FILTERS, { op: 'is', col: 'rpe', val: null }])
    expect(m.op('training_evaluaties', 'insert')).toHaveLength(0)
    expect(m.op('training_evaluaties', 'upsert')).toHaveLength(0)
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}`)
  })

  it('overschrijft nooit: 0 rijen en er staat al een nieuwere RPE → geen schrijfactie meer, resolve', async () => {
    const m = teHerstellen([{ data: [], error: null }, { data: { id: 'r1', rpe: 9 }, error: null }])
    use(m)
    await expect(herstelTrainingRpe(SNAPSHOT)).resolves.toBeUndefined()
    expect(m.op('training_evaluaties', 'update')).toHaveLength(1)
    expect(m.op('training_evaluaties', 'insert')).toHaveLength(0)
    expect(m.op('training_evaluaties', 'upsert')).toHaveLength(0)
  })

  it('geen rij → insert { team_id, event_id, rpe } zonder oordeel', async () => {
    const m = teHerstellen([{ data: [], error: null }, { data: null, error: null }, { error: null }])
    use(m)
    await herstelTrainingRpe(SNAPSHOT)
    const ins = m.op('training_evaluaties', 'insert')
    expect(ins).toHaveLength(1)
    expect(ins[0].payload).toEqual({ team_id: TEAM, event_id: EVENT, rpe: 6 })
  })

  it('23505 bij de insert → re-read; staat er een waarde, dan resolve', async () => {
    const m = teHerstellen([
      { data: [], error: null }, { data: null, error: null }, { error: { code: '23505' } }, { data: { id: 'r1', rpe: 3 }, error: null },
    ])
    use(m)
    await expect(herstelTrainingRpe(SNAPSHOT)).resolves.toBeUndefined()
    expect(m.op('training_evaluaties', 'select')).toHaveLength(2)
    expect(m.op('training_evaluaties', 'update')).toHaveLength(1)
  })

  it('23505 → re-read met lege kolom → tweede conditionele update; lukt die niet → HERSTEL_FOUT', async () => {
    const ok = teHerstellen([
      { data: [], error: null }, { data: null, error: null }, { error: { code: '23505' } },
      { data: { id: 'r1', rpe: null }, error: null }, { data: [{ id: 'r1' }], error: null },
    ])
    use(ok)
    await herstelTrainingRpe(SNAPSHOT)
    expect(ok.op('training_evaluaties', 'update')).toHaveLength(2)
    expect(ok.op('training_evaluaties', 'update')[1].filters).toContainEqual({ op: 'is', col: 'rpe', val: null })

    use(teHerstellen([
      { data: [], error: null }, { data: null, error: null }, { error: { code: '23505' } },
      { data: { id: 'r1', rpe: null }, error: null }, { data: [], error: null },
    ]))
    await expect(herstelTrainingRpe(SNAPSHOT)).rejects.toThrow(HERSTEL_FOUT)

    use(teHerstellen([{ data: [], error: null }, { data: null, error: null }, { error: { code: '23505' } }, { data: null, error: null }]))
    await expect(herstelTrainingRpe(SNAPSHOT)).rejects.toThrow(HERSTEL_FOUT)
  })

  it('andere databasefout → generieke melding zonder ruwe tekst', async () => {
    use(teHerstellen([{ data: null, error: { code: '42501', message: 'permission denied' } }]))
    await expect(herstelTrainingRpe(SNAPSHOT)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(logged()).toContain('trainingEvaluatie.herstelTrainingRpe')
    expect(logged()).not.toContain('permission denied')
  })

  it('weigert vervalste of ongeldige snapshots met HERSTEL_FOUT, zonder te schrijven', async () => {
    const m = teHerstellen([{ data: [{ id: 'r1' }], error: null }])
    use(m)
    for (const fout of [
      { ...SNAPSHOT, teamId: 'ander-team' },
      { ...SNAPSHOT, eventId: 'e1' },
      { ...SNAPSHOT, rpe: 0 },
      { ...SNAPSHOT, rpe: 11 },
      { ...SNAPSHOT, rpe: 5.5 },
      { ...SNAPSHOT, rpe: '5' as unknown as number },
      { ...SNAPSHOT, soort: 'training_oordeel' as never },
      null as unknown as HerstelTrainingRpe,
    ]) {
      await expect(herstelTrainingRpe(fout)).rejects.toThrow(HERSTEL_FOUT)
    }
    expect(m.op('training_evaluaties', 'update')).toHaveLength(0)
    expect(m.op('training_evaluaties', 'insert')).toHaveLength(0)
  })

  it.each([
    ['toekomst', training(MORGEN)],
    ['geen eigen training (meer)', { data: { id: EVENT, type: 'match', date: GISTEREN, doelstelling: null }, error: null }],
    ['onbekend event', { data: null, error: null }],
  ])('weigert bij %s met HERSTEL_FOUT', async (_l, events) => {
    const m = teHerstellen([{ data: [{ id: 'r1' }], error: null }], events)
    use(m)
    await expect(herstelTrainingRpe(SNAPSHOT)).rejects.toThrow(HERSTEL_FOUT)
    expect(m.op('training_evaluaties', 'update')).toHaveLength(0)
  })

  it('RPE-herstel eist GEEN doelstelling', async () => {
    const m = teHerstellen([{ data: [{ id: 'r1' }], error: null }], training(GISTEREN, null))
    use(m)
    await herstelTrainingRpe(SNAPSHOT)
    expect(m.op('training_evaluaties', 'update')).toHaveLength(1)
  })
})

describe('herstelTrainingOordeel', () => {
  const SNAPSHOT: HerstelTrainingOordeel = { soort: 'training_oordeel', teamId: TEAM, eventId: EVENT, oordeel: 'nee' }

  it('conditionele update met .is("oordeel", null) en payload alleen { oordeel }', async () => {
    const m = makeSupabase({ tables: { events: training() }, queues: { training_evaluaties: [{ data: [{ id: 'r1' }], error: null }] } })
    use(m)
    await herstelTrainingOordeel(SNAPSHOT)
    const upd = m.op('training_evaluaties', 'update')[0]
    expect(upd.payload).toEqual({ oordeel: 'nee' })
    expect(upd.filters).toEqual([...TEAM_FILTERS, { op: 'is', col: 'oordeel', val: null }])
  })

  it('zonder rij → insert zonder rpe-sleutel', async () => {
    const m = makeSupabase({
      tables: { events: training() },
      queues: { training_evaluaties: [{ data: [], error: null }, { data: null, error: null }, { error: null }] },
    })
    use(m)
    await herstelTrainingOordeel(SNAPSHOT)
    expect(m.op('training_evaluaties', 'insert')[0].payload).toEqual({ team_id: TEAM, event_id: EVENT, oordeel: 'nee' })
  })

  // B1 (Jamie akkoord): een oordeel bij een inmiddels lege doelstelling is
  // wisbaar (R5.1), dus de undo daarvan moet ook slagen (R8, AC-O.2).
  it.each([['null', null], ['leeg', ''], ['alleen spaties', '   ']])('doelstelling %s → herstel slaagt, nog steeds conditioneel met .is("oordeel", null)', async (_l, doel) => {
    const m = makeSupabase({ tables: { events: training(GISTEREN, doel) }, queues: { training_evaluaties: [{ data: [{ id: 'r1' }], error: null }] } })
    use(m)
    await expect(herstelTrainingOordeel(SNAPSHOT)).resolves.toBeUndefined()
    const upd = m.op('training_evaluaties', 'update')
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toEqual({ oordeel: 'nee' })
    expect(upd[0].filters).toEqual([...TEAM_FILTERS, { op: 'is', col: 'oordeel', val: null }])
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}`)
  })

  it('lege doelstelling en intussen een nieuwer oordeel → geen overschrijving, resolve', async () => {
    const m = makeSupabase({
      tables: { events: training(GISTEREN, null) },
      queues: { training_evaluaties: [{ data: [], error: null }, { data: { id: 'r1', oordeel: 'ja' }, error: null }] },
    })
    use(m)
    await expect(herstelTrainingOordeel(SNAPSHOT)).resolves.toBeUndefined()
    expect(m.op('training_evaluaties', 'update')).toHaveLength(1)
    expect(m.op('training_evaluaties', 'insert')).toHaveLength(0)
  })

  it.each([
    ['toekomst', training(MORGEN, null)],
    ['een wedstrijd', { data: { id: EVENT, type: 'match', date: GISTEREN, doelstelling: null }, error: null }],
    ['onbekend of ander team', { data: null, error: null }],
  ])('lege doelstelling maar %s → nog steeds HERSTEL_FOUT', async (_l, events) => {
    const m = makeSupabase({ tables: { events }, queues: { training_evaluaties: [{ data: [{ id: 'r1' }], error: null }] } })
    use(m)
    await expect(herstelTrainingOordeel(SNAPSHOT)).rejects.toThrow(HERSTEL_FOUT)
    expect(m.op('training_evaluaties', 'update')).toHaveLength(0)
  })

  it('zonder Trainingsrecht blijft herstel "Geen toegang", ook bij lege doelstelling', async () => {
    const m = makeSupabase({
      tables: { team_members: teamMembersFixture(TEAM, { rol: 'assistent', mag_spelers_bewerken: true, mag_aanwezigheid_bewerken: true }), events: training(GISTEREN, null) },
    })
    use(m)
    await expect(herstelTrainingOordeel(SNAPSHOT)).rejects.toThrow('Geen toegang')
    expect(m.nietTeam()).toEqual([])
  })

  it('ongeldig oordeel of vreemd team → HERSTEL_FOUT', async () => {
    use(makeSupabase({ tables: { events: training() } }))
    await expect(herstelTrainingOordeel({ ...SNAPSHOT, oordeel: 'misschien' as TrainingOordeel })).rejects.toThrow(HERSTEL_FOUT)
    await expect(herstelTrainingOordeel({ ...SNAPSHOT, teamId: 'team-2' })).rejects.toThrow(HERSTEL_FOUT)
    await expect(herstelTrainingOordeel({ ...SNAPSHOT, soort: 'training_rpe' as never })).rejects.toThrow(HERSTEL_FOUT)
  })
})

// ── Tijdzones: 3 TZ × 3 tijdstippen ───────────────────────────────────
// Vaste lokale klok in de server-TZ; todayLocal() bepaalt "vandaag".
const TZS: [string, number][] = [
  ['Europe/Amsterdam', -120],
  ['America/Los_Angeles', 420],
  ['Pacific/Auckland', -780],
]

describe.each(TZS)('Tijdzone %s', (tz, offset) => {
  beforeEach(() => {
    process.env.TZ = tz
  })

  it('TZ-controle: de tijdzone is echt gewisseld', () => {
    expect(new Date(2026, 9, 15, 12, 0).getTimezoneOffset()).toBe(offset)
  })

  it.each([[0, 30], [10, 0], [23, 30]])('om %i:%i lokaal: training van vandaag mag, die van morgen niet (RPE, oordeel en herstel)', async (uur, min) => {
    // Lokale tijd 15 oktober 2026 uur:min in de server-TZ.
    vi.setSystemTime(new Date(2026, 9, 15, uur, min))
    const vandaag = '2026-10-15'
    const morgen = '2026-10-16'

    const ok = eigenTraining({ events: training(vandaag) })
    use(ok)
    await expect(saveTrainingRpe(EVENT, 6)).resolves.toBeUndefined()
    await expect(saveTrainingOordeel(EVENT, 'ja')).resolves.toBeUndefined()
    expect(ok.op('training_evaluaties', 'upsert')).toHaveLength(2)

    const nee = eigenTraining({ events: training(morgen) })
    use(nee)
    await expect(saveTrainingRpe(EVENT, 6)).rejects.toThrow('Training nog niet gehouden')
    await expect(saveTrainingOordeel(EVENT, 'ja')).rejects.toThrow('Training nog niet gehouden')
    await expect(herstelTrainingRpe({ soort: 'training_rpe', teamId: TEAM, eventId: EVENT, rpe: 6 })).rejects.toThrow(HERSTEL_FOUT)
    expect(nee.op('training_evaluaties', 'upsert')).toHaveLength(0)
    expect(nee.op('training_evaluaties', 'update')).toHaveLength(0)
  })
})

describe('tijdzone: UTC-serverklok net na middernacht NL (fail-safe)', () => {
  it('00:30 in Amsterdam op de trainingsdag met een UTC-klok → nog "Training nog niet gehouden"', async () => {
    vi.setSystemTime(new Date('2026-10-26T23:30:00Z'))
    process.env.TZ = 'UTC'
    use(eigenTraining({ events: training(VANDAAG) }))
    await expect(saveTrainingRpe(EVENT, 5)).rejects.toThrow('Training nog niet gehouden')

    process.env.TZ = 'Europe/Amsterdam'
    const m = eigenTraining({ events: training(VANDAAG) })
    use(m)
    await saveTrainingRpe(EVENT, 5)
    expect(m.op('training_evaluaties', 'upsert')).toHaveLength(1)
  })
})
