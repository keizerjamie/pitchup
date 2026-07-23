import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FootballEvent, AttendanceStatus, POSITION_ABBREVIATIONS } from '@/lib/types'
import { daysUntil, formatTime, todayLocal } from '@/lib/utils'
import { getDict } from '@/lib/i18n'
import DashboardHero from '@/components/dashboard/DashboardHero'
import StatCard from '@/components/dashboard/StatCard'
import WeekEvents, { WeekItem } from '@/components/dashboard/WeekEvents'
import Availability, { AvailabilityItem } from '@/components/dashboard/Availability'
import QuickActions from '@/components/dashboard/QuickActions'

const AVATAR_BG = ['#16a34a', '#14655c', '#0d3d38', '#1a6b63', '#0f766e', '#15803d']

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

  const [{ data: upcomingEvents }, { data: playerRows }, { data: teamNameRow }] = await Promise.all([
    supabase.from('events').select('*').eq('team_id', user.id).neq('type', 'meting').gte('date', today).order('date', { ascending: true }).limit(10),
    supabase.from('players').select('id, name, position, jersey_number, injured').eq('team_id', user.id).eq('active', true).order('jersey_number', { ascending: true, nullsFirst: false }),
    supabase.from('settings').select('value').eq('team_id', user.id).eq('key', 'team_name').maybeSingle(),
  ])

  const teamName = teamNameRow?.value?.trim() || null
  const upcoming: FootballEvent[] = upcomingEvents ?? []
  const players = playerRows ?? []
  const squadSize = players.length
  const totalActive = players.length
  const injuredCount = players.filter((p) => p.injured).length
  const fitCount = totalActive - injuredCount
  const injuredPct = totalActive > 0 ? Math.round((injuredCount / totalActive) * 100) : 0

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

  const nextMatch = upcoming.find((e) => e.type === 'match') ?? null
  const nextTraining = upcoming.find((e) => e.type === 'training') ?? null
  const heroEvent = nextMatch ?? nextTraining ?? upcoming[0] ?? null

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
  const thisWeekCount = upcoming.filter((e) => daysUntil(e.date) <= 7).length

  // ── "This week" rows ──
  const weekItems: WeekItem[] = upcoming
    .filter((e) => daysUntil(e.date) <= 7)
    .slice(0, 4)
    .map((e) => {
      const isMatch = e.type === 'match'
      const d = new Date(e.date + 'T00:00:00')
      const s = statsFor(e.id)
      return {
        id: e.id,
        day: d.toLocaleDateString(t.browserLocale, { weekday: 'short' }).replace('.', '').slice(0, 2).toUpperCase(),
        date: String(d.getDate()),
        typeLabel: isMatch ? t.event.match : t.event.training,
        accent: isMatch ? '#16a34a' : '#14655c',
        title: isMatch ? (e.opponent ? `vs ${e.opponent}` : t.event.match) : t.event.training,
        time: formatTime(e.time),
        place: e.location ?? '',
        pct: squadSize > 0 && s.total > 0 ? Math.round((s.present / squadSize) * 100) : null,
      }
    })

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
        <StatCard label={t.home.statUpcoming} icon="event" value={upcoming.length} />
        <StatCard label={t.home.statThisWeek} icon="date_range" value={thisWeekCount} />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
        <WeekEvents items={weekItems} t={t} />
        <div className="flex flex-col gap-4">
          <Availability items={availabilityItems} t={t} />
          <QuickActions t={t} />
        </div>
      </div>
    </div>
  )
}
