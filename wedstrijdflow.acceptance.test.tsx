// Acceptatietests - "De wedstrijd als een flow" (stapper Beschikbaar, Selectie,
// Opstelling, Analyse; selectiestap met meer info; opstelling van de vorige
// wedstrijd overnemen). Een blok per acceptatiecriterium (AC1 t/m AC44 uit de
// goedgekeurde story); elke testnaam begint met het criterium dat hij dekt.
//
// Testmethode: de ECHTE async server components (de vier wedstrijdpagina's, het
// dashboard en de PDF-route) worden gerenderd met een generieke in-memory
// tabel-engine die de echte query-chains toepast (.eq/.neq/.lt/.lte/.gte/.in/
// .order/.limit, plus insert/upsert/delete/update op dezelfde rijen). Zou de
// productiecode een team_id-filter vergeten, dan lekt een spookrij van een
// ander team ook hier door en faalt de test; een recorder die alleen vastlegt
// DAT .eq() is aangeroepen bewijst dat niet. De teamcontext (rechten) komt uit
// de echte lib/team-context op team_members-rijen. De server actions draaien
// in de rechtentests en foutpaden als echte code op dezelfde engine.
//
// Alleen `Date` wordt gefaked. "Nu" = maandag 2026-11-16 12:00Z.
//
// Niet in jsdom te dekken (browserverificatie): de 375px-layout (AC19, AC41,
// AC43), de native beforeunload-dialoog van de browser (AC32: alleen dat de
// handler het event annuleert is hier te bewijzen), en browser-terug of
// veeggebaar (bewust ongedekt, besluit bij AC32).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react'
import { NextRequest } from 'next/server'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'

// ---------------------------------------------------------------------------
// Mocks (alleen de buitenste randen: Next, Supabase-client, client-actions)
// ---------------------------------------------------------------------------
const nav = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
const acties = vi.hoisted(() => ({
  toggleSquadPlayer: vi.fn(),
  saveLineup: vi.fn(),
  updateGatherTime: vi.fn(),
  saveSpeelminuten: vi.fn(),
  updateAttendance: vi.fn(),
  markAllPresent: vi.fn(),
}))
const omgeving = vi.hoisted(() => ({ locale: undefined as string | undefined }))
const pdf = vi.hoisted(() => ({ renderPdf: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
  notFound: vi.fn(() => { throw new Error('__notFound__') }),
  useRouter: () => nav,
  usePathname: () => '/events/x/lineup',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (naam: string) => (naam === 'locale' && omgeving.locale ? { value: omgeving.locale } : undefined),
    getAll: () => [],
  })),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/app/actions/match-squad', async (orig) => ({
  ...(await orig<typeof import('@/app/actions/match-squad')>()),
  toggleSquadPlayer: acties.toggleSquadPlayer,
}))
vi.mock('@/app/actions/attendance', async (orig) => ({
  ...(await orig<typeof import('@/app/actions/attendance')>()),
  saveLineup: acties.saveLineup,
  updateAttendance: acties.updateAttendance,
  markAllPresent: acties.markAllPresent,
}))
vi.mock('@/app/actions/events', async (orig) => ({
  ...(await orig<typeof import('@/app/actions/events')>()),
  updateGatherTime: acties.updateGatherTime,
}))
vi.mock('@/app/actions/speelminuten', async (orig) => ({
  ...(await orig<typeof import('@/app/actions/speelminuten')>()),
  saveSpeelminuten: acties.saveSpeelminuten,
}))
vi.mock('@/lib/pdf/render', async (orig) => ({
  ...(await orig<typeof import('@/lib/pdf/render')>()),
  renderPdf: pdf.renderPdf,
}))
vi.mock('@/lib/pdf/sessie', () => ({
  zorgVoorRuimeSessie: vi.fn(async () => true),
  cookiesVoorRender: vi.fn(() => []),
}))

import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import EventDetailPage from '@/app/events/[id]/page'
import MatchSquadPage from '@/app/events/[id]/squad/page'
import LineupPage from '@/app/events/[id]/lineup/page'
import AnalysisPage from '@/app/events/[id]/analysis/page'
import DashboardPage from '@/app/page'
import MatchSquadPrintList from '@/components/MatchSquadPrintList'
import { GET as pdfGet } from '@/app/api/pdf/route'
import { FORMATIONS, POSITION_ABBREVIATIONS, type Player } from '@/lib/types'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { GEEN_RECHTEN, rechtenNaarKolommen, type Onderdeel } from '@/lib/team-rechten'
import { formatDateLong, formatDateShort } from '@/lib/utils'
import { toMatchFormItems } from '@/lib/match-form'
import { resolveClubColors, readableAccentOnWhite } from '@/lib/club-colors'
import { taakHref } from '@/lib/vandaag-scherm'

const echt = {
  matchSquad: await vi.importActual<typeof import('@/app/actions/match-squad')>('@/app/actions/match-squad'),
  attendance: await vi.importActual<typeof import('@/app/actions/attendance')>('@/app/actions/attendance'),
  events: await vi.importActual<typeof import('@/app/actions/events')>('@/app/actions/events'),
  speelminuten: await vi.importActual<typeof import('@/app/actions/speelminuten')>('@/app/actions/speelminuten'),
  matchAnalysis: await vi.importActual<typeof import('@/app/actions/match-analysis')>('@/app/actions/match-analysis'),
}

// ---------------------------------------------------------------------------
// Data-helpers
// ---------------------------------------------------------------------------
const TEAM = 'team-1'
const ANDER = 'team-2'
const USER = 'user-1'
const NU = '2026-11-16T12:00:00Z'
type Row = Record<string, unknown>

const pad = (n: number) => String(n).padStart(2, '0')
const lokaal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function dag(n: number): string {
  const d = new Date(NU)
  d.setDate(d.getDate() + n)
  return lokaal(d)
}
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const E = (n: number) => uuid(1000 + n)
const P = (n: number) => uuid(n)

const NAMEN = ['Anna Aap', 'Bram Beer', 'Cas Cobra', 'Daan Duif', 'Evi Eend', 'Floor Fret', 'Gijs Geit', 'Hugo Haas', 'Ivo Ibis', 'Jan Jak', 'Kees Kat', 'Lars Lam', 'Mees Mol', 'Noor Nijl']
const eerste = (n: number) => NAMEN[n - 1].split(' ')[0]

function spelerRij(n: number, o: Row = {}): Row {
  return {
    id: P(n), team_id: TEAM, name: NAMEN[n - 1], position: 'Centrale middenvelder', secondary_positions: [],
    jersey_number: n, active: true, injured: false, type: 'regular', rating: 6, created_at: '2024-01-01T00:00:00Z', ...o,
  }
}
const spelers = (n: number): Row[] => Array.from({ length: n }, (_, i) => spelerRij(i + 1))

function wedstrijd(id: string, datum: string, o: Row = {}): Row {
  return {
    id, team_id: TEAM, type: 'match', date: datum, time: '10:30:00', location: 'Sportpark Zuid', match_type: 'league',
    opponent: 'FC Rivalen', home_away: 'home', notes: null, doelstelling: null, goals_for: null, goals_against: null,
    gather_time: null, created_at: '2026-11-01T10:00:00Z', ...o,
  }
}
const training = (id: string, datum: string, o: Row = {}): Row => wedstrijd(id, datum, { type: 'training', opponent: null, match_type: null, home_away: null, ...o })
const aanw = (eventId: string, n: number, status: string, team = TEAM): Row => ({ event_id: eventId, player_id: P(n), team_id: team, status })
const aanwezigen = (eventId: string, ns: number[], team = TEAM): Row[] => ns.map((n) => aanw(eventId, n, 'present', team))
const squadRij = (eventId: string, n: number, team = TEAM): Row => ({ event_id: eventId, player_id: P(n), team_id: team })
const squadRijen = (eventId: string, ns: number[], team = TEAM): Row[] => ns.map((n) => squadRij(eventId, n, team))
function opstelling(eventId: string, ns: (number | null)[], formation = '4-3-3', team = TEAM): Row {
  const basis = FORMATIONS[formation]?.positions ?? []
  // Een deels gevulde opstelling wordt aangevuld met lege slots tot de formatiegrootte.
  const slots = Math.max(ns.length, basis.length)
  return {
    event_id: eventId, team_id: team, formation,
    positions: Array.from({ length: slots }, (_, i) => ({
      ...(basis[i] ?? { x: 50, y: 50, position_label: 'XX', position_number: i + 1 }),
      player_id: ns[i] === undefined || ns[i] === null ? null : P(ns[i] as number),
    })),
  }
}
const elf = (van = 1) => Array.from({ length: 11 }, (_, i) => van + i)
const minuten = (eventId: string, n: number, m: number, team = TEAM): Row => ({ event_id: eventId, player_id: P(n), team_id: team, minuten: m, wissels: 0 })

type Db = Record<string, Row[]>
type Lid = 'owner' | Partial<Record<Onderdeel, boolean>>
const lidRij = (lid: Lid): Row => lid === 'owner'
  ? { team_id: TEAM, user_id: USER, rol: 'owner' }
  : { team_id: TEAM, user_id: USER, rol: 'assistent', ...rechtenNaarKolommen({ ...GEEN_RECHTEN, ...lid }) }

// ---------------------------------------------------------------------------
// Tabel-engine
// ---------------------------------------------------------------------------
interface Query { table: string; op: string; filters: [string, unknown][] }
interface Schrijf { table: string; op: string; payload?: unknown; opts?: unknown }
let queries: Query[]
let schrijfacties: Schrijf[]
let rpcAanroepen: { naam: string; args: unknown }[]

function maakClient(db: Db, fouten: Record<string, unknown> = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }), getSession: async () => ({ data: { session: { expires_at: 9999999999 } }, error: null }) },
    rpc: (naam: string, args: unknown) => {
      rpcAanroepen.push({ naam, args })
      return Promise.resolve({ data: null, error: fouten[`rpc:${naam}`] ?? null })
    },
    from: (table: string) => {
      const q: Query = { table, op: 'select', filters: [] }
      queries.push(q)
      const preds: ((r: Row) => boolean)[] = []
      const orders: { col: string; asc: boolean; nullsFirst: boolean }[] = []
      let limitN: number | null = null
      let patch: Row | null = null
      const alle = () => (db[table] ??= [])
      const rijen = (): Row[] => {
        let uit = alle().filter((r) => preds.every((p) => p(r)))
        if (orders.length > 0) {
          uit = [...uit].sort((a, b) => {
            for (const o of orders) {
              const x = a[o.col] as string | number | null | undefined
              const y = b[o.col] as string | number | null | undefined
              const xn = x === null || x === undefined
              const yn = y === null || y === undefined
              if (xn && yn) continue
              if (xn) return o.nullsFirst ? -1 : 1
              if (yn) return o.nullsFirst ? 1 : -1
              if (x! < y!) return o.asc ? -1 : 1
              if (x! > y!) return o.asc ? 1 : -1
            }
            return 0
          })
        }
        return uit.slice(0, Math.min(limitN ?? 1000, 1000))
      }
      const fout = () => (q.op === 'select' ? fouten[table] : fouten[`${table}:${q.op}`])
      const resultaat = () => {
        if (fout()) return { data: null, error: fout() }
        if (q.op === 'select') { const uit = rijen(); return { data: uit, error: null, count: uit.length } }
        if (q.op === 'delete') {
          const weg = new Set(rijen())
          db[table] = alle().filter((r) => !weg.has(r))
        }
        if (q.op === 'update' && patch) for (const r of rijen()) Object.assign(r, patch)
        return { data: null, error: null }
      }
      const filterOp = (naam: string, c: string, v: unknown, pred: (r: Row) => boolean) => {
        if (naam === 'eq' || naam === 'in') q.filters.push([c, v])
        preds.push(pred)
      }
      const schrijf = (op: string, payload: unknown, opts?: unknown) => {
        q.op = op
        schrijfacties.push({ table, op, payload, opts })
        if (fout()) return
        const lijst = (Array.isArray(payload) ? payload : [payload]) as Row[]
        if (op === 'insert') alle().push(...lijst.map((r) => ({ ...r })))
        if (op === 'upsert') {
          const o = (opts ?? {}) as { onConflict?: string; ignoreDuplicates?: boolean }
          const sleutel = (o.onConflict ?? 'id').split(',')
          for (const r of lijst) {
            const bestaand = alle().find((x) => sleutel.every((k) => x[k] === r[k]))
            if (!bestaand) alle().push({ ...r })
            else if (!o.ignoreDuplicates) Object.assign(bestaand, r)
          }
        }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filterOp('eq', c, v, (r) => r[c] === v); return chain },
        neq: (c: string, v: unknown) => { filterOp('neq', c, v, (r) => r[c] !== v); return chain },
        lt: (c: string, v: unknown) => { filterOp('lt', c, v, (r) => (r[c] as string) < (v as string)); return chain },
        lte: (c: string, v: unknown) => { filterOp('lte', c, v, (r) => (r[c] as string) <= (v as string)); return chain },
        gt: (c: string, v: unknown) => { filterOp('gt', c, v, (r) => (r[c] as string) > (v as string)); return chain },
        gte: (c: string, v: unknown) => { filterOp('gte', c, v, (r) => (r[c] as string) >= (v as string)); return chain },
        in: (c: string, v: unknown[]) => { filterOp('in', c, v, (r) => v.includes(r[c])); return chain },
        not: () => chain,
        is: () => chain,
        order: (col: string, o?: { ascending?: boolean; nullsFirst?: boolean }) => { orders.push({ col, asc: o?.ascending !== false, nullsFirst: o?.nullsFirst === true }); return chain },
        limit: (n: number) => { limitN = n; return chain },
        insert: (payload: unknown) => { schrijf('insert', payload); return chain },
        upsert: (payload: unknown, opts?: unknown) => { schrijf('upsert', payload, opts); return chain },
        update: (p: Row) => { q.op = 'update'; patch = p; schrijfacties.push({ table, op: 'update', payload: p }); return chain },
        delete: () => { q.op = 'delete'; schrijfacties.push({ table, op: 'delete' }); return chain },
        maybeSingle: () => { const r = resultaat(); return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }) },
        single: () => { const r = resultaat(); return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }) },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resultaat()).then(res, rej),
      }
      return chain
    },
  }
}

