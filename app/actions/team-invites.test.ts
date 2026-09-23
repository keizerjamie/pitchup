// Tests voor app/actions/team-invites.ts — uitnodigingen genereren, tonen,
// intrekken, bekijken en verzilveren.
//
// De vier dingen die hier écht bewezen moeten worden:
//   1. de link wordt gebouwd uit getSiteUrl() en NOOIT uit een request-header
//      (dat was de kritieke kwetsbaarheid uit de security-audit),
//   2. het ruwe token komt precies ÉÉN keer in een antwoord voor, en
//      getActiveInvite geeft hem nooit,
//   3. verlopen, gebruikt, ingetrokken en onbekend geven alle vier exact
//      dezelfde uitkomst,
//   4. already_member raakt niets aan.
//
// Wat deze tests NIET bewijzen: de policies en de vervaltoets. Die leven in
// supabase/team-invites-rpc.sql en worden geverifieerd met blok 14 t/m 19 van
// supabase/team-rls-verificatie.sql. Vitest praat nooit met een database.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/team-context', async (importOriginal) => {
  const origineel = await importOriginal<typeof import('@/lib/team-context')>()
  return { ...origineel, requireTeamContext: vi.fn() }
})

import { cookies, headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { hashInviteToken } from '@/lib/invite-token'
import { INVITE_ACCEPT_IP_POLICY, INVITE_PEEK_IP_POLICY } from '@/lib/rate-limit'
import { ACTIVE_TEAM_COOKIE, requireTeamContext, type TeamContext } from '@/lib/team-context'
import { NA_ACCEPTATIE_PAD } from '@/lib/team-invites'
import { ALLE_RECHTEN, GEEN_RECHTEN } from '@/lib/team-rechten'
import {
  acceptInvite,
  createInvite,
  getActiveInvite,
  peekInvite,
  revokeInvite,
} from '@/app/actions/team-invites'

const TEAM = '11111111-1111-4111-8111-111111111111'
const ANDER_TEAM = '22222222-2222-4222-8222-222222222222'
const SITE_URL = 'https://pitchup.example'
const VERLOOPT = '2026-10-01T12:00:00.000Z'
// Vorm van een echt token: 43 tekens uit [A-Za-z0-9_-] (32 bytes base64url).
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'

type RpcUitkomst = { data: unknown; error?: { code?: string; message: string } | null }

function makeSupabase(opts: {
  user?: { id: string } | null
  rpc?: Record<string, RpcUitkomst>
} = {}) {
  const user = opts.user === undefined ? { id: 'user-1' } : opts.user
  const calls = { rpc: [] as { fn: string; args: Record<string, unknown> | undefined }[] }

  const defaults: Record<string, RpcUitkomst> = {
    create_team_invite: { data: { invite_id: 'invite-1', verloopt_op: VERLOOPT } },
    active_team_invite: { data: { verloopt_op: VERLOOPT } },
    revoke_team_invite: { data: true },
    peek_team_invite: { data: { status: 'ok', team_naam: 'JO13-1' } },
    accept_team_invite: { data: { status: 'ok', team_id: TEAM } },
  }

  return {
    calls,
    supabase: {
      auth: { getUser: async () => ({ data: { user } }) },
      rpc: (fn: string, args?: Record<string, unknown>) => {
        calls.rpc.push({ fn, args })
        const uitkomst = opts.rpc?.[fn] ?? defaults[fn] ?? { data: null }
        const resultaat = { data: uitkomst.data, error: uitkomst.error ?? null }
        const promise = Promise.resolve(resultaat) as Promise<typeof resultaat> & {
          single: () => Promise<typeof resultaat>
          maybeSingle: () => Promise<typeof resultaat>
        }
        promise.single = () => Promise.resolve(resultaat)
        promise.maybeSingle = () => Promise.resolve(resultaat)
        return promise
      },
    },
  }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(
    mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>,
  )
}

// Namaak van de service-role-RPC's uit supabase/rate-limit.sql, zodat de
// IP-tellers hier getest kunnen worden zonder echte Postgres. Zelfde aanpak
// als in app/actions/auth.test.ts.
function makeRateLimitAdmin() {
  type Entry = { count: number; windowStart: number; blockedUntil: number | null }
  const entries = new Map<string, Entry>()

  function record(key: string, windowMs: number, limit: number, blockMs: number) {
    const now = Date.now()
    const bestaand = entries.get(key) ?? null
    const verlopen = !bestaand
      || now - bestaand.windowStart >= windowMs
      || (bestaand.blockedUntil !== null && bestaand.blockedUntil <= now)

    const entry: Entry = verlopen
      ? { count: 1, windowStart: now, blockedUntil: null }
      : { count: bestaand!.count + 1, windowStart: bestaand!.windowStart, blockedUntil: bestaand!.blockedUntil }

    if (entry.count >= limit) entry.blockedUntil = now + blockMs
    entries.set(key, entry)
    return entry.blockedUntil !== null && entry.blockedUntil > now
      ? { blocked: true, retry_after_ms: entry.blockedUntil - now }
      : { blocked: false, retry_after_ms: 0 }
  }

  function check(key: string) {
    const now = Date.now()
    const entry = entries.get(key)
    if (!entry || entry.blockedUntil === null || entry.blockedUntil <= now) {
      return { blocked: false, retry_after_ms: 0 }
    }
    return { blocked: true, retry_after_ms: entry.blockedUntil - now }
  }

  return {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      let result: { blocked: boolean; retry_after_ms: number } | null = null
      if (fn === 'rate_limit_record_attempt') {
        result = record(
          args!.p_key as string,
          args!.p_window_ms as number,
          args!.p_limit as number,
          args!.p_block_ms as number,
        )
      } else if (fn === 'rate_limit_check') {
        result = check(args!.p_key as string)
      }
      const promise = Promise.resolve({ data: result, error: null })
      ;(promise as unknown as { single: () => Promise<unknown> }).single = () => promise
      return promise
    },
  }
}

