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
//   AC10/AC24 → describe('AC10 / AC24 — pariteit scherm ↔ rapport in elke state') (Deel 2)
//   AC12/AC17/AC19/AC13/AC29/AC32 (rapport) → de 'Deel 2'-describes onderaan
//   AC25 → describe('AC25 — gasten en inactieven (positiesignaal)')
//   AC28 → describe('AC28 — vensters en periodekiezer')
//   AC29 → describe('AC29 — vijf talen')
//   AC30 → describe('AC30 — geen oordeel in de kaarten')
//   AC31/32 → describe('AC31 / AC32 — rollen en tenant')
//   AC35/36/37 → describe('AC35–AC37 — tijdzone')
//   AC39 → describe('AC39 — print:hidden en hidden print:block')
//   Faalpad: fout-vóór-afgekapt → describe('KpiStrip — fout gaat voor afgekapt')
//
// Niet in dit bestand: AC38 en AC40 (echte PDF, vraagt een browser: zie het
// PDF-rapport van de test-verifier), AC14 (visuele lay-out en paginatelling:
// idem), AC34 (/api/pdf, bestaand in delen-als-pdf), AC41 (volledige suite
// groen: zie rapport).

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
import SeizoensrapportPrint from '@/components/inzichten/SeizoensrapportPrint'
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
// Deel 2: de rapporttegel heeft data-rapport-kpi en dezelfde p-volgorde als het
// scherm (label, venster, waarde, detail; bij een melding label, venster, melding).
const rapportTegel = (c: HTMLElement, id: string) => {
  const k = printBlok(c).querySelector(`[data-rapport-kpi="${id}"]`)
  return k ? Array.from(k.querySelectorAll('p')).map((p) => p.textContent) : null
}
const rapportSectie = (c: HTMLElement, titel: string) =>
  Array.from(printBlok(c).querySelectorAll('.rapport-sectie')).find(
    (e) => e.querySelector('.rapport-sectiekop')?.textContent === titel,
  ) as HTMLElement | undefined
const rapportMeldingen = (sectie: Element | undefined) =>
  Array.from(sectie?.querySelectorAll('.rapport-melding') ?? []).map((e) => e.textContent)
const celTekst = (tr: Element) => Array.from(tr.querySelectorAll('th, td')).map((e) => e.textContent ?? '')
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
// ═══════════════════════════════════════════════════════════════════════
// DEEL 2 — seizoensrapport (brief deel 2, AC10–AC14, AC17, AC19, AC24, AC29,
// AC32, AC36, AC39–AC41). De rapporttegel is `[data-rapport-kpi]`; het scherm
// `[data-kpi]`. Beide hebben dezelfde p-volgorde, zodat pariteit letterlijk
// regel voor regel te toetsen is.
// ═══════════════════════════════════════════════════════════════════════
const KPI_IDS = ['opkomst', 'aanwezigheid', 'rating', 'doelsaldo', 'punten', 'cleansheets'] as const

const moment = (id: string, naam: string, doelpunten: number, assists: number, gast = false): Row => ({
  player_id: id, naam, gast, doelpunten, assists, geel: 0, rood: 0,
})
// n topscorers, aflopend op doelpunten; de derde is een gast.
const scorers = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => moment(`m${i}`, `Speler ${String.fromCharCode(65 + i)}`, 10 - i, i % 3, i === 2))
const vormEvents = (): Row[] => [
  { id: 'v1', team_id: TEAM, type: 'match', date: '2026-10-01', goals_for: 2, goals_against: 0, opponent: 'X', match_type: 'league', created_at: '2026-01-01' },
  { id: 'v2', team_id: TEAM, type: 'match', date: '2026-10-05', goals_for: 1, goals_against: 1, opponent: 'Y', match_type: 'league', created_at: '2026-01-01' },
  { id: 'v3', team_id: TEAM, type: 'match', date: '2026-10-09', goals_for: 0, goals_against: 3, opponent: 'Z', match_type: 'league', created_at: '2026-01-01' },
]
// rijk + topscorers + ratings per speler + vorm: alle rapportsecties gevuld
function rijkRapport(aantalScorers = 8): Partial<TeamData> {
  return merge(rijk(), {
    spelerMomenten: scorers(aantalScorers),
    ratingPerSpeler: [
      { player_id: 'r1', naam: 'Rik Rating', gemiddelde: 7.8, aantal: 9 },
      { player_id: 'r2', naam: 'Rob Rating', gemiddelde: 6.1, aantal: 9 },
    ],
    events: vormEvents(),
  })
}
const vormTekst = (w: number, g: number, v: number) => `${w} gewonnen, ${g} gelijk, ${v} verloren`
const viaKaart = (c: HTMLElement, titel: string) =>
  Array.from(c.querySelectorAll('h2')).find((h) => h.textContent === titel)!.closest('.surface-card') as HTMLElement

// ═══ Rapport-uitbreiding: fixtures ═══
const smRij = (id: string, naam: string, wedstrijden: number, minuten: number | null, gast = false): Row => ({
  player_id: id, naam, gast, wedstrijden, minuten, wissels: wedstrijden > 0 ? 1 : null, noemer: 10,
})
const kaartRij = (id: string, naam: string, geel: number, rood: number, gast = false): Row => ({
  player_id: id, naam, gast, doelpunten: 0, assists: 0, geel, rood,
})
const evRijen = (n: number, oordeel: (i: number) => string | null, datumVan = '2026-09-01'): Row[] =>
  Array.from({ length: n }, (_, k) => ({ event_id: `ev${k}`, datum: datum(datumVan, k), doelstelling: 'Opbouwen', rpe: null, oordeel: oordeel(k) }))
function uitbreidingData(): Partial<TeamData> {
  return {
    spelerMomenten: [
      ...scorers(8),
      kaartRij('k1', 'Kees Kaart', 3, 1), kaartRij('k2', 'Gerrit Gast', 2, 0, true), kaartRij('k3', 'Rob Rood', 0, 2),
      kaartRij('k4', 'Aart Aap', 2, 0), kaartRij('k5', 'Bert Bos', 2, 0), kaartRij('k6', 'Cor Cals', 1, 0), kaartRij('k7', 'Dirk Dam', 1, 0), kaartRij('k8', 'Eef Egas', 1, 0),
    ],
    speelminuten: [
      smRij('s1', 'Spel Een', 9, 800), smRij('s2', 'Spel Twee', 8, 700, true), smRij('s3', 'Spel Drie', 7, 600), smRij('s4', 'Spel Vier', 6, 500),
      smRij('s5', 'Spel Vijf', 5, 400), smRij('s6', 'Spel Zes', 4, 300), smRij('s7', 'Spel Zeven', 3, 200), smRij('s8', 'Spel Acht', 0, null),
    ],
    doelpuntMinuten: [{ minuut: 3, aantal: 4 }, { minuut: 20, aantal: 2 }, { minuut: 50, aantal: 6 }, { minuut: 95, aantal: 1 }, { minuut: null, aantal: 2 }],
    tegendoelpunten: [
      { minuut: 8, soort: 'open_play', aantal: 2 }, { minuut: 8, soort: 'set_piece', aantal: 1 },
      { minuut: 55, soort: 'open_play', aantal: 3 }, { minuut: null, soort: 'open_play', aantal: 1 },
    ],
    evaluaties: evRijen(6, (k) => (['ja', 'ja', 'deels', 'nee', null, 'ja'] as (string | null)[])[k]),
  }
}
const metUitbreiding = () => merge(rijkRapport(), uitbreidingData())
const NIEUWE_RPC_FOUTEN = ['inzichten_doelpunten_per_minuut', 'inzichten_tegendoelpunten', 'inzichten_speelminuten_per_speler', 'inzichten_speler_momenten', 'inzichten_training_evaluaties']
const TITELS_NIEUW = ['Speelminuten', 'Kaarten', 'Kwartieroverzicht', 'Doelstelling behaald']

