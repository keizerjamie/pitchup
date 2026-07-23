'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useDict } from '@/lib/i18n-context'
import { signOut } from '@/app/actions/auth'
import ThemeToggle from '@/components/ThemeToggle'

// Prettify the email local-part into a display name + initials for the
// user chip. We only store the email, so this is the best honest label.
function personFromEmail(email: string | null): { name: string; initials: string } {
  if (!email) return { name: 'Account', initials: '👤' }
  const local = email.split('@')[0]
  const words = local.split(/[.\-_]+/).filter(Boolean)
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || local
  const initials = (words.length >= 2
    ? words[0][0] + words[1][0]
    : local.slice(0, 2)).toUpperCase()
  return { name, initials }
}

export default function SidebarNav({
  teamName,
  userEmail,
}: {
  teamName: string | null
  userEmail: string | null
}) {
  const pathname = usePathname()
  const t = useDict()
  const { name, initials } = personFromEmail(userEmail)

  const items = [
    { href: '/',              label: t.nav.dashboard,     icon: 'space_dashboard' },
    { href: '/players',       label: t.nav.players,       icon: 'groups' },
    { href: '/events',        label: t.nav.calendar,      icon: 'calendar_month' },
    { href: '/periodisering', label: t.nav.periodization, icon: 'monitoring' },
    { href: '/settings',      label: t.nav.settings,      icon: 'settings' },
  ]

  return (
    <>
      <nav className="flex-1 px-3 py-2 space-y-1">
        {items.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold tracking-tight transition-colors duration-200 ${
                active
                  ? 'text-ink'
                  : 'text-muted hover:bg-surface-sunken hover:text-ink'
              }`}
              style={active ? { background: 'color-mix(in srgb, var(--primary) 12%, transparent)' } : undefined}
              aria-current={active ? 'page' : undefined}
            >
              <span className={`ms text-[22px] ${active ? 'text-brand-accent' : 'text-faint'}`}>
                {item.icon}
              </span>
              <span className="flex-1">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* User chip + logout */}
      <div className="px-3 pb-5 pt-2">
        <div
          className="flex items-center gap-3 p-2.5 rounded-2xl bg-surface-sunken"
          style={{ border: '1px solid var(--border-soft)' }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold font-display flex-shrink-0"
            style={{ background: 'var(--primary)' }}
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="flex flex-col leading-tight flex-1 min-w-0">
            <span className="text-[13.5px] font-bold text-ink truncate">{name}</span>
            <span className="text-[11.5px] font-semibold text-faint truncate">
              {teamName ?? t.settings.logout}
            </span>
          </div>
          <div className="flex items-center flex-shrink-0">
            <ThemeToggle />
            <form action={signOut}>
              <button
                type="submit"
                title={t.settings.logout}
                aria-label={t.settings.logout}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-faint hover:text-ink hover:bg-surface transition-colors"
              >
                <span className="ms text-[20px]">logout</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  )
}
