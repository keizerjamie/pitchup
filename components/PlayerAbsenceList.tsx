'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateAttendance, markAbsentForPeriod, revokeAbsencePeriod } from '@/app/actions/attendance'
import { AttendanceStatus, FootballEvent, AbsencePeriod } from '@/lib/types'
import { formatDate, formatTime } from '@/lib/utils'
import { findCoveringPeriod } from '@/lib/absence-periods'
import { useDict } from '@/lib/i18n-context'

interface EventWithStatus extends FootballEvent {
  status: AttendanceStatus
}

// Alleen de velden die deze pagina's query daadwerkelijk selecteert
// (app/players/[id]/absence/page.tsx). player_id zit erbij omdat de gedeelde
// helpers uit lib/absence-periods.ts (findCoveringPeriod) dat veld vereisen;
// created_at is hier nooit nodig en wordt bewust niet opgehaald.
type PeriodRange = Pick<AbsencePeriod, 'id' | 'player_id' | 'from_date' | 'to_date'>

interface Props {
  playerId: string
  events: EventWithStatus[]
  periods: PeriodRange[]
  defaultStatus: 'present' | 'unknown'
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function PlayerAbsenceList({ playerId, events: initialEvents, periods: initialPeriods, defaultStatus }: Props) {
  const [events, setEvents] = useState(initialEvents)
  const [periods, setPeriods] = useState(initialPeriods)
  const [, startTransition] = useTransition()
  const [isPeriodPending, startPeriodTransition] = useTransition()
  const [isRevokePending, startRevokeTransition] = useTransition()
  const t = useDict()
  const router = useRouter()

  const [fromDate, setFromDate] = useState(todayStr)
  const [toDate, setToDate] = useState('')
  const [periodResult, setPeriodResult] = useState<number | null>(null)
  const [periodError, setPeriodError] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  // Sync wanneer de server (na router.refresh()) nieuwe props stuurt — zelfde
  // "adjust state during render"-patroon als components/TeamIndelingEditor.tsx
  // (i.p.v. een cascaderende useEffect). Een `useState`-initializer draait
  // niet opnieuw zolang deze component niet remount, dus zonder deze sync
  // blijft de lokale (optimistisch teruggezette) state hangen na revoke.
  const [prevInitialEvents, setPrevInitialEvents] = useState(initialEvents)
  if (prevInitialEvents !== initialEvents) {
    setPrevInitialEvents(initialEvents)
    setEvents(initialEvents)
  }
  const [prevInitialPeriods, setPrevInitialPeriods] = useState(initialPeriods)
  if (prevInitialPeriods !== initialPeriods) {
    setPrevInitialPeriods(initialPeriods)
    setPeriods(initialPeriods)
  }

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
    setPeriodError(null)
    setPeriodResult(null)
    const previousEvents = events
    // Optimistische eerste-orde-benadering: de definitieve teller komt uit de
    // `affected`-waarde van de server (zie hieronder) — die telt ook events
    // buiten deze lokaal geladen (toekomstige) lijst mee.
    setEvents((prev) =>
      prev.map((e) =>
        e.date >= fromDate && e.date <= toDate ? { ...e, status: 'absent' as AttendanceStatus } : e
      )
    )
    startPeriodTransition(async () => {
      try {
        const { periodId, affected } = await markAbsentForPeriod(playerId, fromDate, toDate)
        setPeriods((prev) => [...prev, { id: periodId, player_id: playerId, from_date: fromDate, to_date: toDate }])
        setPeriodResult(affected)
      } catch (err) {
        setEvents(previousEvents)
        setPeriodError(err instanceof Error ? err.message : t.players.periodError)
      }
    })
  }

