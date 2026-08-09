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
