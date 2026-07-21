import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

function buildCsp(nonce: string): string {
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
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self' ${supabaseOrigin} ${supabaseWs}${isDev ? ' ws:' : ''}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : [`upgrade-insecure-requests`]),
  ].join('; ')
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
  // Reset page must stay reachable in both states: the recovery link arrives
  // without cookies, and completing it happens with a recovery session.
  const isResetPage = path.startsWith('/reset-password')

  // Redirect responses must carry any refreshed auth cookies, otherwise the
  // rotated refresh token is lost and the session breaks.
  function redirectWithCookies(pathname: string) {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    const response = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
    return response
  }

  if (!user && !isAuthPage && !isResetPage) return redirectWithCookies('/login')
  if (user && isAuthPage) return redirectWithCookies('/')

  supabaseResponse.headers.set('Content-Security-Policy', csp)
  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|manifest.json|icons|icon.png|apple-icon.png|icon-192.png|icon-512.png|apple-touch-icon.png).*)'],
}
