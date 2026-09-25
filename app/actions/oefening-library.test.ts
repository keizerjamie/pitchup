import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { OefeningInput } from '@/lib/oefening'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import {
  createOefening,
  updateOefening,
  deleteOefening,
  countOefeningKoppelingen,
  kopieerOefeningNaarBibliotheek,
} from '@/app/actions/oefening-library'
import { revalidatePath } from 'next/cache'
import { GEEN_RECHTEN, rechtenNaarKolommen } from '@/lib/team-rechten'
import { OEFENING_INHOUD_KOLOMMEN } from '@/lib/oefening'

type TableResult = { data?: unknown; error?: unknown; count?: number }

// Elke server action haalt sinds deze feature eerst de teamcontext op
// (lib/team-context.ts, requireTeamContext). Die leest team_members; zonder
// een lidmaatschapsrij komt geen enkele action voorbij zijn eerste regel
// ('Geen team'). In fase 1 geldt teams.id === user.id, dus de owner-rij wijst
// naar hetzelfde id als de sessie-user — vanaf fase 2 kan team_id daarvan
// afwijken en is dit de plek om dat na te bootsen.
function teamMembersFixture(userId: string | undefined) {
  if (!userId) return { data: [], error: null }
  return { data: [{ team_id: userId, user_id: userId, rol: 'owner' }], error: null }
}

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const calls = {
    insert: [] as { table: string; payload: Record<string, unknown> }[],
    update: [] as { table: string; payload: Record<string, unknown> }[],
    delete: [] as { table: string }[],
    eq: [] as { table: string; col: string; val: unknown }[],
  }
  function chain(table: string) {
    const result = tables[table] ?? (table === 'team_members' ? teamMembersFixture(user?.id) : { data: [], error: null })
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq']) {
      c[m] = () => c
    }
    c.eq = (col: string, val: unknown) => { calls.eq.push({ table, col, val }); return c }
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push({ table, payload }); return c }
    c.update = (payload: Record<string, unknown>) => { calls.update.push({ table, payload }); return c }
    c.delete = () => { calls.delete.push({ table }); return c }
    c.single = () => Promise.resolve(result)
    c.maybeSingle = () => Promise.resolve(result)
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
    return c
  }
  const supabase = {
    from: (t: string) => chain(t),
    auth: { getUser: async () => ({ data: { user } }) },
  }
  return { supabase, calls }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

