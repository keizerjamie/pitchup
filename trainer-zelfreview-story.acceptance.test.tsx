// Story-acceptatietest — trainer-zelfreview (To-do + Inzichten), AC1 t/m AC27.
// Bron: ff-trainer-review/02-user-story.md (GOEDGEKEURD 2026-11-12, beslissingen 1-15).
//
// Methode (van buitenaf, geen unit-tests):
//  - De ECHTE async server components (dashboard, eventpagina, Inzichten), de
//    ECHTE client-componenten en de ECHTE server action saveTrainerZelfreview
//    draaien tegen één stateful in-memory tabel-engine die .eq/.in/.gte/...
//    en upsert(onConflict) toepast en elke query/mutatie vastlegt. Een klik op
//    "opslaan" schrijft dus echt een rij die de volgende paginarender leest.
//  - Alleen de teamcontext (rol + rechten) en next/* worden gestubd;
//    canEdit/assertCanEdit blijven de echte.
//  - RLS/DB-gedrag (AC15 op DB-niveau, AC19, AC20, AC21, AC25 op DB-niveau)
//    kan een jsdom-test niet bewijzen: dat wordt STRUCTUREEL getoetst op
//    supabase/trainer-zelfreview.sql en op het handmatige verificatieblok 31
//    in supabase/team-rls-verificatie.sql. Die tests dragen "(structureel)"
//    in de naam; het echte gedrag bewijst alleen blok 31 op een live database.
//
// "Vandaag" = 2026-08-03 (lokaal), met alleen `Date` gefaked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { ZELFREVIEW_STELLINGEN, type ZelfreviewStelling } from '@/lib/trainer-zelfreview'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
  notFound: vi.fn(() => { throw new Error('__notFound__') }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
  headers: vi.fn().mockResolvedValue({ get: () => null }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/team-context', async (orig) => ({
  ...(await orig<typeof import('@/lib/team-context')>()),
  requireTeamContextOrLogin: vi.fn(),
  requireTeamContext: vi.fn(),
}))
const mockSettings: { waarde: Record<string, string> } = { waarde: {} }
vi.mock('@/app/actions/settings', () => ({ getAllSettings: vi.fn(async () => mockSettings.waarde) }))

import { createClient } from '@/lib/supabase/server'
import { requireTeamContextOrLogin, requireTeamContext } from '@/lib/team-context'
import { revalidatePath } from 'next/cache'
import { saveTrainerZelfreview } from '@/app/actions/trainer-zelfreview'
import { markTaskDone } from '@/app/actions/todos'
import DashboardPage from '@/app/page'
import EventDetailPage from '@/app/events/[id]/page'
import InzichtenPage from '@/app/inzichten/page'
import ZelfreviewKaart from '@/components/inzichten/ZelfreviewKaart'
import { zelfreviewsPerWeek } from '@/lib/inzichten'

// ── Fixtures ──────────────────────────────────────────────────────────

const TODAY = '2026-08-03'
const TEAM = 'team-1'
const USER = '0a000000-0000-4000-8000-0000000000a1'
const ANDER = '0a000000-0000-4000-8000-0000000000a2'
const E1 = '0e000000-0000-4000-8000-000000000001'
const E2 = '0e000000-0000-4000-8000-000000000002'
const E3 = '0e000000-0000-4000-8000-000000000003'
const E_ANDER_TEAM = '0e000000-0000-4000-8000-0000000000f1'
const E_MATCH = '0e000000-0000-4000-8000-0000000000a9'
type Row = Record<string, unknown>
type Db = Record<string, Row[]>

