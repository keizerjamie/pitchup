import Link from 'next/link'
import type { Dict } from '@/messages/nl'
import { FootballEvent } from '@/lib/types'
import { formatDateLong, formatTime, daysUntil } from '@/lib/utils'

// The dashboard centrepiece: a gradient card for the next event with signup
// ring. Works for both a match and a training (the CTA differs per kind).
// Two layouts: a compact mobile card and the full desktop card.
export default function DashboardHero({
  event,
  kind,
  title,
  t,
  present,
  absent,
  squadSize,
  primaryHref,
  primaryLabel,
  primaryIcon,
  secondaryHref,
  secondaryLabel,
}: {
  event: FootballEvent
  kind: 'match' | 'training'
  title: string
  t: Dict
  present: number
  absent: number
  squadSize: number
  primaryHref: string
  primaryLabel: string
  primaryIcon: string
  secondaryHref: string
  secondaryLabel: string
}) {
  const diff = daysUntil(event.date)
  const rel = diff === 0 ? t.dashboard.today
    : diff === 1 ? t.dashboard.tomorrow
    : diff > 1 && diff <= 7 ? t.dashboard.inDays.replace('{n}', String(diff))
    : null

  const noResponse = Math.max(0, squadSize - present - absent)
  const pct = squadSize > 0 ? Math.round((present / squadSize) * 100) : 0
  const kindLabel = kind === 'match' ? t.home.nextMatch : t.home.nextTraining

  // Compact date for mobile, e.g. "za 8 · 14:30".
  const shortDate = new Date(event.date + 'T00:00:00')
    .toLocaleDateString(t.browserLocale, { weekday: 'short', day: 'numeric' })
    .replace('.', '')
  const compactWhen = `${shortDate}${event.time ? ` · ${formatTime(event.time)}` : ''}`

  const locationText = event.location
    ? `${event.home_away ? `${event.home_away === 'home' ? t.calendar.homeLabel : t.calendar.awayLabel} · ` : ''}${event.location}`
    : null

  return (
    <div
      className="rounded-[20px] lg:rounded-[22px] overflow-hidden relative p-[18px] lg:px-7 lg:py-6 text-white"
      style={{ background: 'linear-gradient(125deg,#0a2e2a 0%,#0d3d38 45%,#14655c 100%)' }}
    >
      <div
        aria-hidden="true"
        className="absolute pointer-events-none w-[150px] h-[150px] lg:w-[260px] lg:h-[260px]"
        style={{
          right: -30, top: -30, borderRadius: '50%',
          background: 'radial-gradient(circle,rgba(74,222,128,.28),transparent 65%)',
        }}
      />

      {/* ── Mobile (compact) ── */}
      <div className="lg:hidden relative flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-[10px] font-extrabold tracking-[.12em] uppercase px-2.5 py-1 rounded-full"
            style={{ color: '#4ade80', background: 'rgba(74,222,128,.16)' }}
          >
            {kindLabel}
          </span>
          <span className="text-[12px] font-semibold" style={{ color: '#9fd8cd' }}>
            {rel ?? compactWhen}
          </span>
        </div>

        <div className="font-display text-[20px] font-bold leading-tight">{title}</div>

        {locationText && (
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: '#9fd8cd' }}>
            <span className="ms text-[16px]">location_on</span>
            {locationText}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap mt-0.5">
          <div className="flex items-center gap-2">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: `conic-gradient(#4ade80 0 ${pct}%, rgba(255,255,255,.14) ${pct}% 100%)` }}
            >
              <div
                className="w-[26px] h-[26px] rounded-full flex items-center justify-center font-display text-[10px] font-bold"
                style={{ background: '#0c352f', color: '#eafff4' }}
              >
                {present}
              </div>
            </div>
            <span className="text-[12px] font-semibold" style={{ color: '#cbe8e0' }}>
              {present}/{squadSize} {t.home.present}
            </span>
          </div>
          <Link
            href={primaryHref}
            className="h-9 rounded-[11px] px-3.5 flex items-center gap-1.5 text-[12.5px] font-bold text-white"
            style={{ background: 'var(--primary)' }}
          >
            <span className="ms text-[17px]">{primaryIcon}</span>
            {primaryLabel}
          </Link>
        </div>
      </div>

      {/* ── Desktop (full) ── */}
      <div className="hidden lg:flex relative justify-between gap-7 items-stretch">
        <div className="flex flex-col gap-4 flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span
              className="text-[11px] font-extrabold tracking-[.14em] uppercase px-2.5 py-1 rounded-full"
              style={{ color: '#4ade80', background: 'rgba(74,222,128,.14)' }}
            >
              {kindLabel}
            </span>
            <span className="text-[13px] font-semibold" style={{ color: '#9fd8cd' }}>
              {rel ? `${rel} · ` : ''}{formatDateLong(event.date, t.browserLocale)}
              {event.time && ` · ${formatTime(event.time)}`}
            </span>
          </div>

          <div>
            <div className="font-display text-[30px] leading-tight font-bold tracking-tight">
              {title}
            </div>
            <div className="flex items-center gap-4 mt-2 text-[14px] font-semibold flex-wrap" style={{ color: '#9fd8cd' }}>
              {locationText && (
                <span className="flex items-center gap-1.5">
                  <span className="ms text-[18px]">location_on</span>
                  {locationText}
                </span>
              )}
              {kind === 'match' && event.match_type && (
                <span className="flex items-center gap-1.5">
                  <span className="ms text-[18px]">emoji_events</span>
                  {t.event.matchTypes[event.match_type as keyof typeof t.event.matchTypes]}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2.5 mt-1 flex-wrap">
            <Link
              href={primaryHref}
              className="h-11 rounded-[13px] px-5 flex items-center gap-2 text-[14px] font-bold text-white"
              style={{ background: 'var(--primary)' }}
            >
              <span className="ms text-[20px]">{primaryIcon}</span>
              {primaryLabel}
            </Link>
            <Link
              href={secondaryHref}
              className="h-11 rounded-[13px] px-[18px] flex items-center gap-2 text-[14px] font-bold text-white"
              style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.22)' }}
            >
              <span className="ms text-[20px]">groups</span>
              {secondaryLabel}
            </Link>
          </div>
        </div>

        <div className="w-[280px] flex-shrink-0 flex flex-col gap-3">
          <span className="text-[12px] font-bold tracking-wide uppercase" style={{ color: '#9fd8cd' }}>
            {t.home.signups}
          </span>
          <div className="flex items-center gap-4">
            <div
              className="w-[92px] h-[92px] rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: `conic-gradient(#4ade80 0 ${pct}%, rgba(255,255,255,.12) ${pct}% 100%)` }}
            >
              <div
                className="w-[70px] h-[70px] rounded-full flex flex-col items-center justify-center leading-none"
                style={{ background: '#0c352f' }}
              >
                <span className="font-display text-[22px] font-bold text-white">{present}</span>
                <span className="text-[10.5px] font-semibold" style={{ color: '#9fd8cd' }}>
                  {t.home.ofCount.replace('{n}', String(squadSize))}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2 flex-1">
              <LegendRow color="#4ade80" text={`${present} ${t.home.present}`} strong />
              <LegendRow color="#ef4444" text={`${absent} ${t.home.absent}`} />
              <LegendRow color="#f59e0b" text={`${noResponse} ${t.home.noResponse}`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function LegendRow({ color, text, strong }: { color: string; text: string; strong?: boolean }) {
  return (
    <div
      className="flex items-center gap-2 text-[13px] font-semibold"
      style={{ color: strong ? '#eafff4' : '#cbe8e0' }}
    >
      <span className="w-[9px] h-[9px] rounded-full" style={{ background: color }} />
      {text}
    </div>
  )
}
