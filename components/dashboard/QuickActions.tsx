import Link from 'next/link'
import type { Dict } from '@/messages/nl'

// Zes snelkoppelingen naar de meest gebruikte routes — bewust een rustige
// 3×2-grid (de oude grid-cols-4 brak de zes tegels in een rommelige 4+2-rij).
export default function QuickActions({ t }: { t: Dict }) {
  const actions = [
    { href: '/events/new', icon: 'add_circle', label: t.home.qaNewEvent },
    { href: '/players/new', icon: 'person_add', label: t.home.qaAddPlayer },
    { href: '/events',      icon: 'calendar_month', label: t.home.qaCalendar },
    { href: '/oefeningen',  icon: 'sports_soccer', label: t.home.qaOefeningen },
    { href: '/periodisering', icon: 'monitoring', label: t.home.qaPeriodization },
    // 'scoreboard' zit (net als de overige iconen hierboven) in de gesubsette
    // Material Symbols-font (public/fonts/material-symbols-rounded.woff2) —
    // geverifieerd via de GSUB-ligatuurtabel, want een ontbrekende glyph
    // toont anders letterlijk de tekst i.p.v. een icoon (zie ChartBarIcon.tsx).
    { href: '/inzichten', icon: 'scoreboard', label: t.home.qaInsights },
  ]
  return (
    <div className="surface-card p-4 flex flex-col gap-3">
      <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint">{t.home.quickActions}</span>
      <div className="grid grid-cols-3 gap-2">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex flex-col items-center gap-1.5 py-2.5 px-1 rounded-[12px] bg-surface-sunken transition-colors hover:bg-surface active:scale-[0.98]"
            style={{ border: '1px solid var(--border-soft)' }}
          >
            <span className="ms text-[21px] text-brand-accent">{a.icon}</span>
            <span className="text-[11px] font-bold text-muted text-center leading-tight">{a.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
