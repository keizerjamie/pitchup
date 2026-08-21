import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`__redirect__:${to}`) },
}))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-policy'
import { TEAM_LOGO_BUCKET, teamLogoPath } from '@/lib/logo-upload'
import {
  SIGN_IN_POLICY,
  SIGN_IN_IP_POLICY,
  SIGN_UP_POLICY,
  SIGN_UP_IP_POLICY,
  PASSWORD_RESET_POLICY,
} from '@/lib/rate-limit'
import { signIn, signUp, requestPasswordReset, updatePassword, deleteAccount } from '@/app/actions/auth'

// ────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────

type AuthError = { message: string; code?: string } | null

function makeSupabase(opts: {
  user?: { id: string } | null
  signInError?: AuthError
  signUpResult?: { data: { user: unknown; session: unknown }; error: AuthError }
  updateUserError?: AuthError
  tableError?: { table: string; error: { code?: string; message: string } }
  storageRemoveError?: { code?: string; message: string }
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  type Eq = { col: string; val: unknown }
  const calls = {
    // `naTabellen` legt de volgorde vast: het logobestand moet vóór de
    // tabel-opruimlus verwijderd worden.
    storageRemove: [] as { bucket: string; paths: string[]; naTabellen: number }[],
    deletes: [] as { table: string; eqs: Eq[] }[],
    inserts: [] as { table: string; payload: Record<string, unknown> }[],
    signIn: [] as { email: string; password: string }[],
    signUp: [] as { email: string; password: string }[],
    resetPassword: [] as { email: string; options?: { redirectTo?: string } }[],
    updateUser: [] as { password?: string }[],
    signOut: 0,
  }

  function chain(table: string) {
    const eqs: Eq[] = []
    const result = opts.tableError?.table === table
      ? { data: null, error: opts.tableError.error }
      : { data: null, error: null }
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    c.delete = () => { calls.deletes.push({ table, eqs }); return c }
    c.insert = (payload: Record<string, unknown>) => { calls.inserts.push({ table, payload }); return c }
    c.maybeSingle = () => Promise.resolve(result)
    c.single = () => Promise.resolve(result)
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
    return c
  }

  const supabase = {
    from: (t: string) => chain(t),
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
      signUp: async (creds: { email: string; password: string }) => {
        calls.signUp.push(creds)
        return opts.signUpResult ?? { data: { user: { id: 'new-team' }, session: { access_token: 'x' } }, error: null }
      },
      resetPasswordForEmail: async (email: string, options?: { redirectTo?: string }) => {
        calls.resetPassword.push({ email, options })
        return { error: null }
      },
      updateUser: async (attrs: { password?: string }) => {
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

  it('lekt de ruwe fout niet als het opslaan van de teamnaam faalt', async () => {
    use(makeSupabase({ tableError: { table: 'settings', error: { code: '23505', message: 'duplicate key value: JO13-1' } } }))

    await expect(signUp(null, form({
      email: 'bob@example.com', password: STRONG_PASSWORD, team_name: 'JO13-1',
    }))).rejects.toThrow('__redirect__:/')

    expect(loggedText()).toContain('auth.signUp.settings')
    expect(loggedText()).toContain('23505')
    expect(loggedText()).not.toContain('duplicate key value')
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

    expect(m.calls.deletes.map((d) => d.table)).toEqual([
      'oefeningen', 'metingen', 'attendance', 'lineups', 'events', 'players', 'settings',
    ])
    for (const del of m.calls.deletes) {
      expect(del.eqs).toEqual([{ col: 'team_id', val: 'team-1' }])
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

    expect(m.calls.deletes.map((d) => d.table)).toEqual([
      'oefeningen', 'metingen', 'attendance', 'lineups', 'events', 'players', 'settings',
    ])
    expect(deleteUser).toHaveBeenCalledWith('team-1')
    expect(m.calls.signOut).toBe(1)
    expect(loggedText()).toContain('auth.deleteAccount.storage')
    expect(loggedText()).not.toContain('Object not found')
  })

  it('raakt Storage niet aan zonder service-role-key', async () => {
    const m = makeSupabase()
    use(m)
    vi.mocked(createAdminClient).mockReturnValue(null)

    await expect(deleteAccount()).rejects.toThrow('Account verwijderen is nu niet mogelijk')
    expect(m.calls.storageRemove).toHaveLength(0)
  })
})
