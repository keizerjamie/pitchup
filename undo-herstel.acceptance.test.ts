// Acceptatietests — UX-details fase 4 (UT): "Ongedaan maken" via
// herstel-snapshots (brief §3 #1–#8, §5; Jamies antwoorden V-A, V-B, V-C).
//
// ── Testmethode ──
// De ECHTE server actions (delete → herstel) draaien tegen een ECHT
// FILTERENDE Supabase-tabel-engine (eigen kopie per bestand, project-conventie
// — geheugen.md "Testmocks bestaan in twee smaken"). Bovenop de gebruikelijke
// engine bootst deze kopie de databasekenmerken na waar het herstel op leunt:
//   - primaire sleutel `id` → een dubbele insert geeft 23505;
//   - UNIQUE (team_id, categorie, datum) op categorie_metingen;
//   - ON DELETE SET NULL voor attendance.absence_period_id en
//     training_oefeningen.genest_in;
//   - `.order()` en `.limit()` worden echt toegepast (assertNieuwsteMeting);
//   - embedded `oefeningen(...)` in een select op training_oefeningen;
//   - fout-injectie per tabel/operatie, voor het compensatiepad.
// team_id ≠ user.id in elk scenario. Wat hier NIET te bewijzen is: RLS
// (oefening_koppelbaar, can_edit) — dat blijft supabase/team-rls-verificatie.sql.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { ACTIVE_TEAM_COOKIE } from '@/lib/team-context'
import { deleteCategorieMeting, herstelCategorieMeting, saveCategorieMeting } from '@/app/actions/periodisering'
import { deleteMatchEvent, herstelWedstrijdMoment } from '@/app/actions/match-analysis'
import { herstelAfmeldperiode, revokeAbsencePeriod, updateAttendance } from '@/app/actions/attendance'
import { herstelKoppeling, removeOefeningFromTraining } from '@/app/actions/training-plan'

// ────────────────────────────────────────────────
// Tabel-engine
// ────────────────────────────────────────────────
type Row = Record<string, unknown>
type Store = Record<string, Row[]>
type Op = 'insert' | 'update' | 'delete'
type Faal = (op: Op, table: string, payload: Row | null) => { code: string; message: string } | null

let genTeller = 0

// UNIQUE-sleutels naast de primaire sleutel `id`.
const UNIQUE: Record<string, string[][]> = {
  categorie_metingen: [['team_id', 'categorie', 'datum']],
}

// ON DELETE SET NULL: verwijderen uit `bron` zet `kolom` in `tabel` op null.
const SET_NULL: { bron: string; tabel: string; kolom: string }[] = [
  { bron: 'absence_periods', tabel: 'attendance', kolom: 'absence_period_id' },
  { bron: 'training_oefeningen', tabel: 'training_oefeningen', kolom: 'genest_in' },
]

