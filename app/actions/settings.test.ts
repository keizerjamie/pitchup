import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { MAX_SEASON_DAYS } from '@/lib/season-dates'
import {
  deleteSeasonTrainings,
  generateSeasonTrainings,
  saveScheduleSettings,
  saveSettings,
} from '@/app/actions/settings'

type TableResult = { data?: unknown; error?: unknown }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  type Filter = { op: string; col: string; val: unknown }
  const calls = {
    select: [] as { table: string; filters: Filter[] }[],
    insert: [] as { table: string; payload: unknown }[],
    upsert: [] as { table: string; payload: unknown }[],
    delete: [] as { table: string; filters: Filter[] }[],
  }

  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const filters: Filter[] = []
    const c: Record<string, unknown> = {}
    c.select = () => { calls.select.push({ table, filters }); return c }
    // Sortering van de afmeldperiode-query: alleen doorgeven, niet vastleggen.
    c.order = () => c
    for (const op of ['eq', 'gte', 'lte', 'gt', 'lt', 'in']) {
      c[op] = (col: string, val: unknown) => { filters.push({ op, col, val }); return c }
    }
    c.insert = (payload: unknown) => { calls.insert.push({ table, payload }); return c }
    c.upsert = (payload: unknown) => { calls.upsert.push({ table, payload }); return c }
    c.delete = () => { calls.delete.push({ table, filters }); return c }
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

