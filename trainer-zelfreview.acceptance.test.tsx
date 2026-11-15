// Acceptatietests — privé trainer-zelfreview, UI-kant: To-do-item op het
// dashboard (app/page.tsx + TodoList) en de sectie op de eventpagina
// (app/events/[id]/page.tsx + TrainerZelfreviewSectie).
//
// Testmethode: de ECHTE async server components worden rechtstreeks gerenderd
// met een generieke in-memory tabel-engine die de echte query-chains
// (.eq/.in/.gte/...) toepast én elke query vastlegt, zodat ook "er gaat géén
// query uit" en "altijd gefilterd op team_id + user_id" bewezen kunnen worden.
// De teamcontext wordt gestubd (rol + rechten); canEdit() blijft de echte.
//
// "Vandaag" = 2026-08-03 (lokaal), met alleen `Date` gefaked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

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
}))
vi.mock('@/app/actions/trainer-zelfreview', () => ({ saveTrainerZelfreview: vi.fn() }))
// Seizoensinstellingen voor /inzichten (getAllSettings zelf is niet het onderwerp).
const mockSettings: { waarde: Record<string, string> } = { waarde: {} }
vi.mock('@/app/actions/settings', () => ({ getAllSettings: vi.fn(async () => mockSettings.waarde) }))

import { createClient } from '@/lib/supabase/server'
import { requireTeamContextOrLogin } from '@/lib/team-context'
import DashboardPage from '@/app/page'
import EventDetailPage from '@/app/events/[id]/page'
import InzichtenPage from '@/app/inzichten/page'

const TODAY = '2026-08-03'
const TEAM = 'team-1'
const USER = 'user-1'
type Row = Record<string, unknown>

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

interface Query { table: string; filters: [string, unknown][] }
let queries: Query[]