describe('AC10 / AC24 — pariteit scherm ↔ rapport in elke state', () => {
  const tweehonderdeen = (): Partial<TeamData> => merge(basis(), { uitslagen: Array.from({ length: 201 }, (_, i) => uitslag(i, 3, 0)) })
  const states: [string, () => Partial<TeamData>, Opties][] = [
    ['rijk', rijk, {}],
    ['rijk, periode 4w', rijk, { periode: '4w' }],
    ['rijk, periode 8w', rijk, { periode: '8w' }],
    ['aanwezigheid-bron stuk', rijk, { rpcErrors: { inzichten_aanwezigheid: FOUT } }],
    ['maandopkomst-bron stuk', rijk, { rpcErrors: { inzichten_training_opkomst_per_maand: FOUT } }],
    ['teamrating-bron stuk', rijk, { rpcErrors: { inzichten_rating_team_per_wedstrijd: FOUT } }],
    ['uitslagen-bron stuk', rijk, { rpcErrors: { inzichten_wedstrijd_uitslagen: FOUT } }],
    ['201 wedstrijden (afgekapt)', tweehonderdeen, {}],
    ['200 wedstrijden (grens)', () => merge(basis(), { uitslagen: Array.from({ length: 200 }, (_, i) => uitslag(i, 3, 0)) }), {}],
    ['0 wedstrijden', basis, {}],
  ]

  it.each(states)('AC24: %s — alle zes tegels hebben op het rapport exact dezelfde regels als op het scherm', async (_n, data, o) => {
    const { container } = await renderInzichten(data(), o)
    for (const id of KPI_IDS) {
      expect(rapportTegel(container, id), id).not.toBeNull()
      expect(rapportTegel(container, id), id).toEqual(tegelTekst(container, id))
    }
    expect(printBlok(container).querySelectorAll('[data-rapport-kpi]')).toHaveLength(6)
  })

  it('AC10: het rapport heeft 6 tegels in de volgorde van het scherm, met venster en deltatekst (rijk)', async () => {
    const { container } = await renderInzichten(rijk())
    const ids = Array.from(printBlok(container).querySelectorAll('[data-rapport-kpi]')).map((e) => e.getAttribute('data-rapport-kpi'))
    expect(ids).toEqual([...KPI_IDS])
    expect(rapportTegel(container, 'opkomst')).toEqual(['Trainingsopkomst', `Laatste maand (${OKT})`, '90%', '+20 t.o.v. vorige maand'])
    expect(rapportTegel(container, 'aanwezigheid')).toEqual(['Totale aanwezigheid', 'Heel seizoen', '84%', 'Norm 85%'])
    expect(rapportTegel(container, 'rating')).toEqual(['Gem. teamrating', 'Heel seizoen', '7.3', '+0.6 t.o.v. de 5 daarvoor'])
    expect(rapportTegel(container, 'doelsaldo')).toEqual(['Doelsaldo', 'Heel seizoen', '+6', '12 voor · 6 tegen'])
    expect(rapportTegel(container, 'punten')).toEqual(['Punten per wedstrijd', 'Heel seizoen', '1.83', '11 punten uit 6 wedstrijden'])
    expect(rapportTegel(container, 'cleansheets')).toEqual(['Clean sheets', 'Heel seizoen', '2', 'van 6 wedstrijden'])
  })

  it('AC24: de Doelsaldo-tegel op het rapport is gelijk aan de saldo-cel van de totaalrij in Resultaten (saldo === resultaten.totaal)', async () => {
    const { container } = await renderInzichten(rijk())
    const rijen = Array.from(rapportSectie(container, 'Resultaten')!.querySelectorAll('tbody tr')).map(celTekst)
    const totaal = rijen.at(-1)!
    expect(totaal[0]).toBe(nl.insights.totaalLabel)
    expect(rapportTegel(container, 'doelsaldo')![2]).toBe(totaal.at(-1))
    expect(rapportTegel(container, 'punten')![2]).toBe(totaal[5])
  })

  it('AC17/AC19: fout → alle drie uitslagtegels tonen bronFout; 201 → afgekapt; nooit een cijfer of een verzonnen 0', async () => {
    const stuk = await renderInzichten(rijk(), { rpcErrors: { inzichten_wedstrijd_uitslagen: FOUT } })
    for (const [id, label] of [['doelsaldo', 'Doelsaldo'], ['punten', 'Punten per wedstrijd'], ['cleansheets', 'Clean sheets']]) {
      expect(rapportTegel(stuk.container, id)).toEqual([label, 'Heel seizoen', nl.insights.bronFout])
    }
    cleanup()
    const veel = await renderInzichten(tweehonderdeen())
    for (const [id, label] of [['doelsaldo', 'Doelsaldo'], ['punten', 'Punten per wedstrijd'], ['cleansheets', 'Clean sheets']]) {
      expect(rapportTegel(veel.container, id)).toEqual([label, 'Heel seizoen', nl.insights.afgekapt])
    }
    expect(printBlok(veel.container).textContent).not.toContain('+603')
    expect(printBlok(veel.container).textContent).not.toContain('603 voor')
    expect(printBlok(veel.container).textContent).not.toContain('3.00')
  })

  it('AC21: 0 wedstrijden → "—" met "Nog geen data" in het rapport, geen 0.00 en geen losse 0', async () => {
    const { container } = await renderInzichten(basis())
    for (const [id, label] of [['doelsaldo', 'Doelsaldo'], ['punten', 'Punten per wedstrijd'], ['cleansheets', 'Clean sheets']]) {
      expect(rapportTegel(container, id)).toEqual([label, 'Heel seizoen', '—', 'Nog geen data'])
    }
    expect(printBlok(container).textContent).not.toContain('0.00')
  })

  it('AC24 (1 bron): het rapport rekent met dezelfde delta als de strook (ruis rond 0 → "0.0", geen plusteken)', async () => {
    const { container } = await renderInzichten(merge(basis(), rating(7.0, 7.001)))
    expect(rapportTegel(container, 'rating')![3]).toBe('0.0 t.o.v. de 5 daarvoor')
  })
})

describe('AC12 / AC24 — sectie Resultaten tegen de Thuis/uit-kaart', () => {
  it('AC12: de tabel heeft 7 kolommen, rijen Thuis, Uit, Onbekend, Totaal; alle cellen gelijk aan de kaart', async () => {
    const { container } = await renderInzichten(rijk())
    const sectie = rapportSectie(container, 'Resultaten')!
    const tabel = sectie.querySelector('table.rapport-tabel')!
    const kaart = viaKaart(container, nl.insights.thuisUitTitle)
    expect(Array.from(tabel.querySelectorAll('thead th'))).toHaveLength(7)
    expect(Array.from(tabel.querySelectorAll('thead th')).map((e) => e.textContent)).toEqual(
      Array.from(kaart.querySelectorAll('thead th')).map((e) => e.textContent),
    )
    const rapportRijen = Array.from(tabel.querySelectorAll('tbody tr')).map(celTekst)
    expect(rapportRijen).toEqual(Array.from(kaart.querySelectorAll('tbody tr')).map(celTekst))
    expect(rapportRijen.map((r) => r[0])).toEqual([nl.insights.thuisLabel, nl.insights.uitLabel, nl.insights.onbekendLabel, nl.insights.totaalLabel])
    expect(rapportRijen.at(-1)).toEqual(['Totaal', '6', '3', '2', '1', '1.83', '+6'])
    // clean-sheetsregel gelijk aan de kaart
    const kaartRegel = Array.from(kaart.querySelectorAll('p')).find((p) => p.textContent?.startsWith('Clean sheets'))!.textContent
    expect(kaartRegel).toBe('Clean sheets: 2 van 6')
    expect(Array.from(sectie.querySelectorAll('.rapport-noot')).map((e) => e.textContent)).toEqual([kaartRegel])
    // zonder eigen doelpunt komt bewust niet mee (R8)
    expect(sectie.textContent).not.toContain('Zonder eigen doelpunt')
  })

  it('AC12: zonder wedstrijd met home_away = null geen Onbekend-rij', async () => {
    const { container } = await renderInzichten(merge(basis(), { uitslagen: uitslagen([[1, 0], [2, 1, 'away']]) }))
    const rijen = Array.from(rapportSectie(container, 'Resultaten')!.querySelectorAll('tbody tr')).map((tr) => celTekst(tr)[0])
    expect(rijen).toEqual([nl.insights.thuisLabel, nl.insights.uitLabel, nl.insights.totaalLabel])
  })

  it('AC17/AC19: fout → kop + bronFout, geen tabel; 201 → kop + afgekapt, geen tabel en geen cijfers', async () => {
    const stuk = await renderInzichten(rijk(), { rpcErrors: { inzichten_wedstrijd_uitslagen: FOUT } })
    let sectie = rapportSectie(stuk.container, 'Resultaten')!
    expect(sectie).toBeDefined()
    expect(rapportMeldingen(sectie)).toEqual([nl.insights.bronFout])
    expect(sectie.querySelector('table')).toBeNull()
    cleanup()
    const veel = await renderInzichten(merge(basis(), { uitslagen: Array.from({ length: 201 }, (_, i) => uitslag(i, 3, 0)) }))
    sectie = rapportSectie(veel.container, 'Resultaten')!
    expect(rapportMeldingen(sectie)).toEqual([nl.insights.afgekapt])
    expect(sectie.querySelector('table')).toBeNull()
    expect(sectie.textContent).not.toMatch(/\d/)
  })

  it('AC12: 0 wedstrijden → kop + thuisUitEmpty (geen tabel, geen melding)', async () => {
    const { container } = await renderInzichten(basis())
    const sectie = rapportSectie(container, 'Resultaten')!
    expect(sectie.querySelector('table')).toBeNull()
    expect(sectie.querySelector('.rapport-noot')!.textContent).toBe(nl.insights.thuisUitEmpty)
    expect(rapportMeldingen(sectie)).toEqual([])
  })
})

