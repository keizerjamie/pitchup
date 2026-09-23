import { redirect } from 'next/navigation'
import { canEdit, requireTeamContextOrLogin } from '@/lib/team-context'
import NewEventForm from '@/components/NewEventForm'

// Server component (brief §4.5, validatiebevinding 2): de knoppen die hierheen
// leiden zijn al overal verborgen zonder Agenda-recht (CalendarView.tsx,
// GlobalFab.tsx); directe navigatie naar dit pad wordt hier hetzelfde
// afgehandeld, zelfde patroon als app/players/new/page.tsx — terug naar de
// lijstpagina, geen formulier dat toch pas bij het klikken zou falen.
export default async function NewEventPage() {
  const ctx = await requireTeamContextOrLogin()
  if (!canEdit(ctx, 'agenda')) redirect('/events')

  return <NewEventForm />
}
