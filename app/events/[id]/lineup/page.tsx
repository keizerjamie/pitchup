import { notFound, redirect } from 'next/navigation'
import BackButton from '@/components/BackButton'
import { createClient } from '@/lib/supabase/server'
import { Player } from '@/lib/types'
import LineupBuilder from '@/components/LineupBuilder'
import { getDict } from '@/lib/i18n'

interface Props {
  params: Promise<{ id: string }>
}

export default async function LineupPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: event }, { data: attendance }, { data: lineup }] = await Promise.all([
    supabase.from('events').select('*').eq('id', id).eq('team_id', user.id).single(),
    supabase.from('attendance').select('player_id, status').eq('event_id', id).eq('team_id', user.id),
    supabase.from('lineups').select('*').eq('event_id', id).eq('team_id', user.id).maybeSingle(),
  ])

  if (!event || event.type !== 'match') notFound()

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

  const sortedPlayers = [
    ...players.filter((p) => presentPlayerIds.has(p.id)),
    ...players.filter((p) => !presentPlayerIds.has(p.id)),
  ]

  const presentPlayers = players.filter((p) => presentPlayerIds.has(p.id))
  const absentPlayers = players.filter((p) => !presentPlayerIds.has(p.id))

  const overviewGroups = [
    { label: 'GK',   positions: ['Keeper'] },
    { label: 'Verd', positions: ['Linksachter', 'Centrale verdediger', 'Rechtsachter'] },
    { label: 'Mid',  positions: ['Defensieve middenvelder', 'Centrale middenvelder', 'Linksmiddenvelder', 'Rechtsmiddenvelder', 'Aanvallende middenvelder'] },
    { label: 'Aanv', positions: ['Linksbuiten', 'Rechtsbuiten', 'Spits'] },
  ]

  return (
    <div className="max-w-2xl lg:max-w-5xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <BackButton fallback={`/events/${id}`}>
          <span className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center text-muted hover:text-ink transition-colors" style={{ border: '1px solid var(--border-soft)' }}>
            <span className="ms text-[22px]">arrow_back</span>
          </span>
        </BackButton>
        <div>
          <h1 className="font-display text-[22px] lg:text-[26px] font-bold text-ink">{t.lineup.title}</h1>
          <p className="text-[13px] font-semibold text-faint">
            {t.lineup.vsLabel} {event.opponent} · {presentPlayers.length} {t.lineup.presentCount}
          </p>
        </div>
      </div>

      {/* Desktop: builder left, player overview right */}
      <div className="lg:grid lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-10 lg:items-start flex flex-col gap-5">

        {/* Player overview */}
        <div className="grid grid-cols-2 lg:grid-cols-1 gap-2.5 order-2 lg:sticky lg:top-8">
          {overviewGroups.map((group) => {
            const gp = presentPlayers.filter((p) => group.positions.includes(p.position))
            return (
              <div key={group.label} className="surface-card p-3">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-brand-accent mb-1.5">{group.label}</p>
                <div className="flex flex-col gap-1">
                  {gp.map((p) => (
                    <div key={p.id} className="flex items-baseline gap-1.5 min-w-0">
                      {p.jersey_number != null && <span className="text-[10px] font-bold text-faint flex-shrink-0">{p.jersey_number}</span>}
                      <span className="text-xs font-semibold text-ink truncate">{p.name.split(' ')[0]}</span>
                    </div>
                  ))}
                  {gp.length === 0 && <span className="text-[10px] text-faint">—</span>}
                </div>
              </div>
            )
          })}
          <div className="surface-card p-3">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-faint mb-1.5">{t.event.absentStat}</p>
            <div className="flex flex-col gap-1">
              {absentPlayers.map((p) => (
                <div key={p.id} className="flex items-baseline gap-1.5 min-w-0">
                  {p.jersey_number != null && <span className="text-[10px] font-bold text-faint flex-shrink-0">{p.jersey_number}</span>}
                  <span className="text-xs text-muted truncate">{p.name.split(' ')[0]}</span>
                </div>
              ))}
              {absentPlayers.length === 0 && <span className="text-[10px] text-faint">—</span>}
            </div>
          </div>
        </div>

        <div className="order-1">
          <LineupBuilder
            eventId={id}
            players={sortedPlayers}
            presentPlayerIds={[...presentPlayerIds]}
            initialFormation={lineup?.formation}
            initialPositions={lineup?.positions}
          />
        </div>

      </div>
    </div>
  )
}