function dag(n: number): string {
  const d = new Date(`${TODAY}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const training = (id: string, datum: string, o: Row = {}): Row => ({
  id, team_id: TEAM, type: 'training', date: datum, time: null, location: null, match_type: null,
  opponent: null, home_away: null, notes: null, doelstelling: null, goals_for: null, goals_against: null,
  created_at: '2026-07-01T10:00:00Z', ...o,
})
const review = (eventId: string, o: Row = {}): Row => ({
  event_id: eventId, team_id: TEAM, user_id: USER,
  score_uitleg: 4, score_organisatie: 3, score_coaching: 5, score_sfeer: 2, score_tijdsbewaking: 1, meeneem: 'Korter uitleggen',
  ...o,
})

// ── Stateful in-memory tabel-engine ───────────────────────────────────

interface Query { table: string; filters: [string, unknown][] }
interface Mutatie { table: string; kind: 'upsert'; payload: Row; onConflict?: string }
let queries: Query[]
let mutaties: Mutatie[]
let db: Db
let fouten: Record<string, unknown>
let upsertFout: unknown

function maakClient(user: string) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: user } } }) },
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table: string) => {
      const q: Query = { table, filters: [] }
      queries.push(q)
      const preds: ((r: Row) => boolean)[] = []
      const rijen = () => (db[table] ?? []).filter((r) => preds.every((p) => p(r)))
      const resultaat = () => (fouten[table]
        ? { data: null, error: fouten[table] }
        : { data: rijen(), error: null, count: rijen().length })
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: unknown) => { q.filters.push([c, v]); preds.push((r) => r[c] === v); return chain },
        neq: (c: string, v: unknown) => { preds.push((r) => r[c] !== v); return chain },
        gte: (c: string, v: unknown) => { preds.push((r) => (r[c] as string) >= (v as string)); return chain },
        lte: (c: string, v: unknown) => { preds.push((r) => (r[c] as string) <= (v as string)); return chain },
        lt: (c: string, v: unknown) => { preds.push((r) => (r[c] as string) < (v as string)); return chain },
        in: (c: string, v: unknown[]) => { q.filters.push([c, v]); preds.push((r) => v.includes(r[c])); return chain },
        not: () => chain, is: () => chain, gt: () => chain, order: () => chain, limit: () => chain,
        upsert: (payload: Row, opts?: { onConflict?: string }) => {
          mutaties.push({ table, kind: 'upsert', payload, onConflict: opts?.onConflict })
          if (!upsertFout) {
            const sleutels = (opts?.onConflict ?? 'id').split(',')
            const lijst = (db[table] ??= [])
            const i = lijst.findIndex((r) => sleutels.every((k) => r[k] === payload[k]))
            if (i >= 0) lijst[i] = { ...lijst[i], ...payload }
            else lijst.push({ ...payload })
          }
          return Promise.resolve({ data: null, error: upsertFout ?? null })
        },
        maybeSingle: () => {
          const r = resultaat()
          return Promise.resolve(r.error ? r : { data: rijen()[0] ?? null, error: null })
        },
        single: () => Promise.resolve({ data: rijen()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resultaat()).then(res, rej),
      }
      return chain
    },
  }
}

let huidigeUser = USER
function gebruikClient() {
  vi.mocked(createClient).mockResolvedValue(maakClient(huidigeUser) as unknown as Awaited<ReturnType<typeof createClient>>)
}

function zetContext(rol: 'owner' | 'assistent', trainingRecht = false, userId = USER) {
  huidigeUser = userId
  const ctx = {
    userId, teamId: TEAM, rol, naam: 'Team',
    rechten: { agenda: false, aanwezigheid: false, training: trainingRecht, wedstrijd: false, periodisering: false, spelers: false },
  } as unknown as Awaited<ReturnType<typeof requireTeamContextOrLogin>>
  vi.mocked(requireTeamContextOrLogin).mockResolvedValue(ctx)
  vi.mocked(requireTeamContext).mockResolvedValue(ctx)
}

type Dict = typeof nl
async function dashboard(dict: Dict = nl) {
  gebruikClient()
  const el = await DashboardPage()
  return render(<DictProvider dict={dict}>{el}</DictProvider>)
}
async function eventPagina(id: string, dict: Dict = nl) {
  gebruikClient()
  const el = await EventDetailPage({ params: Promise.resolve({ id }) })
  return render(<DictProvider dict={dict}>{el}</DictProvider>)
}

const reviewLinks = (dict: Dict = nl) => screen.queryAllByRole('link', { name: new RegExp(dict.todo.taskSelfReview) })
const zelfreviewQueries = () => queries.filter((q) => q.table === 'trainer_zelfreviews')
const upserts = () => mutaties.filter((m) => m.table === 'trainer_zelfreviews')
const basisDb = (extra: Db = {}): Db => ({ settings: [], players: [], attendance: [], ...extra })

// UI-helpers voor het formulier
const score = (stelling: ZelfreviewStelling, n: number, dict: Dict = nl) => {
  const groep = screen.getByRole('group', { name: dict.event.zelfreviewStellingen[stelling] })
  fireEvent.click(within(groep).getByRole('button', { name: dict.event.zelfreviewScoreWaarde.replace('{n}', String(n)) }))
}
const gedrukt = (stelling: ZelfreviewStelling, dict: Dict = nl): number | null => {
  const groep = screen.getByRole('group', { name: dict.event.zelfreviewStellingen[stelling] })
  const knop = within(groep).getAllByRole('button').find((b) => b.getAttribute('aria-pressed') === 'true')
  return knop ? Number(knop.textContent) : null
}
const sectieEl = () => document.querySelector('section#mijn-zelfreview') as HTMLElement
const vulAlles = (waarden: Record<ZelfreviewStelling, number> = { uitleg: 4, organisatie: 3, coaching: 5, sfeer: 2, tijdsbewaking: 1 }) => {
  for (const s of ZELFREVIEW_STELLINGEN) score(s, waarden[s])
}

let consoleError: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  queries = []
  mutaties = []
  db = basisDb()
  fouten = {}
  upsertFout = undefined
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`))
  zetContext('owner')
})
afterEach(() => {
  consoleError.mockRestore()
  vi.useRealTimers()
  cleanup()
})

// ══════════════════════════════════════════════════════════════════════
// To-do
// ══════════════════════════════════════════════════════════════════════

