// Acceptatietests — fase 3b "inzichten-metrics": RPE per training en oordeel
// "doelstelling behaald" (ja/deels/nee) vastleggen op de trainingspagina en
// terugzien op /inzichten (sRPE per ISO-week, oordeel-aantallen, uitbreiding
// van de invul-discipline-kaart).
//
// Methode (van buitenaf, geen unit-tests):
//   * Deel A rendert de ECHTE app/events/[id]/page.tsx met de echte
//     TrainingEvaluatieSectie en de ECHTE server actions
//     (app/actions/training-evaluatie.ts) tegen een in-memory database die
//     filters (.eq/.in/.is/...), de UNIQUE-sleutel (23505) en upsert PER KOLOM
//     (ON CONFLICT DO UPDATE SET alleen de meegegeven kolommen) werkelijk
//     toepast. router.refresh() rendert de pagina opnieuw vanuit die database,
//     dus "blijft na herladen" is echt gemeten.
//   * Deel B rendert de ECHTE app/inzichten/page.tsx. De RPC's worden
//     beantwoord door handlers die de SQL uit supabase/inzichten-metrics-
//     fase3a.sql en inzichten-metrics-fase3b.sql nabootsen op in-memory rijen
//     en daarbij het p_team_id-ARGUMENT van de pagina gebruiken (inclusief
//     is_team_member en het teamfilter op events én op de evaluatie in de ON).
//   * Deel C: tijdzones (3 TZ x 3 tijdstippen), talen, opruimen.
//
// BEPERKING (eerlijk): vitest kan RLS en de SQL zelf niet bewijzen. De handlers
// bootsen de SQL alleen na. RLS, CHECK-constraints, security invoker en cascade
// staan in supabase/team-rls-verificatie.sql (blok 2, 22, 30 - al op de echte
// database gedraaid, zie fase3b/05-migratie-en-verificatie.md) en in de
// structuurtest inzichten-metrics-fase3b-migratie.acceptance.test.ts. CHECK en
// RLS worden hier bewust NIET nagebootst, zodat bewezen wordt dat de server
// action zelf weigert.
//
// Besluiten die hier gelden: R1-R9 (story §6) en O1-O3 (brief §8). Vervallen:
// AC-K.11 (ACWR), AC-R.8 en AC-K.8 (per speler). Bewust gelijke teksten:
// event.oordeelJa/Deels/Nee = insights.kolomJa/Deels/Nee.
//
// ── AC → test-mapping: elke testnaam begint met zijn criterium (bv. "AC-R.1") ──

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, configure, cleanup } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DictProvider } from '@/lib/i18n-context'
import { ToastProvider } from '@/components/ui/Toast'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { es } from '@/messages/es'
import { fr } from '@/messages/fr'
import type { Dict } from '@/messages/nl'

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

// Ruime timeout per test: de pagina-renders zijn onder load (volledige suite) traag gebleken.
vi.setConfig({ testTimeout: 30000 })

import { createClient } from '@/lib/supabase/server'
import InzichtenPage from '@/app/inzichten/page'
import EventDetailPage from '@/app/events/[id]/page'
import {
  saveTrainingRpe, wisTrainingRpe, herstelTrainingRpe,
  saveTrainingOordeel, wisTrainingOordeel, herstelTrainingOordeel,
} from '@/app/actions/training-evaluatie'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { HERSTEL_FOUT, type HerstelTrainingOordeel, type HerstelTrainingRpe } from '@/lib/herstel'
import { TEAM_TABELLEN, ruimTeamOp } from '@/lib/team-opruimen'
import { berekenTijdlijn } from '@/lib/sessie-tijdlijn'
import { blokkenVanKoppelingen } from '@/lib/parallel-groep'

// ═══════════════════════════════════════════════════════════════════════
// Gedeelde in-memory database + Supabase-client
// ═══════════════════════════════════════════════════════════════════════
type Row = Record<string, unknown>
type Db = Record<string, Row[]>
type Op = 'insert' | 'upsert' | 'delete' | 'update'

interface Harness {
  db: Db
  rpcCalls: { name: string; args: Row }[]
  writes: { table: string; op: Op; payload: Row | Row[]; onConflict?: string }[]
  rpcErrors: Record<string, unknown>
  selectErrors: Record<string, unknown>
  writeErrors: Record<string, (op: Op) => unknown>
  // Houdt elke schrijfactie op `training_evaluaties` vast tot de gate opengaat.
  writeGate: Promise<void> | null
  // Wordt vlak voor het toepassen van elke schrijfactie aangeroepen: laat een
  // test een concurrerende schrijver "ertussen" komen (race).
  voorSchrijf: ((op: Op, table: string, db: Db) => void) | null
  handlers: Record<string, (db: Db, args: Row, h: Harness) => Row[]>
  userId: string
}

// De UNIQUE-sleutels die de echte database afdwingt (supabase/inzichten-metrics-fase3b.sql).
const UNIEK: Record<string, string[]> = {
  training_evaluaties: ['event_id'],
}
// Kolomdefaults van een nieuwe rij (rpe en oordeel zijn nullable zonder default = NULL).
const STANDAARD: Record<string, Row> = {
  training_evaluaties: { rpe: null, oordeel: null },
}
let genTeller = 0

function makeClient(h: Harness) {
  function from(table: string) {
    let op: 'select' | Op = 'select'
    let payload: Row | Row[] = {}
    let onConflict = ''
    let selectStr = ''
    let returning = false
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
    let limitN: number | null = null

    // PostgREST-join `oefeningen(categorie, duur_min)` op training_oefeningen.
    function embed(r: Row): Row {
      if (table === 'training_oefeningen' && selectStr.includes('oefeningen(')) {
        const o = h.db.oefeningen.find((x) => x.id === r.oefening_id && x.leesbaar !== false)
        return { ...r, oefeningen: o ? { categorie: o.categorie, duur_min: o.duur_min } : null }
      }
      return { ...r }
    }

    async function execute(): Promise<{ data: Row[] | null; error: unknown }> {
      const rows = h.db[table]
      if (!rows) throw new Error(`Onverwachte tabel in test: "${table}"`)
      if (op !== 'select') {
        h.writes.push({
          table, op, payload: Array.isArray(payload) ? payload.map((p) => ({ ...p })) : { ...payload }, onConflict: onConflict || undefined,
        })
        if (table === 'training_evaluaties' && h.writeGate) await h.writeGate
        h.voorSchrijf?.(op, table, h.db)
        const fout = h.writeErrors[table]?.(op)
        if (fout) return { data: null, error: fout }
        const treffers = () => rows.filter((r) => filters.every((f) => f(r)))
        if (op === 'delete') {
          const weg = treffers()
          const keep = rows.filter((r) => !weg.includes(r))
          rows.length = 0
          rows.push(...keep)
          return { data: returning ? weg.map((r) => ({ ...r })) : null, error: null }
        }
        if (op === 'update') {
          const hit = treffers()
          for (const r of hit) Object.assign(r, payload)
          return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null }
        }
        const uit: Row[] = []
        for (const item of Array.isArray(payload) ? payload : [payload]) {
          if (op === 'upsert') {
            const cols = onConflict.split(',')
            const bestaand = rows.find((r) => cols.every((k) => r[k] === item[k]))
            if (bestaand) {
              // ON CONFLICT DO UPDATE SET: alleen de kolommen uit de payload.
              Object.assign(bestaand, item)
              uit.push(bestaand)
              continue
            }
          }
          const sleutel = UNIEK[table]
          const idBotsing = item.id !== undefined && rows.some((r) => r.id === item.id)
          const sleutelBotsing = !!sleutel && rows.some((r) => sleutel.every((k) => r[k] === item[k]))
          if (idBotsing || sleutelBotsing) {
            return {
              data: null,
              error: { code: '23505', message: `duplicate key value violates unique constraint "${table}_key" RAW_DUP` },
            }
          }
          const nieuw: Row = { ...(STANDAARD[table] ?? {}), id: U('9e', ++genTeller), created_at: new Date().toISOString(), ...item }
          rows.push(nieuw)
          uit.push(nieuw)
        }
        return { data: returning ? uit.map((r) => ({ ...r })) : null, error: null }
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
      return { data: out.map(embed), error: null }
    }

    const chain: Record<string, unknown> = {
      select: (s?: string) => {
        selectStr = s ?? ''
        if (op !== 'select') returning = true
        return chain
      },
      insert: (p: Row | Row[]) => {
        op = 'insert'
        payload = p
        return chain
      },
      upsert: (p: Row | Row[], o: { onConflict: string }) => {
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
      // PostgREST .is(kolom, null) = "kolom IS NULL"; een ontbrekende sleutel telt als NULL.
      is: (c: string, v: unknown) => {
        filters.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v))
        return chain
      },
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
      return Promise.resolve({ data: handler(h.db, args, h), error: null })
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════
// De RPC's, nagebootst uit de SQL (fase 3a en fase 3b)
// ═══════════════════════════════════════════════════════════════════════
const inRange = (d: string, s: string, e: string) => d >= s && d <= e
const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
const SQL_LIMIT = 901 // limit 901 in alle drie de functies

// inzichten_training_koppelingen (3a): events e left join training_oefeningen k
// on k.event_id = e.id and k.team_id = p_team_id left join oefeningen.
function hKoppelingen(db: Db, args: Row): Row[] {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const evs = db.events
    .filter((e) => e.team_id === p_team_id && e.type === 'training' && inRange(e.date as string, p_start, p_end))
    .sort((a, b) => cmp(a.date, b.date) || cmp(a.id, b.id))
  const rijen: Row[] = []
  for (const e of evs) {
    const ks = db.training_oefeningen
      .filter((k) => k.event_id === e.id && k.team_id === p_team_id)
      .sort((a, b) => (a.volgorde as number) - (b.volgorde as number) || cmp(a.created_at, b.created_at) || cmp(a.id, b.id))
    if (ks.length === 0) {
      rijen.push({
        event_id: e.id, datum: e.date, trainingstype: e.trainingstype,
        koppeling_id: null, volgorde: null, aangemaakt: null, parallel_groep_id: null,
        koppeling_duur_min: null, oefening_duur_min: null, categorie: null, stap_override: null,
        oefening_leesbaar: false,
      })
      continue
    }
    for (const k of ks) {
      const oef = db.oefeningen.find((x) => x.id === k.oefening_id && x.leesbaar !== false)
      rijen.push({
        event_id: e.id, datum: e.date, trainingstype: e.trainingstype,
        koppeling_id: k.id, volgorde: k.volgorde, aangemaakt: k.created_at,
        parallel_groep_id: k.parallel_groep_id ?? null,
        koppeling_duur_min: k.duur_min ?? null,
        oefening_duur_min: oef ? (oef.duur_min ?? null) : null,
        categorie: oef ? (oef.categorie ?? null) : null,
        stap_override: k.stap_override ?? null,
        oefening_leesbaar: !!oef,
      })
    }
  }
  return rijen.slice(0, SQL_LIMIT).map((r) => ({ ...r, totaal: rijen.length }))
}

// inzichten_invul_discipline (3a).
function hDiscipline(db: Db, args: Row): Row[] {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const rijen = db.events
    .filter((e) => e.team_id === p_team_id && (e.type === 'match' || e.type === 'training') && inRange(e.date as string, p_start, p_end))
    .sort((a, b) => cmp(a.date, b.date) || cmp(a.id, b.id))
    .map((e) => ({
      event_id: e.id,
      soort: e.type,
      datum: e.date,
      goals_for: e.goals_for ?? null,
      goals_against: e.goals_against ?? null,
      doelstelling: e.type === 'training' ? (e.doelstelling ?? null) : null,
      aantal_ratings: db.match_ratings.filter((r) => r.event_id === e.id && r.team_id === p_team_id).length,
      aantal_momenten: db.match_events.filter((me) => me.event_id === e.id && me.team_id === p_team_id).length,
      aantal_oefeningen: db.training_oefeningen.filter((k) => k.event_id === e.id && k.team_id === p_team_id).length,
      handmatig: db.task_overrides.some(
        (tov) => tov.event_id === e.id && tov.team_id === p_team_id && tov.task_type === (e.type === 'match' ? 'analysis' : 'training_plan'),
      ),
    }))
  return rijen.slice(0, SQL_LIMIT).map((r) => ({ ...r, totaal: rijen.length }))
}

// inzichten_training_evaluaties (3b), 1:1 uit de SQL:
//   from events e left join training_evaluaties te on te.event_id = e.id and te.team_id = p_team_id
//   where is_team_member(p_team_id) and e.team_id = p_team_id and e.type = 'training'
//     and e.date between p_start and p_end
//   order by e.date, e.id limit 901   (+ count(*) over ())
function hEvaluaties(db: Db, args: Row, h: Harness): Row[] {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const isLid = db.team_members.some((m) => m.team_id === p_team_id && m.user_id === h.userId)
  if (!isLid) return []
  const rijen = db.events
    .filter((e) => e.team_id === p_team_id && e.type === 'training' && inRange(e.date as string, p_start, p_end))
    .sort((a, b) => cmp(a.date, b.date) || cmp(a.id, b.id))
    .map((e) => {
      const te = db.training_evaluaties.find((x) => x.event_id === e.id && x.team_id === p_team_id)
      return {
        event_id: e.id, datum: e.date, doelstelling: e.doelstelling ?? null,
        rpe: te ? (te.rpe ?? null) : null, oordeel: te ? (te.oordeel ?? null) : null,
      }
    })
  return rijen.slice(0, SQL_LIMIT).map((r) => ({ ...r, totaal: rijen.length }))
}

const MET_DATA: Harness['handlers'] = {
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
  inzichten_speelminuten_per_speler: () => [],
  inzichten_training_koppelingen: hKoppelingen,
  inzichten_invul_discipline: hDiscipline,
  inzichten_training_evaluaties: hEvaluaties,
}
// Geen enkele oudere kaart heeft data: alleen 3a/3b-bronnen kunnen de pagina "vullen".
const LEEG: Harness['handlers'] = {
  ...MET_DATA,
  inzichten_aanwezigheid: () => [{ aanwezig: 0, afwezig: 0 }],
  inzichten_rating_team_per_wedstrijd: () => [],
  inzichten_rating_per_speler: () => [],
  inzichten_rating_vorm_per_speler: () => [],
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
    voorSchrijf: null,
    handlers: MET_DATA,
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
const TODAY = '2026-10-15' // donderdag; gisteren = 2026-10-14
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
  configure({ defaultIgnore: STANDAARD_IGNORE })
  vi.useRealTimers()
  if (ORIGINELE_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINELE_TZ
})

const e = nl.event
const i = nl.insights
const G = i.geenGegevens

// ═══════════════════════════════════════════════════════════════════════
// Fixtures (gedeeld)
// ═══════════════════════════════════════════════════════════════════════
function leegDb(over: Partial<Db> = {}, seizoen: [string, string] = ['2026-08-01', '2027-06-30']): Db {
  return {
    team_members: [owner()],
    settings: [
      { team_id: TEAM, key: 'season_start', value: seizoen[0] },
      { team_id: TEAM, key: 'season_end', value: seizoen[1] },
    ],
    events: [], players: [], match_events: [], lineups: [], tegendoelpunten: [], match_squad: [], speelminuten: [],
    attendance: [], match_ratings: [], training_oefeningen: [], categorie_metingen: [], task_overrides: [], oefeningen: [],
    metingen: [], absence_periods: [], training_evaluaties: [],
    ...over,
  }
}

let kN = 0
const tr = (id: string, date: string, o: Row = {}): Row => ({
  id, team_id: TEAM, type: 'training', date, opponent: null, trainingstype: 'vct', doelstelling: null,
  goals_for: null, goals_against: null, created_at: '2026-01-01T10:00:00Z', ...o,
})
const wed = (id: string, date: string, o: Row = {}): Row => ({
  id, team_id: TEAM, type: 'match', date, opponent: 'Tegenstander', match_type: 'league', home_away: 'home',
  goals_for: null, goals_against: null, trainingstype: 'vct', doelstelling: null, created_at: '2026-01-01T10:00:00Z', ...o,
})
const oef = (id: string, categorie: string, duur: number | null, o: Row = {}): Row => ({
  id, team_id: TEAM, categorie, duur_min: duur, ...o,
})
const kp = (event: string, oefId: string, o: Row = {}): Row => {
  const n = ++kN
  return {
    id: U('4b', n), team_id: TEAM, event_id: event, oefening_id: oefId, volgorde: n,
    created_at: new Date(Date.UTC(2026, 0, 1, 10, 0, n)).toISOString(), parallel_groep_id: null, duur_min: null,
    stap_override: null, ...o,
  }
}
const ev3b = (event: string, rpe: number | null, oordeel: string | null, team = TEAM): Row => ({
  id: U('7e', ++kN), team_id: team, event_id: event, rpe, oordeel, created_at: '2026-10-10T20:00:00+00:00',
})
const rating = (event: string, team = TEAM): Row => ({ id: U('d1', ++kN), team_id: team, event_id: event, player_id: 'p', rating: 7 })
const moment = (event: string, team = TEAM): Row => ({ id: U('d2', ++kN), team_id: team, event_id: event, kind: 'goal' })
const ovr = (event: string, taskType: string, team = TEAM): Row => ({ id: U('d3', ++kN), team_id: team, event_id: event, task_type: taskType })

// Bibliotheek: duren per oefening. `zd` heeft nergens een duur (blok zonder duur).
const O = {
  pg: U('0f', 1), wu: U('0f', 2), sw: U('0f', 3), pm: U('0f', 4), pk: U('0f', 5), ov: U('0f', 6),
  mate: U('0f', 7), hid: U('0f', 8), zd: U('0f', 9),
}
function bibliotheek(): Row[] {
  return [
    oef(O.pg, 'partijen_groot', 25), oef(O.wu, 'warming_up', 10), oef(O.sw, 'sprints_weinig_rust', 12),
    oef(O.pm, 'partijen_midden', 40), oef(O.pk, 'partijen_klein', 40), oef(O.ov, 'overig', 10),
    oef(O.mate, 'pass_trap', 18, { team_id: 'mate-user' }),
    oef(O.hid, 'positiespel', 40, { leesbaar: false }),
    oef(O.zd, 'overig', null),
  ]
}

// ═══════════════════════════════════════════════════════════════════════
// DEEL A — trainingspagina (echte pagina + echte actions + in-memory DB)
// ═══════════════════════════════════════════════════════════════════════
const EV = {
  past: U('f1', 1), // 2026-10-10, doelstelling 'Passen verbeteren'
  today: U('f1', 2), // vandaag, doelstelling
  future: U('f1', 3), // 2026-10-16, doelstelling
  leeg: U('f1', 4), // verleden, GEEN doelstelling (null)
  spaties: U('f1', 5), // verleden, doelstelling '   '
  match: U('f1', 6), // wedstrijd
  other: U('f1', 7), // training van team-2
  past2: U('f1', 8), // tweede verleden training met doelstelling
  onbekend: U('f1', 99),
}
const PIET = U('a5', 1)
const speler = (id: string, name: string, o: Row = {}): Row => ({
  id, team_id: TEAM, name, position: 'Spits', secondary_positions: [], jersey_number: null, active: true, injured: false,
  type: 'regular', rating: null, created_at: '2026-01-01T00:00:00Z', ...o,
})
const aanw = (event: string, player: string, status = 'present', team = TEAM): Row => ({ team_id: team, event_id: event, player_id: player, status })

function eventDb(over: Partial<Db> = {}): Db {
  const events: Row[] = [
    tr(EV.past, '2026-10-10', { doelstelling: 'Passen verbeteren', notes: 'Een notitie' }),
    tr(EV.today, TODAY, { doelstelling: 'Druk zetten' }),
    tr(EV.future, '2026-10-16', { doelstelling: 'Afwerken' }),
    tr(EV.leeg, '2026-10-09'),
    tr(EV.spaties, '2026-10-08', { doelstelling: '   ' }),
    wed(EV.match, '2026-10-10', { opponent: 'Ajax' }),
    tr(EV.other, '2026-10-10', { team_id: OTHER, doelstelling: 'Vreemd' }),
    tr(EV.past2, '2026-10-07', { doelstelling: 'Positiespel' }),
  ]
  return {
    ...leegDb(),
    events,
    players: [speler(PIET, 'Piet Peters')],
    // Een aanwezigheidsrij per eigen event: de pagina hoeft dan niet te backfillen.
    attendance: events.filter((x) => x.team_id === TEAM).map((x) => aanw(x.id as string, PIET)),
    ...over,
  }
}

async function openEvent(eventId: string, locale = 'nl', teamId = TEAM) {
  state.locale = locale
  const bouw = () => EventDetailPage({ params: Promise.resolve({ id: eventId }) })
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
        <ToastProvider teamId={teamId}>{el}</ToastProvider>
      </DictProvider>
    )
  }
  return render(<Shell />)
}

