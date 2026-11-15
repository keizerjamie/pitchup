import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { saveTrainerZelfreview } from '@/app/actions/trainer-zelfreview'
import { markTaskDone } from '@/app/actions/todos'
import type { ZelfreviewStelling } from '@/lib/trainer-zelfreview'

// Mock-patroon uit app/actions/training-evaluatie.test.ts: een chainable stub
// die filters NIET toepast, maar elke query vastlegt (tabel, soort, kolommen,
// payload, opties, filters). Wat RLS doet (alleen de eigen rij, datumcheck,
// geen delete) bewijst alleen supabase/team-rls-verificatie.sql blok 31.
//
// Anders dan daar zijn USER en TEAM hier VERSCHILLENDE id's: zo bewijst de
// payload dat user_id uit ctx.userId en team_id uit ctx.teamId komt.

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

const USER = '0a000000-0000-4000-8000-0000000000a1'
const TEAM = '0b000000-0000-4000-8000-0000000000b1'
const EVENT = '0e000000-0000-4000-8000-000000000001'

// Vaste klok: 27 oktober 2026, 11:00 in Amsterdam (10:00 UTC).
const NU = new Date('2026-10-27T10:00:00Z')
const VANDAAG = '2026-10-27'
const GISTEREN = '2026-10-26'
const MORGEN = '2026-10-28'

const GELDIG = {
  scores: { uitleg: 4, organisatie: 3, coaching: 5, sfeer: 2, tijdsbewaking: 1 } as Record<ZelfreviewStelling, number>,
  meeneem: '  Meer stilte bij de uitleg  ',
}