describe('To-do', () => {
  it('AC1: training geweest zonder eigen review → item "vorige training reviewen" naar die training', async () => {
    db = basisDb({ events: [training(E1, dag(-1))] })
    await dashboard()
    const links = reviewLinks()
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', `/events/${E1}#mijn-zelfreview`)
    expect(screen.getByRole('button', { name: nl.todo.taskSelfReview })).toHaveAttribute('aria-pressed', 'false')
  })

  it('AC2: item openen → de pagina van die training met het zelfreview-formulier op het ankerdoel', async () => {
    db = basisDb({ events: [training(E1, dag(-1))] })
    await dashboard()
    const href = reviewLinks()[0].getAttribute('href')!
    const [pad, anker] = href.split('#')
    expect(pad).toBe(`/events/${E1}`)
    cleanup()
    const { container } = await eventPagina(E1)
    expect(anker).toBe('mijn-zelfreview')
    const sectie = container.querySelector(`section#${anker}`)
    expect(sectie).not.toBeNull()
    expect(within(sectie as HTMLElement).getByRole('button', { name: nl.event.zelfreviewOpslaan })).toBeInTheDocument()
  })

  it('AC3: ingevulde zelfreview → item automatisch af (doorgestreept) zonder afvinken', async () => {
    db = basisDb({ events: [training(E1, dag(-1))], trainer_zelfreviews: [review(E1)] })
    await dashboard()
    expect(screen.getByRole('button', { name: nl.todo.taskSelfReview })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(nl.todo.taskSelfReview)).toHaveClass('line-through')
  })

  it('AC4: toekomstige training → geen reviewitem en geen review-query', async () => {
    db = basisDb({ events: [training(E1, dag(2))] })
    await dashboard()
    expect(reviewLinks()).toHaveLength(0)
    expect(zelfreviewQueries()).toHaveLength(0)
  })

  it('AC5: item van A verdwijnt op de dag van de volgende training B, ook ongereviewd; blijft staan als B nog niet is geweest', async () => {
    db = basisDb({ events: [training(E1, dag(-1)), training(E2, TODAY)] })
    await dashboard()
    expect(reviewLinks().map((l) => l.getAttribute('href'))).toEqual([`/events/${E2}#mijn-zelfreview`])
    cleanup()
    db = basisDb({ events: [training(E1, dag(-1)), training(E2, dag(1))] })
    await dashboard()
    expect(reviewLinks().map((l) => l.getAttribute('href'))).toEqual([`/events/${E1}#mijn-zelfreview`])
  })

  it('beslissing 2: twee trainingen op één dag → één item per training', async () => {
    db = basisDb({ events: [training(E1, dag(-1)), training(E2, dag(-1))] })
    await dashboard()
    expect(reviewLinks()).toHaveLength(2)
  })

  it('AC26: het vinkje is uitgeschakeld en doet niets; markTaskDone weigert self_review en raakt task_overrides niet', async () => {
    db = basisDb({ events: [training(E1, dag(-1))] })
    await dashboard()
    const vink = screen.getByRole('button', { name: nl.todo.taskSelfReview })
    expect(vink).toBeDisabled()
    expect(vink).toHaveAttribute('title', nl.todo.selfReviewAutoDone)
    fireEvent.click(vink)
    expect(vink).toHaveAttribute('aria-pressed', 'false')
    expect(mutaties.filter((m) => m.table === 'task_overrides')).toEqual([])
    await expect(markTaskDone(E1, 'self_review' as never)).rejects.toThrow('Ongeldige taak')
    expect(mutaties.filter((m) => m.table === 'task_overrides')).toEqual([])
  })

  it('AC23: to-do-status is per trainer: dezelfde training is voor de schrijver af en voor een andere trainer open', async () => {
    db = basisDb({ events: [training(E1, dag(-1))], trainer_zelfreviews: [review(E1, { user_id: USER })] })
    zetContext('assistent', true, USER)
    await dashboard()
    expect(screen.getByRole('button', { name: nl.todo.taskSelfReview })).toHaveAttribute('aria-pressed', 'true')
    cleanup()
    zetContext('assistent', true, ANDER)
    await dashboard()
    expect(screen.getByRole('button', { name: nl.todo.taskSelfReview })).toHaveAttribute('aria-pressed', 'false')
  })

  it('AC24/beslissing 8: assistent mét trainingsrecht ziet het item; zonder trainingsrecht niet (en geen query)', async () => {
    db = basisDb({ events: [training(E1, dag(-1))] })
    zetContext('assistent', true)
    await dashboard()
    expect(reviewLinks()).toHaveLength(1)
    cleanup()
    queries = []
    zetContext('assistent', false)
    await dashboard()
    expect(reviewLinks()).toHaveLength(0)
    expect(zelfreviewQueries()).toHaveLength(0)
  })

  it('AC25: reviews van een ander team tellen niet; de dashboardquery is gefilterd op team_id én user_id', async () => {
    db = basisDb({
      events: [training(E1, dag(-1))],
      trainer_zelfreviews: [review(E1, { team_id: 'team-2' })],
    })
    await dashboard()
    expect(screen.getByRole('button', { name: nl.todo.taskSelfReview })).toHaveAttribute('aria-pressed', 'false')
    expect(zelfreviewQueries()[0].filters).toEqual(expect.arrayContaining([['team_id', TEAM], ['user_id', USER]]))
  })

  it('een trainingsevent van een ander team verschijnt niet als item', async () => {
    db = basisDb({ events: [training(E_ANDER_TEAM, dag(-1), { team_id: 'team-2' })] })
    await dashboard()
    expect(reviewLinks()).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Zelfreview-formulier
// ══════════════════════════════════════════════════════════════════════

describe('Zelfreview-formulier', () => {
  beforeEach(() => { db = basisDb({ events: [training(E1, dag(-1)), training(E_MATCH, dag(-1), { type: 'match', opponent: 'FC X' })] }) })

  it('AC6: vijf vaste stellingen (uitleg, organisatie, coaching, sfeer, tijdsbewaking), elk met precies score 1 t/m 5', async () => {
    await eventPagina(E1)
    expect([...ZELFREVIEW_STELLINGEN]).toEqual(['uitleg', 'organisatie', 'coaching', 'sfeer', 'tijdsbewaking'])
    const groepen = screen.getAllByRole('group').filter((g) => g.closest('#mijn-zelfreview'))
    expect(groepen).toHaveLength(5)
    for (const s of ZELFREVIEW_STELLINGEN) {
      const groep = screen.getByRole('group', { name: nl.event.zelfreviewStellingen[s] })
      const knoppen = within(groep).getAllByRole('button')
      expect(knoppen.map((k) => k.textContent)).toEqual(['1', '2', '3', '4', '5'])
    }
    // Er is geen manier om een andere waarde dan 1..5 te kiezen
    expect(screen.queryByRole('button', { name: nl.event.zelfreviewScoreWaarde.replace('{n}', '0') })).toBeNull()
    expect(screen.queryByRole('button', { name: nl.event.zelfreviewScoreWaarde.replace('{n}', '6') })).toBeNull()
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('AC7: optioneel tekstveld "Wat neem ik mee?" met maximaal 1000 tekens; leeg opslaan mag', async () => {
    await eventPagina(E1)
    const tekst = screen.getByLabelText(nl.event.zelfreviewMeeneemLabel)
    expect(tekst.tagName).toBe('TEXTAREA')
    expect(tekst).toHaveAttribute('maxlength', '1000')
    expect(tekst).not.toBeRequired()
    vulAlles()
    fireEvent.click(screen.getByRole('button', { name: nl.event.zelfreviewOpslaan }))
    await waitFor(() => expect(upserts()).toHaveLength(1))
    expect(upserts()[0].payload.meeneem).toBeNull()
  })

  it('AC8 + AC3 + AC9: alle stellingen gescoord → opslaan bewaart in de database; heropenen toont scores/tekst; to-do-item is af', async () => {
    await eventPagina(E1)
    vulAlles()
    fireEvent.change(screen.getByLabelText(nl.event.zelfreviewMeeneemLabel), { target: { value: '  Korter uitleggen  ' } })
    fireEvent.click(screen.getByRole('button', { name: nl.event.zelfreviewOpslaan }))
    await waitFor(() => expect(within(sectieEl()).getByRole('status')).toHaveTextContent(nl.analysis.saved))

    // De echte action schreef precies één rij, van deze trainer in dit team
    expect(upserts()).toHaveLength(1)
    expect(upserts()[0].payload).toMatchObject({
      team_id: TEAM, user_id: USER, event_id: E1,
      score_uitleg: 4, score_organisatie: 3, score_coaching: 5, score_sfeer: 2, score_tijdsbewaking: 1,
      meeneem: 'Korter uitleggen',
    })
    expect(upserts()[0].onConflict).toBe('event_id,user_id')
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${E1}`)
    expect(revalidatePath).toHaveBeenCalledWith('/')
    // AC9: alleen trainer_zelfreviews is geraakt, nooit training_evaluaties
    expect(mutaties.filter((m) => m.table !== 'trainer_zelfreviews')).toEqual([])

    // Heropenen: scores en tekst staan er weer, knop is "bijwerken"
    cleanup()
    await eventPagina(E1)
    expect([...ZELFREVIEW_STELLINGEN].map((s) => gedrukt(s))).toEqual([4, 3, 5, 2, 1])
    expect(screen.getByLabelText(nl.event.zelfreviewMeeneemLabel)).toHaveValue('Korter uitleggen')
    expect(screen.getByRole('button', { name: nl.event.zelfreviewBijwerken })).toBeInTheDocument()

    // To-do: item is automatisch af
    cleanup()
    await dashboard()
    expect(screen.getByRole('button', { name: nl.todo.taskSelfReview })).toHaveAttribute('aria-pressed', 'true')
  })

  it('beslissing 3: een bestaande review blijft bewerkbaar; opnieuw opslaan overschrijft de eigen rij (geen tweede rij)', async () => {
    db.trainer_zelfreviews = [review(E1)]
    await eventPagina(E1)
    score('uitleg', 1)
    fireEvent.click(screen.getByRole('button', { name: nl.event.zelfreviewBijwerken }))
    await waitFor(() => expect(upserts()).toHaveLength(1))
    expect(db.trainer_zelfreviews).toHaveLength(1)
    expect(db.trainer_zelfreviews[0].score_uitleg).toBe(1)
  })

  it('AC9: een zelfreview en training_evaluaties (RPE/oordeel) beïnvloeden elkaar niet', async () => {
    const evaluatie = { event_id: E1, team_id: TEAM, rpe: 7, oordeel: 'goed' }
    db.training_evaluaties = [evaluatie]
    await eventPagina(E1)
    vulAlles()
    fireEvent.click(screen.getByRole('button', { name: nl.event.zelfreviewOpslaan }))
    await waitFor(() => expect(upserts()).toHaveLength(1))
    expect(db.training_evaluaties).toEqual([evaluatie])
    expect(mutaties.some((m) => m.table === 'training_evaluaties')).toBe(false)
  })

  it('AC14: ontbrekende score → niets bewaard en duidelijke fout (alert met uitleg), waarden blijven staan', async () => {
    await eventPagina(E1)
    score('uitleg', 4); score('organisatie', 3); score('coaching', 5); score('sfeer', 2) // tijdsbewaking ontbreekt
    fireEvent.change(screen.getByLabelText(nl.event.zelfreviewMeeneemLabel), { target: { value: 'blijft' } })
    fireEvent.click(screen.getByRole('button', { name: nl.event.zelfreviewOpslaan }))
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.event.zelfreviewOntbreekt)
    expect(mutaties).toEqual([])
    expect(db.trainer_zelfreviews ?? []).toEqual([])
    expect(gedrukt('uitleg')).toBe(4)
    expect(screen.getByLabelText(nl.event.zelfreviewMeeneemLabel)).toHaveValue('blijft')
  })

  it('AC16: opslagfout → begrijpelijke melding zonder ruwe fout, ingevulde waarden blijven staan', async () => {
    upsertFout = { code: '42501', message: 'RAW_DB_DETAIL new row violates row-level security policy' }
    await eventPagina(E1)
    vulAlles()
    fireEvent.change(screen.getByLabelText(nl.event.zelfreviewMeeneemLabel), { target: { value: 'mijn tekst' } })
    fireEvent.click(screen.getByRole('button', { name: nl.event.zelfreviewOpslaan }))
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.event.zelfreviewOpslaanFout)
    expect(document.body.textContent).not.toMatch(/RAW_DB_DETAIL|row-level|42501/)
    expect(document.body.textContent).not.toContain(GENERIC_ERROR_MESSAGE)
    expect([...ZELFREVIEW_STELLINGEN].map((s) => gedrukt(s))).toEqual([4, 3, 5, 2, 1])
    expect(screen.getByLabelText(nl.event.zelfreviewMeeneemLabel)).toHaveValue('mijn tekst')
    // en na herstel kan dezelfde invoer alsnog worden opgeslagen
    upsertFout = undefined
    fireEvent.click(await screen.findByRole('button', { name: nl.event.zelfreviewOpslaan }))
    await waitFor(() => expect(db.trainer_zelfreviews).toHaveLength(1))
  })

  it('AC19: dubbelklik op opslaan → één opslagactie en één review per trainer per training', async () => {
    await eventPagina(E1)
    vulAlles()
    const knop = screen.getByRole('button', { name: nl.event.zelfreviewOpslaan })
    fireEvent.click(knop)
    fireEvent.click(knop)
    await waitFor(() => expect(within(sectieEl()).getByRole('status')).toHaveTextContent(nl.analysis.saved))
    expect(upserts()).toHaveLength(1)
    expect(db.trainer_zelfreviews).toHaveLength(1)
  })

  it('AC18: toekomstige training → geen formulier in de UI', async () => {
    db.events.push(training(E3, dag(3)))
    await eventPagina(E3)
    expect(screen.getByText(nl.event.zelfreviewToekomst)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: nl.event.zelfreviewOpslaan })).toBeNull()
    expect(screen.queryAllByRole('group')).toHaveLength(0)
  })

  it('AC17 (UI): een training van een ander team of een wedstrijd geeft geen zelfreview-sectie', async () => {
    db.events.push(training(E_ANDER_TEAM, dag(-1), { team_id: 'team-2' }))
    await expect(eventPagina(E_ANDER_TEAM)).rejects.toThrow('__notFound__')
    cleanup()
    const { container } = await eventPagina(E_MATCH)
    expect(container.querySelector('#mijn-zelfreview')).toBeNull()
  })

  it('AC21 (UI-deel): de sectie leest alleen de eigen rij; de review van een andere trainer is onzichtbaar', async () => {
    db.trainer_zelfreviews = [review(E1, { user_id: ANDER, meeneem: 'GEHEIM VAN ANDER' })]
    await eventPagina(E1)
    expect(screen.getByRole('button', { name: nl.event.zelfreviewOpslaan })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('GEHEIM VAN ANDER')
    expect(zelfreviewQueries()[0].filters).toEqual(expect.arrayContaining([['event_id', E1], ['team_id', TEAM], ['user_id', USER]]))
    // De owner ziet de review van de assistent evenmin
    cleanup()
    zetContext('owner', true, '0a000000-0000-4000-8000-0000000000a3')
    await eventPagina(E1)
    expect(document.body.textContent).not.toContain('GEHEIM VAN ANDER')
  })

  it('AC20 (UI-deel): niet-lid van het team → geen toegang tot de trainingspagina, geen zelfreview-lezing', async () => {
    vi.mocked(requireTeamContextOrLogin).mockRejectedValue(new Error('Geen team'))
    await expect(eventPagina(E1)).rejects.toThrow('Geen team')
    expect(zelfreviewQueries()).toEqual([])
  })

  it('AC24: assistent zonder trainingsrecht ziet geen sectie (wel alleen-lezen als er al een eigen review is)', async () => {
    zetContext('assistent', false)
    const { container } = await eventPagina(E1)
    expect(container.querySelector('#mijn-zelfreview')).toBeNull()
    cleanup()
    db.trainer_zelfreviews = [review(E1)]
    await eventPagina(E1)
    expect(screen.getByText(nl.event.zelfreviewAlleenLezen)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: nl.event.zelfreviewBijwerken })).toBeNull()
  })

  it('AC16 (lees-kant): een falende leesquery meldt dat alleen in deze sectie, zonder ruwe fout', async () => {
    fouten.trainer_zelfreviews = { code: 'PGRST205', message: 'RAW_DB_DETAIL' }
    await eventPagina(E1)
    expect(screen.getByText(nl.event.zelfreviewNietBeschikbaar)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/RAW_DB_DETAIL|PGRST205/)
  })

  it('lange tekst: de teller verschijnt vanaf 900 tekens', async () => {
    await eventPagina(E1)
    fireEvent.change(screen.getByLabelText(nl.event.zelfreviewMeeneemLabel), { target: { value: 'x'.repeat(950) } })
    expect(screen.getByText(nl.event.zelfreviewTekens.replace('{n}', '950'))).toBeInTheDocument()
  })
})

// ══════════════════════════════════════════════════════════════════════
// Server action van buitenaf (ook "buiten de UI om")
// ══════════════════════════════════════════════════════════════════════

describe('saveTrainerZelfreview buiten de UI om', () => {
  const GELDIG = { uitleg: 4, organisatie: 3, coaching: 5, sfeer: 2, tijdsbewaking: 1 }
  beforeEach(() => {
    db = basisDb({ events: [training(E1, dag(-1)), training(E3, dag(1)), training(E_MATCH, dag(-1), { type: 'match' }), training(E_ANDER_TEAM, dag(-1), { team_id: 'team-2' })] })
    gebruikClient()
  })

  it.each([
    ['score 0', { ...GELDIG, uitleg: 0 }],
    ['score 6', { ...GELDIG, organisatie: 6 }],
    ['score -1', { ...GELDIG, coaching: -1 }],
    ['decimaal 2.5', { ...GELDIG, sfeer: 2.5 }],
    ["string '3'", { ...GELDIG, tijdsbewaking: '3' }],
    ['NaN', { ...GELDIG, uitleg: NaN }],
    ['null (leeg)', { ...GELDIG, coaching: null }],
    ['ontbrekende stelling', { uitleg: 3, organisatie: 3, coaching: 3, sfeer: 3 }],
    ['lege scores', {}],
  ])('AC14/AC15: %s → geweigerd, niets bewaard', async (_l, scores) => {
    await expect(saveTrainerZelfreview(E1, { scores: scores as never, meeneem: null })).rejects.toThrow('Ongeldige zelfreview')
    expect(mutaties).toEqual([])
  })

  it('AC15: tekst langer dan 1000 tekens (na trim) geweigerd; precies 1000 mag', async () => {
    await expect(saveTrainerZelfreview(E1, { scores: GELDIG, meeneem: 'x'.repeat(1001) })).rejects.toThrow('Ongeldige zelfreview')
    expect(mutaties).toEqual([])
    await saveTrainerZelfreview(E1, { scores: GELDIG, meeneem: 'x'.repeat(1000) })
    expect(upserts()).toHaveLength(1)
  })

  it('AC17: onbestaande training, training van ander team, wedstrijd of geen UUID → geweigerd met neutrale melding, niets bewaard', async () => {
    await expect(saveTrainerZelfreview('0e000000-0000-4000-8000-00000000dead', { scores: GELDIG, meeneem: null })).rejects.toThrow('Event niet gevonden')
    await expect(saveTrainerZelfreview(E_ANDER_TEAM, { scores: GELDIG, meeneem: null })).rejects.toThrow('Event niet gevonden')
    await expect(saveTrainerZelfreview(E_MATCH, { scores: GELDIG, meeneem: null })).rejects.toThrow('Event niet gevonden')
    await expect(saveTrainerZelfreview('geen-uuid', { scores: GELDIG, meeneem: null })).rejects.toThrow('Ongeldige zelfreview')
    expect(mutaties).toEqual([])
  })

  it('AC18: training in de toekomst → geweigerd; training van vandaag mag', async () => {
    await expect(saveTrainerZelfreview(E3, { scores: GELDIG, meeneem: null })).rejects.toThrow('Training nog niet gehouden')
    expect(mutaties).toEqual([])
    db.events.push(training('0e000000-0000-4000-8000-000000000009', TODAY))
    await saveTrainerZelfreview('0e000000-0000-4000-8000-000000000009', { scores: GELDIG, meeneem: null })
    expect(upserts()).toHaveLength(1)
  })

  it('AC19: dezelfde review twee keer versturen → nog steeds één rij per trainer per training', async () => {
    await saveTrainerZelfreview(E1, { scores: GELDIG, meeneem: null })
    await saveTrainerZelfreview(E1, { scores: { ...GELDIG, uitleg: 5 }, meeneem: null })
    expect(db.trainer_zelfreviews).toHaveLength(1)
    expect(db.trainer_zelfreviews[0].score_uitleg).toBe(5)
  })

  it('AC20: assistent zonder trainingsrecht / niet ingelogd → geweigerd, niets bewaard', async () => {
    zetContext('assistent', false)
    await expect(saveTrainerZelfreview(E1, { scores: GELDIG, meeneem: null })).rejects.toThrow('Geen toegang')
    vi.mocked(requireTeamContext).mockRejectedValue(new Error('Niet ingelogd'))
    await expect(saveTrainerZelfreview(E1, { scores: GELDIG, meeneem: null })).rejects.toThrow('Niet ingelogd')
    expect(mutaties).toEqual([])
  })

  it('AC21/AC25: team_id en user_id komen altijd uit de context, een vervalste invoer wordt genegeerd', async () => {
    const vals = { scores: GELDIG, meeneem: null, team_id: 'team-2', user_id: ANDER } as never
    await saveTrainerZelfreview(E1, vals)
    expect(upserts()[0].payload).toMatchObject({ team_id: TEAM, user_id: USER })
  })

  it('AC16: databasefout → alleen de generieke melding naar de client', async () => {
    upsertFout = { code: '23514', message: 'RAW_DB_DETAIL check constraint' }
    const fout = await saveTrainerZelfreview(E1, { scores: GELDIG, meeneem: null }).catch((e: Error) => e)
    expect((fout as Error).message).toBe(GENERIC_ERROR_MESSAGE)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Inzichten
// ══════════════════════════════════════════════════════════════════════

describe('Inzichten', () => {
  const NU = '2026-10-14'
  const zr = (datum: string, s: number, o: Row = {}): Row => ({
    event_id: `e-${datum}-${s}`, datum, score_uitleg: s, score_organisatie: s, score_coaching: s,
    score_sfeer: s, score_tijdsbewaking: s, totaal: 0, ...o,
  })
  // wk 36: 4 en 2 (gemiddelde 3,0), wk 37: 5, wk 38: 1  → 4 reviews
  const VIER = [zr('2026-09-01', 4), zr('2026-09-03', 2), zr('2026-09-08', 5), zr('2026-09-15', 1)]
  let rpcCalls: { name: string; args: Row }[]

  async function inzichten(
    zelfreviews: Row[] | { fout: unknown },
    o: { seizoen?: boolean; metData?: boolean; periode?: string; dict?: Dict } = {},
  ) {
    mockSettings.waarde = o.seizoen === false ? {} : { season_start: '2026-08-01', season_end: '2026-10-31' }
    rpcCalls = []
    const basis = maakClient(huidigeUser)
    const client = {
      auth: basis.auth,
      from: (t: string) => basis.from(t),
      rpc: (name: string, args: Row) => {
        rpcCalls.push({ name, args })
        if (name === 'inzichten_eigen_zelfreviews') {
          if (!Array.isArray(zelfreviews)) return Promise.resolve({ data: null, error: zelfreviews.fout })
          // De RPC filtert zelf op het venster, zoals de SQL doet.
          const inVenster = zelfreviews.filter((r) => (r.datum as string) >= (args.p_start as string) && (r.datum as string) <= (args.p_end as string))
          return Promise.resolve({ data: inVenster.map((r) => ({ ...r, totaal: inVenster.length })), error: null })
        }
        if (name === 'inzichten_training_opkomst_per_maand' && o.metData) {
          return Promise.resolve({ data: [{ maand: '2026-09', aanwezig: 8, afwezig: 2 }], error: null })
        }
        return Promise.resolve({ data: [], error: null })
      },
    }
    vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>)
    const el = await InzichtenPage(o.periode ? { searchParams: Promise.resolve({ periode: o.periode }) } : {})
    return render(<DictProvider dict={o.dict ?? nl}>{el}</DictProvider>)
  }
  const kaart = () => screen.getByText(nl.insights.zelfreviewTitle).closest('.surface-card') as HTMLElement

  beforeEach(() => { vi.setSystemTime(new Date(`${NU}T10:00:00`)) })

  it('AC10: ≥3 zelfreviews → kaart met de ontwikkeling: gemiddelde per ISO-week, per stelling én totaal, grafiek aanwezig', async () => {
    await inzichten(VIER, { metData: true })
    const k = kaart()
    expect(within(k).getByRole('img')).toBeInTheDocument()
    for (const naam of Object.values(nl.insights.zelfreviewKolommen)) expect(within(k).getByRole('columnheader', { name: naam })).toBeInTheDocument()
    expect(within(k).getByRole('columnheader', { name: nl.insights.zelfreviewKolomTotaal })).toBeInTheDocument()
    const rij = (wk: number) => within(k).getAllByRole('row').find((r) => new RegExp(`wk ${wk}\\b`).test(r.textContent ?? ''))!
    // 6 cellen (5 stellingen + totaal) met het weekgemiddelde; week 36 = (4+2)/2
    expect(within(rij(36)).getAllByRole('cell').map((c) => c.textContent)).toEqual(Array(6).fill('3,0'))
    expect(within(rij(37)).getAllByRole('cell').map((c) => c.textContent)).toEqual(Array(6).fill('5,0'))
    expect(within(rij(38)).getAllByRole('cell').map((c) => c.textContent)).toEqual(Array(6).fill('1,0'))
  })

  it('AC11: te weinig (<3) → lege staat met uitleg en het aantal, geen trend en geen tabel', async () => {
    await inzichten(VIER.slice(0, 2), { metData: true })
    const k = kaart()
    expect(k).toHaveTextContent(nl.insights.zelfreviewTeWeinig.replace('{n}', '2'))
    expect(k.querySelector('table')).toBeNull()
    expect(within(k).queryByRole('img')).toBeNull()
  })

  it('AC11: precies 3 reviews is genoeg (drempel 3)', async () => {
    await inzichten(VIER.slice(0, 3), { metData: true })
    expect(kaart().querySelector('table')).not.toBeNull()
  })

  it('AC12: de data komt uit de RPC die per ingelogde trainer filtert; de kaart toont nooit tekst ("meeneem") en de RPC kent het team', async () => {
    await inzichten(VIER, { metData: true })
    const calls = rpcCalls.filter((c) => c.name === 'inzichten_eigen_zelfreviews')
    expect(calls).toHaveLength(1)
    expect(calls[0].args.p_team_id).toBe(TEAM)
    expect(Object.keys(calls[0].args).sort()).toEqual(['p_end', 'p_start', 'p_team_id']) // geen user-argument dat vervalst kan worden
    expect(kaart().textContent).not.toMatch(/meeneem/i)
  })

  it('AC13: geen actief seizoen → dezelfde lege staat als de rest van de pagina en geen zelfreview-RPC', async () => {
    await inzichten(VIER, { seizoen: false })
    expect(screen.getByText(nl.insights.noSeason)).toBeInTheDocument()
    expect(screen.queryByText(nl.insights.zelfreviewTitle)).toBeNull()
    expect(rpcCalls).toHaveLength(0)
  })

  it('AC13/beslissing 6: de kaart volgt het periodefilter: seizoen → trend, 4w → alleen het laatste venster (te weinig)', async () => {
    await inzichten(VIER, { metData: true })
    expect(rpcCalls.find((c) => c.name === 'inzichten_eigen_zelfreviews')!.args.p_start).toBe('2026-08-01')
    expect(kaart().querySelector('table')).not.toBeNull()
    cleanup()
    await inzichten(VIER, { metData: true, periode: '4w' })
    const call4w = rpcCalls.find((c) => c.name === 'inzichten_eigen_zelfreviews')!
    expect(call4w.args.p_start).toBe('2026-09-17')
    expect(kaart()).toHaveTextContent(nl.insights.zelfreviewTeWeinig.replace('{n}', '0'))
    cleanup()
    await inzichten(VIER, { metData: true, periode: '8w' })
    expect(rpcCalls.find((c) => c.name === 'inzichten_eigen_zelfreviews')!.args.p_start).toBe('2026-08-20')
    expect(kaart().querySelector('table')).not.toBeNull()
  })

  it('AC16 (Inzichten): een RPC-fout geeft alleen in deze kaart de bronFout-melding, zonder ruwe fout; de rest blijft', async () => {
    await inzichten({ fout: { code: 'PGRST202', message: 'RAW_DB_DETAIL' } }, { metData: true })
    expect(kaart()).toHaveTextContent(nl.insights.bronFout)
    expect(document.body.textContent).not.toMatch(/RAW_DB_DETAIL|PGRST202/)
    expect(screen.getByText(nl.insights.srpeTitle)).toBeInTheDocument()
  })

  it('AC22: de kaart staat in het schermdeel (print:hidden), niet in het seizoensrapport, en onthult geen tekst', async () => {
    const reviewsMetTekst = VIER.map((r) => ({ ...r, meeneem: 'GEHEIME_TEKST' }))
    const { container } = await inzichten(reviewsMetTekst, { metData: true })
    expect(screen.getAllByText(nl.insights.zelfreviewTitle)).toHaveLength(1)
    expect(screen.getByText(nl.insights.zelfreviewTitle).closest('.print\\:hidden')).not.toBeNull()
    expect(container.textContent).not.toContain('GEHEIME_TEKST')
  })

  it('AC22: zelfreviews alleen maken de pagina niet "gevuld" en geven geen teamsignalen/KPI', async () => {
    await inzichten(VIER)
    expect(screen.getByText(nl.insights.geenDataTitle)).toBeInTheDocument()
    expect(screen.queryByText(nl.insights.zelfreviewTitle)).toBeNull()
  })

  it('AC22 (structureel): alleen de bedoelde bestanden verwijzen naar de zelfreview; rapport-, team-KPI- en signaalcode niet', () => {
    const root = process.cwd()
    const bronnen: string[] = []
    const loop = (dir: string) => {
      for (const naam of readdirSync(dir)) {
        if (naam === 'node_modules' || naam === '.next' || naam.startsWith('.')) continue
        const pad = join(dir, naam)
        if (statSync(pad).isDirectory()) loop(pad)
        else if (/\.(ts|tsx|mjs)$/.test(naam) && !/\.test\.(ts|tsx|mjs)$/.test(naam)) bronnen.push(pad)
      }
    }
    for (const d of ['app', 'components', 'lib']) loop(join(root, d))
    const verwijzers = bronnen
      .filter((p) => /zelfreview|self_review|selfReview/i.test(readFileSync(p, 'utf8')))
      .map((p) => relative(root, p))
      .sort()
    expect(verwijzers).toEqual([
      'app/actions/trainer-zelfreview.ts',
      'app/events/[id]/page.tsx',
      'app/inzichten/page.tsx',
      'app/page.tsx',
      'components/TrainerZelfreviewSectie.tsx',
      'components/dashboard/TodoList.tsx',
      'components/inzichten/ZelfreviewKaart.tsx',
      'lib/inzichten.ts',
      'lib/team-opruimen.ts',
      'lib/todos.mjs',
      'lib/trainer-zelfreview.ts',
    ])
    // Het rapport zelf (SeizoensrapportPrint) en de PDF-route weten van niets
    expect(verwijzers.some((p) => /Seizoensrapport|pdf/i.test(p))).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════
// AC27: i18n nl, en, de, fr, es
// ══════════════════════════════════════════════════════════════════════

describe('AC27: i18n', () => {
  const talen: [string, Dict][] = [['nl', nl], ['en', en], ['de', de], ['fr', fr], ['es', es]]

  const zelfreviewSleutels = (d: Dict) => ({
    taskSelfReview: d.todo.taskSelfReview,
    selfReviewAutoDone: d.todo.selfReviewAutoDone,
    event: Object.fromEntries(Object.entries(d.event).filter(([k]) => k.startsWith('zelfreview'))),
    insights: Object.fromEntries(Object.entries(d.insights).filter(([k]) => k.startsWith('zelfreview'))),
  })

  it.each(talen)('%s: alle zelfreview-teksten bestaan, zijn niet leeg en hebben dezelfde sleutels als nl', (_taal, dict) => {
    const verwacht = zelfreviewSleutels(nl)
    const actueel = zelfreviewSleutels(dict)
    expect(Object.keys(actueel.event).sort()).toEqual(Object.keys(verwacht.event).sort())
    expect(Object.keys(actueel.insights).sort()).toEqual(Object.keys(verwacht.insights).sort())
    const platte = (o: unknown): string[] => (typeof o === 'string' ? [o] : Object.values(o as object).flatMap(platte))
    for (const tekst of platte(actueel)) expect(tekst.trim().length).toBeGreaterThan(0)
    expect(Object.keys(actueel.event.zelfreviewStellingen as object).sort()).toEqual([...ZELFREVIEW_STELLINGEN].sort())
    // plaatshouders blijven behouden
    expect(dict.event.zelfreviewScoreWaarde).toContain('{n}')
    expect(dict.event.zelfreviewTekens).toContain('{n}')
    expect(dict.insights.zelfreviewTeWeinig).toContain('{n}')
    expect(dict.insights.zelfreviewGrafiekLabel).toContain('{n}')
  })

  it.each(talen.filter(([t]) => t !== 'nl'))('%s: de teksten zijn echt vertaald (niet de Nederlandse tekst)', (_taal, dict) => {
    expect(dict.todo.taskSelfReview).not.toBe(nl.todo.taskSelfReview)
    expect(dict.event.zelfreviewTitel).not.toBe(nl.event.zelfreviewTitel)
    expect(dict.event.zelfreviewOpslaan).not.toBe(nl.event.zelfreviewOpslaan)
    expect(dict.event.zelfreviewOntbreekt).not.toBe(nl.event.zelfreviewOntbreekt)
    expect(dict.insights.zelfreviewTitle).not.toBe(nl.insights.zelfreviewTitle)
    expect(dict.insights.zelfreviewTeWeinig).not.toBe(nl.insights.zelfreviewTeWeinig)
  })

  it.each(talen)('%s: To-do-item en formulier renderen in de eigen taal', async (_taal, dict) => {
    db = basisDb({ events: [training(E1, dag(-1))] })
    await dashboard(dict)
    expect(reviewLinks(dict)).toHaveLength(1)
    cleanup()
    await eventPagina(E1, dict)
    expect(screen.getByRole('heading', { name: dict.event.zelfreviewTitel })).toBeInTheDocument()
    for (const s of ZELFREVIEW_STELLINGEN) expect(screen.getByRole('group', { name: dict.event.zelfreviewStellingen[s] })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: dict.event.zelfreviewOpslaan })).toBeInTheDocument()
    // validatiemelding in de eigen taal
    fireEvent.click(screen.getByRole('button', { name: dict.event.zelfreviewOpslaan }))
    expect(await screen.findByRole('alert')).toHaveTextContent(dict.event.zelfreviewOntbreekt)
  })

  it.each(talen)('%s: de Inzichten-kaart rendert in de eigen taal', (_taal, dict) => {
    // De server (getDict) kiest de taal uit een cookie; hier krijgt de kaart
    // rechtstreeks het woordenboek mee, met data uit de echte weekberekening.
    const rijen = [4, 2, 5].map((s, i) => ({ event_id: `e${i}`, datum: `2026-09-0${i + 1}`, score_uitleg: s, score_organisatie: s, score_coaching: s, score_sfeer: s, score_tijdsbewaking: s, totaal: 3 }))
    const data = zelfreviewsPerWeek(rijen, { start: '2026-08-01', end: '2026-10-13' })
    render(<ZelfreviewKaart data={data} fout={false} t={dict} />)
    expect(screen.getByText(dict.insights.zelfreviewTitle)).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: dict.insights.zelfreviewKolomTotaal })).toBeInTheDocument()
    for (const naam of Object.values(dict.insights.zelfreviewKolommen)) expect(screen.getByRole('columnheader', { name: naam })).toBeInTheDocument()
  })
})

// ══════════════════════════════════════════════════════════════════════
// Databaseniveau — STRUCTUREEL (geen echte RLS-uitvoering mogelijk in jsdom)
// ══════════════════════════════════════════════════════════════════════

describe('Databaseniveau (structureel; echt gedrag alleen via blok 31 op een live database)', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/trainer-zelfreview.sql'), 'utf8')
  const code = sql.split('\n').map((r) => r.replace(/--.*$/, '')).join('\n').toLowerCase()
  const verificatie = readFileSync(join(process.cwd(), 'supabase/team-rls-verificatie.sql'), 'utf8')
  const blok31 = verificatie.slice(verificatie.search(/blok 31/i))
  const policy = (naam: string) => code.slice(code.indexOf(`create policy "trainer_zelfreviews: ${naam}"`)).split(';')[0]

  it('AC15 (structureel): vijf scorekolommen smallint not null met check between 1 and 5; meeneem ≤ 1000', () => {
    for (const s of ZELFREVIEW_STELLINGEN) {
      expect(code).toMatch(new RegExp(`score_${s}\\s+smallint not null[^,]*check \\(score_${s} between 1 and 5\\)`))
    }
    expect(code).toMatch(/meeneem is null or char_length\(meeneem\) <= 1000/)
  })

  it('AC19 (structureel): unique (event_id, user_id) = één review per trainer per training', () => {
    expect(code).toMatch(/unique \(event_id, user_id\)/)
  })

  it('AC21 (structureel): RLS aan, select alleen eigen rij (user_id = auth.uid()), geen delete-policy, geen security definer, geen owner-uitzondering', () => {
    expect(code).toContain('alter table public.trainer_zelfreviews enable row level security')
    expect(policy('alleen eigen rij lezen')).toMatch(/for select using \(user_id = auth\.uid\(\) and is_team_member\(team_id\)\)/)
    expect(code).not.toMatch(/for delete/)
    expect(code).not.toMatch(/security definer/)
    expect(code).not.toMatch(/rol\s*=\s*'owner'/)
    const policies = [...code.matchAll(/create policy "trainer_zelfreviews: [^"]+" on public\.trainer_zelfreviews\s+for (\w+)/g)].map((m) => m[1]).sort()
    expect(policies).toEqual(['insert', 'select', 'update'])
  })

  it('AC20/AC24 (structureel): schrijven vereist eigen user_id + trainingsrecht (can_edit training); lezen vereist teamlidmaatschap', () => {
    for (const naam of ['eigen rij maken', 'eigen rij wijzigen']) {
      expect(policy(naam)).toContain('user_id = auth.uid()')
      expect(policy(naam)).toContain("can_edit(team_id, 'training')")
    }
    expect(policy('alleen eigen rij lezen')).toContain('is_team_member(team_id)')
  })

  it('AC17/AC18/AC25 (structureel): insert/update-check bindt de training aan hetzelfde team, type training en datum ≤ vandaag (NL)', () => {
    for (const naam of ['eigen rij maken', 'eigen rij wijzigen']) {
      const p = policy(naam)
      expect(p).toContain('e.team_id = trainer_zelfreviews.team_id')
      expect(p).toContain("e.type = 'training'")
      expect(p).toContain("e.date <= (now() at time zone 'europe/amsterdam')::date")
    }
  })

  it('beslissing 12 (structureel): cascade bij verwijderen van team, training en teamlid', () => {
    expect(code).toMatch(/team_id\s+uuid not null references public\.teams\(id\)\s+on delete cascade/)
    expect(code).toMatch(/event_id\s+uuid not null references public\.events\(id\)\s+on delete cascade/)
    expect(code).toMatch(/foreign key \(team_id, user_id\)\s+references public\.team_members\(team_id, user_id\) on delete cascade/)
  })

  it('AC9 (structureel): de migratie verwijst nergens naar training_evaluaties', () => {
    expect(code).not.toContain('training_evaluaties')
  })

  it('AC12/AC25 (structureel): de inzichten-RPC filtert op auth.uid() én p_team_id, is security invoker en niet voor anon', () => {
    const rpc = code.slice(code.indexOf('create or replace function public.inzichten_eigen_zelfreviews'))
    expect(rpc).toContain('security invoker')
    expect(rpc).toContain('z.user_id = auth.uid()')
    expect(rpc).toContain('z.team_id = p_team_id')
    expect(rpc).toContain('is_team_member(p_team_id)')
    expect(rpc).toMatch(/revoke all on function public\.inzichten_eigen_zelfreviews\(uuid, date, date\) from public, anon/)
    expect(rpc).not.toMatch(/meeneem/)
  })

  it('AC20/AC21 (structureel): handmatig verificatieblok 31 test lezen/schrijven als vreemde, assistent en owner, en meldt LEK/KAPOT', () => {
    expect(verificatie).toMatch(/blok 31/i)
    expect(blok31).toMatch(/trainer_zelfreviews/)
    expect(blok31).toMatch(/LEK/)
    expect(blok31).toMatch(/KAPOT/)
    expect(blok31).toMatch(/42501/)
    expect(blok31).toMatch(/23514/)
    // blok 22: owner ziet de zelfreview van de assistent niet; blok 2: vreemd team
    expect(verificatie).toMatch(/trainer_zelfreviews/)
  })
})
