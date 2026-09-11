// Acceptatietests — Cyclusweek-correctie op /periodisering + gedeeld
// chevron-icoon (user-story.md, technische-brief.md §5.3).
//
// ── AC → test-mapping (nummering volgt de goedgekeurde user story) ──
//   AC1  → describe('AC1 — trainer stelt in dat het team in week 6 zit ...')
//   AC2  → describe('AC2 — trainingsplanner-suggestie rolt door na de correctiedatum ...')
//   AC3  → describe('AC3 — vooruitblik-kaart en hoofdweergave gebruiken beide de correctie ...')
//   AC4  → describe('AC4 — herladen behoudt de ingestelde correctie ...')
//   AC5  → describe('AC5 — correctie zonder enige nulmeting (businessregel 13) ...')
//   AC6  → describe('AC6/AC7 — een ongeldige weekwaarde wordt geweigerd ...')
//   AC7  → zie AC6-describe hierboven
//   AC8  → describe('AC8 — niet ingelogd: redirect naar /login ...')
//   AC9  → gedekt door AC6/AC7 hierboven (validatiegrens 1..6, CYCLE_LENGTH_WEEKS)
//         en door lib/periodization.test.ts (niet dit bestand — unit-niveau)
//   AC10 → gedekt door AC2 hierboven (doorrol na week 6 naar week 1)
//   AC11 → gedekt door AC2/AC3 hierboven (werkt door op datums ná de
//         correctiedatum; AC12-describe bewijst het spiegelbeeld: vóór de
//         correctiedatum geldt het afgeleide anker)
//   AC12 → describe('AC12 — een verzet anker laat de correctie vervallen; opnieuw corrigeren wint weer ...')
//   AC13 → gedekt door AC5 hierboven (correctie zonder ooit een nulmeting)
//   AC14 → describe('AC14 — het "handmatig ingesteld"-label verschijnt alleen met een actieve correctie ...')
//   AC15 → describe('AC15 — de correctie raakt de stapweergave en de hermetings-hint niet ...')
//   AC16 → describe('AC16 — tenant-isolatie: correctie van team-2 raakt team-1 niet ...')
//   AC17 → describe('AC17 — de bestaande regressietest van de hermetings-hint
//         blijft slagen ...'): render zonder settings-rij (geen correctie) met
//         dezelfde spreiding > 42 dagen als nulmeting-per-onderdeel.acceptance.
//         test.tsx:719-764, en toont dat de hint verschijnt én de cyclusweek
//         exact cycleWeekFor(anker, vandaag) is — bewijs dat het rekenpad
//         zonder correctie ongewijzigd is
//   AC18 → describe('AC18/AC21 — NulmetingManager toont een chevron-icoon ...')
//   AC19 → describe('AC19/AC21 — OefeningEditor toont een chevron-icoon ...')
//   AC20 → describe('AC20/AC21 — LineupBuilder toont een chevron-icoon ...')
//   AC21 → zie AC18/AC19/AC20 hierboven (zelfde icoon + toggle-gedrag op alle
//         drie de plekken)
//
// ── Testmethode ──
// Van buitenaf: de ECHTE server components (PeriodizationPage,
// TrainingPlanPage), de ECHTE server actions (saveCyclusWeekCorrectie,
// deleteCyclusWeekCorrectie, saveCategorieMeting) en de ECHTE client
// components (CyclusWeekCorrectie, NulmetingManager, OefeningEditor,
// LineupBuilder) draaien ongewijzigd tegen een gemockte Supabase-client.
// Harnas (tableFactory/makeMutableDb) is een aangepaste kopie van
// nulmeting-per-onderdeel.acceptance.test.tsx:96-191/242-366 — dat bestand
// wordt niet gewijzigd.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { formatDate } from '@/lib/utils'
import { cycleWeekFor, serializeCyclusCorrectie, CYCLUS_CORRECTIE_KEY } from '@/lib/periodization'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
  // TrainingPlanPage rendert BackButton, dat useRouter gebruikt (component-
  // precedent: clubkleuren.acceptance.test.tsx:44).
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// saveCyclusWeekCorrectie/deleteCyclusWeekCorrectie/saveCategorieMeting roepen
// revalidatePath aan, wat buiten een echte Next-requestcontext crasht zonder
// deze mock (zelfde reden als nulmeting-per-onderdeel.acceptance.test.tsx:31).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PeriodizationPage from '@/app/periodisering/page'
import TrainingPlanPage from '@/app/events/[id]/training-plan/page'
import { saveCyclusWeekCorrectie } from '@/app/actions/periodisering'
import OefeningEditor from '@/components/OefeningEditor'
import LineupBuilder from '@/components/LineupBuilder'
import type { Player } from '@/lib/types'

