'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertOwnEvent, assertOwnOefening } from '@/lib/authz'
import { validateOefening, oefeningRow, type OefeningInput } from '@/lib/oefening'
import { validateSpelerindeling } from '@/lib/spelerindeling'
import { joinedCategorie } from '@/lib/periodization'
import { clampStapOverride } from '@/lib/periodization-stappen'

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
// Oefeningen koppelen aan een training (via training_oefeningen)
// ────────────────────────────────────────────────

// Volgende volgorde-waarde binnen een training (max + 1).
async function nextVolgordeForEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  teamId: string,
): Promise<number> {
  const { data: last } = await supabase
    .from('training_oefeningen')
    .select('volgorde')
    .eq('event_id', eventId)
    .eq('team_id', teamId)
    .order('volgorde', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (last?.volgorde ?? -1) + 1
}

// Bestaande bibliotheek-oefening aan een training koppelen.
export async function addOefeningToTraining(eventId: string, oefeningId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await Promise.all([
    assertOwnEvent(supabase, eventId, user.id),
    assertOwnOefening(supabase, oefeningId, user.id),
  ])

  const volgorde = await nextVolgordeForEvent(supabase, eventId, user.id)

  const { error } = await supabase.from('training_oefeningen').insert({
    team_id: user.id,
    event_id: eventId,
    oefening_id: oefeningId,
    volgorde,
  })

  if (error) {
    // UNIQUE(event_id, oefening_id): oefening zit al in deze training → idempotent negeren.
    if (error.code === '23505') {
      revalidatePath(`/events/${eventId}/training-plan`)
      return
    }
    throw new Error(error.message)
  }

  revalidatePath(`/events/${eventId}/training-plan`)
}

// Nieuwe bibliotheek-oefening maken én meteen aan een training koppelen.
export async function createAndAddOefening(
  eventId: string,
  input: OefeningInput,
): Promise<{ oefeningId: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnEvent(supabase, eventId, user.id)
  const v = validateOefening(input)

  const { data: created, error } = await supabase
    .from('oefeningen')
    .insert(oefeningRow(v, user.id))
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  const oefeningId = created.id

  const volgorde = await nextVolgordeForEvent(supabase, eventId, user.id)

  const { error: linkError } = await supabase.from('training_oefeningen').insert({
    team_id: user.id,
    event_id: eventId,
    oefening_id: oefeningId,
    volgorde,
  })

  if (linkError) throw new Error(linkError.message)

  revalidatePath('/oefeningen')
  revalidatePath(`/events/${eventId}/training-plan`)
  return { oefeningId }
}

// Koppeling verwijderen (laat de bibliotheek-oefening zelf staan).
export async function removeOefeningFromTraining(koppelingId: string, eventId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { error } = await supabase
    .from('training_oefeningen')
    .delete()
    .eq('id', koppelingId)
    .eq('team_id', user.id)

  if (error) throw new Error(error.message)
  revalidatePath(`/events/${eventId}/training-plan`)
}

// Koppeling bijwerken: volgorde / stap_override / genest_in.
export async function updateKoppeling(
  koppelingId: string,
  eventId: string,
  patch: { volgorde?: number; stap_override?: number | null; genest_in?: string | null },
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const update: Record<string, number | string | null> = {}

  if (patch.volgorde !== undefined) {
    update.volgorde = Math.max(0, Math.min(32767, Math.floor(patch.volgorde)))
  }

  if (patch.stap_override !== undefined) {
    if (patch.stap_override === null) {
      update.stap_override = null
    } else {
      // De bovengrens is categorie-specifiek (PERIODIZATION_CATEGORIES.maxStap),
      // dus eerst de categorie server-side ophalen — nooit uit de client
      // aannemen. Gescoped op id + event_id + team_id, zoals saveSpelerindeling.
      const { data: koppeling } = await supabase
        .from('training_oefeningen')
        .select('id, oefeningen(categorie)')
        .eq('id', koppelingId)
        .eq('event_id', eventId)
        .eq('team_id', user.id)
        .maybeSingle()
      if (!koppeling) throw new Error('Koppeling niet gevonden')

      // Onbekende/ontbrekende categorie → '' → clamp op de ruime grens 99.
      const categorie = joinedCategorie(koppeling) ?? ''
      update.stap_override = clampStapOverride(patch.stap_override, categorie)
    }
  }

  if (patch.genest_in !== undefined) {
    if (patch.genest_in === null) {
      update.genest_in = null
    } else {
      if (patch.genest_in === koppelingId) throw new Error('Kan niet in zichzelf nesten')
      // De ouder moet een koppeling binnen DEZELFDE training van dit team zijn.
      const { data: parent } = await supabase
        .from('training_oefeningen')
        .select('id')
        .eq('id', patch.genest_in)
        .eq('event_id', eventId)
        .eq('team_id', user.id)
        .maybeSingle()
      if (!parent) throw new Error('Ongeldige nesting')
      update.genest_in = patch.genest_in
    }
  }

  if (Object.keys(update).length === 0) return

  const { error } = await supabase
    .from('training_oefeningen')
    .update(update)
    .eq('id', koppelingId)
    .eq('event_id', eventId)
    .eq('team_id', user.id)

  if (error) throw new Error(error.message)
  revalidatePath(`/events/${eventId}/training-plan`)
}

// Training-specifieke teamindeling van één gekoppelde oefening opslaan.
// spelerindeling = string[][]: index = teamIndex binnen oefeningen.teams, elke
// sub-array is een lijst player_id's. Raakt UITSLUITEND training_oefeningen,
// nooit de bibliotheek-oefening `oefeningen`.
export async function saveSpelerindeling(
  koppelingId: string,
  eventId: string,
  spelerindeling: string[][],
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnEvent(supabase, eventId, user.id)

  // Koppeling ophalen + tenant/event-scopen, inclusief de teamconfig van de
  // gejoinde bibliotheek-oefening (om teamCount te bepalen).
  const { data: koppeling } = await supabase
    .from('training_oefeningen')
    .select('id, oefeningen(teams)')
    .eq('id', koppelingId)
    .eq('event_id', eventId)
    .eq('team_id', user.id)
    .maybeSingle()
  if (!koppeling) throw new Error('Koppeling niet gevonden')

  // De join levert (afhankelijk van de client-typing) een object óf een array.
  const joined = (koppeling as { oefeningen?: unknown }).oefeningen
  const oef = Array.isArray(joined) ? joined[0] : joined
  const teams = (oef && typeof oef === 'object' && Array.isArray((oef as { teams?: unknown }).teams))
    ? (oef as { teams: unknown[] }).teams
    : []
  const teamCount = teams.length

  // Validatieset: alle eigen spelers (geen active-filter — inactief-ingedeelde
  // spelers blijven geldig; een hard-verwijderde speler valt vanzelf weg omdat
  // zijn id niet meer in de set zit).
  const { data: playerRows } = await supabase
    .from('players')
    .select('id')
    .eq('team_id', user.id)
  const ownPlayerIds = new Set((playerRows ?? []).map((r) => r.id))

  const clean = validateSpelerindeling(spelerindeling, { teamCount, ownPlayerIds })

  const { error } = await supabase
    .from('training_oefeningen')
    .update({ spelerindeling: clean })
    .eq('id', koppelingId)
    .eq('team_id', user.id)

  if (error) throw new Error(error.message)
  revalidatePath(`/events/${eventId}/training-plan`)
}

// Volledige herordening van de koppelingen binnen een training.
export async function reorderKoppelingen(eventId: string, orderedIds: string[]): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnEvent(supabase, eventId, user.id)

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('training_oefeningen')
      .update({ volgorde: i })
      .eq('id', orderedIds[i])
      .eq('event_id', eventId)
      .eq('team_id', user.id)
    if (error) throw new Error(error.message)
  }

  revalidatePath(`/events/${eventId}/training-plan`)
}
