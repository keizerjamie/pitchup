import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { Space_Grotesk, Manrope, Archivo_Black } from 'next/font/google'
import './globals.css'
import AppShell from '@/components/AppShell'
import EmptyTeamState from '@/components/EmptyTeamState'
import InactivityLogout from '@/components/InactivityLogout'
import { getDict } from '@/lib/i18n'
import { DictProvider } from '@/lib/i18n-context'
import { createClient } from '@/lib/supabase/server'
import { getTeamContext } from '@/lib/team-context'
import ThemeInit from '@/components/ThemeInit'

// Display font for headings/numbers; body font for everything else.
// Both are variable fonts, exposed as CSS variables so globals.css owns the
// actual font-family assignment (see --font-display / --font-body).
const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' })
const body = Manrope({ subsets: ['latin'], variable: '--font-body' })
// PDF-only display font (wedstrijdselectie-export): "vierkanter" dan Space
// Grotesk, uitsluitend gebruikt door MatchSquadPrintList.tsx/MatchFormCards.tsx
// via .font-pdf-display (globals.css). Archivo Black heeft maar één statisch
// gewicht, dus `weight` is hier verplicht (i.t.t. de variable-fonts hierboven
// die een gewichtenrange ondersteunen). next/font/google's eigen typedefinitie
// (node_modules/next/dist/compiled/@next/font/dist/google/index.d.ts) labelt
// dat ene gewicht als '400', ondanks dat het lettertype visueel "black"/zwaar
// is — dat is hoe Google Fonts deze specifieke familie zelf categoriseert
// ("regular" is hier het enige/zwaarste beschikbare snit). '900' bestaat niet
// als optie en geeft een TS-typefout.
const pdfDisplay = Archivo_Black({ subsets: ['latin'], weight: ['400'], variable: '--font-pdf-display' })

export const metadata: Metadata = {
  title: 'Pitchup',
  description: 'Aanwezigheid, opstellingen en trainingen voor jouw team',
  manifest: '/manifest.json',
  // Favicon/apple-icon are handled by app/icon.png and app/apple-icon.png
  // (file convention); manifest keeps the 192/512 PWA icons.
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Pitchup' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0d3d38',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [t, supabase, headerList] = await Promise.all([getDict(), createClient(), headers()])

  // Nonce voor het theme-script hieronder. proxy.ts genereert per request een
  // nonce, zet die in de CSP én als `x-nonce` op de REQUEST-headers; Next
  // gebruikt hem daarmee automatisch voor zijn eigen inline scripts, maar een
  // zelfgeschreven <script> moet hem expliciet meekrijgen. Zonder dit blokkeert
  // de browser het script stil (alleen een CSP-violation in de console) en
  // flikkert de app bij elke navigatie kort in het verkeerde thema.
  //
  // `?? undefined` en niet `?? ''`: een leeg nonce-attribuut is zelf al een
  // CSP-mismatch. Ontbreekt de header (een pad buiten de proxy-matcher), dan
  // staat er ook geen CSP op die response en is het attribuut overbodig.
  const nonce = headerList.get('x-nonce') ?? undefined

  // Team + user context for the sidebar chrome (read-only, tenant-scoped).
  // Null on auth pages where there is no session — AppShell hides chrome there.
  //
  // De teamnaam komt uit getTeamContext(): die leest de lidmaatschappen én de
  // namen al in één keer, en kent het ACTIEVE team (de active_team-cookie,
  // getoetst aan de database). Het clublogo hangt niet aan de context maar aan
  // dat ene actieve team, en wordt daarom apart en team-gescoped opgehaald.
  const ctx = await getTeamContext()
  const { data: { user } } = await supabase.auth.getUser()
  const teamName = ctx?.teams.find((team) => team.teamId === ctx.teamId)?.naam.trim() || null
  let teamLogoUrl: string | null = null
  if (ctx) {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('team_id', ctx.teamId)
      .eq('key', 'team_logo_url')
      .maybeSingle()
    teamLogoUrl = (data?.value as string | undefined) || null
  }
  // hasTeam = ctx !== null (er is geen apart veld op TeamContext, zie de
  // backend-samenvatting fase 2 §4). Bij een sessie zonder enkel lidmaatschap
  // laat AppShell de lege staat zien i.p.v. children.
  const hasTeam = ctx !== null

  // EmptyTeamState (AC 16/52) is bewust HIER geconstrueerd, niet in
  // AppShell.tsx: AppShell is 'use client' en mag geen async server
  // component rechtstreeks renderen (die zou anders in de clientbundel
  // belanden, inclusief zijn next/headers-afhankelijkheid via getDict — zie
  // validatiebevinding 1). `<EmptyTeamState />` als kant-en-klaar element
  // als prop doorgeven aan een Client Component is wél het ondersteunde
  // patroon: Next's RSC-pipeline resolvet de async component hier server-side
  // vóór de overdracht naar AppShell. Alleen opbouwen als er ook echt geen
  // team is — scheelt een overbodige getDict()-aanroep in het normale pad.
  const emptyState = hasTeam ? null : <EmptyTeamState />

  return (
    <html lang={t.locale} className={`${display.variable} ${body.variable} ${pdfDisplay.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the saved/system theme before first paint to avoid a flash.
            Rendered into <head> so it runs before the body renders. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var s=localStorage.getItem('theme');var pref=s||'system';var t=(pref!=='system')?pref:((window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light');var e=document.documentElement;e.setAttribute('data-theme',t);e.setAttribute('data-theme-pref',pref);}catch(e){}})();",
          }}
        />
      </head>
      <body>
        <DictProvider dict={t}>
          <ThemeInit />
          <AppShell
            emptyState={emptyState}
            teamName={teamName}
            teamLogoUrl={teamLogoUrl}
            userEmail={user?.email ?? null}
            hasTeam={hasTeam}
            teamId={ctx?.teamId ?? null}
            rol={ctx?.rol ?? null}
            rechten={ctx?.rechten ?? null}
            teams={ctx?.teams ?? []}
          >
            {children}
          </AppShell>
          <InactivityLogout />
        </DictProvider>
      </body>
    </html>
  )
}
