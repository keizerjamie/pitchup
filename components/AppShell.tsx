'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Navigation from '@/components/Navigation'
import SidebarNav from '@/components/SidebarNav'
import PageTransition from '@/components/PageTransition'
import GlobalFab from '@/components/GlobalFab'
import ThemeToggle from '@/components/ThemeToggle'

export default function AppShell({
  children,
  teamName,
  userEmail,
}: {
  children: React.ReactNode
  teamName: string | null
  userEmail: string | null
}) {
  const pathname = usePathname()
  const isAuthPage = pathname === '/login' || pathname === '/register' ||
    pathname === '/forgot-password' || pathname === '/reset-password'

  // Auth pages render full-screen without app chrome — otherwise the hidden
  // sidebar (incl. its logout form) stays in the DOM and tab order.
  if (isAuthPage) {
    return <main>{children}</main>
  }

  return (
    <>
      {/* ── Desktop sidebar (light) ── */}
      <div
        className="anchor-sidebar hidden md:flex md:fixed md:inset-y-0 md:w-64 md:flex-col bg-surface"
        style={{ borderRight: '1px solid var(--border-soft)' }}
      >
        {/* Logo + team */}
        <Link href="/" className="flex items-center gap-3 px-5 pt-6 pb-5">
          <div
            className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
            style={{ background: 'var(--color-brand)', boxShadow: '0 8px 20px -8px rgba(13,61,56,.5)' }}
          >
            <Image src="/logo.png" alt="Pitchup" width={40} height={40} />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="font-display font-bold text-ink text-lg tracking-tight">Pitchup</span>
            {teamName && (
              <span className="text-[11.5px] font-semibold text-faint truncate">{teamName}</span>
            )}
          </div>
        </Link>

        <SidebarNav teamName={teamName} userEmail={userEmail} />
      </div>

      {/* ── Mobile header ── */}
      <div
        className="anchor-mobile-header md:hidden fixed top-0 left-0 right-0 z-40 bg-surface"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          borderBottom: '1px solid var(--border-soft)',
        }}
      >
        <div className="flex items-center px-4 h-14 gap-3">
          <Link href="/" className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
              style={{ background: 'var(--color-brand)' }}
            >
              <Image src="/logo.png" alt="Pitchup" width={32} height={32} />
            </div>
            <span className="font-display font-bold text-ink text-base tracking-tight">Pitchup</span>
          </Link>
          <ThemeToggle className="ml-auto" />
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="md:ml-64">
        <main className="min-h-screen pb-40 md:pb-8 pt-[calc(env(safe-area-inset-top)_+_3.5rem)] md:pt-0">
          <PageTransition>
            {children}
          </PageTransition>
        </main>
      </div>

      <Navigation />
      <GlobalFab />
    </>
  )
}