function maakEngine(store: Store, faal: { fn: Faal | null }) {
  function tabel(naam: string) {
    if (!store[naam]) store[naam] = []
    return store[naam]
  }

  return (naam: string) => {
    const rows = tabel(naam)
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; asc: boolean }[] = []
    let limiet: number | null = null
    let embed: string | null = null
    let pendingInsert: Row[] | null = null
    let pendingUpsert: { rij: Row; sleutel: string[] } | null = null
    let pendingUpdate: Row | null = null
    let pendingDelete = false

    const matched = () => {
      let out = rows.filter((r) => filters.every((f) => f(r)))
      if (orders.length) {
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const av = a[o.col] as string | number
            const bv = b[o.col] as string | number
            if (av === bv) continue
            return (av < bv ? -1 : 1) * (o.asc ? 1 : -1)
          }
          return 0
        })
      }
      if (limiet !== null) out = out.slice(0, limiet)
      if (embed) {
        const oef = tabel('oefeningen')
        out = out.map((r) => ({ ...r, [embed!]: oef.find((o) => o.id === r.oefening_id) ?? null }))
      }
      // Kopieën, net als een echte database: een gelezen rij verandert niet
      // mee met een latere update.
      return structuredClone(out)
    }

    const voerUit = (): { data: unknown; error: unknown } => {
      if (pendingUpsert) {
        const { rij, sleutel } = pendingUpsert
        const fout = faal.fn?.('insert', naam, rij) ?? null
        if (fout) return { data: null, error: fout }
        const bestaand = rows.find((r) => sleutel.every((k) => r[k] === rij[k]))
        if (bestaand) Object.assign(bestaand, rij)
        else rows.push({ id: `gen-${genTeller++}`, created_at: '2026-10-25T12:30:00+00:00', ...rij })
        return { data: null, error: null }
      }
      if (pendingInsert) {
        const fout = faal.fn?.('insert', naam, pendingInsert[0]) ?? null
        if (fout) return { data: null, error: fout }
        for (const item of pendingInsert) {
          if (rows.some((r) => r.id === item.id)) return { data: null, error: { code: '23505', message: 'pk' } }
          for (const sleutel of UNIQUE[naam] ?? []) {
            if (rows.some((r) => sleutel.every((k) => r[k] === item[k]))) {
              return { data: null, error: { code: '23505', message: 'unique' } }
            }
          }
        }
        rows.push(...pendingInsert)
        return { data: pendingInsert, error: null }
      }
      const raak = matched()
      if (pendingUpdate) {
        const fout = faal.fn?.('update', naam, pendingUpdate) ?? null
        if (fout) return { data: null, error: fout }
        for (const r of rows.filter((x) => filters.every((f) => f(x)))) Object.assign(r, pendingUpdate)
        return { data: null, error: null }
      }
      if (pendingDelete) {
        const fout = faal.fn?.('delete', naam, null) ?? null
        if (fout) return { data: null, error: fout }
        const weg = rows.filter((x) => filters.every((f) => f(x)))
        for (const r of weg) rows.splice(rows.indexOf(r), 1)
        for (const fk of SET_NULL.filter((x) => x.bron === naam)) {
          for (const r of tabel(fk.tabel)) if (weg.some((w) => w.id === r[fk.kolom])) r[fk.kolom] = null
        }
        return { data: null, error: null }
      }
      return { data: raak, error: null }
    }

    const chain: Record<string, unknown> = {}
    chain.select = (cols?: string) => {
      const m = typeof cols === 'string' ? /(\w+)\(/.exec(cols) : null
      if (m) embed = m[1]
      return chain
    }
    chain.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return chain }
    chain.neq = (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return chain }
    chain.is = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return chain }
    chain.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return chain }
    chain.gte = (c: string, v: string) => { filters.push((r) => (r[c] as string) >= v); return chain }
    chain.lte = (c: string, v: string) => { filters.push((r) => (r[c] as string) <= v); return chain }
    chain.order = (c: string, o?: { ascending?: boolean }) => { orders.push({ col: c, asc: o?.ascending !== false }); return chain }
    chain.limit = (n: number) => { limiet = n; return chain }
    chain.insert = (p: Row | Row[]) => {
      pendingInsert = (Array.isArray(p) ? p : [p]).map((x) => ({
        id: x.id ?? `gen-${genTeller++}`,
        created_at: x.created_at ?? `2026-10-25T12:00:${String(genTeller++ % 60).padStart(2, '0')}+00:00`,
        ...x,
      }))
      return chain
    }
    chain.upsert = (p: Row, o?: { onConflict?: string }) => {
      pendingUpsert = { rij: p, sleutel: (o?.onConflict ?? 'id').split(',') }
      return chain
    }
    chain.update = (p: Row) => { pendingUpdate = p; return chain }
    chain.delete = () => { pendingDelete = true; return chain }
    chain.maybeSingle = () => {
      const res = voerUit()
      const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data
      return Promise.resolve({ data, error: res.error })
    }
    chain.single = chain.maybeSingle
    ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(voerUit())
    return chain
  }
}

