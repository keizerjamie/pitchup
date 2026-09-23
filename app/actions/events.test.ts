import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`__redirect__:${to}`) },
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// getDefaultAttendance leest zelf settings; hier vastgezet zodat deze tests
// alleen over events gaan.
vi.mock('@/app/actions/settings', () => ({ getDefaultAttendance: vi.fn(async () => 'present') }))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { createEvent, updateGatherTime, updateTrainingstype } from '@/app/actions/events'

// ────────────────────────────────────────────────
// Mocks (opzet overgenomen uit app/actions/match-squad.test.ts)
// ────────────────────────────────────────────────

type TableResult = { data?: unknown; error?: unknown }

// Elke server action haalt sinds deze feature eerst de teamcontext op
// (lib/team-context.ts, requireTeamContext). Die leest team_members; zonder
// een lidmaatschapsrij komt geen enkele action voorbij zijn eerste regel
// ('Geen team'). In fase 1 geldt teams.id === user.id, dus de owner-rij wijst
// naar hetzelfde id als de sessie-user — vanaf fase 2 kan team_id daarvan
// afwijken en is dit de plek om dat na te bootsen.
function teamMembersFixture(userId: string | undefined) {
  if (!userId) return { data: [], error: null }
  return { data: [{ team_id: userId, user_id: userId, rol: 'owner' }], error: null }
}

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
  rpcError?: { code?: string; message: string }
  // Laat uitsluitend de DELETE op deze tabel falen. Nodig voor de compensatie:
  // daar moet de events-INSERT slagen en juist de opruim-DELETE mislukken.
  deleteError?: { table: string; error: { code?: string; message: string } }
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  type Eq = { col: string; val: unknown }
  const calls = {
    rpc: [] as { fn: string; args: Record<string, unknown> }[],
    select: [] as { table: string; eqs: Eq[] }[],
    insert: [] as { table: string; payload: unknown }[],
    update: [] as { table: string; payload: Record<string, unknown>; eqs: Eq[] }[],
    delete: [] as { table: string; eqs: Eq[] }[],
  }

  function chain(table: string) {
    const result = tables[table] ?? (table === 'team_members' ? teamMembersFixture(user?.id) : { data: [], error: null })
    const eqs: Eq[] = []
    const c: Record<string, unknown> = {}
    c.select = () => { calls.select.push({ table, eqs }); return c }
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    // `.in()` hoort erbij sinds getTeamContext de teamnamen ophaalt met
    // settings.select('team_id, value').in('team_id', ...). Alleen doorgeven:
    // deze stub past filters toch niet toe.
    c.in = () => c
    // Datumfilters en sortering van de afmeldperiode-query: alleen doorgeven,
    // niet vastleggen — de eq-lijst blijft zo de tenant-check.
    c.gte = () => c
    c.lte = () => c
    c.order = () => c
    c.insert = (payload: unknown) => { calls.insert.push({ table, payload }); return c }
    c.update = (payload: Record<string, unknown>) => {
      calls.update.push({ table, payload, eqs })
      return c
    }
    let deleting = false
    c.delete = () => { calls.delete.push({ table, eqs }); deleting = true; return c }
    function uitkomst() {
      if (deleting && opts.deleteError?.table === table) {
        return { data: null, error: opts.deleteError.error }
      }
      return result
    }
    c.maybeSingle = () => Promise.resolve(uitkomst())
    c.single = () => Promise.resolve(uitkomst())
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(uitkomst())
    return c
  }

  const supabase = {
    from: (t: string) => chain(t),
    // De vier kolom-begrensde RPC's uit supabase/team-rls-gevolgacties.sql
    // (set_event_doelstelling, set_match_result, set_gather_time,
    // set_trainingstype). `rpcError` laat een test de SQLSTATE nabootsen die
    // die functies gooien: 42501 = geen recht, P0002 = niet gevonden.
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push({ fn, args })
      return { data: null, error: opts.rpcError ?? null }
    },
    auth: { getUser: async () => ({ data: { user } }) },
  }
  return { supabase, calls }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

