// @vitest-environment node
//
// Node-omgeving: parseBulkMatchFile leest .xlsx via exceljs (een Node-library)
// en de fixtures worden hier met exceljs zelf gegenereerd.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// getDefaultAttendance leest zelf settings; hier vastgezet zodat deze tests
// alleen over de bulk-actions gaan (zelfde opzet als app/actions/events.test.ts).
vi.mock('@/app/actions/settings', () => ({ getDefaultAttendance: vi.fn(async () => 'present') }))

import ExcelJS from 'exceljs'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { BULK_HEADERS, MAX_BULK_MATCHES, type BulkMatchInput } from '@/lib/bulk-matches'
import { createBulkMatches, getExistingMatchKeys, parseBulkMatchFile } from '@/app/actions/events-bulk'

// ────────────────────────────────────────────────
// Mocks (chainbuilder overgenomen uit app/actions/events.test.ts, uitgebreid
// met .in() voor de datumfilter van getExistingMatchKeys)
// ────────────────────────────────────────────────

type TableResult = { data?: unknown; error?: unknown }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  type Eq = { col: string; val: unknown }
  const calls = {
    select: [] as {
      table: string
      eqs: Eq[]
      ins: { col: string; vals: unknown[] }[]
      gtes: Eq[]
      ltes: Eq[]
    }[],
    insert: [] as { table: string; payload: unknown }[],
  }

  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const eqs: Eq[] = []
    const ins: { col: string; vals: unknown[] }[] = []
    const gtes: Eq[] = []
    const ltes: Eq[] = []
    const c: Record<string, unknown> = {}
    c.select = () => { calls.select.push({ table, eqs, ins, gtes, ltes }); return c }
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    c.in = (col: string, vals: unknown[]) => { ins.push({ col, vals }); return c }
    // Datumbereik en sortering van de afmeldperiode-query: wel vastleggen, want
    // een verkeerd bereik zou stilzwijgend periodes missen.
    c.gte = (col: string, val: unknown) => { gtes.push({ col, val }); return c }
    c.lte = (col: string, val: unknown) => { ltes.push({ col, val }); return c }
    c.order = () => c
    c.insert = (payload: unknown) => { calls.insert.push({ table, payload }); return c }
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

// Standaard: insert op events levert twee ids mét datum op (die datums horen bij
// TWEE_RIJEN), één actieve speler en geen enkele afmeldperiode.
function eigenTeam(extra: Record<string, TableResult> = {}) {
  return makeSupabase({
    tables: {
      events: { data: [{ id: 'e1', date: '2026-09-12' }, { id: 'e2', date: '2026-09-19' }], error: null },
      players: { data: [{ id: 'p1' }], error: null },
      attendance: { data: null, error: null },
      absence_periods: { data: [], error: null },
      ...extra,
    },
  })
}

function bulkRow(overrides: Partial<BulkMatchInput> = {}): BulkMatchInput {
  return {
    date: '2026-09-12',
    time: '14:30',
    opponent: 'DVC',
    home_away: 'home',
    match_type: 'league',
    location: 'De Meent',
    gather_time: '13:45',
    notes: null,
    ...overrides,
  }
}

const TWEE_RIJEN = [bulkRow(), bulkRow({ date: '2026-09-19', opponent: 'SV Tweede', home_away: 'away' })]

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

function insertsOn(m: ReturnType<typeof makeSupabase>, table: string) {
  return m.calls.insert.filter((i) => i.table === table)
}

function eventsPayloads(m: ReturnType<typeof makeSupabase>): Record<string, unknown>[] {
  return insertsOn(m, 'events')[0].payload as Record<string, unknown>[]
}

// ────────────────────────────────────────────────
// createBulkMatches — succes
// ────────────────────────────────────────────────