describe('AC12 / R1 — sectie Topscorers tegen de Topscorers-kaart', () => {
  it('AC12: 4 kolommen; rijen, volgorde, aantallen en gast-markering gelijk aan de eerste 6 rijen van de kaart', async () => {
    const { container } = await renderInzichten(rijkRapport(8))
    const sectie = rapportSectie(container, 'Topscorers')!
    const tabel = sectie.querySelector('table.rapport-tabel')!
    expect(Array.from(tabel.querySelectorAll('thead th')).map((e) => e.textContent)).toEqual(['Speler', 'Doelpunten', 'Assists', 'Betrokken'])
    const rapportRijen = Array.from(tabel.querySelectorAll('tbody tr'))
    expect(rapportRijen).toHaveLength(6)
    const kaartRijen = Array.from(viaKaart(container, nl.insights.topscorersTitle).querySelectorAll('li'))
    expect(kaartRijen).toHaveLength(8)
    rapportRijen.forEach((tr, i) => {
      const kaartLi = kaartRijen[i]
      const naamR = tr.querySelector('th')!.childNodes[0].textContent
      const naamK = kaartLi.querySelector('span')!.childNodes[0].textContent
      expect(naamR).toBe(naamK)
      expect(Boolean(tr.querySelector('.rapport-gast'))).toBe(kaartLi.textContent!.includes(nl.insights.gastLabel))
      const getallenK = (kaartLi.lastElementChild!.textContent ?? '').match(/\d+/g)
      const getallenR = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent)
      expect(getallenR).toEqual(getallenK)
    })
    // de gast heeft tekst, geen kleur alleen
    expect(rapportRijen[2].querySelector('.rapport-gast')!.textContent).toBe('(gast)')
    expect(rapportRijen[0].querySelector('.rapport-gast')).toBeNull()
  })

  it('AC12 (grens): 6 topscorers → geen "Top 6 van"-regel; 7 → 6 rijen + "Top 6 van 7 spelers", de zevende ontbreekt', async () => {
    const zes = await renderInzichten(rijkRapport(6))
    expect(rapportSectie(zes.container, 'Topscorers')!.querySelectorAll('tbody tr')).toHaveLength(6)
    expect(rapportSectie(zes.container, 'Topscorers')!.querySelector('.rapport-noot')).toBeNull()
    cleanup()
    const zeven = await renderInzichten(rijkRapport(7))
    const sectie = rapportSectie(zeven.container, 'Topscorers')!
    expect(sectie.querySelectorAll('tbody tr')).toHaveLength(6)
    expect(sectie.querySelector('.rapport-noot')!.textContent).toBe('Top 6 van 7 spelers')
    expect(sectie.textContent).not.toContain('Speler G')
    // op het scherm staat hij er wel
    expect(viaKaart(zeven.container, nl.insights.topscorersTitle).textContent).toContain('Speler G')
  })

  it('AC12: fout → bronFout; geen doelpunten → topscorersEmpty (ook als er alleen assists zijn, zoals de kaart); zonder rijen geen tabel', async () => {
    const stuk = await renderInzichten(rijkRapport(), { rpcErrors: { inzichten_speler_momenten: FOUT } })
    expect(rapportMeldingen(rapportSectie(stuk.container, 'Topscorers'))).toEqual([nl.insights.bronFout])
    expect(rapportSectie(stuk.container, 'Topscorers')!.querySelector('table')).toBeNull()
    cleanup()
    const alleenAssists = await renderInzichten(merge(rijk(), { spelerMomenten: [moment('a', 'Alleen Assist', 0, 4)] }))
    const sectie = rapportSectie(alleenAssists.container, 'Topscorers')!
    expect(sectie.querySelector('.rapport-noot')!.textContent).toBe(nl.insights.topscorersEmpty)
    expect(sectie.querySelector('table')).toBeNull()
    expect(viaKaart(alleenAssists.container, nl.insights.topscorersTitle).textContent).toContain(nl.insights.topscorersEmpty)
  })

  it('AC12: een naam met {placeholder} blijft letterlijk staan', async () => {
    const { container } = await renderInzichten(merge(rijk(), { spelerMomenten: [moment('x', 'Piet {drempel} {n}', 3, 1)] }))
    expect(rapportSectie(container, 'Topscorers')!.querySelector('tbody th')!.textContent).toBe('Piet {drempel} {n}')
  })

  it('AC12: een inactieve of gast-speler telt mee (de kaart ook); inactieve spelers krijgen geen label', async () => {
    const { container } = await renderInzichten(merge(rijk(), { spelerMomenten: [moment('g', 'Gerrit Gast', 2, 0, true), moment('i', 'Ivo Inactief', 1, 0)] }))
    const rijen = Array.from(rapportSectie(container, 'Topscorers')!.querySelectorAll('tbody tr'))
    expect(rijen.map((r) => r.querySelector('th')!.textContent)).toEqual(['Gerrit Gast(gast)', 'Ivo Inactief'])
  })
})

