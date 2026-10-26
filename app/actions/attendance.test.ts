import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// getDefaultAttendance leest zelf de settings-tabel; hier vastgezet zodat deze
// tests alleen over attendance gaan (zelfde aanpak als app/actions/events.test.ts).
vi.mock('@/app/actions/settings', () => ({ getDefaultAttendance: vi.fn(async () => 'present') }))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { getDefaultAttendance } from '@/app/actions/settings'
import type { HerstelAfmeldperiode } from '@/lib/herstel'
import {
  herstelAfmeldperiode,
  markAbsentForPeriod,
  markAllPresent,
  revokeAbsencePeriod,
  saveLineup,
  updateAttendance,
} from '@/app/actions/attendance'

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
  // Per tabel meerdere opeenvolgende antwoorden, in volgorde van afhandeling.
  // Nodig voor revokeAbsencePeriod, dat absence_periods drie keer aanspreekt
  // (de periode zelf, de overige periodes, de delete) met verschillende vormen.
  queues?: Record<string, TableResult[]>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const queues = opts.queues ?? {}
  type Eq = { col: string; val: unknown }
  type In = { col: string; val: unknown }
  const calls = {
    select: [] as { table: string; eqs: Eq[]; ins?: In[] }[],
    insert: [] as { table: string; payload: unknown }[],
    upsert: [] as { table: string; payload: Record<string, unknown>; eqs: Eq[] }[],
    update: [] as { table: string; payload: Record<string, unknown>; eqs: Eq[]; ins: In[]; neqs: Eq[]; iss: Eq[] }[],
    delete: [] as { table: string; eqs: Eq[] }[],
    // Volgorde van schrijfacties, om te kunnen aantonen dat het herstellen vóór
    // het verwijderen van de periode gebeurt.
    sequence: [] as string[],
  }

  // Het resultaat wordt pas bij het awaiten gekozen, zodat een wachtrij per
  // aanroep opschuift. Bij een lege wachtrij blijft het laatste antwoord staan.
  function nextResult(table: string): TableResult {
    const queue = queues[table]
    if (queue && queue.length > 0) return queue.length === 1 ? queue[0] : queue.shift()!
    return tables[table] ?? (table === 'team_members' ? teamMembersFixture(user?.id) : { data: [], error: null })
  }

  function chain(table: string) {
    const eqs: Eq[] = []
    const ins: In[] = []
    // `.neq()` apart vastgelegd (niet in eqs, dat de tenant-check blijft):
    // markAllPresent slaat er de 'injured'-rijen mee over.
    const neqs: Eq[] = []
    // `.is()` (herstelAfmeldperiode: alleen rijen zonder herkomst) apart, net
    // als neqs, zodat eqs de tenant-check blijft.
    const iss: Eq[] = []
    const c: Record<string, unknown> = {}
    c.is = (col: string, val: unknown) => { iss.push({ col, val }); return c }
    c.select = () => { calls.select.push({ table, eqs, ins }); return c }
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    // Periodefilters van markAbsentForPeriod en de sortering van de
    // periodequery: alleen doorgeven, niet vastleggen — de eq-lijst blijft zo
    // de tenant-check.
    c.gte = () => c
    c.lte = () => c
    c.neq = (col: string, val: unknown) => { neqs.push({ col, val }); return c }
    c.order = () => c
    c.in = (col: string, val: unknown) => { ins.push({ col, val }); return c }
    c.insert = (payload: unknown) => {
      calls.insert.push({ table, payload })
      calls.sequence.push(`${table}.insert`)
      return c
    }
    c.upsert = (payload: Record<string, unknown>) => {
      calls.upsert.push({ table, payload, eqs })
      calls.sequence.push(`${table}.upsert`)
      return c
    }
    c.update = (payload: Record<string, unknown>) => {
      calls.update.push({ table, payload, eqs, ins, neqs, iss })
      calls.sequence.push(`${table}.update`)
      return c
    }
    c.delete = () => {
      calls.delete.push({ table, eqs })
      calls.sequence.push(`${table}.delete`)
      return c
    }
    c.maybeSingle = () => Promise.resolve(nextResult(table))
    c.single = () => Promise.resolve(nextResult(table))
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

// Standaard: eigen event e1 en twee eigen spelers.
function eigenTeam(extra: Record<string, TableResult> = {}) {
  return makeSupabase({
    tables: {
      events: { data: { id: 'e1' }, error: null },
      players: { data: [{ id: PLAYER_A }, { id: PLAYER_B }], error: null },
      lineups: { data: null, error: null },
      ...extra,
    },
  })
}

const PLAYER_A = '11111111-1111-4111-8111-111111111111'
const PLAYER_B = '22222222-2222-4222-8222-222222222222'
const VREEMDE_SPELER = '33333333-3333-4333-8333-333333333333'
const PERIOD_1 = '44444444-4444-4444-8444-444444444444'
const PERIOD_2 = '55555555-5555-4555-8555-555555555555'

function positie(playerId: string | null) {
  return { player_id: playerId, x: 50, y: 50, position_label: 'CM', position_number: 8 }
}

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

describe('updateAttendance', () => {
  it('schrijft de aanwezigheid team-gescoped weg', async () => {
    const m = eigenTeam()
    use(m)

    await updateAttendance('e1', PLAYER_A, 'present')

    const upsert = m.calls.upsert.find((u) => u.table === 'attendance')!
    expect(upsert.payload).toEqual({
      event_id: 'e1',
      player_id: PLAYER_A,
      status: 'present',
      team_id: 'team-1',
    })
  })

  it("accepteert 'injured' als status en schrijft hem ongewijzigd weg", async () => {
    const m = eigenTeam()
    use(m)

    await updateAttendance('e1', PLAYER_A, 'injured')

    const upsert = m.calls.upsert.find((u) => u.table === 'attendance')!
    expect(upsert.payload).toEqual({
      event_id: 'e1',
      player_id: PLAYER_A,
      status: 'injured',
      team_id: 'team-1',
    })
    // V7: een blessure op één event wijzigt de spelerstatus niet.
    expect(m.calls.update.filter((u) => u.table === 'players')).toHaveLength(0)
  })

  it("weigert 'bogus' met 'Ongeldige status'", async () => {
    const m = eigenTeam()
    use(m)

    await expect(updateAttendance('e1', PLAYER_A, 'bogus' as never)).rejects.toThrow('Ongeldige status')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('revalideert de eventpagina én de selectiepagina', async () => {
    use(eigenTeam())

    await updateAttendance('e1', PLAYER_A, 'absent')

    expect(revalidatePath).toHaveBeenCalledWith('/events/e1')
    expect(revalidatePath).toHaveBeenCalledWith('/events/e1/squad')
  })

  it('weigert een ongeldige status en revalideert dan niets', async () => {
    const m = eigenTeam()
    use(m)

    await expect(updateAttendance('e1', PLAYER_A, 'aanwezig' as never)).rejects.toThrow('Ongeldige status')
    expect(m.calls.upsert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een event van een ander team en revalideert dan niets', async () => {
    const m = eigenTeam({ events: { data: null, error: null } })
    use(m)

    await expect(updateAttendance('vreemd', PLAYER_A, 'present')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.upsert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('revalideert niet bij een databasefout', async () => {
    use(eigenTeam({ attendance: { data: null, error: { code: '42501', message: 'permission denied for table attendance' } } }))

    await expect(updateAttendance('e1', PLAYER_A, 'present')).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    use(makeSupabase({ user: null }))

    await expect(updateAttendance('e1', PLAYER_A, 'present')).rejects.toThrow('Niet ingelogd')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  // AC3 — een gastspeler handmatig op aanwezig zetten loopt exact dezelfde weg
  // als bij een reguliere speler: gastschap zit alleen in de AANMAAKregel, niet
  // hier. Deze test legt vast dat er geen type-afhankelijk pad ontstaat.
  it('zet ook een gastspeler handmatig op present, team-gescoped en zonder extra pad', async () => {
    const m = eigenTeam({ players: { data: { id: PLAYER_A, type: 'guest' }, error: null } })
    use(m)

    await updateAttendance('e1', PLAYER_A, 'present')

    const upsert = m.calls.upsert.find((u) => u.table === 'attendance')!
    expect(upsert.payload).toEqual({
      event_id: 'e1',
      player_id: PLAYER_A,
      status: 'present',
      team_id: 'team-1',
    })
    // Alleen de eigenaarschapscheck raakt players; geen extra type-query die de
    // handmatige keuze zou kunnen overrulen.
    expect(m.calls.select.filter((sel) => sel.table === 'players')).toHaveLength(1)
    expect(revalidatePath).toHaveBeenCalledWith('/events/e1')
  })
})

describe('markAbsentForPeriod', () => {
  // De events-select levert hier een lijst (geen maybeSingle), dus een eigen fixture.
  function periode(events: { id: string; type: string }[], extra: Record<string, TableResult> = {}) {
    return makeSupabase({
      tables: {
        events: { data: events, error: null },
        players: { data: [{ id: PLAYER_A }], error: null },
        absence_periods: { data: { id: PERIOD_1 }, error: null },
        ...extra,
      },
    })
  }

  it('haalt de events team-gescoped op en schrijft absent weg per event', async () => {
    const m = periode([{ id: 'e1', type: 'match' }, { id: 'e2', type: 'training' }])
    use(m)

    const res = await markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')

    expect(res).toEqual({ periodId: PERIOD_1, affected: 2 })
    const eventsSelect = m.calls.select.find((s) => s.table === 'events')!
    expect(eventsSelect.eqs).toEqual([{ col: 'team_id', val: 'team-1' }])
    const upsert = m.calls.upsert.find((u) => u.table === 'attendance')!
    expect(upsert.payload).toEqual([
      { event_id: 'e1', player_id: PLAYER_A, status: 'absent', team_id: 'team-1', absence_period_id: PERIOD_1 },
      { event_id: 'e2', player_id: PLAYER_A, status: 'absent', team_id: 'team-1', absence_period_id: PERIOD_1 },
    ])
  })

  it('legt de periode zelf vast, team- en spelergescoped', async () => {
    const m = periode([{ id: 'e1', type: 'match' }])
    use(m)

    await markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')

    const insert = m.calls.insert.find((i) => i.table === 'absence_periods')!
    expect(insert.payload).toEqual({
      team_id: 'team-1',
      player_id: PLAYER_A,
      from_date: '2026-08-01',
      to_date: '2026-08-31',
    })
  })

  it('legt de periode vast vóór de aanwezigheidsrijen', async () => {
    const m = periode([{ id: 'e1', type: 'match' }])
    use(m)

    await markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')

    expect(m.calls.sequence).toEqual(['absence_periods.insert', 'attendance.upsert'])
  })

  it('revalideert de afwezigheidspagina, de eventpagina én de selectiepagina van elk geraakt match-event', async () => {
    use(periode([{ id: 'e1', type: 'match' }, { id: 'e2', type: 'match' }]))

    await markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')

    expect(revalidatePath).toHaveBeenCalledWith(`/players/${PLAYER_A}/absence`)
    expect(revalidatePath).toHaveBeenCalledWith('/events/e1')
    expect(revalidatePath).toHaveBeenCalledWith('/events/e2')
    expect(revalidatePath).toHaveBeenCalledWith('/events/e1/squad')
    expect(revalidatePath).toHaveBeenCalledWith('/events/e2/squad')
  })

  it('revalideert wél de eventpagina maar geen selectiepagina voor een training (die heeft er geen)', async () => {
    use(periode([{ id: 'e1', type: 'training' }]))

    await markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')

    expect(revalidatePath).toHaveBeenCalledWith(`/players/${PLAYER_A}/absence`)
    expect(revalidatePath).toHaveBeenCalledWith('/events/e1')
    expect(revalidatePath).not.toHaveBeenCalledWith('/events/e1/squad')
  })

  it('revalideert een match-event maar één keer', async () => {
    use(periode([{ id: 'e1', type: 'match' }, { id: 'e1', type: 'match' }]))

    await markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')

    const squadCalls = vi.mocked(revalidatePath).mock.calls.filter(([p]) => p === '/events/e1/squad')
    expect(squadCalls).toHaveLength(1)
    const eventCalls = vi.mocked(revalidatePath).mock.calls.filter(([p]) => p === '/events/e1')
    expect(eventCalls).toHaveLength(1)
  })

  it('legt de periode ook vast zonder events erin, zonder aanwezigheidsrijen te schrijven', async () => {
    // De periode geldt voor alles wat er later nog bij komt, dus hij blijft
    // bestaan én de afwezigheidspagina moet hem meteen tonen.
    const m = periode([])
    use(m)

    expect(await markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31'))
      .toEqual({ periodId: PERIOD_1, affected: 0 })
    expect(m.calls.insert.filter((i) => i.table === 'absence_periods')).toHaveLength(1)
    expect(m.calls.upsert).toHaveLength(0)
    expect(revalidatePath).toHaveBeenCalledWith(`/players/${PLAYER_A}/absence`)
  })

  it('weigert een speler van een ander team: geen periode, geen revalidatie', async () => {
    const m = periode([{ id: 'e1', type: 'match' }], { players: { data: null, error: null } })
    use(m)

    await expect(markAbsentForPeriod(VREEMDE_SPELER, '2026-08-01', '2026-08-31'))
      .rejects.toThrow('Speler niet gevonden')
    expect(m.calls.insert).toHaveLength(0)
    expect(m.calls.upsert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert ongeldige of omgekeerde datums: geen periode, geen revalidatie', async () => {
    const m = periode([{ id: 'e1', type: 'match' }])
    use(m)

    await expect(markAbsentForPeriod(PLAYER_A, '01-08-2026', '2026-08-31')).rejects.toThrow('Ongeldige datum')
    await expect(markAbsentForPeriod(PLAYER_A, '2026-08-31', '2026-08-01'))
      .rejects.toThrow('Startdatum moet voor einddatum liggen')
    expect(m.calls.insert).toHaveLength(0)
    expect(m.calls.upsert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een datum die de kalender niet kent, niet alleen een verkeerde vorm', async () => {
    // 2026-02-30 heeft de juiste vorm maar bestaat niet; een pure regexcheck
    // liet die door en de database zou er pas over vallen (lib/season-dates.ts).
    const m = periode([{ id: 'e1', type: 'match' }])
    use(m)

    await expect(markAbsentForPeriod(PLAYER_A, '2026-02-30', '2026-03-05')).rejects.toThrow('Ongeldige datum')
    await expect(markAbsentForPeriod(PLAYER_A, '2026-03-01', '2026-13-01')).rejects.toThrow('Ongeldige datum')
    expect(m.calls.insert).toHaveLength(0)
    expect(m.calls.upsert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('draait de periode terug als de events-query faalt, in plaats van stil affected: 0 te melden', async () => {
    const m = periode([{ id: 'e1', type: 'match' }], {
      events: { data: null, error: { code: '42501', message: 'permission denied for table events' } },
    })
    use(m)

    await expect(markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    // Anders blijft er een periode staan die nooit op bestaande events is toegepast.
    const del = m.calls.delete.find((d) => d.table === 'absence_periods')!
    expect(del.eqs).toEqual([
      { col: 'id', val: PERIOD_1 },
      { col: 'team_id', val: 'team-1' },
    ])
    expect(m.calls.upsert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(logged()).toContain('attendance.markAbsentForPeriod.events')
    expect(logged()).not.toContain('permission denied')
  })

  it('revalideert niet bij een databasefout en draait de periode terug', async () => {
    // Eerste attendance-antwoord: de lookup van bestaande rijen slaagt (leeg).
    // Tweede: de upsert faalt.
    const m = makeSupabase({
      tables: {
        events: { data: [{ id: 'e1', type: 'match' }], error: null },
        players: { data: [{ id: PLAYER_A }], error: null },
        absence_periods: { data: { id: PERIOD_1 }, error: null },
      },
      queues: {
        attendance: [
          { data: [], error: null },
          { data: null, error: { code: '42501', message: 'permission denied for table attendance' } },
        ],
      },
    })
    use(m)

    await expect(markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    // Compenserende delete: geen periode zonder bijbehorende aanwezigheidsrijen.
    const del = m.calls.delete.find((d) => d.table === 'absence_periods')!
    expect(del.eqs).toEqual([
      { col: 'id', val: PERIOD_1 },
      { col: 'team_id', val: 'team-1' },
    ])
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(logged()).toContain('attendance.markAbsentForPeriod')
    expect(logged()).not.toContain('permission denied')
  })

  it('draait de periode terug als de lookup van bestaande rijen faalt, met een veilige melding', async () => {
    const m = periode([{ id: 'e1', type: 'match' }], {
      attendance: { data: null, error: { code: '42501', message: 'permission denied for table attendance' } },
    })
    use(m)

    await expect(markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    const del = m.calls.delete.find((d) => d.table === 'absence_periods')!
    expect(del.eqs).toEqual([
      { col: 'id', val: PERIOD_1 },
      { col: 'team_id', val: 'team-1' },
    ])
    // Zonder lookup géén upsert: anders zou een blessure op 'absent' belanden.
    expect(m.calls.upsert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(logged()).toContain('attendance.markAbsentForPeriod.existing')
    expect(logged()).not.toContain('permission denied')
  })

  it("laat een 'injured'-rij op injured staan en zet er alleen absence_period_id op (besluit 11)", async () => {
    const m = makeSupabase({
      tables: {
        events: { data: [{ id: 'e1', type: 'match' }, { id: 'e2', type: 'training' }], error: null },
        players: { data: [{ id: PLAYER_A }], error: null },
        absence_periods: { data: { id: PERIOD_1 }, error: null },
      },
      queues: {
        attendance: [
          { data: [{ event_id: 'e2', status: 'injured' }, { event_id: 'e1', status: 'present' }], error: null },
          { data: null, error: null },
        ],
      },
    })
    use(m)

    const res = await markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')

    // affected blijft het aantal events in de periode.
    expect(res).toEqual({ periodId: PERIOD_1, affected: 2 })

    // De lookup is team- en spelergescoped en begrensd op de events.
    const lookup = m.calls.select.find((s) => s.table === 'attendance')!
    expect(lookup.eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'player_id', val: PLAYER_A },
    ])
    expect(lookup.ins).toEqual([{ col: 'event_id', val: ['e1', 'e2'] }])

    // Alleen e1 krijgt de upsert naar absent.
    const upsert = m.calls.upsert.find((u) => u.table === 'attendance')!
    expect(upsert.payload).toEqual([
      { event_id: 'e1', player_id: PLAYER_A, status: 'absent', team_id: 'team-1', absence_period_id: PERIOD_1 },
    ])

    // e2 houdt 'injured' en krijgt alleen de herkomst.
    const update = m.calls.update.find((u) => u.table === 'attendance')!
    expect(update.payload).toEqual({ absence_period_id: PERIOD_1 })
    expect(update.payload).not.toHaveProperty('status')
    expect(update.eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'player_id', val: PLAYER_A },
      { col: 'status', val: 'injured' },
    ])
    expect(update.ins).toEqual([{ col: 'event_id', val: ['e2'] }])
  })

  it('schrijft geen upsert als elk event al injured is, alleen de herkomst', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: [{ id: 'e1', type: 'training' }], error: null },
        players: { data: [{ id: PLAYER_A }], error: null },
        absence_periods: { data: { id: PERIOD_1 }, error: null },
      },
      queues: {
        attendance: [
          { data: [{ event_id: 'e1', status: 'injured' }], error: null },
          { data: null, error: null },
        ],
      },
    })
    use(m)

    await markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')

    expect(m.calls.upsert).toHaveLength(0)
    expect(m.calls.update.filter((u) => u.table === 'attendance')).toHaveLength(1)
    expect(revalidatePath).toHaveBeenCalledWith('/events/e1')
  })

  it('na herstel (rij niet meer injured) wordt een nieuwe periode gewoon absent', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: [{ id: 'e1', type: 'training' }], error: null },
        players: { data: [{ id: PLAYER_A }], error: null },
        absence_periods: { data: { id: PERIOD_1 }, error: null },
      },
      queues: {
        attendance: [
          { data: [{ event_id: 'e1', status: 'present' }], error: null },
          { data: null, error: null },
        ],
      },
    })
    use(m)

    await markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')

    const upsert = m.calls.upsert.find((u) => u.table === 'attendance')!
    expect(upsert.payload).toEqual([
      { event_id: 'e1', player_id: PLAYER_A, status: 'absent', team_id: 'team-1', absence_period_id: PERIOD_1 },
    ])
    expect(m.calls.update.filter((u) => u.table === 'attendance')).toHaveLength(0)
  })

  it('draait de periode terug als het zetten van de herkomst op een injured-rij faalt', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: [{ id: 'e1', type: 'training' }], error: null },
        players: { data: [{ id: PLAYER_A }], error: null },
        absence_periods: { data: { id: PERIOD_1 }, error: null },
      },
      queues: {
        attendance: [
          { data: [{ event_id: 'e1', status: 'injured' }], error: null },
          { data: null, error: { code: '42501', message: 'permission denied for table attendance' } },
        ],
      },
    })
    use(m)

    await expect(markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(m.calls.delete.filter((d) => d.table === 'absence_periods')).toHaveLength(1)
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(logged()).toContain('attendance.markAbsentForPeriod.injured')
    expect(logged()).not.toContain('permission denied')
  })

  it('stopt als de periode zelf niet kan worden vastgelegd', async () => {
    const m = periode([{ id: 'e1', type: 'match' }], {
      absence_periods: { data: null, error: { code: '23514', message: 'violates check constraint "absence_periods_range"' } },
    })
    use(m)

    await expect(markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(m.calls.upsert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(logged()).toContain('attendance.markAbsentForPeriod.period')
    expect(logged()).not.toContain('check constraint')
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    use(makeSupabase({ user: null }))

    await expect(markAbsentForPeriod(PLAYER_A, '2026-08-01', '2026-08-31')).rejects.toThrow('Niet ingelogd')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('revokeAbsencePeriod', () => {
  const PERIODE_RIJ = {
    id: PERIOD_1,
    player_id: PLAYER_A,
    from_date: '2026-08-01',
    to_date: '2026-08-31',
  }

  // absence_periods wordt drie keer aangesproken: de periode zelf, de overige
  // periodes van dezelfde speler, en tot slot de delete.
  function intrekken(opts: {
    rows?: { event_id: string; status: string }[]
    events?: { id: string; date: string; type: string }[]
    others?: unknown[]
    periode?: unknown
    attendanceError?: unknown
    // Het type van de speler achter de periode: bepaalt de status waarnaar de
    // rijen worden teruggezet (een gast blijft afwezig).
    player?: unknown
  } = {}) {
    return makeSupabase({
      tables: {
        attendance: { data: opts.rows ?? [], error: opts.attendanceError ?? null },
        events: { data: opts.events ?? [], error: null },
        players: {
          data: opts.player === undefined ? { id: PLAYER_A, type: 'regular' } : opts.player,
          error: null,
        },
      },
      queues: {
        absence_periods: [
          { data: opts.periode === undefined ? PERIODE_RIJ : opts.periode, error: null },
          { data: opts.others ?? [], error: null },
          { data: null, error: null },
        ],
      },
    })
  }

  it('zet de door deze periode gezette rijen terug naar de standaardstatus', async () => {
    const m = intrekken({
      rows: [
        { event_id: 'e1', status: 'absent' },
        { event_id: 'e2', status: 'absent' },
      ],
      events: [
        { id: 'e1', date: '2026-08-05', type: 'match' },
        { id: 'e2', date: '2026-08-06', type: 'training' },
      ],
    })
    use(m)

    expect(await revokeAbsencePeriod(PERIOD_1)).toMatchObject({ restored: 2 })

    const update = m.calls.update.find((u) => u.table === 'attendance')!
    expect(update.payload).toEqual({ status: 'present', absence_period_id: null })
    expect(update.eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'absence_period_id', val: PERIOD_1 },
    ])
    expect(update.ins).toEqual([{ col: 'event_id', val: ['e1', 'e2'] }])
  })

  it('gebruikt de ingestelde standaardstatus van het team', async () => {
    vi.mocked(getDefaultAttendance).mockResolvedValueOnce('unknown')
    const m = intrekken({
      rows: [{ event_id: 'e1', status: 'absent' }],
      events: [{ id: 'e1', date: '2026-08-05', type: 'training' }],
    })
    use(m)

    await revokeAbsencePeriod(PERIOD_1)

    expect(m.calls.update.find((u) => u.table === 'attendance')!.payload)
      .toEqual({ status: 'unknown', absence_period_id: null })
  })

  it('haalt alleen de rijen op die déze periode zette, team-gescoped', async () => {
    // Handmatige of door-blessure-gezette rijen hebben absence_period_id = null
    // en vallen daarmee per constructie buiten deze query.
    const m = intrekken({ rows: [], events: [] })
    use(m)

    await revokeAbsencePeriod(PERIOD_1)

    const rowsSelect = m.calls.select.find((s) => s.table === 'attendance')!
    expect(rowsSelect.eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'absence_period_id', val: PERIOD_1 },
    ])
  })

  it('verwijdert de periode team-gescoped, pas ná het herstellen', async () => {
    const m = intrekken({
      rows: [{ event_id: 'e1', status: 'absent' }],
      events: [{ id: 'e1', date: '2026-08-05', type: 'training' }],
    })
    use(m)

    await revokeAbsencePeriod(PERIOD_1)

    // Andersom zou ON DELETE SET NULL de herkomst wissen vóór het herstel en
    // blijven de rijen onherstelbaar op 'absent' staan.
    expect(m.calls.sequence).toEqual(['attendance.update', 'absence_periods.delete'])
    expect(m.calls.delete.find((d) => d.table === 'absence_periods')!.eqs).toEqual([
      { col: 'id', val: PERIOD_1 },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('draagt rijen die nog door een andere periode gedekt zijn over in plaats van terug te zetten', async () => {
    const m = intrekken({
      rows: [
        { event_id: 'e1', status: 'absent' },
        { event_id: 'e2', status: 'absent' },
      ],
      events: [
        { id: 'e1', date: '2026-08-05', type: 'training' }, // valt óók in P2
        { id: 'e2', date: '2026-08-25', type: 'training' }, // valt buiten P2
      ],
      others: [{ id: PERIOD_2, player_id: PLAYER_A, from_date: '2026-08-01', to_date: '2026-08-10' }],
    })
    use(m)

    expect(await revokeAbsencePeriod(PERIOD_1)).toMatchObject({ restored: 1 })

    const updates = m.calls.update.filter((u) => u.table === 'attendance')
    expect(updates).toHaveLength(2)
    expect(updates[0].payload).toEqual({ absence_period_id: PERIOD_2 })
    expect(updates[0].ins).toEqual([{ col: 'event_id', val: ['e1'] }])
    expect(updates[1].payload).toEqual({ status: 'present', absence_period_id: null })
    expect(updates[1].ins).toEqual([{ col: 'event_id', val: ['e2'] }])
  })

  it('zoekt de overige periodes van dezelfde speler team-gescoped op', async () => {
    const m = intrekken({
      rows: [{ event_id: 'e1', status: 'absent' }],
      events: [{ id: 'e1', date: '2026-08-05', type: 'training' }],
    })
    use(m)

    await revokeAbsencePeriod(PERIOD_1)

    const periodSelects = m.calls.select.filter((s) => s.table === 'absence_periods')
    expect(periodSelects[1].eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'player_id', val: PLAYER_A },
    ])
  })

  it('laat een injured-rij op injured staan en wist alleen de herkomst', async () => {
    const m = intrekken({
      rows: [{ event_id: 'e1', status: 'injured' }],
      events: [{ id: 'e1', date: '2026-08-05', type: 'training' }],
    })
    use(m)

    expect(await revokeAbsencePeriod(PERIOD_1)).toMatchObject({ restored: 0 })

    const update = m.calls.update.find((u) => u.table === 'attendance')!
    expect(update.payload).toEqual({ absence_period_id: null })
    expect(update.payload).not.toHaveProperty('status')
  })

  it('laat een handmatig op present gezette rij staan en wist alleen de herkomst', async () => {
    // updateAttendance laat absence_period_id ongemoeid, dus zo'n rij hangt nog
    // aan de periode terwijl de coach hem bewust heeft overruled. Terugzetten
    // naar de standaardstatus zou die keuze ongedaan maken.
    const m = intrekken({
      rows: [{ event_id: 'e1', status: 'present' }],
      events: [{ id: 'e1', date: '2026-08-05', type: 'training' }],
    })
    use(m)

    expect(await revokeAbsencePeriod(PERIOD_1)).toMatchObject({ restored: 0 })

    const update = m.calls.update.find((u) => u.table === 'attendance')!
    expect(update.payload).toEqual({ absence_period_id: null })
    expect(update.payload).not.toHaveProperty('status')
  })

  it('laat ook een handmatig op unknown gezette rij staan: alles wat niet meer absent is, is al overruled', async () => {
    // De standaardstatus is hier 'present'; zonder deze uitzondering zou een
    // bewust op 'unknown' gezette rij bij het intrekken naar 'present' springen.
    const m = intrekken({
      rows: [{ event_id: 'e1', status: 'unknown' }],
      events: [{ id: 'e1', date: '2026-08-05', type: 'training' }],
    })
    use(m)

    expect(await revokeAbsencePeriod(PERIOD_1)).toMatchObject({ restored: 0 })

    const update = m.calls.update.find((u) => u.table === 'attendance')!
    expect(update.payload).toEqual({ absence_period_id: null })
    expect(update.payload).not.toHaveProperty('status')
  })

  it('zet alleen de rijen terug die nog echt absent zijn', async () => {
    const m = intrekken({
      rows: [
        { event_id: 'e1', status: 'absent' },
        { event_id: 'e2', status: 'present' },
        { event_id: 'e3', status: 'unknown' },
      ],
      events: [
        { id: 'e1', date: '2026-08-05', type: 'training' },
        { id: 'e2', date: '2026-08-06', type: 'training' },
        { id: 'e3', date: '2026-08-07', type: 'training' },
      ],
    })
    use(m)

    expect(await revokeAbsencePeriod(PERIOD_1)).toMatchObject({ restored: 1 })

    const updates = m.calls.update.filter((u) => u.table === 'attendance')
    expect(updates).toHaveLength(2)
    // Eerst de overruled rijen (alleen de herkomst wissen), dan het echte herstel.
    expect(updates[0].payload).toEqual({ absence_period_id: null })
    expect(updates[0].ins).toEqual([{ col: 'event_id', val: ['e2', 'e3'] }])
    expect(updates[1].payload).toEqual({ status: 'present', absence_period_id: null })
    expect(updates[1].ins).toEqual([{ col: 'event_id', val: ['e1'] }])
  })

  it('herstelt ook verstreken events', async () => {
    // Bewust anders dan markRecovered(), dat alleen toekomstige events aanraakt:
    // een periode intrekken betekent "dit is nooit gebeurd".
    const m = intrekken({
      rows: [{ event_id: 'oud', status: 'absent' }],
      events: [{ id: 'oud', date: '2020-01-01', type: 'training' }],
    })
    use(m)

    expect(await revokeAbsencePeriod(PERIOD_1)).toMatchObject({ restored: 1 })
    expect(m.calls.update.find((u) => u.table === 'attendance')!.ins)
      .toEqual([{ col: 'event_id', val: ['oud'] }])
  })

  it('revalideert de afwezigheidspagina, de eventpagina van elk geraakt event en de selectiepagina van elk match-event', async () => {
    use(intrekken({
      rows: [
        { event_id: 'e1', status: 'absent' },
        { event_id: 'e2', status: 'absent' },
      ],
      events: [
        { id: 'e1', date: '2026-08-05', type: 'match' },
        { id: 'e2', date: '2026-08-06', type: 'training' },
      ],
    }))

    await revokeAbsencePeriod(PERIOD_1)

    expect(revalidatePath).toHaveBeenCalledWith(`/players/${PLAYER_A}/absence`)
    expect(revalidatePath).toHaveBeenCalledWith('/events/e1')
    expect(revalidatePath).toHaveBeenCalledWith('/events/e2')
    expect(revalidatePath).toHaveBeenCalledWith('/events/e1/squad')
    expect(revalidatePath).not.toHaveBeenCalledWith('/events/e2/squad')
  })

  it('verwijdert een periode zonder aanwezigheidsrijen zonder iets bij te werken', async () => {
    const m = intrekken({ rows: [], events: [] })
    use(m)

    expect(await revokeAbsencePeriod(PERIOD_1)).toMatchObject({ restored: 0 })
    expect(m.calls.update).toHaveLength(0)
    expect(m.calls.delete).toHaveLength(1)
    expect(revalidatePath).toHaveBeenCalledWith(`/players/${PLAYER_A}/absence`)
  })

  it('weigert een onbekende periode', async () => {
    const m = intrekken({ periode: null })
    use(m)

    await expect(revokeAbsencePeriod(PERIOD_1)).rejects.toThrow('Periode niet gevonden')
    expect(m.calls.update).toHaveLength(0)
    expect(m.calls.delete).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een periode van een ander team met dezelfde melding', async () => {
    // De .eq('team_id')-filter levert dan niets op; de melding verraadt niet of
    // de periode bestaat.
    const m = intrekken({ periode: null })
    use(m)

    await expect(revokeAbsencePeriod(PERIOD_2)).rejects.toThrow('Periode niet gevonden')
    const lookup = m.calls.select.find((s) => s.table === 'absence_periods')!
    expect(lookup.eqs).toEqual([
      { col: 'id', val: PERIOD_2 },
      { col: 'team_id', val: 'team-1' },
    ])
    expect(m.calls.delete).toHaveLength(0)
  })

  it('weigert een id dat geen UUID is, zonder query', async () => {
    const m = intrekken()
    use(m)

    await expect(revokeAbsencePeriod('niet-een-uuid')).rejects.toThrow('Periode niet gevonden')
    // De teamcontext (lib/team-context.ts) leest vóór élke action team_members
    // en de teamnaam uit settings. Die twee horen niet bij de action zelf; waar
    // het hier om gaat is dat er geen enkele INHOUDELIJKE query gedaan wordt.
    const zonderContext = m.calls.select.filter(
      (s) => s.table !== 'team_members' && s.table !== 'settings',
    )
    expect(zonderContext).toHaveLength(0)
    expect(m.calls.update).toHaveLength(0)
    expect(m.calls.delete).toHaveLength(0)
  })

  it('geeft een generieke melding bij een databasefout en lekt niets', async () => {
    const m = intrekken({
      attendanceError: { code: '42501', message: 'permission denied for table attendance' },
    })
    use(m)

    await expect(revokeAbsencePeriod(PERIOD_1)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('attendance.revokeAbsencePeriod.rows')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
    expect(m.calls.delete).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    use(makeSupabase({ user: null }))

    await expect(revokeAbsencePeriod(PERIOD_1)).rejects.toThrow('Niet ingelogd')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

// O2 — een gastspeler blijft afwezig, ook nadat zijn afmeldperiode is
// ingetrokken. Dezelfde regel als bij het aanmaken van een rij
// (lib/attendance-rows.ts), hier hergebruikt.
describe('revokeAbsencePeriod — herstel-snapshot', () => {
  it('geeft periode, created_at en de verdeling naarStandaard/alleenHerkomst terug; overgedragen rijen niet', async () => {
    const m = makeSupabase({
      tables: {
        attendance: {
          data: [
            { event_id: 'e1', status: 'absent' },  // → standaard
            { event_id: 'e2', status: 'present' }, // → alleen herkomst
            { event_id: 'e3', status: 'absent' },  // → overgedragen aan P2
          ],
          error: null,
        },
        events: {
          data: [
            { id: 'e1', date: '2026-08-20', type: 'training' },
            { id: 'e2', date: '2026-08-21', type: 'training' },
            { id: 'e3', date: '2026-08-05', type: 'training' },
          ],
          error: null,
        },
        players: { data: { id: PLAYER_A, type: 'regular' }, error: null },
      },
      queues: {
        absence_periods: [
          { data: { id: PERIOD_1, player_id: PLAYER_A, from_date: '2026-08-01', to_date: '2026-08-31', created_at: '2026-07-30T09:00:00+00:00' } },
          { data: [{ id: PERIOD_2, player_id: PLAYER_A, from_date: '2026-08-01', to_date: '2026-08-10' }] },
          { data: null, error: null },
        ],
      },
    })
    use(m)

    const res = await revokeAbsencePeriod(PERIOD_1)
    expect(res).toEqual({
      restored: 1,
      herstel: {
        soort: 'afmeldperiode',
        teamId: 'team-1',
        id: PERIOD_1,
        playerId: PLAYER_A,
        fromDate: '2026-08-01',
        toDate: '2026-08-31',
        createdAt: '2026-07-30T09:00:00+00:00',
        naarStandaardEventIds: ['e1'],
        alleenHerkomstEventIds: ['e2'],
      },
    })
  })

  it('levert lege lijsten bij een periode zonder aanwezigheidsrijen', async () => {
    const m = makeSupabase({
      tables: { attendance: { data: [], error: null } },
      queues: {
        absence_periods: [
          { data: { id: PERIOD_1, player_id: PLAYER_A, from_date: '2026-08-01', to_date: '2026-08-31' } },
          { data: null, error: null },
        ],
      },
    })
    use(m)
    const { herstel } = await revokeAbsencePeriod(PERIOD_1)
    expect(herstel.naarStandaardEventIds).toEqual([])
    expect(herstel.alleenHerkomstEventIds).toEqual([])
    expect(herstel.createdAt).toBeNull()
  })
})

describe('herstelAfmeldperiode', () => {
  const EV1 = '0e000000-0000-4000-8000-000000000001'
  const EV2 = '0e000000-0000-4000-8000-000000000002'
  const SNAPSHOT: HerstelAfmeldperiode = {
    soort: 'afmeldperiode',
    teamId: 'team-1',
    id: PERIOD_1,
    playerId: PLAYER_A,
    fromDate: '2026-08-01',
    toDate: '2026-08-31',
    createdAt: '2026-07-30T09:00:00+00:00',
    naarStandaardEventIds: [EV1],
    alleenHerkomstEventIds: [EV2],
  }

  // absence_periods: bestaat-check, insert, (evt. hercontrole / compensatie-delete).
  function teHerstellen(opts: {
    periodes?: TableResult[]
    attendance?: TableResult[]
    player?: TableResult
  } = {}) {
    return makeSupabase({
      tables: { players: opts.player ?? { data: { id: PLAYER_A, type: 'regular' }, error: null } },
      queues: {
        absence_periods: opts.periodes ?? [{ data: null }, { error: null }],
        attendance: opts.attendance ?? [{ error: null }],
      },
    })
  }

  it('zet de periode terug met originele id/created_at en team_id uit de sessie', async () => {
    const m = teHerstellen()
    use(m)
    await herstelAfmeldperiode(SNAPSHOT)
    expect(m.calls.insert).toEqual([{
      table: 'absence_periods',
      payload: {
        id: PERIOD_1,
        team_id: 'team-1',
        player_id: PLAYER_A,
        from_date: '2026-08-01',
        to_date: '2026-08-31',
        created_at: '2026-07-30T09:00:00+00:00',
      },
    }])
  })

  it('zet naarStandaard-rijen weer op absent met herkomst, alleen als ze nog zonder herkomst op de standaard staan', async () => {
    const m = teHerstellen()
    use(m)
    await herstelAfmeldperiode(SNAPSHOT)
    const updates = m.calls.update.filter((u) => u.table === 'attendance')
    expect(updates).toHaveLength(2)
    expect(updates[0].payload).toEqual({ status: 'absent', absence_period_id: PERIOD_1 })
    expect(updates[0].eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'player_id', val: PLAYER_A },
      { col: 'status', val: 'present' },
    ])
    expect(updates[0].iss).toEqual([{ col: 'absence_period_id', val: null }])
    expect(updates[0].ins).toEqual([{ col: 'event_id', val: [EV1] }])
  })

  it('geeft alleenHerkomst-rijen alleen hun herkomst terug, status blijft', async () => {
    const m = teHerstellen()
    use(m)
    await herstelAfmeldperiode(SNAPSHOT)
    const update = m.calls.update.filter((u) => u.table === 'attendance')[1]
    expect(update.payload).toEqual({ absence_period_id: PERIOD_1 })
    expect(update.eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'player_id', val: PLAYER_A },
    ])
    expect(update.iss).toEqual([{ col: 'absence_period_id', val: null }])
    expect(update.ins).toEqual([{ col: 'event_id', val: [EV2] }])
  })

  it('gebruikt voor een gastspeler zijn eigen standaardstatus (absent) als filter', async () => {
    const m = teHerstellen({ player: { data: { id: PLAYER_A, type: 'guest' }, error: null } })
    use(m)
    await herstelAfmeldperiode(SNAPSHOT)
    const update = m.calls.update.filter((u) => u.table === 'attendance')[0]
    expect(update.eqs).toContainEqual({ col: 'status', val: 'absent' })
  })

  it('revalideert het afmeldscherm en elk geraakt event', async () => {
    use(teHerstellen())
    await herstelAfmeldperiode(SNAPSHOT)
    expect(revalidatePath).toHaveBeenCalledWith(`/players/${PLAYER_A}/absence`)
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EV1}`)
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EV2}`)
  })

  it('is idempotent: een periode die al terug is levert geen insert of update op', async () => {
    const m = teHerstellen({ periodes: [{ data: { id: PERIOD_1 } }] })
    use(m)
    await herstelAfmeldperiode(SNAPSHOT)
    expect(m.calls.insert).toHaveLength(0)
    expect(m.calls.update).toHaveLength(0)
  })

  it('23505 en de periode staat er in dit team → succes; zonder eigen rij → "Herstel niet mogelijk"', async () => {
    use(teHerstellen({ periodes: [{ data: null }, { error: { code: '23505' } }, { data: { id: PERIOD_1 } }] }))
    await expect(herstelAfmeldperiode(SNAPSHOT)).resolves.toBeUndefined()

    const m = teHerstellen({ periodes: [{ data: null }, { error: { code: '23505' } }, { data: null }] })
    use(m)
    await expect(herstelAfmeldperiode(SNAPSHOT)).rejects.toThrow('Herstel niet mogelijk')
    expect(m.calls.update).toHaveLength(0)
  })

  it('compenseert bij een fout halverwege: bijgewerkte rijen terug, periode weg, generieke melding', async () => {
    const m = teHerstellen({
      periodes: [{ data: null }, { error: null }, { data: null, error: null }],
      attendance: [
        { error: null },                                        // naarStandaard lukt
        { error: { code: '57014', message: 'canceling statement' } }, // alleenHerkomst faalt
        { error: null },                                        // compensatie
      ],
    })
    use(m)
    await expect(herstelAfmeldperiode(SNAPSHOT)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    const updates = m.calls.update.filter((u) => u.table === 'attendance')
    expect(updates[2].payload).toEqual({ status: 'present', absence_period_id: null })
    expect(updates[2].eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'player_id', val: PLAYER_A },
      { col: 'absence_period_id', val: PERIOD_1 },
    ])
    expect(updates[2].ins).toEqual([{ col: 'event_id', val: [EV1] }])
    expect(m.calls.delete).toEqual([{
      table: 'absence_periods',
      eqs: [{ col: 'id', val: PERIOD_1 }, { col: 'team_id', val: 'team-1' }],
    }])
    expect(logged()).toContain('attendance.herstelAfmeldperiode.herkomst')
    expect(logged()).not.toContain('canceling statement')
  })

  it('weigert een snapshot van een ander team, zonder iets te schrijven', async () => {
    const m = teHerstellen()
    use(m)
    await expect(herstelAfmeldperiode({ ...SNAPSHOT, teamId: 'ander-team' })).rejects.toThrow('Herstel niet mogelijk')
    expect(m.calls.insert).toHaveLength(0)
    expect(m.calls.update).toHaveLength(0)
  })

  it('weigert vervalste velden zonder query of schrijfactie', async () => {
    const m = teHerstellen()
    use(m)
    for (const fout of [
      { ...SNAPSHOT, id: 'p1' },
      { ...SNAPSHOT, playerId: 'speler' },
      { ...SNAPSHOT, fromDate: '2026-02-30' },
      { ...SNAPSHOT, fromDate: '2026-09-01' }, // na toDate
      { ...SNAPSHOT, createdAt: 'nu' },
      { ...SNAPSHOT, naarStandaardEventIds: ['e1'] },
      { ...SNAPSHOT, alleenHerkomstEventIds: 'e1' as never },
      { ...SNAPSHOT, naarStandaardEventIds: Array.from({ length: 501 }, () => EV1) },
    ]) {
      await expect(herstelAfmeldperiode(fout)).rejects.toThrow('Herstel niet mogelijk')
    }
    expect(m.calls.select.filter((x) => x.table === 'absence_periods')).toHaveLength(0)
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert een speler die niet (meer) van dit team is', async () => {
    const m = teHerstellen({ player: { data: null, error: null } })
    use(m)
    await expect(herstelAfmeldperiode(SNAPSHOT)).rejects.toThrow('Herstel niet mogelijk')
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert zonder Aanwezigheid-recht met "Geen toegang"', async () => {
    const m = makeSupabase({
      tables: { team_members: { data: [{ team_id: 'team-1', user_id: 'team-1', rol: 'assistent' }], error: null } },
    })
    use(m)
    await expect(herstelAfmeldperiode(SNAPSHOT)).rejects.toThrow('Geen toegang')
    expect(m.calls.insert).toHaveLength(0)
  })
})

describe('revokeAbsencePeriod — gastspeler', () => {
  const PERIODE_RIJ = {
    id: PERIOD_1,
    player_id: PLAYER_A,
    from_date: '2026-08-01',
    to_date: '2026-08-31',
  }

  function intrekkenVoor(playerType: string) {
    return makeSupabase({
      tables: {
        attendance: {
          data: [
            { event_id: 'e1', status: 'absent' },
            { event_id: 'e2', status: 'absent' },
          ],
          error: null,
        },
        events: {
          data: [
            { id: 'e1', date: '2026-08-05', type: 'match' },
            { id: 'e2', date: '2026-08-06', type: 'training' },
          ],
          error: null,
        },
        players: { data: { id: PLAYER_A, type: playerType }, error: null },
      },
      queues: {
        absence_periods: [
          { data: PERIODE_RIJ, error: null },
          { data: [], error: null },
          { data: null, error: null },
        ],
      },
    })
  }

  it('laat de rijen van een GAST op absent staan en wist alleen de herkomst', async () => {
    const m = intrekkenVoor('guest')
    use(m)

    await revokeAbsencePeriod(PERIOD_1)

    expect(m.calls.update.find((u) => u.table === 'attendance')!.payload)
      .toEqual({ status: 'absent', absence_period_id: null })
  })

  it('zet de rijen van een REGULIERE speler wél terug naar de teamstandaard', async () => {
    const m = intrekkenVoor('regular')
    use(m)

    await revokeAbsencePeriod(PERIOD_1)

    expect(m.calls.update.find((u) => u.table === 'attendance')!.payload)
      .toEqual({ status: 'present', absence_period_id: null })
  })

  it('haalt het spelertype team-gescoped op', async () => {
    const m = intrekkenVoor('guest')
    use(m)

    await revokeAbsencePeriod(PERIOD_1)

    const playerSelect = m.calls.select.find((s) => s.table === 'players')!
    expect(playerSelect.eqs).toEqual([
      { col: 'id', val: PLAYER_A },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('houdt de update begrensd tot precies deze periode, ook voor een gast', async () => {
    const m = intrekkenVoor('guest')
    use(m)

    const update = (await revokeAbsencePeriod(PERIOD_1), m.calls.update.find((u) => u.table === 'attendance')!)
    expect(update.eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'absence_period_id', val: PERIOD_1 },
    ])
  })
})

describe('markAllPresent', () => {
  it('werkt alleen de rijen van het eigen team bij', async () => {
    const m = eigenTeam()
    use(m)

    await markAllPresent('e1')

    const update = m.calls.update.find((u) => u.table === 'attendance')!
    expect(update.payload).toEqual({ status: 'present' })
    expect(update.eqs).toEqual([
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it("slaat 'injured'-rijen over (V3): alleen niet-geblesseerde rijen worden present", async () => {
    const m = eigenTeam()
    use(m)

    await markAllPresent('e1')

    const update = m.calls.update.find((u) => u.table === 'attendance')!
    expect(update.neqs).toEqual([{ col: 'status', val: 'injured' }])
  })

  it('revalideert de eventpagina én de selectiepagina', async () => {
    use(eigenTeam())

    await markAllPresent('e1')

    expect(revalidatePath).toHaveBeenCalledWith('/events/e1')
    expect(revalidatePath).toHaveBeenCalledWith('/events/e1/squad')
  })

  it('revalideert niet bij een databasefout', async () => {
    use(eigenTeam({ attendance: { data: null, error: { code: '42501', message: 'permission denied for table attendance' } } }))

    await expect(markAllPresent('e1')).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    use(makeSupabase({ user: null }))

    await expect(markAllPresent('e1')).rejects.toThrow('Niet ingelogd')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('saveLineup', () => {
  it('slaat eigen spelers op, team-gescoped', async () => {
    const m = eigenTeam()
    use(m)

    await saveLineup('e1', '4-3-3', [positie(PLAYER_A), positie(null)])

    const upsert = m.calls.upsert.find((u) => u.table === 'lineups')!
    expect(upsert.payload.team_id).toBe('team-1')
    expect(upsert.payload.event_id).toBe('e1')
    expect(upsert.payload.positions).toEqual([
      { player_id: PLAYER_A, x: 50, y: 50, position_label: 'CM', position_number: 8 },
      { player_id: null, x: 50, y: 50, position_label: 'CM', position_number: 8 },
    ])
  })

  it('haalt de spelerslijst team-gescoped op', async () => {
    const m = eigenTeam()
    use(m)

    await saveLineup('e1', '4-3-3', [positie(PLAYER_A)])

    const playersSelect = m.calls.select.find((s) => s.table === 'players')!
    expect(playersSelect.eqs).toEqual([{ col: 'team_id', val: 'team-1' }])
  })

  it('weigert een player_id van een ander team', async () => {
    const m = eigenTeam()
    use(m)

    await expect(saveLineup('e1', '4-3-3', [positie(VREEMDE_SPELER)]))
      .rejects.toThrow('Speler niet gevonden')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('weigert een player_id dat geen UUID is', async () => {
    const m = eigenTeam()
    use(m)

    await expect(saveLineup('e1', '4-3-3', [positie('niet-een-uuid')]))
      .rejects.toThrow('Ongeldige speler')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('weigert een absurd lange player_id (geen ongelimiteerde JSONB-waarde)', async () => {
    const m = eigenTeam()
    use(m)

    await expect(saveLineup('e1', '4-3-3', [positie('x'.repeat(100_000))]))
      .rejects.toThrow('Ongeldige speler')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('weigert een opstelling voor een event van een ander team', async () => {
    const m = eigenTeam({ events: { data: null, error: null } })
    use(m)

    await expect(saveLineup('vreemd', '4-3-3', [positie(PLAYER_A)]))
      .rejects.toThrow('Event niet gevonden')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('houdt de bestaande grenzen op formatie en aantal posities aan', async () => {
    use(eigenTeam())

    await expect(saveLineup('e1', 'x'.repeat(21), [])).rejects.toThrow('Ongeldige formatie')
    await expect(saveLineup('e1', '4-3-3', Array.from({ length: 31 }, () => positie(null))))
      .rejects.toThrow('Ongeldige opstelling')
  })

  it('normaliseert coördinaten, label en rugnummer', async () => {
    const m = eigenTeam()
    use(m)

    await saveLineup('e1', '4-3-3', [{
      player_id: PLAYER_B,
      x: 999,
      y: -20,
      position_label: 'een-veel-te-lang-label',
      position_number: 1.5,
    }])

    const upsert = m.calls.upsert.find((u) => u.table === 'lineups')!
    expect(upsert.payload.positions).toEqual([{
      player_id: PLAYER_B,
      x: 100,
      y: 0,
      position_label: 'een-veel-t',
      position_number: undefined,
    }])
  })

  it('geeft een generieke melding bij een databasefout', async () => {
    use(eigenTeam({ lineups: { data: null, error: { code: '42501', message: 'permission denied for table lineups' } } }))

    await expect(saveLineup('e1', '4-3-3', [positie(PLAYER_A)])).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    const logged = consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
    expect(logged).toContain('attendance.saveLineup')
    expect(logged).not.toContain('permission denied')
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    use(makeSupabase({ user: null }))

    await expect(saveLineup('e1', '4-3-3', [])).rejects.toThrow('Niet ingelogd')
  })
})
