// @vitest-environment node
//
// Acceptatietests — "Delen als PDF", server-kant. Aanvulling op
// delen-als-pdf.acceptance.test.tsx (die draait in jsdom; deze in node omdat
// de route Request/Response gebruikt).
//
// Anders dan app/api/pdf/route.test.ts is hier renderPdf NIET gemockt: de
// echte route draait samen met de echte renderPdf, parsePdfParams,
// bouwDoelPad, sessie- en slotlogica. Gemockt zijn alleen de buitenste
// randen: de sessie/DB (team-context, authz, supabase), Next-cookies en de
// browser zelf (playwright-core). Een echte Chromium-render is niet mogelijk
// zonder ingelogde sessie en echte data (zie rapport: AC3-inhoud, AC2).
//
//   AC3  -> 'AC3'   print-weergave van het juiste scherm (media print, A4, achtergrond, @page)
//   AC7  -> 'AC7'   mislukte render: vaste body, geen secrets in log
//   AC9  -> 'AC9'   maximaal 2 gelijktijdige renders, slot komt vrij
//   AC10 -> 'AC10'  niet ingelogd / verlopen sessie
//   AC12 -> 'AC12'  alleen eigen team, parametermanipulatie
//   AC13 -> 'AC13'  alleen GET, no-store
//   AC15 -> 'AC15'  tijdzone/locale van het toestel in de render
//   AC16 -> 'AC16'  geen rolcheck

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const launch = vi.fn()
vi.mock('playwright-core', () => ({ chromium: { launch: (...a: unknown[]) => launch(...a) } }))
vi.mock('@sparticuz/chromium', () => ({ default: { args: [], executablePath: vi.fn(), setGraphicsMode: true } }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/team-context', () => ({ requireTeamContext: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ getDict: vi.fn(async () => ({ browserLocale: 'nl-NL' })) }))
vi.mock('@/lib/authz', async (orig) => ({
  ...(await orig<typeof import('@/lib/authz')>()),
  assertOwnTrainingEvent: vi.fn(),
  assertOwnMatchEvent: vi.fn(),
}))
vi.mock('@/lib/errors', async (orig) => ({ ...(await orig<typeof import('@/lib/errors')>()), logError: vi.fn() }))

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireTeamContext, type TeamContext } from '@/lib/team-context'
import { assertOwnMatchEvent, assertOwnTrainingEvent } from '@/lib/authz'
import { logError } from '@/lib/errors'
import * as routeModule from '@/app/api/pdf/route'
import { isPublicPath } from '@/proxy'

const { GET } = routeModule

const SITE = 'https://pitchup.example'
const SUPABASE = 'https://projectref.supabase.co'
const TEAM = '11111111-1111-4111-8111-111111111111'
const ANDER_TEAM = '99999999-9999-4999-8999-999999999999'
const EVENT = '22222222-2222-4222-8222-222222222222'
const COOKIE_WAARDE = 'SECRET-SESSIE-TOKEN-123'
const SESSIE_COOKIES = [
  { name: 'sb-ref-auth-token.0', value: COOKIE_WAARDE },
  { name: 'active_team', value: TEAM },
]

type Pagina = {
  goto: ReturnType<typeof vi.fn>
  url: ReturnType<typeof vi.fn>
  evaluate: ReturnType<typeof vi.fn>
  waitForFunction: ReturnType<typeof vi.fn>
  emulateMedia: ReturnType<typeof vi.fn>
  pdf: ReturnType<typeof vi.fn>
}
let pagina: Pagina
let context: { addCookies: ReturnType<typeof vi.fn>; route: ReturnType<typeof vi.fn>; newPage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }
let browser: { newContext: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }

function nepBrowser(o: { eindPad?: string; status?: number; marker?: { nietGevonden: boolean; redirect: boolean }; gotoPromise?: Promise<unknown>; pdfFout?: Error; gotoFout?: Error } = {}) {
  // Elke launch() levert een verse browser/context/pagina (net als in productie:
  // een launch per request); pagina/context/browser wijzen naar de laatste.
  launch.mockImplementation(async () => {
    let huidig = 'about:blank'
    pagina = {
      goto: vi.fn(async (url: string) => {
        huidig = url
        if (o.gotoFout) throw o.gotoFout
        if (o.gotoPromise) await o.gotoPromise
        if (o.eindPad) huidig = `${SITE}${o.eindPad}`
        return { status: () => o.status ?? 200 }
      }),
      url: vi.fn(() => huidig),
      evaluate: vi.fn().mockResolvedValueOnce(o.marker ?? { nietGevonden: false, redirect: false }).mockResolvedValue(undefined),
      waitForFunction: vi.fn(async () => undefined),
      emulateMedia: vi.fn(async () => undefined),
      pdf: vi.fn(async () => { if (o.pdfFout) throw o.pdfFout; return Buffer.from('%PDF-1.7 echte-bytes') }),
    }
    const pagina_ = pagina
    context = {
      addCookies: vi.fn(async () => undefined),
      route: vi.fn(async () => undefined),
      newPage: vi.fn(async () => pagina_),
      close: vi.fn(async () => undefined),
    }
    const context_ = context
    browser = { newContext: vi.fn(async () => context_), close: vi.fn(async () => undefined) }
    return browser
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
  vi.stubEnv('VERCEL', '')
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getSession: async () => ({ data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null }),
      refreshSession: async () => ({ data: { session: {} }, error: null }),
    },
  } as never)
  vi.mocked(requireTeamContext).mockResolvedValue({ teamId: TEAM, userId: 'u1', rol: 'owner' } as TeamContext)
  vi.mocked(cookies).mockResolvedValue({ getAll: () => SESSIE_COOKIES } as never)
  vi.mocked(assertOwnTrainingEvent).mockResolvedValue(undefined)
  vi.mocked(assertOwnMatchEvent).mockResolvedValue(undefined)
  nepBrowser()
})
afterEach(() => vi.unstubAllEnvs())

