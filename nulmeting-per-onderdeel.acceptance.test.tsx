// Acceptatietests — Nulmeting per periodiseringsonderdeel (user-story.md,
// technische-brief.md §5.1, addendum.md §A5 fase 2).
//
// Dekt de kant die dashboard-vorm.acceptance.test.tsx niet dekt: het volledige
// gedrag van de nieuwe feature over twee echte paginas heen (DashboardPage +
// PeriodizationPage), inclusief NulmetingManager-interactie (geschiedenis
// uitklappen, bewerk-guard) en de hermetings-hint. Zelfde testmethode als
// dashboard-vorm.acceptance.test.tsx: de ECHTE server components rechtstreeks
// renderen met RTL, met uitsluitend @/lib/supabase/server en next/navigation
// gestubd via een generieke tabel-engine — geen kant-en-klare fixtures.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { formatDate } from '@/lib/utils'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// Nodig voor de schrijf-paden hieronder (AC 1,2,4,14-16,20,25-27, edge 13/14):
// saveCategorieMeting/deleteCategorieMeting roepen revalidatePath aan, wat
// buiten een echte Next-requestcontext crasht zonder deze mock (zelfde reden
// als afmeldperiode.acceptance.test.tsx:40).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import DashboardPage from '@/app/page'
import PeriodizationPage from '@/app/periodisering/page'
import { saveCategorieMeting, deleteCategorieMeting } from '@/app/actions/periodisering'

