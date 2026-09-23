import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`__redirect__:${to}`) },
}))
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { cookies, headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-policy'
import { TEAM_NAAM_METADATA_KEY } from '@/lib/team-context'
import { TEAM_LOGO_BUCKET, teamLogoPath } from '@/lib/logo-upload'
import {
  SIGN_IN_POLICY,
  SIGN_IN_IP_POLICY,
  SIGN_UP_POLICY,
  SIGN_UP_IP_POLICY,
  PASSWORD_RESET_POLICY,
} from '@/lib/rate-limit'
import { signIn, signUp, signUpViaInvite, requestPasswordReset, updatePassword, deleteAccount } from '@/app/actions/auth'
import { hashInviteToken } from '@/lib/invite-token'
import { NA_ACCEPTATIE_PAD } from '@/lib/team-invites'

// ────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────

type AuthError = { message: string; code?: string } | null

// Het team-id dat create_team teruggeeft. Bewust géén user-id: sinds fase 2
// krijgt elk NIEUW team een eigen uuid (supabase/team-aanmaken-rpc.sql).
const NIEUW_TEAM_ID = '44444444-4444-4444-8444-444444444444'
// Het team waar een uitnodiging bij hoort.
const INVITE_TEAM_ID = '55555555-5555-4555-8555-555555555555'
// Vorm van een echt token: 43 tekens uit [A-Za-z0-9_-] (32 bytes base64url).
const GELDIG_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'

function makeSupabase(opts: {
  user?: { id: string } | null
  signInError?: AuthError
  signUpResult?: { data: { user: unknown; session: unknown }; error: AuthError }
  updateUserError?: AuthError
  tableError?: { table: string; error: { code?: string; message: string } }
  storageRemoveError?: { code?: string; message: string }
  // Uitkomst per RPC-naam. Sinds fase 2 lopen het aanmaken van een team
  // (create_team) en het verzilveren van een uitnodiging (accept_team_invite)
  // via een security-definer-functie in de database, niet meer via losse
  // inserts.
  rpc?: Record<string, { data: unknown; error?: { code?: string; message: string } | null }>
  // De lidmaatschappen die team_members teruggeeft. Sinds fase 2 kan één
  // account meerdere teams hebben, in verschillende rollen — dat is precies
  // wat deleteAccount moet aankunnen.
  members?: Record<string, unknown>[]
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  type Eq = { col: string; val: unknown }
  const calls = {
    // `naTabellen` legt de volgorde vast: het logobestand moet vóór de
    // tabel-opruimlus verwijderd worden.
    storageRemove: [] as { bucket: string; paths: string[]; naTabellen: number }[],
    deletes: [] as { table: string; eqs: Eq[] }[],
    // Leesacties met hun filters, zodat vastgelegd kan worden dat
    // deleteAccount de lidmaatschappen op `user_id` opvraagt en niet op het
    // actieve team.
    selects: [] as { table: string; eqs: Eq[] }[],
    inserts: [] as { table: string; payload: Record<string, unknown> }[],
    signIn: [] as { email: string; password: string }[],
    signUp: [] as { email: string; password: string; options?: { data?: Record<string, unknown> } }[],
    resetPassword: [] as { email: string; options?: { redirectTo?: string } }[],
    updateUser: [] as { password?: string; data?: Record<string, unknown> }[],
    rpc: [] as { fn: string; args: Record<string, unknown> | undefined }[],
    signOut: 0,
  }

  // Standaarduitkomsten: create_team geeft het nieuwe team-id terug (sinds
  // fase 2 een eigen uuid, NIET meer de user-id), accept_team_invite slaagt.
  const rpcDefaults: Record<string, { data: unknown; error?: { code?: string; message: string } | null }> = {
    create_team: { data: NIEUW_TEAM_ID },
    accept_team_invite: { data: { status: 'ok', team_id: INVITE_TEAM_ID } },
  }

  function chain(table: string) {
    const eqs: Eq[] = []
    const result = opts.tableError?.table === table
      ? { data: null, error: opts.tableError.error }
      : table === 'team_members'
        // De teamcontext (lib/team-context.ts) leest team_members vóór elke
        // action, en deleteAccount leest hem rechtstreeks om ALLE
        // lidmaatschappen te vinden. Standaard: één eigen team, zoals elk
        // bestaand account dat vóór fase 2 had.
        ? { data: opts.members ?? (user ? [{ team_id: user.id, user_id: user.id, rol: 'owner' }] : []), error: null }
        : { data: null, error: null }
    const c: Record<string, unknown> = {}
    c.select = () => { calls.selects.push({ table, eqs }); return c }
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    // `.in()` hoort erbij sinds getTeamContext de teamnamen ophaalt met
    // settings.select('team_id, value').in('team_id', ...).
    c.in = () => c
    c.delete = () => { calls.deletes.push({ table, eqs }); return c }
    c.insert = (payload: Record<string, unknown>) => { calls.inserts.push({ table, payload }); return c }
    c.maybeSingle = () => Promise.resolve(result)
    c.single = () => Promise.resolve(result)
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
    return c
  }

  const supabase = {
    from: (t: string) => chain(t),
    rpc: (fn: string, args?: Record<string, unknown>) => {
      calls.rpc.push({ fn, args })
      const uitkomst = opts.rpc?.[fn] ?? rpcDefaults[fn] ?? { data: null, error: null }
      const resultaat = { data: uitkomst.data, error: uitkomst.error ?? null }
      const promise = Promise.resolve(resultaat) as Promise<typeof resultaat> & {
        single: () => Promise<typeof resultaat>
        maybeSingle: () => Promise<typeof resultaat>
      }
      promise.single = () => Promise.resolve(resultaat)
      promise.maybeSingle = () => Promise.resolve(resultaat)
      return promise
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          calls.storageRemove.push({ bucket, paths, naTabellen: calls.deletes.length })
          return { data: opts.storageRemoveError ? null : [], error: opts.storageRemoveError ?? null }
        },
      }),
    },
    auth: {
      getUser: async () => ({ data: { user } }),
      signInWithPassword: async (creds: { email: string; password: string }) => {
        calls.signIn.push(creds)
        return { error: opts.signInError ?? null }
      },
      signUp: async (creds: { email: string; password: string; options?: { data?: Record<string, unknown> } }) => {
        calls.signUp.push(creds)
        return opts.signUpResult ?? { data: { user: { id: 'new-team' }, session: { access_token: 'x' } }, error: null }
      },
      resetPasswordForEmail: async (email: string, options?: { redirectTo?: string }) => {
        calls.resetPassword.push({ email, options })
        return { error: null }
      },
      updateUser: async (attrs: { password?: string; data?: Record<string, unknown> }) => {
        calls.updateUser.push(attrs)
        return { data: { user }, error: opts.updateUserError ?? null }
      },
      signOut: async () => { calls.signOut += 1; return { error: null } },
    },
  }

  return { supabase, calls }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

