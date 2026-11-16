// Aanvullende acceptatietests (test-verifier) — Vandaag-scherm: faalpaden en edge cases uit de story.
// Aanvulling op vandaag-scherm.acceptance.test.tsx; zelfde engine/mock-smaak.
//
// Origineel kopje:
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
import { markTaskDone, reopenTask } from '@/app/actions/todos'
import DashboardPage from '@/app/page'

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
const regelHrefs = () => (weekRegels() ? within(weekRegels()!).getAllByRole('link').map((l) => l.getAttribute('href')) : [])

beforeEach(() => {
  vi.clearAllMocks()
  queries = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NU))
  omgeving.locale = undefined
  zetContext('owner')
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Edge: meerdere events op één dag (AC5, AC7, AC8)', () => {
  it('AC5/AC7: training + wedstrijd op dezelfde dag → precies één hoofdkaart, het andere event is één regel, geen event dubbel', async () => {
    await dashboard({ events: [training('t1', dag(1)), wedstrijd('m1', dag(1)), training('t2', dag(4))], players: spelers(5) })
    expect(heroTegels()).toHaveLength(1)
    const hrefs = [...heroLinks('.').map((a) => a.getAttribute('href')), ...regelHrefs()]
    const eventsInKaarten = new Set(hrefs.map((h) => h!.split('/')[2].split('#')[0]))
    expect(eventsInKaarten).toEqual(new Set(['t1', 'm1', 't2']))
    // Elk event heeft maximaal één weekregel en het hoofdkaart-event staat er niet bij.
    const regelEvents = regelHrefs().map((h) => h!.split('/')[2])
    expect(new Set(regelEvents).size).toBe(regelEvents.length)
    expect(regelEvents).toHaveLength(2)
  })

  it('AC5: gelijke deadlines → stabiele uitkomst (twee keer renderen geeft dezelfde hoofdkaart en regels)', async () => {
    const db = { events: [training('t1', dag(2)), wedstrijd('m1', dag(2)), wedstrijd('m2', dag(2), { opponent: 'Ajax' })], players: spelers(5) }
    const a = await dashboard(db)
    const eerst = { hero: heroLinks('.').map((l) => l.getAttribute('href')), regels: regelHrefs() }
    a.unmount()
    await dashboard(db)
    expect({ hero: heroLinks('.').map((l) => l.getAttribute('href')), regels: regelHrefs() }).toEqual(eerst)
    expect(heroTegels()).toHaveLength(1)
  })

  it('AC7/AC12: dezelfde events en taken als de To-do: elke taakknop in de To-do heeft zijn event in hoofdkaart of weekregel, en omgekeerd', async () => {
    await dashboard({ events: [training('t1', dag(0)), wedstrijd('m1', dag(2)), training('t2', dag(7)), training('t9', dag(9))], players: spelers(5) })
    const todoKnoppen = screen.getAllByRole('button', { name: new RegExp(`^(${[nl.todo.taskTraining, nl.todo.taskSquad].join('|')})$`) })
    // t1 (training_plan + zelfreview), m1 (squad + lineup), t2 (training_plan): taken die op de To-do staan.
    expect(todoKnoppen.length).toBeGreaterThanOrEqual(3)
    const kaartEvents = new Set([...heroLinks('.').map((a) => a.getAttribute('href')!.split('/')[2].split('#')[0]), ...regelHrefs().map((h) => h!.split('/')[2])])
    expect(kaartEvents).toEqual(new Set(['t1', 'm1', 't2']))
    expect(kaartEvents.has('t9')).toBe(false)
  })

  it('AC8: een regel toont dag, soort en status, en het aantal regels = aantal events met taken (klare en open)', async () => {
    await dashboard({
      events: [training('t1', dag(1)), wedstrijd('m1', dag(2)), training('t2', dag(3), { doelstelling: 'Passen' })],
      players: spelers(5),
    })
    const regels = within(weekRegels()!).getAllByRole('link')
    expect(regels).toHaveLength(2)
    const klaar = regels.find((l) => l.getAttribute('href') === '/events/t2/training-plan')!
    expect(within(klaar).getByText(nl.vandaag.statusDone)).toBeInTheDocument()
    expect(within(klaar).queryByText(nl.vandaag.statusOpen)).toBeNull()
    const open = regels.find((l) => l.getAttribute('href') === '/events/m1/squad')!
    expect(within(open).getByText(nl.vandaag.statusOpen)).toBeInTheDocument()
    expect(within(open).getAllByTestId('week-regel-stip')).toHaveLength(1)
  })
})