// Standaard: eigen wedstrijd e1; insert/update slagen.
function eigenTeam(extra: Record<string, TableResult> = {}, rpcError?: { code?: string; message: string }) {
  return makeSupabase({
    rpcError,
    tables: {
      events: { data: { id: 'e1', type: 'match' }, error: null },
      players: { data: [], error: null },
      attendance: { data: null, error: null },
      ...extra,
    },
  })
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const WEDSTRIJD = {
  type: 'match',
  date: '2026-09-12',
  time: '14:30',
  match_type: 'league',
  home_away: 'home',
  opponent: 'DVC',
}

const TRAINING = { type: 'training', date: '2026-09-10', time: '19:00' }

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

function logged() {
  return consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
}

function eventsPayload(m: ReturnType<typeof makeSupabase>): Record<string, unknown> {
  return m.calls.insert.find((i) => i.table === 'events')!.payload as Record<string, unknown>
}

// ────────────────────────────────────────────────
// createEvent — gather_time
// ────────────────────────────────────────────────

describe('createEvent — verzameltijd', () => {
  it('schrijft de verzameltijd weg bij een wedstrijd', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form({ ...WEDSTRIJD, gather_time: '13:45' })))
      .rejects.toThrow('__redirect__:/events/e1')

    const payload = eventsPayload(m)
    expect(payload.gather_time).toBe('13:45')
    expect(payload.time).toBe('14:30')
    expect(payload.team_id).toBe('team-1')
  })

  it('zet de verzameltijd op null als het veld leeg blijft', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form({ ...WEDSTRIJD, gather_time: '' })))
      .rejects.toThrow('__redirect__:/events/e1')

    expect(eventsPayload(m).gather_time).toBeNull()
  })

  it('zet de verzameltijd op null als het veld helemaal ontbreekt', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form(WEDSTRIJD))).rejects.toThrow('__redirect__:/events/e1')

    expect(eventsPayload(m).gather_time).toBeNull()
  })

  it('geeft een training nooit een verzameltijd, ook niet als het veld wordt meegestuurd', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form({ ...TRAINING, gather_time: '18:30' })))
      .rejects.toThrow('__redirect__:/events/e1')

    const payload = eventsPayload(m)
    expect(payload).not.toHaveProperty('gather_time')
    expect(payload.type).toBe('training')
  })

  it('weigert een ongeldige verzameltijd en schrijft niets weg', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form({ ...WEDSTRIJD, gather_time: '25:00' })))
      .rejects.toThrow('Ongeldig tijdstip')
    expect(m.calls.insert).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────
// createEvent — compensatie bij een mislukte attendance-insert
//
// Deze fout werd vóór het §8-addendum genegeerd: het event stond er dan wél,
// maar zonder aanwezigheidsrijen, en de trainer merkte niets. Nu wordt het
// zojuist gemaakte event teruggedraaid en faalt de action zichtbaar — zelfde
// compensatiepatroon als markAbsentForPeriod in app/actions/attendance.ts.
// ────────────────────────────────────────────────