function useHeaders(init: Record<string, string> = { 'x-forwarded-for': '1.2.3.4' }) {
  vi.mocked(headers).mockResolvedValue(new Headers(init) as unknown as Awaited<ReturnType<typeof headers>>)
}

// signUpViaInvite zet de active_team-cookie zodra de uitnodiging verzilverd is.
let gezetteCookies: { naam: string; value: string }[] = []

function useCookies() {
  gezetteCookies = []
  vi.mocked(cookies).mockResolvedValue({
    set: (naam: string, value: string) => { gezetteCookies.push({ naam, value }) },
    get: () => undefined,
  } as unknown as Awaited<ReturnType<typeof cookies>>)
}

function makeAdmin() {
  const deleteUser = vi.fn(async () => ({ data: null, error: null }))
  return { admin: { auth: { admin: { deleteUser } } }, deleteUser }
}

// Namaak van de service-role-RPC's uit supabase/rate-limit.sql
// (rate_limit_record_attempt/_check/_clear), zodat signIn/signUp/
// requestPasswordReset hier getest kunnen worden zonder een echte Postgres-
// verbinding. Elke test krijgt via beforeEach een verse, lege teller — het
// equivalent van de oude resetRateLimits().
function makeRateLimitAdmin() {
  type Entry = { count: number; windowStart: number; blockedUntil: number | null }
  const entries = new Map<string, Entry>()

  function record(key: string, windowMs: number, limit: number, blockMs: number) {
    const now = Date.now()
    const existing = entries.get(key) ?? null
    const stale = !existing
      || now - existing.windowStart >= windowMs
      || (existing.blockedUntil !== null && existing.blockedUntil <= now)

    if (!stale && existing!.blockedUntil !== null && existing!.blockedUntil > now) {
      return { blocked: true, retry_after_ms: existing!.blockedUntil - now }
    }

    const entry: Entry = stale
      ? { count: 1, windowStart: now, blockedUntil: null }
      : { count: existing!.count + 1, windowStart: existing!.windowStart, blockedUntil: null }

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
      } else if (fn === 'rate_limit_clear') {
        entries.delete(args!.p_key as string)
      }
      const promise = Promise.resolve({ data: result, error: null })
      ;(promise as unknown as { single: () => Promise<unknown> }).single = () => promise
      return promise
    },
  }
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const STRONG_PASSWORD = 'correct-horse-battery'

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  // Default: rate-limiting werkt (backed door een verse, lege in-memory
  // namaak-teller). Tests voor deleteAccount overschrijven dit zelf met
  // makeAdmin() of null — deleteAccount roept geen rate-limit-functies aan,
  // dus dat overschrijven raakt deze default niet.
  vi.mocked(createAdminClient).mockReturnValue(
    makeRateLimitAdmin() as unknown as ReturnType<typeof createAdminClient>,
  )
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  useHeaders()
  useCookies()
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pitchup.example')
})

afterEach(() => {
  consoleError.mockRestore()
  vi.unstubAllEnvs()
})

function loggedText(): string {
  return consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
}

// ────────────────────────────────────────────────
// signIn
// ────────────────────────────────────────────────

