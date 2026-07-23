import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Player } from '@/lib/types'
import PlayerList from '@/components/PlayerList'

export default async function PlayersPage() {
  const supabase = await createClient()
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
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8">
      <PlayerList active={active} inactive={inactive} />
    </div>
  )
}
