'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertOwnOefening } from '@/lib/authz'
import { validateOefening, oefeningRow, type OefeningInput } from '@/lib/oefening'
import { genericError } from '@/lib/errors'

// ────────────────────────────────────────────────
// Bibliotheek-CRUD (los van een training)
// ────────────────────────────────────────────────

export async function createOefening(input: OefeningInput): Promise<{ id: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const v = validateOefening(input)

  const { data, error } = await supabase
    .from('oefeningen')
    .insert(oefeningRow(v, user.id))
    .select('id')
    .single()

  if (error) throw genericError('oefeningLibrary.createOefening', error)
  revalidatePath('/oefeningen')
  return { id: data.id }
}

export async function updateOefening(id: string, input: OefeningInput): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnOefening(supabase, id, user.id)
  const v = validateOefening(input)

  const { error } = await supabase
    .from('oefeningen')
    .update({ ...v })
    .eq('id', id)
    .eq('team_id', user.id)

  if (error) throw genericError('oefeningLibrary.updateOefening', error)

  revalidatePath('/oefeningen')

  // Elke training waaraan deze oefening gekoppeld is, moet vernieuwen.
  const { data: koppelingen } = await supabase
    .from('training_oefeningen')
    .select('event_id')
    .eq('oefening_id', id)
    .eq('team_id', user.id)

  for (const k of koppelingen ?? []) {
    revalidatePath(`/events/${k.event_id}/training-plan`)
  }
}

export async function deleteOefening(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnOefening(supabase, id, user.id)

  // Gekoppelde trainingen ophalen VÓÓR de delete (CASCADE ontkoppelt daarna).
  const { data: koppelingen } = await supabase
    .from('training_oefeningen')
    .select('event_id')
    .eq('oefening_id', id)
    .eq('team_id', user.id)

  const { error } = await supabase
    .from('oefeningen')
    .delete()
    .eq('id', id)
    .eq('team_id', user.id)

  if (error) throw genericError('oefeningLibrary.deleteOefening', error)

  revalidatePath('/oefeningen')
  for (const k of koppelingen ?? []) {
    revalidatePath(`/events/${k.event_id}/training-plan`)
  }
}

// Hoeveel trainingen gebruiken deze oefening (voor "verwijderen?"-waarschuwing).
export async function countOefeningKoppelingen(id: string): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { count } = await supabase
    .from('training_oefeningen')
    .select('id', { count: 'exact', head: true })
    .eq('oefening_id', id)
    .eq('team_id', user.id)

  return count ?? 0
}
