// Tests voor app/actions/team.ts — setActiveTeam, createTeam en (fase 3)
// getTeamDeleteInfo, deleteTeam en leaveTeam.
//
// Twee kernen. Voor setActiveTeam: de active_team-cookie is een KEUZE tussen
// de eigen lidmaatschappen en nooit een autorisatiebron — een team-id waar
// geen lidmaatschap voor bestaat mag de cookie niet kunnen bereiken. Voor
// createTeam: de drie schrijfacties lopen via de RPC create_team, zodat er
// nooit een team zonder hoofdtrainer kan ontstaan, en iemand ZONDER team moet
// hem juist kunnen gebruiken (de lege staat, AC 16/52).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/team-context', async (importOriginal) => {
  const origineel = await importOriginal<typeof import('@/lib/team-context')>()
  return { ...origineel, requireTeamContext: vi.fn() }
})

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { ACTIVE_TEAM_COOKIE, requireTeamContext, type TeamContext } from '@/lib/team-context'
import { ALLE_RECHTEN, GEEN_RECHTEN } from '@/lib/team-rechten'
import { TEAM_TABELLEN } from '@/lib/team-opruimen'
import { TEAM_LOGO_BUCKET, teamLogoPath } from '@/lib/logo-upload'
import {
  createTeam,
  deleteTeam,
  getTeamDeleteInfo,
  leaveTeam,
  setActiveTeam,
} from '@/app/actions/team'

const TEAM_A = '11111111-1111-4111-8111-111111111111'
const TEAM_B = '22222222-2222-4222-8222-222222222222'
const VREEMD = '33333333-3333-4333-8333-333333333333'
const NIEUW = '44444444-4444-4444-8444-444444444444'

function ctxMetTwee(): TeamContext {
  return {
    userId: 'user-1',
    teamId: TEAM_A,
    rol: 'owner',
    rechten: { ...ALLE_RECHTEN },
    teams: [
      { teamId: TEAM_A, naam: 'Appel', rol: 'owner', rechten: { ...ALLE_RECHTEN } },
      { teamId: TEAM_B, naam: 'Zebra', rol: 'assistent', rechten: { ...GEEN_RECHTEN } },
    ],
  }
}

let gezet: { naam: string; value: string; options: Record<string, unknown> }[]
let gewist: string[]
let consoleError: ReturnType<typeof vi.spyOn>

// Minimale Supabase-mock voor createTeam: een sessie en de RPC create_team.
function makeSupabase(opts: {
  user?: { id: string } | null
  rpc?: { data: unknown; error?: { code?: string; message: string } | null }
} = {}) {
  const user = opts.user === undefined ? { id: 'user-1' } : opts.user
  const calls = { rpc: [] as { fn: string; args: Record<string, unknown> | undefined }[] }
  return {
    calls,
    supabase: {
      auth: { getUser: async () => ({ data: { user } }) },
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        calls.rpc.push({ fn, args })
        const uitkomst = opts.rpc ?? { data: NIEUW }
        return { data: uitkomst.data, error: uitkomst.error ?? null }
      },
    },
  }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(
    mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>,
  )
}

function loggedText(): string {
  return consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
}

beforeEach(() => {
  vi.clearAllMocks()
  gezet = []
  gewist = []
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(cookies).mockResolvedValue({
    set: (naam: string, value: string, options: Record<string, unknown>) => {
      gezet.push({ naam, value, options })
    },
    get: () => undefined,
    delete: (naam: string) => {
      gewist.push(naam)
    },
  } as unknown as Awaited<ReturnType<typeof cookies>>)
  vi.mocked(requireTeamContext).mockResolvedValue(ctxMetTwee())
  use(makeSupabase())
})