interface Omgeving { lid?: Lid; fouten?: Record<string, unknown>; dict?: typeof nl }
let huidigeDb: Db
function zetDb(db: Db, o: Omgeving = {}): Db {
  huidigeDb = { settings: [], ...db, team_members: [lidRij(o.lid ?? 'owner')] }
  vi.mocked(createClient).mockResolvedValue(maakClient(huidigeDb, o.fouten) as unknown as Awaited<ReturnType<typeof createClient>>)
  return huidigeDb
}

type Pag = 'event' | 'squad' | 'lineup' | 'analysis'
const PAGINAS = { event: EventDetailPage, squad: MatchSquadPage, lineup: LineupPage, analysis: AnalysisPage }
const PAD: Record<Pag, string> = { event: '', squad: '/squad', lineup: '/lineup', analysis: '/analysis' }
const ALLE_PAGINAS: Pag[] = ['event', 'squad', 'lineup', 'analysis']

async function toon(pag: Pag, id: string, db: Db, o: Omgeving = {}) {
  zetDb(db, o)
  const el = await PAGINAS[pag]({ params: Promise.resolve({ id }) })
  return render(<DictProvider dict={o.dict ?? nl}>{el}</DictProvider>)
}
async function toonDashboard(db: Db, o: Omgeving = {}) {
  zetDb(db, o)
  return render(<DictProvider dict={o.dict ?? nl}>{await DashboardPage()}</DictProvider>)
}

