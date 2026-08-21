import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  PASSWORD_RESET_POLICY,
  SIGN_IN_IP_POLICY,
  SIGN_IN_POLICY,
  SIGN_UP_IP_POLICY,
  SIGN_UP_POLICY,
  checkRateLimit,
  clearRateLimit,
  clientIp,
  ipRateLimitKey,
  rateLimitKey,
  recordAttempt,
} from '@/lib/rate-limit'

// ────────────────────────────────────────────────
// In-memory namaak van rate_limit_record_attempt/_check/_clear
// (supabase/rate-limit.sql), zodat recordAttempt/checkRateLimit/clearRateLimit
// hier getest kunnen worden zonder een echte Postgres-verbinding. Spiegelt
// exact de semantiek van de SQL-functies — niet de oude in-memory Map die
// vóór deze migratie in lib/rate-limit.ts zelf stond.
// ────────────────────────────────────────────────

type FakeEntry = { count: number; windowStart: number; blockedUntil: number | null }

function makeFakeStore() {
  const entries = new Map<string, FakeEntry>()
  let now = 0

  function setNow(ms: number) { now = ms }

  function recordAttemptFake(key: string, windowMs: number, limit: number, blockMs: number) {
    const existing = entries.get(key) ?? null

    const stale = !existing
      || now - existing.windowStart >= windowMs
      || (existing.blockedUntil !== null && existing.blockedUntil <= now)

    if (!stale && existing!.blockedUntil !== null && existing!.blockedUntil > now) {
      return { blocked: true, retry_after_ms: existing!.blockedUntil - now }
    }

    const entry: FakeEntry = stale
      ? { count: 1, windowStart: now, blockedUntil: null }
      : { count: existing!.count + 1, windowStart: existing!.windowStart, blockedUntil: null }

    if (entry.count >= limit) entry.blockedUntil = now + blockMs
    entries.set(key, entry)

    return entry.blockedUntil !== null && entry.blockedUntil > now
      ? { blocked: true, retry_after_ms: entry.blockedUntil - now }
      : { blocked: false, retry_after_ms: 0 }
  }

  function checkFake(key: string) {
    const entry = entries.get(key)
    if (!entry || entry.blockedUntil === null || entry.blockedUntil <= now) {
      return { blocked: false, retry_after_ms: 0 }
    }
    return { blocked: true, retry_after_ms: entry.blockedUntil - now }
  }

  function clearFake(key: string) {
    entries.delete(key)
  }

  return { entries, setNow, recordAttemptFake, checkFake, clearFake }
}

function useFakeAdmin(store: ReturnType<typeof makeFakeStore>) {
  const admin = {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      let result: { blocked: boolean; retry_after_ms: number } | null = null
      if (fn === 'rate_limit_record_attempt') {
        result = store.recordAttemptFake(
          args!.p_key as string,
          args!.p_window_ms as number,
          args!.p_limit as number,
          args!.p_block_ms as number,
        )
      } else if (fn === 'rate_limit_check') {
        result = store.checkFake(args!.p_key as string)
      } else if (fn === 'rate_limit_clear') {
        store.clearFake(args!.p_key as string)
        result = null
      }
      const promise = Promise.resolve({ data: result, error: null })
      ;(promise as unknown as { single: () => Promise<unknown> }).single = () => promise
      return promise
    },
  }
  vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)
  return admin
}

let store: ReturnType<typeof makeFakeStore>

