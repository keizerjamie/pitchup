// Acceptatietests — Wedstrijden bulk toevoegen — server-actions/publieke API.
//
// ── Waarom een los bestand, in node-omgeving ──
// De hoofd-acceptatietest (wedstrijden-bulk-toevoegen.acceptance.test.tsx)
// rendert de ECHTE pagina in jsdom. Voor bestandsupload (.csv/.xlsx) moet die
// pagina echter `File#arrayBuffer()` aanroepen (app/actions/events-bulk.ts:98),
// en jsdom (in de hier geïnstalleerde versie) implementeert die methode niet —
// geverifieerd met een losse smoke-test (`new File(['x'],'a').arrayBuffer()`
// gooit `TypeError: ... is not a function` onder jsdom, maar werkt wél onder
// `@vitest-environment node`, waar `File`/`FormData` de Node/undici-implementatie
// zijn). Dit is exact dezelfde reden waarom lib/bulk-matches-xlsx.test.ts al
// `@vitest-environment node` gebruikt.
//
// Dit bestand test daarom de bestandsupload- en opslaan-criteria niet via de
// (in jsdom onmogelijke) UI-route, maar via de ECHTE, geëxporteerde server
// actions uit app/actions/events-bulk.ts — dat IS de publieke API die de UI
// zelf aanroept (app/actions/events-bulk.ts wordt ongewijzigd geïmporteerd,
// niets wordt hier gemockt behalve de externe randen: Supabase, next/cache en
// de losstaande settings-actie voor de standaard-aanwezigheidsstatus).
// Geen enkele interne pure helper (validateBulkRow, markDuplicates, ...) wordt
// hier rechtstreeks aangeroepen — alleen de drie async server actions.
//
// Criteria-codes verwijzen naar de goedgekeurde story: H = happy path,
// F = faalpad, B = businessregel, E = edge case.

// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import ExcelJS from 'exceljs'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// Losstaande feature (instellingen/default-aanwezigheid); hier vastgezet zodat
// deze tests uitsluitend over de bulk-actions gaan. De waarde 'unknown' is
// bewust een SENTINEL die afwijkt van de interne fallback 'present': als
// createBulkMatches ooit een eigen, hardgecodeerde status zou gebruiken in
// plaats van door te geven aan dezelfde gedeelde helper als single-add
// (app/actions/events.ts roept exact dezelfde getDefaultAttendance() aan),
// zou dat hier meteen zichtbaar worden (Story-H8).
vi.mock('@/app/actions/settings', () => ({ getDefaultAttendance: vi.fn(async () => 'unknown') }))

import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import {
  BULK_HEADER_LINE,
  MAX_BULK_MATCHES,
  type BulkMatchInput,
} from '@/lib/bulk-matches'
import { CSV_EMPTY_ERROR, CSV_HEADER_ERROR, CSV_TOO_MANY_ERROR } from '@/lib/bulk-matches-csv'
import { MAX_XLSX_SCAN_ROWS, XLSX_TOO_MANY_SCAN_ROWS_ERROR } from '@/lib/bulk-matches-xlsx'
import { createBulkMatches, getExistingMatchKeys, parseBulkMatchFile } from '@/app/actions/events-bulk'

// ────────────────────────────────────────────────
// Test-dubbel voor Supabase — mimickt precies de chain-vorm die
// app/actions/events-bulk.ts gebruikt (.select/.insert/.eq/.in, thenable),
// zodat de ECHTE server actions er ongewijzigd tegenaan kunnen praten.
// ────────────────────────────────────────────────

type QueryResult = { data?: unknown; error?: unknown }
type TableConfig = { select?: QueryResult; insert?: QueryResult }