// Vaste "vandaag", ruim ná de winterstop-fixture in de hermetings-tests, zodat
// zowel een meting van 2026-08-01 als van 2027-01-05 al "actueel" zijn.
const TODAY = '2027-02-01'
const TEAM = 'team-1'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`))
})

afterEach(() => {
  vi.useRealTimers()
})

type Row = Record<string, unknown>

function meting(overrides: {
  categorie: string
  datum: string
  stap: number
  id?: string
  notes?: string | null
  // Optioneel: alleen gebruikt door de tenant-isolatietests (AC 25, edge 15),
  // die bewust een rij van een ANDER team zaaien. Alle bestaande aanroepen
  // laten dit veld weg en krijgen zoals voorheen team_id = TEAM.
  team_id?: string
}): Row {
  return {
    id: overrides.id ?? `${overrides.categorie}-${overrides.datum}`,
    team_id: overrides.team_id ?? TEAM,
    categorie: overrides.categorie,
    datum: overrides.datum,
    stap: overrides.stap,
    notes: overrides.notes ?? null,
    created_at: `${overrides.datum}T10:00:00Z`,
  }
}

// Training-fixtures voor AC 17/AC 18/edge 10/edge 11 (stap-telling): een
// events-rij van het type 'training' + een training_oefeningen-rij met de
// (genest) gejoinde categorie, exact de vorm die getTrainingLog
// (lib/periodization.ts) verwacht — de generieke tableFactory hierboven doet
// geen echte join, dus de geneste vorm moet al in de fixture zelf staan.
function trainingEvent(id: string, date: string): Row {
  return { id, team_id: TEAM, type: 'training', date }
}
function trainingOefening(eventId: string, categorie: string): Row {
  return { event_id: eventId, team_id: TEAM, stap_override: null, oefeningen: { categorie } }
}

// ── Generieke Supabase-tabel-engine — zelfde aanpak als
// dashboard-vorm.acceptance.test.tsx (regel 130-207): een tabel-engine die de
// ECHTE method-chain-aanroepen van de pagina's toepast op een gedeelde
// in-memory rijenset, zodat een verkeerd filter/order/limit net zo hard
// faalt als tegen een echte database.
function tableFactory(rows: Row[]) {
  return () => {
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean }[] = []
    let limitN: number | null = null

    function resolveRows(): Row[] {
      let out = rows.filter((r) => filters.every((f) => f(r)))
      if (orders.length > 0) {
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const av = a[o.col] as string | number
            const bv = b[o.col] as string | number
            if (av < bv) return o.ascending ? -1 : 1
            if (av > bv) return o.ascending ? 1 : -1
          }
          return 0
        })
      }
      if (limitN !== null) out = out.slice(0, limitN)
      return out
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
        return chain
      },
      neq: (col: string, val: unknown) => {
        filters.push((r) => r[col] !== val)
        return chain
      },
      gt: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string) > (val as string))
        return chain
      },
      gte: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string) >= (val as string))
        return chain
      },
      lte: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string) <= (val as string))
        return chain
      },
      lt: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string) < (val as string))
        return chain
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]))
        return chain
      },
      order: (col: string, opts: { ascending?: boolean } = {}) => {
        orders.push({ col, ascending: opts.ascending ?? true })
        return chain
      },
      limit: (n: number) => {
        limitN = n
        return chain
      },
      maybeSingle: () => Promise.resolve({ data: resolveRows()[0] ?? null }),
      single: () => Promise.resolve({ data: resolveRows()[0] ?? null }),
      then: (resolve: (v: { data: Row[]; count: number }) => unknown) =>
        resolve({ data: resolveRows(), count: resolveRows().length }),
    }
    return chain
  }
}

// `user` (AC 24) en `trainingOefeningen` (AC 17/18/edge 10/11) zijn puur
// additief: bestaande aanroepen laten ze weg en krijgen exact het oude
// gedrag (ingelogd als TEAM, lege training_oefeningen-tabel).
type MockOpts = {
  events?: Row[]
  categorieMetingen?: Row[]
  trainingOefeningen?: Row[]
  user?: { id: string } | null
}

function makeSupabaseMock(opts: MockOpts = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const eventsFactory = tableFactory(opts.events ?? [])
  const categorieMetingenFactory = tableFactory(opts.categorieMetingen ?? [])
  const trainingOefeningenFactory = tableFactory(opts.trainingOefeningen ?? [])
  const emptyFactory = tableFactory([])
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      if (table === 'events') return eventsFactory()
      if (table === 'categorie_metingen') return categorieMetingenFactory()
      if (table === 'training_oefeningen') return trainingOefeningenFactory()
      return emptyFactory()
    },
  }
}

async function renderDashboard(opts: MockOpts = {}) {
  vi.mocked(createClient).mockResolvedValue(
    makeSupabaseMock(opts) as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  const el = await DashboardPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

async function renderPeriodisering(opts: MockOpts = {}) {
  vi.mocked(createClient).mockResolvedValue(
    makeSupabaseMock(opts) as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  const el = await PeriodizationPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

function periodiseringCard(): HTMLElement {
  const label = screen.getByText(nl.home.periodizationTitle)
  const card = label.closest('.surface-card')
  if (!card) throw new Error('Periodisering-kaart niet gevonden')
  return card as HTMLElement
}

// Vindt één van de vijf onderdeelblokken van NulmetingManager op /periodisering.
// Het categorielabel komt op deze pagina TWEE keer voor (ook in de bestaande
// "Huidige periodiseringstatus"-kaart als <span>) — NulmetingManager's kop is
// specifiek een <h3>, dus daarop filteren voorkomt een dubbelzinnige match.
function blokVoor(categorieKey: string): HTMLElement {
  const label = screen
    .getAllByText(nl.periodization.categories[categorieKey])
    .find((el) => el.tagName === 'H3')
  if (!label) throw new Error(`Blok voor ${categorieKey} niet gevonden`)
  const blok = label.closest('.surface-card')
  if (!blok) throw new Error(`Blok voor ${categorieKey} niet gevonden`)
  return blok as HTMLElement
}

// ═══════════════════════════════════════════════════════════════════════
// Muteerbare Supabase-mock — voor de schrijf-paden (AC 1,2,4,14-16,20,25-27,
// edge 13/14). Zelfde aanpak als afmeldperiode.acceptance.test.tsx (makeDb),
// hier toegespitst op categorie_metingen: de ECHTE saveCategorieMeting/
// deleteCategorieMeting draaien — via een echte klik in de gerenderde sheet
// óf rechtstreeks als publieke server-actie aangeroepen — tegen een
// in-memory rijenset die ECHT muteert, geen call-recording. `upsert` met
// onConflict volgt het ECHTE Postgres ON CONFLICT ... DO UPDATE SET-gedrag:
// alleen de kolommen in de payload worden overschreven, en een tweede treffer
// op dezelfde sleutel wordt een UPDATE i.p.v. een tweede rij (AC 26).
// `events`/`training_oefeningen` blijven leeg (niet nodig voor deze tests).
// ═══════════════════════════════════════════════════════════════════════
function makeMutableDb(seed: { categorieMetingen?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    categorie_metingen: (seed.categorieMetingen ?? []).map((r) => ({ ...r })),
    events: [],
    training_oefeningen: [],
  }
  let seq = 0
  const nextCreatedAt = () => new Date(Date.UTC(2020, 0, 1) + seq++).toISOString()

  function from(name: string) {
    const rows = tables[name] ?? (tables[name] = [])
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean }[] = []
    let limitN: number | null = null
    let mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
    let payload: Row | Row[] | null = null
    let onConflictCols: string[] | null = null

    function matches(r: Row) {
      return filters.every((f) => f(r))
    }
    function applyOrder(list: Row[]): Row[] {
      if (orders.length === 0) return list
      return [...list].sort((a, b) => {
        for (const o of orders) {
          const av = a[o.col] as string | number
          const bv = b[o.col] as string | number
          if (av < bv) return o.ascending ? -1 : 1
          if (av > bv) return o.ascending ? 1 : -1
        }
        return 0
      })
    }
    function execSelect() {
      let out = rows.filter(matches)
      out = applyOrder(out)
      if (limitN !== null) out = out.slice(0, limitN)
      return { data: out, error: null }
    }
    function execInsert() {
      const items = (Array.isArray(payload) ? payload : [payload]) as Row[]
      const inserted: Row[] = []
      for (const item of items) {
        const row: Row = { id: `row-${++seq}`, created_at: nextCreatedAt(), ...item }
        rows.push(row)
        inserted.push(row)
      }
      return { data: inserted, error: null }
    }
    function execUpsert() {
      const items = (Array.isArray(payload) ? payload : [payload]) as Row[]
      const result: Row[] = []
      for (const item of items) {
        let existing: Row | undefined
        if (onConflictCols) existing = rows.find((r) => onConflictCols!.every((c) => r[c] === item[c]))
        if (existing) {
          Object.assign(existing, item)
          result.push(existing)
        } else {
          const row: Row = { id: `row-${++seq}`, created_at: nextCreatedAt(), ...item }
          rows.push(row)
          result.push(row)
        }
      }
      return { data: result, error: null }
    }
    function execUpdate() {
      const targets = rows.filter(matches)
      for (const t of targets) Object.assign(t, payload)
      return { data: targets, error: null }
    }
    function execDelete() {
      const targets = rows.filter(matches)
      for (const t of targets) {
        const idx = rows.indexOf(t)
        if (idx >= 0) rows.splice(idx, 1)
      }
      return { data: targets, error: null }
    }
    function resolve() {
      if (mode === 'insert') return execInsert()
      if (mode === 'upsert') return execUpsert()
      if (mode === 'update') return execUpdate()
      if (mode === 'delete') return execDelete()
      return execSelect()
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return chain },
      neq: (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return chain },
      gt: (col: string, val: unknown) => { filters.push((r) => (r[col] as string) > (val as string)); return chain },
      gte: (col: string, val: unknown) => { filters.push((r) => (r[col] as string) >= (val as string)); return chain },
      lte: (col: string, val: unknown) => { filters.push((r) => (r[col] as string) <= (val as string)); return chain },
      lt: (col: string, val: unknown) => { filters.push((r) => (r[col] as string) < (val as string)); return chain },
      in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return chain },
      order: (col: string, o: { ascending?: boolean } = {}) => { orders.push({ col, ascending: o.ascending ?? true }); return chain },
      limit: (n: number) => { limitN = n; return chain },
      insert: (p: Row | Row[]) => { mode = 'insert'; payload = p; return chain },
      upsert: (p: Row | Row[], o: { onConflict?: string } = {}) => {
        mode = 'upsert'
        payload = p
        onConflictCols = o.onConflict ? o.onConflict.split(',') : null
        return chain
      },
      update: (p: Row) => { mode = 'update'; payload = p; return chain },
      delete: () => { mode = 'delete'; return chain },
      maybeSingle: async () => {
        const { data, error } = resolve()
        const arr = Array.isArray(data) ? data : [data]
        return { data: arr[0] ?? null, error }
      },
      single: async () => {
        const { data, error } = resolve()
        const arr = Array.isArray(data) ? data : [data]
        return { data: arr[0] ?? null, error }
      },
      then: (onres: (v: { data: unknown; error: unknown }) => unknown, onrej?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onres, onrej),
    }
    return chain
  }

  return { tables, from }
}

function installMutableDb(db: ReturnType<typeof makeMutableDb>, user: { id: string } | null = { id: TEAM }) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) => db.from(t),
  } as unknown as Awaited<ReturnType<typeof createClient>>)
}

async function renderPeriodiseringMutable(
  db: ReturnType<typeof makeMutableDb>,
  user: { id: string } | null = { id: TEAM },
) {
  installMutableDb(db, user)
  const el = await PeriodizationPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

// ── DOM-helpers voor de sheet (components/NulmetingManager.tsx) — datum- en
// stapveld zijn gekoppeld via htmlFor/id, dus getByLabelText werkt. Het
// stapveld-label toont een categorie-afhankelijk maximum ("max {n}
// stappen"), vandaar de regex i.p.v. een letterlijke tekst-match.
function sheetDateInput(): HTMLInputElement {
  return screen.getByLabelText(nl.periodization.date) as HTMLInputElement
}
function sheetStepInput(): HTMLInputElement {
  return screen.getByLabelText(/^max \d+ stappen$/) as HTMLInputElement
}
function sheetNotesInput(): HTMLTextAreaElement {
  return screen.getByLabelText(nl.event.notes) as HTMLTextAreaElement
}

// Klikt op de opslaan-knop en wacht op de opgegeven voorwaarde (sheet dicht =
// succes, of foutbalk zichtbaar = fout). RTL's waitFor-polling werkt niet
// betrouwbaar onder vi.useFakeTimers() (zelfde reden als
// inzichten.acceptance.test.tsx:1148/1645/1795): tijdelijk naar echte timers,
// en na afloop de vaste testklok (TODAY) herstellen zodat een eventuele
// VOLGENDE render weer dezelfde vaste "vandaag" gebruikt.
async function saveSheetAndWaitFor(check: () => void) {
  vi.useRealTimers()
  fireEvent.click(screen.getByText(nl.periodization.save))
  await waitFor(check)
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`))
}

