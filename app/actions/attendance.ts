'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { AttendanceStatus } from '@/lib/types'
import { assertKnownPlayerId, assertOwnEvent, assertOwnPlayer, getOwnPlayerIds } from '@/lib/authz'
import { genericError } from '@/lib/errors'

export async function updateAttendance(
  eventId: string,
  playerId: string,
  status: AttendanceStatus
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const VALID_STATUSES: AttendanceStatus[] = ['present', 'absent', 'unknown']
  if (!VALID_STATUSES.includes(status)) throw new Error('Ongeldige status')

  await Promise.all([
    assertOwnEvent(supabase, eventId, user.id),
    assertOwnPlayer(supabase, playerId, user.id),
  ])

  const { error } = await supabase
    .from('attendance')
    .upsert(
      { event_id: eventId, player_id: playerId, status, team_id: user.id },
      { onConflict: 'event_id,player_id' }
    )

  if (error) throw genericError('attendance.updateAttendance', error)
  revalidatePath(`/events/${eventId}`)
  // De selectiepagina filtert de selecteerbare lijst op aanwezigheid; die hangt
  // van deze rijen af en moet dus mee-revalideren.
  revalidatePath(`/events/${eventId}/squad`)
}

export async function markAbsentForPeriod(
  playerId: string,
  fromDate: string,
  toDate: string,
): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) throw new Error('Ongeldige datum')
  if (fromDate > toDate) throw new Error('Startdatum moet voor einddatum liggen')

  await assertOwnPlayer(supabase, playerId, user.id)

  const { data: events } = await supabase
    .from('events')
    .select('id, type')
    .gte('date', fromDate)
    .lte('date', toDate)
    .eq('team_id', user.id)
    .neq('type', 'meting')

  if (!events || events.length === 0) return 0

  const records = events.map((e) => ({
    event_id: e.id,
    player_id: playerId,
    status: 'absent' as AttendanceStatus,
    team_id: user.id,
  }))

  const { error } = await supabase
    .from('attendance')
    .upsert(records, { onConflict: 'event_id,player_id' })

  if (error) throw genericError('attendance.markAbsentForPeriod', error)
  revalidatePath(`/players/${playerId}/absence`)
  // De selectiepagina filtert de selecteerbare lijst op aanwezigheid; die hangt
  // van deze rijen af en moet dus mee-revalideren. Deze actie raakt een hele
  // periode, dus per uniek match-event uit dezelfde query (alleen matches
  // hebben een selectiepagina).
  const matchEventIds = new Set(
    events.filter((e) => e.type === 'match').map((e) => e.id as string)
  )
  for (const matchEventId of matchEventIds) {
    revalidatePath(`/events/${matchEventId}/squad`)
  }
  return events.length
}

export async function markAllPresent(eventId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { error } = await supabase
    .from('attendance')
    .update({ status: 'present' })
    .eq('event_id', eventId)
    .eq('team_id', user.id)

  if (error) throw genericError('attendance.markAllPresent', error)
  revalidatePath(`/events/${eventId}`)
  // De selectiepagina filtert de selecteerbare lijst op aanwezigheid; die hangt
  // van deze rijen af en moet dus mee-revalideren.
  revalidatePath(`/events/${eventId}/squad`)
}

export async function saveLineup(
  eventId: string,
  formation: string,
  positions: { player_id: string | null; x: number; y: number; position_label: string; position_number?: number }[]
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnEvent(supabase, eventId, user.id)

  if (typeof formation !== 'string' || formation.length > 20) throw new Error('Ongeldige formatie')
  if (!Array.isArray(positions) || positions.length > 30) throw new Error('Ongeldige opstelling')

  // Elk player_id moet een eigen speler zijn: RLS beschermt de players-tabel,
  // maar de opstelling gaat als JSONB de lineups-rij in en zou anders een
  // vreemd (of willekeurig lang) id kunnen bevatten. Zelfde patroon als
  // saveSpelerindeling in app/actions/training-plan.ts.
  const ownPlayerIds = await getOwnPlayerIds(supabase, user.id)

  const cleanPositions = positions.map((p) => ({
    player_id: p.player_id === null || p.player_id === undefined
      ? null
      : assertKnownPlayerId(p.player_id, ownPlayerIds),
    x: Math.max(0, Math.min(100, Number(p.x) || 0)),
    y: Math.max(0, Math.min(100, Number(p.y) || 0)),
    position_label: String(p.position_label ?? '').slice(0, 10),
    position_number: Number.isInteger(p.position_number) ? p.position_number : undefined,
  }))

  const { error } = await supabase
    .from('lineups')
    .upsert(
      { event_id: eventId, formation, positions: cleanPositions, team_id: user.id },
      { onConflict: 'event_id' }
    )

  if (error) throw genericError('attendance.saveLineup', error)
  revalidatePath(`/events/${eventId}/lineup`)
}
