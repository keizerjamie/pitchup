import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AttendanceStatus, POSITION_COLORS } from '@/lib/types'
import PlayerAbsenceList from '@/components/PlayerAbsenceList'
import BackButton from '@/components/BackButton'
import { getDict } from '@/lib/i18n'
import { todayLocal } from '@/lib/utils'

interface Props {
  params: Promise<{ id: string }>
}

export default async function PlayerAbsencePage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = todayLocal()

  const [{ data: player }, { data: events }, { data: attendance }] = await Promise.all([
    supabase.from('players').select('*').eq('id', id).eq('team_id', user.id).single(),
    supabase.from('events').select('*').eq('team_id', user.id).neq('type', 'meting').gte('date', today).order('date', { ascending: true }).limit(60),
    supabase.from('attendance').select('event_id, status').eq('player_id', id).eq('team_id', user.id),
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
    <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
      <div className="sticky top-16 md:top-0 z-10 -mx-4 px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-3">
        <BackButton fallback="/players" className="text-gray-400 hover:text-gray-600 flex-shrink-0">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </BackButton>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">{player.name}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${POSITION_COLORS[player.position as keyof typeof POSITION_COLORS]}`}>
              {t.players.positions[player.position] ?? player.position}
            </span>
            {player.jersey_number && (
              <span className="text-xs text-gray-400">#{player.jersey_number}</span>
            )}
          </div>
        </div>
        <Link href={`/players/${id}/edit`} className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200">
          {t.players.editLabel}
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-1">{t.players.attendanceTitle}</h2>
        <p className="text-sm text-gray-500 mb-4">{t.players.attendanceHint}</p>
        <PlayerAbsenceList playerId={id} events={eventsWithStatus} />
      </div>
    </div>
  )
}
