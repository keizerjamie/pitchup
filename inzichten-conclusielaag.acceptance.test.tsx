// Acceptatietests — conclusielaag van de inzichten-metrics, DEEL 1 (KPI-strook
// en signalen). Bron: ff-inzichten-metrics/conclusielaag/02-user-story.md
// (AC1..AC41) en 03-technische-brief-deel1.md (O1..O8; bij verschil wint de
// brief).
//
// Methode: de ECHTE app/inzichten/page.tsx wordt rechtstreeks gerenderd (zelfde
// patroon als inzichten.acceptance.test.tsx), met alleen @/lib/supabase/server,
// next/navigation, next/headers en next/cache gestubd. De RPC's zijn nagebootst:
// elke handler geeft de rijen van het team in `args.p_team_id` terug (en filtert
// datum-bronnen op p_start/p_end). Een verkeerde of ontbrekende p_team_id laat
// daardoor een test vallen. De SQL zelf blijft ongedekt (zoals in de andere
// inzichten-tests): wat de RPC's aan gasten/inactieven uitsluiten is SQL.
//
// ── AC → test-mapping (nummering van de story) ──
//   AC1  → describe('AC1 — zes tegels boven signalen en kaarten')
//   AC2  → describe('AC2 — pariteit met de Thuis/uit-kaart')
//   AC3  → describe('AC3 — vensterlabel per tegel')
//   AC4  → describe('AC4 — label Totale aanwezigheid')  (+ AC29 talen)
//   AC5  → describe('AC5 — nieuwe tegels neutraal')
//   AC6  → describe('AC6 — volgorde en MAX_SIGNALEN')
//   AC7  → describe('AC7 — nieuwe signalen: stijger, daler, positie')
//   AC8  → describe('AC8 — scherm en rapport tonen dezelfde zin')
//   AC9  → describe('AC9 / AC33 — geen extra query')
//   AC15 → describe('AC15 — bronfout per KPI-bron')
//   AC16 → describe('AC16 — bronfout in signalen')
//   AC18 → describe('AC18 — afgekapt (201 wedstrijden)')
//   AC20 → describe('AC20 / AC23 / AC26 / AC27 — minima en grenzen')
//   AC21 → describe('AC21 — null is geen 0')
//   AC22 → describe('AC22 — lege staat')
//   AC24 → describe('AC24 / O5 — scherm en rapport')
//   AC25 → describe('AC25 — gasten en inactieven (positiesignaal)')
//   AC28 → describe('AC28 — vensters en periodekiezer')
//   AC29 → describe('AC29 — vijf talen')
//   AC30 → describe('AC30 — geen oordeel in de kaarten')
//   AC31/32 → describe('AC31 / AC32 — rollen en tenant')
//   AC35/36/37 → describe('AC35–AC37 — tijdzone')
//   AC39 → describe('AC39 — print:hidden en hidden print:block')
//   Faalpad: fout-vóór-afgekapt → describe('KpiStrip — fout gaat voor afgekapt')
//
// Niet in dit bestand (Deel 2 of niet van buitenaf te toetsen): AC10–AC14,
// AC17, AC19 (rapport), AC38 en AC40 (PDF-route, vraagt een browser), AC14
// (visuele lay-out), AC34 (/api/pdf, bestaand in delen-als-pdf), AC41 (volledige
// suite groen: zie rapport).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { es } from '@/messages/es'
import { fr } from '@/messages/fr'
import type { Dict } from '@/messages/nl'

vi.setConfig({ testTimeout: 30000 })

const state = vi.hoisted(() => ({ locale: 'nl', activeTeam: undefined as string | undefined }))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`__redirect__:${to}`)
  },
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) =>
      k === 'locale'
        ? { value: state.locale }
        : k === 'active_team' && state.activeTeam
          ? { value: state.activeTeam }
          : undefined,
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import InzichtenPage from '@/app/inzichten/page'
import KpiStrip from '@/components/inzichten/KpiStrip'
import { splitsThuisUit, type MaandTrend } from '@/lib/inzichten'

type Row = Record<string, unknown>

const TEAM = 'team-1'
const ANDER = 'team-2'
const TODAY = '2026-10-15'
const S = '2026-07-01'
const E = '2026-12-31'

const dicts: Record<string, Dict> = { nl, en, de, es, fr }

// ═══════════════════════════════════════════════════════════════════════
// Harnas: nagebootste Supabase-client
// ═══════════════════════════════════════════════════════════════════════
interface TeamData {
  aanwezigheid: Row[]
  maandOpkomst: Row[]
  teamRating: Row[]
  ratingPerSpeler: Row[]
  aanwezigheidPerSpeler: Row[]
  uitslagen: Row[]
  spelerMomenten: Row[]
  doelpuntMinuten: Row[]
  tegendoelpunten: Row[]
  speelkansen: Row[]
  ratingVorm: Row[]
  trainingOpkomst: Row[]
  blessures: Row[]
  speelminuten: Row[]
  koppelingen: Row[]
  discipline: Row[]
  evaluaties: Row[]
  // tabellen
  events: Row[]
  players: Row[]
  metingen: Row[]
  trainingOefeningen: Row[]
}

const RPC_BRON: Record<string, keyof TeamData> = {
  inzichten_aanwezigheid: 'aanwezigheid',
  inzichten_training_opkomst_per_maand: 'maandOpkomst',
  inzichten_rating_team_per_wedstrijd: 'teamRating',
  inzichten_rating_per_speler: 'ratingPerSpeler',
  inzichten_aanwezigheid_per_speler: 'aanwezigheidPerSpeler',
  inzichten_wedstrijd_uitslagen: 'uitslagen',
  inzichten_speler_momenten: 'spelerMomenten',
  inzichten_doelpunten_per_minuut: 'doelpuntMinuten',
  inzichten_tegendoelpunten: 'tegendoelpunten',
  inzichten_speelkansen: 'speelkansen',
  inzichten_rating_vorm_per_speler: 'ratingVorm',
  inzichten_training_opkomst_per_speler: 'trainingOpkomst',
  inzichten_blessures_per_maand: 'blessures',
  inzichten_speelminuten_per_speler: 'speelminuten',
  inzichten_training_koppelingen: 'koppelingen',
  inzichten_invul_discipline: 'discipline',
  inzichten_training_evaluaties: 'evaluaties',
}
// Bronnen met een `datum`-kolom: de handler filtert op p_start/p_end, zoals de SQL.
const MET_DATUM = new Set<keyof TeamData>(['teamRating', 'uitslagen', 'koppelingen', 'discipline', 'evaluaties'])
// Bronnen met een `totaal`-kolom (afkap-detectie fase 3, SQL: count(*) over ()).
const MET_TOTAAL = new Set<keyof TeamData>(['koppelingen', 'discipline', 'evaluaties'])

function leegTeam(): TeamData {
  return {
    aanwezigheid: [], maandOpkomst: [], teamRating: [], ratingPerSpeler: [], aanwezigheidPerSpeler: [],
    uitslagen: [], spelerMomenten: [], doelpuntMinuten: [], tegendoelpunten: [], speelkansen: [],
    ratingVorm: [], trainingOpkomst: [], blessures: [], speelminuten: [], koppelingen: [], discipline: [],
    evaluaties: [], events: [], players: [], metingen: [], trainingOefeningen: [],
  }
}

// Generieke tabel-engine (zelfde precedent als inzichten.acceptance.test.tsx),
// met capture van de select-string zodat de twee players-queries te
// onderscheiden zijn.
function tabel(rows: Row[], fout?: (sel: string) => unknown) {
  return () => {
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; asc: boolean }[] = []
    let limitN: number | null = null
    let sel = ''
    const resolve = (): Row[] => {
      let out = rows.filter((r) => filters.every((f) => f(r)))
      if (orders.length) {
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const av = a[o.col] as string | number
            const bv = b[o.col] as string | number
            if (av === bv) continue
            if (av === undefined || av === null) return 1
            if (bv === undefined || bv === null) return -1
            return (av < bv ? -1 : 1) * (o.asc ? 1 : -1)
          }
          return 0
        })
      }
      return limitN === null ? out : out.slice(0, limitN)
    }
    const chain: Record<string, unknown> = {
      select: (s: string) => { sel = s; return chain },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return chain },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return chain },
      gt: (c: string, v: unknown) => { filters.push((r) => (r[c] as string) > (v as string)); return chain },
      gte: (c: string, v: unknown) => { filters.push((r) => (r[c] as string) >= (v as string)); return chain },
      lt: (c: string, v: unknown) => { filters.push((r) => (r[c] as string) < (v as string)); return chain },
      lte: (c: string, v: unknown) => { filters.push((r) => (r[c] as string) <= (v as string)); return chain },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return chain },
      not: (c: string, op: string, v: unknown) => {
        if (op !== 'is') throw new Error(`onverwachte operator ${op}`)
        filters.push((r) => r[c] !== v)
        return chain
      },
      order: (c: string, o: { ascending?: boolean } = {}) => { orders.push({ col: c, asc: o.ascending ?? true }); return chain },
      limit: (n: number) => { limitN = n; return chain },
      maybeSingle: () => Promise.resolve({ data: resolve()[0] ?? null }),
      single: () => Promise.resolve({ data: resolve()[0] ?? null }),
      then: (res: (v: unknown) => unknown) => {
        const err = fout?.(sel) ?? null
        return res(err ? { data: null, error: err } : { data: resolve(), error: null })
      },
    }
    return chain
  }
}

const FOUT = { code: 'PGRST202', message: 'Could not find the function public.geheime_functie in the schema cache' }

interface Opties {
  // Overige teams (id → data); het hoofdteam is altijd TEAM.
  anderen?: Record<string, Partial<TeamData>>
  // Welke teams de gebruiker is lid van (default: alleen TEAM, owner).
  members?: Row[]
  periode?: string
  locale?: string
  activeTeam?: string
  rpcErrors?: Record<string, unknown>
  // 'posities' laat de players-query met position/secondary_positions falen.
  selectErrors?: Record<string, unknown>
  // lokale tijd waarop de pagina draait
  klok?: { datum: string; uur?: number; min?: number }
  seizoen?: [string, string]
}

function zetKlok(datum: string, uur = 10, min = 0) {
  const [y, m, d] = datum.split('-').map(Number)
  if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(y, m - 1, d, uur, min, 0))
}

const inRange = (d: string, a: string, b: string) => d >= a && d <= b

function maakClient(teams: Record<string, TeamData>, o: Opties) {
  const rpcCalls: { name: string; args: Row }[] = []
  const fromCalls: string[] = []
  const settings: Row[] = Object.keys(teams).flatMap((id) => [
    { team_id: id, key: 'season_start', value: (o.seizoen ?? [S, E])[0] },
    { team_id: id, key: 'season_end', value: (o.seizoen ?? [S, E])[1] },
  ])
  const alle = (k: 'events' | 'players' | 'metingen' | 'trainingOefeningen') => Object.values(teams).flatMap((t) => t[k])
  const eventsT = tabel(alle('events'))
  const playersT = tabel(alle('players'), (sel) =>
    sel.includes('secondary_positions') ? (o.selectErrors?.posities ?? null) : null,
  )
  const settingsT = tabel(settings)
  const oefT = tabel(alle('trainingOefeningen'))
  const metT = tabel(alle('metingen'))
  const members = o.members ?? [{ team_id: TEAM, user_id: 'u1', rol: 'owner' }]
  const memberChain = () => {
    const chain: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'neq', 'in', 'is', 'not', 'gt', 'gte', 'lt', 'lte', 'order', 'limit']) chain[op] = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: members[0] ?? null, error: null })
    chain.single = chain.maybeSingle
    chain.then = (res: (v: unknown) => unknown) => res({ data: members, error: null })
    return chain
  }
  return {
    __rpcCalls: rpcCalls,
    __fromCalls: fromCalls,
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (naam: string) => {
      if (naam === 'team_members') return memberChain()
      fromCalls.push(naam)
      if (naam === 'events') return eventsT()
      if (naam === 'players') return playersT()
      if (naam === 'settings') return settingsT()
      if (naam === 'training_oefeningen') return oefT()
      if (naam === 'categorie_metingen') return metT()
      throw new Error(`Onverwachte tabel in test: "${naam}"`)
    },
    rpc: (naam: string, args: Row) => {
      rpcCalls.push({ name: naam, args })
      const bron = RPC_BRON[naam]
      if (!bron) throw new Error(`Onbekende RPC in test: "${naam}"`)
      if (o.rpcErrors?.[naam]) return Promise.resolve({ data: null, error: o.rpcErrors[naam] })
      const team = teams[args.p_team_id as string]
      let rijen = team ? [...team[bron]] : []
      const { p_start, p_end } = args as { p_start: string; p_end: string }
      if (MET_DATUM.has(bron)) rijen = rijen.filter((r) => inRange(r.datum as string, p_start, p_end))
      if (bron === 'maandOpkomst') {
        rijen = rijen.filter((r) => inRange(r.maand as string, p_start.slice(0, 7), p_end.slice(0, 7)))
      }
      if (bron === 'uitslagen') rijen = rijen.slice(0, 201) // SQL: limit 201
      if (MET_TOTAAL.has(bron)) {
        rijen = rijen.slice(0, 901) // SQL: limit 901
        rijen = rijen.map((r) => ({ ...r, totaal: rijen.length }))
      }
      return Promise.resolve({ data: rijen, error: null })
    },
  }
}