describe('signIn', () => {
  it('geeft een generieke melding bij verkeerde inloggegevens', async () => {
    use(makeSupabase({ signInError: { message: 'Invalid login credentials', code: 'invalid_credentials' } }))

    const result = await signIn(null, form({ email: 'bob@example.com', password: 'fout' }))

    expect(result).toEqual({ error: 'E-mailadres of wachtwoord klopt niet' })
    expect(loggedText()).not.toContain('Invalid login credentials')
  })

  it('blokkeert na te veel mislukte pogingen op hetzelfde e-mailadres + IP', async () => {
    const m = makeSupabase({ signInError: { message: 'Invalid login credentials' } })
    use(m)
    const fd = form({ email: 'bob@example.com', password: 'fout' })

    for (let i = 0; i < SIGN_IN_POLICY.limit; i++) await signIn(null, fd)
    expect(m.calls.signIn).toHaveLength(SIGN_IN_POLICY.limit)

    const blocked = await signIn(null, fd)
    expect(blocked?.error).toContain('Te veel inlogpogingen')
    // De geblokkeerde poging bereikt Supabase niet meer.
    expect(m.calls.signIn).toHaveLength(SIGN_IN_POLICY.limit)
  })

  it('raakt andere e-mailadressen en IP-adressen niet', async () => {
    const m = makeSupabase({ signInError: { message: 'Invalid login credentials' } })
    use(m)
    const fd = form({ email: 'bob@example.com', password: 'fout' })
    for (let i = 0; i <= SIGN_IN_POLICY.limit; i++) await signIn(null, fd)

    const anderAdres = await signIn(null, form({ email: 'eva@example.com', password: 'fout' }))
    expect(anderAdres?.error).toBe('E-mailadres of wachtwoord klopt niet')

    useHeaders({ 'x-forwarded-for': '9.9.9.9' })
    const anderIp = await signIn(null, fd)
    expect(anderIp?.error).toBe('E-mailadres of wachtwoord klopt niet')
  })

  it('wist de teller na een geslaagde inlog', async () => {
    const mislukt = makeSupabase({ signInError: { message: 'Invalid login credentials' } })
    use(mislukt)
    const fd = form({ email: 'bob@example.com', password: 'fout' })
    for (let i = 0; i < SIGN_IN_POLICY.limit - 1; i++) await signIn(null, fd)

    const gelukt = makeSupabase()
    use(gelukt)
    await expect(signIn(null, form({ email: 'bob@example.com', password: STRONG_PASSWORD })))
      .rejects.toThrow('__redirect__:/')

    // Teller is leeg: een nieuwe reeks fouten mag weer helemaal opnieuw.
    use(mislukt)
    for (let i = 0; i < SIGN_IN_POLICY.limit - 1; i++) {
      const r = await signIn(null, fd)
      expect(r?.error).toBe('E-mailadres of wachtwoord klopt niet')
    }
  })

  it('stopt password spraying: veel verschillende accounts vanaf één IP lopen vast', async () => {
    const m = makeSupabase({ signInError: { message: 'Invalid login credentials' } })
    use(m)

    // Elke poging een ánder e-mailadres, dus de e-mail+IP-teller wordt nooit
    // geraakt; alleen de IP-teller kan dit stoppen.
    for (let i = 0; i < SIGN_IN_IP_POLICY.limit; i++) {
      const r = await signIn(null, form({ email: `slachtoffer${i}@example.com`, password: 'Zomer2026!' }))
      expect(r?.error).toBe('E-mailadres of wachtwoord klopt niet')
    }
    expect(m.calls.signIn).toHaveLength(SIGN_IN_IP_POLICY.limit)

    const blocked = await signIn(null, form({ email: 'nogeen@example.com', password: 'Zomer2026!' }))
    expect(blocked?.error).toContain('Te veel inlogpogingen')
    expect(m.calls.signIn).toHaveLength(SIGN_IN_IP_POLICY.limit)
  })

  it('laat een ander IP ongemoeid als één IP op slot zit', async () => {
    use(makeSupabase({ signInError: { message: 'Invalid login credentials' } }))
    for (let i = 0; i <= SIGN_IN_IP_POLICY.limit; i++) {
      await signIn(null, form({ email: `slachtoffer${i}@example.com`, password: 'Zomer2026!' }))
    }

    useHeaders({ 'x-forwarded-for': '9.9.9.9' })
    const anderIp = await signIn(null, form({ email: 'bob@example.com', password: 'fout' }))
    expect(anderIp?.error).toBe('E-mailadres of wachtwoord klopt niet')
  })

  it('reset de IP-teller niet na een geslaagde inlog op één eigen account', async () => {
    const mislukt = makeSupabase({ signInError: { message: 'Invalid login credentials' } })
    use(mislukt)
    for (let i = 0; i < SIGN_IN_IP_POLICY.limit - 1; i++) {
      await signIn(null, form({ email: `slachtoffer${i}@example.com`, password: 'Zomer2026!' }))
    }

    // Een aanvaller met een eigen geldig account mag de spray-teller niet
    // kunnen wissen.
    const gelukt = makeSupabase()
    use(gelukt)
    await expect(signIn(null, form({ email: 'eigen@example.com', password: STRONG_PASSWORD })))
      .rejects.toThrow('__redirect__:/')

    use(mislukt)
    const nogEen = makeSupabase({ signInError: { message: 'Invalid login credentials' } })
    use(nogEen)
    await signIn(null, form({ email: 'laatste@example.com', password: 'Zomer2026!' }))
    const blocked = await signIn(null, form({ email: 'daarna@example.com', password: 'Zomer2026!' }))

    expect(blocked?.error).toContain('Te veel inlogpogingen')
  })

  it('meldt de wachttijd zonder te verraden of het account bestaat', async () => {
    use(makeSupabase({ signInError: { message: 'Invalid login credentials' } }))
    const fd = form({ email: 'bob@example.com', password: 'fout' })
    for (let i = 0; i < SIGN_IN_POLICY.limit; i++) await signIn(null, fd)

    const blocked = await signIn(null, fd)
    expect(blocked?.error).toMatch(/Probeer het over \d+ minuten opnieuw\./)
    expect(blocked?.error).not.toContain('bob@example.com')
  })
})

// ────────────────────────────────────────────────
// signUp
// ────────────────────────────────────────────────

