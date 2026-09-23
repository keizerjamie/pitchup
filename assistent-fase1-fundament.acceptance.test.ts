// Acceptatietests — Assistent-trainers, fase 1 ("Fundament")
//
// Scope (opdracht van de test-verifier-run, brief §0-fasering): uitsluitend
// wat fase 1 daadwerkelijk oplevert. Fase 1 heeft NUL zichtbare
// UI-verandering (06-backend-fase1-samenvatting.md §7: "components/** niet
// aangeraakt"), dus er is hier geen React-render — de "buitenkant" van deze
// fase IS de publieke API: de geëxporteerde server actions en
// lib/team-context.ts. Dit bestand roept uitsluitend die echte, geëxporteerde
// functies aan (nooit interne helpers), tegen een generieke Supabase-mock die
// .eq/.neq/.in/.select/.insert/.update/.delete/.upsert ECHT toepast — zelfde
// precedent als de andere *.acceptance.test.tsx-bestanden in deze repo
// (bv. gastspelers.acceptance.test.tsx), alleen dan op server-actionniveau
// in plaats van op paginaniveau (er is geen pagina om te renderen).
//
// Gedekte criteria (letterlijke tekst uit de opdracht van de orkestrator):
//   AC15/50 — signUp maakt team (id = user.id), owner-rij en
//             settings.team_name aan, in die volgorde.
//   AC33    — een gebruiker zonder lidmaatschap bij team X krijgt via
//             getTeamContext()/setActiveTeam(X) nooit team X als actief; een
//             vervalste active_team-cookie wordt genegeerd.
//   AC45    — applicatielaag: een schrijfaction zonder recht op onderdeel Y
//             weigert vóór er een schrijf-query wordt uitgevoerd; met recht
//             slaagt de action; een owner slaagt altijd, ongeacht de
//             rechten-kolommen. Plus AC28/42: team-colors/team-logo/
//             saveSettings weigeren een assistent met ALLE zes rechten.
//   "AC38" (fase-1-deel, letterlijke opdrachttekst) — deleteAccount wist de
//             volledige tabellijst incl. categorie_metingen en de teams-rij,
//             en de owner-guard laat teamdata ongemoeid als de context geen
//             owner is. LET OP — zie het testverslag: story-item 38 is
//             letterlijk "de rol is per team bepaald, niet globaal per
//             account" (een BR, geen deleteAccount-eis). De opdrachttekst
//             wijkt daarvan af; ik test hier wat concreet gevraagd is en
//             benoem de discrepantie in het rapport, niet in de testnaam.
//   Invariant — met precies één owner-lidmaatschap wordt cookies() niet
//             gelezen en is ctx.teamId === user.id.
//
// NIET hier (zie testverslag): de RLS-laag van AC45 is niet in vitest te
// bewijzen (brief §5.1) — onderaan staat alleen een structuurcontrole op
// supabase/team-rls-verificatie.sql, geen vervanging van die SQL-verificatie.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
}))
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
// createPlayer roept getDefaultAttendance niet aan, maar players.ts importeert
// hem op module-niveau (patroon van app/actions/players.test.ts) — gemockt om
// dat importpad niet onnodig aan settings.ts vast te klinken.
vi.mock('@/app/actions/settings', async (importOriginal) => {
  const origineel = await importOriginal<typeof import('@/app/actions/settings')>()
  return { ...origineel, getDefaultAttendance: vi.fn(async () => 'present') }
})

import { cookies, headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { signUp, deleteAccount } from '@/app/actions/auth'
import { setActiveTeam } from '@/app/actions/team'
import { ACTIVE_TEAM_COOKIE, TEAM_NAAM_METADATA_KEY, getTeamContext } from '@/lib/team-context'
import { createPlayer } from '@/app/actions/players'
import { createEvent, deleteEvent, updateGatherTime, updateTrainingstype } from '@/app/actions/events'
import { createBulkMatches } from '@/app/actions/events-bulk'
import { markAllPresent, markAbsentForPeriod } from '@/app/actions/attendance'
import { toggleSquadPlayer } from '@/app/actions/match-squad'
import { saveMatchResult } from '@/app/actions/match-analysis'
import { markTaskDone } from '@/app/actions/todos'
import { saveDoelstelling, addOefeningToTraining } from '@/app/actions/training-plan'
import { deleteCyclusWeekCorrectie } from '@/app/actions/periodisering'
import { saveTeamColor } from '@/app/actions/team-colors'
import { uploadTeamLogo } from '@/app/actions/team-logo'
import { saveSettings } from '@/app/actions/settings'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { GEEN_RECHTEN, ALLE_RECHTEN, rechtenNaarKolommen, type TeamRechten } from '@/lib/team-rechten'

// ────────────────────────────────────────────────
// Generieke, ECHT filterende Supabase-tabel-engine (kopie, zelfde precedent
// als gastspelers.acceptance.test.tsx / teamindeling.acceptance.test.tsx —
// elk bestand houdt zijn eigen kopie).
// ────────────────────────────────────────────────

type Row = Record<string, unknown>
type Call = {
  table: string
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc'
  fn?: string
  args?: Record<string, unknown>
}
type TableError = { message: string; code?: string }

let genTeller = 0

// Ronde-2-uitbreiding (validatorpunten 6/7 + addendum §8.7): update/delete
// muteren nu ECHT de onderliggende rijenlijst (in plaats van alleen een call
// te registreren). Dat is nodig om te BEWIJZEN welke team_id een filter
// daadwerkelijk gebruikte: gebruikt de code per ongeluk ctx.userId in plaats
// van ctx.teamId, dan matcht een rij die alleen op ctx.teamId team_id heeft
// gewoon NIET — en blijft na de aanroep onaangeroerd in de fixture staan.
// Dat is een sterker bewijs dan alleen "er is een update/delete-call geweest".
function realTable(name: string, rows: Row[], calls: Call[], failInsert?: TableError) {
  return () => {
    const filters: ((r: Row) => boolean)[] = []
    const resolveRows = () => rows.filter((r) => filters.every((f) => f(r)))
    let lastOp: Call['op'] | null = null
    let pendingUpdate: Row | null = null
    let pendingDelete = false
    let lastInserted: Row[] = []

    const chain: Record<string, unknown> = {}
    chain.select = () => { calls.push({ table: name, op: 'select' }); return chain }
    chain.eq = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return chain }
    chain.neq = (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return chain }
    chain.in = (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return chain }
    chain.gte = (col: string, val: unknown) => {
      filters.push((r) => (r[col] as number | string) >= (val as number | string)); return chain
    }
    chain.lte = (col: string, val: unknown) => {
      filters.push((r) => (r[col] as number | string) <= (val as number | string)); return chain
    }
    chain.order = () => chain
    chain.limit = () => chain
    // Na een insert geeft single()/maybeSingle() de zojuist ingevoegde rij
    // terug (patroon `.insert(payload).select('id').single()`), zoals
    // createEvent/markAbsentForPeriod dat gebruiken. Zonder insert valt hij
    // terug op een gewone select-resolutie.
    chain.maybeSingle = () => Promise.resolve({
      data: failInsert ? null : (lastInserted[0] ?? resolveRows()[0] ?? null), error: failInsert ?? null,
    })
    chain.single = () => Promise.resolve({
      data: failInsert ? null : (lastInserted[0] ?? resolveRows()[0] ?? null), error: failInsert ?? null,
    })
    chain.insert = (payload: Row | Row[]) => {
      calls.push({ table: name, op: 'insert' })
      lastOp = 'insert'
      if (!failInsert) {
        const items = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
          id: (p as Row).id ?? `gen-${name}-${genTeller++}`,
          ...p,
        }))
        for (const item of items) rows.push(item)
        lastInserted = items
      }
      return chain
    }
    chain.upsert = (payload: Row) => {
      calls.push({ table: name, op: 'upsert' })
      rows.push({ ...payload })
      return Promise.resolve({ data: null, error: null })
    }
    chain.update = (payload: Row) => {
      calls.push({ table: name, op: 'update' }); lastOp = 'update'; pendingUpdate = payload; return chain
    }
    chain.delete = () => { calls.push({ table: name, op: 'delete' }); lastOp = 'delete'; pendingDelete = true; return chain }
    ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
      const matched = resolveRows()
      if (pendingUpdate) for (const r of matched) Object.assign(r, pendingUpdate)
      if (pendingDelete) for (const r of matched) {
        const i = rows.indexOf(r)
        if (i >= 0) rows.splice(i, 1)
      }
      if (lastOp === 'insert') return resolve({ data: failInsert ? null : lastInserted, error: failInsert ?? null })
      return resolve({ data: matched, error: null })
    }
    return chain
  }
}

