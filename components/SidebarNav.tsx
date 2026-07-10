'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useDict } from '@/lib/i18n-context'
import { signOut } from '@/app/actions/auth'

const icons = {
  home: (active: boolean) => (
    <svg className="w-5 h-5 flex-shrink-0" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  ),
  players: (active: boolean) => (
    <svg className="w-5 h-5 flex-shrink-0" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
  calendar: (active: boolean) => (
    <svg className="w-5 h-5 flex-shrink-0" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
    </svg>
  ),
  periodization: (active: boolean) => (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={active ? 2.25 : 1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
    </svg>
  ),
  settings: (active: boolean) => (
    <svg className="w-5 h-5 flex-shrink-0" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
}

export default function SidebarNav() {
  const pathname = usePathname()
  const t = useDict()

  const items = [
    { href: '/',         label: t.nav.dashboard, icon: icons.home },
    { href: '/players',  label: t.nav.players,   icon: icons.players },
    { href: '/events',   label: t.nav.calendar,  icon: icons.calendar },
    { href: '/periodisering', label: t.nav.periodization, icon: icons.periodization },
    { href: '/settings', label: t.nav.settings,  icon: icons.settings },
  ]

  return (
    <>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {items.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 ${
                active
                  ? 'bg-white/18 text-white'
                  : 'text-white/55 hover:bg-white/10 hover:text-white/90'
              }`}
            >
              {item.icon(active)}
              <span>{item.label}</span>
              {active && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
              )}
            </Link>
          )
        })}
      </nav>

      <div className="px-3 pb-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest px-3 pt-4 pb-2">{t.fab.title}</p>
        {[
          { href: '/events/new?type=training', label: t.event.createTraining, color: 'text-green-400' },
          { href: '/events/new?type=match',    label: t.event.createMatch,    color: 'text-blue-400' },
          { href: '/players/new',              label: t.players.add,          color: 'text-purple-400' },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 hover:bg-white/10 ${item.color}`}
          >
            <span className="text-base leading-none">+</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </div>

      <div className="px-3 pb-5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <form action={signOut} className="pt-4">
          <button
            type="submit"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/40 hover:bg-white/10 hover:text-white/70 font-medium text-sm transition-all duration-200 w-full"
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            {t.settings.logout}
          </button>
        </form>
      </div>
    </>
  )
}