async function renderInzichten(data: Partial<TeamData>, o: Opties = {}) {
  const klok = o.klok ?? { datum: TODAY }
  zetKlok(klok.datum, klok.uur, klok.min)
  state.locale = o.locale ?? 'nl'
  state.activeTeam = o.activeTeam
  const teams: Record<string, TeamData> = { [TEAM]: { ...leegTeam(), ...data } }
  for (const [id, d] of Object.entries(o.anderen ?? {})) teams[id] = { ...leegTeam(), ...d }
  const client = maakClient(teams, o)
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>)
  const el = o.periode === undefined
    ? await InzichtenPage()
    : await InzichtenPage({ searchParams: Promise.resolve({ periode: o.periode }) })
  const r = render(<DictProvider dict={dicts[state.locale]}>{el}</DictProvider>)
  return { ...r, rpcCalls: client.__rpcCalls, fromCalls: client.__fromCalls }
}

const ORIGINELE_TZ = process.env.TZ
let consoleError: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  state.locale = 'nl'
  state.activeTeam = undefined
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  consoleError.mockRestore()
  vi.useRealTimers()
  if (ORIGINELE_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINELE_TZ
})

// ═══════════════════════════════════════════════════════════════════════
// Fixture-bouwstenen
// ═══════════════════════════════════════════════════════════════════════
function datum(basis: string, dagen: number): string {
  const d = new Date(`${basis}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dagen)
  return d.toISOString().slice(0, 10)
}

const basis = (): Partial<TeamData> => ({ aanwezigheid: [{ aanwezig: 9, afwezig: 1 }] })
const merge = (...delen: Partial<TeamData>[]): Partial<TeamData> => Object.assign({}, ...delen)

function trainingen(maand: string, n: number, voorvoegsel = 't'): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    event_id: `${voorvoegsel}-${maand}-${i}`,
    datum: `${maand}-${String(i + 1).padStart(2, '0')}`,
    doelstelling: null, rpe: null, oordeel: null,
  }))
}
// laatste maand = 2026-10 met `pct`% en `n` trainingen
const opkomst = (pct: number, n: number): Partial<TeamData> => ({
  maandOpkomst: [{ maand: '2026-10', aanwezig: pct, afwezig: 100 - pct }],
  evaluaties: trainingen('2026-10', n),
})
// 10 wedstrijden: 5 met `voor`, daarna 5 met `na`
const ratingReeks = (voor: number, na: number, n = 5): Row[] =>
  [...Array(n).fill(voor), ...Array(n).fill(na)].map((g, i) => ({
    event_id: `r${i}`, datum: datum('2026-08-01', i), tegenstander: null, gemiddelde: g, aantal: 12,
  }))
const rating = (voor: number, na: number): Partial<TeamData> => ({ teamRating: ratingReeks(voor, na) })

function uitslag(i: number, gf: number, ga: number, ha: string | null = 'home'): Row {
  return { event_id: `u${i}`, datum: datum('2026-07-01', i % 100), home_away: ha, goals_for: gf, goals_against: ga, formatie: null }
}
const uitslagen = (lijst: [number, number, (string | null)?][]): Row[] =>
  lijst.map(([gf, ga, ha], i) => uitslag(i, gf, ga, ha === undefined ? 'home' : ha))
const saldoPositief = (): Partial<TeamData> => ({ uitslagen: uitslagen([[1, 0], [1, 0], [1, 0], [1, 0], [1, 0]]) })
const saldoNegatief = (): Partial<TeamData> => ({ uitslagen: uitslagen([[0, 1], [0, 1], [0, 1], [0, 1], [0, 1]]) })

const wegblijver = (naam = 'Wim Weg', aanwezig = 1, afwezig = 5): Partial<TeamData> => ({
  aanwezigheidPerSpeler: [{ player_id: 'w1', naam, aanwezig, afwezig }],
})
const vormRij = (id: string, naam: string, seizoen: number, recent: number, aantal = 10): Row => ({
  player_id: id, naam, aantal, seizoen_gemiddelde: seizoen, recent_gemiddelde: recent,
})
const stijger = (naam = 'Sven Stijger'): Partial<TeamData> => ({ ratingVorm: [vormRij('s1', naam, 7.0, 7.6)] })
const daler = (naam = 'Daan Daler'): Partial<TeamData> => ({ ratingVorm: [vormRij('d1', naam, 7.5, 7.0)] })

function speler(id: string, name: string, position: string, o: Row = {}): Row {
  return { id, team_id: TEAM, name, active: true, type: 'regular', position, secondary_positions: null, injured: false, ...o }
}
const vorm = (...rijen: Row[]): Partial<TeamData> => ({ ratingVorm: rijen })
const keeperGeblesseerd = (): Partial<TeamData> => ({ players: [speler('k1', 'Karel Keeper', 'Keeper', { injured: true })] })

// ═══════════════════════════════════════════════════════════════════════
// Lees-helpers (DOM)
// ═══════════════════════════════════════════════════════════════════════
const tegel = (c: HTMLElement, id: string) => c.querySelector(`[data-kpi="${id}"]`) as HTMLElement
const tegelTekst = (c: HTMLElement, id: string) =>
  Array.from(tegel(c, id).querySelectorAll('p')).map((p) => p.textContent)
const strook = (c: HTMLElement) => c.querySelector('[data-conclusielaag="kpi"]') as HTMLElement | null
const blok = (c: HTMLElement) => c.querySelector('[data-conclusielaag="signalen"]') as HTMLElement | null
const signalen = (c: HTMLElement) =>
  Array.from(blok(c)?.querySelectorAll('li p') ?? []).map((p) => p.textContent ?? '')
const melding = (c: HTMLElement) =>
  Array.from(blok(c)?.children ?? []).filter((e) => e.tagName === 'P').map((e) => e.textContent)
const printBlok = (c: HTMLElement) => c.querySelector('[data-print-only]') as HTMLElement
const rapportSignalen = (c: HTMLElement) =>
  Array.from(printBlok(c).querySelectorAll('.rapport-signaal')).map((p) => p.textContent ?? '')
const rapportKpi = (c: HTMLElement, label: string) => {
  const k = Array.from(printBlok(c).querySelectorAll('.rapport-kpi')).find(
    (e) => e.querySelector('.rapport-kpi-label')?.textContent === label,
  )
  return k ? Array.from(k.querySelectorAll('p')).map((p) => p.textContent) : null
}
const rail = (c: HTMLElement, id: string) =>
  (tegel(c, id).querySelector('div.absolute') as HTMLElement).style.background
const schermTekst = (c: HTMLElement) => (c.querySelector('.print\\:hidden') as HTMLElement).textContent ?? ''

const OKT = 'Okt 2026'

// De rijke dataset: elke tegel heeft een waarde, vier signaalsoorten zijn actief.
function rijk(): Partial<TeamData> {
  return merge(
    { aanwezigheid: [{ aanwezig: 84, afwezig: 16 }] },
    {
      maandOpkomst: [
        { maand: '2026-08', aanwezig: 60, afwezig: 40 },
        { maand: '2026-09', aanwezig: 70, afwezig: 30 },
        { maand: '2026-10', aanwezig: 90, afwezig: 10 },
      ],
      evaluaties: trainingen('2026-10', 3),
    },
    rating(7.0, 7.6),
    {
      uitslagen: uitslagen([[3, 1], [2, 0], [0, 0, 'away'], [1, 2, 'away'], [4, 1], [2, 2, null]]),
    },
    { ratingVorm: [vormRij('s1', 'Sven Stijger', 7.0, 7.6), vormRij('d1', 'Daan Daler', 7.5, 7.0)] },
    wegblijver(),
    keeperGeblesseerd(),
  )
}

// ═══════════════════════════════════════════════════════════════════════
describe('AC1 — zes tegels boven signalen en kaarten', () => {
  it('AC1: de strook heeft 6 tegels in de vaste volgorde, boven het signalenblok en boven alle kaarten', async () => {
    const { container } = await renderInzichten(rijk())
    const ids = Array.from(strook(container)!.querySelectorAll('[data-kpi]')).map((e) => e.getAttribute('data-kpi'))
    expect(ids).toEqual(['opkomst', 'aanwezigheid', 'rating', 'doelsaldo', 'punten', 'cleansheets'])
    const volgt = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(volgt(strook(container)!, blok(container)!)).toBe(true)
    const eersteKaart = Array.from(container.querySelectorAll('h2')).find((h) => h.textContent === nl.insights.thuisUitTitle)!
    expect(volgt(blok(container)!, eersteKaart)).toBe(true)
    // raster: 3 kolommen vanaf lg (structuur; de visuele indeling is niet te toetsen)
    expect(strook(container)!.className).toContain('lg:grid-cols-3')
  })

  it('AC1: elke tegel toont de verwachte inhoud (label, venster, waarde, detail)', async () => {
    const { container } = await renderInzichten(rijk())
    expect(tegelTekst(container, 'opkomst')).toEqual(['Trainingsopkomst', `Laatste maand (${OKT})`, '90%', '+20 t.o.v. vorige maand'])
    expect(tegelTekst(container, 'aanwezigheid')).toEqual(['Totale aanwezigheid', 'Heel seizoen', '84%', 'Norm 85%'])
    expect(tegelTekst(container, 'rating')).toEqual(['Gem. teamrating', 'Heel seizoen', '7.3', '+0.6 t.o.v. de 5 daarvoor'])
    expect(tegelTekst(container, 'doelsaldo')).toEqual(['Doelsaldo', 'Heel seizoen', '+6', '12 voor · 6 tegen'])
    expect(tegelTekst(container, 'punten')).toEqual(['Punten per wedstrijd', 'Heel seizoen', '1.83', '11 punten uit 6 wedstrijden'])
    expect(tegelTekst(container, 'cleansheets')).toEqual(['Clean sheets', 'Heel seizoen', '2', 'van 6 wedstrijden'])
  })
})

describe('AC2 — pariteit met de Thuis/uit-kaart', () => {
  async function kaartTotaal() {
    const r = await renderInzichten(rijk())
    const titel = Array.from(r.container.querySelectorAll('h2')).find((h) => h.textContent === nl.insights.thuisUitTitle)!
    const kaart = titel.closest('.surface-card') as HTMLElement
    const rij = Array.from(kaart.querySelectorAll('tbody tr')).find(
      (tr) => tr.querySelector('th')?.textContent === nl.insights.totaalLabel,
    )!
    const cellen = Array.from(rij.querySelectorAll('td')).map((td) => td.textContent ?? '')
    return { ...r, kaart, cellen }
  }

  it('AC2: Punten per wedstrijd = cel Ptn/w van de totaalrij', async () => {
    const { container, cellen } = await kaartTotaal()
    expect(cellen[4]).toBe('1.83')
    expect(tegelTekst(container, 'punten')[2]).toBe(cellen[4])
  })

  it('AC2: Clean sheets = n uit "Clean sheets: n van totaal"', async () => {
    const { container, kaart } = await kaartTotaal()
    const m = /Clean sheets: (\d+) van (\d+)/.exec(kaart.textContent ?? '')!
    expect(tegelTekst(container, 'cleansheets')[2]).toBe(m[1])
    expect(tegelTekst(container, 'cleansheets')[3]).toBe(`van ${m[2]} wedstrijden`)
  })

  it('AC2: Doelsaldo = saldo-cel van de totaalrij; tegel is te vinden via label.parent.parent (DOM-contract van de bestaande test)', async () => {
    const { container, cellen } = await kaartTotaal()
    expect(tegelTekst(container, 'doelsaldo')[2]).toBe(cellen[5])
    const label = Array.from(strook(container)!.querySelectorAll('p')).find((p) => p.textContent === nl.insights.kpiDoelsaldoLabel)!
    expect(label.parentElement!.parentElement).toBe(tegel(container, 'doelsaldo'))
    expect(label.parentElement!.parentElement!.textContent).toContain(cellen[5])
  })

  it('AC2 (afronding): 2 decimalen, ook bij een repeterend getal (11 punten uit 6 = 1.8333…)', async () => {
    const { container } = await renderInzichten(rijk())
    expect(tegelTekst(container, 'punten')[2]).toBe('1.83')
  })
})

describe('AC3 — vensterlabel per tegel', () => {
  it.each([
    [undefined, nl.insights.periodeSeizoen],
    ['4w', nl.insights.periode4w],
    ['8w', nl.insights.periode8w],
  ])('AC3: periode %s → vijf tegels tonen "%s", Trainingsopkomst blijft "Laatste maand (…)"', async (periode, label) => {
    const { container } = await renderInzichten(rijk(), { periode })
    for (const id of ['aanwezigheid', 'rating', 'doelsaldo', 'punten', 'cleansheets']) {
      expect(tegelTekst(container, id)[1]).toBe(label)
    }
    expect(tegelTekst(container, 'opkomst')[1]).toBe(`Laatste maand (${OKT})`)
  })

  it('AC3: zonder maandopkomst toont de opkomsttegel "Laatste maand" zonder maand', async () => {
    const { container } = await renderInzichten(basis())
    expect(tegelTekst(container, 'opkomst')[1]).toBe('Laatste maand')
  })

  it('AC3: het vensterlabel is een zuster van de kopregel, niet onderdeel van het label-element', async () => {
    const { container } = await renderInzichten(rijk())
    const t = tegel(container, 'doelsaldo')
    const kop = Array.from(t.children).find((e) => e.querySelector('p')?.textContent === 'Doelsaldo')!
    expect(kop.querySelector('p')!.textContent).toBe('Doelsaldo')
    expect(Array.from(t.children).some((e) => e.tagName === 'P' && e.textContent === 'Heel seizoen')).toBe(true)
  })
})

describe('AC4 — label Totale aanwezigheid', () => {
  it('AC4: het oude label is weg en het nieuwe botst niet met de kaarttitel "Aanwezigheid"', async () => {
    const { container } = await renderInzichten(rijk())
    expect(tegelTekst(container, 'aanwezigheid')[0]).toBe('Totale aanwezigheid')
    expect(schermTekst(container)).not.toContain('Aanwezigheid seizoen')
    expect(nl.insights.kpiAanwezigheidLabel).not.toBe(nl.insights.aanwezigheidTitle)
    const titels = Array.from(container.querySelectorAll('h2')).filter((h) => h.textContent === nl.insights.aanwezigheidTitle)
    expect(titels).toHaveLength(1)
  })
})

describe('AC5 — nieuwe tegels neutraal', () => {
  it('AC5: Punten en Clean sheets hebben een neutrale rail, geen sparkline en een neutraal detail', async () => {
    const { container } = await renderInzichten(rijk())
    for (const id of ['punten', 'cleansheets']) {
      expect(rail(container, id)).toBe('var(--faint)')
      expect(tegel(container, id).querySelector('svg')).toBeNull()
      const detail = Array.from(tegel(container, id).querySelectorAll('p')).at(-1) as HTMLElement
      expect(detail.style.color).toBe('var(--faint)')
    }
  })

  it('AC5: een negatief resultaat kleurt de nieuwe tegels niet (0 punten, geen clean sheets)', async () => {
    const { container } = await renderInzichten(merge(basis(), { uitslagen: uitslagen([[0, 3], [0, 3]]) }))
    expect(rail(container, 'punten')).toBe('var(--faint)')
    expect(rail(container, 'cleansheets')).toBe('var(--faint)')
    expect(tegelTekst(container, 'punten')[2]).toBe('0.00')
  })

  it.each([
    [90, 'var(--brand-accent)'],
    [85, 'var(--brand-accent)'],
    [84, 'var(--warning-text)'],
    [70, 'var(--warning-text)'],
    [69, 'var(--chip-red-fg)'],
  ])('AC5: de toonregel van Trainingsopkomst is ongewijzigd (%i%% → %s)', async (pct, kleur) => {
    const { container } = await renderInzichten(merge(basis(), opkomst(pct, 3)))
    expect(rail(container, 'opkomst')).toBe(kleur)
  })

  it('AC5: de toonregel van Totale aanwezigheid en Doelsaldo is ongewijzigd', async () => {
    const a = await renderInzichten(merge({ aanwezigheid: [{ aanwezig: 84, afwezig: 16 }] }, saldoNegatief()))
    expect(rail(a.container, 'aanwezigheid')).toBe('var(--warning-text)')
    expect(rail(a.container, 'doelsaldo')).toBe('var(--warning-text)')
    cleanup()
    const b = await renderInzichten(merge({ aanwezigheid: [{ aanwezig: 60, afwezig: 40 }] }, saldoPositief()))
    expect(rail(b.container, 'aanwezigheid')).toBe('var(--chip-red-fg)')
    expect(rail(b.container, 'doelsaldo')).toBe('var(--brand-accent)')
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC6 — volgorde en MAX_SIGNALEN', () => {
  it('AC6: maximaal 3 signalen; zorg eerst, dan let-op; een zorgsignaal verdringt de complimenten', async () => {
    const { container } = await renderInzichten(rijk())
    expect(signalen(container)).toEqual([
      'Wim Weg was minder dan 50% van de tijd aanwezig.',
      'Daan Daler daalt: de laatste 5 wedstrijden liggen 0.5 onder het eigen seizoensgemiddelde.',
      'Voor Keeper is op dit moment geen fitte speler.',
    ])
    // de vier complimenten zijn er wel degelijk, maar vallen buiten de top 3
    expect(blok(container)!.textContent).not.toContain('Sven Stijger')
    expect(blok(container)!.textContent).not.toContain('haalt de norm')
  })

  it('AC6: een compliment verdringt nooit een zorgsignaal (1 zorg + 4 complimenten → zorg + 2 complimenten)', async () => {
    const { container } = await renderInzichten(
      merge(basis(), wegblijver(), opkomst(90, 3), rating(7.0, 7.6), saldoPositief(), stijger()),
    )
    expect(signalen(container)).toEqual([
      'Wim Weg was minder dan 50% van de tijd aanwezig.',
      `De trainingsopkomst haalt de norm: 90% in ${OKT}, boven de 85%.`,
      'De teamrating stijgt met 0.6 over de laatste 5 wedstrijden.',
    ])
  })

  it('AC6: let-op-volgorde, deel 1: opkomst → rating-daling → doelsaldo-negatief', async () => {
    const { container } = await renderInzichten(
      merge(basis(), opkomst(80, 3), rating(7.6, 7.0), saldoNegatief(), daler(), keeperGeblesseerd()),
    )
    expect(signalen(container)).toEqual([
      `De trainingsopkomst staat op 80% in ${OKT} — onder de norm van 85%.`,
      'De teamrating daalt met 0.6 over de laatste 5 wedstrijden.',
      'Negatief doelsaldo over 5 wedstrijden: 0 voor, 5 tegen.',
    ])
  })

  it('AC6: let-op-volgorde, deel 2: doelsaldo-negatief → speler-daler → positie-zonder-fit', async () => {
    const { container } = await renderInzichten(merge(basis(), saldoNegatief(), daler(), keeperGeblesseerd()))
    expect(signalen(container)).toEqual([
      'Negatief doelsaldo over 5 wedstrijden: 0 voor, 5 tegen.',
      'Daan Daler daalt: de laatste 5 wedstrijden liggen 0.5 onder het eigen seizoensgemiddelde.',
      'Voor Keeper is op dit moment geen fitte speler.',
    ])
  })

  it('AC6: complimentvolgorde: opkomst → rating-stijging → doelsaldo-positief (stijger valt af)', async () => {
    const { container } = await renderInzichten(
      merge(basis(), opkomst(90, 3), rating(7.0, 7.6), saldoPositief(), stijger()),
    )
    expect(signalen(container)).toEqual([
      `De trainingsopkomst haalt de norm: 90% in ${OKT}, boven de 85%.`,
      'De teamrating stijgt met 0.6 over de laatste 5 wedstrijden.',
      'Positief doelsaldo over 5 wedstrijden: 5 voor, 0 tegen.',
    ])
  })

  it('AC6: complimentvolgorde: doelsaldo-positief → speler-stijger', async () => {
    const { container } = await renderInzichten(merge(basis(), saldoPositief(), stijger()))
    expect(signalen(container)).toEqual([
      'Positief doelsaldo over 5 wedstrijden: 5 voor, 0 tegen.',
      'Sven Stijger stijgt: de laatste 5 wedstrijden liggen 0.6 boven het eigen seizoensgemiddelde.',
    ])
  })

  it('AC6: een letop-signaal staat vóór een compliment', async () => {
    const { container } = await renderInzichten(merge(basis(), stijger(), keeperGeblesseerd()))
    expect(signalen(container)).toEqual([
      'Voor Keeper is op dit moment geen fitte speler.',
      'Sven Stijger stijgt: de laatste 5 wedstrijden liggen 0.6 boven het eigen seizoensgemiddelde.',
    ])
  })
})

describe('AC7 — nieuwe signalen: stijger, daler, positie', () => {
  it('AC7: één daler → toon let-op, naam als laatste in de zin; één stijger → compliment', async () => {
    const { container } = await renderInzichten(merge(basis(), vorm(vormRij('d1', 'Daan Daler', 7.5, 7.0), vormRij('s1', 'Sven Stijger', 7.0, 7.6))))
    const lijst = signalen(container)
    expect(lijst).toEqual([
      'Daan Daler daalt: de laatste 5 wedstrijden liggen 0.5 onder het eigen seizoensgemiddelde.',
      'Sven Stijger stijgt: de laatste 5 wedstrijden liggen 0.6 boven het eigen seizoensgemiddelde.',
    ])
    // toon: let-op krijgt het ↓-teken, goed het ↑-teken
    const tekens = Array.from(blok(container)!.querySelectorAll('li span[aria-hidden]')).map((s) => s.textContent)
    expect(tekens).toEqual(['↓', '↑'])
  })

  it('AC7: meerdere dalers/stijgers → meervoudszin met het aantal en de sterkste (grootste verschil)', async () => {
    const { container } = await renderInzichten(
      merge(basis(), {
        ratingVorm: [
          vormRij('d1', 'Dirk Daler', 7.5, 7.1),
          vormRij('d2', 'Daan Daler', 7.5, 7.0),
          vormRij('s1', 'Stef Stijger', 7.0, 7.4),
          vormRij('s2', 'Sven Stijger', 7.0, 7.6),
        ],
      }),
    )
    expect(signalen(container)).toEqual([
      '2 spelers dalen ten opzichte van hun seizoensgemiddelde, het sterkst Daan Daler.',
      '2 spelers stijgen ten opzichte van hun seizoensgemiddelde, het sterkst Sven Stijger.',
    ])
  })

  it('AC7: één positie zonder fitte speler → die positie; meer dan één → alleen het aantal, nooit een opsomming', async () => {
    const een = await renderInzichten(merge(basis(), keeperGeblesseerd()))
    expect(signalen(een.container)).toEqual(['Voor Keeper is op dit moment geen fitte speler.'])
    cleanup()
    const meer = await renderInzichten(
      merge(basis(), {
        players: [
          speler('k1', 'Karel Keeper', 'Keeper', { injured: true }),
          speler('s1', 'Sander Spits', 'Spits', { injured: true }),
          speler('b1', 'Bram Buiten', 'Linksbuiten', { injured: true }),
        ],
      }),
    )
    expect(signalen(meer.container)).toEqual(['Voor 3 posities is op dit moment geen fitte speler.'])
    expect(blok(meer.container)!.textContent).not.toContain('Spits')
    expect(blok(meer.container)!.textContent).not.toContain('Keeper')
  })

  it('AC7 / O3-b: alleen posities die het team bezet — een team zonder spelers heeft geen positiesignaal en vult niet alle 12 posities', async () => {
    const leeg = await renderInzichten(merge(basis(), { players: [] }))
    expect(blok(leeg.container)).toBeNull()
    cleanup()
    // één fitte speler en één geblesseerde op een andere positie → precies die ene
    const een = await renderInzichten(
      merge(basis(), {
        players: [speler('s1', 'Sander Spits', 'Spits'), speler('k1', 'Karel Keeper', 'Keeper', { injured: true })],
      }),
    )
    expect(signalen(een.container)).toEqual(['Voor Keeper is op dit moment geen fitte speler.'])
  })

  it('AC7 / O3-b: een positie telt als bezet via secondary_positions; een fitte tweede-positie-speler dekt de positie', async () => {
    // Anna: Spits (geblesseerd), tweede positie Linksbuiten. Bram: Linksbuiten (fit) → Linksbuiten gedekt.
    const gedekt = await renderInzichten(
      merge(basis(), {
        players: [
          speler('a1', 'Anna', 'Spits', { secondary_positions: ['Linksbuiten'], injured: true }),
          speler('b1', 'Bram', 'Linksbuiten'),
        ],
      }),
    )
    expect(signalen(gedekt.container)).toEqual(['Voor Spits is op dit moment geen fitte speler.'])
    cleanup()
    // Alleen Anna (geblesseerd): Spits én Linksbuiten (via secondary) zijn bezet en niet gedekt → 2 posities
    const beide = await renderInzichten(
      merge(basis(), { players: [speler('a1', 'Anna', 'Spits', { secondary_positions: ['Linksbuiten'], injured: true })] }),
    )
    expect(signalen(beide.container)).toEqual(['Voor 2 posities is op dit moment geen fitte speler.'])
  })

  it('AC7: iedereen geblesseerd → precies één signaal met het aantal bezette posities (geen opsomming)', async () => {
    const { container } = await renderInzichten(
      merge(basis(), {
        players: [
          speler('1', 'A', 'Keeper', { injured: true }),
          speler('2', 'B', 'Spits', { injured: true }),
          speler('3', 'C', 'Linksachter', { injured: true }),
          speler('4', 'D', 'Rechtsachter', { injured: true }),
        ],
      }),
    )
    expect(signalen(container)).toEqual(['Voor 4 posities is op dit moment geen fitte speler.'])
  })

  it('O6: een speler die tegelijk wegblijver en daler is, krijgt beide signalen (zorg eerst)', async () => {
    const { container } = await renderInzichten(
      merge(basis(), wegblijver('Piet Peters'), daler('Piet Peters')),
    )
    expect(signalen(container)).toEqual([
      'Piet Peters was minder dan 50% van de tijd aanwezig.',
      'Piet Peters daalt: de laatste 5 wedstrijden liggen 0.5 onder het eigen seizoensgemiddelde.',
    ])
  })

  it('AC7 / edge: een naam met {placeholder} blijft letterlijk staan (naam is de laatste sleutel) — wegblijver, daler én stijger, scherm én rapport', async () => {
    const { container } = await renderInzichten(
      merge(basis(), wegblijver('Piet {drempel}'), {
        ratingVorm: [vormRij('d1', 'Daan {venster}', 7.5, 7.0), vormRij('s1', 'Sven {verschil} {aantal}', 7.0, 7.6)],
      }),
    )
    const verwacht = [
      'Piet {drempel} was minder dan 50% van de tijd aanwezig.',
      'Daan {venster} daalt: de laatste 5 wedstrijden liggen 0.5 onder het eigen seizoensgemiddelde.',
      'Sven {verschil} {aantal} stijgt: de laatste 5 wedstrijden liggen 0.6 boven het eigen seizoensgemiddelde.',
    ]
    expect(signalen(container)).toEqual(verwacht)
    expect(rapportSignalen(container)).toEqual(verwacht)
  })

  it('AC7: stijgers/dalers gebruiken het hele seizoen, ook bij 4w (RPC-argumenten)', async () => {
    const { rpcCalls } = await renderInzichten(merge(basis(), daler()), { periode: '4w' })
    const call = rpcCalls.find((c) => c.name === 'inzichten_rating_vorm_per_speler')!
    expect(call.args).toEqual({ p_team_id: TEAM, p_start: S, p_end: E, p_recent: 5 })
  })
})

describe('AC8 — scherm en rapport tonen dezelfde zin', () => {
  it('AC8: dezelfde (maximaal 3) zinnen in dezelfde volgorde op scherm en rapport, zonder restant-placeholder', async () => {
    const { container } = await renderInzichten(rijk())
    const scherm = signalen(container)
    expect(scherm).toHaveLength(3)
    expect(rapportSignalen(container)).toEqual(scherm)
    for (const zin of [...scherm, ...rapportSignalen(container)]) expect(zin).not.toMatch(/\{[a-z]+\}/)
  })

  it('AC8: ook de complimenten en de meervoudszinnen zijn identiek op scherm en rapport', async () => {
    const { container } = await renderInzichten(
      merge(basis(), opkomst(90, 3), rating(7.0, 7.6), saldoPositief(), {
        ratingVorm: [vormRij('s1', 'Sven Stijger', 7.0, 7.6), vormRij('s2', 'Stef Stijger', 7.0, 7.4)],
      }),
    )
    expect(signalen(container)).toHaveLength(3)
    expect(rapportSignalen(container)).toEqual(signalen(container))
    cleanup()
    const m = await renderInzichten(
      merge(basis(), {
        ratingVorm: [vormRij('d1', 'Dirk Daler', 7.5, 7.1), vormRij('d2', 'Daan Daler', 7.5, 7.0)],
        players: [speler('1', 'A', 'Keeper', { injured: true }), speler('2', 'B', 'Spits', { injured: true })],
      }),
    )
    expect(rapportSignalen(m.container)).toEqual(signalen(m.container))
    expect(signalen(m.container)).toHaveLength(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC9 / AC33 — geen extra query. De waarden zijn gemeten op de code VÓÓR de
// wijziging (HEAD, 00-querytelling-voor.txt) met ditzelfde harnas en deze
// dataset: zie het rapport (07-test-verifier-rapport.md).
// ═══════════════════════════════════════════════════════════════════════
const VOOR = {
  rpcAantal: 18, // 17 verschillende RPC's + de tweede ronde inzichten_training_koppelingen (periodisering)
  fromAantal: 10,
  rpcNamen: [
    'inzichten_aanwezigheid',
    'inzichten_aanwezigheid_per_speler',
    'inzichten_blessures_per_maand',
    'inzichten_doelpunten_per_minuut',
    'inzichten_invul_discipline',
    'inzichten_rating_per_speler',
    'inzichten_rating_team_per_wedstrijd',
    'inzichten_rating_vorm_per_speler',
    'inzichten_speelkansen',
    'inzichten_speelminuten_per_speler',
    'inzichten_speler_momenten',
    'inzichten_tegendoelpunten',
    'inzichten_training_evaluaties',
    'inzichten_training_koppelingen',
    'inzichten_training_opkomst_per_maand',
    'inzichten_training_opkomst_per_speler',
    'inzichten_wedstrijd_uitslagen',
  ],
  fromNamen: ['categorie_metingen', 'events', 'events', 'events', 'players', 'players', 'settings', 'settings', 'settings', 'training_oefeningen'],
}

describe('AC9 / AC33 — geen extra query', () => {
  const pinData = () =>
    merge(rijk(), {
      events: [
        { id: 'tr1', team_id: TEAM, type: 'training', date: '2026-10-01', trainingstype: 'vct' },
        { id: 'm1', team_id: TEAM, type: 'match', date: '2026-10-03', goals_for: 2, goals_against: 1, opponent: 'X', match_type: 'league', created_at: '2026-01-01' },
      ],
      trainingOefeningen: [{ team_id: TEAM, event_id: 'tr1', oefeningen: { categorie: 'passen' } }],
      metingen: [{ id: 'mt1', team_id: TEAM, categorie: 'partijen_groot', datum: '2026-07-05', stap: 1, notes: null, created_at: '2026-07-05' }],
    })

  it('AC9: het aantal rpc()- en from()-aanroepen en de set RPC-namen zijn gelijk aan de waarde vóór de wijziging', async () => {
    const { rpcCalls, fromCalls } = await renderInzichten(pinData())
    expect(rpcCalls).toHaveLength(VOOR.rpcAantal)
    expect(Array.from(new Set(rpcCalls.map((c) => c.name))).sort()).toEqual(VOOR.rpcNamen)
    expect([...fromCalls].sort()).toEqual(VOOR.fromNamen)
  })

  it('AC9: een falende bron, afgekapte uitslagen of een andere periode voegen geen aanroep toe', async () => {
    const a = await renderInzichten(pinData(), { rpcErrors: { inzichten_rating_vorm_per_speler: FOUT } })
    expect(a.rpcCalls).toHaveLength(VOOR.rpcAantal)
    expect(a.fromCalls).toHaveLength(VOOR.fromAantal)
    cleanup()
    const b = await renderInzichten(pinData(), { periode: '4w' })
    expect(b.rpcCalls).toHaveLength(VOOR.rpcAantal)
    expect(b.fromCalls).toHaveLength(VOOR.fromAantal)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC15 — bronfout per KPI-bron', () => {
  const bron = nl.insights.bronFout
  const meldingTegel = (c: HTMLElement, id: string, label: string, venster: string) => {
    expect(tegelTekst(c, id)).toEqual([label, venster, bron])
  }

  it('AC15: aanwezigheid-RPC faalt → alleen "Totale aanwezigheid" toont bronFout; geen —, geen 0, geen ruwe fout', async () => {
    const { container } = await renderInzichten(rijk(), { rpcErrors: { inzichten_aanwezigheid: FOUT } })
    meldingTegel(container, 'aanwezigheid', 'Totale aanwezigheid', 'Heel seizoen')
    expect(tegelTekst(container, 'rating')[2]).toBe('7.3')
    expect(tegelTekst(container, 'doelsaldo')[2]).toBe('+6')
    expect(document.body.textContent).not.toContain('PGRST202')
    expect(document.body.textContent).not.toContain('geheime_functie')
  })

  it('AC15: maandopkomst-RPC faalt → alleen "Trainingsopkomst" toont bronFout', async () => {
    const { container } = await renderInzichten(rijk(), { rpcErrors: { inzichten_training_opkomst_per_maand: FOUT } })
    meldingTegel(container, 'opkomst', 'Trainingsopkomst', 'Laatste maand')
    expect(tegelTekst(container, 'aanwezigheid')[2]).toBe('84%')
    expect(document.body.textContent).not.toContain('PGRST202')
  })

  it('AC15: team-rating-RPC faalt → alleen "Gem. teamrating" toont bronFout', async () => {
    const { container } = await renderInzichten(rijk(), { rpcErrors: { inzichten_rating_team_per_wedstrijd: FOUT } })
    meldingTegel(container, 'rating', 'Gem. teamrating', 'Heel seizoen')
    expect(tegelTekst(container, 'opkomst')[2]).toBe('90%')
    expect(document.body.textContent).not.toContain('PGRST202')
  })

  it('AC15: uitslagen-RPC faalt → Doelsaldo, Punten én Clean sheets tonen bronFout; de rest niet', async () => {
    const { container } = await renderInzichten(rijk(), { rpcErrors: { inzichten_wedstrijd_uitslagen: FOUT } })
    meldingTegel(container, 'doelsaldo', 'Doelsaldo', 'Heel seizoen')
    meldingTegel(container, 'punten', 'Punten per wedstrijd', 'Heel seizoen')
    meldingTegel(container, 'cleansheets', 'Clean sheets', 'Heel seizoen')
    expect(tegelTekst(container, 'rating')[2]).toBe('7.3')
    expect(tegelTekst(container, 'aanwezigheid')[2]).toBe('84%')
    expect(document.body.textContent).not.toContain('PGRST202')
  })

  it('AC15: een tegel met bronFout heeft geen cijfer, geen sparkline en een neutrale rail', async () => {
    const { container } = await renderInzichten(rijk(), { rpcErrors: { inzichten_training_opkomst_per_maand: FOUT } })
    const t = tegel(container, 'opkomst')
    expect(t.querySelector('p.font-display')).toBeNull()
    expect(t.querySelector('svg')).toBeNull()
    expect(rail(container, 'opkomst')).toBe('var(--faint)')
    expect(t.textContent).not.toMatch(/[0-9—]/)
  })
})

describe('KpiStrip — fout gaat voor afgekapt (regel uit ThuisUitKaart)', () => {
  it('als fout én afgekapt tegelijk waar zijn toont de tegel bronFout, niet afgekapt (op pagina-niveau onbereikbaar: een fout levert geen rijen)', () => {
    const totaal = splitsThuisUit([{ event_id: 'a', datum: S, home_away: 'home', goals_for: 1, goals_against: 0, formatie: null }]).totaal
    const { container } = render(
      <KpiStrip
        opkomst={null as MaandTrend | null}
        maanden={[]}
        aanwezigheidPercentage={null}
        rating={null}
        resultaat={totaal}
        uitslagenAfgekapt={true}
        periodeLabel="Heel seizoen"
        fout={{ maandOpkomst: false, aanwezigheid: false, teamRating: false, uitslagen: true }}
        t={nl}
      />,
    )
    for (const id of ['doelsaldo', 'punten', 'cleansheets']) {
      const tekst = Array.from(tegel(container, id).querySelectorAll('p')).map((p) => p.textContent)
      expect(tekst[2]).toBe(nl.insights.bronFout)
      expect(tekst.join('')).not.toContain(nl.insights.afgekapt)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC16 — bronfout in signalen', () => {
  // Per signaalbron: een dataset die zonder fout precies dat signaal (bij
  // voorkeur een compliment) oplevert.
  const gevallen: [string, string, Partial<TeamData>, string, unknown?][] = [
    ['inzichten_training_opkomst_per_maand', 'opkomst (compliment)', opkomst(90, 3), 'haalt de norm'],
    ['inzichten_training_evaluaties', 'trainingstelling (opkomst-compliment)', opkomst(90, 3), 'haalt de norm'],
    ['inzichten_aanwezigheid_per_speler', 'wegblijver', wegblijver(), 'Wim Weg'],
    ['inzichten_rating_team_per_wedstrijd', 'rating-stijging (compliment)', rating(7.0, 7.6), 'teamrating stijgt'],
    ['inzichten_wedstrijd_uitslagen', 'doelsaldo-positief (compliment)', saldoPositief(), 'Positief doelsaldo'],
    ['inzichten_rating_vorm_per_speler', 'speler-stijger (compliment)', stijger(), 'Sven Stijger'],
  ]

  it.each(gevallen)('AC16: %s faalt (%s) → signaal weg, melding zichtbaar, geen goed-signaal', async (rpc, _naam, data, fragment) => {
    // controle: zonder fout staat het signaal er en is er geen melding
    const ok = await renderInzichten(merge(basis(), data))
    expect(signalen(ok.container).join('|')).toContain(fragment)
    expect(melding(ok.container)).toEqual([])
    cleanup()
    const stuk = await renderInzichten(merge(basis(), data), { rpcErrors: { [rpc]: FOUT } })
    expect(signalen(stuk.container)).toEqual([])
    // het blok blijft staan, ook zonder signalen, met één korte melding
    expect(blok(stuk.container)).not.toBeNull()
    expect(melding(stuk.container)).toEqual([nl.insights.signalenOnvolledig])
    expect(blok(stuk.container)!.querySelectorAll('li')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('PGRST202')
  })

  it('AC16: de posities-query faalt → geen positiesignaal, melding zichtbaar', async () => {
    const ok = await renderInzichten(merge(basis(), keeperGeblesseerd()))
    expect(signalen(ok.container)).toEqual(['Voor Keeper is op dit moment geen fitte speler.'])
    cleanup()
    const stuk = await renderInzichten(merge(basis(), keeperGeblesseerd()), { selectErrors: { posities: FOUT } })
    expect(signalen(stuk.container)).toEqual([])
    expect(melding(stuk.container)).toEqual([nl.insights.signalenOnvolledig])
    expect(document.body.textContent).not.toContain('PGRST202')
  })

  it('AC16: de melding staat onder de signalen als er wél signalen zijn, en is geen alert of signaalregel', async () => {
    const { container } = await renderInzichten(
      merge(basis(), wegblijver(), stijger()),
      { rpcErrors: { inzichten_rating_vorm_per_speler: FOUT } },
    )
    expect(signalen(container)).toEqual(['Wim Weg was minder dan 50% van de tijd aanwezig.'])
    expect(melding(container)).toEqual([nl.insights.signalenOnvolledig])
    expect(blok(container)!.querySelector('[role="alert"]')).toBeNull()
    const kinderen = Array.from(blok(container)!.children)
    expect(kinderen.at(-1)!.textContent).toBe(nl.insights.signalenOnvolledig)
  })

  it('AC16: zonder signalen en zonder fout verdwijnt het blok helemaal', async () => {
    const { container } = await renderInzichten(basis())
    expect(blok(container)).toBeNull()
    expect(printBlok(container).textContent).not.toContain(nl.insights.signalenTitle)
  })

  it('AC16: een afgekapte trainingstelling (901 trainingen) → geen opkomstsignaal en wel de melding', async () => {
    const veel = Array.from({ length: 901 }, (_, i) => ({
      event_id: `x${i}`, datum: datum('2026-08-01', i % 60), doelstelling: null, rpe: null, oordeel: null,
    }))
    const { container } = await renderInzichten(
      merge(basis(), { maandOpkomst: [{ maand: '2026-10', aanwezig: 90, afwezig: 10 }], evaluaties: veel }),
    )
    expect(signalen(container)).toEqual([])
    expect(melding(container)).toEqual([nl.insights.signalenOnvolledig])
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC18 — afgekapt (201 wedstrijden)', () => {
  const veel = (n: number): Partial<TeamData> => ({
    uitslagen: Array.from({ length: n }, (_, i) => uitslag(i, 3, 0)),
  })

  it('AC18: 201 wedstrijden → Doelsaldo, Punten en Clean sheets tonen de afgekapt-tekst, geen cijfer', async () => {
    const { container } = await renderInzichten(merge(basis(), veel(201)))
    for (const [id, label] of [['doelsaldo', 'Doelsaldo'], ['punten', 'Punten per wedstrijd'], ['cleansheets', 'Clean sheets']]) {
      expect(tegelTekst(container, id)).toEqual([label, 'Heel seizoen', nl.insights.afgekapt])
      expect(tegel(container, id).querySelector('p.font-display')).toBeNull()
    }
    // de overige tegels blijven gewoon een waarde tonen
    expect(tegelTekst(container, 'aanwezigheid')[2]).toBe('90%')
  })

  it('AC18: bij 201 wedstrijden komt er geen doelsaldo-signaal, maar wel de melding (O4)', async () => {
    const { container } = await renderInzichten(merge(basis(), veel(201)))
    expect(signalen(container)).toEqual([])
    expect(melding(container)).toEqual([nl.insights.signalenOnvolledig])
    expect(blok(container)!.textContent).not.toContain('doelsaldo')
  })

  it('AC18 (grens): precies 200 wedstrijden is niet afgekapt — cijfers en doelsaldo-signaal wél, geen melding', async () => {
    const { container } = await renderInzichten(merge(basis(), veel(200)))
    expect(tegelTekst(container, 'doelsaldo')).toEqual(['Doelsaldo', 'Heel seizoen', '+600', '600 voor · 0 tegen'])
    expect(tegelTekst(container, 'punten')[2]).toBe('3.00')
    expect(tegelTekst(container, 'cleansheets')[2]).toBe('200')
    expect(signalen(container)).toEqual(['Positief doelsaldo over 200 wedstrijden: 600 voor, 0 tegen.'])
    expect(melding(container)).toEqual([])
  })

  it('AC18: het Doelsaldo gebruikt dezelfde vlag en bron als de Thuis/uit-kaart (ook de kaart toont afgekapt)', async () => {
    const { container } = await renderInzichten(merge(basis(), veel(201)))
    const kaart = Array.from(container.querySelectorAll('h2')).find((h) => h.textContent === nl.insights.thuisUitTitle)!.closest('.surface-card')!
    expect(kaart.textContent).toContain(nl.insights.afgekapt)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC20 / AC23 / AC26 / AC27 — minima en grenzen', () => {
  const alsSignaal = async (data: Partial<TeamData>) => {
    const { container } = await renderInzichten(merge(basis(), data))
    const r = signalen(container)
    cleanup()
    return r
  }

  it('AC26: wegblijver vraagt minstens 4 registraties (3 → niets, 4 → signaal; 0/0 telt niet)', async () => {
    expect(await alsSignaal(wegblijver('Wim Weg', 0, 3))).toEqual([])
    expect(await alsSignaal(wegblijver('Wim Weg', 1, 3))).toEqual(['Wim Weg was minder dan 50% van de tijd aanwezig.'])
    expect(await alsSignaal(wegblijver('Wim Weg', 0, 4))).toEqual(['Wim Weg was minder dan 50% van de tijd aanwezig.'])
    expect(await alsSignaal(wegblijver('Wim Weg', 0, 0))).toEqual([])
  })

  it('AC26 (grens): precies 50% is geen wegblijver; 25% wel', async () => {
    expect(await alsSignaal(wegblijver('Wim Weg', 2, 2))).toEqual([])
    expect(await alsSignaal(wegblijver('Wim Weg', 1, 3))).toHaveLength(1)
  })

  it('AC26: twee wegblijvers → meervoudszin met aantal en de eerste naam', async () => {
    const r = await alsSignaal({
      aanwezigheidPerSpeler: [
        { player_id: 'a', naam: 'Anna', aanwezig: 0, afwezig: 5 },
        { player_id: 'b', naam: 'Bram', aanwezig: 1, afwezig: 5 },
        { player_id: 'c', naam: 'Cor', aanwezig: 0, afwezig: 3 },
      ],
    })
    expect(r).toEqual(['2 spelers waren minder dan 50% van de tijd aanwezig.'])
  })

  it('AC27 / AC23: opkomstsignaal pas bij minstens 3 trainingen in de laatste maand (2 → niets, ook niet bij 100%)', async () => {
    expect(await alsSignaal(opkomst(100, 2))).toEqual([])
    expect(await alsSignaal(opkomst(60, 2))).toEqual([])
    expect(await alsSignaal(opkomst(100, 3))).toEqual([`De trainingsopkomst haalt de norm: 100% in ${OKT}, boven de 85%.`])
    expect(await alsSignaal(opkomst(60, 3))).toEqual([`De trainingsopkomst staat op 60% in ${OKT} — onder de norm van 85%.`])
  })

  it('AC27 (grens): precies 85% is een compliment; 84% een let-op', async () => {
    expect(await alsSignaal(opkomst(85, 3))).toEqual([`De trainingsopkomst haalt de norm: 85% in ${OKT}, boven de 85%.`])
    expect(await alsSignaal(opkomst(84, 3))).toEqual([`De trainingsopkomst staat op 84% in ${OKT} — onder de norm van 85%.`])
  })

  it('AC27: de trainingen worden per maand geteld — trainingen van een andere maand tellen niet mee', async () => {
    const data = {
      maandOpkomst: [{ maand: '2026-10', aanwezig: 90, afwezig: 10 }],
      evaluaties: [...trainingen('2026-10', 2), ...trainingen('2026-09', 5)],
    }
    expect(await alsSignaal(data)).toEqual([])
  })

  it('AC27: dezelfde training telt één keer, ook als de evaluatiebron meerdere rijen met hetzelfde event_id geeft', async () => {
    const t = trainingen('2026-10', 2)
    expect(await alsSignaal({ maandOpkomst: [{ maand: '2026-10', aanwezig: 90, afwezig: 10 }], evaluaties: [...t, ...t] })).toEqual([])
  })

  it('AC27: de KPI Trainingsopkomst blijft de laatste maand tonen, ook als het signaal onder het minimum blijft', async () => {
    const { container } = await renderInzichten(merge(basis(), opkomst(100, 2)))
    expect(tegelTekst(container, 'opkomst')[2]).toBe('100%')
    expect(signalen(container)).toEqual([])
  })

  it('AC20: ratingtrend vraagt 10 beoordeelde wedstrijden (9 → niets, 10 → signaal)', async () => {
    const negen = Array.from({ length: 9 }, (_, i) => ({ event_id: `r${i}`, datum: datum('2026-08-01', i), tegenstander: null, gemiddelde: i < 4 ? 6.0 : 8.0, aantal: 12 }))
    expect(await alsSignaal({ teamRating: negen })).toEqual([])
    expect(await alsSignaal(rating(6.0, 8.0))).toEqual(['De teamrating stijgt met 2 over de laatste 5 wedstrijden.'])
  })

  it('AC20: een ratingverschil onder de ruisdrempel (0,2) geeft geen signaal; 0,5 wel', async () => {
    expect(await alsSignaal(rating(7.0, 7.25))).toEqual([])
    expect(await alsSignaal(rating(7.0, 7.5))).toEqual(['De teamrating stijgt met 0.5 over de laatste 5 wedstrijden.'])
  })

  it('AC20: doelsaldo vraagt 5 wedstrijden (4 → niets, 5 → signaal); saldo 0 geeft geen signaal', async () => {
    expect(await alsSignaal({ uitslagen: uitslagen([[1, 0], [1, 0], [1, 0], [1, 0]]) })).toEqual([])
    expect(await alsSignaal(saldoPositief())).toHaveLength(1)
    expect(await alsSignaal({ uitslagen: uitslagen([[1, 1], [1, 1], [1, 1], [1, 1], [1, 1]]) })).toEqual([])
  })

  it('AC20: stijgers/dalers vragen 8 beoordelingen (7 → niets, 8 → signaal)', async () => {
    expect(await alsSignaal({ ratingVorm: [vormRij('s', 'Sven', 7.0, 7.6, 7)] })).toEqual([])
    expect(await alsSignaal({ ratingVorm: [vormRij('s', 'Sven', 7.0, 7.6, 8)] })).toHaveLength(1)
    expect(await alsSignaal({ ratingVorm: [vormRij('d', 'Daan', 7.6, 7.0, 7)] })).toEqual([])
    expect(await alsSignaal({ ratingVorm: [vormRij('d', 'Daan', 7.6, 7.0, 8)] })).toHaveLength(1)
  })

  it('AC20 (grens): een verschil van precies 0,3 telt (stijger en daler); 0,29 niet', async () => {
    expect(await alsSignaal({ ratingVorm: [vormRij('s', 'Sven', 7.0, 7.3)] })).toEqual([
      'Sven stijgt: de laatste 5 wedstrijden liggen 0.3 boven het eigen seizoensgemiddelde.',
    ])
    expect(await alsSignaal({ ratingVorm: [vormRij('d', 'Daan', 7.3, 7.0)] })).toEqual([
      'Daan daalt: de laatste 5 wedstrijden liggen 0.3 onder het eigen seizoensgemiddelde.',
    ])
    expect(await alsSignaal({ ratingVorm: [vormRij('s', 'Sven', 7.0, 7.29)] })).toEqual([])
  })

  it('AC20 (grens, bestaande regel): teamrating-verschil van exact 0,3 geeft een signaal', async () => {
    // Ratings 7.0 en 7.3: float-ruis (7.3 − 7.0 = 0.2999…) mag de grens niet laten missen.
    expect(await alsSignaal(rating(7.0, 7.3))).toEqual(['De teamrating stijgt met 0.3 over de laatste 5 wedstrijden.'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('K1/K2 — afronding van de ratingdelta (teamRatingTrend)', () => {
  it('K2: ruis rond 0 (5× 7,0 dan 5× 7,001) toont "0.0" met neutrale toon op de rating-tegel en geeft geen rating-signaal', async () => {
    const { container } = await renderInzichten(merge(basis(), rating(7.0, 7.001)))
    const t = tegelTekst(container, 'rating')
    expect(t[3]).toBe('0.0 t.o.v. de 5 daarvoor')
    expect(t[3]).not.toContain('+')
    expect(rail(container, 'rating')).toBe('var(--faint)')
    const detail = Array.from(tegel(container, 'rating').querySelectorAll('p')).at(-1) as HTMLElement
    expect(detail.style.color).toBe('var(--faint)')
    expect(signalen(container)).toEqual([])
  })

  it('K1: door de afronding geeft 0,296 wél een signaal ("0.3"); 0,29 niet (praktische grens ~0,295)', async () => {
    const wel = await renderInzichten(merge(basis(), rating(7.0, 7.296)))
    expect(signalen(wel.container)).toEqual(['De teamrating stijgt met 0.3 over de laatste 5 wedstrijden.'])
    cleanup()
    const niet = await renderInzichten(merge(basis(), rating(7.0, 7.29)))
    expect(signalen(niet.container)).toEqual([])
  })
})

describe('AC21 — null is geen 0', () => {
  it('AC21: zonder uitslagen, rating en maandopkomst tonen de tegels "—" met "Nog geen data" (nooit 0)', async () => {
    const { container } = await renderInzichten(basis())
    expect(tegelTekst(container, 'opkomst')).toEqual(['Trainingsopkomst', 'Laatste maand', '—', 'Nog geen data'])
    expect(tegelTekst(container, 'rating')).toEqual(['Gem. teamrating', 'Heel seizoen', '—', 'Nog geen data'])
    expect(tegelTekst(container, 'doelsaldo')).toEqual(['Doelsaldo', 'Heel seizoen', '—', 'Nog geen data'])
    expect(tegelTekst(container, 'punten')).toEqual(['Punten per wedstrijd', 'Heel seizoen', '—', 'Nog geen data'])
    expect(tegelTekst(container, 'cleansheets')).toEqual(['Clean sheets', 'Heel seizoen', '—', 'Nog geen data'])
    expect(signalen(container)).toEqual([])
  })

  it('AC21: een echte 0 blijft een 0 — geen clean sheets bij wél wedstrijden toont "0", niet "—"', async () => {
    const { container } = await renderInzichten(merge(basis(), { uitslagen: uitslagen([[1, 1], [0, 2]]) }))
    expect(tegelTekst(container, 'cleansheets')).toEqual(['Clean sheets', 'Heel seizoen', '0', 'van 2 wedstrijden'])
    expect(tegelTekst(container, 'punten')[2]).toBe('0.50')
  })

  it('AC21: een teamrating-signaal zonder genoeg wedstrijden telt niet als 0 mee (geen daling of stijging)', async () => {
    const { container } = await renderInzichten(merge(basis(), { teamRating: ratingReeks(7, 7, 2) }))
    expect(signalen(container)).toEqual([])
    expect(tegelTekst(container, 'rating')[3]).toBe('over 4 wedstrijden')
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC22 — lege staat', () => {
  const geenData = () => ({ aanwezigheid: [{ aanwezig: 0, afwezig: 0 }] })

  it('AC22: zonder enige data blijft de lege staat; geen KPI-strook, geen signalenblok, geen rapport', async () => {
    const { container } = await renderInzichten(geenData())
    expect(container.textContent).toContain(nl.insights.geenDataTitle)
    expect(strook(container)).toBeNull()
    expect(blok(container)).toBeNull()
    expect(container.querySelector('[data-print-only]')).toBeNull()
  })

  it('AC22: een nieuwe bron telt alleen mee met echte data — spelers, posities en rating-vorm alleen houden de lege staat', async () => {
    const { container } = await renderInzichten({
      ...geenData(),
      players: [speler('k1', 'Karel Keeper', 'Keeper', { injured: true })],
      ratingVorm: [vormRij('s1', 'Sven Stijger', 7.0, 7.6)],
      evaluaties: trainingen('2026-10', 4),
    })
    expect(container.textContent).toContain(nl.insights.geenDataTitle)
    expect(strook(container)).toBeNull()
  })

  it('AC22: aanwezigheid 0/0 (percentage null) telt niet als data; één echte registratie wel', async () => {
    const leeg = await renderInzichten({ aanwezigheid: [{ aanwezig: 0, afwezig: 0 }] })
    expect(strook(leeg.container)).toBeNull()
    cleanup()
    const vol = await renderInzichten({ aanwezigheid: [{ aanwezig: 1, afwezig: 0 }] })
    expect(strook(vol.container)).not.toBeNull()
    expect(tegelTekst(vol.container, 'aanwezigheid')[2]).toBe('100%')
  })

  it('AC22: met data maar zonder signalen verdwijnt het signalenblok op scherm én in het rapport', async () => {
    const { container } = await renderInzichten(basis())
    expect(blok(container)).toBeNull()
    expect(rapportSignalen(container)).toEqual([])
    expect(printBlok(container).textContent).not.toContain(nl.insights.signalenTitle)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC24 / O5 — scherm en rapport', () => {
  it('AC24: het rapport toont dezelfde Doelsaldo-waarde als het scherm (één bron: thuisUit.totaal)', async () => {
    const { container } = await renderInzichten(rijk())
    expect(tegelTekst(container, 'doelsaldo').slice(2)).toEqual(['+6', '12 voor · 6 tegen'])
    expect(rapportKpi(container, 'Doelsaldo')).toEqual(['Doelsaldo', '+6', '12 voor · 6 tegen'])
  })

  it('AC24: Totale aanwezigheid en Trainingsopkomst hebben dezelfde waarde en het nieuwe label op scherm en rapport', async () => {
    const { container } = await renderInzichten(rijk())
    expect(rapportKpi(container, 'Totale aanwezigheid')![1]).toBe('84%')
    expect(rapportKpi(container, 'Trainingsopkomst')![1]).toBe('90%')
    expect(printBlok(container).textContent).not.toContain('Aanwezigheid seizoen')
  })

  it('O5: bij een uitslagen-fout toont het rapport-Doelsaldo "—", nooit een cijfer', async () => {
    const { container } = await renderInzichten(rijk(), { rpcErrors: { inzichten_wedstrijd_uitslagen: FOUT } })
    expect(rapportKpi(container, 'Doelsaldo')).toEqual(['Doelsaldo', '—', 'Nog geen data'])
  })

  it('O5: bij afgekapte uitslagen (201) toont het rapport-Doelsaldo "—" en nooit een gedeeltelijk cijfer', async () => {
    const { container } = await renderInzichten(
      merge(basis(), { uitslagen: Array.from({ length: 201 }, (_, i) => uitslag(i, 3, 0)) }),
    )
    expect(rapportKpi(container, 'Doelsaldo')).toEqual(['Doelsaldo', '—', 'Nog geen data'])
    expect(printBlok(container).textContent).not.toContain('+603')
    expect(printBlok(container).textContent).not.toContain('603 voor')
  })

  it('O5: zonder fout of afkapping toont het rapport het echte saldo (200 wedstrijden)', async () => {
    const { container } = await renderInzichten(
      merge(basis(), { uitslagen: Array.from({ length: 200 }, (_, i) => uitslag(i, 3, 0)) }),
    )
    expect(rapportKpi(container, 'Doelsaldo')).toEqual(['Doelsaldo', '+600', '600 voor · 0 tegen'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC25 — gasten en inactieven (positiesignaal)', () => {
  it('AC25: een geblesseerde gast of inactieve speler maakt een positie niet bezet — geen signaal', async () => {
    const { container } = await renderInzichten(
      merge(basis(), {
        players: [
          speler('g1', 'Gerrit Gast', 'Keeper', { type: 'guest', injured: true }),
          speler('i1', 'Ivo Inactief', 'Spits', { active: false, injured: true }),
        ],
      }),
    )
    expect(blok(container)).toBeNull()
  })

  it('AC25: een fitte gast dekt een positie niet af — de vaste speler die geblesseerd is, blijft een signaal', async () => {
    const { container } = await renderInzichten(
      merge(basis(), {
        players: [
          speler('k1', 'Karel Keeper', 'Keeper', { injured: true }),
          speler('g1', 'Gerrit Gast', 'Keeper', { type: 'guest' }),
        ],
      }),
    )
    expect(signalen(container)).toEqual(['Voor Keeper is op dit moment geen fitte speler.'])
  })

  it('AC25: de players-query voor de positiedekking filtert op team, actief en vast', async () => {
    const { container } = await renderInzichten(merge(basis(), {}), {
      anderen: { [ANDER]: { players: [speler('x1', 'Xavi Ander', 'Keeper', { team_id: ANDER, injured: true })] } },
      members: [{ team_id: TEAM, user_id: 'u1', rol: 'owner' }],
    })
    expect(blok(container)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC28 — vensters en periodekiezer', () => {
  const VERLEDEN_END = '2026-10-14'
  const venstersPer: Record<string, { venster: [string, string]; verleden: [string, string] }> = {
    seizoen: { venster: [S, E], verleden: [S, VERLEDEN_END] },
    '4w': { venster: ['2026-09-18', E], verleden: ['2026-09-18', VERLEDEN_END] },
    '8w': { venster: ['2026-08-21', E], verleden: ['2026-08-21', VERLEDEN_END] },
  }
  const VERLEDEN = [
    'inzichten_aanwezigheid', 'inzichten_training_opkomst_per_maand', 'inzichten_aanwezigheid_per_speler',
    'inzichten_speelkansen', 'inzichten_training_opkomst_per_speler', 'inzichten_blessures_per_maand',
    'inzichten_training_koppelingen', 'inzichten_invul_discipline', 'inzichten_training_evaluaties',
  ]
  const VENSTER = [
    'inzichten_rating_team_per_wedstrijd', 'inzichten_rating_per_speler', 'inzichten_wedstrijd_uitslagen',
    'inzichten_speler_momenten', 'inzichten_doelpunten_per_minuut', 'inzichten_tegendoelpunten',
    'inzichten_speelminuten_per_speler',
  ]

  it.each(['seizoen', '4w', '8w'])('AC28: periode %s → elke RPC krijgt zijn bestaande venster en p_team_id (verleden / gekozen venster / hele seizoen)', async (periode) => {
    const v = venstersPer[periode]
    const { rpcCalls } = await renderInzichten(rijk(), { periode: periode === 'seizoen' ? undefined : periode })
    expect(rpcCalls).toHaveLength(17)
    for (const c of rpcCalls) {
      expect(c.args.p_team_id).toBe(TEAM)
      expect(Object.keys(c.args)).not.toContain('p_player')
      if (VERLEDEN.includes(c.name)) expect([c.args.p_start, c.args.p_end], c.name).toEqual(v.verleden)
      else if (VENSTER.includes(c.name)) expect([c.args.p_start, c.args.p_end], c.name).toEqual(v.venster)
      else {
        expect(c.name).toBe('inzichten_rating_vorm_per_speler')
        expect(c.args).toEqual({ p_team_id: TEAM, p_start: S, p_end: E, p_recent: 5 })
      }
    }
    expect(rpcCalls.map((c) => c.name).sort()).toEqual([...VERLEDEN, ...VENSTER, 'inzichten_rating_vorm_per_speler'].sort())
  })

  it('AC28: de periodekiezer is ongewijzigd — drie links, de actieve met aria-current', async () => {
    const { container } = await renderInzichten(rijk(), { periode: '8w' })
    const groep = container.querySelector(`[role="group"][aria-label="${nl.insights.periodeLabel}"]`) as HTMLElement
    const links = Array.from(groep.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')])
    expect(links).toEqual([
      [nl.insights.periode4w, '/inzichten?periode=4w', null],
      [nl.insights.periode8w, '/inzichten?periode=8w', 'page'],
      [nl.insights.periodeSeizoen, '/inzichten', null],
    ])
  })

  it('AC28: een onbekende periode valt terug op het hele seizoen (venstergedrag ongewijzigd)', async () => {
    const { container, rpcCalls } = await renderInzichten(rijk(), { periode: 'onzin' })
    expect(tegelTekst(container, 'doelsaldo')[1]).toBe(nl.insights.periodeSeizoen)
    expect(rpcCalls.find((c) => c.name === 'inzichten_wedstrijd_uitslagen')!.args).toMatchObject({ p_start: S, p_end: E })
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC29 — vijf talen', () => {
  type T = {
    aanw: string; punten: string; clean: string; venster: (m: string) => string; leeg: string; onvolledig: string
    stijger: string; stijgers: string; daler: string; dalers: string; positie: string; posities: string
    keeper: string
  }
  // Letterlijk uit brief §5.3 (es/de-positietekst volgt de bestaande dekkingGeen-vertaling).
  const L: Record<string, T> = {
    nl: {
      aanw: 'Totale aanwezigheid', punten: 'Punten per wedstrijd', clean: 'Clean sheets',
      venster: (m) => `Laatste maand (${m})`, leeg: 'Laatste maand', onvolledig: 'Een deel van de signalen kon niet worden berekend.',
      stijger: '{naam} stijgt: de laatste {venster} wedstrijden liggen {verschil} boven het eigen seizoensgemiddelde.',
      stijgers: '{aantal} spelers stijgen ten opzichte van hun seizoensgemiddelde, het sterkst {naam}.',
      daler: '{naam} daalt: de laatste {venster} wedstrijden liggen {verschil} onder het eigen seizoensgemiddelde.',
      dalers: '{aantal} spelers dalen ten opzichte van hun seizoensgemiddelde, het sterkst {naam}.',
      positie: 'Voor {positie} is op dit moment geen fitte speler.', posities: 'Voor {aantal} posities is op dit moment geen fitte speler.',
      keeper: 'Keeper',
    },
    en: {
      aanw: 'Overall attendance', punten: 'Points per match', clean: 'Clean sheets',
      venster: (m) => `Latest month (${m})`, leeg: 'Latest month', onvolledig: 'Some signals could not be calculated.',
      stijger: '{naam} is rising: the last {venster} matches are {verschil} above their season average.',
      stijgers: '{aantal} players are rising compared with their season average, most of all {naam}.',
      daler: '{naam} is dropping: the last {venster} matches are {verschil} below their season average.',
      dalers: '{aantal} players are dropping compared with their season average, most of all {naam}.',
      positie: 'There is currently no fit player for {positie}.', posities: 'There is currently no fit player for {aantal} positions.',
      keeper: 'Goalkeeper',
    },
    de: {
      aanw: 'Gesamtanwesenheit', punten: 'Punkte pro Spiel', clean: 'Zu-null-Spiele',
      venster: (m) => `Letzter Monat (${m})`, leeg: 'Letzter Monat', onvolledig: 'Ein Teil der Hinweise konnte nicht berechnet werden.',
      stijger: '{naam} steigt: die letzten {venster} Spiele liegen {verschil} über dem eigenen Saisonschnitt.',
      stijgers: '{aantal} Spieler steigen gegenüber ihrem Saisonschnitt, am stärksten {naam}.',
      daler: '{naam} fällt: die letzten {venster} Spiele liegen {verschil} unter dem eigenen Saisonschnitt.',
      dalers: '{aantal} Spieler fallen gegenüber ihrem Saisonschnitt, am stärksten {naam}.',
      positie: 'Für {positie} gibt es derzeit keinen fitten Spieler.', posities: 'Für {aantal} Positionen gibt es derzeit keinen fitten Spieler.',
      keeper: 'Torwart',
    },
    es: {
      aanw: 'Asistencia total', punten: 'Puntos por partido', clean: 'Porterías a cero',
      venster: (m) => `Último mes (${m})`, leeg: 'Último mes', onvolledig: 'No se ha podido calcular una parte de las señales.',
      stijger: '{naam} sube: los últimos {venster} partidos están {verschil} por encima de su media de la temporada.',
      stijgers: '{aantal} jugadores suben respecto a su media de la temporada, sobre todo {naam}.',
      daler: '{naam} baja: los últimos {venster} partidos están {verschil} por debajo de su media de la temporada.',
      dalers: '{aantal} jugadores bajan respecto a su media de la temporada, sobre todo {naam}.',
      positie: 'Ahora mismo no hay ningún jugador en forma para {positie}.', posities: 'Ahora mismo no hay ningún jugador en forma para {aantal} posiciones.',
      keeper: 'Portero',
    },
    fr: {
      aanw: 'Présence totale', punten: 'Points par match', clean: 'Matchs sans but encaissé',
      venster: (m) => `Dernier mois (${m})`, leeg: 'Dernier mois', onvolledig: "Une partie des signaux n'a pas pu être calculée.",
      stijger: '{naam} progresse : les {venster} derniers matchs sont {verschil} au-dessus de sa moyenne de la saison.',
      stijgers: '{aantal} joueurs progressent par rapport à leur moyenne de la saison, surtout {naam}.',
      daler: '{naam} recule : les {venster} derniers matchs sont {verschil} en dessous de sa moyenne de la saison.',
      dalers: '{aantal} joueurs reculent par rapport à leur moyenne de la saison, surtout {naam}.',
      positie: 'Aucun joueur apte pour {positie} actuellement.', posities: 'Aucun joueur apte pour {aantal} postes actuellement.',
      keeper: 'Gardien de but',
    },
  }
  const vul = (tpl: string, v: Record<string, string | number>) =>
    Object.entries(v).reduce((s, [k, w]) => s.split(`{${k}}`).join(String(w)), tpl)
  const talen = Object.keys(L)

  // Data zonder opkomst-/saldo-/ratingsignaal maar met alle tegels gevuld.
  const tegelData = (): Partial<TeamData> => ({
    maandOpkomst: [{ maand: '2026-10', aanwezig: 80, afwezig: 20 }],
    evaluaties: trainingen('2026-10', 2),
    uitslagen: uitslagen([[1, 0], [0, 0], [2, 2], [0, 1]]),
  })

  it.each(talen)('AC29 / AC4 (%s): labels, vensterlabels en bronFout/afgekapt in de taal; geen restant {…}', async (taal) => {
    const { container } = await renderInzichten(merge(basis(), tegelData()), { locale: taal })
    const maand = (await import('@/lib/inzichten')).maandLabel('2026-10', dicts[taal].browserLocale)
    expect(tegelTekst(container, 'aanwezigheid')[0]).toBe(L[taal].aanw)
    expect(tegelTekst(container, 'punten')[0]).toBe(L[taal].punten)
    expect(tegelTekst(container, 'cleansheets')[0]).toBe(L[taal].clean)
    expect(tegelTekst(container, 'opkomst')[1]).toBe(L[taal].venster(maand))
    expect(tegelTekst(container, 'aanwezigheid')[1]).toBe(dicts[taal].insights.periodeSeizoen)
    expect(strook(container)!.textContent).not.toMatch(/\{[a-zA-Z]+\}/)
    // geen titel-botsing: elk KPI-label komt precies één keer voor op het scherm
    const leaf = (txt: string) => Array.from(container.querySelectorAll('.print\\:hidden *')).filter((e) => e.children.length === 0 && e.textContent === txt)
    for (const label of [L[taal].aanw, L[taal].punten, L[taal].clean]) expect(leaf(label), label).toHaveLength(1)
    cleanup()
    const leeg = await renderInzichten(basis(), { locale: taal })
    expect(tegelTekst(leeg.container, 'opkomst')[1]).toBe(L[taal].leeg)
    cleanup()
    const stuk = await renderInzichten(merge(basis(), tegelData()), { locale: taal, rpcErrors: { inzichten_wedstrijd_uitslagen: FOUT } })
    expect(tegelTekst(stuk.container, 'punten')[2]).toBe(dicts[taal].insights.bronFout)
    cleanup()
    const veel = await renderInzichten(merge(basis(), { uitslagen: Array.from({ length: 201 }, (_, i) => uitslag(i, 1, 0)) }), { locale: taal })
    expect(tegelTekst(veel.container, 'punten')[2]).toBe(dicts[taal].insights.afgekapt)
    expect(blok(veel.container)!.textContent).toContain(L[taal].onvolledig)
  })

  it.each(['en', 'de', 'es', 'fr'])('AC29 (%s): de vertaalde labels zijn niet gelijk aan het Nederlands (behalve de Engelse term "Clean sheets", O7)', (taal) => {
    expect(L[taal].aanw).not.toBe(L.nl.aanw)
    expect(L[taal].punten).not.toBe(L.nl.punten)
    if (taal !== 'en') expect(L[taal].clean).not.toBe(L.nl.clean)
    expect(dicts[taal].insights.kpiAanwezigheidLabel).toBe(L[taal].aanw)
  })

  it.each(talen)('AC29 / AC8 (%s): enkelvoudssignalen met vertaalde positie — scherm én rapport, geen restant {…}', async (taal) => {
    const { container } = await renderInzichten(merge(basis(), vorm(vormRij('d1', 'Daan Daler', 7.5, 7.0), vormRij('s1', 'Sven Stijger', 7.0, 7.6)), keeperGeblesseerd()), { locale: taal })
    const verwacht = [
      vul(L[taal].daler, { naam: 'Daan Daler', venster: 5, verschil: '0.5' }),
      vul(L[taal].positie, { positie: L[taal].keeper }),
      vul(L[taal].stijger, { naam: 'Sven Stijger', venster: 5, verschil: '0.6' }),
    ]
    expect(signalen(container)).toEqual(verwacht)
    expect(rapportSignalen(container)).toEqual(verwacht)
    for (const zin of verwacht) expect(zin).not.toMatch(/\{[a-z]+\}/)
    // de vertaalde positie staat er, de kale Nederlandse sleutel niet (behalve in het Nederlands zelf)
    if (taal !== 'nl') expect(blok(container)!.textContent).not.toContain('Keeper')
  })

  it.each(talen)('AC29 (%s): meervoudssignalen (dalers, posities, stijgers) in de taal — scherm én rapport', async (taal) => {
    const { container } = await renderInzichten(
      merge(basis(), {
        ratingVorm: [
          vormRij('d1', 'Dirk Daler', 7.5, 7.1), vormRij('d2', 'Daan Daler', 7.5, 7.0),
          vormRij('s1', 'Stef Stijger', 7.0, 7.4), vormRij('s2', 'Sven Stijger', 7.0, 7.6),
        ],
        players: [speler('1', 'A', 'Keeper', { injured: true }), speler('2', 'B', 'Spits', { injured: true })],
      }),
      { locale: taal },
    )
    const verwacht = [
      vul(L[taal].dalers, { aantal: 2, naam: 'Daan Daler' }),
      vul(L[taal].posities, { aantal: 2 }),
      vul(L[taal].stijgers, { aantal: 2, naam: 'Sven Stijger' }),
    ]
    expect(signalen(container)).toEqual(verwacht)
    expect(rapportSignalen(container)).toEqual(verwacht)
  })

  it.each(talen)('AC29 / AC16 (%s): de onvolledig-melding staat in de taal', async (taal) => {
    const { container } = await renderInzichten(basis(), { locale: taal, rpcErrors: { inzichten_rating_vorm_per_speler: FOUT } })
    expect(melding(container)).toEqual([L[taal].onvolledig])
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC30 — geen oordeel in de kaarten', () => {
  it('AC30: het kaartengebied bevat geen conclusielaag, geen signaalzinnen en geen onvolledig-melding', async () => {
    const { container } = await renderInzichten(rijk(), { rpcErrors: { inzichten_rating_vorm_per_speler: FOUT } })
    const grid = container.querySelector('.print\\:hidden > .grid.grid-cols-1') as HTMLElement
    expect(grid).not.toBeNull()
    expect(grid.querySelector('[data-conclusielaag]')).toBeNull()
    expect(grid.querySelector('[data-kpi]')).toBeNull()
    expect(grid.textContent).not.toContain(nl.insights.signalenOnvolledig)
    for (const zin of signalen(container)) expect(grid.textContent).not.toContain(zin)
    expect(grid.textContent).not.toContain(nl.insights.signalenTitle)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC31 / AC32 — rollen en tenant', () => {
  const teamEen = (): Partial<TeamData> =>
    merge(basis(), wegblijver('Piet Peters'), daler('Daan Daler'), { uitslagen: uitslagen([[2, 0], [1, 0]]) })
  const teamTwee = (): Partial<TeamData> => ({
    aanwezigheid: [{ aanwezig: 1, afwezig: 99 }],
    aanwezigheidPerSpeler: [{ player_id: 'z1', naam: 'Zora Ander', aanwezig: 0, afwezig: 9 }],
    ratingVorm: [vormRij('z2', 'Zeno Ander', 7.5, 7.0)],
    teamRating: ratingReeks(5, 9),
    uitslagen: uitslagen([[9, 0], [9, 0], [9, 0]]),
    players: [speler('z3', 'Zita Ander', 'Spits', { team_id: ANDER, injured: true })],
    maandOpkomst: [{ maand: '2026-10', aanwezig: 1, afwezig: 99 }],
    evaluaties: trainingen('2026-10', 5, 'z'),
  })
  const beide = [
    { team_id: TEAM, user_id: 'u1', rol: 'owner' },
    { team_id: ANDER, user_id: 'u1', rol: 'owner' },
  ]

  it('AC32: een gebruiker in twee teams ziet in KPI-strook, signalen en rapport alleen het actieve team', async () => {
    const { container, rpcCalls } = await renderInzichten(teamEen(), {
      anderen: { [ANDER]: teamTwee() }, members: beide, activeTeam: TEAM,
    })
    const conclusie = Array.from(container.querySelectorAll('[data-conclusielaag]')).map((e) => e.textContent).join(' ')
    for (const lek of ['Zora', 'Zeno', 'Zita', 'Ander']) {
      expect(conclusie).not.toContain(lek)
      expect(printBlok(container).textContent).not.toContain(lek)
    }
    expect(signalen(container)).toEqual([
      'Piet Peters was minder dan 50% van de tijd aanwezig.',
      'Daan Daler daalt: de laatste 5 wedstrijden liggen 0.5 onder het eigen seizoensgemiddelde.',
    ])
    expect(tegelTekst(container, 'aanwezigheid')[2]).toBe('90%')
    expect(tegelTekst(container, 'punten')[2]).toBe('3.00')
    expect(rpcCalls.every((c) => c.args.p_team_id === TEAM)).toBe(true)
  })

  it('AC32: schakelt de gebruiker naar het andere team, dan zijn alleen díe gegevens zichtbaar (en niets van team 1)', async () => {
    const { container, rpcCalls } = await renderInzichten(teamEen(), {
      anderen: { [ANDER]: teamTwee() }, members: beide, activeTeam: ANDER,
    })
    const conclusie = Array.from(container.querySelectorAll('[data-conclusielaag]')).map((e) => e.textContent).join(' ')
    for (const lek of ['Piet', 'Daan']) {
      expect(conclusie).not.toContain(lek)
      expect(printBlok(container).textContent).not.toContain(lek)
    }
    expect(signalen(container)[0]).toContain('Zora Ander')
    expect(tegelTekst(container, 'punten')[2]).toBe('3.00')
    expect(tegelTekst(container, 'aanwezigheid')[2]).toBe('1%')
    expect(rpcCalls.every((c) => c.args.p_team_id === ANDER)).toBe(true)
  })

  it('AC31: een assistent (geen eigenaar, geen bewerkrechten) ziet dezelfde KPI\'s en signalen, inclusief spelersnamen', async () => {
    const eigenaar = await renderInzichten(teamEen())
    const alsEigenaar = { signalen: signalen(eigenaar.container), tegels: strook(eigenaar.container)!.textContent }
    cleanup()
    const assistent = await renderInzichten(teamEen(), { members: [{ team_id: TEAM, user_id: 'u1', rol: 'assistent' }] })
    expect(signalen(assistent.container)).toEqual(alsEigenaar.signalen)
    expect(strook(assistent.container)!.textContent).toBe(alsEigenaar.tegels)
    expect(signalen(assistent.container)[0]).toContain('Piet Peters')
  })
})

// ═══════════════════════════════════════════════════════════════════════
const TZS = ['Europe/Amsterdam', 'America/Los_Angeles', 'Pacific/Auckland']
const TIJDEN: [number, number][] = [[0, 30], [12, 0], [23, 30]]

describe.each(TZS)('AC35–AC37 — tijdzone %s', (tz) => {
  beforeEach(() => {
    process.env.TZ = tz
  })

  // Vandaag = 2026-11-01 (maandgrens). De laatste volledige maand is oktober;
  // de trainingen staan op de randen van september/oktober. Alle datums zijn
  // kale 'YYYY-MM-DD'-strings; een Date-parse zou in LA 2026-10-01 naar
  // 30 september verschuiven.
  const data = (): Partial<TeamData> => ({
    aanwezigheid: [{ aanwezig: 9, afwezig: 1 }],
    maandOpkomst: [
      { maand: '2026-09', aanwezig: 70, afwezig: 30 },
      { maand: '2026-10', aanwezig: 90, afwezig: 10 },
    ],
    evaluaties: [
      { event_id: 'a', datum: '2026-09-30', doelstelling: null, rpe: null, oordeel: null },
      { event_id: 'b', datum: '2026-10-01', doelstelling: null, rpe: null, oordeel: null },
      { event_id: 'c', datum: '2026-10-02', doelstelling: null, rpe: null, oordeel: null },
      { event_id: 'd', datum: '2026-10-31', doelstelling: null, rpe: null, oordeel: null },
    ],
  })

  it('TZ-controle: de tijdzone is echt gewisseld', () => {
    const offset = new Date(2026, 9, 15, 12, 0).getTimezoneOffset()
    expect(offset).toBe(tz === 'Europe/Amsterdam' ? -120 : tz === 'America/Los_Angeles' ? 420 : -780)
  })

  it.each(TIJDEN)('AC35–AC37: om %i:%i lokaal — maandlabel, trainingstelling per maand (3 in oktober) en RPC-venster zijn tijdzone-onafhankelijk', async (uur, min) => {
    const { container, rpcCalls } = await renderInzichten(data(), { klok: { datum: '2026-11-01', uur, min } })
    // todayLocal() = 2026-11-01 → verleden eindigt op 2026-10-31, in elke tijdzone
    for (const naam of ['inzichten_training_opkomst_per_maand', 'inzichten_training_evaluaties', 'inzichten_aanwezigheid']) {
      expect(rpcCalls.find((c) => c.name === naam)!.args).toMatchObject({ p_start: S, p_end: '2026-10-31' })
    }
    expect(tegelTekst(container, 'opkomst')[1]).toBe(`Laatste maand (${OKT})`)
    // oktober heeft 3 trainingen (b, c, d), september 1 (a) → het compliment verschijnt
    expect(signalen(container)).toEqual([`De trainingsopkomst haalt de norm: 90% in ${OKT}, boven de 85%.`])
    expect(rapportSignalen(container)).toEqual(signalen(container))
    expect(melding(container)).toEqual([])
  })

  it.each(TIJDEN)('AC36: om %i:%i lokaal — op de laatste dag van de maand blijft de maand ongewijzigd', async (uur, min) => {
    const { container, rpcCalls } = await renderInzichten(data(), { klok: { datum: '2026-10-31', uur, min } })
    expect(rpcCalls.find((c) => c.name === 'inzichten_training_evaluaties')!.args).toMatchObject({ p_end: '2026-10-30' })
    // evaluaties t/m 30 oktober: b en c (2 trainingen) → onder het minimum van 3
    expect(signalen(container)).toEqual([])
    expect(tegelTekst(container, 'opkomst')[1]).toBe(`Laatste maand (${OKT})`)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('AC39 — print:hidden en hidden print:block', () => {
  it('AC39: de KPI-strook en het signalenblok staan in het print:hidden-schermblok, het rapport in hidden print:block', async () => {
    const { container } = await renderInzichten(rijk())
    const scherm = container.querySelector('.print\\:hidden') as HTMLElement
    expect(scherm.contains(strook(container))).toBe(true)
    expect(scherm.contains(blok(container))).toBe(true)
    expect(scherm.querySelector('[data-print-only]')).toBeNull()
    const rapport = printBlok(container)
    expect(rapport.className).toContain('hidden')
    expect(rapport.className).toContain('print:block')
    expect(rapport.querySelector('[data-conclusielaag]')).toBeNull()
  })
})
