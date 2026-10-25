// Server-only: rendert een bestaande Pitchup-pagina in headless Chromium naar
// een A4-PDF, met de print-CSS die er al is (globals.css, @media print). Er
// bestaat dus geen tweede opmaak: de PDF ís de afdruk.
//
// SESSIE: de pagina wordt geopend met de cookies van de gebruiker, in een
// eenmalige, geïsoleerde browser (eigen launch per request, tijdelijk profiel,
// geen userDataDir). Waarborgen tegen lekken:
//   * cookies worden alleen gezet voor de vaste siteUrl-origin (getSiteUrl()
//     in de route, nooit de Host-header);
//   * een netwerk-allowlist (isToegestaneUrl) breekt elk verzoek af dat niet
//     naar de eigen origin of naar Supabase gaat;
//   * context en browser sluiten altijd in `finally`;
//   * er wordt niets van URL, cookies of ruwe foutmeldingen gelogd — fouten
//     komen als PdfRenderFout met alleen een vast stap-label naar buiten.
//
// Alleen importeren vanuit server-code (de route). playwright-core en
// @sparticuz/chromium staan op Next's automatische serverExternalPackages-lijst.

import { chromium, type Browser, type BrowserContext } from 'playwright-core'

// Breedte waarop de print-CSS is afgesteld (186 mm = A4 min 2 × 12 mm marge).
// Bewust breder dan 600px: de telefoon-zoomregel in globals.css mag hier NIET
// matchen, want dit is geen iPhone-afdruk.
const VIEWPORT = { width: 703, height: 1000 }

const LAUNCH_TIMEOUT_MS = 20_000
const NAVIGATIE_TIMEOUT_MS = 25_000
const STREAM_TIMEOUT_MS = 10_000
const AFBEELDINGEN_TIMEOUT_MS = 5_000

export type RenderInvoer = {
  // Genormaliseerde basis-URL uit getSiteUrl(), zonder trailing slash.
  siteUrl: string
  // Pad + query uit bouwDoelPad(), beginnend met '/'.
  pad: string
  cookies: readonly { name: string; value: string }[]
  // BCP-47, bijv. 'nl-NL' (t.browserLocale).
  locale: string
  // IANA-zone van het toestel, al gevalideerd.
  timezoneId: string
  // Origin van Supabase (clublogo uit Storage); null als niet geconfigureerd.
  supabaseOrigin: string | null
}

export type RenderUitkomst =
  | { soort: 'pdf'; pdf: Buffer }
  // De pagina gaf een 404 / notFound().
  | { soort: 'niet_gevonden' }
  // De render kwam niet op het doelpad uit (bijv. doorverwezen naar /login).
  | { soort: 'niet_ingelogd' }
  // Elke andere HTTP-status dan 200.
  | { soort: 'status' }

export type RenderStap = 'launch' | 'context' | 'navigatie' | 'pdf'

// Fout zonder ruwe melding: alleen het stap-label gaat naar de log. De
// oorspronkelijke fout (met mogelijk de URL erin) wordt bewust niet als
// `cause` bewaard, zodat hij ook niet per ongeluk mee-gelogd kan worden.
export class PdfRenderFout extends Error {
  readonly stap: RenderStap
  constructor(stap: RenderStap) {
    super(`PDF-render mislukt (${stap})`)
    this.name = 'PdfRenderFout'
    this.stap = stap
  }
}