function lidmaatschap(extra: Record<string, unknown> = {}): TableResult {
  return { data: [{ team_id: TEAM, user_id: USER, rol: 'owner', ...extra }], error: null }
}

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
  queues?: Record<string, TableResult[]>
} = {}) {
  const user = opts.user === undefined ? { id: USER } : opts.user
  const tables = opts.tables ?? {}
  const queues = opts.queues ?? {}
  const queries: Query[] = []

  function nextResult(table: string): TableResult {
    const queue = queues[table]
    if (queue && queue.length > 0) return queue.length === 1 ? queue[0] : queue.shift()!
    if (tables[table]) return tables[table]
    if (table === 'team_members') return user ? lidmaatschap() : { data: [], error: null }
    return { data: null, error: null }
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
  const nietTeam = () => queries.filter((x) => x.table !== 'team_members' && x.table !== 'settings')
  return { supabase, queries, op, nietTeam }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

function training(date: unknown = VANDAAG, type = 'training'): TableResult {
  return { data: { id: EVENT, type, date }, error: null }
}

function eigenTraining(opts: { events?: TableResult; reviews?: TableResult[] } = {}) {
  return makeSupabase({
    tables: { events: opts.events ?? training() },
    queues: { trainer_zelfreviews: opts.reviews ?? [{ error: null }] },
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

// ── Succes ────────────────────────────────────────────────────────────

describe('saveTrainerZelfreview — opslaan', () => {
  it('upsert EXACT de payload met team_id/user_id uit de context, op (event_id,user_id); meeneem getrimd', async () => {
    const m = eigenTraining()
    use(m)
    await saveTrainerZelfreview(EVENT, GELDIG)

    const upserts = m.op('trainer_zelfreviews', 'upsert')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].payload).toEqual({
      team_id: TEAM,
      user_id: USER,
      event_id: EVENT,
      score_uitleg: 4,
      score_organisatie: 3,
      score_coaching: 5,
      score_sfeer: 2,
      score_tijdsbewaking: 1,
      meeneem: 'Meer stilte bij de uitleg',
      updated_at: NU.toISOString(),
    })
    expect(upserts[0].options).toEqual({ onConflict: 'event_id,user_id' })
    expect(m.op('trainer_zelfreviews', 'insert')).toHaveLength(0)
    expect(m.op('trainer_zelfreviews', 'delete')).toHaveLength(0)
  })

  it('updated_at is een UTC-ISO-string (timestamptz), onafhankelijk van de server-TZ', async () => {
    for (const tz of ['Europe/Amsterdam', 'UTC', 'America/New_York']) {
      process.env.TZ = tz
      const m = eigenTraining()
      use(m)
      await saveTrainerZelfreview(EVENT, GELDIG)
      expect(m.op('trainer_zelfreviews', 'upsert')[0].payload!.updated_at).toBe('2026-10-27T10:00:00.000Z')
    }
  })

  it('leest de training met id- én team-filter (tenant) en kijkt naar type en datum', async () => {
    const m = eigenTraining()
    use(m)
    await saveTrainerZelfreview(EVENT, GELDIG)
    const ev = m.op('events', 'select')
    expect(ev).toHaveLength(1)
    expect(ev[0].filters).toEqual([{ op: 'eq', col: 'id', val: EVENT }, { op: 'eq', col: 'team_id', val: TEAM }])
    expect(String(ev[0].cols)).toContain('type')
    expect(String(ev[0].cols)).toContain('date')
  })

  it('revalidatePath op de trainingspagina én het dashboard', async () => {
    use(eigenTraining())
    await saveTrainerZelfreview(EVENT, GELDIG)
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT}`)
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['lege string', ''],
    ['alleen witruimte', ' \n\t '],
  ])('meeneem %s → null in de payload', async (_l, meeneem) => {
    const m = eigenTraining()
    use(m)
    await saveTrainerZelfreview(EVENT, { scores: GELDIG.scores, meeneem: meeneem as string | null })
    expect(m.op('trainer_zelfreviews', 'upsert')[0].payload).toHaveProperty('meeneem', null)
  })

  it('precies 1000 tekens (na trim) mag', async () => {
    const m = eigenTraining()
    use(m)
    await saveTrainerZelfreview(EVENT, { scores: GELDIG.scores, meeneem: `  ${'x'.repeat(1000)}  ` })
    expect(m.op('trainer_zelfreviews', 'upsert')[0].payload!.meeneem).toBe('x'.repeat(1000))
  })

  it('extra sleutels in scores worden genegeerd en NIET doorgegeven', async () => {
    const m = eigenTraining()
    use(m)
    const scores = { ...GELDIG.scores, extra: 9, team_id: 'vals' } as unknown as Record<ZelfreviewStelling, number>
    await saveTrainerZelfreview(EVENT, { scores, meeneem: null })
    const payload = m.op('trainer_zelfreviews', 'upsert')[0].payload!
    expect(payload).not.toHaveProperty('extra')
    expect(payload).not.toHaveProperty('score_extra')
    expect(payload.team_id).toBe(TEAM)
  })

  it('een vervalste team_id/user_id in de invoer wordt genegeerd (altijd uit de context)', async () => {
    const m = eigenTraining()
    use(m)
    const invoer = { ...GELDIG, team_id: 'ander-team', user_id: 'iemand-anders' } as unknown as typeof GELDIG
    await saveTrainerZelfreview(EVENT, invoer)
    const payload = m.op('trainer_zelfreviews', 'upsert')[0].payload!
    expect(payload.team_id).toBe(TEAM)
    expect(payload.user_id).toBe(USER)
  })

  it('een training van vandaag en van gisteren mag', async () => {
    for (const date of [VANDAAG, GISTEREN]) {
      const m = eigenTraining({ events: training(date) })
      use(m)
      await saveTrainerZelfreview(EVENT, GELDIG)
      expect(m.op('trainer_zelfreviews', 'upsert')).toHaveLength(1)
    }
  })

  it('twee keer opslaan = twee upserts (overschrijven, laatste wint), nooit een insert', async () => {
    const m = makeSupabase({ tables: { events: training(), trainer_zelfreviews: { error: null } } })
    use(m)
    await saveTrainerZelfreview(EVENT, GELDIG)
    await saveTrainerZelfreview(EVENT, { scores: { ...GELDIG.scores, uitleg: 1 }, meeneem: null })
    const upserts = m.op('trainer_zelfreviews', 'upsert')
    expect(upserts.map((u) => u.payload!.score_uitleg)).toEqual([4, 1])
    expect(upserts.every((u) => (u.options as { onConflict: string }).onConflict === 'event_id,user_id')).toBe(true)
    expect(m.op('trainer_zelfreviews', 'insert')).toHaveLength(0)
  })

  it('raakt training_evaluaties nooit (AC9)', async () => {
    const m = eigenTraining()
    use(m)
    await saveTrainerZelfreview(EVENT, GELDIG)
    expect(m.queries.filter((q) => q.table === 'training_evaluaties')).toEqual([])
  })

  it('een assistent MET trainingsrecht mag', async () => {
    const m = makeSupabase({
      tables: { team_members: lidmaatschap({ rol: 'assistent', mag_training_bewerken: true }), events: training() },
      queues: { trainer_zelfreviews: [{ error: null }] },
    })
    use(m)
    await saveTrainerZelfreview(EVENT, GELDIG)
    expect(m.op('trainer_zelfreviews', 'upsert')[0].payload).toMatchObject({ team_id: TEAM, user_id: USER })
  })
})

// ── Falen ─────────────────────────────────────────────────────────────

describe('saveTrainerZelfreview — weigeren', () => {
  const metScore = (stelling: ZelfreviewStelling, waarde: unknown) => ({
    scores: { ...GELDIG.scores, [stelling]: waarde } as Record<ZelfreviewStelling, number>,
    meeneem: null,
  })

  it.each([
    ['score 0', metScore('uitleg', 0)],
    ['score 6', metScore('organisatie', 6)],
    ['score -1', metScore('coaching', -1)],
    ['decimaal 2.5', metScore('sfeer', 2.5)],
    ["string '3'", metScore('tijdsbewaking', '3')],
    ['NaN', metScore('uitleg', NaN)],
    ['Infinity', metScore('uitleg', Infinity)],
    ['null', metScore('coaching', null)],
    ['ontbrekende stelling', { scores: { uitleg: 3, organisatie: 3, coaching: 3, sfeer: 3 }, meeneem: null }],
    ['lege scores', { scores: {}, meeneem: null }],
    ['scores als array', { scores: [3, 3, 3, 3, 3], meeneem: null }],
    ['scores null', { scores: null, meeneem: null }],
    ['invoer null', null],
    ['invoer string', 'alles 5'],
    ['meeneem 1001 tekens', { scores: GELDIG.scores, meeneem: 'x'.repeat(1001) }],
    ['meeneem 1001 tekens na trim', { scores: GELDIG.scores, meeneem: ` ${'x'.repeat(1001)} ` }],
    ['meeneem getal', { scores: GELDIG.scores, meeneem: 42 }],
    ['meeneem object', { scores: GELDIG.scores, meeneem: { tekst: 'x' } }],
  ])('%s → "Ongeldige zelfreview", zonder DB-aanroep (AC14/AC15)', async (_l, invoer) => {
    const m = eigenTraining()
    use(m)
    await expect(saveTrainerZelfreview(EVENT, invoer as typeof GELDIG)).rejects.toThrow('Ongeldige zelfreview')
    expect(m.nietTeam()).toEqual([])
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each([['geen uuid', 'e1'], ['leeg', ''], ['null', null], ['getal', 42]])(
    'eventId %s → "Ongeldige zelfreview", zonder DB-aanroep',
    async (_l, eventId) => {
      const m = eigenTraining()
      use(m)
      await expect(saveTrainerZelfreview(eventId as string, GELDIG)).rejects.toThrow('Ongeldige zelfreview')
      expect(m.nietTeam()).toEqual([])
    },
  )

  it.each([
    ['een event van een ander team of niet-bestaand', { data: null, error: null }],
    ['een wedstrijd', training(GISTEREN, 'match')],
    ['een meting', training(GISTEREN, 'meting')],
  ])('%s → "Event niet gevonden", geen upsert (AC17)', async (_l, events) => {
    const m = eigenTraining({ events })
    use(m)
    await expect(saveTrainerZelfreview(EVENT, GELDIG)).rejects.toThrow('Event niet gevonden')
    expect(m.op('trainer_zelfreviews', 'upsert')).toHaveLength(0)
  })

  it('een training van morgen of zonder bruikbare datum → "Training nog niet gehouden" (AC18)', async () => {
    for (const date of [MORGEN, null, 20261027]) {
      const m = eigenTraining({ events: training(date) })
      use(m)
      await expect(saveTrainerZelfreview(EVENT, GELDIG)).rejects.toThrow('Training nog niet gehouden')
      expect(m.op('trainer_zelfreviews', 'upsert')).toHaveLength(0)
    }
  })

  it('kort na middernacht NL (server in UTC nog gisteren): een training van "vandaag" NL is fail-safe nog toekomst', async () => {
    process.env.TZ = 'UTC'
    vi.setSystemTime(new Date('2026-10-26T23:30:00Z')) // 00:30 op 27-10 in Amsterdam
    const m = eigenTraining({ events: training(VANDAAG) })
    use(m)
    await expect(saveTrainerZelfreview(EVENT, GELDIG)).rejects.toThrow('Training nog niet gehouden')
    expect(m.op('trainer_zelfreviews', 'upsert')).toHaveLength(0)
  })

  it.each([
    ['alleen Spelers en Aanwezigheid', { mag_spelers_bewerken: true, mag_aanwezigheid_bewerken: true }],
    ['Wedstrijd en Agenda', { mag_wedstrijd_bewerken: true, mag_agenda_bewerken: true }],
    ['geen rechten', {}],
  ])('assistent met %s (zonder trainingsrecht): "Geen toegang", zonder DB-aanroep', async (_l, rechten) => {
    const m = makeSupabase({
      tables: { team_members: lidmaatschap({ rol: 'assistent', ...rechten }), events: training() },
    })
    use(m)
    await expect(saveTrainerZelfreview(EVENT, GELDIG)).rejects.toThrow('Geen toegang')
    expect(m.nietTeam()).toEqual([])
  })

  it('niet ingelogd → "Niet ingelogd", geen upsert', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(saveTrainerZelfreview(EVENT, GELDIG)).rejects.toThrow('Niet ingelogd')
    expect(m.op('trainer_zelfreviews', 'upsert')).toHaveLength(0)
  })

  it('ingelogd zonder team → "Geen team", geen upsert', async () => {
    const m = makeSupabase({ tables: { team_members: { data: [], error: null } } })
    use(m)
    await expect(saveTrainerZelfreview(EVENT, GELDIG)).rejects.toThrow('Geen team')
    expect(m.op('trainer_zelfreviews', 'upsert')).toHaveLength(0)
  })

  it('DB-fout → generieke melding, zonder ruwe tekst naar client of log, geen revalidate (AC16)', async () => {
    use(eigenTraining({ reviews: [{ error: { code: '42501', message: 'new row violates row-level security policy for table "trainer_zelfreviews"' } }] }))
    const fout = await saveTrainerZelfreview(EVENT, GELDIG).catch((e: Error) => e)
    expect((fout as Error).message).toBe(GENERIC_ERROR_MESSAGE)
    expect(logged()).toContain('trainerZelfreview.save')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('row-level security')
    expect(logged()).not.toContain(TEAM)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

// ── Niet handmatig afvinkbaar (AC26) ──────────────────────────────────

describe('markTaskDone(…, self_review)', () => {
  it('"Ongeldige taak": de zelfreview is geen task_overrides-type', async () => {
    const m = makeSupabase({ tables: { events: training() } })
    use(m)
    await expect(markTaskDone(EVENT, 'self_review' as never)).rejects.toThrow('Ongeldige taak')
    expect(m.queries.filter((q) => q.table === 'task_overrides')).toEqual([])
  })
})
