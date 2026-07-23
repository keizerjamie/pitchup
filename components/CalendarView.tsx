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

// Type accent colours — chosen to read on both light and dark surfaces.
const TRAINING = '#14b8a6' // teal
const MATCH = '#16a34a'    // green
const colorFor = (e: FootballEvent) => (e.type === 'match' ? MATCH : TRAINING)

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

  const eventsByDate = useMemo(() => {
    const map: Record<string, FootballEvent[]> = {}
    for (const e of events) (map[e.date] ??= []).push(e)
    for (const key in map) map[key].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
    return map
  }, [events])

  const upcoming = useMemo(
    () => events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '')).slice(0, 6),
    [events, today],
  )

  const weeks = useMemo(() => monthMatrix(ym.year, ym.month), [ym])
  const monthLabel = new Date(ym.year, ym.month - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const weekdayLabels = weeks[0].map((d) => new Date(d + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short' }))

  const agendaDays = useMemo(
    () => weeks.flat().filter((d) => sameMonth(d, ym.year, ym.month) && eventsByDate[d]?.length),
    [weeks, ym, eventsByDate],
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
    <div className="md:flex md:gap-5 md:items-start">
      {/* Calendar column */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {/* Month navigation */}
        <div className="flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-[22px] lg:text-[28px] font-bold tracking-tight text-ink capitalize">{monthLabel}</h1>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => shiftMonth(-1)} aria-label={t.calendar.prevMonth}
                className="w-9 h-9 rounded-xl bg-surface flex items-center justify-center text-muted hover:text-ink transition-colors" style={{ border: '1px solid var(--border-soft)' }}>
                <span className="ms text-[20px]">chevron_left</span>
              </button>
              <button type="button" onClick={() => shiftMonth(1)} aria-label={t.calendar.nextMonth}
                className="w-9 h-9 rounded-xl bg-surface flex items-center justify-center text-muted hover:text-ink transition-colors" style={{ border: '1px solid var(--border-soft)' }}>
                <span className="ms text-[20px]">chevron_right</span>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={goToday}
              className="h-9 px-3 rounded-xl text-[13px] font-bold text-brand-accent hover:bg-surface-sunken transition-colors">
              {t.calendar.today}
            </button>
            <Link href="/events/new"
              className="h-10 rounded-xl px-4 flex items-center gap-2 text-[13.5px] font-bold text-white flex-shrink-0" style={{ background: 'var(--primary)' }}>
              <span className="ms text-[19px]">add</span>
              <span className="hidden sm:inline">{t.home.newEvent}</span>
            </Link>
          </div>
        </div>

        {/* Desktop month grid */}
        <div className="hidden md:flex md:flex-col surface-card p-3 lg:p-4">
          <div className="grid grid-cols-7 gap-1.5 mb-1.5 flex-shrink-0">
            {weekdayLabels.map((w, i) => (
              <div key={i} className="text-center text-[11px] font-extrabold uppercase tracking-wide text-faint py-1">{w}</div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1.5" style={{ minHeight: 88 }}>
                {week.map((d) => {
                  const inMonth = sameMonth(d, ym.year, ym.month)
                  const isToday = d === today
                  const dayEvents = eventsByDate[d] ?? []
                  const dayNum = Number(d.slice(-2))
                  return (
                    <div key={d} className="min-h-0 overflow-hidden rounded-xl p-1.5 flex flex-col gap-1"
                      style={{
                        border: `1px solid ${isToday ? 'var(--primary)' : inMonth ? 'var(--border-soft)' : 'transparent'}`,
                        background: inMonth ? 'var(--surface-sunken)' : 'transparent',
                      }}>
                      <span className={cn(
                        'font-display text-[13px] font-bold w-6 h-6 flex items-center justify-center rounded-lg flex-shrink-0',
                        isToday ? 'text-white' : inMonth ? 'text-ink' : 'text-faint',
                      )} style={isToday ? { background: 'var(--primary)' } : undefined}>
                        {dayNum}
                      </span>
                      <div className="flex flex-col gap-1 min-h-0">
                        {dayEvents.slice(0, 2).map((e) => <CalendarPill key={e.id} event={e} t={t} />)}
                        {dayEvents.length > 2 && (
                          <span className="text-[10px] font-semibold text-faint px-1">
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

        {/* Mobile agenda */}
        <div className="md:hidden">
          {agendaDays.length === 0 ? (
            <div className="surface-card p-8 text-center">
              <p className="text-ink font-bold">{t.calendar.noEvents}</p>
              <p className="text-faint text-sm mt-1">{t.calendar.noEventsHint}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {agendaDays.map((d) => {
                const isToday = d === today
                const label = new Date(d + 'T00:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
                return (
                  <div key={d}>
                    <h3 className={cn('text-[12px] font-extrabold uppercase tracking-wider mb-2 capitalize', isToday ? 'text-brand-accent' : 'text-faint')}>
                      {label}{isToday && ` · ${t.calendar.today}`}
                    </h3>
                    <div className="flex flex-col gap-2">
                      {eventsByDate[d].map((e) => <AgendaRow key={e.id} event={e} t={t} stats={attendanceMap[e.id]} />)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Desktop "upcoming" sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-[300px] md:flex-shrink-0 surface-card p-5 gap-4 self-start">
        <span className="font-display text-[17px] font-bold text-ink">{t.calendar.upcoming}</span>
        {upcoming.length === 0 ? (
          <p className="text-faint text-sm">{t.calendar.noEvents}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {upcoming.map((e) => {
              const color = colorFor(e)
              const dateLabel = new Date(e.date + 'T00:00:00')
                .toLocaleDateString(locale, { weekday: 'short', day: 'numeric' }).replace('.', '').toUpperCase()
              return (
                <Link key={e.id} href={`/events/${e.id}`} className="flex gap-3 group">
                  <div className="w-1 rounded-full flex-shrink-0" style={{ background: color }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color }}>
                      {dateLabel}{e.time && ` · ${formatTime(e.time)}`}
                    </div>
                    <div className="text-[14px] font-bold text-ink mt-0.5 truncate group-hover:text-brand-accent transition-colors">{eventTitle(e, t)}</div>
                    {e.location && <div className="text-[12px] font-semibold text-faint truncate">{e.location}</div>}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
        <div className="h-px" style={{ background: 'var(--border-soft)' }} />
        <div className="flex flex-col gap-2.5">
          <LegendRow color={TRAINING} label={t.event.training} />
          <LegendRow color={MATCH} label={t.event.match} />
        </div>
      </aside>
    </div>
  )
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[11px] h-[11px] rounded" style={{ background: color }} />
      <span className="text-[13px] font-semibold text-muted">{label}</span>
    </div>
  )
}

function CalendarPill({ event, t }: { event: FootballEvent; t: Dict }) {
  const color = colorFor(event)
  return (
    <Link
      href={`/events/${event.id}`}
      className="block rounded-md px-1.5 py-1 text-[11px] font-semibold leading-tight truncate text-ink hover:brightness-95 transition-all"
      style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}
    >
      {event.time && <span className="tabular-nums mr-1" style={{ color }}>{formatTime(event.time)}</span>}
      {eventTitle(event, t)}
    </Link>
  )
}

function AgendaRow({ event, t, stats }: { event: FootballEvent; t: Dict; stats?: { present: number; total: number } }) {
  const color = colorFor(event)
  const s = stats ?? { present: 0, total: 0 }
  return (
    <Link href={`/events/${event.id}`} className="block">
      <div className="surface-card rounded-xl p-3 flex items-center gap-3 hover:bg-surface-sunken transition-colors">
        <div className="flex-shrink-0 w-1.5 h-10 rounded-full" style={{ background: color }} />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-ink text-sm">{eventTitle(event, t)}</div>
          <div className="text-xs font-semibold text-faint flex items-center gap-2 flex-wrap">
            {event.time && <span>{formatTime(event.time)}</span>}
            {event.location && <span className="truncate">{event.location}</span>}
            {event.type === 'match' && event.home_away && (
              <span>{event.home_away === 'home' ? t.calendar.homeLabel : t.calendar.awayLabel}</span>
            )}
          </div>
        </div>
        {s.total > 0 && <span className="text-xs font-bold text-faint flex-shrink-0">{s.present}/{s.total}</span>}
      </div>
    </Link>
  )
}
