import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Player } from '@/lib/types'
import { getDict } from '@/lib/i18n'
import PlayerList from '@/components/PlayerList'

export default async function PlayersPage() {
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: players } = await supabase
    .from('players')
    .select('*')
    .eq('team_id', user.id)
    .order('jersey_number', { ascending: true, nullsFirst: false })
    .order('name')

  const allPlayers: Player[] = players ?? []
  const active = allPlayers.filter((p) => p.active)
  const inactive = allPlayers.filter((p) => !p.active)

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">{t.players.title}</h1>
          <p className="text-sm text-gray-500">{active.length} {t.players.activeCount} • {inactive.length} {t.players.inactiveCount}</p>
        </div>
        {/* Desktop create action — mobile uses the FAB */}
        <Link href="/players/new" transitionTypes={['nav-forward']}
          className="hidden md:inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand hover:bg-brand-dark active:scale-95 transition-all flex-shrink-0">
          <span className="text-base leading-none">+</span> {t.players.add}
        </Link>
      </div>

      {active.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center border border-dashed border-white/60">
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          <p className="text-gray-500 font-medium">{t.players.noPlayers}</p>
          <p className="text-gray-400 text-sm mt-1">{t.players.noPlayersHint}</p>
          <Link href="/players/new" transitionTypes={['nav-forward']} className="mt-4 inline-block bg-brand text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-brand-dark">
            {t.players.add}
          </Link>
        </div>
      ) : (
        <PlayerList active={active} inactive={inactive} />
      )}
    </div>
  )
}