function makeSupabase(opts: { user?: { id: string } | null; tables?: Record<string, TableConfig> } = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const inserts: { table: string; payload: unknown }[] = []
  const selects: { table: string; eqs: { col: string; val: unknown }[]; inFilter?: { col: string; vals: unknown[] } }[] = []

  function chain(table: string) {
    let kind: 'select' | 'insert' = 'select'
    const eqs: { col: string; val: unknown }[] = []
    let inFilter: { col: string; vals: unknown[] } | undefined
    const c: Record<string, unknown> = {}
    c.select = () => { if (kind !== 'insert') kind = 'select'; return c }
    c.insert = (payload: unknown) => { kind = 'insert'; inserts.push({ table, payload }); return c }
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    c.in = (col: string, vals: unknown[]) => { inFilter = { col, vals }; return c }
    // Datumbereik en sortering van de afmeldperiode-query (zelfde vorm als in
    // createEvent): alleen doorgeven — de eq-lijst blijft de tenant-check.
    c.gte = () => c
    c.lte = () => c
    c.order = () => c
    ;(c as { then: unknown }).then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) => {
      selects.push({ table, eqs: [...eqs], inFilter })
      const cfg = tables[table] ?? {}
      const result = (kind === 'insert' ? cfg.insert : cfg.select) ?? { data: [], error: null }
      return Promise.resolve(result).then(resolve, reject)
    }
    return c
  }

  const supabase = {
    from: (table: string) => chain(table),
    auth: { getUser: async () => ({ data: { user } }) },
  }
  return { supabase, inserts, selects }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

function validRow(overrides: Partial<BulkMatchInput> = {}): BulkMatchInput {
  return {
    date: '2026-09-12',
    time: '14:30',
    opponent: 'FC Voorbeeld',
    home_away: 'home',
    match_type: 'league',
    location: 'Sportpark de Meent',
    gather_time: '13:45',
    notes: 'Shirts mee',
    ...overrides,
  }
}

function csvFile(lines: string[], name = 'wedstrijden.csv'): File {
  return new File([lines.join('\n')], name, { type: 'text/csv' })
}

async function xlsxFile(headers: string[], rows: (string | number)[][], name = 'wedstrijden.xlsx'): Promise<File> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Blad1')
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(row)
  const buffer = await workbook.xlsx.writeBuffer()
  return new File([buffer as unknown as BlobPart], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// Zelfde als xlsxFile, maar zet daarna nog één cel ver onder de laatste
// datarij: dat blaast sheet.rowCount op zonder dat er een extra herkende
// wedstrijd bij komt — het typische "ooit opgemaakte sjabloon met lege rijen
// onderaan"-bestand. Hiermee is de scanrijen-noodrem (MAX_XLSX_SCAN_ROWS) apart
// van de 200-herkende-wedstrijden-limiet te triggeren via de ECHTE, publieke
// parseBulkMatchFile.
async function xlsxFileWithFarCell(
  headers: string[],
  rows: (string | number)[][],
  farRow: number,
  name = 'wedstrijden.xlsx',
): Promise<File> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Blad1')
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(row)
  sheet.getRow(farRow).getCell(1).value = 'x'
  const buffer = await workbook.xlsx.writeBuffer()
  return new File([buffer as unknown as BlobPart], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

function formDataWith(file: File): FormData {
  const fd = new FormData()
  fd.set('file', file)
  return fd
}

const VALID_HEADER = BULK_HEADER_LINE // 'datum;tijd;tegenstander;thuis_uit;wedstrijdtype;locatie;verzameltijd;notities'
const VALID_ROW_LINE = '2026-09-12;14:30;FC Voorbeeld;thuis;competitie;Sportpark de Meent;13:45;Shirts mee'

beforeEach(() => {
  vi.clearAllMocks()
})

// De hele suite draait in een tijdzone áchter UTC, om Story-B5 (geen
// tijdzone-conversie) ook echt te bewijzen voor de .xlsx-datumcellen
// (lib/bulk-matches-xlsx.ts leest ze met getUTC*(), niet met lokale getters).
const ORIGINAL_TZ = process.env.TZ
process.env.TZ = 'America/Los_Angeles'
afterAll(() => { process.env.TZ = ORIGINAL_TZ })

// ────────────────────────────────────────────────
// Bestand inlezen: parseBulkMatchFile
// ────────────────────────────────────────────────

describe('parseBulkMatchFile — Story-H2 (happy path .csv/.xlsx)', () => {
  it('H2a: een .csv met exact het voorgeschreven kolomformaat wordt ingelezen tot previewrijen', async () => {
    use(makeSupabase())
    const fd = formDataWith(csvFile([VALID_HEADER, VALID_ROW_LINE]))
    const result = await parseBulkMatchFile(fd)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      date: '2026-09-12',
      time: '14:30',
      opponent: 'FC Voorbeeld',
      home_away: 'home',
      match_type: 'league',
      location: 'Sportpark de Meent',
      gather_time: '13:45',
      notes: 'Shirts mee',
    })
  })

  it('H2b: een .xlsx met exact het voorgeschreven kolomformaat wordt ingelezen tot dezelfde previewrijen, zonder tijdzone-drift (Story-B5)', async () => {
    use(makeSupabase())
    const file = await xlsxFile(
      ['datum', 'tijd', 'tegenstander', 'thuis_uit', 'wedstrijdtype', 'locatie', 'verzameltijd', 'notities'],
      [['2026-09-12', '14:30', 'FC Voorbeeld', 'thuis', 'competitie', 'Sportpark de Meent', '13:45', 'Shirts mee']],
    )
    const result = await parseBulkMatchFile(formDataWith(file))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      date: '2026-09-12',
      time: '14:30',
      opponent: 'FC Voorbeeld',
      home_away: 'home',
      match_type: 'league',
    })
  })
})