function makeSupabase(opts: {
  user?: { id: string } | null
  members?: Row[]
  settings?: Row[]
  tables?: Record<string, Row[]>
  failInsert?: { table: string; error: TableError }
}) {
  const user = opts.user === undefined ? null : opts.user
  const calls: Call[] = []
  const store: Record<string, Row[]> = {
    team_members: opts.members ?? [],
    settings: opts.settings ?? [],
    ...(opts.tables ?? {}),
  }
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user } }),
      signOut: async () => ({ error: null }),
    },
    from: (t: string) => {
      if (!store[t]) store[t] = []
      const fout = opts.failInsert?.table === t ? opts.failInsert.error : undefined
      return realTable(t, store[t], calls, fout)()
    },
    // De kolom-begrensde RPC's uit supabase/team-rls-gevolgacties.sql. Sinds
    // het §8-addendum lopen de vier events-kolommen die NIET onder 'agenda'
    // vallen (doelstelling, uitslag, verzameltijd, trainingstype) hierlangs:
    // de events-policy blijft 'agenda', de RPC toetst zelf het juiste
    // onderdeel. Voor deze suite telt hij mee als schrijfactie op `events`,
    // zodat de bestaande "er is/is niets geschreven"-asserties blijven werken.
    // `args` wordt nu ook vastgelegd (ronde-2-uitbreiding) zodat een
    // broncontract-check op de exacte parameternamen mogelijk is (addendum §8.7).
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ table: 'events', op: 'rpc', fn, args })
      return { data: null, error: null }
    },
    storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
  }
  return { supabase, calls, store }
}

