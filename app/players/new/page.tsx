import { redirect } from 'next/navigation'
import BackButton from '@/components/BackButton'
import { createPlayer } from '@/app/actions/players'
import PositionSelector from '@/components/PositionSelector'
import RatingSelector from '@/components/RatingSelector'
import { getDict } from '@/lib/i18n'

export default async function NewPlayerPage() {
  const t = await getDict()

  async function handleSubmit(formData: FormData) {
    'use server'
    await createPlayer(formData)
    redirect('/players')
  }

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
      <div className="flex items-center gap-3 mb-6">
        <BackButton fallback="/players" className="text-faint hover:text-ink">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </BackButton>
        <h1 className="text-2xl font-bold text-ink">{t.players.newTitle}</h1>
      </div>

      <form action={handleSubmit} className="bg-surface rounded-2xl p-6 border border-[var(--border-soft)] space-y-5">
        <div>
          <label className="block text-sm font-semibold text-muted mb-1.5">{t.players.name}</label>
          <input name="name" type="text" required autoFocus placeholder="Jan de Vries"
            className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink placeholder-faint" />
        </div>

        <div>
          <label className="block text-sm font-semibold text-muted mb-1.5">{t.players.playerType}</label>
          <select
            name="type"
            defaultValue="regular"
            className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink bg-surface"
          >
            <option value="regular">{t.players.typeRegular}</option>
            <option value="guest">{t.players.typeGuest}</option>
          </select>
        </div>

        <PositionSelector />

        <div>
          <label className="block text-sm font-semibold text-muted mb-1.5">
            {t.players.jerseyNumber} <span className="text-faint font-normal">({t.players.optional})</span>
          </label>
          <input name="jersey_number" type="number" min="1" max="99" placeholder="10"
            className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink placeholder-faint" />
        </div>

        <RatingSelector />

        <button type="submit" className="w-full bg-brand text-white py-3 rounded-xl font-semibold hover:bg-brand-dark active:scale-[0.98] transition">
          {t.players.add}
        </button>
      </form>
    </div>
  )
}