describe('AC13 — het rapport volgt de gekozen periode', () => {
  // Twee wedstrijden binnen de laatste 4 weken (t.o.v. 2026-10-15), drie erbuiten.
  const metDatums = (): Partial<TeamData> =>
    merge(basis(), {
      uitslagen: [
        { event_id: 'o1', datum: '2026-07-10', home_away: 'home', goals_for: 1, goals_against: 0, formatie: null },
        { event_id: 'o2', datum: '2026-08-10', home_away: 'home', goals_for: 1, goals_against: 0, formatie: null },
        { event_id: 'o3', datum: '2026-09-01', home_away: 'away', goals_for: 0, goals_against: 2, formatie: null },
        { event_id: 'i1', datum: '2026-09-25', home_away: 'home', goals_for: 3, goals_against: 0, formatie: null },
        { event_id: 'i2', datum: '2026-10-02', home_away: 'away', goals_for: 2, goals_against: 2, formatie: null },
      ],
    })

  it('AC13: heel seizoen → 5 wedstrijden, 4w → 2 wedstrijden; Resultaten en tegels volgen dezelfde periode als het scherm', async () => {
    const seizoen = await renderInzichten(metDatums())
    expect(rapportSectie(seizoen.container, 'Resultaten')!.querySelector('tbody tr:last-child td')!.textContent).toBe('5')
    cleanup()
    const vier = await renderInzichten(metDatums(), { periode: '4w' })
    const totaal = celTekst(rapportSectie(vier.container, 'Resultaten')!.querySelector('tbody tr:last-child')!)
    expect(totaal.slice(0, 2)).toEqual(['Totaal', '2'])
    expect(rapportTegel(vier.container, 'punten')).toEqual(['Punten per wedstrijd', nl.insights.periode4w, '2.00', '4 punten uit 2 wedstrijden'])
    expect(rapportTegel(vier.container, 'punten')).toEqual(tegelTekst(vier.container, 'punten'))
  })

  it('AC13 (4w): alle tegels dragen het 4w-venster, Trainingsopkomst blijft "Laatste maand"; nergens "Heel seizoen" in het rapport', async () => {
    const { container } = await renderInzichten(rijk(), { periode: '4w' })
    for (const id of ['aanwezigheid', 'rating', 'doelsaldo', 'punten', 'cleansheets']) {
      expect(rapportTegel(container, id)![1]).toBe(nl.insights.periode4w)
    }
    expect(rapportTegel(container, 'opkomst')![1]).toBe(`Laatste maand (${OKT})`)
    expect(printBlok(container).textContent).not.toContain(nl.insights.periodeSeizoen)
    expect(printBlok(container).querySelector('.rapport-periode')!.textContent).toContain(nl.insights.periode4w)
  })

  it('AC13 / R5: de signalen die het hele seizoen of een momentopname gebruiken, zeggen dat zelf in de zin (geen extra tekst nodig)', async () => {
    const { container } = await renderInzichten(merge(basis(), daler(), keeperGeblesseerd()), { periode: '4w' })
    expect(rapportSignalen(container)).toEqual([
      expect.stringContaining('seizoensgemiddelde'),
      expect.stringContaining('op dit moment'),
    ])
  })
})

describe('AC17 / AC19 / AC40 — bronfout per rapportsectie, op paginaniveau', () => {
  const secties: [string, Opties, string][] = [
    ['uitslagen → Resultaten', { rpcErrors: { inzichten_wedstrijd_uitslagen: FOUT } }, 'Resultaten'],
    ['speler_momenten → Topscorers', { rpcErrors: { inzichten_speler_momenten: FOUT } }, 'Topscorers'],
    ['rating_per_speler → Ratings per speler', { rpcErrors: { inzichten_rating_per_speler: FOUT } }, 'Ratings per speler'],
    ['aanwezigheid_per_speler → Aanwezigheid per speler', { rpcErrors: { inzichten_aanwezigheid_per_speler: FOUT } }, 'Aanwezigheid per speler'],
    ['training_opkomst_per_maand → Trainingsopkomst per maand', { rpcErrors: { inzichten_training_opkomst_per_maand: FOUT } }, 'Trainingsopkomst per maand'],
    ['vorm (events-query) → Recente vorm', { selectErrors: { vorm: FOUT } }, 'Recente vorm'],
  ]

  it.each(secties)('AC17: %s — de sectie blijft staan met exact bronFout, geen ruwe fout, het rapport blijft bestaan', async (_n, o, titel) => {
    // controle zonder fout: geen melding in die sectie
    const ok = await renderInzichten(rijkRapport(), {})
    expect(rapportMeldingen(rapportSectie(ok.container, titel))).toEqual([])
    cleanup()
    const { container } = await renderInzichten(rijkRapport(), o)
    expect(printBlok(container)).not.toBeNull()
    const sectie = rapportSectie(container, titel)
    expect(sectie, titel).toBeDefined()
    expect(rapportMeldingen(sectie)).toEqual([nl.insights.bronFout])
    expect(document.body.textContent).not.toContain('PGRST202')
    expect(document.body.textContent).not.toContain('geheime_functie')
  })

  it('AC17: een falende vorm toont geen verzonnen "0 gewonnen, 0 gelijk, 0 verloren" en geen badges; zonder fout staat de telregel er wel', async () => {
    const ok = await renderInzichten(rijkRapport())
    expect(rapportSectie(ok.container, 'Recente vorm')!.textContent).toContain(vormTekst(1, 1, 1))
    cleanup()
    const { container } = await renderInzichten(rijkRapport(), { selectErrors: { vorm: FOUT } })
    const sectie = rapportSectie(container, 'Recente vorm')!
    expect(sectie.textContent).toBe('Recente vorm' + nl.insights.bronFout)
    expect(printBlok(container).textContent).not.toContain('0 gewonnen')
  })

  it('AC17: de melding bij Trainingsopkomst per maand is hetzelfde als bij de tegel (opkomst-tegel én sectie)', async () => {
    const { container } = await renderInzichten(rijkRapport(), { rpcErrors: { inzichten_training_opkomst_per_maand: FOUT } })
    expect(rapportTegel(container, 'opkomst')).toEqual(['Trainingsopkomst', 'Laatste maand', nl.insights.bronFout])
    expect(rapportMeldingen(rapportSectie(container, 'Trainingsopkomst per maand'))).toEqual([nl.insights.bronFout])
  })

  it('AC40 (paginadeel): acht RPC\'s en twee selects stuk, maar nog wel data elders (aanwezigheid, events) → geen 500 maar het rapport met meldingen', async () => {
    const o: Opties = {
      rpcErrors: {
        inzichten_wedstrijd_uitslagen: FOUT, inzichten_speler_momenten: FOUT, inzichten_rating_per_speler: FOUT,
        inzichten_aanwezigheid_per_speler: FOUT, inzichten_training_opkomst_per_maand: FOUT, inzichten_rating_team_per_wedstrijd: FOUT,
        inzichten_rating_vorm_per_speler: FOUT, inzichten_training_evaluaties: FOUT,
      },
      selectErrors: { vorm: FOUT, posities: FOUT },
    }
    const { container } = await renderInzichten(merge(rijkRapport(), { evaluaties: trainingen('2026-10', 3) }), o)
    expect(printBlok(container)).not.toBeNull()
    expect(rapportMeldingen(printBlok(container) as HTMLElement).length).toBeGreaterThanOrEqual(10)
    expect(document.body.textContent).not.toContain('PGRST202')
  })

  it('bestaand gedrag (brief deel 1 §7, deel 2 §2.5): als écht álle bronnen falen valt de pagina terug op de lege staat — geen crash, geen ruwe fout, geen rapport', async () => {
    const alleRpcs = Object.fromEntries(Object.keys(RPC_BRON).map((n) => [n, FOUT]))
    // Geen enkele data in de tabellen (events/players/metingen): ook de niet-RPC-bronnen leveren niets.
    const { container } = await renderInzichten({}, { rpcErrors: alleRpcs, selectErrors: { vorm: FOUT, posities: FOUT } })
    expect(container.textContent).toContain(nl.insights.geenDataTitle)
    expect(strook(container)).toBeNull()
    expect(blok(container)).toBeNull()
    expect(container.querySelector('[data-print-only]')).toBeNull()
    expect(document.body.textContent).not.toContain('PGRST202')
    expect(document.body.textContent).not.toContain('geheime_functie')
    expect(document.body.textContent).not.toContain(nl.insights.bronFout)
  })

  it('bestaand gedrag: alleen lege data (alle RPC\'s slagen met 0 rijen, aanwezigheid 0/0) geeft dezelfde lege staat', async () => {
    const { container } = await renderInzichten({ aanwezigheid: [{ aanwezig: 0, afwezig: 0 }] })
    expect(container.textContent).toContain(nl.insights.geenDataTitle)
    expect(strook(container)).toBeNull()
    expect(container.querySelector('[data-print-only]')).toBeNull()
    expect(document.body.textContent).not.toContain(nl.insights.bronFout)
  })

  it('AC17: bij een fout op de uitslagen en tegelijk een fout op de momenten blijft de rest van het rapport (opkomst, ratings) gewoon staan', async () => {
    const { container } = await renderInzichten(rijkRapport(), { rpcErrors: { inzichten_wedstrijd_uitslagen: FOUT, inzichten_speler_momenten: FOUT } })
    expect(rapportSectie(container, 'Trainingsopkomst per maand')!.querySelector('.rapport-bars')).not.toBeNull()
    expect(rapportSectie(container, 'Ratings per speler')!.textContent).toContain('Rik Rating')
  })
})

