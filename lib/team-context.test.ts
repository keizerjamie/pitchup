// Unit-tests voor de teamcontext (lib/team-context.ts) — de laag die "wie ben
// ik" (userId) en "voor welk team werk ik nu" (teamId) uit elkaar trekt.
//
// LET OP wat deze tests WEL en NIET bewijzen. Ze bewijzen de applicatielaag:
// sortering, de cookie-keuze, de rechtenafleiding en de foutmeldingen. Ze
// bewijzen NIETS over de RLS-policies — vitest praat nooit met een database.
// Die kant wordt geverifieerd met supabase/team-rls-verificatie.sql.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
}))

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import {
  ACTIVE_TEAM_COOKIE,
  TEAM_NAAM_METADATA_KEY,
  assertCanEdit,
  assertIsOwner,
  canEdit,
  getTeamContext,
  requireTeamContext,
  requireTeamContextOrLogin,
  type TeamContext,
} from '@/lib/team-context'
import { ONDERDELEN } from '@/lib/team-rechten'

type MemberRij = Record<string, unknown>
type SettingsRij = { team_id: string; value: string }

// Minimale Supabase-mock: twee tabellen, filters worden bewust NIET toegepast
// (zelfde chainable-stub-smaak als app/actions/*.test.ts). De filters worden
// wel vastgelegd, zodat de tenant-check op user_id assertbaar is.
function makeSupabase(opts: {
  user?: { id: string; user_metadata?: Record<string, unknown> } | null
  members?: MemberRij[]
  memberError?: unknown
  settings?: SettingsRij[]
  settingsError?: unknown
  // Fout op precies één insert-doel, om het faalpad van maakEigenTeam te
  // kunnen aansturen.
  insertError?: { table: string; error: { code?: string; message: string } }
} = {}) {
  const user = opts.user === undefined ? { id: 'user-1' } : opts.user
  const calls = {
    filters: [] as { table: string; op: string; col: string; val: unknown }[],
    inserts: [] as { table: string; payload: Record<string, unknown> }[],
    updateUser: [] as Record<string, unknown>[],
  }

  function chain(table: string) {
    const c: Record<string, unknown> = {}
    c.select = () => c
    for (const op of ['eq', 'in']) {
      c[op] = (col: string, val: unknown) => {
        calls.filters.push({ table, op, col, val })
        return c
      }
    }
    c.insert = (payload: Record<string, unknown>) => {
      calls.inserts.push({ table, payload })
      const fout = opts.insertError?.table === table ? opts.insertError.error : null
      return { then: (res: (v: unknown) => unknown) => res({ data: null, error: fout }) }
    }
    const result = table === 'team_members'
      ? { data: opts.members ?? [], error: opts.memberError ?? null }
      : { data: opts.settings ?? [], error: opts.settingsError ?? null }
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
    return c
  }

  return {
    calls,
    supabase: {
      from: (t: string) => chain(t),
      auth: {
        getUser: async () => ({ data: { user } }),
        updateUser: async (attrs: Record<string, unknown>) => {
          calls.updateUser.push(attrs)
          return { data: { user }, error: null }
        },
      },
    },
  }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(
    mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>,
  )
}