  function handleRevoke(periodId: string) {
    const revoked = periods.find((p) => p.id === periodId)
    if (!revoked) return
    setRevokeError(null)
    const previousPeriods = periods
    const previousEvents = events
    const remaining = periods.filter((p) => p.id !== periodId)
    setPeriods(remaining)
    setEvents((prev) =>
      prev.map((e) => {
        if (e.date < revoked.from_date || e.date > revoked.to_date) return e
        const stillCovered = findCoveringPeriod(remaining, e.date)
        return { ...e, status: stillCovered ? ('absent' as AttendanceStatus) : (defaultStatus as AttendanceStatus) }
      })
    )
    startRevokeTransition(async () => {
      try {
        await revokeAbsencePeriod(periodId)
        // De server houdt handmatige en blessure-rijen bewust op 'absent';
        // de optimistische update hierboven kent dat onderscheid niet. Een
        // refresh haalt de definitieve serverstaat op.
        router.refresh()
      } catch (err) {
        setPeriods(previousPeriods)
        setEvents(previousEvents)
        setRevokeError(err instanceof Error ? err.message : t.players.periodRevokeError)
      }
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
      <div className="rounded-2xl border border-[var(--border-soft)] overflow-hidden">
        <div className="bg-surface-sunken px-4 pt-4 pb-3 border-b border-[var(--border-soft)]">
          <h3 className="font-semibold text-ink text-sm">{t.players.periodTitle}</h3>
          <p className="text-xs text-faint mt-0.5">{t.players.periodHint}</p>
        </div>
        <div className="px-4 py-4 space-y-3 bg-surface">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted mb-1.5 block">{t.players.periodFrom}</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setPeriodResult(null); setPeriodError(null) }}
                className="w-full px-3 py-2.5 rounded-xl border border-[var(--border-soft)] text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-muted mb-1.5 block">{t.players.periodTo}</label>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(e) => { setToDate(e.target.value); setPeriodResult(null); setPeriodError(null) }}
                className="w-full px-3 py-2.5 rounded-xl border border-[var(--border-soft)] text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40"
              />
            </div>
          </div>

          <button
            onClick={handlePeriodAbsence}
            disabled={!fromDate || !toDate || fromDate > toDate || isPeriodPending}
            className="w-full py-2.5 rounded-xl bg-danger text-white font-semibold text-sm disabled:opacity-40 active:scale-[0.98] transition hover:bg-danger/90"
          >
            {isPeriodPending ? '…' : t.players.periodButton}
          </button>

          {periodResult !== null && !isPeriodPending && (
            <p className={`text-sm font-medium text-center ${periodResult === 0 ? 'text-faint' : 'text-panel-green-ink'}`}>
              {periodResult === 0
                ? t.players.periodNone
                : `${periodResult} ${t.players.periodSuccess}`}
            </p>
          )}

          {periodError && !isPeriodPending && (
            <div className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-3 py-2 rounded-lg">{periodError}</div>
          )}
        </div>
      </div>

      {/* Period list */}
      <div className="rounded-2xl border border-[var(--border-soft)] overflow-hidden">
        <div className="bg-surface-sunken px-4 pt-4 pb-3 border-b border-[var(--border-soft)]">
          <h3 className="font-semibold text-ink text-sm">{t.players.periodListTitle}</h3>
        </div>
        <div className="px-4 py-4 bg-surface space-y-3">
          {revokeError && !isRevokePending && (
            <div className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-3 py-2 rounded-lg">{revokeError}</div>
          )}
          {periods.length === 0 ? (
            <p className="text-sm text-faint text-center">{t.players.periodListEmpty}</p>
          ) : (
            <div className="space-y-2">
              {periods.map((period) => {
                const rangeLabel = `${formatDate(period.from_date, t.browserLocale)} – ${formatDate(period.to_date, t.browserLocale)}`
                return (
                  <div key={period.id} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted">{rangeLabel}</span>
                    <button
                      onClick={() => handleRevoke(period.id)}
                      disabled={isRevokePending}
                      aria-label={t.players.periodRevokeAria.replace('{range}', rangeLabel)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-muted bg-surface-sunken hover:bg-panel-red hover:text-panel-red-ink transition disabled:opacity-40"
                    >
                      {t.players.periodRevoke}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Absent summary */}
      {absentCount > 0 && (
        <div className="bg-panel-red border border-panel-red-edge rounded-xl px-4 py-3 text-sm text-panel-red-ink font-medium">
          {t.players.absentFor} {absentCount} {absentCount === 1 ? t.players.event : t.players.events}
        </div>
      )}

      {/* Per-event list */}
      {weeks.map((week) => (
        <div key={week.label}>
          <p className="text-xs font-semibold text-faint uppercase tracking-wide mb-2">
            {t.players.weekOf} {week.label}
          </p>
          <div className="space-y-2">
            {week.events.map((event) => {
              const isMatch = event.type === 'match'
              const isAbsent = event.status === 'absent'
              const isPresent = event.status === 'present'

              return (
                <div key={event.id}
                  className={`bg-surface rounded-xl border-2 p-4 flex items-center gap-4 transition ${isAbsent ? 'border-panel-red-edge bg-panel-red' : 'border-[var(--border-soft)]'}`}>
                  <div className={`flex-shrink-0 w-11 h-11 rounded-xl flex flex-col items-center justify-center ${isMatch ? 'bg-panel-blue' : 'bg-brand-light'}`}>
                    <span className={`text-xs font-medium leading-none ${isMatch ? 'text-panel-blue-ink' : 'text-brand'}`}>
                      {new Date(event.date + 'T00:00:00').toLocaleDateString(t.browserLocale, { month: 'short' })}
                    </span>
                    <span className={`text-base font-bold leading-tight ${isMatch ? 'text-panel-blue-ink' : 'text-brand'}`}>
                      {new Date(event.date + 'T00:00:00').getDate()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ink text-sm">
                      {isMatch && event.opponent ? `vs ${event.opponent}` : t.calendar.trainingLabel}
                    </div>
                    <div className="text-xs text-faint flex items-center gap-2 mt-0.5">
                      {event.time && <span>{formatTime(event.time)}</span>}
                      {isMatch && event.match_type && (
                        <span>{t.event.matchTypes[event.match_type as keyof typeof t.event.matchTypes]}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex-shrink-0 flex gap-2">
                    <button
                      onClick={() => !isPresent && setStatus(event.id, 'present')}
                      disabled={isPeriodPending || isRevokePending}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-40 ${
                        isPresent
                          ? 'bg-primary text-white'
                          : 'bg-surface-sunken text-faint hover:bg-panel-green hover:text-panel-green-ink'
                      }`}>
                      {t.players.present}
                    </button>
                    <button
                      onClick={() => !isAbsent && setStatus(event.id, 'absent')}
                      disabled={isPeriodPending || isRevokePending}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-40 ${
                        isAbsent
                          ? 'bg-danger text-white'
                          : 'bg-surface-sunken text-faint hover:bg-panel-red hover:text-panel-red-ink'
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
        <div className="text-center py-8 text-faint text-sm">
          {t.players.noUpcomingEvents}
        </div>
      )}
    </div>
  )
}
