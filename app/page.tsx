import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FootballEvent, AttendanceStatus, POSITION_ABBREVIATIONS } from '@/lib/types'
import { addDays, daysUntil, todayLocal } from '@/lib/utils'
import { getDict } from '@/lib/i18n'
import DashboardHero from '@/components/dashboard/DashboardHero'
import StatCard from '@/components/dashboard/StatCard'
import NextMatch from '@/components/dashboard/NextMatch'
import TodoList, { TaskType, TodoItem } from '@/components/dashboard/TodoList'
import Availability, { AvailabilityItem } from '@/components/dashboard/Availability'
import QuickActions from '@/components/dashboard/QuickActions'
import FormStrip, { FormStripItem } from '@/components/dashboard/FormStrip'
import ChartBarIcon from '@/components/icons/ChartBarIcon'
import { FORWARD, analysisDeadline, effectiveDone, hasTrainingPlanDone, isTaskVisible, sortTasks } from '@/lib/todos.mjs'
import { analyseBestaat, matchResult } from '@/lib/match-analysis.mjs'

const AVATAR_BG = ['#16a34a', '#14655c', '#0d3d38', '#1a6b63', '#0f766e', '#15803d']
// AANNAME A1 (goedgekeurd): backward-fetchhorizon voor To-do kandidaat-events —
// ruim genoeg zodat wedstrijden/trainingen met een nog open taak niet gemist
// worden, ook als hun event-datum ver vóór vandaag ligt (bv. late analyse-deadline).
const FETCH_HORIZON_DAYS = 30

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return (words.length >= 2 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase()
}

