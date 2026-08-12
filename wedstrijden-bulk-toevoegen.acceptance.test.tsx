// Acceptatietests — Wedstrijden bulk toevoegen (user story: als trainer in één
// keer een heel programma aan wedstrijden importeren, via vrije tekst of een
// .csv-/.xlsx-bestand, met een controleerbare/bewerkbare preview voordat er
// iets wordt opgeslagen).
//
// ── Testmethode ──
// Rendert de ECHTE orkestrator-pagina (app/events/bulk/page.tsx) met RTL.
// 'next/navigation' is gestubd (precedent: MatchSquadEditor.test.tsx). Anders
// dan de eerdere versie van dit bestand worden de server actions uit
// app/actions/events-bulk.ts NIET meer als geheel gemockt: alleen de externe
// rand (Supabase, next/cache, de losstaande settings-actie) wordt gestubd,
// zodat getExistingMatchKeys en createBulkMatches ECHT draaien — inclusief
// hun validatie, tenant-scoping en foutafhandeling. Dat maakt bv. de
// "niet ingelogd bij bevestigen"- en "duplicaat toch opslaan"-scenario's een
// echte end-to-end-toets in plaats van een doorgegeven mock-resultaat.
//
// Uitzondering: parseBulkMatchFile (het bestandsupload-pad) blijft gemockt.
// Reden: die functie roept file.arrayBuffer() aan (app/actions/events-bulk.ts),
// en jsdom's File-implementatie in deze omgeving mist die methode (geverifieerd
// met een losse smoke-test: werkt niet onder jsdom, wél onder Node/undici).
// De ECHTE bestandsparsing (.csv/.xlsx, kolomformaat, corrupte bestanden,
// >200-limiet) wordt daarom bewezen in het companion-bestand
// wedstrijden-bulk-toevoegen-serveracties.acceptance.test.ts (@vitest-environment
// node), dat parseBulkMatchFile ongewijzigd, echt aanroept. Dit bestand bewijst
// voor het bestandspad alleen de UI-bedrading (bestand kiezen → verwerken →
// preview) plus het CLIENT-SIDE extensie-voorfilter, dat wél zonder
// arrayBuffer werkt (components/BulkMatchInput.tsx leest alleen file.name).
//
// De tekstparser (lib/bulk-matches-text.ts) draait overal ECHT — dat is puur
// client-side regex-logica, geen serverronde nodig — en wordt daarom als
// primaire route gebruikt om previewrijen met specifieke inhoud te krijgen
// (twijfelgevallen, duplicaten, aantallen op de grens).
//
// Criteria-codes verwijzen naar de goedgekeurde story: H = happy path,
// F = faalpad, B = businessregel, E = edge case. Zie ook het companion-bestand
// hierboven voor H2, F1(bestand)/F3/F4/E6(bestand), B9(preview-limiet 200) en
// H8/H9/B1/B4/B5/B6/F8/F9/E1 (serverkant van opslaan/attendance).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { MAX_BULK_MATCHES, BULK_HEADER_LINE, type ParsedMatchRow } from '@/lib/bulk-matches'
import { TEXT_NO_MATCHES_ERROR } from '@/lib/bulk-matches-text'
import BulkMatchesPage from '@/app/events/bulk/page'
import GlobalFab from '@/components/GlobalFab'

vi.mock('next/navigation', () => {
  const push = vi.fn()
  return {
    usePathname: () => '/events/bulk',
    useRouter: () => ({ push, back: vi.fn(), refresh: vi.fn() }),
  }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// Losstaande feature; vastgezet zodat deze UI-tests niet van instellingen-gedrag
// afhangen (zelfde motivatie als het companion-serveracties-bestand).
vi.mock('@/app/actions/settings', () => ({ getDefaultAttendance: vi.fn(async () => 'present') }))

// Alleen parseBulkMatchFile wordt gemockt (zie bestandskop hierboven); de rest
// van de module blijft de ECHTE implementatie.
vi.mock('@/app/actions/events-bulk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/actions/events-bulk')>()
  return { ...actual, parseBulkMatchFile: vi.fn() }
})

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { parseBulkMatchFile } from '@/app/actions/events-bulk'