describe('createBulkMatches — opslaan', () => {
  it('schrijft alle wedstrijden in één insert weg', async () => {
    const m = eigenTeam()
    use(m)

    const result = await createBulkMatches(TWEE_RIJEN)

    expect(insertsOn(m, 'events')).toHaveLength(1)
    expect(eventsPayloads(m)).toEqual([
      {
        type: 'match',
        date: '2026-09-12',
        time: '14:30',
        gather_time: '13:45',
        location: 'De Meent',
        notes: null,
        match_type: 'league',
        opponent: 'DVC',
        home_away: 'home',
        team_id: 'team-1',
      },
      {
        type: 'match',
        date: '2026-09-19',
        time: '14:30',
        gather_time: '13:45',
        location: 'De Meent',
        notes: null,
        match_type: 'league',
        opponent: 'SV Tweede',
        home_away: 'away',
        team_id: 'team-1',
      },
    ])
    expect(result).toEqual({ created: 2, attendanceFailed: false })
  })

  it('zet het type hard op match en het team altijd uit de sessie', async () => {
    const m = eigenTeam()
    use(m)

    // Een client die 'training' en een vreemd team meestuurt, mag daar niets
    // mee opschieten: beide waarden komen niet uit de payload.
    await createBulkMatches([
      { ...bulkRow(), type: 'training', team_id: 'ander-team' } as unknown as BulkMatchInput,
    ])

    expect(eventsPayloads(m)[0].type).toBe('match')
    expect(eventsPayloads(m)[0].team_id).toBe('team-1')
  })

  it('maakt van lege optionele velden null', async () => {
    const m = eigenTeam()
    use(m)

    await createBulkMatches([bulkRow({ time: null, location: null, gather_time: null, notes: null })])

    expect(eventsPayloads(m)[0]).toMatchObject({ time: null, location: null, gather_time: null, notes: null })
  })

  it('zet voor elke nieuwe wedstrijd een aanwezigheidsrij per actieve speler klaar', async () => {
    const m = eigenTeam({ players: { data: [{ id: 'p1' }, { id: 'p2' }], error: null } })
    use(m)

    await createBulkMatches(TWEE_RIJEN)

    const attendance = insertsOn(m, 'attendance')
    expect(attendance).toHaveLength(1)
    expect(attendance[0].payload).toEqual([
      { event_id: 'e1', player_id: 'p1', status: 'present', team_id: 'team-1', absence_period_id: null },
      { event_id: 'e1', player_id: 'p2', status: 'present', team_id: 'team-1', absence_period_id: null },
      { event_id: 'e2', player_id: 'p1', status: 'present', team_id: 'team-1', absence_period_id: null },
      { event_id: 'e2', player_id: 'p2', status: 'present', team_id: 'team-1', absence_period_id: null },
    ])
  })

  it('haalt de spelers team-gescoped en alleen actief op', async () => {
    const m = eigenTeam()
    use(m)

    await createBulkMatches(TWEE_RIJEN)

    expect(m.calls.select.find((s) => s.table === 'players')!.eqs).toEqual([
      { col: 'active', val: true },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('slaat de aanwezigheidsstap over als er geen actieve spelers zijn', async () => {
    const m = eigenTeam({ players: { data: [], error: null } })
    use(m)

    const result = await createBulkMatches(TWEE_RIJEN)

    expect(insertsOn(m, 'attendance')).toHaveLength(0)
    expect(result).toEqual({ created: 2, attendanceFailed: false })
  })

  it('revalideert de agenda en het dashboard, zonder te redirecten', async () => {
    use(eigenTeam())

    // Zou hier een redirect() staan, dan gooide deze aanroep en bereikte het
    // resultaat de client nooit.
    await expect(createBulkMatches(TWEE_RIJEN)).resolves.toEqual({ created: 2, attendanceFailed: false })

    expect(revalidatePath).toHaveBeenCalledWith('/events')
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('accepteert precies 100 wedstrijden', async () => {
    const honderd = Array.from({ length: MAX_BULK_MATCHES }, () => bulkRow())
    const m = eigenTeam({
      events: { data: honderd.map((_, i) => ({ id: `e${i}`, date: '2026-09-12' })), error: null },
    })
    use(m)

    const result = await createBulkMatches(honderd)

    expect(eventsPayloads(m)).toHaveLength(MAX_BULK_MATCHES)
    expect(result.created).toBe(MAX_BULK_MATCHES)
  })
})

// ────────────────────────────────────────────────
// createBulkMatches — weigeringen
// ────────────────────────────────────────────────

describe('createBulkMatches — weigeringen', () => {
  it('weigert zonder ingelogde gebruiker', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(createBulkMatches(TWEE_RIJEN)).rejects.toThrow('Niet ingelogd')
    expect(m.calls.insert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een lege lijst', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createBulkMatches([])).rejects.toThrow('Geen wedstrijden om op te slaan')
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert iets anders dan een lijst', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createBulkMatches(null as unknown as BulkMatchInput[])).rejects.toThrow()
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert 101 wedstrijden', async () => {
    const m = eigenTeam()
    use(m)

    const teveel = Array.from({ length: MAX_BULK_MATCHES + 1 }, () => bulkRow())
    await expect(createBulkMatches(teveel)).rejects.toThrow('Maximaal 100 wedstrijden tegelijk')
    expect(m.calls.insert).toHaveLength(0)
  })

  it('weigert de hele batch bij één ongeldige rij', async () => {
    const m = eigenTeam()
    use(m)

    await expect(createBulkMatches([bulkRow(), bulkRow({ date: 'morgen' })]))
      .rejects.toThrow('Ongeldige datum')
    expect(m.calls.insert).toHaveLength(0)
  })

  const ongeldig: [string, Partial<BulkMatchInput>, string][] = [
    ['een datum die niet bestaat', { date: '2026-02-30' }, 'Ongeldige datum'],
    ['een ontbrekende datum', { date: '' }, 'Ongeldige datum'],
    ['een tijd buiten bereik', { time: '25:00' }, 'Ongeldig tijdstip'],
    ['een ongeldige verzameltijd', { gather_time: '9:5' }, 'Ongeldig tijdstip'],
    ['een onbekend wedstrijdtype', { match_type: 'competitie' as BulkMatchInput['match_type'] }, 'Ongeldig wedstrijdtype'],
    ['een onbekend thuis/uit', { home_away: 'thuis' as BulkMatchInput['home_away'] }, 'Ongeldig thuis/uit'],
    ['een lege tegenstander', { opponent: '   ' }, 'Ongeldige tegenstander'],
    ['een te lange tegenstander', { opponent: 'a'.repeat(101) }, 'Ongeldige tegenstander'],
    ['een te lange locatie', { location: 'b'.repeat(201) }, 'Ongeldige locatie'],
    ['te lange notities', { notes: 'c'.repeat(2001) }, 'Ongeldige notities'],
  ]

  for (const [naam, overrides, melding] of ongeldig) {
    it(`weigert ${naam} en schrijft niets weg`, async () => {
      const m = eigenTeam()
      use(m)

      await expect(createBulkMatches([bulkRow(overrides)])).rejects.toThrow(melding)
      expect(m.calls.insert).toHaveLength(0)
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  }

  it('geeft een generieke melding bij een databasefout en lekt niets', async () => {
    const m = eigenTeam({
      events: { data: null, error: { code: '23505', message: 'Key (team_id)=(team-1) already exists' } },
    })
    use(m)

    await expect(createBulkMatches(TWEE_RIJEN)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('events.bulkCreate')
    expect(logged()).toContain('23505')
    expect(logged()).not.toContain('already exists')
    expect(insertsOn(m, 'attendance')).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────
// createBulkMatches — aanwezigheid faalt
// ────────────────────────────────────────────────

describe('createBulkMatches — aanwezigheid mislukt', () => {
  it('laat de wedstrijden staan en meldt attendanceFailed', async () => {
    const m = eigenTeam({ attendance: { data: null, error: { code: '42501', message: 'permission denied' } } })
    use(m)

    const result = await createBulkMatches(TWEE_RIJEN)

    expect(result).toEqual({ created: 2, attendanceFailed: true })
    expect(logged()).toContain('events.bulkCreate.attendance')
    expect(logged()).not.toContain('permission denied')
    // De wedstrijden zijn opgeslagen, dus de agenda moet ververst worden.
    expect(revalidatePath).toHaveBeenCalledWith('/events')
  })

  it('meldt attendanceFailed als de spelerslijst niet opgehaald kan worden', async () => {
    const m = eigenTeam({ players: { data: null, error: { code: '42501' } } })
    use(m)

    const result = await createBulkMatches(TWEE_RIJEN)

    expect(result).toEqual({ created: 2, attendanceFailed: true })
    expect(insertsOn(m, 'attendance')).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────
// createBulkMatches — afmeldperiodes
// ────────────────────────────────────────────────

describe('createBulkMatches — afmeldperiode', () => {
  const PERIOD_1 = 'ap-1'
  const PERIOD_2 = 'ap-2'

  // Twee spelers, twee wedstrijden (2026-09-12 en 2026-09-19), met de
  // meegegeven periodes als antwoord op de absence_periods-query.
  function metPeriodes(periods: unknown[], extra: Record<string, TableResult> = {}) {
    return eigenTeam({
      players: { data: [{ id: 'p1' }, { id: 'p2' }], error: null },
      absence_periods: { data: periods, error: null },
      ...extra,
    })
  }

  function attendanceRows(m: ReturnType<typeof makeSupabase>): Record<string, unknown>[] {
    return insertsOn(m, 'attendance')[0].payload as Record<string, unknown>[]
  }

  it('zet een afgemelde speler op absent met de herkomst van de periode', async () => {
    const m = metPeriodes([
      { id: PERIOD_1, player_id: 'p1', from_date: '2026-09-01', to_date: '2026-09-30' },
    ])
    use(m)

    await createBulkMatches(TWEE_RIJEN)

    expect(attendanceRows(m)).toEqual([
      { event_id: 'e1', player_id: 'p1', status: 'absent', team_id: 'team-1', absence_period_id: PERIOD_1 },
      { event_id: 'e1', player_id: 'p2', status: 'present', team_id: 'team-1', absence_period_id: null },
      { event_id: 'e2', player_id: 'p1', status: 'absent', team_id: 'team-1', absence_period_id: PERIOD_1 },
      { event_id: 'e2', player_id: 'p2', status: 'present', team_id: 'team-1', absence_period_id: null },
    ])
  })

  it('beoordeelt elke wedstrijd op zijn eigen datum, niet op één datum voor de hele batch', async () => {
    // p1 is alleen afgemeld rond de eerste wedstrijd (12 sept), p2 alleen rond
    // de tweede (19 sept). Zou de batch één datum gebruiken, dan zou minstens
    // één van deze vier rijen verkeerd staan.
    const m = metPeriodes([
      { id: PERIOD_1, player_id: 'p1', from_date: '2026-09-10', to_date: '2026-09-12' },
      { id: PERIOD_2, player_id: 'p2', from_date: '2026-09-19', to_date: '2026-09-25' },
    ])
    use(m)

    await createBulkMatches(TWEE_RIJEN)

    expect(attendanceRows(m)).toEqual([
      { event_id: 'e1', player_id: 'p1', status: 'absent', team_id: 'team-1', absence_period_id: PERIOD_1 },
      { event_id: 'e1', player_id: 'p2', status: 'present', team_id: 'team-1', absence_period_id: null },
      { event_id: 'e2', player_id: 'p1', status: 'present', team_id: 'team-1', absence_period_id: null },
      { event_id: 'e2', player_id: 'p2', status: 'absent', team_id: 'team-1', absence_period_id: PERIOD_2 },
    ])
  })

  it('haalt de periodes team-gescoped op, over het datumbereik van de hele batch', async () => {
    const m = metPeriodes([])
    use(m)

    await createBulkMatches(TWEE_RIJEN)

    const select = m.calls.select.find((s) => s.table === 'absence_periods')!
    expect(select.eqs).toEqual([{ col: 'team_id', val: 'team-1' }])
    // from_date <= laatste eventdatum en to_date >= eerste eventdatum: alles wat
    // met het bereik overlapt, niets meer.
    expect(select.ltes).toEqual([{ col: 'from_date', val: '2026-09-19' }])
    expect(select.gtes).toEqual([{ col: 'to_date', val: '2026-09-12' }])
  })

  it('geeft elke rij dezelfde sleutels, ook zonder enige periode', async () => {
    // PostgREST weigert een bulk-insert waarin de objecten verschillende
    // kolommen hebben; absence_period_id moet dus altijd mee.
    const m = metPeriodes([])
    use(m)

    await createBulkMatches(TWEE_RIJEN)

    for (const row of attendanceRows(m)) {
      expect(Object.keys(row).sort()).toEqual(
        ['absence_period_id', 'event_id', 'player_id', 'status', 'team_id'],
      )
      expect(row.status).toBe('present')
      expect(row.absence_period_id).toBeNull()
    }
  })

  it('meldt attendanceFailed als de periodes niet opgehaald kunnen worden, zonder te gooien', async () => {
    // Anders dan createEvent kan hier niet hard gefaald worden: de wedstrijden
    // staan al in de agenda.
    const m = metPeriodes([], {
      absence_periods: { data: null, error: { code: '42501', message: 'permission denied for table absence_periods' } },
    })
    use(m)

    const result = await createBulkMatches(TWEE_RIJEN)

    expect(result).toEqual({ created: 2, attendanceFailed: true })
    expect(insertsOn(m, 'attendance')).toHaveLength(0)
    expect(logged()).toContain('events.bulkCreate.attendance')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
    // De wedstrijden blijven staan, dus de agenda wordt wél ververst.
    expect(revalidatePath).toHaveBeenCalledWith('/events')
  })
})

// ────────────────────────────────────────────────
// getExistingMatchKeys
// ────────────────────────────────────────────────

describe('getExistingMatchKeys', () => {
  it('zoekt team-gescoped, alleen wedstrijden, op de gevraagde datums', async () => {
    const m = eigenTeam({
      events: { data: [{ date: '2026-09-12', opponent: 'DVC' }], error: null },
    })
    use(m)

    const result = await getExistingMatchKeys(['2026-09-12', '2026-09-19'])

    const select = m.calls.select.find((s) => s.table === 'events')!
    expect(select.eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'type', val: 'match' },
    ])
    expect(select.ins).toEqual([{ col: 'date', vals: ['2026-09-12', '2026-09-19'] }])
    expect(result).toEqual([{ date: '2026-09-12', opponent: 'DVC' }])
  })

  it('ontdubbelt de datums en gooit onzin eruit', async () => {
    const m = eigenTeam({ events: { data: [], error: null } })
    use(m)

    await getExistingMatchKeys(['2026-09-12', '2026-09-12', 'morgen', '2026-02-30', ''])

    expect(m.calls.select.find((s) => s.table === 'events')!.ins).toEqual([
      { col: 'date', vals: ['2026-09-12'] },
    ])
  })

  it('bevraagt de database niet als er geen bruikbare datum overblijft', async () => {
    const m = eigenTeam()
    use(m)

    await expect(getExistingMatchKeys(['morgen'])).resolves.toEqual([])
    expect(m.calls.select).toHaveLength(0)
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(getExistingMatchKeys(['2026-09-12'])).rejects.toThrow('Niet ingelogd')
    expect(m.calls.select).toHaveLength(0)
  })

  it('geeft een generieke melding bij een databasefout', async () => {
    use(eigenTeam({ events: { data: null, error: { code: '42501', message: 'permission denied for table events' } } }))

    await expect(getExistingMatchKeys(['2026-09-12'])).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(logged()).toContain('events.getExistingMatchKeys')
    expect(logged()).not.toContain('permission denied')
  })
})

// ────────────────────────────────────────────────
// parseBulkMatchFile
// ────────────────────────────────────────────────

const HEADER = BULK_HEADERS.join(';')
const CSV = `${HEADER}\n2026-09-12;14:30;FC Voorbeeld;thuis;competitie;De Meent;13:45;\n`

function upload(file: File): FormData {
  const fd = new FormData()
  fd.set('file', file)
  return fd
}

async function xlsxBytes(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Blad1')
  sheet.addRow([...BULK_HEADERS])
  sheet.addRow(['2026-09-12', '14:30', 'FC Voorbeeld', 'thuis', 'competitie', '', '', ''])
  return (await workbook.xlsx.writeBuffer()) as unknown as ArrayBuffer
}

describe('parseBulkMatchFile — geldige bestanden', () => {
  it('leest een .csv-bestand', async () => {
    use(eigenTeam())

    const result = await parseBulkMatchFile(upload(new File([CSV], 'wedstrijden.csv', { type: 'text/csv' })))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rows[0]).toMatchObject({ date: '2026-09-12', opponent: 'FC Voorbeeld' })
  })

  it('leest een .xlsx-bestand', async () => {
    use(eigenTeam())

    const result = await parseBulkMatchFile(
      upload(new File([await xlsxBytes()], 'wedstrijden.xlsx', { type: 'application/vnd.ms-excel' })),
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rows[0]).toMatchObject({ date: '2026-09-12', match_type: 'league' })
  })

  it('kijkt naar de extensie ongeacht hoofdletters', async () => {
    use(eigenTeam())

    const result = await parseBulkMatchFile(upload(new File([CSV], 'WEDSTRIJDEN.CSV', { type: '' })))
    expect(result.ok).toBe(true)
  })
})

describe('parseBulkMatchFile — weigeringen', () => {
  it('weigert zonder ingelogde gebruiker', async () => {
    use(makeSupabase({ user: null }))

    const result = await parseBulkMatchFile(upload(new File([CSV], 'wedstrijden.csv')))
    expect(result).toEqual({ ok: false, error: 'Niet ingelogd' })
  })

  it('weigert een ontbrekend of leeg bestand', async () => {
    use(eigenTeam())

    expect(await parseBulkMatchFile(new FormData())).toEqual({
      ok: false, error: 'Kies een .csv- of .xlsx-bestand.',
    })
    expect(await parseBulkMatchFile(upload(new File([], 'leeg.csv')))).toEqual({
      ok: false, error: 'Kies een .csv- of .xlsx-bestand.',
    })
  })

  it('weigert een te groot bestand', async () => {
    use(eigenTeam())

    const groot = new File(['x'.repeat(512 * 1024 + 1)], 'groot.csv')
    const result = await parseBulkMatchFile(upload(groot))
    expect(result).toEqual({ ok: false, error: 'Het bestand is te groot. Maximaal 512 KB.' })
  })

  it('weigert een andere extensie, ook met een vervalst content-type', async () => {
    use(eigenTeam())

    // De client bepaalt file.type zelf; die header is dus geen bewijs.
    const result = await parseBulkMatchFile(upload(new File([CSV], 'wedstrijden.txt', { type: 'text/csv' })))
    expect(result).toEqual({ ok: false, error: 'Alleen .csv- en .xlsx-bestanden zijn toegestaan.' })
  })

  it('weigert een .xlsx zonder ZIP-kop', async () => {
    use(eigenTeam())

    const result = await parseBulkMatchFile(upload(new File([CSV], 'nep.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })))
    expect(result).toEqual({ ok: false, error: 'Dit lijkt geen geldig .xlsx-bestand te zijn.' })
  })

  it('herkent een oud .xls-bestand aan de magic bytes en zegt wat te doen', async () => {
    use(eigenTeam())

    const oud = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    const result = await parseBulkMatchFile(upload(new File([oud], 'oud.xlsx')))
    expect(result).toEqual({
      ok: false,
      error: 'Dit is een oud .xls-bestand. Sla het in Excel op als .xlsx en probeer het opnieuw.',
    })
  })

  it('weigert een .csv met NUL-bytes', async () => {
    use(eigenTeam())

    const binair = new Uint8Array([0x64, 0x61, 0x74, 0x00, 0x75, 0x6d])
    const result = await parseBulkMatchFile(upload(new File([binair], 'binair.csv')))
    expect(result).toEqual({
      ok: false, error: 'Dit bestand is geen leesbare tekst. Sla het op als CSV met UTF-8-codering.',
    })
  })

  it('weigert een .csv die geen geldige UTF-8 is', async () => {
    use(eigenTeam())

    // 0xFF/0xFE komt in geldige UTF-8 nooit voor (wel in Latin-1/UTF-16).
    const latin1 = new Uint8Array([0x64, 0x61, 0x74, 0x75, 0x6d, 0xff, 0xfe])
    const result = await parseBulkMatchFile(upload(new File([latin1], 'latin1.csv')))
    expect(result).toEqual({
      ok: false, error: 'Dit bestand is geen leesbare tekst. Sla het op als CSV met UTF-8-codering.',
    })
  })

  it('geeft de foutmelding van de parser door bij een verkeerde kopregel', async () => {
    use(eigenTeam())

    const result = await parseBulkMatchFile(upload(new File(['a;b;c\n1;2;3'], 'fout.csv')))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('kopregel')
  })

  it('geeft een nette melding als een .xlsx onleesbaar blijkt', async () => {
    use(eigenTeam())

    // Wel een ZIP-kop, maar geen werkmap: exceljs gooit hier.
    const nepZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])
    const result = await parseBulkMatchFile(upload(new File([nepZip], 'kapot.xlsx')))

    expect(result).toEqual({ ok: false, error: 'Dit bestand kon niet gelezen worden.' })
    expect(logged()).toContain('events.parseBulkMatchFile')
  })
})