describe('Edge: 0 reacties / delen door nul / inactieven / gasten (AC1, AC2)', () => {
  it('AC1: 0 reacties → "0/5 aanwezig" en "5 onbekend", nergens NaN/Infinity', async () => {
    await dashboard({ events: [training('t1', dag(1))], players: spelers(5), attendance: [] })
    expect(within(hero()).getByText(`0/5 ${nl.home.present}`)).toBeInTheDocument()
    expect(within(hero()).getByText(`· ${nl.vandaag.unknownCount.replace('{n}', '5')}`)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('AC1: iedereen heeft gereageerd → geen "onbekend"-tekst', async () => {
    await dashboard({ events: [training('t1', dag(1))], players: spelers(3), attendance: aanwezig('t1', ids(1, 3)) })
    expect(within(hero()).getByText(`3/3 ${nl.home.present}`)).toBeInTheDocument()
    expect(within(hero()).queryByText(/onbekend/)).toBeNull()
  })

  it('AC1: geen actieve spelers (0 spelers) → hoofdkaart blijft, geen NaN, geen aanwezigheidsquery', async () => {
    await dashboard({ events: [training('t1', dag(1))], players: [], attendance: aanwezig('t1', ['px']) })
    expect(heroTegels()).toHaveLength(1)
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
    expect(queries.filter((q) => q.table === 'attendance')).toHaveLength(0)
    for (const a of heroLinks(nl.home.makeTrainingPlan)) expect(a).toHaveAttribute('href', '/events/t1/training-plan')
  })

  it('AC1: inactieve spelers tellen niet mee (noch in aanwezig, noch in totaal/onbekend)', async () => {
    const rij = spelers(5)
    rij[3] = { ...rij[3], active: false }
    rij[4] = { ...rij[4], active: false }
    await dashboard({
      events: [training('t1', dag(1))],
      players: rij,
      attendance: aanwezig('t1', ['p1', 'p4', 'p5']), // p4/p5 zijn inactief
    })
    expect(within(hero()).getByText(`1/3 ${nl.home.present}`)).toBeInTheDocument()
    expect(within(hero()).getByText(`· ${nl.vandaag.unknownCount.replace('{n}', '2')}`)).toBeInTheDocument()
  })

  it('AC1: een gast die wel reageert telt niet bij "aanwezig" en niet bij het totaal', async () => {
    const rij = spelers(3)
    rij[2] = { ...rij[2], type: 'guest' }
    await dashboard({ events: [training('t1', dag(1))], players: rij, attendance: aanwezig('t1', ['p1', 'p2', 'p3']) })
    expect(within(hero()).getByText(`2/2 ${nl.home.present}`)).toBeInTheDocument()
  })

  it('AC2: "beschikbaar" komt uit aanwezigheid, niet uit match_squad (selectie van 11 spelers, 3 aanwezig → 3)', async () => {
    const squad = ids(1, 11).map((p) => ({ event_id: 'm1', team_id: TEAM, player_id: p }))
    await dashboard({
      events: [wedstrijd('m1', dag(2))], players: spelers(14),
      match_squad: squad, attendance: aanwezig('m1', ['p1', 'p2', 'p3']),
    })
    expect(within(hero()).getByText(`3/14 ${nl.home.present}`)).toBeInTheDocument()
    expect(hero().textContent).not.toMatch(/11\/14/)
  })

  it('AC1: een training die niet "vct" is (teamtactisch) krijgt dezelfde hoofdkaart naar de planner', async () => {
    await dashboard({ events: [training('t1', dag(1), { training_type: 'teamtactisch' })], players: spelers(4), attendance: aanwezig('t1', ['p1']) })
    expect(within(hero()).getByText(`1/4 ${nl.home.present}`)).toBeInTheDocument()
    for (const a of heroLinks(nl.home.makeTrainingPlan)) expect(a).toHaveAttribute('href', '/events/t1/training-plan')
  })
})

describe('Edge: analyse en zelfreview (AC3, AC4, AC6)', () => {
  it('AC3: oude open analyse zonder +7-cap (wedstrijd 20 dagen geleden, volgende training pas over 20 dagen) kan hoofdkaart worden', async () => {
    await dashboard({
      events: [wedstrijd('m0', dag(-20)), training('t1', dag(20)), training('t2', dag(3))],
      players: spelers(5),
    })
    for (const a of heroLinks(nl.vandaag.actionAnalysis)) expect(a).toHaveAttribute('href', '/events/m0/analysis')
    expect(heroTegels()).toHaveLength(1)
  })

  it('AC3/AC6: een handmatig als klaar afgevinkte analyse is geen hoofdkaart zolang er een open taak is', async () => {
    await dashboard({
      events: [wedstrijd('m1', dag(-1)), training('t2', dag(3))],
      players: spelers(5),
      task_overrides: [override('m1', 'analysis')],
    })
    expect(screen.queryAllByRole('link', { name: new RegExp(nl.vandaag.actionAnalysis) })).toHaveLength(0)
    expect(heroLinks(nl.home.makeTrainingPlan)[0]).toHaveAttribute('href', '/events/t2/training-plan')
  })

  it('AC4: al ingevulde zelfreview (rij in trainer_zelfreviews) is geen open hoofdkaart; andere gebruiker telt niet', async () => {
    await dashboard({
      events: [training('t1', dag(-1)), training('t2', dag(2))],
      players: spelers(5),
      trainer_zelfreviews: [{ event_id: 't1', team_id: TEAM, user_id: USER }],
    })
    expect(screen.queryAllByRole('link', { name: new RegExp(nl.vandaag.actionSelfReview) })).toHaveLength(0)
    expect(heroLinks(nl.home.makeTrainingPlan)[0]).toHaveAttribute('href', '/events/t2/training-plan')
    cleanup()
    await dashboard({
      events: [training('t1', dag(-1)), training('t2', dag(2))],
      players: spelers(5),
      trainer_zelfreviews: [{ event_id: 't1', team_id: TEAM, user_id: 'andere-user' }],
    })
    for (const a of heroLinks(nl.vandaag.actionSelfReview)) expect(a).toHaveAttribute('href', '/events/t1#mijn-zelfreview')
  })

  it('AC4: geen kloktijd → op de trainingsdag zelf verschijnt de zelfreview al (naast het plan), per dag', async () => {
    await dashboard({ events: [training('t1', dag(0), { doelstelling: 'Passen', time: '23:00:00' })], players: spelers(5) })
    for (const a of heroLinks(nl.vandaag.actionSelfReview)) expect(a).toHaveAttribute('href', '/events/t1#mijn-zelfreview')
  })

  it('AC4: zelfreview weg zodra de volgende training aanbreekt', async () => {
    await dashboard({ events: [training('t1', dag(-3)), training('t2', dag(0))], players: spelers(5) })
    expect(screen.queryAllByRole('link', { name: new RegExp(nl.vandaag.actionSelfReview) })).toHaveLength(0)
    expect(regelHrefs()).not.toContain('/events/t1#mijn-zelfreview')
  })
})

describe('Rechten en tenant (AC16, AC17, AC23)', () => {
  it('AC16: assistent met alleen wedstrijdrecht → wedstrijdvinkjes actief, trainingsvinkje disabled; kaart en knop altijd zichtbaar', async () => {
    zetContext('assistent', { wedstrijd: true })
    await dashboard({ events: [training('t1', dag(1)), wedstrijd('m1', dag(2))], players: spelers(5) })
    expect(heroLinks(nl.home.makeTrainingPlan)[0]).toHaveAttribute('href', '/events/t1/training-plan')
    expect(screen.getByRole('button', { name: nl.todo.taskTraining })).toBeDisabled()
    expect(screen.getByRole('button', { name: nl.todo.taskSquad })).not.toBeDisabled()
  })

  it('AC16: een disabled vinkje roept markTaskDone niet aan', async () => {
    zetContext('assistent')
    await dashboard({ events: [training('t1', dag(1))], players: spelers(5) })
    fireEvent.click(screen.getByRole('button', { name: nl.todo.taskTraining }))
    expect(markTaskDone).not.toHaveBeenCalled()
  })

  it('AC17: mét trainingsrecht verschijnt de zelfreview als regel (positieve tegenhanger) en wordt de zelfreview-query gedaan', async () => {
    zetContext('assistent', { training: true })
    await dashboard({ events: [training('t1', dag(-1)), wedstrijd('m1', dag(0))], players: spelers(5) })
    expect(queries.filter((q) => q.table === 'trainer_zelfreviews').length).toBeGreaterThan(0)
    expect(regelHrefs().concat(heroLinks('.').map((a) => a.getAttribute('href')))).toContain('/events/t1#mijn-zelfreview')
  })

  it('AC17: zonder trainingsrecht ook geen zelfreview-weekregel', async () => {
    zetContext('assistent', { wedstrijd: true })
    await dashboard({ events: [training('t1', dag(-1)), wedstrijd('m1', dag(0))], players: spelers(5) })
    expect(regelHrefs()).not.toContain('/events/t1#mijn-zelfreview')
    expect(heroLinks('.').map((a) => a.getAttribute('href'))).not.toContain('/events/t1#mijn-zelfreview')
  })

  it('AC23: events, taak-overrides en zelfreviews van een andere tenant verschijnen niet en tellen niet', async () => {
    await dashboard({
      events: [
        training('t1', dag(1)),
        training('x1', dag(0), { team_id: 'team-2' }),
        wedstrijd('x2', dag(1), { team_id: 'team-2' }),
      ],
      players: [...spelers(3), { id: 'q1', team_id: 'team-2', name: 'Vreemd', position: 'Keeper', jersey_number: 1, injured: false, type: 'regular', active: true }],
      task_overrides: [{ event_id: 't1', task_type: 'training_plan', team_id: 'team-2' }],
      attendance: aanwezig('t1', ['p1'], 'team-2'),
    })
    // t1 blijft open (override van het andere team telt niet) en is de enige kaart.
    expect(heroLinks(nl.home.makeTrainingPlan)[0]).toHaveAttribute('href', '/events/t1/training-plan')
    expect(within(hero()).getByText(`0/3 ${nl.home.present}`)).toBeInTheDocument()
    expect(weekRegels()).toBeNull()
    expect(document.body.innerHTML).not.toContain('/events/x1')
    expect(document.body.innerHTML).not.toContain('/events/x2')
  })

  it('AC23: alleen events van een ander team → lege staat (AC13), geen lekkage', async () => {
    await dashboard({ events: [training('x1', dag(1), { team_id: 'team-2' })], players: [] })
    expect(heroTegels()).toHaveLength(0)
    expect(screen.getAllByText(nl.home.empty).length).toBeGreaterThan(0)
  })
})

describe('Afvinken en heropenen (AC12)', () => {
  it('AC12: een klare taak heropenen roept reopenTask aan en na her-render is ze weer de hoofdkaart', async () => {
    const db: Record<string, Row[]> = {
      events: [training('t1', dag(1)), wedstrijd('m1', dag(3))],
      players: spelers(5),
      task_overrides: [override('t1', 'training_plan')],
    }
    const view = render(await pagina(db))
    for (const a of heroLinks(nl.vandaag.actionSquad)) expect(a).toHaveAttribute('href', '/events/m1/squad')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: nl.todo.taskTraining })) })
    expect(reopenTask).toHaveBeenCalledWith('t1', 'training_plan')
    view.rerender(await pagina({ ...db, task_overrides: [] }))
    expect(heroLinks(nl.home.makeTrainingPlan)[0]).toHaveAttribute('href', '/events/t1/training-plan')
  })

  it('AC12: een falende markTaskDone toont de foutmelding en laat de hoofdkaart staan', async () => {
    vi.mocked(markTaskDone).mockRejectedValueOnce(new Error('boem'))
    await dashboard({ events: [training('t1', dag(1)), wedstrijd('m1', dag(3))], players: spelers(5) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: nl.todo.taskTraining })) })
    expect(screen.getByRole('button', { name: nl.todo.taskTraining })).toHaveAttribute('aria-pressed', 'false')
    expect(heroLinks(nl.home.makeTrainingPlan)[0]).toHaveAttribute('href', '/events/t1/training-plan')
    expect(document.body.textContent).not.toMatch(/boem/)
  })
})

