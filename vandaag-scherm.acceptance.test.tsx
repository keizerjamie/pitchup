// Acceptatietests — Vandaag-scherm (hoofdkaart + weekregels) op het startscherm.
//
// Testmethode: de ECHTE async server component app/page.tsx wordt gerenderd met
// een generieke in-memory tabel-engine (zelfde smaak als trainer-zelfreview.
// acceptance.test.tsx) die de echte query-chains toepast, elke query vastlegt
// en — net als PostgREST — nooit meer dan 1000 rijen per query teruggeeft.
// Alleen `Date` wordt gefaked, met expliciete Z-instants zodat Amsterdamse
// middernacht aantoonbaar los staat van de tijdzone van het testproces.
//
// "Nu" = maandag 2026-11-16 12:00Z (13:00 in Amsterdam, wintertijd).
// Niet in jsdom te dekken (browserverificatie): AC21 (375x812/1440x900, FAB),
// AC22 licht/donker.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
  notFound: vi.fn(() => { throw new Error('__notFound__') }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
// Mutabel zodat een test een locale-cookie ('en') kan zetten.
const omgeving: { locale: string | undefined } = { locale: undefined }
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: (naam: string) => (naam === 'locale' && omgeving.locale ? { value: omgeving.locale } : undefined) })),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/team-context', async (orig) => ({
  ...(await orig<typeof import('@/lib/team-context')>()),
  requireTeamContextOrLogin: vi.fn(),
}))
vi.mock('@/app/actions/todos', () => ({
  markTaskDone: vi.fn().mockResolvedValue(undefined),
  reopenTask: vi.fn().mockResolvedValue(undefined),
}))

import { createClient } from '@/lib/supabase/server'
import { requireTeamContextOrLogin } from '@/lib/team-context'
import { markTaskDone } from '@/app/actions/todos'
import DashboardPage from '@/app/page'
import { formatDate } from '@/lib/utils'

const TODAY = '2026-11-16'
const NU = '2026-11-16T12:00:00Z'
const TEAM = 'team-1'
const USER = 'user-1'
type Row = Record<string, unknown>

