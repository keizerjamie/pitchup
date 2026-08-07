import { notFound, redirect } from 'next/navigation'
import BackButton from '@/components/BackButton'
import { createClient } from '@/lib/supabase/server'
import { Player } from '@/lib/types'
import { formatDateLong } from '@/lib/utils'
import MatchSquadEditor from '@/components/MatchSquadEditor'
import { getDict } from '@/lib/i18n'

interface Props {
  params: Promise<{ id: string }>
}

export default async function MatchSquadPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: event }, { data: squad }, { data: allPlayers }] = await Promise.all([
    supabase.from('events').select('*').eq('id', id).eq('team_id', user.id).single(),
    supabase.from('match_squad').select('player_id').eq('event_id', id).eq('team_id', user.id),
    supabase.from('players').select('*').eq('team_id', user.id).order('name'),
  ])

  if (!event || event.type !== 'match') notFound()

  const selectedIds = new Set((squad ?? []).map((s) => s.player_id))
  const players: Player[] = allPlayers ?? []
  // Unie van actieve spelers en al-geselecteerde spelers: een speler die ná
  // selectie inactief wordt gemaakt verdwijnt niet stilzwijgend uit de lijst
  // (en dus de export) — hij blijft zichtbaar met het inactief-label.
  const selectable = players.filter((p) => p.active || selectedIds.has(p.id))
  const dateLabel = formatDateLong(event.date, t.browserLocale)

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      <div className="flex items-center gap-3 print:hidden">
        <BackButton fallback={`/events/${id}`}>
          <span className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center text-muted hover:text-ink transition-colors" style={{ border: '1px solid var(--border-soft)' }}>
            <span className="ms text-[22px]">arrow_back</span>
          </span>
        </BackButton>
        <div>
          <h1 className="font-display text-[22px] lg:text-[26px] font-bold text-ink">{t.matchSquad.title}</h1>
        </div>
      </div>

      <MatchSquadEditor
        eventId={id}
        players={selectable}
        initialSelectedIds={[...selectedIds]}
        opponent={event.opponent}
        dateLabel={dateLabel}
      />
    </div>
  )
}
