// GET /api/pdf — "Delen als PDF".
//
// Rendert een bestaand scherm (trainingsplan, wedstrijdselectie,
// aanwezigheidsoverzicht, seizoensrapport) server-side in headless Chromium
// naar een PDF, met de bestaande print-CSS. Zie lib/pdf/render.ts voor de
// sessie- en netwerkwaarborgen en lib/pdf/doelen.ts voor de parameters.
//
// GET omdat het een leesactie is die niets wijzigt en veilig herhaald kan
// worden. Cross-site fetches sturen de Lax-sessiecookies niet mee, en zonder
// CORS-headers is het antwoord cross-origin niet leesbaar.
//
// proxy.ts dekt deze route: zonder sessie volgt daar al een 307 naar /login,
// en de proxy ververst de sessiecookies vlak vóór deze handler draait.

import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { assertOwnMatchEvent, assertOwnTrainingEvent } from '@/lib/authz'
import { logError } from '@/lib/errors'
import { getDict } from '@/lib/i18n'
import { bouwDoelPad, parsePdfParams, type PdfFoutCode } from '@/lib/pdf/doelen'
import { renderSlots } from '@/lib/pdf/gelijktijdig'
import { PdfRenderFout, renderPdf } from '@/lib/pdf/render'
import { cookiesVoorRender, zorgVoorRuimeSessie } from '@/lib/pdf/sessie'
import { getSiteUrl } from '@/lib/site-url'
import { createClient } from '@/lib/supabase/server'
import { requireTeamContext } from '@/lib/team-context'

export const runtime = 'nodejs'
// Chromium-launch (cold start) + navigatie + render. Vóór de push nog tegen
// het Vercel-plan van Pitchup controleren (besluit 2026-10-25).
export const maxDuration = 60

// Nooit cachen: de PDF bevat teamdata van precies deze sessie.
const GEEN_CACHE = { 'Cache-Control': 'private, no-store' }

// Na een 429 is een render van een paar seconden de verwachte wachttijd.
const RETRY_AFTER_SECONDEN = '5'

function fout(status: number, code: PdfFoutCode, extraHeaders: Record<string, string> = {}): Response {
  return Response.json({ fout: code }, { status, headers: { ...GEEN_CACHE, ...extraHeaders } })
}

function supabaseOrigin(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin
  } catch {
    return null
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  // 1. Parameters — vóór elke databaseroundtrip.
  const params = parsePdfParams(request.nextUrl.searchParams)
  if (!params) return fout(400, 'ongeldig')

  // 2. Sessie en actief team. Bewust de bestaande meldingen van
  //    requireTeamContext; al het andere is een onverwachte fout.
  let teamId: string
  try {
    teamId = (await requireTeamContext()).teamId
  } catch (err) {
    const melding = err instanceof Error ? err.message : ''
    if (melding === 'Niet ingelogd') return fout(401, 'niet_ingelogd')
    if (melding === 'Geen team') return fout(403, 'geen_team')
    logError('pdf.teamContext', err)
    return fout(500, 'pdf_mislukt')
  }

  // 3. Tenant-voorcheck, zodat Chromium niet voor niets (of voor een event van
  //    een ander team) opstart. De gerenderde pagina scopet daarna zelf nog
  //    elke query op ctx.teamId — dit is de eerste van drie lagen.
  const { doel, tz } = params
  const supabase = await createClient()
  if (doel.doel === 'trainingsplan' || doel.doel === 'selectie') {
    try {
      if (doel.doel === 'trainingsplan') await assertOwnTrainingEvent(supabase, doel.eventId, teamId)
      else await assertOwnMatchEvent(supabase, doel.eventId, teamId)
    } catch {
      // Zelfde niet-onthullende antwoord voor "bestaat niet", "ander team" en
      // "verkeerd type".
      return fout(404, 'niet_gevonden')
    }
  }

  // 4. Vaste origin — NOOIT de Host- of Origin-header (zelfde principe als de
  //    wachtwoord-reset, lib/site-url.ts).
  const siteUrl = getSiteUrl()
  if (!siteUrl) {
    logError('pdf.siteUrl', { code: 'site_url_missing' })
    return fout(500, 'pdf_mislukt')
  }

  // 5. Maximaal MAX_GELIJKTIJDIGE_RENDERS Chromiums tegelijk per instance.
  const geefVrij = renderSlots.probeer()
  if (!geefVrij) return fout(429, 'te_druk', { 'Retry-After': RETRY_AFTER_SECONDEN })

  try {
    // 6. Sessie die de hele render meegaat — zie lib/pdf/sessie.ts voor het
    //    refresh-token-probleem dat dit voorkomt.
    if (!(await zorgVoorRuimeSessie(supabase))) return fout(401, 'niet_ingelogd')

    // Cookies pas NU lezen: na de verversing door de proxy én een eventuele
    // verversing hierboven, zodat Chromium precies de set krijgt die de
    // gebruiker via Set-Cookie ook krijgt.
    const sessieCookies = cookiesVoorRender((await cookies()).getAll())
    const t = await getDict()

    const uitkomst = await renderPdf({
      siteUrl,
      pad: bouwDoelPad(doel),
      cookies: sessieCookies,
      locale: t.browserLocale,
      timezoneId: tz,
      supabaseOrigin: supabaseOrigin(),
    })

    switch (uitkomst.soort) {
      case 'niet_gevonden':
        return fout(404, 'niet_gevonden')
      case 'niet_ingelogd':
        return fout(401, 'niet_ingelogd')
      case 'status':
        logError('pdf.status', { code: 'unexpected_status' })
        return fout(502, 'pdf_mislukt')
      case 'pdf':
        return new Response(new Uint8Array(uitkomst.pdf), {
          status: 200,
          headers: {
            ...GEEN_CACHE,
            'Content-Type': 'application/pdf',
            // De echte bestandsnaam zet de client (toesteldatum/eventdatum).
            'Content-Disposition': 'attachment; filename="pitchup.pdf"',
            'Content-Length': String(uitkomst.pdf.byteLength),
            'X-Content-Type-Options': 'nosniff',
          },
        })
    }
  } catch (err) {
    // Alleen een vast label; nooit URL, cookies of de ruwe melding.
    logError(err instanceof PdfRenderFout ? `pdf.${err.stap}` : 'pdf.onbekend', err)
    return fout(500, 'pdf_mislukt')
  } finally {
    geefVrij()
  }
}
