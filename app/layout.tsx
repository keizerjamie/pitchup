import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, Manrope, Archivo_Black } from 'next/font/google'
import './globals.css'
import AppShell from '@/components/AppShell'
import InactivityLogout from '@/components/InactivityLogout'
import { getDict } from '@/lib/i18n'
import { DictProvider } from '@/lib/i18n-context'
import { createClient } from '@/lib/supabase/server'
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
  const [t, supabase] = await Promise.all([getDict(), createClient()])

  // Team + user context for the sidebar chrome (read-only, tenant-scoped).
  // Null on auth pages where there is no session — AppShell hides chrome there.
  const { data: { user } } = await supabase.auth.getUser()
  let teamName: string | null = null
  let teamLogoUrl: string | null = null
  if (user) {
    const { data } = await supabase
      .from('settings')
      .select('key, value')
      .eq('team_id', user.id)
      .in('key', ['team_name', 'team_logo_url'])
    for (const row of data ?? []) {
      if (row.key === 'team_name') teamName = row.value?.trim() || null
      else if (row.key === 'team_logo_url') teamLogoUrl = row.value || null
    }
  }

  return (
    <html lang={t.locale} className={`${display.variable} ${body.variable} ${pdfDisplay.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the saved/system theme before first paint to avoid a flash.
            Rendered into <head> so it runs before the body renders. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var s=localStorage.getItem('theme');var pref=s||'system';var t=(pref!=='system')?pref:((window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light');var e=document.documentElement;e.setAttribute('data-theme',t);e.setAttribute('data-theme-pref',pref);}catch(e){}})();",
          }}
        />
      </head>
      <body>
        <DictProvider dict={t}>
          <ThemeInit />
          <AppShell teamName={teamName} teamLogoUrl={teamLogoUrl} userEmail={user?.email ?? null}>{children}</AppShell>
          <InactivityLogout />
        </DictProvider>
      </body>
    </html>
  )
}
