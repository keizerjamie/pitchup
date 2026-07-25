import { notFound, redirect } from 'next/navigation'
import BackButton from '@/components/BackButton'
import { createClient } from '@/lib/supabase/server'
import { Player, MatchRating, MatchEvent } from '@/lib/types'
import MatchAnalysisEditor from '@/components/MatchAnalysisEditor'
import { getDict } from '@/lib/i18n'

interface Props {
  params: Promise<{ id: string }>
}

export default async function AnalysisPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: event }, { data: attendance }, { data: ratings }, { data: matchEvents }, { data: teamNameRow }] = await Promise.all([
    supabase.from('events').select('*').eq('id', id).eq('team_id', user.id).single(),
    supabase.from('attendance').select('player_id, status').eq('event_id', id).eq('team_id', user.id),
    supabase.from('match_ratings').select('id,event_id,player_id,rating,created_at').eq('event_id', id).eq('team_id', user.id),
    supabase.from('match_events').select('id,event_id,player_id,kind,minute,created_at').eq('event_id', id).eq('team_id', user.id),
    supabase.from('settings').select('value').eq('team_id', user.id).eq('key', 'team_name').maybeSingle(),
  ])

  if (!event || event.type !== 'match') notFound()

  const teamName = teamNameRow?.value?.trim() || null

  const presentPlayerIds = new Set(
    (attendance ?? []).filter((a) => a.status === 'present').map((a) => a.player_id)
  )

  const { data: allPlayers } = await supabase
    .from('players')
    .select('*')
    .eq('team_id', user.id)
    .eq('active', true)
    .order('jersey_number', { ascending: true, nullsFirst: false })
    .order('name')

  const players: Player[] = allPlayers ?? []
  const presentPlayers = players.filter((p) => presentPlayerIds.has(p.id))

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <BackButton fallback={`/events/${id}`}>
          <span className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center text-muted hover:text-ink transition-colors" style={{ border: '1px solid var(--border-soft)' }}>
            <span className="ms text-[22px]">arrow_back</span>
          </span>
        </BackButton>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-[22px] lg:text-[26px] font-bold text-ink truncate">{t.analysis.title}</h1>
          <p className="text-[13px] font-semibold text-faint">
            {t.lineup.vsLabel} {event.opponent}
          </p>
        </div>
      </div>

      <MatchAnalysisEditor
        eventId={id}
        presentPlayers={presentPlayers}
        teamName={teamName}
        opponent={event.opponent}
        homeAway={event.home_away}
        initialGoalsFor={event.goals_for}
        initialGoalsAgainst={event.goals_against}
        initialRatings={(ratings ?? []) as MatchRating[]}
        initialEvents={(matchEvents ?? []) as MatchEvent[]}
      />
    </div>
  )
}
