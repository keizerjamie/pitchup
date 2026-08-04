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
    supabase.from('training_oefeningen').select('oefening_id').eq('team_id', user.id),
  ])

  // Dual-read: bestaande rijen bevatten nog de legacy vorm {grootte, formatie}.
  // Normaliseer naar {grootte, formaties} vóórdat de UI de data ziet.
  const oefeningen: Oefening[] = (oefeningenData ?? []).map((o) => ({
    ...o,
    teams: normalizeOefeningTeams(o.teams),
  }))

  const usageCounts = new Map<string, number>()
  for (const row of koppelingenData ?? []) {
    usageCounts.set(row.oefening_id, (usageCounts.get(row.oefening_id) ?? 0) + 1)
  }

  const withUsage: OefeningWithUsage[] = oefeningen.map((o) => ({
    ...o,
    koppelingCount: usageCounts.get(o.id) ?? 0,
  }))

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8">
      <OefeningLibrary oefeningen={withUsage} />
    </div>
  )
}