describe('parseBulkMatchFile — Story-F1 (niet ingelogd)', () => {
  it('F1: een niet-ingelogde gebruiker krijgt "Niet ingelogd" en geen rijen, ook al is het bestand geldig', async () => {
    use(makeSupabase({ user: null }))
    const result = await parseBulkMatchFile(formDataWith(csvFile([VALID_HEADER, VALID_ROW_LINE])))
    expect(result).toEqual({ ok: false, error: 'Niet ingelogd' })
  })
})

describe('parseBulkMatchFile — Story-F3 (extensie/corrupt bestand)', () => {
  it('F3a: een .txt-bestand (niet-ondersteunde extensie) wordt geweigerd', async () => {
    use(makeSupabase())
    const file = new File(['datum;tijd'], 'wedstrijden.txt', { type: 'text/plain' })
    const result = await parseBulkMatchFile(formDataWith(file))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('Alleen .csv- en .xlsx-bestanden zijn toegestaan.')
  })

  it('F3b: een corrupt .xlsx-bestand (verkeerde magic bytes) wordt geweigerd, niet stilzwijgend "leeg" verwerkt', async () => {
    use(makeSupabase())
    const file = new File(['dit is geen echte xlsx-inhoud'], 'wedstrijden.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const result = await parseBulkMatchFile(formDataWith(file))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('Dit lijkt geen geldig .xlsx-bestand te zijn.')
  })

  it('F3c: een binair/niet-tekst .csv-bestand wordt geweigerd', async () => {
    use(makeSupabase())
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0x00, 0x10])
    const file = new File([bytes], 'wedstrijden.csv', { type: 'text/csv' })
    const result = await parseBulkMatchFile(formDataWith(file))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('Dit bestand is geen leesbare tekst. Sla het op als CSV met UTF-8-codering.')
  })

  it('F3d: een leeg bestand (0 bytes) wordt geweigerd', async () => {
    use(makeSupabase())
    const file = new File([], 'wedstrijden.csv', { type: 'text/csv' })
    const result = await parseBulkMatchFile(formDataWith(file))
    expect(result).toEqual({ ok: false, error: 'Kies een .csv- of .xlsx-bestand.' })
  })
})