function useSupabase(m: { supabase: unknown }) {
  vi.mocked(createClient).mockResolvedValue(m.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

function memberRow(teamId: string, userId: string, rol: 'owner' | 'assistent', rechten: Partial<TeamRechten> = {}): Row {
  const kolommen = rechtenNaarKolommen({ ...GEEN_RECHTEN, ...rechten } as TeamRechten)
  return { team_id: teamId, user_id: userId, rol, ...kolommen }
}

function teamNameRow(teamId: string, naam: string): Row {
  return { team_id: teamId, key: 'team_name', value: naam }
}

function schrijfCalls(calls: Call[], table: string): Call[] {
  return calls.filter((c) => c.table === table && c.op !== 'select')
}

// Cookie-mock: get() leest de "forged" of geldige waarde, set() legt vast wat
// setActiveTeam zou wegschrijven.
let cookieWaarde: string | undefined
let cookieSets: { naam: string; value: string }[]

beforeEach(() => {
  vi.clearAllMocks()
  cookieWaarde = undefined
  cookieSets = []
  vi.mocked(cookies).mockResolvedValue({
    get: (naam: string) => (naam === ACTIVE_TEAM_COOKIE && cookieWaarde !== undefined ? { value: cookieWaarde } : undefined),
    set: (naam: string, value: string) => { cookieSets.push({ naam, value }) },
  } as unknown as Awaited<ReturnType<typeof cookies>>)
  // signUp/rate-limit (lib/rate-limit.ts clientIp) leest headers() op — een
  // ontbrekende service-role-key laat checkRateLimit/recordAttempt stil
  // NOT_BLOCKED teruggeven (geen throw), dus createAdminClient hoeft in de
  // signUp-tests niet apart gemockt te worden.
  vi.mocked(headers).mockResolvedValue(new Headers({ 'x-forwarded-for': '1.2.3.4' }) as unknown as Awaited<ReturnType<typeof headers>>)
})

const TEAM_A = '11111111-1111-4111-8111-111111111111'
const TEAM_B = '22222222-2222-4222-8222-222222222222'
const VREEMD_TEAM = '99999999-9999-4999-8999-999999999999'
const ANDERE_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

// ════════════════════════════════════════════════════════════════════════
// AC15/50 — signUp maakt team, owner-rij en teamnaam aan, in die volgorde
// ════════════════════════════════════════════════════════════════════════

// LET OP — herzien tijdens dit testverslag: de eerste versie van dit blok
// testte signUp als een rechtstreekse teams/team_members/settings-insert
// (zoals 06-backend-fase1-samenvatting.md het beschrijft). Tijdens deze
// verificatie bleek app/actions/auth.ts + lib/team-context.ts inmiddels
// herschreven te zijn (signUp → maakEigenTeam(), met een user-metadata-vlag
// TEAM_NAAM_METADATA_KEY voor het geval e-mailbevestiging aanstaat en er nog
// geen sessie is — dit dicht brief §6.5, openstaande vraag 13). Dat is een
// reële wijziging in de working tree, niet iets dat ik heb aangepast; zie het
// testverslag voor de melding hierover (o.a. dat dit ook app/actions/
// auth.test.ts zelf rood maakt). Onderstaande tests toetsen de HUIDIGE code.
describe('AC15/50 — signUp via de gewone registratiepagina', () => {
  function makeSignUpSupabase() {
    const calls: { table: string; op: string; payload: Row }[] = []
    const updateUserCalls: Row[] = []
    const supabase = {
      auth: {
        getUser: async () => ({ data: { user: null } }),
        signUp: async () => ({
          data: { user: { id: TEAM_A }, session: { access_token: 'x' } },
          error: null,
        }),
        updateUser: async (payload: Row) => {
          updateUserCalls.push(payload)
          return { data: {}, error: null }
        },
      },
      from: (table: string) => ({
        insert: (payload: Row) => {
          calls.push({ table, op: 'insert', payload })
          return Promise.resolve({ data: null, error: null })
        },
      }),
    }
    return { supabase, calls, updateUserCalls }
  }

  function form(fields: Record<string, string>): FormData {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.set(k, v)
    return fd
  }

  it('maakt bij registratie de teams-rij, de owner-rij in team_members én settings.team_name aan, in exact die volgorde', async () => {
    const m = makeSignUpSupabase()
    vi.mocked(createClient).mockResolvedValue(m.supabase as unknown as Awaited<ReturnType<typeof createClient>>)

    await expect(signUp(null, form({
      email: 'coach@example.com', password: 'correct-horse-battery', team_name: 'JO13-1',
    }))).rejects.toThrow('__redirect__:/')

    expect(m.calls.map((c) => c.table)).toEqual(['teams', 'team_members', 'settings'])
  })

  it('geeft de teams-rij het user-id als primaire sleutel (teams.id === user.id) — de invariant waar fase 1 op rust', async () => {
    const m = makeSignUpSupabase()
    vi.mocked(createClient).mockResolvedValue(m.supabase as unknown as Awaited<ReturnType<typeof createClient>>)

    await expect(signUp(null, form({
      email: 'coach@example.com', password: 'correct-horse-battery', team_name: 'JO13-1',
    }))).rejects.toThrow('__redirect__:/')

    expect(m.calls.find((c) => c.table === 'teams')!.payload).toEqual({ id: TEAM_A })
  })

  it('maakt de registrant owner met alle zes rechten, en de teamnaam-rij met de ingevoerde naam', async () => {
    const m = makeSignUpSupabase()
    vi.mocked(createClient).mockResolvedValue(m.supabase as unknown as Awaited<ReturnType<typeof createClient>>)

    await expect(signUp(null, form({
      email: 'coach@example.com', password: 'correct-horse-battery', team_name: 'JO13-1',
    }))).rejects.toThrow('__redirect__:/')

    const lid = m.calls.find((c) => c.table === 'team_members')!.payload
    expect(lid.team_id).toBe(TEAM_A)
    expect(lid.user_id).toBe(TEAM_A)
    expect(lid.rol).toBe('owner')
    expect(rechtenNaarKolommen(ALLE_RECHTEN)).toMatchObject(
      Object.fromEntries(Object.entries(lid).filter(([k]) => k.startsWith('mag_'))),
    )

    const naam = m.calls.find((c) => c.table === 'settings')!.payload
    expect(naam).toEqual({ team_id: TEAM_A, key: 'team_name', value: 'JO13-1' })
  })
})

// ════════════════════════════════════════════════════════════════════════
// Fase-1-invariant + AC33 — teamcontext en de cookie als NOOIT-autorisatiebron
// ════════════════════════════════════════════════════════════════════════

describe('Invariant — precies één owner-lidmaatschap: cookies() wordt niet gelezen, ctx.teamId === user.id', () => {
  it('getTeamContext() leest de cookie niet en geeft het enige team als actief, gelijk aan user.id', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
    })
    useSupabase(m)

    const ctx = await getTeamContext()

    expect(ctx?.teamId).toBe(TEAM_A)
    expect(ctx?.userId).toBe(TEAM_A)
    expect(ctx?.teamId).toBe(ctx?.userId)
    expect(vi.mocked(cookies)).not.toHaveBeenCalled()
  })
})

describe('AC33 — een gebruiker zonder lidmaatschap bij team X krijgt dat team nooit als actief', () => {
  it('een vervalste active_team-cookie voor een team zonder lidmaatschap wordt genegeerd; getTeamContext valt terug op het eerste eigen team (alfabetisch)', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      // Twee ECHTE lidmaatschappen (alfabetisch: 'Ajax' vóór 'Zebra's'), plus
      // een cookie die een DERDE, niet-gekoppeld team claimt.
      members: [
        memberRow(TEAM_A, TEAM_A, 'owner', ALLE_RECHTEN),
        memberRow(TEAM_B, TEAM_A, 'assistent', ALLE_RECHTEN),
      ],
      settings: [teamNameRow(TEAM_A, 'Ajax'), teamNameRow(TEAM_B, "Zebra's")],
    })
    useSupabase(m)
    cookieWaarde = VREEMD_TEAM

    const ctx = await getTeamContext()

    expect(ctx?.teamId).not.toBe(VREEMD_TEAM)
    expect(ctx?.teamId).toBe(TEAM_A) // alfabetisch eerste van de ÉCHTE lidmaatschappen
  })

  it('setActiveTeam(X) weigert een team-id waar geen lidmaatschap voor bestaat, en laat de cookie ongemoeid', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [
        memberRow(TEAM_A, TEAM_A, 'owner', ALLE_RECHTEN),
        memberRow(TEAM_B, TEAM_A, 'assistent', ALLE_RECHTEN),
      ],
      settings: [teamNameRow(TEAM_A, 'Ajax'), teamNameRow(TEAM_B, "Zebra's")],
    })
    useSupabase(m)

    await expect(setActiveTeam(VREEMD_TEAM)).rejects.toThrow('Team niet gevonden')
    expect(cookieSets).toHaveLength(0)
  })

  it('setActiveTeam slaagt wél voor een team waar wél een lidmaatschap voor bestaat', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [
        memberRow(TEAM_A, TEAM_A, 'owner', ALLE_RECHTEN),
        memberRow(TEAM_B, TEAM_A, 'assistent', ALLE_RECHTEN),
      ],
      settings: [teamNameRow(TEAM_A, 'Ajax'), teamNameRow(TEAM_B, "Zebra's")],
    })
    useSupabase(m)

    await expect(setActiveTeam(TEAM_B)).rejects.toThrow('__redirect__:/')
    expect(cookieSets).toEqual([{ naam: ACTIVE_TEAM_COOKIE, value: TEAM_B }])
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC45 — applicatielaag: assertCanEdit weigert vóór elke schrijf-query
// ════════════════════════════════════════════════════════════════════════
//
// Voor elk onderdeel: (1) een assistent ZONDER dat recht krijgt 'Geen
// toegang' en er wordt géén schrijf-query (insert/update/upsert/delete)
// uitgevoerd op de resource-tabel — lezen blijft toegestaan voor elk lid
// (RLS is_team_member), dus alleen SCHRIJVEN wordt hier gecontroleerd;
// (2) een assistent MET dat recht slaagt en de schrijf-query vindt wel
// plaats.

