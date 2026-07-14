'use client'

import { useState, useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useDict } from '@/lib/i18n-context'

const PlusIcon = () => (
  <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth={2.25} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
)

const TrainingIcon = () => (
  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const MatchIcon = () => (
  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
  </svg>
)

const PlayerIcon = () => (
  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
)

const ChevronRight = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
)

const emptySubscribe = () => () => {}

export default function GlobalFab() {
  const t = useDict()
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  // true after hydration on the client, false during SSR — portal-safe
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  function openMenu() {
    setOpen(true)
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
  }

  function closeMenu() {
    setVisible(false)
    setTimeout(() => setOpen(false), 300)
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') closeMenu() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const items = [
    {
      label: t.event.createTraining,
      href: '/events/new?type=training',
      icon: <TrainingIcon />,
      color: '#16a34a',
      bg: 'rgba(22,163,74,0.12)',
    },
    {
      label: t.event.createMatch,
      href: '/events/new?type=match',
      icon: <MatchIcon />,
      color: '#2563eb',
      bg: 'rgba(37,99,235,0.12)',
    },
    {
      label: t.players.add,
      href: '/players/new',
      icon: <PlayerIcon />,
      color: '#0891b2',
      bg: 'rgba(8,145,178,0.12)',
    },
  ]

  const overlay = open && mounted ? createPortal(
    <>
      {/* Full-screen backdrop — rendered in document.body, outside all stacking contexts */}
      <div
        onClick={closeMenu}
        style={{
          position: 'fixed', inset: 0, zIndex: 399,
          background: 'rgba(0,0,0,0.30)',
          backdropFilter: visible ? 'blur(16px)' : 'blur(0px)',
          WebkitBackdropFilter: visible ? 'blur(16px)' : 'blur(0px)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.25s ease, backdrop-filter 0.25s ease, -webkit-backdrop-filter 0.25s ease',
        }}
      />

      {/* Menu card — opens upward from the FAB in the thumb zone */}
      <div
        style={{
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 156px)',
          right: 16,
          zIndex: 401,
          minWidth: 238,
          background: 'rgba(248,248,252,0.78)',
          backdropFilter: 'blur(40px) saturate(180%) brightness(1.06)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%) brightness(1.06)',
          border: '1px solid rgba(255,255,255,0.92)',
          borderRadius: 20,
          boxShadow: '0 8px 40px rgba(0,0,0,0.20), 0 2px 0 rgba(255,255,255,0.95) inset',
          transformOrigin: 'bottom right',
          transform: visible ? 'scale(1) translateY(0)' : 'scale(0.80) translateY(12px)',
          opacity: visible ? 1 : 0,
          transition: 'transform 0.34s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.22s ease',
          overflow: 'hidden',
        }}
      >
        {/* Specular highlight */}
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: 'inherit',
          background: 'linear-gradient(145deg, rgba(255,255,255,0.42) 0%, transparent 45%)',
        }} />

        {/* Section label */}
        <div style={{ padding: '11px 16px 9px', borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {t.fab.title}
          </span>
        </div>

        {/* Menu items */}
        {items.map((item, i) => (
          <Link
            key={item.href}
            href={item.href}
            transitionTypes={['nav-forward']}
            onClick={closeMenu}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 13,
              padding: '13px 16px',
              borderBottom: i < items.length - 1 ? '1px solid rgba(0,0,0,0.055)' : undefined,
              position: 'relative',
              zIndex: 1,
              textDecoration: 'none',
              opacity: visible ? 1 : 0,
              transform: visible ? 'translateX(0)' : 'translateX(16px)',
              transition: `opacity 0.28s ease ${80 + i * 55}ms, transform 0.34s cubic-bezier(0.34,1.56,0.64,1) ${80 + i * 55}ms`,
            }}
          >
            <div style={{
              width: 38, height: 38, borderRadius: 11,
              background: item.bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: item.color, flexShrink: 0,
            }}>
              {item.icon}
            </div>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', flex: 1 }}>
              {item.label}
            </span>
            <span style={{ color: 'rgba(0,0,0,0.22)', lineHeight: 0 }}>
              <ChevronRight />
            </span>
          </Link>
        ))}
      </div>
    </>,
    document.body
  ) : null

  return (
    <>
      {/* Floating action button — bottom right, in the one-handed thumb zone */}
      <button
        type="button"
        onClick={open ? closeMenu : openMenu}
        aria-label={t.fab.title}
        aria-expanded={open}
        className="md:hidden fixed w-14 h-14 rounded-full flex items-center justify-center active:scale-90"
        style={{
          right: 16,
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
          zIndex: 402,
          background: 'linear-gradient(160deg, #14655c 0%, #0d3d38 100%)',
          boxShadow: '0 4px 16px rgba(13,61,56,0.35), 0 1px 0 rgba(255,255,255,0.18) inset',
          color: 'white',
          transition: 'box-shadow 0.2s ease',
        }}
      >
        <span style={{
          display: 'block', lineHeight: 0,
          transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
          transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
        }}>
          <PlusIcon />
        </span>
      </button>

      {overlay}
    </>
  )
}