function useCookie(value?: string) {
  vi.mocked(cookies).mockResolvedValue({
    get: (naam: string) => (naam === ACTIVE_TEAM_COOKIE && value ? { value } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>)
}

function ownerRij(teamId: string): MemberRij {
  return { team_id: teamId, rol: 'owner' }
}

function assistentRij(teamId: string, rechten: Partial<Record<string, boolean>> = {}): MemberRij {
  return {
    team_id: teamId,
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
  useCookie()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('getTeamContext — lidmaatschappen lezen', () => {
  it('scheidt identiteit van tenant: userId uit de sessie, teamId uit team_members', async () => {
    use(makeSupabase({
      user: { id: 'user-1' },
      members: [assistentRij('team-a')],
      settings: [{ team_id: 'team-a', value: 'Team A' }],
    }))

    const ctx = (await getTeamContext())!
    expect(ctx.userId).toBe('user-1')
    expect(ctx.teamId).toBe('team-a')
  })

  it('filtert team_members op de eigen user_id — de policy laat een owner óók de rijen van zijn assistenten zien', async () => {
    const m = makeSupabase({ members: [ownerRij('team-a')] })
    use(m)

    await getTeamContext()

    expect(m.calls.filters).toContainEqual({
      table: 'team_members', op: 'eq', col: 'user_id', val: 'user-1',
    })
  })

  it('geeft null zonder sessie', async () => {
    use(makeSupabase({ user: null }))
    expect(await getTeamContext()).toBeNull()
  })

  it('geeft null zonder enkel lidmaatschap', async () => {
    use(makeSupabase({ members: [] }))
    expect(await getTeamContext()).toBeNull()
  })

  it('geeft null en logt een contextlabel bij een leesfout, zonder de rauwe fout', async () => {
    use(makeSupabase({ memberError: { code: '42501', message: 'permission denied for table team_members' } }))

    expect(await getTeamContext()).toBeNull()
    const gelogd = consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
    expect(gelogd).toContain('teamContext.leden')
    expect(gelogd).not.toContain('permission denied')
  })
})

describe('getTeamContext — sortering van teams', () => {
  it('sorteert alfabetisch op teamnaam', async () => {
    use(makeSupabase({
      members: [ownerRij('t-zebra'), assistentRij('t-appel'), assistentRij('t-midden')],
      settings: [
        { team_id: 't-zebra', value: 'Zebra' },
        { team_id: 't-appel', value: 'Appel' },
        { team_id: 't-midden', value: 'Midden' },
      ],
    }))

    const ctx = (await getTeamContext())!
    expect(ctx.teams.map((t) => t.naam)).toEqual(['Appel', 'Midden', 'Zebra'])
  })

  it('valt bij twee gelijke namen terug op het team-id, zodat de volgorde stabiel is', async () => {
    use(makeSupabase({
      members: [ownerRij('t-b'), assistentRij('t-a')],
      settings: [
        { team_id: 't-b', value: 'JO13-1' },
        { team_id: 't-a', value: 'JO13-1' },
      ],
    }))

    const ctx = (await getTeamContext())!
    expect(ctx.teams.map((t) => t.teamId)).toEqual(['t-a', 't-b'])
  })

  it('een team zonder settings-rij krijgt een lege naam en sorteert vooraan — geen crash', async () => {
    use(makeSupabase({
      members: [ownerRij('t-naamloos'), assistentRij('t-bekend')],
      settings: [{ team_id: 't-bekend', value: 'Bekend' }],
    }))

    const ctx = (await getTeamContext())!
    expect(ctx.teams.map((t) => t.naam)).toEqual(['', 'Bekend'])
  })
})

describe('getTeamContext — actief team en de cookie', () => {
  it('kiest het team uit een geldige active_team-cookie', async () => {
    useCookie('t-zebra')
    use(makeSupabase({
      members: [assistentRij('t-appel'), ownerRij('t-zebra')],
      settings: [
        { team_id: 't-appel', value: 'Appel' },
        { team_id: 't-zebra', value: 'Zebra' },
      ],
    }))

    const ctx = (await getTeamContext())!
    expect(ctx.teamId).toBe('t-zebra')
    expect(ctx.rol).toBe('owner')
  })

  it('valt terug op het eerste team (alfabetisch) bij een cookie van een VREEMD team — de cookie is nooit een autorisatiebron', async () => {
    useCookie('team-van-iemand-anders')
    use(makeSupabase({
      members: [assistentRij('t-appel'), ownerRij('t-zebra')],
      settings: [
        { team_id: 't-appel', value: 'Appel' },
        { team_id: 't-zebra', value: 'Zebra' },
      ],
    }))

    const ctx = (await getTeamContext())!
    expect(ctx.teamId).toBe('t-appel')
  })

  it('leest de cookie helemaal niet bij precies één lidmaatschap — hij kan daar niets kiezen', async () => {
    useCookie('wat-dan-ook')
    use(makeSupabase({ members: [ownerRij('t-enig')], settings: [] }))

    const ctx = (await getTeamContext())!
    expect(ctx.teamId).toBe('t-enig')
    expect(vi.mocked(cookies)).not.toHaveBeenCalled()
  })

  it('neemt rol en rechten uit het lidmaatschap van het ACTIEVE team, niet uit een ander', async () => {
    useCookie('t-appel')
    use(makeSupabase({
      members: [
        assistentRij('t-appel', { mag_spelers_bewerken: true }),
        ownerRij('t-zebra'),
      ],
      settings: [
        { team_id: 't-appel', value: 'Appel' },
        { team_id: 't-zebra', value: 'Zebra' },
      ],
    }))

    const ctx = (await getTeamContext())!
    expect(ctx.rol).toBe('assistent')
    expect(ctx.rechten.spelers).toBe(true)
    expect(ctx.rechten.agenda).toBe(false)
  })
})

describe('getTeamContext — rechten uit de rij', () => {
  it('geeft een hoofdtrainer alle zes rechten, ongeacht wat er in de kolommen staat', async () => {
    use(makeSupabase({
      // Alle zes vlaggen expliciet op false: de rol wint.
      members: [{ ...assistentRij('t-a'), rol: 'owner' }],
    }))

    const ctx = (await getTeamContext())!
    for (const onderdeel of ONDERDELEN) {
      expect(ctx.rechten[onderdeel], onderdeel).toBe(true)
    }
  })

  it('leest bij een assistent elk recht uit zijn eigen kolom', async () => {
    use(makeSupabase({
      members: [assistentRij('t-a', { mag_training_bewerken: true, mag_wedstrijd_bewerken: true })],
    }))

    const ctx = (await getTeamContext())!
    expect(ctx.rechten).toEqual({
      spelers: false,
      agenda: false,
      aanwezigheid: false,
      wedstrijd: true,
      training: true,
      periodisering: false,
    })
  })

  it('behandelt alles wat geen expliciete true is als "geen recht"', async () => {
    use(makeSupabase({
      members: [{ team_id: 't-a', rol: 'assistent', mag_spelers_bewerken: 'ja', mag_agenda_bewerken: 1 }],
    }))

    const ctx = (await getTeamContext())!
    expect(ctx.rechten.spelers).toBe(false)
    expect(ctx.rechten.agenda).toBe(false)
  })

  it('behandelt een onbekende rolwaarde als assistent, niet als owner', async () => {
    use(makeSupabase({ members: [{ team_id: 't-a', rol: 'beheerder' }] }))

    const ctx = (await getTeamContext())!
    expect(ctx.rol).toBe('assistent')
    expect(ctx.rechten.spelers).toBe(false)
  })
})

describe('requireTeamContext', () => {
  it('gooit "Niet ingelogd" zonder sessie — dezelfde melding als vóór deze feature', async () => {
    use(makeSupabase({ user: null }))
    await expect(requireTeamContext()).rejects.toThrow('Niet ingelogd')
  })

  it('gooit "Geen team" met sessie maar zonder lidmaatschap', async () => {
    use(makeSupabase({ members: [] }))
    await expect(requireTeamContext()).rejects.toThrow('Geen team')
  })
})

describe('requireTeamContextOrLogin', () => {
  it('stuurt zonder sessie naar /login, precies zoals de pagina dat eerder zelf deed', async () => {
    use(makeSupabase({ user: null }))
    await expect(requireTeamContextOrLogin()).rejects.toThrow('__redirect__:/login')
  })

  it('gooit met sessie maar zonder team "Geen team" — géén redirect, want dat zou een lus met proxy.ts geven', async () => {
    use(makeSupabase({ members: [] }))
    await expect(requireTeamContextOrLogin()).rejects.toThrow('Geen team')
  })
})

// ── Synchrone helpers: puur, geen database ──
function ctxMet(rol: 'owner' | 'assistent', rechten: Partial<Record<string, boolean>> = {}): TeamContext {
  const volledig = {
    spelers: false, agenda: false, aanwezigheid: false,
    wedstrijd: false, training: false, periodisering: false,
    ...rechten,
  } as TeamContext['rechten']
  return {
    userId: 'user-1',
    teamId: 't-a',
    rol,
    rechten: volledig,
    teams: [
      { teamId: 't-a', naam: 'A', rol, rechten: volledig },
      { teamId: 't-b', naam: 'B', rol: 'assistent', rechten: volledig },
    ],
  }
}

describe('canEdit / assertCanEdit', () => {
  it('geeft true voor een hoofdtrainer op elk onderdeel, ook met alle vlaggen op false', () => {
    const ctx = ctxMet('owner')
    for (const onderdeel of ONDERDELEN) {
      expect(canEdit(ctx, onderdeel), onderdeel).toBe(true)
      expect(() => assertCanEdit(ctx, onderdeel)).not.toThrow()
    }
  })

  it('volgt bij een assistent exact de vlag van dat onderdeel', () => {
    const ctx = ctxMet('assistent', { training: true })
    expect(canEdit(ctx, 'training')).toBe(true)
    expect(canEdit(ctx, 'spelers')).toBe(false)
  })

  it('gooit "Geen toegang" bij een ontbrekend recht', () => {
    const ctx = ctxMet('assistent', { training: true })
    expect(() => assertCanEdit(ctx, 'spelers')).toThrow('Geen toegang')
  })
})

describe('assertIsOwner', () => {
  it('laat de hoofdtrainer van het actieve team door', () => {
    expect(() => assertIsOwner(ctxMet('owner'))).not.toThrow()
  })

  it('weigert een assistent van het actieve team, ook met alle zes rechten', () => {
    const ctx = ctxMet('assistent', {
      spelers: true, agenda: true, aanwezigheid: true,
      wedstrijd: true, training: true, periodisering: true,
    })
    expect(() => assertIsOwner(ctx)).toThrow('Geen toegang')
  })

  it('weigert een team waarvan de gebruiker geen hoofdtrainer is', () => {
    expect(() => assertIsOwner(ctxMet('owner'), 't-b')).toThrow('Geen toegang')
  })

  it('weigert een team waar helemaal geen lidmaatschap voor bestaat', () => {
    expect(() => assertIsOwner(ctxMet('owner'), 't-onbekend')).toThrow('Geen toegang')
  })
})


// ═══════════════════════════════════════════════════════════════════════
// Zelfherstel: een account dat bij registratie nog geen sessie had
// (e-mailbevestiging staat aan in Supabase) krijgt zijn team alsnog bij de
// eerste request mét sessie. De VLAG in de user-metadata is daarbij het hele
// verschil: zonder die vlag gebeurt er niets, want vanaf fase 2 registreert
// iemand ook via een uitnodiging en die hoort géén eigen team te krijgen.
// ═══════════════════════════════════════════════════════════════════════

function metVlag(naam: string) {
  return { id: 'user-1', user_metadata: { [TEAM_NAAM_METADATA_KEY]: naam } }
}

describe('zelfherstel bij nul lidmaatschappen', () => {
  it('maakt het eigen team aan wanneer de teamnaam als metadata klaarstaat', async () => {
    const m = makeSupabase({ user: metVlag('JO13-1'), members: [] })
    use(m)

    const ctx = (await getTeamContext())!
    expect(ctx.teamId).toBe('user-1')
    expect(ctx.rol).toBe('owner')
    expect(ctx.teams).toHaveLength(1)
    expect(ctx.teams[0].naam).toBe('JO13-1')
  })

  it('schrijft teams, de owner-rij en de teamnaam — in die volgorde', async () => {
    const m = makeSupabase({ user: metVlag('JO13-1'), members: [] })
    use(m)

    await getTeamContext()

    expect(m.calls.inserts.map((i) => i.table)).toEqual(['teams', 'team_members', 'settings'])
    expect(m.calls.inserts[0].payload).toEqual({ id: 'user-1' })
    expect(m.calls.inserts[1].payload).toMatchObject({
      team_id: 'user-1', user_id: 'user-1', rol: 'owner', mag_spelers_bewerken: true,
    })
    expect(m.calls.inserts[2].payload).toEqual({ team_id: 'user-1', key: 'team_name', value: 'JO13-1' })
  })

  it('wist de metadata-vlag daarna, zodat hij later geen team kan terugtoveren', async () => {
    const m = makeSupabase({ user: metVlag('JO13-1'), members: [] })
    use(m)

    await getTeamContext()

    expect(m.calls.updateUser).toEqual([{ data: { [TEAM_NAAM_METADATA_KEY]: null } }])
  })

  // DIT IS DE KERN VAN DE FASE-2-COMPATIBILITEIT: wie via een uitnodiging
  // registreert (signUpViaInvite) krijgt deze metadata niet, en mag dus ook
  // na e-mailbevestiging + login géén eigen team krijgen (BR 51).
  it('maakt GEEN team aan zonder de metadata-vlag — en raakt de database niet aan', async () => {
    const m = makeSupabase({ user: { id: 'user-1' }, members: [] })
    use(m)

    expect(await getTeamContext()).toBeNull()
    expect(m.calls.inserts).toHaveLength(0)
    expect(m.calls.updateUser).toHaveLength(0)
  })

  it('maakt GEEN team aan bij een lege of niet-tekstuele vlag', async () => {
    for (const waarde of ['', '   ', 42, null, { naam: 'X' }]) {
      const m = makeSupabase({
        user: { id: 'user-1', user_metadata: { [TEAM_NAAM_METADATA_KEY]: waarde } },
        members: [],
      })
      use(m)

      expect(await getTeamContext(), String(waarde)).toBeNull()
      expect(m.calls.inserts, String(waarde)).toHaveLength(0)
    }
  })

  it('raakt het zelfherstel niet aan zodra er al één lidmaatschap is — ook niet met een achtergebleven vlag', async () => {
    const m = makeSupabase({
      user: metVlag('Ander Team'),
      members: [ownerRij('t-bestaand')],
      settings: [{ team_id: 't-bestaand', value: 'Bestaand' }],
    })
    use(m)

    const ctx = (await getTeamContext())!
    expect(ctx.teamId).toBe('t-bestaand')
    expect(m.calls.inserts).toHaveLength(0)
  })

  it('knipt een te lange naam uit de metadata af op 80 tekens — die waarde is door de gebruiker zelf te zetten', async () => {
    const m = makeSupabase({ user: metVlag('x'.repeat(200)), members: [] })
    use(m)

    const ctx = (await getTeamContext())!
    expect(ctx.teams[0].naam).toHaveLength(80)
  })

  it('geeft geen context en logt alleen een contextlabel als de teams-rij niet geschreven kan worden', async () => {
    const m = makeSupabase({
      user: metVlag('JO13-1'),
      members: [],
      insertError: { table: 'teams', error: { code: '42501', message: 'permission denied for table teams' } },
    })
    use(m)

    expect(await getTeamContext()).toBeNull()
    const gelogd = consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
    expect(gelogd).toContain('teamContext.maakEigenTeam.team')
    expect(gelogd).not.toContain('permission denied')
  })

  it('behandelt een al bestaande rij (23505) als "stond er al" — twee gelijktijdige requests botsen niet', async () => {
    const m = makeSupabase({
      user: metVlag('JO13-1'),
      members: [],
      insertError: { table: 'teams', error: { code: '23505', message: 'duplicate key value' } },
    })
    use(m)

    const ctx = (await getTeamContext())!
    expect(ctx.teamId).toBe('user-1')
    expect(consoleError).not.toHaveBeenCalled()
  })
})
