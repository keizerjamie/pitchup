import type { SupabaseClient } from '@supabase/supabase-js'

// Guard against callers passing ids of another team's rows: RLS keeps the
// data invisible, but unique constraints (event_id, player_id) would still
// let a forged insert block the owning team's own writes.

export async function assertOwnEvent(supabase: SupabaseClient, eventId: string, teamId: string) {
  const { data } = await supabase.from('events').select('id').eq('id', eventId).eq('team_id', teamId).maybeSingle()
  if (!data) throw new Error('Event niet gevonden')
}

export async function assertOwnPlayer(supabase: SupabaseClient, playerId: string, teamId: string) {
  const { data } = await supabase.from('players').select('id').eq('id', playerId).eq('team_id', teamId).maybeSingle()
  if (!data) throw new Error('Speler niet gevonden')
}

export async function assertOwnOefening(supabase: SupabaseClient, oefeningId: string, teamId: string) {
  const { data } = await supabase.from('oefeningen').select('id').eq('id', oefeningId).eq('team_id', teamId).maybeSingle()
  if (!data) throw new Error('Oefening niet gevonden')
}