describe('AC45 — spelers (createPlayer)', () => {
  function form(): FormData {
    const fd = new FormData()
    fd.set('name', 'Nieuwe Speler')
    fd.set('position', 'Keeper')
    return fd
  }

  it('een assistent zonder spelersrecht krijgt "Geen toegang" en er wordt niets in players geschreven', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { ...GEEN_RECHTEN, spelers: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { players: [] },
    })
    useSupabase(m)

    await expect(createPlayer(form())).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'players')).toHaveLength(0)
  })

  it('een assistent MET spelersrecht kan een speler toevoegen', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { spelers: true })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { players: [] },
    })
    useSupabase(m)

    await expect(createPlayer(form())).resolves.toBeUndefined()
    expect(schrijfCalls(m.calls, 'players')).toEqual([{ table: 'players', op: 'insert' }])
  })

  it('een owner kan altijd een speler toevoegen, ook als de spelers-kolom in team_members op false staat', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'owner', { spelers: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { players: [] },
    })
    useSupabase(m)

    await expect(createPlayer(form())).resolves.toBeUndefined()
    expect(schrijfCalls(m.calls, 'players')).toEqual([{ table: 'players', op: 'insert' }])
  })
})

describe('AC45 — agenda (deleteEvent)', () => {
  it('een assistent zonder agendarecht krijgt "Geen toegang" en er wordt niets in events verwijderd', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { agenda: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { events: [{ id: 'e1', team_id: TEAM_A }] },
    })
    useSupabase(m)

    await expect(deleteEvent('e1')).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'events')).toHaveLength(0)
  })

  it('een assistent MET agendarecht kan een event verwijderen', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { agenda: true })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { events: [{ id: 'e1', team_id: TEAM_A }] },
    })
    useSupabase(m)

    await expect(deleteEvent('e1')).resolves.toBeUndefined()
    expect(schrijfCalls(m.calls, 'events')).toEqual([{ table: 'events', op: 'delete' }])
  })
})

describe('AC45 — aanwezigheid (markAllPresent)', () => {
  it('een assistent zonder aanwezigheidsrecht krijgt "Geen toegang" en er wordt niets in attendance geschreven', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { aanwezigheid: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { attendance: [] },
    })
    useSupabase(m)

    await expect(markAllPresent('e1')).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'attendance')).toHaveLength(0)
  })

  it('een assistent MET aanwezigheidsrecht kan iedereen op aanwezig zetten', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { aanwezigheid: true })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { attendance: [] },
    })
    useSupabase(m)

    await expect(markAllPresent('e1')).resolves.toBeUndefined()
    expect(schrijfCalls(m.calls, 'attendance')).toEqual([{ table: 'attendance', op: 'update' }])
  })
})

describe('AC45 — wedstrijd (toggleSquadPlayer)', () => {
  it('een assistent zonder wedstrijdrecht krijgt "Geen toegang" en er wordt niets in match_squad geschreven (ook geen eigenaarschapscheck op events/players)', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { wedstrijd: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: {
        events: [{ id: 'e1', team_id: TEAM_A, type: 'match' }],
        players: [{ id: 'p1', team_id: TEAM_A }],
        match_squad: [],
      },
    })
    useSupabase(m)

    await expect(toggleSquadPlayer('e1', 'p1', true)).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'match_squad')).toHaveLength(0)
  })

  it('een assistent MET wedstrijdrecht kan een speler uit de selectie halen', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { wedstrijd: true })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: {
        events: [{ id: 'e1', team_id: TEAM_A, type: 'match' }],
        players: [{ id: 'p1', team_id: TEAM_A }],
        match_squad: [{ event_id: 'e1', player_id: 'p1', team_id: TEAM_A }],
      },
    })
    useSupabase(m)

    await expect(toggleSquadPlayer('e1', 'p1', false)).resolves.toBeUndefined()
    expect(schrijfCalls(m.calls, 'match_squad')).toEqual([{ table: 'match_squad', op: 'delete' }])
  })
})

describe('AC45 — training (saveDoelstelling)', () => {
  it('een assistent zonder trainingsrecht krijgt "Geen toegang" en er wordt niets in events geschreven', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { training: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { events: [{ id: 'e1', team_id: TEAM_A }] },
    })
    useSupabase(m)

    await expect(saveDoelstelling('e1', 'Positiespel oefenen')).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'events')).toHaveLength(0)
  })

  it('een assistent MET trainingsrecht kan de doelstelling opslaan', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { training: true })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      // type: 'training' is inmiddels verplicht: saveDoelstelling doet sinds
      // kort ook een assertOwnTrainingEvent-forged-id-guard vóór de RPC (zelfde
      // patroon als updateGatherTime/updateTrainingstype/saveMatchResult).
      tables: { events: [{ id: 'e1', team_id: TEAM_A, type: 'training' }] },
    })
    useSupabase(m)

    await expect(saveDoelstelling('e1', 'Positiespel oefenen')).resolves.toBeUndefined()
    // Sinds het §8-addendum geen directe update meer maar de kolom-begrensde
    // RPC set_event_doelstelling — de events-policy blijft op 'agenda'. De
    // parameternamen zijn een broncontract (addendum §8.7): een hernoeming
    // zou hier stil `undefined` doorgeven i.p.v. hard te falen.
    expect(schrijfCalls(m.calls, 'events')).toEqual([
      { table: 'events', op: 'rpc', fn: 'set_event_doelstelling', args: { p_event_id: 'e1', p_doelstelling: 'Positiespel oefenen' } },
    ])
  })
})

