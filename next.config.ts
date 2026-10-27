import type { NextConfig } from "next";

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

// Next 16.3: `experimental.viewTransition` bestaat niet meer — React's
// <ViewTransition> werkt in de App Router zonder configuratie
// (node_modules/next/dist/docs/01-app/02-guides/view-transitions.md).
const nextConfig: NextConfig = {
  // GET /api/pdf (Delen als PDF): @sparticuz/chromium leest zijn gecomprimeerde
  // Chromium-binary via `fs` uit zijn eigen bin/-map. Zo'n runtime-pad ziet de
  // file tracer mogelijk niet, en dan ontbreekt de binary in de functiebundel
  // ("The input directory .../bin does not exist"). Of dit strikt nodig is,
  // blijkt uit de preview-build; schaden doet het niet
  // (node_modules/next/dist/docs/01-app/03-api-reference/05-config/
  // 01-next-config-js/output.md, outputFileTracingIncludes).
  // Hetzelfde geldt voor playwright-core: lib/coreBundle.js doet
  // `require(path.join(packageRoot, "browsers.json"))`. Zonder deze regel
  // faalde elke render op Vercel met "Cannot find module
  // .../playwright-core/browsers.json" (2026-10-27). Het hele pakket, zodat
  // een volgend dynamisch pad niet opnieuw ontbreekt.
  outputFileTracingIncludes: {
    '/api/pdf': [
      './node_modules/@sparticuz/chromium/bin/**',
      './node_modules/playwright-core/**',
    ],
  },
  experimental: {
    serverActions: {
      // Server-action-bodies zijn standaard op 1MB gecapt. Het clublogo mag 2MB
      // zijn (MAX_LOGO_BYTES / de bucket-limiet), en multipart/form-data telt
      // daar nog boundaries en part-headers bovenop — vandaar 3mb i.p.v. exact
      // 2mb (node_modules/next/dist/docs/01-app/03-api-reference/05-config/
      // 01-next-config-js/serverActions.md). Dit is een bovengrens op de
      // request, niet op wat we accepteren: de echte controle staat in
      // uploadTeamLogo.
      bodySizeLimit: '3mb',
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
};

export default nextConfig;