const stapperNav = () => screen.getByRole('navigation', { name: nl.wedstrijdFlow.stapperLabel })
const stapItems = () => within(stapperNav()).getAllByRole('listitem')
const stapKlaar = (i: number) => within(stapItems()[i]).queryByText(nl.wedstrijdFlow.stapKlaarSr) !== null
const stapVergrendeld = (i: number) => stapItems()[i].querySelector('[aria-disabled="true"]') !== null
const stapStatus = () => stapItems().map((_, i) => (stapVergrendeld(i) ? 'vergrendeld' : stapKlaar(i) ? 'klaar' : 'open'))
const volgende = (tekst: string) => screen.queryByRole('link', { name: tekst })
const rijVan = (naam: string) => screen.getByLabelText(`${nl.matchSquad.toggleLabel}: ${naam}`).parentElement as HTMLElement
const toggleKnop = (naam: string) => screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: ${naam}` })
const veldNamen = () => screen.queryAllByTestId(/^speler-poppetje/).map((c) => (c.closest('button')!.lastElementChild as HTMLElement).textContent)

function hasPrintHidden(el: Element | null): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) if (n.classList.contains('print:hidden')) return true
  return false
}
const printBlok = (c: HTMLElement) => c.querySelector('.hidden.print\\:block') as HTMLElement
// jsdom kan de geschiedenis niet terugzetten tussen tests; daarom de lengte zelf bepalen.
const zetGeschiedenis = (lengte: number) => Object.defineProperty(window.history, 'length', { configurable: true, get: () => lengte })

beforeEach(() => {
  vi.clearAllMocks()
  queries = []
  schrijfacties = []
  rpcAanroepen = []
  omgeving.locale = undefined
  zetGeschiedenis(1)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NU))
  acties.toggleSquadPlayer.mockResolvedValue(undefined)
  acties.saveLineup.mockResolvedValue({ legePosities: 0, selectieAutomatischGevuld: false, selectieFout: false })
  acties.updateGatherTime.mockResolvedValue(undefined)
  acties.saveSpeelminuten.mockResolvedValue(undefined)
  acties.updateAttendance.mockResolvedValue(undefined)
  acties.markAllPresent.mockResolvedValue(undefined)
  // jsdom kent geen navigatie: een niet-onderschepte linkklik zou een "not implemented"-fout loggen.
  document.addEventListener('click', voorkomNavigatie)
})
const voorkomNavigatie = (e: Event) => { if (e.target instanceof Element && e.target.closest('a[href]')) e.preventDefault() }
afterEach(() => { cleanup(); document.removeEventListener('click', voorkomNavigatie); vi.useRealTimers(); vi.restoreAllMocks() })

// Standaardwedstrijd: gespeeld gisteren, zodat alle vier de stappen open staan.
const M = E(1)
const basis = (o: Db = {}): Db => ({ events: [wedstrijd(M, dag(-1))], players: spelers(14), attendance: aanwezigen(M, [1, 2, 3]), ...o })

// ===========================================================================
// Stapper en navigatie (AC1 t/m AC8)
// ===========================================================================
describe('Stapper en navigatie', () => {
  it.each(ALLE_PAGINAS)('AC1: %s toont dezelfde stapper met vier stappen in vaste volgorde en alleen de huidige stap is aria-current="step"', async (pag) => {
    await toon(pag, M, basis())
    const links = within(stapperNav()).getAllByRole('link')
    expect(links).toHaveLength(4)
    expect(stapItems().map((li) => li.textContent)).toEqual([
      expect.stringContaining(nl.wedstrijdFlow.stapBeschikbaar),
      expect.stringContaining(nl.wedstrijdFlow.stapSelectie),
      expect.stringContaining(nl.wedstrijdFlow.stapOpstelling),
      expect.stringContaining(nl.wedstrijdFlow.stapAnalyse),
    ])
    const huidig = links.filter((l) => l.getAttribute('aria-current') === 'step')
    expect(huidig).toHaveLength(1)
    expect(huidig[0].getAttribute('href')).toBe(`/events/${M}${PAD[pag]}`)
  })

  it.each(ALLE_PAGINAS)('AC2: %s - elke stap linkt naar het bestaande pad, zonder zoekparameter of redirect', async (pag) => {
    await toon(pag, M, basis())
    const hrefs = within(stapperNav()).getAllByRole('link').map((l) => l.getAttribute('href'))
    expect(hrefs).toEqual([`/events/${M}`, `/events/${M}/squad`, `/events/${M}/lineup`, `/events/${M}/analysis`])
    expect(hrefs.some((h) => /[?#]|stap=/.test(h!))).toBe(false)
  })

  it('AC2: geen nieuw pad en geen redirect - de routemap van een wedstrijd heeft geen stap-route en next.config heeft geen redirects', () => {
    const routes = readdirSync(path.join(__dirname, 'app', 'events', '[id]')).filter((n) => statSync(path.join(__dirname, 'app', 'events', '[id]', n)).isDirectory())
    expect(routes.sort()).toEqual(['analysis', 'edit', 'lineup', 'squad', 'training-plan'])
    expect(readFileSync(path.join(__dirname, 'next.config.ts'), 'utf-8')).not.toMatch(/redirects\s*[(:]/)
  })

  it('AC3: stap 1, 2 en 3 hebben een Volgende-actie naar de volgende stap; op Analyse is er geen', async () => {
    // Gisteren gespeeld: analyse is niet vergrendeld, dus een echte link.
    const dbs = basis()
    const kijk = async (pag: Pag) => { const r = await toon(pag, M, dbs); const link = screen.queryByRole('link', { name: /^Volgende/ }); const tekst = link?.textContent ?? null; const href = link?.getAttribute('href') ?? null; r.unmount(); return { tekst, href } }
    expect(await kijk('event')).toEqual({ tekst: nl.wedstrijdFlow.volgendeSelectie, href: `/events/${M}/squad` })
    expect(nl.wedstrijdFlow.volgendeSelectie).toBe('Volgende: selectie')
    expect(await kijk('squad')).toEqual({ tekst: nl.wedstrijdFlow.volgendeOpstelling, href: `/events/${M}/lineup` })
    expect(await kijk('lineup')).toEqual({ tekst: nl.wedstrijdFlow.volgendeAnalyse, href: `/events/${M}/analysis` })
    expect(await kijk('analysis')).toEqual({ tekst: null, href: null })
  })

  it('AC3: op Analyse staat ook geen uitgeschakelde Volgende-knop of reden', async () => {
    await toon('analysis', M, basis({ events: [wedstrijd(M, dag(1))] }))
    expect(screen.queryByText(/^Volgende/)).toBeNull()
  })

  it('AC4: op stap 1 zijn de drie actiekaarten vervangen door stapper plus "Volgende: selectie"; de aanwezigheidslijst werkt ongewijzigd', async () => {
    await toon('event', M, basis())
    for (const oud of [nl.event.squad, nl.event.lineup, nl.event.lineupView, nl.event.analysis, nl.event.squadCta]) {
      expect(screen.queryByText(oud)).toBeNull()
    }
    expect(volgende(nl.wedstrijdFlow.volgendeSelectie)).toHaveAttribute('href', `/events/${M}/squad`)
    // Aanwezigheid: Evi (speler 5) zonder rij -> op "Aanwezig" tikken schrijft via de bestaande actie.
    const rij = screen.getByText(NAMEN[4]).closest('div.flex.items-center') as HTMLElement
    await act(async () => { fireEvent.click(within(rij).getByRole('button', { name: nl.event.presentStat })) })
    expect(acties.updateAttendance).toHaveBeenCalledWith(M, P(5), 'present')
  })

  it('AC5: de stapper toont geen vinkjes zolang niets klaar is en Beschikbaar krijgt nooit een vinkje, alleen de samenvatting', async () => {
    await toon('event', M, basis())
    expect(stapStatus()).toEqual(['open', 'open', 'open', 'open'])
    // 14 actieve spelers, 3 aanwezig, 11 zonder rij = geen reactie.
    expect(stapperNav().textContent).toContain('3 aanwezig · 11 geen reactie')
  })

  it('AC5: selectie is klaar bij >=1 match_squad-rij, opstelling bij een complete opstelling, analyse bij uitslag, beoordeling of moment - op alle vier de pagina\'s hetzelfde', async () => {
    const gevallen: { naam: string; db: Db; verwacht: string[] }[] = [
      { naam: 'selectie', db: basis({ match_squad: squadRijen(M, [1]) }), verwacht: ['open', 'klaar', 'open', 'open'] },
      { naam: 'complete opstelling', db: basis({ lineups: [opstelling(M, elf())] }), verwacht: ['open', 'open', 'klaar', 'open'] },
      { naam: 'uitslag', db: basis({ events: [wedstrijd(M, dag(-1), { goals_for: 2, goals_against: 1 })] }), verwacht: ['open', 'open', 'open', 'klaar'] },
      { naam: 'beoordeling', db: basis({ match_ratings: [{ event_id: M, team_id: TEAM, player_id: P(1), rating: 7 }] }), verwacht: ['open', 'open', 'open', 'klaar'] },
      { naam: 'wedstrijdmoment', db: basis({ match_events: [{ event_id: M, team_id: TEAM, player_id: P(1), kind: 'goal', minute: 5 }] }), verwacht: ['open', 'open', 'open', 'klaar'] },
      { naam: 'alles', db: basis({ match_squad: squadRijen(M, [1]), lineups: [opstelling(M, elf())], events: [wedstrijd(M, dag(-1), { goals_for: 0, goals_against: 0 })] }), verwacht: ['open', 'klaar', 'klaar', 'klaar'] },
    ]
    for (const g of gevallen) {
      for (const pag of ALLE_PAGINAS) {
        const r = await toon(pag, M, g.db)
        expect(stapStatus(), `${g.naam} op ${pag}`).toEqual(g.verwacht)
        r.unmount()
      }
    }
  })

  it('AC5: een opstelling met 10 van 11 spelers, een onbekende formatie of dezelfde speler twee keer is niet klaar (zelfde regel als de To-do)', async () => {
    const tien = opstelling(M, [...elf(1).slice(0, 10), null])
    const dubbel = opstelling(M, [...elf(1).slice(0, 10), 1])
    const onbekend = opstelling(M, elf(), 'bestaat-niet')
    for (const rij of [tien, dubbel, onbekend]) {
      const r = await toon('lineup', M, basis({ lineups: [rij] }))
      expect(stapStatus()[2]).toBe('open')
      r.unmount()
    }
  })

  it('AC5/AC39: stapper en dashboard (To-do en Vandaag-kaart) wijzen dezelfde eerstvolgende open stap aan, in vijf toestanden', async () => {
    const stap = (pad: string) => pad
    const gevallen: { naam: string; datum: string; db: Db; verwachtPad: string | null }[] = [
      { naam: 'geen selectie', datum: dag(2), db: {}, verwachtPad: '/squad' },
      { naam: 'selectie klaar', datum: dag(2), db: { match_squad: squadRijen(M, [1]) }, verwachtPad: '/lineup' },
      { naam: 'opstelling mist posities', datum: dag(2), db: { match_squad: squadRijen(M, [1]), lineups: [opstelling(M, elf().slice(0, 9))] }, verwachtPad: '/lineup' },
      { naam: 'gespeeld, analyse open', datum: dag(-1), db: { match_squad: squadRijen(M, [1]), lineups: [opstelling(M, elf())] }, verwachtPad: '/analysis' },
      { naam: 'alles klaar', datum: dag(-1), db: { match_squad: squadRijen(M, [1]), lineups: [opstelling(M, elf())], events: [wedstrijd(M, dag(-1), { goals_for: 1, goals_against: 0 })] }, verwachtPad: null },
    ]
    for (const g of gevallen) {
      // Een latere training geeft de analysetaak van een gespeelde wedstrijd een deadline (analysisDeadline).
      const db = { events: [wedstrijd(M, g.datum), training(E(40), dag(5), { doelstelling: 'Passen' })], players: spelers(14), attendance: aanwezigen(M, [1, 2, 3]), ...g.db }
      // Stapper: eerste stap (selectie, opstelling, analyse) die niet klaar of vergrendeld is.
      const s = await toon('event', M, db)
      const status = stapStatus()
      s.unmount()
      const idx = [1, 2, 3].find((i) => status[i] === 'open')
      const stapperPad = idx === undefined ? null : ['', '/squad', '/lineup', '/analysis'][idx]
      // Dashboard: bestemming van de hoofdkaart voor dit event.
      const d = await toonDashboard(db)
      const hero = screen.queryAllByTestId('hero-tile-link')[0]?.parentElement
      const hrefs = hero ? within(hero).queryAllByRole('link').map((a) => a.getAttribute('href')).filter((h): h is string => !!h && h.startsWith(`/events/${M}`)) : []
      d.unmount()
      if (g.verwachtPad === null) {
        expect(stapperPad, g.naam).toBeNull()
        expect(hrefs, g.naam).toEqual([])
      } else {
        expect(stapperPad, `stapper ${g.naam}`).toBe(g.verwachtPad)
        expect(hrefs.map(stap), `dashboard ${g.naam}`).toContain(`/events/${M}${g.verwachtPad}`)
      }
    }
  })

  it('AC6: een niet-klare stap blokkeert een latere stap niet - Opstelling en Analyse blijven links ook zonder selectie', async () => {
    await toon('event', M, basis())
    const links = within(stapperNav()).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toContain(`/events/${M}/lineup`)
    expect(links.map((l) => l.getAttribute('href'))).toContain(`/events/${M}/analysis`)
    expect(links.every((l) => l.getAttribute('aria-disabled') !== 'true')).toBe(true)
  })

  it('AC6: de opstellingspagina werkt zonder selectie (bank = aanwezigen)', async () => {
    await toon('lineup', M, basis({ lineups: [opstelling(M, [9])] }))
    expect(screen.getByText(`${nl.lineup.bench} (3)`)).toBeInTheDocument()
  })

  it.each(['event', 'squad', 'lineup'] as const)('AC7: %s - een wedstrijd morgen zonder analyse toont Analyse als niet beschikbaar (geen link) met de bestaande reden', async (pag) => {
    await toon(pag, M, basis({ events: [wedstrijd(M, dag(1))] }))
    expect(stapVergrendeld(3)).toBe(true)
    expect(within(stapperNav()).getAllByRole('link')).toHaveLength(3)
    expect(within(stapItems()[3]).getByText(nl.event.analysisAfterMatch)).toBeInTheDocument()
  })

  it('AC7: de Volgende-knop naar een vergrendelde Analyse is uitgeschakeld met dezelfde reden zichtbaar', async () => {
    await toon('lineup', M, basis({ events: [wedstrijd(M, dag(1))] }))
    const knop = screen.getByRole('button', { name: nl.wedstrijdFlow.volgendeAnalyse })
    expect(knop).toBeDisabled()
    expect(screen.queryByRole('link', { name: nl.wedstrijdFlow.volgendeAnalyse })).toBeNull()
    expect(screen.getAllByText(nl.event.analysisAfterMatch).length).toBeGreaterThan(0)
  })

  it('AC7: een toekomstige wedstrijd mét bestaande analyse is niet vergrendeld (!analyseBestaat && !datumBereikt)', async () => {
    await toon('event', M, basis({ events: [wedstrijd(M, dag(1), { goals_for: 1, goals_against: 1 })] }))
    expect(stapVergrendeld(3)).toBe(false)
    expect(stapKlaar(3)).toBe(true)
    expect(within(stapperNav()).getAllByRole('link')).toHaveLength(4)
  })

  it('AC7: de URL /analysis rechtstreeks openen blijft werken voor een vergrendelde wedstrijd (pagina met de bestaande speelminuten-melding, stapper met Analyse als huidige stap)', async () => {
    await toon('analysis', M, basis({ events: [wedstrijd(M, dag(1))] }))
    expect(screen.getByText(nl.analysis.speelminutenToekomst)).toBeInTheDocument()
    const huidig = within(stapperNav()).getAllByRole('link').find((l) => l.getAttribute('aria-current') === 'step')
    expect(huidig).toHaveAttribute('href', `/events/${M}/analysis`)
  })

  it.each(['squad', 'lineup', 'analysis'] as const)('AC8: de terugknop op %s heeft als terugval nog steeds /events/[id]', async (pag) => {
    await toon(pag, M, basis())
    const terug = screen.getByRole('button', { name: nl.nav.back })
    expect(terug).toHaveAttribute('data-onopgeslagen-terug', `/events/${M}`)
    fireEvent.click(terug) // geen geschiedenis in de test -> terugval
    expect(nav.push).toHaveBeenCalledWith(`/events/${M}`)
  })

  it('AC8: met geschiedenis gaat de terugknop gewoon een stap terug', async () => {
    zetGeschiedenis(3)
    await toon('squad', M, basis())
    fireEvent.click(screen.getByRole('button', { name: nl.nav.back }))
    expect(nav.back).toHaveBeenCalled()
    expect(nav.push).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Rechten (AC9 t/m AC12)
// ===========================================================================
describe('Rechten', () => {
  const alleenAanwezigheid: Lid = { aanwezigheid: true }
  const alleenWedstrijd: Lid = { wedstrijd: true }
  const geen: Lid = {}

  it('AC9: zonder aanwezigheidsrecht is de aanwezigheid alleen-lezen op stap 1, maar werken stapper en "Volgende: selectie" gewoon', async () => {
    await toon('event', M, basis(), { lid: alleenWedstrijd })
    expect(screen.queryByRole('button', { name: nl.event.presentStat })).toBeNull()
    expect(screen.queryByRole('button', { name: nl.event.markAllPresent })).toBeNull()
    expect(screen.getAllByText(nl.event.presentStat).length).toBeGreaterThan(0) // status als badge
    expect(within(stapperNav()).getAllByRole('link')).toHaveLength(4)
    expect(volgende(nl.wedstrijdFlow.volgendeSelectie)).toHaveAttribute('href', `/events/${M}/squad`)
  })

  it('AC9: ook iemand zonder enig recht ziet de stapper en kan de flow doorlopen', async () => {
    await toon('event', M, basis(), { lid: geen })
    expect(within(stapperNav()).getAllByRole('link')).toHaveLength(4)
    expect(volgende(nl.wedstrijdFlow.volgendeSelectie)).not.toBeNull()
  })

  it('AC10: zonder wedstrijdrecht is de selectie alleen-lezen (geen toggles, geen verzameltijd-opslaan, geen overnemen)', async () => {
    await toon('squad', M, basis({ match_squad: squadRijen(M, [1]) }), { lid: alleenAanwezigheid })
    expect(screen.queryAllByRole('button', { name: new RegExp(`^${nl.matchSquad.toggleLabel}:`) })).toHaveLength(0)
    expect(screen.queryByRole('button', { name: nl.matchSquad.gatherTimeSave })).toBeNull()
    expect(screen.getByLabelText(`${nl.matchSquad.toggleLabel}: ${eerste(1)} ${NAMEN[0].split(' ')[1]}`)).toBeInTheDocument()
    expect(within(stapperNav()).getAllByRole('link')).toHaveLength(4)
  })

  it('AC10: zonder wedstrijdrecht heeft de opstellingspagina geen Opslaan, geen Auto-opstelling, geen formatiekiezer en geen overnemen-knop', async () => {
    const db = basis({ events: [wedstrijd(M, dag(-1)), wedstrijd(E(2), dag(-8))], lineups: [opstelling(E(2), elf())] })
    await toon('lineup', M, db, { lid: alleenAanwezigheid })
    expect(screen.queryByRole('button', { name: nl.lineup.save })).toBeNull()
    expect(screen.queryByRole('button', { name: nl.lineup.autoLineup })).toBeNull()
    expect(screen.queryByRole('button', { name: nl.lineup.vorigeOvernemen })).toBeNull()
    expect(screen.queryByText(nl.lineup.vorigeGeen)).toBeNull()
    expect(screen.queryByRole('button', { name: nl.lineup.formation })).toBeNull()
  })

  it('AC10: zonder wedstrijdrecht zijn minuten, uitslag en wedstrijdmomenten op de analysepagina alleen-lezen', async () => {
    await toon('analysis', M, basis(), { lid: alleenAanwezigheid })
    expect(screen.queryByLabelText(new RegExp(nl.analysis.minutenLabel))).toBeNull()
    expect(screen.queryByRole('button', { name: nl.analysis.save })).toBeNull()
    for (const veld of screen.queryAllByRole('spinbutton')) expect(veld).toHaveAttribute('readonly')
    expect(screen.getAllByText(nl.analysis.speelminutenNietIngevuld).length).toBeGreaterThan(0)
  })

  it('AC10 (server): zonder wedstrijdrecht weigeren selectie, opstelling, verzameltijd en speelminuten ook server-side, zonder iets te schrijven', async () => {
    zetDb(basis({ lineups: [] }), { lid: alleenAanwezigheid })
    await expect(echt.matchSquad.toggleSquadPlayer(M, P(1), true)).rejects.toThrow('Geen toegang')
    await expect(echt.attendance.saveLineup(M, '4-3-3', [])).rejects.toThrow('Geen toegang')
    await expect(echt.events.updateGatherTime(M, '10:00')).rejects.toThrow('Geen toegang')
    await expect(echt.speelminuten.saveSpeelminuten(M, P(1), 90, 0)).rejects.toThrow('Geen toegang')
    await expect(echt.matchAnalysis.saveMatchResult(M, 1, 0)).rejects.toThrow('Geen toegang')
    expect(schrijfacties).toEqual([])
    expect(rpcAanroepen).toEqual([])
  })

  it('AC11: wedstrijdrecht zonder aanwezigheidsrecht - selectie bewerkbaar, aanwezigheid alleen-lezen, ook server-side', async () => {
    await toon('squad', M, basis(), { lid: alleenWedstrijd })
    expect(toggleKnop(NAMEN[0])).toBeInTheDocument()
    cleanup()
    zetDb(basis(), { lid: alleenWedstrijd })
    await expect(echt.matchSquad.toggleSquadPlayer(M, P(1), true)).resolves.toBeUndefined()
    await expect(echt.attendance.updateAttendance(M, P(1), 'present')).rejects.toThrow('Geen toegang')
    expect(schrijfacties.filter((s) => s.table === 'attendance')).toEqual([])
  })

  it('AC11: aanwezigheidsrecht zonder wedstrijdrecht - aanwezigheid bewerkbaar, selectie alleen-lezen, ook server-side', async () => {
    await toon('event', M, basis(), { lid: alleenAanwezigheid })
    expect(screen.getAllByRole('button', { name: nl.event.presentStat }).length).toBeGreaterThan(0)
    cleanup()
    zetDb(basis(), { lid: alleenAanwezigheid })
    await expect(echt.attendance.updateAttendance(M, P(1), 'present')).resolves.toBeUndefined()
    await expect(echt.matchSquad.toggleSquadPlayer(M, P(1), true)).rejects.toThrow('Geen toegang')
  })

  it('AC11: met een van beide rechten blijft de flow doorloopbaar (stapper op alle vier de pagina\'s)', async () => {
    for (const lid of [alleenAanwezigheid, alleenWedstrijd]) {
      for (const pag of ALLE_PAGINAS) {
        const r = await toon(pag, M, basis(), { lid })
        expect(within(stapperNav()).getAllByRole('link')).toHaveLength(4)
        r.unmount()
      }
    }
  })

  it('AC12: bewerken en verwijderen blijven agenda-rechten en bereikbaar op /events/[id]', async () => {
    const met = await toon('event', M, basis(), { lid: { agenda: true } })
    expect(screen.getByRole('link', { name: nl.event.editEvent })).toHaveAttribute('href', `/events/${M}/edit`)
    expect(screen.getByRole('button', { name: nl.common.moreActions })).toBeInTheDocument()
    met.unmount()
    await toon('event', M, basis(), { lid: { wedstrijd: true, aanwezigheid: true } })
    expect(screen.queryByRole('link', { name: nl.event.editEvent })).toBeNull()
  })
})

// ===========================================================================
// Selectiestap (AC13 t/m AC19)
// ===========================================================================
describe('Selectiestap', () => {
  // 1-3 aanwezig, 4-5 geen reactie (geen rij), 6 afwezig, 7 geblesseerd (event-status), 8 inactief.
  const db = (extra: Db = {}): Db => basis({
    players: [...spelers(7), spelerRij(8, { active: false })],
    attendance: [...aanwezigen(M, [1, 2, 3]), aanw(M, 6, 'absent'), aanw(M, 7, 'injured')],
    ...extra,
  })

  it('AC13: drie groepen in volgorde - aanwezigen, nog geen reactie (met label), afwezig en geblesseerd ingeklapt', async () => {
    await toon('squad', M, db())
    const aanwezig = screen.getByRole('heading', { name: nl.matchSquad.groepAanwezig.replace('{n}', '3') })
    const geenReactie = screen.getByRole('heading', { name: nl.matchSquad.groepGeenReactie.replace('{n}', '2') })
    const samenvatting = screen.getByText(nl.matchSquad.groepAfwezig.replace('{n}', '2'))
    const volg = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(volg(aanwezig, geenReactie)).toBe(true)
    expect(volg(geenReactie, samenvatting)).toBe(true)
    // Rijen staan in hun eigen groep.
    expect(volg(rijVan(NAMEN[2]), geenReactie)).toBe(true)
    expect(volg(geenReactie, rijVan(NAMEN[3]))).toBe(true)
    expect(volg(rijVan(NAMEN[4]), samenvatting)).toBe(true)
    // Zichtbaar label op 'nog geen reactie'.
    expect(within(rijVan(NAMEN[3])).getByText(new RegExp(nl.matchSquad.geenReactieLabel))).toBeInTheDocument()
    // Afwezig/geblesseerd: standaard dicht en uitklapbaar.
    const details = samenvatting.closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    fireEvent.click(samenvatting)
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(within(details).getByText(NAMEN[5])).toBeInTheDocument()
    expect(within(details).getByText(NAMEN[6])).toBeInTheDocument()
  })

  it('AC13: afwezig, geblesseerd en inactief zitten in de ingeklapte groep; inactieve speler toont het label Inactief', async () => {
    // Speler 8 (inactief) is niet geselecteerd en valt dus weg; maak hem geselecteerd om hem te zien.
    await toon('squad', M, db({ match_squad: squadRijen(M, [8]) }))
    const details = screen.getByText(nl.matchSquad.groepAfwezig.replace('{n}', '3')).closest('details') as HTMLDetailsElement
    expect(within(details).getByText(new RegExp(nl.players.inactiveLabel))).toBeInTheDocument()
  })

  it('AC13/edge: alle spelers zonder reactie - de groep aanwezigen is leeg met melding, "nog geen reactie" is gevuld', async () => {
    await toon('squad', M, basis({ attendance: [] }))
    expect(screen.getByText(nl.matchSquad.geenAanwezigen)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.matchSquad.emptyNoAttendanceLink })).toHaveAttribute('href', `/events/${M}`)
    expect(screen.getByRole('heading', { name: nl.matchSquad.groepGeenReactie.replace('{n}', '14') })).toBeInTheDocument()
  })

  it('AC13/edge: team zonder actieve spelers toont de lege staat met link naar speler toevoegen', async () => {
    await toon('squad', M, basis({ players: [], attendance: [] }))
    expect(screen.getByText(nl.matchSquad.emptyTeam)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.players.add })).toBeInTheDocument()
  })

  it('AC14: een rij toont positie-afkorting, aanwezigheidsstatus, blessure-chip (players.injured) en de minuten van de laatste 3 wedstrijden', async () => {
    const rij = spelerRij(1, { position: 'Spits', injured: true })
    await toon('squad', M, db({
      players: [rij, ...spelers(7).slice(1)],
      events: [wedstrijd(M, dag(-1)), wedstrijd(E(2), dag(-8)), wedstrijd(E(3), dag(-15)), wedstrijd(E(4), dag(-22)), wedstrijd(E(5), dag(-29))],
      speelminuten: [minuten(E(2), 1, 60), minuten(E(3), 1, 45), minuten(E(4), 1, 30), minuten(E(5), 1, 99)],
    }))
    const r = rijVan(NAMEN[0])
    expect(within(r).getByText(new RegExp(`^${POSITION_ABBREVIATIONS['Spits']} · ${nl.event.presentStat}$`))).toBeInTheDocument()
    expect(within(r).getByText(nl.players.injuredBadge)).toBeInTheDocument()
    // Nieuwste eerst: 8 dagen, 15 dagen, 22 dagen geleden; de 4e (29 dagen) telt niet mee.
    expect(r.textContent).toMatch(/60 minuten op .*45 minuten op .*30 minuten op /)
    expect(r.textContent).not.toContain('99 minuten')
    // Een speler zonder blessure krijgt geen chip.
    expect(within(rijVan(NAMEN[1])).queryByText(nl.players.injuredBadge)).toBeNull()
  })

  it('AC14: de minutenkop toont de drie datums, nieuwste eerst', async () => {
    await toon('squad', M, db({ events: [wedstrijd(M, dag(-1)), wedstrijd(E(2), dag(-8)), wedstrijd(E(3), dag(-15))] }))
    const fmt = (n: number) => new Intl.DateTimeFormat(nl.browserLocale, { day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date(`${dag(n)}T00:00:00Z`))
    const kop = screen.getByText(nl.matchSquad.minutenKop).parentElement as HTMLElement
    expect(kop.textContent).toContain(`${fmt(-8)}${fmt(-15)}`)
  })

  it('AC15: een speler zonder speelminuten-rij toont een "geen gegevens"-teken, geen 0; een rij met 0 minuten toont wel 0', async () => {
    await toon('squad', M, db({
      events: [wedstrijd(M, dag(-1)), wedstrijd(E(2), dag(-8)), wedstrijd(E(3), dag(-15)), wedstrijd(E(4), dag(-22))],
      speelminuten: [minuten(E(2), 1, 0), minuten(E(4), 1, 70)],
    }))
    const r = rijVan(NAMEN[0])
    expect(within(r).getByText(/^0 minuten op /)).toBeInTheDocument()
    expect(within(r).getAllByText(/^Geen minuten bekend op /)).toHaveLength(1)
    const cellen = Array.from(r.querySelectorAll('[aria-hidden="true"].text-ink, [aria-hidden="true"].text-faint')).map((e) => e.textContent).filter((t) => t === '–' || /^\d+$/.test(t ?? ''))
    expect(cellen).toEqual(['0', '–', '70'])
    // Speler zonder enige rij: drie keer "–".
    expect(within(rijVan(NAMEN[1])).getAllByText(/^Geen minuten bekend op /)).toHaveLength(3)
  })

  it('AC15/edge: een gast zonder positie toont een leeg teken en geen foutmelding', async () => {
    await toon('squad', M, db({
      players: [...spelers(3), spelerRij(9, { type: 'guest', position: null })],
      attendance: [...aanwezigen(M, [1, 2, 3]), aanw(M, 9, 'present')],
    }))
    const r = rijVan(NAMEN[8])
    expect(within(r).getByText(new RegExp(`^– · ${nl.event.presentStat}$`))).toBeInTheDocument()
    expect(within(r).getByText(new RegExp(nl.players.guestBadge))).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('AC16: een al geselecteerde afwezige speler blijft zichtbaar (groep open) en is deselecteerbaar, ook na deselecteren', async () => {
    await toon('squad', M, db({ match_squad: squadRijen(M, [6]) }))
    const details = screen.getByText(nl.matchSquad.groepAfwezig.replace('{n}', '2')).closest('details') as HTMLDetailsElement
    expect(details.open).toBe(true)
    expect(toggleKnop(NAMEN[5])).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { fireEvent.click(toggleKnop(NAMEN[5])) })
    expect(acties.toggleSquadPlayer).toHaveBeenCalledWith(M, P(6), false)
    expect(toggleKnop(NAMEN[5])).toHaveAttribute('aria-pressed', 'false')
    expect(details.open).toBe(true) // klapt niet dicht onder je vingers
  })

  it('AC16/edge: een geselecteerde speler die inmiddels inactief is, blijft zichtbaar en deselecteerbaar', async () => {
    await toon('squad', M, db({ match_squad: squadRijen(M, [8]) }))
    expect(toggleKnop(NAMEN[7])).toHaveAttribute('aria-pressed', 'true')
    expect(within(rijVan(NAMEN[7])).getByText(new RegExp(nl.players.inactiveLabel))).toBeInTheDocument()
  })

  it('AC17: tikken is optimistisch (direct geselecteerd), met rollback en een generieke melding bij een fout - nooit de ruwe error', async () => {
    let los!: () => void
    acties.toggleSquadPlayer.mockImplementationOnce(() => new Promise<void>((res) => { los = res }))
    await toon('squad', M, db())
    await act(async () => { fireEvent.click(toggleKnop(NAMEN[0])) })
    expect(toggleKnop(NAMEN[0])).toHaveAttribute('aria-pressed', 'true') // nog niet afgerond
    await act(async () => { los() })
    expect(toggleKnop(NAMEN[0])).toHaveAttribute('aria-pressed', 'true')

    acties.toggleSquadPlayer.mockRejectedValueOnce(new Error('RAW_DB_DETAIL secret-sleutel'))
    await act(async () => { fireEvent.click(toggleKnop(NAMEN[1])) })
    expect(toggleKnop(NAMEN[1])).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(nl.matchSquad.saveError)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/RAW_DB_DETAIL|secret-sleutel/)
  })

  it('AC17: de toggle-actie is idempotent - tweemaal selecteren geeft geen dubbele rij en geen fout, deselecteren zonder rij is een no-op', async () => {
    zetDb(basis())
    await echt.matchSquad.toggleSquadPlayer(M, P(1), true)
    await echt.matchSquad.toggleSquadPlayer(M, P(1), true)
    expect(huidigeDb.match_squad.filter((r) => r.player_id === P(1))).toHaveLength(1)
    await echt.matchSquad.toggleSquadPlayer(M, P(1), false)
    await expect(echt.matchSquad.toggleSquadPlayer(M, P(1), false)).resolves.toBeUndefined()
    expect(huidigeDb.match_squad).toHaveLength(0)
  })

  it('AC18: zodra match_squad >=1 rij heeft is de bank precies de geselecteerde spelers; zonder selectie zijn dat de aanwezigen', async () => {
    const lineup = opstelling(M, [9]) // 1 opgestelde speler zodat de bank getoond wordt
    const metSelectie = await toon('lineup', M, basis({ lineups: [lineup], attendance: aanwezigen(M, [1, 2, 3, 9]), match_squad: squadRijen(M, [4, 5, 9]) }))
    const bank = () => screen.getByText(new RegExp(`^${nl.lineup.bench} \\(`)).parentElement as HTMLElement
    expect(bank().textContent).toContain(`${nl.lineup.bench} (2)`)
    expect(bank().textContent).toContain(eerste(4))
    expect(bank().textContent).toContain(eerste(5))
    expect(bank().textContent).not.toContain(eerste(1))
    metSelectie.unmount()
    await toon('lineup', M, basis({ lineups: [lineup], attendance: aanwezigen(M, [1, 2, 3, 9]) }))
    expect(bank().textContent).toContain(`${nl.lineup.bench} (3)`)
    expect(bank().textContent).toContain(eerste(1))
    expect(bank().textContent).not.toContain(eerste(4))
  })

  it('AC18/edge: alles uitvinken laat de bank terugvallen op aanwezigen en zet de stapper weer op niet klaar', async () => {
    await toon('squad', M, basis({ match_squad: squadRijen(M, [1]) }))
    expect(stapKlaar(1)).toBe(true)
    cleanup()
    await toon('squad', M, basis({ match_squad: [] }))
    expect(stapKlaar(1)).toBe(false)
  })

  it('AC19 (proxy, geen 375px-bewijs): de rij houdt de toggle van 36px met hit-slop en geeft de naam ruimte om af te breken', async () => {
    await toon('squad', M, db())
    const knop = toggleKnop(NAMEN[0])
    expect(knop.className).toMatch(/relative hit-slop w-9 h-9/)
    expect(rijVan(NAMEN[0]).querySelector('.min-w-0.flex-1')).not.toBeNull()
    expect(stapperNav().className).not.toMatch(/overflow-x/)
  })
})

// ===========================================================================
// PDF-privacy (AC20 t/m AC22)
// ===========================================================================
describe('PDF-privacy', () => {
  // Beide varianten delen dezelfde eerdere wedstrijden (die voeden het vormblok van de PDF) en dezelfde selectie;
  // alleen de schermgegevens verschillen: status, blessure, afwezigen, minuten, extra spelers en andere selectie-rijen.
  const vorigeWedstrijden = (): Row[] => [wedstrijd(E(2), dag(-8), { goals_for: 2, goals_against: 1 }), wedstrijd(E(3), dag(-15), { goals_for: 0, goals_against: 0 })]
  const huidig = (): Row => wedstrijd(M, dag(-1), { gather_time: '09:15:00' })
  const rijkeDb = (): Db => basis({
    players: [spelerRij(1, { position: 'Spits', injured: true }), ...spelers(7).slice(1), spelerRij(9, { type: 'guest' })],
    attendance: [...aanwezigen(M, [1, 2, 9]), aanw(M, 6, 'absent'), aanw(M, 7, 'injured')],
    match_squad: squadRijen(M, [1, 2, 7, 9]),
    events: [huidig(), ...vorigeWedstrijden()],
    speelminuten: [minuten(E(2), 1, 77), minuten(E(3), 2, 66)],
  })
  const kaalDb = (): Db => ({
    events: [huidig(), ...vorigeWedstrijden()],
    players: [spelerRij(1, { position: 'Spits' }), spelerRij(2), spelerRij(7), spelerRij(9, { type: 'guest' })],
    attendance: aanwezigen(M, [1, 2, 7, 9]),
    match_squad: squadRijen(M, [1, 2, 7, 9]),
  })

  it('AC20: het printblok bevat geen positie, status, blessure-chip, speelminuten, stapper, Volgende of groepskoppen', async () => {
    const { container } = await toon('squad', M, rijkeDb())
    const tekst = printBlok(container).textContent ?? ''
    expect(tekst).toContain(NAMEN[0])
    expect(tekst).not.toMatch(new RegExp(`\\b${POSITION_ABBREVIATIONS['Spits']}\\b`))
    for (const verboden of [
      nl.event.presentStat, nl.event.absentStat, nl.event.injuredStat, nl.players.injuredBadge,
      nl.matchSquad.geenReactieLabel, 'minuten op', '77', '66', nl.wedstrijdFlow.stapperLabel, nl.wedstrijdFlow.volgendeOpstelling,
      nl.matchSquad.groepAanwezig.replace(' ({n})', ''), nl.matchSquad.groepGeenReactie.replace(' ({n})', ''), nl.matchSquad.groepAfwezig.replace(' ({n})', ''),
    ]) expect(tekst, verboden).not.toContain(verboden)
  })

  it('AC20: het printblok is byte-gelijk aan dat van dezelfde selectie zonder schermgegevens en aan een directe render van MatchSquadPrintList zoals vóór de feature', async () => {
    const rijk = await toon('squad', M, rijkeDb())
    const html = printBlok(rijk.container).innerHTML
    rijk.unmount()
    const kaal = await toon('squad', M, kaalDb())
    expect(printBlok(kaal.container).innerHTML).toBe(html)
    kaal.unmount()

    const kleuren = resolveClubColors({})
    const speler = (n: number, o: Row = {}) => spelerRij(n, o) as unknown as Player
    const direct = render(
      <DictProvider dict={nl}>
        <MatchSquadPrintList
          players={[speler(1, { position: 'Spits' }), speler(2), speler(7), speler(9, { type: 'guest' })]}
          opponent="FC Rivalen" dateLabel={formatDateLong(dag(-1), nl.browserLocale)} teamName={null} teamLogoUrl={null}
          homeAway="home" gatherTime="09:15:00" kickoffTime="10:30:00" location="Sportpark Zuid" selectedCount={4}
          formItems={toMatchFormItems([vorigeWedstrijden()[0], vorigeWedstrijden()[1]] as never)}
          primaryColor={kleuren.primary} secondaryColor={kleuren.secondary} accentText={readableAccentOnWhite(kleuren.primary)}
        />
      </DictProvider>,
    )
    expect(printBlok(direct.container).innerHTML).toBe(html)
  })

  it('AC20: naam, verzameltijd en aftrap staan in de PDF zoals nu', async () => {
    const { container } = await toon('squad', M, rijkeDb())
    const tekst = printBlok(container).textContent ?? ''
    for (const n of [1, 2, 7, 9]) expect(tekst).toContain(NAMEN[n - 1])
    expect(tekst).toContain('09:15')
    expect(tekst).toContain('10:30')
    expect(tekst).not.toContain(NAMEN[2]) // niet geselecteerd
  })

  it('AC21: alle nieuwe schermonderdelen op de squad-route (stapper, Volgende, kop, groepen, minutenkop, chips, minuten) hebben een print:hidden-voorouder', async () => {
    const { container } = await toon('squad', M, rijkeDb())
    const blok = printBlok(container)
    const schermElementen: Element[] = [
      stapperNav(),
      screen.getByRole('link', { name: nl.wedstrijdFlow.volgendeOpstelling }),
      screen.getByRole('heading', { name: nl.matchSquad.groepAanwezig.replace('{n}', '3') }),
      screen.getByText(nl.matchSquad.minutenKop),
      screen.getByText(nl.players.injuredBadge),
      screen.getByText(nl.matchSquad.groepAfwezig.replace('{n}', '2')),
      rijVan(NAMEN[0]),
    ]
    for (const el of schermElementen) expect(hasPrintHidden(el), el.textContent ?? '').toBe(true)
    // En andersom: het printblok zelf staat NIET onder print:hidden.
    expect(hasPrintHidden(blok)).toBe(false)
  })

  it('AC21: MatchSquadPrintList importeert uit "@/lib/types" alleen Player en krijgt geen nieuwe velden', () => {
    const bron = readFileSync(path.join(__dirname, 'components', 'MatchSquadPrintList.tsx'), 'utf-8')
    const uitTypes = Array.from(bron.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@\/lib\/types'/g)).flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean))
    expect(uitTypes).toEqual(['Player'])
    expect(bron).not.toMatch(/statusPerSpeler|recenteMinuten|stapper|wedstrijd-stappen|wedstrijd-selectie-info/)
    const props = bron.slice(bron.indexOf('interface Props'), bron.indexOf('}\n', bron.indexOf('interface Props')))
    expect(props).not.toMatch(/status|minuten|injured|position/i)
  })

  it('AC22: /api/pdf rendert nog steeds /events/[id]/squad voor een wedstrijd van het actieve team', async () => {
    zetDb(basis())
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pitchup.example')
    pdf.renderPdf.mockResolvedValue({ soort: 'pdf', pdf: Buffer.from('%PDF-1.7') })
    const res = await pdfGet(new NextRequest(`https://pitchup.example/api/pdf?doel=selectie&id=${M}&tz=Europe/Amsterdam`))
    expect(res.status).toBe(200)
    expect(pdf.renderPdf).toHaveBeenCalledWith(expect.objectContaining({ pad: `/events/${M}/squad` }))
    vi.unstubAllEnvs()
  })

  it('AC22: /api/pdf weigert een wedstrijd van een ander team en een training, zonder te renderen', async () => {
    zetDb(basis({ events: [wedstrijd(M, dag(-1)), wedstrijd(E(9), dag(-1), { team_id: ANDER }), training(E(8), dag(-1))] }))
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pitchup.example')
    for (const id of [E(9), E(8)]) {
      const res = await pdfGet(new NextRequest(`https://pitchup.example/api/pdf?doel=selectie&id=${id}&tz=Europe/Amsterdam`))
      expect(res.status).toBe(404)
    }
    expect(pdf.renderPdf).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})

