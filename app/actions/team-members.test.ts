// Tests voor app/actions/team-members.ts — staf beheren.
//
// WAT DEZE TESTS WEL EN NIET BEWIJZEN. Ze bewijzen de applicatielaag: de
// owner-check, de drie filters op elke schrijfactie, dat een owner-rij en de
// eigen rij onaanraakbaar zijn, en dat het e-mailadres strikt per user-id van
// DIT team wordt opgehaald. Ze bewijzen NIETS over de RLS-policies — de
// chainable stub hieronder past `.eq()` net zomin toe als de stub in de andere
// app/actions/*.test.ts (geheugen.md, "Belangrijke gotchas"). De filters
// worden daarom vastgelegd en geassert, niet toegepast. De policy-kant staat
// in supabase/team-rls-verificatie.sql, blok 17.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/team-context', async (importOriginal) => {
  const origineel = await importOriginal<typeof import('@/lib/team-context')>()
  return { ...origineel, requireTeamContext: vi.fn() }
})

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { requireTeamContext, type TeamContext } from '@/lib/team-context'
import { ALLE_RECHTEN, GEEN_RECHTEN, ONDERDELEN, RECHT_KOLOM } from '@/lib/team-rechten'
import { listTeamMembers, removeMember, updateMemberRights } from '@/app/actions/team-members'

const TEAM = '11111111-1111-4111-8111-111111111111'
const VREEMD_TEAM = '22222222-2222-4222-8222-222222222222'
const OWNER = 'owner-1'
const ASSISTENT = 'assistent-1'

type Filter = { op: string; col: string; val: unknown }

function makeSupabase(opts: {
  leden?: Record<string, unknown>[]
  selectError?: { code?: string; message: string }
  schrijfError?: { code?: string; message: string }
  // Wat de update/delete terugmeldt. Een lege array betekent "0 rijen geraakt"
  // — precies wat er gebeurt als de RLS-policy of het rol-filter de rij
  // buitensluit.
  geraakt?: { user_id: string }[]
} = {}) {
  const calls = {
    filters: [] as Filter[],
    updates: [] as Record<string, unknown>[],
    deletes: 0,
    selects: [] as string[],
  }

  function chain() {
    let modus: 'select' | 'update' | 'delete' = 'select'
    const c: Record<string, unknown> = {}
    c.select = (kolommen?: string) => {
      if (kolommen) calls.selects.push(kolommen)
      return c
    }
    c.update = (payload: Record<string, unknown>) => { modus = 'update'; calls.updates.push(payload); return c }
    c.delete = () => { modus = 'delete'; calls.deletes += 1; return c }
    c.eq = (col: string, val: unknown) => { calls.filters.push({ op: 'eq', col, val }); return c }
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => {
      if (modus === 'select') {
        return res({ data: opts.leden ?? [], error: opts.selectError ?? null })
      }
      return res({ data: opts.geraakt ?? [{ user_id: ASSISTENT }], error: opts.schrijfError ?? null })
    }
    return c
  }

  return { calls, supabase: { from: () => chain() } }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(
    mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>,
  )
}

function makeAdmin(emails: Record<string, string>, fout?: { code?: string; message: string }) {
  const opgevraagd: string[] = []
  const getUserById = vi.fn(async (id: string) => {
    opgevraagd.push(id)
    if (fout) return { data: null, error: fout }
    return { data: { user: { id, email: emails[id] ?? null } }, error: null }
  })
  return { opgevraagd, admin: { auth: { admin: { getUserById } } } }
}

function ownerCtx(): TeamContext {
  return {
    userId: OWNER,
    teamId: TEAM,
    rol: 'owner',
    rechten: { ...ALLE_RECHTEN },
    teams: [{ teamId: TEAM, naam: 'Team A', rol: 'owner', rechten: { ...ALLE_RECHTEN } }],
  }
}

function assistentCtx(): TeamContext {
  // Bewust met ALLE ZES bewerkrechten: staf beheren is hoofdtrainer-werk en
  // valt dus niet onder de rechten-vlaggen (AC 32/46).
  return {
    userId: ASSISTENT,
    teamId: TEAM,
    rol: 'assistent',
    rechten: { ...ALLE_RECHTEN },
    teams: [{ teamId: TEAM, naam: 'Team A', rol: 'assistent', rechten: { ...ALLE_RECHTEN } }],
  }
}