function ownerCtx(): TeamContext {
  return {
    userId: 'user-1',
    teamId: TEAM,
    rol: 'owner',
    rechten: { ...ALLE_RECHTEN },
    teams: [{ teamId: TEAM, naam: 'JO13-1', rol: 'owner', rechten: { ...ALLE_RECHTEN } }],
  }
}

function assistentCtx(): TeamContext {
  return {
    userId: 'user-1',
    teamId: TEAM,
    rol: 'assistent',
    rechten: { ...ALLE_RECHTEN },
    teams: [{ teamId: TEAM, naam: 'JO13-1', rol: 'assistent', rechten: { ...ALLE_RECHTEN } }],
  }
}

let gezetteCookies: { naam: string; value: string; options: Record<string, unknown> }[]
let consoleError: ReturnType<typeof vi.spyOn>

function useHeaders(init: Record<string, string> = { 'x-forwarded-for': '1.2.3.4' }) {
  vi.mocked(headers).mockResolvedValue(new Headers(init) as unknown as Awaited<ReturnType<typeof headers>>)
}

beforeEach(() => {
  vi.clearAllMocks()
  gezetteCookies = []
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  useHeaders()
  vi.mocked(cookies).mockResolvedValue({
    set: (naam: string, value: string, options: Record<string, unknown>) => {
      gezetteCookies.push({ naam, value, options })
    },
    get: () => undefined,
  } as unknown as Awaited<ReturnType<typeof cookies>>)
  vi.mocked(createAdminClient).mockReturnValue(
    makeRateLimitAdmin() as unknown as ReturnType<typeof createAdminClient>,
  )
  vi.mocked(requireTeamContext).mockResolvedValue(ownerCtx())
  use(makeSupabase())
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE_URL)
})

afterEach(() => {
  consoleError.mockRestore()
  vi.unstubAllEnvs()
})