// ────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────
const TEAM = '11111111-1111-4111-8111-111111111111'
const ANDER_TEAM = '22222222-2222-4222-8222-222222222222'
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ANDERE_USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const P1 = '0b000000-0000-4000-8000-000000000001'
const P2 = '0b000000-0000-4000-8000-000000000002'
const E1 = '0e000000-0000-4000-8000-000000000001'
const E2 = '0e000000-0000-4000-8000-000000000002'
const E3 = '0e000000-0000-4000-8000-000000000003'
const E4 = '0e000000-0000-4000-8000-000000000004'

let store: Store
const faal: { fn: Faal | null } = { fn: null }
let cookieWaarde: string | undefined

function installeer(extra: Store, leden: Row[] = [{ team_id: TEAM, user_id: USER, rol: 'owner' }]) {
  store = { team_members: leden, settings: [], ...extra }
  const from = maakEngine(store, faal)
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from,
  } as unknown as Awaited<ReturnType<typeof createClient>>)
}

// Diepe kopie van een tabel, zonder volgorde-afhankelijkheid.
function kopie(tabel: string): Row[] {
  return JSON.parse(JSON.stringify(store[tabel] ?? [])).sort((a: Row, b: Row) => String(a.id).localeCompare(String(b.id)))
}

beforeEach(() => {
  vi.clearAllMocks()
  genTeller = 0
  faal.fn = null
  cookieWaarde = undefined
  vi.mocked(cookies).mockResolvedValue({
    get: (n: string) => (n === ACTIVE_TEAM_COOKIE && cookieWaarde !== undefined ? { value: cookieWaarde } : undefined),
    set: () => {},
  } as unknown as Awaited<ReturnType<typeof cookies>>)
})

// ────────────────────────────────────────────────
// Nulmeting
// ────────────────────────────────────────────────
describe('Nulmeting: verwijderen → herstellen', () => {
  const M_OUD = '0c000000-0000-4000-8000-000000000001'
  const M_NIEUW = '0c000000-0000-4000-8000-000000000002'

  function metGeschiedenis() {
    installeer({
      categorie_metingen: [
        { id: M_OUD, team_id: TEAM, categorie: 'partijen_klein', datum: '2026-07-01', stap: 2, notes: null, created_at: '2026-07-01T08:00:00+00:00' },
        { id: M_NIEUW, team_id: TEAM, categorie: 'partijen_klein', datum: '2026-08-01', stap: 5, notes: 'fris', created_at: '2026-08-01T08:00:00+00:00' },
        // Zelfde id-ruimte, ander team: mag nooit geraakt worden.
        { id: '0c000000-0000-4000-8000-0000000000ff', team_id: ANDER_TEAM, categorie: 'partijen_klein', datum: '2026-08-01', stap: 9, notes: null, created_at: '2026-08-01T08:00:00+00:00' },
      ],
    })
  }

  it('zet de nieuwste meting inhoudelijk gelijk terug (id, stap, notes, created_at)', async () => {
    metGeschiedenis()
    const voor = kopie('categorie_metingen')
    const herstel = await deleteCategorieMeting(M_NIEUW)
    expect(store.categorie_metingen.some((r) => r.id === M_NIEUW)).toBe(false)

    await herstelCategorieMeting(herstel)
    expect(kopie('categorie_metingen')).toEqual(voor)
  })

  it('dubbel herstel levert één rij op', async () => {
    metGeschiedenis()
    const herstel = await deleteCategorieMeting(M_NIEUW)
    await herstelCategorieMeting(herstel)
    await herstelCategorieMeting(herstel)
    expect(store.categorie_metingen.filter((r) => r.id === M_NIEUW)).toHaveLength(1)
  })

  it('herstel naast een intussen nieuwere meting wordt een geschiedenisrij', async () => {
    metGeschiedenis()
    const herstel = await deleteCategorieMeting(M_NIEUW)
    await saveCategorieMeting({ categorie: 'partijen_klein', datum: '2026-09-01', stap: 7, notes: null })
    await herstelCategorieMeting(herstel)
    const eigen = store.categorie_metingen.filter((r) => r.team_id === TEAM).map((r) => r.datum).sort()
    expect(eigen).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
  })

  it('weigert als er intussen een andere meting op dezelfde datum staat', async () => {
    metGeschiedenis()
    const herstel = await deleteCategorieMeting(M_NIEUW)
    await saveCategorieMeting({ categorie: 'partijen_klein', datum: '2026-08-01', stap: 3, notes: null })
    await expect(herstelCategorieMeting(herstel)).rejects.toThrow('Herstel niet mogelijk')
    expect(store.categorie_metingen.some((r) => r.id === M_NIEUW)).toBe(false)
  })
})