const SEC = (d: Dict = nl) => within(screen.getByRole('region', { name: d.event.evaluatieTitel }))
const rpeNaam = (n: number, d: Dict = nl) => {
  const basis = d.event.rpeWaarde.replace('{n}', String(n))
  const anker = (d.event.rpeAnkers as Record<string, string>)[String(n)]
  return anker ? `${basis} – ${anker}` : basis
}
const rpeKnop = (n: number, d: Dict = nl) => SEC(d).getByRole('button', { name: rpeNaam(n, d) })
const OORDEEL_NAAM = { ja: e.oordeelJa, deels: e.oordeelDeels, nee: e.oordeelNee } as const
const oordeelKnop = (o: 'ja' | 'deels' | 'nee') => SEC().getByRole('button', { name: OORDEEL_NAAM[o] })
const geselecteerdeRpe = () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((n) => rpeKnop(n).getAttribute('aria-pressed') === 'true')
const geselecteerdOordeel = () => (['ja', 'deels', 'nee'] as const).filter((o) => oordeelKnop(o).getAttribute('aria-pressed') === 'true')
const evRij = (db: Db, event = EV.past) => db.training_evaluaties.filter((r) => r.event_id === event)
const stamEv = (event: string, rpe: number | null, oordeel: string | null, o: Row = {}): Row => ({ ...ev3b(event, rpe, oordeel), ...o })
const statusTekst = () => SEC().getAllByRole('status').map((s) => s.textContent).join('|')

describe('AC-R.1 — RPE (1–10) vastleggen: direct zichtbaar en blijft na herladen', () => {
  it('AC-R.1: op 7 tikken slaat één rij op met team-id, training en RPE; direct zichtbaar; na herladen staat 7 er nog', async () => {
    const db = eventDb()
    setup(db)
    const { unmount } = await openEvent(EV.past)
    expect(geselecteerdeRpe()).toEqual([])
    fireEvent.click(rpeKnop(7))
    expect(rpeKnop(7)).toHaveAttribute('aria-pressed', 'true') // direct zichtbaar (optimistisch)
    await waitFor(() => expect(evRij(db)).toHaveLength(1))
    expect(evRij(db)[0]).toMatchObject({ team_id: TEAM, event_id: EV.past, rpe: 7 })
    await waitFor(() => expect(statusTekst()).toContain(nl.analysis.saved))

    unmount() // herladen = nieuwe pagina-render vanuit de database
    await openEvent(EV.past)
    expect(geselecteerdeRpe()).toEqual([7])
  })

  it('AC-R.1: alle tien waarden 1 t/m 10 zijn te kiezen en worden precies zo opgeslagen', async () => {
    for (const n of [1, 5, 10]) {
      const db = eventDb()
      setup(db)
      const { unmount } = await openEvent(EV.past)
      fireEvent.click(rpeKnop(n))
      await waitFor(() => expect(evRij(db)[0]?.rpe).toBe(n))
      unmount()
      await openEvent(EV.past)
      expect(geselecteerdeRpe()).toEqual([n])
      cleanup()
    }
  })

  it('AC-R.1: de schaal heeft precies de tien knoppen 1–10 (geen 0, geen 11)', async () => {
    setup(eventDb())
    await openEvent(EV.past)
    const knoppen = SEC().getAllByRole('button', { name: /^RPE \d+/ })
    expect(knoppen).toHaveLength(10)
    expect(knoppen.map((b) => b.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
  })
})

describe('AC-R.2 — hooguit één RPE per training; opnieuw opslaan overschrijft; gelijktijdig geeft één rij', () => {
  it('AC-R.2: opnieuw opslaan overschrijft dezelfde rij (zelfde id), nooit een tweede rij', async () => {
    const db = eventDb()
    setup(db)
    await openEvent(EV.past)
    fireEvent.click(rpeKnop(4))
    await waitFor(() => expect(evRij(db)).toHaveLength(1))
    const id = evRij(db)[0].id
    await waitFor(() => expect(rpeKnop(9)).not.toBeDisabled())
    fireEvent.click(rpeKnop(9))
    await waitFor(() => expect(evRij(db)[0].rpe).toBe(9))
    expect(evRij(db)).toHaveLength(1)
    expect(evRij(db)[0].id).toBe(id)
    expect(geselecteerdeRpe()).toEqual([9])
  })

  it('AC-R.2: twee gelijktijdige opslagen voor dezelfde training geven één rij (laatste wint)', async () => {
    const db = eventDb()
    const h = setup(db)
    await Promise.all([saveTrainingRpe(EV.past, 6), saveTrainingRpe(EV.past, 9)])
    expect(evRij(db)).toHaveLength(1)
    expect(evRij(db)[0]).toMatchObject({ rpe: 9 })
    expect(h.writes.every((w) => w.op === 'upsert')).toBe(true)
  })

  it('AC-R.2: twee keer dezelfde opslag (dubbelklik/netwerk-retry) geeft één rij en geen fout', async () => {
    const db = eventDb()
    setup(db)
    await saveTrainingRpe(EV.past, 6)
    await expect(saveTrainingRpe(EV.past, 6)).resolves.toBeUndefined()
    expect(evRij(db)).toHaveLength(1)
  })

  it('AC-R.2 / O.2: de database kent de UNIQUE-sleutel: een tweede gewone insert op dezelfde training botst (23505)', async () => {
    // Bewijst dat de harnas-engine 23505 echt toepast, zodat de race-tests hieronder iets meten.
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, 3, null)] })
    const client = makeClient(setup(db))
    const tabel = client.from('training_evaluaties') as unknown as { insert(p: Row): Promise<{ error: unknown }> }
    const { error } = await tabel.insert({ team_id: TEAM, event_id: EV.past, rpe: 5 })
    expect(error).toMatchObject({ code: '23505' })
    expect(evRij(db)).toHaveLength(1)
  })
})

describe('AC-R.3 — in één stap opgeslagen; formulier tijdens opslaan niet opnieuw te versturen', () => {
  it('AC-R.3: tijdens opslaan zijn alle 10 RPE-knoppen en de wisknop disabled; twee tikken geven één schrijfactie; het oordeelblok blijft bruikbaar', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, 3, null)] })
    let los: () => void = () => {}
    const h = setup(db, { writeGate: new Promise<void>((r) => { los = r }) })
    await openEvent(EV.past)
    fireEvent.click(rpeKnop(8))
    await waitFor(() => expect(rpeKnop(1)).toBeDisabled())
    for (let n = 1; n <= 10; n++) expect(rpeKnop(n)).toBeDisabled()
    expect(SEC().getByRole('button', { name: e.rpeWissen })).toBeDisabled()
    fireEvent.click(rpeKnop(9)) // tweede tik tijdens pending
    fireEvent.click(rpeKnop(2))
    expect(oordeelKnop('ja')).not.toBeDisabled() // eigen transitie per blok
    los()
    await waitFor(() => expect(evRij(db)[0].rpe).toBe(8))
    expect(h.writes.filter((w) => w.table === 'training_evaluaties')).toHaveLength(1)
  })

  it('AC-R.3: een tik op de huidige waarde doet niets (geen schrijfactie)', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, 6, null)] })
    const h = setup(db)
    await openEvent(EV.past)
    fireEvent.click(rpeKnop(6))
    await new Promise((r) => setTimeout(r, 20))
    expect(h.writes).toEqual([])
  })

  it('AC-R.3: een RPE-opslag is één schrijfactie met alleen team, training en RPE', async () => {
    const db = eventDb()
    const h = setup(db)
    await openEvent(EV.past)
    fireEvent.click(rpeKnop(5))
    await waitFor(() => expect(evRij(db)).toHaveLength(1))
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0]).toMatchObject({ table: 'training_evaluaties', op: 'upsert', onConflict: 'event_id', payload: { team_id: TEAM, event_id: EV.past, rpe: 5 } })
  })
})

describe('AC-R.4 — een mislukte opslag is zichtbaar en de oude waarde blijft', () => {
  it('AC-R.4: databasefout -> melding in de sectie (geen ruwe tekst), oude waarde blijft in database én selectie; na herladen de oude waarde', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, 5, null)] })
    let kapot = true
    const h = setup(db, { writeErrors: { training_evaluaties: () => (kapot ? { code: 'XX000', message: 'RAW_DB_DETAIL' } : null) } })
    const { unmount } = await openEvent(EV.past)
    fireEvent.click(rpeKnop(8))
    expect(await SEC().findByRole('alert')).toHaveTextContent(e.evaluatieOpslaanFout)
    expect(document.body.textContent).not.toMatch(/RAW_DB_DETAIL|XX000/)
    expect(evRij(db)[0].rpe).toBe(5)
    expect(geselecteerdeRpe()).toEqual([5]) // terug naar de oude waarde
    unmount()
    await openEvent(EV.past)
    expect(geselecteerdeRpe()).toEqual([5])
    // opnieuw proberen lukt zodra de fout weg is
    kapot = false
    fireEvent.click(rpeKnop(8))
    await waitFor(() => expect(evRij(db)[0].rpe).toBe(8))
    expect(h.writes).toHaveLength(2)
  })

  it('AC-R.4: de serverfout bevat nooit de ruwe databasetekst', async () => {
    setup(eventDb(), { writeErrors: { training_evaluaties: () => ({ code: '42501', message: 'new row violates row-level security policy RAW_RLS' }) } })
    const fout = await saveTrainingRpe(EV.past, 6).catch((x: Error) => x)
    expect(fout).toBeInstanceOf(Error)
    expect((fout as Error).message).toBe(GENERIC_ERROR_MESSAGE)
  })
})

describe('AC-R.5 — ongeldige RPE geweigerd, niets opgeslagen', () => {
  it.each([[0], [11], [-1], [5.5], ['5'], [NaN], [null], [undefined], [Infinity], [10.0000001]])(
    'AC-R.5: RPE %s -> "Ongeldige RPE", geen enkele database-aanroep, niets opgeslagen',
    async (waarde) => {
      const db = eventDb()
      const h = setup(db)
      await expect(saveTrainingRpe(EV.past, waarde as never)).rejects.toThrow('Ongeldige RPE')
      expect(h.writes).toEqual([])
      expect(db.training_evaluaties).toEqual([])
    },
  )

  it('AC-R.5: ongeldig event-id (geen uuid) wordt geweigerd zonder opslag', async () => {
    const db = eventDb()
    const h = setup(db)
    await expect(saveTrainingRpe('niet-een-uuid', 5)).rejects.toThrow('Ongeldige RPE')
    expect(h.writes).toEqual([])
  })
})