describe('parseBulkMatchFile — Story-F4 (afwijkend kolomformaat, geen poging tot alsnog herkennen)', () => {
  it('F4a: .csv met een ontbrekende kolom wordt volledig geweigerd (geen poging tot herkennen)', async () => {
    use(makeSupabase())
    const badHeader = 'datum;tijd;tegenstander;thuis_uit;wedstrijdtype;locatie;notities' // verzameltijd ontbreekt
    const result = await parseBulkMatchFile(formDataWith(csvFile([badHeader, VALID_ROW_LINE])))
    expect(result).toEqual({ ok: false, error: CSV_HEADER_ERROR })
  })

  it('F4b: .csv met kolommen in de verkeerde volgorde wordt volledig geweigerd', async () => {
    use(makeSupabase())
    const reordered = 'tijd;datum;tegenstander;thuis_uit;wedstrijdtype;locatie;verzameltijd;notities'
    const result = await parseBulkMatchFile(formDataWith(csvFile([reordered, VALID_ROW_LINE])))
    expect(result).toEqual({ ok: false, error: CSV_HEADER_ERROR })
  })

  it('F4c: .xlsx met een afwijkende kopregel wordt volledig geweigerd', async () => {
    use(makeSupabase())
    const file = await xlsxFile(
      ['datum', 'tijd', 'tegenstander', 'thuis_uit', 'wedstrijdtype', 'notities'], // locatie/verzameltijd ontbreken
      [['2026-09-12', '14:30', 'FC Voorbeeld', 'thuis', 'competitie', '']],
    )
    const result = await parseBulkMatchFile(formDataWith(file))
    expect(result).toEqual({ ok: false, error: CSV_HEADER_ERROR })
  })
})

describe('parseBulkMatchFile — Story-E6 (bestand met alleen headerregel)', () => {
  it('E6: een .csv met uitsluitend de kopregel levert geen (lege) tabel op, wel een duidelijke melding', async () => {
    use(makeSupabase())
    const result = await parseBulkMatchFile(formDataWith(csvFile([VALID_HEADER])))
    expect(result).toEqual({ ok: false, error: CSV_EMPTY_ERROR })
  })
})

describe('parseBulkMatchFile — Story-B9 (preview-limiet van 200)', () => {
  it('201 herkende wedstrijden in een .csv worden volledig geweigerd (preview-limiet)', async () => {
    use(makeSupabase())
    const lines = Array.from({ length: 201 }, (_, i) =>
      `2026-09-${String((i % 27) + 1).padStart(2, '0')};14:30;Tegenstander ${i};thuis;competitie;;;`)
    const result = await parseBulkMatchFile(formDataWith(csvFile([VALID_HEADER, ...lines])))
    expect(result).toEqual({ ok: false, error: CSV_TOO_MANY_ERROR })
  })
})

// ────────────────────────────────────────────────
// Twee losse xlsx-noodremmen die niet met elkaar verward mogen worden: de
// >10.000-ruwe-scanrijen-noodrem (XLSX_TOO_MANY_SCAN_ROWS_ERROR, vóórdat er
// ook maar één wedstrijd is ingelezen) versus de >200-herkende-wedstrijden-
// preview-limiet (CSV_TOO_MANY_ERROR, hierboven ook voor .csv bewezen). Beide
// via de ECHTE, publieke parseBulkMatchFile — niet via de interne
// parseMatchesFromXlsx rechtstreeks.
// ────────────────────────────────────────────────

const XLSX_HEADERS = ['datum', 'tijd', 'tegenstander', 'thuis_uit', 'wedstrijdtype', 'locatie', 'verzameltijd', 'notities']

