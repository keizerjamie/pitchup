'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useDict } from '@/lib/i18n-context'
import { useReducedMotion } from '@/lib/use-reduced-motion'

const TAB_COUNT = 4
const PILL_INSET = 6 // px gap on each side of the pill within its tab slot

export default function Navigation() {
  const pathname = usePathname()
  const t = useDict()
  const reduceMotion = useReducedMotion()
  const trackRef = useRef<HTMLDivElement>(null)
  const [tabWidth, setTabWidth] = useState(0)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setTabWidth(entry.contentRect.width / TAB_COUNT))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (pathname === '/login' || pathname === '/register') return null

  const tabs = [
    { href: '/',         label: t.nav.dashboard, icon: 'space_dashboard' },
    { href: '/players',  label: t.nav.players,   icon: 'groups' },
    { href: '/events',   label: t.nav.calendar,  icon: 'calendar_month' },
    { href: '/settings', label: t.nav.settings,  icon: 'settings' },
  ]

  const activeIndex = tabs.findIndex((tab) =>
    tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
  )

  return (
    <div
      className="anchor-bottom-nav fixed bottom-0 left-0 right-0 z-50 md:hidden px-3"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 10px)' }}
    >
      <div
        className="relative rounded-2xl overflow-hidden bg-surface"
        style={{
          boxShadow: '0 8px 32px -12px rgba(10,46,42,0.28), 0 1px 0 rgba(255,255,255,0.9) inset',
          border: '1px solid var(--border-soft)',
        }}
      >
        {/* Sliding active pill — GPU-composited transform, not left/width */}
        {activeIndex >= 0 && tabWidth > 0 && (
          <div
            className="absolute top-1.5 bottom-1.5 left-0 rounded-xl"
            style={{
              background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
              width: tabWidth - PILL_INSET * 2,
              transform: `translateX(${activeIndex * tabWidth + PILL_INSET}px)`,
              transition: reduceMotion ? 'none' : 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          />
        )}

        <div ref={trackRef} className="flex h-[62px]">
          {tabs.map((tab, i) => {
            const active = i === activeIndex
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 relative z-10 transition-colors duration-200 ${
                  active ? 'text-brand-accent' : 'text-faint'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <span className="ms text-[24px]">{tab.icon}</span>
                <span className={`text-[10px] font-semibold tracking-tight leading-none ${active ? '' : 'opacity-80'}`}>
                  {tab.label}
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
