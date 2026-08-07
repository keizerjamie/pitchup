import type { SupabaseClient } from '@supabase/supabase-js'

// Guard against callers passing ids of another team's rows: RLS keeps the
// data invisible, but unique constraints (event_id, player_id) would still
// let a forged insert block the owning team's own writes.

export async function assertOwnEvent(supabase: SupabaseClient, eventId: string, teamId: string) {
  const { data } = await supabase.from('events').select('id').eq('id', eventId).eq('team_id', teamId).maybeSingle()
  if (!data) throw new Error('Event niet gevonden')
}

// Zelfde tenant-check als assertOwnEvent, plus de eis dat het event een
// wedstrijd is. Bewust dezelfde melding: die verraadt niet of het event niet
// bestaat, van een ander team is, of gewoon geen wedstrijd is.
export async function assertOwnMatchEvent(supabase: SupabaseClient, eventId: string, teamId: string) {
  const { data } = await supabase.from('events').select('id, type').eq('id', eventId).eq('team_id', teamId).maybeSingle()
  if (!data || data.type !== 'match') throw new Error('Event niet gevonden')
}

export async function assertOwnPlayer(supabase: SupabaseClient, playerId: string, teamId: string) {
  const { data } = await supabase.from('players').select('id').eq('id', playerId).eq('team_id', teamId).maybeSingle()
  if (!data) throw new Error('Speler niet gevonden')
}

export async function assertOwnOefening(supabase: SupabaseClient, oefeningId: string, teamId: string) {
  const { data } = await supabase.from('oefeningen').select('id').eq('id', oefeningId).eq('team_id', teamId).maybeSingle()
  if (!data) throw new Error('Oefening niet gevonden')
}

// Vormcheck vóór elke id-vergelijking: een player_id is altijd een UUID. Dit
// begrenst meteen de lengte van waarden die anders ongecontroleerd in een
// JSONB-kolom belanden.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && UUID_RE.test(value)
}

// Alle spelers-ids van dit team als Set, om een lijst ids in één keer te kunnen
// valideren zonder per id een query te doen. Bewust géén active-filter: ook een
// inactieve speler blijft een eigen speler. Zelfde patroon als
// saveSpelerindeling in app/actions/training-plan.ts.
export async function getOwnPlayerIds(supabase: SupabaseClient, teamId: string): Promise<Set<string>> {
  const { data } = await supabase.from('players').select('id').eq('team_id', teamId)
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id))
}

// Tenant-check voor een los player_id uit een payload: eerst de vorm, dan het
// eigenaarschap. Gooit dezelfde melding als assertOwnPlayer.
export function assertKnownPlayerId(playerId: unknown, ownPlayerIds: Set<string>): string {
  if (!isUuid(playerId)) throw new Error('Ongeldige speler')
  if (!ownPlayerIds.has(playerId)) throw new Error('Speler niet gevonden')
  return playerId
}
