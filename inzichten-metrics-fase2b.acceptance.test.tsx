// Acceptatietests — fase 2b "inzichten-metrics": speelminuten en wissels per
// speler vastleggen op de wedstrijdanalyse en terugzien op /inzichten.
//
// Methode (van buitenaf, geen unit-tests):
//   * Deel A rendert de ECHTE app/inzichten/page.tsx (async server component) met
//     RTL. Alleen @/lib/supabase/server, next/navigation en next/headers zijn
//     gestubd. De RPC inzichten_speelminuten_per_speler wordt beantwoord door een
//     handler die de SQL uit supabase/inzichten-metrics-fase2b.sql nabootst op
//     in-memory rijen en daarbij het p_team_id-ARGUMENT van de pagina gebruikt
//     (team-filter op speelminuten, events en players apart).
//   * Deel B rendert de ECHTE app/events/[id]/analysis/page.tsx met de echte
//     MatchAnalysisEditor/SpeelminutenSectie en de ECHTE server actions
//     (app/actions/speelminuten.ts) tegen een in-memory database die filters
//     (.eq/.in/...), UNIQUE-sleutels en upsert werkelijk toepast. router.refresh()
//     rendert de pagina opnieuw vanuit die database, dus "blijft na herladen" is
//     echt gemeten.
//   * Deel C: tijdzones (toekomstcheck en venster onder drie TZ's), AC-A6 (talen),
//     AC-A13 (opruimen).
//
// BEPERKING (eerlijk): vitest kan RLS en de SQL zelf niet bewijzen. De handler
// bootst de SQL alleen na. Wat de DB-laag afdwingt (RLS, CHECK-constraints,
// security invoker, team-filters in de RPC, cascade) staat in
// supabase/team-rls-verificatie.sql (blok 2, 22, 28 — al op de echte database
// gedraaid, zie fase2b/05-migratie-en-verificatie.md) en in de tekst-
// structuurtest inzichten-metrics-fase2b-migratie.acceptance.test.ts. De CHECK-
// constraints en RLS worden hier bewust NIET nagebootst, zodat bewezen wordt dat
// de server action zelf weigert.
//
// Besluiten die hier gelden: M1–M8 (story §6), O1–O4 (brief §8). AC-K.8 en
// AC-M.14 vervallen; M5 (geen voorinvulling) wordt wel getoetst.
//
// ── AC → test-mapping: elke testnaam begint met zijn criterium (bv. "AC-M.3") ──

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, configure, cleanup } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DictProvider } from '@/lib/i18n-context'
import { ToastProvider } from '@/components/ui/Toast'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { es } from '@/messages/es'
import { fr } from '@/messages/fr'
import type { Dict } from '@/messages/nl'
import type { Player } from '@/lib/types'

const state = vi.hoisted(() => ({
  locale: 'nl',
  refresh: (() => {}) as () => void,
}))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`__redirect__:${to}`)
  },
  notFound: () => {
    throw new Error('__notFound__')
  },
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
    prefetch: () => {},
    refresh: () => state.refresh(),
  }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (k === 'locale' ? { value: state.locale } : undefined),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import InzichtenPage from '@/app/inzichten/page'
import AnalysisPage from '@/app/events/[id]/analysis/page'
import MatchAnalysisEditor from '@/components/MatchAnalysisEditor'
import { saveSpeelminuten, deleteSpeelminuten, herstelSpeelminuten } from '@/app/actions/speelminuten'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { TEAM_TABELLEN, ruimTeamOp } from '@/lib/team-opruimen'
import type { HerstelSpeelminuten } from '@/lib/herstel'

// ═══════════════════════════════════════════════════════════════════════
// Gedeelde in-memory database + Supabase-client
// ═══════════════════════════════════════════════════════════════════════
type Row = Record<string, unknown>
type Db = Record<string, Row[]>
type Op = 'insert' | 'upsert' | 'delete' | 'update'

interface Harness {
  db: Db
  rpcCalls: { name: string; args: Row }[]
  writes: { table: string; op: Op; payload: Row }[]
  rpcErrors: Record<string, unknown>
  selectErrors: Record<string, unknown>
  writeErrors: Record<string, (op: Op) => unknown>
  // Houdt elke schrijfactie op `speelminuten` vast tot de gate opengaat.
  writeGate: Promise<void> | null
  handlers: Record<string, (db: Db, args: Row) => Row[]>
  userId: string
}

// De UNIQUE-sleutels die de echte database afdwingt (schema.sql / migratie).
const UNIEK: Record<string, string[]> = {
  speelminuten: ['event_id', 'player_id'],
  match_ratings: ['event_id', 'player_id'],
}
let genTeller = 0

function makeClient(h: Harness) {
  function from(table: string) {
    let op: 'select' | Op = 'select'
    let payload: Row = {}
    let onConflict = ''
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
    let limitN: number | null = null

    async function execute(): Promise<{ data: Row[] | null; error: unknown }> {
      const rows = h.db[table]
      if (!rows) throw new Error(`Onverwachte tabel in test: "${table}"`)
      if (op !== 'select') {
        h.writes.push({ table, op, payload: { ...payload } })
        if (table === 'speelminuten' && h.writeGate) await h.writeGate
        const fout = h.writeErrors[table]?.(op)
        if (fout) return { data: null, error: fout }
        if (op === 'delete') {
          const keep = rows.filter((r) => !filters.every((f) => f(r)))
          rows.length = 0
          rows.push(...keep)
          return { data: null, error: null }
        }
        if (op === 'update') {
          for (const r of rows.filter((x) => filters.every((f) => f(x)))) Object.assign(r, payload)
          return { data: null, error: null }
        }
        if (op === 'upsert') {
          const cols = onConflict.split(',')
          const bestaand = rows.find((r) => cols.every((k) => r[k] === payload[k]))
          if (bestaand) {
            Object.assign(bestaand, payload)
            return { data: null, error: null }
          }
        }
        const sleutel = UNIEK[table]
        const idBotsing = payload.id !== undefined && rows.some((r) => r.id === payload.id)
        const sleutelBotsing = !!sleutel && rows.some((r) => sleutel.every((k) => r[k] === payload[k]))
        if (idBotsing || sleutelBotsing) {
          return {
            data: null,
            error: { code: '23505', message: `duplicate key value violates unique constraint "${table}_key" RAW_DUP` },
          }
        }
        rows.push({ id: payload.id ?? U('9e', ++genTeller), created_at: new Date().toISOString(), ...payload })
        return { data: null, error: null }
      }
      if (h.selectErrors[table]) return { data: null, error: h.selectErrors[table] }
      let out = rows.filter((r) => filters.every((f) => f(r)))
      if (orders.length > 0) {
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const av = a[o.col] as string | number | null | undefined
            const bv = b[o.col] as string | number | null | undefined
            const an = av === null || av === undefined
            const bn = bv === null || bv === undefined
            if (an && bn) continue
            if (an) return o.nullsFirst ? -1 : 1
            if (bn) return o.nullsFirst ? 1 : -1
            if (av! < bv!) return o.ascending ? -1 : 1
            if (av! > bv!) return o.ascending ? 1 : -1
          }
          return 0
        })
      }
      if (limitN !== null) out = out.slice(0, limitN)
      return { data: out.map((r) => ({ ...r })), error: null }
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: (p: Row) => {
        op = 'insert'
        payload = p
        return chain
      },
      upsert: (p: Row, o: { onConflict: string }) => {
        op = 'upsert'
        payload = p
        onConflict = o.onConflict
        return chain
      },
      update: (p: Row) => {
        op = 'update'
        payload = p
        return chain
      },
      delete: () => {
        op = 'delete'
        return chain
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), chain),
      gt: (c: string, v: unknown) => (filters.push((r) => (r[c] as string) > (v as string)), chain),
      gte: (c: string, v: unknown) => (filters.push((r) => (r[c] as string) >= (v as string)), chain),
      lt: (c: string, v: unknown) => (filters.push((r) => (r[c] as string) < (v as string)), chain),
      lte: (c: string, v: unknown) => (filters.push((r) => (r[c] as string) <= (v as string)), chain),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), chain),
      not: (c: string, o: string, v: unknown) => {
        if (o !== 'is') throw new Error(`.not(): onverwachte operator "${o}"`)
        filters.push((r) => r[c] !== v && !(v === null && r[c] === undefined))
        return chain
      },
      order: (c: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
        orders.push({ col: c, ascending: o.ascending ?? true, nullsFirst: o.nullsFirst ?? false })
        return chain
      },
      limit: (n: number) => ((limitN = n), chain),
      single: async () => {
        const r = await execute()
        return { data: r.data?.[0] ?? null, error: r.error }
      },
      maybeSingle: async () => {
        const r = await execute()
        return { data: r.data?.[0] ?? null, error: r.error }
      },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => execute().then(res, rej),
    }
    return chain
  }

  return {
    auth: { getUser: async () => ({ data: { user: { id: h.userId } } }) },
    from,
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    rpc: (name: string, args: Row) => {
      h.rpcCalls.push({ name, args })
      if (h.rpcErrors[name]) return Promise.resolve({ data: null, error: h.rpcErrors[name] })
      const handler = h.handlers[name]
      if (!handler) throw new Error(`Onbekende RPC in test: "${name}"`)
      return Promise.resolve({ data: handler(h.db, args), error: null })
    },
  }
}

// ─── De RPC-handler: SQL van supabase/inzichten-metrics-fase2b.sql in TS ───
// Team-filter op sm, e, pl én p afzonderlijk; alleen wedstrijden; venster op
// events.date (inclusief); noemer = aantal verschillende wedstrijden met >=1
// rij; speler MET rij (ook gast/inactief) of actieve vaste speler zonder rij;
// geen rijen als noemer 0; geen limit; order by naam, id.
function inRange(d: string, s: string, e: string) {
  return d >= s && d <= e
}
function hSpeelminuten(db: Db, args: Row): Row[] {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const events = new Map(db.events.map((e) => [e.id as string, e]))
  const players = new Map(db.players.map((p) => [p.id as string, p]))
  const rijen = db.speelminuten.filter((sm) => {
    if (sm.team_id !== p_team_id) return false
    const e = events.get(sm.event_id as string)
    const pl = players.get(sm.player_id as string)
    return !!e && !!pl && e.team_id === p_team_id && pl.team_id === p_team_id && e.type === 'match' &&
      inRange(e.date as string, p_start, p_end)
  })
  const per = new Map<string, { wedstrijden: number; minuten: number; wissels: number }>()
  for (const r of rijen) {
    const cur = per.get(r.player_id as string) ?? { wedstrijden: 0, minuten: 0, wissels: 0 }
    cur.wedstrijden++
    cur.minuten += r.minuten as number
    cur.wissels += r.wissels as number
    per.set(r.player_id as string, cur)
  }
  const noemer = new Set(rijen.map((r) => r.event_id)).size
  if (noemer === 0) return []
  return db.players
    .filter((p) => p.team_id === p_team_id && (per.has(p.id as string) || (p.active !== false && p.type === 'regular')))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)))
    .map((p) => {
      const ps = per.get(p.id as string)
      return {
        player_id: p.id, naam: p.name, gast: p.type === 'guest',
        wedstrijden: ps?.wedstrijden ?? 0, minuten: ps?.minuten ?? null, wissels: ps?.wissels ?? null, noemer,
      }
    })
}

