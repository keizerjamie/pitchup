// Regressietest op de CSP-nonce van het theme-script in de root layout.
//
// Waarom dit een eigen test verdient: het script zelf blijft gewoon in de HTML
// staan als de nonce ontbreekt — de browser voert hem alleen niet uit. Er is
// dus geen crash, geen foutmelding in de app, alleen een violation in de
// console en een themaflits bij het laden. Precies het soort stille regressie
// dat maanden onopgemerkt blijft.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// next/font/google draait in Next op buildtijd; onder vitest zou de echte
// module naar buiten willen. Vervangen door de vorm die layout.tsx gebruikt
// (alleen `variable`).
vi.mock('next/font/google', () => ({
  Space_Grotesk: () => ({ variable: 'font-display-var' }),
  Manrope: () => ({ variable: 'font-body-var' }),
  Archivo_Black: () => ({ variable: 'font-pdf-var' }),
}))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ getDict: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// De chrome-componenten zijn hier niet het onderwerp; ze houden de test klein
// en onafhankelijk van hun eigen hooks/context.
vi.mock('@/components/AppShell', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/ThemeInit', () => ({ default: () => null }))
vi.mock('@/components/InactivityLogout', () => ({ default: () => null }))
vi.mock('@/lib/i18n-context', () => ({ DictProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

import { headers } from 'next/headers'
import { getDict } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'
import { nl } from '@/messages/nl'
import RootLayout from '@/app/layout'

function supabaseMock() {
  return {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [] }) }) }) }),
  }
}

// Geeft de headers-mock een Headers-achtige terug met (of zonder) x-nonce.
function metNonce(nonce: string | null) {
  vi.mocked(headers).mockResolvedValue({
    get: (naam: string) => (naam === 'x-nonce' ? nonce : null),
  } as unknown as Awaited<ReturnType<typeof headers>>)
}

async function renderLayout(): Promise<string> {
  const el = await RootLayout({ children: null })
  return renderToStaticMarkup(el)
}

// Het inline theme-script is te herkennen aan zijn eigen inhoud (het zet
// data-theme vóór de eerste paint) — niet aan zijn positie, zodat deze test
// niet breekt als er ooit een ander script bij komt.
function themeScriptTag(html: string): string | null {
  const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) ?? []
  return scripts.find((s) => s.includes('data-theme')) ?? null
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getDict).mockResolvedValue(nl)
  vi.mocked(createClient).mockResolvedValue(supabaseMock() as unknown as Awaited<ReturnType<typeof createClient>>)
})

describe('root layout — CSP-nonce op het theme-script', () => {
  it('zet de nonce uit de x-nonce-header op het inline theme-script', async () => {
    metNonce('nonce-uit-de-proxy')
    const script = themeScriptTag(await renderLayout())
    expect(script).not.toBeNull()
    expect(script).toContain('nonce="nonce-uit-de-proxy"')
  })

  it('het script staat er nog steeds en zet nog steeds data-theme vóór de eerste paint', async () => {
    metNonce('n1')
    const script = themeScriptTag(await renderLayout())
    expect(script).toContain('data-theme')
    expect(script).toContain('prefers-color-scheme')
    expect(script).toContain('localStorage')
  })

  it('zonder x-nonce-header komt er GEEN leeg nonce-attribuut in de HTML', async () => {
    // Een pad buiten de proxy-matcher krijgt ook geen CSP mee; een leeg
    // nonce="" zou daar juist een mismatch zijn.
    metNonce(null)
    const script = themeScriptTag(await renderLayout())
    expect(script).not.toBeNull()
    expect(script).not.toContain('nonce=')
  })

  it('leest de nonce uit x-nonce en niet uit een andere header', async () => {
    const get = vi.fn((naam: string) => (naam === 'x-nonce' ? 'abc' : 'FOUT'))
    vi.mocked(headers).mockResolvedValue({ get } as unknown as Awaited<ReturnType<typeof headers>>)
    const html = await renderLayout()
    expect(get).toHaveBeenCalledWith('x-nonce')
    expect(themeScriptTag(html)).toContain('nonce="abc"')
  })
})
