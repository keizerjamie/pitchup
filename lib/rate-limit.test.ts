import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  resetRateLimits,
} from '@/lib/rate-limit'

beforeEach(() => {
  resetRateLimits()
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

  it('houdt de IP-teller los van de e-mail+IP-teller', () => {
    const emailKey = rateLimitKey('signin', 'bob@example.com', '1.2.3.4')
    const ipKey = ipRateLimitKey('signin', '1.2.3.4')

    for (let i = 0; i < SIGN_IN_POLICY.limit; i++) recordAttempt(emailKey, SIGN_IN_POLICY, T0)

    expect(checkRateLimit(emailKey, T0).blocked).toBe(true)
    expect(checkRateLimit(ipKey, T0).blocked).toBe(false)
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

  it('gaat op slot bij de `limit`-ste poging binnen het venster', () => {
    for (let i = 0; i < SIGN_IN_POLICY.limit - 1; i++) {
      expect(recordAttempt(key, SIGN_IN_POLICY, T0).blocked).toBe(false)
      expect(checkRateLimit(key, T0).blocked).toBe(false)
    }

    const laatste = recordAttempt(key, SIGN_IN_POLICY, T0)
    expect(laatste.blocked).toBe(true)
    expect(laatste.retryAfterMs).toBe(SIGN_IN_POLICY.blockMs)
    expect(checkRateLimit(key, T0).blocked).toBe(true)
  })

  it('houdt de blokkade vast tot de lockout voorbij is', () => {
    for (let i = 0; i < SIGN_IN_POLICY.limit; i++) recordAttempt(key, SIGN_IN_POLICY, T0)

    expect(checkRateLimit(key, T0 + 60_000).blocked).toBe(true)
    expect(checkRateLimit(key, T0 + 60_000).retryAfterMs).toBe(SIGN_IN_POLICY.blockMs - 60_000)
    expect(checkRateLimit(key, T0 + SIGN_IN_POLICY.blockMs).blocked).toBe(false)
  })

  it('begint na een uitgezeten blokkade met een schone teller', () => {
    for (let i = 0; i < SIGN_IN_POLICY.limit; i++) recordAttempt(key, SIGN_IN_POLICY, T0)

    const after = T0 + SIGN_IN_POLICY.blockMs + 1
    expect(recordAttempt(key, SIGN_IN_POLICY, after).blocked).toBe(false)
    expect(checkRateLimit(key, after).blocked).toBe(false)
  })

  it('vergeet pogingen die buiten het venster vallen', () => {
    for (let i = 0; i < SIGN_IN_POLICY.limit - 1; i++) recordAttempt(key, SIGN_IN_POLICY, T0)

    const later = T0 + SIGN_IN_POLICY.windowMs
    expect(recordAttempt(key, SIGN_IN_POLICY, later).blocked).toBe(false)
    expect(checkRateLimit(key, later).blocked).toBe(false)
  })

  it('telt per sleutel, niet globaal', () => {
    const other = 'signin:eve@example.com:1.2.3.4'
    for (let i = 0; i < SIGN_IN_POLICY.limit; i++) recordAttempt(key, SIGN_IN_POLICY, T0)

    expect(checkRateLimit(key, T0).blocked).toBe(true)
    expect(checkRateLimit(other, T0).blocked).toBe(false)
  })

  it('kent een strengere policy voor wachtwoord-herstel', () => {
    const resetKey = 'password-reset:bob@example.com:1.2.3.4'
    for (let i = 0; i < PASSWORD_RESET_POLICY.limit - 1; i++) {
      expect(recordAttempt(resetKey, PASSWORD_RESET_POLICY, T0).blocked).toBe(false)
    }
    expect(recordAttempt(resetKey, PASSWORD_RESET_POLICY, T0).blocked).toBe(true)
    expect(PASSWORD_RESET_POLICY.limit).toBeLessThan(SIGN_IN_POLICY.limit)
  })

  it('geeft geen status voor een onbekende sleutel', () => {
    expect(checkRateLimit('nooit-gebruikt', T0)).toEqual({ blocked: false, retryAfterMs: 0 })
  })
})

describe('clearRateLimit', () => {
  it('wist de teller (bijv. na een geslaagde inlog)', () => {
    const key = 'signin:bob@example.com:1.2.3.4'
    for (let i = 0; i < SIGN_IN_POLICY.limit; i++) recordAttempt(key, SIGN_IN_POLICY, T0)
    expect(checkRateLimit(key, T0).blocked).toBe(true)

    clearRateLimit(key)

    expect(checkRateLimit(key, T0).blocked).toBe(false)
    for (let i = 0; i < SIGN_IN_POLICY.limit - 1; i++) {
      expect(recordAttempt(key, SIGN_IN_POLICY, T0).blocked).toBe(false)
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