// Vaste ratingbronnen: dit bestand test geen ratings, maar bewijst (AC-A1/A11)
// dat die kaarten identiek blijven met en zonder speelminuten.
const HANDLERS: Harness['handlers'] = {
  inzichten_aanwezigheid: () => [{ aanwezig: 8, afwezig: 2 }],
  inzichten_training_opkomst_per_maand: () => [],
  inzichten_rating_team_per_wedstrijd: () => [
    { event_id: 'r1', datum: '2026-09-05', tegenstander: 'Ajax', gemiddelde: 7.5, aantal: 3 },
    { event_id: 'r2', datum: '2026-09-12', tegenstander: 'PSV', gemiddelde: 6.5, aantal: 3 },
  ],
  inzichten_rating_speler: () => [],
  inzichten_rating_per_speler: () => [{ player_id: 'x', naam: 'Ratingspeler', gemiddelde: 7.2, aantal: 3 }],
  inzichten_aanwezigheid_per_speler: () => [],
  inzichten_speelkansen: () => [],
  inzichten_rating_vorm_per_speler: () => [
    { player_id: 'x', naam: 'Ratingspeler', aantal: 4, seizoen_gemiddelde: 6.5, recent_gemiddelde: 7.5 },
  ],
  inzichten_training_opkomst_per_speler: () => [],
  inzichten_blessures_per_maand: () => [],
  inzichten_wedstrijd_uitslagen: () => [],
  inzichten_speler_momenten: () => [],
  inzichten_doelpunten_per_minuut: () => [],
  inzichten_tegendoelpunten: () => [],
  inzichten_speelminuten_per_speler: hSpeelminuten,
  // Fase 3a: dit bestand test de nieuwe kaarten niet; lege bronnen.
  inzichten_training_koppelingen: () => [],
  inzichten_invul_discipline: () => [],
  inzichten_training_evaluaties: () => [],
}

function setup(db: Db, over: Partial<Harness> = {}): Harness {
  const h: Harness = {
    db,
    rpcCalls: [],
    writes: [],
    rpcErrors: {},
    selectErrors: {},
    writeErrors: {},
    writeGate: null,
    handlers: HANDLERS,
    userId: 'team-1',
    ...over,
  }
  vi.mocked(createClient).mockResolvedValue(makeClient(h) as unknown as Awaited<ReturnType<typeof createClient>>)
  return h
}