const verzoek = (q: string, headers: Record<string, string> = {}) => new NextRequest(`${SITE}/api/pdf?${q}`, { headers })

describe('AC3 — de PDF is de print-weergave van het juiste scherm (bestaande print-CSS)', () => {
  it.each([
    ['trainingsplan', `doel=trainingsplan&id=${EVENT}`, `/events/${EVENT}/training-plan`],
    ['selectie', `doel=selectie&id=${EVENT}`, `/events/${EVENT}/squad`],
    ['aanwezigheid', 'doel=aanwezigheid&periode=8w', '/players?weergave=aanwezigheid&periode=8w'],
    ['inzichten', 'doel=inzichten&periode=4w', '/inzichten?periode=4w'],
  ])('%s: opent %s, emuleert media print, A4 + achtergrond + CSS-paginagrootte, levert PDF-bytes', async (_n, query, pad) => {
    const res = await GET(verzoek(query))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('%PDF-1.7 echte-bytes')
    expect(pagina.goto.mock.calls[0][0]).toBe(`${SITE}${pad}`)
    expect(pagina.emulateMedia).toHaveBeenCalledWith({ media: 'print' })
    expect(pagina.pdf).toHaveBeenCalledWith({ format: 'A4', printBackground: true, preferCSSPageSize: true })
    // emulateMedia vóór pdf
    expect(pagina.emulateMedia.mock.invocationCallOrder[0]).toBeLessThan(pagina.pdf.mock.invocationCallOrder[0])
  })

  it('licht thema (dark mode wordt een lichte PDF) en print-breedte van 186 mm (703 px)', async () => {
    await GET(verzoek('doel=inzichten'))
    expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({
      colorScheme: 'light',
      viewport: { width: 703, height: 1000 },
    }))
  })

  it('een lege/onverwachte pagina-status levert geen PDF (502)', async () => {
    nepBrowser({ status: 500 })
    const res = await GET(verzoek('doel=inzichten'))
    expect(res.status).toBe(502)
    expect(pagina.pdf).not.toHaveBeenCalled()
  })
})