function assistentRij(userId: string, rechten: Partial<Record<string, boolean>> = {}) {
  return {
    user_id: userId,
    rol: 'assistent',
    mag_spelers_bewerken: false,
    mag_agenda_bewerken: false,
    mag_aanwezigheid_bewerken: false,
    mag_wedstrijd_bewerken: false,
    mag_training_bewerken: false,
    mag_periodisering_bewerken: false,
    ...rechten,
  }
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(requireTeamContext).mockResolvedValue(ownerCtx())
  vi.mocked(createAdminClient).mockReturnValue(null)
  use(makeSupabase())
})

afterEach(() => {
  consoleError.mockRestore()
})

function loggedText(): string {
  return consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
}

function teamFilters(calls: { filters: Filter[] }): Filter[] {
  return calls.filters.filter((f) => f.col === 'team_id')
}

// ────────────────────────────────────────────────
// listTeamMembers
// ────────────────────────────────────────────────

describe('listTeamMembers', () => {
  it('leest uitsluitend de leden van het ACTIEVE team', async () => {
    const m = makeSupabase({ leden: [assistentRij(ASSISTENT)] })
    use(m)

    await listTeamMembers()

    expect(teamFilters(m.calls)).toEqual([{ op: 'eq', col: 'team_id', val: TEAM }])
  })

  it('vraagt alleen de kolommen op die de UI nodig heeft, nooit select(*)', async () => {
    const m = makeSupabase({ leden: [] })
    use(m)

    await listTeamMembers()

    expect(m.calls.selects[0]).not.toContain('*')
    for (const kolom of Object.values(RECHT_KOLOM)) {
      expect(m.calls.selects[0]).toContain(kolom)
    }
  })

  it('geeft een hoofdtrainer alle zes rechten, ongeacht wat er in de kolommen staat', async () => {
    use(makeSupabase({ leden: [{ user_id: OWNER, rol: 'owner' }] }))

    const leden = await listTeamMembers()

    expect(leden[0].rol).toBe('owner')
    for (const onderdeel of ONDERDELEN) expect(leden[0].rechten[onderdeel]).toBe(true)
  })

  it('leest bij een assistent elk recht uit zijn eigen kolom', async () => {
    use(makeSupabase({ leden: [assistentRij(ASSISTENT, { mag_training_bewerken: true })] }))

    const leden = await listTeamMembers()

    expect(leden[0].rechten.training).toBe(true)
    expect(leden[0].rechten.spelers).toBe(false)
  })

  it('zet de hoofdtrainer bovenaan', async () => {
    use(makeSupabase({ leden: [assistentRij(ASSISTENT), { user_id: OWNER, rol: 'owner' }] }))

    const leden = await listTeamMembers()

    expect(leden.map((l) => l.rol)).toEqual(['owner', 'assistent'])
  })

  // De service-role-key is het scherpste gereedschap in de doos. Hij mag hier
  // alleen gebruikt worden om per user-id die AL in team_members van dit team
  // staat het e-mailadres op te halen — nooit een lijstquery over alle
  // accounts van het project.
  it('vraagt e-mailadressen strikt per user-id van dit team op', async () => {
    const admin = makeAdmin({ [OWNER]: 'coach@example.com', [ASSISTENT]: 'hulp@example.com' })
    vi.mocked(createAdminClient).mockReturnValue(admin.admin as unknown as ReturnType<typeof createAdminClient>)
    use(makeSupabase({ leden: [{ user_id: OWNER, rol: 'owner' }, assistentRij(ASSISTENT)] }))

    const leden = await listTeamMembers()

    expect(admin.opgevraagd.sort()).toEqual([ASSISTENT, OWNER].sort())
    expect(leden.find((l) => l.userId === ASSISTENT)?.email).toBe('hulp@example.com')
  })

  it('geeft per lid niets anders terug dan userId, e-mail, rol en rechten', async () => {
    const admin = makeAdmin({ [ASSISTENT]: 'hulp@example.com' })
    vi.mocked(createAdminClient).mockReturnValue(admin.admin as unknown as ReturnType<typeof createAdminClient>)
    use(makeSupabase({ leden: [assistentRij(ASSISTENT)] }))

    const leden = await listTeamMembers()

    expect(Object.keys(leden[0]).sort()).toEqual(['email', 'rechten', 'rol', 'userId'])
  })

  // Brief §3.3: nette degradatie in plaats van falen.
  it('degradeert naar e-mail = null zonder service-role-key, en faalt niet', async () => {
    vi.mocked(createAdminClient).mockReturnValue(null)
    use(makeSupabase({ leden: [assistentRij(ASSISTENT)] }))

    const leden = await listTeamMembers()

    expect(leden[0].email).toBeNull()
    expect(loggedText()).toContain('teamMembers.emails')
  })

  it('degradeert ook wanneer het ophalen van één adres mislukt', async () => {
    const admin = makeAdmin({}, { code: 'user_not_found', message: 'User not found' })
    vi.mocked(createAdminClient).mockReturnValue(admin.admin as unknown as ReturnType<typeof createAdminClient>)
    use(makeSupabase({ leden: [assistentRij(ASSISTENT)] }))

    const leden = await listTeamMembers()

    expect(leden[0].email).toBeNull()
    expect(loggedText()).not.toContain('User not found')
  })

  it('weigert een assistent, ook met alle zes bewerkrechten', async () => {
    vi.mocked(requireTeamContext).mockResolvedValue(assistentCtx())
    const m = makeSupabase()
    use(m)

    await expect(listTeamMembers()).rejects.toThrow('Geen toegang')
    expect(m.calls.filters).toHaveLength(0)
  })

  it('lekt de ruwe databasefout niet', async () => {
    use(makeSupabase({ selectError: { code: '42501', message: 'permission denied for table team_members' } }))

    await expect(listTeamMembers()).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(loggedText()).toContain('teamMembers.listTeamMembers')
    expect(loggedText()).not.toContain('permission denied')
  })
})

