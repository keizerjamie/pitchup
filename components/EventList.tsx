'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FootballEvent, MATCH_TYPE_COLORS } from '@/lib/types'
import { formatTime } from '@/lib/utils'
import { useDict } from '@/lib/i18n-context'

interface Props {
  upcoming: FootballEvent[]
  past: FootballEvent[]
  attendanceMap: Record<string, { present: number; total: number }>
}

export default function EventList({ upcoming, past, attendanceMap }: Props) {
  const t = useDict()
  const [showTraining, setShowTraining] = useState(true)
  const [showMatch, setShowMatch] = useState(true)
  const [showMeting, setShowMeting] = useState(true)

  const all = [...upcoming, ...past]
  const trainingCount = all.filter(e => e.type === 'training').length
  const matchCount = all.filter(e => e.type === 'match').length
  const metingCount = all.filter(e => e.type === 'meting').length

  function filter(events: FootballEvent[]) {
    return events.filter(e =>
      (e.type === 'training' && showTraining) ||
      (e.type === 'match' && showMatch) ||
      (e.type === 'meting' && showMeting)
    )
  }

  const filteredUpcoming = filter(upcoming)
  const filteredPast = filter(past)
  const isEmpty = upcoming.length === 0 && past.length === 0

  function EventRow({ event }: { event: FootballEvent }) {
    const isMatch = event.type === 'match'
    const isMeting = event.type === 'meting'
    const stats = attendanceMap[event.id] ?? { present: 0, total: 0 }

    const dateColor = isMatch ? '#3b82f6' : isMeting ? '#9333ea' : '#16a34a'
    const dateBoldColor = isMatch ? '#1d4ed8' : isMeting ? '#7c3aed' : '#15803d'
    const dateBg = isMatch ? 'bg-blue-50' : isMeting ? 'bg-purple-50' : 'bg-green-50'

    const title = isMatch && event.opponent ? `vs ${event.opponent}`
      : isMeting ? t.event.meting
      : t.calendar.trainingLabel

    return (
      <Link href={`/events/${event.id}`} transitionTypes={['nav-forward']} className="block">
        <div className="glass-card-raised rounded-xl p-4 flex items-center gap-4 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200">
          <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex flex-col items-center justify-center ${dateBg}`}>
            <span className="text-xs font-medium" style={{ color: dateColor }}>
              {new Date(event.date + 'T00:00:00').toLocaleDateString(t.browserLocale, { month: 'short' })}
            </span>
            <span className="text-lg font-bold leading-none" style={{ color: dateBoldColor }}>
              {new Date(event.date + 'T00:00:00').getDate()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-900">{title}</div>
            <div className="text-sm text-gray-500 flex items-center gap-2 flex-wrap">
              {event.time && <span>{formatTime(event.time)}</span>}
              {event.location && (
                <span className="truncate flex items-center gap-1 min-w-0">
                  <svg className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="truncate">{event.location}</span>
                </span>
              )}
              {isMatch && event.home_away && (
                <span>{event.home_away === 'home' ? t.calendar.homeLabel : t.calendar.awayLabel}</span>
              )}
            </div>
          </div>
          <div className="flex-shrink-0 flex flex-col items-end gap-1">
            {isMatch && event.match_type && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${MATCH_TYPE_COLORS[event.match_type]}`}>
                {t.event.matchTypes[event.match_type as keyof typeof t.event.matchTypes]}
              </span>
            )}
            {event.type === 'training' && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                {t.calendar.trainingLabel}
              </span>
            )}
            {isMeting && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                {t.event.meting}
              </span>
            )}
            {stats.total > 0 && (
              <span className="text-xs text-gray-400">✓ {stats.present}/{stats.total}</span>
            )}
          </div>
        </div>
      </Link>
    )
  }

  return (
    <div className="space-y-6">
      {/* Filter toggles */}
      <div className="flex gap-2 flex-wrap">
        <FilterChip
          active={showTraining}
          onToggle={() => setShowTraining(v => !v)}
          count={trainingCount}
          label={t.calendar.trainingLabel}
          activeStyle={{ background: 'rgba(22,163,74,0.12)', color: '#15803d', border: '1.5px solid rgba(22,163,74,0.30)', boxShadow: '0 1px 4px rgba(22,163,74,0.10)' }}
          checkColor="#16a34a"
        />
        <FilterChip
          active={showMatch}
          onToggle={() => setShowMatch(v => !v)}
          count={matchCount}
          label={t.event.match}
          activeStyle={{ background: 'rgba(37,99,235,0.10)', color: '#1d4ed8', border: '1.5px solid rgba(37,99,235,0.25)', boxShadow: '0 1px 4px rgba(37,99,235,0.08)' }}
          checkColor="#2563eb"
        />
        {metingCount > 0 && (
          <FilterChip
            active={showMeting}
            onToggle={() => setShowMeting(v => !v)}
            count={metingCount}
            label={t.event.meting}
            activeStyle={{ background: 'rgba(147,51,234,0.10)', color: '#7c3aed', border: '1.5px solid rgba(147,51,234,0.25)', boxShadow: '0 1px 4px rgba(147,51,234,0.08)' }}
            checkColor="#9333ea"
          />
        )}
      </div>

      {/* Event lists */}
      {isEmpty ? (
        <div className="glass-card rounded-2xl p-8 text-center border border-dashed border-white/60">
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
          </svg>
          <p className="text-gray-500 font-medium">{t.calendar.noEvents}</p>
          <p className="text-gray-400 text-sm mt-1">{t.calendar.noEventsHint}</p>
        </div>
      ) : (
        <>
          {/* Side-by-side columns on desktop, stacked on mobile */}
          <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start space-y-6 lg:space-y-0">
            {filteredUpcoming.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t.calendar.upcoming}</h2>
                <div className="flex flex-col gap-2 stagger">
                  {filteredUpcoming.map(e => <EventRow key={e.id} event={e} />)}
                </div>
              </div>
            )}

            {filteredPast.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t.calendar.past}</h2>
                <div className="flex flex-col gap-2 opacity-70 stagger">
                  {filteredPast.map(e => <EventRow key={e.id} event={e} />)}
                </div>
              </div>
            )}
          </div>

          {filteredUpcoming.length === 0 && filteredPast.length === 0 && (
            <div className="glass-card rounded-2xl p-8 text-center border border-dashed border-white/60">
              <p className="text-gray-500 font-medium">{t.calendar.noEvents}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FilterChip({ active, onToggle, count, label, activeStyle, checkColor }: {
  active: boolean
  onToggle: () => void
  count: number
  label: string
  activeStyle: React.CSSProperties
  checkColor: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 active:scale-95"
      style={active ? activeStyle : {
        background: 'rgba(255,255,255,0.60)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        color: '#9ca3af',
        border: '1.5px solid rgba(0,0,0,0.06)',
      }}
    >
      <span
        className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all duration-200"
        style={active ? { background: checkColor } : { background: 'rgba(0,0,0,0.08)' }}
      >
        {active && (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label}
      <span className="text-xs opacity-60 font-medium">({count})</span>
    </button>
  )
}
