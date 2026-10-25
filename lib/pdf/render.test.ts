// @vitest-environment node
//
// isToegestaneUrl is puur. renderPdf draait hier tegen een gemockte
// playwright-core: de echte Chromium-render is lokaal met de hand gecontroleerd
// (zie de overdracht van de backend-engineer), hier gaat het om de beslislogica
// (status/pad → uitkomst), de cookie- en netwerkwaarborgen en het opruimen.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const launch = vi.fn()
vi.mock('playwright-core', () => ({ chromium: { launch: (...args: unknown[]) => launch(...args) } }))

const sparticuz = {
  args: ['--sparticuz-arg'],
  executablePath: vi.fn(async () => '/tmp/chromium'),
  setGraphicsMode: true as boolean,
}
vi.mock('@sparticuz/chromium', () => ({ default: sparticuz }))

import { isToegestaneUrl, PdfRenderFout, renderPdf, type RenderInvoer } from '@/lib/pdf/render'

const SITE = 'https://pitchup.example'
const SUPABASE = 'https://projectref.supabase.co'

describe('isToegestaneUrl', () => {
  const toegestaan = [SITE, SUPABASE]

  it.each([
    `${SITE}/events/x/training-plan`,
    `${SITE}/_next/static/chunks/app.js`,
    `${SITE}/fonts/inter.woff2`,
    `${SUPABASE}/storage/v1/object/public/team-logos/t/logo?v=1`,
  ])('toegestaan: %s', (url) => {
    expect(isToegestaneUrl(url, toegestaan)).toBe(true)
  })

  it.each([
    'https://evil.example/x',
    'https://pitchup.example.evil.example/x',
    'https://pitchup.example:8443/x',
    'http://pitchup.example/x',
    'https://other.supabase.co/storage/x',
    'file:///etc/passwd',
    'data:text/html,<p>x</p>',
    'about:blank',
    'geen url',
  ])('geweigerd: %s', (url) => {
    expect(isToegestaneUrl(url, toegestaan)).toBe(false)
  })
})

// ── renderPdf met nep-browser ──────────────────────────────────────────────

type NepPagina = ReturnType<typeof maakPagina>

function maakPagina(opties: { status?: number | null; eindUrl?: string; markers?: { nietGevonden: boolean; redirect: boolean } }) {
  let huidigeUrl = 'about:blank'
  return {
    goto: vi.fn(async (url: string) => {
      huidigeUrl = opties.eindUrl ?? url
      return opties.status === null ? null : { status: () => opties.status ?? 200 }
    }),
    url: () => huidigeUrl,
    evaluate: vi
      .fn()
      .mockResolvedValueOnce(opties.markers ?? { nietGevonden: false, redirect: false })
      .mockResolvedValue(undefined),
    waitForFunction: vi.fn(async () => undefined),
    emulateMedia: vi.fn(async () => undefined),
    pdf: vi.fn(async () => Buffer.from('%PDF-1.7')),
  }
}

let pagina: NepPagina
let context: {
  addCookies: ReturnType<typeof vi.fn>
  route: ReturnType<typeof vi.fn>
  newPage: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}
let browser: { newContext: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }

function zetBrowser(p: NepPagina) {
  pagina = p
  context = {
    addCookies: vi.fn(async () => undefined),
    route: vi.fn(async () => undefined),
    newPage: vi.fn(async () => pagina),
    close: vi.fn(async () => undefined),
  }
  browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined) }
  launch.mockResolvedValue(browser)
}

const INVOER: RenderInvoer = {
  siteUrl: SITE,
  pad: '/events/22222222-2222-4222-8222-222222222222/training-plan',
  cookies: [
    { name: 'sb-ref-auth-token', value: 'tok' },
    { name: 'locale', value: 'en' },
  ],
  locale: 'en-GB',
  timezoneId: 'Europe/London',
  supabaseOrigin: SUPABASE,
}