beforeEach(() => {
  store = makeFakeStore()
  useFakeAdmin(store)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const T0 = 1_700_000_000_000 // vaste UTC-ms, zodat de tests tijdzone-onafhankelijk zijn

describe('rateLimitKey', () => {
  it('normaliseert het e-mailadres zodat hoofdletters de teller niet omzeilen', () => {
    expect(rateLimitKey('signin', ' Bob@Example.com ', '1.2.3.4'))
      .toBe(rateLimitKey('signin', 'bob@example.com', '1.2.3.4'))
  })

  it('scheidt tellers per actie en per IP', () => {
    const a = rateLimitKey('signin', 'bob@example.com', '1.2.3.4')
    expect(rateLimitKey('password-reset', 'bob@example.com', '1.2.3.4')).not.toBe(a)
    expect(rateLimitKey('signin', 'bob@example.com', '5.6.7.8')).not.toBe(a)
  })
})

describe('ipRateLimitKey', () => {
  it('telt per actie + IP, ongeacht het e-mailadres', () => {
    expect(ipRateLimitKey('signin', '1.2.3.4')).toBe(ipRateLimitKey('signin', '1.2.3.4'))
    expect(ipRateLimitKey('signin', '5.6.7.8')).not.toBe(ipRateLimitKey('signin', '1.2.3.4'))
    expect(ipRateLimitKey('signup', '1.2.3.4')).not.toBe(ipRateLimitKey('signin', '1.2.3.4'))
  })

  it('botst nooit met een e-mail+IP-sleutel, ook niet bij een geknutseld e-mailveld', () => {
    // Het e-mailveld wordt ge-encodeerd, dus geen enkel ingevuld "adres" kan de
    // IP-sleutel nabootsen.
    const ipKey = ipRateLimitKey('signin', '1.2.3.4')
    expect(ipKey).not.toBe(rateLimitKey('signin', '%', '1.2.3.4'))
    expect(ipKey).not.toBe(rateLimitKey('signin', '%25', '1.2.3.4'))
    expect(ipKey).not.toBe(rateLimitKey('signin', '', '1.2.3.4'))
    expect(rateLimitKey('signin', 'bob:x@example.com', '1.2.3.4'))
      .not.toBe(rateLimitKey('signin', 'bob', 'x@example.com:1.2.3.4'))
  })

  it('houdt de IP-teller los van de e-mail+IP-teller', async () => {
    store.setNow(T0)
    const emailKey = rateLimitKey('signin', 'bob@example.com', '1.2.3.4')
    const ipKey = ipRateLimitKey('signin', '1.2.3.4')

    for (let i = 0; i < SIGN_IN_POLICY.limit; i++) await recordAttempt(emailKey, SIGN_IN_POLICY)

    expect((await checkRateLimit(emailKey)).blocked).toBe(true)
    expect((await checkRateLimit(ipKey)).blocked).toBe(false)
  })
})

describe('policies', () => {
  it('geeft de IP-teller voor inloggen een ruimere limiet dan de e-mail+IP-teller', () => {
    expect(SIGN_IN_IP_POLICY.limit).toBeGreaterThan(SIGN_IN_POLICY.limit)
    expect(SIGN_IN_IP_POLICY.limit).toBeGreaterThanOrEqual(20)
    expect(SIGN_IN_IP_POLICY.limit).toBeLessThanOrEqual(30)
  })

  it('kent ook registreren een limiet toe', () => {
    expect(SIGN_UP_POLICY.limit).toBeGreaterThan(0)
    expect(SIGN_UP_IP_POLICY.limit).toBeGreaterThanOrEqual(SIGN_UP_POLICY.limit)
  })
})

describe('recordAttempt / checkRateLimit', () => {
  const key = 'signin:bob@example.com:1.2.3.4'

  it('gaat op slot bij de `limit`-ste poging binnen het venster', async () => {
    store.setNow(T0)
    for (let i = 0; i < SIGN_IN_POLICY.limit - 1; i++) {
      expect((await recordAttempt(key, SIGN_IN_POLICY)).blocked).toBe(false)
      expect((await checkRateLimit(key)).blocked).toBe(false)
    }

    const laatste = await recordAttempt(key, SIGN_IN_POLICY)
    expect(laatste.blocked).toBe(true)
    expect(laatste.retryAfterMs).toBe(SIGN_IN_POLICY.blockMs)
    expect((await checkRateLimit(key)).blocked).toBe(true)
  })

  it('houdt de blokkade vast tot de lockout voorbij is', async () => {
    store.setNow(T0)
    for (let i = 0; i < SIGN_IN_POLICY.limit; i++) await recordAttempt(key, SIGN_IN_POLICY)

    store.setNow(T0 + 60_000)
    expect((await checkRateLimit(key)).blocked).toBe(true)
    expect((await checkRateLimit(key)).retryAfterMs).toBe(SIGN_IN_POLICY.blockMs - 60_000)

    store.setNow(T0 + SIGN_IN_POLICY.blockMs)
    expect((await checkRateLimit(key)).blocked).toBe(false)
  })

  it('begint na een uitgezeten blokkade met een schone teller', async () => {
    store.setNow(T0)
    for (let i = 0; i < SIGN_IN_POLICY.limit; i++) await recordAttempt(key, SIGN_IN_POLICY)

    store.setNow(T0 + SIGN_IN_POLICY.blockMs + 1)
    expect((await recordAttempt(key, SIGN_IN_POLICY)).blocked).toBe(false)
    expect((await checkRateLimit(key)).blocked).toBe(false)
  })

  it('vergeet pogingen die buiten het venster vallen', async () => {
    store.setNow(T0)
    for (let i = 0; i < SIGN_IN_POLICY.limit - 1; i++) await recordAttempt(key, SIGN_IN_POLICY)

    store.setNow(T0 + SIGN_IN_POLICY.windowMs)
    expect((await recordAttempt(key, SIGN_IN_POLICY)).blocked).toBe(false)
    expect((await checkRateLimit(key)).blocked).toBe(false)
  })

  it('telt per sleutel, niet globaal', async () => {
    store.setNow(T0)
    const other = 'signin:eve@example.com:1.2.3.4'
    for (let i = 0; i < SIGN_IN_POLICY.limit; i++) await recordAttempt(key, SIGN_IN_POLICY)

    expect((await checkRateLimit(key)).blocked).toBe(true)
    expect((await checkRateLimit(other)).blocked).toBe(false)
  })

  it('kent een strengere policy voor wachtwoord-herstel', async () => {
    store.setNow(T0)
    const resetKey = 'password-reset:bob@example.com:1.2.3.4'
    for (let i = 0; i < PASSWORD_RESET_POLICY.limit - 1; i++) {
      expect((await recordAttempt(resetKey, PASSWORD_RESET_POLICY)).blocked).toBe(false)
    }
    expect((await recordAttempt(resetKey, PASSWORD_RESET_POLICY)).blocked).toBe(true)
    expect(PASSWORD_RESET_POLICY.limit).toBeLessThan(SIGN_IN_POLICY.limit)
  })

  it('geeft geen status voor een onbekende sleutel', async () => {
    store.setNow(T0)
    expect(await checkRateLimit('nooit-gebruikt')).toEqual({ blocked: false, retryAfterMs: 0 })
  })
})

describe('checkRateLimit / recordAttempt zonder service-role-key', () => {
  it('faalt open (blocked=false) in plaats van te crashen of alles te blokkeren', async () => {
    vi.mocked(createAdminClient).mockReturnValue(null)
    expect(await checkRateLimit('signin:bob@example.com:1.2.3.4')).toEqual({ blocked: false, retryAfterMs: 0 })
    expect(await recordAttempt('signin:bob@example.com:1.2.3.4', SIGN_IN_POLICY))
      .toEqual({ blocked: false, retryAfterMs: 0 })
  })
})

describe('clearRateLimit', () => {
  it('wist de teller (bijv. na een geslaagde inlog)', async () => {
    store.setNow(T0)
    const key = 'signin:bob@example.com:1.2.3.4'
    for (let i = 0; i < SIGN_IN_POLICY.limit; i++) await recordAttempt(key, SIGN_IN_POLICY)
    expect((await checkRateLimit(key)).blocked).toBe(true)

    await clearRateLimit(key)

    expect((await checkRateLimit(key)).blocked).toBe(false)
    for (let i = 0; i < SIGN_IN_POLICY.limit - 1; i++) {
      expect((await recordAttempt(key, SIGN_IN_POLICY)).blocked).toBe(false)
    }
  })
})

describe('clientIp (buiten Vercel)', () => {
  it('neemt het eerste adres uit x-forwarded-for', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4')
  })

  it('valt terug op x-real-ip', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9')
  })

  it('accepteert IPv6 en normaliseert naar kleine letters', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '2001:DB8::1' }))).toBe('2001:db8::1')
  })

  it('weigert vrije tekst en te lange waarden', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': 'niet-een-ip' }))).toBe('onbekend')
    expect(clientIp(new Headers({ 'x-forwarded-for': '1'.repeat(60) }))).toBe('onbekend')
  })

  it('geeft "onbekend" zonder proxy-headers', () => {
    expect(clientIp(new Headers())).toBe('onbekend')
  })

  it('geeft de platform-header voorrang boven x-forwarded-for', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '203.0.113.7',
      'x-forwarded-for': '1.2.3.4',
      'x-real-ip': '5.6.7.8',
    })
    expect(clientIp(headers)).toBe('203.0.113.7')
  })
})