export default async function DashboardPage() {
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = todayLocal()
  const windowEnd = addDays(today, FORWARD)
  const fetchStart = addDays(today, -FETCH_HORIZON_DAYS)

  const [
    { data: upcomingEvents },
    { data: playerRows },
    { data: teamNameRow },
    { data: todoCandidateEvents },
    { data: trainingDateRows },
    { data: recentMatchRows },
  ] = await Promise.all([
    supabase.from('events').select('*').eq('team_id', user.id).neq('type', 'meting').gte('date', today).order('date', { ascending: true }).limit(10),
    supabase.from('players').select('id, name, position, jersey_number, injured').eq('team_id', user.id).eq('active', true).order('jersey_number', { ascending: true, nullsFirst: false }),
    supabase.from('settings').select('value').eq('team_id', user.id).eq('key', 'team_name').maybeSingle(),
    // Kandidaat-events voor de To-do: alles binnen het venster, ongeacht status
    // (zichtbaarheid wordt verderop bepaald door isTaskVisible).
    supabase.from('events').select('*').eq('team_id', user.id).neq('type', 'meting').gte('date', fetchStart).lte('date', windowEnd).order('date', { ascending: true }),
    // Trainingsdatums voor de live analyse-deadline — bewust ONbegrensd naar
    // voren (geen lte windowEnd): never-miss, zie lib/todos.mjs isTaskVisible.
    supabase.from('events').select('date').eq('team_id', user.id).eq('type', 'training').gte('date', fetchStart).order('date', { ascending: true }),
    // Recente vorm (W/G/V) van de laatste 5 afgeronde wedstrijden — alle
    // match_type's tellen mee, oefenwedstrijden inclusief.
    supabase.from('events')
      .select('id, date, goals_for, goals_against')
      .eq('team_id', user.id)
      .eq('type', 'match')
      .lt('date', today)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(5),
  ])

  const teamName = teamNameRow?.value?.trim() || null
  const upcoming: FootballEvent[] = upcomingEvents ?? []
  const players = playerRows ?? []
  const squadSize = players.length
  const totalActive = players.length
  const injuredCount = players.filter((p) => p.injured).length
  const fitCount = totalActive - injuredCount
  const injuredPct = totalActive > 0 ? Math.round((injuredCount / totalActive) * 100) : 0
  const recentForm: FormStripItem[] =
    (recentMatchRows ?? []).map((m) => ({ id: m.id, result: matchResult(m) }))

  const allEventIds = upcoming.map((e) => e.id)
  const { data: attendanceRows } = allEventIds.length > 0
    ? await supabase.from('attendance').select('event_id, player_id, status').eq('team_id', user.id).in('event_id', allEventIds)
    : { data: [] }
  const allAttendance = attendanceRows ?? []

  function statsFor(eventId: string) {
    const records = allAttendance.filter((a) => a.event_id === eventId)
    const present = records.filter((a) => a.status === 'present').length
    const absent = records.filter((a) => a.status === 'absent').length
    return { present, absent, total: records.length }
  }

  // Hero = the chronologically next activity (training or match). The upcoming
  // list is already sorted ascending by date. The next match gets its own card.
  const nextMatch = upcoming.find((e) => e.type === 'match') ?? null
  const heroEvent = upcoming[0] ?? null

  // ── Greeting + date line ──
  const hour = new Date().getHours()
  const greeting = hour < 12 ? t.home.greetingMorning : hour < 18 ? t.home.greetingAfternoon : t.home.greetingEvening
  const dateLine = (() => {
    const d = new Date(today + 'T00:00:00').toLocaleDateString(t.browserLocale, { weekday: 'long', day: 'numeric', month: 'long' })
    return d.charAt(0).toUpperCase() + d.slice(1)
  })()

  // ── Stat cards (all real data) ──
  let totalPresent = 0, totalAbsent = 0
  for (const a of allAttendance) {
    if (a.status === 'present') totalPresent++
    else if (a.status === 'absent') totalAbsent++
  }
  const attendancePct = totalPresent + totalAbsent > 0
    ? Math.round((totalPresent / (totalPresent + totalAbsent)) * 100)
    : null
  // ── To-do (open opstelling/analyse/trainingsplan-taken) ──
  const todoCandidates: FootballEvent[] = todoCandidateEvents ?? []
  const trainingDates: string[] = (trainingDateRows ?? []).map((r: { date: string }) => r.date)
  const matchCandidateIds = todoCandidates.filter((e) => e.type === 'match').map((e) => e.id)
  const trainingCandidateIds = todoCandidates.filter((e) => e.type === 'training').map((e) => e.id)
  const allCandidateIds = todoCandidates.map((e) => e.id)

  const [
    { data: lineupRows },
    { data: matchRatingRows },
    { data: matchEventRows },
    { data: oefeningRows },
    { data: overrideRows },
  ] = await Promise.all([
    matchCandidateIds.length > 0
      ? supabase.from('lineups').select('event_id').eq('team_id', user.id).in('event_id', matchCandidateIds)
      : Promise.resolve({ data: [] }),
    matchCandidateIds.length > 0
      ? supabase.from('match_ratings').select('event_id').eq('team_id', user.id).in('event_id', matchCandidateIds)
      : Promise.resolve({ data: [] }),
    matchCandidateIds.length > 0
      ? supabase.from('match_events').select('event_id').eq('team_id', user.id).in('event_id', matchCandidateIds)
      : Promise.resolve({ data: [] }),
    trainingCandidateIds.length > 0
      ? supabase.from('training_oefeningen').select('event_id').eq('team_id', user.id).in('event_id', trainingCandidateIds)
      : Promise.resolve({ data: [] }),
    allCandidateIds.length > 0
      ? supabase.from('task_overrides').select('event_id, task_type').eq('team_id', user.id).in('event_id', allCandidateIds)
      : Promise.resolve({ data: [] }),
  ])

  const lineupSet = new Set<string>((lineupRows ?? []).map((r: { event_id: string }) => r.event_id))
  const manualSet = new Set<string>(
    (overrideRows ?? []).map((r: { event_id: string; task_type: string }) => `${r.event_id}:${r.task_type}`)
  )
  function countByEvent(rows: { event_id: string }[] | null): Map<string, number> {
    const m = new Map<string, number>()
    for (const r of rows ?? []) m.set(r.event_id, (m.get(r.event_id) ?? 0) + 1)
    return m
  }
  const ratingCountMap = countByEvent(matchRatingRows)
  const matchEventCountMap = countByEvent(matchEventRows)
  const oefCountMap = countByEvent(oefeningRows)

  interface RawTask {
    eventId: string
    taskType: TaskType
    opponent: string | null
    deadline: string
    eventDate: string
    auto: boolean
    manual: boolean
    effective: boolean
  }
  const rawTasks: RawTask[] = []

  for (const e of todoCandidates) {
    if (e.type === 'match') {
      const lineupAuto = lineupSet.has(e.id)
      const lineupManual = manualSet.has(`${e.id}:lineup`)
      const lineupEffective = effectiveDone(lineupAuto, lineupManual)
      if (isTaskVisible({ taskType: 'lineup', done: lineupEffective, daysUntilEvent: daysUntil(e.date), daysUntilDeadline: 0 })) {
        rawTasks.push({
          eventId: e.id, taskType: 'lineup', opponent: e.opponent, deadline: e.date, eventDate: e.date,
          auto: lineupAuto, manual: lineupManual, effective: lineupEffective,
        })
      }

      const analysisAuto = analyseBestaat({
        goals_for: e.goals_for,
        goals_against: e.goals_against,
        ratingCount: ratingCountMap.get(e.id) ?? 0,
        eventCount: matchEventCountMap.get(e.id) ?? 0,
      })
      const analysisManual = manualSet.has(`${e.id}:analysis`)
      const analysisEffective = effectiveDone(analysisAuto, analysisManual)
      const deadline = analysisDeadline(e.date, trainingDates)
      if (isTaskVisible({ taskType: 'analysis', done: analysisEffective, daysUntilEvent: daysUntil(e.date), daysUntilDeadline: daysUntil(deadline) })) {
        rawTasks.push({
          eventId: e.id, taskType: 'analysis', opponent: e.opponent, deadline, eventDate: e.date,
          auto: analysisAuto, manual: analysisManual, effective: analysisEffective,
        })
      }
    } else if (e.type === 'training') {
      const auto = hasTrainingPlanDone(e.doelstelling, oefCountMap.get(e.id) ?? 0)
      const manual = manualSet.has(`${e.id}:training_plan`)
      const effective = effectiveDone(auto, manual)
      if (isTaskVisible({ taskType: 'training_plan', done: effective, daysUntilEvent: daysUntil(e.date), daysUntilDeadline: 0 })) {
        rawTasks.push({
          eventId: e.id, taskType: 'training_plan', opponent: null, deadline: e.date, eventDate: e.date,
          auto, manual, effective,
        })
      }
    }
  }

  const todoItems: TodoItem[] = sortTasks(rawTasks).map((task) => ({
    eventId: task.eventId,
    taskType: task.taskType,
    opponent: task.opponent,
    deadline: task.deadline,
    eventDate: task.eventDate,
    auto: task.auto,
    manual: task.manual,
  }))

  // ── Availability for the next event ──
  const heroAttendance = new Map<string, AttendanceStatus>()
  if (heroEvent) {
    for (const a of allAttendance) {
      if (a.event_id === heroEvent.id && a.player_id) heroAttendance.set(a.player_id, a.status as AttendanceStatus)
    }
  }
  const availabilityItems: AvailabilityItem[] = players.slice(0, 6).map((p, i) => ({
    id: p.id,
    initials: initialsOf(p.name),
    avatarBg: AVATAR_BG[i % AVATAR_BG.length],
    name: p.name,
    num: p.jersey_number,
    pos: POSITION_ABBREVIATIONS[p.position] ?? p.position,
    status: heroAttendance.get(p.id) ?? 'unknown',
    injured: p.injured,
  }))

  const heroStats = heroEvent ? statsFor(heroEvent.id) : { present: 0, absent: 0, total: 0 }
  const heroIsMatch = heroEvent?.type === 'match'
  const heroTitle = !heroEvent ? '' : heroIsMatch
    ? `${teamName ? `${teamName} ` : ''}vs ${heroEvent.opponent ?? '?'}`
    : t.event.training

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      {/* Topbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-col leading-tight">
          <span className="text-[13px] font-bold text-faint">{dateLine}</span>
          <span className="font-display text-[24px] lg:text-[27px] font-bold tracking-tight text-ink">
            {greeting} 👋
          </span>
        </div>
        <Link
          href="/events/new"
          className="h-[42px] rounded-xl px-[18px] flex items-center gap-2 text-[13.5px] font-bold text-white"
          style={{ background: 'var(--brand-btn)' }}
        >
          <span className="ms text-[19px]">add</span>
          {t.home.newEvent}
        </Link>
      </div>

      {heroEvent ? (
        <DashboardHero
          event={heroEvent}
          kind={heroIsMatch ? 'match' : 'training'}
          title={heroTitle}
          t={t}
          present={heroStats.present}
          absent={heroStats.absent}
          squadSize={squadSize}
          primaryHref={heroIsMatch ? `/events/${heroEvent.id}/lineup` : `/events/${heroEvent.id}/training-plan`}
          primaryLabel={heroIsMatch ? t.home.makeLineup : t.home.makeTrainingPlan}
          primaryIcon={heroIsMatch ? 'sports' : 'assignment'}
          secondaryHref={`/events/${heroEvent.id}`}
          secondaryLabel={t.home.viewEvent}
        />
      ) : (
        <div className="surface-card p-10 text-center flex flex-col items-center gap-3">
          <span className="ms text-[40px] text-faint">calendar_month</span>
          <p className="text-ink font-bold">{t.home.empty}</p>
          <p className="text-faint text-sm">{t.home.emptyHint}</p>
          <Link
            href="/events/new"
            className="mt-1 h-11 rounded-xl px-5 flex items-center gap-2 text-sm font-bold text-white"
            style={{ background: 'var(--brand-btn)' }}
          >
            <span className="ms text-[19px]">add</span>
            {t.home.newEvent}
          </Link>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          label={t.home.statAttendance}
          icon="trending_up"
          value={attendancePct !== null ? `${attendancePct}%` : '—'}
        >
          <div className="h-[7px] rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
            <div className="h-full" style={{ width: `${attendancePct ?? 0}%`, background: 'linear-gradient(90deg,#16a34a,#4ade80)' }} />
          </div>
        </StatCard>
        <StatCard label={t.home.statActivePlayers} icon="groups" value={totalActive}>
          <div className="flex flex-col gap-2">
            <div className="h-[7px] rounded-full overflow-hidden flex" style={{ background: 'var(--track)' }}>
              {totalActive > 0 && fitCount > 0 && (
                <div style={{ width: `${(fitCount / totalActive) * 100}%`, background: '#16a34a' }} />
              )}
              {totalActive > 0 && injuredCount > 0 && (
                <div style={{ width: `${(injuredCount / totalActive) * 100}%`, background: '#ef4444' }} />
              )}
            </div>
            <span className="text-[11.5px] font-semibold text-faint">
              {fitCount} {t.home.fit} · {injuredCount} {t.home.injured} ({injuredPct}%)
            </span>
          </div>
        </StatCard>
        <StatCard label={t.home.statForm} icon={<ChartBarIcon className="w-5 h-5" />} value={
          recentForm.length > 0
            ? <FormStrip items={recentForm} t={t} />
            : <span className="text-[13px] font-semibold text-faint">{t.home.formEmpty}</span>
        } />
        <NextMatch match={nextMatch} t={t} />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
        <TodoList items={todoItems} />
        <div className="flex flex-col gap-4">
          <Availability items={availabilityItems} t={t} />
          <QuickActions t={t} />
        </div>
      </div>
    </div>
  )
}