const mockParseBulkMatchFile = parseBulkMatchFile as unknown as ReturnType<typeof vi.fn>

// ────────────────────────────────────────────────
// Supabase-testdubbel — zelfde chain-vorm als het companion-bestand, zodat de
// ECHTE getExistingMatchKeys/createBulkMatches er ongewijzigd tegenaan praten.
// ────────────────────────────────────────────────

type QueryResult = { data?: unknown; error?: unknown }
type TableConfig = { select?: QueryResult; insert?: QueryResult }

function makeSupabase(opts: { user?: { id: string } | null; tables?: Record<string, TableConfig> } = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const inserts: { table: string; payload: unknown }[] = []

  function chain(table: string) {
    let kind: 'select' | 'insert' = 'select'
    const c: Record<string, unknown> = {}
    c.select = () => { if (kind !== 'insert') kind = 'select'; return c }
    c.insert = (payload: unknown) => { kind = 'insert'; inserts.push({ table, payload }); return c }
    c.eq = () => c
    c.in = () => c
    ;(c as { then: unknown }).then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) => {
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
  return { supabase, inserts }
}

function useSupabase(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

// Standaard: ingelogd, geen bestaande wedstrijden, opslaan lukt, geen actieve
// spelers (attendance-stap is dan een no-op — die kant wordt in het
// companion-bestand bewezen, hier gaat het om de UI-flow).
function defaultSupabase(extra: Record<string, TableConfig> = {}) {
  return makeSupabase({
    tables: {
      events: {
        select: { data: [], error: null },
        insert: { data: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }], error: null },
      },
      players: { select: { data: [], error: null } },
      ...extra,
    },
  })
}

function renderPage() {
  return render(
    <DictProvider dict={nl}>
      <BulkMatchesPage />
    </DictProvider>,
  )
}

async function pasteText(lines: string[]) {
  const textarea = screen.getByLabelText(nl.event.bulk.pasteLabel)
  fireEvent.change(textarea, { target: { value: lines.join('\n') } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: nl.event.bulk.process }))
  })
}

function makeRow(overrides: Partial<ParsedMatchRow> = {}): ParsedMatchRow {
  return {
    id: 'r0',
    date: '2026-09-12',
    time: '14:30',
    opponent: 'FC Voorbeeld',
    home_away: 'home',
    match_type: 'league',
    location: 'Sportpark de Meent',
    gather_time: '13:45',
    notes: '',
    uncertain: [],
    sourceLine: null,
    ...overrides,
  }
}

async function uploadRows(rows: ParsedMatchRow[]) {
  mockParseBulkMatchFile.mockResolvedValueOnce({ ok: true, rows })
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['datum;tijd;tegenstander'], 'wedstrijden.csv', { type: 'text/csv' })
  await act(async () => {
    fireEvent.change(fileInput, { target: { files: [file] } })
  })
  const processButton = screen.getByRole('button', { name: nl.event.bulk.process })
  await act(async () => {
    fireEvent.click(processButton)
  })
}

