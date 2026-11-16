// Acceptatietests — F3 "Inzichten inkorten" (/inzichten): "Wat valt op" met
// gekoppelde grafiek + actie, kaarten per thema in native <details>, en
// scroll-indicatie. Bron: ff-snelle-winst/f3-02-story.md (criteria 1-34,
// besluiten B1-B4) en f3-03-brief.md (besluiten 1-6; bij verschil wint de brief).
//
// Methode: identiek aan inzichten-conclusielaag.acceptance.test.tsx — de ECHTE
// app/inzichten/page.tsx wordt gerenderd met alleen supabase/next gestubd; de
// RPC's geven de rijen van het team in `args.p_team_id` terug. jsdom heeft geen
// layout: "dicht" toets ik via het `open`-attribuut van <details>, en de
// scrollranden via gesimuleerde scrollWidth/clientWidth (zie describe C).
//
// ── Criterium → test-mapping (nummering van de story; "Cn:" staat in elke testnaam) ──
//   C1-C5   → describe('A. Wat valt op')
//   C6-C10  → describe('B. Thema\'s')
//   C11-C14 → describe('C. Scroll-indicatie')           (gesimuleerde maten)
//   C15-C20 → describe('D. Faalpaden')
//   C21-C24 → describe('E. Businessregels')
//   C25-C28 → describe('F. Rechten en privacy')
//   C29-C31 → describe('G. Print en PDF')
//   C32-C34 → describe('H. Mobiel')                    (alleen structuur)
//
// NIET in jsdom te toetsen (browser, door de orkestrator): visueel dicht/open,
// zichtbare fade, mobiele hoogte (C32 streefdoel <= ~3 schermhoogtes),
// daadwerkelijke tikgrootte (C33), horizontale pagina-scroll (C34),
// group-open:rotate-180, shadow-none!, sticky-kolom-inset (C13), echte swipe,
// toetsenbord op <summary> (native browsergedrag). C31 (seizoensrapport-,
// delen-als-pdf- en api/pdf-tests ongewijzigd groen) is de volledige suite:
// zie rapport. C21 (unit-tests ongewijzigd) idem.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within, waitFor } from '@testing-library/react'
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
  zelfreviews: Row[]
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
  inzichten_eigen_zelfreviews: 'zelfreviews',
}
// Bronnen met een `datum`-kolom: de handler filtert op p_start/p_end, zoals de SQL.
const MET_DATUM = new Set<keyof TeamData>(['teamRating', 'uitslagen', 'koppelingen', 'discipline', 'evaluaties', 'zelfreviews'])
// Bronnen met een `totaal`-kolom (afkap-detectie fase 3, SQL: count(*) over ()).
const MET_TOTAAL = new Set<keyof TeamData>(['koppelingen', 'discipline', 'evaluaties', 'zelfreviews'])

function leegTeam(): TeamData {
  return {
    aanwezigheid: [], maandOpkomst: [], teamRating: [], ratingPerSpeler: [], aanwezigheidPerSpeler: [],
    uitslagen: [], spelerMomenten: [], doelpuntMinuten: [], tegendoelpunten: [], speelkansen: [],
    ratingVorm: [], trainingOpkomst: [], blessures: [], speelminuten: [], koppelingen: [], discipline: [],
    evaluaties: [], zelfreviews: [], events: [], players: [], metingen: [], trainingOefeningen: [],
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
  // 'posities' laat de players-query met position/secondary_positions falen;
  // 'vorm' laat de events-query van de recente vorm falen.
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
  // De vorm-query (laatste 5 wedstrijden) is aan zijn select te herkennen.
  const eventsT = tabel(alle('events'), (sel) =>
    sel === 'id, date, goals_for, goals_against' ? (o.selectErrors?.vorm ?? null) : null,
  )
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
// Fixture-bouwstenen (zelfde vorm als in inzichten-conclusielaag)
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
const opkomst = (pct: number, n: number): Partial<TeamData> => ({
  maandOpkomst: [{ maand: '2026-10', aanwezig: pct, afwezig: 100 - pct }],
  evaluaties: trainingen('2026-10', n),
})
const ratingReeks = (voor: number, na: number, n = 5): Row[] =>
  [...Array(n).fill(voor), ...Array(n).fill(na)].map((g, i) => ({
    event_id: `r${i}`, datum: datum('2026-08-01', i), tegenstander: null, gemiddelde: g, aantal: 12,
  }))
const rating = (voor: number, na: number): Partial<TeamData> => ({ teamRating: ratingReeks(voor, na) })

function uitslag(i: number, gf: number, ga: number, ha: string | null = 'home', start = '2026-07-01'): Row {
  return { event_id: `u${i}`, datum: datum(start, i % 100), home_away: ha, goals_for: gf, goals_against: ga, formatie: null }
}
const uitslagen = (lijst: [number, number, (string | null)?][], start = '2026-07-01'): Row[] =>
  lijst.map(([gf, ga, ha], i) => uitslag(i, gf, ga, ha === undefined ? 'home' : ha, start))
const saldoPositief = (start?: string): Partial<TeamData> => ({ uitslagen: uitslagen([[1, 0], [1, 0], [1, 0], [1, 0], [1, 0]], start) })
const saldoNegatief = (start?: string): Partial<TeamData> => ({ uitslagen: uitslagen([[0, 1], [0, 1], [0, 1], [0, 1], [0, 1]], start) })

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
const keeperGeblesseerd = (): Partial<TeamData> => ({ players: [speler('k1', 'Karel Keeper', 'Keeper', { injured: true })] })

// De rijke dataset uit de conclusielaag: drie signalen (zorg + 2x let-op).
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
    { uitslagen: uitslagen([[3, 1], [2, 0], [0, 0, 'away'], [1, 2, 'away'], [4, 1], [2, 2, null]]) },
    { ratingVorm: [vormRij('s1', 'Sven Stijger', 7.0, 7.6), vormRij('d1', 'Daan Daler', 7.5, 7.0)] },
    wegblijver(),
    keeperGeblesseerd(),
  )
}

// Wedstrijden voor DoelpuntenChart (client-state: het type-filter).
const wedstrijdEvents = (): Row[] => [
  { id: 'm1', team_id: TEAM, type: 'match', date: '2026-10-01', goals_for: 2, goals_against: 0, opponent: 'X', match_type: 'league', created_at: '2026-01-01' },
  { id: 'm2', team_id: TEAM, type: 'match', date: '2026-10-05', goals_for: 1, goals_against: 1, opponent: 'Y', match_type: 'friendly', created_at: '2026-01-01' },
]

