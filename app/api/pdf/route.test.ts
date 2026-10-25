// @vitest-environment node
//
// Tests voor GET /api/pdf (Delen als PDF). renderPdf (Chromium) is gemockt;
// lib/pdf/render.test.ts dekt de render zelf. Kern: validatie vóór alles,
// tenant-voorcheck vóór Chromium, vaste origin (geen Host-header), geen ruwe
// fouten naar client of log, en de in-memory grens van 2 gelijktijdige renders.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/team-context', () => ({ requireTeamContext: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ getDict: vi.fn(async () => ({ browserLocale: 'nl-NL' })) }))
vi.mock('@/lib/authz', async (importOriginal) => {
  const origineel = await importOriginal<typeof import('@/lib/authz')>()
  return { ...origineel, assertOwnTrainingEvent: vi.fn(), assertOwnMatchEvent: vi.fn() }
})
vi.mock('@/lib/pdf/render', async (importOriginal) => {
  const origineel = await importOriginal<typeof import('@/lib/pdf/render')>()
  return { ...origineel, renderPdf: vi.fn() }
})
vi.mock('@/lib/errors', async (importOriginal) => {
  const origineel = await importOriginal<typeof import('@/lib/errors')>()
  return { ...origineel, logError: vi.fn() }
})

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireTeamContext, type TeamContext } from '@/lib/team-context'
import { assertOwnMatchEvent, assertOwnTrainingEvent } from '@/lib/authz'
import { PdfRenderFout, renderPdf, type RenderInvoer } from '@/lib/pdf/render'
import { logError } from '@/lib/errors'
import { renderSlots } from '@/lib/pdf/gelijktijdig'
import { GET } from '@/app/api/pdf/route'

const TEAM = '11111111-1111-4111-8111-111111111111'
const EVENT = '22222222-2222-4222-8222-222222222222'
const SITE = 'https://pitchup.example'
const PDF = Buffer.from('%PDF-1.7 test')

const SESSIE_COOKIES = [
  { name: 'sb-ref-auth-token.0', value: 'deel-een' },
  { name: 'sb-ref-auth-token.1', value: 'deel-twee' },
  { name: 'locale', value: 'nl' },
  { name: 'active_team', value: TEAM },
]

let getSession: ReturnType<typeof vi.fn>
let refreshSession: ReturnType<typeof vi.fn>