function dag(n: number, basis = TODAY): string {
  const d = new Date(`${basis}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const training = (id: string, datum: string, o: Row = {}): Row => ({
  id, team_id: TEAM, type: 'training', date: datum, time: '19:30:00', location: null, match_type: null,
  opponent: null, home_away: null, notes: null, doelstelling: null, goals_for: null, goals_against: null,
  created_at: '2026-11-01T10:00:00Z', ...o,
})
const wedstrijd = (id: string, datum: string, o: Row = {}): Row => ({
  id, team_id: TEAM, type: 'match', date: datum, time: '10:30:00', location: null, match_type: null,
  opponent: 'Diemen', home_away: 'away', notes: null, doelstelling: null, goals_for: null, goals_against: null,
  created_at: '2026-11-01T10:00:00Z', ...o,
})
const spelers = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, team_id: TEAM, name: `Speler ${i + 1}`, position: 'Middenvelder', jersey_number: i + 1,
    injured: false, type: 'regular', active: true,
  }))
const aanwezig = (eventId: string, spelerIds: string[], team = TEAM): Row[] =>
  spelerIds.map((p) => ({ event_id: eventId, player_id: p, team_id: team, status: 'present' }))
const ids = (van: number, tot: number) => Array.from({ length: tot - van + 1 }, (_, i) => `p${van + i}`)
const override = (eventId: string, taskType: string): Row => ({ event_id: eventId, task_type: taskType, team_id: TEAM })
const squadRij = (eventId: string): Row => ({ event_id: eventId, team_id: TEAM })
const opstelling = (eventId: string, gevuld: number, formation = '4-3-3'): Row => ({
  event_id: eventId, team_id: TEAM, formation,
  positions: Array.from({ length: gevuld }, (_, i) => ({ player_id: `p${i + 1}` })),
})

interface Query { table: string; filters: [string, unknown][] }
let queries: Query[]

const MAX_RIJEN = 1000
function maakClient(db: Record<string, Row[]>, fouten: Record<string, unknown> = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table: string) => {
      const q: Query = { table, filters: [] }
      queries.push(q)
      const preds: ((r: Row) => boolean)[] = []
      const orders: { col: string; asc: boolean }[] = []
      let limitN: number | null = null
      const rijen = () => {
        let uit = (db[table] ?? []).filter((r) => preds.every((p) => p(r)))
        if (orders.length > 0) {
          uit = [...uit].sort((a, b) => {
            for (const { col, asc } of orders) {
              const x = a[col] as string, y = b[col] as string
              if (x < y) return asc ? -1 : 1
              if (x > y) return asc ? 1 : -1
            }
            return 0
          })
        }
        // PostgREST-gedrag: nooit meer dan 1000 rijen per request.
        return uit.slice(0, Math.min(limitN ?? MAX_RIJEN, MAX_RIJEN))
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
        order: (col: string, o?: { ascending?: boolean }) => { orders.push({ col, asc: o?.ascending !== false }); return chain },
        limit: (n: number) => { limitN = n; return chain },
        maybeSingle: () => Promise.resolve({ data: rijen()[0] ?? null, error: null }),
        single: () => Promise.resolve({ data: rijen()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resultaat()).then(res, rej),
      }
      return chain
    },
  }
}

function zetContext(rol: 'owner' | 'assistent', rechten: Partial<Record<'agenda' | 'training' | 'wedstrijd', boolean>> = {}) {
  vi.mocked(requireTeamContextOrLogin).mockResolvedValue({
    userId: USER, teamId: TEAM, rol, naam: 'Team',
    rechten: { agenda: false, aanwezigheid: false, training: false, wedstrijd: false, periodisering: false, spelers: false, ...rechten },
  } as unknown as Awaited<ReturnType<typeof requireTeamContextOrLogin>>)
}

async function pagina(db: Record<string, Row[]>, fouten: Record<string, unknown> = {}, dict = nl) {
  vi.mocked(createClient).mockResolvedValue(maakClient({ settings: [], ...db }, fouten) as unknown as Awaited<ReturnType<typeof createClient>>)
  return <DictProvider dict={dict}>{await DashboardPage()}</DictProvider>
}
async function dashboard(db: Record<string, Row[]>, fouten: Record<string, unknown> = {}) {
  return render(await pagina(db, fouten))
}

const heroTegels = () => screen.queryAllByTestId('hero-tile-link')
const hero = () => heroTegels()[0].parentElement as HTMLElement
const heroLinks = (naam: string) => within(hero()).getAllByRole('link', { name: new RegExp(naam) })
const weekRegels = () => screen.queryByRole('region', { name: nl.vandaag.weekTitle })
const taakLabels = [nl.todo.taskSquad, nl.todo.taskLineup, nl.todo.taskAnalysis, nl.todo.taskTraining, nl.todo.taskSelfReview]
const volgorde = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

beforeEach(() => {
  vi.clearAllMocks()
  queries = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NU))
  omgeving.locale = undefined
  zetContext('owner')
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Hoofdkaart', () => {
  it('AC1: training morgen → "Training morgen", 19/21 aanwezig + 2 onbekend, hoofdknop naar de planner', async () => {
    await dashboard({
      events: [training('t1', dag(1))],
      players: spelers(21),
      attendance: aanwezig('t1', ids(1, 19)), // p20 en p21 hebben geen rij → onbekend
    })
    expect(heroTegels()).toHaveLength(1)
    expect(within(hero()).getAllByText(nl.vandaag.trainingTitle.replace('{wanneer}', nl.vandaag.whenTomorrow)).length).toBeGreaterThan(0)
    expect(within(hero()).getByText(`19/21 ${nl.home.present}`)).toBeInTheDocument()
    expect(within(hero()).getByText(`· ${nl.vandaag.unknownCount.replace('{n}', '2')}`)).toBeInTheDocument()
    for (const a of heroLinks(nl.home.makeTrainingPlan)) expect(a).toHaveAttribute('href', '/events/t1/training-plan')
    expect(within(hero()).getAllByText(nl.vandaag.eyebrowTodo).length).toBeGreaterThan(0)
  })

  it('AC1: gasten tellen niet mee in x/y; geblesseerden niet als onbekend', async () => {
    const rij = spelers(4)
    rij[2] = { ...rij[2], type: 'guest' }
    rij[3] = { ...rij[3], injured: true }
    await dashboard({
      events: [training('t1', dag(1))],
      players: rij,
      attendance: [...aanwezig('t1', ['p1', 'p3']), { event_id: 't1', player_id: 'p4', team_id: TEAM, status: 'injured' }],
    })
    // vast: p1, p2, p4 (p3 is gast) → 1 aanwezig van 3; p2 onbekend
    expect(within(hero()).getByText(`1/3 ${nl.home.present}`)).toBeInTheDocument()
  })

  it('AC2: wedstrijd zonder selectie → "Diemen uit" met knop naar de selectie; met selectie → knop naar de opstelling', async () => {
    const eerste = await dashboard({
      events: [wedstrijd('m1', dag(2))],
      players: spelers(18),
      attendance: aanwezig('m1', ids(1, 16)),
    })
    expect(within(hero()).getAllByText(nl.vandaag.matchAway.replace('{tegenstander}', 'Diemen')).length).toBeGreaterThan(0)
    expect(within(hero()).getByText(`16/18 ${nl.home.present}`)).toBeInTheDocument()
    for (const a of heroLinks(nl.vandaag.actionSquad)) expect(a).toHaveAttribute('href', '/events/m1/squad')
    eerste.unmount()

    await dashboard({
      events: [wedstrijd('m1', dag(2))],
      players: spelers(18),
      attendance: aanwezig('m1', ids(1, 16)),
      match_squad: [squadRij('m1')],
    })
    for (const a of heroLinks(nl.home.makeLineup)) expect(a).toHaveAttribute('href', '/events/m1/lineup')
    expect(within(hero()).queryByRole('link', { name: new RegExp(nl.vandaag.actionSquad) })).toBeNull()
  })

  it('AC2: thuiswedstrijd heet "Diemen thuis"', async () => {
    await dashboard({ events: [wedstrijd('m1', dag(2), { home_away: 'home' })], players: spelers(3) })
    expect(within(hero()).getAllByText(nl.vandaag.matchHome.replace('{tegenstander}', 'Diemen')).length).toBeGreaterThan(0)
  })

  it('AC3: gespeelde wedstrijd zonder analyse → "Analyse invullen" naar de analysepagina, zonder aanmeldtelling', async () => {
    await dashboard({
      events: [wedstrijd('m1', dag(-1)), training('t2', dag(3), { doelstelling: 'Passen' })],
      players: spelers(5),
    })
    for (const a of heroLinks(nl.vandaag.actionAnalysis)) expect(a).toHaveAttribute('href', '/events/m1/analysis')
    expect(within(hero()).queryByText(new RegExp(`^\\d+/\\d+ ${nl.home.present}$`))).toBeNull()
    expect(within(hero()).queryByText(nl.home.signups)).toBeNull()
  })

  it('AC3: een ingevulde uitslag maakt de analyse klaar → geen analysekaart', async () => {
    await dashboard({
      events: [wedstrijd('m1', dag(-1), { goals_for: 2, goals_against: 1 }), training('t2', dag(3))],
      players: spelers(5),
    })
    expect(screen.queryAllByRole('link', { name: new RegExp(nl.vandaag.actionAnalysis) })).toHaveLength(0)
    expect(heroLinks(nl.home.makeTrainingPlan)[0]).toHaveAttribute('href', '/events/t2/training-plan')
  })

  it('AC4: gehouden training met open zelfreview → "Zelfreview invullen" naar het anker', async () => {
    await dashboard({ events: [training('t1', dag(-1))], players: spelers(5) })
    for (const a of heroLinks(nl.vandaag.actionSelfReview)) expect(a).toHaveAttribute('href', '/events/t1#mijn-zelfreview')
    expect(within(hero()).getAllByText(nl.vandaag.trainingTitle.replace('{wanneer}', nl.vandaag.whenYesterday)).length).toBeGreaterThan(0)
    expect(within(hero()).getAllByText(nl.vandaag.whenYesterdayCap).length).toBeGreaterThan(0)
  })

  it('AC5: meerdere kaarten → precies één hoofdkaart; de rest staat in compacte regels, in To-do-volgorde', async () => {
    await dashboard({
      events: [wedstrijd('m1', dag(3)), training('t1', dag(0)), training('t2', dag(5))],
      players: spelers(5),
    })
    expect(heroTegels()).toHaveLength(1)
    // Training vandaag heeft de vroegste deadline → hoofdkaart.
    expect(heroLinks(nl.home.makeTrainingPlan)[0]).toHaveAttribute('href', '/events/t1/training-plan')
    const regels = within(weekRegels()!).getAllByRole('link')
    expect(regels.map((l) => l.getAttribute('href'))).toEqual(['/events/m1/squad', '/events/t2/training-plan'])
    // Het event van de hoofdkaart staat niet nogmaals als regel.
    expect(within(weekRegels()!).queryByRole('link', { name: new RegExp(`^${nl.dashboard.today}`) })).toBeNull()
  })

  it('AC6: een klare taak (override) wordt geen hoofdkaart zolang er een open taak is; ze staat wel als "Klaar"-regel', async () => {
    await dashboard({
      events: [training('t1', dag(1)), wedstrijd('m1', dag(3))],
      players: spelers(5),
      task_overrides: [override('t1', 'training_plan')],
    })
    for (const a of heroLinks(nl.vandaag.actionSquad)) expect(a).toHaveAttribute('href', '/events/m1/squad')
    const regel = within(weekRegels()!).getByRole('link')
    expect(regel).toHaveAttribute('href', '/events/t1/training-plan')
    expect(within(regel).getByText(nl.vandaag.statusDone)).toBeInTheDocument()
  })
})

describe('Weekregels', () => {
  it('AC7/AC8: regels voor events t/m vandaag+7, met dag, soort, status en link; niets voorbij +7', async () => {
    await dashboard({
      events: [training('t0', dag(0)), wedstrijd('m1', dag(1)), training('t7', dag(7)), training('t8', dag(8))],
      players: spelers(5),
      match_squad: [squadRij('m1')],
    })
    const sectie = weekRegels()!
    const links = within(sectie).getAllByRole('link')
    // t0 is de hoofdkaart; m1 (selectie klaar, opstelling open) en t7 zijn regels; t8 ligt buiten het venster.
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/events/m1/lineup', '/events/t7/training-plan'])
    expect(within(links[0]).getByText(nl.dashboard.tomorrow)).toBeInTheDocument()
    // AC8: de kloktijd staat in de subregel vóór het soort ("10:30 · Opstelling"), niet in de titel.
    expect(within(links[0]).getByText(`10:30 · ${nl.vandaag.lineLineup}`)).toBeInTheDocument()
    expect(within(links[0]).getByText(nl.vandaag.statusOpen)).toBeInTheDocument()
    expect(within(links[1]).getByText(formatDate(dag(7), nl.browserLocale))).toBeInTheDocument()
    expect(within(links[1]).getAllByTestId('week-regel-stip')).toHaveLength(1)
    for (const l of links) for (const label of taakLabels) expect(l.textContent).not.toBe(label)
  })

  // AC7 (aangescherpt): venster vandaag t/m +7, plus verleden met open taak.
  const alleKlaar = (id: string): Row[] => [override(id, 'squad'), override(id, 'lineup'), override(id, 'analysis')]
  const todoKnoppen = () => screen.queryAllByRole('button', { name: new RegExp(`^(${taakLabels.join('|')})$`) })

  it('AC7: afgerond verleden → geen weekregel, maar de taken staan nog wel in de To-do-lijst', async () => {
    await dashboard({
      events: [wedstrijd('mOud', dag(-3)), training('t2', dag(2))],
      players: spelers(5),
      task_overrides: alleKlaar('mOud'),
    })
    // t2 is de hoofdkaart; mOud is volledig afgerond en ligt voor vandaag.
    expect(weekRegels()).toBeNull()
    expect(heroLinks('.').every((l) => !l.getAttribute('href')!.startsWith('/events/mOud'))).toBe(true)
    // Wel nog in de To-do: de afgevinkte taken van mOud blijven als knop bestaan.
    expect(screen.getAllByText(/Diemen/).length).toBeGreaterThan(0)
    expect(todoKnoppen().length).toBeGreaterThan(0)
  })

  it('AC7: open verleden (analyse nog open) → wel een weekregel; afgerond verleden ernaast niet', async () => {
    await dashboard({
      events: [wedstrijd('mOpen1', dag(-3)), wedstrijd('mOpen2', dag(-9)), wedstrijd('mKlaar', dag(-5)), training('t2', dag(2))],
      players: spelers(5),
      task_overrides: alleKlaar('mKlaar'),
    })
    const heroEvent = heroLinks('.')[0].getAttribute('href')!.split('/')[2].split('#')[0]
    expect(['mOpen1', 'mOpen2']).toContain(heroEvent)
    const ander = heroEvent === 'mOpen1' ? 'mOpen2' : 'mOpen1'
    const hrefs = within(weekRegels()!).getAllByRole('link').map((l) => l.getAttribute('href'))
    expect(hrefs).toContain(`/events/${ander}/analysis`)
    expect(hrefs.some((h) => h?.startsWith('/events/mKlaar'))).toBe(false)
  })

  it('AC7: grenzen — vandaag en vandaag+7 hebben een regel, vandaag+8 niet (afgeronde events)', async () => {
    await dashboard({
      events: [
        wedstrijd('mHero', dag(-2)),
        training('t0', dag(0), { doelstelling: 'Passen' }),
        training('t7', dag(7), { doelstelling: 'Passen' }),
        training('t8', dag(8), { doelstelling: 'Passen' }),
      ],
      players: spelers(5),
    })
    expect(heroLinks('.')[0].getAttribute('href')).toMatch(/^\/events\/mHero(\/|#|$)/)
    const hrefs = within(weekRegels()!).getAllByRole('link').map((l) => l.getAttribute('href'))
    const heeft = (id: string) => hrefs.some((h) => h?.startsWith(`/events/${id}/`) || h?.startsWith(`/events/${id}#`))
    expect(heeft('t0')).toBe(true)
    expect(heeft('t7')).toBe(true)
    expect(heeft('t8')).toBe(false)
  })

  it('AC7: grens aan de verleden-kant — gisteren afgerond heeft geen regel, vandaag afgerond wel', async () => {
    await dashboard({
      events: [
        wedstrijd('mHero', dag(-4)),
        wedstrijd('mGisteren', dag(-1)),
        training('tVandaag', dag(0), { doelstelling: 'Passen' }),
      ],
      players: spelers(5),
      task_overrides: alleKlaar('mGisteren'),
    })
    const hrefs = within(weekRegels()!).getAllByRole('link').map((l) => l.getAttribute('href'))
    expect(hrefs.some((h) => h?.startsWith('/events/tVandaag'))).toBe(true)
    expect(hrefs.some((h) => h?.startsWith('/events/mGisteren'))).toBe(false)
  })

  it('AC8: titel wordt niet afgekapt (geen truncate-klasse in de regel) en de tijd staat in de subregel', async () => {
    await dashboard({
      events: [training('t0', dag(0)), wedstrijd('m1', dag(1), { opponent: 'Zeer Lange Verenigingsnaam Combinatie' }), training('t3', dag(3), { doelstelling: 'Passen' })],
      players: spelers(5),
      match_squad: [squadRij('m1')],
    })
    const links = within(weekRegels()!).getAllByRole('link')
    for (const l of links) {
      const metTruncate = [l, ...Array.from(l.querySelectorAll('*'))].filter((el) => /\btruncate\b/.test(el.getAttribute('class') ?? ''))
      expect(metTruncate).toHaveLength(0)
    }
    const m1 = links.find((l) => l.getAttribute('href') === '/events/m1/lineup')!
    const titel = within(m1).getByText(/Zeer Lange Verenigingsnaam Combinatie/)
    expect(titel.textContent).not.toMatch(/\d{1,2}:\d{2}/)
    expect(titel.className).toMatch(/break-words/)
    expect(within(m1).getByText(`10:30 · ${nl.vandaag.lineLineup}`)).toBeInTheDocument()
    // Klare regel: de subregel is alleen de tijd.
    const klaar = links.find((l) => l.getAttribute('href') === '/events/t3/training-plan')!
    expect(within(klaar).getByText('19:30')).toBeInTheDocument()
  })

  it('geen regels → geen weekregels-sectie', async () => {
    await dashboard({ events: [training('t1', dag(1))], players: spelers(3) })
    expect(weekRegels()).toBeNull()
  })
})