// ────────────────────────────────────────────────
// Doelpunt/kaart
// ────────────────────────────────────────────────
describe('Wedstrijdmoment: verwijderen → herstellen', () => {
  const MOMENT = '0d000000-0000-4000-8000-000000000001'

  function metMoment(leden?: Row[]) {
    installeer({
      events: [{ id: E1, team_id: TEAM, date: '2026-10-20', type: 'match' }],
      players: [{ id: P1, team_id: TEAM, type: 'regular' }],
      match_events: [
        { id: MOMENT, team_id: TEAM, event_id: E1, player_id: P1, kind: 'yellow', minute: 37, created_at: '2026-10-20T15:37:00+00:00' },
      ],
    }, leden)
  }

  it('zet het moment inhoudelijk gelijk terug', async () => {
    metMoment()
    const voor = kopie('match_events')
    const herstel = await deleteMatchEvent(MOMENT, E1)
    expect(store.match_events).toHaveLength(0)
    await herstelWedstrijdMoment(herstel)
    expect(kopie('match_events')).toEqual(voor)
  })

  it('teamwissel tussen verwijderen en herstellen: snapshot van het andere team wordt geweigerd, niets geschreven (V-C)', async () => {
    const leden = [
      { team_id: TEAM, user_id: USER, rol: 'owner' },
      { team_id: ANDER_TEAM, user_id: USER, rol: 'owner' },
    ]
    metMoment(leden)
    cookieWaarde = TEAM
    const herstel = await deleteMatchEvent(MOMENT, E1)

    cookieWaarde = ANDER_TEAM
    await expect(herstelWedstrijdMoment(herstel)).rejects.toThrow('Herstel niet mogelijk')
    expect(store.match_events).toHaveLength(0)
  })

  it('een vervalst teamId met het actieve team schrijft nog steeds alleen in ctx.teamId', async () => {
    metMoment()
    const herstel = await deleteMatchEvent(MOMENT, E1)
    await herstelWedstrijdMoment({ ...herstel, teamId: TEAM })
    expect(store.match_events.map((r) => r.team_id)).toEqual([TEAM])
  })
})