function verlooptOverSeconden(s: number) {
  return { data: { session: { expires_at: Math.floor(Date.now() / 1000) + s } }, error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://projectref.supabase.co')
  getSession = vi.fn(async () => verlooptOverSeconden(3600))
  refreshSession = vi.fn(async () => ({ data: { session: {} }, error: null }))
  vi.mocked(createClient).mockResolvedValue({ auth: { getSession, refreshSession } } as never)
  vi.mocked(requireTeamContext).mockResolvedValue({ teamId: TEAM, userId: 'user-1' } as TeamContext)
  vi.mocked(cookies).mockResolvedValue({ getAll: () => SESSIE_COOKIES } as never)
  vi.mocked(assertOwnTrainingEvent).mockResolvedValue(undefined)
  vi.mocked(assertOwnMatchEvent).mockResolvedValue(undefined)
  vi.mocked(renderPdf).mockResolvedValue({ soort: 'pdf', pdf: PDF })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function verzoek(query: string, headers: Record<string, string> = {}) {
  return new NextRequest(`${SITE}/api/pdf?${query}`, { headers })
}

function renderInvoer(): RenderInvoer {
  expect(renderPdf).toHaveBeenCalledTimes(1)
  return vi.mocked(renderPdf).mock.calls[0][0]
}

describe('GET /api/pdf — succes', () => {
  it('trainingsplan: 200 met de PDF-bytes en de juiste headers', async () => {
    const res = await GET(verzoek(`doel=trainingsplan&id=${EVENT}`))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="pitchup.pdf"')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PDF)
  })

  it('trainingsplan: render krijgt siteUrl + eventpad, alle sessiecookies, locale en tz', async () => {
    await GET(verzoek(`doel=trainingsplan&id=${EVENT}&tz=America%2FNew_York`))

    const invoer = renderInvoer()
    expect(invoer.siteUrl).toBe(SITE)
    expect(invoer.pad).toBe(`/events/${EVENT}/training-plan`)
    expect(invoer.cookies).toEqual(SESSIE_COOKIES)
    expect(invoer.locale).toBe('nl-NL')
    expect(invoer.timezoneId).toBe('America/New_York')
    expect(invoer.supabaseOrigin).toBe('https://projectref.supabase.co')
    expect(assertOwnTrainingEvent).toHaveBeenCalledWith(expect.anything(), EVENT, TEAM)
  })

  it('selectie: wedstrijd-voorcheck met het actieve team en het squad-pad', async () => {
    const res = await GET(verzoek(`doel=selectie&id=${EVENT}`))

    expect(res.status).toBe(200)
    expect(assertOwnMatchEvent).toHaveBeenCalledWith(expect.anything(), EVENT, TEAM)
    expect(assertOwnTrainingEvent).not.toHaveBeenCalled()
    expect(renderInvoer().pad).toBe(`/events/${EVENT}/squad`)
  })

  it('aanwezigheid: spelerspagina in aanwezigheidsweergave met de periode', async () => {
    const res = await GET(verzoek('doel=aanwezigheid&periode=8w'))

    expect(res.status).toBe(200)
    expect(renderInvoer().pad).toBe('/players?weergave=aanwezigheid&periode=8w')
    expect(assertOwnTrainingEvent).not.toHaveBeenCalled()
    expect(assertOwnMatchEvent).not.toHaveBeenCalled()
  })

  it('inzichten zonder periode: valt terug op seizoen, tz op Europe/Amsterdam', async () => {
    const res = await GET(verzoek('doel=inzichten'))

    expect(res.status).toBe(200)
    const invoer = renderInvoer()
    expect(invoer.pad).toBe('/inzichten?periode=seizoen')
    expect(invoer.timezoneId).toBe('Europe/Amsterdam')
  })
})

describe('GET /api/pdf — falen', () => {
  it.each([
    ['onbekend doel', 'doel=rapport'],
    ['geen doel', ''],
    ['ongeldige uuid', 'doel=trainingsplan&id=abc'],
    ['ontbrekende id', 'doel=selectie'],
    ['id bij inzichten', `doel=inzichten&id=${EVENT}`],
    ['periode bij trainingsplan', `doel=trainingsplan&id=${EVENT}&periode=4w`],
    ['ongeldige periode', 'doel=aanwezigheid&periode=12w'],
    ['ongeldige tz', 'doel=inzichten&tz=Mars%2FOlympus'],
    ['lege tz', 'doel=inzichten&tz='],
  ])('%s: 400 { fout: "ongeldig" } zonder context of render', async (_naam, query) => {
    const res = await GET(verzoek(query))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ fout: 'ongeldig' })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(requireTeamContext).not.toHaveBeenCalled()
    expect(renderPdf).not.toHaveBeenCalled()
  })

  it('niet ingelogd: 401', async () => {
    vi.mocked(requireTeamContext).mockRejectedValue(new Error('Niet ingelogd'))

    const res = await GET(verzoek('doel=inzichten'))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ fout: 'niet_ingelogd' })
    expect(renderPdf).not.toHaveBeenCalled()
  })

  it('geen team: 403', async () => {
    vi.mocked(requireTeamContext).mockRejectedValue(new Error('Geen team'))

    const res = await GET(verzoek('doel=inzichten'))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ fout: 'geen_team' })
  })

  it('onverwachte contextfout: 500, alleen een label in de log', async () => {
    vi.mocked(requireTeamContext).mockRejectedValue(new Error('geheime databasemelding'))

    const res = await GET(verzoek('doel=inzichten'))

    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('geheime')
    expect(logError).toHaveBeenCalledWith('pdf.teamContext', expect.anything())
  })

  it.each([
    ['trainingsplan', assertOwnTrainingEvent],
    ['selectie', assertOwnMatchEvent],
  ] as const)('%s van een ander team: 404 en Chromium start niet', async (doel, guard) => {
    vi.mocked(guard).mockRejectedValue(new Error('Event niet gevonden'))

    const res = await GET(verzoek(`doel=${doel}&id=${EVENT}`))

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ fout: 'niet_gevonden' })
    expect(renderPdf).not.toHaveBeenCalled()
  })

  it('renderPdf gooit: 500 pdf_mislukt, geen ruwe melding in body of log', async () => {
    vi.mocked(renderPdf).mockRejectedValue(new Error(`net::ERR at ${SITE}/events/${EVENT} cookie=geheim`))

    const res = await GET(verzoek(`doel=trainingsplan&id=${EVENT}`))

    expect(res.status).toBe(500)
    const body = await res.text()
    expect(JSON.parse(body)).toEqual({ fout: 'pdf_mislukt' })
    expect(body).not.toContain('geheim')
    expect(logError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logError).mock.calls[0][0]).toBe('pdf.onbekend')
  })

  it('PdfRenderFout: log-label bevat de stap', async () => {
    vi.mocked(renderPdf).mockRejectedValue(new PdfRenderFout('launch'))

    const res = await GET(verzoek('doel=inzichten'))

    expect(res.status).toBe(500)
    expect(vi.mocked(logError).mock.calls[0][0]).toBe('pdf.launch')
  })

  it('render eindigt niet op het doelpad (doorverwezen naar /login): 401', async () => {
    vi.mocked(renderPdf).mockResolvedValue({ soort: 'niet_ingelogd' })

    const res = await GET(verzoek('doel=inzichten'))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ fout: 'niet_ingelogd' })
  })

  it('pagina geeft 404: 404', async () => {
    vi.mocked(renderPdf).mockResolvedValue({ soort: 'niet_gevonden' })

    const res = await GET(verzoek(`doel=trainingsplan&id=${EVENT}`))

    expect(res.status).toBe(404)
  })

  it('pagina geeft een andere status: 502 pdf_mislukt', async () => {
    vi.mocked(renderPdf).mockResolvedValue({ soort: 'status' })

    const res = await GET(verzoek('doel=inzichten'))

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ fout: 'pdf_mislukt' })
  })

  it('geen siteUrl in productie: 500 en geen render', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    vi.stubEnv('NODE_ENV', 'production')

    const res = await GET(verzoek('doel=inzichten'))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ fout: 'pdf_mislukt' })
    expect(logError).toHaveBeenCalledWith('pdf.siteUrl', expect.anything())
    expect(renderPdf).not.toHaveBeenCalled()
  })
})