const baseInput = (over: Partial<OefeningInput> = {}): OefeningInput => ({
  naam: 'Rondo',
  categorie: 'partijen_klein',
  teams: [],
  aantal_neutralen: 0,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createOefening', () => {
  it('slaagt zonder teams en geeft het nieuwe id terug', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'new-id' }, error: null } } })
    use(m)
    const res = await createOefening(baseInput())
    expect(res).toEqual({ id: 'new-id' })
    expect(m.calls.insert[0].payload.team_id).toBe('team-1')
    expect(m.calls.insert[0].payload.teams).toEqual([])
  })

  it('slaagt met asymmetrische teams van verschillende grootte', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({
      teams: [
        { grootte: 4, formaties: ['2-0-1'] },
        { grootte: 6, formaties: ['3-0-2'] },
        { grootte: 8, formaties: [] },
      ],
    }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 4, formaties: ['2-0-1'], keeperInGrootte: true },
      { grootte: 6, formaties: ['3-0-2'], keeperInGrootte: true },
      { grootte: 8, formaties: [], keeperInGrootte: true },
    ])
  })

  it('slaat een binnengekomen label canoniek op als key', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    // '3-2' is het LABEL van compositie 3V-0M-2A.
    await createOefening(baseInput({ teams: [{ grootte: 6, formaties: ['3-2'] }] }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 6, formaties: ['3-0-2'], keeperInGrootte: true },
    ])
  })

  it('weigert meer dan één formatie per team', async () => {
    use(makeSupabase())
    await expect(createOefening(baseInput({ teams: [{ grootte: 4, formaties: ['2-0-1', '1-0-2'] }] })))
      .rejects.toThrow('Maximaal één formatie per team')
  })

  it('weigert meer dan één formatie ook bij een 11-tal', async () => {
    use(makeSupabase())
    await expect(
      createOefening(baseInput({ teams: [{ grootte: 11, formaties: ['5-3-2', '3-4-3'] }] })),
    ).rejects.toThrow('Maximaal één formatie per team')
  })

  it('ontdubbelt herhaalde formaties (blijft daarmee binnen het maximum van 1)', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({ teams: [{ grootte: 6, formaties: ['3-0-2', '3-0-2'] }] }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 6, formaties: ['3-0-2'], keeperInGrootte: true },
    ])
  })

  it('een lege selectie blijft een lege array (= geen formatie)', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({ teams: [{ grootte: 6, formaties: [] }] }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 6, formaties: [], keeperInGrootte: true },
    ])
  })

  it('dual-read: legacy invoer {grootte, formatie} wordt als nieuwe vorm weggeschreven', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({
      teams: [
        { grootte: 4, formatie: '2-1' },
        { grootte: 6, formatie: null },
      ] as unknown as OefeningInput['teams'],
    }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 4, formaties: ['2-0-1'], keeperInGrootte: true },
      { grootte: 6, formaties: [], keeperInGrootte: true },
    ])
  })

  it('slaat keeperInGrootte false op: het team speelt zonder keeper', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    // Zonder keeper zijn er 6 veldspelers, dus '3-2-1' past (met keeper zou dat niet).
    await createOefening(baseInput({
      teams: [{ grootte: 6, formaties: ['3-2-1'], keeperInGrootte: false }],
    }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 6, formaties: ['3-2-1'], keeperInGrootte: false },
    ])
  })

  it('een formatie die alleen zonder keeper past, faalt met keeper', async () => {
    use(makeSupabase())
    await expect(
      createOefening(baseInput({ teams: [{ grootte: 6, formaties: ['3-2-1'] }] })),
    ).rejects.toThrow('Formatie past niet bij teamgrootte')
  })

  it('grootte 11 forceert keeperInGrootte true, ongeacht de invoer', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({
      teams: [{ grootte: 11, formaties: ['4-3-3'], keeperInGrootte: false }],
    }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 11, formaties: ['4-3-3'], keeperInGrootte: true },
    ])
  })

  it('accepteert grootte 10 (nieuw: gedekt door de gegenereerde catalogus)', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({ teams: [{ grootte: 10, formaties: ['4-4-1'] }] }))
    expect(m.calls.insert[0].payload.teams).toEqual([
      { grootte: 10, formaties: ['4-4-1'], keeperInGrootte: true },
    ])
  })

  it('valideert categorie-afhankelijk: partijen_groot eist alle drie de linies', async () => {
    // '3-0-2' (geen middenvelder) mag wél bij partijen_klein...
    const ok = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(ok)
    await createOefening(baseInput({
      categorie: 'partijen_klein',
      teams: [{ grootte: 6, formaties: ['3-0-2'] }],
    }))
    expect(ok.calls.insert[0].payload.teams).toEqual([
      { grootte: 6, formaties: ['3-0-2'], keeperInGrootte: true },
    ])

    // ...maar niet bij partijen_groot.
    use(makeSupabase())
    await expect(
      createOefening(baseInput({
        categorie: 'partijen_groot',
        teams: [{ grootte: 6, formaties: ['3-0-2'] }],
      })),
    ).rejects.toThrow('Formatie past niet bij teamgrootte')
  })

  it('dual-read: een legacy formatie die niet bij de grootte past faalt nog steeds', async () => {
    use(makeSupabase())
    await expect(
      createOefening(baseInput({
        teams: [{ grootte: 6, formatie: '4-3-3' }] as unknown as OefeningInput['teams'],
      })),
    ).rejects.toThrow('Formatie past niet bij teamgrootte')
  })

  it('slaagt met aantal_neutralen > 0', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({ aantal_neutralen: 3 }))
    expect(m.calls.insert[0].payload.aantal_neutralen).toBe(3)
  })

  it('faalt wanneer de formatie niet bij de teamgrootte past', async () => {
    use(makeSupabase())
    await expect(createOefening(baseInput({ teams: [{ grootte: 6, formaties: ['4-3-3'] }] })))
      .rejects.toThrow('Formatie past niet bij teamgrootte')
  })

  it('de max-1-check gaat vóór de per-waarde-validatie (geen stille afkap)', async () => {
    for (const formaties of [
      ['3-0-2', '4-3-3'],            // fout achteraan
      ['4-3-3', '3-0-2'],            // fout vooraan
      ['3-0-2', '4-3-3', '2-2-1'],   // fout in het midden
    ]) {
      use(makeSupabase())
      await expect(createOefening(baseInput({ teams: [{ grootte: 6, formaties }] })))
        .rejects.toThrow('Maximaal één formatie per team')
    }
  })

  it('faalt bij een ongeldige teamgrootte', async () => {
    for (const grootte of [0, 12]) {
      use(makeSupabase())
      await expect(createOefening(baseInput({ teams: [{ grootte, formaties: [] }] })))
        .rejects.toThrow('Ongeldige teamgrootte')
    }
  })

  it('accepteert grootte 1 en 2 (nieuw: kleine oefenvormen als 1v1/2v2)', async () => {
    for (const grootte of [1, 2]) {
      const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
      use(m)
      await createOefening(baseInput({ teams: [{ grootte, formaties: [] }] }))
      expect(m.calls.insert[0].payload.teams).toEqual([
        { grootte, formaties: [], keeperInGrootte: true },
      ])
    }
  })

  it('faalt wanneer niet ingelogd', async () => {
    use(makeSupabase({ user: null }))
    await expect(createOefening(baseInput())).rejects.toThrow('Niet ingelogd')
  })

  it('accepteert de nieuwe categorieën warming_up/positiespel/pass_trap', async () => {
    for (const categorie of ['warming_up', 'positiespel', 'pass_trap'] as const) {
      const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
      use(m)
      await createOefening(baseInput({ categorie }))
      expect(m.calls.insert[0].payload.categorie).toBe(categorie)
    }
  })

  it('faalt bij een onbekende categorie', async () => {
    use(makeSupabase())
    await expect(
      createOefening(baseInput({ categorie: 'onzin' as OefeningInput['categorie'] })),
    ).rejects.toThrow('Ongeldige categorie')
  })

  it('clamped teams naar maximaal 6', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({
      teams: Array.from({ length: 8 }, () => ({ grootte: 3, formaties: [] })),
    }))
    expect((m.calls.insert[0].payload.teams as unknown[]).length).toBe(6)
  })

  it('clamped aantal_neutralen naar 0..30', async () => {
    const hi = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(hi)
    await createOefening(baseInput({ aantal_neutralen: 99 }))
    expect(hi.calls.insert[0].payload.aantal_neutralen).toBe(30)

    const lo = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(lo)
    await createOefening(baseInput({ aantal_neutralen: -5 }))
    expect(lo.calls.insert[0].payload.aantal_neutralen).toBe(0)
  })

  it('clamped duur_min naar 0..600 en behoudt null', async () => {
    const hi = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(hi)
    await createOefening(baseInput({ duur_min: 5000 }))
    expect(hi.calls.insert[0].payload.duur_min).toBe(600)

    const nul = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(nul)
    await createOefening(baseInput({ duur_min: null }))
    expect(nul.calls.insert[0].payload.duur_min).toBeNull()
  })

  it('clamped breedte_m / lengte_m naar 0..999.9 (1 decimaal)', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({ breedte_m: 99999, lengte_m: -3.14 }))
    expect(m.calls.insert[0].payload.breedte_m).toBe(999.9)
    expect(m.calls.insert[0].payload.lengte_m).toBe(0)
  })

  it('stript onbekende velden uit een team', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await createOefening(baseInput({
      teams: [{ grootte: 6, formaties: [], foo: 'bar' } as unknown as OefeningInput['teams'][number]],
    }))
    const team = (m.calls.insert[0].payload.teams as Record<string, unknown>[])[0]
    expect(team).toEqual({ grootte: 6, formaties: [], keeperInGrootte: true })
    expect('foo' in team).toBe(false)
  })
})

