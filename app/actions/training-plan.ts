'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { OefeningCategorie } from '@/lib/types'

const VALID_CATEGORIES: OefeningCategorie[] = [
  'partijen_groot', 'partijen_midden', 'partijen_klein',
  'sprints_weinig_rust', 'sprints_veel_rust', 'steigerungs', 'overig',
]
const VALID_ORIENTATIES = ['breedte', 'lengte', 'vrij'] as const
const VALID_VELDZONES = ['links', 'midden', 'rechts', 'strafschopgebied_links', 'strafschopgebied_rechts'] as const

// ────────────────────────────────────────────────
// Meting
// ────────────────────────────────────────────────

export interface MetingSteps {
  partijen_groot_stap: number
  partijen_midden_stap: number
  partijen_klein_stap: number
  sprints_weinig_rust_stap: number
  sprints_veel_rust_stap: number
}

function clampSteps(steps: MetingSteps): MetingSteps {
  return {
    partijen_groot_stap:      Math.max(1, Math.min(21, steps.partijen_groot_stap)),
    partijen_midden_stap:     Math.max(1, Math.min(15, steps.partijen_midden_stap)),
    partijen_klein_stap:      Math.max(1, Math.min(13, steps.partijen_klein_stap)),
    sprints_weinig_rust_stap: Math.max(1, Math.min(14, steps.sprints_weinig_rust_stap)),
    sprints_veel_rust_stap:   Math.max(1, Math.min(13, steps.sprints_veel_rust_stap)),
  }
}

export async function saveMeting(eventId: string, steps: MetingSteps, notes: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  // Verify event belongs to this team
  const { data: event } = await supabase
    .from('events').select('id').eq('id', eventId).eq('team_id', user.id).single()
  if (!event) throw new Error('Event niet gevonden')

  const { error } = await supabase.from('metingen').upsert({
    event_id: eventId,
    team_id: user.id,
    ...clampSteps(steps),
    notes: notes?.slice(0, 1000) ?? null,
  }, { onConflict: 'event_id' })

  if (error) throw new Error(error.message)
  revalidatePath(`/events/${eventId}`)
  revalidatePath('/periodisering')
}

// ────────────────────────────────────────────────
// Nulmeting (periodisering page) — stored as a meting event under the hood
// so existing step calculations and history keep working without a migration.
// ────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function saveNulmeting(input: {
  eventId?: string
  date: string
  steps: MetingSteps
  notes: string | null
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  if (!DATE_RE.test(input.date)) throw new Error('Ongeldige datum')

  let eventId = input.eventId ?? null

  if (eventId) {
    const { data: event } = await supabase
      .from('events').select('id').eq('id', eventId).eq('team_id', user.id).eq('type', 'meting').single()
    if (!event) throw new Error('Nulmeting niet gevonden')

    const { error } = await supabase
      .from('events')
      .update({ date: input.date })
      .eq('id', eventId)
      .eq('team_id', user.id)
    if (error) throw new Error(error.message)
  } else {
    const { data: created, error } = await supabase
      .from('events')
      .insert({ type: 'meting', date: input.date, team_id: user.id })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    eventId = created.id
  }

  const { error: metingError } = await supabase.from('metingen').upsert({
    event_id: eventId,
    team_id: user.id,
    ...clampSteps(input.steps),
    notes: input.notes?.slice(0, 1000) ?? null,
  }, { onConflict: 'event_id' })

  if (metingError) throw new Error(metingError.message)
  revalidatePath('/periodisering')
}

export async function deleteNulmeting(eventId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', eventId)
    .eq('team_id', user.id)
    .eq('type', 'meting')

  if (error) throw new Error(error.message)
  revalidatePath('/periodisering')
}

// ────────────────────────────────────────────────
// Doelstelling
// ────────────────────────────────────────────────

export async function saveDoelstelling(eventId: string, doelstelling: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { error } = await supabase
    .from('events')
    .update({ doelstelling: doelstelling.slice(0, 500) || null })
    .eq('id', eventId)
    .eq('team_id', user.id)

  if (error) throw new Error(error.message)
  revalidatePath(`/events/${eventId}/training-plan`)
}