async function clickSave() {
  const saveButton = screen.getByRole('button', { name: nl.event.bulk.save })
  await act(async () => {
    fireEvent.click(saveButton)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useSupabase(defaultSupabase())
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

// ────────────────────────────────────────────────
// Story-H1 — Tekst plakken → preview met alle herkenbare velden
// ────────────────────────────────────────────────

describe('Story-H1 — Plakken → preview', () => {
  it('drie herkenbare regels tekst leveren een preview met 3 rijen op', async () => {
    renderPage()
    await pasteText([
      '2026-09-12 14:30 thuis competitie DVC',
      '2026-09-19 12:00 uit competitie SV Tweede',
      '2026-09-26 15:00 thuis beker VV Derde',
    ])

    expect(screen.getByText(nl.event.bulk.rowCount.replace('{count}', '3'))).toBeInTheDocument()
    expect(screen.getAllByLabelText(nl.event.bulk.columnHeaders.opponent)).toHaveLength(3)
  })

  it('een herkende regel toont datum, tijd, tegenstander, thuis/uit en wedstrijdtype correct in de preview-velden', async () => {
    renderPage()
    await pasteText(['12 sep 2026 14:30 thuis competitie DVC'])

    const dateInput = screen.getByLabelText(nl.event.bulk.columnHeaders.date) as HTMLInputElement
    const timeInput = screen.getByLabelText(nl.event.bulk.columnHeaders.time) as HTMLInputElement
    const opponentInput = screen.getByLabelText(nl.event.bulk.columnHeaders.opponent) as HTMLInputElement
    const homeAwaySelect = screen.getByLabelText(nl.event.bulk.columnHeaders.home_away) as HTMLSelectElement
    const matchTypeSelect = screen.getByLabelText(nl.event.bulk.columnHeaders.match_type) as HTMLSelectElement

    expect(dateInput.value).toBe('2026-09-12')
    expect(timeInput.value).toBe('14:30')
    expect(opponentInput.value).toBe('DVC')
    expect(homeAwaySelect.value).toBe('home')
    expect(matchTypeSelect.value).toBe('league')
  })
})

describe('Story-F2 — Onherkenbare/lege tekst', () => {
  it('onherkenbare tekst (geen datum) toont een melding en géén tabel', async () => {
    renderPage()
    await pasteText(['Dit is geen wedstrijd, gewoon een zin.'])

    expect(screen.getByText(TEXT_NO_MATCHES_ERROR)).toBeInTheDocument()
    expect(document.querySelector('table')).not.toBeInTheDocument()
  })

  it('E6: een volledig leeg tekstveld levert een duidelijke melding op, geen (lege) tabel', async () => {
    renderPage()
    const processButton = screen.getByRole('button', { name: nl.event.bulk.process })
    expect(processButton).toBeDisabled()
    // Plakken en weer wissen: process-knop blijft uitgeschakeld zolang er geen
    // tekst/bestand is; er is dus sowieso geen manier om een lege set te
    // "verwerken" tot een tabel.
    const textarea = screen.getByLabelText(nl.event.bulk.pasteLabel)
    fireEvent.change(textarea, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: nl.event.bulk.process })).toBeDisabled()
    expect(document.querySelector('table')).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// Story-H5/H6 — bewerken/verwijderen in de preview
// ────────────────────────────────────────────────

describe('Story-H5 — Preview bewerken', () => {
  it('een veld bewerken zet de gewijzigde waarde zichtbaar vóór opslaan, en in de daadwerkelijke insert-payload', async () => {
    const mock = defaultSupabase()
    useSupabase(mock)
    renderPage()
    await uploadRows([makeRow({ id: 'r0', opponent: 'Oude Naam' })])

    const opponentInput = screen.getByLabelText(nl.event.bulk.columnHeaders.opponent) as HTMLInputElement
    fireEvent.change(opponentInput, { target: { value: 'Nieuwe Naam' } })
    expect(opponentInput.value).toBe('Nieuwe Naam')

    await clickSave()

    const payload = mock.inserts.find((i) => i.table === 'events')!.payload as { opponent: string }[]
    expect(payload).toHaveLength(1)
    expect(payload[0].opponent).toBe('Nieuwe Naam')
  })
})

describe('Story-H6 — Preview: rij verwijderen', () => {
  it('een rij verwijderen zorgt dat die rij niet in de opgeslagen payload zit', async () => {
    const mock = defaultSupabase()
    useSupabase(mock)
    renderPage()
    await uploadRows([
      makeRow({ id: 'r0', date: '2026-09-12', opponent: 'Blijft Staan' }),
      makeRow({ id: 'r1', date: '2026-09-19', opponent: 'Wordt Verwijderd' }),
    ])

    const removeButtons = screen.getAllByRole('button', { name: nl.event.bulk.remove })
    fireEvent.click(removeButtons[1])

    await clickSave()

    const payload = mock.inserts.find((i) => i.table === 'events')!.payload as { opponent: string }[]
    expect(payload).toHaveLength(1)
    expect(payload.some((r) => r.opponent === 'Wordt Verwijderd')).toBe(false)
    expect(payload[0].opponent).toBe('Blijft Staan')
  })
})

// ────────────────────────────────────────────────
// Story-H7 — Bevestigen (echte createBulkMatches, geen mock)
// ────────────────────────────────────────────────

describe('Story-H7 — Bevestigen', () => {
  it('bevestigen toont een bevestiging met het aantal opgeslagen wedstrijden, blijft op /events/bulk staan en navigeert pas naar /events na een klik op de knop', async () => {
    const mock = defaultSupabase({
      events: { select: { data: [], error: null }, insert: { data: [{ id: 'e1' }, { id: 'e2' }], error: null } },
    })
    useSupabase(mock)
    renderPage()
    await pasteText([
      '2026-09-12 14:30 thuis competitie DVC',
      '2026-09-19 12:00 uit competitie SV Tweede',
    ])

    await clickSave()

    // De melding blijft zichtbaar — geen stille navigatie in dezelfde tick.
    expect(screen.getByText(nl.event.bulk.savedCount.replace('{count}', '2'))).toBeInTheDocument()
    const { push } = useRouter()
    expect(push).not.toHaveBeenCalledWith('/events')

    fireEvent.click(screen.getByRole('button', { name: nl.event.bulk.backToEvents }))
    expect(push).toHaveBeenCalledWith('/events')
  })

  it('attendanceFailed: zowel het succes als de aanwezigheidswaarschuwing zijn zichtbaar (geen foutmelding), en blijven zichtbaar totdat de trainer zelf doorgaat', async () => {
    const mock = defaultSupabase({
      events: { select: { data: [], error: null }, insert: { data: [{ id: 'e1' }], error: null } },
      players: { select: { data: [{ id: 'p1' }], error: null } },
      attendance: { insert: { data: null, error: { code: '500' } } },
    })
    useSupabase(mock)
    renderPage()
    await pasteText(['2026-09-12 14:30 thuis competitie DVC'])

    await clickSave()

    expect(screen.getByText(nl.event.bulk.savedCount.replace('{count}', '1'))).toBeInTheDocument()
    expect(screen.getByText(nl.event.bulk.attendanceWarning)).toBeInTheDocument()
    // Story-F9: dit is een waarschuwing, geen (rode) foutmelding.
    const warning = screen.getByText(nl.event.bulk.attendanceWarning)
    expect(warning.className).not.toMatch(/red/)
    const { push } = useRouter()
    expect(push).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: nl.event.bulk.backToEvents }))
    expect(push).toHaveBeenCalledWith('/events')
  })
})

describe('Story-F1 — Niet ingelogd bij bevestigen', () => {
  it('sessie verlopen vóór opslaan → niets opgeslagen, melding "Niet ingelogd"', async () => {
    renderPage()
    await pasteText(['2026-09-12 14:30 thuis competitie DVC'])

    // Sessie is inmiddels verlopen: de eerstvolgende Supabase-aanroep (in
    // createBulkMatches) ziet geen gebruiker meer.
    useSupabase(makeSupabase({ user: null }))

    await clickSave()

    expect(screen.getByText('Niet ingelogd')).toBeInTheDocument()
    expect(screen.queryByText(/opgeslagen/)).not.toBeInTheDocument()
  })
})

describe('Story-F8 — Opslaan faalt: alles-of-niets', () => {
  it('als de insert faalt, wordt er niets opgeslagen en verschijnt een foutmelding', async () => {
    useSupabase(makeSupabase({
      tables: {
        events: { select: { data: [], error: null }, insert: { data: null, error: { code: '23505' } } },
      },
    }))
    renderPage()
    await pasteText(['2026-09-12 14:30 thuis competitie DVC'])

    await clickSave()

    expect(screen.queryByText(/opgeslagen/)).not.toBeInTheDocument()
    expect(screen.getByText('Er ging iets mis. Probeer het opnieuw.')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// Story-F5/F6 — Twijfelgeval en blokkades
// ────────────────────────────────────────────────

describe('Story-F5/E5 — Twijfelgeval (nooit gegokt)', () => {
  it('een dubbelzinnige datum ("01-02-2026") blijft LEEG in de preview en krijgt een twijfelgeval-markering die opslaan blokkeert', async () => {
    renderPage()
    await pasteText(['01-02-2026 14:30 thuis competitie DVC'])

    const dateInput = screen.getByLabelText(nl.event.bulk.columnHeaders.date) as HTMLInputElement
    expect(dateInput.value).toBe('')

    const saveButton = screen.getByRole('button', { name: nl.event.bulk.save })
    expect(saveButton).toBeDisabled()
    expect(screen.getByText(nl.event.bulk.errorBlocked)).toBeInTheDocument()
    expect(screen.getByText(/01-02-2026 14:30 thuis competitie DVC/)).toBeInTheDocument()
  })
})

describe('Story-F6 — Ontbrekend verplicht veld blokkeert opslaan', () => {
  it('een verplicht veld leegmaken in de preview blokkeert opslaan tot het hersteld is', async () => {
    renderPage()
    await pasteText(['2026-09-12 14:30 thuis competitie DVC'])

    const saveButtonBefore = screen.getByRole('button', { name: nl.event.bulk.save })
    expect(saveButtonBefore).toBeEnabled()

    const opponentInput = screen.getByLabelText(nl.event.bulk.columnHeaders.opponent) as HTMLInputElement
    fireEvent.change(opponentInput, { target: { value: '' } })

    expect(screen.getByRole('button', { name: nl.event.bulk.save })).toBeDisabled()
    expect(screen.getByText(nl.event.bulk.fieldRequired)).toBeInTheDocument()

    // Herstellen maakt opslaan weer mogelijk.
    fireEvent.change(opponentInput, { target: { value: 'DVC' } })
    expect(screen.getByRole('button', { name: nl.event.bulk.save })).toBeEnabled()
  })
})

describe('Story-F7/E1 — Grens van 100 wedstrijden', () => {
  it(`meer dan ${MAX_BULK_MATCHES} rijen tonen een melding met het aantal en blokkeren opslaan (101-200 blijven zichtbaar)`, async () => {
    renderPage()
    const lines = Array.from({ length: MAX_BULK_MATCHES + 1 }, (_, i) =>
      `2026-09-${String((i % 27) + 1).padStart(2, '0')} 14:30 thuis competitie Tegenstander${i}`)
    await pasteText(lines)

    const saveButton = screen.getByRole('button', { name: nl.event.bulk.save })
    expect(saveButton).toBeDisabled()
    expect(screen.getByText(
      nl.event.bulk.errorTooMany.replace('{count}', String(MAX_BULK_MATCHES + 1)).replace('{max}', String(MAX_BULK_MATCHES)),
    )).toBeInTheDocument()
    // De 101 rijen blijven zichtbaar in de tabel, ze worden niet weggelaten.
    expect(screen.getAllByLabelText(nl.event.bulk.columnHeaders.opponent)).toHaveLength(MAX_BULK_MATCHES + 1)
  })

  it('E1: precies 100 rijen blokkeert opslaan NIET (grenswaarde)', async () => {
    renderPage()
    const lines = Array.from({ length: MAX_BULK_MATCHES }, (_, i) =>
      `2026-09-${String((i % 27) + 1).padStart(2, '0')} 14:30 thuis competitie Tegenstander${i}`)
    await pasteText(lines)

    expect(screen.getByRole('button', { name: nl.event.bulk.save })).toBeEnabled()
    expect(screen.queryByText(
      nl.event.bulk.errorTooMany.replace('{count}', String(MAX_BULK_MATCHES)).replace('{max}', String(MAX_BULK_MATCHES)),
    )).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// Duplicaatdetectie — markeert alleen, blokkeert nooit (Story-B8/E2/E3/E4)
// ────────────────────────────────────────────────

describe('Story-B8/E3 — Duplicaat tegen bestaande DB-wedstrijd', () => {
  it('een rij met datum+tegenstander die al bestaat (ook al wijkt de tijd af) krijgt een duplicaat-badge, maar blokkeert niet', async () => {
    useSupabase(defaultSupabase({
      events: {
        select: { data: [{ date: '2026-09-12', opponent: 'FC Dubbel' }], error: null },
        insert: { data: [{ id: 'e1' }], error: null },
      },
    }))
    renderPage()
    // Andere tijd dan de "bestaande" wedstrijd — de check kijkt alleen naar
    // datum+tegenstander (lib/bulk-matches.ts:duplicateKey).
    await pasteText(['2026-09-12 20:00 uit beker FC Dubbel'])

    await waitFor(() => expect(screen.getByText(nl.event.bulk.duplicate)).toBeInTheDocument(), { timeout: 2000 })
    expect(screen.getByRole('button', { name: nl.event.bulk.save })).toBeEnabled()
  })
})

describe('Story-E2 — Duplicaat binnen dezelfde set (intern)', () => {
  it('twee rijen met identieke datum+tegenstander in dezelfde plak-actie worden allebei als duplicaat gemarkeerd', async () => {
    renderPage()
    await pasteText([
      '2026-09-12 14:30 thuis competitie DVC',
      '2026-09-12 16:00 thuis competitie DVC',
    ])

    await waitFor(() => {
      expect(screen.getAllByText(nl.event.bulk.duplicate)).toHaveLength(2)
    }, { timeout: 2000 })
  })
})

describe('Story-E4 — Duplicaat-markering negeren en toch bevestigen', () => {
  it('een gemarkeerd duplicaat wordt gewoon (nogmaals) opgeslagen als de trainer toch bevestigt', async () => {
    const mock = defaultSupabase({
      events: {
        select: { data: [{ date: '2026-09-12', opponent: 'FC Dubbel' }], error: null },
        insert: { data: [{ id: 'e1' }], error: null },
      },
    })
    useSupabase(mock)
    renderPage()
    await pasteText(['2026-09-12 14:30 thuis competitie FC Dubbel'])

    await waitFor(() => expect(screen.getByText(nl.event.bulk.duplicate)).toBeInTheDocument(), { timeout: 2000 })

    await clickSave()

    expect(screen.getByText(nl.event.bulk.savedCount.replace('{count}', '1'))).toBeInTheDocument()
    const payload = mock.inserts.find((i) => i.table === 'events')!.payload as { opponent: string }[]
    expect(payload).toHaveLength(1)
    expect(payload[0].opponent).toBe('FC Dubbel')
  })
})

describe('Duplicaatcontrole die zelf mislukt — waarschuwt, blokkeert niet (lib/use-bulk-match-rows.ts:121-123)', () => {
  it('een mislukte getExistingMatchKeys-aanroep zet de duplicateCheckFailed-melding, maar de save-knop blijft ingeschakeld en bevestigen slaagt gewoon', async () => {
    // De events-tabel is zowel de bron voor getExistingMatchKeys (duplicaat-
    // controle) als voor de insert bij opslaan: alleen de SELECT-kant faalt.
    const mock = defaultSupabase({
      events: {
        select: { data: null, error: { code: '500', message: 'boom' } },
        insert: { data: [{ id: 'e1' }], error: null },
      },
    })
    useSupabase(mock)
    renderPage()
    await pasteText(['2026-09-12 14:30 thuis competitie DVC'])

    // De gedebouncete duplicaatcontrole (400ms) faalt en zet de vlag.
    await waitFor(
      () => expect(screen.getByText(nl.event.bulk.errorDuplicateCheck)).toBeInTheDocument(),
      { timeout: 2000 },
    )

    // Niet-blokkerend: de save-knop blijft gewoon bruikbaar.
    const saveButton = screen.getByRole('button', { name: nl.event.bulk.save })
    expect(saveButton).toBeEnabled()

    await clickSave()

    expect(screen.getByText(nl.event.bulk.savedCount.replace('{count}', '1'))).toBeInTheDocument()
    const payload = mock.inserts.find((i) => i.table === 'events')!.payload as { opponent: string }[]
    expect(payload).toHaveLength(1)
  })
})

describe('Ongeldige datum/tijd uit een bestand blijft leesbaar in de preview (components/BulkMatchPreviewTable.tsx)', () => {
  it('een onherkenbare datum ("31/02/2026") uit een bestand blijft als tekst zichtbaar, niet stilzwijgend leeg gesaneerd door het native date-veld', async () => {
    renderPage()
    await uploadRows([makeRow({ id: 'r0', date: '31/02/2026' })])

    const dateInput = screen.getByLabelText(nl.event.bulk.columnHeaders.date) as HTMLInputElement
    expect(dateInput.type).toBe('text')
    expect(dateInput.value).toBe('31/02/2026')
    expect(screen.getByText(nl.event.bulk.fieldInvalid)).toBeInTheDocument()
  })

  it('een onherkenbare tijd ("25:99") uit een bestand blijft als tekst zichtbaar, niet stilzwijgend leeg gesaneerd door het native time-veld', async () => {
    renderPage()
    await uploadRows([makeRow({ id: 'r0', time: '25:99' })])

    const timeInput = screen.getByLabelText(nl.event.bulk.columnHeaders.time) as HTMLInputElement
    expect(timeInput.type).toBe('text')
    expect(timeInput.value).toBe('25:99')
  })

  it('een geldige datum blijft gewoon het native date-veld (geen onterechte tekstweergave)', async () => {
    renderPage()
    await uploadRows([makeRow({ id: 'r0', date: '2026-09-12' })])

    const dateInput = screen.getByLabelText(nl.event.bulk.columnHeaders.date) as HTMLInputElement
    expect(dateInput.type).toBe('date')
  })
})

describe('Tekst geplakt én bestand gekozen tegelijk toont een notitie (components/BulkMatchInput.tsx)', () => {
  it('zodra er zowel geplakte tekst als een gekozen bestand aanwezig zijn, verschijnt de "bestand wint"-notitie', async () => {
    renderPage()

    const textarea = screen.getByLabelText(nl.event.bulk.pasteLabel)
    fireEvent.change(textarea, { target: { value: '2026-09-12 14:30 thuis competitie DVC' } })
    expect(screen.queryByText(nl.event.bulk.fileOverridesText)).not.toBeInTheDocument()

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['datum;tijd;tegenstander'], 'wedstrijden.csv', { type: 'text/csv' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(screen.getByText(nl.event.bulk.fileOverridesText)).toBeInTheDocument()
  })

  it('alleen tekst (geen bestand) toont de notitie niet', async () => {
    renderPage()
    const textarea = screen.getByLabelText(nl.event.bulk.pasteLabel)
    fireEvent.change(textarea, { target: { value: '2026-09-12 14:30 thuis competitie DVC' } })
    expect(screen.queryByText(nl.event.bulk.fileOverridesText)).not.toBeInTheDocument()
  })
})

describe('Story-E7 — Wedstrijddatum in het verleden', () => {
  it('een datum in het verleden wordt gewoon geaccepteerd, zonder waarschuwing of blokkade', async () => {
    renderPage()
    await pasteText(['12 sep 2020 14:30 thuis competitie Oude Tegenstander'])

    expect(screen.getByRole('button', { name: nl.event.bulk.save })).toBeEnabled()
    expect(screen.queryByText(nl.event.bulk.errorBlocked)).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// Story-H3/H4 — Entry points en voorbeeldbestand
// ────────────────────────────────────────────────

describe('Story-H4 — Voorbeeldbestand', () => {
  it('de downloadlink wijst naar /voorbeeld-wedstrijden.csv', () => {
    renderPage()
    const link = screen.getByRole('link', { name: nl.event.bulk.downloadExample }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/voorbeeld-wedstrijden.csv')
  })

  it('het daadwerkelijke bestand public/voorbeeld-wedstrijden.csv gebruikt exact de voorgeschreven kolomstructuur', () => {
    const filePath = path.resolve(__dirname, 'public/voorbeeld-wedstrijden.csv')
    const content = readFileSync(filePath, 'utf-8').replace(/^﻿/, '')
    const headerLine = content.split(/\r\n|\r|\n/)[0]
    expect(headerLine).toBe(BULK_HEADER_LINE)
  })
})

describe('Story-H3 — GlobalFab: nieuwe menu-optie', () => {
  it('toont "Wedstrijden importeren" naast "Wedstrijd", met href="/events/bulk"', () => {
    render(
      <DictProvider dict={nl}>
        <GlobalFab />
      </DictProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: nl.fab.title }))

    const matchLink = screen.getByRole('link', { name: nl.event.createMatch }) as HTMLAnchorElement
    expect(matchLink.getAttribute('href')).toBe('/events/new?type=match')

    const bulkLink = screen.getByRole('link', { name: nl.event.bulk.fabLabel }) as HTMLAnchorElement
    expect(bulkLink.getAttribute('href')).toBe('/events/bulk')
  })
})

// ────────────────────────────────────────────────
// Story-F3 (gedeeltelijk) — client-side extensiefilter vóór bestandsupload.
// De server is de echte poortwachter (zie companion-bestand, Story-F3/F4);
// dit bewijst alleen dat de UI een evident verkeerd bestand al client-side
// weert, met een duidelijke melding, zonder ooit te verwerken.
// ────────────────────────────────────────────────

describe('Story-F3 — Client-side extensiefilter vóór upload', () => {
  it('een .txt-bestand wordt client-side geweigerd, "Verwerken" blijft uitgeschakeld en er wordt niets naar de server gestuurd', async () => {
    renderPage()
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['iets'], 'wedstrijden.txt', { type: 'text/plain' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(screen.getByText(nl.event.bulk.errorFileType)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.event.bulk.process })).toBeDisabled()
    expect(mockParseBulkMatchFile).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────
// Story-H2 (UI-bedrading) — de UI verwerkt wat parseBulkMatchFile teruggeeft.
// De ECHTE .csv/.xlsx-parsing zelf staat in het companion-bestand (zie
// bestandskop) vanwege de jsdom/File-beperking.
// ────────────────────────────────────────────────

describe('Story-H2 — Bestandsupload zet het resultaat van parseBulkMatchFile om in dezelfde preview-tabel', () => {
  it('een succesvolle serverrespons na bestandskeuze levert dezelfde preview-tabel op als het plakpad', async () => {
    renderPage()
    await uploadRows([
      makeRow({ id: 'r0', date: '2026-09-12', opponent: 'FC Voorbeeld' }),
      makeRow({ id: 'r1', date: '2026-09-19', opponent: 'SV Tweede' }),
    ])

    expect(screen.getByText(nl.event.bulk.rowCount.replace('{count}', '2'))).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByLabelText(nl.event.bulk.columnHeaders.opponent)).toHaveLength(2)
  })
})
