import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development'
  const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin
  const supabaseWs = supabaseOrigin.replace('https://', 'wss://')

  return [
    `default-src 'self'`,
    // 'unsafe-eval' is dev-only: React uses eval for enhanced debugging there.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // 'unsafe-inline' is required: nonces cannot cover style *attributes*,
    // which the app uses extensively.
    `style-src 'self' 'unsafe-inline'`,
    // Supabase-origin is nodig voor het clublogo: dat komt uit Storage en wordt
    // met een gewone <img src="https://<ref>.supabase.co/storage/..."> geladen
    // (zie components/TeamLogo.tsx). Zonder deze bron blokkeert de browser de
    // afbeelding stil — zichtbaar in zijbalk én wedstrijdselectie-PDF.
    `img-src 'self' blob: data: ${supabaseOrigin}`,
    `font-src 'self'`,
    `connect-src 'self' ${supabaseOrigin} ${supabaseWs}${isDev ? ' ws:' : ''}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : [`upgrade-insecure-requests`]),
  ].join('; ')
}

// Paden die zonder sessie bereikbaar moeten blijven.
//
// `/invite/*` staat hier omdat de hele uitnodigingsflow anders onbereikbaar
// is: een genodigde zonder account zou naar /login geduwd worden en de link
// nooit kunnen openen. De pagina daarachter toont alleen de teamnaam bij een
// geldig token (peek_team_invite) en verder niets.
//
// Pure functie zodat proxy.test.ts hem kan afdekken zonder een hele
// NextRequest en een Supabase-sessie na te bouwen.
export function isPublicPath(path: string): boolean {
  // Reset page must stay reachable in both states: the recovery link arrives
  // without cookies, and completing it happens with a recovery session.
  return path.startsWith('/reset-password')
    || path === '/invite'
    || path.startsWith('/invite/')
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce)

  // On the *request* so Next.js picks up the nonce for its inline scripts.
  request.headers.set('x-nonce', nonce)
  request.headers.set('content-security-policy', csp)

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isAuthPage = path.startsWith('/login') || path.startsWith('/register') ||
    path.startsWith('/forgot-password')

  // Redirect responses must carry any refreshed auth cookies, otherwise the
  // rotated refresh token is lost and the session breaks.
  function redirectWithCookies(pathname: string) {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    const response = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
    setSecurityHeaders(response, csp)
    return response
  }

  if (!user && !isAuthPage && !isPublicPath(path)) return redirectWithCookies('/login')
  if (user && isAuthPage) return redirectWithCookies('/')

  setSecurityHeaders(supabaseResponse, csp)
  return supabaseResponse
}

// `same-origin` zorgt dat de browser bij een klik naar een EXTERN domein geen
// Referer meestuurt — en dus ook niet het uitnodigingstoken dat in het pad
// /invite/<token> staat. Zonder deze header lekt zo'n token naar elke externe
// link die ooit op een pagina komt te staan.
//
// App-breed en niet alleen op /invite: een security-header die per pad
// aan- en uitgaat is een header die iemand vergeet.
function setSecurityHeaders(response: NextResponse, csp: string) {
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('Referrer-Policy', 'same-origin')
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|manifest.json|icons|icon.png|apple-icon.png|icon-192.png|icon-512.png|apple-touch-icon.png).*)'],
}