// Zelfreviews van de ingelogde trainer (drie weken → trend + tabel met sticky kolom).
const zr = (d: string): Row => ({
  event_id: `e-${d}`, datum: d, score_uitleg: 4, score_organisatie: 3, score_coaching: 5,
  score_sfeer: 2, score_tijdsbewaking: 4, totaal: 3,
})
const driezelfreviews = (): Partial<TeamData> => ({ zelfreviews: [zr('2026-09-01'), zr('2026-09-08'), zr('2026-09-15')] })

// ═══════════════════════════════════════════════════════════════════════
// Lees-helpers (DOM)
// ═══════════════════════════════════════════════════════════════════════
const i18n = nl.insights
const scherm = (c: HTMLElement) => c.querySelector('.print\\:hidden') as HTMLElement
const strook = (c: HTMLElement) => c.querySelector('[data-conclusielaag="kpi"]') as HTMLElement
const blok = (c: HTMLElement) => c.querySelector('[data-conclusielaag="signalen"]') as HTMLElement | null
const themagroepen = (c: HTMLElement) => c.querySelector('[data-themagroepen]') as HTMLElement | null
const printBlok = (c: HTMLElement) => c.querySelector('[data-print-only]') as HTMLElement
const tegel = (c: HTMLElement, id: string) => c.querySelector(`[data-kpi="${id}"]`) as HTMLElement
const tegelTekst = (c: HTMLElement, id: string) => Array.from(tegel(c, id).querySelectorAll('p')).map((p) => p.textContent)
const lis = (c: HTMLElement) => Array.from(blok(c)?.querySelectorAll('li[data-signaal]') ?? []) as HTMLElement[]
const signaalIds = (c: HTMLElement) => lis(c).map((li) => li.getAttribute('data-signaal'))
const signaalTeksten = (c: HTMLElement) =>
  lis(c).map((li) => li.querySelector('[data-signaal-tekst]')?.textContent ?? '')
const melding = (c: HTMLElement) =>
  Array.from(blok(c)?.children ?? []).filter((e) => e.tagName === 'P').map((e) => e.textContent)
const h2s = (el: Element) => Array.from(el.querySelectorAll('h2')).map((h) => h.textContent ?? '')
const thema = (c: HTMLElement, sleutel: string) =>
  c.querySelector(`details[data-thema="${sleutel}"]`) as HTMLDetailsElement | null
const themas = (c: HTMLElement) => Array.from(c.querySelectorAll('details[data-thema]')) as HTMLDetailsElement[]
const themaSleutels = (c: HTMLElement) => themas(c).map((d) => d.getAttribute('data-thema'))
const kaartVan = (c: HTMLElement, titel: string) =>
  Array.from(scherm(c).querySelectorAll('h2')).find((h) => h.textContent === titel)!.closest('.surface-card') as HTMLElement
const volgt = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

// Indeling volgens aanname A3 van de story (onafhankelijk van lib/inzichten-indeling.ts).
const TEAM_TITELS = [i18n.vormTitle, i18n.opkomstTitle, i18n.aanwezigheidTitle, i18n.ratingsTitle, i18n.doelpuntenTitle, i18n.topWorstRatingsTitle, i18n.topWorstAanwezigheidTitle, i18n.inhoudTitle]
const WEDSTRIJDEN_TITELS = [i18n.thuisUitTitle, i18n.formatieTitle, i18n.topscorersTitle, i18n.kaartenTitle, i18n.kwartierTitle, i18n.tegenTitle]
const SPELERS_TITELS = [i18n.speelkansenTitle, i18n.stijgersTitle, i18n.dekkingTitle, i18n.naastElkaarTitle, i18n.blessuresTitle, i18n.speelminutenTitle]
const TRAINING_TITELS = [i18n.belastingTitle, i18n.periodiseringTitle, i18n.disciplineTitle, i18n.srpeTitle, i18n.oordeelTitle]
const ALLE_KAARTTITELS = [...TEAM_TITELS, ...WEDSTRIJDEN_TITELS, ...SPELERS_TITELS, ...TRAINING_TITELS]

// Besluit B2: signaal → (titel van de verhuisde kaart, linktekst, href).
const SPELERS_ACTIE = { label: i18n.signaalActieSpelers, href: '/players' }
const KALENDER_ACTIE = { label: i18n.signaalActieKalender, href: '/events' }
const KOPPELINGEN: { id: string; data: () => Partial<TeamData>; kaart: string; actie: { label: string; href: string } }[] = [
  { id: 'spelers-onder-drempel', data: () => merge(basis(), wegblijver()), kaart: i18n.topWorstAanwezigheidTitle, actie: SPELERS_ACTIE },
  { id: 'opkomst-onder-doel', data: () => merge(basis(), opkomst(80, 3)), kaart: i18n.opkomstTitle, actie: KALENDER_ACTIE },
  { id: 'opkomst-boven-doel', data: () => merge(basis(), opkomst(90, 3)), kaart: i18n.opkomstTitle, actie: KALENDER_ACTIE },
  { id: 'rating-daling', data: () => merge(basis(), rating(7.6, 7.0)), kaart: i18n.ratingsTitle, actie: SPELERS_ACTIE },
  { id: 'rating-stijging', data: () => merge(basis(), rating(7.0, 7.6)), kaart: i18n.ratingsTitle, actie: SPELERS_ACTIE },
  { id: 'doelsaldo-negatief', data: () => merge(basis(), saldoNegatief()), kaart: i18n.thuisUitTitle, actie: KALENDER_ACTIE },
  { id: 'doelsaldo-positief', data: () => merge(basis(), saldoPositief()), kaart: i18n.thuisUitTitle, actie: KALENDER_ACTIE },
  { id: 'speler-daler', data: () => merge(basis(), daler()), kaart: i18n.stijgersTitle, actie: SPELERS_ACTIE },
  { id: 'speler-stijger', data: () => merge(basis(), stijger()), kaart: i18n.stijgersTitle, actie: SPELERS_ACTIE },
  { id: 'positie-zonder-fit', data: () => merge(basis(), keeperGeblesseerd()), kaart: i18n.dekkingTitle, actie: SPELERS_ACTIE },
]