describe('Probleemkaarten', () => {
  it('AC9: onvolledige opstelling (9 van 11) → "Opstelling mist 2 posities", knop naar de opstelling', async () => {
    await dashboard({
      events: [wedstrijd('m1', dag(1))], players: spelers(14),
      match_squad: [squadRij('m1')], lineups: [opstelling('m1', 9)],
    })
    expect(within(hero()).getAllByText(nl.vandaag.lineupMissingMany.replace('{n}', '2')).length).toBeGreaterThan(0)
    for (const a of heroLinks(nl.vandaag.actionFixLineup)) expect(a).toHaveAttribute('href', '/events/m1/lineup')
  })

  it('AC9: 10 van 11 → "mist 1 positie"; onbekende formatie → "niet compleet" zonder aantal', async () => {
    const een = await dashboard({
      events: [wedstrijd('m1', dag(1))], players: spelers(14),
      match_squad: [squadRij('m1')], lineups: [opstelling('m1', 10)],
    })
    expect(within(hero()).getAllByText(nl.vandaag.lineupMissingOne).length).toBeGreaterThan(0)
    een.unmount()
    await dashboard({
      events: [wedstrijd('m1', dag(1))], players: spelers(14),
      match_squad: [squadRij('m1')], lineups: [opstelling('m1', 9, 'onbekend')],
    })
    expect(within(hero()).getAllByText(nl.vandaag.lineupIncomplete).length).toBeGreaterThan(0)
    expect(hero().textContent).not.toMatch(/mist \d+ posities/)
  })

  it('AC9: een handmatig als klaar afgevinkte onvolledige opstelling is nooit een probleem', async () => {
    await dashboard({
      events: [wedstrijd('m1', dag(1))], players: spelers(14),
      match_squad: [squadRij('m1')], lineups: [opstelling('m1', 9)],
      task_overrides: [override('m1', 'lineup')],
    })
    expect(screen.queryByText(new RegExp(nl.vandaag.lineupMissingMany.replace('{n}', '\\d+')))).toBeNull()
    expect(screen.queryByText(nl.vandaag.actionFixLineup)).toBeNull()
  })

  it('AC10: de probleemkaart is alleen hoofdkaart als ze volgens de rangorde bovenaan staat; anders een regel met de probleemtekst', async () => {
    await dashboard({
      events: [training('t1', dag(0)), wedstrijd('m1', dag(2))], players: spelers(14),
      match_squad: [squadRij('m1')], lineups: [opstelling('m1', 9)],
    })
    expect(heroLinks(nl.home.makeTrainingPlan)[0]).toHaveAttribute('href', '/events/t1/training-plan')
    expect(within(hero()).queryByText(nl.vandaag.actionFixLineup)).toBeNull()
    const regel = within(weekRegels()!).getByRole('link')
    expect(regel).toHaveAttribute('href', '/events/m1/lineup')
    expect(within(regel).getByText(nl.vandaag.lineupMissingMany.replace('{n}', '2'))).toBeInTheDocument()
  })
})

