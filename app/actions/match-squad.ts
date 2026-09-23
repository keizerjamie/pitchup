'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertOwnMatchEvent, assertOwnPlayer } from '@/lib/authz'
import { genericError } from '@/lib/errors'
import { assertCanEdit, requireTeamContext } from '@/lib/team-context'

// Zet één speler in of uit de wedstrijdselectie. De aanwezigheid van de rij ís
// de selectie, dus selected=true schrijft een rij en selected=false verwijdert
// hem. Beide richtingen zijn idempotent: onConflict/ignoreDuplicates laat een
// bestaande rij ongemoeid, en een delete zonder treffer is een no-op.
export async function toggleSquadPlayer(
  eventId: string,
  playerId: string,
  selected: boolean,
): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'wedstrijd')

  if (typeof selected !== 'boolean') throw new Error('Ongeldige selectie')

  await Promise.all([
    assertOwnMatchEvent(supabase, eventId, ctx.teamId),
    assertOwnPlayer(supabase, playerId, ctx.teamId),
  ])

  const { error } = selected
    ? await supabase
        .from('match_squad')
        .upsert(
          { event_id: eventId, player_id: playerId, team_id: ctx.teamId },
          { onConflict: 'event_id,player_id', ignoreDuplicates: true },
        )
    : await supabase
        .from('match_squad')
        .delete()
        .eq('event_id', eventId)
        .eq('player_id', playerId)
        .eq('team_id', ctx.teamId)

  if (error) throw genericError('match-squad.toggleSquadPlayer', error)

  revalidatePath(`/events/${eventId}/squad`)
  // De detailpagina toont de 'done'-status van de selectie-actiekaart; die hangt
  // van deze rijen af en moet dus mee-revalideren.
  revalidatePath(`/events/${eventId}`)
}