// ────────────────────────────────────────────────
// updateMemberRights
// ────────────────────────────────────────────────

describe('updateMemberRights', () => {
  it('schrijft precies de zes kolommen', async () => {
    const m = makeSupabase()
    use(m)

    await updateMemberRights(ASSISTENT, { ...GEEN_RECHTEN, training: true })

    expect(m.calls.updates).toHaveLength(1)
    expect(m.calls.updates[0]).toEqual({
      mag_spelers_bewerken: false,
      mag_agenda_bewerken: false,
      mag_aanwezigheid_bewerken: false,
      mag_wedstrijd_bewerken: false,
      mag_training_bewerken: true,
      mag_periodisering_bewerken: false,
    })
  })

  it('negeert onbekende sleutels — een client kan geen andere kolom meesturen', async () => {
    const m = makeSupabase()
    use(m)

    await updateMemberRights(ASSISTENT, { ...GEEN_RECHTEN, rol: 'owner', mag_alles: true } as Record<string, unknown>)

    expect(Object.keys(m.calls.updates[0]).sort()).toEqual(Object.values(RECHT_KOLOM).sort())
  })

  it('behandelt alles wat geen expliciete true is als "geen recht"', async () => {
    const m = makeSupabase()
    use(m)

    await updateMemberRights(ASSISTENT, { training: 'ja', spelers: 1, agenda: null } as unknown as Record<string, unknown>)

    expect(Object.values(m.calls.updates[0]).every((v) => v === false)).toBe(true)
  })

  // Drie filters, alle drie nodig: team_id is de tenant-grens, user_id het
  // doel, en rol = 'assistent' houdt de owner-rij onaanraakbaar — precies wat
  // de RLS-policy ook eist.
  it('filtert op team_id, user_id én rol = assistent', async () => {
    const m = makeSupabase()
    use(m)

    await updateMemberRights(ASSISTENT, { ...GEEN_RECHTEN })

    expect(m.calls.filters).toEqual([
      { op: 'eq', col: 'team_id', val: TEAM },
      { op: 'eq', col: 'user_id', val: ASSISTENT },
      { op: 'eq', col: 'rol', val: 'assistent' },
    ])
  })

  it('weigert de eigen rij vóór elke query — een hoofdtrainer kan zichzelf niet degraderen (AC 32)', async () => {
    const m = makeSupabase()
    use(m)

    await expect(updateMemberRights(OWNER, { ...GEEN_RECHTEN })).rejects.toThrow('Teamlid niet gevonden')
    expect(m.calls.updates).toHaveLength(0)
    expect(m.calls.filters).toHaveLength(0)
  })

  it('weigert een lege user-id', async () => {
    const m = makeSupabase()
    use(m)

    await expect(updateMemberRights('', { ...GEEN_RECHTEN })).rejects.toThrow('Teamlid niet gevonden')
    expect(m.calls.updates).toHaveLength(0)
  })

  it('geeft dezelfde melding als er 0 rijen geraakt zijn — dat verraadt niet of het een vreemd lid of de hoofdtrainer was', async () => {
    use(makeSupabase({ geraakt: [] }))

    await expect(updateMemberRights('iemand-anders', { ...GEEN_RECHTEN })).rejects.toThrow('Teamlid niet gevonden')
  })

  it('weigert een assistent met alle zes bewerkrechten (AC 32)', async () => {
    vi.mocked(requireTeamContext).mockResolvedValue(assistentCtx())
    const m = makeSupabase()
    use(m)

    await expect(updateMemberRights('iemand', { ...ALLE_RECHTEN })).rejects.toThrow('Geen toegang')
    expect(m.calls.updates).toHaveLength(0)
  })

  it('lekt de ruwe databasefout niet', async () => {
    use(makeSupabase({ schrijfError: { code: '42501', message: 'permission denied for table team_members' } }))

    await expect(updateMemberRights(ASSISTENT, { ...GEEN_RECHTEN })).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(loggedText()).toContain('teamMembers.updateMemberRights')
    expect(loggedText()).not.toContain('permission denied')
  })
})