function maakClient(db: Record<string, Row[]>, fouten: Record<string, unknown> = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table: string) => {
      const q: Query = { table, filters: [] }
      queries.push(q)
      const preds: ((r: Row) => boolean)[] = []
      let limitN: number | null = null
      const rijen = () => {
        const uit = (db[table] ?? []).filter((r) => preds.every((p) => p(r)))
        return limitN === null ? uit : uit.slice(0, limitN)
      }
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
        not: () => chain,
        is: () => chain,
        gt: () => chain,
        order: () => chain,
        limit: (n: number) => { limitN = n; return chain },
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

const SEIZOEN: Row[] = []

function zetContext(rol: 'owner' | 'assistent', training_recht = false) {
  vi.mocked(requireTeamContextOrLogin).mockResolvedValue({
    userId: USER, teamId: TEAM, rol, naam: 'Team',
    rechten: { agenda: false, aanwezigheid: false, training: training_recht, wedstrijd: false, periodisering: false, spelers: false },
  } as unknown as Awaited<ReturnType<typeof requireTeamContextOrLogin>>)
}

async function dashboard(db: Record<string, Row[]>, fouten: Record<string, unknown> = {}) {
  vi.mocked(createClient).mockResolvedValue(maakClient({ settings: SEIZOEN, ...db }, fouten) as unknown as Awaited<ReturnType<typeof createClient>>)
  const el = await DashboardPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

async function eventPagina(id: string, db: Record<string, Row[]>, fouten: Record<string, unknown> = {}) {
  vi.mocked(createClient).mockResolvedValue(maakClient(db, fouten) as unknown as Awaited<ReturnType<typeof createClient>>)
  const el = await EventDetailPage({ params: Promise.resolve({ id }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

const reviewLinks = () => screen.queryAllByRole('link', { name: new RegExp(nl.todo.taskSelfReview) })
const zelfreviewQueries = () => queries.filter((q) => q.table === 'trainer_zelfreviews')

beforeEach(() => {
  vi.clearAllMocks()
  queries = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`))
  zetContext('owner')
})
afterEach(() => { vi.useRealTimers() })

describe('Dashboard — zelfreview-item in de To-do', () => {
  it('AC1: een gehouden training zonder review geeft een open item met link naar de sectie', async () => {
    await dashboard({ events: [training('t1', dag(-1))] })
    const links = reviewLinks()
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/events/t1#mijn-zelfreview')
    expect(links[0]).toHaveTextContent(nl.event.training)
    const vink = screen.getByRole('button', { name: nl.todo.taskSelfReview })
    expect(vink).toHaveAttribute('aria-pressed', 'false')
    expect(vink).toBeDisabled()
    expect(screen.queryByText(nl.todo.overdue)).toBeNull()
  })

  it('AC3: een eigen review maakt het item automatisch afgerond (doorgestreept) maar het blijft staan', async () => {
    await dashboard({ events: [training('t1', dag(-1))], trainer_zelfreviews: [review('t1')] })
    expect(reviewLinks()).toHaveLength(1)
    expect(screen.getByRole('button', { name: nl.todo.taskSelfReview })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(nl.todo.taskSelfReview)).toHaveClass('line-through')
  })

  it('de review van een ander of van een ander team telt niet', async () => {
    await dashboard({
      events: [training('t1', dag(-1))],
      trainer_zelfreviews: [review('t1', { user_id: 'user-2' }), review('t1', { team_id: 'team-2' })],
    })
    expect(screen.getByRole('button', { name: nl.todo.taskSelfReview })).toHaveAttribute('aria-pressed', 'false')
  })

  it('de query is gefilterd op team_id, user_id en alleen gehouden trainingen', async () => {
    await dashboard({
      events: [training('t1', dag(-1)), training('t2', dag(2))],
      trainer_zelfreviews: [review('t1')],
    })
    const q = zelfreviewQueries()
    expect(q).toHaveLength(1)
    expect(q[0].filters).toEqual(expect.arrayContaining([['team_id', TEAM], ['user_id', USER], ['event_id', ['t1']]]))
  })

  it('AC4: een training van vandaag is al zichtbaar', async () => {
    await dashboard({ events: [training('t1', TODAY)] })
    expect(reviewLinks()).toHaveLength(1)
  })

  it('een toekomstige training geeft geen item en geen query', async () => {
    await dashboard({ events: [training('t1', dag(2))] })
    expect(reviewLinks()).toHaveLength(0)
    expect(zelfreviewQueries()).toHaveLength(0)
  })

  it('AC5: het item van gisteren verdwijnt op de dag van de volgende training (ook onbeoordeeld)', async () => {
    await dashboard({ events: [training('t1', dag(-1)), training('t2', TODAY)] })
    const hrefs = reviewLinks().map((l) => l.getAttribute('href'))
    expect(hrefs).toEqual(['/events/t2#mijn-zelfreview'])
  })

  it('het item van gisteren blijft staan als de volgende training pas morgen is', async () => {
    await dashboard({ events: [training('t1', dag(-1)), training('t2', dag(1))] })
    expect(reviewLinks().map((l) => l.getAttribute('href'))).toEqual(['/events/t1#mijn-zelfreview'])
  })

  it('twee trainingen op één dag geven twee items', async () => {
    await dashboard({ events: [training('t1', dag(-1)), training('t2', dag(-1))] })
    expect(reviewLinks()).toHaveLength(2)
  })

  it('een assistent zonder trainingsrecht ziet geen item en er gaat geen query uit', async () => {
    zetContext('assistent', false)
    await dashboard({ events: [training('t1', dag(-1))], trainer_zelfreviews: [review('t1')] })
    expect(reviewLinks()).toHaveLength(0)
    expect(zelfreviewQueries()).toHaveLength(0)
  })

  it('een assistent mét trainingsrecht ziet wel een item', async () => {
    zetContext('assistent', true)
    await dashboard({ events: [training('t1', dag(-1))] })
    expect(reviewLinks()).toHaveLength(1)
  })

  it('een queryfout geeft geen reviewitems, de rest van het dashboard blijft werken en er lekt geen ruwe fout', async () => {
    await dashboard(
      { events: [training('t1', dag(-1)), training('t2', dag(1))] },
      { trainer_zelfreviews: { code: 'XX000', message: 'RAW_DB_DETAIL' } },
    )
    expect(reviewLinks()).toHaveLength(0)
    expect(screen.getByText(nl.todo.title)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/RAW_DB_DETAIL/)
  })
})

describe('Eventpagina — zelfreview-sectie', () => {
  const basis = (extra: Record<string, Row[]> = {}) => ({
    events: [training('t1', dag(-1))], players: [], attendance: [], ...extra,
  })

  it('een trainer ziet de sectie met het anker, leeg formulier en knop "opslaan"', async () => {
    const { container } = await eventPagina('t1', basis())
    expect(container.querySelector('section#mijn-zelfreview')).not.toBeNull()
    expect(screen.getByRole('heading', { name: nl.event.zelfreviewTitel })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.event.zelfreviewOpslaan })).toBeInTheDocument()
  })

  it('AC23: een eigen review is voorgevuld en de knop is "bijwerken"', async () => {
    await eventPagina('t1', basis({ trainer_zelfreviews: [review('t1')] }))
    expect(screen.getByRole('button', { name: nl.event.zelfreviewBijwerken })).toBeInTheDocument()
    expect(screen.getByLabelText(nl.event.zelfreviewMeeneemLabel)).toHaveValue('Korter uitleggen')
  })

  it('AC24: de review van een ander telt niet, en de eigen query is gefilterd op event, team en user', async () => {
    await eventPagina('t1', basis({ trainer_zelfreviews: [review('t1', { user_id: 'user-2' })] }))
    expect(screen.getByRole('button', { name: nl.event.zelfreviewOpslaan })).toBeInTheDocument()
    expect(zelfreviewQueries()[0].filters).toEqual(
      expect.arrayContaining([['event_id', 't1'], ['team_id', TEAM], ['user_id', USER]]),
    )
  })

  it('een ongeldige score in de database telt als "geen review"', async () => {
    await eventPagina('t1', basis({ trainer_zelfreviews: [review('t1', { score_sfeer: 9 })] }))
    expect(screen.getByRole('button', { name: nl.event.zelfreviewOpslaan })).toBeInTheDocument()
  })

  it('toekomstige training: sectie met uitleg, zonder formulier', async () => {
    await eventPagina('t1', basis({ events: [training('t1', dag(3))] }))
    expect(screen.getByText(nl.event.zelfreviewToekomst)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: nl.event.zelfreviewOpslaan })).toBeNull()
  })

  it('zonder trainingsrecht en zonder review: geen sectie', async () => {
    zetContext('assistent', false)
    const { container } = await eventPagina('t1', basis())
    expect(container.querySelector('#mijn-zelfreview')).toBeNull()
  })

  it('V5: recht kwijt maar wel een review: alleen-lezen', async () => {
    zetContext('assistent', false)
    await eventPagina('t1', basis({ trainer_zelfreviews: [review('t1')] }))
    expect(screen.getByText(nl.event.zelfreviewAlleenLezen)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: nl.event.zelfreviewBijwerken })).toBeNull()
  })

  it('een queryfout geeft alleen in deze sectie de niet-beschikbaar-melding, zonder ruwe fout', async () => {
    await eventPagina('t1', basis(), { trainer_zelfreviews: { code: 'PGRST205', message: 'RAW_DB_DETAIL' } })
    expect(screen.getByText(nl.event.zelfreviewNietBeschikbaar)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/RAW_DB_DETAIL|PGRST205/)
    expect(screen.getByRole('heading', { name: nl.event.evaluatieTitel })).toBeInTheDocument()
  })

  it('een wedstrijd heeft geen zelfreview-sectie', async () => {
    const { container } = await eventPagina('m1', basis({ events: [training('m1', dag(-1), { type: 'match', opponent: 'FC X' })] }))
    expect(container.querySelector('#mijn-zelfreview')).toBeNull()
  })
})

// ── Inzichten: kaart "Mijn ontwikkeling als trainer" ──
describe('Inzichten — zelfreviewkaart', () => {
  const NU = '2026-10-14'
  const zr = (datum: string, o: Row = {}): Row => ({
    event_id: `e-${datum}`, datum, score_uitleg: 4, score_organisatie: 3, score_coaching: 5,
    score_sfeer: 2, score_tijdsbewaking: 4, totaal: 3, ...o,
  })
  const DRIE = [zr('2026-09-01'), zr('2026-09-08'), zr('2026-09-15')]
  let rpcCalls: { name: string; args: Row }[]

  async function inzichten(
    zelfreviews: Row[] | { fout: unknown },
    o: { seizoen?: boolean; metData?: boolean } = {},
  ) {
    mockSettings.waarde = o.seizoen === false ? {} : { season_start: '2026-08-01', season_end: '2026-10-31' }
    rpcCalls = []
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
      from: (table: string) => maakClient({ events: [], players: [], settings: [], training_oefeningen: [], categorie_metingen: [] }).from(table),
      rpc: (name: string, args: Row) => {
        rpcCalls.push({ name, args })
        if (name === 'inzichten_eigen_zelfreviews') {
          return Promise.resolve(Array.isArray(zelfreviews)
            ? { data: zelfreviews.map((r) => ({ ...r, totaal: zelfreviews.length })), error: null }
            : { data: null, error: zelfreviews.fout })
        }
        if (name === 'inzichten_training_opkomst_per_maand' && o.metData) {
          return Promise.resolve({ data: [{ maand: '2026-09', aanwezig: 8, afwezig: 2 }], error: null })
        }
        return Promise.resolve({ data: [], error: null })
      },
    }
    vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>)
    const el = await InzichtenPage()
    return render(<DictProvider dict={nl}>{el}</DictProvider>)
  }

  beforeEach(() => { vi.setSystemTime(new Date(`${NU}T10:00:00`)) })

  it('een trainer met drie reviews ziet de trend en tabel; de RPC krijgt team en het verleden-venster', async () => {
    await inzichten(DRIE, { metData: true })
    expect(screen.getByText(nl.insights.zelfreviewTitle)).toBeInTheDocument()
    expect(screen.getAllByRole('rowheader').filter((r) => /wk 3[6-8]/.test(r.textContent ?? ''))).toHaveLength(3)
    const call = rpcCalls.filter((c) => c.name === 'inzichten_eigen_zelfreviews')
    expect(call).toHaveLength(1)
    expect(call[0].args).toEqual({ p_team_id: TEAM, p_start: '2026-08-01', p_end: '2026-10-13' })
  })

  it('de kaart staat in het schermdeel en niet in het printrapport', async () => {
    const { container } = await inzichten(DRIE, { metData: true })
    expect(screen.getAllByText(nl.insights.zelfreviewTitle)).toHaveLength(1)
    expect(screen.getByText(nl.insights.zelfreviewTitle).closest('.print\\:hidden')).not.toBeNull()
    expect(container.textContent).not.toContain('Korter uitleggen')
  })

  it('een trainer zonder reviews ziet de kaart met "te weinig"', async () => {
    await inzichten([], { metData: true })
    expect(screen.getByText(nl.insights.zelfreviewTeWeinig.replace('{n}', '0'))).toBeInTheDocument()
  })

  it('een niet-trainer zonder reviews ziet geen kaart, maar de RPC wordt wel aangeroepen', async () => {
    zetContext('assistent', false)
    await inzichten([], { metData: true })
    expect(screen.queryByText(nl.insights.zelfreviewTitle)).toBeNull()
    expect(rpcCalls.some((c) => c.name === 'inzichten_eigen_zelfreviews')).toBe(true)
  })

  it('V5: een niet-trainer met eigen reviews ziet de kaart (alleen-lezen)', async () => {
    zetContext('assistent', false)
    await inzichten(DRIE, { metData: true })
    expect(screen.getByText(nl.insights.zelfreviewTitle)).toBeInTheDocument()
  })

  it('een RPC-fout geeft alleen in deze kaart bronFout, zonder ruwe fout; andere kaarten blijven', async () => {
    await inzichten({ fout: { code: 'PGRST202', message: 'RAW_DB_DETAIL inzichten_eigen_zelfreviews' } }, { metData: true })
    const kaart = screen.getByText(nl.insights.zelfreviewTitle).closest('.surface-card') as HTMLElement
    expect(kaart).toHaveTextContent(nl.insights.bronFout)
    expect(document.body.textContent).not.toMatch(/RAW_DB_DETAIL|PGRST202/)
    expect(screen.getByText(nl.insights.srpeTitle)).toBeInTheDocument()
  })

  it('901 rijen is afgekapt: afgekaptTraining in plaats van cijfers', async () => {
    const veel = Array.from({ length: 901 }, (_, k) => zr('2026-09-01', { event_id: `e${k}` }))
    await inzichten(veel, { metData: true })
    const kaart = screen.getByText(nl.insights.zelfreviewTitle).closest('.surface-card') as HTMLElement
    expect(kaart).toHaveTextContent(nl.insights.afgekaptTraining)
    expect(kaart.querySelector('table')).toBeNull()
  })

  it('V4: reviews alleen maken de lege pagina niet "gevuld"', async () => {
    await inzichten(DRIE)
    expect(screen.getByText(nl.insights.geenDataTitle)).toBeInTheDocument()
    expect(screen.queryByText(nl.insights.zelfreviewTitle)).toBeNull()
  })

  it('zonder seizoen: lege staat en geen enkele RPC', async () => {
    await inzichten(DRIE, { seizoen: false })
    expect(screen.getByText(nl.insights.noSeason)).toBeInTheDocument()
    expect(rpcCalls).toHaveLength(0)
  })
})