describe('AC7 — PDF maken mislukt: vaste body, geen secrets in body of log', () => {
  const fouten: [string, () => void][] = [
    ['browser start niet', () => launch.mockRejectedValue(new Error(`launch faalde ${SITE} ${COOKIE_WAARDE}`))],
    ['navigatie time-out', () => nepBrowser({ gotoFout: new Error(`Timeout ${SITE}/events/${EVENT} ${COOKIE_WAARDE}`) })],
    ['pdf() faalt', () => nepBrowser({ pdfFout: new Error(`boem ${COOKIE_WAARDE}`) })],
  ]
  it.each(fouten)('%s: 500 { fout: "pdf_mislukt" }', async (_n, maakFout) => {
    maakFout()
    const res = await GET(verzoek(`doel=trainingsplan&id=${EVENT}`))
    const body = await res.text()

    expect(res.status).toBe(500)
    expect(JSON.parse(body)).toEqual({ fout: 'pdf_mislukt' })
    expect(body).not.toContain(COOKIE_WAARDE)
    expect(body).not.toContain(SITE)
    const gelogd = JSON.stringify(vi.mocked(logError).mock.calls, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v))
    expect(vi.mocked(logError)).toHaveBeenCalled()
    expect(gelogd).not.toContain(COOKIE_WAARDE)
    expect(gelogd).not.toContain(EVENT)
    expect(gelogd).not.toContain(SITE)
  })

  it('onbruikbare NEXT_PUBLIC_SITE_URL: 500 en geen browser gestart', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'geen-url')
    const res = await GET(verzoek('doel=inzichten'))
    expect(res.status).toBe(500)
    expect(launch).not.toHaveBeenCalled()
  })

  it('browser en context worden ook na een fout gesloten (geen lekkende sessie)', async () => {
    nepBrowser({ pdfFout: new Error('x') })
    await GET(verzoek('doel=inzichten'))
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(browser.close).toHaveBeenCalledTimes(1)
  })
})

describe('AC9 — maximaal 2 gelijktijdige renders per instance; slot komt altijd vrij', () => {
  it('derde gelijktijdige aanvraag: 429 te_druk + Retry-After, géén derde browser; daarna weer bruikbaar', async () => {
    let open!: () => void
    const wacht = new Promise<void>((res) => { open = res })
    nepBrowser({ gotoPromise: wacht })
    const r1 = GET(verzoek('doel=inzichten'))
    const r2 = GET(verzoek('doel=inzichten'))
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(2))
    const r3 = await GET(verzoek('doel=inzichten'))

    expect(r3.status).toBe(429)
    expect(await r3.json()).toEqual({ fout: 'te_druk' })
    expect(r3.headers.get('retry-after')).toBeTruthy()
    expect(launch).toHaveBeenCalledTimes(2)

    open()
    expect((await r1).status).toBe(200)
    expect((await r2).status).toBe(200)
    expect((await GET(verzoek('doel=inzichten'))).status).toBe(200)
  })

  it('een mislukte render geeft zijn slot vrij', async () => {
    launch.mockRejectedValue(new Error('x'))
    for (let i = 0; i < 4; i++) expect((await GET(verzoek('doel=inzichten'))).status).toBe(500)
    nepBrowser()
    expect((await GET(verzoek('doel=inzichten'))).status).toBe(200)
  })
})

describe('AC10 — niet ingelogd / sessie verlopen: nooit een PDF met teamdata', () => {
  it('geen sessie (requireTeamContext gooit): 401, geen browser, geen cookies naar Chromium', async () => {
    vi.mocked(requireTeamContext).mockRejectedValue(new Error('Niet ingelogd'))
    const res = await GET(verzoek(`doel=trainingsplan&id=${EVENT}`))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ fout: 'niet_ingelogd' })
    expect(launch).not.toHaveBeenCalled()
  })

  it('sessie niet te verversen: 401, geen render', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getSession: async () => ({ data: { session: { expires_at: Math.floor(Date.now() / 1000) + 10 } }, error: null }),
        refreshSession: async () => ({ data: { session: null }, error: { message: 'x' } }),
      },
    } as never)
    const res = await GET(verzoek('doel=inzichten'))
    expect(res.status).toBe(401)
    expect(launch).not.toHaveBeenCalled()
  })

  it('Chromium wordt tijdens het renderen naar /login gestuurd: 401, geen PDF-bytes', async () => {
    nepBrowser({ eindPad: '/login' })
    const res = await GET(verzoek('doel=inzichten'))
    expect(res.status).toBe(401)
    expect(pagina.pdf).not.toHaveBeenCalled()
  })

  it('redirect-marker tijdens streamen (status 200): 401, geen PDF', async () => {
    nepBrowser({ marker: { nietGevonden: false, redirect: true } })
    const res = await GET(verzoek('doel=inzichten'))
    expect(res.status).toBe(401)
    expect(pagina.pdf).not.toHaveBeenCalled()
  })

  it('/api/pdf is geen openbaar pad (proxy dwingt login af)', () => {
    expect(isPublicPath('/api/pdf')).toBe(false)
  })
})