describe('Bestaande blokken en afvinken', () => {
  it('AC11: hoofdkaart en weekregels staan vóór To-do, KPI-tegels, Beschikbaarheid en Periodisering', async () => {
    await dashboard({ events: [training('t1', dag(1)), wedstrijd('m1', dag(2))], players: spelers(5) })
    const todo = screen.getByText(nl.todo.title)
    const kpi = screen.getByText(nl.home.statAttendance)
    const beschikbaar = screen.getByText(nl.home.availability)
    const periodisering = screen.getByText(nl.home.periodizationTitle)
    for (const eerder of [hero(), weekRegels()!]) {
      for (const later of [todo, kpi, beschikbaar, periodisering]) expect(volgorde(eerder, later)).toBe(true)
    }
    expect(volgorde(hero(), weekRegels()!)).toBe(true)
    expect(volgorde(todo, kpi)).toBe(true)
  })

  it('AC12: afvinken roept markTaskDone aan; na de server-render (override) schuift de hoofdkaart naar de volgende taak', async () => {
    const db: Record<string, Row[]> = {
      events: [training('t1', dag(1)), wedstrijd('m1', dag(3))],
      players: spelers(5),
    }
    const view = render(await pagina(db))
    expect(heroLinks(nl.home.makeTrainingPlan)[0]).toHaveAttribute('href', '/events/t1/training-plan')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: nl.todo.taskTraining })) })
    expect(markTaskDone).toHaveBeenCalledWith('t1', 'training_plan')

    // revalidatePath('/') laat de server de pagina opnieuw renderen, nu met de override.
    view.rerender(await pagina({ ...db, task_overrides: [override('t1', 'training_plan')] }))
    for (const a of heroLinks(nl.vandaag.actionSquad)) expect(a).toHaveAttribute('href', '/events/m1/squad')
    expect(screen.getByRole('button', { name: nl.todo.taskTraining })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Faal- en rechtenpaden', () => {
  it('AC13: geen events → huidige lege staat, geen hoofdkaart, geen weekregels, geen fout', async () => {
    await dashboard({ events: [], players: [] })
    expect(screen.getAllByText(nl.home.empty).length).toBeGreaterThan(0)
    expect(heroTegels()).toHaveLength(0)
    expect(weekRegels()).toBeNull()
  })

  it('AC14: alle taken klaar → eerstvolgende event als hoofdkaart, "Alles klaar", zonder "Te laat"', async () => {
    await dashboard({ events: [training('t1', dag(1), { doelstelling: 'Passen' })], players: spelers(5) })
    expect(within(hero()).getAllByText(nl.vandaag.eyebrowAllDone).length).toBeGreaterThan(0)
    for (const a of heroLinks(nl.vandaag.actionViewPlan)) expect(a).toHaveAttribute('href', '/events/t1/training-plan')
    expect(screen.queryByText(nl.todo.overdue)).toBeNull()
  })

  it('AC14: wedstrijd met complete opstelling → "Opstelling bekijken"', async () => {
    await dashboard({
      events: [wedstrijd('m1', dag(1))], players: spelers(14),
      match_squad: [squadRij('m1')], lineups: [opstelling('m1', 11)],
    })
    for (const a of heroLinks(nl.vandaag.actionViewLineup)) expect(a).toHaveAttribute('href', '/events/m1/lineup')
    expect(within(hero()).getAllByText(nl.vandaag.eyebrowAllDone).length).toBeGreaterThan(0)
  })

  it('AC14: alles klaar en het eerstvolgende event ligt voorbij +7 → die wedstrijd blijft hoofdkaart', async () => {
    await dashboard({ events: [wedstrijd('m1', dag(10))], players: spelers(14) })
    // Voorbij het To-do-venster is er geen taak; de kaart toont de eerstvolgende wedstrijd (selectie nog te maken).
    for (const a of heroLinks(nl.vandaag.actionSquad)) expect(a).toHaveAttribute('href', '/events/m1/squad')
  })

  it('AC15: een falende zelfreview-query → geen zelfreview-kaart/-regel en geen ruwe fout; rest werkt', async () => {
    await dashboard(
      { events: [training('t1', dag(-1)), training('t2', dag(2))], players: spelers(5) },
      { trainer_zelfreviews: { code: 'PGRST205', message: 'RAW_DB_DETAIL' } },
    )
    expect(screen.queryAllByText(nl.vandaag.actionSelfReview)).toHaveLength(0)
    expect(screen.queryAllByText(nl.vandaag.lineSelfReview)).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/RAW_DB_DETAIL|PGRST205/)
    expect(heroLinks(nl.home.makeTrainingPlan)[0]).toHaveAttribute('href', '/events/t2/training-plan')
  })

  it('AC15: een falende aanwezigheidsquery → hoofdkaart blijft, zonder getallen en zonder ruwe fout', async () => {
    await dashboard(
      { events: [training('t1', dag(1))], players: spelers(5) },
      { attendance: { code: 'XX000', message: 'RAW_ATT' } },
    )
    expect(heroTegels()).toHaveLength(1)
    expect(within(hero()).queryByText(new RegExp(`^\\d+/\\d+ ${nl.home.present}$`))).toBeNull()
    expect(within(hero()).queryByText(nl.home.signups)).toBeNull()
    expect(document.body.textContent).not.toMatch(/RAW_ATT|NaN/)
  })

  it('AC16: assistent zonder rechten ziet kaart, hoofdknop en weekregels; To-do-vinkjes zijn disabled', async () => {
    zetContext('assistent')
    await dashboard({ events: [wedstrijd('m1', dag(1)), training('t1', dag(2))], players: spelers(5) })
    for (const a of heroLinks(nl.vandaag.actionSquad)) expect(a).toHaveAttribute('href', '/events/m1/squad')
    expect(within(weekRegels()!).getByRole('link')).toHaveAttribute('href', '/events/t1/training-plan')
    expect(screen.getByRole('button', { name: nl.todo.taskSquad })).toBeDisabled()
    expect(screen.getByRole('button', { name: nl.todo.taskTraining })).toBeDisabled()
  })

  it('AC17: zonder trainingsrecht geen zelfreview-kaart, -regel of -query', async () => {
    zetContext('assistent', { wedstrijd: true })
    await dashboard({ events: [training('t1', dag(-1)), wedstrijd('m1', dag(2))], players: spelers(5) })
    expect(screen.queryAllByText(nl.vandaag.actionSelfReview)).toHaveLength(0)
    expect(screen.queryAllByText(nl.todo.taskSelfReview)).toHaveLength(0)
    expect(queries.filter((q) => q.table === 'trainer_zelfreviews')).toHaveLength(0)
  })
})