describe('signUp', () => {
  it('weigert een te kort wachtwoord', async () => {
    const m = makeSupabase()
    use(m)

    const result = await signUp(null, form({
      email: 'bob@example.com',
      password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1),
      team_name: 'JO13-1',
    }))

    expect(result).toEqual({ error: `Wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens zijn` })
    expect(m.calls.signUp).toHaveLength(0)
  })

  it('accepteert een wachtwoord van precies de minimumlengte', async () => {
    const m = makeSupabase()
    use(m)

    await expect(signUp(null, form({
      email: 'bob@example.com',
      password: 'a'.repeat(MIN_PASSWORD_LENGTH),
      team_name: 'JO13-1',
    }))).rejects.toThrow('__redirect__:/')

    expect(m.calls.signUp).toHaveLength(1)
  })

  // ── Team aanmaken bij registratie (assistent-trainers) ──
  // SINDS FASE 2 loopt dit via de RPC create_team (M5,
  // supabase/team-aanmaken-rpc.sql) in plaats van drie losse inserts. Dat is
  // geen netheid: de bootstrap-INSERT-policies op teams en team_members gaan
  // ná de deploy van fase 2 weg (M5b), dus de oude weg werkt daarna simpelweg
  // niet meer. En de drie schrijfacties zitten nu in één transactie, zodat er
  // nooit een team zonder hoofdtrainer kan ontstaan.
  it('maakt het team via de RPC create_team en niet meer met losse inserts', async () => {
    const m = makeSupabase()
    use(m)

    await expect(signUp(null, form({
      email: 'bob@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))).rejects.toThrow('__redirect__:/')

    expect(m.calls.rpc.map((c) => c.fn)).toContain('create_team')
    // Geen enkele directe insert in teams/team_members/settings meer: na M5b
    // zijn die policies weg en zou zo'n insert stil stuklopen.
    expect(m.calls.inserts.map((i) => i.table)).not.toContain('teams')
    expect(m.calls.inserts.map((i) => i.table)).not.toContain('team_members')
  })

  it('geeft create_team de opgeschoonde teamnaam mee en vraagt om idempotentie', async () => {
    const m = makeSupabase()
    use(m)

    await expect(signUp(null, form({
      email: 'bob@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))).rejects.toThrow('__redirect__:/')

    // p_alleen_zonder_team vervangt de bescherming die vóór fase 2 uit de
    // primaire sleutel teams.id = user.id kwam: een dubbele inzending levert
    // het bestaande team op in plaats van een tweede leeg team.
    expect(m.calls.rpc.find((c) => c.fn === 'create_team')?.args).toEqual({
      p_naam: 'JO13-1',
      p_alleen_zonder_team: true,
    })
  })

  it('maakt geen team aan als er nog geen sessie is (e-mailbevestiging staat aan)', async () => {
    const m = makeSupabase({
      signUpResult: { data: { user: { id: 'new-user' }, session: null }, error: null },
    })
    use(m)

    const result = await signUp(null, form({
      email: 'bob@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))

    expect(result?.error).toContain('Bevestig eerst je e-mailadres')
    expect(m.calls.rpc).toHaveLength(0)
    expect(m.calls.inserts).toHaveLength(0)
  })

  it('verraadt niet dat een e-mailadres al bestaat', async () => {
    use(makeSupabase({
      signUpResult: {
        data: { user: null, session: null },
        error: { message: 'User already registered', code: 'user_already_exists' },
      },
    }))

    const result = await signUp(null, form({
      email: 'bestaat@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))

    expect(result?.error).toBe('Registratie is niet gelukt. Controleer je gegevens en probeer het opnieuw.')
    expect(result?.error).not.toContain('already registered')
    expect(loggedText()).not.toContain('User already registered')
    expect(loggedText()).not.toContain('bestaat@example.com')
  })

  it('geeft exact dezelfde melding bij een andere registratiefout', async () => {
    use(makeSupabase({
      signUpResult: {
        data: { user: null, session: null },
        error: { message: 'Unable to validate email address: invalid format', code: 'validation_failed' },
      },
    }))

    const result = await signUp(null, form({
      email: 'kapot', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))

    expect(result?.error).toBe('Registratie is niet gelukt. Controleer je gegevens en probeer het opnieuw.')
  })

  it('faalt hard en zichtbaar als create_team niet lukt — zonder team is het account onbruikbaar', async () => {
    use(makeSupabase({
      rpc: {
        create_team: {
          data: null,
          error: { code: '42501', message: 'permission denied for table teams' },
        },
      },
    }))

    const result = await signUp(null, form({
      email: 'bob@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))

    expect(result?.error).toContain('het opzetten van je team is niet gelukt')
    expect(loggedText()).toContain('teamContext.maakEigenTeam')
    expect(loggedText()).toContain('42501')
    expect(loggedText()).not.toContain('permission denied')
  })

  it('faalt hard als create_team geen team-id teruggeeft', async () => {
    use(makeSupabase({ rpc: { create_team: { data: null } } }))

    const result = await signUp(null, form({
      email: 'bob@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))

    expect(result?.error).toContain('het opzetten van je team is niet gelukt')
    expect(loggedText()).toContain('teamContext.maakEigenTeam')
  })

  // ── Registratie zonder directe sessie (e-mailbevestiging staat aan) ──
  it('parkeert de teamnaam als user-metadata, zodat het zelfherstel hem later kan gebruiken', async () => {
    const m = makeSupabase()
    use(m)

    await expect(signUp(null, form({
      email: 'bob@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))).rejects.toThrow('__redirect__:/')

    expect(m.calls.signUp[0].options?.data).toEqual({ [TEAM_NAAM_METADATA_KEY]: 'JO13-1' })
  })

  it('wist de metadata-vlag zodra het team bestaat, zodat hij later geen team kan terugtoveren', async () => {
    const m = makeSupabase()
    use(m)

    await expect(signUp(null, form({
      email: 'bob@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))).rejects.toThrow('__redirect__:/')

    expect(m.calls.updateUser).toContainEqual({ data: { [TEAM_NAAM_METADATA_KEY]: null } })
  })

  it('throttlet herhaalde registratiepogingen op hetzelfde e-mailadres + IP', async () => {
    const m = makeSupabase({
      signUpResult: { data: { user: null, session: null }, error: { message: 'kapot' } },
    })
    use(m)
    const fd = form({ email: 'bob@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1' })

    for (let i = 0; i < SIGN_UP_POLICY.limit; i++) await signUp(null, fd)
    expect(m.calls.signUp).toHaveLength(SIGN_UP_POLICY.limit)

    const blocked = await signUp(null, fd)
    expect(blocked?.error).toContain('Te veel registratiepogingen')
    // De geblokkeerde poging bereikt Supabase niet meer.
    expect(m.calls.signUp).toHaveLength(SIGN_UP_POLICY.limit)
  })

  it('throttlet ook wanneer elke poging een nieuw e-mailadres gebruikt', async () => {
    const m = makeSupabase({
      signUpResult: { data: { user: null, session: null }, error: { message: 'kapot' } },
    })
    use(m)

    for (let i = 0; i < SIGN_UP_IP_POLICY.limit; i++) {
      await signUp(null, form({ email: `nieuw${i}@example.com`, password: STRONG_PASSWORD, team_name: 'JO13-1' }))
    }
    expect(m.calls.signUp).toHaveLength(SIGN_UP_IP_POLICY.limit)

    const blocked = await signUp(null, form({
      email: 'nogeen@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))
    expect(blocked?.error).toContain('Te veel registratiepogingen')
    expect(m.calls.signUp).toHaveLength(SIGN_UP_IP_POLICY.limit)
  })

  it('telt ook geslaagde registraties mee, en laat een ander IP ongemoeid', async () => {
    const m = makeSupabase()
    use(m)

    for (let i = 0; i < SIGN_UP_IP_POLICY.limit; i++) {
      await expect(signUp(null, form({
        email: `nieuw${i}@example.com`, password: STRONG_PASSWORD, team_name: 'JO13-1',
      }))).rejects.toThrow('__redirect__:/')
    }

    const blocked = await signUp(null, form({
      email: 'daarna@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))
    expect(blocked?.error).toContain('Te veel registratiepogingen')

    useHeaders({ 'x-forwarded-for': '9.9.9.9' })
    await expect(signUp(null, form({
      email: 'ander-ip@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))).rejects.toThrow('__redirect__:/')
  })

  it('verbruikt geen poging aan een formulier dat de basiscontroles niet haalt', async () => {
    const m = makeSupabase()
    use(m)

    for (let i = 0; i < SIGN_UP_IP_POLICY.limit + 3; i++) {
      await signUp(null, form({ email: 'bob@example.com', password: 'kort', team_name: 'JO13-1' }))
    }
    expect(m.calls.signUp).toHaveLength(0)

    // Een geldige poging kan daarna gewoon door.
    await expect(signUp(null, form({
      email: 'bob@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))).rejects.toThrow('__redirect__:/')
  })
})

// ────────────────────────────────────────────────
// updatePassword
// ────────────────────────────────────────────────

// ────────────────────────────────────────────────
// signIn — de next-parameter voor de uitnodigingsflow
// ────────────────────────────────────────────────

describe('signIn — next-parameter', () => {
  it('stuurt na het inloggen naar het uitnodigingspad', async () => {
    use(makeSupabase())

    await expect(signIn(null, form({
      email: 'bob@example.com', password: STRONG_PASSWORD, next: `/invite/${GELDIG_TOKEN}`,
    }))).rejects.toThrow(`__redirect__:/invite/${GELDIG_TOKEN}`)
  })

  it('stuurt zonder next gewoon naar /', async () => {
    use(makeSupabase())

    await expect(signIn(null, form({ email: 'bob@example.com', password: STRONG_PASSWORD })))
      .rejects.toThrow('__redirect__:/')
  })

  // Zonder de strikte regex is dit een open redirect: de gebruiker logt in op
  // de echte app en belandt daarna op een vreemde host.
  it('weigert elke vreemde bestemming en valt terug op /', async () => {
    for (const next of [
      'https://kwaadaardig.example',
      '//kwaadaardig.example',
      '/settings',
      `/invite/${GELDIG_TOKEN}/register`,
      'javascript:alert(1)',
    ]) {
      use(makeSupabase())
      await expect(
        signIn(null, form({ email: `bob${next.length}@example.com`, password: STRONG_PASSWORD, next })),
        next,
      ).rejects.toThrow('__redirect__:/')
    }
  })
})

// ────────────────────────────────────────────────
// signUpViaInvite
// ────────────────────────────────────────────────

describe('signUpViaInvite', () => {
  // DIT IS BUSINESSREGEL 51, EN DE VLAG IS DE HELE MECHANIEK. Zou hij hier
  // gezet worden, dan gaf het zelfherstel in lib/team-context.ts de genodigde
  // na e-mailbevestiging alsnog een leeg eigen team.
  it('zet de metadata-vlag NIET — wie via een uitnodiging binnenkomt krijgt geen eigen team', async () => {
    const m = makeSupabase()
    use(m)

    await expect(signUpViaInvite(null, form({
      email: 'hulp@example.com', password: STRONG_PASSWORD, token: GELDIG_TOKEN,
    }))).rejects.toThrow(`__redirect__:${NA_ACCEPTATIE_PAD}`)

    expect(m.calls.signUp[0].options?.data).toBeUndefined()
    expect(JSON.stringify(m.calls.signUp[0])).not.toContain(TEAM_NAAM_METADATA_KEY)
  })

  it('maakt geen eigen team aan', async () => {
    const m = makeSupabase()
    use(m)

    await expect(signUpViaInvite(null, form({
      email: 'hulp@example.com', password: STRONG_PASSWORD, token: GELDIG_TOKEN,
    }))).rejects.toThrow(`__redirect__:${NA_ACCEPTATIE_PAD}`)

    expect(m.calls.rpc.map((c) => c.fn)).toEqual(['accept_team_invite'])
    expect(m.calls.inserts).toHaveLength(0)
  })

  it('verzilvert de uitnodiging met de HASH van het token en zet het team als actief', async () => {
    const m = makeSupabase()
    use(m)

    await expect(signUpViaInvite(null, form({
      email: 'hulp@example.com', password: STRONG_PASSWORD, token: GELDIG_TOKEN,
    }))).rejects.toThrow(`__redirect__:${NA_ACCEPTATIE_PAD}`)

    expect(m.calls.rpc[0].args).toEqual({ p_token_hash: hashInviteToken(GELDIG_TOKEN) })
    expect(gezetteCookies).toEqual([{ naam: 'active_team', value: INVITE_TEAM_ID }])
  })

  // Registreren via een uitnodiging is óók "je bent toegevoegd aan <team>" en
  // eindigt daarom op exact dezelfde bestemming als acceptInvite — inclusief
  // de joined-vlag, en zonder team-id in de query.
  it('eindigt op dezelfde bestemming als acceptInvite, met de joined-vlag en zonder tenant-sleutel', async () => {
    use(makeSupabase())

    const fout = await signUpViaInvite(null, form({
      email: 'hulp@example.com', password: STRONG_PASSWORD, token: GELDIG_TOKEN,
    })).catch((e: Error) => e.message)

    expect(fout).toBe('__redirect__:/?joined=1')
    expect(fout).not.toContain(INVITE_TEAM_ID)
  })

  // Brief §2.2: de uitnodiging is nog ongebruikt en dus nog geldig, dus er is
  // geen pending-mechanisme en geen extra cookie nodig — de genodigde opent na
  // het bevestigen simpelweg dezelfde link opnieuw.
  it('meldt zonder sessie dat de e-mail eerst bevestigd moet worden, en verbruikt de link niet', async () => {
    const m = makeSupabase({
      signUpResult: { data: { user: { id: 'nieuw' }, session: null }, error: null },
    })
    use(m)

    const result = await signUpViaInvite(null, form({
      email: 'hulp@example.com', password: STRONG_PASSWORD, token: GELDIG_TOKEN,
    }))

    expect(result.error).toBe('Bevestig eerst je e-mailadres en open daarna de uitnodigingslink opnieuw.')
    expect(m.calls.rpc).toHaveLength(0)
    expect(gezetteCookies).toHaveLength(0)
  })

  it('weigert een token met een onmogelijke vorm vóór elke andere stap', async () => {
    const m = makeSupabase()
    use(m)

    for (const token of ['', '../../etc/passwd', 'kort']) {
      const result = await signUpViaInvite(null, form({
        email: 'hulp@example.com', password: STRONG_PASSWORD, token,
      }))
      expect(result.error, token).toContain('niet (meer) geldig')
    }
    expect(m.calls.signUp).toHaveLength(0)
  })

  it('weigert een te kort wachtwoord, net als signUp', async () => {
    const m = makeSupabase()
    use(m)

    const result = await signUpViaInvite(null, form({
      email: 'hulp@example.com', password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1), token: GELDIG_TOKEN,
    }))

    expect(result.error).toBe(`Wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens zijn`)
    expect(m.calls.signUp).toHaveLength(0)
  })

  it('verraadt niet dat een e-mailadres al bestaat', async () => {
    use(makeSupabase({
      signUpResult: {
        data: { user: null, session: null },
        error: { message: 'User already registered', code: 'user_already_exists' },
      },
    }))

    const result = await signUpViaInvite(null, form({
      email: 'bestaat@example.com', password: STRONG_PASSWORD, token: GELDIG_TOKEN,
    }))

    expect(result.error).toBe('Registratie is niet gelukt. Controleer je gegevens en probeer het opnieuw.')
    expect(loggedText()).not.toContain('User already registered')
  })

  it('meldt een inmiddels ongeldige uitnodiging zonder cookie te zetten — het account bestaat dan wél', async () => {
    const m = makeSupabase({ rpc: { accept_team_invite: { data: { status: 'invalid', team_id: null } } } })
    use(m)

    const result = await signUpViaInvite(null, form({
      email: 'hulp@example.com', password: STRONG_PASSWORD, token: GELDIG_TOKEN,
    }))

    expect(result.error).toContain('niet (meer) geldig')
    expect(gezetteCookies).toHaveLength(0)
  })

  // Zonder gedeelde tellers zou dit een tweede, onbeperkte weg naar
  // supabase.auth.signUp() zijn.
  it('deelt de registratie-teller met signUp', async () => {
    const m = makeSupabase({
      signUpResult: { data: { user: { id: 'nieuw' }, session: null }, error: null },
    })
    use(m)
    const velden = { email: 'hulp@example.com', password: STRONG_PASSWORD }

    // Eerst signUp tot de limiet vol is...
    for (let i = 0; i < SIGN_UP_POLICY.limit; i++) {
      await signUp(null, form({ ...velden, team_name: 'JO13-1' }))
    }
    // ...daarna loopt signUpViaInvite op dezelfde teller vast.
    const result = await signUpViaInvite(null, form({ ...velden, token: GELDIG_TOKEN }))
    expect(result.error).toContain('Te veel registratiepogingen')
  })

  it('throttlet ook per IP wanneer elke poging een nieuw e-mailadres gebruikt', async () => {
    const m = makeSupabase({
      signUpResult: { data: { user: { id: 'nieuw' }, session: null }, error: null },
    })
    use(m)

    for (let i = 0; i < SIGN_UP_IP_POLICY.limit; i++) {
      await signUpViaInvite(null, form({
        email: `hulp${i}@example.com`, password: STRONG_PASSWORD, token: GELDIG_TOKEN,
      }))
    }

    const result = await signUpViaInvite(null, form({
      email: 'laatste@example.com', password: STRONG_PASSWORD, token: GELDIG_TOKEN,
    }))
    expect(result.error).toContain('Te veel registratiepogingen')
  })
})

describe('updatePassword', () => {
  it('weigert server-side een te kort wachtwoord, ook zonder client-validatie', async () => {
    const m = makeSupabase()
    use(m)

    const result = await updatePassword(null, form({ password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1) }))

    expect(result).toEqual({ error: `Wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens zijn` })
    expect(m.calls.updateUser).toHaveLength(0)
  })

  it('weigert een leeg wachtwoord', async () => {
    const m = makeSupabase()
    use(m)

    const result = await updatePassword(null, form({ password: '' }))

    expect(result.error).toContain(`minimaal ${MIN_PASSWORD_LENGTH}`)
    expect(m.calls.updateUser).toHaveLength(0)
  })

  it('accepteert precies de minimumlengte en zet het wachtwoord', async () => {
    const m = makeSupabase()
    use(m)
    const password = 'a'.repeat(MIN_PASSWORD_LENGTH)

    const result = await updatePassword(null, form({ password }))

    expect(result).toEqual({ error: null })
    expect(m.calls.updateUser).toEqual([{ password }])
  })

  it('weigert zonder (herstel)sessie en raakt het account niet aan', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    const result = await updatePassword(null, form({ password: STRONG_PASSWORD }))

    expect(result.error).toContain('niet (meer) ingelogd')
    expect(m.calls.updateUser).toHaveLength(0)
  })

  it('lekt de ruwe Supabase-fout niet naar de client of de log', async () => {
    const m = makeSupabase({ updateUserError: { message: 'New password should be different from the old password', code: 'same_password' } })
    use(m)

    const result = await updatePassword(null, form({ password: STRONG_PASSWORD }))

    expect(result.error).toBe('Wachtwoord bijwerken is niet gelukt. Probeer het opnieuw.')
    expect(loggedText()).toContain('auth.updatePassword')
    expect(loggedText()).toContain('same_password')
    expect(loggedText()).not.toContain('New password should be different')
  })

  it('logt het wachtwoord zelf nooit', async () => {
    use(makeSupabase({ updateUserError: { message: 'kapot' } }))

    await updatePassword(null, form({ password: STRONG_PASSWORD }))

    expect(loggedText()).not.toContain(STRONG_PASSWORD)
  })
})

// ────────────────────────────────────────────────
// requestPasswordReset
// ────────────────────────────────────────────────

describe('requestPasswordReset', () => {
  it('bouwt de herstellink uit de geconfigureerde site-URL en negeert de origin-header', async () => {
    const m = makeSupabase()
    use(m)
    useHeaders({ 'x-forwarded-for': '1.2.3.4', origin: 'https://kwaadaardig.example', host: 'kwaadaardig.example' })

    const result = await requestPasswordReset(null, form({ email: 'bob@example.com' }))

    expect(result).toEqual({ sent: true })
    expect(m.calls.resetPassword).toHaveLength(1)
    expect(m.calls.resetPassword[0].options?.redirectTo).toBe('https://pitchup.example/reset-password')
    expect(m.calls.resetPassword[0].options?.redirectTo).not.toContain('kwaadaardig')
  })

  it('stuurt niets zonder e-mailadres', async () => {
    const m = makeSupabase()
    use(m)

    expect(await requestPasswordReset(null, form({ email: '  ' }))).toEqual({ sent: true })
    expect(m.calls.resetPassword).toHaveLength(0)
  })

  it('stuurt niets in productie zonder NEXT_PUBLIC_SITE_URL, maar antwoordt hetzelfde', async () => {
    const m = makeSupabase()
    use(m)
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    vi.stubEnv('NODE_ENV', 'production')

    const result = await requestPasswordReset(null, form({ email: 'bob@example.com' }))

    expect(result).toEqual({ sent: true })
    expect(m.calls.resetPassword).toHaveLength(0)
    expect(loggedText()).toContain('site_url_missing')
  })

  it('stopt met versturen na de limiet, met een onveranderd antwoord', async () => {
    const m = makeSupabase()
    use(m)
    const fd = form({ email: 'bob@example.com' })

    for (let i = 0; i < PASSWORD_RESET_POLICY.limit; i++) {
      expect(await requestPasswordReset(null, fd)).toEqual({ sent: true })
    }
    expect(m.calls.resetPassword).toHaveLength(PASSWORD_RESET_POLICY.limit)

    expect(await requestPasswordReset(null, fd)).toEqual({ sent: true })
    expect(m.calls.resetPassword).toHaveLength(PASSWORD_RESET_POLICY.limit)
  })
})

// ────────────────────────────────────────────────
// deleteAccount
// ────────────────────────────────────────────────

// De dertien teamtabellen in FK-veilige volgorde, gevolgd door de teams-rij
// zelf. `categorie_metingen` staat er bewust bij: die tabel heeft alleen een
// team_id en cascadet nergens vanaf, dus de nulmetingen per onderdeel bleven
// vroeger als wees achter. De cascade op `teams` ruimt team_members en
// team_invites op.
const TEAM_OPRUIMING = [
  'training_oefeningen', 'task_overrides', 'match_squad', 'match_events',
  'match_ratings', 'lineups', 'attendance', 'absence_periods',
  'categorie_metingen', 'metingen', 'events', 'players', 'settings',
  'teams',
]

describe('deleteAccount', () => {
  it('faalt hard en verwijdert niets zonder service-role-key', async () => {
    const m = makeSupabase()
    use(m)
    vi.mocked(createAdminClient).mockReturnValue(null)

    await expect(deleteAccount()).rejects.toThrow('Account verwijderen is nu niet mogelijk')
    expect(m.calls.deletes).toHaveLength(0)
    expect(m.calls.signOut).toBe(0)
    expect(loggedText()).toContain('service_role_key_missing')
  })

  it('verwijdert alle eigen tabellen team-gescoped en daarna het auth-account', async () => {
    const m = makeSupabase()
    use(m)
    const { admin, deleteUser } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow('__redirect__:/login')

    // Eerst de teamdata per eigen team, daarna pas het persoonlijke bezit:
    // `oefeningen` hangt aan het ACCOUNT (team_id = eigenaar-user) en zijn
    // FK-cascade raakt koppelingen in teams van ANDEREN, dus die stap hoort
    // pas te komen als alle eigen teams opgeruimd zijn.
    expect(m.calls.deletes.map((d) => d.table)).toEqual([...TEAM_OPRUIMING, 'oefeningen'])
    for (const del of m.calls.deletes) {
      // `teams` op zijn primaire sleutel, `oefeningen` op de EIGENAAR-USER,
      // de rest op team_id. In dit scenario zijn die twee waarden toevallig
      // gelijk (een account uit de fase-1-tijd).
      expect(del.eqs).toEqual([
        { col: del.table === 'teams' ? 'id' : 'team_id', val: 'team-1' },
      ])
    }
    expect(deleteUser).toHaveBeenCalledWith('team-1')
    expect(m.calls.signOut).toBe(1)
  })

  it('geeft een generieke melding als een tabel niet gewist kan worden', async () => {
    use(makeSupabase({ tableError: { table: 'events', error: { code: '42501', message: 'permission denied for table events' } } }))
    const { admin } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(loggedText()).not.toContain('permission denied')
  })

  it('weigert zonder ingelogde gebruiker', async () => {
    use(makeSupabase({ user: null }))

    await expect(deleteAccount()).rejects.toThrow('Niet ingelogd')
  })

  it('verwijdert het clublogo uit Storage vóór de tabel-opruimlus (AVG)', async () => {
    const m = makeSupabase()
    use(m)
    const { admin } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow('__redirect__:/login')

    // Bewust tegen de gedeelde constanten uit lib/logo-upload.ts en niet tegen
    // letterlijke strings: zo faalt deze test zodra deleteAccount weer een eigen
    // pad zou opbouwen. De vorm van dat pad zelf is vastgelegd in
    // lib/logo-upload.test.ts.
    expect(m.calls.storageRemove).toEqual([
      { bucket: TEAM_LOGO_BUCKET, paths: [teamLogoPath('team-1')], naTabellen: 0 },
    ])
  })

  it('laat een storage-fout de rest van de verwijdering niet blokkeren', async () => {
    const m = makeSupabase({
      storageRemoveError: { code: '404', message: 'Object not found: team-1/logo' },
    })
    use(m)
    const { admin, deleteUser } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow('__redirect__:/login')

    expect(m.calls.deletes.map((d) => d.table)).toEqual([...TEAM_OPRUIMING, 'oefeningen'])
    expect(deleteUser).toHaveBeenCalledWith('team-1')
    expect(m.calls.signOut).toBe(1)
    expect(loggedText()).toContain('auth.deleteAccount.team1.storage')
    expect(loggedText()).not.toContain('Object not found')
  })

  it('raakt Storage niet aan zonder service-role-key', async () => {
    const m = makeSupabase()
    use(m)
    vi.mocked(createAdminClient).mockReturnValue(null)

    await expect(deleteAccount()).rejects.toThrow('Account verwijderen is nu niet mogelijk')
    expect(m.calls.storageRemove).toHaveLength(0)
  })

  // ── De rollen-lus (brief §2.6), naar fase 2 gehaald ──
  // Tot fase 1 had een account precies één team en was het daar owner van.
  // Vanaf fase 2 leveren createTeam en acceptInvite meerdere lidmaatschappen
  // op; alleen het ACTIEVE team opruimen zou de data van het andere team laten
  // staan (persoonsgegevens van spelers) mét een owner-rij die naar een
  // verdwenen account wijst — en dáár slaat de sanity-check "geen team zonder
  // hoofdtrainer" juist niet op aan.
  it('leest alle lidmaatschappen rechtstreeks, gescoped op de eigen user-id', async () => {
    const m = makeSupabase()
    use(m)
    const { admin } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow('__redirect__:/login')

    // De lees zit vóór elke delete en filtert op user_id — niet op het actieve
    // team, en niet via de cache()-de teamcontext.
    expect(m.calls.selects[0]).toEqual({ table: 'team_members', eqs: [{ col: 'user_id', val: 'team-1' }] })
  })

  it('ruimt bij een hoofdtrainer van TWEE teams beide teams volledig op', async () => {
    const m = makeSupabase({
      members: [
        { team_id: 'team-a', rol: 'owner' },
        { team_id: 'team-b', rol: 'owner' },
      ],
    })
    use(m)
    const { admin, deleteUser } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow('__redirect__:/login')

    expect(m.calls.deletes.map((d) => d.table)).toEqual([
      ...TEAM_OPRUIMING, ...TEAM_OPRUIMING, 'oefeningen',
    ])
    // Elk team wordt op zijn eigen id gescoped; geen enkele delete raakt het
    // andere team.
    const teamIds = m.calls.deletes.map((d) => d.eqs[0].val)
    expect(teamIds.slice(0, TEAM_OPRUIMING.length).every((v) => v === 'team-a')).toBe(true)
    expect(teamIds.slice(TEAM_OPRUIMING.length, TEAM_OPRUIMING.length * 2).every((v) => v === 'team-b')).toBe(true)
    // Beide logo's gaan mee.
    expect(m.calls.storageRemove.map((r) => r.paths[0])).toEqual([
      teamLogoPath('team-a'), teamLogoPath('team-b'),
    ])
    expect(deleteUser).toHaveBeenCalledWith('team-1')
  })

  it('ruimt bij owner-van-A + assistent-bij-B alleen team A op, en zegt bij B alleen het lidmaatschap op', async () => {
    const m = makeSupabase({
      members: [
        { team_id: 'team-a', rol: 'owner' },
        { team_id: 'team-b', rol: 'assistent' },
      ],
    })
    use(m)
    const { admin, deleteUser } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow('__redirect__:/login')

    // Team B verliest ALLEEN de eigen lidmaatschapsrij — de teamdata blijft
    // volledig intact (AC 10/21): een assistent die vertrekt neemt niets mee.
    expect(m.calls.deletes.map((d) => d.table)).toEqual([
      ...TEAM_OPRUIMING, 'team_members', 'oefeningen',
    ])
    const lidmaatschap = m.calls.deletes.find((d) => d.table === 'team_members')!
    expect(lidmaatschap.eqs).toEqual([
      { col: 'team_id', val: 'team-b' },
      { col: 'user_id', val: 'team-1' },
    ])
    // Geen enkele teamtabel wordt op team-b gescoped.
    expect(m.calls.deletes.filter((d) => d.table !== 'team_members').some((d) => d.eqs[0].val === 'team-b')).toBe(false)
    // Het logo van team B blijft staan: dat is niet van deze gebruiker.
    expect(m.calls.storageRemove.map((r) => r.paths[0])).toEqual([teamLogoPath('team-a')])
    expect(deleteUser).toHaveBeenCalledWith('team-1')
  })

  it('raakt bij een account dat alleen assistent is GEEN enkele teamtabel aan', async () => {
    const m = makeSupabase({ members: [{ team_id: 'team-b', rol: 'assistent' }] })
    use(m)
    const { admin, deleteUser } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow('__redirect__:/login')

    expect(m.calls.deletes.map((d) => d.table)).toEqual(['team_members', 'oefeningen'])
    expect(m.calls.storageRemove).toHaveLength(0)
    // Het account zelf verdwijnt wél (AVG), en de eigen oefeningen gaan mee —
    // hun koppelingen in trainingsplannen van anderen cascaden weg.
    expect(deleteUser).toHaveBeenCalledWith('team-1')
  })

  it('verwijdert het account van iemand zonder enkel lidmaatschap, zonder teamdata aan te raken', async () => {
    const m = makeSupabase({ members: [] })
    use(m)
    const { admin, deleteUser } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow('__redirect__:/login')

    expect(m.calls.deletes.map((d) => d.table)).toEqual(['oefeningen'])
    expect(deleteUser).toHaveBeenCalledWith('team-1')
  })

  it('stopt bij een mislukking halverwege en laat het auth-account bestaan, met een vindbaar contextlabel per team', async () => {
    const m = makeSupabase({
      members: [
        { team_id: 'team-a', rol: 'owner' },
        { team_id: 'team-b', rol: 'owner' },
      ],
      tableError: { table: 'events', error: { code: '42501', message: 'permission denied for table events' } },
    })
    use(m)
    const { admin, deleteUser } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    // Het account blijft bestaan, zodat de gebruiker het opnieuw kan proberen
    // in plaats van data achter te laten die aan een verdwenen account hangt.
    expect(deleteUser).not.toHaveBeenCalled()
    expect(m.calls.signOut).toBe(0)
    // Het contextlabel bevat het volgnummer van het team, niet het team-id:
    // dat laatste zou een tenant-sleutel in de log zetten.
    expect(loggedText()).toContain('auth.deleteAccount.team1.events')
    expect(loggedText()).not.toContain('team-a')
    expect(loggedText()).not.toContain('permission denied')
  })

  it('lekt de ruwe fout niet als de lidmaatschappen niet te lezen zijn, en verwijdert dan niets', async () => {
    const m = makeSupabase({
      tableError: { table: 'team_members', error: { code: '42501', message: 'permission denied for table team_members' } },
    })
    use(m)
    const { admin, deleteUser } = makeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)

    await expect(deleteAccount()).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    expect(m.calls.deletes).toHaveLength(0)
    expect(deleteUser).not.toHaveBeenCalled()
    expect(loggedText()).toContain('auth.deleteAccount.lidmaatschappen')
    expect(loggedText()).not.toContain('permission denied')
  })
})
