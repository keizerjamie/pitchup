// Tests voor app/actions/team.ts — in fase 1 alleen setActiveTeam.
//
// De kern die hier bewezen moet worden: de active_team-cookie is een KEUZE
// tussen de eigen lidmaatschappen en nooit een autorisatiebron. Een team-id
// waar geen lidmaatschap voor bestaat mag de cookie niet kunnen bereiken.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
}))
vi.mock('@/lib/team-context', async (importOriginal) => {
  const origineel = await importOriginal<typeof import('@/lib/team-context')>()
  return { ...origineel, requireTeamContext: vi.fn() }
})

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { ACTIVE_TEAM_COOKIE, requireTeamContext, type TeamContext } from '@/lib/team-context'
import { ALLE_RECHTEN, GEEN_RECHTEN } from '@/lib/team-rechten'
import { setActiveTeam } from '@/app/actions/team'

const TEAM_A = '11111111-1111-4111-8111-111111111111'
const TEAM_B = '22222222-2222-4222-8222-222222222222'
const VREEMD = '33333333-3333-4333-8333-333333333333'

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

beforeEach(() => {
  vi.clearAllMocks()
  gezet = []
  vi.mocked(cookies).mockResolvedValue({
    set: (naam: string, value: string, options: Record<string, unknown>) => {
      gezet.push({ naam, value, options })
    },
    get: () => undefined,
  } as unknown as Awaited<ReturnType<typeof cookies>>)
  vi.mocked(requireTeamContext).mockResolvedValue(ctxMetTwee())
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
