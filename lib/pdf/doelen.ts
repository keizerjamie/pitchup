// Welke schermen als PDF gedeeld kunnen worden, hoe de querystring van
// GET /api/pdf eruitziet en welk pad de headless browser daarvoor opent.
//
// Puur (geen server-API's), zodat de client het type `PdfDoel` mag importeren
// en de parsing zonder Next of Supabase te testen is.
//
// Het doelpad wordt bewust ALTIJD hier, server-side, uit gevalideerde
// onderdelen opgebouwd: de client levert nooit een pad of URL aan. Zo kan een
// gemanipuleerde request hooguit een ander eigen event of een andere periode
// opleveren, nooit een willekeurige pagina (of een externe host — de origin
// komt uit getSiteUrl() in de route).

import { isUuid } from '@/lib/authz'
import { isPeriode, PERIODE_STANDAARD, type Periode } from '@/lib/inzichten'

export type PdfDoel =
  | { doel: 'trainingsplan' | 'selectie'; eventId: string }
  | { doel: 'aanwezigheid' | 'inzichten'; periode: Periode }

export type PdfDoelNaam = PdfDoel['doel']

export const PDF_DOELEN: readonly PdfDoelNaam[] = ['trainingsplan', 'selectie', 'aanwezigheid', 'inzichten']

// Terugval voor `tz` als de client er geen meestuurt. De app is Nederlands van
// origine; het is ook de zone van de huidige gebruikers.
export const STANDAARD_TIJDZONE = 'Europe/Amsterdam'

export type PdfParams = { doel: PdfDoel; tz: string }

// Alle foutcodes die GET /api/pdf als `{ fout: <code> }` kan teruggeven. De
// client toont deze nooit; hij vertaalt elke foutstatus naar één i18n-melding.
export type PdfFoutCode = 'ongeldig' | 'niet_ingelogd' | 'geen_team' | 'niet_gevonden' | 'te_druk' | 'pdf_mislukt'

function isDoelNaam(waarde: unknown): waarde is PdfDoelNaam {
  return typeof waarde === 'string' && (PDF_DOELEN as readonly string[]).includes(waarde)
}

// Een IANA-zone is geldig als Intl hem accepteert. `Intl.DateTimeFormat` gooit
// een RangeError bij een onbekende zone; dat is precies de check die Chromium
// straks ook nodig heeft (een ongeldige timezoneId laat newContext falen).
// Lengtegrens vooraf, zodat er geen willekeurig lange tekst door Intl gaat.
export function isTijdzone(waarde: unknown): waarde is string {
  if (typeof waarde !== 'string' || waarde.length === 0 || waarde.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: waarde })
    return true
  } catch {
    return false
  }
}

// null = ongeldig (de route geeft dan 400). Onbekende extra parameters worden
// genegeerd; een parameter die bij het gekozen doel niet hoort (id bij
// inzichten, periode bij trainingsplan) is juist wél ongeldig, zodat de client
// niet ongemerkt iets meestuurt waar de server niets mee doet.
export function parsePdfParams(params: URLSearchParams): PdfParams | null {
  const doelNaam = params.get('doel')
  if (!isDoelNaam(doelNaam)) return null

  const tzRuw = params.get('tz')
  const tz = tzRuw === null ? STANDAARD_TIJDZONE : tzRuw
  if (!isTijdzone(tz)) return null

  const id = params.get('id')
  const periode = params.get('periode')

  if (doelNaam === 'trainingsplan' || doelNaam === 'selectie') {
    if (periode !== null) return null
    if (!isUuid(id)) return null
    return { doel: { doel: doelNaam, eventId: id }, tz }
  }

  if (id !== null) return null
  if (periode !== null && !isPeriode(periode)) return null
  return { doel: { doel: doelNaam, periode: periode ?? PERIODE_STANDAARD }, tz }
}

// Pad + query (zonder origin) van de pagina die de PDF oplevert. Dit zijn
// exact de bestaande schermen; de PDF is hun print-weergave.
export function bouwDoelPad(doel: PdfDoel): string {
  switch (doel.doel) {
    case 'trainingsplan':
      return `/events/${encodeURIComponent(doel.eventId)}/training-plan`
    case 'selectie':
      return `/events/${encodeURIComponent(doel.eventId)}/squad`
    case 'aanwezigheid':
      return `/players?weergave=aanwezigheid&periode=${encodeURIComponent(doel.periode)}`
    case 'inzichten':
      return `/inzichten?periode=${encodeURIComponent(doel.periode)}`
  }
}
