'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertOwnOefening } from '@/lib/authz'
import { validateOefening, oefeningRow, type OefeningInput } from '@/lib/oefening'
import { genericError } from '@/lib/errors'
import { requireTeamContext } from '@/lib/team-context'

// ────────────────────────────────────────────────
// Bibliotheek-CRUD (los van een training)
// ────────────────────────────────────────────────
//
// LET OP het verschil tussen de twee tabellen hieronder:
//   oefeningen.team_id          = EIGENAAR-USER  -> ctx.userId
//   training_oefeningen.team_id = het TEAM       -> ctx.teamId
// Een oefening is persoonlijk bezit en verhuist niet met het actieve team mee;
// de koppeling aan een training is wél teamdata. Daarom staat hier ook GEEN
// assertCanEdit: wie de oefening bezit mag hem bewerken, los van de
// teamrechten.

export async function createOefening(input: OefeningInput): Promise<{ id: string }> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()

  const v = validateOefening(input)

  const { data, error } = await supabase
    .from('oefeningen')
    .insert(oefeningRow(v, ctx.userId))
    .select('id')
    .single()

  if (error) throw genericError('oefeningLibrary.createOefening', error)
  revalidatePath('/oefeningen')
  return { id: data.id }
}

export async function updateOefening(id: string, input: OefeningInput): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()

  await assertOwnOefening(supabase, id, ctx.userId)
  const v = validateOefening(input)

  const { error } = await supabase
    .from('oefeningen')
    .update({ ...v })
    .eq('id', id)
    .eq('team_id', ctx.userId)

  if (error) throw genericError('oefeningLibrary.updateOefening', error)

  revalidatePath('/oefeningen')

  // Elke training waaraan deze oefening gekoppeld is, moet vernieuwen.
  const { data: koppelingen } = await supabase
    .from('training_oefeningen')
    .select('event_id')
    .eq('oefening_id', id)
    .eq('team_id', ctx.teamId)

  for (const k of koppelingen ?? []) {
    revalidatePath(`/events/${k.event_id}/training-plan`)
  }
}

export async function deleteOefening(id: string): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()

  await assertOwnOefening(supabase, id, ctx.userId)

  // Gekoppelde trainingen ophalen VÓÓR de delete (CASCADE ontkoppelt daarna).
  const { data: koppelingen } = await supabase
    .from('training_oefeningen')
    .select('event_id')
    .eq('oefening_id', id)
    .eq('team_id', ctx.teamId)

  const { error } = await supabase
    .from('oefeningen')
    .delete()
    .eq('id', id)
    .eq('team_id', ctx.userId)

  if (error) throw genericError('oefeningLibrary.deleteOefening', error)

  revalidatePath('/oefeningen')
  for (const k of koppelingen ?? []) {
    revalidatePath(`/events/${k.event_id}/training-plan`)
  }
}

// Hoeveel UNIEKE trainingen gebruiken deze oefening (voor de
// "verwijderen?"-waarschuwing). Bewust géén rijtelling: dezelfde oefening mag
// meerdere keren als aparte koppeling in één training zitten
// (supabase/oefening-meerdere-keren.sql), en dan is dat nog steeds één training.
export async function countOefeningKoppelingen(id: string): Promise<number> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()

  const { data } = await supabase
    .from('training_oefeningen')
    .select('event_id')
    .eq('oefening_id', id)
    .eq('team_id', ctx.teamId)

  return new Set((data ?? []).map((k) => k.event_id)).size
}
