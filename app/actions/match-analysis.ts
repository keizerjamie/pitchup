'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertOwnEvent, assertOwnPlayer } from '@/lib/authz'
import type { MatchEventKind } from '@/lib/types'
import { clampGoals, isValidRating, isValidKind, isValidMinute } from '@/lib/match-analysis.mjs'
import { genericError, rpcEventError } from '@/lib/errors'
import { assertCanEdit, requireTeamContext } from '@/lib/team-context'

// Revalidate both the analysis sub-page and the event page (which shows the
// analysis ActionCard + done-state) after every mutation.
function revalidateEvent(eventId: string) {
  revalidatePath(`/events/${eventId}/analysis`)
  revalidatePath(`/events/${eventId}`)
}

// De uitslag hoort bij Wedstrijd, maar staat als kolom op `events` — en de
// events-policy blijft op 'agenda'. Daarom loopt dit ene kolommenpaar via de
// kolom-begrensde RPC set_match_result (supabase/team-rls-gevolgacties.sql),
// die zelf can_edit(team,'wedstrijd') toetst en het team-id uit de rij haalt.
// clampGoals blijft de ENIGE bron van waarheid voor het bereik en draait
// daarom vóór de aanroep; de RPC klemt bewust niet nog een keer.
export async function saveMatchResult(
  eventId: string,
  goalsFor: number | null,
  goalsAgainst: number | null,
): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'wedstrijd')

  // Strikt genomen overbodig naast de RPC (die zoekt het team zelf op), maar
  // bewust behouden: dit is de forged-id-guard die dit project overal gebruikt
  // en hij geeft dezelfde melding als de RPC bij een onbekend event.
  await assertOwnEvent(supabase, eventId, ctx.teamId)

  const { error } = await supabase.rpc('set_match_result', {
    p_event_id: eventId,
    p_goals_for: clampGoals(goalsFor),
    p_goals_against: clampGoals(goalsAgainst),
  })

  if (error) throw rpcEventError('matchAnalysis.saveMatchResult', error)
  revalidateEvent(eventId)
}

export async function saveMatchRating(
  eventId: string,
  playerId: string,
  rating: number | null,
): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'wedstrijd')

  await Promise.all([
    assertOwnEvent(supabase, eventId, ctx.teamId),
    assertOwnPlayer(supabase, playerId, ctx.teamId),
  ])

  if (rating === null) {
    const { error } = await supabase
      .from('match_ratings')
      .delete()
      .eq('event_id', eventId)
      .eq('player_id', playerId)
      .eq('team_id', ctx.teamId)
    if (error) throw genericError('matchAnalysis.saveMatchRating.delete', error)
    return
  }

  if (!isValidRating(rating)) throw new Error('Ongeldige rating')

  const { error } = await supabase
    .from('match_ratings')
    .upsert(
      { event_id: eventId, player_id: playerId, rating, team_id: ctx.teamId },
      { onConflict: 'event_id,player_id' },
    )

  if (error) throw genericError('matchAnalysis.saveMatchRating', error)
  // Bewust géén revalidatePath hier: ratings worden in hoge frequentie met +/-
  // aangepast en de client toont de waarde al optimistisch. Zou dit de huidige
  // analyse-route revalideren, dan herrendert de hele pagina bij elke klik. De
  // done-status op /events/[id] is een dynamische route (auth-cookie) en wordt
  // bij navigatie vanzelf opnieuw opgehaald.
}

export async function addMatchEvent(
  eventId: string,
  playerId: string,
  kind: MatchEventKind,
  minute: number | null,
): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'wedstrijd')

  await Promise.all([
    assertOwnEvent(supabase, eventId, ctx.teamId),
    assertOwnPlayer(supabase, playerId, ctx.teamId),
  ])

  if (!isValidKind(kind)) throw new Error('Ongeldige gebeurtenis')
  if (!isValidMinute(minute)) throw new Error('Ongeldige minuut')

  const { error } = await supabase
    .from('match_events')
    .insert({ event_id: eventId, player_id: playerId, kind, minute, team_id: ctx.teamId })

  if (error) throw genericError('matchAnalysis.addMatchEvent', error)
  revalidateEvent(eventId)
}

export async function deleteMatchEvent(id: string, eventId: string): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'wedstrijd')

  const { error } = await supabase
    .from('match_events')
    .delete()
    .eq('id', id)
    .eq('team_id', ctx.teamId)

  if (error) throw genericError('matchAnalysis.deleteMatchEvent', error)
  revalidateEvent(eventId)
}