// Generieke variant van saveSheetAndWaitFor hierboven, voor elke klik buiten
// de sheet (bv. de verwijderknop in de geschiedenis) die op een server-actie
// wacht. Zelfde reden voor de tijdelijke overstap naar echte timers.
async function clickAndWaitFor(el: HTMLElement, check: () => void) {
  vi.useRealTimers()
  fireEvent.click(el)
  await waitFor(check)
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`))
}

// ═══════════════════════════════════════════════════════════════════════
// Dashboard — PeriodiseringStatus (AC 3, 9-13; edge 1-3)
// ═══════════════════════════════════════════════════════════════════════
describe('Dashboard: status per onderdeel', () => {
  it('zonder metingen: alle vijf onderdelen "nog te meten" met hun vaste week (1/3/5/3/5), Steigerungs-regel, oude setup-tekst afwezig', async () => {
    await renderDashboard({ categorieMetingen: [] })
    const card = periodiseringCard()

    const verwacht: [string, number][] = [
      ['partijen_groot', 1],
      ['partijen_midden', 3],
      ['partijen_klein', 5],
      ['sprints_weinig_rust', 3],
      ['sprints_veel_rust', 5],
    ]
    for (const [key, week] of verwacht) {
      const row = within(card).getByText(nl.periodization.categories[key]).closest('a')
      expect(row).toHaveTextContent(nl.home.periodizationToMeasure)
      expect(row).toHaveTextContent(nl.home.periodizationDueWeek.replace('{n}', String(week)))
    }
    expect(
      within(card).getByText(nl.home.periodizationSteigerungs.replace('{a}', '1').replace('{b}', '2')),
    ).toBeInTheDocument()
    expect(screen.queryByText('Periodisering staat nog uit')).toBeNull()
  })

  it('AC 3: alle vijf onderdelen gemeten toont vijf keer "Gemeten", geen enkele "Nog te meten"', async () => {
    const oud = '2026-12-01'
    await renderDashboard({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: oud, stap: 5 }),
        meting({ categorie: 'partijen_midden', datum: oud, stap: 6 }),
        meting({ categorie: 'partijen_klein', datum: oud, stap: 7 }),
        meting({ categorie: 'sprints_weinig_rust', datum: oud, stap: 8 }),
        meting({ categorie: 'sprints_veel_rust', datum: oud, stap: 9 }),
      ],
    })
    const card = periodiseringCard()
    expect(within(card).getAllByText(nl.home.periodizationMeasured)).toHaveLength(5)
    expect(within(card).queryByText(nl.home.periodizationToMeasure)).toBeNull()
  })

  it('edge 3: precies één onderdeel gemeten — de andere vier blijven "nog te meten"', async () => {
    await renderDashboard({
      categorieMetingen: [meting({ categorie: 'partijen_groot', datum: '2026-12-01', stap: 5 })],
    })
    const card = periodiseringCard()
    expect(within(card).getAllByText(nl.home.periodizationToMeasure)).toHaveLength(4)
    const row = within(card).getByText(nl.periodization.categories.partijen_groot).closest('div')
    expect(row).toHaveTextContent(nl.home.periodizationMeasured)
  })

  it('AC 13: net gemeten (nog geen training sindsdien) toont exact de ingevulde stap', async () => {
    // Peildatum-exclusief = TODAY + 1: een meting van vandaag telt al mee.
    await renderDashboard({
      categorieMetingen: [meting({ categorie: 'partijen_groot', datum: TODAY, stap: 6 })],
    })
    const card = periodiseringCard()
    const row = within(card).getByText(nl.periodization.categories.partijen_groot).closest('div')
    expect(row).toHaveTextContent(nl.home.periodizationMeasured)
    expect(row).toHaveTextContent('6')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// /periodisering — NulmetingManager: geschiedenis en bewerk-guard (AC 5-7, 28)
// ═══════════════════════════════════════════════════════════════════════
describe('NulmetingManager: alleen de nieuwste meting is bewerkbaar', () => {
  it('AC 7/28: van twee metingen heeft alleen de nieuwste Bewerken/Verwijderen; de oudere toont de hint', async () => {
    await renderPeriodisering({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-06-01', stap: 4 }),
        meting({ categorie: 'partijen_groot', datum: '2026-07-01', stap: 6 }),
      ],
    })
    const blok = blokVoor('partijen_groot')
    const toggle = within(blok).getByText(nl.periodization.historyForCategory.replace('{n}', '2'))
    fireEvent.click(toggle.closest('button')!)

    // Precies één bewerk-knop en één verwijder-knop in dit blok.
    expect(within(blok).getAllByText(nl.periodization.editNulmeting)).toHaveLength(1)
    expect(within(blok).getAllByLabelText(nl.periodization.deleteNulmeting)).toHaveLength(1)
    expect(within(blok).getByText(nl.periodization.latestOnlyHint)).toBeInTheDocument()

    // Die ene bewerk-knop hoort bij de NIEUWSTE rij (hoogste datum).
    const editButton = within(blok).getByText(nl.periodization.editNulmeting)
    const editRow = editButton.closest('div.px-5')
    expect(editRow).toHaveTextContent(formatDate('2026-07-01', nl.browserLocale))
    expect(editRow).not.toHaveTextContent(formatDate('2026-06-01', nl.browserLocale))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC 27 (verwijderen) — de verwijderknop in de gerenderde NulmetingManager,
// succes- en foutpad. Klikt écht op de knop (confirm gemockt), tegen het
// muteerbare db-harnas — geen call-recording.
// ═══════════════════════════════════════════════════════════════════════
describe('Verwijderen via de UI (AC 27)', () => {
  it('succes: de rij verdwijnt uit de database en beide paden worden gerevalideerd', async () => {
    const db = makeMutableDb({
      categorieMetingen: [meting({ id: 'm1', categorie: 'partijen_groot', datum: '2026-05-01', stap: 5 })],
    })
    await renderPeriodiseringMutable(db)

    const blok = blokVoor('partijen_groot')
    fireEvent.click(within(blok).getByText(nl.periodization.historyForCategory.replace('{n}', '1')).closest('button')!)
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)

    await clickAndWaitFor(
      within(blok).getByLabelText(nl.periodization.deleteNulmeting),
      () => expect(db.tables.categorie_metingen).toHaveLength(0),
    )

    expect(revalidatePath).toHaveBeenCalledWith('/periodisering')
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('fout: de meting bestaat niet meer (bv. al verwijderd in een ander tabblad) — de foutmelding is zichtbaar bij het blok, buiten de sheet', async () => {
    const db = makeMutableDb({
      categorieMetingen: [meting({ id: 'm1', categorie: 'partijen_groot', datum: '2026-05-01', stap: 5 })],
    })
    await renderPeriodiseringMutable(db)

    const blok = blokVoor('partijen_groot')
    fireEvent.click(within(blok).getByText(nl.periodization.historyForCategory.replace('{n}', '1')).closest('button')!)
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)

    // Een ander tabblad heeft de rij intussen al verwijderd: deleteCategorieMeting
    // vindt 'm niet meer en gooit 'Meting niet gevonden'.
    db.tables.categorie_metingen.length = 0

    await clickAndWaitFor(
      within(blok).getByLabelText(nl.periodization.deleteNulmeting),
      () => expect(within(blok).getByText(nl.oefeningen.genericError)).toBeInTheDocument(),
    )

    // Geen sheet open — de melding moet zichtbaar zijn zonder dat er een
    // sheet-titel/opslaan-knop op de pagina staat.
    expect(screen.queryByText(nl.periodization.save)).toBeNull()
  })

  it('de verwijder-foutmelding verdwijnt door de geschiedenis-toggle dicht en weer open te klappen', async () => {
    const db = makeMutableDb({
      categorieMetingen: [meting({ id: 'm1', categorie: 'partijen_groot', datum: '2026-05-01', stap: 5 })],
    })
    await renderPeriodiseringMutable(db)

    const blok = blokVoor('partijen_groot')
    const toggle = within(blok).getByText(nl.periodization.historyForCategory.replace('{n}', '1')).closest('button')!
    fireEvent.click(toggle)
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    db.tables.categorie_metingen.length = 0 // simuleert een race-conditie

    await clickAndWaitFor(
      within(blok).getByLabelText(nl.periodization.deleteNulmeting),
      () => expect(within(blok).getByText(nl.oefeningen.genericError)).toBeInTheDocument(),
    )

    fireEvent.click(toggle) // dichtklappen
    fireEvent.click(toggle) // en weer open
    expect(within(blok).queryByText(nl.oefeningen.genericError)).toBeNull()
  })

  it('de verwijder-foutmelding verdwijnt ook zodra de sheet voor hetzelfde onderdeel wordt geopend', async () => {
    const db = makeMutableDb({
      categorieMetingen: [meting({ id: 'm1', categorie: 'partijen_groot', datum: '2026-05-01', stap: 5 })],
    })
    await renderPeriodiseringMutable(db)

    const blok = blokVoor('partijen_groot')
    fireEvent.click(within(blok).getByText(nl.periodization.historyForCategory.replace('{n}', '1')).closest('button')!)
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    db.tables.categorie_metingen.length = 0

    await clickAndWaitFor(
      within(blok).getByLabelText(nl.periodization.deleteNulmeting),
      () => expect(within(blok).getByText(nl.oefeningen.genericError)).toBeInTheDocument(),
    )

    // De rij staat client-side nog gerenderd (de fout brak de save niet af),
    // dus de knop heet nog "Hermeten"; openNew() moet de oude melding wissen.
    fireEvent.click(within(blok).getByText(nl.periodization.remeasureCta).closest('button')!)
    expect(screen.queryByText(nl.oefeningen.genericError)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// /periodisering — Delta-indicator (AC 6; edge 6/7)
// ═══════════════════════════════════════════════════════════════════════
describe('NulmetingManager: delta t.o.v. de vorige meting', () => {
  it('hoger: toont ▲ met het verschil en de datum van de vorige meting', async () => {
    await renderPeriodisering({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-06-01', stap: 5 }),
        meting({ categorie: 'partijen_groot', datum: '2026-07-01', stap: 8 }),
      ],
    })
    const blok = blokVoor('partijen_groot')
    const verwacht = nl.periodization.progressUp.replace('{n}', '3').replace('{date}', formatDate('2026-06-01', nl.browserLocale))
    expect(within(blok).getByText(verwacht)).toBeInTheDocument()
  })

  it('lager (edge 6): toont ▼ met het verschil — even duidelijk zichtbaar als vooruitgang', async () => {
    await renderPeriodisering({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-06-01', stap: 8 }),
        meting({ categorie: 'partijen_groot', datum: '2026-07-01', stap: 5 }),
      ],
    })
    const blok = blokVoor('partijen_groot')
    const verwacht = nl.periodization.progressDown.replace('{n}', '3').replace('{date}', formatDate('2026-06-01', nl.browserLocale))
    expect(within(blok).getByText(verwacht)).toBeInTheDocument()
  })

  it('gelijk (edge 7): toont = zonder foutmelding', async () => {
    await renderPeriodisering({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-06-01', stap: 7 }),
        meting({ categorie: 'partijen_groot', datum: '2026-07-01', stap: 7 }),
      ],
    })
    const blok = blokVoor('partijen_groot')
    const verwacht = nl.periodization.progressSame.replace('{date}', formatDate('2026-06-01', nl.browserLocale))
    expect(within(blok).getByText(verwacht)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Kop/knoptekst-consistentie bij een uitsluitend TOEKOMSTIGE meting: die telt
// nog niet mee als actueel (peildatum-exclusief), dus de kop ("Nog niet
// gemeten") en de knoptekst ("Meting invullen"/"Hermeten") moeten dezelfde
// bron gebruiken — anders zegt de kop "nog niet gemeten" terwijl de knop al
// "Hermeten" zegt.
// ═══════════════════════════════════════════════════════════════════════
describe('Consistentie tussen kop en knoptekst bij een uitsluitend toekomstige meting', () => {
  it('een onderdeel met alleen een meting ver in de toekomst toont overal "nog niet gemeten" — kop én knop uit dezelfde bron', async () => {
    // TODAY = 2027-02-01; peildatum-exclusief = 2027-02-02, dus 2028-01-01
    // telt nog niet mee als actuele meting.
    await renderPeriodisering({
      categorieMetingen: [meting({ categorie: 'partijen_groot', datum: '2028-01-01', stap: 9 })],
    })
    const blok = blokVoor('partijen_groot')
    expect(blok).toHaveTextContent(nl.periodization.notMeasured)
    expect(within(blok).getByText(nl.periodization.measureCta)).toBeInTheDocument() // niet "Hermeten"
    expect(within(blok).queryByText(nl.periodization.remeasureCta)).toBeNull()

    // De sheet-titel (bij het openen van dezelfde knop) gebruikt dezelfde bron.
    fireEvent.click(within(blok).getByText(nl.periodization.measureCta).closest('button')!)
    const sheet = sheetDateInput().closest('.animate-scale-in') as HTMLElement
    expect(sheet).toHaveTextContent(nl.periodization.measureCta)
    expect(sheet).not.toHaveTextContent(nl.periodization.remeasureCta)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// /periodisering — Hermetings-hint (addendum §A)
// ═══════════════════════════════════════════════════════════════════════
describe('Hermetings-hint', () => {
  it('winterstop-data (spreiding > 42 dagen) toont de hint met "1 van 5", direct ná de cyclus-kaart', async () => {
    await renderPeriodisering({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-08-01', stap: 5 }),
        meting({ categorie: 'partijen_midden', datum: '2026-08-01', stap: 6 }),
        meting({ categorie: 'partijen_klein', datum: '2026-08-01', stap: 7 }),
        meting({ categorie: 'sprints_weinig_rust', datum: '2026-08-01', stap: 8 }),
        // Ruim > 42 dagen na het anker (2026-08-01) — hermeting.
        meting({ categorie: 'sprints_veel_rust', datum: '2027-01-05', stap: 9 }),
      ],
    })
    const hintTitel = nl.periodization.remeasureHintTitle.replace('{n}', '1').replace('{m}', '5')
    const hint = screen.getByText(hintTitel)
    expect(hint).toBeInTheDocument()
    expect(screen.getByText(nl.periodization.remeasureHintBody)).toBeInTheDocument()

    // Plek: ná de cyclus-kaart, vóór "Huidige periodiseringstatus".
    const cyclusKaart = screen.getByText(nl.periodization.cycleTitle)
    const statusKaart = screen.getByText(nl.periodization.currentSteps)
    const positieNaCyclus = cyclusKaart.compareDocumentPosition(hint)
    const positieVoorStatus = hint.compareDocumentPosition(statusKaart)
    expect(positieNaCyclus & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(positieVoorStatus & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('alle vijf binnen één cyclus (6 weken): de hint is afwezig', async () => {
    await renderPeriodisering({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-12-01', stap: 5 }),
        meting({ categorie: 'partijen_midden', datum: '2026-12-05', stap: 6 }),
        meting({ categorie: 'partijen_klein', datum: '2026-12-10', stap: 7 }),
        meting({ categorie: 'sprints_weinig_rust', datum: '2026-12-15', stap: 8 }),
        meting({ categorie: 'sprints_veel_rust', datum: '2026-12-20', stap: 9 }),
      ],
    })
    expect(screen.queryByText(/Hermeting loopt/)).toBeNull()
  })

  it('de hint verandert niets aan de getoonde cyclusweek of stappen', async () => {
    const CATS = ['partijen_groot', 'partijen_midden', 'partijen_klein', 'sprints_weinig_rust', 'sprints_veel_rust']
    function snapshot() {
      const cycleWeekTekst = screen.getByText(/week \d+ van de cyclus/).textContent
      const statusKaart = screen.getByText(nl.periodization.currentSteps).closest('.surface-card') as HTMLElement
      const stapTeksten = CATS.map(
        (key) => within(statusKaart).getByText(nl.periodization.categories[key]).closest('div')!.textContent,
      )
      return { cycleWeekTekst, stapTeksten }
    }

    // Variant A: winterstop (hint actief) — sprints_veel_rust ruim > 42 dagen
    // na het gedeelde anker van de andere vier.
    const { unmount } = await renderPeriodisering({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-08-01', stap: 5 }),
        meting({ categorie: 'partijen_midden', datum: '2026-08-01', stap: 6 }),
        meting({ categorie: 'partijen_klein', datum: '2026-08-01', stap: 7 }),
        meting({ categorie: 'sprints_weinig_rust', datum: '2026-08-01', stap: 8 }),
        meting({ categorie: 'sprints_veel_rust', datum: '2027-01-05', stap: 9 }),
      ],
    })
    expect(screen.getByText(/Hermeting loopt/)).toBeInTheDocument()
    const snapshotA = snapshot()
    unmount()
    cleanup()

    // Variant B: zelfde anker (2026-08-01), maar ALLE vijf op die datum —
    // geen hermeting, dus geen hint. Zonder trainingen in beide fixtures is
    // de berekende stap voor elk onderdeel gelijk aan zijn eigen ingevulde N,
    // ongeacht welk venster de telling gebruikt: de vergelijking hieronder
    // bewijst dat de hint zelf niets aan die berekening verandert.
    await renderPeriodisering({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-08-01', stap: 5 }),
        meting({ categorie: 'partijen_midden', datum: '2026-08-01', stap: 6 }),
        meting({ categorie: 'partijen_klein', datum: '2026-08-01', stap: 7 }),
        meting({ categorie: 'sprints_weinig_rust', datum: '2026-08-01', stap: 8 }),
        meting({ categorie: 'sprints_veel_rust', datum: '2026-08-01', stap: 9 }),
      ],
    })
    expect(screen.queryByText(/Hermeting loopt/)).toBeNull()
    const snapshotB = snapshot()

    expect(snapshotB).toEqual(snapshotA)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC1 — eerste keer invullen van een onderdeel zonder nulmeting (raakt ook
// AC 22: lege notitie geen fout; AC 23: er bestaat in de UI geen enkel
// mechanisme dat "Meting invullen" blokkeert vóór de eigen cyclusweek — deze
// test meet een onderdeel zonder dat er ooit een cyclus liep, en bewijst
// daarmee de afwezigheid van zo'n blokkade meteen mee)
// ═══════════════════════════════════════════════════════════════════════
describe('AC1 — eerste keer invullen van een onderdeel zonder nulmeting', () => {
  it('de sheet slaat de ingevulde datum en stap exact op; de vier overige onderdelen blijven ongeregistreerd; lege notitie geeft geen fout', async () => {
    const db = makeMutableDb({ categorieMetingen: [] })
    await renderPeriodiseringMutable(db)

    const blok = blokVoor('sprints_weinig_rust')
    fireEvent.click(within(blok).getByText(nl.periodization.measureCta).closest('button')!)
    fireEvent.change(sheetDateInput(), { target: { value: '2026-09-15' } })
    fireEvent.change(sheetStepInput(), { target: { value: '9' } })
    // Notitieveld blijft bewust leeg (AC 22).

    await saveSheetAndWaitFor(() => expect(screen.queryByText(nl.periodization.save)).toBeNull())

    expect(db.tables.categorie_metingen).toHaveLength(1)
    expect(db.tables.categorie_metingen[0]).toMatchObject({
      team_id: TEAM,
      categorie: 'sprints_weinig_rust',
      datum: '2026-09-15',
      stap: 9,
      notes: null,
    })
    expect(screen.queryByText(nl.periodization.errorInvalidDate)).toBeNull()
    expect(screen.queryByText(nl.oefeningen.genericError)).toBeNull()

    // De vier overige meetbare onderdelen blijven ongeregistreerd.
    for (const cat of ['partijen_groot', 'partijen_midden', 'partijen_klein', 'sprints_veel_rust']) {
      expect(db.tables.categorie_metingen.filter((r) => r.categorie === cat)).toHaveLength(0)
    }

    expect(revalidatePath).toHaveBeenCalledWith('/periodisering')
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC2 — twee verschillende, elk voor het eerst gemeten onderdelen blijven
// onafhankelijk van elkaar bewaard
// ═══════════════════════════════════════════════════════════════════════
describe('AC2 — een tweede, nog niet gemeten onderdeel meten laat de eerste meting ongewijzigd', () => {
  it('beide metingen zijn na het opslaan afzonderlijk beschikbaar; de nog niet gemeten onderdelen blijven als zodanig geregistreerd', async () => {
    const eersteDatum = '2026-05-01'
    const db = makeMutableDb({
      categorieMetingen: [meting({ categorie: 'partijen_groot', datum: eersteDatum, stap: 12, notes: 'eerste' })],
    })
    await renderPeriodiseringMutable(db)

    const blok = blokVoor('partijen_klein')
    fireEvent.click(within(blok).getByText(nl.periodization.measureCta).closest('button')!)
    fireEvent.change(sheetDateInput(), { target: { value: '2026-06-01' } })
    fireEvent.change(sheetStepInput(), { target: { value: '5' } })
    await saveSheetAndWaitFor(() => expect(screen.queryByText(nl.periodization.save)).toBeNull())

    const groot = db.tables.categorie_metingen.find((r) => r.categorie === 'partijen_groot')
    const klein = db.tables.categorie_metingen.find((r) => r.categorie === 'partijen_klein')
    expect(groot).toMatchObject({ datum: eersteDatum, stap: 12, notes: 'eerste' }) // ongewijzigd
    expect(klein).toMatchObject({ datum: '2026-06-01', stap: 5 })

    for (const cat of ['partijen_midden', 'sprints_weinig_rust', 'sprints_veel_rust']) {
      expect(db.tables.categorie_metingen.filter((r) => r.categorie === cat)).toHaveLength(0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC4/AC21 — hermeten: de nieuwe meting wordt actueel, de oude blijft als
// geschiedenis met haar eigen notitie
// ═══════════════════════════════════════════════════════════════════════
describe('AC4/AC21 — hermeten laat de vorige meting (incl. notitie) intact; de nieuwe wordt de actuele status met haar eigen notitie', () => {
  it('een tweede meting op een latere datum met een eigen notitie laat de eerste meting volledig ongemoeid', async () => {
    const db = makeMutableDb({
      categorieMetingen: [
        meting({ categorie: 'partijen_midden', datum: '2026-05-01', stap: 7, notes: 'eerste meting van het seizoen' }),
      ],
    })
    await renderPeriodiseringMutable(db)

    const blok = blokVoor('partijen_midden')
    expect(within(blok).getByText(nl.periodization.remeasureCta)).toBeInTheDocument() // niet "Meting invullen"
    fireEvent.click(within(blok).getByText(nl.periodization.remeasureCta).closest('button')!)
    fireEvent.change(sheetDateInput(), { target: { value: '2026-08-01' } })
    fireEvent.change(sheetStepInput(), { target: { value: '10' } })
    fireEvent.change(sheetNotesInput(), {
      target: { value: 'hermeting na de zomerstop' },
    })
    await saveSheetAndWaitFor(() => expect(screen.queryByText(nl.periodization.save)).toBeNull())

    const rijen = db.tables.categorie_metingen.filter((r) => r.categorie === 'partijen_midden')
    expect(rijen).toHaveLength(2)
    const oud = rijen.find((r) => r.datum === '2026-05-01')
    const nieuw = rijen.find((r) => r.datum === '2026-08-01')
    expect(oud).toMatchObject({ stap: 7, notes: 'eerste meting van het seizoen' }) // ongewijzigd, blijft geschiedenis
    expect(nieuw).toMatchObject({ stap: 10, notes: 'hermeting na de zomerstop' }) // de nieuwe actuele status
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC5 — geschiedenis toont per eerdere meting de datum en de toen ingevulde
// stap, in chronologische volgorde (nieuwste eerst)
// ═══════════════════════════════════════════════════════════════════════
describe('AC5 — de geschiedenis toont per eerdere meting de datum en de toen ingevulde stap, nieuwste eerst', () => {
  it('drie metingen (bewust in willekeurige volgorde gezaaid) verschijnen uitgeklapt in de juiste chronologische volgorde met hun eigen datum/stap', async () => {
    await renderPeriodisering({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-06-01', stap: 6 }),
        meting({ categorie: 'partijen_groot', datum: '2026-04-01', stap: 4 }),
        meting({ categorie: 'partijen_groot', datum: '2026-05-01', stap: 5 }),
      ],
    })
    const blok = blokVoor('partijen_groot')
    fireEvent.click(within(blok).getByText(nl.periodization.historyForCategory.replace('{n}', '3')).closest('button')!)

    const rijen = blok.querySelectorAll('.divide-y > div')
    expect(rijen).toHaveLength(3)
    expect(rijen[0].textContent).toContain(formatDate('2026-06-01', nl.browserLocale))
    expect(rijen[0].textContent).toContain('6')
    expect(rijen[1].textContent).toContain(formatDate('2026-05-01', nl.browserLocale))
    expect(rijen[1].textContent).toContain('5')
    expect(rijen[2].textContent).toContain(formatDate('2026-04-01', nl.browserLocale))
    expect(rijen[2].textContent).toContain('4')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC9 — Steigerungs krijgt geen invoerblok, geen stapgetal en geen link:
// alleen de informatieve regel
// ═══════════════════════════════════════════════════════════════════════
describe('AC9 — Steigerungs krijgt geen invoerblok, geen stapgetal en geen link, alleen de informatieve regel', () => {
  it('op /periodisering bestaat er geen NulmetingManager-blok voor Steigerungs; precies vijf meetknoppen, geen zesde', async () => {
    await renderPeriodisering({ categorieMetingen: [] })
    const steigerungsBlok = screen.queryAllByText(nl.periodization.categories.steigerungs).find((el) => el.tagName === 'H3')
    expect(steigerungsBlok).toBeUndefined()
    expect(screen.getAllByText(nl.periodization.measureCta)).toHaveLength(5)
  })

  it('op het dashboard toont Steigerungs alleen de vaste informatieve regel, zonder link en zonder eigen status-chip', async () => {
    await renderDashboard({ categorieMetingen: [] })
    const card = periodiseringCard()
    // Precies vijf status-rijen (chip "Gemeten" of "Nog te meten") — Steigerungs
    // krijgt er geen zesde.
    const statusRijen =
      within(card).queryAllByText(nl.home.periodizationToMeasure).length +
      within(card).queryAllByText(nl.home.periodizationMeasured).length
    expect(statusRijen).toBe(5)

    const steigerungsRegel = within(card).getByText(
      nl.home.periodizationSteigerungs.replace('{a}', '1').replace('{b}', '2'),
    )
    expect(steigerungsRegel.closest('a')).toBeNull() // geen invoermogelijkheid/link
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC11 — een nog niet gemeten onderdeel toont altijd zijn eigen vaste week,
// ongeacht een elders al lopende cyclus
// ═══════════════════════════════════════════════════════════════════════
describe('AC11 — een nog niet gemeten onderdeel toont zijn eigen vaste week, ongeacht een elders al lopende cyclus', () => {
  it('met partijen_groot al lang geleden gemeten (er loopt dus al een cyclus) tonen de vier overige onderdelen nog steeds hun eigen vaste week 3/5/3/5', async () => {
    await renderDashboard({
      categorieMetingen: [meting({ categorie: 'partijen_groot', datum: '2026-01-05', stap: 5 })],
    })
    const card = periodiseringCard()
    const verwacht: [string, number][] = [
      ['partijen_midden', 3],
      ['partijen_klein', 5],
      ['sprints_weinig_rust', 3],
      ['sprints_veel_rust', 5],
    ]
    for (const [key, week] of verwacht) {
      const row = within(card).getByText(nl.periodization.categories[key]).closest('a')
      expect(row).toHaveTextContent(nl.home.periodizationDueWeek.replace('{n}', String(week)))
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC14/edge 8 — de ankerdatum is de vroegste datum onder de actuele metingen
// ═══════════════════════════════════════════════════════════════════════
describe('AC14/edge 8 — de ankerdatum is de vroegste datum onder de actuele metingen', () => {
  it('AC14: drie onderdelen met verschillende datums — het anker is de vroegste van de drie', async () => {
    await renderPeriodisering({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-03-10', stap: 5 }),
        meting({ categorie: 'partijen_midden', datum: '2026-02-01', stap: 6 }), // vroegste
        meting({ categorie: 'partijen_klein', datum: '2026-04-05', stap: 7 }),
      ],
    })
    const kaart = screen.getByText(nl.periodization.cycleTitle).parentElement!
    expect(kaart.textContent).toContain(formatDate('2026-02-01', nl.browserLocale))
  })

  it('edge 8: twee onderdelen delen dezelfde (vroegste) datum — het anker is die gedeelde datum', async () => {
    await renderPeriodisering({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-02-01', stap: 5 }),
        meting({ categorie: 'partijen_midden', datum: '2026-02-01', stap: 6 }),
        meting({ categorie: 'partijen_klein', datum: '2026-05-01', stap: 7 }),
      ],
    })
    const kaart = screen.getByText(nl.periodization.cycleTitle).parentElement!
    expect(kaart.textContent).toContain(formatDate('2026-02-01', nl.browserLocale))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC15/AC16 — de ankerdatum verschuift alleen wanneer de vroegste meting
// zelf verandert
// ═══════════════════════════════════════════════════════════════════════
describe('AC15/AC16 — de ankerdatum verschuift alleen wanneer de vroegste meting zelf verandert', () => {
  it('AC15: een ánder onderdeel hermeten met een latere datum dan het huidige anker laat het anker ongemoeid', async () => {
    const db = makeMutableDb({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-02-01', stap: 5 }), // huidig anker
        meting({ categorie: 'partijen_midden', datum: '2026-03-01', stap: 6 }),
      ],
    })
    const first = await renderPeriodiseringMutable(db)
    expect(screen.getByText(nl.periodization.cycleTitle).parentElement!.textContent)
      .toContain(formatDate('2026-02-01', nl.browserLocale))

    fireEvent.click(within(blokVoor('partijen_midden')).getByText(nl.periodization.remeasureCta).closest('button')!)
    fireEvent.change(sheetDateInput(), { target: { value: '2026-04-01' } }) // later, maar nog steeds ná het anker
    await saveSheetAndWaitFor(() => expect(screen.queryByText(nl.periodization.save)).toBeNull())

    first.unmount()
    cleanup()
    await renderPeriodiseringMutable(db)
    expect(screen.getByText(nl.periodization.cycleTitle).parentElement!.textContent)
      .toContain(formatDate('2026-02-01', nl.browserLocale)) // ongewijzigd
  })

  it('AC16: de datum van de ankerbepalende meting wijzigen herberekent het anker op basis van de nieuwe vroegste datum', async () => {
    const db = makeMutableDb({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-02-01', stap: 5 }), // huidig anker
        meting({ categorie: 'partijen_midden', datum: '2026-03-01', stap: 6 }),
      ],
    })
    const first = await renderPeriodiseringMutable(db)

    const blokGroot = blokVoor('partijen_groot')
    fireEvent.click(within(blokGroot).getByText(nl.periodization.historyForCategory.replace('{n}', '1')).closest('button')!)
    fireEvent.click(within(blokGroot).getByText(nl.periodization.editNulmeting).closest('button')!)
    fireEvent.change(sheetDateInput(), { target: { value: '2026-04-01' } }) // later dan partijen_midden
    await saveSheetAndWaitFor(() => expect(screen.queryByText(nl.periodization.save)).toBeNull())

    first.unmount()
    cleanup()
    await renderPeriodiseringMutable(db)
    // partijen_groot is niet langer de vroegste — het anker verschuift naar
    // partijen_midden (2026-03-01), zonder dat aan partijen_midden zelf iets
    // veranderd is.
    expect(screen.getByText(nl.periodization.cycleTitle).parentElement!.textContent)
      .toContain(formatDate('2026-03-01', nl.browserLocale))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC17/AC18/edge 10/edge 11 — de actuele stap = nulmeting + floor(trainingen
// sinds de EIGEN meetdatum / 2), per onderdeel, ongeclampt boven het maximum
// ═══════════════════════════════════════════════════════════════════════
describe('AC17/AC18/edge 10/edge 11 — de getoonde actuele stap volgt nulmeting + floor(k/2), per onderdeel vanaf de eigen meetdatum, ongeclampt', () => {
  it('een training tussen twee meetdata telt voor het eerder gemeten onderdeel maar niet voor het later gemeten onderdeel; een training exact op een onderdeel-eigen meetdatum telt niet mee; de opgetelde stap mag boven het maximum uitkomen', async () => {
    await renderPeriodisering({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum: '2026-06-01', stap: 20 }), // max 21 — bijna vol
        meting({ categorie: 'partijen_midden', datum: '2026-06-10', stap: 8 }), // max 15
      ],
      events: [
        trainingEvent('t-b0', '2026-06-10'), // exact op partijen_midden's EIGEN meetdatum (edge 11)
        trainingEvent('t1', '2026-06-05'), // tussen de twee meetdata in
        trainingEvent('t2', '2026-06-15'),
        trainingEvent('t3', '2026-06-16'),
        trainingEvent('t4', '2026-06-17'),
        trainingEvent('t5', '2026-06-18'),
      ],
      trainingOefeningen: [
        trainingOefening('t-b0', 'partijen_midden'),
        trainingOefening('t1', 'partijen_groot'),
        trainingOefening('t1', 'partijen_midden'),
        trainingOefening('t2', 'partijen_groot'), trainingOefening('t2', 'partijen_midden'),
        trainingOefening('t3', 'partijen_groot'), trainingOefening('t3', 'partijen_midden'),
        trainingOefening('t4', 'partijen_groot'), trainingOefening('t4', 'partijen_midden'),
        trainingOefening('t5', 'partijen_groot'), trainingOefening('t5', 'partijen_midden'),
      ],
    })

    // partijen_groot (meetdatum 06-01): t1, t2, t3, t4, t5 tellen allemaal mee
    // (5 trainingen; t-b0 heeft geen oefening voor dit onderdeel) →
    // 20 + floor(5/2) = 22 — BOVEN het maximum van 21, bewust ongeclampt
    // getoond (edge 10).
    // partijen_midden (meetdatum 06-10): t-b0 telt NIET mee (exact op de
    // eigen meetdatum — edge 11); t1 telt NIET mee (vóór de eigen meetdatum —
    // dezelfde training telt wél voor partijen_groot, AC 18); t2..t5 tellen
    // wel (4) → 8 + floor(4/2) = 10.
    const statusKaart = screen.getByText(nl.periodization.currentSteps).closest('.surface-card') as HTMLElement
    const rijGroot = within(statusKaart).getByText(nl.periodization.categories.partijen_groot).closest('div')!
    expect(rijGroot).toHaveTextContent(`${nl.periodization.step} 22/21`)
    const rijMidden = within(statusKaart).getByText(nl.periodization.categories.partijen_midden).closest('div')!
    expect(rijMidden).toHaveTextContent(`${nl.periodization.step} 10/15`)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC20 — ongeldige datum: niets opgeslagen, foutmelding zichtbaar in de sheet
// ═══════════════════════════════════════════════════════════════════════
describe('AC20 — een ongeldige datum wordt geweigerd: niets opgeslagen, foutmelding zichtbaar in de sheet', () => {
  it('het datumveld leegmaken en opslaan toont de vertaalde foutmelding, de sheet blijft open, en er wordt niets geschreven', async () => {
    const db = makeMutableDb({ categorieMetingen: [] })
    await renderPeriodiseringMutable(db)

    fireEvent.click(within(blokVoor('sprints_veel_rust')).getByText(nl.periodization.measureCta).closest('button')!)
    fireEvent.change(sheetDateInput(), { target: { value: '' } })
    await saveSheetAndWaitFor(() => expect(screen.getByText(nl.periodization.errorInvalidDate)).toBeInTheDocument())

    // De sheet blijft open (opslaan-knop nog aanwezig) en er is niets geschreven.
    expect(screen.getByText(nl.periodization.save)).toBeInTheDocument()
    expect(db.tables.categorie_metingen).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC24 — niet ingelogd: het invulscherm /periodisering redirect naar /login
// ═══════════════════════════════════════════════════════════════════════
describe('AC24 — niet ingelogd: /periodisering redirect naar /login', () => {
  it('zonder ingelogde gebruiker gooit PeriodizationPage de bestaande redirect naar /login, vóórdat er een categorie_metingen-query draait', async () => {
    await expect(renderPeriodisering({ user: null })).rejects.toThrow('__redirect__:/login')
    expect(redirect).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC25 — bewerken of verwijderen van andermans onderdeel-nulmeting mislukt,
// diens data blijft ongewijzigd
// ═══════════════════════════════════════════════════════════════════════
describe('AC25 — bewerken of verwijderen van een onderdeel-nulmeting van een ander team mislukt, diens data blijft ongewijzigd', () => {
  it('bewerken van een meting-id van een ander team gooit "Meting niet gevonden" en laat die rij volledig intact', async () => {
    const vanAnderTeam = meting({
      id: 'ander-m1', team_id: 'ander-team', categorie: 'partijen_groot', datum: '2026-05-01', stap: 4, notes: 'blijf ervan af',
    })
    const db = makeMutableDb({ categorieMetingen: [vanAnderTeam] })
    installMutableDb(db, { id: TEAM }) // ingelogd als TEAM, de rij is van 'ander-team'

    await expect(
      saveCategorieMeting({ id: 'ander-m1', categorie: 'partijen_groot', datum: '2026-06-01', stap: 9, notes: 'gekaapt' }),
    ).rejects.toThrow('Meting niet gevonden')

    expect(db.tables.categorie_metingen).toEqual([vanAnderTeam])
  })

  it('verwijderen van een meting-id van een ander team gooit "Meting niet gevonden" en laat die rij volledig intact', async () => {
    const vanAnderTeam = meting({
      id: 'ander-m2', team_id: 'ander-team', categorie: 'partijen_klein', datum: '2026-05-01', stap: 4,
    })
    const db = makeMutableDb({ categorieMetingen: [vanAnderTeam] })
    installMutableDb(db, { id: TEAM })

    await expect(deleteCategorieMeting('ander-m2')).rejects.toThrow('Meting niet gevonden')
    expect(db.tables.categorie_metingen).toEqual([vanAnderTeam])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC26/edge 14 — twee snel opeenvolgende verzoeken voor hetzelfde onderdeel
// geven precies één actuele status, laatste waarde wint, zonder foutmelding
// ═══════════════════════════════════════════════════════════════════════
describe('AC26/edge 14 — twee snel opeenvolgende verzoeken voor hetzelfde onderdeel geven precies één rij; de laatst opgeslagen waarde geldt', () => {
  it('twee keer achter elkaar dezelfde categorie/datum opslaan (de tweede keer met een andere stap) levert precies één rij op, met de laatst opgeslagen stap', async () => {
    const db = makeMutableDb({ categorieMetingen: [] })
    await renderPeriodiseringMutable(db)

    fireEvent.click(within(blokVoor('partijen_klein')).getByText(nl.periodization.measureCta).closest('button')!)
    fireEvent.change(sheetDateInput(), { target: { value: '2026-10-01' } })
    fireEvent.change(sheetStepInput(), { target: { value: '5' } })
    await saveSheetAndWaitFor(() => expect(screen.queryByText(nl.periodization.save)).toBeNull())

    // Tweede verzoek: het gemounte component weet niets van het eerste (geen
    // live re-fetch in deze render-zonder-router-opzet — zelfde precedent als
    // afmeldperiode/dashboard-vorm), dus dit is een authentieke "twee keer
    // kort na elkaar"-situatie: opnieuw "Meting invullen" voor hetzelfde
    // onderdeel, dezelfde datum, een ANDERE stap.
    fireEvent.click(within(blokVoor('partijen_klein')).getByText(nl.periodization.measureCta).closest('button')!)
    fireEvent.change(sheetDateInput(), { target: { value: '2026-10-01' } })
    fireEvent.change(sheetStepInput(), { target: { value: '9' } })
    await saveSheetAndWaitFor(() => expect(screen.queryByText(nl.periodization.save)).toBeNull())

    const rijen = db.tables.categorie_metingen.filter((r) => r.categorie === 'partijen_klein')
    expect(rijen).toHaveLength(1) // AC 26: geen dubbele of tegenstrijdige registratie
    expect(rijen[0].stap).toBe(9) // edge 14: de laatst opgeslagen waarde geldt
    expect(screen.queryByText(nl.periodization.errorDuplicateDate)).toBeNull() // zonder conflictmelding
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC27 — bijwerken of verwijderen van een niet (meer) bestaande meting geeft
// een foutmelding, de bestaande status blijft ongewijzigd
// ═══════════════════════════════════════════════════════════════════════
describe('AC27 — bijwerken of verwijderen van een niet (meer) bestaande meting geeft een foutmelding, de bestaande status blijft ongewijzigd', () => {
  it('bewerken met een onbekend id gooit "Meting niet gevonden" en laat de bestaande meting van dit team ongewijzigd', async () => {
    const bestaand = meting({ id: 'echt-1', categorie: 'sprints_veel_rust', datum: '2026-05-01', stap: 5 })
    const db = makeMutableDb({ categorieMetingen: [bestaand] })
    installMutableDb(db)

    await expect(
      saveCategorieMeting({ id: 'bestaat-niet', categorie: 'sprints_veel_rust', datum: '2026-06-01', stap: 9, notes: null }),
    ).rejects.toThrow('Meting niet gevonden')

    expect(db.tables.categorie_metingen).toEqual([bestaand])
  })

  it('verwijderen met een onbekend id gooit "Meting niet gevonden" en verwijdert niets', async () => {
    const bestaand = meting({ id: 'echt-2', categorie: 'sprints_veel_rust', datum: '2026-05-01', stap: 5 })
    const db = makeMutableDb({ categorieMetingen: [bestaand] })
    installMutableDb(db)

    await expect(deleteCategorieMeting('bestaat-niet')).rejects.toThrow('Meting niet gevonden')
    expect(db.tables.categorie_metingen).toEqual([bestaand])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Edge 13 — een achteraf ingevoerde, oudere meting ("vergeten" nulmeting)
// verdringt de actuele niet
// ═══════════════════════════════════════════════════════════════════════
describe('Edge 13 — een achteraf ingevoerde, oudere meting ("vergeten" nulmeting) verdringt de actuele niet', () => {
  it('een oudere datum toevoegen aan een onderdeel met een al bestaande recentere meting laat de recentere de actuele status houden', async () => {
    const db = makeMutableDb({
      categorieMetingen: [meting({ categorie: 'sprints_veel_rust', datum: '2026-07-01', stap: 6 })],
    })
    const first = await renderPeriodiseringMutable(db)

    fireEvent.click(within(blokVoor('sprints_veel_rust')).getByText(nl.periodization.remeasureCta).closest('button')!)
    fireEvent.change(sheetDateInput(), { target: { value: '2026-05-01' } }) // vroeger dan de bestaande meting
    fireEvent.change(sheetStepInput(), { target: { value: '3' } })
    await saveSheetAndWaitFor(() => expect(screen.queryByText(nl.periodization.save)).toBeNull())

    expect(db.tables.categorie_metingen.filter((r) => r.categorie === 'sprints_veel_rust')).toHaveLength(2)

    first.unmount()
    cleanup()
    await renderPeriodiseringMutable(db)

    // De actuele status (de kop van het blok) blijft de meting met de
    // hoogste datum (07-01/stap 6), niet de net toegevoegde, oudere
    // (05-01/stap 3). (De 05-01-datum is elders in het blok wél zichtbaar,
    // in de delta-indicator "▲3 hoger dan vr 1 mei" — dat is AC 6, terecht.)
    const blok = blokVoor('sprints_veel_rust')
    expect(blok).toHaveTextContent(
      nl.periodization.measuredOn.replace('{date}', formatDate('2026-07-01', nl.browserLocale)),
    )
    expect(blok).toHaveTextContent(
      nl.periodization.progressUp.replace('{n}', '3').replace('{date}', formatDate('2026-05-01', nl.browserLocale)),
    )

    // Uitgeklapt staan beide in de geschiedenis, nieuwste eerst (AC 5).
    fireEvent.click(within(blok).getByText(nl.periodization.historyForCategory.replace('{n}', '2')).closest('button')!)
    const rijen = blok.querySelectorAll('.divide-y > div')
    expect(rijen).toHaveLength(2)
    expect(rijen[0].textContent).toContain(formatDate('2026-07-01', nl.browserLocale))
    expect(rijen[1].textContent).toContain(formatDate('2026-05-01', nl.browserLocale))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Edge 15 — tenant-isolatie geldt ook op /periodisering, inclusief de
// geschiedenis
// ═══════════════════════════════════════════════════════════════════════
describe('Edge 15 — tenant-isolatie geldt ook op /periodisering, inclusief de geschiedenis', () => {
  it('een meting van een ander team komt nergens op /periodisering terecht: het onderdeel blijft "nog niet gemeten" en heeft geen geschiedenis', async () => {
    await renderPeriodisering({
      categorieMetingen: [meting({ team_id: 'ander-team', categorie: 'partijen_groot', datum: '2026-06-01', stap: 9 })],
    })
    const blok = blokVoor('partijen_groot')
    expect(within(blok).getByText(nl.periodization.measureCta)).toBeInTheDocument() // niet "Hermeten"
    expect(blok).toHaveTextContent(nl.periodization.notMeasured)
    expect(within(blok).queryByText(/Geschiedenis/)).toBeNull() // geen geschiedenis-toggle
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Edge 16 — Warming-up, Positiespel, Pass- en trapvorm en Overig verschijnen
// niet in dit statusoverzicht
// ═══════════════════════════════════════════════════════════════════════
describe('Edge 16 — Warming-up, Positiespel, Pass- en trapvorm en Overig verschijnen niet in dit statusoverzicht', () => {
  it('geen van de vier krijgt een NulmetingManager-blok op /periodisering', async () => {
    await renderPeriodisering({ categorieMetingen: [] })
    for (const key of ['warming_up', 'positiespel', 'pass_trap', 'overig']) {
      const match = screen.queryAllByText(nl.periodization.categories[key]).find((el) => el.tagName === 'H3')
      expect(match, `${key} zou geen NulmetingManager-blok mogen hebben`).toBeUndefined()
    }
  })

  it('geen van de vier krijgt een rij op de dashboardkaart', async () => {
    await renderDashboard({ categorieMetingen: [] })
    const card = periodiseringCard()
    for (const key of ['warming_up', 'positiespel', 'pass_trap', 'overig']) {
      expect(within(card).queryByText(nl.periodization.categories[key])).toBeNull()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Edge 2 — bij alle vijf onderdelen gemeten blijft de Steigerungs-regel
// altijd zichtbaar
// ═══════════════════════════════════════════════════════════════════════
describe('Edge 2 — bij alle vijf onderdelen gemeten blijft de Steigerungs-regel altijd zichtbaar', () => {
  it('met alle vijf gemeten toont de kaart nog steeds de informatieve Steigerungs-regel', async () => {
    const datum = '2026-12-01'
    await renderDashboard({
      categorieMetingen: [
        meting({ categorie: 'partijen_groot', datum, stap: 5 }),
        meting({ categorie: 'partijen_midden', datum, stap: 6 }),
        meting({ categorie: 'partijen_klein', datum, stap: 7 }),
        meting({ categorie: 'sprints_weinig_rust', datum, stap: 8 }),
        meting({ categorie: 'sprints_veel_rust', datum, stap: 9 }),
      ],
    })
    const card = periodiseringCard()
    expect(
      within(card).getByText(nl.home.periodizationSteigerungs.replace('{a}', '1').replace('{b}', '2')),
    ).toBeInTheDocument()
  })
})
