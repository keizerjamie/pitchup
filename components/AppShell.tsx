'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Navigation from '@/components/Navigation'
import SidebarNav from '@/components/SidebarNav'
import PageTransition from '@/components/PageTransition'
import GlobalFab from '@/components/GlobalFab'

export default function AppShell({ children }: { children: React.ReactNode }) {
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
      {/* Third background blob */}
      <div className="fixed pointer-events-none z-0" style={{
        top: '40%', left: '55%',
        width: 400, height: 400,
        background: 'radial-gradient(circle at center, rgba(74,222,128,0.10) 0%, transparent 65%)',
        borderRadius: '50%',
      }} />

      {/* ── Desktop sidebar ── */}
      <div
        className="anchor-sidebar hidden md:flex md:fixed md:inset-y-0 md:w-64 md:flex-col"
        style={{ background: 'linear-gradient(160deg, #0d3d38 0%, #082b26 100%)' }}
      >
        {/* Logo */}
        <div
          className="flex items-center gap-3 px-5 py-5"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 ring-2 ring-white/10">
            <Image src="/logo.png" alt="Pitchup" width={36} height={36} />
          </div>
          <span className="font-bold text-white text-lg tracking-tight">Pitchup</span>
        </div>

        <SidebarNav />
      </div>

      {/* ── Mobile header ── */}
      <div
        className="anchor-mobile-header md:hidden fixed top-0 left-0 right-0 z-40"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          background: '#0a2e2a',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div className="flex items-center px-4 h-14 gap-3">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 ring-1 ring-white/20">
              <Image src="/logo.png" alt="Pitchup" width={32} height={32} />
            </div>
            <span className="font-bold text-white text-base tracking-tight">Pitchup</span>
          </Link>
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
