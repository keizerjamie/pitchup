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

  return (
    <div className="max-w-2xl lg:max-w-5xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">
      <div className="flex items-center gap-3">
        <BackButton fallback={`/events/${id}`} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </BackButton>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t.lineup.title}</h1>
          <p className="text-sm text-gray-500">
            {t.lineup.vsLabel} {event.opponent} • {presentPlayers.length} {t.lineup.presentCount}
          </p>
        </div>
      </div>

      {/* Desktop: builder left, player overview right */}
      <div className="lg:grid lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-10 lg:items-start space-y-6 lg:space-y-0">

      {/* Player overview — 4 columns */}
      <div className="grid grid-cols-4 gap-2 lg:order-2 lg:grid-cols-2 lg:sticky lg:top-10">

        {/* Col 1: GK stacked above VERD */}
        <div className="flex flex-col gap-2">
          {[
            { label: 'GK',   positions: ['Keeper'], color: 'text-green-500' },
            { label: 'Verd', positions: ['Linksachter', 'Centrale verdediger', 'Rechtsachter'], color: 'text-green-500' },
          ].map((group) => {
            const gp = presentPlayers.filter(p => group.positions.includes(p.position))
            return (
              <div key={group.label} className="bg-green-50 rounded-lg p-2">
                <p className={`text-[10px] font-bold uppercase tracking-wide mb-1 ${group.color}`}>{group.label}</p>
                <div className="flex flex-col gap-0.5">
                  {gp.map(p => (
                    <div key={p.id} className="flex items-baseline gap-1 min-w-0">
                      {p.jersey_number && <span className="text-[10px] font-bold text-green-400 flex-shrink-0">{p.jersey_number}</span>}
                      <span className="text-xs font-medium text-green-900 truncate">{p.name.split(' ')[0]}</span>
                    </div>
                  ))}
                  {gp.length === 0 && <span className="text-[10px] text-green-300">—</span>}
                </div>
              </div>
            )
          })}
        </div>

        {/* Col 2: MID */}
        {(() => {
          const gp = presentPlayers.filter(p => ['Defensieve middenvelder','Centrale middenvelder','Linksmiddenvelder','Rechtsmiddenvelder','Aanvallende middenvelder'].includes(p.position))
          return (
            <div className="bg-green-50 rounded-lg p-2">
              <p className="text-[10px] font-bold text-green-500 uppercase tracking-wide mb-1">Mid</p>
              <div className="flex flex-col gap-0.5">
                {gp.map(p => (
                  <div key={p.id} className="flex items-baseline gap-1 min-w-0">
                    {p.jersey_number && <span className="text-[10px] font-bold text-green-400 flex-shrink-0">{p.jersey_number}</span>}
                    <span className="text-xs font-medium text-green-900 truncate">{p.name.split(' ')[0]}</span>
                  </div>
                ))}
                {gp.length === 0 && <span className="text-[10px] text-green-300">—</span>}
              </div>
            </div>
          )
        })()}

        {/* Col 3: AANV */}
        {(() => {
          const gp = presentPlayers.filter(p => ['Linksbuiten','Rechtsbuiten','Spits'].includes(p.position))
          return (
            <div className="bg-green-50 rounded-lg p-2">
              <p className="text-[10px] font-bold text-green-500 uppercase tracking-wide mb-1">Aanv</p>
              <div className="flex flex-col gap-0.5">
                {gp.map(p => (
                  <div key={p.id} className="flex items-baseline gap-1 min-w-0">
                    {p.jersey_number && <span className="text-[10px] font-bold text-green-400 flex-shrink-0">{p.jersey_number}</span>}
                    <span className="text-xs font-medium text-green-900 truncate">{p.name.split(' ')[0]}</span>
                  </div>
                ))}
                {gp.length === 0 && <span className="text-[10px] text-green-300">—</span>}
              </div>
            </div>
          )
        })()}

        {/* Col 4: Absent */}
        <div className="bg-gray-50 rounded-lg p-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">{t.event.absentStat}</p>
          <div className="flex flex-col gap-0.5">
            {absentPlayers.map(p => (
              <div key={p.id} className="flex items-baseline gap-1 min-w-0">
                {p.jersey_number && <span className="text-[10px] font-bold text-gray-300 flex-shrink-0">{p.jersey_number}</span>}
                <span className="text-xs text-gray-500 truncate">{p.name.split(' ')[0]}</span>
              </div>
            ))}
            {absentPlayers.length === 0 && <span className="text-[10px] text-gray-300">—</span>}
          </div>
        </div>

      </div>

      <div className="lg:order-1">
        <LineupBuilder
          eventId={id}
          players={sortedPlayers}
          presentPlayerIds={[...presentPlayerIds]}
          initialFormation={lineup?.formation}
          initialPositions={lineup?.positions}
        />
      </div>

      </div>{/* end grid */}
    </div>
  )
}
