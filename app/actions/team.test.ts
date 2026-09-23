// Tests voor app/actions/team.ts — setActiveTeam en createTeam.
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
import { createTeam, setActiveTeam } from '@/app/actions/team'

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
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(cookies).mockResolvedValue({
    set: (naam: string, value: string, options: Record<string, unknown>) => {
      gezet.push({ naam, value, options })
    },
    get: () => undefined,
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
