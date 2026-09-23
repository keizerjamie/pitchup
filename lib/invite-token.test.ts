// Unit-tests voor lib/invite-token.ts — de tokenlaag van de uitnodigingsflow.
//
// Wat hier bewezen moet worden: het token is URL-veilig, uniek en lang genoeg,
// de hash is de vorm waar de database op controleert, en de `next`-parameter
// van /login kan nooit naar een vreemde host wijzen.

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  INVITE_TOKEN_BYTES,
  INVITE_TOKEN_PATTERN,
  generateInviteToken,
  hashInviteToken,
  isInviteToken,
  veiligeNextPath,
} from '@/lib/invite-token'

describe('generateInviteToken', () => {
  it('levert 32 bytes entropie op, base64url-gecodeerd', () => {
    expect(INVITE_TOKEN_BYTES).toBe(32)
    // 32 bytes base64url zonder padding = 43 tekens.
    expect(generateInviteToken()).toHaveLength(43)
  })

  it('gebruikt uitsluitend URL-veilige tekens — het token staat in een pad en moet kopiëren en plakken overleven', () => {
    for (let i = 0; i < 50; i++) {
      const token = generateInviteToken()
      expect(token, token).toMatch(/^[A-Za-z0-9_-]+$/)
      // Geen padding, geen '+' of '/': die zouden ge-encodeerd moeten worden
      // en dan komt er een ander token bij de server aan.
      expect(token).not.toContain('=')
      expect(token).not.toContain('+')
      expect(token).not.toContain('/')
    }
  })

  it('geeft bij elke aanroep een ander token', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateInviteToken()))
    expect(tokens.size).toBe(200)
  })

  it('past op zijn eigen vormcheck', () => {
    expect(isInviteToken(generateInviteToken())).toBe(true)
  })
})

describe('hashInviteToken', () => {
  it('geeft 64 kleine hex-tekens — exact de vorm waar create_team_invite op controleert', () => {
    expect(hashInviteToken(generateInviteToken())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is sha256 van het ruwe token', () => {
    const token = 'een-token'
    expect(hashInviteToken(token)).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
  })

  it('is deterministisch: hetzelfde token geeft dezelfde hash', () => {
    const token = generateInviteToken()
    expect(hashInviteToken(token)).toBe(hashInviteToken(token))
  })

  it('geeft een andere hash bij een token dat één teken verschilt', () => {
    expect(hashInviteToken('aaaaaaaaaaaaaaaa')).not.toBe(hashInviteToken('aaaaaaaaaaaaaaab'))
  })

  it('bevat het ruwe token niet — dat is de hele reden dat er gehasht wordt', () => {
    const token = generateInviteToken()
    expect(hashInviteToken(token)).not.toContain(token)
  })
})

describe('isInviteToken', () => {
  it('accepteert een echt token', () => {
    expect(isInviteToken(generateInviteToken())).toBe(true)
  })

  it('weigert alles wat geen string is', () => {
    for (const waarde of [null, undefined, 42, {}, [], true]) {
      expect(isInviteToken(waarde), String(waarde)).toBe(false)
    }
  })

  it('weigert te kort en te lang', () => {
    expect(isInviteToken('a'.repeat(15))).toBe(false)
    expect(isInviteToken('a'.repeat(16))).toBe(true)
    expect(isInviteToken('a'.repeat(128))).toBe(true)
    expect(isInviteToken('a'.repeat(129))).toBe(false)
  })

  it('weigert padscheidingen, spaties en query-tekens — zo belandt er geen vrije tekst in een query of logregel', () => {
    for (const waarde of [
      '../../etc/passwd',
      'aaaaaaaaaaaaaaaa/..',
      'aaaaaaaaaaaaaaaa?x=1',
      'aaaaaaaaaaaa aaaa',
      'aaaaaaaaaaaaaaaa%2F',
      "aaaaaaaaaaaaaaaa'--",
      'aaaaaaaaaaaaaaaa\n',
    ]) {
      expect(isInviteToken(waarde), waarde).toBe(false)
    }
  })

  it('gebruikt dezelfde regel als INVITE_TOKEN_PATTERN', () => {
    const token = generateInviteToken()
    expect(INVITE_TOKEN_PATTERN.test(token)).toBe(isInviteToken(token))
  })
})

describe('veiligeNextPath', () => {
  it('laat een eigen uitnodigingspad door', () => {
    const token = generateInviteToken()
    expect(veiligeNextPath(`/invite/${token}`)).toBe(`/invite/${token}`)
  })

  // Zonder deze grens is ?next= een open redirect: na een geslaagde inlog zou
  // de gebruiker op een vreemde host belanden die er hetzelfde uitziet.
  it('weigert elke absolute URL en valt terug op /', () => {
    for (const waarde of [
      'https://kwaadaardig.example',
      'http://kwaadaardig.example/invite/aaaaaaaaaaaaaaaa',
      '//kwaadaardig.example',
      '//kwaadaardig.example/invite/aaaaaaaaaaaaaaaa',
      'javascript:alert(1)',
      '/\\kwaadaardig.example',
    ]) {
      expect(veiligeNextPath(waarde), waarde).toBe('/')
    }
  })

  it('weigert elk ander intern pad — alleen de uitnodigingsflow heeft dit nodig', () => {
    for (const waarde of ['/', '/settings', '/players', '/invite', '/invite/', '/inviteX/aaaaaaaaaaaaaaaa']) {
      expect(veiligeNextPath(waarde), waarde).toBe('/')
    }
  })

  it('weigert een uitnodigingspad met iets erachter', () => {
    const token = generateInviteToken()
    for (const waarde of [
      `/invite/${token}/register`,
      `/invite/${token}?x=1`,
      `/invite/${token}#x`,
      `/invite/${token}/../../settings`,
    ]) {
      expect(veiligeNextPath(waarde), waarde).toBe('/')
    }
  })

  it('weigert alles wat geen string is', () => {
    for (const waarde of [null, undefined, 42, {}, []]) {
      expect(veiligeNextPath(waarde), String(waarde)).toBe('/')
    }
  })
})