describe('AC12 — alleen data van het eigen team, ook niet via parametermanipulatie', () => {
  it.each([
    ['trainingsplan', assertOwnTrainingEvent],
    ['selectie', assertOwnMatchEvent],
  ] as const)('%s van een ander team: 404, geen browser, geen bytes', async (doel, guard) => {
    vi.mocked(guard).mockRejectedValue(new Error('niet van dit team'))
    const res = await GET(verzoek(`doel=${doel}&id=${EVENT}`))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ fout: 'niet_gevonden' })
    expect(launch).not.toHaveBeenCalled()
  })

  it('het team komt uit de sessie, niet uit de querystring (team_id/teamId/team in de URL genegeerd)', async () => {
    const res = await GET(verzoek(`doel=trainingsplan&id=${EVENT}&team_id=${ANDER_TEAM}&teamId=${ANDER_TEAM}&team=${ANDER_TEAM}`))
    expect(res.status).toBe(200)
    expect(assertOwnTrainingEvent).toHaveBeenCalledWith(expect.anything(), EVENT, TEAM)
    expect(pagina.goto.mock.calls[0][0]).toBe(`${SITE}/events/${EVENT}/training-plan`)
  })

  it.each([
    ['pad-traversal als id', 'doel=trainingsplan&id=..%2F..%2Fadmin'],
    ['id met extra pad', `doel=trainingsplan&id=${EVENT}%2F..%2Fsettings`],
    ['periode met pad', 'doel=inzichten&periode=..%2Fadmin'],
    ['periode met query-injectie', 'doel=aanwezigheid&periode=seizoen%26weergave%3Dx'],
    ['onbekend doel', 'doel=login'],
    ['id bij inzichten', `doel=inzichten&id=${EVENT}`],
    ['SQL in id', "doel=selectie&id=' OR 1=1 --"],
  ])('%s: 400 en geen browser', async (_n, q) => {
    const res = await GET(verzoek(q))
    expect(res.status).toBe(400)
    expect(launch).not.toHaveBeenCalled()
  })

  it('een meegestuurde url=/path=/origin= wordt genegeerd: de browser opent altijd de vaste site-origin + intern gebouwd pad', async () => {
    const res = await GET(verzoek(`doel=inzichten&url=https://evil.example/x&path=/admin&origin=https://evil.example&host=evil.example`))
    expect(res.status).toBe(200)
    expect(pagina.goto.mock.calls[0][0]).toBe(`${SITE}/inzichten?periode=seizoen`)
  })

  it('Host-/Origin-/X-Forwarded-Host-header van de aanvaller verandert de render-origin niet', async () => {
    const res = await GET(verzoek('doel=inzichten', { host: 'evil.example', origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' }))
    expect(res.status).toBe(200)
    expect(pagina.goto.mock.calls[0][0].startsWith(`${SITE}/`)).toBe(true)
    expect(context.addCookies.mock.calls[0][0].every((c: { url: string }) => c.url === `${SITE}/`)).toBe(true)
  })

  it('sessiecookies gaan alleen naar de eigen origin; netwerkverkeer buiten site + Supabase wordt afgebroken', async () => {
    await GET(verzoek('doel=inzichten'))
    const cookiesGezet = context.addCookies.mock.calls[0][0] as { name: string; value: string; url: string }[]
    expect(cookiesGezet.map((c) => c.value)).toContain(COOKIE_WAARDE)
    expect(cookiesGezet.every((c) => c.url === `${SITE}/`)).toBe(true)

    const handler = context.route.mock.calls[0][1] as (r: unknown) => void
    const probeer = (url: string) => {
      const r = { request: () => ({ url: () => url }), continue: vi.fn(), abort: vi.fn() }
      handler(r)
      return r
    }
    expect(probeer(`${SITE}/_next/static/x.js`).continue).toHaveBeenCalled()
    expect(probeer(`${SUPABASE}/storage/v1/object/public/logo.png`).continue).toHaveBeenCalled()
    for (const kwaad of ['https://evil.example/steal', 'http://pitchup.example/', `${SITE}:8443/x`, 'file:///etc/passwd', 'https://pitchup.example.evil.example/']) {
      const r = probeer(kwaad)
      expect(r.abort).toHaveBeenCalled()
      expect(r.continue).not.toHaveBeenCalled()
    }
  })

  it('pagina meldt niet-gevonden tijdens streamen (status 200 + noindex): 404, geen PDF', async () => {
    nepBrowser({ marker: { nietGevonden: true, redirect: false } })
    const res = await GET(verzoek(`doel=selectie&id=${EVENT}`))
    expect(res.status).toBe(404)
    expect(pagina.pdf).not.toHaveBeenCalled()
  })
})

describe('AC13 — leesactie: alleen GET, nooit gecached, veilig herhaalbaar', () => {
  it('de route exporteert alleen GET (geen POST/PUT/PATCH/DELETE)', () => {
    const verbs = ['POST', 'PUT', 'PATCH', 'DELETE'].filter((v) => v in routeModule)
    expect(verbs).toEqual([])
    expect(typeof routeModule.GET).toBe('function')
  })

  it.each([
    ['200', 'doel=inzichten'],
    ['400', 'doel=nope'],
  ])('antwoord %s heeft Cache-Control private, no-store', async (_s, q) => {
    expect((await GET(verzoek(q))).headers.get('cache-control')).toBe('private, no-store')
  })

  it('twee keer dezelfde aanvraag geeft tweemaal dezelfde PDF, zonder schrijfacties (geen sessie-/DB-mutatie behalve eventuele verversing)', async () => {
    const a = await GET(verzoek(`doel=trainingsplan&id=${EVENT}`))
    const b = await GET(verzoek(`doel=trainingsplan&id=${EVENT}`))
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(Buffer.from(await a.arrayBuffer()).equals(Buffer.from(await b.arrayBuffer()))).toBe(true)
  })

  it('niet-ok antwoorden hebben ook no-store (401/404/429/500)', async () => {
    vi.mocked(requireTeamContext).mockRejectedValueOnce(new Error('Niet ingelogd'))
    expect((await GET(verzoek('doel=inzichten'))).headers.get('cache-control')).toBe('private, no-store')
    vi.mocked(assertOwnTrainingEvent).mockRejectedValueOnce(new Error('x'))
    expect((await GET(verzoek(`doel=trainingsplan&id=${EVENT}`))).headers.get('cache-control')).toBe('private, no-store')
    launch.mockRejectedValueOnce(new Error('x'))
    expect((await GET(verzoek('doel=inzichten'))).headers.get('cache-control')).toBe('private, no-store')
  })
})

describe('AC15 — tijdzone en taal van het toestel in de render', () => {
  it('tz uit het verzoek wordt de timezoneId van de browsercontext; locale uit de app-taal', async () => {
    await GET(verzoek('doel=inzichten&tz=America%2FNew_York'))
    expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({ timezoneId: 'America/New_York', locale: 'nl-NL' }))
  })
  it('zonder tz: Europe/Amsterdam', async () => {
    await GET(verzoek('doel=inzichten'))
    expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({ timezoneId: 'Europe/Amsterdam' }))
  })
})

describe('AC16 — geen rolcheck: elke teamlid met schermtoegang kan een PDF krijgen', () => {
  it.each(['owner', 'assistent'])('rol %s: 200', async (rol) => {
    vi.mocked(requireTeamContext).mockResolvedValue({ teamId: TEAM, userId: 'u2', rol, rechten: {} } as unknown as TeamContext)
    const res = await GET(verzoek(`doel=selectie&id=${EVENT}`))
    expect(res.status).toBe(200)
  })
})
