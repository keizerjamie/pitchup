'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertOwnEvent, assertOwnPlayer, isUuid } from '@/lib/authz'
import type { MatchEventKind } from '@/lib/types'
import { clampGoals, isValidRating, isValidKind, isValidMinute } from '@/lib/match-analysis.mjs'
import { errorCode, genericError, rpcEventError } from '@/lib/errors'
import { herstelNietMogelijk, schoonCreatedAt, type HerstelWedstrijdMoment } from '@/lib/herstel'
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

// Doelpunt/kaart verwijderen. Leest de rij eerst (tenant-gescoped) zodat de
// herstel-snapshot voor "Ongedaan maken" teruggegeven kan worden. `eventId`
// blijft in de signatuur voor de bestaande aanroepers, maar revalideren
// gebeurt met het event uit de rij zelf: dat is de waarheid, niet de client.
export async function deleteMatchEvent(id: string, eventId: string): Promise<HerstelWedstrijdMoment> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'wedstrijd')

  const { data } = await supabase
    .from('match_events')
    .select('id, event_id, player_id, kind, minute, created_at')
    .eq('id', id)
    .eq('team_id', ctx.teamId)
    .maybeSingle()
  if (!data) throw new Error('Gebeurtenis niet gevonden')
  const rij = data as {
    id: string
    event_id: string
    player_id: string
    kind: MatchEventKind
    minute: number | null
    created_at: string | null
  }

  const { error } = await supabase
    .from('match_events')
    .delete()
    .eq('id', id)
    .eq('team_id', ctx.teamId)

  if (error) throw genericError('matchAnalysis.deleteMatchEvent', error)
  revalidateEvent(rij.event_id ?? eventId)

  return {
    soort: 'wedstrijdmoment',
    teamId: ctx.teamId,
    id: rij.id,
    eventId: rij.event_id,
    playerId: rij.player_id,
    kind: rij.kind,
    minute: rij.minute ?? null,
    createdAt: rij.created_at ?? null,
  }
}

async function wedstrijdMomentBestaat(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  teamId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('match_events')
    .select('id')
    .eq('id', id)
    .eq('team_id', teamId)
    .maybeSingle()
  return !!data
}

// "Ongedaan maken" van deleteMatchEvent: zet de rij terug met dezelfde id en
// created_at. Volledig opnieuw gevalideerd zoals addMatchEvent (event en
// speler van dit team, geldige soort en minuut); `herstel.teamId` alleen als
// weigercontrole, schrijven altijd met ctx.teamId. Idempotent.
export async function herstelWedstrijdMoment(herstel: HerstelWedstrijdMoment): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'wedstrijd')

  if (!herstel || typeof herstel !== 'object' || herstel.soort !== 'wedstrijdmoment') throw herstelNietMogelijk()
  if (herstel.teamId !== ctx.teamId) throw herstelNietMogelijk()
  if (!isUuid(herstel.id) || !isUuid(herstel.eventId) || !isUuid(herstel.playerId)) throw herstelNietMogelijk()
  if (!isValidKind(herstel.kind)) throw herstelNietMogelijk()
  if (!isValidMinute(herstel.minute)) throw herstelNietMogelijk()
  const createdAt = schoonCreatedAt(herstel.createdAt)
  if (createdAt === undefined) throw herstelNietMogelijk()

  try {
    await Promise.all([
      assertOwnEvent(supabase, herstel.eventId, ctx.teamId),
      assertOwnPlayer(supabase, herstel.playerId, ctx.teamId),
    ])
  } catch {
    throw herstelNietMogelijk()
  }

  if (await wedstrijdMomentBestaat(supabase, herstel.id, ctx.teamId)) {
    revalidateEvent(herstel.eventId)
    return
  }

  const { error } = await supabase.from('match_events').insert({
    id: herstel.id,
    team_id: ctx.teamId,
    event_id: herstel.eventId,
    player_id: herstel.playerId,
    kind: herstel.kind,
    minute: herstel.minute,
    ...(createdAt ? { created_at: createdAt } : {}),
  })

  if (error) {
    if (errorCode(error) === '23505') {
      if (await wedstrijdMomentBestaat(supabase, herstel.id, ctx.teamId)) {
        revalidateEvent(herstel.eventId)
        return
      }
      throw herstelNietMogelijk()
    }
    throw genericError('matchAnalysis.herstelWedstrijdMoment', error)
  }

  revalidateEvent(herstel.eventId)
}