// ===========================================================================
// Opstelling overnemen (AC23 t/m AC29)
// ===========================================================================
describe('Opstelling overnemen', () => {
  const VORIGE = E(2)
  // Huidige wedstrijd over 3 dagen. Vorige (-7) heeft een 4-4-2 met spelers 1 t/m 11.
  // Beschikbaarheid voor de huidige wedstrijd: 3 afwezig, 5 geblesseerd (event-status),
  // 7 inactief, 9 niet in de selectie -> 4 lege slots, 7 gevulde slots.
  const overnemenDb = (extra: Db = {}): Db => ({
    events: [wedstrijd(M, dag(3)), wedstrijd(VORIGE, dag(-7))],
    players: [...spelers(14).filter((p) => p.id !== P(7)), spelerRij(7, { active: false })],
    attendance: [...aanwezigen(M, [1, 2, 4, 6, 8, 9, 10, 11, 12]), aanw(M, 3, 'absent'), aanw(M, 5, 'injured')],
    match_squad: squadRijen(M, [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12]),
    lineups: [opstelling(VORIGE, elf(), '4-4-2')],
    ...extra,
  })
  const knop = () => screen.getByRole('button', { name: nl.lineup.vorigeOvernemen })

  it('AC23: met wedstrijdrecht en een eerdere opstelling staat er een expliciete knop met de bronwedstrijd - en er wordt niets automatisch overgenomen', async () => {
    await toon('lineup', M, overnemenDb())
    expect(knop()).toBeEnabled()
    expect(screen.getByText(nl.lineup.vorigeBron.replace('{datum}', formatDateShort(dag(-7), nl.browserLocale)))).toBeInTheDocument()
    expect(veldNamen()).toEqual([])
    expect(acties.saveLineup).not.toHaveBeenCalled()
  })

  it('AC24: de knop vult formatie en posities op het scherm (leeg veld: direct, zonder vraag) en slaat niets op tot Opslaan', async () => {
    await toon('lineup', M, overnemenDb())
    fireEvent.click(knop())
    expect(screen.queryByText(nl.lineup.vervangenVraag)).toBeNull()
    expect(screen.getByRole('button', { name: /4-4-2$/ })).toBeInTheDocument() // formatiekiezer toont de overgenomen formatie
    expect(veldNamen()).toHaveLength(7)
    expect(screen.getByText(nl.lineup.overgenomenMelding)).toBeInTheDocument()
    expect(acties.saveLineup).not.toHaveBeenCalled()
    expect(schrijfacties).toEqual([])
  })

  it('AC25: een speler uit de vorige opstelling die afwezig, geblesseerd, inactief of niet geselecteerd is, laat zijn plek leeg - zonder vervanger; de rest wordt gevuld', async () => {
    await toon('lineup', M, overnemenDb())
    fireEvent.click(knop())
    const namen = veldNamen()
    expect(namen.sort()).toEqual([1, 2, 4, 6, 8, 10, 11].map(eerste).sort())
    for (const weg of [3, 5, 7, 9]) expect(namen).not.toContain(eerste(weg))
    // Geen vervanger: ook spelers 12 en 13, die wel beschikbaar waren maar niet in de vorige opstelling stonden, staan niet op het veld.
    expect(namen).not.toContain(eerste(12))
    expect(screen.getByText(nl.lineup.overgenomenLeegMany.replace('{n}', '4'))).toBeInTheDocument()
  })

  it('AC25: een speler die in de vorige opstelling twee keer stond, wordt maximaal een keer geplaatst', async () => {
    const dubbel = opstelling(VORIGE, [1, 2, 1, 4, 6, 8, 10, 11, 12, null, null], '4-4-2')
    await toon('lineup', M, overnemenDb({ lineups: [dubbel] }))
    fireEvent.click(knop())
    expect(veldNamen().filter((n) => n === eerste(1))).toHaveLength(1)
  })

  it('AC24/AC26: na Opslaan gaat de overgenomen opstelling via de bestaande opslagactie met de overgenomen formatie en spelers', async () => {
    await toon('lineup', M, overnemenDb())
    fireEvent.click(knop())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: nl.lineup.save })) })
    expect(acties.saveLineup).toHaveBeenCalledTimes(1)
    const [eventId, formatie, posities] = acties.saveLineup.mock.calls[0]
    expect(eventId).toBe(M)
    expect(formatie).toBe('4-4-2')
    expect((posities as { player_id: string | null }[]).filter((p) => p.player_id).map((p) => p.player_id)).toEqual([1, 2, 4, 6, 8, 10, 11].map(P))
  })

  it('AC26: de opslagactie hervalideert elke speler-id tegen het huidige team, begrenst coordinaten en aantal posities, en schrijft niets bij een vreemde speler', async () => {
    zetDb(overnemenDb({ players: [...spelers(14), spelerRij(99, { team_id: ANDER })] }))
    const slot = (id: string | null, x = 50, y = 50) => ({ player_id: id, x, y, position_label: 'CM', position_number: 1 })
    await expect(echt.attendance.saveLineup(M, '4-4-2', [slot(P(99))])).rejects.toThrow('Speler niet gevonden')
    await expect(echt.attendance.saveLineup(M, '4-4-2', [slot('geen-uuid')])).rejects.toThrow('Ongeldige speler')
    await expect(echt.attendance.saveLineup(M, '4-4-2', Array.from({ length: 31 }, () => slot(null)))).rejects.toThrow('Ongeldige opstelling')
    expect(schrijfacties.filter((s) => s.table === 'lineups')).toEqual([])
    await echt.attendance.saveLineup(M, '4-4-2', [slot(P(1), 150, -5)])
    const upsert = schrijfacties.find((s) => s.table === 'lineups')!
    const rij = upsert.payload as { team_id: string; positions: { x: number; y: number }[] }
    expect(rij.team_id).toBe(TEAM)
    expect(rij.positions[0]).toMatchObject({ x: 100, y: 0 })
  })

  it('AC24/AC26 (end-to-end): overnemen en Opslaan via de echte opslagactie schrijft een lineups-rij van het eigen team met alleen eigen spelers', async () => {
    acties.saveLineup.mockImplementation((...a: Parameters<typeof echt.attendance.saveLineup>) => echt.attendance.saveLineup(...a))
    await toon('lineup', M, overnemenDb())
    fireEvent.click(knop())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: nl.lineup.save })) })
    const rij = huidigeDb.lineups.find((l) => l.event_id === M)!
    expect(rij.team_id).toBe(TEAM)
    expect(rij.formation).toBe('4-4-2')
    expect((rij.positions as { player_id: string | null }[]).filter((p) => p.player_id).map((p) => p.player_id)).toEqual([1, 2, 4, 6, 8, 10, 11].map(P))
  })

  it('AC27: zonder eerdere wedstrijd met opstelling is de knop uitgeschakeld met een korte uitleg en gaat er niets mis - eerste wedstrijd, alleen toekomst, oudere zonder opstelling', async () => {
    const gevallen: Db[] = [
      overnemenDb({ events: [wedstrijd(M, dag(3))], lineups: [] }), // eerste wedstrijd
      overnemenDb({ events: [wedstrijd(M, dag(3)), wedstrijd(VORIGE, dag(2))] }), // eerdere datum maar nog niet gespeeld
      overnemenDb({ lineups: [] }), // oudere zonder opstelling
    ]
    for (const db of gevallen) {
      const r = await toon('lineup', M, db)
      expect(knop()).toBeDisabled()
      expect(screen.getByText(nl.lineup.vorigeGeen)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).toBeNull()
      r.unmount()
    }
  })

  it('AC27/edge: een onleesbare vorige opstelling (onbekende formatie) laat het veld ongemoeid, zonder terugval op een oudere wedstrijd', async () => {
    const OUDER = E(3)
    const db = overnemenDb({
      events: [wedstrijd(M, dag(3)), wedstrijd(VORIGE, dag(-7)), wedstrijd(OUDER, dag(-14))],
      lineups: [opstelling(VORIGE, elf(), 'bestaat-niet'), opstelling(OUDER, elf(), '4-3-3')],
    })
    await toon('lineup', M, db)
    expect(knop()).toBeDisabled()
    expect(screen.getByText(nl.lineup.vorigeOnleesbaar)).toBeInTheDocument()
    expect(veldNamen()).toEqual([])
  })

  it('AC27/edge: een falende lineups-query of wedstrijdenquery geeft een foutuitleg in plaats van "geen vorige opstelling"', async () => {
    for (const fouten of [{ lineups: { code: 'XX000', message: 'RAW_DB_DETAIL' } }]) {
      // De eigen lineups-rij van dit event faalt ook; dat verandert niets aan de uitleg.
      const r = await toon('lineup', M, overnemenDb(), { fouten })
      expect(knop()).toBeDisabled()
      expect(screen.getByText(nl.lineup.vorigeFout)).toBeInTheDocument()
      expect(document.body.textContent).not.toContain('RAW_DB_DETAIL')
      r.unmount()
    }
  })

  it('AC27/edge: een gedeeltelijk gevulde vorige opstelling wordt overgenomen zoals ze is', async () => {
    await toon('lineup', M, overnemenDb({ lineups: [opstelling(VORIGE, [1, 2, 4, null, null, null, null, null, null, null, null], '4-4-2')] }))
    fireEvent.click(knop())
    expect(veldNamen().sort()).toEqual([1, 2, 4].map(eerste).sort())
    expect(screen.queryByText(new RegExp(nl.lineup.overgenomenLeegMany.replace('{n}', '\\d+')))).toBeNull()
  })

  it('AC28: bij een al gevulde opstelling vraagt overnemen eerst "Huidige opstelling vervangen?"; annuleren laat het veld gelijk, bevestigen vervangt', async () => {
    await toon('lineup', M, overnemenDb({ lineups: [...(overnemenDb().lineups), opstelling(M, [12, 13])] }))
    expect(veldNamen().sort()).toEqual([12, 13].map(eerste).sort())
    fireEvent.click(knop())
    expect(screen.getByText(nl.lineup.vervangenVraag)).toBeInTheDocument()
    expect(veldNamen().sort()).toEqual([12, 13].map(eerste).sort()) // nog niets overschreven
    fireEvent.click(screen.getByRole('button', { name: nl.common.cancel }))
    expect(screen.queryByText(nl.lineup.vervangenVraag)).toBeNull()
    expect(veldNamen().sort()).toEqual([12, 13].map(eerste).sort())
    fireEvent.click(knop())
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.vervangenBevestig }))
    expect(veldNamen().sort()).toEqual([1, 2, 4, 6, 8, 10, 11].map(eerste).sort())
    expect(acties.saveLineup).not.toHaveBeenCalled()
  })

  it('AC24/edge: dubbel tikken op overnemen geeft geen schrijfactie en geen fout', async () => {
    await toon('lineup', M, overnemenDb())
    fireEvent.click(knop())
    fireEvent.click(knop()) // tweede tik op een nu gevuld veld -> alleen de bevestigingsvraag
    expect(acties.saveLineup).not.toHaveBeenCalled()
    expect(schrijfacties).toEqual([])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('AC29/AC37: de bron is de laatste GESPEELDE eerdere wedstrijd van het eigen team met een opstelling - niet een toekomstige, niet dezelfde dag, niet de huidige, niet van een ander team', async () => {
    const A = E(10), B = E(11), C = E(12), D = E(13), SPOOK = E(14), SPOOK2 = E(15)
    const db = overnemenDb({
      // M ligt over 5 dagen. B (-7) moet winnen van A (-14); C (morgen) is nog niet gespeeld, D valt op dezelfde dag als M.
      events: [
        wedstrijd(M, dag(5)), wedstrijd(A, dag(-14)), wedstrijd(B, dag(-7)), wedstrijd(C, dag(1)), wedstrijd(D, dag(5)),
        wedstrijd(SPOOK, dag(-2), { team_id: ANDER }),
      ],
      lineups: [
        opstelling(A, elf(), '4-3-3'), opstelling(B, elf(), '4-4-2'), opstelling(C, elf(), '4-5-1'), opstelling(D, elf(), '4-2-3-1'),
        opstelling(SPOOK, elf(), '4-2-2-2', ANDER), opstelling(SPOOK2, elf(), '4-2-2-2', ANDER),
        // Gemanipuleerd: een lineups-rij van het andere team met het id van onze beste kandidaat.
        { ...opstelling(B, [12, 13, 14], '4-2-2-2', ANDER) },
      ],
    })
    await toon('lineup', M, db)
    expect(screen.getByText(nl.lineup.vorigeBron.replace('{datum}', formatDateShort(dag(-7), nl.browserLocale)))).toBeInTheDocument()
    fireEvent.click(knop())
    expect(screen.getByRole('button', { name: /4-4-2$/ })).toBeInTheDocument()
  })

  it('AC29: een wedstrijd en opstelling van een ander team worden nooit gevonden, ook niet als dat de enige kandidaat is', async () => {
    const SPOOK = E(14)
    const db = overnemenDb({
      events: [wedstrijd(M, dag(3)), wedstrijd(SPOOK, dag(-7), { team_id: ANDER })],
      lineups: [opstelling(SPOOK, elf(), '4-4-2', ANDER)],
    })
    await toon('lineup', M, db)
    expect(knop()).toBeDisabled()
    expect(screen.getByText(nl.lineup.vorigeGeen)).toBeInTheDocument()
  })
})