describe('clientIp (op Vercel)', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL', '1')
  })

  it('gebruikt alleen de door het platform gezette header', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '203.0.113.7',
      'x-forwarded-for': '1.2.3.4',
    })
    expect(clientIp(headers)).toBe('203.0.113.7')
  })

  it('negeert een zelf-gestuurde x-forwarded-for, zodat de sleutel niet te sturen is', () => {
    // De aanvaller varieert x-forwarded-for om telkens een nieuwe teller te
    // krijgen; het echte adres in x-vercel-forwarded-for blijft leidend.
    const eerste = clientIp(new Headers({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }))
    const tweede = clientIp(new Headers({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '2.2.2.2' }))
    const derde = clientIp(new Headers({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-real-ip': '3.3.3.3' }))

    expect(eerste).toBe('203.0.113.7')
    expect(tweede).toBe('203.0.113.7')
    expect(derde).toBe('203.0.113.7')
  })

  it('valt bij een ontbrekende platform-header terug op "onbekend", niet op een spoofbare header', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4' }))).toBe('onbekend')
    expect(clientIp(new Headers({ 'x-real-ip': '1.2.3.4' }))).toBe('onbekend')
    expect(clientIp(new Headers())).toBe('onbekend')
  })

  it('weigert ook hier vrije tekst in de platform-header', () => {
    expect(clientIp(new Headers({ 'x-vercel-forwarded-for': 'drop table users' }))).toBe('onbekend')
  })
})