describe('AC45 — periodisering (deleteCyclusWeekCorrectie)', () => {
  it('een assistent zonder periodiseringsrecht krijgt "Geen toegang" en er wordt niets in settings verwijderd', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { periodisering: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
    })
    useSupabase(m)

    await expect(deleteCyclusWeekCorrectie()).rejects.toThrow('Geen toegang')
    // De settings-tabel wordt door de context zelf al met SELECT bevraagd
    // (team_name); dit bewijst specifiek dat er geen DELETE plaatsvond.
    expect(m.calls.filter((c) => c.table === 'settings' && c.op === 'delete')).toHaveLength(0)
  })

  it('een assistent MET periodiseringsrecht kan de cyclusweek-correctie wissen', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { periodisering: true })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
    })
    useSupabase(m)

    await expect(deleteCyclusWeekCorrectie()).resolves.toBeUndefined()
    expect(m.calls.filter((c) => c.table === 'settings' && c.op === 'delete')).toEqual([
      { table: 'settings', op: 'delete' },
    ])
  })
})

// ════════════════════════════════════════════════════════════════════════
// Ronde 2 — addendum §8: updateGatherTime → wedstrijd, updateTrainingstype →
// training (niet meer agenda). Beide lopen nu via een kolom-begrensde RPC
// (de events-policy blijft 'agenda'); dit dekt tegelijk addendum §8.7's eis
// dat de RPC met exact de verwachte parameternamen wordt aangeroepen.
// ════════════════════════════════════════════════════════════════════════

describe('AC45 (addendum §8) — wedstrijd: updateGatherTime', () => {
  it('een assistent zonder wedstrijdrecht krijgt "Geen toegang" — agendarecht alléén is niet meer genoeg', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      // Bewust WEL agenda, GEEN wedstrijd: vóór addendum §8 was dit genoeg.
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { agenda: true, wedstrijd: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { events: [{ id: 'e1', team_id: TEAM_A, type: 'match' }] },
    })
    useSupabase(m)

    await expect(updateGatherTime('e1', '19:30')).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'events')).toHaveLength(0)
  })

  it('een assistent MET wedstrijdrecht zet de verzameltijd via de RPC set_gather_time, met exact de verwachte parameternamen', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { wedstrijd: true })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { events: [{ id: 'e1', team_id: TEAM_A, type: 'match' }] },
    })
    useSupabase(m)

    await expect(updateGatherTime('e1', '19:30')).resolves.toBeUndefined()
    expect(schrijfCalls(m.calls, 'events')).toEqual([
      { table: 'events', op: 'rpc', fn: 'set_gather_time', args: { p_event_id: 'e1', p_gather_time: '19:30' } },
    ])
  })
})

describe('AC45 (addendum §8) — training: updateTrainingstype', () => {
  it('een assistent zonder trainingsrecht krijgt "Geen toegang" — agendarecht alléén is niet meer genoeg', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { agenda: true, training: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { events: [{ id: 'e1', team_id: TEAM_A, type: 'training' }] },
    })
    useSupabase(m)

    await expect(updateTrainingstype('e1', 'vct')).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'events')).toHaveLength(0)
  })

  it('een assistent MET trainingsrecht zet het trainingstype via de RPC set_trainingstype, met exact de verwachte parameternamen', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { training: true })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { events: [{ id: 'e1', team_id: TEAM_A, type: 'training' }] },
    })
    useSupabase(m)

    await expect(updateTrainingstype('e1', 'vct')).resolves.toBeUndefined()
    expect(schrijfCalls(m.calls, 'events')).toEqual([
      { table: 'events', op: 'rpc', fn: 'set_trainingstype', args: { p_event_id: 'e1', p_trainingstype: 'vct' } },
    ])
  })
})

// ════════════════════════════════════════════════════════════════════════
// Validator ronde 1, punt 7 — weigeringstest in élk van de nog ongedekte
// bestanden (players/settings/team-logo/team-colors waren al gedekt; agenda/
// aanwezigheid/wedstrijd/training/periodisering al gedekt hierboven). Dit
// blok vult aan: events (createEvent), events-bulk, attendance (afmeldperiode),
// match-analysis, todos, training-plan (koppeling toevoegen). match-squad was
// al gedekt (AC45 hierboven).
// ════════════════════════════════════════════════════════════════════════

function eventForm(fields: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('type', 'training')
  fd.set('date', '2026-01-01')
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('Validator punt 7 — events (createEvent)', () => {
  it('een assistent zonder agendarecht krijgt "Geen toegang" en er wordt niets in events of attendance geschreven', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { agenda: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { players: [], absence_periods: [] },
    })
    useSupabase(m)

    await expect(createEvent(eventForm())).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'events')).toHaveLength(0)
    expect(schrijfCalls(m.calls, 'attendance')).toHaveLength(0)
  })
})

describe('Validator punt 7 — events-bulk (createBulkMatches)', () => {
  it('een assistent zonder agendarecht krijgt "Geen toegang" vóórdat de invoer zelfs maar gevalideerd wordt', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { agenda: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { events: [] },
    })
    useSupabase(m)

    // Bewust een lege array: assertCanEdit is de EERSTE check, vóór de
    // "geen wedstrijden om op te slaan"-validatie. Faalt de test op de
    // validatiemelding i.p.v. 'Geen toegang', dan is die volgorde omgedraaid.
    await expect(createBulkMatches([])).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'events')).toHaveLength(0)
  })
})

describe('Validator punt 7 — attendance (afmeldperiode: markAbsentForPeriod)', () => {
  it('een assistent zonder aanwezigheidsrecht krijgt "Geen toegang" en er wordt geen afmeldperiode aangemaakt', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { aanwezigheid: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { players: [{ id: 'p1', team_id: TEAM_A }], absence_periods: [], events: [] },
    })
    useSupabase(m)

    await expect(markAbsentForPeriod('p1', '2026-01-01', '2026-01-07')).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'absence_periods')).toHaveLength(0)
  })
})

describe('Validator punt 7 — match-analysis (saveMatchResult)', () => {
  it('een assistent zonder wedstrijdrecht krijgt "Geen toegang" en de RPC set_match_result wordt niet aangeroepen', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { wedstrijd: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { events: [{ id: 'e1', team_id: TEAM_A, type: 'match' }] },
    })
    useSupabase(m)

    await expect(saveMatchResult('e1', 2, 1)).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'events')).toHaveLength(0)
  })

  it('een assistent MET wedstrijdrecht roept set_match_result aan met exact de verwachte parameternamen, ná clampGoals', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { wedstrijd: true })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { events: [{ id: 'e1', team_id: TEAM_A, type: 'match' }] },
    })
    useSupabase(m)

    await expect(saveMatchResult('e1', 120, -3)).resolves.toBeUndefined()
    expect(schrijfCalls(m.calls, 'events')).toEqual([
      // 120 -> geklemd op 99, -3 -> geklemd op 0 (lib/match-analysis.mjs clampGoals).
      { table: 'events', op: 'rpc', fn: 'set_match_result', args: { p_event_id: 'e1', p_goals_for: 99, p_goals_against: 0 } },
    ])
  })
})

