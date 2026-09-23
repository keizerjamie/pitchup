'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Navigation from '@/components/Navigation'
import SidebarNav from '@/components/SidebarNav'
import PageTransition from '@/components/PageTransition'
import GlobalFab from '@/components/GlobalFab'
import ThemeToggle from '@/components/ThemeToggle'
import TeamLogo from '@/components/TeamLogo'
import TeamSwitcher from '@/components/TeamSwitcher'
import { TeamContextClientProvider } from '@/lib/team-context-client'
import type { TeamLidmaatschap } from '@/lib/team-context'
import type { TeamRechten, TeamRol } from '@/lib/team-rechten'

interface Props {
  children: React.ReactNode
  // De lege staat (AC 16/52), AL SERVER-SIDE gerenderd/geresolved in
  // app/layout.tsx en hier als kant-en-klaar element doorgegeven — NOOIT
  // `<EmptyTeamState />` hier zelf neerzetten. EmptyTeamState is een async
  // server component (leest getDict()); AppShell is 'use client', en "alles
  // wat een 'use client'-bestand direct rendert, zit in de clientbundel"
  // (Next-documentatie). Als prop/children doorgegeven component wordt
  // vooraf door Next's RSC-pipeline server-side geresolved — dat is het enige
  // ondersteunde patroon voor een async server component naast een client
  // component. `null` zolang er een team is; layout.tsx bouwt hem alleen op
  // wanneer dat nodig is. Verplicht (mag `null` zijn) — elke aanroeper moet
  // een bewuste keuze maken i.p.v. stilzwijgend op een default te leunen.
  emptyState: React.ReactNode
  teamName: string | null
  teamLogoUrl: string | null
  userEmail: string | null
  // Team + rechten van de huidige sessie. `hasTeam` staat los van `teams`
  // etc. te controleren (ipv "teams.length > 0") omdat getTeamContext() ook
  // `null` teruggeeft voor "niet ingelogd" — AppShell zelf onderscheidt dat
  // niet (proxy.ts stuurt zo iemand toch al naar /login); alle drie de
  // waarden zijn hier daarom altijd samen aanwezig of samen afwezig.
  hasTeam: boolean
  teamId: string | null
  rol: TeamRol | null
  rechten: TeamRechten | null
  teams: TeamLidmaatschap[]
}

export default function AppShell({
  children,
  emptyState,
  teamName,
  teamLogoUrl,
  userEmail,
  hasTeam,
  teamId,
  rol,
  rechten,
  teams,
}: Props) {
  const pathname = usePathname()
  const isAuthPage = pathname === '/login' || pathname === '/register' ||
    pathname === '/forgot-password' || pathname === '/reset-password'
  // Volle-scherm-layout zoals app/register/page.tsx, zonder app-chrome (brief
  // §4.4) — dit dekt zowel niet-ingelogde bezoekers (die zouden anders geen
  // zijbalk/nav moeten zien) als ingelogde bezoekers die een tweede
  // uitnodiging openen.
  const isInvitePage = pathname === '/invite' || pathname.startsWith('/invite/')

  // Auth- en invite-pages renderen zonder app chrome — anders blijft de
  // verborgen sidebar (incl. de uitlogknop) in de DOM en tab-volgorde staan.
  if (isAuthPage || isInvitePage) {
    return <main>{children}</main>
  }

  const teamCtxValue = hasTeam && teamId && rol && rechten ? { teamId, rol, rechten, teams } : null

  // AC 16/52: een sessie zonder enkel lidmaatschap krijgt de lege staat
  // i.p.v. de pagina-inhoud, en geen navigatie/FAB — behalve op /settings,
  // dat blijft bereikbaar zodat iemand kan uitloggen of zijn account kan
  // verwijderen (brief §4.2). De pagina zelf (die anders 'Geen team' zou
  // gooien via requireTeamContextOrLogin) wordt op de vervangen paden dus
  // helemaal niet gerenderd.
  const showEmptyState = !hasTeam && pathname !== '/settings'
  const showChrome = hasTeam

  return (
    <TeamContextClientProvider value={teamCtxValue}>
      {/* ── Desktop sidebar (light) ── */}
      <div
        className="anchor-sidebar hidden md:flex md:fixed md:inset-y-0 md:w-64 md:flex-col bg-surface"
        style={{ borderRight: '1px solid var(--border-soft)' }}
      >
        {/* Logo + team */}
        <Link href="/" className="flex items-center gap-3 px-5 pt-6 pb-5">
          <TeamLogo
            src={teamLogoUrl}
            size={40}
            alt={teamName ? `${teamName} logo` : 'Pitchup'}
            fallback={
              <div
                className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
                style={{ background: 'var(--color-brand)', boxShadow: '0 8px 20px -8px rgba(13,61,56,.5)' }}
              >
                <Image src="/logo.png" alt="Pitchup" width={40} height={40} />
              </div>
            }
          />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="font-display font-bold text-ink text-lg tracking-tight">Pitchup</span>
            {hasTeam && teamId && (
              <TeamSwitcher teams={teams} activeTeamId={teamId} variant="desktop" />
            )}
          </div>
        </Link>

        <SidebarNav teamName={teamName} userEmail={userEmail} hasTeam={hasTeam} />
      </div>

      {/* ── Mobile header ── */}
      <div
        className="anchor-mobile-header md:hidden fixed top-0 left-0 right-0 z-[var(--z-chrome)] bg-surface"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          borderBottom: '1px solid var(--border-soft)',
        }}
      >
        <div className="flex items-center px-4 h-14 gap-3">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <TeamLogo
              src={teamLogoUrl}
              size={32}
              alt={teamName ? `${teamName} logo` : 'Pitchup'}
              fallback={
                <div
                  className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
                  style={{ background: 'var(--color-brand)' }}
                >
                  <Image src="/logo.png" alt="Pitchup" width={32} height={32} />
                </div>
              }
            />
            <span className="font-display font-bold text-ink text-base tracking-tight flex-shrink-0">Pitchup</span>
          </Link>
          {hasTeam && teamId && (
            <TeamSwitcher teams={teams} activeTeamId={teamId} variant="mobile" />
          )}
          <ThemeToggle className="ml-auto" />
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="app-main md:ml-64">
        <main className="min-h-screen pb-40 md:pb-8 pt-[calc(env(safe-area-inset-top)_+_3.5rem)] md:pt-0">
          {showEmptyState ? emptyState : <PageTransition>{children}</PageTransition>}
        </main>
      </div>

      {/* Mobile bottom fade — laat de content naar de thema-achtergrond vervagen
          richting de zwevende navigatiebalk, zodat er niets scherp leesbaar
          achter/naast de balk doorschemert. Ligt boven de content maar onder de
          nav (z-50) en de FAB (z-402); pointer-events uit zodat taps doorgaan. */}
      <div
        aria-hidden="true"
        className="md:hidden fixed bottom-0 left-0 right-0 z-[var(--z-chrome)] pointer-events-none"
        style={{
          height: 'calc(env(safe-area-inset-bottom, 0px) + 112px)',
          background: 'linear-gradient(to top, var(--bg) 0%, var(--bg) 64%, transparent 100%)',
        }}
      />

      {showChrome && <Navigation />}
      {showChrome && <GlobalFab />}
    </TeamContextClientProvider>
  )
}