describe('AC16 / AC19 — signalenblok in het rapport', () => {
  it('AC16: een falende bron + signalen → rapport toont de signalen en één melding eronder, zonder bolletje (geen .rapport-signaal)', async () => {
    const { container } = await renderInzichten(merge(basis(), wegblijver(), stijger()), { rpcErrors: { inzichten_rating_vorm_per_speler: FOUT } })
    const sectie = rapportSectie(container, nl.insights.signalenTitle)!
    expect(rapportSignalen(container)).toEqual(['Wim Weg was minder dan 50% van de tijd aanwezig.'])
    expect(rapportMeldingen(sectie)).toEqual([nl.insights.signalenOnvolledig])
    expect(sectie.lastElementChild!.textContent).toBe(nl.insights.signalenOnvolledig)
    // scherm en rapport zijn gelijk
    expect(rapportSignalen(container)).toEqual(signalen(container))
    expect(melding(container)).toEqual([nl.insights.signalenOnvolledig])
  })

  it('AC16: 0 signalen + onvolledig → het rapportblok bestaat met alleen de melding; zonder onvolledig verdwijnt het', async () => {
    const stuk = await renderInzichten(merge(basis(), stijger()), { rpcErrors: { inzichten_rating_vorm_per_speler: FOUT } })
    const sectie = rapportSectie(stuk.container, nl.insights.signalenTitle)!
    expect(rapportSignalen(stuk.container)).toEqual([])
    expect(rapportMeldingen(sectie)).toEqual([nl.insights.signalenOnvolledig])
    cleanup()
    const ok = await renderInzichten(basis())
    expect(rapportSectie(ok.container, nl.insights.signalenTitle)).toBeUndefined()
  })

  it('AC19 / O4: 201 wedstrijden → geen doelsaldo-signaal, wel de onvolledig-melding in het rapport', async () => {
    const { container } = await renderInzichten(merge(basis(), { uitslagen: Array.from({ length: 201 }, (_, i) => uitslag(i, 3, 0)) }))
    expect(rapportSignalen(container)).toEqual([])
    expect(rapportMeldingen(rapportSectie(container, nl.insights.signalenTitle))).toEqual([nl.insights.signalenOnvolledig])
  })
})

describe('Rapport — fout gaat voor afgekapt, DOM-regels', () => {
  it('fout én afgekapt tegelijk (op paginaniveau onbereikbaar): tegels en Resultaten tonen bronFout, nergens afgekapt', () => {
    const resultaten = splitsThuisUit([{ event_id: 'a', datum: S, home_away: 'home', goals_for: 1, goals_against: 0, formatie: null }])
    const { container } = render(
      <SeizoensrapportPrint
        t={nl}
        teamName="FC Test"
        teamLogoUrl={null}
        venster={{ start: S, end: E }}
        periodeLabel="Heel seizoen"
        opkomst={null}
        maanden={[]}
        aanwezigheidPercentage={null}
        rating={null}
        saldo={resultaten.totaal}
        signalen={[]}
        ratingTopWorst={{ top: [], worst: [] }}
        aanwezigheidTopWorst={{ top: [], worst: [] }}
        vormTelling={{ win: 0, gelijk: 0, verlies: 0, onbekend: 0 }}
        resultaten={resultaten}
        topscorers={{ spelers: [], doelpunten: 0, assists: 0, assistPercentage: null }}
        uitslagenAfgekapt={true}
        fout={{ uitslagen: true }}
        primaryColor="#111111"
        secondaryColor="#222222"
      />,
    )
    const blok = container.querySelector('[data-print-only]') as HTMLElement
    for (const id of ['doelsaldo', 'punten', 'cleansheets']) {
      const regels = Array.from(blok.querySelectorAll(`[data-rapport-kpi="${id}"] p`)).map((p) => p.textContent)
      expect(regels[2]).toBe(nl.insights.bronFout)
    }
    expect(blok.textContent).toContain(nl.insights.bronFout)
    expect(blok.textContent).not.toContain(nl.insights.afgekapt)
  })

  it('AC39/R-regels: geen <h2>, <caption>, [data-kpi], [data-conclusielaag], role=alert of sr-only-tabel in het rapport', async () => {
    const { container } = await renderInzichten(rijkRapport(), { rpcErrors: { inzichten_speler_momenten: FOUT } })
    const blok = printBlok(container)
    expect(blok.querySelector('h2')).toBeNull()
    expect(blok.querySelector('caption')).toBeNull()
    expect(blok.querySelector('[data-kpi]')).toBeNull()
    expect(blok.querySelector('[data-conclusielaag]')).toBeNull()
    expect(blok.querySelector('[role="alert"]')).toBeNull()
    expect(blok.querySelector('table.sr-only')).toBeNull()
  })

  it('AC41: de sectievolgorde is Kop, tegels, Wat valt op, Resultaten | Topscorers, Vorm, Opkomst, Ratings | Aanwezigheid, voet', async () => {
    const { container } = await renderInzichten(rijkRapport())
    const kopjes = Array.from(printBlok(container).querySelectorAll('.rapport-sectiekop')).map((e) => e.textContent)
    expect(kopjes).toEqual([
      'Wat valt op', 'Resultaten', 'Topscorers', 'Recente vorm', 'Trainingsopkomst per maand', 'Ratings per speler', 'Aanwezigheid per speler',
      'Speelminuten', 'Kaarten', 'Kwartieroverzicht', 'Doelstelling behaald',
    ])
    const delen = Array.from(printBlok(container).children).map((e) => e.className.split(' ')[0])
    expect(delen[0]).toBe('rapport-kop')
    expect(delen[1]).toBe('rapport-kpis')
    expect(delen.at(-1)).toBe('rapport-voet')
    // Resultaten en Topscorers staan in dezelfde rij naast elkaar
    expect(rapportSectie(container, 'Resultaten')!.parentElement).toBe(rapportSectie(container, 'Topscorers')!.parentElement)
    expect(rapportSectie(container, 'Resultaten')!.parentElement!.className).toBe('rapport-kolommen')
    // Uitbreiding (X1): Speelminuten | Kaarten en Kwartieroverzicht | Doelstelling delen elk een rij, achter Ratings | Aanwezigheid
    expect(rapportSectie(container, 'Speelminuten')!.parentElement).toBe(rapportSectie(container, 'Kaarten')!.parentElement)
    expect(rapportSectie(container, 'Kwartieroverzicht')!.parentElement).toBe(rapportSectie(container, 'Doelstelling behaald')!.parentElement)
    expect(rapportSectie(container, 'Speelminuten')!.parentElement!.className).toBe('rapport-kolommen')
    expect(rapportSectie(container, 'Kwartieroverzicht')!.parentElement!.className).toBe('rapport-kolommen')
    expect(rapportSectie(container, 'Speelminuten')!.parentElement).not.toBe(rapportSectie(container, 'Kwartieroverzicht')!.parentElement)
    expect(rapportSectie(container, 'Ratings per speler')!.parentElement).toBe(rapportSectie(container, 'Aanwezigheid per speler')!.parentElement)
  })

  it('AC41/AC9: het aantal queries is ongewijzigd met alle rapportsecties gevuld (18 rpc, 17 namen, 10 from)', async () => {
    const { rpcCalls, fromCalls } = await renderInzichten(
      merge(rijkRapport(), uitbreidingData(), {
        events: [...vormEvents(), { id: 'tr1', team_id: TEAM, type: 'training', date: '2026-10-01', trainingstype: 'vct' }],
        trainingOefeningen: [{ team_id: TEAM, event_id: 'tr1', oefeningen: { categorie: 'passen' } }],
        metingen: [{ id: 'mt1', team_id: TEAM, categorie: 'partijen_groot', datum: '2026-07-05', stap: 1, notes: null, created_at: '2026-07-05' }],
      }),
    )
    expect(rpcCalls).toHaveLength(VOOR.rpcAantal)
    expect(Array.from(new Set(rpcCalls.map((c) => c.name))).sort()).toEqual(VOOR.rpcNamen)
    expect(fromCalls).toHaveLength(VOOR.fromAantal)
  })
})