describe('AC-R.6 / AC-O.5 (R4) — zonder recht "training" alleen lezen; assistent met alleen Spelers + Aanwezigheid kan niets', () => {
  const ZONDER_TRAINING = assistent({ mag_spelers_bewerken: true, mag_aanwezigheid_bewerken: true, mag_agenda_bewerken: true })

  it('AC-R.6 / O.5: lezer ziet RPE en oordeel als tekst, zonder knoppen of velden', async () => {
    const db = eventDb({ team_members: ZONDER_TRAINING as Row[], training_evaluaties: [stamEv(EV.past, 7, 'deels')] })
    setup(db, { userId: 'user-a' })
    await openEvent(EV.past)
    expect(SEC().getByText(`${e.rpeWaarde.replace('{n}', '7')} · ${(e.rpeAnkers as Record<string, string>)['7']}`)).toBeInTheDocument()
    expect(SEC().getByText(e.oordeelDeels)).toBeInTheDocument()
    expect(SEC().queryAllByRole('button')).toHaveLength(0)
    expect(SEC().queryAllByRole('textbox')).toHaveLength(0)
  })

  it('AC-R.6 / O.5: lezer zonder waarden ziet "Nog geen RPE" en "Nog geen oordeel"', async () => {
    setup(eventDb({ team_members: ZONDER_TRAINING as Row[] }), { userId: 'user-a' })
    await openEvent(EV.past)
    expect(SEC().getByText(e.rpeNietIngevuld)).toBeInTheDocument()
    expect(SEC().getByText(e.oordeelNietIngevuld)).toBeInTheDocument()
    expect(SEC().queryAllByRole('button')).toHaveLength(0)
  })

  it('AC-R.6 / O.5 / R4: alle zes server-acties weigeren zonder recht "training" ("Geen toegang"), ook met Spelers + Aanwezigheid; niets verandert, geen enkele schrijfactie', async () => {
    const bestaand = stamEv(EV.past, 7, 'deels')
    const db = eventDb({ team_members: ZONDER_TRAINING as Row[], training_evaluaties: [bestaand] })
    const h = setup(db, { userId: 'user-a' })
    const rpeSnap: HerstelTrainingRpe = { soort: 'training_rpe', teamId: TEAM, eventId: EV.past2, rpe: 5 }
    const oordeelSnap: HerstelTrainingOordeel = { soort: 'training_oordeel', teamId: TEAM, eventId: EV.past2, oordeel: 'ja' }
    await expect(saveTrainingRpe(EV.past, 3)).rejects.toThrow('Geen toegang')
    await expect(saveTrainingRpe(EV.past2, 3)).rejects.toThrow('Geen toegang')
    await expect(wisTrainingRpe(EV.past)).rejects.toThrow('Geen toegang')
    await expect(herstelTrainingRpe(rpeSnap)).rejects.toThrow('Geen toegang')
    await expect(saveTrainingOordeel(EV.past, 'nee')).rejects.toThrow('Geen toegang')
    await expect(wisTrainingOordeel(EV.past)).rejects.toThrow('Geen toegang')
    await expect(herstelTrainingOordeel(oordeelSnap)).rejects.toThrow('Geen toegang')
    expect(h.writes).toEqual([])
    expect(db.training_evaluaties).toEqual([bestaand])
  })

  it('AC-R.6 / R4: een assistent MET mag_training_bewerken (zonder Spelers/Aanwezigheid) mag RPE én oordeel opslaan; de rij krijgt het team-id (niet het user-id)', async () => {
    const db = eventDb({ team_members: assistent({ mag_training_bewerken: true }) as Row[] })
    setup(db, { userId: 'user-a' })
    await openEvent(EV.past)
    fireEvent.click(rpeKnop(6))
    await waitFor(() => expect(evRij(db)[0]?.rpe).toBe(6))
    fireEvent.click(oordeelKnop('ja'))
    await waitFor(() => expect(evRij(db)[0]?.oordeel).toBe('ja'))
    expect(evRij(db)).toHaveLength(1)
    expect(evRij(db)[0]).toMatchObject({ team_id: TEAM, rpe: 6, oordeel: 'ja' })
  })
})

describe('AC-R.7 / AC-O.2 (R8) — corrigeren, wissen en ongedaan maken', () => {
  it('AC-R.7: wissen zet alleen de RPE op null (rij blijft, nooit een delete); de toast biedt "Ongedaan maken" en herstelt', async () => {
    const rij = stamEv(EV.past, 6, null)
    const db = eventDb({ training_evaluaties: [rij] })
    const h = setup(db)
    await openEvent(EV.past)
    fireEvent.click(SEC().getByRole('button', { name: e.rpeWissen }))
    await waitFor(() => expect(evRij(db)[0].rpe).toBeNull())
    expect(evRij(db)).toHaveLength(1)
    expect(h.writes.map((w) => w.op)).not.toContain('delete')
    await waitFor(() => expect(geselecteerdeRpe()).toEqual([]))
    expect(SEC().queryByRole('button', { name: e.rpeWissen })).toBeNull() // geen waarde, geen wisknop

    fireEvent.click(await screen.findByRole('button', { name: nl.undo.action }))
    await waitFor(() => expect(evRij(db)[0].rpe).toBe(6))
    expect(evRij(db)).toHaveLength(1)
    expect(evRij(db)[0].id).toBe(rij.id)
    await waitFor(() => expect(geselecteerdeRpe()).toEqual([6]))
  })

  it('AC-O.2: oordeel wissen -> "geen oordeel" (rij blijft, RPE blijft); undo zet het terug', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, 6, 'deels')] })
    const h = setup(db)
    await openEvent(EV.past)
    fireEvent.click(SEC().getByRole('button', { name: e.oordeelWissen }))
    await waitFor(() => expect(evRij(db)[0].oordeel).toBeNull())
    expect(evRij(db)[0].rpe).toBe(6)
    expect(h.writes.map((w) => w.op)).not.toContain('delete')
    await waitFor(() => expect(geselecteerdOordeel()).toEqual([]))
    fireEvent.click(await screen.findByRole('button', { name: nl.undo.action }))
    await waitFor(() => expect(evRij(db)[0].oordeel).toBe('deels'))
    expect(evRij(db)[0].rpe).toBe(6)
    await waitFor(() => expect(geselecteerdOordeel()).toEqual(['deels']))
  })

  it('AC-R.7: "Ongedaan maken" overschrijft nooit een intussen opgeslagen waarde (RPE)', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, 6, null)] })
    setup(db)
    const herstel = await wisTrainingRpe(EV.past)
    expect(herstel).toEqual({ soort: 'training_rpe', teamId: TEAM, eventId: EV.past, rpe: 6 })
    await saveTrainingRpe(EV.past, 9)
    await expect(herstelTrainingRpe(herstel)).resolves.toBeUndefined()
    expect(evRij(db)).toHaveLength(1)
    expect(evRij(db)[0].rpe).toBe(9) // nieuwere waarde wint
  })

  it('AC-O.2: "Ongedaan maken" overschrijft nooit een intussen opgeslagen oordeel', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, null, 'ja')] })
    setup(db)
    const herstel = await wisTrainingOordeel(EV.past)
    expect(herstel).toEqual({ soort: 'training_oordeel', teamId: TEAM, eventId: EV.past, oordeel: 'ja' })
    await saveTrainingOordeel(EV.past, 'nee')
    await expect(herstelTrainingOordeel(herstel)).resolves.toBeUndefined()
    expect(evRij(db)[0].oordeel).toBe('nee')
  })

  it('AC-R.7: herstel zet de RPE terug zonder het (intussen opgeslagen) oordeel aan te raken', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, 6, null)] })
    setup(db)
    const herstel = await wisTrainingRpe(EV.past)
    await saveTrainingOordeel(EV.past, 'deels') // rij met rpe null + oordeel
    await herstelTrainingRpe(herstel)
    expect(evRij(db)[0]).toMatchObject({ rpe: 6, oordeel: 'deels' })
  })

  it('AC-R.7: herstel zonder bestaande rij maakt de rij opnieuw aan', async () => {
    const db = eventDb()
    setup(db)
    await herstelTrainingRpe({ soort: 'training_rpe', teamId: TEAM, eventId: EV.past, rpe: 4 })
    expect(evRij(db)).toHaveLength(1)
    expect(evRij(db)[0]).toMatchObject({ team_id: TEAM, rpe: 4, oordeel: null })
  })

  it('AC-R.7: race — de rij ontstaat tussen lezen en insert (23505): een intussen opgeslagen RPE blijft staan', async () => {
    const db = eventDb()
    const h = setup(db)
    let gedaan = false
    h.voorSchrijf = (op, table, d) => {
      if (gedaan || op !== 'insert' || table !== 'training_evaluaties') return
      gedaan = true
      d.training_evaluaties.push(stamEv(EV.past, 9, null)) // concurrerende schrijver
    }
    await expect(herstelTrainingRpe({ soort: 'training_rpe', teamId: TEAM, eventId: EV.past, rpe: 4 })).resolves.toBeUndefined()
    expect(gedaan).toBe(true)
    expect(evRij(db)).toHaveLength(1)
    expect(evRij(db)[0].rpe).toBe(9)
  })

  it('AC-R.7: race — de concurrerende rij heeft alleen een oordeel (RPE leeg): herstel vult de RPE en laat het oordeel staan', async () => {
    const db = eventDb()
    const h = setup(db)
    let gedaan = false
    h.voorSchrijf = (op, table, d) => {
      if (gedaan || op !== 'insert' || table !== 'training_evaluaties') return
      gedaan = true
      d.training_evaluaties.push(stamEv(EV.past, null, 'nee'))
    }
    await herstelTrainingRpe({ soort: 'training_rpe', teamId: TEAM, eventId: EV.past, rpe: 4 })
    expect(evRij(db)).toHaveLength(1)
    expect(evRij(db)[0]).toMatchObject({ rpe: 4, oordeel: 'nee' })
  })

  it('AC-R.7: wissen terwijl de waarde intussen is gewijzigd raakt niets en meldt "RPE niet gevonden"', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, 6, null)] })
    const h = setup(db)
    let gedaan = false
    h.voorSchrijf = (op, table, d) => {
      if (gedaan || op !== 'update' || table !== 'training_evaluaties') return
      gedaan = true
      d.training_evaluaties[0].rpe = 8 // een ander apparaat was net sneller
    }
    await expect(wisTrainingRpe(EV.past)).rejects.toThrow('RPE niet gevonden')
    expect(evRij(db)[0].rpe).toBe(8)
  })

  it('AC-R.7: wissen zonder waarde -> "RPE niet gevonden" / "Oordeel niet gevonden"; geen rij of lege kolom raakt niets', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past2, null, 'ja')] })
    const h = setup(db)
    await expect(wisTrainingRpe(EV.past)).rejects.toThrow('RPE niet gevonden') // geen rij
    await expect(wisTrainingRpe(EV.past2)).rejects.toThrow('RPE niet gevonden') // rij zonder RPE
    await expect(wisTrainingOordeel(EV.past)).rejects.toThrow('Oordeel niet gevonden')
    expect(h.writes).toEqual([])
  })

  it('AC-R.7 / O.2: een falende wis zet de waarde terug en toont "Verwijderen is mislukt"; de database houdt de waarde', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, 6, null)] })
    setup(db, { writeErrors: { training_evaluaties: (op) => (op === 'update' ? { code: 'XX000', message: 'RAW_DEL' } : null) } })
    await openEvent(EV.past)
    fireEvent.click(SEC().getByRole('button', { name: e.rpeWissen }))
    expect(await SEC().findByRole('alert')).toHaveTextContent(nl.undo.deleteError)
    expect(evRij(db)[0].rpe).toBe(6)
    expect(geselecteerdeRpe()).toEqual([6])
    expect(document.body.textContent).not.toContain('RAW_DEL')
  })
})

describe('AC-R.9 / AC-O.9 — RPE opslaan wist het oordeel niet en omgekeerd; oordeel wijzigt de doelstelling niet', () => {
  it('AC-R.9: RPE opslaan laat het bestaande oordeel staan (database én scherm, ook na herladen)', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, null, 'deels')] })
    const h = setup(db)
    const { unmount } = await openEvent(EV.past)
    fireEvent.click(rpeKnop(7))
    await waitFor(() => expect(evRij(db)[0].rpe).toBe(7))
    expect(evRij(db)[0].oordeel).toBe('deels')
    expect(geselecteerdOordeel()).toEqual(['deels'])
    expect(h.writes[0].payload).not.toHaveProperty('oordeel')
    unmount()
    await openEvent(EV.past)
    expect(geselecteerdeRpe()).toEqual([7])
    expect(geselecteerdOordeel()).toEqual(['deels'])
  })

  it('AC-R.9: oordeel opslaan laat de bestaande RPE staan (database én scherm, ook na herladen)', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, 6, null)] })
    const h = setup(db)
    const { unmount } = await openEvent(EV.past)
    fireEvent.click(oordeelKnop('nee'))
    await waitFor(() => expect(evRij(db)[0].oordeel).toBe('nee'))
    expect(evRij(db)[0].rpe).toBe(6)
    expect(h.writes[0].payload).not.toHaveProperty('rpe')
    unmount()
    await openEvent(EV.past)
    expect(geselecteerdeRpe()).toEqual([6])
    expect(geselecteerdOordeel()).toEqual(['nee'])
  })

  it('AC-R.9: wissen van de RPE laat het oordeel staan en wissen van het oordeel laat de RPE staan', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, 6, 'deels')] })
    setup(db)
    await wisTrainingRpe(EV.past)
    expect(evRij(db)[0]).toMatchObject({ rpe: null, oordeel: 'deels' })
    await saveTrainingRpe(EV.past, 3)
    await wisTrainingOordeel(EV.past)
    expect(evRij(db)[0]).toMatchObject({ rpe: 3, oordeel: null })
  })

  it('AC-R.9 / O.9: beide waarden in één rij, in willekeurige volgorde opgeslagen, blijven allebei staan', async () => {
    const db = eventDb()
    setup(db)
    await saveTrainingOordeel(EV.past, 'ja')
    await saveTrainingRpe(EV.past, 8)
    await saveTrainingOordeel(EV.past, 'deels')
    await saveTrainingRpe(EV.past, 2)
    expect(evRij(db)).toHaveLength(1)
    expect(evRij(db)[0]).toMatchObject({ rpe: 2, oordeel: 'deels' })
  })

  it('AC-O.9: een oordeel opslaan wijzigt de doelstellingstekst niet en schrijft niet naar events', async () => {
    const db = eventDb()
    const h = setup(db)
    await saveTrainingOordeel(EV.past, 'ja')
    expect(db.events.find((x) => x.id === EV.past)!.doelstelling).toBe('Passen verbeteren')
    expect(h.writes.every((w) => w.table === 'training_evaluaties')).toBe(true)
  })
})

describe('AC-O.1 — oordeel ja/deels/nee: direct zichtbaar en blijft na herladen', () => {
  it.each([['ja'], ['deels'], ['nee']] as const)('AC-O.1: "%s" kiezen -> rij in de database, direct zichtbaar, na herladen nog gekozen', async (waarde) => {
    const db = eventDb()
    setup(db)
    const { unmount } = await openEvent(EV.past)
    expect(geselecteerdOordeel()).toEqual([])
    fireEvent.click(oordeelKnop(waarde))
    expect(oordeelKnop(waarde)).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(evRij(db)).toHaveLength(1))
    expect(evRij(db)[0]).toMatchObject({ team_id: TEAM, event_id: EV.past, oordeel: waarde })
    unmount()
    await openEvent(EV.past)
    expect(geselecteerdOordeel()).toEqual([waarde])
  })

  it('AC-O.1 / O.2: opnieuw kiezen overschrijft (één oordeel, dezelfde rij)', async () => {
    const rij = stamEv(EV.past, null, 'ja')
    const db = eventDb({ training_evaluaties: [rij] })
    setup(db)
    await openEvent(EV.past)
    fireEvent.click(oordeelKnop('nee'))
    await waitFor(() => expect(evRij(db)[0].oordeel).toBe('nee'))
    expect(evRij(db)).toHaveLength(1)
    expect(evRij(db)[0].id).toBe(rij.id)
    expect(geselecteerdOordeel()).toEqual(['nee'])
  })
})

describe('AC-O.3 (R5.2) — oordeel alleen bij een niet-lege doelstelling; anders geen veld, met uitleg', () => {
  it.each([['leeg (geen tekst)', EV.leeg], ['alleen spaties', EV.spaties]])(
    'AC-O.3: training met doelstelling %s -> geen oordeelknoppen, wel de uitleg; de RPE is wel invulbaar',
    async (_naam, id) => {
      setup(eventDb())
      await openEvent(id)
      for (const o of ['ja', 'deels', 'nee'] as const) expect(SEC().queryByRole('button', { name: OORDEEL_NAAM[o] })).toBeNull()
      expect(SEC().getByText(e.oordeelGeenDoelstelling)).toBeInTheDocument()
      expect(rpeKnop(5)).toBeInTheDocument()
    },
  )

  it('AC-O.3 (trim): de server weigert een oordeel bij een lege doelstelling of alleen spaties ("Geen doelstelling"), niets opgeslagen', async () => {
    const db = eventDb()
    const h = setup(db)
    await expect(saveTrainingOordeel(EV.leeg, 'ja')).rejects.toThrow('Geen doelstelling')
    await expect(saveTrainingOordeel(EV.spaties, 'ja')).rejects.toThrow('Geen doelstelling')
    expect(h.writes).toEqual([])
    expect(db.training_evaluaties).toEqual([])
  })

  it('AC-O.3: bij een niet-lege doelstelling wordt de tekst getoond als context en zijn de drie keuzes er', async () => {
    setup(eventDb())
    await openEvent(EV.past)
    expect(SEC().getByText('Passen verbeteren')).toBeInTheDocument() // O3
    expect(SEC().getByText(e.oordeelLabel)).toBeInTheDocument()
    expect(SEC().queryByText(e.oordeelGeenDoelstelling)).toBeNull()
    for (const o of ['ja', 'deels', 'nee'] as const) expect(oordeelKnop(o)).toBeInTheDocument()
  })

  it('AC-O.3: een oordeel opslaan zonder doelstelling schrijft niets, ook niet zonder rij (RPE blijft wel mogelijk)', async () => {
    const db = eventDb()
    setup(db)
    await saveTrainingRpe(EV.leeg, 5)
    expect(db.training_evaluaties).toHaveLength(1)
    await expect(saveTrainingOordeel(EV.leeg, 'deels')).rejects.toThrow('Geen doelstelling')
    expect(db.training_evaluaties[0].oordeel).toBeNull()
  })
})