describe('Validator punt 7 — todos (markTaskDone)', () => {
  it('een assistent zonder trainingsrecht krijgt "Geen toegang" bij een training_plan-taak en er wordt niets in task_overrides geschreven', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { training: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { events: [{ id: 'e1', team_id: TEAM_A }], task_overrides: [] },
    })
    useSupabase(m)

    await expect(markTaskDone('e1', 'training_plan')).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'task_overrides')).toHaveLength(0)
  })

  it('een assistent zonder wedstrijdrecht krijgt "Geen toegang" bij een squad-taak (niet training_plan) — ander onderdeel, zelfde guard', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { wedstrijd: false, training: true })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: { events: [{ id: 'e1', team_id: TEAM_A }], task_overrides: [] },
    })
    useSupabase(m)

    await expect(markTaskDone('e1', 'squad')).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'task_overrides')).toHaveLength(0)
  })
})

describe('Validator punt 7 — training-plan (koppeling toevoegen: addOefeningToTraining)', () => {
  it('een assistent zonder trainingsrecht krijgt "Geen toegang" en er wordt niets in training_oefeningen geschreven', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { training: false })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: {
        events: [{ id: 'e1', team_id: TEAM_A }],
        oefeningen: [{ id: 'oef1', team_id: TEAM_A, duur_min: 30 }],
        training_oefeningen: [],
      },
    })
    useSupabase(m)

    await expect(addOefeningToTraining('e1', 'oef1')).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'training_oefeningen')).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// Validator ronde 1, punt 6 — ctx.teamId !== ctx.userId. Elke fixture
// hieronder gebruikt bewust TWEE VERSCHILLENDE id's; slaagt de test, dan kan
// dat alleen doordat de productiecode ECHT ctx.teamId (resp. ctx.userId voor
// oefeningen) gebruikt — met de verkeerde id zou de fixture-rij niet
// matchen (geen effect) of, bij addOefeningToTraining, de oefening niet
// gevonden worden.
// ════════════════════════════════════════════════════════════════════════

const TEAM_X = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' // ctx.teamId
const USER_Y = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' // ctx.userId — bewust ANDERS dan TEAM_X

describe('Validator punt 6 — ctx.teamId !== ctx.userId, per onderdeel', () => {
  it('spelers (createPlayer): de nieuwe speler krijgt team_id = ctx.teamId, niet ctx.userId', async () => {
    const m = makeSupabase({
      user: { id: USER_Y },
      members: [memberRow(TEAM_X, USER_Y, 'assistent', { spelers: true })],
      settings: [teamNameRow(TEAM_X, 'JO13-1')],
      tables: { players: [] },
    })
    useSupabase(m)
    const fd = new FormData()
    fd.set('name', 'Nieuwe Speler')
    fd.set('position', 'Keeper')

    await expect(createPlayer(fd)).resolves.toBeUndefined()
    expect(m.store.players).toHaveLength(1)
    expect(m.store.players[0].team_id).toBe(TEAM_X)
    expect(m.store.players[0].team_id).not.toBe(USER_Y)
  })

  it('agenda (deleteEvent): verwijdert alléén de rij met team_id = ctx.teamId', async () => {
    const m = makeSupabase({
      user: { id: USER_Y },
      members: [memberRow(TEAM_X, USER_Y, 'assistent', { agenda: true })],
      settings: [teamNameRow(TEAM_X, 'JO13-1')],
      tables: { events: [{ id: 'e1', team_id: TEAM_X }] },
    })
    useSupabase(m)

    await expect(deleteEvent('e1')).resolves.toBeUndefined()
    // Was het filter per ongeluk ctx.userId geweest, dan had TEAM_X !== USER_Y
    // de rij niet gematcht en zou hij hier nog steeds staan.
    expect(m.store.events).toHaveLength(0)
  })

  it('aanwezigheid (markAllPresent): update raakt alleen de rij met team_id = ctx.teamId', async () => {
    const m = makeSupabase({
      user: { id: USER_Y },
      members: [memberRow(TEAM_X, USER_Y, 'assistent', { aanwezigheid: true })],
      settings: [teamNameRow(TEAM_X, 'JO13-1')],
      tables: { attendance: [{ event_id: 'e1', team_id: TEAM_X, status: 'absent' }] },
    })
    useSupabase(m)

    await expect(markAllPresent('e1')).resolves.toBeUndefined()
    expect(m.store.attendance[0].status).toBe('present')
  })

  it('wedstrijd (toggleSquadPlayer): verwijdert alléén de match_squad-rij met team_id = ctx.teamId', async () => {
    const m = makeSupabase({
      user: { id: USER_Y },
      members: [memberRow(TEAM_X, USER_Y, 'assistent', { wedstrijd: true })],
      settings: [teamNameRow(TEAM_X, 'JO13-1')],
      tables: {
        events: [{ id: 'e1', team_id: TEAM_X, type: 'match' }],
        players: [{ id: 'p1', team_id: TEAM_X }],
        match_squad: [{ event_id: 'e1', player_id: 'p1', team_id: TEAM_X }],
      },
    })
    useSupabase(m)

    await expect(toggleSquadPlayer('e1', 'p1', false)).resolves.toBeUndefined()
    expect(m.store.match_squad).toHaveLength(0)
  })

  it('periodisering (deleteCyclusWeekCorrectie): verwijdert alléén de settings-rij met team_id = ctx.teamId', async () => {
    const m = makeSupabase({
      user: { id: USER_Y },
      members: [memberRow(TEAM_X, USER_Y, 'assistent', { periodisering: true })],
      settings: [teamNameRow(TEAM_X, 'JO13-1'), { team_id: TEAM_X, key: 'cyclus_week_correctie', value: '3' }],
    })
    useSupabase(m)

    await expect(deleteCyclusWeekCorrectie()).resolves.toBeUndefined()
    expect(m.store.settings.some((r) => r.key === 'cyclus_week_correctie')).toBe(false)
  })

  it('training (addOefeningToTraining) + oefeningen: de koppeling krijgt team_id = ctx.teamId, de oefening wordt gevonden via ctx.userId (niet ctx.teamId)', async () => {
    const m = makeSupabase({
      user: { id: USER_Y },
      members: [memberRow(TEAM_X, USER_Y, 'assistent', { training: true })],
      settings: [teamNameRow(TEAM_X, 'JO13-1')],
      tables: {
        events: [{ id: 'e1', team_id: TEAM_X }],
        // De oefening staat op team_id = USER_Y (eigenaar-user, geen teams.id).
        // Zou addOefeningToTraining per ongeluk ctx.teamId gebruiken om de
        // oefening op te zoeken, dan matcht TEAM_X !== USER_Y niet en volgt
        // 'Oefening niet gevonden' — de test slaagt dus alléén als de code
        // hier echt ctx.userId gebruikt.
        oefeningen: [{ id: 'oef1', team_id: USER_Y, duur_min: 30 }],
        training_oefeningen: [],
      },
    })
    useSupabase(m)

    await expect(addOefeningToTraining('e1', 'oef1')).resolves.toBeUndefined()

    const koppeling = m.store.training_oefeningen[0]
    expect(koppeling.team_id).toBe(TEAM_X)
    expect(koppeling.team_id).not.toBe(USER_Y)
  })
})