describe('setActiveTeam — succes', () => {
  it('zet de active_team-cookie op een team waar wél een lidmaatschap voor bestaat', async () => {
    await expect(setActiveTeam(TEAM_B)).rejects.toThrow('__redirect__:/')

    expect(gezet).toEqual([
      { naam: ACTIVE_TEAM_COOKIE, value: TEAM_B, options: { path: '/', maxAge: 60 * 60 * 24 * 365 } },
    ])
  })

  it('revalideert de layout en eindigt in een redirect — zonder die redirect leest dezelfde request de oude, cache()-de context', async () => {
    await expect(setActiveTeam(TEAM_B)).rejects.toThrow('__redirect__:/')
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('accepteert ook het al actieve team (idempotent)', async () => {
    await expect(setActiveTeam(TEAM_A)).rejects.toThrow('__redirect__:/')
    expect(gezet[0].value).toBe(TEAM_A)
  })
})

describe('setActiveTeam — weigeringen', () => {
  it('weigert een team waar geen lidmaatschap voor bestaat en laat de cookie ongemoeid', async () => {
    await expect(setActiveTeam(VREEMD)).rejects.toThrow('Team niet gevonden')
    expect(gezet).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een waarde die geen UUID is vóór enige vergelijking — zo kan er geen vrije tekst in de cookie belanden', async () => {
    await expect(setActiveTeam('../../etc/passwd')).rejects.toThrow('Team niet gevonden')
    expect(gezet).toHaveLength(0)
  })

  it('weigert een lege waarde', async () => {
    await expect(setActiveTeam('')).rejects.toThrow('Team niet gevonden')
    expect(gezet).toHaveLength(0)
  })

  it('geeft dezelfde melding voor een onbekend team en voor een ongeldige vorm — dat verraadt niet welk van de twee het was', async () => {
    const onbekend = await setActiveTeam(VREEMD).catch((e: Error) => e.message)
    const ongeldig = await setActiveTeam('geen-uuid').catch((e: Error) => e.message)
    expect(onbekend).toBe(ongeldig)
  })

  it('laat "Niet ingelogd" uit de teamcontext gewoon doorkomen', async () => {
    vi.mocked(requireTeamContext).mockRejectedValue(new Error('Niet ingelogd'))
    await expect(setActiveTeam(TEAM_B)).rejects.toThrow('Niet ingelogd')
    expect(gezet).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// createTeam (fase 2)
// ═══════════════════════════════════════════════════════════════════════

describe('createTeam', () => {
  it('maakt het team via de RPC create_team — één transactie, dus nooit een team zonder hoofdtrainer', async () => {
    const m = makeSupabase()
    use(m)

    await expect(createTeam('Nieuw team')).rejects.toThrow('__redirect__:/')

    expect(m.calls.rpc).toEqual([
      { fn: 'create_team', args: { p_naam: 'Nieuw team', p_alleen_zonder_team: false } },
    ])
  })

  // p_alleen_zonder_team hoort hier op FALSE te staan: een tweede, derde of
  // vierde team is precies de bedoeling (BR 37, geen limiet). Alleen het
  // zelfherstel in lib/team-context.ts zet hem op true.
  it('vraagt niet om idempotentie — een extra team aanmaken mag altijd', async () => {
    const m = makeSupabase()
    use(m)

    await expect(createTeam('Tweede team')).rejects.toThrow('__redirect__:/')

    expect((m.calls.rpc[0].args as { p_alleen_zonder_team: boolean }).p_alleen_zonder_team).toBe(false)
  })

  it('zet het nieuwe team meteen als actief en eindigt in een redirect', async () => {
    await expect(createTeam('Nieuw team')).rejects.toThrow('__redirect__:/')

    expect(gezet).toEqual([
      { naam: ACTIVE_TEAM_COOKIE, value: NIEUW, options: { path: '/', maxAge: 60 * 60 * 24 * 365 } },
    ])
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  // Dit is AC 16/52: iemand die net uit zijn laatste team is verwijderd heeft
  // nul lidmaatschappen en moet juist hier terechtkunnen. Daarom géén
  // requireTeamContext() in deze action.
  it('werkt zonder enkel lidmaatschap — de lege staat moet er een team kunnen maken', async () => {
    vi.mocked(requireTeamContext).mockRejectedValue(new Error('Geen team'))
    const m = makeSupabase()
    use(m)

    await expect(createTeam('Mijn eerste team')).rejects.toThrow('__redirect__:/')
    expect(m.calls.rpc).toHaveLength(1)
  })

  it('weigert zonder sessie en raakt niets aan', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(createTeam('Nieuw team')).rejects.toThrow('Niet ingelogd')
    expect(m.calls.rpc).toHaveLength(0)
    expect(gezet).toHaveLength(0)
  })

  it('weigert een lege naam vóór de database-aanroep', async () => {
    const m = makeSupabase()
    use(m)

    for (const naam of ['', '   ', '\n\t']) {
      await expect(createTeam(naam), naam).rejects.toThrow('Vul een teamnaam in')
    }
    expect(m.calls.rpc).toHaveLength(0)
    expect(gezet).toHaveLength(0)
  })

  it('knipt een te lange naam af op 80 tekens', async () => {
    const m = makeSupabase()
    use(m)

    await expect(createTeam('x'.repeat(200))).rejects.toThrow('__redirect__:/')
    expect((m.calls.rpc[0].args as { p_naam: string }).p_naam).toHaveLength(80)
  })

  it('trimt de naam, zodat "  JO13-1  " niet als andere naam wordt opgeslagen', async () => {
    const m = makeSupabase()
    use(m)

    await expect(createTeam('  JO13-1  ')).rejects.toThrow('__redirect__:/')
    expect((m.calls.rpc[0].args as { p_naam: string }).p_naam).toBe('JO13-1')
  })

  it('lekt de ruwe databasefout niet naar client of log, en zet geen cookie', async () => {
    use(makeSupabase({
      rpc: { data: null, error: { code: '42501', message: 'permission denied for table teams' } },
    }))

    await expect(createTeam('Nieuw team')).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(gezet).toHaveLength(0)
    expect(loggedText()).toContain('team.createTeam')
    expect(loggedText()).not.toContain('permission denied')
  })

  it('zet geen cookie als de RPC geen team-id teruggeeft', async () => {
    use(makeSupabase({ rpc: { data: null } }))

    await expect(createTeam('Nieuw team')).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(gezet).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Fase 3 — getTeamDeleteInfo, deleteTeam, leaveTeam
// ═══════════════════════════════════════════════════════════════════════
//
// Mock-smaak: een kleine tabel-engine die .eq() ECHT toepast en rijen echt
// verwijdert (geheugen.md: een stub die filters negeert blijft stil groen bij
// een verkeerd team-id). Zo is te bewijzen dat een verwijdering het ANDERE team
// ongemoeid laat. Eén ding bootst hij bewust na: de FK-cascade van teams naar
// team_members en team_invites (`references teams(id) on delete cascade`,
// supabase/teams-en-leden.sql) — dat is databasegedrag dat deleteTeam
// gebruikt in plaats van zelf die rijen te wissen. Dat die cascade in de echte
// database zo werkt, legt blok 22 van supabase/team-rls-verificatie.sql vast.

type Rij = Record<string, unknown>

const EIGEN_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ASSISTENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ANDERE_USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function makeStore(opts: {
  tabellen?: Record<string, Rij[]>
  tableError?: { table: string; error: { code?: string; message: string } }
  storageError?: { code?: string; message: string }
} = {}) {
  const store: Record<string, Rij[]> = { ...(opts.tabellen ?? {}) }
  const calls = {
    deletes: [] as string[],
    selects: [] as string[],
    storage: [] as { bucket: string; paths: string[] }[],
    updateUser: [] as Record<string, unknown>[],
  }

  function chain(table: string) {
    if (!store[table]) store[table] = []
    const rijen = store[table]
    const filters: ((r: Rij) => boolean)[] = []
    let verwijder = false
    const c: Record<string, unknown> = {}
    c.select = () => { calls.selects.push(table); return c }
    c.eq = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return c }
    c.delete = () => { calls.deletes.push(table); verwijder = true; return c }
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => {
      if (opts.tableError?.table === table) return res({ data: null, error: opts.tableError.error })
      const geraakt = rijen.filter((r) => filters.every((f) => f(r)))
      if (verwijder) {
        for (const r of geraakt) rijen.splice(rijen.indexOf(r), 1)
        // FK-cascade: teams -> team_members / team_invites.
        if (table === 'teams') {
          for (const kind of ['team_members', 'team_invites']) {
            const ids = new Set(geraakt.map((r) => r.id))
            store[kind] = (store[kind] ?? []).filter((r) => !ids.has(r.team_id))
          }
        }
      }
      return res({ data: geraakt, error: null })
    }
    return c
  }

  const supabase = {
    from: (t: string) => chain(t),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          calls.storage.push({ bucket, paths })
          return { data: [], error: opts.storageError ?? null }
        },
      }),
    },
    auth: {
      updateUser: async (payload: Record<string, unknown>) => {
        calls.updateUser.push(payload)
        return { data: null, error: null }
      },
    },
  }
  return { supabase, store, calls }
}

function useStore(m: ReturnType<typeof makeStore>) {
  vi.mocked(createClient).mockResolvedValue(
    m.supabase as unknown as Awaited<ReturnType<typeof createClient>>,
  )
}

// Hoofdtrainer van Appel (actief) en Zebra; alfabetisch zoals getTeamContext
// ze aanlevert. Het team-id wijkt bewust af van de user-id.
function ctxOwnerVanTwee(actief: string = TEAM_A): TeamContext {
  return {
    userId: EIGEN_USER,
    teamId: actief,
    rol: 'owner',
    rechten: { ...ALLE_RECHTEN },
    teams: [
      { teamId: TEAM_A, naam: 'Appel', rol: 'owner', rechten: { ...ALLE_RECHTEN } },
      { teamId: TEAM_B, naam: 'Zebra', rol: 'owner', rechten: { ...ALLE_RECHTEN } },
    ],
  }
}

// Eén rij per teamtabel voor elk van beide teams, plus lidmaatschappen,
// uitnodigingen en oefeningen (persoonlijk bezit, team_id = eigenaar-user).
function volleStore(extra: Parameters<typeof makeStore>[0] = {}) {
  const tabellen: Record<string, Rij[]> = {}
  for (const tabel of TEAM_TABELLEN) {
    tabellen[tabel] = [
      { id: `${tabel}-a`, team_id: TEAM_A },
      { id: `${tabel}-b`, team_id: TEAM_B },
    ]
  }
  tabellen.teams = [{ id: TEAM_A }, { id: TEAM_B }]
  tabellen.team_members = [
    { team_id: TEAM_A, user_id: EIGEN_USER, rol: 'owner' },
    { team_id: TEAM_A, user_id: ASSISTENT, rol: 'assistent' },
    { team_id: TEAM_B, user_id: EIGEN_USER, rol: 'owner' },
    { team_id: TEAM_B, user_id: ASSISTENT, rol: 'assistent' },
  ]
  tabellen.team_invites = [{ id: 'inv-a', team_id: TEAM_A }, { id: 'inv-b', team_id: TEAM_B }]
  tabellen.oefeningen = [
    { id: 'oef-eigen', team_id: EIGEN_USER },
    { id: 'oef-assistent', team_id: ASSISTENT },
  ]
  return makeStore({ ...extra, tabellen: { ...tabellen, ...(extra.tabellen ?? {}) } })
}

describe('getTeamDeleteInfo', () => {
  it('geeft de teamnaam en het aantal assistenten van DAT team (AC 14)', async () => {
    const m = makeStore({
      tabellen: {
        team_members: [
          { team_id: TEAM_A, user_id: EIGEN_USER, rol: 'owner' },
          { team_id: TEAM_A, user_id: ASSISTENT, rol: 'assistent' },
          { team_id: TEAM_A, user_id: ANDERE_USER, rol: 'assistent' },
          { team_id: TEAM_B, user_id: ASSISTENT, rol: 'assistent' },
        ],
      },
    })
    useStore(m)
    vi.mocked(requireTeamContext).mockResolvedValue(ctxOwnerVanTwee())

    await expect(getTeamDeleteInfo(TEAM_A)).resolves.toEqual({ naam: 'Appel', aantalAssistenten: 2 })
    await expect(getTeamDeleteInfo(TEAM_B)).resolves.toEqual({ naam: 'Zebra', aantalAssistenten: 1 })
  })

  it('telt de hoofdtrainer zelf niet mee, en geeft 0 bij een team zonder assistenten', async () => {
    useStore(makeStore({ tabellen: { team_members: [{ team_id: TEAM_A, user_id: EIGEN_USER, rol: 'owner' }] } }))
    vi.mocked(requireTeamContext).mockResolvedValue(ctxOwnerVanTwee())

    await expect(getTeamDeleteInfo(TEAM_A)).resolves.toEqual({ naam: 'Appel', aantalAssistenten: 0 })
  })

  it('weigert een team waar de aanroeper alleen assistent is, zonder query', async () => {
    const m = makeStore()
    useStore(m)
    // ctxMetTwee: owner van A, assistent van B.

    await expect(getTeamDeleteInfo(TEAM_B)).rejects.toThrow('Geen toegang')
    expect(m.calls.selects).toHaveLength(0)
  })

  it('weigert een vreemd team en een ontbrekend of ongeldig id met dezelfde melding', async () => {
    const m = makeStore()
    useStore(m)

    for (const id of [VREEMD, undefined, null, '', 'geen-uuid']) {
      await expect(getTeamDeleteInfo(id as unknown as string), String(id)).rejects.toThrow('Geen toegang')
    }
    expect(m.calls.selects).toHaveLength(0)
  })

  it('lekt een databasefout niet', async () => {
    useStore(makeStore({ tableError: { table: 'team_members', error: { code: '42501', message: 'permission denied for table team_members' } } }))

    await expect(getTeamDeleteInfo(TEAM_A)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(loggedText()).toContain('team.getTeamDeleteInfo')
    expect(loggedText()).not.toContain('permission denied')
  })
})

describe('deleteTeam — succes', () => {
  it('verwijdert bij een hoofdtrainer van twee teams er één; het andere blijft volledig staan', async () => {
    const m = volleStore()
    useStore(m)
    vi.mocked(requireTeamContext).mockResolvedValue(ctxOwnerVanTwee())

    await expect(deleteTeam(TEAM_A)).rejects.toThrow('__redirect__:/')

    for (const tabel of TEAM_TABELLEN) {
      expect(m.store[tabel].map((r) => r.team_id), tabel).toEqual([TEAM_B])
    }
    expect(m.store.teams).toEqual([{ id: TEAM_B }])
    expect(m.store.team_invites.map((r) => r.team_id)).toEqual([TEAM_B])
  })

  it('wist de dertien teamtabellen in de gedeelde volgorde en daarna de teams-rij (zelfde code als deleteAccount)', async () => {
    const m = volleStore()
    useStore(m)
    vi.mocked(requireTeamContext).mockResolvedValue(ctxOwnerVanTwee())

    await expect(deleteTeam(TEAM_A)).rejects.toThrow('__redirect__:/')

    expect(m.calls.deletes).toEqual([...TEAM_TABELLEN, 'teams'])
    expect(m.calls.storage).toEqual([{ bucket: TEAM_LOGO_BUCKET, paths: [teamLogoPath(TEAM_A)] }])
  })

  it('de assistenten verliezen hun lidmaatschap van DIT team, niet van het andere', async () => {
    const m = volleStore()
    useStore(m)
    vi.mocked(requireTeamContext).mockResolvedValue(ctxOwnerVanTwee())

    await expect(deleteTeam(TEAM_A)).rejects.toThrow('__redirect__:/')

    expect(m.store.team_members).toEqual([
      { team_id: TEAM_B, user_id: EIGEN_USER, rol: 'owner' },
      { team_id: TEAM_B, user_id: ASSISTENT, rol: 'assistent' },
    ])
  })

  // BR 54: oefeningen zijn persoonlijk bezit en overleven het team — die van
  // de hoofdtrainer én die van de assistenten. Alleen hun koppelingen aan dit
  // team (training_oefeningen) gaan mee.
  it('raakt oefeningen nooit aan', async () => {
    const m = volleStore()
    useStore(m)
    vi.mocked(requireTeamContext).mockResolvedValue(ctxOwnerVanTwee())

    await expect(deleteTeam(TEAM_A)).rejects.toThrow('__redirect__:/')

    expect(m.calls.deletes).not.toContain('oefeningen')
    expect(m.store.oefeningen.map((r) => r.id)).toEqual(['oef-eigen', 'oef-assistent'])
  })

  it('schakelt het actieve team naar het eerstvolgende als het actieve team verdwijnt (AC 17)', async () => {
    useStore(volleStore())
    vi.mocked(requireTeamContext).mockResolvedValue(ctxOwnerVanTwee(TEAM_A))

    await expect(deleteTeam(TEAM_A)).rejects.toThrow('__redirect__:/')

    expect(gezet).toEqual([
      { naam: ACTIVE_TEAM_COOKIE, value: TEAM_B, options: { path: '/', maxAge: 60 * 60 * 24 * 365 } },
    ])
    expect(gewist).toHaveLength(0)
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('laat het actieve team staan als een ANDER team wordt verwijderd', async () => {
    useStore(volleStore())
    vi.mocked(requireTeamContext).mockResolvedValue(ctxOwnerVanTwee(TEAM_A))

    await expect(deleteTeam(TEAM_B)).rejects.toThrow('__redirect__:/')

    expect(gezet.map((c) => c.value)).toEqual([TEAM_A])
  })

  it('wist bij het laatste team de cookie en de geparkeerde teamnaam — de lege staat (AC 16)', async () => {
    const m = volleStore()
    useStore(m)
    vi.mocked(requireTeamContext).mockResolvedValue({
      userId: EIGEN_USER,
      teamId: TEAM_A,
      rol: 'owner',
      rechten: { ...ALLE_RECHTEN },
      teams: [{ teamId: TEAM_A, naam: 'Appel', rol: 'owner', rechten: { ...ALLE_RECHTEN } }],
    })

    await expect(deleteTeam(TEAM_A)).rejects.toThrow('__redirect__:/')

    expect(gezet).toHaveLength(0)
    expect(gewist).toEqual([ACTIVE_TEAM_COOKIE])
    // Anders kan het zelfherstel in lib/team-context.ts na het verlies van
    // het laatste team een leeg team terugtoveren.
    expect(m.calls.updateUser).toEqual([{ data: { pitchup_team_name: null } }])
  })

  it('wist de geparkeerde teamnaam NIET zolang er nog een team over is', async () => {
    const m = volleStore()
    useStore(m)
    vi.mocked(requireTeamContext).mockResolvedValue(ctxOwnerVanTwee())

    await expect(deleteTeam(TEAM_A)).rejects.toThrow('__redirect__:/')
    expect(m.calls.updateUser).toHaveLength(0)
  })

  it('laat een ontbrekend logo de verwijdering niet blokkeren', async () => {
    const m = volleStore({ storageError: { code: '404', message: 'Object not found' } })
    useStore(m)
    vi.mocked(requireTeamContext).mockResolvedValue(ctxOwnerVanTwee())

    await expect(deleteTeam(TEAM_A)).rejects.toThrow('__redirect__:/')
    expect(m.store.teams).toEqual([{ id: TEAM_B }])
    expect(loggedText()).toContain('team.deleteTeam.storage')
    expect(loggedText()).not.toContain('Object not found')
  })
})

describe('deleteTeam — weigeringen (AC 31)', () => {
  it('weigert een assistent van het team en raakt niets aan', async () => {
    const m = volleStore()
    useStore(m)
    // ctxMetTwee: owner van A, ASSISTENT van B.

    await expect(deleteTeam(TEAM_B)).rejects.toThrow('Geen toegang')

    expect(m.calls.deletes).toHaveLength(0)
    expect(m.calls.storage).toHaveLength(0)
    expect(gezet).toHaveLength(0)
    expect(gewist).toHaveLength(0)
    expect(m.store.teams).toHaveLength(2)
  })

  it('weigert een team waar de aanroeper geen lid van is', async () => {
    const m = volleStore()
    useStore(m)

    await expect(deleteTeam(VREEMD)).rejects.toThrow('Geen toegang')
    expect(m.calls.deletes).toHaveLength(0)
  })

  // assertIsOwner valt bij een ontbrekend teamId terug op het ACTIEVE team. Een
  // action-argument komt van de client; zonder de vormcheck zou
  // deleteTeam(undefined) het actieve team als doel goedkeuren.
  it('keurt een ontbrekend of ongeldig id NIET goed als "het actieve team"', async () => {
    const m = volleStore()
    useStore(m)
    vi.mocked(requireTeamContext).mockResolvedValue(ctxOwnerVanTwee(TEAM_A))

    for (const id of [undefined, null, '', 'geen-uuid', `${TEAM_A} `]) {
      await expect(deleteTeam(id as unknown as string), String(id)).rejects.toThrow('Geen toegang')
    }
    expect(m.calls.deletes).toHaveLength(0)
    expect(m.calls.storage).toHaveLength(0)
  })

  it('laat "Niet ingelogd" en "Geen team" uit de teamcontext gewoon doorkomen', async () => {
    const m = volleStore()
    useStore(m)
    vi.mocked(requireTeamContext).mockRejectedValueOnce(new Error('Niet ingelogd'))
    await expect(deleteTeam(TEAM_A)).rejects.toThrow('Niet ingelogd')
    vi.mocked(requireTeamContext).mockRejectedValueOnce(new Error('Geen team'))
    await expect(deleteTeam(TEAM_A)).rejects.toThrow('Geen team')
    expect(m.calls.deletes).toHaveLength(0)
  })
})

describe('deleteTeam — gedeeltelijke mislukking is niet stil', () => {
  it('stopt met een generieke melding, logt de stap zonder team-id en laat cookie en teams-rij staan', async () => {
    const m = volleStore({
      tableError: { table: 'events', error: { code: '42501', message: 'permission denied for table events' } },
    })
    useStore(m)
    vi.mocked(requireTeamContext).mockResolvedValue(ctxOwnerVanTwee())

    await expect(deleteTeam(TEAM_A)).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(m.calls.deletes).not.toContain('teams')
    expect(m.store.teams).toHaveLength(2)
    expect(gezet).toHaveLength(0)
    expect(gewist).toHaveLength(0)
    expect(loggedText()).toContain('team.deleteTeam.events')
    expect(loggedText()).not.toContain(TEAM_A)
    expect(loggedText()).not.toContain('permission denied')
  })
})

describe('leaveTeam (geen UI in deze scope, beslissing 8)', () => {
  // Hoofdtrainer van Appel (A), assistent bij Zebra (B).
  it('zegt alleen de eigen assistent-rij van dat team op; teamdata en andere leden blijven', async () => {
    const m = makeStore({
      tabellen: {
        team_members: [
          { team_id: TEAM_A, user_id: 'user-1', rol: 'owner' },
          { team_id: TEAM_B, user_id: 'user-1', rol: 'assistent' },
          { team_id: TEAM_B, user_id: ANDERE_USER, rol: 'owner' },
        ],
      },
    })
    useStore(m)

    await expect(leaveTeam(TEAM_B)).rejects.toThrow('__redirect__:/')

    expect(m.calls.deletes).toEqual(['team_members'])
    expect(m.store.team_members).toEqual([
      { team_id: TEAM_A, user_id: 'user-1', rol: 'owner' },
      { team_id: TEAM_B, user_id: ANDERE_USER, rol: 'owner' },
    ])
    // Het actieve team (A) blijft actief.
    expect(gezet.map((c) => c.value)).toEqual([TEAM_A])
  })

  it('schakelt naar het eerstvolgende team als het actieve team wordt verlaten', async () => {
    useStore(makeStore())
    vi.mocked(requireTeamContext).mockResolvedValue({ ...ctxMetTwee(), teamId: TEAM_B, rol: 'assistent' })

    await expect(leaveTeam(TEAM_B)).rejects.toThrow('__redirect__:/')
    expect(gezet.map((c) => c.value)).toEqual([TEAM_A])
  })

  it('weigert een hoofdtrainer — er is geen overdracht, en een team zonder owner is onbereikbaar', async () => {
    const m = makeStore()
    useStore(m)

    await expect(leaveTeam(TEAM_A)).rejects.toThrow('Geen toegang')
    expect(m.calls.deletes).toHaveLength(0)
    expect(gezet).toHaveLength(0)
  })

  it('weigert een team zonder lidmaatschap en een ongeldig id met dezelfde melding', async () => {
    const m = makeStore()
    useStore(m)

    for (const id of [VREEMD, undefined, 'geen-uuid']) {
      await expect(leaveTeam(id as unknown as string), String(id)).rejects.toThrow('Team niet gevonden')
    }
    expect(m.calls.deletes).toHaveLength(0)
  })

  it('lekt een databasefout niet en laat de cookie staan', async () => {
    useStore(makeStore({ tableError: { table: 'team_members', error: { code: '42501', message: 'permission denied' } } }))

    await expect(leaveTeam(TEAM_B)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(gezet).toHaveLength(0)
    expect(loggedText()).toContain('team.leaveTeam')
    expect(loggedText()).not.toContain('permission denied')
  })
})