function loggedText(): string {
  return consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
}

function tokenUitUrl(url: string): string {
  return url.slice(`${SITE_URL}/invite/`.length)
}

// ────────────────────────────────────────────────
// createInvite
// ────────────────────────────────────────────────

describe('createInvite', () => {
  it('bouwt de URL uit getSiteUrl()', async () => {
    const { url } = await createInvite()
    expect(url.startsWith(`${SITE_URL}/invite/`)).toBe(true)
  })

  // DIT IS DE KERN VAN DE SECURITY-AUDIT-LES: een origin/Host-header is door
  // de client te sturen. Werd die hier gebruikt, dan kon een aanvaller het
  // uitnodigingstoken naar zijn eigen domein laten wijzen.
  it('negeert elke request-header, ook een die zich als origin voordoet', async () => {
    useHeaders({
      'x-forwarded-for': '1.2.3.4',
      origin: 'https://kwaadaardig.example',
      host: 'kwaadaardig.example',
      'x-forwarded-host': 'kwaadaardig.example',
    })

    const { url } = await createInvite()

    expect(url.startsWith(SITE_URL)).toBe(true)
    expect(url).not.toContain('kwaadaardig.example')
  })

  it('faalt zonder bruikbare site-URL en maakt dan GEEN invite aan — anders staat er een link in de database die niemand kan gebruiken', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    vi.stubEnv('NODE_ENV', 'production')
    const m = makeSupabase()
    use(m)

    await expect(createInvite()).rejects.toThrow('Uitnodigen is nu niet mogelijk')
    expect(m.calls.rpc).toHaveLength(0)
    expect(loggedText()).toContain('teamInvites.createInvite')
  })

  it('stuurt de HASH naar de database en nooit het ruwe token', async () => {
    const m = makeSupabase()
    use(m)

    const { url } = await createInvite()
    const token = tokenUitUrl(url)
    const args = m.calls.rpc[0].args as { p_team_id: string; p_token_hash: string }

    expect(args.p_token_hash).toBe(hashInviteToken(token))
    expect(args.p_token_hash).not.toBe(token)
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('geeft de RPC het ACTIEVE team mee', async () => {
    const m = makeSupabase()
    use(m)

    await createInvite()

    expect(m.calls.rpc[0].fn).toBe('create_team_invite')
    expect((m.calls.rpc[0].args as { p_team_id: string }).p_team_id).toBe(TEAM)
  })

  // Het ruwe token verlaat de server precies één keer, in dit antwoord. Staat
  // hij er twee keer in (bijvoorbeeld ook los naast de URL), dan is de kans
  // dat hij ergens gelogd wordt ook twee keer zo groot.
  it('bevat het token exact één keer in het antwoord', async () => {
    const resultaat = await createInvite()
    const token = tokenUitUrl(resultaat.url)
    const json = JSON.stringify(resultaat)

    expect(json.split(token)).toHaveLength(2)
    expect(Object.keys(resultaat).sort()).toEqual(['url', 'verlooptOp'])
  })

  it('geeft de vervaldatum door zoals de database hem teruggeeft — hier wordt niets gerekend', async () => {
    const { verlooptOp } = await createInvite()
    expect(verlooptOp).toBe(VERLOOPT)
  })

  it('geeft bij elke aanroep een ander token', async () => {
    const eerste = tokenUitUrl((await createInvite()).url)
    const tweede = tokenUitUrl((await createInvite()).url)
    expect(eerste).not.toBe(tweede)
  })

  it('weigert een assistent, ook met alle zes bewerkrechten (AC 46)', async () => {
    vi.mocked(requireTeamContext).mockResolvedValue(assistentCtx())
    const m = makeSupabase()
    use(m)

    await expect(createInvite()).rejects.toThrow('Geen toegang')
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('lekt de ruwe databasefout niet', async () => {
    use(makeSupabase({
      rpc: { create_team_invite: { data: null, error: { code: '42501', message: 'permission denied' } } },
    }))

    await expect(createInvite()).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(loggedText()).toContain('teamInvites.createInvite')
    expect(loggedText()).not.toContain('permission denied')
  })
})

// ────────────────────────────────────────────────
// getActiveInvite
// ────────────────────────────────────────────────

describe('getActiveInvite', () => {
  it('geeft NOOIT een token of een hash terug — die is gehasht opgeslagen en niet te reproduceren', async () => {
    const resultaat = await getActiveInvite()

    expect(resultaat).toEqual({ verlooptOp: VERLOOPT })
    expect(Object.keys(resultaat!)).toEqual(['verlooptOp'])
    expect(JSON.stringify(resultaat)).not.toContain('token')
  })

  // De vervaltoets hoort met now() in de DATABASE te gebeuren. Een filter hier
  // met een JS-Date zou de klok van de app-server laten beslissen terwijl
  // accept_team_invite de klok van de database gebruikt.
  it('laat de database beslissen of er nog een link openstaat', async () => {
    const m = makeSupabase()
    use(m)

    await getActiveInvite()

    expect(m.calls.rpc).toEqual([
      { fn: 'active_team_invite', args: { p_team_id: TEAM } },
    ])
  })

  it('geeft null als er niets openstaat', async () => {
    use(makeSupabase({ rpc: { active_team_invite: { data: null } } }))
    expect(await getActiveInvite()).toBeNull()
  })

  it('weigert een assistent', async () => {
    vi.mocked(requireTeamContext).mockResolvedValue(assistentCtx())
    await expect(getActiveInvite()).rejects.toThrow('Geen toegang')
  })
})

// ────────────────────────────────────────────────
// revokeInvite
// ────────────────────────────────────────────────

describe('revokeInvite', () => {
  it('trekt de link van het actieve team in', async () => {
    const m = makeSupabase()
    use(m)

    expect(await revokeInvite()).toEqual({ ok: true })
    expect(m.calls.rpc).toEqual([{ fn: 'revoke_team_invite', args: { p_team_id: TEAM } }])
  })

  it('is idempotent: niets openstaan is geen fout', async () => {
    use(makeSupabase({ rpc: { revoke_team_invite: { data: false } } }))
    expect(await revokeInvite()).toEqual({ ok: true })
  })

  it('weigert een assistent', async () => {
    vi.mocked(requireTeamContext).mockResolvedValue(assistentCtx())
    const m = makeSupabase()
    use(m)

    await expect(revokeInvite()).rejects.toThrow('Geen toegang')
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('lekt de ruwe databasefout niet', async () => {
    use(makeSupabase({
      rpc: { revoke_team_invite: { data: null, error: { code: '42501', message: 'permission denied' } } },
    }))

    await expect(revokeInvite()).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(loggedText()).not.toContain('permission denied')
  })
})

// ────────────────────────────────────────────────
// peekInvite
// ────────────────────────────────────────────────

describe('peekInvite', () => {
  it('geeft de teamnaam bij een geldige link', async () => {
    expect(await peekInvite(TOKEN)).toEqual({ status: 'ok', teamNaam: 'JO13-1' })
  })

  it('stuurt de hash naar de database, nooit het ruwe token', async () => {
    const m = makeSupabase()
    use(m)

    await peekInvite(TOKEN)

    expect(m.calls.rpc[0].fn).toBe('peek_team_invite')
    expect(m.calls.rpc[0].args).toEqual({ p_token_hash: hashInviteToken(TOKEN) })
  })

  it('wijzigt niets — een hoofdtrainer die zijn eigen link controleert verbrandt hem niet', async () => {
    const m = makeSupabase()
    use(m)

    await peekInvite(TOKEN)

    expect(m.calls.rpc.map((c) => c.fn)).toEqual(['peek_team_invite'])
  })

  // AC 23/24/25: verlopen, gebruikt, ingetrokken en onbekend zijn niet te
  // onderscheiden. De RPC geeft daar al één status voor terug; hier wordt
  // bewaakt dat de actielaag er ook nooit een teamnaam bij lekt.
  it('geeft exact dezelfde uitkomst voor elk ongeldig geval', async () => {
    const uitkomsten = []
    for (const data of [
      { status: 'invalid', team_naam: null },
      null,
      { status: 'onbekend' },
    ]) {
      use(makeSupabase({ rpc: { peek_team_invite: { data } } }))
      uitkomsten.push(await peekInvite(TOKEN))
    }
    uitkomsten.push(await peekInvite('geen-geldig-token!'))

    for (const uitkomst of uitkomsten) {
      expect(uitkomst).toEqual({ status: 'invalid', teamNaam: null })
    }
  })

  it('doet geen database-aanroep bij een token met een onmogelijke vorm', async () => {
    const m = makeSupabase()
    use(m)

    expect(await peekInvite('../../etc/passwd')).toEqual({ status: 'invalid', teamNaam: null })
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('geeft ook bij een databasefout een neutrale invalid, zodat de pagina renderbaar blijft', async () => {
    use(makeSupabase({
      rpc: { peek_team_invite: { data: null, error: { code: '42501', message: 'permission denied' } } },
    }))

    expect(await peekInvite(TOKEN)).toEqual({ status: 'invalid', teamNaam: null })
    expect(loggedText()).toContain('teamInvites.peekInvite')
    expect(loggedText()).not.toContain('permission denied')
  })

  it('valt na te veel pogingen vanaf één IP terug op invalid — zonder te verraden dat er iets met dit token is', async () => {
    for (let i = 0; i < INVITE_PEEK_IP_POLICY.limit; i++) {
      expect((await peekInvite(TOKEN)).status, `poging ${i}`).toBe('ok')
    }
    expect(await peekInvite(TOKEN)).toEqual({ status: 'invalid', teamNaam: null })
  })

  it('laat een ander IP ongemoeid', async () => {
    for (let i = 0; i <= INVITE_PEEK_IP_POLICY.limit; i++) await peekInvite(TOKEN)

    useHeaders({ 'x-forwarded-for': '9.9.9.9' })
    expect((await peekInvite(TOKEN)).status).toBe('ok')
  })
})

// ────────────────────────────────────────────────
// acceptInvite
// ────────────────────────────────────────────────

describe('acceptInvite', () => {
  it('zet het nieuwe team als actief en eindigt in een redirect met de joined-vlag, zodat het dashboard "Je bent toegevoegd aan <team>" kan tonen', async () => {
    await expect(acceptInvite(TOKEN)).rejects.toThrow(`__redirect__:${NA_ACCEPTATIE_PAD}`)

    expect(gezetteCookies).toEqual([
      { naam: ACTIVE_TEAM_COOKIE, value: TEAM, options: { path: '/', maxAge: 60 * 60 * 24 * 365 } },
    ])
  })

  it('stuurt de hash naar de database, nooit het ruwe token', async () => {
    const m = makeSupabase()
    use(m)

    await expect(acceptInvite(TOKEN)).rejects.toThrow(`__redirect__:${NA_ACCEPTATIE_PAD}`)

    expect(m.calls.rpc).toEqual([
      { fn: 'accept_team_invite', args: { p_token_hash: hashInviteToken(TOKEN) } },
    ])
  })

  // De vlag is een signaal, geen gegevensdrager: een team-id of -naam in de
  // query belandt in browsergeschiedenis, server-logs en een eventuele
  // Referer. De naam staat al in de teamcontext van het net gezette actieve
  // team.
  it('zet geen teamnaam of team-id in de redirect-URL', async () => {
    const fout = await acceptInvite(TOKEN).catch((e: Error) => e.message)

    expect(fout).toBe('__redirect__:/?joined=1')
    expect(fout).not.toContain(TEAM)
  })

  // AC 26 / beslissing 9: een bestaand lid verbruikt de link niet en houdt
  // zijn rechten. Dat is gedrag van de RPC; hier wordt bewaakt dat de
  // actielaag er niets bovenop doet — geen cookie, geen redirect, geen
  // tweede aanroep.
  it('raakt bij already_member niets aan', async () => {
    const m = makeSupabase({
      rpc: { accept_team_invite: { data: { status: 'already_member', team_id: ANDER_TEAM } } },
    })
    use(m)

    expect(await acceptInvite(TOKEN)).toEqual({ status: 'already_member', teamId: ANDER_TEAM })
    expect(gezetteCookies).toHaveLength(0)
    expect(m.calls.rpc).toHaveLength(1)
  })

  it('geeft voor elk ongeldig geval dezelfde uitkomst, zonder cookie', async () => {
    const uitkomsten = []
    for (const data of [{ status: 'invalid', team_id: null }, null, { status: 'ok', team_id: null }]) {
      use(makeSupabase({ rpc: { accept_team_invite: { data } } }))
      uitkomsten.push(await acceptInvite(TOKEN))
    }
    uitkomsten.push(await acceptInvite('geen-geldig-token!'))

    for (const uitkomst of uitkomsten) {
      expect(uitkomst).toEqual({ status: 'invalid', teamId: null })
    }
    expect(gezetteCookies).toHaveLength(0)
  })

  it('weigert zonder sessie — accepteren vereist een account', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    await expect(acceptInvite(TOKEN)).rejects.toThrow('Niet ingelogd')
    expect(m.calls.rpc).toHaveLength(0)
  })

  it('blokkeert na te veel pogingen vanaf één IP, en verbruikt de link dan niet', async () => {
    // Elke poging een ongeldig token, zodat de teller volloopt zonder dat er
    // een redirect tussendoor komt.
    use(makeSupabase({ rpc: { accept_team_invite: { data: { status: 'invalid', team_id: null } } } }))
    for (let i = 0; i < INVITE_ACCEPT_IP_POLICY.limit; i++) {
      expect((await acceptInvite(TOKEN)).status, `poging ${i}`).toBe('invalid')
    }

    const m = makeSupabase()
    use(m)
    expect(await acceptInvite(TOKEN)).toEqual({ status: 'rate_limited', teamId: null })
    expect(m.calls.rpc).toHaveLength(0)
    expect(gezetteCookies).toHaveLength(0)
  })

  it('lekt de ruwe databasefout niet', async () => {
    use(makeSupabase({
      rpc: { accept_team_invite: { data: null, error: { code: '42501', message: 'permission denied' } } },
    }))

    await expect(acceptInvite(TOKEN)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(loggedText()).toContain('teamInvites.acceptInvite')
    expect(loggedText()).not.toContain('permission denied')
  })

  it('gebruikt de teamcontext niet — een genodigde heeft nog geen lidmaatschap', async () => {
    vi.mocked(requireTeamContext).mockRejectedValue(new Error('Geen team'))

    await expect(acceptInvite(TOKEN)).rejects.toThrow(`__redirect__:${NA_ACCEPTATIE_PAD}`)
    expect(requireTeamContext).not.toHaveBeenCalled()
  })
})

// Regressie op de GEEN_RECHTEN-constante: die wordt hier alleen gebruikt om te
// laten zien dat rechten geen rol spelen bij uitnodigen — dat is rol-werk.
describe('rechten spelen geen rol bij uitnodigen', () => {
  it('weigert een assistent zónder rechten net zo goed als eentje met alle rechten', async () => {
    vi.mocked(requireTeamContext).mockResolvedValue({
      userId: 'user-1',
      teamId: TEAM,
      rol: 'assistent',
      rechten: { ...GEEN_RECHTEN },
      teams: [{ teamId: TEAM, naam: 'JO13-1', rol: 'assistent', rechten: { ...GEEN_RECHTEN } }],
    })

    await expect(createInvite()).rejects.toThrow('Geen toegang')
  })
})