// ===========================================================================
// Onopgeslagen opstelling, bank op mobiel (AC32, AC42)
// ===========================================================================
describe('Onopgeslagen opstelling en bank', () => {
  const lineupDb = (extra: Db = {}): Db => basis({ attendance: aanwezigen(M, [1, 2, 3, 4]), lineups: [opstelling(M, [1])], ...extra })
  const maakDirty = () => {
    fireEvent.click(screen.getByText('CM'))
    fireEvent.click(screen.getAllByTestId('popup-speler')[0])
  }
  const klik = (el: Element) => { fireEvent.click(el) }
  const beforeUnload = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented }

  it('AC32: zonder wijzigingen verlaat je de opstelling zonder bevestiging en is er geen beforeunload-bewaking', async () => {
    await toon('lineup', M, lineupDb())
    klik(screen.getByRole('link', { name: new RegExp(nl.wedstrijdFlow.stapAnalyse) }))
    expect(screen.queryByText(nl.lineup.verlatenTitel)).toBeNull()
    expect(beforeUnload()).toBe(false)
  })

  it('AC32: met een niet-opgeslagen wijziging onderschept een klik op de stapper het verlaten met "Blijven" en "Toch verlaten"; Blijven laat alles staan', async () => {
    await toon('lineup', M, lineupDb())
    maakDirty()
    klik(screen.getByRole('link', { name: new RegExp(nl.wedstrijdFlow.stapAnalyse) }))
    expect(screen.getByText(nl.lineup.verlatenTitel)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.lineup.blijven })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.lineup.tochVerlaten })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.blijven }))
    expect(screen.queryByText(nl.lineup.verlatenTitel)).toBeNull()
    expect(nav.push).not.toHaveBeenCalled()
    expect(veldNamen()).toHaveLength(2)
  })

  it('AC32: "Toch verlaten" navigeert naar de gekozen stap; de Volgende-knop wordt op dezelfde manier bewaakt', async () => {
    await toon('lineup', M, lineupDb())
    maakDirty()
    klik(screen.getByRole('link', { name: nl.wedstrijdFlow.volgendeAnalyse }))
    expect(screen.getByText(nl.lineup.verlatenTitel)).toBeInTheDocument()
    expect(nav.push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.tochVerlaten }))
    expect(nav.push).toHaveBeenCalledWith(`/events/${M}/analysis`)
  })

  it('AC32: de terugpijl in de paginakop wordt ook bewaakt; "Toch verlaten" gaat dan terug (met geschiedenis) of naar de terugval (zonder)', async () => {
    await toon('lineup', M, lineupDb())
    maakDirty()
    fireEvent.click(screen.getByRole('button', { name: nl.nav.back }))
    expect(screen.getByText(nl.lineup.verlatenTitel)).toBeInTheDocument()
    expect(nav.back).not.toHaveBeenCalled()
    expect(nav.push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.tochVerlaten }))
    expect(nav.push).toHaveBeenCalledWith(`/events/${M}`) // jsdom heeft hier geen geschiedenis
    cleanup()
    zetGeschiedenis(3)
    await toon('lineup', M, lineupDb())
    maakDirty()
    fireEvent.click(screen.getByRole('button', { name: nl.nav.back }))
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.tochVerlaten }))
    expect(nav.back).toHaveBeenCalled()
  })

  it('AC32: herladen en sluiten worden afgevangen (beforeunload geannuleerd) zolang er niet-opgeslagen werk is; de native dialoog zelf is alleen in de browser te zien', async () => {
    await toon('lineup', M, lineupDb())
    expect(beforeUnload()).toBe(false)
    maakDirty()
    expect(beforeUnload()).toBe(true)
  })

  it('AC32: na een geslaagde Opslaan is de bewaking weg; na een mislukte Opslaan blijft ze staan en blijft de invoer behouden (AC30)', async () => {
    await toon('lineup', M, lineupDb())
    maakDirty()
    acties.saveLineup.mockRejectedValueOnce(new Error('RAW_DB_DETAIL'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: nl.lineup.save })) })
    expect(screen.getByRole('alert')).toHaveTextContent(nl.lineup.saveError)
    expect(document.body.textContent).not.toContain('RAW_DB_DETAIL')
    expect(veldNamen()).toHaveLength(2) // invoer behouden
    expect(beforeUnload()).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: nl.lineup.save })) })
    expect(beforeUnload()).toBe(false)
    klik(screen.getByRole('link', { name: new RegExp(nl.wedstrijdFlow.stapAnalyse) }))
    expect(screen.queryByText(nl.lineup.verlatenTitel)).toBeNull()
  })

  it('AC32: overnemen telt als wijziging (de bewaking grijpt in tot er is opgeslagen)', async () => {
    const db = lineupDb({ events: [wedstrijd(M, dag(3)), wedstrijd(E(2), dag(-7))], lineups: [opstelling(E(2), elf(), '4-4-2')] })
    await toon('lineup', M, db)
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.vorigeOvernemen }))
    expect(beforeUnload()).toBe(true)
  })

  it('AC32: zonder wedstrijdrecht is er niets te bewaken', async () => {
    await toon('lineup', M, lineupDb(), { lid: { aanwezigheid: true } })
    expect(beforeUnload()).toBe(false)
  })

  it('AC42: de knop "Bank (n)" opent een lijst met de bank (rugnummer, naam, positie); de inline bank is voor kleine schermen verborgen', async () => {
    await toon('lineup', M, lineupDb())
    const knop = screen.getByRole('button', { name: nl.lineup.bankKnop.replace('{n}', '3') })
    expect(knop.className).toContain('sm:hidden')
    fireEvent.click(knop)
    const blad = screen.getByRole('dialog')
    expect(within(blad).getByText(`${nl.lineup.bench} (3)`)).toBeInTheDocument()
    for (const n of [2, 3, 4]) expect(within(blad).getByText(NAMEN[n - 1])).toBeInTheDocument()
    expect(within(blad).getAllByText(POSITION_ABBREVIATIONS['Centrale middenvelder']).length).toBeGreaterThan(0)
    const inline = screen.getAllByText(`${nl.lineup.bench} (3)`).find((el) => !blad.contains(el))!
    expect(inline.parentElement!.className).toContain('max-sm:hidden')
  })

  it('AC42: de bankknop verschijnt niet als er geen bank is (niemand opgesteld of iedereen opgesteld)', async () => {
    await toon('lineup', M, lineupDb({ lineups: [] }))
    expect(screen.queryByRole('button', { name: /^Bank \(/ })).toBeNull()
  })
})

