import { redirect } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import ActionBar from '@/components/ui/ActionBar'
import Button, { LinkButton } from '@/components/ui/Button'
import { createPlayer } from '@/app/actions/players'
import PositionSelector from '@/components/PositionSelector'
import RatingSelector from '@/components/RatingSelector'
import { getDict } from '@/lib/i18n'
import { canEdit, requireTeamContextOrLogin } from '@/lib/team-context'

export default async function NewPlayerPage() {
  const [t, ctx] = await Promise.all([getDict(), requireTeamContextOrLogin()])
  // De "Speler toevoegen"-knop is al overal verborgen zonder dit recht
  // (PlayerList.tsx, GlobalFab.tsx); directe navigatie hierheen wordt hier
  // hetzelfde afgehandeld (brief §4.5).
  if (!canEdit(ctx, 'spelers')) redirect('/players')

  async function handleSubmit(formData: FormData) {
    'use server'
    await createPlayer(formData)
    redirect('/players')
  }

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
      <PageHeader backFallback="/players" title={t.players.newTitle} className="mb-6" />

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

        <ActionBar
          secondary={<LinkButton href="/players" variant="secondary">{t.common.cancel}</LinkButton>}
          primary={<Button type="submit">{t.players.add}</Button>}
        />
      </form>
    </div>
  )
}
