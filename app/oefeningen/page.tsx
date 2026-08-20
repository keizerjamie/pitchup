import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Oefening, normalizeOefeningTeams } from '@/lib/types'
import OefeningLibrary, { OefeningWithUsage } from '@/components/OefeningLibrary'

export default async function OefeningenPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: oefeningenData }, { data: koppelingenData }] = await Promise.all([
    supabase.from('oefeningen').select('*').eq('team_id', user.id).order('created_at', { ascending: false }),
    supabase.from('training_oefeningen').select('oefening_id, event_id').eq('team_id', user.id),
  ])

  // Dual-read: bestaande rijen bevatten nog de legacy vorm {grootte, formatie}.
  // Normaliseer naar {grootte, formaties} vóórdat de UI de data ziet.
  const oefeningen: Oefening[] = (oefeningenData ?? []).map((o) => ({
    ...o,
    teams: normalizeOefeningTeams(o.teams),
  }))

  // Tellen op UNIEKE trainingen, niet op koppelingsrijen: dezelfde oefening mag
  // meerdere keren in één training zitten (supabase/oefening-meerdere-keren.sql),
  // en de verwijder-waarschuwing spreekt over "n training(en)".
  const usageEvents = new Map<string, Set<string>>()
  for (const row of koppelingenData ?? []) {
    const events = usageEvents.get(row.oefening_id) ?? new Set<string>()
    events.add(row.event_id)
    usageEvents.set(row.oefening_id, events)
  }

  const withUsage: OefeningWithUsage[] = oefeningen.map((o) => ({
    ...o,
    koppelingCount: usageEvents.get(o.id)?.size ?? 0,
  }))

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8">
      <OefeningLibrary oefeningen={withUsage} />
    </div>
  )
}