describe('updateOefening / deleteOefening (tenant-isolatie)', () => {
  it('update op een oefening van een ander team → niet gevonden', async () => {
    use(makeSupabase({ tables: { oefeningen: { data: null } } }))
    await expect(updateOefening('other', baseInput())).rejects.toThrow('Oefening niet gevonden')
  })

  it('delete op een oefening van een ander team → niet gevonden', async () => {
    use(makeSupabase({ tables: { oefeningen: { data: null } } }))
    await expect(deleteOefening('other')).rejects.toThrow('Oefening niet gevonden')
  })
})

describe('generieke foutafhandeling (geen ruwe databasemelding)', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  function logged() {
    return consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
  }

  // data blijft gevuld zodat assertOwnOefening slaagt; de mutatie zelf faalt.
  const dbFout = {
    data: { id: 'o1' },
    error: { code: '23505', message: 'Key (naam)=(Rondo) already exists' },
  }

  it('createOefening: generieke melding, context in de log, geen ruwe tekst', async () => {
    use(makeSupabase({ tables: { oefeningen: dbFout } }))

    await expect(createOefening(baseInput())).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('oefeningLibrary.createOefening')
    expect(logged()).toContain('23505')
    expect(logged()).not.toContain('Rondo')
  })

  it('updateOefening: generieke melding met eigen context', async () => {
    use(makeSupabase({ tables: { oefeningen: dbFout } }))

    await expect(updateOefening('o1', baseInput())).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('oefeningLibrary.updateOefening')
    expect(logged()).not.toContain('already exists')
  })

  it('deleteOefening: generieke melding met eigen context', async () => {
    use(makeSupabase({ tables: { oefeningen: dbFout } }))

    await expect(deleteOefening('o1')).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(logged()).toContain('oefeningLibrary.deleteOefening')
    expect(logged()).not.toContain('already exists')
  })
})