// ════════════════════════════════════════════════════════════════════════
// Addendum §8.7 — createEvent rolt terug bij een mislukte attendance-insert
// (geen half event): het net gemaakte event wordt verwijderd en de action
// gooit zichtbaar, in plaats van de fout te negeren (dit was vóór het
// addendum een stil-falen-bug).
// ════════════════════════════════════════════════════════════════════════

describe('Addendum §8.7 — createEvent: rollback bij mislukte attendance-insert', () => {
  it('draait het net gemaakte event terug (tenant-gescoped) en gooit zichtbaar — geen half event, geen redirect', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', { agenda: true })],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
      tables: {
        players: [{ id: 'p1', team_id: TEAM_A, active: true, injured: false, type: 'regular' }],
        absence_periods: [],
      },
      failInsert: { table: 'attendance', error: { message: 'insert failed', code: '23502' } },
    })
    useSupabase(m)

    await expect(createEvent(eventForm())).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    // Geen half event: de net aangemaakte events-rij is weer weg.
    expect(m.store.events).toHaveLength(0)
    // Er werd wél een insert-poging op attendance gedaan (die faalde) — geen
    // stil overgeslagen actie.
    expect(m.calls.some((c) => c.table === 'attendance' && c.op === 'insert')).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════
// Validator ronde 1, punt 8 — faalpaden van signUp. lib/team-context.test.ts
// dekt "zelfherstel bij nul lidmaatschappen" al grondig op UNIT-niveau (9
// tests, chainable stub die filters niet toepast) en app/actions/auth.test.ts
// dekt de harde fouten op teams/team_members al op actionniveau. Dit blok
// vult uitsluitend aan op ACCEPTATIENIVEAU: dezelfde paden, maar tegen de
// ECHT filterende tabel-engine van dit bestand, via de publieke functies
// (signUp, getTeamContext) — geen enkele van onderstaande scenario's stond al
// in dit bestand.
// ════════════════════════════════════════════════════════════════════════

describe('Validator punt 8 — signUp: tak zonder sessie', () => {
  it('zet de teamnaam-metadata, maakt GEEN team aan en geeft GEEN foutmelding — het account is niet stuk (validatorpunt 1)', async () => {
    const inserts: { table: string }[] = []
    const signUpCalls: { email: string; password: string; options?: { data?: Record<string, unknown> } }[] = []
    const supabase = {
      auth: {
        getUser: async () => ({ data: { user: null } }),
        signUp: async (creds: { email: string; password: string; options?: { data?: Record<string, unknown> } }) => {
          signUpCalls.push(creds)
          return { data: { user: { id: TEAM_A }, session: null }, error: null }
        },
      },
      from: (table: string) => ({ insert: () => { inserts.push({ table }); return Promise.resolve({ data: null, error: null }) } }),
    }
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>)
    const fd = new FormData()
    fd.set('email', 'coach@example.com')
    fd.set('password', 'correct-horse-battery')
    fd.set('team_name', 'JO13-1')

    const result = await signUp(null, fd)

    expect(result?.error).toContain('Bevestig eerst je e-mailadres')
    expect(inserts).toHaveLength(0) // geen teams/team_members/settings-insert
    // De teamnaam gaat als user-metadata mee, zodat het zelfherstel hem later
    // kan gebruiken (TEAM_NAAM_METADATA_KEY, lib/team-context.ts).
    expect(signUpCalls[0]?.options?.data).toEqual({ [TEAM_NAAM_METADATA_KEY]: 'JO13-1' })
  })
})

describe('Validator punt 8 — zelfherstel via getTeamContext() (acceptatieniveau, echte tabel-engine)', () => {
  function userMetUser(userId: string, teamNaam: string | undefined): { id: string; user_metadata?: Record<string, unknown> } {
    return teamNaam === undefined
      ? { id: userId }
      : { id: userId, user_metadata: { [TEAM_NAAM_METADATA_KEY]: teamNaam } }
  }

  it('maakt bij de eerste context MET de metadata-vlag alsnog het team aan (teams, team_members, settings)', async () => {
    const m = makeSupabase({
      user: userMetUser(TEAM_A, 'JO13-1'),
      members: [],
      settings: [],
      tables: { teams: [] },
    })
    // maakEigenTeam wist de vlag via auth.updateUser() als laatste stap.
    ;(m.supabase.auth as unknown as { updateUser: () => Promise<{ data: object; error: null }> }).updateUser =
      async () => ({ data: {}, error: null })
    useSupabase(m)

    const ctx = await getTeamContext()

    expect(ctx?.teamId).toBe(TEAM_A)
    expect(ctx?.rol).toBe('owner')
    expect(m.store.teams).toEqual([{ id: TEAM_A }])
    expect(m.store.team_members.some((r) => r.team_id === TEAM_A && r.user_id === TEAM_A && r.rol === 'owner')).toBe(true)
    expect(m.store.settings.some((r) => r.team_id === TEAM_A && r.key === 'team_name' && r.value === 'JO13-1')).toBe(true)
  })

  it('maakt GEEN team aan zonder de metadata-vlag — nul lidmaatschappen blijft nul lidmaatschappen', async () => {
    const m = makeSupabase({
      user: userMetUser(TEAM_A, undefined),
      members: [],
      settings: [],
      tables: { teams: [] },
    })
    useSupabase(m)

    const ctx = await getTeamContext()

    expect(ctx).toBeNull()
    expect(m.store.teams).toHaveLength(0)
    expect(m.store.team_members).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC28/42 — teambrede instellingen weigeren ALTIJD een assistent, ook met
// alle zes rechten (owner-only, al in fase 1 afdwingbaar op applicatieniveau)
// ════════════════════════════════════════════════════════════════════════

describe('AC28/42 — owner-only acties weigeren een assistent met alle zes rechten', () => {
  it('saveTeamColor weigert een assistent met ALLE rechten', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
    })
    useSupabase(m)

    const result = await saveTeamColor('primary', '#112233')

    expect(result.error).toBeTruthy()
    expect(result.error).toContain('hoofdtrainer')
    expect(schrijfCalls(m.calls, 'settings')).toHaveLength(0)
  })

  it('uploadTeamLogo weigert een assistent met ALLE rechten (vóór enige bestandscontrole)', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
    })
    useSupabase(m)

    // Lege FormData zonder 'logo': zou bij het bereiken van de bestandscheck
    // een ANDERE melding geven ("Kies een afbeelding..."). De melding hieronder
    // bewijst dus dat de permissiecheck als eerste wordt bereikt.
    const result = await uploadTeamLogo(new FormData())

    expect(result.error).toBeTruthy()
    expect(result.error).toContain('hoofdtrainer')
  })

  it('saveSettings (default_attendance) weigert een assistent met ALLE rechten', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'assistent', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
    })
    useSupabase(m)

    const fd = new FormData()
    fd.set('default_attendance', 'present')

    await expect(saveSettings(fd)).rejects.toThrow('Geen toegang')
    expect(schrijfCalls(m.calls, 'settings')).toHaveLength(0)
  })

  it('saveTeamColor slaagt wél voor de owner', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
    })
    useSupabase(m)

    const result = await saveTeamColor('primary', '#112233')

    expect(result.error).toBeNull()
    expect(schrijfCalls(m.calls, 'settings')).toEqual([{ table: 'settings', op: 'upsert' }])
  })
})

