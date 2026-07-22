'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Dict } from '@/messages/nl'
import { FootballEvent } from '@/lib/types'
import { cn, formatTime, todayLocal } from '@/lib/utils'
import { monthMatrix, sameMonth } from '@/lib/calendar.mjs'
import { useDict } from '@/lib/i18n-context'

interface Props {
  events: FootballEvent[]
  attendanceMap: Record<string, { present: number; total: number }>
}

function eventTitle(event: FootballEvent, t: Dict): string {
  if (event.type === 'match') return event.opponent ? `vs ${event.opponent}` : t.event.match
  return t.calendar.trainingLabel
}

export default function CalendarView({ events, attendanceMap }: Props) {
  const t = useDict()
  const locale = t.browserLocale
  const today = todayLocal()

  const [ym, setYm] = useState(() => {
    const [year, month] = today.split('-').map(Number)
    return { year, month }
  })

  // Group events by their local date; sort each day by start time.
  const eventsByDate = useMemo(() => {
    const map: Record<string, FootballEvent[]> = {}
    for (const e of events) (map[e.date] ??= []).push(e)
    for (const key in map) {
      map[key].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
    }
    return map
  }, [events])

  const weeks = useMemo(() => monthMatrix(ym.year, ym.month), [ym])

  const monthLabel = new Date(ym.year, ym.month - 1, 1)
    .toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const weekdayLabels = weeks[0].map((d) =>
    new Date(d + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short' })
  )

  // Days of the visible month that actually have events (mobile agenda).
  const agendaDays = useMemo(
    () =>
      weeks
        .flat()
        .filter((d) => sameMonth(d, ym.year, ym.month) && eventsByDate[d]?.length),
    [weeks, ym, eventsByDate]
  )

  function shiftMonth(delta: number) {
    setYm(({ year, month }) => {
      const m = month + delta
      if (m < 1) return { year: year - 1, month: 12 }
      if (m > 12) return { year: year + 1, month: 1 }
      return { year, month: m }
    })
  }

  function goToday() {
    const [year, month] = today.split('-').map(Number)
    setYm({ year, month })
  }

  return (
    <div className="space-y-4 md:space-y-0 md:gap-4 md:h-full md:flex md:flex-col md:min-h-0">
      {/* Month navigation */}
      <div className="flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label={t.calendar.prevMonth}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-black/5 active:scale-95 transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label={t.calendar.nextMonth}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-black/5 active:scale-95 transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
        <h2 className="text-lg lg:text-xl font-semibold text-gray-900 capitalize">{monthLabel}</h2>
        <button
          type="button"
          onClick={goToday}
          className="px-3 py-1.5 rounded-xl text-sm font-semibold text-brand hover:bg-brand-light active:scale-95 transition-all"
        >
          {t.calendar.today}
        </button>
      </div>

      {/* Desktop / laptop: month grid — fills the remaining viewport height so a
          whole month always fits without scrolling; week rows share the height. */}
      <div className="hidden md:flex md:flex-col md:flex-1 md:min-h-0 glass-card-raised rounded-2xl p-3 lg:p-4">
        <div className="grid grid-cols-7 gap-1 lg:gap-2 mb-1 flex-shrink-0">
          {weekdayLabels.map((w, i) => (
            <div key={i} className="text-center text-xs font-semibold uppercase tracking-wide text-gray-400 py-1 capitalize">
              {w}
            </div>
          ))}
        </div>
        <div className="flex-1 min-h-0 flex flex-col gap-1 lg:gap-2">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex-1 min-h-0 grid grid-cols-7 gap-1 lg:gap-2">
              {week.map((d) => {
                const inMonth = sameMonth(d, ym.year, ym.month)
                const isToday = d === today
                const dayEvents = eventsByDate[d] ?? []
                const dayNum = Number(d.slice(-2))
                return (
                  <div
                    key={d}
                    className={cn(
                      'min-h-0 overflow-hidden rounded-xl p-1.5 flex flex-col gap-1 border transition-colors',
                      inMonth ? 'bg-white/70 border-black/5' : 'border-transparent',
                      isToday && 'ring-2 ring-accent !border-accent'
                    )}
                  >
                    <span
                      className={cn(
                        'text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full flex-shrink-0',
                        isToday ? 'bg-brand text-white' : inMonth ? 'text-gray-700' : 'text-gray-300'
                      )}
                    >
                      {dayNum}
                    </span>
                    <div className="flex flex-col gap-1 min-h-0">
                      {dayEvents.slice(0, 2).map((e) => (
                        <CalendarPill key={e.id} event={e} t={t} />
                      ))}
                      {dayEvents.length > 2 && (
                        <span className="text-[10px] text-gray-400 px-1">
                          {t.calendar.moreEvents.replace('{n}', String(dayEvents.length - 2))}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: compact agenda of days that have events */}
      <div className="md:hidden">
        {agendaDays.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center border border-dashed border-white/60">
            <p className="text-gray-500 font-medium">{t.calendar.noEvents}</p>
            <p className="text-gray-400 text-sm mt-1">{t.calendar.noEventsHint}</p>
          </div>
        ) : (
          <div className="space-y-4 stagger">
            {agendaDays.map((d) => {
              const isToday = d === today
              const label = new Date(d + 'T00:00:00').toLocaleDateString(locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })
              return (
                <div key={d}>
                  <h3 className={cn('text-sm font-semibold mb-2 capitalize', isToday ? 'text-brand' : 'text-gray-500')}>
                    {label}
                    {isToday && ` · ${t.calendar.today}`}
                  </h3>
                  <div className="flex flex-col gap-2">
                    {eventsByDate[d].map((e) => (
                      <AgendaRow key={e.id} event={e} t={t} stats={attendanceMap[e.id]} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function CalendarPill({ event, t }: { event: FootballEvent; t: Dict }) {
  const isMatch = event.type === 'match'
  const cls = isMatch ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
  return (
    <Link
      href={`/events/${event.id}`}
      transitionTypes={['nav-forward']}
      className={cn(
        'block rounded-md px-1.5 py-1 text-[11px] font-medium leading-tight truncate hover:opacity-80 transition-opacity',
        cls
      )}
    >
      {event.time && <span className="tabular-nums mr-1">{formatTime(event.time)}</span>}
      {eventTitle(event, t)}
    </Link>
  )
}

function AgendaRow({
  event,
  t,
  stats,
}: {
  event: FootballEvent
  t: Dict
  stats?: { present: number; total: number }
}) {
  const isMatch = event.type === 'match'
  const accent = isMatch ? '#3b82f6' : '#16a34a'
  const s = stats ?? { present: 0, total: 0 }
  return (
    <Link href={`/events/${event.id}`} transitionTypes={['nav-forward']} className="block">
      <div className="glass-card-raised rounded-xl p-3 flex items-center gap-3 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200">
        <div className="flex-shrink-0 w-1.5 h-10 rounded-full" style={{ background: accent }} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 text-sm">{eventTitle(event, t)}</div>
          <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
            {event.time && <span>{formatTime(event.time)}</span>}
            {event.location && <span className="truncate">{event.location}</span>}
            {isMatch && event.home_away && (
              <span>{event.home_away === 'home' ? t.calendar.homeLabel : t.calendar.awayLabel}</span>
            )}
          </div>
        </div>
        {s.total > 0 && <span className="text-xs text-gray-400 flex-shrink-0">✓ {s.present}/{s.total}</span>}
      </div>
    </Link>
  )
}
