import { redirect } from 'next/navigation'
import BackButton from '@/components/BackButton'
import { createPlayer } from '@/app/actions/players'
import PositionSelector from '@/components/PositionSelector'
import { getDict } from '@/lib/i18n'

export default async function NewPlayerPage() {
  const t = await getDict()

  async function handleSubmit(formData: FormData) {
    'use server'
    await createPlayer(formData)
    redirect('/players')
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <BackButton fallback="/players" className="text-gray-400 hover:text-gray-600">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </BackButton>
        <h1 className="text-2xl font-bold text-gray-900">{t.players.newTitle}</h1>
      </div>

      <form action={handleSubmit} className="bg-white rounded-2xl p-6 border border-gray-100 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.players.name}</label>
          <input name="name" type="text" required autoFocus placeholder="Jan de Vries"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-gray-900 placeholder-gray-400" />
        </div>

        <PositionSelector />

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
            {t.players.jerseyNumber} <span className="text-gray-400 font-normal">({t.players.optional})</span>
          </label>
          <input name="jersey_number" type="number" min="1" max="99" placeholder="10"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-gray-900 placeholder-gray-400" />
        </div>

        <button type="submit" className="w-full bg-brand text-white py-3 rounded-xl font-semibold hover:bg-brand-dark active:scale-95 transition-all">
          {t.players.add}
        </button>
      </form>
    </div>
  )
}
