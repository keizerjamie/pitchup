// Dependency-free smoke test. Run against a running server:
//   npm run build && npm start &   (or: npm run dev)
//   SMOKE_URL=http://localhost:3000 node scripts/smoke.mjs
// Exits non-zero on the first failed check. No database mutations, no auth
// required — catches "the app is fundamentally broken" regressions.

const BASE = process.env.SMOKE_URL ?? 'http://localhost:3000'

let failures = 0
function check(name, ok, detail = '') {
  const status = ok ? 'PASS' : 'FAIL'
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function run() {
  // 1. Login page renders with its form
  {
    const res = await fetch(`${BASE}/login`)
    const body = await res.text()
    check('GET /login is 200', res.status === 200, `status ${res.status}`)
    check('login page has email + password fields',
      body.includes('name="email"') && body.includes('name="password"'))
  }

  // 2. Unauthenticated root redirects to /login (proxy auth guard)
  {
    const res = await fetch(`${BASE}/`, { redirect: 'manual' })
    const location = res.headers.get('location') ?? ''
    check('unauthenticated / redirects to /login',
      [302, 303, 307].includes(res.status) && location.includes('/login'),
      `status ${res.status}, location "${location}"`)
  }

  // 3. Security headers are present
  {
    const res = await fetch(`${BASE}/login`)
    check('Content-Security-Policy header present', !!res.headers.get('content-security-policy'))
    check('X-Frame-Options is DENY', res.headers.get('x-frame-options') === 'DENY')
  }

  // 4. Favicon is served
  {
    const res = await fetch(`${BASE}/icon.png`)
    check('GET /icon.png is 200 image',
      res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('image/'),
      `status ${res.status}, type ${res.headers.get('content-type')}`)
  }

  // 5. Calendar page is auth-guarded — unauthenticated /events redirects to /login
  {
    const res = await fetch(`${BASE}/events`, { redirect: 'manual' })
    const location = res.headers.get('location') ?? ''
    check('unauthenticated /events redirects to /login',
      [302, 303, 307].includes(res.status) && location.includes('/login'),
      `status ${res.status}, location "${location}"`)
  }

  // 6. Invite landing (brief §5.1 punt 3): /invite/* moet publiek bereikbaar
  // zijn (proxy.ts isPublicPath) — een niet-ingelogde bezoeker mag NIET naar
  // /login geduwd worden, anders is de hele uitnodigingsflow onbereikbaar. Een
  // willekeurige/ongeldige token geeft peek_team_invite() altijd 'invalid'
  // terug (brief §1.6: geen onderscheid, geen teamnaam) — de pagina moet dus
  // de neutrale melding tonen en NOOIT de "account aanmaken/inloggen"-takken
  // die alleen bij een geldig token horen (die zouden een teamnaam tonen).
  {
    const randomToken = 'zZ9' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    const res = await fetch(`${BASE}/invite/${randomToken}`, { redirect: 'manual' })
    const location = res.headers.get('location') ?? ''
    const redirectsToLogin = [302, 303, 307].includes(res.status) && location.includes('/login')
    check('unauthenticated /invite/<random-token> does NOT redirect to /login',
      !redirectsToLogin, `status ${res.status}, location "${location}"`)

    const body = res.status === 200 ? await res.text() : ''
    check('GET /invite/<random-token> is 200', res.status === 200, `status ${res.status}`)
    check('invite page for an invalid token shows the neutral message',
      body.includes('Deze uitnodiging is niet (meer) geldig'))
    // Bewijs dat er geen teamnaam kon lekken: de takken die een teamnaam tonen
    // (account aanmaken / al een account) horen bij status 'ok' en mogen bij
    // een ongeldig token niet renderen.
    check('invite page for an invalid token contains no team name (no "ok" branch rendered)',
      !body.includes('Account aanmaken') && !body.includes('Ik heb al een account'))
  }

  console.log(`\n${failures === 0 ? 'All smoke checks passed.' : `${failures} check(s) failed.`}`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((err) => {
  console.error('Smoke test could not run:', err.message)
  console.error(`Is the server running at ${BASE}?`)
  process.exit(1)
})