const TEAM = 'team-1'
const OTHER = 'team-2'
const owner = (team = TEAM) => ({ team_id: team, user_id: team, rol: 'owner' })
const assistent = (rechten: Row) => [{ team_id: TEAM, user_id: 'user-a', rol: 'assistent', ...rechten }]
const U = (k: string, n: number) => `${k}000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function fmt(tpl: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), tpl)
}

// ─── Klok en tijdzone ───
const TODAY = '2026-10-15'
function zetKlok(datum: string, uur = 10, min = 0) {
  const [y, m, d] = datum.split('-').map(Number)
  if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(y, m - 1, d, uur, min, 0))
}
const ORIGINELE_TZ = process.env.TZ

const dicts: Record<string, Dict> = { nl, en, de, es, fr }
const STANDAARD_IGNORE = 'script, style'
const NEGEER_PRINTBLOK = `${STANDAARD_IGNORE}, [data-print-only], [data-print-only] *`

let consoleError: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  state.locale = 'nl'
  state.refresh = () => {}
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  zetKlok(TODAY)
})
afterEach(() => {
  cleanup()
  consoleError.mockRestore()
  vi.unstubAllGlobals()
  configure({ defaultIgnore: STANDAARD_IGNORE })
  vi.useRealTimers()
  if (ORIGINELE_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINELE_TZ
})

const a = nl.analysis
const i = nl.insights

// ═══════════════════════════════════════════════════════════════════════
// DEEL A — /inzichten (echte pagina, nagebootste RPC op args.p_team_id)
// ═══════════════════════════════════════════════════════════════════════
const ev = (id: string, date: string, o: Row = {}): Row => ({
  id, team_id: TEAM, type: 'match', date, opponent: 'Tegenstander', match_type: 'league', home_away: 'home',
  goals_for: null, goals_against: null, created_at: '2026-01-01T10:00:00Z', trainingstype: 'vct', ...o,
})
const sp = (id: string, name: string, o: Row = {}): Row => ({
  id, team_id: TEAM, name, active: true, type: 'regular', position: 'Spits', secondary_positions: [],
  jersey_number: null, injured: false, rating: null, created_at: '2026-01-01T00:00:00Z', ...o,
})
let smN = 0
const sm = (event: string, player: string, minuten: number, wissels: number, team = TEAM): Row => ({
  id: U('5a', ++smN), team_id: team, event_id: event, player_id: player, minuten, wissels, created_at: '2026-09-30T10:00:00+00:00',
})

function leegDb(over: Partial<Db> = {}): Db {
  return {
    team_members: [owner()],
    settings: [
      { team_id: TEAM, key: 'season_start', value: '2026-08-01' },
      { team_id: TEAM, key: 'season_end', value: '2027-06-30' },
    ],
    events: [], players: [], match_events: [], lineups: [], tegendoelpunten: [], match_squad: [], speelminuten: [],
    attendance: [], match_ratings: [], training_oefeningen: [],
    // Fase 3a: de metingen-query van de pagina (leeg = geen metingen).
    categorie_metingen: [],
    ...over,
  }
}

// Hoofdscenario (verwachte waarden met de hand afgeleid, zie AC-K.1-test):
//   e1 09-05  Anna 90/1  Bram 45/2  Cor 30/0  Guus(gast) 20/0
//   e2 09-12  Anna 90/0  Bram 90/1  Cor 45/0
//   e3 09-19  Anna 45/3
//   e4 10-15 (vandaag)  Dirk 0/0   <- expliciet ingevoerde 0
//   e6 09-18  Bram 10/0     e7 09-17  Bram 100/9
//   e5 08-10  wedstrijd ZONDER minuten (telt niet mee in y)
//   t1 09-10  TRAINING met een rij voor Anna 120/5 (moet genegeerd worden)
//   Eva: actieve vaste speler zonder rij; Gina (gast) en Ina (inactief) zonder rij.
const E = {
  e1: U('e1', 1), e2: U('e1', 2), e3: U('e1', 3), e4: U('e1', 4), e5: U('e1', 5), e6: U('e1', 6), e7: U('e1', 7),
  t1: U('e1', 8), x1: U('e1', 9),
}
const P = {
  anna: U('a1', 1), bram: U('a1', 2), cor: U('a1', 3), dirk: U('a1', 4), eva: U('a1', 5), guus: U('a1', 6),
  gina: U('a1', 7), ina: U('a1', 8), xander: U('a1', 9),
}

function hoofdDb(): Db {
  smN = 0
  return leegDb({
    events: [
      ev(E.e1, '2026-09-05'), ev(E.e2, '2026-09-12'), ev(E.e3, '2026-09-19'), ev(E.e4, TODAY), ev(E.e5, '2026-08-10'),
      ev(E.e6, '2026-09-18'), ev(E.e7, '2026-09-17'),
      ev(E.t1, '2026-09-10', { type: 'training', opponent: null, match_type: null, home_away: null }),
    ],
    players: [
      sp(P.anna, 'Anna Aap'), sp(P.bram, 'Bram Beer'), sp(P.cor, 'Cor Cobra', { active: false }),
      sp(P.dirk, 'Dirk Duif'), sp(P.eva, 'Eva Ezel'), sp(P.guus, 'Guus Gast', { type: 'guest' }),
      sp(P.gina, 'Gina Gast', { type: 'guest' }), sp(P.ina, 'Ina Inactief', { active: false }),
    ],
    speelminuten: [
      sm(E.e1, P.anna, 90, 1), sm(E.e1, P.bram, 45, 2), sm(E.e1, P.cor, 30, 0), sm(E.e1, P.guus, 20, 0),
      sm(E.e2, P.anna, 90, 0), sm(E.e2, P.bram, 90, 1), sm(E.e2, P.cor, 45, 0),
      sm(E.e3, P.anna, 45, 3),
      sm(E.e4, P.dirk, 0, 0),
      sm(E.e6, P.bram, 10, 0), sm(E.e7, P.bram, 100, 9),
      sm(E.t1, P.anna, 120, 5),
    ],
  })
}

// Zelfde scenario + data van team-2 in elke tabel + kruisbesmetting, zó dat het
// weglaten van één team-filter (sm, e of pl) zichtbaar wordt.
function vervuildeDb(): Db {
  const db = hoofdDb()
  db.events.push(ev(E.x1, '2026-09-06', { team_id: OTHER }))
  db.players.push(sp(P.xander, 'Xander Vreemd', { team_id: OTHER }))
  db.speelminuten.push(
    // vreemde rij op een vreemde wedstrijd met een vreemde speler
    sm(E.x1, P.xander, 130, 9, OTHER),
    // rij met team_id = TEAM, maar de speler is van team-2 (pl.team_id-filter)
    sm(E.e1, P.xander, 111, 1),
    // rij met team_id = TEAM op een wedstrijd van team-2 (e.team_id-filter)
    sm(E.x1, P.anna, 66, 6),
    // rij met team_id = team-2 op een eigen wedstrijd met een eigen speler (sm.team_id-filter)
    sm(E.e2, P.eva, 55, 5, OTHER),
  )
  return db
}

async function renderInzichten(db: Db, o: { periode?: string; over?: Partial<Harness>; locale?: string } = {}) {
  configure({ defaultIgnore: NEGEER_PRINTBLOK })
  state.locale = o.locale ?? 'nl'
  const h = setup(db, o.over)
  const el = o.periode === undefined
    ? await InzichtenPage()
    : await InzichtenPage({ searchParams: Promise.resolve({ periode: o.periode }) })
  const r = render(<DictProvider dict={dicts[state.locale]}>{el}</DictProvider>)
  return { ...r, h }
}

function kaart(titel: string): HTMLElement {
  return screen.getByRole('heading', { level: 2, name: titel }).closest('.surface-card') as HTMLElement
}
const SMK = () => kaart(i.speelminutenTitle)
interface KaartRij { naam: string; gast: boolean; cellen: string[]; th: HTMLElement }
function kaartRijen(k: HTMLElement): KaartRij[] {
  return within(k).getAllByRole('rowheader').map((th) => ({
    th,
    naam: th.childNodes[0]?.textContent ?? '',
    gast: th.querySelector('span') !== null,
    cellen: [...th.closest('tr')!.querySelectorAll('td')].map((td) => td.textContent ?? ''),
  }))
}
const dekking = (x: number, y: number, t: Dict = nl) => fmt(t.insights.minutenDekking, { x, y })
const G = i.geenGegevens
const zonderKaart = (container: HTMLElement, titel: string): string => {
  const kopie = container.cloneNode(true) as HTMLElement
  const h2 = [...kopie.querySelectorAll('h2')].find((h) => h.textContent === titel)
  h2?.closest('.surface-card')?.remove()
  // recharts telt zijn eigen DOM-id's op per render (clip-paden, _r_N_); dat is geen inhoud.
  return kopie.innerHTML.replace(/recharts\d+-clip/g, 'recharts-clip').replace(/_r_[0-9a-z]+_/g, '_r_')
}

describe('AC-A1 — fase-1- en fase-2a-kaarten ongewijzigd; nieuwe kaart eronder', () => {
  it('AC-A1: de speelminutenkaart staat direct na "Blessures per maand" (laatste kaart van fase 2b; fase 3a komt daarna), in hetzelfde raster en half breed (O3)', async () => {
    await renderInzichten(hoofdDb())
    const koppen = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    // Fase 3a voegt drie kaarten toe NA de speelminuten, fase 3b er nog twee (sRPE en oordeel).
    expect(koppen.at(-6)).toBe(i.speelminutenTitle)
    expect(koppen.at(-7)).toBe(i.blessuresTitle)
    expect(koppen.slice(-5)).toEqual([i.belastingTitle, i.periodiseringTitle, i.disciplineTitle, i.srpeTitle, i.oordeelTitle])
    expect(koppen.filter((t) => t === i.speelminutenTitle)).toHaveLength(1)
    const bless = kaart(i.blessuresTitle)
    expect(SMK().previousElementSibling).toBe(bless)
    expect(SMK().parentElement).toBe(bless.parentElement)
    // O3: half breed — geen volle-breedte wrapper om de kaart
    expect(SMK().parentElement!.className).toContain('grid')
    expect(SMK().className).not.toContain('col-span-2')
  })

  it('AC-A1: alle overige kaarten zijn byte-voor-byte gelijk met en zonder speelminuten-data', async () => {
    const met = await renderInzichten(hoofdDb())
    const htmlMet = zonderKaart(met.container, i.speelminutenTitle)
    cleanup()
    const zonder = await renderInzichten(leegDb({ ...hoofdDb(), speelminuten: [] }))
    const htmlZonder = zonderKaart(zonder.container, i.speelminutenTitle)
    expect(htmlMet.length).toBeGreaterThan(5000) // niet-triviale vergelijking
    expect(htmlMet).toBe(htmlZonder)
  })
})

describe('AC-A2 — tenant-isolatie', () => {
  it('AC-A2: vreemde rijen (team-2 / vreemde wedstrijd / vreemde speler / vreemd sm.team_id) tellen niet mee en worden niet getoond', async () => {
    await renderInzichten(vervuildeDb())
    const rijen = kaartRijen(SMK())
    expect(rijen.map((r) => r.naam)).not.toContain('Xander Vreemd')
    const byNaam = Object.fromEntries(rijen.map((r) => [r.naam, r.cellen]))
    expect(byNaam['Anna Aap']).toEqual([dekking(3, 6), '225', '75', '4']) // niet +66
    expect(byNaam['Eva Ezel']).toEqual([dekking(0, 6), G, G, G]) // niet de 55 van team-2
    expect(SMK().textContent).not.toMatch(/\b(111|130|66|55)\b/)
  })

  it('AC-A2: de pagina geeft de RPC p_team_id = team-id uit de context (niet het user-id van een assistent)', async () => {
    const db = hoofdDb()
    db.team_members = assistent({}) as Row[]
    const { h } = await renderInzichten(db, { over: { userId: 'user-a' } })
    const call = h.rpcCalls.find((c) => c.name === 'inzichten_speelminuten_per_speler')!
    expect(call.args.p_team_id).toBe(TEAM)
    expect(kaartRijen(SMK()).length).toBeGreaterThan(0) // de handler filterde op dat argument
  })
})

describe('AC-A3 — geen relevante data: lege staat, geen nullen als meting, geen NaN', () => {
  it('AC-A3: periode zonder wedstrijd met minuten (andere kaarten hebben wel data) -> lege staat, geen tabel, geen NaN', async () => {
    const db = hoofdDb()
    db.speelminuten = []
    const { container } = await renderInzichten(db)
    // de pagina is niet leeg: de rating-kaarten hebben data (vaste handlers)
    expect(within(SMK()).getByText(i.speelminutenEmpty)).toBeInTheDocument()
    expect(within(SMK()).queryByRole('table')).toBeNull()
    expect(SMK().textContent).not.toMatch(/NaN|undefined|Infinity/)
    expect(container.textContent).not.toMatch(/NaN/)
  })

  it('AC-A3: speler zonder minuten toont "geen gegevens", nooit 0, en nergens NaN', async () => {
    await renderInzichten(hoofdDb())
    expect(SMK().textContent).not.toMatch(/NaN|undefined|Infinity/)
    const eva = kaartRijen(SMK()).find((r) => r.naam === 'Eva Ezel')!
    expect(eva.cellen.slice(1)).toEqual([G, G, G])
  })
})

describe('AC-A4 — minutenbron faalt: overige kaarten werken, alleen deze kaart meldt', () => {
  it('AC-A4: RPC-fout -> algemene melding in alleen deze kaart, zonder ruwe fouttekst; overige kaarten blijven staan', async () => {
    const { container } = await renderInzichten(hoofdDb(), {
      over: { rpcErrors: { inzichten_speelminuten_per_speler: { code: 'XX000', message: 'RAW_DETAIL boem' } } },
    })
    expect(within(SMK()).getByText(i.bronFout)).toBeInTheDocument()
    expect(within(SMK()).queryByRole('table')).toBeNull()
    expect(container.textContent).not.toMatch(/RAW_DETAIL|XX000/)
    // andere kaarten renderen gewoon door (rating- en blessurekaart)
    expect(screen.getByRole('heading', { level: 2, name: i.blessuresTitle })).toBeInTheDocument()
    expect(within(kaart(i.blessuresTitle)).queryByText(i.bronFout)).toBeNull()
    expect(screen.getAllByText(i.bronFout)).toHaveLength(1)
  })
})

describe('AC-A5 — team zonder data houdt de lege-pagina-staat; minuten tellen mee', () => {
  it('AC-A5: team zonder enige data -> lege-pagina-staat, geen speelminutenkaart', async () => {
    await renderInzichten(leegDb(), {
      over: {
        handlers: {
          ...HANDLERS,
          inzichten_aanwezigheid: () => [{ aanwezig: 0, afwezig: 0 }],
          inzichten_rating_team_per_wedstrijd: () => [],
          inzichten_rating_per_speler: () => [],
          inzichten_rating_vorm_per_speler: () => [],
        },
      },
    })
    expect(screen.getByText(i.geenDataTitle)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: i.speelminutenTitle })).toBeNull()
  })

  it('AC-A5: alleen speelminuten (verder niets) is genoeg voor de gewone pagina met de kaart', async () => {
    smN = 0
    // De wedstrijd is van vandaag: de vormstrook (laatste 5 wedstrijden vóór vandaag)
    // blijft dan leeg, zodat de minuten de enige data van het team zijn.
    const db = leegDb({
      events: [ev(E.e1, TODAY)],
      players: [sp(P.anna, 'Anna Aap')],
      speelminuten: [sm(E.e1, P.anna, 80, 2)],
    })
    await renderInzichten(db, {
      over: {
        handlers: {
          ...HANDLERS,
          inzichten_aanwezigheid: () => [{ aanwezig: 0, afwezig: 0 }],
          inzichten_rating_team_per_wedstrijd: () => [],
          inzichten_rating_per_speler: () => [],
          inzichten_rating_vorm_per_speler: () => [],
        },
      },
    })
    expect(screen.queryByText(i.geenDataTitle)).toBeNull()
    expect(kaartRijen(SMK())[0].cellen).toEqual([dekking(1, 1), '80', '80', '2'])
  })
})

describe('AC-A6 — unieke titel en tekst in nl/en/de/es/fr', () => {
  const SLEUTELS_INZ = ['speelminutenTitle', 'speelminutenDescription', 'speelminutenEmpty', 'minutenDekking'] as const
  const SLEUTELS_ANA = [
    'speelminuten', 'speelminutenUitleg', 'speelminutenOngeldig', 'speelminutenOpslaanFout',
    'speelminutenToekomst', 'speelminutenNietBeschikbaar', 'speelminutenOverig', 'speelminutenWaarde', 'speelminutenNietIngevuld',
  ] as const
  function waarden(obj: unknown, uit: string[] = []): string[] {
    if (typeof obj === 'string') uit.push(obj)
    else if (obj && typeof obj === 'object') for (const v of Object.values(obj)) waarden(v, uit)
    return uit
  }

  it.each(Object.keys(dicts))('AC-A6: %s — alle nieuwe titels en teksten bestaan, zijn niet leeg en komen precies één keer voor in de hele woordenlijst', (taal) => {
    const d = dicts[taal]
    const alle = waarden(d)
    for (const k of SLEUTELS_INZ) {
      const w = d.insights[k]
      expect(typeof w === 'string' && w.length > 0, `insights.${k}`).toBe(true)
      expect(alle.filter((x) => x === w), `insights.${k} uniek`).toHaveLength(1)
    }
    for (const k of SLEUTELS_ANA) {
      const w = d.analysis[k]
      expect(typeof w === 'string' && w.length > 0, `analysis.${k}`).toBe(true)
      expect(alle.filter((x) => x === w), `analysis.${k} uniek`).toHaveLength(1)
    }
  })

  it('AC-A6: de titels zijn per taal werkelijk vertaald (niet gelijk aan het Nederlands)', () => {
    for (const taal of ['en', 'de', 'es', 'fr']) {
      expect(dicts[taal].insights.speelminutenTitle).not.toBe(nl.insights.speelminutenTitle)
      expect(dicts[taal].analysis.speelminuten).not.toBe(nl.analysis.speelminuten)
    }
  })

  it.each(['en', 'de', 'es', 'fr'])('AC-A6: %s — /inzichten toont titel en "x van y"-noemer in die taal', async (taal) => {
    await renderInzichten(hoofdDb(), { locale: taal })
    const d = dicts[taal]
    const k = kaart(d.insights.speelminutenTitle)
    expect(kaartRijen(k).find((r) => r.naam === 'Anna Aap')!.cellen[0]).toBe(dekking(3, 6, d))
    expect(within(k).getByText(d.insights.kolomWissels)).toBeInTheDocument()
  })
})

describe('AC-A7 — tekstvariant (tabel) en kleuren uit tokens', () => {
  it('AC-A7: de kaart is een semantische tabel met kolomkoppen en rij-koppen; de meter is aria-hidden en gebruikt alleen tokens', async () => {
    await renderInzichten(hoofdDb())
    const k = SMK()
    const tabel = within(k).getByRole('table')
    const kolommen = within(tabel).getAllByRole('columnheader').map((c) => c.textContent)
    expect(kolommen).toEqual([i.kolomSpeler, i.kolomWedstrijdenMetMinuten, i.kolomMinutenTotaal, i.kolomGemiddeldPerWedstrijd, i.kolomWissels])
    const meters = [...k.querySelectorAll('[aria-hidden="true"]')].filter((el) => el.querySelector('div[style]'))
    expect(meters.length).toBeGreaterThan(0)
    const stijlen = [...k.querySelectorAll('[style]')].map((el) => el.getAttribute('style') ?? '')
    expect(stijlen.some((s) => s.includes('var(--brand-accent)'))).toBe(true)
    expect(stijlen.some((s) => s.includes('var(--track)'))).toBe(true)
    expect(k.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/)
    // het getal staat als tekst naast de meter (niet alleen visueel)
    expect(kaartRijen(k)[0].cellen[1]).toBe('245')
  })

  it('AC-A7: de langste meter is 100% breed en de meter schaalt met het totaal (Anna 225/245)', async () => {
    await renderInzichten(hoofdDb())
    const breedte = (naam: string) => {
      const r = kaartRijen(SMK()).find((x) => x.naam === naam)!
      return (r.th.closest('tr')!.querySelector('[aria-hidden="true"] > div') as HTMLElement).style.width
    }
    expect(breedte('Bram Beer')).toBe('100%')
    expect(parseFloat(breedte('Anna Aap'))).toBeCloseTo((225 / 245) * 100, 3)
  })
})

describe('AC-A8 — alleen aantallen: geen KPI, signaal, advies, alarm of rangorde-oordeel', () => {
  it('AC-A8: geen rangnummers, geen oordeelkleur, geen alert/status in de kaart; precies vijf kolommen', async () => {
    await renderInzichten(hoofdDb())
    const k = SMK()
    expect(k.querySelector('ol')).toBeNull()
    expect(within(k).queryAllByRole('alert')).toHaveLength(0)
    expect(within(k).queryAllByRole('status')).toHaveLength(0)
    expect(within(k).getAllByRole('columnheader')).toHaveLength(5)
    for (const r of kaartRijen(k)) expect(r.naam).not.toMatch(/^\s*#?\d+[.)]?\s/)
    expect(k.innerHTML).not.toMatch(/text-(red|green|amber)|bg-panel-(red|green)|chip-(red|green|amber)/)
  })
})

describe('AC-A9 / O4 — vaste volgorde: minuten aflopend, gelijk -> wedstrijden aflopend, dan naam, dan speler-id', () => {
  it('AC-A9: volgorde in het hoofdscenario: Bram 245, Anna 225, Cor 75, Guus 20, Dirk 0, dan Eva (geen gegevens)', async () => {
    await renderInzichten(hoofdDb())
    expect(kaartRijen(SMK()).map((r) => r.naam)).toEqual(['Bram Beer', 'Anna Aap', 'Cor Cobra', 'Guus Gast', 'Dirk Duif', 'Eva Ezel'])
  })

  it('AC-A9: gelijke minuten -> meeste wedstrijden eerst; daarna naam; gelijke naam -> speler-id (zichtbaar via de wissels-kolom)', async () => {
    smN = 0
    const idA = U('a1', 11)
    const idB = U('a1', 12)
    const db = leegDb({
      events: [ev(E.e1, '2026-09-05'), ev(E.e2, '2026-09-12')],
      players: [
        sp(U('a1', 20), 'Zed'), sp(U('a1', 21), 'Aap'), sp(U('a1', 22), 'Mo'),
        sp(idB, 'Sam'), sp(idA, 'Sam'), // zelfde naam; id idA < idB
      ],
      speelminuten: [
        sm(E.e1, U('a1', 20), 100, 0), sm(E.e1, U('a1', 21), 100, 0),
        sm(E.e1, U('a1', 22), 50, 0), sm(E.e2, U('a1', 22), 50, 0),
        sm(E.e1, idB, 80, 2), sm(E.e1, idA, 80, 1),
      ],
    })
    await renderInzichten(db)
    const rijen = kaartRijen(SMK())
    expect(rijen.map((r) => r.naam)).toEqual(['Mo', 'Aap', 'Zed', 'Sam', 'Sam'])
    expect(rijen.slice(3).map((r) => r.cellen[3])).toEqual(['1', '2']) // id idA (1 wissel) vóór idB (2)
  })
})

describe('AC-A10 — geen kloktijden; gehele minuten; venster op wedstrijddatum', () => {
  it('AC-A10: alle getallen zijn gehele getallen of "geen gegevens"; het gemiddelde is afgerond (37,5 -> 38; 61,25 -> 61)', async () => {
    await renderInzichten(hoofdDb())
    for (const r of kaartRijen(SMK())) {
      for (const cel of r.cellen.slice(1)) expect(`${r.naam}: ${cel}`).toMatch(new RegExp(`: (\\d+|${G})$`))
    }
    const cor = kaartRijen(SMK()).find((r) => r.naam === 'Cor Cobra')!
    const bram = kaartRijen(SMK()).find((r) => r.naam === 'Bram Beer')!
    expect(cor.cellen[2]).toBe('38')
    expect(bram.cellen[2]).toBe('61')
    expect(SMK().textContent).not.toMatch(/\d{1,2}:\d{2}/)
  })

  it('AC-A10: een wedstrijd op de dag van vandaag telt mee (venster, niet verleden)', async () => {
    const { h } = await renderInzichten(hoofdDb())
    const dirk = kaartRijen(SMK()).find((r) => r.naam === 'Dirk Duif')!
    expect(dirk.cellen).toEqual([dekking(1, 6), '0', '0', '0'])
    const call = h.rpcCalls.find((c) => c.name === 'inzichten_speelminuten_per_speler')!
    expect(call.args).toEqual({ p_team_id: TEAM, p_start: '2026-08-01', p_end: '2027-06-30' })
  })
})

describe('AC-A11 / M8 — ratings, vorm en trend ongewijzigd door speelminuten', () => {
  it('AC-A11: de rating-, vorm- en trendkaarten zijn identiek met en zonder speelminuten-rijen', async () => {
    const met = await renderInzichten(hoofdDb())
    const htmlMet = zonderKaart(met.container, i.speelminutenTitle)
    expect(met.container.textContent).toContain('Ratingspeler') // de ratingbron is echt gerenderd
    cleanup()
    const zonder = await renderInzichten(leegDb({ ...hoofdDb(), speelminuten: [] }))
    expect(zonderKaart(zonder.container, i.speelminutenTitle)).toBe(htmlMet)
  })

  it('AC-A11: speelminuten opslaan en verwijderen schrijft alleen naar de tabel speelminuten (ratings blijven aangeraakt noch gewijzigd)', async () => {
    const db = analyseDb()
    db.match_ratings = [{ id: U('b1', 1), team_id: TEAM, event_id: EV.past, player_id: PIET, rating: 7, created_at: '2026-10-10T20:00:00Z' }]
    const ratingsVoor = JSON.stringify(db.match_ratings)
    const spelersVoor = JSON.stringify(db.players)
    const h = setup(db)
    await saveSpeelminuten(EV.past, PIET, 90, 2)
    await saveSpeelminuten(EV.past, PIET, 60, 1)
    const herstel = await deleteSpeelminuten(EV.past, PIET)
    await herstelSpeelminuten(herstel)
    expect([...new Set(h.writes.map((w) => w.table))]).toEqual(['speelminuten'])
    expect(JSON.stringify(db.match_ratings)).toBe(ratingsVoor)
    expect(JSON.stringify(db.players)).toBe(spelersVoor)
  })
})

describe('AC-A12 — zonder migratie: alleen de minutenkaart meldt; de rest werkt', () => {
  it('AC-A12: ontbrekende RPC (PGRST202) -> alleen de minutenkaart toont een melding, de rest van /inzichten werkt', async () => {
    const { container } = await renderInzichten(hoofdDb(), {
      over: { rpcErrors: { inzichten_speelminuten_per_speler: { code: 'PGRST202', message: 'Could not find the function RAW_DETAIL' } } },
    })
    expect(within(SMK()).getByText(i.bronFout)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/PGRST202|RAW_DETAIL/)
    expect(screen.queryByText(i.geenDataTitle)).toBeNull()
    expect(container.textContent).toContain('Ratingspeler')
  })

  it('AC-A12: analysepagina zonder tabel -> de pagina rendert met een melding in plaats van invoer; ratings, tegendoelpunten en events werken', async () => {
    const db = analyseDb()
    setup(db, {
      selectErrors: { speelminuten: { code: '42P01', message: 'relation "speelminuten" does not exist RAW_DETAIL' } },
    })
    vi.stubGlobal('crypto', { randomUUID: () => U('d1', 900) })
    await openAnalyse(EV.past)
    expect(screen.getByText(a.title)).toBeInTheDocument()
    expect(sec().getByText(a.speelminutenNietBeschikbaar)).toBeInTheDocument()
    expect(sec().queryByLabelText(/ – Minuten$/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/RAW_DETAIL|42P01/)
    // ratings blijven werken
    fireEvent.click(screen.getAllByRole('button', { name: '+' })[0])
    await waitFor(() => expect(db.match_ratings).toHaveLength(1))
    // tegendoelpunten blijven werken
    const td = within(screen.getByRole('region', { name: a.tegendoelpunten }))
    fireEvent.click(td.getByRole('button', { name: a.tegendoelpuntSoorten.open_play }))
    fireEvent.click(td.getByRole('button', { name: a.addTegendoelpunt }))
    await waitFor(() => expect(db.tegendoelpunten).toHaveLength(1))
    expect(screen.getByText(a.events)).toBeInTheDocument()
  })
})

describe('AC-K.1 / K.2 / K.3 / K.4 — kaartinhoud en noemer', () => {
  it('AC-K.1 / K.2: per speler totaal, gemiddelde en wissels met "x van y wedstrijden met minuten"; y = wedstrijden in het venster met >=1 rij', async () => {
    await renderInzichten(hoofdDb())
    const per = Object.fromEntries(kaartRijen(SMK()).map((r) => [r.naam, r.cellen]))
    // y = 6 (e1, e2, e3, e4, e6, e7); e5 (zonder rijen) en de training tellen niet mee
    expect(per['Bram Beer']).toEqual([dekking(4, 6), '245', '61', '12'])
    expect(per['Anna Aap']).toEqual([dekking(3, 6), '225', '75', '4']) // niet +120/+5 van de training
    expect(per['Cor Cobra']).toEqual([dekking(2, 6), '75', '38', '0'])
    expect(per['Guus Gast']).toEqual([dekking(1, 6), '20', '20', '0'])
    expect(per['Dirk Duif']).toEqual([dekking(1, 6), '0', '0', '0'])
    expect(per['Eva Ezel']).toEqual([dekking(0, 6), G, G, G])
  })

  it('AC-K.3: oude wedstrijd zonder minuten telt niet mee in y en niet als 0; de analyse maakt er geen rijen voor aan (geen backfill)', async () => {
    const { h } = await renderInzichten(hoofdDb())
    expect(kaartRijen(SMK())[0].cellen[0]).toBe(dekking(4, 6)) // y=6, niet 7 (met e5)
    expect(h.writes).toEqual([])
    cleanup()
    const db = analyseDb()
    setup(db)
    await openAnalyse(EV.old)
    expect(db.speelminuten).toEqual([])
  })

  it('AC-K.4: expliciet ingevoerde 0 minuten telt als 0; geen rij = "geen gegevens" (en "0 van y")', async () => {
    await renderInzichten(hoofdDb())
    const per = Object.fromEntries(kaartRijen(SMK()).map((r) => [r.naam, r.cellen]))
    expect(per['Dirk Duif'].slice(1)).toEqual(['0', '0', '0'])
    expect(per['Eva Ezel'].slice(1)).toEqual([G, G, G])
    expect(per['Eva Ezel'][0]).toBe(dekking(0, 6))
  })

  it('AC-K.4: als iedereen 0 minuten heeft is er geen meter en geen NaN', async () => {
    smN = 0
    const db = leegDb({
      events: [ev(E.e1, '2026-09-05')],
      players: [sp(P.anna, 'Anna Aap'), sp(P.bram, 'Bram Beer')],
      speelminuten: [sm(E.e1, P.anna, 0, 0), sm(E.e1, P.bram, 0, 0)],
    })
    await renderInzichten(db)
    expect(SMK().querySelectorAll('[aria-hidden="true"] > div[style]')).toHaveLength(0)
    expect(SMK().textContent).not.toMatch(/NaN/)
    expect(kaartRijen(SMK())[0].cellen).toEqual([dekking(1, 1), '0', '0', '0'])
  })
})

describe('AC-K.5 (M4) — gasten met label "gast"; inactieven met minuten doen mee', () => {
  it('AC-K.5: gast met minuten krijgt het label; inactieve speler met minuten doet mee zonder label; zonder rij vallen gasten en inactieven weg', async () => {
    await renderInzichten(hoofdDb())
    const rijen = kaartRijen(SMK())
    const guus = rijen.find((r) => r.naam === 'Guus Gast')!
    expect(within(guus.th).getByText(i.gastLabel)).toBeInTheDocument()
    expect(rijen.filter((r) => r.gast).map((r) => r.naam)).toEqual(['Guus Gast'])
    const cor = rijen.find((r) => r.naam === 'Cor Cobra')!
    expect(cor.gast).toBe(false)
    expect(cor.cellen[1]).toBe('75') // inactief maar mét minuten: telt mee
    const namen = rijen.map((r) => r.naam)
    expect(namen).not.toContain('Gina Gast')
    expect(namen).not.toContain('Ina Inactief')
  })
})

describe('AC-K.6 — de kaart volgt het periodevenster en vermeldt dat', () => {
  const periodeDb = () => {
    smN = 0
    const ids = [U('e2', 1), U('e2', 2), U('e2', 3), U('e2', 4), U('e2', 5)]
    return leegDb({
      events: [
        ev(ids[0], '2026-08-05'), ev(ids[1], '2026-08-25'), ev(ids[2], '2026-09-17'), ev(ids[3], '2026-09-18'), ev(ids[4], TODAY),
      ],
      players: [sp(P.anna, 'Anna Aap')],
      speelminuten: [
        sm(ids[0], P.anna, 1, 0), sm(ids[1], P.anna, 2, 0), sm(ids[2], P.anna, 4, 0), sm(ids[3], P.anna, 8, 0), sm(ids[4], P.anna, 16, 0),
      ],
    })
  }

  it.each([
    ['seizoen', '2026-08-01', '31', 5],
    ['8w', '2026-08-21', '30', 4],
    ['4w', '2026-09-18', '24', 2],
  ])('AC-K.6: periode %s -> RPC krijgt het gekozen venster (start %s), totaal %s, y = %i', async (periode, start, totaal, y) => {
    const { h } = await renderInzichten(periodeDb(), { periode })
    const call = h.rpcCalls.find((c) => c.name === 'inzichten_speelminuten_per_speler')!
    expect(call.args).toEqual({ p_team_id: TEAM, p_start: start, p_end: '2027-06-30' })
    expect(kaartRijen(SMK())[0].cellen).toEqual([dekking(y, y), totaal, String(Math.round(Number(totaal) / y)), '0'])
    // de kaart zegt dat ze het periodevenster volgt
    expect(within(SMK()).getByText(i.speelminutenDescription)).toBeInTheDocument()
    expect(i.speelminutenDescription).toMatch(/periode/i)
  })
})

describe('AC-K.7 — geen stille afkapping', () => {
  it('AC-K.7: 230 wedstrijden en 70 spelers worden volledig geteld en getoond (geen limiet)', async () => {
    smN = 0
    const events: Row[] = []
    const players: Row[] = []
    const rijen: Row[] = []
    for (let n = 1; n <= 230; n++) {
      const dag = new Date(Date.UTC(2026, 7, 1) + (n % 70) * 86_400_000).toISOString().slice(0, 10)
      events.push(ev(U('e3', n), dag))
      rijen.push(sm(U('e3', n), U('a3', 1), 90, 1))
    }
    for (let n = 1; n <= 70; n++) players.push(sp(U('a3', n), `Speler ${String(n).padStart(2, '0')}`))
    await renderInzichten(leegDb({ events, players, speelminuten: rijen }))
    const rows = kaartRijen(SMK())
    expect(rows).toHaveLength(70)
    expect(rows.find((r) => r.naam === 'Speler 01')!.cellen).toEqual([dekking(230, 230), '20700', '90', '230'])
  })
})

describe('AC-K.9 — geen wedstrijd met minuten in het venster: lege staat met uitleg', () => {
  it('AC-K.9: minuten alleen buiten het gekozen venster -> lege staat met uitleg hoe je ze vastlegt', async () => {
    const db = leegDb({
      events: [ev(U('e4', 1), '2026-08-05'), ev(U('e4', 2), TODAY, { goals_for: 1, goals_against: 0 })],
      players: [sp(P.anna, 'Anna Aap')],
      speelminuten: [sm(U('e4', 1), P.anna, 90, 0)],
    })
    await renderInzichten(db, { periode: '4w' })
    expect(within(SMK()).getByText(i.speelminutenEmpty)).toBeInTheDocument()
    expect(i.speelminutenEmpty).toMatch(/wedstrijdanalyse/i)
    expect(within(SMK()).queryByRole('table')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// DEEL B — wedstrijdanalyse (echte pagina + echte actions + in-memory DB)
// ═══════════════════════════════════════════════════════════════════════
const EV = {
  past: U('e5', 1), // 2026-10-10, uitslag 2-1
  today: U('e5', 2), // vandaag
  future: U('e5', 3), // morgen
  noScore: U('e5', 4), // verleden, zonder uitslag
  train: U('e5', 5),
  other: U('e5', 6), // team-2
  leeg: U('e5', 7), // wedstrijd zonder aanwezigen
  old: U('e5', 8), // oude wedstrijd (augustus)
  onbekend: U('e5', 99),
}
const PIET = U('a5', 1)
const QUINTEN = U('a5', 2)
const GERRIT = U('a5', 3)
const AAFKE = U('a5', 4)
const INA = U('a5', 5)
const VERA = U('a5', 6)
const DIRK = U('a5', 7)

const speler = (id: string, name: string, o: Row = {}): Row => ({
  id, team_id: TEAM, name, position: 'Spits', secondary_positions: [], jersey_number: null, active: true, injured: false,
  type: 'regular', rating: null, created_at: '2026-01-01T00:00:00Z', ...o,
})
const aanw = (event: string, player: string, status = 'present', team = TEAM): Row => ({ team_id: team, event_id: event, player_id: player, status })

function analyseDb(over: Partial<Db> = {}): Db {
  smN = 0
  return {
    ...leegDb(),
    events: [
      { id: EV.past, team_id: TEAM, type: 'match', date: '2026-10-10', opponent: 'Ajax', home_away: 'home', goals_for: 2, goals_against: 1 },
      { id: EV.today, team_id: TEAM, type: 'match', date: TODAY, opponent: 'PSV', home_away: 'home', goals_for: null, goals_against: null },
      { id: EV.future, team_id: TEAM, type: 'match', date: '2026-10-16', opponent: 'AZ', home_away: 'home', goals_for: null, goals_against: null },
      { id: EV.noScore, team_id: TEAM, type: 'match', date: '2026-10-12', opponent: 'FC Utrecht', home_away: 'away', goals_for: null, goals_against: null },
      { id: EV.train, team_id: TEAM, type: 'training', date: '2026-10-09', opponent: null, home_away: null, goals_for: null, goals_against: null },
      { id: EV.other, team_id: OTHER, type: 'match', date: '2026-10-10', opponent: 'Feyenoord', home_away: 'home', goals_for: 0, goals_against: 0 },
      { id: EV.leeg, team_id: TEAM, type: 'match', date: '2026-10-11', opponent: 'NEC', home_away: 'home', goals_for: null, goals_against: null },
      { id: EV.old, team_id: TEAM, type: 'match', date: '2026-08-20', opponent: 'Vitesse', home_away: 'home', goals_for: 1, goals_against: 1 },
    ],
    players: [
      speler(PIET, 'Piet Peters', { jersey_number: 9 }),
      speler(QUINTEN, 'Quinten Quast', { jersey_number: 7 }),
      speler(GERRIT, 'Gerrit Gast', { type: 'guest' }),
      speler(AAFKE, 'Aafke Afwezig'),
      speler(INA, 'Ina Inactief', { active: false }),
      speler(VERA, 'Vera Vreemd', { team_id: OTHER }),
      speler(DIRK, 'Dirk Duif'),
    ],
    attendance: [
      aanw(EV.past, PIET), aanw(EV.past, QUINTEN), aanw(EV.past, GERRIT), aanw(EV.past, AAFKE, 'absent'), aanw(EV.past, INA),
      aanw(EV.past, VERA, 'present', OTHER),
      aanw(EV.today, PIET), aanw(EV.today, QUINTEN),
      aanw(EV.future, PIET),
      aanw(EV.noScore, PIET), aanw(EV.noScore, QUINTEN),
      aanw(EV.old, PIET), aanw(EV.old, QUINTEN),
    ],
    match_ratings: [], match_events: [], tegendoelpunten: [], speelminuten: [],
    ...over,
  }
}

async function openAnalyse(eventId: string, locale = 'nl') {
  state.locale = locale
  const bouw = () => AnalysisPage({ params: Promise.resolve({ id: eventId }) })
  const eerste = await bouw()
  function Shell() {
    const [el, setEl] = useState(eerste)
    useEffect(() => {
      state.refresh = () => {
        void bouw().then(setEl)
      }
    }, [])
    return (
      <DictProvider dict={dicts[locale]}>
        <ToastProvider teamId={TEAM}>{el}</ToastProvider>
      </DictProvider>
    )
  }
  return render(<Shell />)
}

const sec = (d: Dict = nl) => within(screen.getByRole('region', { name: d.analysis.speelminuten }))
const veld = (naam: string, soort: 'm' | 'w') =>
  sec().getByLabelText(`${naam} – ${soort === 'm' ? a.minutenLabel : a.wisselsLabel}`) as HTMLInputElement
const rijVan = (naam: string) => veld(naam, 'm').closest('form') as HTMLFormElement
const opslaanKnop = (naam: string) => within(rijVan(naam)).getByRole('button', { name: a.save })
const verwijderKnop = (naam: string) => sec().getByRole('button', { name: `${a.delete} – ${naam}` })
function vul(naam: string, m?: string, w?: string) {
  if (m !== undefined) fireEvent.change(veld(naam, 'm'), { target: { value: m } })
  if (w !== undefined) fireEvent.change(veld(naam, 'w'), { target: { value: w } })
}
const rijenIn = (db: Db, event = EV.past) => db.speelminuten.filter((r) => r.event_id === event)
const stamrij = (event: string, player: string, minuten: number, wissels: number, o: Row = {}): Row => ({
  id: U('5b', ++smN), team_id: TEAM, event_id: event, player_id: player, minuten, wissels, created_at: '2026-10-10T20:00:00+00:00', ...o,
})
async function slaOp(naam: string, m: string, w?: string) {
  vul(naam, m, w)
  fireEvent.click(opslaanKnop(naam))
  await waitFor(() => expect(sec().getByRole('status')).toHaveTextContent(a.saved))
}

describe('AC-M.1 — invullen, opslaan, direct zichtbaar, blijft na herladen', () => {
  it('AC-M.1: minuten en wissels invullen en opslaan -> rij in de database, direct zichtbaar en nog aanwezig na herladen', async () => {
    const db = analyseDb()
    setup(db)
    const { unmount } = await openAnalyse(EV.past)
    await slaOp('Piet Peters', '90', '2')
    expect(rijenIn(db)).toHaveLength(1)
    expect(rijenIn(db)[0]).toMatchObject({ team_id: TEAM, event_id: EV.past, player_id: PIET, minuten: 90, wissels: 2 })
    expect(veld('Piet Peters', 'm')).toHaveValue(90) // direct zichtbaar
    expect(verwijderKnop('Piet Peters')).toBeInTheDocument()

    unmount() // herladen = nieuwe pagina-render vanuit de database
    await openAnalyse(EV.past)
    expect(veld('Piet Peters', 'm')).toHaveValue(90)
    expect(veld('Piet Peters', 'w')).toHaveValue(2)
    expect(veld('Quinten Quast', 'm')).toHaveValue(null) // andere speler onaangeraakt
    expect(veld('Quinten Quast', 'w')).toHaveValue(0)
  })

  it('AC-M.1 / AC-K.1: een in de analyse opgeslagen waarde is daarna op /inzichten terug te zien', async () => {
    const db = analyseDb()
    setup(db)
    await openAnalyse(EV.past)
    await slaOp('Piet Peters', '90', '2')
    await slaOp('Quinten Quast', '45', '0')
    cleanup()
    await renderInzichten(db)
    const per = Object.fromEntries(kaartRijen(SMK()).map((r) => [r.naam, r.cellen]))
    expect(per['Piet Peters']).toEqual([dekking(1, 1), '90', '90', '2'])
    expect(per['Quinten Quast']).toEqual([dekking(1, 1), '45', '45', '0'])
  })
})

describe('AC-M.2 / M5 — invoer alleen in de wedstrijdanalyse', () => {
  it('AC-M.2: de sectie staat op de wedstrijdanalyse met kop en uitleg', async () => {
    setup(analyseDb())
    await openAnalyse(EV.past)
    expect(sec().getByText(a.speelminuten)).toBeInTheDocument()
    expect(sec().getByText(a.speelminutenUitleg)).toBeInTheDocument()
  })

  it('AC-M.2 (structuur): SpeelminutenSectie wordt buiten de wedstrijdanalyse nergens gerenderd', () => {
    const gebruikers: string[] = []
    const loop = (dir: string) => {
      for (const naam of readdirSync(dir)) {
        if (naam === 'node_modules' || naam.startsWith('.')) continue
        const pad = join(dir, naam)
        if (statSync(pad).isDirectory()) loop(pad)
        else if (/\.(tsx|ts)$/.test(naam) && !/\.test\./.test(naam) && readFileSync(pad, 'utf8').includes('SpeelminutenSectie')) gebruikers.push(pad.replace(process.cwd() + '/', ''))
      }
    }
    loop(join(process.cwd(), 'app'))
    loop(join(process.cwd(), 'components'))
    expect(gebruikers.sort()).toEqual(['components/MatchAnalysisEditor.tsx', 'components/SpeelminutenSectie.tsx'])
  })
})

describe('AC-M.3 — hooguit één set per wedstrijd en speler; laatste wint', () => {
  it('AC-M.3: opnieuw opslaan overschrijft (zelfde rij, nieuwe waarde), nooit een tweede rij', async () => {
    const db = analyseDb()
    setup(db)
    await openAnalyse(EV.past)
    await slaOp('Piet Peters', '90', '2')
    const id = rijenIn(db)[0].id
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull(), { timeout: 3000 })
    await slaOp('Piet Peters', '60', '3')
    expect(rijenIn(db)).toHaveLength(1)
    expect(rijenIn(db)[0]).toMatchObject({ id, minuten: 60, wissels: 3 })
  })

  it('AC-M.3: twee gelijktijdige opslagen voor dezelfde wedstrijd en speler geven één rij (laatste wint)', async () => {
    const db = analyseDb()
    const h = setup(db)
    await Promise.all([saveSpeelminuten(EV.past, PIET, 90, 1), saveSpeelminuten(EV.past, PIET, 60, 2)])
    expect(rijenIn(db)).toHaveLength(1)
    expect(rijenIn(db)[0]).toMatchObject({ minuten: 60, wissels: 2 })
    expect(h.writes.every((w) => w.op === 'upsert')).toBe(true)
  })

  it('AC-M.3: twee keer dezelfde opslag (dubbelklik/netwerk-retry) geeft één rij', async () => {
    const db = analyseDb()
    setup(db)
    await saveSpeelminuten(EV.past, PIET, 90, 1)
    await expect(saveSpeelminuten(EV.past, PIET, 90, 1)).resolves.toBeUndefined()
    expect(rijenIn(db)).toHaveLength(1)
  })
})

describe('AC-M.4 — alles van één speler in één stap; formulier niet opnieuw te versturen tijdens opslaan', () => {
  it('AC-M.4: tijdens opslaan zijn velden en knop disabled en een tweede submit geeft nog steeds één schrijfactie', async () => {
    const db = analyseDb()
    let los: () => void = () => {}
    const h = setup(db, { writeGate: new Promise<void>((r) => { los = r }) })
    await openAnalyse(EV.past)
    vul('Piet Peters', '90', '2')
    fireEvent.click(opslaanKnop('Piet Peters'))
    await waitFor(() => expect(veld('Piet Peters', 'm')).toBeDisabled())
    expect(veld('Piet Peters', 'w')).toBeDisabled()
    expect(opslaanKnop('Piet Peters')).toBeDisabled()
    fireEvent.submit(rijVan('Piet Peters')) // Enter tijdens pending
    fireEvent.click(opslaanKnop('Piet Peters'))
    // een andere speler blijft bruikbaar
    expect(veld('Quinten Quast', 'm')).not.toBeDisabled()
    los()
    await waitFor(() => expect(rijenIn(db)).toHaveLength(1))
    expect(h.writes.filter((w) => w.table === 'speelminuten')).toHaveLength(1)
  })

  it('AC-M.4: minuten en wissels gaan in één schrijfactie mee; nooit een rij met alleen één veld', async () => {
    const db = analyseDb()
    const h = setup(db)
    await openAnalyse(EV.past)
    await slaOp('Piet Peters', '70', '4')
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0].payload).toMatchObject({ minuten: 70, wissels: 4 })
  })

  it.each([
    ['wissels ontbreekt', 90, undefined],
    ['wissels is null', 90, null],
    ['minuten is null', null, 2],
    ['minuten ontbreekt', undefined, 2],
  ])('AC-M.4: server weigert een halve set (%s) en slaat niets op', async (_n, m, w) => {
    const db = analyseDb()
    const h = setup(db)
    await expect(saveSpeelminuten(EV.past, PIET, m as never, w as never)).rejects.toThrow('Ongeldige speelminuten')
    expect(h.writes).toEqual([])
    expect(db.speelminuten).toEqual([])
  })
})

describe('AC-M.5 — een mislukte opslag is zichtbaar en de oude waarde blijft', () => {
  it('AC-M.5: databasefout -> melding in de sectie (geen ruwe tekst), oude waarde in de database ongewijzigd, concept blijft staan; na herladen de oude waarde', async () => {
    const db = analyseDb({ speelminuten: [stamrij(EV.past, PIET, 80, 1)] })
    let kapot = true
    const h = setup(db, { writeErrors: { speelminuten: () => (kapot ? { code: 'XX000', message: 'RAW_DB_DETAIL' } : null) } })
    const { unmount } = await openAnalyse(EV.past)
    vul('Piet Peters', '70', '0')
    fireEvent.click(opslaanKnop('Piet Peters'))
    expect(await sec().findByRole('alert')).toHaveTextContent(a.speelminutenOpslaanFout)
    expect(document.body.textContent).not.toMatch(/RAW_DB_DETAIL|XX000/)
    expect(rijenIn(db)[0]).toMatchObject({ minuten: 80, wissels: 1 })
    expect(veld('Piet Peters', 'm')).toHaveValue(70) // concept blijft staan
    unmount()
    await openAnalyse(EV.past)
    expect(veld('Piet Peters', 'm')).toHaveValue(80)
    // opnieuw proberen lukt zodra de fout weg is
    kapot = false
    await slaOp('Piet Peters', '70', '0')
    expect(rijenIn(db)).toHaveLength(1)
    expect(rijenIn(db)[0]).toMatchObject({ minuten: 70, wissels: 0 })
    expect(h.writes).toHaveLength(2)
  })

  it('AC-M.5: de serverfout bevat nooit de ruwe databasetekst', async () => {
    setup(analyseDb(), { writeErrors: { speelminuten: () => ({ code: '42501', message: 'new row violates row-level security policy RAW_RLS' }) } })
    const fout = await saveSpeelminuten(EV.past, PIET, 90, 1).catch((e: Error) => e)
    expect(fout).toBeInstanceOf(Error)
    expect((fout as Error).message).toBe(GENERIC_ERROR_MESSAGE)
    expect((fout as Error).message).not.toMatch(/RAW_RLS|row-level/)
  })
})

describe('AC-M.6 / M2 — ongeldige invoer geweigerd met melding, niets opgeslagen (0–130 minuten, wissels 0–99)', () => {
  it.each([
    ['minuten 131', '131', '1'],
    ['minuten -1', '-1', '1'],
    ['minuten 12.5 (decimaal)', '12.5', '1'],
    ['minuten niet-numeriek ("abc")', 'abc', '3'],
    ['minuten leeg', '', '3'],
    ['wissels 100', '90', '100'],
    ['wissels -1', '90', '-1'],
    ['wissels 1.5 (decimaal)', '90', '1.5'],
  ])('AC-M.6: formulier met %s -> melding, geen schrijfactie', async (_n, m, w) => {
    const db = analyseDb()
    const h = setup(db)
    await openAnalyse(EV.past)
    vul('Piet Peters', m, w)
    // Het formulier heeft noValidate: een klik op Opslaan geeft direct de eigen
    // melding van de app, niet de browserbubbel.
    fireEvent.click(opslaanKnop('Piet Peters'))
    fireEvent.submit(rijVan('Piet Peters'))
    expect(await sec().findByRole('alert')).toHaveTextContent(a.speelminutenOngeldig)
    expect(h.writes).toEqual([])
    expect(db.speelminuten).toEqual([])
  })

  it.each([
    ['minuten', '131'], ['minuten', '-1'], ['minuten', '12.5'], ['wissels', '100'], ['wissels', '-1'], ['wissels', '1.5'],
  ])('AC-M.6: %s %s geeft bij klik op Opslaan de eigen app-melding (noValidate, geen browserbubbel) en schrijft niets', async (soort, waarde) => {
    const db = analyseDb()
    const h = setup(db)
    await openAnalyse(EV.past)
    vul('Piet Peters', soort === 'minuten' ? waarde : '90', soort === 'wissels' ? waarde : '1')
    expect(rijVan('Piet Peters').noValidate).toBe(true)
    fireEvent.click(opslaanKnop('Piet Peters'))
    expect(await sec().findByRole('alert')).toHaveTextContent(a.speelminutenOngeldig)
    expect(h.writes).toEqual([])
  })

  it.each([
    [131, 1], [-1, 1], [12.5, 1], ['12', 1], [Number.NaN, 1], [Number.POSITIVE_INFINITY, 1],
    [90, 100], [90, -1], [90, 1.5], [90, '1'], [90, Number.NaN],
  ])('AC-M.6: server weigert minuten %j / wissels %j en slaat niets op', async (m, w) => {
    const db = analyseDb()
    const h = setup(db)
    await expect(saveSpeelminuten(EV.past, PIET, m as never, w as never)).rejects.toThrow('Ongeldige speelminuten')
    expect(h.writes).toEqual([])
  })

  it('AC-M.6: een niet-uuid als wedstrijd- of speler-id wordt geweigerd', async () => {
    const h = setup(analyseDb())
    await expect(saveSpeelminuten('x', PIET, 90, 1)).rejects.toThrow()
    await expect(saveSpeelminuten(EV.past, 'x', 90, 1)).rejects.toThrow()
    expect(h.writes).toEqual([])
  })

  it.each([[0, 0], [130, 99], [0, 99], [130, 0]])('AC-M.6 (grens): minuten %i en wissels %i zijn geldig', async (m, w) => {
    const db = analyseDb()
    setup(db)
    await saveSpeelminuten(EV.past, PIET, m, w)
    expect(rijenIn(db)[0]).toMatchObject({ minuten: m, wissels: w })
  })
})

describe('AC-M.7 — zonder recht "wedstrijd" niets toevoegen, wijzigen of verwijderen; lezer ziet waarden', () => {
  it('AC-M.7: lezer ziet de waarden als tekst, zonder velden of knoppen', async () => {
    const db = analyseDb({
      team_members: assistent({ mag_agenda_bewerken: true }) as Row[],
      speelminuten: [stamrij(EV.past, PIET, 90, 2)],
    })
    setup(db, { userId: 'user-a' })
    await openAnalyse(EV.past)
    expect(sec().getByText('90 min · 2 wissels')).toBeInTheDocument()
    expect(sec().getAllByText(a.speelminutenNietIngevuld).length).toBeGreaterThan(0)
    expect(sec().queryAllByRole('spinbutton')).toHaveLength(0)
    expect(sec().queryAllByRole('button')).toHaveLength(0)
  })

  it('AC-M.7: de server weigert opslaan, verwijderen en herstellen zonder wedstrijdrecht ("Geen toegang"); niets verandert', async () => {
    const bestaand = stamrij(EV.past, PIET, 90, 2)
    const db = analyseDb({ team_members: assistent({ mag_agenda_bewerken: true }) as Row[], speelminuten: [bestaand] })
    const h = setup(db, { userId: 'user-a' })
    const snapshot: HerstelSpeelminuten = {
      soort: 'speelminuten', teamId: TEAM, id: U('5c', 1), eventId: EV.past, playerId: QUINTEN, minuten: 10, wissels: 0, createdAt: null,
    }
    await expect(saveSpeelminuten(EV.past, QUINTEN, 10, 0)).rejects.toThrow('Geen toegang')
    await expect(saveSpeelminuten(EV.past, PIET, 10, 0)).rejects.toThrow('Geen toegang')
    await expect(deleteSpeelminuten(EV.past, PIET)).rejects.toThrow('Geen toegang')
    await expect(herstelSpeelminuten(snapshot)).rejects.toThrow('Geen toegang')
    expect(h.writes).toEqual([])
    expect(db.speelminuten).toEqual([bestaand])
  })

  it('AC-M.7: een assistent MET mag_wedstrijd_bewerken mag opslaan; de rij krijgt het team-id (niet het user-id)', async () => {
    const db = analyseDb({ team_members: assistent({ mag_wedstrijd_bewerken: true }) as Row[] })
    setup(db, { userId: 'user-a' })
    await openAnalyse(EV.past)
    await slaOp('Piet Peters', '90', '1')
    expect(rijenIn(db)[0]).toMatchObject({ team_id: TEAM, minuten: 90, wissels: 1 })
  })
})

describe('AC-M.8 / M7 — corrigeren en per speler verwijderen met "Ongedaan maken"', () => {
  it('AC-M.8: corrigeren (nieuwe waarde opslaan) wijzigt dezelfde rij', async () => {
    const db = analyseDb({ speelminuten: [stamrij(EV.past, PIET, 80, 1)] })
    setup(db)
    await openAnalyse(EV.past)
    await slaOp('Piet Peters', '85')
    expect(rijenIn(db)).toHaveLength(1)
    expect(rijenIn(db)[0]).toMatchObject({ minuten: 85, wissels: 1 })
  })

  it('AC-M.8: verwijderen haalt de rij weg, de toast biedt "Ongedaan maken" en herstelt dezelfde rij (id, created_at)', async () => {
    const rij1 = stamrij(EV.past, PIET, 80, 1)
    const db = analyseDb({ speelminuten: [rij1] })
    setup(db)
    await openAnalyse(EV.past)
    fireEvent.click(verwijderKnop('Piet Peters'))
    await waitFor(() => expect(rijenIn(db)).toHaveLength(0))
    await waitFor(() => expect(veld('Piet Peters', 'm')).toHaveValue(null))
    expect(veld('Piet Peters', 'w')).toHaveValue(0)
    expect(sec().queryByRole('button', { name: `${a.delete} – Piet Peters` })).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: nl.undo.action }))
    await waitFor(() => expect(rijenIn(db)).toHaveLength(1))
    expect(rijenIn(db)[0]).toMatchObject({ id: rij1.id, team_id: TEAM, player_id: PIET, minuten: 80, wissels: 1 })
    expect(new Date(rijenIn(db)[0].created_at as string).getTime()).toBe(new Date(rij1.created_at as string).getTime())
    await waitFor(() => expect(veld('Piet Peters', 'm')).toHaveValue(80))
  })

  it('AC-M.8: "Ongedaan maken" overschrijft nooit een intussen opgeslagen waarde (laatste wint, één rij)', async () => {
    const db = analyseDb({ speelminuten: [stamrij(EV.past, PIET, 80, 1)] })
    const h = setup(db)
    const herstel = await deleteSpeelminuten(EV.past, PIET)
    await saveSpeelminuten(EV.past, PIET, 55, 2)
    await expect(herstelSpeelminuten(herstel)).resolves.toBeUndefined()
    expect(rijenIn(db)).toHaveLength(1)
    expect(rijenIn(db)[0]).toMatchObject({ minuten: 55, wissels: 2 })
    expect(rijenIn(db)[0].id).not.toBe(herstel.id)
    expect(h.writes.filter((w) => w.op === 'insert')).toHaveLength(0)
  })

  it('AC-M.8: een falende delete zet de waarde terug en toont "Verwijderen is mislukt"; de database houdt de rij', async () => {
    const db = analyseDb({ speelminuten: [stamrij(EV.past, PIET, 80, 1)] })
    setup(db, { writeErrors: { speelminuten: (op) => (op === 'delete' ? { code: 'XX000', message: 'RAW_DEL' } : null) } })
    await openAnalyse(EV.past)
    fireEvent.click(verwijderKnop('Piet Peters'))
    expect(await sec().findByRole('alert')).toHaveTextContent(nl.undo.deleteError)
    expect(rijenIn(db)).toHaveLength(1)
    expect(veld('Piet Peters', 'm')).toHaveValue(80)
    expect(document.body.textContent).not.toContain('RAW_DEL')
  })

  it('AC-M.8: verwijderen/herstellen van een rij van een ander team of een vreemd teamId wordt geweigerd', async () => {
    const vreemd = stamrij(EV.other, VERA, 90, 0, { team_id: OTHER })
    const db = analyseDb({ speelminuten: [vreemd] })
    const h = setup(db)
    await expect(deleteSpeelminuten(EV.other, VERA)).rejects.toThrow('Speelminuten niet gevonden')
    expect(db.speelminuten).toEqual([vreemd])
    const snapshot: HerstelSpeelminuten = {
      soort: 'speelminuten', teamId: OTHER, id: U('5c', 2), eventId: EV.past, playerId: PIET, minuten: 5, wissels: 0, createdAt: null,
    }
    await expect(herstelSpeelminuten(snapshot)).rejects.toThrow()
    expect(h.writes).toEqual([])
  })
})

describe('AC-M.9 / M4 — wie krijgt een invoerregel: aanwezige actieve spelers, inclusief aanwezige gasten', () => {
  it('AC-M.9: regel voor aanwezige spelers en de aanwezige gast; niet voor afwezigen, inactieven, niet-geselecteerden of spelers van een ander team', async () => {
    setup(analyseDb())
    await openAnalyse(EV.past)
    const labels = sec().getAllByLabelText(/ – Minuten$/).map((el) => el.getAttribute('aria-label'))
    expect(labels.sort()).toEqual(['Gerrit Gast – Minuten', 'Piet Peters – Minuten', 'Quinten Quast – Minuten'])
    for (const naam of ['Aafke Afwezig', 'Ina Inactief', 'Dirk Duif', 'Vera Vreemd']) {
      expect(sec().queryByLabelText(`${naam} – Minuten`)).toBeNull()
    }
  })
})

describe('AC-M.10 — wedstrijd zonder spelers die een regel kunnen krijgen: lege staat met uitleg', () => {
  it('AC-M.10: geen aanwezigen -> uitleg ("Geen aanwezige spelers"), geen fout en geen invoer', async () => {
    setup(analyseDb())
    await openAnalyse(EV.leeg)
    expect(screen.getByText(a.noPresent)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryAllByLabelText(/ – Minuten$/)).toHaveLength(0)
  })
})

describe('AC-M.11 / M5 — gedrag voor toekomst, vandaag, zonder uitslag en achteraf', () => {
  it('AC-M.11: wedstrijd in de toekomst -> uitleg en geen invoer; de server weigert ("Wedstrijd nog niet gespeeld")', async () => {
    const db = analyseDb()
    const h = setup(db)
    await openAnalyse(EV.future)
    expect(sec().getByText(a.speelminutenToekomst)).toBeInTheDocument()
    expect(sec().queryAllByRole('spinbutton')).toHaveLength(0)
    await expect(saveSpeelminuten(EV.future, PIET, 90, 1)).rejects.toThrow('Wedstrijd nog niet gespeeld')
    expect(h.writes).toEqual([])
  })

  it('AC-M.11: een wedstrijd van vandaag mag wel (invoer zichtbaar, opslaan lukt)', async () => {
    const db = analyseDb()
    setup(db)
    await openAnalyse(EV.today)
    await slaOp('Piet Peters', '45', '0')
    expect(rijenIn(db, EV.today)).toHaveLength(1)
  })

  it('AC-M.11: wedstrijd zonder uitslag en oude wedstrijden mogen achteraf worden ingevuld', async () => {
    const db = analyseDb()
    setup(db)
    await openAnalyse(EV.noScore)
    await slaOp('Piet Peters', '60', '1')
    cleanup()
    await openAnalyse(EV.old)
    await slaOp('Piet Peters', '70', '2')
    expect(rijenIn(db, EV.noScore)).toHaveLength(1)
    expect(rijenIn(db, EV.old)).toHaveLength(1)
  })

  it('AC-M.11 (fail-closed): de editor zonder wedstrijdGespeeld-prop toont geen invoer maar de toekomst-uitleg', () => {
    setup(analyseDb())
    render(
      <DictProvider dict={nl}>
        <ToastProvider teamId={TEAM}>
          <MatchAnalysisEditor
            eventId={EV.past}
            presentPlayers={[speler(PIET, 'Piet Peters') as unknown as Player]}
            teamName="Wij"
            opponent="Ajax"
            homeAway="home"
            initialGoalsFor={null}
            initialGoalsAgainst={null}
            initialRatings={[]}
            initialEvents={[]}
          />
        </ToastProvider>
      </DictProvider>,
    )
    expect(sec().getByText(a.speelminutenToekomst)).toBeInTheDocument()
    expect(sec().queryAllByRole('spinbutton')).toHaveLength(0)
  })

  it.each([
    ['een training van het eigen team', EV.train],
    ['een wedstrijd van een ander team', EV.other],
    ['een niet-bestaand event', EV.onbekend],
  ])('AC-A2 / AC-M.11: server weigert %s ("Event niet gevonden"), niets opgeslagen', async (_n, event) => {
    const db = analyseDb()
    const h = setup(db)
    await expect(saveSpeelminuten(event, PIET, 90, 1)).rejects.toThrow('Event niet gevonden')
    expect(h.writes).toEqual([])
  })
})

describe('AC-M.12 / M6 — geen waarschuwingen, alleen de harde validatie', () => {
  it('AC-M.12: 130 minuten met 99 wissels voor een speler met rode kaart wordt zonder waarschuwing opgeslagen', async () => {
    const db = analyseDb({
      match_events: [{ id: U('c1', 1), team_id: TEAM, event_id: EV.past, player_id: PIET, kind: 'red', minute: 5, created_at: '2026-10-10T20:00:00Z' }],
    })
    setup(db)
    await openAnalyse(EV.past)
    await slaOp('Piet Peters', '130', '99')
    expect(sec().queryAllByRole('alert')).toHaveLength(0)
    expect(rijenIn(db)[0]).toMatchObject({ minuten: 130, wissels: 99 })
  })
})

describe('AC-M.13 / M2 — geen wedstrijdduur', () => {
  it('AC-M.13: de opgeslagen rij bevat alleen team, wedstrijd, speler, minuten en wissels (geen duur); 130 is geldig bij elke wedstrijd', async () => {
    const db = analyseDb()
    const h = setup(db)
    await saveSpeelminuten(EV.past, PIET, 130, 0)
    expect(Object.keys(h.writes[0].payload).sort()).toEqual(['event_id', 'minuten', 'player_id', 'team_id', 'wissels'])
  })
})

describe('AC-M.14 (vervallen) / M5 — geen voorinvulling en nooit automatisch opslaan', () => {
  it('AC-M.14: openen van de analyse (met opstelling en aanwezigen) vult niets in en schrijft niets', async () => {
    const db = analyseDb()
    const h = setup(db)
    await openAnalyse(EV.past)
    for (const naam of ['Piet Peters', 'Quinten Quast', 'Gerrit Gast']) {
      expect(veld(naam, 'm')).toHaveValue(null)
      expect(opslaanKnop(naam)).toBeDisabled()
    }
    expect(h.writes).toEqual([])
    expect(db.speelminuten).toEqual([])
  })
})

describe('O1 — wisselveld start zichtbaar op 0; minuten verplicht', () => {
  it('O1: een nieuwe regel toont wissels "0" en lege minuten; alleen minuten invullen + opslaan -> rij met wissels 0', async () => {
    const db = analyseDb()
    setup(db)
    await openAnalyse(EV.past)
    expect(veld('Piet Peters', 'w')).toHaveValue(0)
    expect(veld('Piet Peters', 'w').value).toBe('0')
    expect(veld('Piet Peters', 'm').value).toBe('')
    await slaOp('Piet Peters', '90')
    expect(rijenIn(db)[0]).toMatchObject({ minuten: 90, wissels: 0 })
  })

  it('O1: een leeg wisselveld is een fout (melding, geen aanroep) — er wordt geen 0 verzonnen', async () => {
    const db = analyseDb()
    const h = setup(db)
    await openAnalyse(EV.past)
    vul('Piet Peters', '90', '')
    fireEvent.click(opslaanKnop('Piet Peters'))
    expect(await sec().findByRole('alert')).toHaveTextContent(a.speelminutenOngeldig)
    expect(h.writes).toEqual([])
  })

  it('O1: leeg minutenveld is een fout; de server blijft beide waarden eisen', async () => {
    const h = setup(analyseDb())
    await openAnalyse(EV.past)
    vul('Piet Peters', '', '2')
    fireEvent.click(opslaanKnop('Piet Peters'))
    expect(await sec().findByRole('alert')).toHaveTextContent(a.speelminutenOngeldig)
    expect(h.writes).toEqual([])
  })
})

describe('O2 — rijen van niet (meer) aanwezige of inactieve spelers: alleen-lezen, wel verwijderbaar met undo', () => {
  const overigeDb = () =>
    analyseDb({ speelminuten: [stamrij(EV.past, AAFKE, 70, 1), stamrij(EV.past, INA, 50, 0), stamrij(EV.past, PIET, 90, 2)] })

  it('O2: overige rijen staan onder een eigen kop met naam (ook van de inactieve speler) en waarde, zonder bewerkvelden', async () => {
    setup(overigeDb())
    await openAnalyse(EV.past)
    expect(sec().getByText(a.speelminutenOverig)).toBeInTheDocument()
    expect(sec().getByText('Aafke Afwezig')).toBeInTheDocument()
    expect(sec().getByText('Ina Inactief')).toBeInTheDocument()
    expect(sec().getByText('70 min · 1 wissels')).toBeInTheDocument()
    expect(sec().getByText('50 min · 0 wissels')).toBeInTheDocument()
    expect(sec().queryByLabelText('Aafke Afwezig – Minuten')).toBeNull()
    expect(sec().queryByLabelText('Ina Inactief – Minuten')).toBeNull()
  })

  it('O2: overige rij verwijderen met undo-toast werkt (ook voor de inactieve speler); undo zet dezelfde rij terug', async () => {
    const db = overigeDb()
    setup(db)
    await openAnalyse(EV.past)
    fireEvent.click(verwijderKnop('Ina Inactief'))
    await waitFor(() => expect(rijenIn(db).some((r) => r.player_id === INA)).toBe(false))
    await waitFor(() => expect(sec().queryByText('Ina Inactief')).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: nl.undo.action }))
    await waitFor(() => expect(rijenIn(db).some((r) => r.player_id === INA)).toBe(true))
    expect(rijenIn(db).find((r) => r.player_id === INA)).toMatchObject({ minuten: 50, wissels: 0, team_id: TEAM })
  })

  it('O2: een lezer (zonder wedstrijdrecht) ziet de overige rijen zonder verwijderknop', async () => {
    const db = overigeDb()
    db.team_members = assistent({}) as Row[]
    setup(db, { userId: 'user-a' })
    await openAnalyse(EV.past)
    expect(sec().getByText('Aafke Afwezig')).toBeInTheDocument()
    expect(sec().queryAllByRole('button')).toHaveLength(0)
  })

  it('AC-A2 / O2: een rij van team-2 op dezelfde wedstrijd wordt niet getoond', async () => {
    const db = analyseDb({ speelminuten: [stamrij(EV.past, VERA, 33, 3, { team_id: OTHER }), stamrij(EV.past, PIET, 90, 2)] })
    setup(db)
    await openAnalyse(EV.past)
    expect(sec().queryByText('33 min · 3 wissels')).toBeNull()
    expect(sec().queryByText(a.speelminutenOverig)).toBeNull()
    expect(sec().queryByText('Vera Vreemd')).toBeNull()
  })
})

describe('O3 — sectievolgorde in de analyse', () => {
  it('O3: Uitslag, Beoordelingen, Speelminuten en wissels, Gebeurtenissen, Tegendoelpunten — in die volgorde', async () => {
    setup(analyseDb())
    await openAnalyse(EV.past)
    const volgorde = [
      screen.getByText(a.result),
      screen.getByText(a.ratings),
      screen.getByRole('region', { name: a.speelminuten }),
      screen.getByText(a.events),
      screen.getByRole('region', { name: a.tegendoelpunten }),
    ]
    for (let n = 0; n < volgorde.length - 1; n++) {
      expect(volgorde[n].compareDocumentPosition(volgorde[n + 1]) & Node.DOCUMENT_POSITION_FOLLOWING, `positie ${n}`).toBeTruthy()
    }
  })
})

describe('AC-A2 (analyse) — tenant-isolatie op de wedstrijdanalyse', () => {
  it('AC-A2: een rij van team-2 op dezelfde wedstrijd beïnvloedt de getoonde waarden niet', async () => {
    const db = analyseDb({ speelminuten: [stamrij(EV.past, VERA, 33, 3, { team_id: OTHER }), stamrij(EV.past, PIET, 90, 2)] })
    setup(db)
    await openAnalyse(EV.past)
    expect(veld('Piet Peters', 'm')).toHaveValue(90)
    expect(sec().queryByText(/33/)).toBeNull()
  })

  it('AC-A2: speler van ander team -> "Speler niet gevonden", niets opgeslagen', async () => {
    const db = analyseDb()
    const h = setup(db)
    await expect(saveSpeelminuten(EV.past, VERA, 90, 1)).rejects.toThrow('Speler niet gevonden')
    expect(h.writes).toEqual([])
    expect(db.speelminuten).toEqual([])
  })

  it('AC-A2: de rij krijgt altijd het team-id uit de context, ook bij een assistent met ander user-id', async () => {
    const db = analyseDb({ team_members: assistent({ mag_wedstrijd_bewerken: true }) as Row[] })
    setup(db, { userId: 'user-a' })
    await saveSpeelminuten(EV.past, PIET, 90, 1)
    expect(rijenIn(db)[0].team_id).toBe(TEAM)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// DEEL C — tijdzones, opruimen
// ═══════════════════════════════════════════════════════════════════════
const TZS: [string, number][] = [
  ['Europe/Amsterdam', -120],
  ['America/Los_Angeles', 420],
  ['Pacific/Auckland', -780],
]

describe.each(TZS)('Tijdzone %s', (tz, offset) => {
  beforeEach(() => {
    process.env.TZ = tz
  })

  it('TZ-controle: de tijdzone is echt gewisseld', () => {
    expect(new Date(2026, 9, 15, 12, 0).getTimezoneOffset()).toBe(offset)
  })

  it.each([[0, 30], [10, 0], [23, 30]])('AC-M.11 / AC-A10: om %i:%i lokaal is een wedstrijd van vandaag toegestaan en die van morgen niet (action én pagina)', async (uur, min) => {
    zetKlok(TODAY, uur, min)
    const db = analyseDb()
    setup(db)
    await expect(saveSpeelminuten(EV.today, PIET, 90, 1)).resolves.toBeUndefined()
    await expect(saveSpeelminuten(EV.future, PIET, 90, 1)).rejects.toThrow('Wedstrijd nog niet gespeeld')
    expect(rijenIn(db, EV.today)).toHaveLength(1)
    expect(rijenIn(db, EV.future)).toHaveLength(0)
    await openAnalyse(EV.future)
    expect(sec().getByText(a.speelminutenToekomst)).toBeInTheDocument()
    cleanup()
    await openAnalyse(EV.today)
    expect(veld('Piet Peters', 'm')).toHaveValue(90)
  })

  it('AC-A10 / AC-K.6: het venster volgt de kalenderdatum van de wedstrijd — 4w-grens 2026-09-18 inclusief, 2026-09-17 uitgesloten; vandaag telt mee', async () => {
    zetKlok(TODAY, 23, 30)
    smN = 0
    const ids = [U('e2', 1), U('e2', 2), U('e2', 3)]
    const db = leegDb({
      events: [ev(ids[0], '2026-09-17'), ev(ids[1], '2026-09-18'), ev(ids[2], TODAY)],
      players: [sp(P.anna, 'Anna Aap')],
      speelminuten: [sm(ids[0], P.anna, 4, 0), sm(ids[1], P.anna, 8, 0), sm(ids[2], P.anna, 16, 0)],
    })
    const { h } = await renderInzichten(db, { periode: '4w' })
    const call = h.rpcCalls.find((c) => c.name === 'inzichten_speelminuten_per_speler')!
    expect(call.args).toMatchObject({ p_start: '2026-09-18' })
    expect(kaartRijen(SMK())[0].cellen).toEqual([dekking(2, 2), '24', '12', '0'])
  })
})

describe('AC-A13 — minuten mee bij team opruimen en verwijderen', () => {
  it('AC-A13: speelminuten staat in TEAM_TABELLEN, vóór events, players en match_ratings (FK-veilige volgorde)', () => {
    const lijst = [...TEAM_TABELLEN] as string[]
    const idx = lijst.indexOf('speelminuten')
    expect(idx).toBeGreaterThanOrEqual(0)
    for (const t of ['events', 'players', 'match_ratings']) expect(idx).toBeLessThan(lijst.indexOf(t))
  })

  it('AC-A13: het opruimen van een team verwijdert zijn speelminuten en laat die van andere teams staan', async () => {
    const db: Db = { teams: [{ id: TEAM }, { id: OTHER }] }
    for (const t of TEAM_TABELLEN) db[t] = []
    db.speelminuten = [stamrij(EV.past, PIET, 90, 1), stamrij(EV.other, VERA, 80, 0, { team_id: OTHER })]
    const h = setup(db)
    await ruimTeamOp(makeClient(h) as unknown as Parameters<typeof ruimTeamOp>[0], TEAM, 'test.opruimen')
    expect(db.speelminuten.map((r) => r.team_id)).toEqual([OTHER])
  })

  it('AC-A13 (SQL-structuur): speelminuten verwijst met on delete cascade naar teams, events en players (bewezen op de echte database door blok 28j)', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/inzichten-metrics-fase2b.sql'), 'utf8')
    for (const t of ['teams', 'events', 'players']) {
      expect(sql).toMatch(new RegExp(`references public\\.${t}\\(id\\)\\s+on delete cascade`))
    }
  })
})
