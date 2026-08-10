import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildCsp } from '@/proxy'

// Regressietest bij de productiebug van 2026-08-09: het clublogo laadde nergens
// (zijbalk én wedstrijdselectie-PDF) omdat `img-src` het Supabase-origin niet
// bevatte. Het logo komt uit Supabase Storage en wordt met een gewone <img>
// geladen (components/TeamLogo.tsx), dus de browser blokkeerde het stil via CSP.
// De header werd nergens getest, waardoor dit onopgemerkt live ging.

const SUPABASE_URL = 'https://projectref.supabase.co'
const SUPABASE_ORIGIN = 'https://projectref.supabase.co'
const SUPABASE_WS = 'wss://projectref.supabase.co'

// Zo ziet de opgeslagen logo-URL er in productie uit: getPublicUrl() van de
// `team-logos`-bucket, met de cache-buster die app/actions/team-logo.ts toevoegt.
const LOGO_URL = `${SUPABASE_URL}/storage/v1/object/public/team-logos/team-1/logo?v=1754697600000`

afterEach(() => {
  vi.unstubAllEnvs()
})

function csp(nodeEnv = 'production'): Map<string, string[]> {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `${SUPABASE_URL}/`)
  vi.stubEnv('NODE_ENV', nodeEnv)
  const header = buildCsp('test-nonce')
  return new Map(
    header.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(' ')
      return [name, sources]
    })
  )
}

describe('buildCsp', () => {
  it('staat het Supabase-origin toe in img-src, zodat het clublogo uit Storage laadt', () => {
    expect(csp().get('img-src')).toContain(SUPABASE_ORIGIN)
  })

  it('dekt de echte publieke logo-URL met de img-src-bron', () => {
    expect(csp().get('img-src')).toContain(new URL(LOGO_URL).origin)
  })

  it('houdt de bestaande img-src-bronnen intact', () => {
    expect(csp().get('img-src')).toEqual(
      expect.arrayContaining([`'self'`, 'blob:', 'data:'])
    )
  })

  it('staat het Supabase-origin en de websocket toe in connect-src', () => {
    expect(csp().get('connect-src')).toEqual(
      expect.arrayContaining([`'self'`, SUPABASE_ORIGIN, SUPABASE_WS])
    )
  })

  it('laat het Supabase-origin niet uit default-src lekken: die blijft strikt op self', () => {
    expect(csp().get('default-src')).toEqual([`'self'`])
  })

  it('geldt ook in development, waar het logo van hetzelfde Storage-origin komt', () => {
    const dev = csp('development')
    expect(dev.get('img-src')).toContain(SUPABASE_ORIGIN)
    expect(dev.get('connect-src')).toContain(SUPABASE_ORIGIN)
  })

  it('houdt de nonce en de overige hardening-directives overeind', () => {
    expect(csp().get('script-src')).toContain(`'nonce-test-nonce'`)
    expect(csp().get('object-src')).toEqual([`'none'`])
    expect(csp().get('frame-ancestors')).toEqual([`'none'`])
    expect(csp().get('base-uri')).toEqual([`'self'`])
    expect(csp().get('form-action')).toEqual([`'self'`])
  })
})