describe('parseBulkMatchFile — xlsx: scanrijen-noodrem vs. 200-wedstrijden-limiet zijn twee verschillende meldingen', () => {
  it('een .xlsx met meer dan 10.000 ruwe (grotendeels lege) rijen krijgt de scanrijen-melding, niet de 200-limietmelding', async () => {
    use(makeSupabase())
    const file = await xlsxFileWithFarCell(
      XLSX_HEADERS,
      [['2026-09-12', '14:30', 'FC Voorbeeld', 'thuis', 'competitie', 'Sportpark de Meent', '13:45', 'Shirts mee']],
      MAX_XLSX_SCAN_ROWS + 2,
    )
    const result = await parseBulkMatchFile(formDataWith(file))
    expect(result).toEqual({ ok: false, error: XLSX_TOO_MANY_SCAN_ROWS_ERROR })
    if (result.ok) throw new Error('unreachable')
    expect(result.error).not.toBe(CSV_TOO_MANY_ERROR)
    expect(result.error).not.toContain('wedstrijden')
  })

  it('een .xlsx met 201 daadwerkelijk herkende wedstrijden (geen enorme lege staart) krijgt de 200-limietmelding, niet de scanrijen-melding', async () => {
    use(makeSupabase())
    const rows = Array.from({ length: 201 }, (_, i) => [
      `2026-09-${String((i % 27) + 1).padStart(2, '0')}`, '14:30', `Tegenstander ${i}`, 'thuis', 'competitie', '', '', '',
    ])
    const file = await xlsxFile(XLSX_HEADERS, rows)
    const result = await parseBulkMatchFile(formDataWith(file))
    expect(result).toEqual({ ok: false, error: CSV_TOO_MANY_ERROR })
    if (result.ok) throw new Error('unreachable')
    expect(result.error).not.toBe(XLSX_TOO_MANY_SCAN_ROWS_ERROR)
  })
})

// ────────────────────────────────────────────────
// Opslaan: createBulkMatches
// ────────────────────────────────────────────────

function eventsPlayersAttendanceOk(extra: Record<string, TableConfig> = {}) {
  return makeSupabase({
    tables: {
      // Met datum: de attendance-stap bepaalt per wedstrijd welke afmeldperiode
      // die dag dekt (app/actions/events-bulk.ts, spiegelt createEvent).
      events: { insert: { data: [{ id: 'e1', date: '2026-09-12' }, { id: 'e2', date: '2026-09-19' }], error: null } },
      players: { select: { data: [{ id: 'p1' }, { id: 'p2' }], error: null } },
      attendance: { insert: { data: null, error: null } },
      ...extra,
    },
  })
}

describe('createBulkMatches — Story-F1 (niet ingelogd)', () => {
  it('F1: niet ingelogd → wordt geweigerd, er wordt niets opgeslagen', async () => {
    use(makeSupabase({ user: null }))
    await expect(createBulkMatches([validRow()])).rejects.toThrow('Niet ingelogd')
  })
})

describe('createBulkMatches — Story-H7/H9 (bulk-insert met de juiste velden)', () => {
  it('H7: geldige rijen worden in één keer opgeslagen, met het aantal in het resultaat', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    const result = await createBulkMatches([validRow(), validRow({ date: '2026-09-19', opponent: 'SV Tweede' })])
    expect(result).toEqual({ created: 2, attendanceFailed: false })
    expect(mock.inserts.filter((i) => i.table === 'events')).toHaveLength(1)
  })

  it('H9: de opgeslagen wedstrijd bevat exact de verplichte velden (date, match_type, opponent, home_away) en de optionele velden', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    await createBulkMatches([validRow()])
    const payload = mock.inserts.find((i) => i.table === 'events')!.payload as Record<string, unknown>[]
    expect(payload[0]).toMatchObject({
      date: '2026-09-12',
      match_type: 'league',
      opponent: 'FC Voorbeeld',
      home_away: 'home',
      time: '14:30',
      gather_time: '13:45',
      location: 'Sportpark de Meent',
      notes: 'Shirts mee',
    })
  })

  it('H9b: optionele velden die leeg zijn, worden null (niet afgedwongen verplicht)', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    await createBulkMatches([validRow({ time: null, gather_time: null, location: null, notes: null })])
    const payload = mock.inserts.find((i) => i.table === 'events')!.payload as Record<string, unknown>[]
    expect(payload[0].time).toBeNull()
    expect(payload[0].gather_time).toBeNull()
    expect(payload[0].location).toBeNull()
    expect(payload[0].notes).toBeNull()
  })
})