describe('AC29 (rapport) — vijf talen', () => {
  const R: Record<string, { res: string; top: string; betrokken: string; afgekort: string }> = {
    nl: { res: 'Resultaten', top: 'Topscorers', betrokken: 'Betrokken', afgekort: 'Top {n} van {totaal} spelers' },
    en: { res: 'Results', top: 'Top scorers', betrokken: 'Involved', afgekort: 'Top {n} of {totaal} players' },
    de: { res: 'Ergebnisse', top: 'Torschützen', betrokken: 'Beteiligt', afgekort: 'Top {n} von {totaal} Spielern' },
    es: { res: 'Resultados', top: 'Goleadores', betrokken: 'Implicado', afgekort: 'Top {n} de {totaal} jugadores' },
    fr: { res: 'Résultats', top: 'Buteurs', betrokken: 'Impliqué', afgekort: 'Top {n} sur {totaal} joueurs' },
  }
  const talen = Object.keys(R)

  it.each(talen)('AC29 (%s): sectietitels, kolomkop en "Top 6 van 7" in de taal; geen kaarttitel, geen restant {…}', async (taal) => {
    const d = dicts[taal]
    const { container } = await renderInzichten(rijkRapport(7), { locale: taal })
    const blok = printBlok(container)
    const res = rapportSectie(container, R[taal].res)
    const top = rapportSectie(container, R[taal].top)
    expect(res, 'Resultaten').toBeDefined()
    expect(top, 'Topscorers').toBeDefined()
    expect(top!.querySelectorAll('thead th')[3].textContent).toBe(R[taal].betrokken)
    expect(top!.querySelector('.rapport-noot')!.textContent).toBe(R[taal].afgekort.replace('{n}', '6').replace('{totaal}', '7'))
    expect(res!.querySelectorAll('thead th')).toHaveLength(7)
    // titels zijn niet gelijk aan de kaarttitels en die staan ook niet in het rapport (V6)
    for (const kaartTitel of [d.insights.thuisUitTitle, d.insights.topscorersTitle, d.insights.formatieTitle]) {
      expect(blok.textContent).not.toContain(kaartTitel)
      expect([R[taal].res, R[taal].top]).not.toContain(kaartTitel)
    }
    expect(blok.textContent).not.toMatch(/\{[a-zA-Z]+\}/)
    if (taal !== 'nl') {
      expect(R[taal].res).not.toBe(R.nl.res)
      expect(R[taal].top).not.toBe(R.nl.top)
      expect(R[taal].betrokken).not.toBe(R.nl.betrokken)
      expect(R[taal].afgekort).not.toBe(R.nl.afgekort)
    }
    // zelfde regels voor de zes tegels op scherm en rapport, ook in deze taal
    for (const id of KPI_IDS) expect(rapportTegel(container, id), id).toEqual(tegelTekst(container, id))
  })

  it.each(talen)('AC29 / AC17 (%s): bronFout en afgekapt in het rapport zijn de woorden van de taal', async (taal) => {
    const stuk = await renderInzichten(rijkRapport(), { locale: taal, rpcErrors: { inzichten_wedstrijd_uitslagen: FOUT, inzichten_speler_momenten: FOUT } })
    expect(rapportMeldingen(rapportSectie(stuk.container, R[taal].res))).toEqual([dicts[taal].insights.bronFout])
    expect(rapportMeldingen(rapportSectie(stuk.container, R[taal].top))).toEqual([dicts[taal].insights.bronFout])
    cleanup()
    const veel = await renderInzichten(merge(basis(), { uitslagen: Array.from({ length: 201 }, (_, i) => uitslag(i, 3, 0)) }), { locale: taal })
    expect(rapportMeldingen(rapportSectie(veel.container, R[taal].res))).toEqual([dicts[taal].insights.afgekapt])
  })
})

