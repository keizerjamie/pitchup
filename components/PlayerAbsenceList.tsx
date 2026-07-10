'use client'

import { useState, useTransition } from 'react'
import { updateAttendance, markAbsentForPeriod } from '@/app/actions/attendance'
import { AttendanceStatus, FootballEvent } from '@/lib/types'
import { formatTime } from '@/lib/utils'
import { useDict } from '@/lib/i18n-context'

interface EventWithStatus extends FootballEvent {
  status: AttendanceStatus
}

interface Props {
  playerId: string
  events: EventWithStatus[]
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function PlayerAbsenceList({ playerId, events: initialEvents }: Props) {
  const [events, setEvents] = useState(initialEvents)
  const [, startTransition] = useTransition()
  const [isPeriodPending, startPeriodTransition] = useTransition()
  const t = useDict()

  const [fromDate, setFromDate] = useState(todayStr)
  const [toDate, setToDate] = useState('')
  const [periodResult, setPeriodResult] = useState<number | null>(null)

  function setStatus(eventId: string, next: AttendanceStatus) {
    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, status: next } : e))
    )
    startTransition(() => {
      updateAttendance(eventId, playerId, next)
    })
  }

  function handlePeriodAbsence() {
    if (!fromDate || !toDate || fromDate > toDate) return
    const affected = events.filter((e) => e.date >= fromDate && e.date <= toDate).length
    setEvents((prev) =>
      prev.map((e) =>
        e.date >= fromDate && e.date <= toDate ? { ...e, status: 'absent' as AttendanceStatus } : e
      )
    )
    setPeriodResult(affected)
    startPeriodTransition(async () => {
      await markAbsentForPeriod(playerId, fromDate, toDate)
    })
  }

  const weeks: { label: string; events: EventWithStatus[] }[] = []
  for (const event of events) {
    const date = new Date(event.date + 'T00:00:00')
    const weekStart = new Date(date)
    weekStart.setDate(date.getDate() - date.getDay() + 1)
    const weekLabel = weekStart.toLocaleDateString(t.browserLocale, { day: 'numeric', month: 'long' })
    const last = weeks[weeks.length - 1]
    if (last && last.label === weekLabel) {
      last.events.push(event)
    } else {
      weeks.push({ label: weekLabel, events: [event] })
    }
  }

  const absentCount = events.filter((e) => e.status === 'absent').length

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <div className="rounded-2xl border border-gray-100 overflow-hidden">
        <div className="bg-gray-50 px-4 pt-4 pb-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800 text-sm">{t.players.periodTitle}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{t.players.periodHint}</p>
        </div>
        <div className="px-4 py-4 space-y-3 bg-white">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">{t.players.periodFrom}</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setPeriodResult(null) }}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">{t.players.periodTo}</label>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(e) => { setToDate(e.target.value); setPeriodResult(null) }}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40"
              />
            </div>
          </div>

          <button
            onClick={handlePeriodAbsence}
            disabled={!fromDate || !toDate || fromDate > toDate || isPeriodPending}
            className="w-full py-2.5 rounded-xl bg-red-500 text-white font-semibold text-sm disabled:opacity-40 active:scale-[0.98] transition-all hover:bg-red-600"
          >
            {isPeriodPending ? '…' : t.players.periodButton}
          </button>

          {periodResult !== null && !isPeriodPending && (
            <p className={`text-sm font-medium text-center ${periodResult === 0 ? 'text-gray-400' : 'text-green-600'}`}>
              {periodResult === 0
                ? t.players.periodNone
                : `${periodResult} ${t.players.periodSuccess}`}
            </p>
          )}
        </div>
      </div>

      {/* Absent summary */}
      {absentCount > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700 font-medium">
          {t.players.absentFor} {absentCount} {absentCount === 1 ? t.players.event : t.players.events}
        </div>
      )}

      {/* Per-event list */}
      {weeks.map((week) => (
        <div key={week.label}>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {t.players.weekOf} {week.label}
          </p>
          <div className="space-y-2">
            {week.events.map((event) => {
              const isMatch = event.type === 'match'
              const isAbsent = event.status === 'absent'
              const isPresent = event.status === 'present'

              return (
                <div key={event.id}
                  className={`bg-white rounded-xl border-2 p-4 flex items-center gap-4 transition-all ${isAbsent ? 'border-red-200 bg-red-50' : 'border-gray-100'}`}>
                  <div className={`flex-shrink-0 w-11 h-11 rounded-xl flex flex-col items-center justify-center ${isMatch ? 'bg-blue-50' : 'bg-brand-light'}`}>
                    <span className={`text-xs font-medium leading-none ${isMatch ? 'text-blue-500' : 'text-brand'}`}>
                      {new Date(event.date + 'T00:00:00').toLocaleDateString(t.browserLocale, { month: 'short' })}
                    </span>
                    <span className={`text-base font-bold leading-tight ${isMatch ? 'text-blue-700' : 'text-brand'}`}>
                      {new Date(event.date + 'T00:00:00').getDate()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 text-sm">
                      {isMatch && event.opponent ? `vs ${event.opponent}` : t.calendar.trainingLabel}
                    </div>
                    <div className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
                      {event.time && <span>{formatTime(event.time)}</span>}
                      {isMatch && event.match_type && (
                        <span>{t.event.matchTypes[event.match_type as keyof typeof t.event.matchTypes]}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex-shrink-0 flex gap-2">
                    <button
                      onClick={() => !isPresent && setStatus(event.id, 'present')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        isPresent
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-100 text-gray-400 hover:bg-green-100 hover:text-green-700'
                      }`}>
                      {t.players.present}
                    </button>
                    <button
                      onClick={() => !isAbsent && setStatus(event.id, 'absent')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        isAbsent
                          ? 'bg-red-500 text-white'
                          : 'bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-700'
                      }`}>
                      {t.players.absent}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {events.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-sm">
          {t.players.noUpcomingEvents}
        </div>
      )}
    </div>
  )
}