describe('countOefeningKoppelingen (telt trainingen, niet koppelingsrijen)', () => {
  it('geeft 0 terug wanneer de oefening nergens gekoppeld is', async () => {
    use(makeSupabase({ tables: { training_oefeningen: { data: [], error: null } } }))
    await expect(countOefeningKoppelingen('o1')).resolves.toBe(0)
  })

  it('telt elke training één keer, ook bij meerdere koppelingen in dezelfde training', async () => {
    use(makeSupabase({
      tables: {
        training_oefeningen: {
          data: [{ event_id: 'e1' }, { event_id: 'e1' }, { event_id: 'e2' }],
          error: null,
        },
      },
    }))
    await expect(countOefeningKoppelingen('o1')).resolves.toBe(2)
  })

  it('scoopt de telling op de oefening én op het eigen team', async () => {
    const m = makeSupabase({ tables: { training_oefeningen: { data: [{ event_id: 'e1' }], error: null } } })
    use(m)
    await countOefeningKoppelingen('o1')
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'oefening_id', val: 'o1' })
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'team_id', val: 'team-1' })
  })

  it('gooit "Niet ingelogd" zonder sessie', async () => {
    use(makeSupabase({ user: null }))
    await expect(countOefeningKoppelingen('o1')).rejects.toThrow('Niet ingelogd')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Fase 4 — oefeningen van teamgenoten: kopiëren (AC 20) en niet bewerken (AC 35)
// ═══════════════════════════════════════════════════════════════════════
//
// Mock-smaak: de stub hierboven negeert .eq() en geeft voor select én insert
// dezelfde vaste uitkomst — daarmee is niet te bewijzen dat een kopie een
// NIEUWE rij is, of dat een update het origineel ongemoeid laat. Hieronder
// daarom een kleine tabel-engine die filters echt toepast en rijen echt
// schrijft.
//
// Hij bootst ook de LEESKANT van de RLS op `oefeningen` na, omdat het gedrag
// van kopieerOefeningNaarBibliotheek daar volledig van afhangt ("RLS beslist
// zichtbaarheid"): een rij is zichtbaar als hij van de gebruiker zelf is
// (oefeningen: own team only) óf gekoppeld staat in een trainingsplan van een
// team waar de gebruiker lid van is (oefeningen: zichtbaar via gekoppeld
// trainingsplan, supabase/oefeningen-persoonlijk.sql). Of de ECHTE policy dat
// doet, bewijst alleen blok 24 van supabase/team-rls-verificatie.sql — vitest
// praat niet met een database.

type Rij = Record<string, unknown>

const TEAM = '11111111-1111-4111-8111-111111111111'
const HOOFDTRAINER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ASSISTENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const VREEMDE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OEF_HOOFD = '0e000000-0000-4000-8000-000000000001'
const OEF_ASSISTENT = '0e000000-0000-4000-8000-000000000002'
const OEF_VREEMD = '0e000000-0000-4000-8000-000000000003'

function oefeningRij(id: string, eigenaar: string, naam: string): Rij {
  return {
    id,
    team_id: eigenaar,
    created_at: '2026-01-01T10:00:00Z',
    naam,
    beschrijving: `Beschrijving van ${naam}`,
    categorie: 'partijen_klein',
    duur_min: 15,
    breedte_m: 20,
    lengte_m: 25.5,
    orientatie: 'lengte',
    veldzone: null,
    teams: [{ grootte: 4, formaties: [], keeperInGrootte: true }],
    aantal_neutralen: 2,
    aantal_neutralen_max: 3,
    diagram: { markers: [{ x: 1, y: 2 }] },
  }
}

function makeEngine(userId: string, opts: { leesFout?: boolean; schrijfFout?: boolean } = {}) {
  const store: Record<string, Rij[]> = {
    team_members: [
      { team_id: TEAM, user_id: HOOFDTRAINER, rol: 'owner', ...rechtenNaarKolommen({ ...GEEN_RECHTEN }) },
      // Assistent ZONDER enig recht: kopiëren vraagt geen recht (AC 20).
      { team_id: TEAM, user_id: ASSISTENT, rol: 'assistent', ...rechtenNaarKolommen({ ...GEEN_RECHTEN }) },
    ],
    settings: [{ team_id: TEAM, key: 'team_name', value: 'JO13-1' }],
    oefeningen: [
      oefeningRij(OEF_HOOFD, HOOFDTRAINER, 'Rondo van de hoofdtrainer'),
      oefeningRij(OEF_ASSISTENT, ASSISTENT, 'Positiespel van de assistent'),
      oefeningRij(OEF_VREEMD, VREEMDE, 'Oefening van een buitenstaander'),
    ],
    training_oefeningen: [
      { id: 'k1', team_id: TEAM, event_id: 'e1', oefening_id: OEF_HOOFD },
      { id: 'k2', team_id: TEAM, event_id: 'e1', oefening_id: OEF_ASSISTENT },
    ],
  }
  const calls = {
    ops: [] as { table: string; op: string }[],
    eqs: [] as { table: string; op: string; col: string; val: unknown }[],
    inserts: [] as { table: string; payload: Rij }[],
  }
  let teller = 0

  const zichtbaar = (r: Rij) => {
    if (r.team_id === userId) return true
    const mijnTeams = new Set(store.team_members.filter((m) => m.user_id === userId).map((m) => m.team_id))
    return store.training_oefeningen.some((k) => k.oefening_id === r.id && mijnTeams.has(k.team_id))
  }

  function chain(table: string) {
    const filters: ((r: Rij) => boolean)[] = []
    let op = 'select'
    let patch: Rij | null = null
    let ingevoegd: Rij[] = []
    const lees = () => {
      const basis = table === 'oefeningen' ? store[table].filter(zichtbaar) : (store[table] ?? [])
      return basis.filter((r) => filters.every((f) => f(r)))
    }
    const uitkomst = () => {
      if (table === 'oefeningen' && op === 'select' && opts.leesFout) {
        return { data: null, error: { code: '42501', message: 'permission denied for table oefeningen' } }
      }
      if (table === 'oefeningen' && op === 'insert' && opts.schrijfFout) {
        return { data: null, error: { code: '23514', message: 'new row violates check constraint "oefeningen_categorie_check"' } }
      }
      if (op === 'insert') return { data: ingevoegd, error: null }
      const geraakt = lees()
      if (op === 'update') for (const r of geraakt) Object.assign(r, patch)
      if (op === 'delete') for (const r of geraakt) store[table].splice(store[table].indexOf(r), 1)
      return { data: geraakt, error: null }
    }
    const c: Record<string, unknown> = {}
    c.select = () => { if (op === 'select') calls.ops.push({ table, op }); return c }
    c.eq = (col: string, val: unknown) => {
      calls.eqs.push({ table, op, col, val })
      filters.push((r) => r[col] === val)
      return c
    }
    c.in = (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return c }
    c.order = () => c
    c.insert = (payload: Rij) => {
      op = 'insert'
      calls.ops.push({ table, op })
      calls.inserts.push({ table, payload })
      if (!opts.schrijfFout) {
        // UUID-vormig, zoals gen_random_uuid(): de action doet een vormcheck.
        const id = `ae000000-0000-4000-8000-${String(++teller).padStart(12, '0')}`
        const rij = { id, created_at: '2026-09-24T12:00:00Z', ...payload }
        store[table].push(rij)
        ingevoegd = [rij]
      }
      return c
    }
    c.update = (p: Rij) => { op = 'update'; patch = p; calls.ops.push({ table, op }); return c }
    c.delete = () => { op = 'delete'; calls.ops.push({ table, op }); return c }
    c.single = () => {
      const u = uitkomst()
      return Promise.resolve({ data: Array.isArray(u.data) ? (u.data[0] ?? null) : u.data, error: u.error })
    }
    c.maybeSingle = c.single
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(uitkomst())
    return c
  }

  const supabase = {
    from: (t: string) => chain(t),
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
  }
  return { supabase, store, calls }
}

function useEngine(m: ReturnType<typeof makeEngine>) {
  vi.mocked(createClient).mockResolvedValue(m.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

function oefening(m: ReturnType<typeof makeEngine>, id: string): Rij | undefined {
  return m.store.oefeningen.find((r) => r.id === id)
}

describe('kopieerOefeningNaarBibliotheek — succes (AC 20, BR 56)', () => {
  it('maakt een NIEUWE rij met alle inhoud letterlijk overgenomen, ook de naam', async () => {
    const m = makeEngine(ASSISTENT)
    useEngine(m)
    const origineel = { ...oefening(m, OEF_HOOFD)! }

    const { id } = await kopieerOefeningNaarBibliotheek(OEF_HOOFD)

    expect(id).not.toBe(OEF_HOOFD)
    const kopie = oefening(m, id)!
    for (const kolom of OEFENING_INHOUD_KOLOMMEN) {
      expect(kopie[kolom], kolom).toEqual(origineel[kolom])
    }
    // Beslissing 10: geen "(kopie)"-suffix.
    expect(kopie.naam).toBe('Rondo van de hoofdtrainer')
    expect(m.store.oefeningen).toHaveLength(4)
  })

  // Oefeningen zijn persoonlijk bezit: de kopie hoort bij de AANROEPER, nooit
  // bij het actieve team (ctx.teamId) en nooit bij de oude eigenaar.
  it('zet team_id = ctx.userId, niet het team en niet de oude eigenaar', async () => {
    const m = makeEngine(ASSISTENT)
    useEngine(m)

    const { id } = await kopieerOefeningNaarBibliotheek(OEF_HOOFD)

    expect(oefening(m, id)!.team_id).toBe(ASSISTENT)
    expect(oefening(m, id)!.team_id).not.toBe(TEAM)
  })

  it('stuurt geen id, created_at of herkomst mee — die krijgt de kopie zelf (beslissing 2)', async () => {
    const m = makeEngine(ASSISTENT)
    useEngine(m)

    await kopieerOefeningNaarBibliotheek(OEF_HOOFD)

    const payload = m.calls.inserts.find((i) => i.table === 'oefeningen')!.payload
    expect(Object.keys(payload).sort()).toEqual([...OEFENING_INHOUD_KOLOMMEN, 'team_id'].sort())
  })

  it('vraagt GEEN teamrecht: een assistent met nul rechten mag kopiëren', async () => {
    const m = makeEngine(ASSISTENT)
    useEngine(m)
    // Vastgelegd in de fixture: de assistent heeft alle zes rechten op false.
    expect(m.store.team_members.find((r) => r.user_id === ASSISTENT)!.mag_training_bewerken).toBe(false)

    await expect(kopieerOefeningNaarBibliotheek(OEF_HOOFD)).resolves.toEqual({ id: expect.any(String) })
  })

  // RLS beslist de zichtbaarheid; een team_id-filter op de lees zou de
  // oefening van de teamgenoot juist wegfilteren.
  it('filtert de lees alleen op het id, niet op een eigenaar of team', async () => {
    const m = makeEngine(ASSISTENT)
    useEngine(m)

    await kopieerOefeningNaarBibliotheek(OEF_HOOFD)

    const leesFilters = m.calls.eqs.filter((e) => e.table === 'oefeningen' && e.op === 'select')
    expect(leesFilters).toEqual([{ table: 'oefeningen', op: 'select', col: 'id', val: OEF_HOOFD }])
  })

  it('revalideert de eigen bibliotheek', async () => {
    useEngine(makeEngine(ASSISTENT))
    await kopieerOefeningNaarBibliotheek(OEF_HOOFD)
    expect(revalidatePath).toHaveBeenCalledWith('/oefeningen')
  })

  it('de kopie is onafhankelijk: wijzigen van de kopie raakt het origineel niet', async () => {
    const m = makeEngine(ASSISTENT)
    useEngine(m)
    const { id } = await kopieerOefeningNaarBibliotheek(OEF_HOOFD)

    await updateOefening(id, baseInput({ naam: 'Mijn eigen variant' }))

    expect(oefening(m, id)!.naam).toBe('Mijn eigen variant')
    expect(oefening(m, OEF_HOOFD)!.naam).toBe('Rondo van de hoofdtrainer')
  })

  it('een kopie van een kopie is net zo los (geen herkomstketen)', async () => {
    const m = makeEngine(ASSISTENT)
    useEngine(m)
    const { id: eerste } = await kopieerOefeningNaarBibliotheek(OEF_HOOFD)
    const { id: tweede } = await kopieerOefeningNaarBibliotheek(eerste)

    expect(new Set([OEF_HOOFD, eerste, tweede]).size).toBe(3)
    expect(oefening(m, tweede)!.team_id).toBe(ASSISTENT)
  })
})

describe('kopieerOefeningNaarBibliotheek — faalpaden', () => {
  it('een onzichtbare oefening (niet gekoppeld in een eigen team) geeft "Oefening niet gevonden" en schrijft niets', async () => {
    const m = makeEngine(ASSISTENT)
    useEngine(m)

    await expect(kopieerOefeningNaarBibliotheek(OEF_VREEMD)).rejects.toThrow('Oefening niet gevonden')
    expect(m.calls.inserts).toHaveLength(0)
  })

  it('een onbekend id geeft dezelfde melding', async () => {
    const m = makeEngine(ASSISTENT)
    useEngine(m)

    await expect(kopieerOefeningNaarBibliotheek('0e000000-0000-4000-8000-0000000000ff')).rejects.toThrow('Oefening niet gevonden')
    expect(m.calls.inserts).toHaveLength(0)
  })

  it('een id dat geen UUID is geeft dezelfde melding, zonder databasequery', async () => {
    const m = makeEngine(ASSISTENT)
    useEngine(m)

    for (const id of ['', 'geen-uuid', undefined, null]) {
      await expect(kopieerOefeningNaarBibliotheek(id as unknown as string), String(id)).rejects.toThrow('Oefening niet gevonden')
    }
    expect(m.calls.ops.filter((o) => o.table === 'oefeningen')).toHaveLength(0)
  })

  it('een leesfout gaat generiek naar de client en zonder ruwe tekst naar de log', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    useEngine(makeEngine(ASSISTENT, { leesFout: true }))

    await expect(kopieerOefeningNaarBibliotheek(OEF_HOOFD)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    const log = consoleError.mock.calls.map((a: unknown[]) => a.join(' ')).join('\n')
    expect(log).toContain('oefeningLibrary.kopieerOefeningNaarBibliotheek.lezen')
    expect(log).not.toContain('permission denied')
    consoleError.mockRestore()
  })

  it('een schrijffout gaat generiek naar de client en zonder ruwe tekst naar de log', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    useEngine(makeEngine(ASSISTENT, { schrijfFout: true }))

    await expect(kopieerOefeningNaarBibliotheek(OEF_HOOFD)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    const log = consoleError.mock.calls.map((a: unknown[]) => a.join(' ')).join('\n')
    expect(log).toContain('oefeningLibrary.kopieerOefeningNaarBibliotheek')
    expect(log).not.toContain('check constraint')
    consoleError.mockRestore()
  })
})

describe('AC 35 — een oefening van een ander is niet te bewerken of te verwijderen', () => {
  // De scherpste variant uit de story: de aanroeper is HOOFDTRAINER van het
  // team waarin de oefening gekoppeld staat. Hij ZIET de oefening (via het
  // plan), maar bezit hem niet.
  it('de hoofdtrainer kan de gekoppelde oefening van zijn assistent niet wijzigen', async () => {
    const m = makeEngine(HOOFDTRAINER)
    useEngine(m)

    await expect(updateOefening(OEF_ASSISTENT, baseInput({ naam: 'Gekaapt' }))).rejects.toThrow('Oefening niet gevonden')
    expect(oefening(m, OEF_ASSISTENT)!.naam).toBe('Positiespel van de assistent')
    expect(m.calls.ops.filter((o) => o.op === 'update')).toHaveLength(0)
  })

  it('de hoofdtrainer kan de gekoppelde oefening van zijn assistent niet verwijderen', async () => {
    const m = makeEngine(HOOFDTRAINER)
    useEngine(m)

    await expect(deleteOefening(OEF_ASSISTENT)).rejects.toThrow('Oefening niet gevonden')
    expect(oefening(m, OEF_ASSISTENT)).toBeDefined()
    expect(m.calls.ops.filter((o) => o.op === 'delete')).toHaveLength(0)
  })

  it('en andersom: de assistent kan de gekoppelde oefening van de hoofdtrainer niet wijzigen of verwijderen', async () => {
    const m = makeEngine(ASSISTENT)
    useEngine(m)

    await expect(updateOefening(OEF_HOOFD, baseInput())).rejects.toThrow('Oefening niet gevonden')
    await expect(deleteOefening(OEF_HOOFD)).rejects.toThrow('Oefening niet gevonden')
    expect(oefening(m, OEF_HOOFD)!.naam).toBe('Rondo van de hoofdtrainer')
  })

  it('de eigenaar kan zijn eigen gekoppelde oefening wél wijzigen, los van zijn teamrechten (BR 54)', async () => {
    const m = makeEngine(ASSISTENT)
    useEngine(m)

    await updateOefening(OEF_ASSISTENT, baseInput({ naam: 'Aangepast' }))
    expect(oefening(m, OEF_ASSISTENT)!.naam).toBe('Aangepast')
  })

  it('de eigenaarscheck gebruikt ctx.userId, niet het team', async () => {
    const m = makeEngine(HOOFDTRAINER)
    useEngine(m)

    await expect(updateOefening(OEF_ASSISTENT, baseInput())).rejects.toThrow('Oefening niet gevonden')
    expect(m.calls.eqs).toContainEqual({ table: 'oefeningen', op: 'select', col: 'team_id', val: HOOFDTRAINER })
    expect(m.calls.eqs).not.toContainEqual({ table: 'oefeningen', op: 'select', col: 'team_id', val: TEAM })
  })
})