describe('Vandaag rond middernacht (Europe/Amsterdam)', () => {
  const db = () => ({
    events: [training('t1', '2026-11-17'), wedstrijd('m1', '2026-11-17', { time: '14:00:00' })],
    players: spelers(5),
  })

  it('AC18/AC19: 23:30Z (00:30 NL, dinsdag) → "Training vandaag", datumregel dinsdag 17 november, "Goedemorgen"', async () => {
    vi.setSystemTime(new Date('2026-11-16T23:30:00Z'))
    await dashboard(db())
    expect(within(hero()).getAllByText(nl.vandaag.trainingTitle.replace('{wanneer}', nl.vandaag.whenToday)).length).toBeGreaterThan(0)
    expect(screen.getByText('Dinsdag 17 november')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(nl.home.greetingMorning)
  })

  it('AC18/AC19: dezelfde events om 22:30Z (23:30 NL, maandag) → "Training morgen", maandag 16 november, "Goedenavond"', async () => {
    vi.setSystemTime(new Date('2026-11-16T22:30:00Z'))
    await dashboard(db())
    expect(within(hero()).getAllByText(nl.vandaag.trainingTitle.replace('{wanneer}', nl.vandaag.whenTomorrow)).length).toBeGreaterThan(0)
    expect(screen.getByText('Maandag 16 november')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(nl.home.greetingEvening)
  })

  it('AC18: NextMatch en To-do rekenen met dezelfde dag: wedstrijd op de 17e is om 00:30 NL "Vandaag" en niet te laat', async () => {
    vi.setSystemTime(new Date('2026-11-16T23:30:00Z'))
    await dashboard(db())
    const tegel = screen.getByText(nl.home.nextMatch, { selector: 'span' }).closest('a') as HTMLElement
    expect(tegel).toHaveTextContent(new RegExp(`${nl.dashboard.today} · 14:00`))
    expect(screen.queryByText(nl.todo.overdue)).toBeNull()
    // Een taak met deadline op de 16e is om 00:30 NL op de 17e verstreken en verdwijnt (geen "gisteren"-restant).
    cleanup()
    await dashboard({ events: [training('t0', '2026-11-16'), training('t1', '2026-11-17')], players: spelers(5) })
    expect(screen.getAllByRole('button', { name: nl.todo.taskTraining })).toHaveLength(1)
  })

  it('AC18: op een UTC-proces blijft het resultaat gelijk (de klok van het proces speelt geen rol)', async () => {
    const tz = process.env.TZ
    process.env.TZ = 'UTC'
    try {
      vi.setSystemTime(new Date('2026-11-16T23:30:00Z'))
      await dashboard(db())
      expect(screen.getByText('Dinsdag 17 november')).toBeInTheDocument()
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })
})

describe('Tenant en volledige tellingen', () => {
  it('AC23: elke query is gefilterd op team_id; aanwezigheid van een ander team telt niet', async () => {
    await dashboard({
      events: [training('t1', dag(1))],
      players: spelers(4),
      attendance: [...aanwezig('t1', ['p1']), ...aanwezig('t1', ['p2', 'p3', 'p4'], 'team-2')],
    })
    expect(queries.length).toBeGreaterThan(0)
    for (const q of queries) expect(q.filters, `query op ${q.table}`).toContainEqual(['team_id', TEAM])
    expect(within(hero()).getByText(`1/4 ${nl.home.present}`)).toBeInTheDocument()
  })

  it('AC23: 60 spelers × 34 events → meerdere batches ≤ 1000 rijen, telling niet afgekapt', async () => {
    const events: Row[] = []
    let attendance: Row[] = []
    for (let i = 0; i < 34; i++) {
      const id = `e${String(i).padStart(2, '0')}`
      events.push(training(id, dag(1 + (i % 7)), { created_at: `2026-11-01T10:${String(i).padStart(2, '0')}:00Z` }))
      // e00 is de hoofdkaart (vroegste dag, eerst in de lijst): 45 van 60 aanwezig; de rest iedereen.
      attendance = attendance.concat(aanwezig(id, i === 0 ? ids(1, 45) : ids(1, 60)))
    }
    await dashboard({ events, players: spelers(60), attendance })
    const batches = queries.filter((q) => q.table === 'attendance')
    expect(batches.length).toBeGreaterThan(1)
    for (const q of batches) {
      const eventIds = q.filters.find(([c]) => c === 'event_id')![1] as string[]
      expect(eventIds.length * 60).toBeLessThanOrEqual(1000)
      expect(q.filters).toContainEqual(['team_id', TEAM])
    }
    expect(within(hero()).getByText(`45/60 ${nl.home.present}`)).toBeInTheDocument()
  })
})

describe('AC20: teksten in alle talen', () => {
  const talen = { nl, en, de, fr, es }
  it.each(Object.entries(talen))('%s heeft alle vandaag-teksten, niet leeg, met dezelfde plaatshouders als nl', (_taal, d) => {
    expect(Object.keys(d.vandaag).sort()).toEqual(Object.keys(nl.vandaag).sort())
    for (const [sleutel, tekst] of Object.entries(d.vandaag)) {
      expect(tekst.trim().length, sleutel).toBeGreaterThan(0)
      const plaats = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
      expect(plaats(tekst), sleutel).toBe(plaats((nl.vandaag as Record<string, string>)[sleutel]))
    }
  })

  it('de/fr/es zijn echt vertaald (niet gelijk aan het Nederlands) voor de kernteksten', () => {
    for (const d of [de, fr, es]) {
      for (const k of ['actionSquad', 'actionFixLineup', 'weekTitle', 'statusDone', 'eyebrowAllDone'] as const) {
        expect(d.vandaag[k], k).not.toBe(nl.vandaag[k])
      }
    }
  })

  it('het scherm rendert in het Engels met Engelse teksten', async () => {
    omgeving.locale = 'en'
    render(await pagina({ events: [training('t1', dag(1))], players: spelers(3) }, {}, en))
    expect(within(hero()).getAllByText(en.vandaag.eyebrowTodo).length).toBeGreaterThan(0)
  })
})

describe('Niet in jsdom te dekken', () => {
  it.todo('AC21 — NIET NETJES TE DEKKEN IN JSDOM: hoofdknop zonder scrollen op 375x812, bruikbaar op 1440x900, FAB overlapt niets — browserverificatie')
  it.todo('AC22 — NIET NETJES TE DEKKEN IN JSDOM: licht/donker van chips en weekregels — browserverificatie')
})
