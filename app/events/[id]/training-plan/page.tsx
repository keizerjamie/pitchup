import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Player } from '@/lib/types'
import { cycleWeekFor, countCategoryOccurrences, computeCurrentSteps, dueCategories } from '@/lib/periodization'
import { formatDateLong } from '@/lib/utils'
import BackButton from '@/components/BackButton'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import AttendanceSummary from '@/components/AttendanceSummary'
import { getDict } from '@/lib/i18n'

interface Props {
  params: Promise<{ id: string }>
}

export default async function TrainingPlanPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .eq('team_id', user.id)
    .single()

  if (!event || event.type !== 'training') notFound()

  // ── Attendance overview: who is present / not present for this training ──
  const [{ data: playersData }, { data: attendanceData }] = await Promise.all([
    supabase.from('players').select('*').eq('team_id', user.id).eq('active', true)
      .order('position').order('jersey_number', { ascending: true, nullsFirst: false }).order('name'),
    supabase.from('attendance').select('player_id, status').eq('event_id', id).eq('team_id', user.id),
  ])
  const activePlayers: Player[] = playersData ?? []
  const presentIds = new Set((attendanceData ?? []).filter((a) => a.status === 'present').map((a) => a.player_id))
  const presentPlayers = activePlayers.filter((p) => presentIds.has(p.id))
  const absentPlayers = activePlayers.filter((p) => !presentIds.has(p.id))

  // ── Find latest meting event before this training ──
  const { data: metingEvents } = await supabase
    .from('events')
    .select('id, date')
    .eq('team_id', user.id)
    .eq('type', 'meting')
    .lt('date', event.date)
    .order('date', { ascending: false })
    .limit(1)

  const latestMetingEvent = metingEvents?.[0] ?? null

  // ── Load meting step data (parallel with exercises) ──
  const [metingResult, oefeningenResult] = await Promise.all([
    latestMetingEvent
      ? supabase.from('metingen').select('*').eq('event_id', latestMetingEvent.id).eq('team_id', user.id).single()
      : Promise.resolve({ data: null }),
    supabase.from('oefeningen').select('*').eq('event_id', id).eq('team_id', user.id).order('volgorde'),
  ])

  const latestMeting = metingResult.data
  const oefeningen = oefeningenResult.data ?? []

  // ── Current steps per category, as of this training's date ──
  const occurrences = latestMetingEvent
    ? await countCategoryOccurrences(supabase, user.id, latestMetingEvent.date, event.date)
    : {}
  const currentSteps = computeCurrentSteps(latestMeting, occurrences)

  // ── Cycle-week suggestion: which categories are due this week ──
  const cycleWeek = latestMetingEvent ? cycleWeekFor(latestMetingEvent.date, event.date) : null
  const suggestion = cycleWeek !== null
    ? {
        week: cycleWeek,
        items: dueCategories(cycleWeek).map((cat) => ({
          key: cat.key,
          step: currentSteps[cat.key] ?? null,
        })),
      }
    : null

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">

      <div className="flex items-center gap-3">
        <BackButton fallback={`/events/${id}`} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </BackButton>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t.event.trainingPlan}</h1>
          <p className="text-sm text-gray-500">{formatDateLong(event.date, t.browserLocale)}</p>
        </div>
      </div>

      {/* Desktop: planner left, attendance overview right (sticky). Mobile: overview on top. */}
      <div className="lg:grid lg:grid-cols-[1fr_19rem] lg:gap-8 lg:items-start space-y-6 lg:space-y-0">
        <div className="lg:order-2">
          <AttendanceSummary
            present={presentPlayers}
            absent={absentPlayers}
            eventId={id}
            t={t}
            className="lg:sticky lg:top-10"
          />
        </div>

        <div className="lg:order-1 min-w-0">
          <TrainingPlanEditor
            eventId={id}
            initialDoelstelling={event.doelstelling ?? null}
            initialOefeningen={oefeningen}
            currentSteps={currentSteps}
            hasNulmeting={!!latestMeting}
            suggestion={suggestion}
          />
        </div>
      </div>

    </div>
  )
}
