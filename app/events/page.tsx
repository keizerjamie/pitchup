import { createClient } from '@/lib/supabase/server'
import { canEdit, requireTeamContextOrLogin } from '@/lib/team-context'
import { logError } from '@/lib/errors'
import { FootballEvent } from '@/lib/types'
import { teltMee } from '@/lib/aanwezigheid-telling'
import CalendarView from '@/components/CalendarView'

export default async function EventsPage() {
  const supabase = await createClient()
  const ctx = await requireTeamContextOrLogin()

  const [{ data: events }, { data: attendance }, { data: guestPlayerRows, error: guestPlayerError }] = await Promise.all([
    supabase.from('events').select('*').eq('team_id', ctx.teamId).neq('type', 'meting').order('date', { ascending: false }),
    // player_id is nodig om per rij te bepalen of het een gast is; zonder die
    // kolom zou de noemer hieronder elke gast blind meetellen.
    supabase.from('attendance').select('event_id, player_id, status').eq('team_id', ctx.teamId),
    // Gast-ids, zelfde vorm en zelfde team-scoping als de gast-query van het
    // dashboard (app/page.tsx, zie gastIds). Bewust zonder active-filter: de
    // telling hieronder kijkt naar álle attendance-rijen van het team, ook die
    // van inactief geworden spelers.
    supabase.from('players').select('id').eq('team_id', ctx.teamId).eq('type', 'guest'),
  ])

  const allEvents: FootballEvent[] = events ?? []
  const allAttendance = attendance ?? []

  // Faalt de gast-query, dan weten we niet wie gast is. Alleen een statisch
  // label naar de log, nooit de ruwe PostgREST-fout (lib/errors.ts, logError).
  if (guestPlayerError) logError('events.guestPlayers', guestPlayerError)
  const gastIds = new Set((guestPlayerRows ?? []).map((p: { id: string }) => p.id))

  const attendanceMap: Record<string, { present: number; total: number }> = {}
  for (const event of allEvents) {
    const records = allAttendance.filter(a => a.event_id === event.id)
    attendanceMap[event.id] = {
      // Aanwezig blijft ongewijzigd: ook een gast die op aanwezig staat telt mee.
      present: records.filter(a => a.status === 'present').length,
      // De noemer is het aantal MEETELLENDE spelers — de regel komt uit
      // teltMee (lib/aanwezigheid-telling.ts), niet uit een tweede formulering
      // hier. Bij een gefaalde gast-query vallen we bewust terug op de oude,
      // ongefilterde telling: deze teller is informatief en staat op élke rij,
      // dus elke rij zijn teller ontnemen is een grotere regressie dan een
      // zeldzaam iets te hoog getal. Dit wijkt bewust af van de KPI-tegel op
      // het dashboard (attendancePct in app/page.tsx), die wél — toont omdat
      // daar één getal centraal staat.
      total: guestPlayerError
        ? records.length
        : records.filter(a => teltMee(gastIds.has(a.player_id) ? 'guest' : 'regular', a.status === 'present')).length,
    }
  }

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8">
      <CalendarView events={allEvents} attendanceMap={attendanceMap} canEdit={canEdit(ctx, 'agenda')} />
    </div>
  )
}