// ────────────────────────────────────────────────
// Oefeningen
// ────────────────────────────────────────────────

export interface OefeningInput {
  naam: string
  beschrijving?: string | null
  categorie: OefeningCategorie
  duur_min?: number | null
  breedte_m?: number | null
  lengte_m?: number | null
  orientatie?: 'breedte' | 'lengte' | 'vrij'
  veldzone?: 'links' | 'midden' | 'rechts' | 'strafschopgebied_links' | 'strafschopgebied_rechts' | null
  aantal_teams?: number
  stap_override?: number | null
  genest_in?: string | null
}

export async function addOefening(eventId: string, input: OefeningInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const naam = input.naam.trim().slice(0, 200)
  if (!naam) throw new Error('Naam verplicht')
  if (!VALID_CATEGORIES.includes(input.categorie)) throw new Error('Ongeldige categorie')
  if (input.orientatie && !VALID_ORIENTATIES.includes(input.orientatie)) throw new Error('Ongeldige oriëntatie')
  if (input.veldzone && !VALID_VELDZONES.includes(input.veldzone)) throw new Error('Ongeldige veldzone')

  // Check event belongs to team
  const { data: event } = await supabase
    .from('events').select('id').eq('id', eventId).eq('team_id', user.id).single()
  if (!event) throw new Error('Event niet gevonden')

  // Get max volgorde for this event
  const { data: last } = await supabase
    .from('oefeningen')
    .select('volgorde')
    .eq('event_id', eventId)
    .order('volgorde', { ascending: false })
    .limit(1)
    .single()
  const nextVolgorde = (last?.volgorde ?? -1) + 1

  const { error } = await supabase.from('oefeningen').insert({
    event_id: eventId,
    team_id: user.id,
    naam,
    beschrijving: input.beschrijving?.slice(0, 2000) ?? null,
    categorie: input.categorie,
    duur_min: input.duur_min ?? null,
    breedte_m: input.breedte_m ?? null,
    lengte_m: input.lengte_m ?? null,
    orientatie: input.orientatie ?? 'vrij',
    veldzone: input.veldzone ?? null,
    aantal_teams: Math.max(0, Math.min(20, input.aantal_teams ?? 0)),
    stap_override: input.stap_override ?? null,
    genest_in: input.genest_in ?? null,
    volgorde: nextVolgorde,
  })

  if (error) throw new Error(error.message)
  revalidatePath(`/events/${eventId}/training-plan`)
}

export async function updateOefening(id: string, eventId: string, input: OefeningInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const naam = input.naam.trim().slice(0, 200)
  if (!naam) throw new Error('Naam verplicht')
  if (!VALID_CATEGORIES.includes(input.categorie)) throw new Error('Ongeldige categorie')

  const { error } = await supabase
    .from('oefeningen')
    .update({
      naam,
      beschrijving: input.beschrijving?.slice(0, 2000) ?? null,
      categorie: input.categorie,
      duur_min: input.duur_min ?? null,
      breedte_m: input.breedte_m ?? null,
      lengte_m: input.lengte_m ?? null,
      orientatie: input.orientatie ?? 'vrij',
      veldzone: input.veldzone ?? null,
      aantal_teams: Math.max(0, Math.min(20, input.aantal_teams ?? 0)),
      stap_override: input.stap_override ?? null,
      genest_in: input.genest_in ?? null,
    })
    .eq('id', id)
    .eq('team_id', user.id)

  if (error) throw new Error(error.message)
  revalidatePath(`/events/${eventId}/training-plan`)
}

export async function deleteOefening(id: string, eventId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { error } = await supabase
    .from('oefeningen')
    .delete()
    .eq('id', id)
    .eq('team_id', user.id)

  if (error) throw new Error(error.message)
  revalidatePath(`/events/${eventId}/training-plan`)
}
