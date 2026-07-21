import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { updatePlayer, deletePlayer } from '@/app/actions/players'
import BackButton from '@/components/BackButton'
import DeleteButton from '@/components/DeleteButton'
import PositionSelector from '@/components/PositionSelector'
import { getDict } from '@/lib/i18n'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditPlayerPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: player } = await supabase.from('players').select('*').eq('id', id).eq('team_id', user.id).single()
  if (!player) notFound()

  async function handleUpdate(formData: FormData) {
    'use server'
    await updatePlayer(id, formData)
    redirect('/players')
  }

  async function handleDelete() {
    'use server'
    await deletePlayer(id)
    redirect('/players')
  }

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
      <div className="flex items-center gap-3 mb-6">
        <BackButton fallback="/players" className="text-gray-400 hover:text-gray-600">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </BackButton>
        <h1 className="text-2xl font-bold text-gray-900">{player.name}</h1>
      </div>

      <form action={handleUpdate} className="bg-white rounded-2xl p-6 border border-gray-100 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.players.name}</label>
          <input name="name" type="text" required defaultValue={player.name}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-gray-900" />
        </div>

        <PositionSelector
          defaultPosition={player.position}
          defaultSecondaryPositions={player.secondary_positions ?? []}
        />

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
            {t.players.jerseyNumber} <span className="text-gray-400 font-normal">({t.players.optional})</span>
          </label>
          <input name="jersey_number" type="number" min="1" max="99" defaultValue={player.jersey_number ?? ''} placeholder="10"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-gray-900 placeholder-gray-400" />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            {t.players.rating} <span className="text-gray-400 font-normal">({t.players.optional})</span>
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {[1,2,3,4,5,6,7,8,9,10].map((n) => (
              <label key={n} className="cursor-pointer">
                <input type="radio" name="rating" value={n} defaultChecked={player.rating === n} className="sr-only peer" />
                <span className="flex items-center justify-center w-9 h-9 rounded-xl border-2 text-sm font-bold border-gray-200 text-gray-400 peer-checked:bg-accent peer-checked:border-accent peer-checked:text-white transition-all">
                  {n}
                </span>
              </label>
            ))}
            <label className="cursor-pointer">
              <input type="radio" name="rating" value="" defaultChecked={!player.rating} className="sr-only peer" />
              <span className="flex items-center justify-center w-9 h-9 rounded-xl border-2 text-xs font-bold border-gray-200 text-gray-300 peer-checked:bg-gray-100 peer-checked:border-gray-300 peer-checked:text-gray-500 transition-all">
                —
              </span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input id="active" name="active" type="checkbox" value="true" defaultChecked={player.active} className="w-5 h-5 rounded accent-green-600" />
          <label htmlFor="active" className="text-sm font-semibold text-gray-700">{t.players.activeInSquad}</label>
        </div>

        <button type="submit" className="w-full bg-brand text-white py-3 rounded-xl font-semibold hover:bg-brand-dark active:scale-95 transition-all">
          {t.players.save}
        </button>
      </form>

      <div className="mt-4">
        <DeleteButton
          label={t.players.deletePlayer}
          confirmMessage={`${player.name}?`}
          action={handleDelete}
        />
      </div>
    </div>
  )
}
