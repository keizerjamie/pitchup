import { redirect } from 'next/navigation'
import { canEdit, requireTeamContextOrLogin } from '@/lib/team-context'
import BulkMatchesForm from '@/components/BulkMatchesForm'

// Server component (brief §4.5, validatiebevinding 2): de "Wedstrijden
// importeren"-knop is al overal verborgen zonder Agenda-recht
// (CalendarView.tsx); directe navigatie naar dit pad wordt hier hetzelfde
// afgehandeld — terug naar de kalender.
export default async function BulkMatchesPage() {
  const ctx = await requireTeamContextOrLogin()
  if (!canEdit(ctx, 'agenda')) redirect('/events')

  return <BulkMatchesForm />
}