// ═══════════════════════════════════════════════════════════════════════
describe('A. Wat valt op', () => {
  it('C1: met data en signalen staat "Wat valt op" direct onder de KPI-strook en boven alle themagroepen', async () => {
    const { container } = await renderInzichten(rijk())
    expect(strook(container).nextElementSibling).toBe(blok(container))
    expect(blok(container)!.nextElementSibling).toBe(themagroepen(container))
    expect(blok(container)!.querySelector('h2')!.textContent).toBe(i18n.signalenTitle)
    for (const d of themas(container)) expect(volgt(blok(container)!, d)).toBe(true)
  })

  it('C2: precies de signalen van bepaalSignalen, max 3, in prioriteit zorg → let-op → goed', async () => {
    const { container } = await renderInzichten(rijk())
    expect(signaalIds(container)).toEqual(['spelers-onder-drempel', 'speler-daler', 'positie-zonder-fit'])
    expect(signaalTeksten(container)).toEqual([
      'Wim Weg was minder dan 50% van de tijd aanwezig.',
      'Daan Daler daalt: de laatste 5 wedstrijden liggen 0.5 onder het eigen seizoensgemiddelde.',
      'Voor Keeper is op dit moment geen fitte speler.',
    ])
    cleanup()
    // 1 zorg + 4 complimenten → zorg + de eerste 2 complimenten (nooit meer dan 3)
    const goed = await renderInzichten(merge(basis(), wegblijver(), opkomst(90, 3), rating(7.0, 7.6), saldoPositief(), stijger()))
    expect(signaalIds(goed.container)).toEqual(['spelers-onder-drempel', 'opkomst-boven-doel', 'rating-stijging'])
  })

  it.each(KOPPELINGEN)('C3: signaal $id toont de bestaande signaaltekst, precies één grafiek van de gekoppelde kaart en één actie', async ({ id, data, kaart }) => {
    const { container } = await renderInzichten(data())
    expect(signaalIds(container)).toEqual([id])
    const li = lis(container)[0]
    expect(li.querySelector('[data-signaal-tekst]')!.textContent!.length).toBeGreaterThan(10)
    const kaarten = li.querySelectorAll('[data-signaal-kaart]')
    expect(kaarten).toHaveLength(1)
    expect(h2s(kaarten[0])).toEqual([kaart])
    expect(li.querySelectorAll('a')).toHaveLength(1)
  })

  it.each(KOPPELINGEN)('C4 (besluit B2): signaal $id → actie "$actie.label" linkt naar $actie.href', async ({ data, actie }) => {
    const { container } = await renderInzichten(data())
    const links = lis(container)[0].querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0].textContent).toBe(actie.label)
    expect(links[0].getAttribute('href')).toBe(actie.href)
  })

  it('C4: de actie is een gewone link in alle vijf talen met een vertaalde tekst', async () => {
    for (const taal of ['en', 'de', 'fr', 'es']) {
      const { container } = await renderInzichten(merge(basis(), saldoNegatief()), { locale: taal })
      const link = lis(container)[0].querySelector('a')!
      expect(link.textContent).toBe(dicts[taal].insights.signaalActieKalender)
      expect(link.textContent).not.toBe(nl.insights.signaalActieKalender)
      cleanup()
    }
  })

  it('C5: elke kaarttitel staat precies één keer in de DOM; verhuisde kaarten staan niet meer in hun thema', async () => {
    const { container } = await renderInzichten(rijk())
    const titels = h2s(scherm(container)).filter((t) => t !== i18n.signalenTitle)
    expect(titels.sort()).toEqual([...ALLE_KAARTTITELS, i18n.zelfreviewTitle].sort())
    expect(new Set(titels).size).toBe(titels.length)
    // de drie verhuisde kaarten staan in het blok, niet in een thema
    expect(h2s(blok(container)!).filter((t) => t !== i18n.signalenTitle).sort()).toEqual(
      [i18n.topWorstAanwezigheidTitle, i18n.stijgersTitle, i18n.dekkingTitle].sort(),
    )
    for (const d of themas(container)) {
      for (const verhuisd of [i18n.topWorstAanwezigheidTitle, i18n.stijgersTitle, i18n.dekkingTitle]) {
        expect(h2s(d)).not.toContain(verhuisd)
      }
    }
  })

  it('C5: twee signalen naar dezelfde kaart (daler + stijger) → de kaart één keer, de tweede conclusie verwijst ernaar en houdt zijn actie', async () => {
    const { container } = await renderInzichten(merge(basis(), { ratingVorm: [vormRij('d1', 'Daan Daler', 7.5, 7.0), vormRij('s1', 'Sven Stijger', 7.0, 7.6)] }))
    expect(signaalIds(container)).toEqual(['speler-daler', 'speler-stijger'])
    const [eerste, tweede] = lis(container)
    expect(h2s(eerste)).toEqual([i18n.stijgersTitle])
    expect(tweede.querySelector('[data-signaal-kaart]')).toBeNull()
    expect(h2s(tweede)).toEqual([])
    expect(tweede.textContent).toContain(i18n.signaalZelfdeGrafiek)
    expect(eerste.textContent).not.toContain(i18n.signaalZelfdeGrafiek)
    expect(tweede.querySelector('a')!.getAttribute('href')).toBe('/players')
    expect(h2s(scherm(container)).filter((t) => t === i18n.stijgersTitle)).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('B. Thema\'s', () => {
  it('C6: zonder signalen staan de 25 kaarten volgens A3 in vier thema\'s (8/6/6/5) in vaste volgorde, daarna Zelfreview', async () => {
    const { container } = await renderInzichten(basis())
    expect(themaSleutels(container)).toEqual(['team', 'wedstrijden', 'spelers', 'training', 'zelfreview'])
    expect(h2s(thema(container, 'team')!)).toEqual(TEAM_TITELS)
    expect(h2s(thema(container, 'wedstrijden')!)).toEqual(WEDSTRIJDEN_TITELS)
    expect(h2s(thema(container, 'spelers')!)).toEqual(SPELERS_TITELS)
    expect(h2s(thema(container, 'training')!)).toEqual(TRAINING_TITELS)
    expect(h2s(thema(container, 'zelfreview')!)).toEqual([i18n.zelfreviewTitle])
  })

  it('C6: elke themakop toont de themanaam en het aantal kaarten (na het verhuizen)', async () => {
    const { container } = await renderInzichten(basis())
    const kop = (s: string) => thema(container, s)!.querySelector('summary')!
    expect(kop('team').textContent).toContain(i18n.themaTeam)
    expect(kop('team').textContent).toContain('8 onderdelen')
    expect(kop('wedstrijden').textContent).toContain(`${i18n.themaWedstrijden}`)
    expect(kop('wedstrijden').textContent).toContain('6 onderdelen')
    expect(kop('spelers').textContent).toContain(i18n.themaSpelers)
    expect(kop('spelers').textContent).toContain('6 onderdelen')
    expect(kop('training').textContent).toContain(i18n.themaTraining)
    expect(kop('training').textContent).toContain('5 onderdelen')
    expect(kop('zelfreview').textContent).toContain(i18n.themaZelfreview)
    expect(kop('zelfreview').textContent).toContain(i18n.themaAantalEen)
    cleanup()
    // drie kaarten verhuisd: Team 7, Spelers 4 (topWorstAanwezigheid, stijgersDalers, positiedekking)
    const rijkR = await renderInzichten(rijk())
    expect(thema(rijkR.container, 'team')!.querySelector('summary')!.textContent).toContain('7 onderdelen')
    expect(thema(rijkR.container, 'spelers')!.querySelector('summary')!.textContent).toContain('4 onderdelen')
    expect(thema(rijkR.container, 'wedstrijden')!.querySelector('summary')!.textContent).toContain('6 onderdelen')
  })

  it('C6: de themanamen en kopteksten verschillen van elke kaarttitel (themakoppen zijn geen kaarten)', async () => {
    for (const taal of ['nl', 'en', 'de', 'fr', 'es']) {
      const d = dicts[taal].insights
      const namen = [d.themaTeam, d.themaWedstrijden, d.themaSpelers, d.themaTraining, d.themaZelfreview]
      const titels = Object.entries(d).filter(([k]) => k.endsWith('Title')).map(([, v]) => v)
      for (const naam of namen) expect(titels, `${taal}: ${naam}`).not.toContain(naam)
    }
  })

  it('C7: elk thema is een native <details> met <summary> (toetsenbord en screenreader zijn dan van de browser), zonder eigen rol of tabindex', async () => {
    const { container } = await renderInzichten(basis())
    for (const d of themas(container)) {
      expect(d.tagName).toBe('DETAILS')
      const summary = d.firstElementChild!
      expect(summary.tagName).toBe('SUMMARY')
      expect(summary.hasAttribute('role')).toBe(false)
      expect(summary.hasAttribute('tabindex')).toBe(false)
      expect(summary.hasAttribute('aria-expanded')).toBe(false)
      expect(summary.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull()
    }
  })

  it('C7: één tik op de themakop opent het thema, een tweede sluit het weer', async () => {
    const { container } = await renderInzichten(basis())
    const wed = thema(container, 'wedstrijden')!
    expect(wed.open).toBe(false)
    fireEvent.click(wed.querySelector('summary')!)
    expect(wed.open).toBe(true)
    fireEvent.click(wed.querySelector('summary')!)
    expect(wed.open).toBe(false)
  })

  it('C8 (besluit B3): standaard is alleen "Team" open; Wedstrijden, Spelers, Training en Zelfreview zijn dicht', async () => {
    const { container } = await renderInzichten(basis())
    expect(Object.fromEntries(themas(container).map((d) => [d.getAttribute('data-thema'), d.open]))).toEqual({
      team: true, wedstrijden: false, spelers: false, training: false, zelfreview: false,
    })
    cleanup()
    const r = await renderInzichten(rijk())
    expect(Object.fromEntries(themas(r.container).map((d) => [d.getAttribute('data-thema'), d.open]))).toEqual({
      team: true, wedstrijden: false, spelers: false, training: false, zelfreview: false,
    })
  })

  it('C8: de open/dicht-stand wordt niet bewaard — een verse render met een eerder geopend thema begint weer met alleen Team open', async () => {
    const eerste = await renderInzichten(basis())
    thema(eerste.container, 'training')!.open = true
    cleanup()
    const tweede = await renderInzichten(basis())
    expect(thema(tweede.container, 'training')!.open).toBe(false)
  })

  it('C9: alle 25 kaarten blijven in de DOM als hun thema dicht is, met hun titel en cijfers', async () => {
    const { container } = await renderInzichten(merge(rijk(), { uitslagen: uitslagen([[3, 1], [2, 0], [0, 0, 'away']]) }))
    for (const s of ['wedstrijden', 'spelers', 'training', 'zelfreview']) expect(thema(container, s)!.open).toBe(false)
    const aanwezig = h2s(scherm(container))
    for (const titel of ALLE_KAARTTITELS) expect(aanwezig).toContain(titel)
    // toegankelijkheidsboom: dichte details-inhoud is voor jsdom nog vindbaar
    expect(screen.getByRole('heading', { name: i18n.thuisUitTitle })).toBeInTheDocument()
    // de cijfers van de kaart in een dicht thema zijn gelijk aan die in de KPI-strook (zelfde bron)
    expect(tegelTekst(container, 'doelsaldo')[2]).toBe('+4')
    expect(kaartVan(container, i18n.thuisUitTitle).textContent).toContain('+4')
  })

  it('C9: client-state in RatingsChart/DoelpuntenChart blijft behouden als het thema wordt dichtgeklapt en weer geopend', async () => {
    const { container } = await renderInzichten(merge(basis(), { events: wedstrijdEvents() }))
    const team = thema(container, 'team')!
    const knop = within(kaartVan(container, i18n.doelpuntenTitle)).getByRole('button', { name: nl.event.matchTypes.league })
    expect(knop).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(knop)
    expect(knop).toHaveAttribute('aria-pressed', 'true')
    team.open = false
    fireEvent.click(team.querySelector('summary')!)
    expect(team.open).toBe(true)
    const na = within(kaartVan(container, i18n.doelpuntenTitle)).getByRole('button', { name: nl.event.matchTypes.league })
    expect(na).toBe(knop)
    expect(na).toHaveAttribute('aria-pressed', 'true')
  })

  it('C9 (edge): bij een periodewissel gaan de thema\'s terug naar de standaardstand, zonder dat de kaarten hermonteren', async () => {
    const r = await renderInzichten(merge(basis(), { events: wedstrijdEvents() }))
    const knop = within(kaartVan(r.container, i18n.doelpuntenTitle)).getByRole('button', { name: nl.event.matchTypes.league })
    fireEvent.click(knop)
    thema(r.container, 'wedstrijden')!.open = true
    thema(r.container, 'team')!.open = false
    const el = await InzichtenPage({ searchParams: Promise.resolve({ periode: '8w' }) })
    r.rerender(<DictProvider dict={nl}>{el}</DictProvider>)
    expect(thema(r.container, 'team')!.open).toBe(true)
    expect(thema(r.container, 'wedstrijden')!.open).toBe(false)
  })

  it('C10: de zelfreviewkaart staat in een eigen onderdeel (niet in een van de vier thema\'s) bij canEdit training', async () => {
    const { container } = await renderInzichten(basis())
    const zelf = thema(container, 'zelfreview')!
    expect(h2s(zelf)).toEqual([i18n.zelfreviewTitle])
    expect(zelf.querySelector('summary')!.textContent).toContain(i18n.themaZelfreview)
    for (const s of ['team', 'wedstrijden', 'spelers', 'training']) expect(h2s(thema(container, s)!)).not.toContain(i18n.zelfreviewTitle)
    expect(themaSleutels(container).at(-1)).toBe('zelfreview')
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('C. Scroll-indicatie (gesimuleerde maten: jsdom heeft geen layout)', () => {
  const origineel = {
    scrollWidth: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth'),
    clientWidth: Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth'),
  }
  let breedte = { scrollWidth: 900, clientWidth: 300 }

  beforeEach(() => {
    breedte = { scrollWidth: 900, clientWidth: 300 }
    for (const k of ['scrollWidth', 'clientWidth'] as const) {
      Object.defineProperty(Element.prototype, k, {
        configurable: true,
        get(this: Element) {
          return this.classList.contains('overflow-x-auto') ? breedte[k] : 0
        },
      })
    }
  })
  afterEach(() => {
    for (const k of ['scrollWidth', 'clientWidth'] as const) {
      if (origineel[k]) Object.defineProperty(Element.prototype, k, origineel[k])
    }
  })

  const metGrafieken = (): Partial<TeamData> =>
    merge(rijk(), driezelfreviews(), { events: wedstrijdEvents() }, {
      speelminuten: [{ player_id: 'p1', naam: 'Piet', gast: false, wedstrijden: 3, minuten: 200, wissels: 1, noemer: 3 }],
    })
  const scrollers = (c: HTMLElement) => Array.from(scherm(c).querySelectorAll('.overflow-x-auto')) as HTMLElement[]
  const randen = (scroller: HTMLElement) =>
    Array.from(scroller.parentElement!.querySelectorAll(':scope > [data-scroll-rand]')).map((e) => e.getAttribute('data-scroll-rand'))

  it('C11: elke kaart met horizontaal scrollbare inhoud toont aan het begin een rand aan de kant waar nog inhoud is (eind), ook in dichte thema\'s', async () => {
    const { container } = await renderInzichten(metGrafieken())
    const lijst = scrollers(container)
    expect(lijst.length).toBeGreaterThanOrEqual(5)
    // minstens één scroller in een dicht thema en één in "Wat valt op"
    expect(lijst.some((s) => s.closest('details[data-thema]:not([open])'))).toBe(true)
    expect(lijst.some((s) => blok(container)!.contains(s))).toBe(true)
    for (const s of lijst) expect(randen(s), s.parentElement!.closest('.surface-card')?.querySelector('h2')?.textContent ?? '').toEqual(['eind'])
  })

  it('C12: past alle inhoud, dan staat er nergens een scrollrand', async () => {
    breedte = { scrollWidth: 300, clientWidth: 300 }
    const { container } = await renderInzichten(metGrafieken())
    expect(scrollers(container).length).toBeGreaterThanOrEqual(5)
    expect(container.querySelector('[data-scroll-rand]')).toBeNull()
  })

  it('C13: in het midden staan beide randen, aan het einde verdwijnt de eindrand en blijft de startrand; de kaart blijft een native scroller', async () => {
    const { container } = await renderInzichten(metGrafieken())
    const s = scrollers(container).find((el) => el.closest('[data-signaal-kaart]'))!
    const zetLinks = async (x: number) => {
      Object.defineProperty(s, 'scrollLeft', { configurable: true, writable: true, value: x })
      fireEvent.scroll(s)
      await waitFor(() => expect(randen(s)).toEqual(x === 0 ? ['eind'] : x < 600 ? ['start', 'eind'] : ['start']))
    }
    await zetLinks(0)
    await zetLinks(300)
    await zetLinks(600)
    expect(s.className).toContain('overflow-x-auto')
    expect(s.className).not.toMatch(/overflow-x-hidden|overflow-hidden|touch-none/)
    await zetLinks(0)
  })

  it('C13: de sticky eerste kolom van de weektabel van de zelfreviewkaart blijft bestaan, binnen de scroller', async () => {
    const { container } = await renderInzichten(metGrafieken())
    const zelf = thema(container, 'zelfreview')!
    const sticky = zelf.querySelectorAll('.overflow-x-auto th.sticky')
    expect(sticky.length).toBeGreaterThanOrEqual(3)
  })

  it('C14: de randen zijn puur visueel — pointer-events-none, geen rol, geen aria, geen interactief element', async () => {
    const { container } = await renderInzichten(metGrafieken())
    const randLijst = Array.from(container.querySelectorAll('[data-scroll-rand]')) as HTMLElement[]
    expect(randLijst.length).toBeGreaterThan(0)
    for (const rand of randLijst) {
      expect(rand.className).toContain('pointer-events-none')
      expect(rand.children).toHaveLength(0)
      expect(rand.textContent).toBe('')
      expect(rand.getAttributeNames().filter((a) => a.startsWith('aria-') || a === 'role' || a === 'tabindex' || a === 'onclick')).toEqual([])
      // geen focusbare of klikbare inhoud: de rand is een lege div naast de scroller
      expect(rand.matches('a, button, input, select, textarea, [tabindex]')).toBe(false)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('D. Faalpaden', () => {
  it('C15: een falende bron → de regel wordt overgeslagen, de rest blijft, de "onvolledig"-melding staat er, en geen conclusie draagt een foute of lege grafiek', async () => {
    const { container } = await renderInzichten(rijk(), { rpcErrors: { inzichten_rating_vorm_per_speler: FOUT } })
    // speler-daler (en stijger) vallen weg, de rest blijft
    expect(signaalIds(container)).toEqual(['spelers-onder-drempel', 'positie-zonder-fit', 'opkomst-boven-doel'])
    expect(melding(container)).toEqual([i18n.signalenOnvolledig])
    for (const k of Array.from(blok(container)!.querySelectorAll('[data-signaal-kaart]'))) {
      expect(k.textContent).not.toContain(i18n.bronFout)
    }
    // de kaart zelf staat nog (met zijn bestaande foutmelding) in zijn thema
    expect(h2s(thema(container, 'spelers')!)).toContain(i18n.stijgersTitle)
    expect(kaartVan(container, i18n.stijgersTitle).textContent).toContain(i18n.bronFout)
    expect(h2s(blok(container)!)).not.toContain(i18n.stijgersTitle)
  })

  it('C15: een falende uitslagenbron → geen doelsaldo-conclusie en geen lege Thuis/uit-grafiek in "Wat valt op"', async () => {
    const { container } = await renderInzichten(merge(basis(), saldoNegatief()), { rpcErrors: { inzichten_wedstrijd_uitslagen: FOUT } })
    expect(blok(container)!.querySelector('[data-signaal-kaart]')).toBeNull()
    expect(signaalIds(container)).toEqual([])
    expect(melding(container)).toEqual([i18n.signalenOnvolledig])
    expect(h2s(thema(container, 'wedstrijden')!)).toContain(i18n.thuisUitTitle)
  })

  it('C16: een kaart met bronfout in een dicht thema is zichtbaar zonder openen — de themakop meldt "n onvolledig" in plaats van het aantal te verbergen', async () => {
    const { container } = await renderInzichten(basis(), { rpcErrors: { inzichten_speelkansen: FOUT } })
    const spelers = thema(container, 'spelers')!
    expect(spelers.open).toBe(false)
    const fouten = Array.from(spelers.querySelectorAll('.surface-card')).filter((k) => k.textContent!.includes(i18n.bronFout)).length
    expect(fouten).toBeGreaterThan(0)
    expect(spelers.querySelector('summary')!.textContent).toContain(i18n.themaOnvolledig.replace('{n}', String(fouten)))
    // thema's zonder fout hebben geen waarschuwing
    for (const s of ['team', 'wedstrijden', 'training']) {
      expect(thema(container, s)!.querySelector('summary')!.textContent).not.toContain('onvolledig')
    }
    // de waarschuwing is geen alert (geen rol die de pagina onderbreekt)
    expect(spelers.querySelector('summary [role="alert"]')).toBeNull()
  })

  it('C16: de waarschuwing telt ook mee voor de zelfreview-groep bij een falende zelfreviewbron', async () => {
    const { container } = await renderInzichten(basis(), { rpcErrors: { inzichten_eigen_zelfreviews: FOUT } })
    const zelf = thema(container, 'zelfreview')!
    expect(zelf.open).toBe(false)
    expect(zelf.querySelector('summary')!.textContent).toContain(i18n.themaOnvolledig.replace('{n}', '1'))
  })

  it('C17: 0 signalen en alles in orde → geen "Wat valt op"; de themagroepen staan direct onder de KPI-strook', async () => {
    const { container } = await renderInzichten(basis())
    expect(blok(container)).toBeNull()
    expect(strook(container).nextElementSibling).toBe(themagroepen(container))
    expect(container.querySelector('[data-signaal]')).toBeNull()
  })

  it('C18: minder dan 3 signalen → alleen die conclusies, geen opvulling', async () => {
    const twee = await renderInzichten(merge(basis(), saldoPositief(), stijger()))
    expect(signaalIds(twee.container)).toEqual(['doelsaldo-positief', 'speler-stijger'])
    expect(lis(twee.container)).toHaveLength(2)
    cleanup()
    const een = await renderInzichten(merge(basis(), keeperGeblesseerd()))
    expect(signaalIds(een.container)).toEqual(['positie-zonder-fit'])
    expect(lis(een.container)).toHaveLength(1)
  })

  it('C19: geen seizoen → de bestaande lege staat, zonder themakoppen en zonder RPC\'s', async () => {
    const { container, rpcCalls } = await renderInzichten(rijk(), { seizoen: ['', ''] })
    expect(container.textContent).toContain(i18n.noSeason)
    expect(container.querySelector('details')).toBeNull()
    expect(container.querySelector('summary')).toBeNull()
    expect(blok(container)).toBeNull()
    expect(rpcCalls).toHaveLength(0)
  })

  it('C19: geenEnkeleData (seizoen en periode 4w) → de bestaande lege staten, zonder themakoppen', async () => {
    const leeg = { aanwezigheid: [{ aanwezig: 0, afwezig: 0 }] }
    const heel = await renderInzichten(leeg)
    expect(heel.container.textContent).toContain(i18n.geenDataTitle)
    expect(heel.container.querySelector('details, summary, [data-themagroepen]')).toBeNull()
    cleanup()
    const kort = await renderInzichten(leeg, { periode: '4w' })
    expect(kort.container.textContent).toContain(i18n.periodeLeeg)
    expect(kort.container.querySelector('details, summary, [data-themagroepen]')).toBeNull()
  })

  it('C20: een ongeldige ?periode= valt terug op het seizoen — zelfde RPC-vensters en dezelfde indeling', async () => {
    const standaard = await renderInzichten(rijk())
    const standaardArgs = standaard.rpcCalls.map((c) => [c.name, c.args])
    const standaardIds = signaalIds(standaard.container)
    cleanup()
    const fout = await renderInzichten(rijk(), { periode: 'kaboem' })
    expect(fout.rpcCalls.map((c) => [c.name, c.args])).toEqual(standaardArgs)
    expect(signaalIds(fout.container)).toEqual(standaardIds)
    expect(themaSleutels(fout.container)).toEqual(['team', 'wedstrijden', 'spelers', 'training', 'zelfreview'])
    const actief = fout.container.querySelector('[aria-current]')!
    expect(actief.textContent).toBe(i18n.periodeSeizoen)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('E. Businessregels', () => {
  it('C21: de signaalregels en drempels zijn onveranderd — 85% opkomst is "boven doel", 84% is "onder doel", en het maximum blijft 3', async () => {
    const boven = await renderInzichten(merge(basis(), opkomst(85, 3)))
    expect(signaalIds(boven.container)).toEqual(['opkomst-boven-doel'])
    cleanup()
    const onder = await renderInzichten(merge(basis(), opkomst(84, 3)))
    expect(signaalIds(onder.container)).toEqual(['opkomst-onder-doel'])
    cleanup()
    const veel = await renderInzichten(
      merge(basis(), wegblijver(), opkomst(80, 3), rating(7.6, 7.0), saldoNegatief(), daler(), keeperGeblesseerd()),
    )
    expect(signaalIds(veel.container)).toEqual(['spelers-onder-drempel', 'opkomst-onder-doel', 'rating-daling'])
    expect(signaalTeksten(veel.container)[1]).toBe(`De trainingsopkomst staat op 80% in Okt 2026 — onder de norm van 85%.`)
  })

  it('C22: precies 18 RPC\'s, elk met p_team_id van het actieve team, ook als alle thema\'s dicht zijn (geen lazy loading); geen nieuwe tabel', async () => {
    const { rpcCalls, fromCalls } = await renderInzichten(rijk())
    expect(rpcCalls).toHaveLength(18)
    expect(new Set(rpcCalls.map((c) => c.name)).size).toBe(18)
    expect(rpcCalls.every((c) => c.args.p_team_id === TEAM)).toBe(true)
    for (const tabel of fromCalls) expect(['categorie_metingen', 'events', 'players', 'settings', 'training_oefeningen']).toContain(tabel)
  })

  it('C22: open- of dichtklappen van een thema veroorzaakt geen extra RPC of query', async () => {
    const { container, rpcCalls, fromCalls } = await renderInzichten(rijk())
    const rpc = rpcCalls.length
    const from = fromCalls.length
    for (const d of themas(container)) fireEvent.click(d.querySelector('summary')!)
    expect(rpcCalls).toHaveLength(rpc)
    expect(fromCalls).toHaveLength(from)
  })

  it('C23: het periodefilter werkt voor signalen én kaarten — uitslagen binnen 4 weken geven signaal + gevulde kaart, daarbuiten geen signaal en een lege kaart in het thema', async () => {
    const binnen = await renderInzichten(merge(basis(), saldoNegatief('2026-10-01')), { periode: '4w' })
    expect(signaalIds(binnen.container)).toEqual(['doelsaldo-negatief'])
    expect(h2s(blok(binnen.container)!)).toContain(i18n.thuisUitTitle)
    expect(h2s(thema(binnen.container, 'wedstrijden')!)).not.toContain(i18n.thuisUitTitle)
    cleanup()
    // dezelfde uitslagen liggen in het hele seizoen wel, maar niet in de laatste 4 weken
    const buiten = await renderInzichten(merge(basis(), saldoNegatief('2026-07-01')), { periode: '4w' })
    expect(blok(buiten.container)).toBeNull()
    expect(h2s(thema(buiten.container, 'wedstrijden')!)).toContain(i18n.thuisUitTitle)
    cleanup()
    const seizoen = await renderInzichten(merge(basis(), saldoNegatief('2026-07-01')))
    expect(signaalIds(seizoen.container)).toEqual(['doelsaldo-negatief'])
  })

  it('C24: de zes KPI-tegels zijn ongewijzigd (volgorde, labels en waarden)', async () => {
    const { container } = await renderInzichten(rijk())
    expect(Array.from(strook(container).querySelectorAll('[data-kpi]')).map((e) => e.getAttribute('data-kpi'))).toEqual([
      'opkomst', 'aanwezigheid', 'rating', 'doelsaldo', 'punten', 'cleansheets',
    ])
    expect(tegelTekst(container, 'opkomst')).toEqual(['Trainingsopkomst', 'Laatste maand (Okt 2026)', '90%', '+20 t.o.v. vorige maand'])
    expect(tegelTekst(container, 'aanwezigheid')).toEqual(['Totale aanwezigheid', 'Heel seizoen', '84%', 'Norm 85%'])
    expect(tegelTekst(container, 'rating')).toEqual(['Gem. teamrating', 'Heel seizoen', '7.3', '+0.6 t.o.v. de 5 daarvoor'])
    expect(tegelTekst(container, 'doelsaldo')).toEqual(['Doelsaldo', 'Heel seizoen', '+6', '12 voor · 6 tegen'])
    expect(tegelTekst(container, 'punten')).toEqual(['Punten per wedstrijd', 'Heel seizoen', '1.83', '11 punten uit 6 wedstrijden'])
    expect(tegelTekst(container, 'cleansheets')).toEqual(['Clean sheets', 'Heel seizoen', '2', 'van 6 wedstrijden'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('F. Rechten en privacy', () => {
  const teamEen = (): Partial<TeamData> => merge(basis(), wegblijver('Piet Peters'), daler('Daan Daler'), { uitslagen: uitslagen([[2, 0], [1, 0]]) })
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

  it('C25: tenantisolatie — blok, thema\'s en kaarten tonen alleen het actieve team; elke RPC gebruikt dat team', async () => {
    const { container, rpcCalls } = await renderInzichten(teamEen(), { anderen: { [ANDER]: teamTwee() }, members: beide, activeTeam: TEAM })
    for (const lek of ['Zora', 'Zeno', 'Zita']) expect(container.textContent).not.toContain(lek)
    expect(signaalIds(container)).toEqual(['spelers-onder-drempel', 'speler-daler'])
    expect(rpcCalls.every((c) => c.args.p_team_id === TEAM)).toBe(true)
    cleanup()
    const ander = await renderInzichten(teamEen(), { anderen: { [ANDER]: teamTwee() }, members: beide, activeTeam: ANDER })
    for (const lek of ['Piet', 'Daan']) expect(ander.container.textContent).not.toContain(lek)
    expect(signaalTeksten(ander.container)[0]).toContain('Zora Ander')
    expect(ander.rpcCalls.every((c) => c.args.p_team_id === ANDER)).toBe(true)
  })

  it('C25: geen nieuwe bron — dezelfde 18 RPC\'s en dezelfde tabellen als vóór de wijziging', async () => {
    const { rpcCalls, fromCalls } = await renderInzichten(teamEen())
    expect(rpcCalls.map((c) => c.name).sort()).toEqual(Object.keys(RPC_BRON).sort())
    for (const tabel of fromCalls) expect(['events', 'players', 'settings', 'training_oefeningen', 'categorie_metingen']).toContain(tabel)
  })

  it('C26: de zelfreviewkaart is privé — niet in "Wat valt op" en niet in het rapport/de PDF-markup', async () => {
    const { container } = await renderInzichten(merge(rijk(), driezelfreviews()))
    expect(h2s(blok(container)!)).not.toContain(i18n.zelfreviewTitle)
    expect(blok(container)!.textContent).not.toContain(i18n.themaZelfreview)
    expect(h2s(thema(container, 'zelfreview')!)).toEqual([i18n.zelfreviewTitle])
    const rapport = printBlok(container)
    expect(rapport.textContent).not.toContain(i18n.zelfreviewTitle)
    expect(rapport.textContent).not.toContain(i18n.themaZelfreview)
    expect(rapport.querySelector('details, summary, [data-thema]')).toBeNull()
  })

  it('C27: een gebruiker zonder training-recht en zonder eigen zelfreviews ziet geen zelfreview-onderdeel (ook geen lege kop)', async () => {
    const { container } = await renderInzichten(basis(), { members: [{ team_id: TEAM, user_id: 'u1', rol: 'assistent' }] })
    expect(thema(container, 'zelfreview')).toBeNull()
    expect(themaSleutels(container)).toEqual(['team', 'wedstrijden', 'spelers', 'training'])
    expect(container.textContent).not.toContain(i18n.zelfreviewTitle)
    expect(container.textContent).not.toContain(i18n.themaZelfreview)
  })

  it('C27: dezelfde assistent mét eigen zelfreviews ziet het onderdeel wel; de eigenaar ziet het ook zonder rijen', async () => {
    const assistent = await renderInzichten(driezelfreviewsMetBasis(), { members: [{ team_id: TEAM, user_id: 'u1', rol: 'assistent' }] })
    expect(h2s(thema(assistent.container, 'zelfreview')!)).toEqual([i18n.zelfreviewTitle])
    cleanup()
    const eigenaar = await renderInzichten(basis())
    expect(thema(eigenaar.container, 'zelfreview')).not.toBeNull()
  })

  it('C28: open/dicht gaat nergens heen — geen opslag, geen cookie, geen fetch, geen RPC bij klappen', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const cookie = vi.spyOn(document, 'cookie', 'set')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const { container, rpcCalls } = await renderInzichten(rijk())
      const rpc = rpcCalls.length
      for (const d of themas(container)) fireEvent.click(d.querySelector('summary')!)
      for (const d of themas(container)) fireEvent.click(d.querySelector('summary')!)
      expect(setItem).not.toHaveBeenCalled()
      expect(cookie).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(rpcCalls).toHaveLength(rpc)
    } finally {
      vi.unstubAllGlobals()
      setItem.mockRestore()
      cookie.mockRestore()
    }
  })
})

function driezelfreviewsMetBasis(): Partial<TeamData> {
  return merge(basis(), driezelfreviews())
}

// ═══════════════════════════════════════════════════════════════════════
describe('G. Print en PDF', () => {
  it('C29: het scherm staat in print:hidden (blok, KPI, thema\'s); het rapport staat erbuiten in hidden print:block en kent geen thema-markup', async () => {
    const { container } = await renderInzichten(rijk())
    const s = scherm(container)
    expect(s.contains(strook(container))).toBe(true)
    expect(s.contains(blok(container))).toBe(true)
    for (const d of themas(container)) expect(s.contains(d)).toBe(true)
    const rapport = printBlok(container)
    expect(s.contains(rapport)).toBe(false)
    expect(rapport.className).toContain('hidden')
    expect(rapport.className).toContain('print:block')
    expect(rapport.querySelector('details, summary, [data-thema], [data-signaal-kaart], [data-scroll-rand]')).toBeNull()
  })

  it('C30: het rapport is inhoudelijk identiek, ongeacht welke thema\'s open of dicht staan', async () => {
    const { container } = await renderInzichten(merge(rijk(), driezelfreviews()))
    const dicht = printBlok(container).innerHTML
    for (const d of themas(container)) d.open = true
    expect(printBlok(container).innerHTML).toBe(dicht)
    for (const d of themas(container)) d.open = false
    expect(printBlok(container).innerHTML).toBe(dicht)
    expect(dicht.length).toBeGreaterThan(500)
  })

  it('C30: het rapport toont dezelfde signaalzinnen als "Wat valt op" (verhuizen van kaarten verandert het rapport niet)', async () => {
    const { container } = await renderInzichten(rijk())
    const rapport = Array.from(printBlok(container).querySelectorAll('.rapport-signaal')).map((p) => p.textContent)
    expect(rapport).toEqual(signaalTeksten(container))
    // ook de kaarttitels die naar "Wat valt op" verhuisden staan niet als schermkaart in het rapport
    expect(printBlok(container).querySelector('.surface-card')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('H. Mobiel (alleen structuur; hoogte, tikgrootte en paginascroll meet de orkestrator in de browser)', () => {
  it('C32: één kolom als basis — conclusies en thema-inhoud hebben geen kolommen onder lg', async () => {
    const { container } = await renderInzichten(rijk())
    for (const li of lis(container)) {
      expect(li.className).toContain('flex-col')
      expect(li.className).toMatch(/lg:grid/)
    }
    for (const d of themas(container)) {
      const inhoud = d.lastElementChild as HTMLElement
      expect(inhoud.className).toContain('grid-cols-1')
      expect(inhoud.className).toContain('lg:grid-cols-2')
    }
  })

  it('C33: themakoppen (min-h-12 = 48px) en acties (h-11 = 44px) hebben de bestaande tikmaat', async () => {
    const { container } = await renderInzichten(rijk())
    for (const d of themas(container)) expect(d.querySelector('summary')!.className).toContain('min-h-12')
    const links = Array.from(blok(container)!.querySelectorAll('a'))
    expect(links.length).toBe(3)
    for (const a of links) expect(a.className).toContain('h-11')
  })

  it('C34: kaarten in "Wat valt op" kunnen krimpen (min-w-0) zodat een brede grafiek in zijn eigen scroller blijft en niet de pagina oprekt', async () => {
    const { container } = await renderInzichten(rijk())
    const kaarten = blok(container)!.querySelectorAll('[data-signaal-kaart]')
    expect(kaarten).toHaveLength(3)
    for (const k of Array.from(kaarten)) expect(k.className).toContain('min-w-0')
  })

  it('edge (reduced motion): geen animatie op themakop of scrollrand — geen transition- of animate-klassen', async () => {
    const { container } = await renderInzichten(rijk())
    for (const d of themas(container)) {
      const kop = d.querySelector('summary')!
      expect(kop.className).not.toMatch(/\banimate-|\btransition-/)
      for (const el of Array.from(kop.querySelectorAll('[class]'))) {
        const klassen = (el.getAttribute('class') ?? '').split(/\s+/)
        const beweegt = klassen.filter((k) => /^(animate-|transition-(?!none))/.test(k))
        // het icoon heeft zelf transition-transform; transition-none! moet dat overrulen
        if (beweegt.length > 0) expect(klassen).toContain('transition-none!')
        expect(klassen.filter((k) => k.startsWith('animate-'))).toEqual([])
      }
    }
  })
})
