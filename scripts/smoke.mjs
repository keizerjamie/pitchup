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

  console.log(`\n${failures === 0 ? 'All smoke checks passed.' : `${failures} check(s) failed.`}`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((err) => {
  console.error('Smoke test could not run:', err.message)
  console.error(`Is the server running at ${BASE}?`)
  process.exit(1)
})