function gebruikSupabase(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

// Instellingen zijn key/value-rijen; een ruime maand zodat er in elke tijdzone
// meerdere maandagen (training_days = '1') binnen het seizoen vallen.
const SEIZOEN_SETTINGS = {
  data: [
    { key: 'season_start', value: '2026-01-01' },
    { key: 'season_end', value: '2026-01-31' },
    { key: 'training_days', value: '1' },
    { key: 'training_time', value: '19:00' },
    { key: 'training_location', value: 'Sportpark' },
  ],
  error: null,
}

function metSeizoen(extra: Record<string, TableResult> = {}) {
  return makeSupabase({
    tables: {
      settings: SEIZOEN_SETTINGS,
      events: { data: [], error: null },
      players: { data: [], error: null },
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

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('saveSettings', () => {
  it('slaat team-gescoped op', async () => {
    const m = makeSupabase()
    gebruikSupabase(m)

    await saveSettings(form({ default_attendance: 'unknown' }))

    expect(m.calls.upsert).toEqual([{
      table: 'settings',
      payload: { team_id: 'team-1', key: 'default_attendance', value: 'unknown' },
    }])
  })

  it('weigert een waarde buiten de toegestane set', async () => {
    gebruikSupabase(makeSupabase())
    await expect(saveSettings(form({ default_attendance: 'aanwezig' }))).rejects.toThrow('Ongeldige waarde')
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    gebruikSupabase(makeSupabase({ user: null }))
    await expect(saveSettings(form({ default_attendance: 'present' }))).rejects.toThrow('Niet ingelogd')
  })

  it('faalt zichtbaar (en generiek) als de upsert mislukt in plaats van stil door te gaan', async () => {
    gebruikSupabase(makeSupabase({
      tables: { settings: { data: null, error: { code: '42501', message: 'permission denied for table settings' } } },
    }))

    await expect(saveSettings(form({ default_attendance: 'present' }))).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('settings.saveSettings')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
  })
})

describe('saveScheduleSettings', () => {
  const geldig = {
    season_start: '2026-01-01',
    season_end: '2026-06-30',
    training_days: '1,3',
    training_time: '19:00',
    training_location: 'Sportpark',
  }

  it('slaat alle sleutels team-gescoped op', async () => {
    const m = makeSupabase()
    gebruikSupabase(m)

    await saveScheduleSettings(form(geldig))

    const rows = m.calls.upsert[0].payload as Record<string, unknown>[]
    expect(rows.map((r) => r.key)).toEqual([
      'season_start', 'season_end', 'training_days', 'training_time', 'training_location',
    ])
    for (const row of rows) expect(row.team_id).toBe('team-1')
  })

  it('weigert een verkeerd datumformaat', async () => {
    gebruikSupabase(makeSupabase())
    await expect(saveScheduleSettings(form({ ...geldig, season_start: '01-01-2026' })))
      .rejects.toThrow('Ongeldige datum')
  })

  it('weigert een datum die niet bestaat', async () => {
    gebruikSupabase(makeSupabase())
    await expect(saveScheduleSettings(form({ ...geldig, season_end: '2026-02-30' })))
      .rejects.toThrow('Ongeldige datum')
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    gebruikSupabase(makeSupabase({ user: null }))
    await expect(saveScheduleSettings(form(geldig))).rejects.toThrow('Niet ingelogd')
  })

  it('faalt zichtbaar (en generiek) als de upsert mislukt', async () => {
    gebruikSupabase(makeSupabase({
      tables: { settings: { data: null, error: { code: '23514', message: 'violates check constraint "settings_key_check"' } } },
    }))

    await expect(saveScheduleSettings(form(geldig))).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('settings.saveScheduleSettings')
    expect(logged()).toContain('23514')
    expect(logged()).not.toContain('check constraint')
  })
})

describe('deleteSeasonTrainings', () => {
  it('verwijdert team-gescoped binnen het seizoen en telt de rijen', async () => {
    const m = metSeizoen({ events: { data: [{ id: 'a' }, { id: 'b' }], error: null } })
    gebruikSupabase(m)

    const res = await deleteSeasonTrainings()

    expect(res).toEqual({ deleted: 2 })
    const del = m.calls.delete.find((d) => d.table === 'events')!
    expect(del.filters).toEqual([
      { op: 'eq', col: 'team_id', val: 'team-1' },
      { op: 'eq', col: 'type', val: 'training' },
      { op: 'gte', col: 'date', val: '2026-01-01' },
      { op: 'lte', col: 'date', val: '2026-01-31' },
    ])
  })

  it('weigert zonder seizoensdatums', async () => {
    gebruikSupabase(makeSupabase({ tables: { settings: { data: [], error: null } } }))
    await expect(deleteSeasonTrainings()).rejects.toThrow('Stel eerst seizoensdatums in')
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    gebruikSupabase(makeSupabase({ user: null }))
    await expect(deleteSeasonTrainings()).rejects.toThrow('Niet ingelogd')
  })

  it('geeft een generieke melding bij een databasefout', async () => {
    gebruikSupabase(metSeizoen({
      events: { data: null, error: { code: '42501', message: 'permission denied for table events' } },
    }))

    await expect(deleteSeasonTrainings()).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('settings.deleteSeasonTrainings')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
  })
})

describe('generateSeasonTrainings', () => {
  it('maakt trainingen aan met team_id, tijd en locatie uit de instellingen', async () => {
    const m = metSeizoen()
    gebruikSupabase(m)

    const res = await generateSeasonTrainings()

    expect(res.created).toBeGreaterThan(0)
    const insert = m.calls.insert.find((i) => i.table === 'events')!
    const rows = insert.payload as Record<string, unknown>[]
    expect(rows.length).toBe(res.created)
    for (const row of rows) {
      expect(row.team_id).toBe('team-1')
      expect(row.type).toBe('training')
      expect(row.time).toBe('19:00')
      expect(row.location).toBe('Sportpark')
      expect(row.date).toMatch(/^2026-01-\d{2}$/)
    }
  })

  it('weigert zonder seizoensdata of trainingsdagen', async () => {
    gebruikSupabase(makeSupabase({ tables: { settings: { data: [], error: null } } }))
    await expect(generateSeasonTrainings())
      .rejects.toThrow('Vul seizoensdata en trainingsdagen in voor je genereert')
  })

  it('geeft een generieke melding bij een databasefout op de insert', async () => {
    gebruikSupabase(metSeizoen({
      events: { data: null, error: { code: '23505', message: 'Key (team_id, date)=(team-1, 2026-01-05) already exists' } },
    }))

    await expect(generateSeasonTrainings()).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('settings.generateSeasonTrainings')
    expect(logged()).toContain('23505')
    expect(logged()).not.toContain('already exists')
  })

  it('faalt zichtbaar als het aanmaken van de aanwezigheidsrijen mislukt', async () => {
    gebruikSupabase(metSeizoen({
      events: { data: [{ id: 'e1' }], error: null },
      players: { data: [{ id: 'p1' }], error: null },
      attendance: { data: null, error: { code: '42501', message: 'permission denied for table attendance' } },
    }))

    await expect(generateSeasonTrainings()).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('settings.generateSeasonTrainings.attendance')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
  })

  it('maakt de aanwezigheidsrijen team-gescoped aan', async () => {
    // `date` hoort erbij: de code haalt hem op met .select('id, date') om de
    // afmeldperiodes op datum te kunnen matchen.
    const m = metSeizoen({
      events: { data: [{ id: 'e1', date: '2026-01-12' }], error: null },
      players: { data: [{ id: 'p1' }, { id: 'p2' }], error: null },
    })
    gebruikSupabase(m)

    await generateSeasonTrainings()

    const attendance = m.calls.insert.find((i) => i.table === 'attendance')!
    const rows = attendance.payload as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.team_id).toBe('team-1')
      expect(row.event_id).toBe('e1')
    }
  })

  it('slaat trainingen over die al bestaan', async () => {
    const m = metSeizoen({
      events: { data: [{ id: 'e1', date: '2026-01-05' }], error: null },
    })
    gebruikSupabase(m)

    const res = await generateSeasonTrainings()

    const insert = m.calls.insert.find((i) => i.table === 'events')!
    const dates = (insert.payload as { date: string }[]).map((r) => r.date)
    expect(dates).not.toContain('2026-01-05')
    expect(dates).toEqual(['2026-01-12', '2026-01-19', '2026-01-26'])
    expect(res.created).toBe(3)
  })

  it('genereert niets bij een leeg training_days (0 mag geen "elke zondag" worden)', async () => {
    gebruikSupabase(makeSupabase({
      tables: {
        settings: {
          data: [
            { key: 'season_start', value: '2026-01-01' },
            { key: 'season_end', value: '2026-01-31' },
            { key: 'training_days', value: '' },
          ],
          error: null,
        },
      },
    }))

    await expect(generateSeasonTrainings())
      .rejects.toThrow('Vul seizoensdata en trainingsdagen in voor je genereert')
  })

  it('weigert een einddatum vóór de startdatum', async () => {
    gebruikSupabase(makeSupabase({
      tables: {
        settings: {
          data: [
            { key: 'season_start', value: '2026-06-30' },
            { key: 'season_end', value: '2026-01-01' },
            { key: 'training_days', value: '1' },
          ],
          error: null,
        },
        events: { data: [], error: null },
      },
    }))

    await expect(generateSeasonTrainings()).rejects.toThrow('einddatum moet na de startdatum liggen')
  })

  it('weigert een seizoen dat langer duurt dan het maximum', async () => {
    gebruikSupabase(makeSupabase({
      tables: {
        settings: {
          data: [
            { key: 'season_start', value: '2020-01-01' },
            { key: 'season_end', value: '2030-01-01' },
            { key: 'training_days', value: '1' },
          ],
          error: null,
        },
        events: { data: [], error: null },
      },
    }))

    await expect(generateSeasonTrainings()).rejects.toThrow(`maximaal ${MAX_SEASON_DAYS} dagen`)
  })
})

// ────────────────────────────────────────────────
// generateSeasonTrainings — afmeldperiode
// ────────────────────────────────────────────────

describe('generateSeasonTrainings — afmeldperiode', () => {
  // Let op: de events-fixture doet in deze mock dubbel dienst — hij is zowel het
  // antwoord op "welke trainingen bestaan al" als op de insert-select. De datums
  // hieronder zijn dus tegelijk de reeds bestaande én de teruggegeven rijen.
  function metPeriodes(
    events: { id: string; date: string }[],
    periods: unknown[],
    extra: Record<string, TableResult> = {},
  ) {
    return metSeizoen({
      events: { data: events, error: null },
      players: { data: [{ id: 'p1' }, { id: 'p2' }], error: null },
      absence_periods: { data: periods, error: null },
      ...extra,
    })
  }

  function attendanceRows(m: ReturnType<typeof makeSupabase>): Record<string, unknown>[] {
    return m.calls.insert.find((i) => i.table === 'attendance')!.payload as Record<string, unknown>[]
  }

  it('zet een speler met een dekkende periode op absent en de rest op de standaardstatus', async () => {
    const m = metPeriodes(
      [{ id: 'e1', date: '2026-01-12' }],
      [{ id: 'ap-1', player_id: 'p1', from_date: '2026-01-10', to_date: '2026-01-20' }],
    )
    gebruikSupabase(m)

    await generateSeasonTrainings()

    expect(attendanceRows(m)).toEqual([
      { event_id: 'e1', player_id: 'p1', status: 'absent', team_id: 'team-1', injury_set: false, absence_period_id: 'ap-1' },
      { event_id: 'e1', player_id: 'p2', status: 'present', team_id: 'team-1', injury_set: false, absence_period_id: null },
    ])
  })

  it('differentieert per event: alleen de training binnen de periode wordt absent', async () => {
    // Bewijs dat er op DATUM gematcht wordt en niet op array-index: de
    // teruggegeven rijen (05 en 26 januari) hebben andere datums dan de batch
    // die wordt ingevoegd (12 en 19 januari).
    const m = metPeriodes(
      [{ id: 'e1', date: '2026-01-05' }, { id: 'e2', date: '2026-01-26' }],
      [{ id: 'ap-1', player_id: 'p1', from_date: '2026-01-01', to_date: '2026-01-06' }],
    )
    gebruikSupabase(m)

    await generateSeasonTrainings()

    const rows = attendanceRows(m)
    expect(rows.filter((r) => r.event_id === 'e1')).toEqual([
      { event_id: 'e1', player_id: 'p1', status: 'absent', team_id: 'team-1', injury_set: false, absence_period_id: 'ap-1' },
      { event_id: 'e1', player_id: 'p2', status: 'present', team_id: 'team-1', injury_set: false, absence_period_id: null },
    ])
    for (const row of rows.filter((r) => r.event_id === 'e2')) {
      expect(row.status).toBe('present')
      expect(row.absence_period_id).toBeNull()
    }
  })

  it('telt de grensdatums van de periode mee', async () => {
    const m = metPeriodes(
      [{ id: 'e1', date: '2026-01-12' }],
      [{ id: 'ap-1', player_id: 'p1', from_date: '2026-01-12', to_date: '2026-01-12' }],
    )
    gebruikSupabase(m)

    await generateSeasonTrainings()

    expect(attendanceRows(m)[0]).toMatchObject({ status: 'absent', absence_period_id: 'ap-1' })
  })

  it('geeft elke rij dezelfde sleutels, ook zonder enige periode', async () => {
    // PostgREST weigert een bulk-insert met afwijkende kolommen per object.
    const m = metPeriodes([{ id: 'e1', date: '2026-01-12' }], [])
    gebruikSupabase(m)

    await generateSeasonTrainings()

    for (const row of attendanceRows(m)) {
      expect(Object.keys(row).sort()).toEqual(
        ['absence_period_id', 'event_id', 'injury_set', 'player_id', 'status', 'team_id'],
      )
      expect(row.absence_period_id).toBeNull()
      expect(row.injury_set).toBe(false)
    }
  })

  it('haalt de periodes één keer op, niet per event, met een bereik-overlap op het seizoen', async () => {
    const m = metPeriodes(
      [{ id: 'e1', date: '2026-01-05' }, { id: 'e2', date: '2026-01-12' }],
      [{ id: 'ap-1', player_id: 'p1', from_date: '2026-01-01', to_date: '2026-01-06' }],
    )
    gebruikSupabase(m)

    await generateSeasonTrainings()

    const periodSelects = m.calls.select.filter((s) => s.table === 'absence_periods')
    expect(periodSelects).toHaveLength(1)
    expect(periodSelects[0].filters).toEqual([
      { op: 'eq', col: 'team_id', val: 'team-1' },
      { op: 'lte', col: 'from_date', val: '2026-01-31' },
      { op: 'gte', col: 'to_date', val: '2026-01-01' },
    ])
  })

  it('faalt zichtbaar (en generiek) als de periodequery mislukt', async () => {
    gebruikSupabase(metPeriodes([{ id: 'e1', date: '2026-01-12' }], [], {
      absence_periods: { data: null, error: { code: '42501', message: 'permission denied for table absence_periods' } },
    }))

    await expect(generateSeasonTrainings()).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('settings.generateSeasonTrainings.periods')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
  })
})

// ────────────────────────────────────────────────
// generateSeasonTrainings — blessure
// ────────────────────────────────────────────────
// Anders dan een afmeldperiode kent een blessure geen datumbereik: zolang
// players.injured true is, geldt hij voor élke gegenereerde training.

describe('generateSeasonTrainings — blessure', () => {
  function metBlessure(
    events: { id: string; date: string }[],
    players: { id: string; injured?: boolean }[],
    extra: Record<string, TableResult> = {},
  ) {
    return metSeizoen({
      events: { data: events, error: null },
      players: { data: players, error: null },
      absence_periods: { data: [], error: null },
      ...extra,
    })
  }

  function attendanceRows(m: ReturnType<typeof makeSupabase>): Record<string, unknown>[] {
    return m.calls.insert.find((i) => i.table === 'attendance')!.payload as Record<string, unknown>[]
  }

  it('zet een geblesseerde speler op elke gegenereerde training op absent, ook zonder enige periode', async () => {
    const m = metBlessure(
      [{ id: 'e1', date: '2026-01-12' }, { id: 'e2', date: '2026-01-26' }],
      [{ id: 'p1', injured: true }, { id: 'p2', injured: false }],
    )
    gebruikSupabase(m)

    await generateSeasonTrainings()

    const rows = attendanceRows(m)
    const geblesseerd = rows.filter((r) => r.player_id === 'p1')
    expect(geblesseerd).toHaveLength(2)
    for (const row of geblesseerd) {
      expect(row.status).toBe('absent')
      expect(row.injury_set).toBe(true)
      expect(row.absence_period_id).toBeNull()
    }

    const fit = rows.filter((r) => r.player_id === 'p2')
    expect(fit).toHaveLength(2)
    for (const row of fit) {
      expect(row.status).toBe('present')
      expect(row.injury_set).toBe(false)
    }
  })

  it('combineert blessure en een dekkende periode: absent met beide markeringen', async () => {
    const m = metBlessure(
      [{ id: 'e1', date: '2026-01-12' }],
      [{ id: 'p1', injured: true }],
      { absence_periods: { data: [{ id: 'ap-1', player_id: 'p1', from_date: '2026-01-10', to_date: '2026-01-20' }], error: null } },
    )
    gebruikSupabase(m)

    await generateSeasonTrainings()

    expect(attendanceRows(m)[0]).toEqual({
      event_id: 'e1', player_id: 'p1', status: 'absent', team_id: 'team-1',
      injury_set: true, absence_period_id: 'ap-1',
    })
  })

  it('faalt zichtbaar (en generiek) als de spelersquery mislukt', async () => {
    gebruikSupabase(metBlessure([{ id: 'e1', date: '2026-01-12' }], [], {
      players: { data: null, error: { code: '42501', message: 'permission denied for table players' } },
    }))

    await expect(generateSeasonTrainings()).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('settings.generateSeasonTrainings.players')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
  })
})

// ────────────────────────────────────────────────
// generateSeasonTrainings — gastspelers (AC6)
// ────────────────────────────────────────────────
// Een gastspeler staat op ELKE gegenereerde training op 'absent', ongeacht de
// teaminstelling default_attendance (in deze suite 'present').

describe('generateSeasonTrainings — gastspeler', () => {
  function metGast(
    events: { id: string; date: string }[],
    players: { id: string; injured?: boolean; type?: string }[],
    extra: Record<string, TableResult> = {},
  ) {
    return metSeizoen({
      events: { data: events, error: null },
      players: { data: players, error: null },
      absence_periods: { data: [], error: null },
      ...extra,
    })
  }

  function attendanceRows(m: ReturnType<typeof makeSupabase>): Record<string, unknown>[] {
    return m.calls.insert.find((i) => i.table === 'attendance')!.payload as Record<string, unknown>[]
  }

  const TWEE_TRAININGEN = [{ id: 'e1', date: '2026-01-12' }, { id: 'e2', date: '2026-01-26' }]

  it('zet de gast op elke gegenereerde training op absent, de reguliere speler op present', async () => {
    const m = metGast(TWEE_TRAININGEN, [
      { id: 'p1', injured: false, type: 'guest' },
      { id: 'p2', injured: false, type: 'regular' },
    ])
    gebruikSupabase(m)

    await generateSeasonTrainings()

    const rows = attendanceRows(m)
    const gast = rows.filter((r) => r.player_id === 'p1')
    expect(gast).toHaveLength(2)
    for (const row of gast) {
      expect(row.status).toBe('absent')
      expect(row.injury_set).toBe(false)
      expect(row.absence_period_id).toBeNull()
    }

    const regulier = rows.filter((r) => r.player_id === 'p2')
    expect(regulier).toHaveLength(2)
    for (const row of regulier) expect(row.status).toBe('present')
  })

  it('blijft absent in combinatie met blessure en een dekkende periode (AC9)', async () => {
    const m = metGast(
      [{ id: 'e1', date: '2026-01-12' }],
      [{ id: 'p1', injured: true, type: 'guest' }],
      { absence_periods: { data: [{ id: 'ap-1', player_id: 'p1', from_date: '2026-01-10', to_date: '2026-01-20' }], error: null } },
    )
    gebruikSupabase(m)

    await generateSeasonTrainings()

    expect(attendanceRows(m)[0]).toEqual({
      event_id: 'e1', player_id: 'p1', status: 'absent', team_id: 'team-1',
      injury_set: true, absence_period_id: 'ap-1',
    })
  })

  it('houdt het active-filter en de tenant-scope op de spelersquery', async () => {
    // Een gast is gewoon actief: zonder dit filter zou hij nooit een rij
    // krijgen.
    const m = metGast([{ id: 'e1', date: '2026-01-12' }], [{ id: 'p1', type: 'guest' }])
    gebruikSupabase(m)

    await generateSeasonTrainings()

    const playerSelects = m.calls.select.filter((s) => s.table === 'players')
    expect(playerSelects).toHaveLength(1)
    expect(playerSelects[0].filters).toEqual([
      { op: 'eq', col: 'active', val: true },
      { op: 'eq', col: 'team_id', val: 'team-1' },
    ])
  })

  it('houdt de sleutelset gelijk voor gast en reguliere speler', async () => {
    const m = metGast([{ id: 'e1', date: '2026-01-12' }], [
      { id: 'p1', type: 'guest' },
      { id: 'p2', type: 'regular' },
    ])
    gebruikSupabase(m)

    await generateSeasonTrainings()

    for (const row of attendanceRows(m)) {
      expect(Object.keys(row).sort()).toEqual(
        ['absence_period_id', 'event_id', 'injury_set', 'player_id', 'status', 'team_id'],
      )
    }
  })
})

// ────────────────────────────────────────────────
// Tijdzones
// ────────────────────────────────────────────────

describe('generateSeasonTrainings — tijdzone-onafhankelijk', () => {
  const oorspronkelijkeTz = process.env.TZ

  afterEach(() => {
    process.env.TZ = oorspronkelijkeTz
  })

  async function datumsIn(tz: string): Promise<string[]> {
    process.env.TZ = tz
    const m = makeSupabase({
      tables: {
        settings: {
          data: [
            { key: 'season_start', value: '2025-01-01' },
            { key: 'season_end', value: '2025-12-31' },
            { key: 'training_days', value: '1,3' },
          ],
          error: null,
        },
        events: { data: [], error: null },
        players: { data: [], error: null },
      },
    })
    gebruikSupabase(m)
    await generateSeasonTrainings()
    return m.calls.insert
      .filter((i) => i.table === 'events')
      .flatMap((i) => (i.payload as { date: string }[]).map((r) => r.date))
  }

  it('geeft in elke server-tijdzone exact dezelfde trainingsdatums', async () => {
    // Asia/Beirut, America/Santiago en America/Havana schakelen de zomertijd om
    // middernacht om; met lokale Date-rekenkunde verschoof de cursor daar een
    // uur en viel de laatste seizoensdag buiten de lus.
    const utc = await datumsIn('UTC')
    for (const tz of ['Europe/Amsterdam', 'Asia/Beirut', 'America/Santiago', 'America/Havana', 'Pacific/Kiritimati']) {
      expect(await datumsIn(tz), `tijdzone ${tz}`).toEqual(utc)
    }
  })

  it('laat de laatste dag van het seizoen niet wegvallen bij een zomertijd-omschakeling om middernacht', async () => {
    // 31-12-2025 is een woensdag en dus een trainingsdag.
    expect(await datumsIn('Asia/Beirut')).toContain('2025-12-31')
    expect(await datumsIn('UTC')).toContain('2025-12-31')
  })

  it('houdt elke gegenereerde datum op de ingestelde weekdag (ma/wo)', async () => {
    for (const date of await datumsIn('America/Santiago')) {
      expect([1, 3]).toContain(new Date(`${date}T00:00:00Z`).getUTCDay())
    }
  })
})
