import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Player, AttendanceStatus, MATCH_TYPE_COLORS } from '@/lib/types'
import { formatDateLong, formatTime } from '@/lib/utils'
import TrainingAttendance from '@/components/TrainingAttendance'
import MetingEditor from '@/components/MetingEditor'
import BackButton from '@/components/BackButton'
import DeleteButton from '@/components/DeleteButton'
import { deleteEvent } from '@/app/actions/events'
import { getDict } from '@/lib/i18n'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EventDetailPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: event }, { data: players }, { data: attendance }, { data: lineup }, { data: meting }, { data: oefeningen }] = await Promise.all([
    supabase.from('events').select('*').eq('id', id).eq('team_id', user.id).single(),
    supabase.from('players').select('*').eq('team_id', user.id).eq('active', true).order('position').order('jersey_number', { ascending: true, nullsFirst: false }).order('name'),
    supabase.from('attendance').select('*').eq('event_id', id).eq('team_id', user.id),
    supabase.from('lineups').select('id').eq('event_id', id).eq('team_id', user.id).maybeSingle(),
    supabase.from('metingen').select('*').eq('event_id', id).eq('team_id', user.id).maybeSingle(),
    supabase.from('oefeningen').select('id').eq('event_id', id).eq('team_id', user.id).limit(1),
  ])

  if (!event) notFound()

  // A training counts as "planned" once it has an objective or an exercise.
  const hasTrainingPlan = !!event.doelstelling || (oefeningen?.length ?? 0) > 0

  const isMatch = event.type === 'match'
  const isTraining = event.type === 'training'
  const isMeting = event.type === 'meting'

  async function handleDelete() {
    'use server'
    await deleteEvent(id)
    redirect('/events')
  }

  // ──────────────────────────────────────────────
  // Meting detail
  // ──────────────────────────────────────────────
  if (isMeting) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <BackButton fallback="/events" className="text-gray-400 hover:text-gray-600 flex-shrink-0">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </BackButton>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <span className="text-purple-600">◆</span> {t.event.meting}
            </h1>
            <p className="text-sm text-gray-500">{formatDateLong(event.date, t.browserLocale)}</p>
          </div>
          <span className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
            {t.event.meting}
          </span>
        </div>

        {(event.time || event.location || event.notes) && (
          <div className="bg-purple-50 rounded-2xl p-4 space-y-1 border border-purple-100">
            {event.time && (
              <p className="text-sm text-purple-700 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {formatTime(event.time)}
              </p>
            )}
            {event.location && (
              <p className="text-sm text-purple-700 flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                </svg>
                {event.location}
              </p>
            )}
            {event.notes && <p className="text-sm text-purple-700 pt-1">{event.notes}</p>}
          </div>
        )}

        <MetingEditor eventId={id} initialMeting={meting} />

        <DeleteButton
          label={t.event.deleteEvent}
          confirmMessage={`${t.event.deleteEvent}?`}
          action={handleDelete}
        />
      </div>
    )
  }

  // ──────────────────────────────────────────────
  // Training / Match detail
  // ──────────────────────────────────────────────
  const allPlayers: Player[] = players ?? []
  const attendanceMap = new Map<string, AttendanceStatus>()
  for (const a of (attendance ?? [])) {
    attendanceMap.set(a.player_id, a.status)
  }

  const missingPlayers = allPlayers.filter((p) => !attendanceMap.has(p.id))
  if (missingPlayers.length > 0) {
    await supabase.from('attendance').insert(
      missingPlayers.map((p) => ({ event_id: id, player_id: p.id, status: 'unknown', team_id: user.id }))
    )
    for (const p of missingPlayers) attendanceMap.set(p.id, 'unknown')
  }

  const presentCount = [...attendanceMap.values()].filter((s) => s === 'present').length
  const absentCount  = [...attendanceMap.values()].filter((s) => s === 'absent').length
  const unknownCount = [...attendanceMap.values()].filter((s) => s === 'unknown').length

  const keeperPlayers      = allPlayers.filter(p => p.position === 'Keeper')
  const fieldPlayers       = allPlayers.filter(p => p.position !== 'Keeper')
  const keeperPresentCount = keeperPlayers.filter(p => attendanceMap.get(p.id) === 'present').length
  const fieldPresentCount  = fieldPlayers.filter(p => attendanceMap.get(p.id) === 'present').length

  const initialStatuses = Object.fromEntries(attendanceMap) as Record<string, AttendanceStatus>

  const bannerBg = isMatch
    ? 'linear-gradient(135deg, #4338ca 0%, #312e81 100%)'
    : 'linear-gradient(135deg, #0d3d38 0%, #0a2e2a 100%)'

  return (
    <div className="max-w-2xl lg:max-w-5xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <BackButton fallback="/events" className="text-gray-400 hover:text-gray-600 flex-shrink-0">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </BackButton>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">
            {isMatch && event.opponent ? `vs ${event.opponent}` : t.event.training}
          </h1>
          <p className="text-sm text-gray-500">{formatDateLong(event.date, t.browserLocale)}</p>
        </div>
        {isMatch && event.match_type && (
          <span className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${MATCH_TYPE_COLORS[event.match_type as keyof typeof MATCH_TYPE_COLORS]}`}>
            {t.event.matchTypes[event.match_type as keyof typeof t.event.matchTypes]}
          </span>
        )}
      </div>

      {/* Two columns on desktop: info left, attendance right */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start space-y-6 lg:space-y-0">
      <div className="space-y-6">

      {/* Stats banner */}
      <div className="rounded-2xl p-5 text-white" style={{ background: bannerBg }}>

        {/* Metadata row */}
        {(event.time || event.location || (isMatch && event.home_away)) && (
          <div className="flex items-center gap-4 text-sm opacity-85 mb-5 pb-5 border-b border-white/20 flex-wrap">
            {event.time && (
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {formatTime(event.time)}
              </span>
            )}
            {event.location && (
              <span className="flex items-center gap-1.5 min-w-0">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="truncate">{event.location}</span>
              </span>
            )}
            {isMatch && event.home_away && (
              <span>{event.home_away === 'home' ? t.event.homeDetail : t.event.awayDetail}</span>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <div className="flex items-end gap-1">
              <span className="text-4xl font-bold leading-none">{fieldPresentCount}</span>
              <span className="text-xl font-semibold opacity-40 mb-0.5">/{fieldPlayers.length}</span>
            </div>
            <div className="text-xs opacity-75 mt-1.5 font-medium uppercase tracking-wide">{t.event.fieldPlayers}</div>
          </div>
          <div className="border-l border-white/20 pl-4">
            <div className="flex items-end gap-1">
              <span className="text-4xl font-bold leading-none">{keeperPresentCount}</span>
              <span className="text-xl font-semibold opacity-40 mb-0.5">/{keeperPlayers.length}</span>
            </div>
            <div className="text-xs opacity-75 mt-1.5 font-medium uppercase tracking-wide">{t.players.groups['Keepers']}</div>
          </div>
        </div>

        {/* Progress bar */}
        {allPlayers.length > 0 && (
          <div>
            <div className="flex justify-between text-xs opacity-70 mb-1.5">
              <span>{presentCount} {t.event.presentStat.toLowerCase()}</span>
              <span>{absentCount} {t.event.absentStat.toLowerCase()} · {unknownCount} {t.event.unknownStat.toLowerCase()}</span>
            </div>
            <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-green rounded-full transition-all duration-500"
                style={{ width: `${(presentCount / allPlayers.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {event.notes && (
          <div className="mt-5 pt-5 border-t border-white/20">
            <div className="text-xs opacity-75 mb-1 font-medium uppercase tracking-wide">{t.event.notes}</div>
            <div className="text-sm opacity-90">{event.notes}</div>
          </div>
        )}
      </div>

      {/* Lineup button (match only) */}
      {isMatch && (
        <Link href={`/events/${id}/lineup`} transitionTypes={['nav-forward']}>
          {lineup ? (
            <div className="rounded-xl p-4 border-2 border-green-300 bg-green-50 flex items-center gap-4 hover:border-green-400 transition-colors">
              <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center text-xl flex-shrink-0">✅</div>
              <div className="flex-1">
                <div className="font-semibold text-green-800">{t.event.lineupView}</div>
                <div className="text-sm text-green-600">{t.event.lineupViewHint}</div>
              </div>
              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden border-2 border-orange-300 hover:border-orange-400 transition-colors">
              <div className="bg-white px-4 pt-4 pb-3 flex items-center gap-4">
                <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-orange-500 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <rect x="2" y="4" width="20" height="16" rx="0.5" />
                    <line x1="12" y1="4" x2="12" y2="20" />
                    <circle cx="12" cy="12" r="3" />
                    <rect x="2" y="8" width="5" height="8" />
                    <rect x="17" y="8" width="5" height="8" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">{t.event.lineup}</div>
                  <div className="text-xs text-gray-400">{t.event.lineupHint}</div>
                </div>
                <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <div className="bg-orange-500 px-4 py-2.5 flex items-center gap-2">
                <svg className="w-4 h-4 text-white/70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-white font-semibold text-sm">{t.event.lineupCta}</span>
              </div>
            </div>
          )}
        </Link>
      )}

      {/* Training planner button (training only) */}
      {isTraining && (
        <Link href={`/events/${id}/training-plan`} transitionTypes={['nav-forward']}>
          {hasTrainingPlan ? (
            <div className="rounded-xl p-4 border-2 border-green-300 bg-green-50 flex items-center gap-4 hover:border-green-400 transition-colors">
              <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-semibold text-green-800">{t.event.trainingPlanView}</div>
                <div className="text-sm text-green-600">{t.event.trainingPlanViewHint}</div>
              </div>
              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden border-2 border-orange-300 hover:border-orange-400 transition-colors">
              <div className="bg-white px-4 pt-4 pb-3 flex items-center gap-4">
                <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">{t.event.trainingPlan}</div>
                  <div className="text-xs text-gray-400">{t.event.trainingPlanHint}</div>
                </div>
                <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <div className="bg-orange-500 px-4 py-2.5 flex items-center gap-2">
                <svg className="w-4 h-4 text-white/70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-white font-semibold text-sm">{t.event.trainingPlanCta}</span>
              </div>
            </div>
          )}
        </Link>
      )}

      {/* Delete — desktop only (left column) */}
      <div className="hidden lg:block">
        <DeleteButton
          label={t.event.deleteEvent}
          confirmMessage={`${t.event.deleteEvent}?`}
          action={handleDelete}
        />
      </div>

      </div>{/* end left column */}

      <div className="space-y-6">
      {/* Attendance */}
      <TrainingAttendance
        eventId={id}
        players={allPlayers}
        initialStatuses={initialStatuses}
      />

      {/* Delete — mobile only (below attendance) */}
      <div className="lg:hidden">
        <DeleteButton
          label={t.event.deleteEvent}
          confirmMessage={`${t.event.deleteEvent}?`}
          action={handleDelete}
        />
      </div>
      </div>{/* end right column */}

      </div>{/* end grid */}
    </div>
  )
}
