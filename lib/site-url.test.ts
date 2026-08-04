import { describe, it, expect, vi, afterEach } from 'vitest'
import { getSiteUrl } from '@/lib/site-url'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getSiteUrl', () => {
  it('gebruikt de geconfigureerde URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pitchup.example')
    expect(getSiteUrl()).toBe('https://pitchup.example')
  })

  it('strippt trailing slashes zodat er geen dubbele slash in de link komt', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pitchup.example/')
    expect(getSiteUrl()).toBe('https://pitchup.example')
  })

  it('houdt een subpad intact', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://voorbeeld.example/pitchup/')
    expect(getSiteUrl()).toBe('https://voorbeeld.example/pitchup')
  })

  it('weigert een waarde die geen http(s)-URL is', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'javascript:alert(1)')
    expect(getSiteUrl()).toBeNull()

    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'zomaar-tekst')
    expect(getSiteUrl()).toBeNull()
  })

  it('valt buiten productie terug op de lokale dev-server', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    vi.stubEnv('NODE_ENV', 'development')
    expect(getSiteUrl()).toBe('http://localhost:3000')
  })

  it('geeft null in productie zonder configuratie (nooit een header-fallback)', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(getSiteUrl()).toBeNull()
  })
})