function originVan(url: string): string | null {
  try {
    const origin = new URL(url).origin
    // file:, data:, about: e.d. hebben origin 'null'.
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

// Pure allowlist-check: alleen exact dezelfde origin (protocol + host + poort)
// als een van de toegestane origins.
export function isToegestaneUrl(url: string, toegestaneOrigins: readonly string[]): boolean {
  const origin = originVan(url)
  if (!origin) return false
  return toegestaneOrigins.some((toegestaan) => originVan(toegestaan) === origin)
}

async function startBrowser(): Promise<Browser> {
  // VERCEL=1 is een systeemvariabele die Vercel zelf zet. Daar draait de
  // Linux-build van @sparticuz/chromium (Chromium 149, gelijk aan de major van
  // playwright-core 1.61). Lokaal: de al geïnstalleerde Playwright-browsers.
  if (process.env.VERCEL === '1') {
    const { default: sparticuz } = await import('@sparticuz/chromium')
    // Geen WebGL nodig voor een PDF; dan hoeft swiftshader ook niet uitgepakt
    // te worden (snellere cold start).
    sparticuz.setGraphicsMode = false
    return chromium.launch({
      executablePath: await sparticuz.executablePath(),
      args: sparticuz.args,
      headless: true,
      timeout: LAUNCH_TIMEOUT_MS,
    })
  }
  return chromium.launch({ headless: true, timeout: LAUNCH_TIMEOUT_MS })
}

async function stap<T>(naam: RenderStap, werk: () => Promise<T>): Promise<T> {
  try {
    return await werk()
  } catch {
    throw new PdfRenderFout(naam)
  }
}

export async function renderPdf(invoer: RenderInvoer): Promise<RenderUitkomst> {
  const eigenOrigin = originVan(invoer.siteUrl)
  if (!eigenOrigin) throw new PdfRenderFout('context')
  const toegestaan = invoer.supabaseOrigin ? [eigenOrigin, invoer.supabaseOrigin] : [eigenOrigin]
  // siteUrl heeft geen trailing slash (getSiteUrl normaliseert) en pad begint
  // met '/', dus simpel aaneenrijgen houdt een eventueel subpad van siteUrl
  // intact. De origin kan hierdoor niet veranderen: pad komt uit bouwDoelPad.
  const doelUrl = new URL(`${invoer.siteUrl}${invoer.pad}`)
  if (doelUrl.origin !== eigenOrigin) throw new PdfRenderFout('context')
  const doelPathname = doelUrl.pathname

  let browser: Browser | null = null
  let context: BrowserContext | null = null
  try {
    browser = await stap('launch', startBrowser)
    const b = browser

    context = await stap('context', async () => {
      const ctx = await b.newContext({
        viewport: VIEWPORT,
        colorScheme: 'light',
        locale: invoer.locale,
        timezoneId: invoer.timezoneId,
        serviceWorkers: 'block',
      })
      await ctx.addCookies(
        invoer.cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          // Host-only cookie voor precies de eigen origin, pad '/'.
          url: `${eigenOrigin}/`,
          httpOnly: true,
          secure: eigenOrigin.startsWith('https:'),
          sameSite: 'Lax' as const,
        })),
      )
      await ctx.route('**/*', (route) =>
        isToegestaneUrl(route.request().url(), toegestaan) ? route.continue() : route.abort(),
      )
      return ctx
    })
    const c = context

    const page = await stap('context', () => c.newPage())

    const resultaat = await stap('navigatie', async (): Promise<RenderUitkomst | null> => {
      const resp = await page.goto(doelUrl.href, { waitUntil: 'load', timeout: NAVIGATIE_TIMEOUT_MS })
      if (resp?.status() === 404) return { soort: 'niet_gevonden' }
      if (new URL(page.url()).pathname !== doelPathname) return { soort: 'niet_ingelogd' }
      if (!resp || resp.status() !== 200) return { soort: 'status' }

      // De root-loading.tsx laat elke pagina streamen: eerst het skelet, dan
      // de echte inhoud in Suspense-grenzen. Een notFound() of redirect() die
      // pas tijdens dat streamen valt, geeft daardoor GEEN 404/307 maar een
      // 200 met een marker in de HTML (Next:
      // server/app-render/make-get-server-inserted-html.js —
      // `robots noindex` bij notFound/forbidden/unauthorized, en
      // `#__next-page-redirect` bij redirect). De app zet zelf nergens robots-
      // metadata, dus de noindex-marker komt alleen uit die foutroute.
      const marker = await page.evaluate(() => ({
        nietGevonden: document.querySelector('meta[name="robots"][content="noindex"]') !== null,
        redirect: document.getElementById('__next-page-redirect') !== null,
      }))
      if (marker.nietGevonden) return { soort: 'niet_gevonden' }
      if (marker.redirect) return { soort: 'niet_ingelogd' }

      // Wachten tot React alle gestreamde Suspense-grenzen heeft ingevoegd
      // (een openstaande grens staat als <template id="B:…">, de nog niet
      // geplaatste inhoud als <div hidden id="S:…">). Anders kan de PDF het
      // skelet bevatten in plaats van de pagina.
      await page.waitForFunction(
        () => document.querySelector('template[id^="B:"], div[hidden][id^="S:"]') === null,
        undefined,
        { timeout: STREAM_TIMEOUT_MS },
      )
      await page.evaluate(async () => {
        await document.fonts.ready
      })
      // Afbeeldingen (clublogo) zijn best effort: een trage of geblokkeerde
      // afbeelding mag de PDF niet tegenhouden.
      await page
        .waitForFunction(() => Array.from(document.images).every((img) => img.complete), undefined, {
          timeout: AFBEELDINGEN_TIMEOUT_MS,
        })
        .catch(() => undefined)
      return null
    })
    if (resultaat) return resultaat

    const pdf = await stap('pdf', async () => {
      await page.emulateMedia({ media: 'print' })
      // preferCSSPageSize: @page { margin: 12mm } en de named page
      // `@page squad { margin: 0 }` uit globals.css blijven leidend.
      return page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
    })
    return { soort: 'pdf', pdf }
  } finally {
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
  }
}
