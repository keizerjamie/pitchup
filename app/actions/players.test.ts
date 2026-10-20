import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// getDefaultAttendance leest zelf de settings-tabel; hier vastgezet zodat deze
// tests alleen over players gaan (zelfde aanpak als app/actions/events.test.ts).
vi.mock('@/app/actions/settings', () => ({ getDefaultAttendance: vi.fn(async () => 'present') }))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { createPlayer, deletePlayer, markInjured, markRecovered, updatePlayer } from '@/app/actions/players'

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
  // Uitkomst per UPDATE-aanroep op een tabel, in volgorde. Zo kan een test de
  // tweede attendance-update laten falen terwijl de eerste slaagt. Ontbreekt
  // een positie, dan geldt het gewone tabelresultaat.
  updateResults?: Record<string, TableResult[]>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const updateResults = opts.updateResults ?? {}
  const updateCount: Record<string, number> = {}
  type Filter = { op: string; col: string; val: unknown }
  const calls = {
    select: [] as { table: string; filters: Filter[] }[],
    insert: [] as { table: string; payload: unknown }[],
    update: [] as { table: string; payload: Record<string, unknown>; filters: Filter[] }[],
    upsert: [] as { table: string; payload: unknown }[],
  }

  function chain(table: string) {
    let result = tables[table] ?? (table === 'team_members' ? teamMembersFixture(user?.id) : { data: [], error: null })
    const filters: Filter[] = []
    const c: Record<string, unknown> = {}
    c.select = () => { calls.select.push({ table, filters }); return c }
    // `.is()` hoort erbij sinds markRecovered rijen met een afmeldperiode
    // overslaat; zonder deze regel zou de mock stilzwijgend een andere query
    // testen dan de code doet.
    for (const op of ['eq', 'neq', 'gte', 'lte', 'in', 'is']) {
      c[op] = (col: string, val: unknown) => { filters.push({ op, col, val }); return c }
    }
    // `.not(col, 'is', null)` sinds markRecovered rijen MET afmeldperiode apart
    // terugzet naar 'absent'. Vastgelegd als op 'not.is', zodat een test het
    // verschil met `.is()` ziet.
    c.not = (col: string, op: string, val: unknown) => { filters.push({ op: `not.${op}`, col, val }); return c }
    c.insert = (payload: unknown) => { calls.insert.push({ table, payload }); return c }
    c.update = (payload: Record<string, unknown>) => {
      calls.update.push({ table, payload, filters })
      const n = updateCount[table] ?? 0
      updateCount[table] = n + 1
      const override = updateResults[table]?.[n]
      if (override) result = override
      return c
    }
    c.upsert = (payload: unknown) => { calls.upsert.push({ table, payload }); return c }
    c.maybeSingle = () => Promise.resolve(result)
    c.single = () => Promise.resolve(result)
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

const PLAYER_A = '11111111-1111-4111-8111-111111111111'

// Eigen speler, één toekomstig event.
function eigenTeam(extra: Record<string, TableResult> = {}) {
  return makeSupabase({
    tables: {
      players: { data: { id: PLAYER_A }, error: null },
      events: { data: [{ id: 'e1' }], error: null },
      attendance: { data: null, error: null },
      ...extra,
    },
  })
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

// De eerste attendance-update zet toekomstige 'injured'-rijen ZONDER periode
// terug naar de standaard, de tweede die MET periode naar 'absent'
// (markRecovered in app/actions/players.ts).
function updates(m: ReturnType<typeof makeSupabase>) {
  return m.calls.update.filter((u) => u.table === 'attendance')
}

describe('markRecovered', () => {
  it('zet toekomstige injured-rijen ZONDER afmeldperiode terug naar de standaardstatus', async () => {
    const m = eigenTeam()
    use(m)

    await markRecovered(PLAYER_A)

    const restore = updates(m)[0]
    expect(restore.payload).toEqual({ status: 'present' })
    expect(restore.filters).toEqual([
      { op: 'eq', col: 'team_id', val: 'team-1' },
      { op: 'eq', col: 'player_id', val: PLAYER_A },
      { op: 'eq', col: 'status', val: 'injured' },
      { op: 'is', col: 'absence_period_id', val: null },
      { op: 'in', col: 'event_id', val: ['e1'] },
    ])
  })

  it('zet toekomstige injured-rijen MET afmeldperiode op absent: de periode dekt de datum nog', async () => {
    const m = eigenTeam()
    use(m)

    await markRecovered(PLAYER_A)

    const periode = updates(m)[1]
    expect(periode.payload).toEqual({ status: 'absent' })
    expect(periode.filters).toEqual([
      { op: 'eq', col: 'team_id', val: 'team-1' },
      { op: 'eq', col: 'player_id', val: PLAYER_A },
      { op: 'eq', col: 'status', val: 'injured' },
      { op: 'not.is', col: 'absence_period_id', val: null },
      { op: 'in', col: 'event_id', val: ['e1'] },
    ])
  })

  it('raakt alleen toekomstige events: verleden-injured blijft staan (AC16)', async () => {
    const m = eigenTeam({ events: { data: [{ id: 'e1' }, { id: 'e2' }], error: null } })
    use(m)

    await markRecovered(PLAYER_A)

    // De events-query is de "vanaf vandaag"-grens; elke attendance-update is
    // daarop begrensd met .in('event_id', …). Er is geen update meer zonder
    // die grens (de oude "stap b" die over alle rijen ging is weg).
    const eventsSelect = m.calls.select.find((s) => s.table === 'events')!
    expect(eventsSelect.filters).toContainEqual(expect.objectContaining({ op: 'gte', col: 'date' }))
    expect(updates(m)).toHaveLength(2)
    for (const u of updates(m)) {
      expect(u.filters).toContainEqual({ op: 'in', col: 'event_id', val: ['e1', 'e2'] })
      expect(u.payload).not.toHaveProperty('injury_set')
    }
  })

  it('werkt zonder toekomstige events geen enkele attendance-rij bij', async () => {
    const m = eigenTeam({ events: { data: [], error: null } })
    use(m)

    await markRecovered(PLAYER_A)

    expect(updates(m)).toHaveLength(0)
    expect(m.calls.update.find((u) => u.table === 'players')!.payload).toEqual({ injured: false })
  })

  it('zet de speler op hersteld en revalideert', async () => {
    const m = eigenTeam()
    use(m)

    await markRecovered(PLAYER_A)

    const player = m.calls.update.find((u) => u.table === 'players')!
    expect(player.payload).toEqual({ injured: false })
    expect(player.filters).toEqual([
      { op: 'eq', col: 'id', val: PLAYER_A },
      { op: 'eq', col: 'team_id', val: 'team-1' },
    ])
    expect(revalidatePath).toHaveBeenCalledWith('/players')
    expect(revalidatePath).toHaveBeenCalledWith('/')
    // Ook het profiel van deze ene speler: dat rendert de beschikbaarheidspil
    // server-side en zou anders op de oude stand blijven staan.
    expect(revalidatePath).toHaveBeenCalledWith(`/players/${PLAYER_A}`)
    expect(revalidatePath).toHaveBeenCalledTimes(3)
  })

  it('weigert een speler van een ander team en werkt dan niets bij', async () => {
    const m = eigenTeam({ players: { data: null, error: null } })
    use(m)

    await expect(markRecovered(PLAYER_A)).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    use(makeSupabase({ user: null }))

    await expect(markRecovered(PLAYER_A)).rejects.toThrow('Niet ingelogd')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('geeft een generieke melding bij een databasefout en lekt niets', async () => {
    use(eigenTeam({
      attendance: { data: null, error: { code: '42501', message: 'permission denied for table attendance' } },
    }))

    await expect(markRecovered(PLAYER_A)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('players.markRecovered.restore')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('faalt update b (rijen met periode), dan een veilige melding en players.injured blijft ongewijzigd', async () => {
    const m = makeSupabase({
      tables: {
        players: { data: { id: PLAYER_A }, error: null },
        events: { data: [{ id: 'e1' }], error: null },
        attendance: { data: null, error: null },
      },
      updateResults: {
        attendance: [
          { data: null, error: null },
          { data: null, error: { code: '42501', message: 'permission denied for table attendance' } },
        ],
      },
    })
    use(m)

    await expect(markRecovered(PLAYER_A)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('players.markRecovered.period')
    expect(logged()).not.toContain('permission denied')
    expect(m.calls.update.filter((u) => u.table === 'players')).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────
// markRecovered — gastspelers (O2)
// ────────────────────────────────────────────────
// Herstellen van een blessure zet toekomstige rijen terug naar de
// teamstandaard. Voor een gastspeler is die standaard 'absent': hij komt alleen
// op 'present' als de trainer hem daar handmatig op zet.

describe('markInjured', () => {
  it('zet de speler op geblesseerd en revalideert lijst, dashboard én het spelersprofiel', async () => {
    const m = eigenTeam()
    use(m)

    await markInjured(PLAYER_A)

    const player = m.calls.update.find((u) => u.table === 'players')!
    expect(player.payload).toEqual({ injured: true })
    expect(player.filters).toEqual([
      { op: 'eq', col: 'id', val: PLAYER_A },
      { op: 'eq', col: 'team_id', val: 'team-1' },
    ])
    expect(revalidatePath).toHaveBeenCalledWith('/players')
    expect(revalidatePath).toHaveBeenCalledWith('/')
    expect(revalidatePath).toHaveBeenCalledWith(`/players/${PLAYER_A}`)
    expect(revalidatePath).toHaveBeenCalledTimes(3)
  })

  it('revalideert het profiel met een LITERAAL pad, zonder \'page\'-argument', async () => {
    // Een routepatroon (`/players/[id]`, 'page') zou elk spelersprofiel in één
    // keer invalideren terwijl er precies één speler wijzigt
    // (Next-docs revalidatePath.md, "If `path` is a literal path ... omit `type`").
    use(eigenTeam())

    await markInjured(PLAYER_A)

    for (const call of vi.mocked(revalidatePath).mock.calls) {
      expect(call).toHaveLength(1)
    }
    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).not.toContain('/players/[id]')
  })

  it('revalideert niets als de speler van een ander team is', async () => {
    use(eigenTeam({ players: { data: null, error: null } }))

    await expect(markInjured(PLAYER_A)).rejects.toThrow('Speler niet gevonden')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('upsert injured voor ALLE toekomstige events, ook rijen die al absent waren (AC15, V2)', async () => {
    // De attendance-tabel levert hier een al-absent rij; vroeger werd die
    // overgeslagen. Nu is er geen lookup meer en gaat elk event mee.
    const m = eigenTeam({
      events: { data: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }], error: null },
      attendance: { data: [{ event_id: 'e2', status: 'absent' }], error: null },
    })
    use(m)

    await markInjured(PLAYER_A)

    const upserts = m.calls.upsert.filter((u) => u.table === 'attendance')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].payload).toEqual(
      ['e1', 'e2', 'e3'].map((id) => ({
        event_id: id,
        player_id: PLAYER_A,
        team_id: 'team-1',
        status: 'injured',
      })),
    )
    expect(m.calls.select.filter((s) => s.table === 'attendance')).toHaveLength(0)
  })

  it('stuurt geen absence_period_id en geen injury_set mee: een bestaande periode-herkomst blijft staan', async () => {
    const m = eigenTeam()
    use(m)

    await markInjured(PLAYER_A)

    const payload = m.calls.upsert.find((u) => u.table === 'attendance')!.payload as Record<string, unknown>[]
    for (const row of payload) {
      expect(row).not.toHaveProperty('absence_period_id')
      expect(row).not.toHaveProperty('injury_set')
    }
  })

  it('haalt alleen events vanaf vandaag op, zonder metingen, team-gescoped', async () => {
    const m = eigenTeam()
    use(m)

    await markInjured(PLAYER_A)

    const eventsSelect = m.calls.select.find((s) => s.table === 'events')!
    expect(eventsSelect.filters).toEqual([
      { op: 'eq', col: 'team_id', val: 'team-1' },
      { op: 'neq', col: 'type', val: 'meting' },
      expect.objectContaining({ op: 'gte', col: 'date' }),
    ])
  })

  it('upsert niets zonder toekomstige events, maar zet de speler wél op geblesseerd', async () => {
    const m = eigenTeam({ events: { data: [], error: null } })
    use(m)

    await markInjured(PLAYER_A)

    expect(m.calls.upsert).toHaveLength(0)
    expect(m.calls.update.find((u) => u.table === 'players')!.payload).toEqual({ injured: true })
  })
})

describe('markRecovered — gastspeler', () => {
  it('zet de rijen van een GAST terug naar absent in plaats van de teamstandaard', async () => {
    const m = eigenTeam({ players: { data: { id: PLAYER_A, type: 'guest' }, error: null } })
    use(m)

    await markRecovered(PLAYER_A)

    expect(updates(m)[0].payload).toEqual({ status: 'absent' })
  })

  it('zet de rijen van een REGULIERE speler wél terug naar de teamstandaard', async () => {
    // Zelfde call, alleen een ander type: het verschil zit uitsluitend in de
    // statusregel uit lib/attendance-rows.ts.
    const m = eigenTeam({ players: { data: { id: PLAYER_A, type: 'regular' }, error: null } })
    use(m)

    await markRecovered(PLAYER_A)

    expect(updates(m)[0].payload).toEqual({ status: 'present' })
  })

  it('haalt het type team-gescoped op', async () => {
    const m = eigenTeam({ players: { data: { id: PLAYER_A, type: 'guest' }, error: null } })
    use(m)

    await markRecovered(PLAYER_A)

    // Twee players-selects: assertOwnPlayer en de type-query. Beide dragen
    // id + team_id.
    const playerSelects = m.calls.select.filter((s) => s.table === 'players')
    expect(playerSelects).toHaveLength(2)
    for (const sel of playerSelects) {
      expect(sel.filters).toEqual([
        { op: 'eq', col: 'id', val: PLAYER_A },
        { op: 'eq', col: 'team_id', val: 'team-1' },
      ])
    }
  })

  it('zet ook voor een gast rijen MET periode op absent (geen verschil met de gastregel)', async () => {
    const m = eigenTeam({ players: { data: { id: PLAYER_A, type: 'guest' }, error: null } })
    use(m)

    await markRecovered(PLAYER_A)

    expect(updates(m)[1].payload).toEqual({ status: 'absent' })
  })
})

// ────────────────────────────────────────────────
// createPlayer / updatePlayer — spelertype (AC1, AC4, AC17, AC21, AC22)
// ────────────────────────────────────────────────

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const BASIS = { name: 'Piet Peters', position: 'Spits' }

function inserts(m: ReturnType<typeof makeSupabase>) {
  return m.calls.insert.filter((i) => i.table === 'players')
}

describe('createPlayer — spelertype', () => {
  it('slaat een gastspeler op als type guest, actief en team-gescoped (AC1)', async () => {
    const m = eigenTeam()
    use(m)

    await createPlayer(form({ ...BASIS, type: 'guest' }))

    expect(inserts(m)).toHaveLength(1)
    expect(inserts(m)[0].payload).toMatchObject({
      name: 'Piet Peters',
      position: 'Spits',
      type: 'guest',
      // Een gast is gewoon actief; type staat los van active.
      active: true,
      team_id: 'team-1',
    })
  })

  it('valt terug op regular als het formulier geen type meestuurt', async () => {
    const m = eigenTeam()
    use(m)

    await createPlayer(form(BASIS))

    expect((inserts(m)[0].payload as Record<string, unknown>).type).toBe('regular')
  })

  it('behandelt een leeg type als regular', async () => {
    const m = eigenTeam()
    use(m)

    await createPlayer(form({ ...BASIS, type: '' }))

    expect((inserts(m)[0].payload as Record<string, unknown>).type).toBe('regular')
  })

  it('weigert een type buiten de whitelist en maakt niets aan (AC21)', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createPlayer(form({ ...BASIS, type: 'vip' }))).rejects.toThrow('Ongeldig spelertype')
    expect(m.calls.insert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('houdt position verplicht, ook voor een gast (AC4)', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createPlayer(form({ name: 'Piet Peters', type: 'guest' })))
      .rejects.toThrow('Ongeldige positie')
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert zonder ingelogde gebruiker en raakt de database niet (AC22)', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(createPlayer(form({ ...BASIS, type: 'guest' }))).rejects.toThrow('Niet ingelogd')
    expect(m.calls.insert).toHaveLength(0)
    expect(m.calls.select).toHaveLength(0)
  })
})

describe('createPlayer — beoordeling', () => {
  it('slaat een beoordeling op die al bij het aanmaken is ingevuld', async () => {
    const m = eigenTeam()
    use(m)

    await createPlayer(form({ ...BASIS, rating: '7' }))

    expect(inserts(m)[0].payload).toMatchObject({ rating: 7, team_id: 'team-1' })
  })

  it('slaat null op als er geen beoordeling is gekozen', async () => {
    const m = eigenTeam()
    use(m)

    await createPlayer(form({ ...BASIS, rating: '' }))

    expect((inserts(m)[0].payload as Record<string, unknown>).rating).toBeNull()
  })

  it('slaat null op als het formulier het veld niet meestuurt', async () => {
    const m = eigenTeam()
    use(m)

    await createPlayer(form(BASIS))

    expect((inserts(m)[0].payload as Record<string, unknown>).rating).toBeNull()
  })

  it('weigert een beoordeling buiten 1..10 en maakt niets aan', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createPlayer(form({ ...BASIS, rating: '11' })))
      .rejects.toThrow('Beoordeling moet tussen 1 en 10 liggen')
    expect(m.calls.insert).toHaveLength(0)
  })
})

describe('updatePlayer — spelertype', () => {
  it('schrijft een gewijzigd type weg, gescoped op id én team_id (AC17)', async () => {
    const m = eigenTeam()
    use(m)

    await updatePlayer(PLAYER_A, form({ ...BASIS, type: 'regular', active: 'true' }))

    const update = m.calls.update.find((u) => u.table === 'players')!
    expect(update.payload).toMatchObject({ type: 'regular', active: true })
    expect(update.filters).toEqual([
      { op: 'eq', col: 'id', val: PLAYER_A },
      { op: 'eq', col: 'team_id', val: 'team-1' },
    ])
  })

  it('kan een reguliere speler alsnog gast maken', async () => {
    const m = eigenTeam()
    use(m)

    await updatePlayer(PLAYER_A, form({ ...BASIS, type: 'guest', active: 'true' }))

    expect(m.calls.update.find((u) => u.table === 'players')!.payload).toMatchObject({ type: 'guest' })
  })

  it('weigert een ongeldig type en werkt niets bij (AC21)', async () => {
    const m = eigenTeam()
    use(m)

    await expect(updatePlayer(PLAYER_A, form({ ...BASIS, type: 'vip' })))
      .rejects.toThrow('Ongeldig spelertype')
    expect(m.calls.update).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert zonder ingelogde gebruiker (AC22)', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(updatePlayer(PLAYER_A, form({ ...BASIS, type: 'guest' }))).rejects.toThrow('Niet ingelogd')
    expect(m.calls.update).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────
// Bewerkrecht per onderdeel (assistent-trainers, fase 1)
//
// De applicatielaag is de EERSTE van twee lagen: assertCanEdit weigert vóór
// enige query. De RLS-policy op players (can_edit(team_id,'spelers')) is de
// tweede en wordt hier niet bewezen — vitest praat nooit met een database.
// Zie supabase/team-rls-verificatie.sql voor die kant.
// ────────────────────────────────────────────────

function assistentZonderSpelersrecht(extra: Record<string, TableResult> = {}) {
  return makeSupabase({
    tables: {
      team_members: {
        data: [{ team_id: 'team-1', user_id: 'team-1', rol: 'assistent', mag_spelers_bewerken: false }],
        error: null,
      },
      players: { data: { id: PLAYER_A }, error: null },
      events: { data: [{ id: 'e1' }], error: null },
      attendance: { data: null, error: null },
      ...extra,
    },
  })
}

describe('assertCanEdit — spelers', () => {
  it('weigert createPlayer voor een assistent zonder spelersrecht, zonder insert', async () => {
    const m = assistentZonderSpelersrecht()
    use(m)

    await expect(createPlayer(form(BASIS))).rejects.toThrow('Geen toegang')
    expect(m.calls.insert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert updatePlayer en deletePlayer zonder spelersrecht, zonder write', async () => {
    const m = assistentZonderSpelersrecht()
    use(m)

    await expect(updatePlayer(PLAYER_A, form(BASIS))).rejects.toThrow('Geen toegang')
    await expect(deletePlayer(PLAYER_A)).rejects.toThrow('Geen toegang')
    expect(m.calls.update).toHaveLength(0)
  })

  it('weigert markInjured en markRecovered zonder spelersrecht', async () => {
    const m = assistentZonderSpelersrecht()
    use(m)

    await expect(markInjured(PLAYER_A)).rejects.toThrow('Geen toegang')
    await expect(markRecovered(PLAYER_A)).rejects.toThrow('Geen toegang')
    expect(m.calls.update).toHaveLength(0)
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('laat een assistent MET spelersrecht wél door', async () => {
    const m = assistentZonderSpelersrecht({
      team_members: {
        data: [{ team_id: 'team-1', user_id: 'team-1', rol: 'assistent', mag_spelers_bewerken: true }],
        error: null,
      },
    })
    use(m)

    await createPlayer(form(BASIS))
    expect(inserts(m)).toHaveLength(1)
  })

  it('laat een hoofdtrainer altijd door, ook met alle zes vlaggen op false', async () => {
    const m = assistentZonderSpelersrecht({
      team_members: {
        data: [{ team_id: 'team-1', user_id: 'team-1', rol: 'owner', mag_spelers_bewerken: false }],
        error: null,
      },
    })
    use(m)

    await createPlayer(form(BASIS))
    expect(inserts(m)).toHaveLength(1)
  })
})
