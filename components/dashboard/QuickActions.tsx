import Link from 'next/link'
import type { Dict } from '@/messages/nl'

// Four shortcut tiles to the most common actions — all real routes.
export default function QuickActions({ t }: { t: Dict }) {
  const actions = [
    { href: '/events/new', icon: 'add_circle', label: t.home.qaNewEvent },
    { href: '/players/new', icon: 'person_add', label: t.home.qaAddPlayer },
    { href: '/events',      icon: 'calendar_month', label: t.home.qaCalendar },
    { href: '/periodisering', icon: 'monitoring', label: t.home.qaPeriodization },
  ]
  return (
    <div className="surface-card p-4 flex flex-col gap-3">
      <span className="font-display text-[15px] font-bold text-ink">{t.home.quickActions}</span>
      <div className="grid grid-cols-4 gap-2.5">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex flex-col items-center gap-2 py-3 px-1 rounded-[13px] bg-surface-sunken transition-colors hover:bg-white"
            style={{ border: '1px solid var(--border-soft)' }}
          >
            <span className="ms text-[23px] text-brand-accent">{a.icon}</span>
            <span className="text-[11.5px] font-bold text-muted text-center leading-tight">{a.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