describe('createEvent — mislukte aanwezigheidsrijen', () => {
  function metAttendanceFout() {
    return makeSupabase({
      tables: {
        events: { data: { id: 'e1', type: 'training' }, error: null },
        players: { data: [{ id: 'p1' }], error: null },
        attendance: { data: null, error: { code: '42501', message: 'permission denied for table attendance' } },
        absence_periods: { data: [], error: null },
      },
    })
  }

  it('verwijdert het zojuist gemaakte event weer, tenant-gescoped', async () => {
    const m = metAttendanceFout()
    use(m)

    await expect(createEvent(form(TRAINING))).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    const eventDelete = m.calls.delete.find((d) => d.table === 'events')!
    expect(eventDelete.eqs).toEqual([
      { col: 'id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('faalt zichtbaar met een generieke melding en lekt de ruwe fout niet', async () => {
    use(metAttendanceFout())

    await expect(createEvent(form(TRAINING))).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('events.createEvent.attendance')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
  })

  it('redirect niet — er is geen half event om naartoe te navigeren', async () => {
    use(metAttendanceFout())

    await expect(createEvent(form(TRAINING))).rejects.not.toThrow('__redirect__')
  })

  it('logt het apart als de compensatie zélf mislukt — dan blijft er een half event achter', async () => {
    use(makeSupabase({
      deleteError: { table: 'events', error: { code: '42501', message: 'permission denied for table events' } },
      tables: {
        events: { data: { id: 'e1', type: 'training' }, error: null },
        players: { data: [{ id: 'p1' }], error: null },
        attendance: { data: null, error: { code: '23503', message: 'insert or update violates foreign key' } },
        absence_periods: { data: [], error: null },
      },
    }))

    await expect(createEvent(form(TRAINING))).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    // Beide contextlabels: de oorzaak én het feit dat de opruiming faalde.
    expect(logged()).toContain('events.createEvent.attendance')
    expect(logged()).toContain('events.createEvent.compensatie')
    // Nog steeds geen ruwe melding, van geen van beide fouten.
    expect(logged()).not.toContain('permission denied')
    expect(logged()).not.toContain('violates foreign key')
  })
})

// ────────────────────────────────────────────────
// createEvent — afmeldperiode
// ────────────────────────────────────────────────

describe('createEvent — afmeldperiode', () => {
  const PLAYER_A = 'p1'
  const PLAYER_B = 'p2'
  const PERIOD_1 = 'ap-1'

  // Speler A zit in een periode die de eventdatum dekt, speler B niet.
  function metPeriode(periods: unknown[], extra: Record<string, TableResult> = {}) {
    return makeSupabase({
      tables: {
        events: { data: { id: 'e1', type: 'match' }, error: null },
        players: { data: [{ id: PLAYER_A }, { id: PLAYER_B }], error: null },
        attendance: { data: null, error: null },
        absence_periods: { data: periods, error: null },
        ...extra,
      },
    })
  }

  const LOPENDE_PERIODE = [
    { id: PERIOD_1, player_id: PLAYER_A, from_date: '2026-09-01', to_date: '2026-09-30' },
  ]

  function attendanceRows(m: ReturnType<typeof makeSupabase>): Record<string, unknown>[] {
    return m.calls.insert.find((i) => i.table === 'attendance')!.payload as Record<string, unknown>[]
  }

  it('zet een speler met een lopende periode op absent en de rest op de standaardstatus', async () => {
    const m = metPeriode(LOPENDE_PERIODE)
    use(m)

    await expect(createEvent(form(TRAINING))).rejects.toThrow('__redirect__:/events/e1')

    expect(attendanceRows(m)).toEqual([
      { event_id: 'e1', player_id: PLAYER_A, status: 'absent', team_id: 'team-1', injury_set: false, absence_period_id: PERIOD_1 },
      { event_id: 'e1', player_id: PLAYER_B, status: 'present', team_id: 'team-1', injury_set: false, absence_period_id: null },
    ])
  })

  it('doet hetzelfde voor een wedstrijd', async () => {
    const m = metPeriode([
      { id: PERIOD_1, player_id: PLAYER_A, from_date: '2026-09-12', to_date: '2026-09-12' },
    ])
    use(m)

    await expect(createEvent(form(WEDSTRIJD))).rejects.toThrow('__redirect__:/events/e1')

    expect(attendanceRows(m)).toEqual([
      { event_id: 'e1', player_id: PLAYER_A, status: 'absent', team_id: 'team-1', injury_set: false, absence_period_id: PERIOD_1 },
      { event_id: 'e1', player_id: PLAYER_B, status: 'present', team_id: 'team-1', injury_set: false, absence_period_id: null },
    ])
  })

  it('geeft elke rij dezelfde sleutels, ook zonder enige periode', async () => {
    // PostgREST weigert een bulk-insert waarin de objecten verschillende
    // kolommen hebben; absence_period_id en injury_set moeten dus altijd mee.
    const m = metPeriode([])
    use(m)

    await expect(createEvent(form(TRAINING))).rejects.toThrow('__redirect__:/events/e1')

    for (const row of attendanceRows(m)) {
      expect(Object.keys(row).sort()).toEqual(
        ['absence_period_id', 'event_id', 'injury_set', 'player_id', 'status', 'team_id'],
      )
      expect(row.status).toBe('present')
      expect(row.absence_period_id).toBeNull()
      expect(row.injury_set).toBe(false)
    }
  })

  it('laat een periode die de datum net niet dekt ongemoeid', async () => {
    const m = metPeriode([
      { id: PERIOD_1, player_id: PLAYER_A, from_date: '2026-09-01', to_date: '2026-09-09' },
    ])
    use(m)

    // TRAINING is op 2026-09-10, één dag na het einde van de periode.
    await expect(createEvent(form(TRAINING))).rejects.toThrow('__redirect__:/events/e1')

    for (const row of attendanceRows(m)) {
      expect(row.status).toBe('present')
      expect(row.absence_period_id).toBeNull()
    }
  })

  it('haalt de periodes team-gescoped op', async () => {
    const m = metPeriode(LOPENDE_PERIODE)
    use(m)

    await expect(createEvent(form(TRAINING))).rejects.toThrow('__redirect__:/events/e1')

    const periodSelect = m.calls.select.find((s) => s.table === 'absence_periods')!
    expect(periodSelect.eqs).toEqual([{ col: 'team_id', val: 'team-1' }])
  })

  it('geeft een generieke melding bij een databasefout op de periodequery', async () => {
    const m = metPeriode([], {
      absence_periods: { data: null, error: { code: '42501', message: 'permission denied for table absence_periods' } },
    })
    use(m)

    await expect(createEvent(form(TRAINING))).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    // Bewust géén aanwezigheidsrijen met de standaardstatus: dan zou een
    // afgemelde speler stilzwijgend als aanwezig in de lijst staan.
    expect(m.calls.insert.find((i) => i.table === 'attendance')).toBeUndefined()
    expect(logged()).toContain('events.createEvent.periods')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
  })
})

// ────────────────────────────────────────────────
// createEvent — blessure
// ────────────────────────────────────────────────
// Gespiegeld aan het afmeldperiode-blok hierboven: een speler met
// players.injured = true moet op een NIEUW event meteen absent + injury_set
// krijgen, precies zoals markInjured dat voor bestaande events doet
// (app/actions/players.ts:124-132).

describe('createEvent — blessure', () => {
  const PLAYER_A = 'p1'
  const PLAYER_B = 'p2'
  const PERIOD_1 = 'ap-1'

  // Speler A is geblesseerd, speler B niet.
  function metBlessure(
    players: { id: string; injured?: boolean }[],
    periods: unknown[] = [],
    extra: Record<string, TableResult> = {},
  ) {
    return makeSupabase({
      tables: {
        events: { data: { id: 'e1', type: 'match' }, error: null },
        players: { data: players, error: null },
        attendance: { data: null, error: null },
        absence_periods: { data: periods, error: null },
        ...extra,
      },
    })
  }

  function attendanceRows(m: ReturnType<typeof makeSupabase>): Record<string, unknown>[] {
    return m.calls.insert.find((i) => i.table === 'attendance')!.payload as Record<string, unknown>[]
  }

  it('zet een geblesseerde speler op absent met injury_set en laat de teamgenoot op de standaardstatus', async () => {
    const m = metBlessure([{ id: PLAYER_A, injured: true }, { id: PLAYER_B, injured: false }])
    use(m)

    await expect(createEvent(form(TRAINING))).rejects.toThrow('__redirect__:/events/e1')

    expect(attendanceRows(m)).toEqual([
      { event_id: 'e1', player_id: PLAYER_A, status: 'absent', team_id: 'team-1', injury_set: true, absence_period_id: null },
      { event_id: 'e1', player_id: PLAYER_B, status: 'present', team_id: 'team-1', injury_set: false, absence_period_id: null },
    ])
  })

  it('doet hetzelfde voor een wedstrijd', async () => {
    const m = metBlessure([{ id: PLAYER_A, injured: true }, { id: PLAYER_B, injured: false }])
    use(m)

    await expect(createEvent(form(WEDSTRIJD))).rejects.toThrow('__redirect__:/events/e1')

    expect(attendanceRows(m)).toEqual([
      { event_id: 'e1', player_id: PLAYER_A, status: 'absent', team_id: 'team-1', injury_set: true, absence_period_id: null },
      { event_id: 'e1', player_id: PLAYER_B, status: 'present', team_id: 'team-1', injury_set: false, absence_period_id: null },
    ])
  })

  it('combineert blessure en een dekkende periode: absent met beide markeringen', async () => {
    const m = metBlessure(
      [{ id: PLAYER_A, injured: true }, { id: PLAYER_B, injured: false }],
      [{ id: PERIOD_1, player_id: PLAYER_A, from_date: '2026-09-01', to_date: '2026-09-30' }],
    )
    use(m)

    await expect(createEvent(form(TRAINING))).rejects.toThrow('__redirect__:/events/e1')

    expect(attendanceRows(m)[0]).toEqual({
      event_id: 'e1', player_id: PLAYER_A, status: 'absent', team_id: 'team-1',
      injury_set: true, absence_period_id: PERIOD_1,
    })
  })

  it('geeft een generieke melding bij een databasefout op de spelersquery', async () => {
    const m = metBlessure([], [], {
      players: { data: null, error: { code: '42501', message: 'permission denied for table players' } },
    })
    use(m)

    await expect(createEvent(form(TRAINING))).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    // Bewust géén aanwezigheidsrijen: zonder de injured-vlag zou een
    // geblesseerde speler stilzwijgend als aanwezig in de lijst staan.
    expect(m.calls.insert.find((i) => i.table === 'attendance')).toBeUndefined()
    expect(logged()).toContain('events.createEvent.players')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
  })
})

// ────────────────────────────────────────────────
// AC5 — een gastspeler (players.type = 'guest') komt op een NIEUW event altijd
// op 'absent', ongeacht getDefaultAttendance (hier vastgezet op 'present').
// ────────────────────────────────────────────────

describe('createEvent — gastspeler', () => {
  const GAST = 'p1'
  const REGULIER = 'p2'
  const PERIOD_1 = 'ap-1'

  function metGast(
    players: { id: string; injured?: boolean; type?: string }[],
    periods: unknown[] = [],
    extra: Record<string, TableResult> = {},
  ) {
    return makeSupabase({
      tables: {
        events: { data: { id: 'e1', type: 'match' }, error: null },
        players: { data: players, error: null },
        attendance: { data: null, error: null },
        absence_periods: { data: periods, error: null },
        ...extra,
      },
    })
  }

  function attendanceRows(m: ReturnType<typeof makeSupabase>): Record<string, unknown>[] {
    return m.calls.insert.find((i) => i.table === 'attendance')!.payload as Record<string, unknown>[]
  }

  const STANDAARD = [
    { id: GAST, injured: false, type: 'guest' },
    { id: REGULIER, injured: false, type: 'regular' },
  ]

  it('zet de gast op absent en de reguliere speler op de teamstandaard (training)', async () => {
    const m = metGast(STANDAARD)
    use(m)

    await expect(createEvent(form(TRAINING))).rejects.toThrow('__redirect__:/events/e1')

    expect(attendanceRows(m)).toEqual([
      { event_id: 'e1', player_id: GAST, status: 'absent', team_id: 'team-1', injury_set: false, absence_period_id: null },
      { event_id: 'e1', player_id: REGULIER, status: 'present', team_id: 'team-1', injury_set: false, absence_period_id: null },
    ])
  })

  it('doet hetzelfde voor een wedstrijd', async () => {
    const m = metGast(STANDAARD)
    use(m)

    await expect(createEvent(form(WEDSTRIJD))).rejects.toThrow('__redirect__:/events/e1')

    expect(attendanceRows(m)[0]).toMatchObject({ player_id: GAST, status: 'absent' })
    expect(attendanceRows(m)[1]).toMatchObject({ player_id: REGULIER, status: 'present' })
  })

  it('blijft absent in combinatie met blessure en een dekkende periode (AC9)', async () => {
    const m = metGast(
      [{ id: GAST, injured: true, type: 'guest' }],
      [{ id: PERIOD_1, player_id: GAST, from_date: '2026-09-01', to_date: '2026-09-30' }],
    )
    use(m)

    await expect(createEvent(form(TRAINING))).rejects.toThrow('__redirect__:/events/e1')

    expect(attendanceRows(m)[0]).toEqual({
      event_id: 'e1', player_id: GAST, status: 'absent', team_id: 'team-1',
      injury_set: true, absence_period_id: PERIOD_1,
    })
  })

  it('houdt het active-filter en de tenant-scope op de spelersquery', async () => {
    // Een gast is gewoon actief: zonder dit filter zou hij nooit een rij
    // krijgen, mét een verkeerde scope zou hij van een ander team kunnen komen.
    const m = metGast(STANDAARD)
    use(m)

    await expect(createEvent(form(TRAINING))).rejects.toThrow('__redirect__:/events/e1')

    expect(m.calls.select.find((s) => s.table === 'players')!.eqs).toEqual([
      { col: 'active', val: true },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('houdt de sleutelset gelijk voor gast en reguliere speler', async () => {
    const m = metGast(STANDAARD)
    use(m)

    await expect(createEvent(form(TRAINING))).rejects.toThrow('__redirect__:/events/e1')

    for (const row of attendanceRows(m)) {
      expect(Object.keys(row).sort()).toEqual(
        ['absence_period_id', 'event_id', 'injury_set', 'player_id', 'status', 'team_id'],
      )
    }
  })
})

// ────────────────────────────────────────────────
// createEvent — trainingstype
// ────────────────────────────────────────────────

describe('createEvent — trainingstype', () => {
  it('schrijft het gekozen trainingstype weg', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form({ ...TRAINING, trainingstype: 'teamtactisch' })))
      .rejects.toThrow('__redirect__:/events/e1')

    expect(eventsPayload(m).trainingstype).toBe('teamtactisch')
  })

  it('valt zonder veld terug op VCT (gelijk aan de DB-default)', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form(TRAINING))).rejects.toThrow('__redirect__:/events/e1')

    expect(eventsPayload(m).trainingstype).toBe('vct')
  })

  it('geeft een wedstrijd nooit een trainingstype, ook niet als het veld wordt meegestuurd', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form({ ...WEDSTRIJD, trainingstype: 'teamtactisch' })))
      .rejects.toThrow('__redirect__:/events/e1')

    expect(eventsPayload(m)).not.toHaveProperty('trainingstype')
  })

  it('weigert een onbekend trainingstype en schrijft niets weg', async () => {
    // Nooit stil terugvallen op de default: een waarde die er wél stond maar
    // onzin is, is een fout — zelfde lijn als match_type.
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form({ ...TRAINING, trainingstype: 'onzin' })))
      .rejects.toThrow('Ongeldig trainingstype')
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert een leeg trainingstype-veld (leeg is geen geldige keuze)', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createEvent(form({ ...TRAINING, trainingstype: '' })))
      .rejects.toThrow('Ongeldig trainingstype')
    expect(m.calls.insert).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────