// Vaste "vandaag" — dezelfde datum als de voorbeelden in de technische brief
// (correctiedatum 2026-09-08), zodat todayLocal() deterministisch is.
const TODAY = '2026-09-08'
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

function correctieRow(value: string, teamId: string = TEAM): Row {
  return { team_id: teamId, key: CYCLUS_CORRECTIE_KEY, value }
}

function trainingEvent(id: string, date: string, overrides: Row = {}): Row {
  // trainingstype: 'vct' — anders matcht het .eq('trainingstype','vct')-filter
  // in getTrainingLog niets (backend-feedback; breekt deze tests nu nog niet
  // omdat ze niet op de telling zelf toetsen, maar voorkomt stille drift).
  return { id, team_id: TEAM, type: 'training', date, time: null, trainingstype: 'vct', ...overrides }
}

// ═══════════════════════════════════════════════════════════════════════
// Muteerbare Supabase-tabel-engine — aangepaste kopie van
// nulmeting-per-onderdeel.acceptance.test.tsx:242-366 (makeMutableDb): een
// generieke method-chain-engine tegen een in-memory rijenset per tabel, die
// onbekende tabellen lazy aanmaakt (o.a. 'settings') zodat zowel de
// leeskant (select/eq/order/limit/maybeSingle) als de schrijfkant
// (upsert met onConflict, delete, update) van de ECHTE server actions en
// server components hiertegen draaien — geen call-recording, echte mutatie.
// ═══════════════════════════════════════════════════════════════════════
function makeMutableDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }))
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