describe('AC-O.4 — mislukte oordeel-opslag: melding en oude waarde; waarde buiten ja/deels/nee geweigerd', () => {
  it('AC-O.4: databasefout -> melding, oude keuze blijft (database en selectie), geen ruwe tekst', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, null, 'ja')] })
    setup(db, { writeErrors: { training_evaluaties: () => ({ code: 'XX000', message: 'RAW_O' }) } })
    await openEvent(EV.past)
    fireEvent.click(oordeelKnop('nee'))
    expect(await SEC().findByRole('alert')).toHaveTextContent(e.evaluatieOpslaanFout)
    expect(evRij(db)[0].oordeel).toBe('ja')
    expect(geselecteerdOordeel()).toEqual(['ja'])
    expect(document.body.textContent).not.toContain('RAW_O')
  })

  it.each([['misschien'], ['Ja'], [''], ['JA'], [null], [undefined], [1], [true]])(
    'AC-O.4: oordeel %s -> "Ongeldig oordeel", geen aanroep, niets opgeslagen',
    async (waarde) => {
      const db = eventDb()
      const h = setup(db)
      await expect(saveTrainingOordeel(EV.past, waarde as never)).rejects.toThrow('Ongeldig oordeel')
      expect(h.writes).toEqual([])
      expect(db.training_evaluaties).toEqual([])
    },
  )

  it('AC-O.4: de serverfout bevat nooit de ruwe databasetekst', async () => {
    setup(eventDb(), { writeErrors: { training_evaluaties: () => ({ code: '42501', message: 'RAW_RLS_O' }) } })
    const fout = await saveTrainingOordeel(EV.past, 'ja').catch((x: Error) => x)
    expect((fout as Error).message).toBe(GENERIC_ERROR_MESSAGE)
  })
})

describe('AC-O.6 (R5.1) — achteraf gewiste doelstellingstekst: het oordeel blijft staan, alleen-lezen met wisknop', () => {
  it('AC-O.6: oordeel bij een inmiddels lege doelstelling blijft zichtbaar (alleen-lezen) met uitleg en wisknop; geen nieuwe keuze mogelijk', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.leeg, 6, 'deels')] })
    setup(db)
    await openEvent(EV.leeg)
    expect(SEC().getByText(e.oordeelDeels)).toBeInTheDocument()
    expect(SEC().getByText(e.oordeelZonderDoelstelling)).toBeInTheDocument()
    for (const o of ['ja', 'deels', 'nee'] as const) expect(SEC().queryByRole('button', { name: OORDEEL_NAAM[o] })).toBeNull()
    expect(SEC().getByRole('button', { name: e.oordeelWissen })).toBeInTheDocument()
    expect(evRij(db, EV.leeg)[0].oordeel).toBe('deels') // de database wijzigde niet
  })

  it('AC-O.6: hetzelfde bij een doelstelling van alleen spaties', async () => {
    setup(eventDb({ training_evaluaties: [stamEv(EV.spaties, null, 'ja')] }))
    await openEvent(EV.spaties)
    expect(SEC().getByText(e.oordeelZonderDoelstelling)).toBeInTheDocument()
    expect(SEC().queryByRole('button', { name: OORDEEL_NAAM.nee })).toBeNull()
  })

  it('AC-O.6: wissen mag ook zonder doelstelling (de rij blijft, de RPE blijft)', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.leeg, 6, 'deels')] })
    setup(db)
    await openEvent(EV.leeg)
    fireEvent.click(SEC().getByRole('button', { name: e.oordeelWissen }))
    await waitFor(() => expect(evRij(db, EV.leeg)[0].oordeel).toBeNull())
    expect(evRij(db, EV.leeg)[0].rpe).toBe(6)
    await waitFor(() => expect(SEC().getByText(e.oordeelGeenDoelstelling)).toBeInTheDocument())
  })

  describe.each([
    ['null', null],
    ["'' (leeg)", ''],
    ["'   ' (spaties)", '   '],
  ])('AC-O.6 / O.2 / R8 — doelstelling achteraf %s: wissen en ongedaan maken', (_naam, doel) => {
    const dbMetLegeDoel = () => {
      const db = eventDb({ training_evaluaties: [stamEv(EV.leeg, 6, 'deels')] })
      db.events.find((x) => x.id === EV.leeg)!.doelstelling = doel
      return db
    }

    it('AC-O.6 / O.2: oordeel wissen en dan "Ongedaan maken": het oordeel staat weer in de database en op het scherm, ook na herladen; de RPE blijft', async () => {
      const db = dbMetLegeDoel()
      setup(db)
      const { unmount } = await openEvent(EV.leeg)
      expect(SEC().getByText(e.oordeelDeels)).toBeInTheDocument()
      fireEvent.click(SEC().getByRole('button', { name: e.oordeelWissen }))
      await waitFor(() => expect(evRij(db, EV.leeg)[0].oordeel).toBeNull())
      await waitFor(() => expect(SEC().queryByText(e.oordeelDeels)).toBeNull())
      fireEvent.click(await screen.findByRole('button', { name: nl.undo.action }))
      await waitFor(() => expect(evRij(db, EV.leeg)[0].oordeel).toBe('deels'))
      expect(evRij(db, EV.leeg)).toHaveLength(1)
      expect(evRij(db, EV.leeg)[0].rpe).toBe(6)
      await waitFor(() => expect(SEC().getByText(e.oordeelDeels)).toBeInTheDocument())
      expect(screen.queryByText(nl.undo.restoreError)).toBeNull()
      unmount()
      await openEvent(EV.leeg) // herladen
      expect(SEC().getByText(e.oordeelDeels)).toBeInTheDocument()
      expect(SEC().getByText(e.oordeelZonderDoelstelling)).toBeInTheDocument()
      expect(geselecteerdeRpe()).toEqual([6])
    })

    it('AC-O.2 / R8: het herstel overschrijft nooit een intussen nieuwer oordeel', async () => {
      const db = dbMetLegeDoel()
      setup(db)
      const herstel = await wisTrainingOordeel(EV.leeg)
      expect(herstel).toEqual({ soort: 'training_oordeel', teamId: TEAM, eventId: EV.leeg, oordeel: 'deels' })
      evRij(db, EV.leeg)[0].oordeel = 'nee' // een ander apparaat zette intussen een nieuw oordeel
      await expect(herstelTrainingOordeel(herstel)).resolves.toBeUndefined()
      expect(evRij(db, EV.leeg)[0]).toMatchObject({ oordeel: 'nee', rpe: 6 })
    })

    it('AC-O.2: herstel zonder bestaande rij maakt de rij opnieuw aan, ook zonder doelstelling', async () => {
      const db = dbMetLegeDoel()
      db.training_evaluaties.length = 0
      setup(db)
      await herstelTrainingOordeel({ soort: 'training_oordeel', teamId: TEAM, eventId: EV.leeg, oordeel: 'ja' })
      expect(evRij(db, EV.leeg)).toHaveLength(1)
      expect(evRij(db, EV.leeg)[0]).toMatchObject({ team_id: TEAM, oordeel: 'ja', rpe: null })
    })

    it('AC-O.3 (blijft): NIEUW opslaan van een oordeel zonder doelstelling wordt wel geweigerd ("Geen doelstelling"), niets geschreven', async () => {
      const db = dbMetLegeDoel()
      const h = setup(db)
      await expect(saveTrainingOordeel(EV.leeg, 'ja')).rejects.toThrow('Geen doelstelling')
      expect(h.writes).toEqual([])
      expect(evRij(db, EV.leeg)[0].oordeel).toBe('deels')
    })
  })
})

describe('AC-O.7 (R3) — geen RPE of oordeel voor wedstrijden', () => {
  it('AC-O.7: de wedstrijdpagina heeft geen evaluatiesectie', async () => {
    setup(eventDb())
    await openEvent(EV.match)
    expect(screen.queryByRole('region', { name: e.evaluatieTitel })).toBeNull()
    expect(screen.queryByText(e.rpeLabel)).toBeNull()
  })

  it('AC-O.7: de server weigert RPE en oordeel voor een wedstrijd ("Event niet gevonden"), niets opgeslagen', async () => {
    const db = eventDb()
    const h = setup(db)
    await expect(saveTrainingRpe(EV.match, 5)).rejects.toThrow('Event niet gevonden')
    await expect(saveTrainingOordeel(EV.match, 'ja')).rejects.toThrow('Event niet gevonden')
    expect(h.writes).toEqual([])
  })
})

