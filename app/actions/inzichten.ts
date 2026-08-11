'use server'

import { createClient } from '@/lib/supabase/server'
import { assertOwnPlayer, isUuid } from '@/lib/authz'
import { genericError } from '@/lib/errors'
import { seizoensVenster } from '@/lib/inzichten'
import { getAllSettings } from '@/app/actions/settings'
import type { SpelerRatingPunt } from '@/lib/inzichten'

// Dit bestand exporteert bewust ALLEEN async functies: een type-export uit een
// 'use server'-bestand lekt in Turbopack als runtime-verwijzing (geheugen.md).
// SpelerRatingPunt en de rest van de types staan daarom in lib/inzichten.ts en
// worden daar rechtstreeks geïmporteerd.

// De ratingreeks van één speler over het ingestelde seizoen, oplopend op datum.
//
// Een lege lijst is een geldige, verwachte uitkomst: geen seizoen ingesteld,
// geen wedstrijden in het venster, nog geen ratings, of een inactieve speler
// (die filtert de RPC weg, net als de teamgrafiek — zie O3 in
// supabase/inzichten.sql).
export async function getSpelerRatingReeks(playerId: string): Promise<SpelerRatingPunt[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  // Vormcheck vóór elke databasetoegang: een player_id is altijd een UUID.
  // Bewust dezelfde melding als assertOwnPlayer hieronder (lib/authz.ts:20-23),
  // zodat "bestaat niet", "van een ander team" en "geen geldig id" van buitenaf
  // niet uit elkaar te houden zijn.
  if (!isUuid(playerId)) throw new Error('Speler niet gevonden')
  await assertOwnPlayer(supabase, playerId, user.id)

  // Het seizoensvenster komt server-side opnieuw uit settings — nooit van de
  // client aannemen, anders kan een aanroeper zijn eigen datumbereik opgeven.
  // Zelfde hergebruik van getAllSettings() als deleteSeasonTrainings
  // (app/actions/settings.ts:79-81).
  const settings = await getAllSettings()
  const venster = seizoensVenster(settings)
  if (!venster) return []

  // De RPC is security invoker en filtert zelf op team_id = auth.uid() bovenop
  // RLS; er gaat daarom bewust géén team_id-parameter mee.
  const { data, error } = await supabase.rpc('inzichten_rating_speler', {
    p_player: playerId,
    p_start: venster.start,
    p_end: venster.end,
  })
  if (error) throw genericError('inzichten.getSpelerRatingReeks', error)

  // De Supabase-client is ongetypeerd (lib/supabase/server.ts:7), vandaar de
  // expliciete annotatie op het RPC-resultaat.
  return (data ?? []) as SpelerRatingPunt[]
}
