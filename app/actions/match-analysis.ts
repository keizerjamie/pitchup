'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertOwnEvent, assertOwnPlayer } from '@/lib/authz'
import type { MatchEventKind } from '@/lib/types'
import { clampGoals, isValidRating, isValidKind, isValidMinute } from '@/lib/match-analysis.mjs'

// Revalidate both the analysis sub-page and the event page (which shows the
// analysis ActionCard + done-state) after every mutation.
function revalidateEvent(eventId: string) {
  revalidatePath(`/events/${eventId}/analysis`)
  revalidatePath(`/events/${eventId}`)
}

export async function saveMatchResult(
  eventId: string,
  goalsFor: number | null,
  goalsAgainst: number | null,
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnEvent(supabase, eventId, user.id)

  const { error } = await supabase
    .from('events')
    .update({ goals_for: clampGoals(goalsFor), goals_against: clampGoals(goalsAgainst) })
    .eq('id', eventId)
    .eq('team_id', user.id)
    .eq('type', 'match')

  if (error) throw new Error(error.message)
  revalidateEvent(eventId)
}

export async function saveMatchRating(
  eventId: string,
  playerId: string,
  rating: number | null,
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await Promise.all([
    assertOwnEvent(supabase, eventId, user.id),
    assertOwnPlayer(supabase, playerId, user.id),
  ])

  if (rating === null) {
    const { error } = await supabase
      .from('match_ratings')
      .delete()
      .eq('event_id', eventId)
      .eq('player_id', playerId)
      .eq('team_id', user.id)
    if (error) throw new Error(error.message)
    return
  }

  if (!isValidRating(rating)) throw new Error('Ongeldige rating')

  const { error } = await supabase
    .from('match_ratings')
    .upsert(
      { event_id: eventId, player_id: playerId, rating, team_id: user.id },
      { onConflict: 'event_id,player_id' },
    )

  if (error) throw new Error(error.message)
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await Promise.all([
    assertOwnEvent(supabase, eventId, user.id),
    assertOwnPlayer(supabase, playerId, user.id),
  ])

  if (!isValidKind(kind)) throw new Error('Ongeldige gebeurtenis')
  if (!isValidMinute(minute)) throw new Error('Ongeldige minuut')

  const { error } = await supabase
    .from('match_events')
    .insert({ event_id: eventId, player_id: playerId, kind, minute, team_id: user.id })

  if (error) throw new Error(error.message)
  revalidateEvent(eventId)
}

export async function deleteMatchEvent(id: string, eventId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { error } = await supabase
    .from('match_events')
    .delete()
    .eq('id', id)
    .eq('team_id', user.id)

  if (error) throw new Error(error.message)
  revalidateEvent(eventId)
}