// ────────────────────────────────────────────────
// Afmeldperiode (V-A)
// ────────────────────────────────────────────────
describe('Afmeldperiode: intrekken → herstellen', () => {
  const PERIODE = '0a000000-0000-4000-8000-0000000000a1'
  const ANDERE_PERIODE = '0a000000-0000-4000-8000-0000000000a2'

  function metPeriode() {
    installeer({
      players: [{ id: P1, team_id: TEAM, type: 'regular' }],
      events: [
        { id: E1, team_id: TEAM, date: '2026-08-05', type: 'training' },
        { id: E2, team_id: TEAM, date: '2026-08-06', type: 'match' },
        { id: E3, team_id: TEAM, date: '2026-08-07', type: 'training' },
        { id: E4, team_id: TEAM, date: '2026-08-20', type: 'training' },
      ],
      absence_periods: [
        { id: PERIODE, team_id: TEAM, player_id: P1, from_date: '2026-08-01', to_date: '2026-08-31', created_at: '2026-07-30T09:00:00+00:00' },
        { id: ANDERE_PERIODE, team_id: TEAM, player_id: P1, from_date: '2026-08-15', to_date: '2026-08-25', created_at: '2026-07-31T09:00:00+00:00' },
      ],
      attendance: [
        { event_id: E1, player_id: P1, team_id: TEAM, status: 'absent', absence_period_id: PERIODE },  // → standaard
        { event_id: E2, player_id: P1, team_id: TEAM, status: 'present', absence_period_id: PERIODE }, // handmatig present
        { event_id: E3, player_id: P1, team_id: TEAM, status: 'injured', absence_period_id: PERIODE }, // geblesseerd
        { event_id: E4, player_id: P1, team_id: TEAM, status: 'absent', absence_period_id: PERIODE },  // → overgedragen
      ],
    })
  }

  const rij = (eventId: string) => store.attendance.find((r) => r.event_id === eventId)!

  it('herstelt periode en herkomst; handmatige present blijft present, toDefault-rij weer absent met herkomst', async () => {
    metPeriode()
    const periodeVoor = kopie('absence_periods')
    const { restored, herstel } = await revokeAbsencePeriod(PERIODE)
    expect(restored).toBe(1)
    expect(rij(E1)).toMatchObject({ status: 'present', absence_period_id: null })
    expect(rij(E4)).toMatchObject({ status: 'absent', absence_period_id: ANDERE_PERIODE })

    await herstelAfmeldperiode(herstel)

    expect(kopie('absence_periods')).toEqual(periodeVoor)
    expect(rij(E1)).toMatchObject({ status: 'absent', absence_period_id: PERIODE })
    expect(rij(E2)).toMatchObject({ status: 'present', absence_period_id: PERIODE })
    expect(rij(E3)).toMatchObject({ status: 'injured', absence_period_id: PERIODE })
    // Aan een andere periode overgedragen rijen blijven daar (V-A).
    expect(rij(E4)).toMatchObject({ status: 'absent', absence_period_id: ANDERE_PERIODE })
  })

  it('een keuze van de coach tussen intrekken en herstellen wint', async () => {
    metPeriode()
    const { herstel } = await revokeAbsencePeriod(PERIODE)
    await updateAttendance(E1, P1, 'unknown')
    await herstelAfmeldperiode(herstel)
    expect(rij(E1)).toMatchObject({ status: 'unknown', absence_period_id: null })
  })

  it('dubbel herstel levert één periode op', async () => {
    metPeriode()
    const { herstel } = await revokeAbsencePeriod(PERIODE)
    await herstelAfmeldperiode(herstel)
    await herstelAfmeldperiode(herstel)
    expect(store.absence_periods.filter((r) => r.id === PERIODE)).toHaveLength(1)
  })

  it('compensatie halverwege: geen periode en geen half herstel', async () => {
    metPeriode()
    const { herstel } = await revokeAbsencePeriod(PERIODE)
    const naIntrekken = kopie('attendance')

    // De herkomst-update (tweede stap) faalt; de standaard-update was al gelukt.
    faal.fn = (op, table, payload) =>
      op === 'update' && table === 'attendance' && payload && !('status' in payload) && payload.absence_period_id === PERIODE
        ? { code: '57014', message: 'canceling statement' }
        : null
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(herstelAfmeldperiode(herstel)).rejects.toThrow('Er ging iets mis')
    consoleError.mockRestore()

    expect(store.absence_periods.some((r) => r.id === PERIODE)).toBe(false)
    expect(kopie('attendance')).toEqual(naIntrekken)
  })
})

