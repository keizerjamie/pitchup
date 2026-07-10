'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { AttendanceStatus } from '@/lib/types'
import type { SupabaseClient } from '@supabase/supabase-js'

// Guard against callers passing ids of another team's rows: RLS keeps the
// data invisible, but unique constraints (event_id, player_id) would still
// let a forged insert block the owning team's own writes.
async function assertOwnEvent(supabase: SupabaseClient, eventId: string, teamId: string) {
  const { data } = await supabase.from('events').select('id').eq('id', eventId).eq('team_id', teamId).maybeSingle()
  if (!data) throw new Error('Event niet gevonden')
}

async function assertOwnPlayer(supabase: SupabaseClient, playerId: string, teamId: string) {
  const { data } = await supabase.from('players').select('id').eq('id', playerId).eq('team_id', teamId).maybeSingle()
  if (!data) throw new Error('Speler niet gevonden')
}

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

  if (error) throw new Error(error.message)
  revalidatePath(`/events/${eventId}`)
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
    .select('id')
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

  if (error) throw new Error(error.message)
  revalidatePath(`/players/${playerId}/absence`)
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

  if (error) throw new Error(error.message)
  revalidatePath(`/events/${eventId}`)
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

  const cleanPositions = positions.map((p) => ({
    player_id: typeof p.player_id === 'string' ? p.player_id : null,
    x: Math.max(0, Math.min(100, Number(p.x) || 0)),
    y: Math.max(0, Math.min(100, Number(p.y) || 0)),
    position_label: String(p.position_label ?? '').slice(0, 10),
    position_number: typeof p.position_number === 'number' ? p.position_number : undefined,
  }))

  const { error } = await supabase
    .from('lineups')
    .upsert(
      { event_id: eventId, formation, positions: cleanPositions, team_id: user.id },
      { onConflict: 'event_id' }
    )

  if (error) throw new Error(error.message)
  revalidatePath(`/events/${eventId}/lineup`)
}
