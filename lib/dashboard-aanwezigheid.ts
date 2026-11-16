// Aanwezigheidsstatussen voor de kaarten van het startscherm (hoofdkaart en
// Beschikbaarheid-tegel). Geen 'use server': dit is een gewone server-helper
// die de pagina (app/page.tsx) met zijn eigen Supabase-client aanroept.
//
// Zelfde batch-patroon als de kalender (app/events/page.tsx): PostgREST levert
// hooguit 1000 rijen per request, dus per batch events zo groot dat
// (events × spelers) daaronder blijft (lib/attendance-batches.ts). Elke batch
// is team-gescoped en beperkt tot de ACTIEVE spelers, zodat rijen van
// inactieve spelers niet meetellen en geen ruimte onder de 1000 innemen.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttendanceStatus } from '@/lib/types'
import { eventBatchGrootte, inBatches } from '@/lib/attendance-batches'
import { logError } from '@/lib/errors'

interface AttendanceRij {
  event_id: string
  player_id: string
  status: AttendanceStatus
}

/**
 * Per event: player_id → status. Een event uit een gefaalde batch krijgt
 * GEEN entry (de UI toont dan geen getallen in plaats van een fout getal);
 * een event uit een geslaagde batch krijgt altijd een entry, ook zonder
 * rijen. Geen events of geen actieve spelers → lege Map en 0 queries.
 */
export async function haalStatussenPerEvent(
  supabase: SupabaseClient,
  teamId: string,
  eventIds: readonly string[],
  actieveSpelerIds: readonly string[],
): Promise<Map<string, Map<string, AttendanceStatus>>> {
  const statusPerEvent = new Map<string, Map<string, AttendanceStatus>>()
  const ids = [...new Set(eventIds)]
  const spelers = [...new Set(actieveSpelerIds)]
  if (ids.length === 0 || spelers.length === 0) return statusPerEvent

  const batches = inBatches(ids, eventBatchGrootte(spelers.length))
  const resultaten = await Promise.all(
    batches.map((batch) =>
      supabase
        .from('attendance')
        .select('event_id, player_id, status')
        .eq('team_id', teamId)
        .in('event_id', batch)
        .in('player_id', spelers),
    ),
  )

  resultaten.forEach(({ data, error }, i) => {
    if (error) {
      // Alleen een statisch label (lib/errors.ts), nooit de ruwe fout.
      logError('dashboard.attendanceBatch', error)
      return
    }
    for (const id of batches[i]) statusPerEvent.set(id, new Map())
    for (const rij of (data ?? []) as AttendanceRij[]) {
      if (rij.player_id) statusPerEvent.get(rij.event_id)?.set(rij.player_id, rij.status)
    }
  })

  return statusPerEvent
}