describe('AC-R.11 (O2) — eigen sectie onderaan de linkerkolom van de trainingspagina, na de notities', () => {
  it('AC-R.11: de sectie staat op de trainingspagina na de notitie en vóór de aanwezigheidskolom, met kop en uitleg', async () => {
    setup(eventDb())
    await openEvent(EV.past)
    const sectie = screen.getByRole('region', { name: e.evaluatieTitel })
    expect(SEC().getByRole('heading', { name: e.evaluatieTitel })).toBeInTheDocument()
    expect(SEC().getByText(e.evaluatieUitleg)).toBeInTheDocument()
    const notitie = screen.getByText('Een notitie').closest('.surface-card')!
    expect(notitie.compareDocumentPosition(sectie) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // laatste element van de linkerkolom
    expect(sectie.parentElement!.lastElementChild).toBe(sectie)
    expect(sectie.parentElement!.contains(notitie)).toBe(true)
    // de aanwezigheidskolom staat in een andere kolom
    expect(sectie.parentElement!.contains(screen.getByText('Piet Peters'))).toBe(false)
  })

  it('AC-R.11 / A11: de uitleg zegt dat de cijfers vanaf morgen op Inzichten staan', () => {
    expect(e.evaluatieUitleg).toMatch(/vanaf morgen/)
    expect(e.evaluatieUitleg).toMatch(/Inzichten/)
  })

  it('AC-R.11: het label en de uitleg van de RPE (schaal 1 tot 10, inschatting voor de groep)', async () => {
    setup(eventDb())
    await openEvent(EV.past)
    expect(SEC().getByText(e.rpeLabel)).toBeInTheDocument()
    expect(SEC().getByText(e.rpeUitleg)).toBeInTheDocument()
  })
})

describe('AC-A2 (trainingspagina) — tenant-isolatie', () => {
  it('AC-A2: opslaan, wissen en herstellen voor een training van een ander team wordt geweigerd; de vreemde rij blijft ongemoeid', async () => {
    const vreemd = stamEv(EV.other, 9, 'ja', { team_id: OTHER })
    const db = eventDb({ training_evaluaties: [vreemd] })
    const h = setup(db)
    await expect(saveTrainingRpe(EV.other, 3)).rejects.toThrow('Event niet gevonden')
    await expect(saveTrainingOordeel(EV.other, 'nee')).rejects.toThrow('Event niet gevonden')
    await expect(wisTrainingRpe(EV.other)).rejects.toThrow('RPE niet gevonden')
    await expect(wisTrainingOordeel(EV.other)).rejects.toThrow('Oordeel niet gevonden')
    await expect(herstelTrainingRpe({ soort: 'training_rpe', teamId: TEAM, eventId: EV.other, rpe: 3 })).rejects.toThrow(HERSTEL_FOUT)
    await expect(herstelTrainingOordeel({ soort: 'training_oordeel', teamId: TEAM, eventId: EV.other, oordeel: 'nee' })).rejects.toThrow(HERSTEL_FOUT)
    expect(h.writes).toEqual([])
    expect(db.training_evaluaties).toEqual([vreemd])
  })

  it('AC-A2: herstel met een vreemd teamId in de snapshot wordt geweigerd', async () => {
    const db = eventDb()
    const h = setup(db)
    await expect(herstelTrainingRpe({ soort: 'training_rpe', teamId: OTHER, eventId: EV.past, rpe: 3 })).rejects.toThrow(HERSTEL_FOUT)
    await expect(herstelTrainingOordeel({ soort: 'training_oordeel', teamId: OTHER, eventId: EV.past, oordeel: 'ja' })).rejects.toThrow(HERSTEL_FOUT)
    expect(h.writes).toEqual([])
  })

  it('AC-A2: herstel met een verkeerde soort of ongeldige waarde in de snapshot wordt geweigerd', async () => {
    const h = setup(eventDb())
    await expect(herstelTrainingRpe({ soort: 'training_oordeel', teamId: TEAM, eventId: EV.past, rpe: 3 } as never)).rejects.toThrow(HERSTEL_FOUT)
    await expect(herstelTrainingRpe({ soort: 'training_rpe', teamId: TEAM, eventId: EV.past, rpe: 11 })).rejects.toThrow(HERSTEL_FOUT)
    await expect(herstelTrainingOordeel({ soort: 'training_oordeel', teamId: TEAM, eventId: EV.past, oordeel: 'misschien' as never })).rejects.toThrow(HERSTEL_FOUT)
    expect(h.writes).toEqual([])
  })

  it('AC-A2: een rij van team-2 op een eigen training wordt niet getoond (pagina filtert op team) en een vreemde training is niet te openen', async () => {
    const db = eventDb({ training_evaluaties: [stamEv(EV.past, 9, 'ja', { team_id: OTHER })] })
    setup(db)
    await openEvent(EV.past)
    expect(geselecteerdeRpe()).toEqual([])
    expect(geselecteerdOordeel()).toEqual([])
    cleanup()
    await expect(EventDetailPage({ params: Promise.resolve({ id: EV.other }) })).rejects.toThrow('__notFound__')
  })

  it('AC-A2: de rij die een assistent opslaat krijgt het team-id uit de context en nooit het user-id', async () => {
    const db = eventDb({ team_members: assistent({ mag_training_bewerken: true }) as Row[] })
    const h = setup(db, { userId: 'user-a' })
    await saveTrainingRpe(EV.past, 5)
    expect(h.writes[0].payload).toMatchObject({ team_id: TEAM })
    expect(JSON.stringify(db.training_evaluaties)).not.toContain('user-a')
  })
})

describe('AC-A13 — zonder migratie: trainingspagina bruikbaar, alleen de nieuwe invoer meldt', () => {
  it('AC-A13: leesfout op de evaluatietabel -> pagina rendert (aanwezigheid, plan, notitie), sectie toont "niet beschikbaar" zonder invoer en zonder ruwe tekst', async () => {
    setup(eventDb(), { selectErrors: { training_evaluaties: { code: 'PGRST205', message: 'RAW_TABEL_ONTBREEKT' } } })
    const { container } = await openEvent(EV.past)
    expect(SEC().getByText(e.evaluatieNietBeschikbaar)).toBeInTheDocument()
    expect(SEC().queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('Piet Peters')).toBeInTheDocument()
    expect(screen.getByText('Een notitie')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/RAW_TABEL_ONTBREEKT|PGRST205/)
  })

  it('AC-A13: dezelfde leesfout op een wedstrijdpagina geeft geen melding (query niet gebruikt)', async () => {
    setup(eventDb(), { selectErrors: { training_evaluaties: { code: 'PGRST205', message: 'RAW' } } })
    await openEvent(EV.match)
    expect(screen.queryByText(e.evaluatieNietBeschikbaar)).toBeNull()
  })
})

describe('AC-A6 / R.12 — teksten in 5 talen; ankerlabels bij 1, 3, 5, 7 en 10', () => {
  const ANKERS: Record<string, string[]> = {
    nl: ['zeer licht', 'gemiddeld', 'zwaar', 'zeer zwaar', 'maximaal'],
    en: ['very light', 'moderate', 'hard', 'very hard', 'maximal'],
    de: ['sehr leicht', 'mittel', 'schwer', 'sehr schwer', 'maximal'],
    es: ['muy ligero', 'moderado', 'duro', 'muy duro', 'máximo'],
    fr: ['très léger', 'modéré', 'difficile', 'très difficile', 'maximal'],
  }
  it.each(Object.keys(ANKERS))('R.12 (%s): precies vijf ankerlabels (1, 3, 5, 7, 10) in de juiste cellen; de aria-label van de knop bevat het anker', async (taal) => {
    setup(eventDb())
    await openEvent(EV.past, taal)
    const d = dicts[taal]
    const ankerNummers = [1, 3, 5, 7, 10]
    ankerNummers.forEach((n, idx) => {
      const knop = rpeKnop(n, d)
      expect(knop).toHaveAttribute('aria-label', `${d.event.rpeWaarde.replace('{n}', String(n))} – ${ANKERS[taal][idx]}`)
      // het anker staat in dezelfde cel als de knop
      const cel = knop.parentElement!
      expect(within(cel).getByText(ANKERS[taal][idx])).toBeInTheDocument()
      expect(within(cel).getByText(ANKERS[taal][idx])).toHaveAttribute('aria-hidden', 'true')
    })
    for (const n of [2, 4, 6, 8, 9]) {
      expect(rpeKnop(n, d)).toHaveAttribute('aria-label', d.event.rpeWaarde.replace('{n}', String(n)))
      expect(rpeKnop(n, d).parentElement!.querySelectorAll('span')).toHaveLength(0)
    }
    expect(SEC(d).getAllByText(/./, { selector: '[aria-hidden="true"]' }).filter((x) => ANKERS[taal].includes(x.textContent ?? ''))).toHaveLength(5)
  })

  it('A6 (nl/en/de/es/fr): alle nieuwe sleutels bestaan in elke taal, zijn niet leeg en (behalve gedeelde labels) vertaald; elk uniek binnen de eigen woordenlijst', () => {
    const EVENT_SLEUTELS = [
      'evaluatieTitel', 'evaluatieUitleg', 'rpeLabel', 'rpeUitleg', 'rpeWaarde', 'rpeNietIngevuld', 'rpeWissen', 'oordeelLabel',
      'oordeelNietIngevuld', 'oordeelWissen', 'oordeelGeenDoelstelling', 'oordeelZonderDoelstelling', 'evaluatieToekomst',
      'evaluatieNietBeschikbaar', 'evaluatieOpslaanFout',
    ] as const
    const INZICHT_SLEUTELS = [
      'srpeTitle', 'srpeDescription', 'srpeEmpty', 'srpeGrafiekLabel', 'kolomMetRpe', 'rpeDekking', 'kolomSrpe', 'srpeZonderRpe',
      'srpeZonderDuur', 'srpeOnvolledig', 'srpeMomentopname', 'srpeVolgendeDag', 'oordeelTitle', 'oordeelDescription', 'oordeelEmpty',
      'oordeelGeenDoelstellingen', 'kolomZonderOordeel', 'oordeelZonderUitleg', 'disciplineRpe', 'disciplineZonderRpe',
      'disciplineOordeel', 'disciplineZonderOordeel', 'disciplineGeenDoelstelling', 'disciplineEvaluatieFout',
    ] as const
    function waarden(obj: unknown, uit: string[] = []): string[] {
      if (typeof obj === 'string') uit.push(obj)
      else if (obj && typeof obj === 'object') for (const v of Object.values(obj)) waarden(v, uit)
      return uit
    }
    for (const [taal, d] of Object.entries(dicts)) {
      const alle = waarden(d)
      const aantal = (t: string) => alle.filter((x) => x === t).length
      for (const k of EVENT_SLEUTELS) {
        const v = (d.event as Record<string, unknown>)[k]
        expect(typeof v, `${taal} event.${k}`).toBe('string')
        expect((v as string).trim().length, `${taal} event.${k} leeg`).toBeGreaterThan(0)
        if (!['rpeWaarde'].includes(k)) expect(aantal(v as string), `${taal} event.${k} niet uniek`).toBe(1)
        if (taal !== 'nl' && !['rpeWaarde'].includes(k)) expect(v, `${taal} event.${k} niet vertaald`).not.toBe((nl.event as Record<string, unknown>)[k])
      }
      for (const k of INZICHT_SLEUTELS) {
        const v = (d.insights as Record<string, unknown>)[k]
        expect(typeof v, `${taal} insights.${k}`).toBe('string')
        expect((v as string).trim().length, `${taal} insights.${k} leeg`).toBeGreaterThan(0)
        // 'sRPE (AU)' is in en/de bewust een internationale term
        if (!['kolomSrpe'].includes(k)) expect(aantal(v as string), `${taal} insights.${k} niet uniek`).toBe(1)
        if (taal !== 'nl' && !['kolomSrpe'].includes(k)) expect(v, `${taal} insights.${k} niet vertaald`).not.toBe((nl.insights as Record<string, unknown>)[k])
      }
      // Ja/Deels/Nee: bewust gelijk aan kolomJa/Deels/Nee (afwijking 2), maar wel gevuld en onderling verschillend.
      expect(new Set([d.event.oordeelJa, d.event.oordeelDeels, d.event.oordeelNee]).size).toBe(3)
      expect([d.event.oordeelJa, d.event.oordeelDeels, d.event.oordeelNee]).toEqual([d.insights.kolomJa, d.insights.kolomDeels, d.insights.kolomNee])
      expect(Object.keys(d.event.rpeAnkers as object).sort()).toEqual(['1', '10', '3', '5', '7'])
    }
  })

  it('A6: de drie titels (sectie, sRPE-kaart, oordeelkaart) komen elk precies één keer voor als kop in alle 5 talen', () => {
    for (const d of Object.values(dicts)) {
      const titels = [d.event.evaluatieTitel, d.insights.srpeTitle, d.insights.oordeelTitle]
      expect(new Set(titels).size).toBe(3)
    }
  })
})

describe('AC-A7 / AC-A8 / K.9 — tokens, geen oordeelskleur, geen hex in de nieuwe componenten', () => {
  it.each(['components/TrainingEvaluatieSectie.tsx', 'components/inzichten/SrpeKaart.tsx', 'components/inzichten/DoelstellingOordeelKaart.tsx'])(
    'AC-A7: %s bevat geen #hex-kleur (alleen tokens)',
    (pad) => {
      const bron = readFileSync(join(process.cwd(), pad), 'utf8')
      expect(bron).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(bron).not.toMatch(/\b(rgb|hsl)a?\(/)
    },
  )

  it('AC-A8 / K.9: een geselecteerde keuze is altijd var(--primary), voor ja, deels én nee en voor elke RPE (geen kleur per uitkomst)', async () => {
    for (const o of ['ja', 'deels', 'nee'] as const) {
      setup(eventDb({ training_evaluaties: [stamEv(EV.past, 5, o)] }))
      await openEvent(EV.past)
      const stijl = oordeelKnop(o).getAttribute('style') ?? ''
      expect(stijl).toContain('var(--primary)')
      expect(stijl).not.toMatch(/success|danger|warning|red|green|amber/)
      expect(rpeKnop(5).getAttribute('style')).toContain('var(--primary)')
      cleanup()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// DEEL B — /inzichten (echte pagina, nagebootste RPC's op args.p_team_id)
// ═══════════════════════════════════════════════════════════════════════
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
const SRPE = (d: Dict = nl) => kaart(d.insights.srpeTitle)
const OORDEEL = (d: Dict = nl) => kaart(d.insights.oordeelTitle)
const DIS = (d: Dict = nl) => kaart(d.insights.disciplineTitle)
const BEL = (d: Dict = nl) => kaart(d.insights.belastingTitle)

interface WeekRij { label: string; deelweek: boolean; cellen: string[] }
function weekRijen(k: HTMLElement): WeekRij[] {
  return within(k).getAllByRole('rowheader').map((th) => ({
    label: th.childNodes[0]?.textContent ?? '',
    deelweek: th.querySelector('span') !== null,
    cellen: [...th.closest('tr')!.querySelectorAll('td')].map((td) => td.textContent ?? ''),
  }))
}
const wk = (rijen: WeekRij[], week: number): WeekRij => {
  const r = rijen.find((x) => x.label.startsWith(`wk ${week} · `))
  if (!r) throw new Error(`week ${week} niet gevonden in ${rijen.map((x) => x.label).join(' | ')}`)
  return r
}
const calls = (h: Harness, name: string) => h.rpcCalls.filter((c) => c.name === name)
const dtTeksten = (k: HTMLElement) => [...k.querySelectorAll('dt')].map((x) => x.textContent ?? '')
const dekking = (x: number, y: number) => fmt(i.rpeDekking, { x, y })

// De conclusielaag (KPI-strook en signalen) krijgt eigen tests; deze vergelijking
// gaat alleen over de kaarten. Op het scherm draagt de laag [data-conclusielaag],
// in het print-blok is het de .rapport-sectie met de signalen-kop.
const sluitConclusielaagUit = (klon: HTMLElement): void => {
  klon.querySelectorAll('[data-conclusielaag]').forEach((el) => el.remove())
  klon.querySelectorAll('[data-print-only] .rapport-sectie').forEach((sectie) => {
    if (sectie.querySelector('.rapport-sectiekop')?.textContent === nl.insights.signalenTitle) sectie.remove()
  })
}
function zonderKaarten(container: HTMLElement, titels: string[]): string {
  const kopie = container.cloneNode(true) as HTMLElement
  sluitConclusielaagUit(kopie)
  for (const titel of titels) {
    const h2 = [...kopie.querySelectorAll('h2')].find((x) => x.textContent === titel)
    h2?.closest('.surface-card')?.remove()
  }
  return kopie.innerHTML.replace(/recharts\d+-clip/g, 'recharts-clip').replace(/_r_[0-9a-z]+_/g, '_r_')
}
const NIEUWE_3B = [i.srpeTitle, i.oordeelTitle, i.disciplineTitle]

// ── Fixture sRPE (donderdag 2026-10-15; venster = seizoen t/m gisteren 2026-10-14) ──
// ISO-weken (ma-zo): wk 31 = ma 27 jul (deelweek: begint voor seizoensstart 1 aug) ... wk 42 = ma 12 okt (deelweek: eindigt na gisteren).
// Duur = planner-totaal (berekenTijdlijn, parallel = langste); sRPE = RPE x duur.
//  S15 25-08 wk35  RPE 6, GEEN koppelingen                       -> zonder duur; week blijft "geen gegevens" (niet 0)
//  S1  01-09 wk36  RPE 6, pg 60min, oordeel ja,   doel 'Passen'  -> 360
//  S2  03-09 wk36  RPE 4, pg 30min, oordeel deels, doel 'Druk'   -> 120
//  S3  06-09 wk36 (ZONDAG) geen RPE (rij van team-2 met RPE 10 moet genegeerd), doel 'Tempo', geen oordeel
//  S4  07-09 wk37 (MAANDAG) RPE 7, parallel pm20+pk30 (=30), oordeel nee, GEEN doelstelling (gewist, O1) -> 210
//  S5  09-09 wk37  RPE 5, geen koppelingen -> zonder duur; doel 'Conditie' geen oordeel
//  S6  15-09 wk38  RPE 8, wu(bib 10) + zd(nergens duur) -> 10 min met 1 blok zonder duur ('*') -> 80; doel '  '
//  S7  17-09 wk38  geen evaluatie-rij, pg 20min
//  S8  23-09 wk39  evaluatie-rij met rpe null en oordeel null (gewist), pg 30min, doel 'Passen'
//  (wk 40: geen trainingen)
//  S9  06-10 wk41  RPE 9, pg koppelingsduur 0 -> zonder duur
//  S10 08-10 wk41  RPE 3, pg 20 -> 60
//  S11 13-10 wk42  RPE 10, pg 40, oordeel ja, doel 'Pressing' -> 400
//  S14 14-10 wk42 (gisteren) RPE 2, pg 10 -> 20
//  S12 15-10 (VANDAAG) RPE 10 pg 99, oordeel ja; S13 20-10 (toekomst) RPE 10 pg 88   -> tellen NIET mee
//  M1  10-09 wedstrijd met evaluatie-rij (RPE 5)   -> telt niet mee
//  X1  08-09 training van team-2 (RPE 9, pg 500)   -> telt niet mee
const S = {
  s1: U('f2', 1), s2: U('f2', 2), s3: U('f2', 3), s4: U('f2', 4), s5: U('f2', 5), s6: U('f2', 6), s7: U('f2', 7), s8: U('f2', 8),
  s9: U('f2', 9), s10: U('f2', 10), s11: U('f2', 11), s14: U('f2', 12), s12: U('f2', 13), s13: U('f2', 14), m1: U('f2', 15),
  x1: U('f2', 16), s15: U('f2', 17),
}
const GRP = U('9a', 1)
function srpeDb(over: Partial<Db> = {}): Db {
  kN = 0
  const kb1 = kp(S.s4, O.pm, { duur_min: 20, parallel_groep_id: GRP, volgorde: 1 })
  return leegDb({
    events: [
      tr(S.s15, '2026-08-25'),
      tr(S.s1, '2026-09-01', { doelstelling: 'Passen' }), tr(S.s2, '2026-09-03', { doelstelling: 'Druk' }),
      tr(S.s3, '2026-09-06', { doelstelling: 'Tempo' }), tr(S.s4, '2026-09-07'),
      tr(S.s5, '2026-09-09', { doelstelling: 'Conditie' }), tr(S.s6, '2026-09-15', { doelstelling: '  ' }),
      tr(S.s7, '2026-09-17'), tr(S.s8, '2026-09-23', { doelstelling: 'Passen' }),
      tr(S.s9, '2026-10-06'), tr(S.s10, '2026-10-08'), tr(S.s11, '2026-10-13', { doelstelling: 'Pressing' }),
      tr(S.s14, '2026-10-14'), tr(S.s12, TODAY, { doelstelling: 'Vandaag' }), tr(S.s13, '2026-10-20', { doelstelling: 'Straks' }),
      wed(S.m1, '2026-09-10'),
      tr(S.x1, '2026-09-08', { team_id: OTHER, doelstelling: 'Vreemd' }),
    ],
    oefeningen: bibliotheek(),
    training_oefeningen: [
      kp(S.s1, O.pg, { duur_min: 60 }), kp(S.s2, O.pg, { duur_min: 30 }), kp(S.s3, O.pg, { duur_min: 45 }),
      kb1, kp(S.s4, O.pk, { duur_min: 30, parallel_groep_id: GRP, volgorde: 1 }),
      kp(S.s6, O.wu), kp(S.s6, O.zd),
      kp(S.s7, O.pg, { duur_min: 20 }), kp(S.s8, O.pg, { duur_min: 30 }),
      kp(S.s9, O.pg, { duur_min: 0 }), kp(S.s10, O.pg, { duur_min: 20 }), kp(S.s11, O.pg, { duur_min: 40 }),
      kp(S.s14, O.pg, { duur_min: 10 }), kp(S.s12, O.pg, { duur_min: 99 }), kp(S.s13, O.pg, { duur_min: 88 }),
      kp(S.x1, O.pg, { team_id: OTHER, duur_min: 500 }),
    ],
    training_evaluaties: [
      ev3b(S.s15, 6, null),
      ev3b(S.s1, 6, 'ja'), ev3b(S.s2, 4, 'deels'),
      ev3b(S.s3, 10, 'ja', OTHER), // rij van team-2 op een EIGEN training (te.team_id-filter in de ON)
      ev3b(S.s4, 7, 'nee'), ev3b(S.s5, 5, null), ev3b(S.s6, 8, null),
      ev3b(S.s8, null, null),
      ev3b(S.s9, 9, null), ev3b(S.s10, 3, null), ev3b(S.s11, 10, 'ja'), ev3b(S.s14, 2, null),
      ev3b(S.s12, 10, 'ja'), ev3b(S.s13, 10, null),
      ev3b(S.m1, 5, 'ja'),
      ev3b(S.x1, 9, 'ja', OTHER),
    ],
    ...over,
  })
}
// [aantal met RPE van trainingen, sRPE] per ISO-week
const SRPE_VERWACHT: Record<number, string[]> = {
  35: [dekking(1, 1), G],
  36: [dekking(2, 3), '480'],
  37: [dekking(2, 2), '210'],
  38: [dekking(1, 2), '80 *'],
  39: [dekking(0, 1), G],
  40: [G, G],
  41: [dekking(2, 2), '60'],
  42: [dekking(2, 2), '420'],
}
// [ja, deels, nee, zonder oordeel] per ISO-week
const OORDEEL_VERWACHT: Record<number, string[]> = {
  36: ['1', '1', '0', '1'],
  37: ['0', '0', '1', '1'],
  38: ['0', '0', '0', '0'],
  39: ['0', '0', '0', '1'],
  40: [G, G, G, G],
  41: ['0', '0', '0', '0'],
  42: ['1', '0', '0', '0'],
}
function controleerSrpeTabel() {
  const rijen = weekRijen(SRPE())
  for (const [w, cellen] of Object.entries(SRPE_VERWACHT)) expect(wk(rijen, Number(w)).cellen, `sRPE wk ${w}`).toEqual(cellen)
  for (const w of [31, 32, 33, 34]) expect(wk(rijen, w).cellen, `sRPE wk ${w}`).toEqual([G, G])
}

describe('AC-K.1 / K.2 / K.3 / K.4 / K.5 (R9) — sRPE = RPE x geplande duur, opgeteld per ISO-week', () => {
  it('AC-K.1: sRPE per week = som van RPE x planner-duur (6x60 + 4x30 = 480; parallel 20/30 telt als 30 -> 7x30 = 210; 8x10 = 80 *; 3x20 = 60; 10x40 + 2x10 = 420)', async () => {
    await renderInzichten(srpeDb())
    controleerSrpeTabel()
  })

  it('AC-K.1 (venster): zondag valt in de week ervoor, maandag in de volgende (S3 zondag 6-9 in wk 36, S4 maandag 7-9 in wk 37); weken lopen ma–zo en staan chronologisch', async () => {
    await renderInzichten(srpeDb())
    const rijen = weekRijen(SRPE())
    expect(rijen.map((r) => Number(r.label.match(/^wk (\d+)/)![1]))).toEqual([31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42])
    expect(wk(rijen, 36).cellen[0]).toBe(dekking(2, 3)) // incl. de zondag
    expect(wk(rijen, 37).cellen[0]).toBe(dekking(2, 2)) // incl. de maandag
  })

  it('AC-K.1 / R9 (pariteit met berekenTijdlijn): sRPE per week = RPE x het planner-totaal van berekenTijdlijn, en de belastingkaart toont dezelfde duur', async () => {
    // Fixture met bekende planner-totalen: ta 40 (1 blok zonder duur), tb 40 (parallel + genest), tc 20, th 18, tg 35.
    kN = 0
    const T = { ta: U('e3', 1), tb: U('e3', 2), tc: U('e3', 3), td: U('e3', 4), tg: U('e3', 7), th: U('e3', 8) }
    const kb1 = kp(T.tb, O.pm, { duur_min: 20, parallel_groep_id: GRP, volgorde: 1 })
    const db = leegDb({
      events: [
        tr(T.ta, '2026-10-06'), tr(T.tb, '2026-10-11'), tr(T.tc, '2026-10-12'), tr(T.td, '2026-10-14'),
        tr(T.tg, '2026-10-03'), tr(T.th, '2026-10-02'),
      ],
      oefeningen: bibliotheek(),
      training_oefeningen: [
        kp(T.ta, O.pg), kp(T.ta, O.wu, { duur_min: 15 }), kp(T.ta, O.sw, { duur_min: 0 }),
        kb1, kp(T.tb, O.pk, { duur_min: 30, parallel_groep_id: GRP, volgorde: 1 }), kp(T.tb, O.ov, { duur_min: 10, volgorde: 2, genest_in: kb1.id }),
        kp(T.tc, O.pg, { duur_min: 20 }), kp(T.tg, O.hid, { duur_min: 35 }), kp(T.th, O.mate),
      ],
      training_evaluaties: [ev3b(T.ta, 5, null), ev3b(T.tb, 6, null), ev3b(T.tc, 4, null), ev3b(T.td, 5, null), ev3b(T.tg, 2, null), ev3b(T.th, 7, null)],
    })
    // Onafhankelijk verwacht: de planner-aanroep zelf, op de ruwe koppelingen van de fixture.
    const plannerDuur = (event: string): number => {
      const leden = db.training_oefeningen.filter((k) => k.event_id === event).map((k) => {
        const o = db.oefeningen.find((x) => x.id === k.oefening_id && x.leesbaar !== false)
        return {
          id: String(k.id), volgorde: k.volgorde as number, created_at: String(k.created_at),
          parallel_groep_id: (k.parallel_groep_id as string | null) ?? null, duur_min: (k.duur_min as number | null) ?? null,
          oefeningen: o ? { duur_min: (o.duur_min as number | null) ?? null } : null,
        }
      })
      return berekenTijdlijn(blokkenVanKoppelingen(leden), null).totaalMin
    }
    expect([plannerDuur(T.ta), plannerDuur(T.tb), plannerDuur(T.tc), plannerDuur(T.th), plannerDuur(T.tg)]).toEqual([40, 40, 20, 18, 35])
    await renderInzichten(db)
    const sr = weekRijen(SRPE())
    expect(wk(sr, 40).cellen[1]).toBe(String(7 * plannerDuur(T.th) + 2 * plannerDuur(T.tg))) // 196
    expect(wk(sr, 41).cellen[1]).toBe(`${5 * plannerDuur(T.ta) + 6 * plannerDuur(T.tb)} *`) // 440 *
    expect(wk(sr, 42).cellen[1]).toBe(String(4 * plannerDuur(T.tc))) // 80; td (geen koppelingen) telt niet mee
    expect(wk(sr, 42).cellen[0]).toBe(dekking(2, 2))
    // Dezelfde duur als de belastingkaart (laatste kolom = trainingstotaal)
    const bel = weekRijen(BEL())
    expect(wk(bel, 40).cellen.at(-1)).toBe(String(plannerDuur(T.th) + plannerDuur(T.tg)))
    expect(wk(bel, 41).cellen.at(-1)).toBe(`${plannerDuur(T.ta) + plannerDuur(T.tb)} *`)
    expect(wk(bel, 42).cellen.at(-1)).toBe(String(plannerDuur(T.tc)))
  })

  it('AC-K.2: een training zonder RPE telt niet mee in de sRPE, niet als 0; het aantal is zichtbaar (kaart én voettekst)', async () => {
    await renderInzichten(srpeDb())
    // S3, S7, S8 hebben geen RPE (S8: rij met lege kolom). 13 trainingen, 10 met RPE.
    expect(SRPE().textContent).toContain(fmt(i.srpeZonderRpe, { n: 3 }))
    // Week 39 heeft alleen een training zonder RPE: "geen gegevens", niet 0
    expect(wk(weekRijen(SRPE()), 39).cellen).toEqual([dekking(0, 1), G])
    expect(wk(weekRijen(SRPE()), 36).cellen[1]).toBe('480') // S3 voegt geen 0 toe aan een andere waarde
  })

  it('AC-K.3: een training met RPE maar zonder berekenbare duur (geen koppelingen of duur 0) telt niet mee, niet als 0; het aantal is zichtbaar', async () => {
    await renderInzichten(srpeDb())
    // S5 (geen koppelingen), S9 (duur 0), S15 (geen koppelingen) = 3
    expect(SRPE().textContent).toContain(fmt(i.srpeZonderDuur, { n: 3 }))
    expect(wk(weekRijen(SRPE()), 35).cellen).toEqual([dekking(1, 1), G]) // week met alleen zo'n training: "geen gegevens", NIET 0
    expect(wk(weekRijen(SRPE()), 41).cellen[1]).toBe('60') // S9 voegt geen 0 toe, de rest blijft
  })

  it('AC-K.4: week zonder trainingen -> "geen gegevens" (niet 0); week met trainingen zonder RPE -> "geen gegevens" met aantallen; deelweken herkenbaar', async () => {
    await renderInzichten(srpeDb())
    const rijen = weekRijen(SRPE())
    expect(wk(rijen, 40).cellen).toEqual([G, G])
    expect(wk(rijen, 39).cellen).toEqual([dekking(0, 1), G])
    expect(rijen.filter((r) => r.deelweek).map((r) => r.label.match(/^wk (\d+)/)![1])).toEqual(['31', '42'])
    expect(within(SRPE()).getAllByText(i.deelweekLabel)).toHaveLength(2)
    expect(SRPE().textContent).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('AC-K.4 / A5: de staaf-reeks heeft alleen een staaf voor weken met een sRPE (geen staaf voor "geen gegevens"), in één tint', async () => {
    await renderInzichten(srpeDb())
    const img = within(SRPE()).getByRole('img')
    expect(img).toHaveAttribute('aria-label', fmt(i.srpeGrafiekLabel, { n: 12 }))
    const staven = [...img.querySelectorAll('div[style*="brand-accent"]')]
    expect(staven).toHaveLength(5) // wk 36, 37, 38, 41, 42
    for (const s of staven) expect(s.getAttribute('style')).toMatch(/var\(--brand-accent\)/)
    // de deelweek (wk 42) is gedimd
    expect(staven.at(-1)!.getAttribute('style')).toMatch(/opacity: 0\.5/)
  })

  it('AC-K.5: vermeldt dat de duur de geplande duur uit het trainingsplan is (momentopname) en dat een RPE van vandaag morgen zichtbaar is', async () => {
    await renderInzichten(srpeDb())
    expect(SRPE().textContent).toContain(i.srpeMomentopname)
    expect(SRPE().textContent).toContain(i.srpeVolgendeDag)
    expect(i.srpeMomentopname).toMatch(/geplande duur/)
    expect(i.srpeMomentopname).toMatch(/bibliotheek/)
    expect(SRPE().textContent).toContain(i.srpeOnvolledig) // voetnoot bij wk 38
  })

  it('AC-K.5: een gewijzigde bibliotheekduur werkt door bij een koppeling zonder eigen duur', async () => {
    kN = 0
    const t1 = U('f3', 1)
    const db = leegDb({
      events: [tr(t1, '2026-10-06')],
      oefeningen: bibliotheek(),
      training_oefeningen: [kp(t1, O.pg)], // geen eigen duur -> bibliotheek (25)
      training_evaluaties: [ev3b(t1, 6, null)],
    })
    await renderInzichten(db)
    expect(wk(weekRijen(SRPE()), 41).cellen[1]).toBe('150') // 6 x 25
    cleanup()
    db.oefeningen.find((o) => o.id === O.pg)!.duur_min = 40
    await renderInzichten(db)
    expect(wk(weekRijen(SRPE()), 41).cellen[1]).toBe('240') // 6 x 40
  })

  it('AC-K.1 (A8): alleen cijfers: geen gemiddelde, drempel, advies of alarm op de sRPE-kaart', async () => {
    await renderInzichten(srpeDb())
    const k = SRPE()
    expect(within(k).queryByRole('alert')).toBeNull()
    expect(k.textContent).not.toMatch(/gemiddeld|drempel|advies|alarm|te hoog|te laag|risico|overbelast/i)
    expect(k.innerHTML).not.toMatch(/--danger|--warning|--success|panel-red|panel-amber|panel-green/)
  })
})

describe('AC-K.6 / K.7 / O1 — oordeel zichtbaar als aantallen per periode en per week; zonder oordeel apart', () => {
  it('AC-K.6: aantallen ja/deels/nee/zonder oordeel per week (en per periode), zonder lijst per training', async () => {
    await renderInzichten(srpeDb())
    const rijen = weekRijen(OORDEEL())
    for (const [w, cellen] of Object.entries(OORDEEL_VERWACHT)) expect(wk(rijen, Number(w)).cellen, `oordeel wk ${w}`).toEqual(cellen)
    expect(rijen).toHaveLength(12) // alleen weken, geen rij per training
    // periode: ja 2 (S1, S11), deels 1 (S2), nee 1 (S4), zonder oordeel 3 (S3, S5, S8)
    const samenvatting = Object.fromEntries([...OORDEEL().querySelectorAll('dl > div')].map((d) => [d.querySelector('dt')!.textContent, d.querySelector('dd')!.textContent]))
    expect(samenvatting).toEqual({ [i.kolomJa]: '2', [i.kolomDeels]: '1', [i.kolomNee]: '1', [i.kolomZonderOordeel]: '3' })
  })

  it('AC-K.6 / O1 (R5.1): een oordeel bij een inmiddels gewiste doelstelling (S4, nee) telt WEL mee in ja/deels/nee', async () => {
    await renderInzichten(srpeDb())
    expect(wk(weekRijen(OORDEEL()), 37).cellen[2]).toBe('1')
  })

  it('AC-K.7: "zonder oordeel" is apart geteld en telt nooit als nee (S3, S5, S8 zonder oordeel; nee blijft 1)', async () => {
    await renderInzichten(srpeDb())
    const rijen = weekRijen(OORDEEL())
    expect(wk(rijen, 36).cellen).toEqual(['1', '1', '0', '1']) // S3 zonder oordeel -> niet bij nee
    expect(OORDEEL().textContent).toContain(i.oordeelZonderUitleg)
    expect(i.oordeelZonderUitleg).toMatch(/telt niet als nee/)
  })

  it('AC-K.7 / A3: een rij met lege kolommen (gewist) telt als niet ingevuld; een training zonder doelstelling is nooit "zonder oordeel"', async () => {
    await renderInzichten(srpeDb())
    const rijen = weekRijen(OORDEEL())
    expect(wk(rijen, 39).cellen).toEqual(['0', '0', '0', '1']) // S8: wél doelstelling, lege rij
    expect(wk(rijen, 41).cellen).toEqual(['0', '0', '0', '0']) // S9, S10: geen doelstelling
  })

  it('AC-A1 / K.9 / R6: de oordeelkaart toont alleen aantallen: geen grafiek, geen kleur per uitkomst, geen oordeel over de trainer', async () => {
    await renderInzichten(srpeDb())
    const k = OORDEEL()
    expect(within(k).queryByRole('img')).toBeNull()
    expect(within(k).queryByRole('alert')).toBeNull()
    expect(k.innerHTML).not.toMatch(/--danger|--warning|--success|panel-red|panel-amber|panel-green|text-green|text-red/)
    expect(k.textContent).not.toMatch(/advies|alarm|slecht|goed gedaan|score|kpi|signaal/i)
  })

  it('AC-K.6: weken zonder trainingen tonen "geen gegevens" in alle vier de cellen; deelweken herkenbaar', async () => {
    await renderInzichten(srpeDb())
    const rijen = weekRijen(OORDEEL())
    expect(wk(rijen, 40).cellen).toEqual([G, G, G, G])
    expect(rijen.filter((r) => r.deelweek).map((r) => r.label.match(/^wk (\d+)/)![1])).toEqual(['31', '42'])
  })

  it('AC-A3: team zonder trainingen in de periode -> lege staat met uitleg op beide kaarten (andere kaarten hebben wel data)', async () => {
    const db = leegDb({ events: [wed(U('f9', 1), '2026-09-12')] })
    const { container } = await renderInzichten(db)
    expect(within(SRPE()).getByText(i.srpeEmpty)).toBeInTheDocument()
    expect(within(OORDEEL()).getByText(i.oordeelEmpty)).toBeInTheDocument()
    expect(within(SRPE()).queryByRole('table')).toBeNull()
    expect(within(OORDEEL()).queryByRole('table')).toBeNull()
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('AC-A3: trainingen maar nergens een doelstelling of oordeel -> oordeelkaart met uitleg; sRPE met "geen gegevens", geen nullen als meting', async () => {
    kN = 0
    const t1 = U('f9', 2)
    const db = leegDb({ events: [tr(t1, '2026-09-12')], oefeningen: bibliotheek(), training_oefeningen: [kp(t1, O.pg, { duur_min: 30 })] })
    const { container } = await renderInzichten(db)
    expect(within(OORDEEL()).getByText(i.oordeelGeenDoelstellingen)).toBeInTheDocument()
    expect(wk(weekRijen(SRPE()), 37).cellen).toEqual([dekking(0, 1), G])
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/)
  })
})

describe('AC-D — uitbreiding invul-discipline (D.1–D.8)', () => {
  // Basis = fixture van de 3a-discipline-test (8 wedstrijden, 6 trainingen) plus Tx.
  const D = {
    m1: U('e5', 1), m2: U('e5', 2), m3: U('e5', 3), m4: U('e5', 4), m5: U('e5', 5), m6: U('e5', 6), m7: U('e5', 7),
    m8: U('e5', 8), m9: U('e5', 9), m10: U('e5', 10), mee: U('e5', 11),
    t1: U('e6', 1), t2: U('e6', 2), t3: U('e6', 3), t4: U('e6', 4), t5: U('e6', 5), t7: U('e6', 7), t8: U('e6', 8), t9: U('e6', 9), tx: U('e6', 20),
  }
  function disciplineDb(metEvaluatie = true): Db {
    kN = 0
    return leegDb({
      events: [
        wed(D.m1, '2026-09-05', { goals_for: 2, goals_against: 1 }), wed(D.m2, '2026-09-12'), wed(D.m3, '2026-09-19', { goals_for: 1 }),
        wed(D.m4, '2026-09-26'), wed(D.m5, '2026-10-03', { goals_for: 2, goals_against: 0 }), wed(D.m6, '2026-10-10'),
        wed(D.m7, TODAY, { goals_for: 1, goals_against: 1 }), wed(D.m8, '2026-10-20', { goals_for: 4, goals_against: 0 }),
        wed(D.m9, '2026-08-20'), wed(D.m10, '2026-10-12'), { ...wed(D.mee, '2026-09-30'), type: 'meeting' },
        tr(D.t1, '2026-09-08', { doelstelling: 'Passen' }), tr(D.t2, '2026-09-10'), tr(D.t3, '2026-09-15', { doelstelling: ' ' }),
        tr(D.t4, '2026-09-17', { doelstelling: '' }), tr(D.t5, '2026-09-24'), tr(D.t7, '2026-10-14'),
        tr(D.t8, TODAY, { doelstelling: 'Vandaag' }), tr(D.t9, '2026-10-25', { doelstelling: 'Straks' }),
        tr(D.tx, '2026-09-12', { doelstelling: 'Passing' }),
      ],
      oefeningen: bibliotheek(),
      training_oefeningen: [kp(D.t2, O.pg), kp(D.t2, O.wu)],
      match_ratings: [rating(D.m2), rating(D.m3)],
      match_events: [moment(D.m9)],
      task_overrides: [ovr(D.m4, 'analysis'), ovr(D.m5, 'analysis'), ovr(D.m10, 'training_plan'), ovr(D.t4, 'training_plan'), ovr(D.t5, 'analysis')],
      training_evaluaties: metEvaluatie
        ? [
            ev3b(D.t1, 5, 'ja'), ev3b(D.t2, 7, null),
            ev3b(D.t3, null, 'nee'), // doelstelling ' ' = geen doelstelling: oordeel telt niet in D.2
            ev3b(D.t7, 6, null),
            ev3b(D.t8, 9, 'ja'), ev3b(D.t9, 9, 'ja'), // vandaag en toekomst: niet in de noemer
          ]
        : [],
    })
  }
  const MATEN_3A = [fmt(i.disciplineAnalyse, { x: 5, y: 8 }), fmt(i.disciplineUitslag, { x: 2, y: 8 }), fmt(i.disciplinePlan, { x: 4, y: 7 })]

  it('AC-D.1 / D.2 / D.3: "x van y trainingen hebben een RPE" (3 van 7, 4 zonder RPE) en "x van y trainingen met doelstelling hebben een oordeel" (1 van 2, 1 zonder oordeel); toekomst en vandaag niet in de noemer', async () => {
    await renderInzichten(disciplineDb())
    const dt = dtTeksten(DIS())
    expect(dt).toHaveLength(5)
    expect(dt[3]).toBe(fmt(i.disciplineRpe, { x: 3, y: 7 }))
    expect(dt[4]).toBe(fmt(i.disciplineOordeel, { x: 1, y: 2 }))
    expect(DIS().textContent).toContain(fmt(i.disciplineZonderRpe, { n: 4 }))
    expect(DIS().textContent).toContain(fmt(i.disciplineZonderOordeel, { n: 1 }))
  })

  it('AC-D.2 (R5.3): de noemer is "trainingen met een niet-lege doelstelling" (spaties tellen niet; een oordeel zonder doelstelling zit niet in de teller)', async () => {
    await renderInzichten(disciplineDb())
    // t3 (' ') heeft oordeel 'nee' maar geen doelstelling -> noch teller noch noemer. y = T1 + Tx = 2.
    expect(dtTeksten(DIS())[4]).toBe(fmt(i.disciplineOordeel, { x: 1, y: 2 }))
  })

  it('AC-D.4: de bestaande 3a-maten zijn exact gelijk met en zonder 3b-data (tekst én meter) en hebben de hand-afgeleide waarden', async () => {
    const met = await renderInzichten(disciplineDb(true))
    const dtMet = dtTeksten(DIS()).slice(0, 3)
    const htmlMet = [...DIS().querySelectorAll('dl > div')].slice(0, 3).map((d) => d.innerHTML)
    met.unmount()
    cleanup()
    await renderInzichten(disciplineDb(false))
    expect(dtTeksten(DIS()).slice(0, 3)).toEqual(dtMet)
    expect([...DIS().querySelectorAll('dl > div')].slice(0, 3).map((d) => d.innerHTML)).toEqual(htmlMet)
    expect(dtMet).toEqual(MATEN_3A)
    expect(DIS().textContent).toContain(i.disciplineAanwezigheid)
  })

  it('AC-D.5 / D.6: context, geen oordeel of alarm; geen invul-knop of link in de kaart', async () => {
    await renderInzichten(disciplineDb())
    const k = DIS()
    expect(k.querySelectorAll('a, button')).toHaveLength(0)
    expect(within(k).queryByRole('alert')).toBeNull()
    expect(k.innerHTML).not.toMatch(/--danger|--warning|--success|panel-red|panel-amber|panel-green/)
    expect(k.textContent).not.toMatch(/advies|alarm|achterstand|te weinig/i)
  })

  it('AC-D.7: het venster is gelijk aan dat van de bestaande discipline-maten (dezelfde p_start/p_end, t/m gisteren)', async () => {
    const { h } = await renderInzichten(disciplineDb())
    const dis = calls(h, 'inzichten_invul_discipline')[0].args
    const evl = calls(h, 'inzichten_training_evaluaties')
    expect(evl).toHaveLength(1)
    expect(evl[0].args).toEqual({ p_team_id: TEAM, p_start: '2026-08-01', p_end: '2026-10-14' })
    expect(evl[0].args).toEqual(dis)
    expect(calls(h, 'inzichten_training_koppelingen')[0].args).toEqual(dis)
  })

  it('AC-D.7: ook bij een kortere periode (4w) is het venster van evaluatie en discipline gelijk', async () => {
    const { h } = await renderInzichten(disciplineDb(), { periode: '4w' })
    expect(calls(h, 'inzichten_training_evaluaties')[0].args).toEqual(calls(h, 'inzichten_invul_discipline')[0].args)
    expect(calls(h, 'inzichten_training_evaluaties')[0].args.p_end).toBe('2026-10-14')
  })

  it('AC-D.8 / D.3: lege staten per maat — geen trainingen -> "geen trainingen"; trainingen zonder doelstelling -> RPE "0 van 1" en oordeel "geen trainingen met doelstelling"', async () => {
    kN = 0
    const geenTraining = leegDb({ events: [wed(U('f9', 5), '2026-09-12', { goals_for: 1, goals_against: 0 })] })
    await renderInzichten(geenTraining)
    let dt = dtTeksten(DIS())
    expect(dt).toHaveLength(5)
    expect(dt[3]).toBe(i.disciplineGeenTrainingen)
    expect(dt[4]).toBe(i.disciplineGeenDoelstelling)
    cleanup()

    const zonderDoel = leegDb({ events: [wed(U('f9', 5), '2026-09-12', { goals_for: 1, goals_against: 0 }), tr(U('f9', 6), '2026-09-13')] })
    await renderInzichten(zonderDoel)
    dt = dtTeksten(DIS())
    expect(dt[3]).toBe(fmt(i.disciplineRpe, { x: 0, y: 1 }))
    expect(dt[4]).toBe(i.disciplineGeenDoelstelling)
    expect(DIS().textContent).not.toMatch(/NaN|Infinity/)
  })

  it('AC-D.8 / A4: een falende evaluatiebron geeft één regel onder de maten; de 3a-maten blijven staan', async () => {
    const { container } = await renderInzichten(disciplineDb(), { over: { rpcErrors: { inzichten_training_evaluaties: { code: 'XX000', message: 'RAW_E' } } } })
    const dt = dtTeksten(DIS())
    expect(dt).toEqual(MATEN_3A)
    expect(within(DIS()).getByText(i.disciplineEvaluatieFout)).toBeInTheDocument()
    expect(container.textContent).not.toContain('RAW_E')
  })

  it('AC-D.8 / A12: afgekapte evaluatiebron -> melding onder de maten, geen RPE- of oordeelmaat, 3a-maten blijven', async () => {
    const afgeknipt = (d: Db, args: Row, h: Harness) => hEvaluaties(d, args, h).map((r) => ({ ...r, totaal: 905 }))
    await renderInzichten(disciplineDb(), { over: { handlers: { ...MET_DATA, inzichten_training_evaluaties: afgeknipt } } })
    expect(dtTeksten(DIS())).toEqual(MATEN_3A)
    expect(within(DIS()).getByText(i.afgekaptTraining)).toBeInTheDocument()
  })
})

describe('AC-A1 / AC-A15 — volgorde en bestaande kaarten ongewijzigd', () => {
  it('AC-A1: de laatste drie kaarten zijn discipline, sRPE, oordeel (in die volgorde), elk één keer; sRPE en oordeel half breed naast de discipline in het raster', async () => {
    await renderInzichten(srpeDb())
    const koppen = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(koppen.slice(-3)).toEqual([i.disciplineTitle, i.srpeTitle, i.oordeelTitle])
    expect(koppen.slice(-5, -3)).toEqual([i.belastingTitle, i.periodiseringTitle])
    for (const t of NIEUWE_3B) expect(koppen.filter((x) => x === t)).toHaveLength(1)
    expect(SRPE().previousElementSibling).toBe(DIS())
    expect(OORDEEL().previousElementSibling).toBe(SRPE())
    expect(SRPE().parentElement).toBe(DIS().parentElement)
    expect(SRPE().className).not.toContain('col-span-2')
    expect(OORDEEL().className).not.toContain('col-span-2')
  })

  it('AC-A15: alle overige kaarten (rating, vorm, trend, periodisering, belasting, trainingsinhoud, ...) zijn byte-voor-byte gelijk met en zonder 3b-data', async () => {
    const met = await renderInzichten(srpeDb())
    const htmlMet = zonderKaarten(met.container, NIEUWE_3B)
    met.unmount()
    cleanup()
    const zonder = await renderInzichten(srpeDb({ training_evaluaties: [] }))
    const htmlZonder = zonderKaarten(zonder.container, NIEUWE_3B)
    expect(htmlMet.length).toBeGreaterThan(5000)
    expect(htmlMet).toBe(htmlZonder)
  })

  it('AC-A15 / D.4: belasting- en discipline-uitkomsten zijn gelijk aan de hand-afgeleide 3a-waarden (belastingkaart: wk 36 trainingstotaal 135, wk 37 30, wk 38 30 *, wk 41 20 *, wk 42 50)', async () => {
    await renderInzichten(srpeDb())
    const bel = weekRijen(BEL())
    // S1 60 + S2 30 + S3 45 = 135; S4 max(20,30) = 30 + S5 (geen koppelingen) = 30 -> wk 37 = 30 (hand: 30)
    expect(wk(bel, 36).cellen.at(-1)).toBe('135')
    expect(wk(bel, 37).cellen.at(-1)).toBe('30')
    expect(wk(bel, 38).cellen.at(-1)).toBe('30 *') // S6 10 (1 blok zonder duur) + S7 20
    expect(wk(bel, 41).cellen.at(-1)).toBe('20 *') // S9 (blok met duur 0 = blok zonder duur, '*') + S10 20
    expect(wk(bel, 42).cellen.at(-1)).toBe('50') // S11 40 + S14 10
  })

  it('AC-A15: to-do\'s en dashboard raken de nieuwe tabel niet (geen verwijzing in app/page.tsx, lib/todos.mjs, lib/inzichten.ts-kern)', () => {
    for (const pad of ['app/page.tsx', 'lib/todos.mjs']) {
      const bron = readFileSync(join(process.cwd(), pad), 'utf8')
      expect(bron, pad).not.toMatch(/training_evaluaties|trainingEvaluatie|TrainingEvaluatie/)
    }
  })
})

describe('AC-A2 (inzichten) — tenant-isolatie', () => {
  it('AC-A2: rijen van team-2 (eigen training met vreemde evaluatie, vreemde training, wedstrijd met evaluatie) tellen niet mee en worden niet getoond', async () => {
    await renderInzichten(srpeDb())
    // S3 heeft een vreemde rij met RPE 10 en oordeel ja: week 36 houdt "2 van 3" en 1 ja
    expect(wk(weekRijen(SRPE()), 36).cellen).toEqual(SRPE_VERWACHT[36])
    expect(wk(weekRijen(OORDEEL()), 36).cellen).toEqual(OORDEEL_VERWACHT[36])
    expect(SRPE().textContent).not.toMatch(/\b(4500|500)\b/)
    // X1 (team-2, 8-9, pg 500, RPE 9): wk 37 blijft 210
    expect(wk(weekRijen(SRPE()), 37).cellen).toEqual(SRPE_VERWACHT[37])
  })

  it('AC-A2: de pagina geeft de evaluatie-RPC p_team_id = team-id uit de context (niet het user-id van een assistent); de handler filterde op dat argument', async () => {
    const db = srpeDb()
    db.team_members = assistent({}) as Row[]
    const { h } = await renderInzichten(db, { over: { userId: 'user-a' } })
    const call = calls(h, 'inzichten_training_evaluaties')[0]
    expect(call.args.p_team_id).toBe(TEAM)
    controleerSrpeTabel() // zou leeg zijn bij een verkeerde p_team_id (handler eist lidmaatschap)
  })

  it('AC-A2: een niet-lid krijgt van de RPC niets (is_team_member) -> geen cijfers bij een vreemd p_team_id', async () => {
    const db = srpeDb()
    const h = setup(db)
    expect(hEvaluaties(db, { p_team_id: OTHER, p_start: '2026-08-01', p_end: '2026-10-14' }, h)).toEqual([])
    expect(hEvaluaties(db, { p_team_id: 'x', p_start: '2026-08-01', p_end: '2026-10-14' }, h)).toEqual([])
    expect(hEvaluaties(db, { p_team_id: TEAM, p_start: '2026-08-01', p_end: '2026-10-14' }, h).length).toBe(13) // 13 eigen trainingen in het venster (vandaag en toekomst vallen af)
  })
})

describe('AC-A4 / AC-A13 — één falende bron: de rest werkt; zonder migratie alleen de nieuwe kaarten', () => {
  it('AC-A4: evaluatie-RPC faalt -> bronFout op sRPE- en oordeelkaart, één regel in de discipline, belasting en rest werken; geen ruwe tekst', async () => {
    const { container } = await renderInzichten(srpeDb(), { over: { rpcErrors: { inzichten_training_evaluaties: { code: 'XX000', message: 'RAW_DETAIL boem' } } } })
    expect(within(SRPE()).getByText(i.bronFout)).toBeInTheDocument()
    expect(within(OORDEEL()).getByText(i.bronFout)).toBeInTheDocument()
    expect(within(SRPE()).queryByRole('table')).toBeNull()
    expect(within(OORDEEL()).queryByRole('table')).toBeNull()
    expect(within(DIS()).getByText(i.disciplineEvaluatieFout)).toBeInTheDocument()
    expect(within(BEL()).queryByText(i.bronFout)).toBeNull()
    expect(within(BEL()).getByRole('table')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/RAW_DETAIL|XX000/)
    expect(screen.getAllByText(i.bronFout)).toHaveLength(2)
  })

  it('AC-A4: koppelingen-RPC faalt -> bronFout op sRPE en belasting, de oordeelkaart werkt gewoon door', async () => {
    await renderInzichten(srpeDb(), { over: { rpcErrors: { inzichten_training_koppelingen: { code: 'XX000', message: 'RAW_K' } } } })
    expect(within(SRPE()).getByText(i.bronFout)).toBeInTheDocument()
    expect(within(BEL()).getByText(i.bronFout)).toBeInTheDocument()
    expect(within(OORDEEL()).queryByText(i.bronFout)).toBeNull()
    const rijen = weekRijen(OORDEEL())
    expect(wk(rijen, 37).cellen).toEqual(OORDEEL_VERWACHT[37])
    expect(within(DIS()).queryByText(i.disciplineEvaluatieFout)).toBeNull()
  })

  it('AC-A13: zonder migratie (PGRST202) -> alleen de twee nieuwe kaarten en de disciplineregel melden; de pagina werkt; geen ruwe tekst', async () => {
    const PGRST202 = { code: 'PGRST202', message: 'RAW_DETAIL Could not find the function public.inzichten_training_evaluaties in the schema cache' }
    const { container } = await renderInzichten(srpeDb(), { over: { rpcErrors: { inzichten_training_evaluaties: PGRST202 } } })
    expect(within(SRPE()).getByText(i.bronFout)).toBeInTheDocument()
    expect(within(OORDEEL()).getByText(i.bronFout)).toBeInTheDocument()
    expect(within(DIS()).getByText(i.disciplineEvaluatieFout)).toBeInTheDocument()
    expect(dtTeksten(DIS()).length).toBe(3)
    expect(container.textContent).not.toMatch(/RAW_DETAIL|PGRST202|inzichten_training_evaluaties/)
  })
})

describe('AC-A12 — limiet overschreden: zichtbaar vermeld, nooit stil afkappen', () => {
  function veelTrainingen(n: number): Db {
    const events: Row[] = []
    for (let x = 0; x < n; x++) {
      const dag = 1 + (x % 70)
      events.push(tr(U('ea', x + 1), new Date(Date.UTC(2026, 7, dag)).toISOString().slice(0, 10), { doelstelling: 'D' }))
    }
    return leegDb({ events, training_evaluaties: events.map((x, idx) => ev3b(x.id as string, 5, idx % 2 ? 'ja' : null)) })
  }

  it('AC-A12: 905 trainingen -> de SQL levert 901 rijen met totaal 905 -> sRPE en oordeel melden afgekapt en tonen geen cijfers; de discipline-regel meldt het ook', async () => {
    const { h } = await renderInzichten(veelTrainingen(905))
    const bron = hEvaluaties(h.db, { p_team_id: TEAM, p_start: '2026-08-01', p_end: '2026-10-14' }, h)
    expect(bron).toHaveLength(901)
    expect(bron[0].totaal).toBe(905)
    for (const k of [SRPE(), OORDEEL()]) {
      expect(within(k).getByText(i.afgekaptTraining)).toBeInTheDocument()
      expect(within(k).queryByRole('table')).toBeNull()
      expect(within(k).queryByRole('img')).toBeNull()
      expect(k.textContent).not.toMatch(/wk \d+| van \d+/)
    }
    // In deze fixture is ook de 3a-disciplinebron afgekapt: de hele kaart meldt het (3a is leidend).
    expect(within(DIS()).getByText(i.afgekaptTraining)).toBeInTheDocument()
  })

  it('AC-A12: exact 900 rijen (totaal 900) is NIET afgekapt', async () => {
    await renderInzichten(veelTrainingen(900))
    expect(within(SRPE()).queryByText(i.afgekaptTraining)).toBeNull()
    expect(within(OORDEEL()).queryByText(i.afgekaptTraining)).toBeNull()
    expect(within(SRPE()).getByRole('table')).toBeInTheDocument()
  })

  it('AC-A12: afgekapte duurbron (koppelingen) -> sRPE meldt het, maar de oordeel-aantallen blijven gevuld en kloppen', async () => {
    const afgeknipt = (d: Db, a: Row) => hKoppelingen(d, a).slice(0, 3).map((r) => ({ ...r, totaal: 905 }))
    await renderInzichten(srpeDb(), { over: { handlers: { ...MET_DATA, inzichten_training_koppelingen: afgeknipt } } })
    expect(within(SRPE()).getByText(i.afgekaptTraining)).toBeInTheDocument()
    expect(within(SRPE()).queryByRole('table')).toBeNull()
    expect(within(OORDEEL()).queryByText(i.afgekaptTraining)).toBeNull()
    expect(wk(weekRijen(OORDEEL()), 37).cellen).toEqual(OORDEEL_VERWACHT[37])
  })
})

describe('AC-A5 — team zonder data houdt de lege-pagina-staat; RPE en oordeel tellen mee', () => {
  it('AC-A5: alleen ingeplande trainingen (geen RPE, geen oordeel, geen plan) -> lege-pagina-staat', async () => {
    const t1 = U('f8', 2)
    await renderInzichten(leegDb({ events: [tr(t1, '2026-09-12')] }), { over: { handlers: LEEG } })
    expect(screen.getByText(i.geenDataTitle)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: i.srpeTitle })).toBeNull()
  })

  it('AC-A5: één enkele RPE (verder niets) is genoeg voor de gewone pagina met de kaarten', async () => {
    const t1 = U('f8', 3)
    const db = leegDb({ events: [tr(t1, '2026-09-12')], training_evaluaties: [ev3b(t1, 6, null)] })
    await renderInzichten(db, { over: { handlers: LEEG } })
    expect(screen.queryByText(i.geenDataTitle)).toBeNull()
    expect(wk(weekRijen(SRPE()), 37).cellen).toEqual([dekking(1, 1), G])
  })

  it('AC-A5: één enkel oordeel (verder niets) is genoeg voor de gewone pagina', async () => {
    const t1 = U('f8', 5)
    const db = leegDb({ events: [tr(t1, '2026-09-12')], training_evaluaties: [ev3b(t1, null, 'deels')] })
    await renderInzichten(db, { over: { handlers: LEEG } })
    expect(screen.queryByText(i.geenDataTitle)).toBeNull()
    expect(wk(weekRijen(OORDEEL()), 37).cellen[1]).toBe('1')
  })

  it('AC-A5: een ongeldige RPE (11) of oordeel in de bron telt niet als invoer', async () => {
    const t1 = U('f8', 4)
    const db = leegDb({ events: [tr(t1, '2026-09-12')], training_evaluaties: [ev3b(t1, 11, 'misschien')] })
    await renderInzichten(db, { over: { handlers: LEEG } })
    expect(screen.getByText(i.geenDataTitle)).toBeInTheDocument()
  })
})

describe('AC-A9 — vaste deterministische volgorde', () => {
  it('AC-A9: weken staan chronologisch ongeacht de volgorde waarin de RPC de rijen levert', async () => {
    const normaal = await renderInzichten(srpeDb())
    const html = SRPE().innerHTML + OORDEEL().innerHTML
    normaal.unmount()
    cleanup()
    const omgekeerd = (d: Db, a: Row, h: Harness) => [...hEvaluaties(d, a, h)].reverse()
    const omgekeerdKopp = (d: Db, a: Row) => [...hKoppelingen(d, a)].reverse()
    await renderInzichten(srpeDb(), { over: { handlers: { ...MET_DATA, inzichten_training_evaluaties: omgekeerd, inzichten_training_koppelingen: omgekeerdKopp } } })
    expect(SRPE().innerHTML + OORDEEL().innerHTML).toBe(html)
  })
})

describe('AC-A10 / AC-A11 — ISO-week op kalenderdatum; jaarwisseling; schrikkeljaar; venster t/m gisteren', () => {
  it('AC-A11: de RPC krijgt het venster t/m gisteren (verleden), niet het hele seizoen; RPE van vandaag en toekomst staan er niet in, die van gisteren wel', async () => {
    const { h } = await renderInzichten(srpeDb())
    expect(calls(h, 'inzichten_training_evaluaties')[0].args).toEqual({ p_team_id: TEAM, p_start: '2026-08-01', p_end: '2026-10-14' })
    // S12 (vandaag, 99 min x 10) en S13 (toekomst) zouden wk 42 verhogen; S14 (gisteren) zit er wel in: 400 + 20
    expect(wk(weekRijen(SRPE()), 42).cellen).toEqual(SRPE_VERWACHT[42])
    expect(SRPE().textContent).not.toMatch(/990|880/)
  })

  it('AC-A11: kaarten vermelden het venster (t/m gisteren, ma–zo, AU) en de oordeelkaart ook', async () => {
    await renderInzichten(srpeDb())
    expect(SRPE().textContent).toContain(i.srpeDescription)
    expect(i.srpeDescription).toMatch(/t\/m gisteren/)
    expect(i.srpeDescription).toMatch(/ma–zo/)
    expect(i.srpeDescription).toMatch(/AU/)
    expect(i.srpeDescription).toMatch(/RPE × geplande trainingsduur/)
    expect(OORDEEL().textContent).toContain(i.oordeelDescription)
    expect(i.oordeelDescription).toMatch(/t\/m gisteren/)
    expect(i.kolomSrpe).toMatch(/AU/)
  })

  it('AC-A10: jaarwisseling — donderdag 31-12, vrijdag 1-1 en zondag 3-1 vallen in wk 53, maandag 4-1 in wk 1 (2027); week 52 en week 53 apart', async () => {
    zetKlok('2027-02-01')
    kN = 0
    const t = [U('fa', 1), U('fa', 2), U('fa', 3), U('fa', 4)]
    const db = leegDb({
      events: [tr(t[0], '2026-12-31'), tr(t[1], '2027-01-01'), tr(t[2], '2027-01-03'), tr(t[3], '2027-01-04')],
      oefeningen: bibliotheek(),
      training_oefeningen: t.map((x) => kp(x, O.pg, { duur_min: 60 })),
      training_evaluaties: t.map((x) => ev3b(x, 5, null)),
    }, ['2026-12-15', '2027-01-31'])
    await renderInzichten(db)
    const rijen = weekRijen(SRPE())
    expect(rijen.map((r) => Number(r.label.match(/^wk (\d+)/)![1]))).toEqual([51, 52, 53, 1, 2, 3, 4])
    expect(wk(rijen, 53).cellen).toEqual([dekking(3, 3), '900'])
    expect(wk(rijen, 1).cellen).toEqual([dekking(1, 1), '300'])
    expect(wk(rijen, 52).cellen).toEqual([G, G])
    expect(rijen[0].deelweek).toBe(true) // wk 51 begint (14-12) voor de seizoensstart (15-12)
    expect(rijen.at(-1)!.deelweek).toBe(false)
  })

  it('AC-A10: schrikkeljaar — 28-2 (ma), 29-2 (di), 1-3 (wo) en 5-3 (zo) vallen in wk 9, 6-3 (ma) in wk 10', async () => {
    zetKlok('2028-03-16')
    kN = 0
    const t = [U('fb', 1), U('fb', 2), U('fb', 3), U('fb', 4), U('fb', 5)]
    const datums = ['2028-02-28', '2028-02-29', '2028-03-01', '2028-03-05', '2028-03-06']
    const db = leegDb({
      events: t.map((x, idx) => tr(x, datums[idx])),
      oefeningen: bibliotheek(),
      training_oefeningen: t.map((x) => kp(x, O.pg, { duur_min: 30 })),
      training_evaluaties: t.map((x) => ev3b(x, 4, null)),
    }, ['2028-02-15', '2028-03-31'])
    await renderInzichten(db)
    const rijen = weekRijen(SRPE())
    expect(wk(rijen, 9).cellen).toEqual([dekking(4, 4), '480'])
    expect(wk(rijen, 10).cellen).toEqual([dekking(1, 1), '120'])
    expect(rijen.at(-1)!.deelweek).toBe(true) // lopende week t/m gisteren
  })
})

// ═══════════════════════════════════════════════════════════════════════
// DEEL C — tijdzones, opruimen, SQL-structuur
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

  it.each([[0, 30], [10, 0], [23, 30]])(
    'AC-R.10 / O.8 / A10: om %i:%i lokaal is een training van vandaag toegestaan en die van morgen niet — RPE én oordeel, action én pagina',
    async (uur, min) => {
      zetKlok(TODAY, uur, min)
      const db = eventDb()
      setup(db)
      await expect(saveTrainingRpe(EV.today, 6)).resolves.toBeUndefined()
      await expect(saveTrainingOordeel(EV.today, 'ja')).resolves.toBeUndefined()
      await expect(saveTrainingRpe(EV.future, 6)).rejects.toThrow('Training nog niet gehouden')
      await expect(saveTrainingOordeel(EV.future, 'ja')).rejects.toThrow('Training nog niet gehouden')
      expect(evRij(db, EV.today)).toHaveLength(1)
      expect(evRij(db, EV.today)[0]).toMatchObject({ rpe: 6, oordeel: 'ja' })
      expect(evRij(db, EV.future)).toHaveLength(0)
      // herstel op een toekomstige training weigert ook
      await expect(herstelTrainingRpe({ soort: 'training_rpe', teamId: TEAM, eventId: EV.future, rpe: 4 })).rejects.toThrow(HERSTEL_FOUT)
      await openEvent(EV.future)
      expect(SEC().getByText(e.evaluatieToekomst)).toBeInTheDocument()
      expect(SEC().queryAllByRole('button')).toHaveLength(0)
      cleanup()
      await openEvent(EV.today)
      expect(geselecteerdeRpe()).toEqual([6])
      expect(geselecteerdOordeel()).toEqual(['ja'])
    },
  )

  it.each([[0, 30], [10, 0], [23, 30]])(
    'AC-A10 / A11: om %i:%i lokaal is de sRPE- en oordeeltabel identiek: zondag/maandag in de juiste week, vandaag niet, gisteren wel',
    async (uur, min) => {
      zetKlok(TODAY, uur, min)
      const { h } = await renderInzichten(srpeDb())
      expect(calls(h, 'inzichten_training_evaluaties')[0].args).toEqual({ p_team_id: TEAM, p_start: '2026-08-01', p_end: '2026-10-14' })
      controleerSrpeTabel()
      const rijen = weekRijen(OORDEEL())
      for (const [w, cellen] of Object.entries(OORDEEL_VERWACHT)) expect(wk(rijen, Number(w)).cellen).toEqual(cellen)
    },
  )
})

describe('AC-A14 — RPE en oordeel mee bij team opruimen en verwijderen', () => {
  it('AC-A14: training_evaluaties staat in TEAM_TABELLEN, vóór events, players en match_ratings (FK-veilige volgorde)', () => {
    const lijst = [...TEAM_TABELLEN] as string[]
    const idx = lijst.indexOf('training_evaluaties')
    expect(idx).toBeGreaterThanOrEqual(0)
    for (const t of ['events', 'players', 'match_ratings']) expect(idx).toBeLessThan(lijst.indexOf(t))
  })

  it('AC-A14: het opruimen van een team verwijdert zijn evaluaties en laat die van andere teams staan', async () => {
    const db: Db = { teams: [{ id: TEAM }, { id: OTHER }] }
    for (const t of TEAM_TABELLEN) db[t] = []
    db.training_evaluaties = [stamEv(EV.past, 6, 'ja'), stamEv(EV.other, 9, null, { team_id: OTHER })]
    const h = setup(db)
    await ruimTeamOp(makeClient(h) as unknown as Parameters<typeof ruimTeamOp>[0], TEAM, 'test.opruimen')
    expect(db.training_evaluaties.map((r) => r.team_id)).toEqual([OTHER])
  })

  it('AC-A14 (SQL-structuur): training_evaluaties verwijst met on delete cascade naar teams en events (verwijderde training neemt de rij mee; bewezen op de echte database door blok 30j)', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/inzichten-metrics-fase3b.sql'), 'utf8')
    for (const t of ['teams', 'events']) expect(sql).toMatch(new RegExp(`references public\\.${t}\\(id\\)\\s+on delete cascade`))
    expect(sql).toMatch(/constraint training_evaluaties_event_key unique \(event_id\)/)
    const verif = readFileSync(join(process.cwd(), 'supabase/team-rls-verificatie.sql'), 'utf8')
    expect(verif).toMatch(/Blok 30/)
    expect(verif).toMatch(/cascade/i)
  })

  it('AC-A14: de bewaker tegen een uit de pas lopende tabellijst: TEAM_TABELLEN heeft precies zestien tabellen', () => {
    expect(TEAM_TABELLEN).toHaveLength(16)
  })
})