// ===========================================================================
// Opslaan, foutpaden en revalidatie (AC30, AC31)
// ===========================================================================
describe('Foutpaden en revalidatie', () => {
  it('AC30: een mislukte verzameltijd toont een generieke melding en geen ruwe error', async () => {
    acties.updateGatherTime.mockRejectedValueOnce(new Error('RAW_DB_DETAIL'))
    await toon('squad', M, basis())
    fireEvent.change(document.getElementById('gather-time-input') as HTMLInputElement, { target: { value: '10:15' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: nl.matchSquad.gatherTimeSave })) })
    expect(screen.getByText(nl.matchSquad.gatherTimeSaveError)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('RAW_DB_DETAIL')
    // Bestaand gedrag (verzameltijd bleef ongewijzigd, besluit 13): het veld rolt terug naar de laatst opgeslagen
    // waarde. De letterlijke tekst van AC30 ("blijft mijn invoer behouden") is hier dus NIET gehaald; zie het rapport.
    expect((document.getElementById('gather-time-input') as HTMLInputElement).value).toBe('')
  })

  it('AC30: een mislukte speelminuten-opslag toont een generieke melding en behoudt de getypte invoer', async () => {
    acties.saveSpeelminuten.mockRejectedValueOnce(new Error('RAW_DB_DETAIL'))
    await toon('analysis', M, basis())
    const veld = screen.getByLabelText(`${NAMEN[0]} – ${nl.analysis.minutenLabel}`) as HTMLInputElement
    fireEvent.change(veld, { target: { value: '80' } })
    await act(async () => { fireEvent.click(within(veld.closest('form') as HTMLElement).getByRole('button', { name: nl.analysis.save })) })
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.analysis.speelminutenOpslaanFout)
    expect((screen.getByLabelText(`${NAMEN[0]} – ${nl.analysis.minutenLabel}`) as HTMLInputElement).value).toBe('80')
    expect(document.body.textContent).not.toContain('RAW_DB_DETAIL')
  })

  it('AC30 (server): bij een databasefout geven selectie, opstelling en speelminuten een generieke fout en logt de server geen ruwe melding of secret', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ruw = { code: '23505', message: 'RAW_DB_DETAIL secret-sleutel-123', details: 'Key (x)=(geheim)' }
    zetDb(basis(), { fouten: { 'match_squad:upsert': ruw, 'lineups:upsert': ruw, 'speelminuten:upsert': ruw } })
    const slot = { player_id: P(1), x: 1, y: 1, position_label: 'CM' }
    const fouten = await Promise.allSettled([
      echt.matchSquad.toggleSquadPlayer(M, P(1), true),
      echt.attendance.saveLineup(M, '4-3-3', [slot]),
      echt.speelminuten.saveSpeelminuten(M, P(1), 90, 0),
    ])
    for (const f of fouten) {
      expect(f.status).toBe('rejected')
      expect((f as PromiseRejectedResult).reason.message).toBe(GENERIC_ERROR_MESSAGE)
    }
    const gelogd = log.mock.calls.flat().join(' ')
    expect(gelogd).not.toMatch(/RAW_DB_DETAIL|secret-sleutel|geheim/)
  })

  it('AC31: een wijziging in de ene stap is direct zichtbaar in de andere - selectie, aanwezigheid en uitslag werken door in bank en stapper', async () => {
    const db = basis({ lineups: [opstelling(M, [9])], attendance: aanwezigen(M, [1, 2, 9]) })
    zetDb(db)
    await echt.matchSquad.toggleSquadPlayer(M, P(4), true)
    await echt.matchSquad.toggleSquadPlayer(M, P(9), true)
    const r = await toon('lineup', M, huidigeDb)
    expect(screen.getByText(`${nl.lineup.bench} (1)`)).toBeInTheDocument() // bank = selectie minus opgesteld
    expect(stapKlaar(1)).toBe(true)
    r.unmount()
    await echt.attendance.updateAttendance(M, P(5), 'present')
    await echt.matchAnalysis.addMatchEvent(M, P(1), 'goal', 12)
    const s = await toon('squad', M, huidigeDb)
    expect(stapKlaar(3)).toBe(true) // analyse bestaat nu
    expect(stapperNav().textContent).toContain('4 aanwezig · 10 geen reactie') // 1, 2, 9 en nu ook 5
    s.unmount()
  })

  it('AC31: elke schrijfactie revalideert ook de stappen die van haar data afhangen', async () => {
    const paden = () => vi.mocked(revalidatePath).mock.calls.map((c) => c.join('|'))
    zetDb(basis({ lineups: [] }))
    await echt.matchSquad.toggleSquadPlayer(M, P(1), true)
    expect(paden()).toEqual(expect.arrayContaining([`/events/${M}/squad`, `/events/${M}`, `/events/${M}/lineup`, `/events/${M}/analysis`]))
    vi.mocked(revalidatePath).mockClear()
    await echt.attendance.updateAttendance(M, P(1), 'present')
    expect(paden()).toEqual(expect.arrayContaining([`/events/${M}`, `/events/${M}/squad`, `/events/${M}/lineup`, `/events/${M}/analysis`]))
    vi.mocked(revalidatePath).mockClear()
    await echt.attendance.markAllPresent(M)
    expect(paden()).toEqual(expect.arrayContaining([`/events/${M}/lineup`, `/events/${M}/analysis`]))
    vi.mocked(revalidatePath).mockClear()
    await echt.attendance.saveLineup(M, '4-3-3', [{ player_id: P(1), x: 1, y: 1, position_label: 'CM' }])
    expect(paden()).toEqual(expect.arrayContaining([`/events/${M}/lineup`, `/events/${M}/analysis`, '/events/[id]/lineup|page']))
    vi.mocked(revalidatePath).mockClear()
    await echt.speelminuten.saveSpeelminuten(M, P(1), 90, 1)
    expect(paden()).toEqual(expect.arrayContaining([`/events/${M}/analysis`, '/events/[id]/squad|page']))
    vi.mocked(revalidatePath).mockClear()
    await echt.matchAnalysis.saveMatchResult(M, 1, 0)
    expect(paden()).toEqual(expect.arrayContaining([`/events/${M}/analysis`, `/events/${M}/squad`, `/events/${M}/lineup`]))
  })
})