beforeEach(() => {
  vi.clearAllMocks()
  sparticuz.setGraphicsMode = true
  zetBrowser(maakPagina({}))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('renderPdf', () => {
  it('opent de doel-URL en levert de PDF', async () => {
    const uitkomst = await renderPdf(INVOER)

    expect(uitkomst).toEqual({ soort: 'pdf', pdf: Buffer.from('%PDF-1.7') })
    expect(pagina.goto).toHaveBeenCalledWith(`${SITE}${INVOER.pad}`, expect.objectContaining({ waitUntil: 'load' }))
    expect(pagina.emulateMedia).toHaveBeenCalledWith({ media: 'print' })
    expect(pagina.pdf).toHaveBeenCalledWith({ format: 'A4', printBackground: true, preferCSSPageSize: true })
  })

  it('context: print-breedte, licht thema, locale, tijdzone, geen service workers', async () => {
    await renderPdf(INVOER)

    expect(browser.newContext).toHaveBeenCalledWith({
      viewport: { width: 703, height: 1000 },
      colorScheme: 'light',
      locale: 'en-GB',
      timezoneId: 'Europe/London',
      serviceWorkers: 'block',
    })
  })

  it('cookies alleen voor de eigen origin, host-only, httpOnly, secure bij https', async () => {
    await renderPdf(INVOER)

    expect(context.addCookies).toHaveBeenCalledWith([
      { name: 'sb-ref-auth-token', value: 'tok', url: `${SITE}/`, httpOnly: true, secure: true, sameSite: 'Lax' },
      { name: 'locale', value: 'en', url: `${SITE}/`, httpOnly: true, secure: true, sameSite: 'Lax' },
    ])
  })

  it('netwerk-allowlist: eigen origin en Supabase door, de rest afgebroken', async () => {
    await renderPdf(INVOER)

    expect(context.route).toHaveBeenCalledWith('**/*', expect.any(Function))
    const handler = context.route.mock.calls[0][1] as (route: unknown) => unknown
    const nepRoute = (url: string) => ({ request: () => ({ url: () => url }), continue: vi.fn(), abort: vi.fn() })

    const eigen = nepRoute(`${SITE}/_next/static/x.js`)
    const logo = nepRoute(`${SUPABASE}/storage/v1/object/public/team-logos/x`)
    const extern = nepRoute('https://tracker.example/pixel')
    handler(eigen)
    handler(logo)
    handler(extern)

    expect(eigen.continue).toHaveBeenCalled()
    expect(logo.continue).toHaveBeenCalled()
    expect(extern.abort).toHaveBeenCalled()
    expect(extern.continue).not.toHaveBeenCalled()
  })

  it('zonder Supabase-origin: alleen de eigen origin', async () => {
    await renderPdf({ ...INVOER, supabaseOrigin: null })

    const handler = context.route.mock.calls[0][1] as (route: unknown) => unknown
    const logo = { request: () => ({ url: () => `${SUPABASE}/x` }), continue: vi.fn(), abort: vi.fn() }
    handler(logo)
    expect(logo.abort).toHaveBeenCalled()
  })

  it('subpad in siteUrl blijft behouden', async () => {
    await renderPdf({ ...INVOER, siteUrl: `${SITE}/app` })

    expect(pagina.goto).toHaveBeenCalledWith(`${SITE}/app${INVOER.pad}`, expect.anything())
  })

  it('wacht op gestreamde Suspense-grenzen, lettertypen en afbeeldingen vóór de PDF', async () => {
    await renderPdf(INVOER)

    // 1× stream-markers, 1× afbeeldingen.
    expect(pagina.waitForFunction).toHaveBeenCalledTimes(2)
    // 1× foutmarkers, 1× fonts.ready.
    expect(pagina.evaluate).toHaveBeenCalledTimes(2)
    expect(pagina.waitForFunction.mock.invocationCallOrder[0]).toBeLessThan(pagina.pdf.mock.invocationCallOrder[0])
  })

  it('een trage afbeelding houdt de PDF niet tegen', async () => {
    pagina.waitForFunction.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Timeout'))

    expect((await renderPdf(INVOER)).soort).toBe('pdf')
  })

  it('HTTP 404: niet_gevonden, geen PDF', async () => {
    zetBrowser(maakPagina({ status: 404 }))

    expect(await renderPdf(INVOER)).toEqual({ soort: 'niet_gevonden' })
    expect(pagina.pdf).not.toHaveBeenCalled()
  })

  it('gestreamde notFound() (200 + robots-noindex-marker): niet_gevonden', async () => {
    zetBrowser(maakPagina({ markers: { nietGevonden: true, redirect: false } }))

    expect(await renderPdf(INVOER)).toEqual({ soort: 'niet_gevonden' })
    expect(pagina.pdf).not.toHaveBeenCalled()
  })

  it('doorverwezen naar /login: niet_ingelogd', async () => {
    zetBrowser(maakPagina({ eindUrl: `${SITE}/login` }))

    expect(await renderPdf(INVOER)).toEqual({ soort: 'niet_ingelogd' })
    expect(pagina.pdf).not.toHaveBeenCalled()
  })

  it('gestreamde redirect (meta-refresh-marker): niet_ingelogd', async () => {
    zetBrowser(maakPagina({ markers: { nietGevonden: false, redirect: true } }))

    expect(await renderPdf(INVOER)).toEqual({ soort: 'niet_ingelogd' })
  })

  it.each([500, 302, null])('status %s: status', async (status) => {
    zetBrowser(maakPagina({ status }))

    expect(await renderPdf(INVOER)).toEqual({ soort: 'status' })
  })

  it('sluit context en browser altijd, ook na een fout', async () => {
    pagina.pdf.mockRejectedValue(new Error(`Target closed ${SITE}`))

    const fout = await renderPdf(INVOER).catch((e: unknown) => e)

    expect(fout).toBeInstanceOf(PdfRenderFout)
    expect((fout as PdfRenderFout).stap).toBe('pdf')
    // Geen URL of ruwe melding in de fout die naar buiten gaat.
    expect((fout as Error).message).not.toContain(SITE)
    expect(context.close).toHaveBeenCalled()
    expect(browser.close).toHaveBeenCalled()
  })

  it('navigatie-timeout: PdfRenderFout(navigatie), wel opgeruimd', async () => {
    pagina.goto.mockRejectedValue(new Error('Timeout 25000ms exceeded'))

    await expect(renderPdf(INVOER)).rejects.toMatchObject({ stap: 'navigatie' })
    expect(browser.close).toHaveBeenCalled()
  })

  it('launch faalt: PdfRenderFout(launch)', async () => {
    launch.mockRejectedValue(new Error('no executable'))

    await expect(renderPdf(INVOER)).rejects.toMatchObject({ stap: 'launch' })
  })

  it('lokaal: Playwright-browsers, geen @sparticuz/chromium', async () => {
    vi.stubEnv('VERCEL', '')

    await renderPdf(INVOER)

    expect(launch).toHaveBeenCalledWith(expect.not.objectContaining({ executablePath: expect.anything() }))
    expect(sparticuz.executablePath).not.toHaveBeenCalled()
  })

  it('op Vercel: @sparticuz/chromium-binary en -args, zonder WebGL', async () => {
    vi.stubEnv('VERCEL', '1')

    await renderPdf(INVOER)

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: '/tmp/chromium', args: ['--sparticuz-arg'], headless: true }),
    )
    expect(sparticuz.setGraphicsMode).toBe(false)
  })

  it('ongeldige siteUrl: faalt vóór de launch', async () => {
    await expect(renderPdf({ ...INVOER, siteUrl: 'geen-url' })).rejects.toBeInstanceOf(PdfRenderFout)
    expect(launch).not.toHaveBeenCalled()
  })
})
