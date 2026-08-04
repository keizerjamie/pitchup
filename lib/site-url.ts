// Vaste, server-side geconfigureerde basis-URL van de app.
//
// Bewust NIET afgeleid van de `origin`/`Host`-request-header: die is door de
// client te sturen en zou een aanvaller de kans geven om links in mails (bijv.
// de wachtwoord-hersteltoken) naar een eigen domein te laten wijzen.
// Configureer `NEXT_PUBLIC_SITE_URL` (zie DEPLOY.md).

const DEV_FALLBACK = 'http://localhost:3000'

// Retourneert de genormaliseerde basis-URL (zonder trailing slash), of null
// wanneer er geen bruikbare configuratie is. Callers beslissen zelf hoe ze
// daarop reageren; ze mogen nooit terugvallen op een header.
export function getSiteUrl(): string | null {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim()

  if (!configured) {
    // Buiten productie is de lokale dev-server een veilige, vaste aanname.
    return process.env.NODE_ENV === 'production' ? null : DEV_FALLBACK
  }

  return normalize(configured)
}

function normalize(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}