// ────────────────────────────────────────────────
// Oefening uit training (koppeling, V-B)
// ────────────────────────────────────────────────
describe('Koppeling: verwijderen → herstellen', () => {
  const OEF_EIGEN = '0f000000-0000-4000-8000-000000000001'
  const OEF_ANDER = '0f000000-0000-4000-8000-000000000002'
  const GROEP = '06000000-0000-4000-8000-000000000001'
  const KA = '0a000000-0000-4000-8000-00000000000a'
  const KB = '0a000000-0000-4000-8000-00000000000b'
  const KC = '0a000000-0000-4000-8000-00000000000c'
  const KD = '0a000000-0000-4000-8000-00000000000d'

  function koppeling(id: string, extra: Row): Row {
    return {
      id,
      team_id: TEAM,
      event_id: E1,
      oefening_id: OEF_EIGEN,
      volgorde: 0,
      duur_min: null,
      stap_override: null,
      genest_in: null,
      spelerindeling: [],
      aantallen_override: null,
      parallel_groep_id: null,
      parallel_spelers: [],
      created_at: `2026-10-01T10:00:0${id.slice(-1) === 'a' ? 1 : id.slice(-1) === 'b' ? 2 : id.slice(-1) === 'c' ? 3 : 4}+00:00`,
      ...extra,
    }
  }

  function metPlan() {
    installeer({
      events: [{ id: E1, team_id: TEAM, date: '2026-10-28', type: 'training' }],
      players: [{ id: P1, team_id: TEAM }, { id: P2, team_id: TEAM }],
      oefeningen: [
        { id: OEF_EIGEN, team_id: USER, categorie: 'partijen_klein', teams: [{ grootte: 3 }, { grootte: 3 }], aantal_neutralen: 0, aantal_neutralen_max: 2 },
        { id: OEF_ANDER, team_id: ANDERE_USER, categorie: 'positiespel', teams: [{ grootte: 4 }], aantal_neutralen: 0, aantal_neutralen_max: null },
      ],
      training_oefeningen: [
        koppeling(KA, {
          volgorde: 0, duur_min: 12, stap_override: 4, spelerindeling: [[P1], []],
          aantallen_override: { teams: [null, null], neutralen: 1 },
          parallel_groep_id: GROEP, parallel_spelers: [P1],
        }),
        koppeling(KB, { volgorde: 0, parallel_groep_id: GROEP, parallel_spelers: [P2] }),
        koppeling(KC, { volgorde: 1, genest_in: KA }),
        koppeling(KD, { volgorde: 2, oefening_id: OEF_ANDER }),
      ],
    })
  }

  it('zet koppeling, duur, stap, parallelgroep + partner, nesting en volgorde inhoudelijk gelijk terug', async () => {
    metPlan()
    const voor = kopie('training_oefeningen')
    const herstel = await removeOefeningFromTraining(KA, E1)

    const na = kopie('training_oefeningen')
    expect(na.find((r) => r.id === KA)).toBeUndefined()
    // Groep vervallen, nesting gewist (ON DELETE SET NULL).
    expect(na.find((r) => r.id === KB)).toMatchObject({ parallel_groep_id: null, parallel_spelers: [] })
    expect(na.find((r) => r.id === KC)).toMatchObject({ genest_in: null })

    await herstelKoppeling(herstel)
    expect(kopie('training_oefeningen')).toEqual(voor)
  })

  it('dubbel herstel levert één koppeling op', async () => {
    metPlan()
    const herstel = await removeOefeningFromTraining(KA, E1)
    await herstelKoppeling(herstel)
    await herstelKoppeling(herstel)
    expect(store.training_oefeningen.filter((r) => r.id === KA)).toHaveLength(1)
  })

  it('partner intussen elders gegroepeerd: koppeling komt zonder groep terug, partner blijft waar hij is', async () => {
    metPlan()
    const herstel = await removeOefeningFromTraining(KA, E1)
    const ANDERE_GROEP = '06000000-0000-4000-8000-000000000002'
    for (const r of store.training_oefeningen) {
      if (r.id === KB || r.id === KD) r.parallel_groep_id = ANDERE_GROEP
    }
    await herstelKoppeling(herstel)
    expect(store.training_oefeningen.find((r) => r.id === KA)).toMatchObject({ parallel_groep_id: null, parallel_spelers: [] })
    expect(store.training_oefeningen.find((r) => r.id === KB)).toMatchObject({ parallel_groep_id: ANDERE_GROEP })
  })

  it('kinderen-update faalt: geen half herstel — koppeling weg, partner weer los, kind los', async () => {
    metPlan()
    const herstel = await removeOefeningFromTraining(KA, E1)
    const naVerwijderen = kopie('training_oefeningen')

    faal.fn = (op, table, payload) =>
      op === 'update' && table === 'training_oefeningen' && payload && 'genest_in' in payload
        ? { code: '57014', message: 'canceling statement' }
        : null
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(herstelKoppeling(herstel)).rejects.toThrow('Er ging iets mis')
    consoleError.mockRestore()

    expect(kopie('training_oefeningen')).toEqual(naVerwijderen)

    // Daarna lukt herstel alsnog volledig (idempotent, geen restanten).
    faal.fn = null
    await herstelKoppeling(herstel)
    expect(store.training_oefeningen.find((r) => r.id === KC)).toMatchObject({ genest_in: KA })
    expect(store.training_oefeningen.find((r) => r.id === KB)).toMatchObject({ parallel_groep_id: GROEP })
  })

  it('volgorde-normalisatie faalt na de insert: koppeling weer weg en volgorde zoals na verwijderen', async () => {
    metPlan()
    const herstel = await removeOefeningFromTraining(KC, E1)
    const naVerwijderen = kopie('training_oefeningen')

    // Eén keer falen (tijdelijke storing): de eerste volgorde-update van het herstel.
    let gefaald = false
    faal.fn = (op, table, payload) => {
      if (!gefaald && op === 'update' && table === 'training_oefeningen' && payload && 'volgorde' in payload) {
        gefaald = true
        return { code: '57014', message: 'canceling statement' }
      }
      return null
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(herstelKoppeling(herstel)).rejects.toThrow('Er ging iets mis')
    consoleError.mockRestore()

    expect(gefaald).toBe(true)
    expect(store.training_oefeningen.some((r) => r.id === KC)).toBe(false)
    expect(kopie('training_oefeningen')).toEqual(naVerwijderen)
  })

  it('compensatie laat een partner die intussen elders gegroepeerd is ongemoeid', async () => {
    metPlan()
    const herstel = await removeOefeningFromTraining(KA, E1)
    const ANDERE_GROEP = '06000000-0000-4000-8000-000000000002'

    // Gelijktijdige bewerking: tussen de partner-update en de insert zet iemand
    // de partner in een andere groep; daarna faalt de insert.
    faal.fn = (op, table, payload) => {
      if (op === 'insert' && table === 'training_oefeningen' && payload?.id === KA) {
        const kb = store.training_oefeningen.find((r) => r.id === KB)!
        kb.parallel_groep_id = ANDERE_GROEP
        kb.parallel_spelers = [P2]
        return { code: '57014', message: 'canceling statement' }
      }
      return null
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(herstelKoppeling(herstel)).rejects.toThrow('Er ging iets mis')
    consoleError.mockRestore()

    expect(store.training_oefeningen.some((r) => r.id === KA)).toBe(false)
    expect(store.training_oefeningen.find((r) => r.id === KB)).toMatchObject({
      parallel_groep_id: ANDERE_GROEP,
      parallel_spelers: [P2],
    })
  })

  it('andermans oefening zonder resterende koppeling in het team kan niet terug (V-B)', async () => {
    metPlan()
    const herstel = await removeOefeningFromTraining(KD, E1)
    await expect(herstelKoppeling(herstel)).rejects.toThrow('Herstel niet mogelijk')
    expect(store.training_oefeningen.some((r) => r.id === KD)).toBe(false)
  })

  it('snapshot van een ander team wordt geweigerd, niets geschreven', async () => {
    metPlan()
    const herstel = await removeOefeningFromTraining(KA, E1)
    await expect(herstelKoppeling({ ...herstel, teamId: ANDER_TEAM })).rejects.toThrow('Herstel niet mogelijk')
    expect(store.training_oefeningen.some((r) => r.id === KA)).toBe(false)
  })
})
