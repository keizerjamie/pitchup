import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AttendanceStatus, POSITION_COLORS } from '@/lib/types'
import PlayerAbsenceList from '@/components/PlayerAbsenceList'
import BackButton from '@/components/BackButton'
import { getDict } from '@/lib/i18n'
import { todayLocal } from '@/lib/utils'
import { getDefaultAttendance } from '@/app/actions/settings'

interface Props {
  params: Promise<{ id: string }>
}

export default async function PlayerAbsencePage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = todayLocal()

  const [{ data: player }, { data: events }, { data: attendance }, { data: periods }, defaultStatus] = await Promise.all([
    supabase.from('players').select('*').eq('id', id).eq('team_id', user.id).single(),
    supabase.from('events').select('*').eq('team_id', user.id).neq('type', 'meting').gte('date', today).order('date', { ascending: true }).limit(60),
    supabase.from('attendance').select('event_id, status').eq('player_id', id).eq('team_id', user.id),
    supabase.from('absence_periods').select('id, player_id, from_date, to_date').eq('player_id', id).eq('team_id', user.id).order('from_date', { ascending: true }).limit(60),
    getDefaultAttendance(),
  ])

  if (!player) notFound()

  const attendanceMap = new Map<string, AttendanceStatus>()
  for (const a of attendance ?? []) {
    attendanceMap.set(a.event_id, a.status as AttendanceStatus)
  }

  const eventsWithStatus = (events ?? []).map((e) => ({
    ...e,
    status: attendanceMap.get(e.id) ?? 'unknown' as AttendanceStatus,
  }))

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-5">
      {/* De sticky-offset moet exact de hoogte van de mobiele header uit
          AppShell zijn: die is h-14 (3.5rem) PLUS env(safe-area-inset-top).
          Met het eerdere vaste `top-16` (64px) schoof deze balk op een toestel
          met notch onder de header door. Blijft dit ooit niet meer kloppen,
          check dan `anchor-mobile-header` in AppShell.tsx. */}
      <div className="sticky top-[calc(env(safe-area-inset-top)_+_3.5rem)] md:top-0 z-10 -mx-4 px-4 py-3 bg-[var(--bg)] border-b border-[var(--border-soft)] flex items-center gap-3">
        <BackButton fallback="/players" className="text-faint hover:text-muted flex-shrink-0">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </BackButton>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-ink truncate">{player.name}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${POSITION_COLORS[player.position as keyof typeof POSITION_COLORS]}`}>
              {t.players.positions[player.position] ?? player.position}
            </span>
            {player.jersey_number && (
              <span className="text-xs text-faint">#{player.jersey_number}</span>
            )}
          </div>
        </div>
        <Link href={`/players/${id}/edit`} className="text-xs text-muted hover:text-ink px-3 py-1.5 rounded-lg border border-[var(--border-soft)]">
          {t.players.editLabel}
        </Link>
      </div>

      <div className="surface-card p-5">
        <h2 className="font-semibold text-ink mb-1">{t.players.attendanceTitle}</h2>
        <p className="text-sm text-muted mb-4">{t.players.attendanceHint}</p>
        <PlayerAbsenceList
          playerId={id}
          events={eventsWithStatus}
          periods={periods ?? []}
          defaultStatus={defaultStatus}
        />
      </div>
    </div>
  )
}