describe('GET /api/pdf — sessie (refresh-token)', () => {
  it('ruime sessie: geen eigen verversing', async () => {
    await GET(verzoek('doel=inzichten'))

    expect(getSession).toHaveBeenCalled()
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('token verloopt binnen de render-marge: route ververst vóór het lezen van de cookies', async () => {
    getSession.mockResolvedValue(verlooptOverSeconden(100))
    const volgorde: string[] = []
    refreshSession.mockImplementation(async () => {
      volgorde.push('refresh')
      return { data: { session: {} }, error: null }
    })
    vi.mocked(cookies).mockImplementation(async () => {
      volgorde.push('cookies')
      return { getAll: () => SESSIE_COOKIES } as never
    })

    const res = await GET(verzoek('doel=inzichten'))

    expect(res.status).toBe(200)
    expect(volgorde).toEqual(['refresh', 'cookies'])
  })

  it('verversen mislukt: 401 en geen render', async () => {
    getSession.mockResolvedValue(verlooptOverSeconden(10))
    refreshSession.mockResolvedValue({ data: { session: null }, error: { code: 'refresh_token_not_found' } })

    const res = await GET(verzoek('doel=inzichten'))

    expect(res.status).toBe(401)
    expect(renderPdf).not.toHaveBeenCalled()
  })

  it('verwijderde cookie-chunks (lege waarde) gaan niet mee naar Chromium', async () => {
    vi.mocked(cookies).mockResolvedValue({
      getAll: () => [...SESSIE_COOKIES.slice(0, 1), { name: 'sb-ref-auth-token.1', value: '' }],
    } as never)

    await GET(verzoek('doel=inzichten'))

    expect(renderInvoer().cookies).toEqual([{ name: 'sb-ref-auth-token.0', value: 'deel-een' }])
  })
})

describe('GET /api/pdf — edge cases', () => {
  it('Host-spoofing: render gebruikt altijd de getSiteUrl()-origin', async () => {
    const req = new NextRequest(`https://evil.example/api/pdf?doel=trainingsplan&id=${EVENT}`, {
      headers: { host: 'evil.example', origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' },
    })

    await GET(req)

    expect(renderInvoer().siteUrl).toBe(SITE)
  })

  it('maximaal 2 gelijktijdige renders: de derde krijgt 429 met Retry-After', async () => {
    const wachtend: (() => void)[] = []
    vi.mocked(renderPdf).mockImplementation(
      () => new Promise((resolve) => wachtend.push(() => resolve({ soort: 'pdf', pdf: PDF }))),
    )

    const eerste = GET(verzoek('doel=inzichten'))
    const tweede = GET(verzoek('doel=aanwezigheid'))
    await vi.waitFor(() => expect(renderPdf).toHaveBeenCalledTimes(2))

    const derde = await GET(verzoek('doel=inzichten'))
    expect(derde.status).toBe(429)
    expect(await derde.json()).toEqual({ fout: 'te_druk' })
    expect(derde.headers.get('retry-after')).toBe('5')
    expect(derde.headers.get('cache-control')).toBe('private, no-store')
    expect(renderPdf).toHaveBeenCalledTimes(2)

    wachtend.forEach((klaar) => klaar())
    expect((await eerste).status).toBe(200)
    expect((await tweede).status).toBe(200)
    expect(renderSlots.actief()).toBe(0)

    // Plek weer vrij: een nieuwe request mag renderen.
    vi.mocked(renderPdf).mockResolvedValue({ soort: 'pdf', pdf: PDF })
    expect((await GET(verzoek('doel=inzichten'))).status).toBe(200)
  })

  it('plek komt ook vrij na een mislukte render of een 401 tijdens de sessiecheck', async () => {
    vi.mocked(renderPdf).mockRejectedValue(new Error('crash'))
    await GET(verzoek('doel=inzichten'))
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    await GET(verzoek('doel=inzichten'))

    expect(renderSlots.actief()).toBe(0)
  })
})