// ────────────────────────────────────────────────
// removeMember
// ────────────────────────────────────────────────

describe('removeMember', () => {
  it('verwijdert alleen de team_members-rij en raakt geen andere tabel aan', async () => {
    const m = makeSupabase()
    use(m)

    const resultaat = await removeMember(ASSISTENT)

    expect(resultaat).toEqual({ ok: true })
    expect(m.calls.deletes).toBe(1)
    expect(m.calls.updates).toHaveLength(0)
  })

  it('filtert op team_id, user_id én rol = assistent', async () => {
    const m = makeSupabase()
    use(m)

    await removeMember(ASSISTENT)

    expect(m.calls.filters).toEqual([
      { op: 'eq', col: 'team_id', val: TEAM },
      { op: 'eq', col: 'user_id', val: ASSISTENT },
      { op: 'eq', col: 'rol', val: 'assistent' },
    ])
  })

  it('weigert zichzelf vóór elke query — anders ontstaat er een team zonder hoofdtrainer (AC 32)', async () => {
    const m = makeSupabase()
    use(m)

    await expect(removeMember(OWNER)).rejects.toThrow('Teamlid niet gevonden')
    expect(m.calls.deletes).toBe(0)
    expect(m.calls.filters).toHaveLength(0)
  })

  it('geeft dezelfde melding als er 0 rijen geraakt zijn', async () => {
    use(makeSupabase({ geraakt: [] }))

    await expect(removeMember('iemand-anders')).rejects.toThrow('Teamlid niet gevonden')
  })

  it('weigert een assistent met alle zes bewerkrechten', async () => {
    vi.mocked(requireTeamContext).mockResolvedValue(assistentCtx())
    const m = makeSupabase()
    use(m)

    await expect(removeMember('iemand')).rejects.toThrow('Geen toegang')
    expect(m.calls.deletes).toBe(0)
  })

  it('weigert een hoofdtrainer van een ANDER team — assertIsOwner kijkt naar het actieve team', async () => {
    vi.mocked(requireTeamContext).mockResolvedValue({
      userId: OWNER,
      teamId: TEAM,
      rol: 'assistent',
      rechten: { ...GEEN_RECHTEN },
      teams: [
        { teamId: TEAM, naam: 'Team A', rol: 'assistent', rechten: { ...GEEN_RECHTEN } },
        { teamId: VREEMD_TEAM, naam: 'Team B', rol: 'owner', rechten: { ...ALLE_RECHTEN } },
      ],
    })
    const m = makeSupabase()
    use(m)

    await expect(removeMember(ASSISTENT)).rejects.toThrow('Geen toegang')
    expect(m.calls.deletes).toBe(0)
  })

  it('lekt de ruwe databasefout niet', async () => {
    use(makeSupabase({ schrijfError: { code: '42501', message: 'permission denied for table team_members' } }))

    await expect(removeMember(ASSISTENT)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(loggedText()).toContain('teamMembers.removeMember')
    expect(loggedText()).not.toContain('permission denied')
  })
})
