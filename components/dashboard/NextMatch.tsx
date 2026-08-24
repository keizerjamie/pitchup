import Link from 'next/link'
import type { Dict } from '@/messages/nl'
import { FootballEvent } from '@/lib/types'
import { daysUntil, formatDate, formatTime } from '@/lib/utils'

// Compact "next match" tile — sits in the stat-card row and links to the match.
export default function NextMatch({ match, t }: { match: FootballEvent | null; t: Dict }) {
  const diff = match ? daysUntil(match.date) : null
  const rel = match && diff !== null
    ? (diff === 0 ? t.dashboard.today
      : diff === 1 ? t.dashboard.tomorrow
      : diff > 1 && diff <= 7 ? t.dashboard.inDays.replace('{n}', String(diff))
      : formatDate(match.date, t.browserLocale))
    : null
  const sub = match
    ? [rel, match.time ? formatTime(match.time) : null,
       match.home_away ? (match.home_away === 'home' ? t.calendar.homeLabel : t.calendar.awayLabel) : null]
      .filter(Boolean).join(' · ')
    : t.home.noMatch

  return (
    <Link
      href={match ? `/events/${match.id}` : '/events/new'}
      className="surface-card p-[17px] flex flex-col gap-2.5 h-full transition-[background-color,transform] active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-faint leading-[1.35]">{t.home.nextMatch}</span>
        <span className="ms text-[19px] text-brand-accent">emoji_events</span>
      </div>
      <div
        className={`font-display text-[20px] font-bold leading-tight truncate ${match ? 'text-ink' : 'text-faint'}`}
      >
        {match ? `vs ${match.opponent ?? '?'}` : '—'}
      </div>
      <span className="text-[11.5px] font-semibold text-faint truncate">{sub}</span>
    </Link>
  )
}