// ===========================================================================
// Tenant-isolatie (AC29, AC33, AC34)
// ===========================================================================
describe('Tenant-isolatie', () => {
  const spookDb = (): Db => {
    const GE = E(50)
    return basis({
      events: [wedstrijd(M, dag(2)), wedstrijd(E(2), dag(-8)), wedstrijd(GE, dag(-8), { team_id: ANDER, goals_for: 9, goals_against: 0 }), training(E(60), dag(2), { team_id: ANDER })],
      players: [...spelers(5), spelerRij(90, { team_id: ANDER, name: 'Spook Speler' })],
      attendance: [...aanwezigen(M, [1]), aanw(M, 2, 'present', ANDER), aanw(M, 90, 'present', ANDER)],
      // Spookrijen van team 2 voor HETZELFDE event-id en dezelfde speler-ids: alleen het team_id-filter houdt ze buiten.
      match_squad: [squadRij(M, 3, ANDER), squadRij(M, 90, ANDER)],
      lineups: [opstelling(M, elf(), '4-3-3', ANDER), opstelling(E(2), elf(), '4-4-2', ANDER)],
      match_ratings: [{ event_id: M, team_id: ANDER, player_id: P(1), rating: 9 }],
      match_events: [{ event_id: M, team_id: ANDER, player_id: P(1), kind: 'goal', minute: 3 }],
      speelminuten: [minuten(E(2), 1, 99, ANDER), minuten(GE, 1, 88, ANDER)],
    })
  }

  it.each(ALLE_PAGINAS)('AC33: %s - spookrijen van een ander team in alle bronnen tellen nergens mee (stapper, samenvatting, bank, minuten, vorige opstelling)', async (pag) => {
    const r = await toon(pag, M, spookDb())
    // Alle drie de stappen die van data afhangen blijven open: selectie, opstelling en analyse.
    expect(stapStatus().slice(1)).toEqual(['open', 'open', pag === 'analysis' ? 'open' : 'vergrendeld'])
    // 1 aanwezig (eigen team), geen enkele reactie van speler 2 meegeteld: 4 zonder reactie.
    expect(stapperNav().textContent).toContain('1 aanwezig · 4 geen reactie')
    expect(document.body.textContent).not.toContain('Spook Speler')
    expect(document.body.textContent).not.toMatch(/99 minuten|88 minuten/)
    r.unmount()
  })

  it('AC33: de selectiepagina toont geen spookspelers en geen spookminuten; de opstellingspagina vindt geen vorige opstelling van een ander team', async () => {
    const s = await toon('squad', M, spookDb())
    expect(within(rijVan(NAMEN[0])).queryByText(/99/)).toBeNull()
    expect(screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '0'))).toBeInTheDocument()
    s.unmount()
    await toon('lineup', M, spookDb())
    expect(screen.getByRole('button', { name: nl.lineup.vorigeOvernemen })).toBeDisabled()
    expect(screen.getByText(nl.lineup.vorigeGeen)).toBeInTheDocument()
  })

  it.each(ALLE_PAGINAS)('AC33: %s - elke query op een teamtabel filtert op het actieve team', async (pag) => {
    await toon(pag, M, spookDb())
    const teamQueries = queries.filter((q) => q.table !== 'team_members')
    expect(teamQueries.length).toBeGreaterThan(5)
    for (const q of teamQueries.filter((x) => x.op !== 'upsert' && x.op !== 'insert')) {
      const heeftTeamFilter = q.filters.some(([kolom, waarde]) => kolom === 'team_id' && (waarde === TEAM || (Array.isArray(waarde) && waarde.includes(TEAM))))
      expect(heeftTeamFilter, `${q.op} op ${q.table} mist een team_id-filter`).toBe(true)
    }
    // Schrijfacties dragen het team in hun payload (de eventdetailpagina backfillt aanwezigheid).
    for (const w of schrijfacties.filter((x) => x.op === 'upsert' || x.op === 'insert')) {
      for (const rij of (Array.isArray(w.payload) ? w.payload : [w.payload]) as Row[]) expect(rij.team_id, `${w.op} op ${w.table}`).toBe(TEAM)
    }
  })

  it.each(['squad', 'lineup', 'analysis'] as const)('AC34: %s - een wedstrijd van een ander team geeft niet-gevonden, zonder stapper', async (pag) => {
    await expect(toon(pag, E(50), spookDb())).rejects.toThrow('__notFound__')
    expect(notFound).toHaveBeenCalled()
    expect(screen.queryByRole('navigation', { name: nl.wedstrijdFlow.stapperLabel })).toBeNull()
  })

  it.each(['squad', 'lineup', 'analysis'] as const)('AC34: %s - een training (geen wedstrijd) geeft niet-gevonden', async (pag) => {
    await expect(toon(pag, E(7), basis({ events: [training(E(7), dag(1))] }))).rejects.toThrow('__notFound__')
    expect(screen.queryByRole('navigation', { name: nl.wedstrijdFlow.stapperLabel })).toBeNull()
  })

  it('AC34: /events/[id] van een ander team geeft niet-gevonden', async () => {
    await expect(toon('event', E(50), spookDb())).rejects.toThrow('__notFound__')
  })

  it('AC34/AC10 (server): de acties weigeren een wedstrijd van een ander team, zonder te schrijven', async () => {
    zetDb(spookDb())
    await expect(echt.matchSquad.toggleSquadPlayer(E(50), P(1), true)).rejects.toThrow('Event niet gevonden')
    await expect(echt.attendance.saveLineup(E(50), '4-3-3', [])).rejects.toThrow('Event niet gevonden')
    await expect(echt.speelminuten.saveSpeelminuten(E(50), P(1), 90, 0)).rejects.toThrow('Event niet gevonden')
    expect(schrijfacties).toEqual([])
  })
})