describe('createBulkMatches — Story-B2 (datum JJJJ-MM-DD, tijd optioneel maar geldig indien ingevuld)', () => {
  it('een niet-bestaande datum (2026-13-40) wordt geweigerd', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    const bad = { ...validRow(), date: '2026-13-40' } as unknown as BulkMatchInput
    await expect(createBulkMatches([bad])).rejects.toThrow('Ongeldige datum')
    expect(mock.inserts).toHaveLength(0)
  })

  it('een lege datum (verplicht) wordt geweigerd', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    const bad = { ...validRow(), date: '' } as unknown as BulkMatchInput
    await expect(createBulkMatches([bad])).rejects.toThrow('Ongeldige datum')
  })

  it('een ongeldige tijd (25:99) wordt geweigerd, ook al is tijd optioneel', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    await expect(createBulkMatches([validRow({ time: '25:99' })])).rejects.toThrow('Ongeldig tijdstip')
  })

  it('een ontbrekende (null) tijd is wél toegestaan — tijd is optioneel', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    const result = await createBulkMatches([validRow({ time: null })])
    expect(typeof result.created).toBe('number')
    expect(mock.inserts.some((i) => i.table === 'events')).toBe(true)
  })

  it('een ongeldige verzameltijd wordt eveneens geweigerd', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    await expect(createBulkMatches([validRow({ gather_time: '99:99' })])).rejects.toThrow('Ongeldig tijdstip')
  })
})

describe('createBulkMatches — Story-B1 (team_id altijd uit sessie)', () => {
  it('een meegestuurde team_id in de rij wordt genegeerd; opgeslagen team_id komt uit de sessie', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    const maliciousRow = { ...validRow(), team_id: 'evil-team' } as unknown as BulkMatchInput
    await createBulkMatches([maliciousRow])
    const payload = mock.inserts.find((i) => i.table === 'events')!.payload as Record<string, unknown>[]
    expect(payload[0].team_id).toBe('team-1')
  })
})

describe('createBulkMatches — Story-B6 (uitsluitend type = match)', () => {
  it('elke opgeslagen rij krijgt hardgecodeerd type "match"', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    await createBulkMatches([validRow()])
    const payload = mock.inserts.find((i) => i.table === 'events')!.payload as Record<string, unknown>[]
    expect(payload[0].type).toBe('match')
  })
})

describe('createBulkMatches — Story-B5 (geen tijdzone-conversie)', () => {
  it('datum en tijd worden als kale strings doorgegeven, exact zoals ingevoerd', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    await createBulkMatches([validRow({ date: '2026-09-12', time: '14:30' })])
    const payload = mock.inserts.find((i) => i.table === 'events')!.payload as Record<string, unknown>[]
    expect(payload[0].date).toBe('2026-09-12')
    expect(typeof payload[0].date).toBe('string')
    expect(payload[0].time).toBe('14:30')
  })
})

describe('createBulkMatches — Story-H8 (attendance na succesvol opslaan)', () => {
  it('maakt attendance-records voor alle actieve spelers per opgeslagen wedstrijd, met dezelfde default-status als single-add', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    await createBulkMatches([validRow(), validRow({ date: '2026-09-19', opponent: 'SV Tweede' })])

    const attendanceInsert = mock.inserts.find((i) => i.table === 'attendance')!
    const records = attendanceInsert.payload as { event_id: string; player_id: string; status: string; team_id: string }[]
    // 2 wedstrijden × 2 actieve spelers
    expect(records).toHaveLength(4)
    expect(new Set(records.map((r) => r.event_id))).toEqual(new Set(['e1', 'e2']))
    expect(new Set(records.map((r) => r.player_id))).toEqual(new Set(['p1', 'p2']))
    for (const r of records) {
      // 'unknown' is de gemockte terugkeerwaarde van de GEDEELDE getDefaultAttendance()
      // (zelfde helper als app/actions/events.ts voor single-add) — geen eigen,
      // afwijkende default in de bulk-actie.
      expect(r.status).toBe('unknown')
      expect(r.team_id).toBe('team-1')
    }
  })
})