describe('Middernacht winter- én zomertijd (AC18, AC19)', () => {
  it('AC19 winter: grens exact — 22:59:59Z is nog de 16e (23:59:59 NL), 23:00:00Z is al de 17e', async () => {
    const db = () => ({ events: [training('t1', '2026-11-17')], players: spelers(3) })
    vi.setSystemTime(new Date('2026-11-16T22:59:59Z'))
    const a = await dashboard(db())
    expect(within(hero()).getAllByText(nl.vandaag.trainingTitle.replace('{wanneer}', nl.vandaag.whenTomorrow)).length).toBeGreaterThan(0)
    expect(screen.getByText('Maandag 16 november')).toBeInTheDocument()
    a.unmount()
    vi.setSystemTime(new Date('2026-11-16T23:00:00Z'))
    await dashboard(db())
    expect(within(hero()).getAllByText(nl.vandaag.trainingTitle.replace('{wanneer}', nl.vandaag.whenToday)).length).toBeGreaterThan(0)
    expect(screen.getByText('Dinsdag 17 november')).toBeInTheDocument()
  })

  it('AC19 zomer (CEST, UTC+2): 2026-07-01T22:30Z is 00:30 NL op 2 juli → "vandaag", donderdag 2 juli, "Goedemorgen"', async () => {
    vi.setSystemTime(new Date('2026-07-01T22:30:00Z'))
    await dashboard({ events: [training('t1', '2026-07-02')], players: spelers(3) })
    expect(within(hero()).getAllByText(nl.vandaag.trainingTitle.replace('{wanneer}', nl.vandaag.whenToday)).length).toBeGreaterThan(0)
    expect(screen.getByText('Donderdag 2 juli')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(nl.home.greetingMorning)
  })

  it('AC19 zomer: 2026-07-01T21:59:59Z is nog 1 juli (23:59:59 NL) → dezelfde training is "morgen", "Goedenavond"', async () => {
    vi.setSystemTime(new Date('2026-07-01T21:59:59Z'))
    await dashboard({ events: [training('t1', '2026-07-02')], players: spelers(3) })
    expect(within(hero()).getAllByText(nl.vandaag.trainingTitle.replace('{wanneer}', nl.vandaag.whenTomorrow)).length).toBeGreaterThan(0)
    expect(screen.getByText('Woensdag 1 juli')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(nl.home.greetingEvening)
  })

  it('AC18 zomer: To-do en NextMatch gebruiken dezelfde dag — wedstrijd op 2 juli om 00:30 NL is "Vandaag", geen "te laat"', async () => {
    vi.setSystemTime(new Date('2026-07-01T22:30:00Z'))
    await dashboard({ events: [wedstrijd('m1', '2026-07-02', { time: '14:00:00' })], players: spelers(3) })
    const tegel = screen.getByText(nl.home.nextMatch, { selector: 'span' }).closest('a') as HTMLElement
    expect(tegel).toHaveTextContent(new RegExp(`${nl.dashboard.today} · 14:00`))
    expect(screen.queryByText(nl.todo.overdue)).toBeNull()
  })

  it('AC18: op een proces in UTC én in Los Angeles hetzelfde resultaat in zomertijd', async () => {
    const tz = process.env.TZ
    try {
      for (const zone of ['UTC', 'America/Los_Angeles']) {
        process.env.TZ = zone
        vi.setSystemTime(new Date('2026-07-01T22:30:00Z'))
        const v = await dashboard({ events: [training('t1', '2026-07-02')], players: spelers(3) })
        expect(screen.getByText('Donderdag 2 juli')).toBeInTheDocument()
        expect(within(hero()).getAllByText(nl.vandaag.trainingTitle.replace('{wanneer}', nl.vandaag.whenToday)).length).toBeGreaterThan(0)
        v.unmount()
      }
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })

  it('AC18/AC7: weekvenster rekent met de Amsterdamse dag — om 00:30 NL (17 nov) valt de 24e nog binnen +7, de 25e niet', async () => {
    vi.setSystemTime(new Date('2026-11-16T23:30:00Z'))
    await dashboard({
      events: [training('a', '2026-11-17'), training('b', '2026-11-24'), training('c', '2026-11-25')],
      players: spelers(3),
    })
    expect(regelHrefs()).toEqual(['/events/b/training-plan'])
  })
})

describe('Faalpaden die ook zonder ruwe fout moeten blijven (AC15)', () => {
  it('AC15: falende events-query → geen crash, geen ruwe fout', async () => {
    await dashboard({ events: [training('t1', dag(1))], players: spelers(3) }, { events: { code: 'XX000', message: 'RAW_EVENTS' } })
    expect(document.body.textContent).not.toMatch(/RAW_EVENTS|NaN/)
    expect(heroTegels()).toHaveLength(0)
  })

  it('AC15: falende lineups-query → geen "opstelling mist"-kaart en geen ruwe fout', async () => {
    await dashboard(
      { events: [wedstrijd('m1', dag(1))], players: spelers(14), match_squad: [squadRij('m1')], lineups: [opstelling('m1', 9)] },
      { lineups: { code: 'XX000', message: 'RAW_LINEUPS' } },
    )
    expect(document.body.textContent).not.toMatch(/RAW_LINEUPS/)
    expect(screen.queryByText(new RegExp(nl.vandaag.lineupMissingMany.replace('{n}', '\\d+')))).toBeNull()
  })

  it('AC15: falende zelfreview-query → zelfreview ook niet als hoofdkaart wanneer het de enige taak is (geen leeg scherm met fout)', async () => {
    await dashboard({ events: [training('t1', dag(-1))], players: spelers(3) }, { trainer_zelfreviews: { code: 'PGRST205', message: 'RAW' } })
    expect(screen.queryAllByRole('link', { name: new RegExp(nl.vandaag.actionSelfReview) })).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/PGRST205|RAW/)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})

describe('AC24: geen nieuwe tabellen of RPCs', () => {
  const BEKENDE_TABELLEN = new Set([
    'events', 'players', 'attendance', 'settings', 'match_squad', 'lineups', 'match_ratings', 'match_events',
    'training_oefeningen', 'task_overrides', 'trainer_zelfreviews', 'categorie_metingen', 'training_log',
  ])
  it('de pagina bevraagt alleen bestaande tabellen en gebruikt alleen bestaande RPCs', async () => {
    const rpcs: string[] = []
    const client = maakClient({ settings: [], events: [training('t1', dag(1)), wedstrijd('m1', dag(2))], players: spelers(3) }) as { rpc: (n: string) => unknown }
    client.rpc = (n: string) => { rpcs.push(n); return Promise.resolve({ data: null, error: null }) }
    vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>)
    render(<DictProvider dict={nl}>{await DashboardPage()}</DictProvider>)
    const onbekend = [...new Set(queries.map((q) => q.table))].filter((t) => !BEKENDE_TABELLEN.has(t))
    // Bestaande tabellen die hier niet in de lijst staan zijn geen bewijs van "nieuw": controleer tegen de repo-migraties.
    const { readFileSync, readdirSync, existsSync } = await import('node:fs')
    const sqlTekst = ['supabase', 'supabase/migrations'].filter(existsSync)
      .flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`${d}/${f}`, 'utf8'))).join('\n')
    for (const t of onbekend) expect(sqlTekst, `tabel ${t}`).toMatch(new RegExp(`create table (if not exists )?(public\\.)?${t}\\b`, 'i'))
    for (const r of rpcs) expect(sqlTekst, `rpc ${r}`).toMatch(new RegExp(`function (public\\.)?${r}\\b`, 'i'))
  })

  it('de nieuwe lib-bestanden doen alleen attendance-queries en geen RPC', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['lib/dashboard-aanwezigheid.ts', 'lib/vandaag-scherm.ts', 'lib/amsterdam-dag.ts']) {
      const tekst = readFileSync(f, 'utf8')
      expect(tekst, f).not.toMatch(/\.rpc\(/)
      for (const m of tekst.matchAll(/\.from\('([a-z_]+)'\)/g)) expect(m[1], f).toBe('attendance')
    }
  })
})

describe('AC20/AC22: statisch bewijs', () => {
  it('AC20: WeekRegels en vandaag-teksten bevatten geen hardgecodeerde Nederlandse UI-woorden', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['components/dashboard/WeekRegels.tsx', 'components/dashboard/vandaag-teksten.ts']) {
      const code = readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
      expect(code, f).not.toMatch(/['">]\s*(Open|Klaar|Komende week|Selectie|Opstelling|Analyse|Zelfreview|Training|Wedstrijd)\s*['"<]/)
    }
  })

  it('AC22: WeekRegels gebruikt design-tokens (CSS-variabelen), geen vaste hex-kleuren', async () => {
    const { readFileSync } = await import('node:fs')
    const code = readFileSync('components/dashboard/WeekRegels.tsx', 'utf8')
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(code).toMatch(/var\(--/)
  })
})

describe('Niet in jsdom te dekken', () => {
  it.todo('AC21 — NIET NETJES TE DEKKEN IN JSDOM: hoofdknop zonder scrollen op 375x812, 1440x900, FAB overlapt niets (browserverificatie)')
  it.todo('AC22 — NIET NETJES TE DEKKEN IN JSDOM: licht/donker rendering en glyphs (browserverificatie); alleen tokengebruik is statisch bewezen')
})