describe('AC32 (rapport) — tenant', () => {
  const beide = [
    { team_id: TEAM, user_id: 'u1', rol: 'owner' },
    { team_id: ANDER, user_id: 'u1', rol: 'owner' },
  ]
  const ander = (): Partial<TeamData> => ({
    aanwezigheid: [{ aanwezig: 5, afwezig: 5 }],
    uitslagen: Array.from({ length: 9 }, (_, i) => uitslag(i, 9, 0)),
    spelerMomenten: [moment('z1', 'Zita Ander', 40, 9)],
    ratingPerSpeler: [{ player_id: 'z2', naam: 'Zeno Ander', gemiddelde: 9.9, aantal: 9 }],
  })

  it('AC32: namen en aantallen van team 2 komen niet voor in Resultaten, Topscorers of de andere rapportsecties', async () => {
    const { container, rpcCalls } = await renderInzichten(rijkRapport(), { anderen: { [ANDER]: ander() }, members: beide, activeTeam: TEAM })
    const blok = printBlok(container)
    expect(blok.textContent).not.toContain('Ander')
    expect(blok.textContent).not.toContain('Zita')
    expect(rapportSectie(container, 'Resultaten')!.querySelector('tbody tr:last-child td')!.textContent).toBe('6')
    expect(rapportSectie(container, 'Topscorers')!.textContent).toContain('Speler A')
    expect(rapportTegel(container, 'punten')![3]).toBe('11 punten uit 6 wedstrijden')
    expect(rpcCalls.every((c) => c.args.p_team_id === TEAM)).toBe(true)
  })

  it('AC32: bij het andere actieve team zijn alleen díe gegevens in het rapport te zien', async () => {
    const { container } = await renderInzichten(rijkRapport(), { anderen: { [ANDER]: ander() }, members: beide, activeTeam: ANDER })
    const blok = printBlok(container)
    expect(blok.textContent).toContain('Zita Ander')
    expect(blok.textContent).not.toContain('Speler A')
    expect(blok.textContent).not.toContain('Rik Rating')
    expect(rapportSectie(container, 'Resultaten')!.querySelector('tbody tr:last-child td')!.textContent).toBe('9')
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
    // AC36 (Deel 2): ook in het rapport blijven vensterlabel en maandlabels UTC-veilig
    expect(rapportTegel(container, 'opkomst')).toEqual(tegelTekst(container, 'opkomst'))
    expect(rapportTegel(container, 'opkomst')![1]).toBe(`Laatste maand (${OKT})`)
    expect(Array.from(printBlok(container).querySelectorAll('.rapport-bar-label')).map((e) => e.textContent)).toEqual(['Sep 2026', OKT])
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

// ═══════════════════════════════════════════════════════════════════════
// Rapport-uitbreiding (rapport-uitbreiding/02-user-story.md AC1-AC30)
// ═══════════════════════════════════════════════════════════════════════
describe('Rapport-uitbreiding — pariteit scherm ↔ rapport (AC1-AC4)', () => {
  const schermTabel = (c: HTMLElement, titel: string) => viaKaart(c, titel).querySelector('table.sr-only') as HTMLElement
  const labelsEnWaarden = (sec: HTMLElement) =>
    Array.from(sec.querySelectorAll('.rapport-kwartier-labels > .rapport-kwartier-kolom')).map((k) => ({
      bak: k.querySelector('.rapport-bar-label')!.textContent,
      waarden: Array.from(k.querySelectorAll('.rapport-kwartier-waarde')).map((e) => e.textContent),
    }))

  it('AC1: de voor-waarden per bak zijn gelijk aan de datatabel van KwartierChart; de tegen-waarden aan de kolom Totaal van TegendoelpuntenChart', async () => {
    const { container } = await renderInzichten(metUitbreiding())
    const voorScherm = Array.from(schermTabel(container, nl.insights.kwartierTitle).querySelectorAll('tbody tr')).map((tr) => celTekst(tr))
    const tegenScherm = Array.from(schermTabel(container, nl.insights.tegenTitle).querySelectorAll('tbody tr')).map((tr) => celTekst(tr))
    const rapport = labelsEnWaarden(rapportSectie(container, 'Kwartieroverzicht')!)
    expect(rapport).toHaveLength(7)
    expect(voorScherm).toHaveLength(7)
    rapport.forEach((r, k) => {
      expect(r.bak).toBe(voorScherm[k][0])
      expect(r.waarden[0]).toBe(voorScherm[k][1])
      expect(r.waarden[1]).toBe(tegenScherm[k][3])
    })
    // de data is echt niet leeg: er zit een uitschieter in bak 46-60 en een bak met 0
    expect(rapport.map((r) => r.waarden[0])).toContain('6')
    expect(rapport.map((r) => r.waarden[0])).toContain('0')
  })

  it('AC2: de eerste 6 rijen van SpeelminutenKaart (naam, minuten, wedstrijden = x uit minutenDekking) staan identiek in het rapport', async () => {
    const { container } = await renderInzichten(metUitbreiding())
    const scherm = Array.from(viaKaart(container, nl.insights.speelminutenTitle).querySelectorAll('tbody tr')).slice(0, 6).map((tr) => [
      tr.querySelector('th')!.childNodes[0].textContent,
      tr.querySelectorAll('td')[1].querySelector('span')!.textContent,
      String(Number((tr.querySelectorAll('td')[0].textContent ?? '').match(/^\d+/)![0])),
    ])
    const rapport = Array.from(rapportSectie(container, 'Speelminuten')!.querySelectorAll('tbody tr')).map((tr) => [
      tr.querySelector('th')!.childNodes[0].textContent, tr.querySelectorAll('td')[0].textContent, tr.querySelectorAll('td')[1].textContent,
    ])
    expect(rapport).toHaveLength(6)
    expect(rapport).toEqual(scherm)
    expect(rapport[0]).toEqual(['Spel Een', '800', '9'])
  })

  it('AC3: de eerste 6 items van GeleRodeKaartenLijst (naam, kaartenWaarde) staan identiek in het rapport; het gastlabel staat los van de naam', async () => {
    const { container } = await renderInzichten(metUitbreiding())
    const scherm = Array.from(viaKaart(container, nl.insights.kaartenTitle).querySelectorAll('li')).slice(0, 6).map((li) => [
      li.children[0].childNodes[0].textContent, li.children[1].textContent,
    ])
    const rapport = Array.from(rapportSectie(container, 'Kaarten')!.querySelectorAll('.rapport-lijst-rij')).map((p) => [
      p.children[0].childNodes[0].textContent, p.children[1].textContent,
    ])
    expect(rapport).toHaveLength(6)
    expect(rapport).toEqual(scherm)
    expect(rapport[0]).toEqual(['Kees Kaart', '3 geel · 1 rood'])
  })

  it('AC4: de vier vakjes van DoelstellingOordeelKaart zijn gelijk aan die van het rapport', async () => {
    const { container } = await renderInzichten(metUitbreiding())
    const scherm = Array.from(viaKaart(container, nl.insights.oordeelTitle).querySelectorAll('dl > div')).map((d) => [d.querySelector('dt')!.textContent, d.querySelector('dd')!.textContent])
    const rapport = Array.from(rapportSectie(container, 'Doelstelling behaald')!.querySelectorAll('.rapport-oordeel > div')).map((d) => [d.children[0].textContent, d.children[1].textContent])
    expect(rapport).toEqual(scherm)
    expect(rapport.map((r) => r[1])).toEqual(['3', '1', '1', '1'])
  })
})

describe('Rapport-uitbreiding — bronfouten per RPC (AC9, AC10, AC11)', () => {
  const gezondHtml = async () => {
    const { container } = await renderInzichten(metUitbreiding())
    const m = Object.fromEntries(TITELS_NIEUW.map((t) => [t, rapportSectie(container, t)!.outerHTML]))
    cleanup()
    return m
  }
  const gevallen: [string, string[], string[]][] = [
    ['inzichten_speelminuten_per_speler', ['Speelminuten'], []],
    ['inzichten_speler_momenten', ['Kaarten'], []],
    ['inzichten_training_evaluaties', ['Doelstelling behaald'], []],
  ]
  it.each(gevallen)('AC9/AC10: %s stuk → alleen de eigen sectie toont bronFout; geen PGRST202; andere nieuwe secties ongewijzigd', async (rpc, stukke) => {
    const gezond = await gezondHtml()
    const { container } = await renderInzichten(metUitbreiding(), { rpcErrors: { [rpc]: FOUT } })
    for (const t of TITELS_NIEUW) {
      if (stukke.includes(t)) expect(rapportMeldingen(rapportSectie(container, t)), t).toEqual([nl.insights.bronFout])
      else expect(rapportSectie(container, t)!.outerHTML, t).toBe(gezond[t])
    }
    expect(printBlok(container).textContent).not.toContain('PGRST202')
    expect(printBlok(container).textContent).not.toContain('geheime_functie')
  })

  it('AC10: inzichten_speler_momenten stuk raakt ook Topscorers (gedeelde vlag) én Kaarten, niet Speelminuten', async () => {
    const { container } = await renderInzichten(metUitbreiding(), { rpcErrors: { inzichten_speler_momenten: FOUT } })
    expect(rapportMeldingen(rapportSectie(container, 'Topscorers'))).toEqual([nl.insights.bronFout])
    expect(rapportMeldingen(rapportSectie(container, 'Kaarten'))).toEqual([nl.insights.bronFout])
    expect(rapportMeldingen(rapportSectie(container, 'Speelminuten'))).toEqual([])
  })

  it('AC10 (U9): inzichten_doelpunten_per_minuut stuk → alleen de voor-regel een melding; tegenbalken blijven', async () => {
    const { container } = await renderInzichten(metUitbreiding(), { rpcErrors: { inzichten_doelpunten_per_minuut: FOUT } })
    const sec = rapportSectie(container, 'Kwartieroverzicht')!
    expect(rapportMeldingen(sec)).toEqual([nl.insights.bronFout])
    expect(sec.querySelector('.rapport-kwartier-bar-voor')).toBeNull()
    expect(sec.querySelector('.rapport-kwartier-bar-tegen')).not.toBeNull()
    const regel = Array.from(sec.querySelectorAll('.rapport-kwartier-regel')).find((r) => r.querySelector('.rapport-melding'))!
    expect(regel.querySelector('.rapport-kwartier-reeks')!.textContent).toBe(nl.insights.rapportKwartierVoor)
    expect(printBlok(container).textContent).not.toContain('PGRST202')
    const stukHtml = Object.fromEntries(['Speelminuten', 'Kaarten', 'Doelstelling behaald'].map((t) => [t, rapportSectie(container, t)!.outerHTML]))
    cleanup()
    const gezond = await renderInzichten(metUitbreiding())
    for (const t of Object.keys(stukHtml)) expect(stukHtml[t], t).toBe(rapportSectie(gezond.container, t)!.outerHTML)
  })

  it('AC10 (U9): inzichten_tegendoelpunten stuk → alleen de tegen-regel een melding; voorbalken blijven', async () => {
    const { container } = await renderInzichten(metUitbreiding(), { rpcErrors: { inzichten_tegendoelpunten: FOUT } })
    const sec = rapportSectie(container, 'Kwartieroverzicht')!
    expect(sec.querySelector('.rapport-kwartier-bar-tegen')).toBeNull()
    expect(sec.querySelector('.rapport-kwartier-bar-voor')).not.toBeNull()
    const regel = Array.from(sec.querySelectorAll('.rapport-kwartier-regel')).find((r) => r.querySelector('.rapport-melding'))!
    expect(regel.querySelector('.rapport-kwartier-reeks')!.textContent).toBe(nl.insights.rapportKwartierTegen)
    const stukHtml = Object.fromEntries(['Speelminuten', 'Kaarten', 'Doelstelling behaald'].map((t) => [t, rapportSectie(container, t)!.outerHTML]))
    cleanup()
    const gezond = await renderInzichten(metUitbreiding())
    for (const t of Object.keys(stukHtml)) expect(stukHtml[t], t).toBe(rapportSectie(gezond.container, t)!.outerHTML)
  })

  it('AC11: alle vijf nieuwe bronnen stuk → overal een melding, geen balken, geen kop zonder inhoud, geen ruwe fout', async () => {
    const rpcErrors = Object.fromEntries(NIEUWE_RPC_FOUTEN.map((n) => [n, FOUT]))
    const { container } = await renderInzichten(metUitbreiding(), { rpcErrors })
    for (const t of TITELS_NIEUW) expect(rapportMeldingen(rapportSectie(container, t)).length, t).toBeGreaterThan(0)
    expect(printBlok(container).querySelectorAll('.rapport-kwartier-bar')).toHaveLength(0)
    for (const sec of Array.from(printBlok(container).querySelectorAll('.rapport-sectie'))) {
      expect(sec.querySelectorAll(':scope > :not(.rapport-sectiekop)').length).toBeGreaterThan(0)
    }
    expect(printBlok(container).textContent).not.toContain('PGRST202')
  })
})

describe('Rapport-uitbreiding — venster, tenant, talen (AC19, AC25, AC30)', () => {
  it('AC30: een training van vandaag telt niet mee in Doelstelling (t/m gisteren); de bronnen van de andere secties lopen tot het einde van het venster', async () => {
    const data = merge(rijkRapport(), uitbreidingData(), { evaluaties: [...evRijen(2, () => 'ja', '2026-10-12'), { event_id: 'vandaag', datum: TODAY, doelstelling: 'X', rpe: null, oordeel: 'nee' }] })
    const { container, rpcCalls } = await renderInzichten(data)
    const vakjes = Array.from(rapportSectie(container, 'Doelstelling behaald')!.querySelectorAll('.rapport-oordeel-waarde')).map((e) => e.textContent)
    expect(vakjes).toEqual(['2', '0', '0', '0'])
    const arg = (n: string) => rpcCalls.find((c) => c.name === n)!.args
    expect(arg('inzichten_training_evaluaties').p_end).toBe('2026-10-14')
    for (const n of ['inzichten_speelminuten_per_speler', 'inzichten_doelpunten_per_minuut', 'inzichten_tegendoelpunten', 'inzichten_speler_momenten']) {
      expect(arg(n).p_end, n).toBe(E)
    }
    expect(rapportSectie(container, 'Doelstelling behaald')!.textContent).toContain(nl.insights.rapportOordeelNoot)
    expect(nl.insights.rapportOordeelNoot).toMatch(/gisteren/)
  })

  const ander = (): Partial<TeamData> => ({
    aanwezigheid: [{ aanwezig: 5, afwezig: 5 }],
    spelerMomenten: [kaartRij('z1', 'Zita Ander', 9, 9)],
    speelminuten: [smRij('z2', 'Zeno Ander', 9, 9999)],
    doelpuntMinuten: [{ minuut: 3, aantal: 77 }],
    tegendoelpunten: [{ minuut: 3, soort: 'open_play', aantal: 88 }],
    evaluaties: evRijen(5, () => 'nee'),
  })
  it('AC25: namen en aantallen van team 2 komen niet in de nieuwe secties; elke rpc-aanroep heeft p_team_id = TEAM', async () => {
    const beide = [{ team_id: TEAM, user_id: 'u1', rol: 'owner' }, { team_id: ANDER, user_id: 'u1', rol: 'owner' }]
    const { container, rpcCalls } = await renderInzichten(metUitbreiding(), { anderen: { [ANDER]: ander() }, members: beide, activeTeam: TEAM })
    const tekst = TITELS_NIEUW.map((t) => rapportSectie(container, t)!.textContent).join(' ')
    expect(tekst).not.toMatch(/Zita|Zeno|Ander|9999|\b77\b|\b88\b/)
    expect(tekst).toContain('Spel Een')
    expect(rpcCalls.length).toBeGreaterThan(0)
    expect(rpcCalls.every((c) => c.args.p_team_id === TEAM)).toBe(true)
  })

  const NIEUWE_SLEUTELS = ['rapportSpeelminutenTitle', 'rapportKaartenTitle', 'rapportKwartierTitle', 'rapportKwartierVoor', 'rapportKwartierTegen', 'rapportOordeelTitle', 'rapportOordeelNoot'] as const
  const TITEL_SLEUTELS = ['rapportSpeelminutenTitle', 'rapportKaartenTitle', 'rapportKwartierTitle', 'rapportOordeelTitle'] as const
  it.each(['nl', 'en', 'de', 'es', 'fr'])('AC19 (%s): de 7 nieuwe sleutels bestaan, zijn niet leeg, verschillen van nl, zijn gelijk aan geen *Title-waarde en bevatten geen kaarttitel', (taal) => {
    const d = dicts[taal].insights as unknown as Record<string, string>
    const nlI = nl.insights as unknown as Record<string, string>
    const titelWaarden = Object.entries(d).filter(([k]) => k.endsWith('Title') && !(NIEUWE_SLEUTELS as readonly string[]).includes(k)).map(([, v]) => v)
    const kaartTitels = ['thuisUitTitle', 'kaartenTitle', 'kwartierTitle', 'tegenTitle', 'speelminutenTitle', 'oordeelTitle'].map((k) => d[k])
    for (const k of NIEUWE_SLEUTELS) {
      expect(typeof d[k], k).toBe('string')
      expect(d[k].trim().length, k).toBeGreaterThan(0)
      if (taal !== 'nl') expect(d[k], k).not.toBe(nlI[k])
      expect(titelWaarden, k).not.toContain(d[k])
      for (const kt of kaartTitels) expect(d[k], k).not.toContain(kt)
    }
    for (const k of TITEL_SLEUTELS) for (const kt of kaartTitels) expect(d[k]).not.toBe(kt)
  })

  it.each(['nl', 'en', 'de', 'es', 'fr'])('AC19 (%s): de nieuwe secties gebruiken de titels en hergebruikte teksten van de actieve taal; geen {…}-restant', async (taal) => {
    const d = dicts[taal].insights
    const { container } = await renderInzichten(metUitbreiding(), { locale: taal })
    const blok = printBlok(container)
    for (const titel of [d.rapportSpeelminutenTitle, d.rapportKaartenTitle, d.rapportKwartierTitle, d.rapportOordeelTitle]) {
      expect(rapportSectie(container, titel), titel).toBeDefined()
    }
    const kw = rapportSectie(container, d.rapportKwartierTitle)!.textContent!
    expect(kw).toContain(d.kwartierDekking.replace('{x}', '13').replace('{y}', '15'))
    expect(kw).toContain(d.rapportKwartierVoor)
    expect(rapportSectie(container, d.rapportSpeelminutenTitle)!.textContent).toContain(d.gastLabel)
    expect(rapportSectie(container, d.rapportOordeelTitle)!.textContent).toContain(d.rapportOordeelNoot)
    expect(rapportSectie(container, d.rapportKaartenTitle)!.textContent).toContain(d.rapportTopscorersAfgekort.replace('{n}', '6').replace('{totaal}', '8'))
    expect(blok.textContent).not.toMatch(/\{[a-zA-Z]+\}/)
    for (const kt of [d.kwartierTitle, d.tegenTitle, d.kaartenTitle, d.speelminutenTitle, d.oordeelTitle]) expect(blok.textContent).not.toContain(kt)
  })
})