describe('createBulkMatches — Story-F8 (opslaan faalt: alles-of-niets)', () => {
  it('als de insert naar events faalt, wordt er niets opgeslagen en komt er een foutmelding (geen ruwe DB-fout)', async () => {
    const mock = makeSupabase({
      tables: { events: { insert: { data: null, error: { code: '23505', message: 'duplicate key' } } } },
    })
    use(mock)
    await expect(createBulkMatches([validRow()])).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(mock.inserts.filter((i) => i.table === 'attendance')).toHaveLength(0)
  })
})

describe('createBulkMatches — afmeldperiode-integratie (per-event-datum, niet per-batch)', () => {
  it('een speler met een dekkende afmeldperiode krijgt status absent + de bijbehorende absence_period_id, alleen voor de wedstrijd(en) binnen die periode — een andere wedstrijd in dezelfde batch op een niet-gedekte datum krijgt gewoon de default-status', async () => {
    const mock = makeSupabase({
      tables: {
        events: {
          insert: {
            data: [{ id: 'e1', date: '2026-09-12' }, { id: 'e2', date: '2026-09-19' }],
            error: null,
          },
        },
        players: { select: { data: [{ id: 'p1' }], error: null } },
        absence_periods: {
          select: {
            data: [{ id: 'ap-1', player_id: 'p1', from_date: '2026-09-10', to_date: '2026-09-15' }],
            error: null,
          },
        },
        attendance: { insert: { data: null, error: null } },
      },
    })
    use(mock)

    const result = await createBulkMatches([
      validRow({ date: '2026-09-12', opponent: 'FC Voorbeeld' }),
      validRow({ date: '2026-09-19', opponent: 'SV Tweede' }),
    ])
    expect(result).toEqual({ created: 2, attendanceFailed: false })

    const attendanceInsert = mock.inserts.find((i) => i.table === 'attendance')!
    const records = attendanceInsert.payload as
      { event_id: string; player_id: string; status: string; absence_period_id: string | null }[]
    const forDekkendeDatum = records.find((r) => r.event_id === 'e1')!
    const forNietDekkendeDatum = records.find((r) => r.event_id === 'e2')!

    // 12 sept valt binnen de afmeldperiode (10-15 sept): absent + herkomst.
    expect(forDekkendeDatum.status).toBe('absent')
    expect(forDekkendeDatum.absence_period_id).toBe('ap-1')
    // 19 sept valt BUITEN diezelfde periode: gewoon de gedeelde default-status
    // ('unknown' is hier de sentinel-mock van getDefaultAttendance, zie kop van
    // dit bestand), geen absence_period_id. Dit bewijst dat de beoordeling per
    // event-datum gebeurt, niet één datum voor de hele batch.
    expect(forNietDekkendeDatum.status).toBe('unknown')
    expect(forNietDekkendeDatum.absence_period_id).toBeNull()

    // Team-scoping van de periodes-query, expliciet naast de RLS-policy.
    const periodsSelect = mock.selects.find((s) => s.table === 'absence_periods')!
    expect(periodsSelect.eqs).toContainEqual({ col: 'team_id', val: 'team-1' })
  })
})

describe('createBulkMatches — Story-F9 (wedstrijden ok, attendance faalt: geen rollback)', () => {
  it('wedstrijden blijven staan (created > 0, geen throw) en attendanceFailed wordt true', async () => {
    const mock = eventsPlayersAttendanceOk({ attendance: { insert: { data: null, error: { code: '500' } } } })
    use(mock)
    const result = await createBulkMatches([validRow(), validRow({ date: '2026-09-19', opponent: 'SV Tweede' })])
    expect(result).toEqual({ created: 2, attendanceFailed: true })
  })
})