// ════════════════════════════════════════════════════════════════════════
// "AC38" (opdrachttekst) — deleteAccount: volledige tabellijst + owner-guard
// ════════════════════════════════════════════════════════════════════════

describe('deleteAccount — fase-1-deel van de opruiming', () => {
  function makeAdmin() {
    const deleteUser = vi.fn(async () => ({ data: null, error: null }))
    return { admin: { auth: { admin: { deleteUser } } }, deleteUser }
  }

  const VOLLEDIGE_TABELLIJST = [
    'oefeningen',
    'training_oefeningen', 'task_overrides', 'match_squad', 'match_events',
    'match_ratings', 'lineups', 'attendance', 'absence_periods',
    'categorie_metingen', 'metingen', 'events', 'players', 'settings',
    'teams',
  ]

  it('wist als owner de volledige tabellijst (incl. categorie_metingen), sluit af met de teams-rij, en verwijdert het auth-account', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
    })
    useSupabase(m)
    const { admin, deleteUser } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow('__redirect__:/login')

    expect(m.calls.filter((c) => c.op === 'delete').map((c) => c.table)).toEqual(VOLLEDIGE_TABELLIJST)
    expect(deleteUser).toHaveBeenCalledWith(TEAM_A)
  })

  it('categorie_metingen wordt WEL gewist — dit is het expliciete gat uit de researcher-briefing dat de brief dichtte', async () => {
    const m = makeSupabase({
      user: { id: TEAM_A },
      members: [memberRow(TEAM_A, TEAM_A, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
    })
    useSupabase(m)
    const { admin } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow('__redirect__:/login')

    expect(m.calls.filter((c) => c.op === 'delete').map((c) => c.table)).toContain('categorie_metingen')
  })

  it('de owner-guard laat de teamdata ONGEMOEID wanneer de actieve rol geen owner is — alleen de eigen oefeningen en het account zelf worden dan nog verwijderd', async () => {
    // Fase 1 heeft geen assistenten (die komen in fase 2), maar de guard in
    // deleteAccount zelf bestaat al nu (06-backend-fase1-samenvatting.md §6.5:
    // "Wel al een ctx.rol === 'owner'-guard.") en is dus nu al testbaar.
    const m = makeSupabase({
      user: { id: ANDERE_USER },
      members: [memberRow(TEAM_A, ANDERE_USER, 'assistent', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'JO13-1')],
    })
    useSupabase(m)
    const { admin, deleteUser } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow('__redirect__:/login')

    const verwijderdeTabellen = m.calls.filter((c) => c.op === 'delete').map((c) => c.table)
    expect(verwijderdeTabellen).toEqual(['oefeningen']) // alleen het persoonlijke bezit, geen teamtabel
    expect(verwijderdeTabellen).not.toContain('teams')
    expect(verwijderdeTabellen).not.toContain('categorie_metingen')
    expect(deleteUser).toHaveBeenCalledWith(ANDERE_USER) // het account zelf verdwijnt nog wel (AVG)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC45 — RLS-laag: niet in vitest te dekken (brief §5.1)
// ════════════════════════════════════════════════════════════════════════

describe('AC45 — RLS-laag: niet netjes in vitest te dekken', () => {
  it('NIET GEDEKT DOOR VITEST — verificatie loopt via supabase/team-rls-verificatie.sql; dit is alleen een structuurcontrole dat dat bestand bestaat, een niet-schrijvende begin…rollback-transactie is, en de 13 blokken uit §5.1 + addendum §8.7 bevat', () => {
    // Vitest praat nooit met een echte database en kan dus niets over RLS-
    // policies bewijzen (brief §5.1). Deze test controleert UITSLUITEND dat
    // het handmatige verificatiescript bestaat en de verwachte structuur heeft
    // — geen vervanging van het handmatig draaien ervan in de SQL Editor.
    // Ronde 2: het script is uitgebreid van 6 naar 13 blokken (addendum §8.7 —
    // vier nieuwe blokken voor de attendance-verruiming/RPC's, plus de
    // permanente sanity-check "geen team zonder hoofdtrainer" uit §8.6).
    const pad = path.resolve(__dirname, 'supabase', 'team-rls-verificatie.sql')
    const inhoud = readFileSync(pad, 'utf8')

    expect(inhoud).toMatch(/^begin;/m)
    expect(inhoud).toMatch(/^rollback;/m)

    const blokken = inhoud.match(/^do \$\$/gm) ?? []
    expect(blokken.length).toBeGreaterThanOrEqual(13)

    for (let i = 1; i <= 13; i++) {
      expect(inhoud).toContain(`Blok ${i}`)
    }

    // Blok 7 (spelers-only) moet het bewust aanvaarde restrisico uit brief
    // §8.2 expliciet vastleggen als "aanvaard", niet als stilzwijgend lek —
    // én moet hard alarmeren als iemand het ooit ongemerkt dichttimmert.
    expect(inhoud).toMatch(/aanvaarde restrisico/i)
    expect(inhoud).toContain('ONVERWACHT: het aanvaarde restrisico is dichtgetimmerd')
  })
})
