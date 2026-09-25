'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertOwnOefening, isUuid } from '@/lib/authz'
import {
  OEFENING_INHOUD_KOLOMMEN,
  oefeningKopieRij,
  oefeningRow,
  validateOefening,
  type OefeningInput,
} from '@/lib/oefening'
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

// ────────────────────────────────────────────────
// Kopiëren naar de eigen bibliotheek (fase 4, AC 20, BR 56)
// ────────────────────────────────────────────────
//
// Een teamlid ziet in een trainingsplan ook oefeningen van teamgenoten (de
// SELECT-policy "oefeningen: zichtbaar via gekoppeld trainingsplan",
// supabase/oefeningen-persoonlijk.sql). Bewerken kan hij die niet (AC 35);
// kopiëren wel. De kopie is een nieuwe, volledig onafhankelijke rij in zijn
// eigen bibliotheek.
//
// GEEN RECHTENCHECK, en dat is de bedoeling (AC 20): elk teamlid dat het plan
// kan lezen mag kopiëren, ook zonder Training-bewerkrecht. Het kopiëren raakt
// geen enkele teamdata — alleen de eigen bibliotheek.
//
// GEEN team_id-FILTER OP DE LEES, en ook dat is de bedoeling: de oefening is
// juist NIET van de aanroeper. RLS beslist of hij zichtbaar is (eigenaar, of
// gekoppeld in een trainingsplan van een team waar de aanroeper lid van is).
// Komt er niets terug, dan bestaat hij niet of is hij onzichtbaar — dezelfde
// melding voor beide, zoals assertOwnOefening.
export async function kopieerOefeningNaarBibliotheek(oefeningId: string): Promise<{ id: string }> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()

  // Vormcheck vóór de database: een ongeldig id zou anders een PostgREST-fout
  // (22P02) worden in plaats van de gewone "niet gevonden".
  if (!isUuid(oefeningId)) throw new Error('Oefening niet gevonden')

  const { data: bron, error: leesError } = await supabase
    .from('oefeningen')
    .select(OEFENING_INHOUD_KOLOMMEN.join(', '))
    .eq('id', oefeningId)
    .maybeSingle()

  if (leesError) throw genericError('oefeningLibrary.kopieerOefeningNaarBibliotheek.lezen', leesError)
  if (!bron) throw new Error('Oefening niet gevonden')

  // Eigenaar van de kopie = de aanroeper (ctx.userId), NOOIT ctx.teamId: een
  // oefening is persoonlijk bezit en verhuist niet met het actieve team mee.
  const { data, error } = await supabase
    .from('oefeningen')
    .insert(oefeningKopieRij(bron as unknown as Record<string, unknown>, ctx.userId))
    .select('id')
    .single()

  if (error) throw genericError('oefeningLibrary.kopieerOefeningNaarBibliotheek', error)

  revalidatePath('/oefeningen')
  return { id: data.id }
}
