import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit, requireTeamContextOrLogin } from '@/lib/team-context'
import { updatePlayer, deletePlayer } from '@/app/actions/players'
import PageHeader from '@/components/ui/PageHeader'
import ActionBar from '@/components/ui/ActionBar'
import Button, { LinkButton } from '@/components/ui/Button'
import TrashIcon from '@/components/icons/TrashIcon'
import PositionSelector from '@/components/PositionSelector'
import RatingSelector from '@/components/RatingSelector'
import { getDict } from '@/lib/i18n'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditPlayerPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const ctx = await requireTeamContextOrLogin()
  // De bewerkknop op het spelerprofiel is al verborgen zonder dit recht
  // (brief §4.5); directe navigatie naar dit pad wordt hier hetzelfde
  // afgehandeld — terug naar het profiel, geen formulier dat toch zou falen.
  if (!canEdit(ctx, 'spelers')) redirect(`/players/${id}`)

  const { data: player } = await supabase.from('players').select('*').eq('id', id).eq('team_id', ctx.teamId).single()
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
      {/* Designronde 3: verwijderen in het ⋯-menu van de kop (rood, met
          bevestiging) i.p.v. een losse knop onder het formulier. */}
      <PageHeader
        backFallback={`/players/${id}`}
        title={player.name}
        className="mb-6"
        menu={[{
          label: t.players.deletePlayer,
          icon: <TrashIcon />,
          danger: true,
          confirm: `${player.name}?`,
          action: handleDelete,
        }]}
      />

      <form action={handleUpdate} className="bg-surface rounded-2xl p-6 border border-[var(--border-soft)] space-y-5">
        <div>
          <label className="block text-sm font-semibold text-muted mb-1.5">{t.players.name}</label>
          <input name="name" type="text" required defaultValue={player.name}
            className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink" />
        </div>

        <div>
          <label className="block text-sm font-semibold text-muted mb-1.5">{t.players.playerType}</label>
          <select
            name="type"
            defaultValue={player.type ?? 'regular'}
            className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink bg-surface"
          >
            <option value="regular">{t.players.typeRegular}</option>
            <option value="guest">{t.players.typeGuest}</option>
          </select>
        </div>

        <PositionSelector
          defaultPosition={player.position}
          defaultSecondaryPositions={player.secondary_positions ?? []}
        />

        <div>
          <label className="block text-sm font-semibold text-muted mb-1.5">
            {t.players.jerseyNumber} <span className="text-faint font-normal">({t.players.optional})</span>
          </label>
          <input name="jersey_number" type="number" min="1" max="99" defaultValue={player.jersey_number ?? ''} placeholder="10"
            className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink placeholder-faint" />
        </div>

        <RatingSelector defaultRating={player.rating} />

        <div className="flex items-center gap-3">
          <input id="active" name="active" type="checkbox" value="true" defaultChecked={player.active} className="w-5 h-5 rounded accent-green-600" />
          <label htmlFor="active" className="text-sm font-semibold text-muted">{t.players.activeInSquad}</label>
        </div>

        <ActionBar
          secondary={<LinkButton href={`/players/${id}`} variant="secondary">{t.common.cancel}</LinkButton>}
          primary={<Button type="submit">{t.players.save}</Button>}
        />
      </form>

    </div>
  )
}