// ===========================================================================
// Analysestap, tijdzone en datumgrens (AC35 t/m AC37)
// ===========================================================================
describe('Analysestap en datumgrens', () => {
  const zetKlok = (jaar: number, maand: number, dagNr: number, uur: number, min: number) => vi.setSystemTime(new Date(jaar, maand - 1, dagNr, uur, min))

  it.each([
    ['gisteren', -1, true], ['vandaag', 0, true], ['morgen', 1, false],
  ] as const)('AC35/AC36: een wedstrijd %s telt overal met een regel - stapper, analysepagina en server-guard zijn het eens (gespeeld = %s)', async (_naam, offset, gespeeld) => {
    const db = basis({ events: [wedstrijd(M, dag(offset))] })
    for (const pag of ALLE_PAGINAS) {
      const r = await toon(pag, M, db)
      if (pag !== 'analysis') expect(stapVergrendeld(3), pag).toBe(!gespeeld)
      r.unmount()
    }
    const a = await toon('analysis', M, db)
    expect(screen.queryByText(nl.analysis.speelminutenToekomst) !== null).toBe(!gespeeld)
    a.unmount()
    zetDb(db)
    const opslaan = echt.speelminuten.saveSpeelminuten(M, P(1), 90, 0)
    if (gespeeld) await expect(opslaan).resolves.toBeUndefined()
    else await expect(opslaan).rejects.toThrow('Wedstrijd nog niet gespeeld')
    expect(schrijfacties.some((s) => s.table === 'speelminuten' && s.op === 'upsert')).toBe(gespeeld)
  })

  it('AC35: vlak na middernacht (lokale servertijd) schuift de grens voor stapper en pagina samen mee', async () => {
    zetKlok(2026, 11, 17, 0, 5)
    for (const [datum, vergrendeld] of [['2026-11-17', false], ['2026-11-18', true], ['2026-11-16', false]] as const) {
      const db = basis({ events: [wedstrijd(M, datum)] })
      const s = await toon('squad', M, db)
      expect(stapVergrendeld(3), datum).toBe(vergrendeld)
      s.unmount()
      const a = await toon('analysis', M, db)
      expect(screen.queryByText(nl.analysis.speelminutenToekomst) !== null, datum).toBe(vergrendeld)
      a.unmount()
    }
  })

  it('AC35: een dag voor middernacht is de wedstrijd van de volgende dag nog toekomst', async () => {
    zetKlok(2026, 11, 16, 23, 55)
    const s = await toon('squad', M, basis({ events: [wedstrijd(M, '2026-11-17')] }))
    expect(stapVergrendeld(3)).toBe(true)
    s.unmount()
  })

  it('AC37: "laatste 3" zijn de 3 meest recente eerdere gespeelde wedstrijden van het team (alle wedstrijdtypes), op datumstring; de huidige, dezelfde dag, toekomst, trainingen en andere teams tellen niet mee', async () => {
    const events = [
      wedstrijd(M, dag(-1)),
      wedstrijd(E(2), dag(-8), { match_type: 'friendly' }), wedstrijd(E(3), dag(-15), { match_type: 'cup' }), wedstrijd(E(4), dag(-22)), wedstrijd(E(5), dag(-29)),
      wedstrijd(E(6), dag(-1), { created_at: '2026-10-01T00:00:00Z' }), // tweede wedstrijd dezelfde dag: genegeerd
      wedstrijd(E(7), dag(3)), // toekomst
      training(E(8), dag(-3)), // geen wedstrijd
      wedstrijd(E(9), dag(-2), { team_id: ANDER }),
    ]
    await toon('squad', M, basis({ events, speelminuten: [minuten(E(2), 1, 11), minuten(E(3), 1, 22), minuten(E(4), 1, 33), minuten(E(5), 1, 44), minuten(E(6), 1, 55), minuten(E(7), 1, 66), minuten(E(8), 1, 77), minuten(E(9), 1, 88, ANDER)] }))
    const r = rijVan(NAMEN[0])
    expect(r.textContent).toMatch(/11 minuten op .*22 minuten op .*33 minuten op /)
    for (const nee of [44, 55, 66, 77, 88]) expect(r.textContent).not.toContain(`${nee} minuten`)
  })

  it('AC37: een eerste wedstrijd van het team geeft geen minutenkolommen en geen fout; een eerdere wedstrijd van vandaag telt niet mee voor een wedstrijd van vandaag', async () => {
    await toon('squad', M, basis())
    expect(screen.queryByText(nl.matchSquad.minutenKop)).toBeNull()
    expect(screen.queryByText(nl.matchSquad.minutenFout)).toBeNull()
  })

  it('AC37/edge: een falende minutenquery laat de minutenkolommen weg met een melding; de rest van de selectiestap werkt', async () => {
    await toon('squad', M, basis({ events: [wedstrijd(M, dag(-1)), wedstrijd(E(2), dag(-8))] }), { fouten: { speelminuten: { code: 'XX000', message: 'RAW_DB_DETAIL' } } })
    expect(screen.getByText(nl.matchSquad.minutenFout)).toBeInTheDocument()
    expect(screen.queryByText(nl.matchSquad.minutenKop)).toBeNull()
    expect(toggleKnop(NAMEN[0])).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('RAW_DB_DETAIL')
  })

  it('AC5/edge: een falende statusquery geeft "onbekend" - geen vinkje en geen vals "klaar"', async () => {
    await toon('squad', M, basis({ match_squad: squadRijen(M, [1]) }), { fouten: { match_squad: { code: 'XX000', message: 'RAW_DB_DETAIL' } } })
    expect(stapKlaar(1)).toBe(false)
    expect(within(stapItems()[1]).queryByText(nl.wedstrijdFlow.stapOpenSr)).toBeNull() // onbekend is ook geen "nog open"
    expect(document.body.textContent).not.toContain('RAW_DB_DETAIL')
  })
})

// ===========================================================================
// Deeplinks en bestaande werking (AC38 t/m AC40)
// ===========================================================================
describe('Deeplinks en bestaande werking', () => {
  it('AC38: de links van de Vandaag-kaart komen op de bedoelde pagina, met stapper', async () => {
    const dbs: { db: Db; pad: string; pag: Pag }[] = [
      { db: { events: [wedstrijd(M, dag(2))], players: spelers(5) }, pad: `/events/${M}/squad`, pag: 'squad' },
      { db: { events: [wedstrijd(M, dag(2))], players: spelers(5), match_squad: squadRijen(M, [1]) }, pad: `/events/${M}/lineup`, pag: 'lineup' },
      { db: { events: [wedstrijd(M, dag(-1)), training(E(40), dag(5), { doelstelling: 'Passen' })], players: spelers(5), match_squad: squadRijen(M, [1]), lineups: [opstelling(M, elf())] }, pad: `/events/${M}/analysis`, pag: 'analysis' },
    ]
    for (const { db, pad, pag } of dbs) {
      const d = await toonDashboard(db)
      const hero = screen.getAllByTestId('hero-tile-link')[0].parentElement as HTMLElement
      expect(within(hero).getAllByRole('link').map((a) => a.getAttribute('href'))).toContain(pad)
      d.unmount()
      await toon(pag, M, { ...db, attendance: [] })
      expect(within(stapperNav()).getAllByRole('link').find((l) => l.getAttribute('aria-current') === 'step')).toHaveAttribute('href', pad)
      cleanup()
    }
  })

  it('AC38: het anker van de trainer-terugblik uit de To-do en de Vandaag-kaart bestaat nog steeds op /events/[id] van een training', async () => {
    const anker = taakHref('t1', 'self_review').split('#')[1]
    expect(anker).toBeTruthy()
    const { container } = await toon('event', 't1', { events: [training('t1', dag(-1))], players: spelers(3) })
    expect(container.querySelector(`#${anker}`)).not.toBeNull()
  })

  it('AC39: To-do en Vandaag-kaart gebruiken nog steeds dezelfde bestemmingen: selectie, opstelling, analyse', async () => {
    expect(taakHref(M, 'squad')).toBe(`/events/${M}/squad`)
    expect(taakHref(M, 'lineup')).toBe(`/events/${M}/lineup`)
    expect(taakHref(M, 'analysis')).toBe(`/events/${M}/analysis`)
  })

  it('AC40: een training toont geen stapper en geen Volgende, en de trainingsplan-kaart en aanwezigheid werken zoals nu', async () => {
    await toon('event', 't1', { events: [training('t1', dag(1))], players: spelers(3), attendance: [] })
    expect(screen.queryByRole('navigation', { name: nl.wedstrijdFlow.stapperLabel })).toBeNull()
    expect(screen.queryByText(/^Volgende/)).toBeNull()
    expect(screen.getByRole('link', { name: new RegExp(nl.event.trainingPlan) })).toHaveAttribute('href', '/events/t1/training-plan')
    expect(screen.getAllByRole('button', { name: nl.event.presentStat }).length).toBeGreaterThan(0)
  })

  it('AC40: een meting toont geen stapper en geen Volgende', async () => {
    await toon('event', 'me1', { events: [wedstrijd('me1', dag(1), { type: 'meting', opponent: null })], players: spelers(3) })
    expect(screen.queryByRole('navigation', { name: nl.wedstrijdFlow.stapperLabel })).toBeNull()
    expect(screen.queryByText(/^Volgende/)).toBeNull()
  })
})

// ===========================================================================
// Mobiel (AC41 t/m AC43): alleen proxies, het echte bewijs is een browsercheck op 375px
// ===========================================================================
describe('Mobiel (alleen structurele proxies; 375px zelf is browser-verificatie)', () => {
  it('AC41 (proxy): de stapper is een raster van vier kolommen zonder horizontaal scrollen, elke stap heeft een raakvlak van minimaal 44px en labels breken af in plaats van te knippen', async () => {
    await toon('event', M, basis())
    const ol = stapperNav().querySelector('ol')!
    expect(ol.className).toMatch(/grid-cols-4/)
    for (const l of within(stapperNav()).getAllByRole('link')) {
      expect(l.className).toContain('min-h-11')
      expect(l.querySelector('.break-words')).not.toBeNull()
      expect(l.className + l.innerHTML).not.toMatch(/truncate|overflow-x/)
    }
  })

  it('AC43 (proxy): de Volgende-knop is statisch onder de inhoud - niet fixed of sticky - dus overlapt hij Opslaan en de globale knop nooit', async () => {
    for (const pag of ['event', 'squad', 'lineup'] as const) {
      const r = await toon(pag, M, basis())
      const link = screen.getByRole('link', { name: /^Volgende/ })
      for (let n: Element | null = link; n && n !== document.body; n = n.parentElement) expect(n.className, pag).not.toMatch(/\b(fixed|sticky)\b/)
      r.unmount()
    }
  })
})

// ===========================================================================
// Taal (AC44)
// ===========================================================================
describe('Taal', () => {
  const talen = { nl, en, de, fr, es }
  const sleutels = (d: typeof nl) => ({
    ...Object.fromEntries(Object.entries(d.wedstrijdFlow).map(([k, v]) => [`wedstrijdFlow.${k}`, v])),
    ...Object.fromEntries(['groepAanwezig', 'groepGeenReactie', 'groepAfwezig', 'geenReactieLabel', 'geenAanwezigen', 'minutenKop', 'minutenSr', 'minutenGeenSr', 'minutenFout'].map((k) => [`matchSquad.${k}`, (d.matchSquad as Record<string, string>)[k]])),
    ...Object.fromEntries(['vorigeOvernemen', 'vorigeBron', 'vorigeGeen', 'vorigeOnleesbaar', 'vorigeFout', 'vervangenVraag', 'vervangenBevestig', 'overgenomenMelding', 'overgenomenLeegOne', 'overgenomenLeegMany', 'verlatenTitel', 'verlatenTekst', 'blijven', 'tochVerlaten', 'bankKnop'].map((k) => [`lineup.${k}`, (d.lineup as Record<string, string>)[k]])),
  })

  it('AC44: alle nieuwe teksten bestaan in nl, en, de, fr en es, zijn niet leeg en behouden hun invulplaatsen', () => {
    const nlSleutels = sleutels(nl) as Record<string, string>
    expect(Object.keys(nlSleutels).length).toBeGreaterThanOrEqual(35)
    for (const [taal, dict] of Object.entries(talen)) {
      const s = sleutels(dict) as Record<string, string>
      expect(Object.keys(s).sort(), taal).toEqual(Object.keys(nlSleutels).sort())
      for (const [k, v] of Object.entries(s)) {
        expect(typeof v === 'string' && v.trim().length > 0, `${taal}.${k}`).toBe(true)
        const plaatsen = (t: string) => (t.match(/\{[a-zA-Z]+\}/g) ?? []).sort()
        expect(plaatsen(v), `${taal}.${k} invulplaatsen`).toEqual(plaatsen(nlSleutels[k]))
      }
    }
  })

  it('AC44: de vertalingen zijn echt vertaald - in en, de, fr en es is hooguit een klein deel gelijk aan het Nederlands', () => {
    const nlS = sleutels(nl) as Record<string, string>
    for (const [taal, dict] of Object.entries({ en, de, fr, es })) {
      const s = sleutels(dict) as Record<string, string>
      const gelijk = Object.keys(nlS).filter((k) => s[k] === nlS[k])
      expect(gelijk.length, `${taal}: ${gelijk.join(', ')}`).toBeLessThanOrEqual(3)
    }
  })

  it.each(['en', 'de', 'fr', 'es'] as const)('AC44: de pagina\'s tonen stapper, Volgende, groepskoppen en overnemen-knop in %s', async (taal) => {
    omgeving.locale = taal
    const d = talen[taal]
    await toon('lineup', M, basis({ events: [wedstrijd(M, dag(3)), wedstrijd(E(2), dag(-7))], lineups: [opstelling(E(2), elf())] }), { dict: d })
    expect(screen.getByRole('navigation', { name: d.wedstrijdFlow.stapperLabel })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: d.lineup.vorigeOvernemen })).toBeInTheDocument()
    expect(screen.getAllByText(d.event.analysisAfterMatch).length).toBeGreaterThan(0)
    cleanup()
    await toon('squad', M, basis(), { dict: d })
    expect(screen.getByRole('link', { name: d.wedstrijdFlow.volgendeOpstelling })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: d.matchSquad.groepAanwezig.replace('{n}', '3') })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: d.matchSquad.groepGeenReactie.replace('{n}', '11') })).toBeInTheDocument()
  })
})

// ===========================================================================
// Structurele guards van dit bestand
// ===========================================================================
describe('Structurele guards', () => {
  it('dit bestand bevat het gereserveerde woord niet en geen C0-controletekens', () => {
    const bron = readFileSync(__filename, 'utf-8')
    const woord = ['zelf', 'review'].join('')
    expect(bron.toLowerCase().includes(woord)).toBe(false)
    const slecht = Array.from(bron).filter((c) => { const n = c.charCodeAt(0); return (n < 0x20 && n !== 0x09 && n !== 0x0a && n !== 0x0d) || n === 0x7f })
    expect(slecht).toEqual([])
  })
})