describe('createBulkMatches — Story-E1/B9 (grens van 100)', () => {
  it('E1: precies 100 rijen slaagt (grenswaarde)', async () => {
    const mock = makeSupabase({
      tables: {
        events: {
          insert: {
            data: Array.from({ length: 100 }, (_, i) => ({
              id: `e${i}`,
              date: `2026-09-${String((i % 27) + 1).padStart(2, '0')}`,
            })),
            error: null,
          },
        },
        players: { select: { data: [], error: null } },
      },
    })
    use(mock)
    const rows = Array.from({ length: MAX_BULK_MATCHES }, (_, i) =>
      validRow({ date: `2026-09-${String((i % 27) + 1).padStart(2, '0')}`, opponent: `Tegenstander ${i}` }))
    const result = await createBulkMatches(rows)
    expect(result.created).toBe(100)
  })

  it('B9: 101 rijen wordt geweigerd, met het maximum in de melding', async () => {
    use(eventsPlayersAttendanceOk())
    const rows = Array.from({ length: MAX_BULK_MATCHES + 1 }, (_, i) =>
      validRow({ date: `2026-09-${String((i % 27) + 1).padStart(2, '0')}`, opponent: `Tegenstander ${i}` }))
    await expect(createBulkMatches(rows)).rejects.toThrow(`Maximaal ${MAX_BULK_MATCHES} wedstrijden tegelijk`)
  })
})

describe('createBulkMatches — Story-B4 (te lange/lege waarden worden geweigerd, niet afgekapt)', () => {
  it('een tegenstander >100 tekens wordt geweigerd (niet stilzwijgend afgekapt)', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    await expect(createBulkMatches([validRow({ opponent: 'x'.repeat(101) })])).rejects.toThrow('Ongeldige tegenstander')
    expect(mock.inserts).toHaveLength(0)
  })

  it('een lege tegenstander wordt geweigerd', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    await expect(createBulkMatches([validRow({ opponent: '' })])).rejects.toThrow('Ongeldige tegenstander')
    expect(mock.inserts).toHaveLength(0)
  })

  it('een locatie >200 tekens wordt geweigerd', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    await expect(createBulkMatches([validRow({ location: 'x'.repeat(201) })])).rejects.toThrow('Ongeldige locatie')
  })

  it('notities >2000 tekens worden geweigerd', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    await expect(createBulkMatches([validRow({ notes: 'x'.repeat(2001) })])).rejects.toThrow('Ongeldige notities')
  })
})

describe('createBulkMatches — Story-B3 (whitelists worden ook server-side gehandhaafd)', () => {
  it('een ongeldig match_type wordt geweigerd, ook al komt het "geldig getypeerd" binnen', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    const bad = { ...validRow(), match_type: 'onzin' } as unknown as BulkMatchInput
    await expect(createBulkMatches([bad])).rejects.toThrow('Ongeldig wedstrijdtype')
  })

  it('een ongeldige home_away wordt geweigerd', async () => {
    const mock = eventsPlayersAttendanceOk()
    use(mock)
    const bad = { ...validRow(), home_away: 'ergens' } as unknown as BulkMatchInput
    await expect(createBulkMatches([bad])).rejects.toThrow('Ongeldig thuis/uit')
  })
})

// ────────────────────────────────────────────────
// Duplicaatcontrole: getExistingMatchKeys
// ────────────────────────────────────────────────

describe('getExistingMatchKeys — Story-F1 (niet ingelogd)', () => {
  it('niet ingelogd → geweigerd', async () => {
    use(makeSupabase({ user: null }))
    await expect(getExistingMatchKeys(['2026-09-12'])).rejects.toThrow('Niet ingelogd')
  })
})

describe('getExistingMatchKeys — Story-B1/E3 (tenant-scoped, alleen wedstrijden)', () => {
  it('geeft bestaande {date, opponent}-paren terug, gefilterd op team_id en type=match', async () => {
    const mock = makeSupabase({
      tables: { events: { select: { data: [{ date: '2026-09-12', opponent: 'FC Dubbel' }], error: null } } },
    })
    use(mock)
    const result = await getExistingMatchKeys(['2026-09-12'])
    expect(result).toEqual([{ date: '2026-09-12', opponent: 'FC Dubbel' }])

    const call = mock.selects.find((s) => s.table === 'events')!
    expect(call.eqs).toContainEqual({ col: 'team_id', val: 'team-1' })
    expect(call.eqs).toContainEqual({ col: 'type', val: 'match' })
    expect(call.inFilter?.col).toBe('date')
    expect(call.inFilter?.vals).toContain('2026-09-12')
  })
})
