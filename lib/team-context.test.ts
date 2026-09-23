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

// Het team-id dat create_team teruggeeft. Bewust NIET de user-id: de
// fase-1-invariant teams.id = user.id gold alleen om fase 1 zonder
// gedragsverandering uit te kunnen rollen; nieuwe teams krijgen sinds fase 2
// een eigen uuid.
const NIEUW_TEAM_ID = '66666666-6666-4666-8666-666666666666'

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
  // Fout op precies één insert-doel, om faalpaden te kunnen aansturen.
  insertError?: { table: string; error: { code?: string; message: string } }
  // Uitkomst van de RPC create_team. Sinds fase 2 maakt maakEigenTeam het team
  // daarmee (supabase/team-aanmaken-rpc.sql) in plaats van met drie losse
  // inserts — die weg verdwijnt zodra M5b de bootstrap-policies dropt.
  createTeam?: { data: unknown; error?: { code?: string; message: string } | null }
  updateUserError?: { code?: string; message: string }
  // Wat de TWEEDE lees van team_members teruggeeft (de herlees ná het
  // zelfherstel). Zo is te simuleren dat er tussen de eerste lees en de
  // RPC-aanroep in een ander tabblad een uitnodiging is geaccepteerd.
  membersNaHerstel?: MemberRij[]
  membersNaHerstelError?: unknown
} = {}) {
  const user = opts.user === undefined ? { id: 'user-1' } : opts.user
  const calls = {
    filters: [] as { table: string; op: string; col: string; val: unknown }[],
    inserts: [] as { table: string; payload: Record<string, unknown> }[],
    updateUser: [] as Record<string, unknown>[],
    rpc: [] as { fn: string; args: Record<string, unknown> | undefined }[],
  }

  let memberLeesTeller = 0

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
    let result: { data: unknown; error: unknown }
    if (table === 'team_members') {
      const tweedeLees = memberLeesTeller > 0
      memberLeesTeller += 1
      result = tweedeLees && (opts.membersNaHerstel || opts.membersNaHerstelError)
        ? { data: opts.membersNaHerstel ?? [], error: opts.membersNaHerstelError ?? null }
        : { data: opts.members ?? [], error: opts.memberError ?? null }
    } else {
      result = { data: opts.settings ?? [], error: opts.settingsError ?? null }
    }
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
    return c
  }

  return {
    calls,
    supabase: {
      from: (t: string) => chain(t),
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        calls.rpc.push({ fn, args })
        const uitkomst = opts.createTeam ?? { data: NIEUW_TEAM_ID }
        return { data: uitkomst.data, error: uitkomst.error ?? null }
      },
      auth: {
        getUser: async () => ({ data: { user } }),
        updateUser: async (attrs: Record<string, unknown>) => {
          calls.updateUser.push(attrs)
          return { data: { user }, error: opts.updateUserError ?? null }
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
    expect(ctx.teamId).toBe(NIEUW_TEAM_ID)
    expect(ctx.rol).toBe('owner')
    expect(ctx.teams).toHaveLength(1)
    expect(ctx.teams[0].naam).toBe('JO13-1')
  })

  // SINDS FASE 2 via de RPC create_team en niet meer met drie losse inserts.
  // Dwingend, niet cosmetisch: M5b dropt de bootstrap-INSERT-policies op teams
  // en team_members ná de deploy van fase 2, dus vanaf dat moment kan een
  // gewone client die rijen helemaal niet meer schrijven.
  it('maakt het team via de RPC create_team, met idempotentie-vlag, en raakt geen tabel rechtstreeks aan', async () => {
    const m = makeSupabase({ user: metVlag('JO13-1'), members: [] })
    use(m)

    await getTeamContext()

    expect(m.calls.rpc).toEqual([
      { fn: 'create_team', args: { p_naam: 'JO13-1', p_alleen_zonder_team: true } },
    ])
    expect(m.calls.inserts).toHaveLength(0)
  })

  it('geeft het nieuwe team een eigen uuid — de fase-1-invariant teams.id = user.id geldt niet meer', async () => {
    const m = makeSupabase({ user: metVlag('JO13-1'), members: [] })
    use(m)

    const ctx = (await getTeamContext())!
    expect(ctx.teamId).not.toBe(ctx.userId)
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
    expect(m.calls.rpc).toHaveLength(0)
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
      expect(m.calls.rpc, String(waarde)).toHaveLength(0)
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
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('knipt een te lange naam uit de metadata af op 80 tekens — die waarde is door de gebruiker zelf te zetten', async () => {
    const m = makeSupabase({ user: metVlag('x'.repeat(200)), members: [] })
    use(m)

    const ctx = (await getTeamContext())!
    expect(ctx.teams[0].naam).toHaveLength(80)
    expect((m.calls.rpc[0].args as { p_naam: string }).p_naam).toHaveLength(80)
  })

  it('geeft geen context en logt alleen een contextlabel als create_team faalt', async () => {
    const m = makeSupabase({
      user: metVlag('JO13-1'),
      members: [],
      createTeam: { data: null, error: { code: '42501', message: 'permission denied for table teams' } },
    })
    use(m)

    expect(await getTeamContext()).toBeNull()
    const gelogd = consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
    expect(gelogd).toContain('teamContext.maakEigenTeam')
    expect(gelogd).not.toContain('permission denied')
  })

  it('geeft geen context als create_team geen team-id teruggeeft', async () => {
    const m = makeSupabase({ user: metVlag('JO13-1'), members: [], createTeam: { data: null } })
    use(m)

    expect(await getTeamContext()).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// De vlag opruimen zodra er WEL een lidmaatschap is.
//
// Dit is de gekozen oplossing voor het fase-2/3-aandachtspunt uit
// validatieronde 2 (punt 5): het wissen in maakEigenTeam kan mislukken, en een
// achtergebleven vlag zou vanaf fase 2 een leeg team kunnen terugtoveren zodra
// iemand via removeMember zijn laatste lidmaatschap verliest. Door hem te
// wissen zolang er een lidmaatschap ís, convergeert de vlag naar weg: elke
// request probeert het opnieuw.
// ═══════════════════════════════════════════════════════════════════════

describe('achtergebleven metadata-vlag opruimen', () => {
  it('wist een vlag die nog naast een bestaand lidmaatschap staat', async () => {
    const m = makeSupabase({
      user: metVlag('Ooit Bedoeld'),
      members: [ownerRij('t-1')],
      settings: [{ team_id: 't-1', value: 'Bestaand' }],
    })
    use(m)

    await getTeamContext()

    expect(m.calls.updateUser).toEqual([{ data: { [TEAM_NAAM_METADATA_KEY]: null } }])
    // Wissen is géén team aanmaken.
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('raakt de metadata niet aan als er geen vlag staat — dat is het normale geval', async () => {
    const m = makeSupabase({
      user: { id: 'user-1' },
      members: [ownerRij('t-1')],
      settings: [{ team_id: 't-1', value: 'Bestaand' }],
    })
    use(m)

    await getTeamContext()

    expect(m.calls.updateUser).toHaveLength(0)
  })

  it('levert gewoon een context op als het wissen mislukt, en logt alleen een contextlabel', async () => {
    const m = makeSupabase({
      user: metVlag('Ooit Bedoeld'),
      members: [ownerRij('t-1')],
      settings: [{ team_id: 't-1', value: 'Bestaand' }],
      updateUserError: { code: 'over_request_rate_limit', message: 'too many requests' },
    })
    use(m)

    const ctx = (await getTeamContext())!
    expect(ctx.teamId).toBe('t-1')
    const gelogd = consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
    expect(gelogd).toContain('teamContext.vlagWissen')
    expect(gelogd).not.toContain('too many requests')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Herlezen ná het zelfherstel (validatiepunt 2).
//
// De verleiding is om na create_team `[{ team_id, rol: 'owner' }]` te
// construeren — dat scheelt een query. Maar dan VERZINT deze functie een rol
// in plaats van hem te lezen. Tussen de eerste lees en de RPC-aanroep kan in
// een ander tabblad een uitnodiging geaccepteerd zijn; dat assistent-
// lidmaatschap zou dan als 'owner' met ALLE_RECHTEN in de context belanden.
// RLS en de RPC's houden elke echte schrijfactie nog tegen, maar canEdit en
// assertIsOwner zouden één request lang openstaan — en dat maakt van de twee
// beschermingslagen er tijdelijk één.
// ═══════════════════════════════════════════════════════════════════════

describe('zelfherstel — herlezen in plaats van de rij verzinnen', () => {
  it('leest de lidmaatschappen opnieuw na create_team', async () => {
    const m = makeSupabase({
      user: metVlag('JO13-1'),
      members: [],
      membersNaHerstel: [ownerRij(NIEUW_TEAM_ID)],
      settings: [{ team_id: NIEUW_TEAM_ID, value: 'JO13-1' }],
    })
    use(m)

    const ctx = (await getTeamContext())!

    expect(ctx.teamId).toBe(NIEUW_TEAM_ID)
    // Twee leesrondes op team_members: vóór en ná het zelfherstel.
    expect(m.calls.filters.filter((f) => f.table === 'team_members')).toHaveLength(2)
  })

  it('pikt een lidmaatschap op dat tijdens het zelfherstel in een ander tabblad ontstond, ZONDER het als owner te bestempelen', async () => {
    const m = makeSupabase({
      user: metVlag('Eigen team'),
      members: [],
      membersNaHerstel: [
        ownerRij(NIEUW_TEAM_ID),
        assistentRij('t-uitnodiging', { mag_training_bewerken: true }),
      ],
      settings: [
        { team_id: NIEUW_TEAM_ID, value: 'Zebra' },
        { team_id: 't-uitnodiging', value: 'Appel' },
      ],
    })
    use(m)

    const ctx = (await getTeamContext())!

    expect(ctx.teams).toHaveLength(2)
    const uitnodiging = ctx.teams.find((t) => t.teamId === 't-uitnodiging')!
    expect(uitnodiging.rol).toBe('assistent')
    expect(uitnodiging.rechten.training).toBe(true)
    expect(uitnodiging.rechten.spelers).toBe(false)
    // Het eigen team blijft owner met alle rechten.
    expect(ctx.teams.find((t) => t.teamId === NIEUW_TEAM_ID)!.rol).toBe('owner')
  })

  it('valt bij een mislukte herlees terug op het team dat create_team aantoonbaar heeft aangemaakt', async () => {
    const m = makeSupabase({
      user: metVlag('JO13-1'),
      members: [],
      membersNaHerstelError: { code: '42501', message: 'permission denied for table team_members' },
    })
    use(m)

    const ctx = (await getTeamContext())!

    expect(ctx.teamId).toBe(NIEUW_TEAM_ID)
    expect(ctx.rol).toBe('owner')
    expect(ctx.teams[0].naam).toBe('JO13-1')
    const gelogd = consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
    expect(gelogd).toContain('teamContext.ledenNaHerstel')
    expect(gelogd).not.toContain('permission denied')
  })

  it('valt ook terug wanneer de herlees leeg is — replicatievertraging mag het net gemaakte team niet laten verdwijnen', async () => {
    const m = makeSupabase({
      user: metVlag('JO13-1'),
      members: [],
      membersNaHerstel: [],
      membersNaHerstelError: null,
    })
    use(m)

    // Met een lege herlees zonder fout valt hij terug op de RPC-uitkomst.
    const ctx = await getTeamContext()
    expect(ctx?.teamId).toBe(NIEUW_TEAM_ID)
  })
})