async function renderPeriodisering(
  db: ReturnType<typeof makeMutableDb>,
  user: { id: string } | null = { id: TEAM },
) {
  installMutableDb(db, user)
  const el = await PeriodizationPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

async function renderTrainingPlan(
  db: ReturnType<typeof makeMutableDb>,
  eventId: string,
  user: { id: string } | null = { id: TEAM },
) {
  installMutableDb(db, user)
  const el = await TrainingPlanPage({ params: Promise.resolve({ id: eventId }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

function blokVoor(categorieKey: string): HTMLElement {
  const label = screen
    .getAllByText(nl.periodization.categories[categorieKey])
    .find((el) => el.tagName === 'H3')
  if (!label) throw new Error(`Blok voor ${categorieKey} niet gevonden`)
  const blok = label.closest('.surface-card')
  if (!blok) throw new Error(`Blok voor ${categorieKey} niet gevonden`)
  return blok as HTMLElement
}

function sheetDateInput(): HTMLInputElement {
  return screen.getByLabelText(nl.periodization.date) as HTMLInputElement
}
function sheetStepInput(): HTMLInputElement {
  return screen.getByLabelText(/^max \d+ stappen$/) as HTMLInputElement
}

// RTL's waitFor-polling werkt niet betrouwbaar onder vi.useFakeTimers()
// (zelfde reden als nulmeting-per-onderdeel.acceptance.test.tsx:400-410):
// tijdelijk naar echte timers, en na afloop de vaste testklok herstellen.
async function withRealTimers(fn: () => void, check: () => void) {
  vi.useRealTimers()
  fn()
  await waitFor(check)
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`))
}

// Opent de sheet, kiest "Week {n}" en klikt op "Week opslaan".
async function stelCorrectieIn(n: number) {
  fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))
  fireEvent.click(screen.getByRole('radio', { name: nl.periodization.adjustWeekOption.replace('{n}', String(n)) }))
  await withRealTimers(
    () => fireEvent.click(screen.getByText(nl.periodization.saveWeek)),
    () => expect(screen.queryByText(nl.periodization.saveWeek)).toBeNull(),
  )
}

// ═══════════════════════════════════════════════════════════════════════
// AC1 — trainer stelt in dat het team in week 6 zit
// ═══════════════════════════════════════════════════════════════════════
describe('AC1 — trainer stelt in dat het team in week 6 zit', () => {
  it('op basis van het afgeleide anker toont /periodisering "week 2 van de cyclus"; na de correctie via de echte sheet toont een herlaad "week 6 van de cyclus"', async () => {
    // anker = 2026-09-01 (7 dagen vóór TODAY) → cycleWeekFor geeft week 2.
    const db = makeMutableDb({
      categorie_metingen: [meting({ categorie: 'partijen_groot', datum: '2026-09-01', stap: 5 })],
    })
    const first = await renderPeriodisering(db)
    expect(screen.getByText(/week 2 van de cyclus/)).toBeInTheDocument()

    await stelCorrectieIn(6)
    expect(db.tables.settings).toHaveLength(1)
    expect(db.tables.settings[0]).toMatchObject({ team_id: TEAM, key: CYCLUS_CORRECTIE_KEY })

    // "Herlaad" = de ECHTE server component opnieuw uitvoeren tegen de nu
    // bijgewerkte database (zelfde precedent als nulmeting-per-onderdeel.
    // acceptance.test.tsx AC15/AC16).
    first.unmount()
    cleanup()
    await renderPeriodisering(db)
    expect(screen.getByText(/week 6 van de cyclus/)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC2 — de trainingsplanner-suggestie rolt door na de correctiedatum
// ═══════════════════════════════════════════════════════════════════════
describe('AC2 — trainingsplanner-suggestie rolt door na de correctiedatum', () => {
  it('een training 7 dagen na de correctiedatum (week 6) toont de suggesties van week 1', async () => {
    // Anker bij correctie = 2026-08-01 (moet gelijk zijn aan het NU afgeleide
    // anker, anders is de correctie vervallen — businessregel 12).
    const db = makeMutableDb({
      categorie_metingen: [meting({ categorie: 'partijen_groot', datum: '2026-08-01', stap: 5 })],
      events: [trainingEvent('e1', '2026-09-15')],
      settings: [correctieRow(serializeCyclusCorrectie({ week: 6, datum: TODAY, ankerBijCorrectie: '2026-08-01' }))],
    })
    await renderTrainingPlan(db, 'e1')

    expect(screen.getByText(nl.periodization.suggestTitle)).toBeInTheDocument()
    const suggestieKaart = screen.getByText(nl.periodization.suggestTitle).closest('div')!.parentElement as HTMLElement
    expect(within(suggestieKaart).getByText(nl.periodization.cycleWeek.replace('{n}', '1'))).toBeInTheDocument()
    expect(within(suggestieKaart).getByText(nl.periodization.categories.partijen_groot)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC3 — vooruitblik-kaart en hoofdweergave gebruiken beide de correctie
// ═══════════════════════════════════════════════════════════════════════
describe('AC3 — vooruitblik-kaart en hoofdweergave gebruiken beide de correctie', () => {
  it('met een actieve correctie tonen zowel de vooruitblik-kaart als de hoofdweergave een van de correctie afgeleide cyclusweek', async () => {
    const db = makeMutableDb({
      categorie_metingen: [meting({ categorie: 'partijen_groot', datum: '2026-08-01', stap: 5 })],
      events: [trainingEvent('e1', '2026-09-15')],
      settings: [correctieRow(serializeCyclusCorrectie({ week: 6, datum: TODAY, ankerBijCorrectie: '2026-08-01' }))],
    })
    await renderPeriodisering(db)

    // Hoofdweergave: vandaag (TODAY == correctiedatum) toont exact week 6.
    expect(screen.getByText(/week 6 van de cyclus/)).toBeInTheDocument()

    // Vooruitblik voor de eerstvolgende training (2026-09-15, 7 dagen later):
    // week 1 (na week 6 rolt de cyclus door), met de bijbehorende due-badge.
    expect(screen.getByText(nl.periodization.nextTrainingDue.replace('{n}', '1'))).toBeInTheDocument()
    const vooruitblikKaart = screen.getByText(nl.periodization.nextTrainingTitle).closest('.surface-card') as HTMLElement
    expect(within(vooruitblikKaart).getByText(nl.periodization.categories.partijen_groot)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC4 — herladen behoudt de ingestelde correctie
// ═══════════════════════════════════════════════════════════════════════
describe('AC4 — herladen behoudt de ingestelde correctie', () => {
  it('twee onafhankelijke renders tegen dezelfde settings-rij tonen dezelfde cyclusweek en hetzelfde label', async () => {
    const db = makeMutableDb({
      categorie_metingen: [meting({ categorie: 'partijen_groot', datum: '2026-08-01', stap: 5 })],
      settings: [correctieRow(serializeCyclusCorrectie({ week: 6, datum: TODAY, ankerBijCorrectie: '2026-08-01' }))],
    })
    const first = await renderPeriodisering(db)
    expect(screen.getByText(/week 6 van de cyclus/)).toBeInTheDocument()
    expect(screen.getByText(nl.periodization.manualWeekSince.replace('{date}', formatDate(TODAY, nl.browserLocale)))).toBeInTheDocument()
    first.unmount()
    cleanup()

    await renderPeriodisering(db)
    expect(screen.getByText(/week 6 van de cyclus/)).toBeInTheDocument()
    expect(screen.getByText(nl.periodization.manualWeekSince.replace('{date}', formatDate(TODAY, nl.browserLocale)))).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC5/AC13 — correctie zonder enige nulmeting (businessregel 13)
// ═══════════════════════════════════════════════════════════════════════
describe('AC5 — correctie zonder enige nulmeting (businessregel 13)', () => {
  it('geen nulmetingen + een actieve correctie tonen een lopende cyclusweek; de vijf onderdelen blijven "nog niet gemeten"', async () => {
    const db = makeMutableDb({
      categorie_metingen: [],
      settings: [correctieRow(serializeCyclusCorrectie({ week: 6, datum: TODAY, ankerBijCorrectie: null }))],
    })
    await renderPeriodisering(db)

    expect(screen.getByText(/week 6 van de cyclus/)).toBeInTheDocument()
    for (const key of ['partijen_groot', 'partijen_midden', 'partijen_klein', 'sprints_weinig_rust', 'sprints_veel_rust']) {
      expect(blokVoor(key)).toHaveTextContent(nl.periodization.notMeasured)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC6/AC7/AC9 — een ongeldige weekwaarde wordt geweigerd
// ═══════════════════════════════════════════════════════════════════════
// De sheet biedt uitsluitend zes vaste knoppen (Week 1..6, role="radio"); een
// gebruiker kan via de ECHTE UI dus structureel geen waarde buiten 1-6 of een
// niet-gehele/niet-numerieke waarde indienen — dat is zelf al bewijs dat de
// UI het criterium afdwingt. Het faalpad wordt hier daarom getoetst tegen de
// publieke server-actie zelf (`saveCyclusWeekCorrectie`), het contract dat de
// UI aanroept en de enige plek die de waarde ooit valideert (brief §3.1).
describe('AC6/AC7 — een ongeldige weekwaarde wordt geweigerd, niets wordt opgeslagen', () => {
  it.each([0, 7, 3.5, NaN])('week = %s wordt geweigerd met "Ongeldige cyclusweek"; er wordt niets opgeslagen', async (bad) => {
    const db = makeMutableDb({ categorie_metingen: [] })
    installMutableDb(db)
    await expect(saveCyclusWeekCorrectie(bad)).rejects.toThrow('Ongeldige cyclusweek')
    expect(db.tables.settings ?? []).toHaveLength(0)
  })

  it.each(['', 'abc'])('week = %j (niet-numeriek) wordt geweigerd met "Ongeldige cyclusweek"; er wordt niets opgeslagen', async (bad) => {
    const db = makeMutableDb({ categorie_metingen: [] })
    installMutableDb(db)
    await expect(saveCyclusWeekCorrectie(bad as unknown as number)).rejects.toThrow('Ongeldige cyclusweek')
    expect(db.tables.settings ?? []).toHaveLength(0)
  })

  it('een al actieve correctie blijft ongewijzigd staan wanneer een volgende, ongeldige correctie wordt geweigerd', async () => {
    const bestaand = correctieRow(serializeCyclusCorrectie({ week: 3, datum: '2026-09-01', ankerBijCorrectie: null }))
    const db = makeMutableDb({ categorie_metingen: [], settings: [bestaand] })
    installMutableDb(db)
    await expect(saveCyclusWeekCorrectie(0)).rejects.toThrow('Ongeldige cyclusweek')
    expect(db.tables.settings).toEqual([bestaand])
  })

  it('de sheet biedt uitsluitend "Week 1".."Week 6" aan — geen enkele manier om via de UI een waarde buiten 1-6 te kiezen', async () => {
    const db = makeMutableDb({ categorie_metingen: [] })
    await renderPeriodisering(db)
    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(6)
    expect(radios.map((r) => r.textContent)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `Week ${n}`))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC8 — niet ingelogd: redirect naar /login
// ═══════════════════════════════════════════════════════════════════════
describe('AC8 — niet ingelogd: /periodisering redirect naar /login', () => {
  it('zonder ingelogde gebruiker gooit PeriodizationPage de bestaande redirect naar /login', async () => {
    const db = makeMutableDb({ categorie_metingen: [] })
    await expect(renderPeriodisering(db, null)).rejects.toThrow('__redirect__:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC12 — een verzet anker laat de correctie vervallen; opnieuw corrigeren
// wint weer (businessregel 12)
// ═══════════════════════════════════════════════════════════════════════
describe('AC12 — een verzet anker laat de correctie vervallen; opnieuw corrigeren wint weer', () => {
  it('een nulmeting die het anker verzet doet het label verdwijnen en de week terugvallen op het afgeleide anker; een nieuwe correctie wint weer', async () => {
    const anker = '2026-08-01'
    const db = makeMutableDb({
      categorie_metingen: [meting({ categorie: 'partijen_groot', datum: anker, stap: 5 })],
      settings: [correctieRow(serializeCyclusCorrectie({ week: 3, datum: '2026-09-01', ankerBijCorrectie: anker }))],
    })
    const first = await renderPeriodisering(db)
    // Correctie actief: label zichtbaar op de datum van instellen (2026-09-01).
    expect(screen.getByText(nl.periodization.manualWeekSince.replace('{date}', formatDate('2026-09-01', nl.browserLocale)))).toBeInTheDocument()

    // Een nulmeting met een EERDERE datum dan het huidige anker verzet het
    // afgeleide anker (businessregel 12) — via de echte NulmetingManager-sheet.
    const nieuwAnker = '2026-07-01'
    fireEvent.click(within(blokVoor('partijen_midden')).getByText(nl.periodization.measureCta).closest('button')!)
    fireEvent.change(sheetDateInput(), { target: { value: nieuwAnker } })
    fireEvent.change(sheetStepInput(), { target: { value: '5' } })
    await withRealTimers(
      () => fireEvent.click(screen.getByText(nl.periodization.save)),
      () => expect(screen.queryByText(nl.periodization.save)).toBeNull(),
    )

    first.unmount()
    cleanup()
    const second = await renderPeriodisering(db)
    // Label weg: de correctie is vervallen doordat het anker verschoof.
    expect(screen.queryByText(/Handmatig ingesteld op/)).toBeNull()
    // Week terug op het (nieuwe) afgeleide anker.
    const verwachteWeek = cycleWeekFor(nieuwAnker, TODAY)
    expect(screen.getByText(new RegExp(`week ${verwachteWeek} van de cyclus`))).toBeInTheDocument()

    // Opnieuw corrigeren: de nieuwe correctie wint weer.
    await stelCorrectieIn(5)
    second.unmount()
    cleanup()
    await renderPeriodisering(db)
    expect(screen.getByText(/week 5 van de cyclus/)).toBeInTheDocument()
    expect(screen.getByText(nl.periodization.manualWeekSince.replace('{date}', formatDate(TODAY, nl.browserLocale)))).toBeInTheDocument()
  })

  it('edge: een latere, niet-ankerbepalende meting verandert het afgeleide anker niet — de correctie blijft gewoon gelden', async () => {
    const anker = '2026-08-01'
    const db = makeMutableDb({
      categorie_metingen: [
        meting({ categorie: 'partijen_groot', datum: anker, stap: 5 }),
        meting({ categorie: 'partijen_midden', datum: '2026-08-15', stap: 6 }),
      ],
      settings: [correctieRow(serializeCyclusCorrectie({ week: 6, datum: TODAY, ankerBijCorrectie: anker }))],
    })
    await renderPeriodisering(db)
    expect(screen.getByText(nl.periodization.manualWeekSince.replace('{date}', formatDate(TODAY, nl.browserLocale)))).toBeInTheDocument()
    expect(screen.getByText(/week 6 van de cyclus/)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC14 — het "handmatig ingesteld"-label verschijnt alleen met een actieve
// correctie
// ═══════════════════════════════════════════════════════════════════════
describe('AC14 — het "handmatig ingesteld"-label verschijnt alleen met een actieve correctie', () => {
  it('mét correctie: het label is zichtbaar', async () => {
    const db = makeMutableDb({
      categorie_metingen: [meting({ categorie: 'partijen_groot', datum: '2026-08-01', stap: 5 })],
      settings: [correctieRow(serializeCyclusCorrectie({ week: 6, datum: TODAY, ankerBijCorrectie: '2026-08-01' }))],
    })
    await renderPeriodisering(db)
    expect(screen.getByText(/Handmatig ingesteld op/)).toBeInTheDocument()
  })

  it('zonder correctie: het label is afwezig', async () => {
    const db = makeMutableDb({
      categorie_metingen: [meting({ categorie: 'partijen_groot', datum: '2026-08-01', stap: 5 })],
    })
    await renderPeriodisering(db)
    expect(screen.queryByText(/Handmatig ingesteld op/)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC15 — de correctie raakt de stapweergave en de hermetings-hint niet
// (businessregel 15)
// ═══════════════════════════════════════════════════════════════════════
describe('AC15 — de correctie raakt de per-onderdeel stapweergave en de hermetings-hint niet', () => {
  it('per-onderdeel stappen en de hermetings-hint zijn identiek mét en zonder een actieve correctie', async () => {
    const CATS = ['partijen_groot', 'partijen_midden', 'partijen_klein', 'sprints_weinig_rust', 'sprints_veel_rust']
    function snapshot() {
      const statusKaart = screen.getByText(nl.periodization.currentSteps).closest('.surface-card') as HTMLElement
      const stapTeksten = CATS.map(
        (key) => within(statusKaart).getByText(nl.periodization.categories[key]).closest('div')!.textContent,
      )
      const hintZichtbaar = screen.queryByText(/Hermeting loopt/) !== null
      return { stapTeksten, hintZichtbaar }
    }

    // Vier onderdelen op dezelfde datum, één ruim > 42 dagen later — spreiding
    // ver in het verleden zodat de peildatum (morgen t.o.v. TODAY) alle
    // metingen als "actueel" meetelt, ongeacht de vaste testklok.
    const gedeeldeDatum = '2025-01-01'
    const uitloperDatum = '2025-06-01' // 151 dagen later, > 42
    const categorieMetingen = [
      meting({ categorie: 'partijen_groot', datum: gedeeldeDatum, stap: 5 }),
      meting({ categorie: 'partijen_midden', datum: gedeeldeDatum, stap: 6 }),
      meting({ categorie: 'partijen_klein', datum: gedeeldeDatum, stap: 7 }),
      meting({ categorie: 'sprints_weinig_rust', datum: gedeeldeDatum, stap: 8 }),
      meting({ categorie: 'sprints_veel_rust', datum: uitloperDatum, stap: 9 }),
    ]

    const dbZonder = makeMutableDb({ categorie_metingen: categorieMetingen })
    const { unmount } = await renderPeriodisering(dbZonder)
    const zonderCorrectie = snapshot()
    expect(zonderCorrectie.hintZichtbaar).toBe(true)
    unmount()
    cleanup()

    const dbMet = makeMutableDb({
      categorie_metingen: categorieMetingen,
      settings: [correctieRow(serializeCyclusCorrectie({ week: 6, datum: TODAY, ankerBijCorrectie: gedeeldeDatum }))],
    })
    await renderPeriodisering(dbMet)
    const metCorrectie = snapshot()

    expect(screen.getByText(/Handmatig ingesteld op/)).toBeInTheDocument() // correctie is wel degelijk actief
    expect(metCorrectie).toEqual(zonderCorrectie)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC16 — tenant-isolatie: correctie van team-2 raakt team-1 niet
// ═══════════════════════════════════════════════════════════════════════
describe('AC16 — tenant-isolatie: een correctie van team-2 heeft geen effect op team-1', () => {
  it('een settings-rij van team-2 laat de /periodisering van team-1 volledig ongemoeid', async () => {
    const db = makeMutableDb({
      categorie_metingen: [meting({ categorie: 'partijen_groot', datum: '2026-09-01', stap: 5 })], // anker → week 2
      settings: [correctieRow(serializeCyclusCorrectie({ week: 6, datum: TODAY, ankerBijCorrectie: null }), 'team-2')],
    })
    await renderPeriodisering(db, { id: TEAM })

    expect(screen.getByText(/week 2 van de cyclus/)).toBeInTheDocument() // afgeleid anker, niet team-2's correctie
    expect(screen.queryByText(/Handmatig ingesteld op/)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC17 — de bestaande hint-regressietest blijft slagen
// ═══════════════════════════════════════════════════════════════════════
describe('AC17 — de bestaande regressietest van de hermetings-hint blijft slagen', () => {
  it('zonder correctie (dezelfde spreiding > 42 dagen als de hint-regressietest) is de hint zichtbaar én is de getoonde cyclusweek exact cycleWeekFor(anker, vandaag) — het rekenpad zonder correctie is dus byte-identiek aan het oude, ongewijzigde gedrag van nulmeting-per-onderdeel.acceptance.test.tsx:719-764', async () => {
    // Zelfde opzet als de hint-regressietest (variant A daar): vier onderdelen
    // op één gedeeld anker, één onderdeel ruim > 42 dagen later — dat triggert
    // de hint. GEEN settings-rij hier, dus geen correctie: dit bewijst dat het
    // pad zonder correctie ongewijzigd is, niet alleen dat het oude bestand
    // toevallig nog slaagt.
    const anker = '2026-01-01'
    const uitloperDatum = TODAY // (2026-09-08) — ver > 42 dagen na het anker
    const db = makeMutableDb({
      categorie_metingen: [
        meting({ categorie: 'partijen_groot', datum: anker, stap: 5 }),
        meting({ categorie: 'partijen_midden', datum: anker, stap: 6 }),
        meting({ categorie: 'partijen_klein', datum: anker, stap: 7 }),
        meting({ categorie: 'sprints_weinig_rust', datum: anker, stap: 8 }),
        meting({ categorie: 'sprints_veel_rust', datum: uitloperDatum, stap: 9 }),
      ],
    })
    await renderPeriodisering(db)

    expect(screen.getByText(/Hermeting loopt/)).toBeInTheDocument()
    const verwachteWeek = cycleWeekFor(anker, TODAY)
    expect(screen.getByText(new RegExp(`week ${verwachteWeek} van de cyclus`))).toBeInTheDocument()
    expect(screen.queryByText(/Handmatig ingesteld op/)).toBeNull() // geen correctie actief
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC18/AC21 — NulmetingManager toont een chevron-icoon, geen letterlijke
// iconnaam, en toggelt zichtbaar bij open/dicht
// ═══════════════════════════════════════════════════════════════════════
describe('AC18/AC21 — NulmetingManager toont een chevron-icoon, nooit de tekst "expand_more"/"expand_less"', () => {
  it('de geschiedenis-toggle bevat een svg, geen tekstnode met de iconnaam, en rotate-180 verschijnt/verdwijnt bij het in-/uitklappen', async () => {
    const db = makeMutableDb({
      categorie_metingen: [meting({ categorie: 'partijen_groot', datum: '2026-08-01', stap: 5 })],
    })
    await renderPeriodisering(db)

    const blok = blokVoor('partijen_groot')
    const toggle = within(blok).getByText(nl.periodization.historyForCategory.replace('{n}', '1')).closest('button')!
    const svg = toggle.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(screen.queryByText('expand_more')).toBeNull()
    expect(screen.queryByText('expand_less')).toBeNull()
    expect(svg!.getAttribute('class')).not.toContain('rotate-180')

    fireEvent.click(toggle)
    expect(svg!.getAttribute('class')).toContain('rotate-180')
    fireEvent.click(toggle)
    expect(svg!.getAttribute('class')).not.toContain('rotate-180')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC19/AC21 — OefeningEditor toont een chevron-icoon voor de tekening-toggle
// ═══════════════════════════════════════════════════════════════════════
describe('AC19/AC21 — OefeningEditor toont een chevron-icoon, nooit de tekst "expand_more"/"chevron_right"', () => {
  it('de tekening-toggle bevat een svg, geen tekstnode met de iconnaam, en rotate-180 verschijnt bij het openklappen', () => {
    render(
      <DictProvider dict={nl}>
        <OefeningEditor onCancel={vi.fn()} onSubmit={vi.fn().mockResolvedValue(undefined)} />
      </DictProvider>,
    )
    const toggle = screen.getByText(nl.oefeningen.diagramToggle).closest('button')!
    const svg = toggle.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(screen.queryByText('expand_more')).toBeNull()
    expect(screen.queryByText('chevron_right')).toBeNull()
    expect(svg!.getAttribute('class')).not.toContain('rotate-180')

    fireEvent.click(toggle)
    expect(svg!.getAttribute('class')).toContain('rotate-180')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC20/AC21 — LineupBuilder toont een chevron-icoon voor de formatiekiezer
// ═══════════════════════════════════════════════════════════════════════
describe('AC20/AC21 — LineupBuilder toont een chevron-icoon, nooit de tekst "expand_more"', () => {
  function player(overrides: Partial<Player> = {}): Player {
    return {
      id: 'p1', name: 'Speler Een', position: 'Centrale middenvelder', secondary_positions: [],
      jersey_number: 8, active: true, injured: false, type: 'regular', rating: null,
      created_at: '2026-01-01T00:00:00Z',
      ...overrides,
    }
  }

  beforeEach(() => {
    // LineupBuilder gebruikt useReducedMotion; jsdom kent window.matchMedia
    // niet standaard — zelfde stub als components/LineupBuilder.test.tsx.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
      })),
    })
  })

  it('de formatiekiezer bevat een svg, geen tekstnode met de iconnaam, en rotate-180 verschijnt/verdwijnt bij het in-/uitklappen', () => {
    render(
      <DictProvider dict={nl}>
        <LineupBuilder eventId="event-1" players={[player()]} playerForm={{}} />
      </DictProvider>,
    )
    // aria-labelledby wijst naar twee id's (bestaand label + de knop zelf) —
    // geen betrouwbare accessible-name-match voor getByRole; selecteren via
    // het unieke element-id (components/LineupBuilder.tsx:213) is hier
    // duidelijker dan een broze naam-regex.
    const toggle = document.getElementById('formatie-kiezer') as HTMLElement
    expect(toggle).not.toBeNull()
    const svg = toggle.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(screen.queryByText('expand_more')).toBeNull()
    expect(svg!.getAttribute('class')).not.toContain('rotate-180')

    fireEvent.click(toggle)
    expect(svg!.getAttribute('class')).toContain('rotate-180')
    fireEvent.click(toggle)
    expect(svg!.getAttribute('class')).not.toContain('rotate-180')
  })
})