// updateTrainingstype
// ────────────────────────────────────────────────

// Standaard: eigen training e1.
function eigenTraining(extra: Record<string, TableResult> = {}, rpcError?: { code?: string; message: string }) {
  return makeSupabase({
    rpcError,
    tables: {
      events: { data: { id: 'e1', type: 'training' }, error: null },
      ...extra,
    },
  })
}

describe('updateTrainingstype — succes', () => {
  // BRONCONTRACT: de parameternamen moeten exact overeenkomen met
  // set_trainingstype in supabase/team-rls-gevolgacties.sql. Een hernoemde
  // parameter geeft bij PostgREST geen fout maar een NULL-waarde, dus dit moet
  // hard vastliggen. Er gaat GEEN events-update meer rechtstreeks de deur uit:
  // de events-policy blijft op 'agenda' en deze ene kolom loopt via de RPC.
  it('schrijft via set_trainingstype met exact de verwachte parameternamen, niet via een directe update', async () => {
    const m = eigenTraining()
    use(m)

    await updateTrainingstype('e1', 'teamtactisch')

    expect(m.calls.rpc).toEqual([
      { fn: 'set_trainingstype', args: { p_event_id: 'e1', p_trainingstype: 'teamtactisch' } },
    ])
    expect(m.calls.update.filter((u) => u.table === 'events')).toHaveLength(0)
  })

  it('zet ook terug naar vct', async () => {
    const m = eigenTraining()
    use(m)

    await updateTrainingstype('e1', 'vct')

    expect(m.calls.rpc[0].args.p_trainingstype).toBe('vct')
  })

  it('haalt het event team-gescoped op vóór het bijwerken', async () => {
    const m = eigenTraining()
    use(m)

    await updateTrainingstype('e1', 'teamtactisch')

    const eventsSelect = m.calls.select.find((s) => s.table === 'events')!
    expect(eventsSelect.eqs).toEqual([
      { col: 'id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('revalideert de plannerpagina en alle drie de pagina\'s die de telling tonen', async () => {
    use(eigenTraining())

    await updateTrainingstype('e1', 'teamtactisch')

    expect(revalidatePath).toHaveBeenCalledWith('/events/e1/training-plan')
    expect(revalidatePath).toHaveBeenCalledWith('/')
    expect(revalidatePath).toHaveBeenCalledWith('/periodisering')
    expect(revalidatePath).toHaveBeenCalledWith('/inzichten')
  })
})

describe('updateTrainingstype — weigeringen', () => {
  it('weigert zonder ingelogde gebruiker', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(updateTrainingstype('e1', 'vct')).rejects.toThrow('Niet ingelogd')
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een ongeldige waarde vóór enige query', async () => {
    const m = eigenTraining()
    use(m)

    await expect(updateTrainingstype('e1', 'onzin' as unknown as 'vct'))
      .rejects.toThrow('Ongeldig trainingstype')
    // De teamcontext (lib/team-context.ts) leest vóór élke action team_members
    // en de teamnaam uit settings. Die twee horen niet bij de action zelf; waar
    // het hier om gaat is dat er geen enkele INHOUDELIJKE query gedaan wordt.
    const zonderContext = m.calls.select.filter(
      (s) => s.table !== 'team_members' && s.table !== 'settings',
    )
    expect(zonderContext).toHaveLength(0)
    expect(m.calls.update).toHaveLength(0)
  })

  it('weigert een event van een ander team', async () => {
    const m = eigenTraining({ events: { data: null, error: null } })
    use(m)

    await expect(updateTrainingstype('vreemd', 'teamtactisch')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een event dat geen training is', async () => {
    const m = eigenTraining({ events: { data: { id: 'e1', type: 'match' }, error: null } })
    use(m)

    await expect(updateTrainingstype('e1', 'teamtactisch')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('geeft een generieke melding bij een onverwachte databasefout en lekt niets', async () => {
    const m = eigenTraining()
    m.supabase.rpc = async () => ({ data: null, error: { code: '40001', message: 'deadlock detected on events' } })
    use(m)

    await expect(updateTrainingstype('e1', 'teamtactisch')).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('events.updateTrainingstype')
    expect(logged()).toContain('40001')
    expect(logged()).not.toContain('deadlock detected')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  // ── Errcode-vertaling van de RPC (lib/errors.ts, rpcEventError) ──
  it('vertaalt 42501 uit set_trainingstype naar "Geen toegang", zonder log-ruis', async () => {
    const m = eigenTraining({}, { code: '42501', message: 'Geen toegang' })
    use(m)

    await expect(updateTrainingstype('e1', 'teamtactisch')).rejects.toThrow('Geen toegang')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('vertaalt P0002 uit set_trainingstype naar "Event niet gevonden"', async () => {
    const m = eigenTraining({}, { code: 'P0002', message: 'Event niet gevonden' })
    use(m)

    await expect(updateTrainingstype('e1', 'teamtactisch')).rejects.toThrow('Event niet gevonden')
  })

  it('weigert zonder trainingsrecht — vóór enige query of RPC', async () => {
    const m = eigenTraining({
      team_members: {
        data: [{ team_id: 'team-1', user_id: 'team-1', rol: 'assistent', mag_agenda_bewerken: true }],
        error: null,
      },
    })
    use(m)

    await expect(updateTrainingstype('e1', 'teamtactisch')).rejects.toThrow('Geen toegang')
    expect(m.calls.rpc).toHaveLength(0)
    expect(m.calls.update).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────
// updateGatherTime
// ────────────────────────────────────────────────

describe('updateGatherTime — succes', () => {
  // BRONCONTRACT: parameternamen exact gelijk aan set_gather_time in
  // supabase/team-rls-gevolgacties.sql — zie de toelichting bij
  // set_trainingstype hierboven.
  it('schrijft via set_gather_time met exact de verwachte parameternamen, niet via een directe update', async () => {
    const m = eigenTeam()
    use(m)

    await updateGatherTime('e1', '13:45')

    expect(m.calls.rpc).toEqual([
      { fn: 'set_gather_time', args: { p_event_id: 'e1', p_gather_time: '13:45' } },
    ])
    expect(m.calls.update.filter((u) => u.table === 'events')).toHaveLength(0)
  })

  it('wist de verzameltijd met null', async () => {
    const m = eigenTeam()
    use(m)

    await updateGatherTime('e1', null)

    expect(m.calls.rpc[0].args.p_gather_time).toBeNull()
  })

  it('behandelt een lege string als wissen, niet als ongeldige invoer', async () => {
    const m = eigenTeam()
    use(m)

    await updateGatherTime('e1', '')

    expect(m.calls.rpc[0].args.p_gather_time).toBeNull()
  })

  it('accepteert de randen van de dag', async () => {
    const m = eigenTeam()
    use(m)

    await updateGatherTime('e1', '00:00')
    await updateGatherTime('e1', '23:59')

    expect(m.calls.rpc.map((r) => r.args.p_gather_time)).toEqual(['00:00', '23:59'])
  })

  it('haalt het event team-gescoped op vóór het bijwerken', async () => {
    const m = eigenTeam()
    use(m)

    await updateGatherTime('e1', '13:45')

    const eventsSelect = m.calls.select.find((s) => s.table === 'events')!
    expect(eventsSelect.eqs).toEqual([
      { col: 'id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('revalideert de selectiepagina én de eventpagina', async () => {
    use(eigenTeam())

    await updateGatherTime('e1', '13:45')

    expect(revalidatePath).toHaveBeenCalledWith('/events/e1/squad')
    expect(revalidatePath).toHaveBeenCalledWith('/events/e1')
  })
})

describe('updateGatherTime — weigeringen', () => {
  it('weigert zonder ingelogde gebruiker', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(updateGatherTime('e1', '13:45')).rejects.toThrow('Niet ingelogd')
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een event van een ander team', async () => {
    const m = eigenTeam({ events: { data: null, error: null } })
    use(m)

    await expect(updateGatherTime('vreemd', '13:45')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een event dat geen wedstrijd is', async () => {
    const m = eigenTeam({ events: { data: { id: 'e1', type: 'training' }, error: null } })
    use(m)

    await expect(updateGatherTime('e1', '13:45')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('weigert een uur buiten het bereik', async () => {
    const m = eigenTeam()
    use(m)

    await expect(updateGatherTime('e1', '25:00')).rejects.toThrow('Ongeldig tijdstip')
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert tekst als tijdstip', async () => {
    const m = eigenTeam()
    use(m)

    await expect(updateGatherTime('e1', 'abc')).rejects.toThrow('Ongeldig tijdstip')
    expect(m.calls.update).toHaveLength(0)
  })

  it('weigert een tijd zonder leidende nullen', async () => {
    const m = eigenTeam()
    use(m)

    await expect(updateGatherTime('e1', '9:5')).rejects.toThrow('Ongeldig tijdstip')
    expect(m.calls.update).toHaveLength(0)
  })

  it('geeft een generieke melding bij een onverwachte databasefout en lekt niets', async () => {
    use(eigenTeam({}, { code: '40001', message: 'deadlock detected on events' }))

    await expect(updateGatherTime('e1', '13:45')).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('events.updateGatherTime')
    expect(logged()).toContain('40001')
    expect(logged()).not.toContain('deadlock detected')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  // ── Errcode-vertaling van de RPC (lib/errors.ts, rpcEventError) ──
  it('vertaalt 42501 uit set_gather_time naar "Geen toegang"', async () => {
    use(eigenTeam({}, { code: '42501', message: 'Geen toegang' }))

    await expect(updateGatherTime('e1', '13:45')).rejects.toThrow('Geen toegang')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('vertaalt P0002 uit set_gather_time naar "Event niet gevonden"', async () => {
    use(eigenTeam({}, { code: 'P0002', message: 'Event niet gevonden' }))

    await expect(updateGatherTime('e1', '13:45')).rejects.toThrow('Event niet gevonden')
  })

  it('weigert zonder wedstrijdrecht — vóór enige query of RPC', async () => {
    const m = eigenTeam({
      team_members: {
        data: [{ team_id: 'team-1', user_id: 'team-1', rol: 'assistent', mag_agenda_bewerken: true }],
        error: null,
      },
    })
    use(m)

    await expect(updateGatherTime('e1', '13:45')).rejects.toThrow('Geen toegang')
    expect(m.calls.rpc).toHaveLength(0)
    expect(m.calls.update).toHaveLength(0)
  })
})
