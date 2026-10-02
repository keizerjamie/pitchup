import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit, requireTeamContextOrLogin } from '@/lib/team-context'
import { formatTime } from '@/lib/utils'
import EditEventForm from '@/components/EditEventForm'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditEventPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const ctx = await requireTeamContextOrLogin()
  // Directe navigatie zonder agenda-recht gaat terug naar de detailpagina,
  // zelfde patroon als de spelers-bewerkpagina; updateEvent toetst het recht
  // daarnaast zelf.
  if (!canEdit(ctx, 'agenda')) redirect(`/events/${id}`)

  const { data: event } = await supabase
    .from('events')
    .select('id, type, date, time, location, notes, opponent, match_type, home_away')
    .eq('id', id)
    .eq('team_id', ctx.teamId)
    .maybeSingle()
  if (!event) notFound()

  // Alleen training en wedstrijd zijn bewerkbaar (de legacy meting niet).
  if (event.type !== 'training' && event.type !== 'match') redirect(`/events/${id}`)

  return (
    <EditEventForm
      event={{
        id: event.id,
        type: event.type,
        date: event.date,
        time: formatTime(event.time),
        location: event.location ?? '',
        notes: event.notes ?? '',
        opponent: event.opponent ?? '',
        matchType: event.match_type,
        homeAway: event.home_away,
      }}
    />
  )
}
