'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertOwnEvent, assertOwnOefening, getOwnPlayerIds } from '@/lib/authz'
import { validateOefening, oefeningRow, type OefeningInput } from '@/lib/oefening'
import { validateSpelerindeling } from '@/lib/spelerindeling'
import { validateParallelSpelers, assertGeenOverlap } from '@/lib/parallel-groep'
import { joinedCategorie } from '@/lib/periodization'
import { clampStapOverride } from '@/lib/periodization-stappen'
import { genericError, logError } from '@/lib/errors'
import { kopieerKoppelingen, type BronKoppeling } from '@/lib/kopieer-trainingsplan'

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

  if (error) throw genericError('trainingPlan.saveMeting', error)
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
    if (error) throw genericError('trainingPlan.saveNulmeting.event', error)
  } else {
    const { data: created, error } = await supabase
      .from('events')
      .insert({ type: 'meting', date: input.date, team_id: user.id })
      .select('id')
      .single()
    if (error) throw genericError('trainingPlan.saveNulmeting.createEvent', error)
    eventId = created.id
  }

  const { error: metingError } = await supabase.from('metingen').upsert({
    event_id: eventId,
    team_id: user.id,
    ...clampSteps(input.steps),
    notes: input.notes?.slice(0, 1000) ?? null,
  }, { onConflict: 'event_id' })

  if (metingError) throw genericError('trainingPlan.saveNulmeting.meting', metingError)
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

  if (error) throw genericError('trainingPlan.deleteNulmeting', error)
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

  if (error) throw genericError('trainingPlan.saveDoelstelling', error)
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

// Bestaande bibliotheek-oefening aan een training koppelen. Dezelfde oefening mag
// meerdere keren aan dezelfde training hangen: elke aanroep maakt een nieuwe,
// onafhankelijke koppelingsrij onderaan het plan.
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

  if (error) throw genericError('trainingPlan.addOefeningToTraining', error)

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

  if (error) throw genericError('trainingPlan.createAndAddOefening', error)
  const oefeningId = created.id

  const volgorde = await nextVolgordeForEvent(supabase, eventId, user.id)

  const { error: linkError } = await supabase.from('training_oefeningen').insert({
    team_id: user.id,
    event_id: eventId,
    oefening_id: oefeningId,
    volgorde,
  })

  if (linkError) throw genericError('trainingPlan.createAndAddOefening.link', linkError)

  revalidatePath('/oefeningen')
  revalidatePath(`/events/${eventId}/training-plan`)
  return { oefeningId }
}

// Koppeling verwijderen (laat de bibliotheek-oefening zelf staan).
export async function removeOefeningFromTraining(koppelingId: string, eventId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnEvent(supabase, eventId, user.id)

  // Eerst de eventuele parallelle groep lezen: na het verwijderen is niet meer
  // te achterhalen bij welke groep deze koppeling hoorde. Op event_id gescoped,
  // zodat een koppeling uit een ándere training van dit team de opruiming niet
  // op het verkeerde event laat draaien.
  const { data: koppeling } = await supabase
    .from('training_oefeningen')
    .select('id, parallel_groep_id')
    .eq('id', koppelingId)
    .eq('event_id', eventId)
    .eq('team_id', user.id)
    .maybeSingle()
  const groepId = (koppeling as { parallel_groep_id?: string | null } | null)?.parallel_groep_id ?? null

  const { error } = await supabase
    .from('training_oefeningen')
    .delete()
    .eq('id', koppelingId)
    .eq('event_id', eventId)
    .eq('team_id', user.id)

  if (error) throw genericError('trainingPlan.removeOefeningFromTraining', error)

  // Blijft er één lid over, dan is het geen parallelle groep meer.
  await ruimEenzameGroepOp(supabase, eventId, user.id, groepId)
  await normaliseerBlokVolgorde(supabase, eventId, user.id)

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

  if (error) throw genericError('trainingPlan.updateKoppeling', error)
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

  if (error) throw genericError('trainingPlan.saveSpelerindeling', error)
  revalidatePath(`/events/${eventId}/training-plan`)
}

// Volledige herordening van de koppelingen binnen een training.
//
// Blok-bewust: koppelingen die in dezelfde parallelle groep zitten vormen één
// blok en houden dezelfde `volgorde`. Blind `volgorde = i` per id schrijven zou
// die invariant breken. De client-signatuur blijft ongewijzigd.
export async function reorderKoppelingen(eventId: string, orderedIds: string[]): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnEvent(supabase, eventId, user.id)

  await normaliseerBlokVolgorde(supabase, eventId, user.id, orderedIds)

  revalidatePath(`/events/${eventId}/training-plan`)
}

// ────────────────────────────────────────────────
// Parallelle oefeningen: blok-volgorde
// ────────────────────────────────────────────────
// Zie supabase/parallelle-oefeningen.sql en lib/parallel-groep.ts. Alle leden
// van één parallelle groep delen dezelfde `volgorde` (het blok); verschillende
// blokken hebben verschillende, aaneengesloten waarden 0..m-1.

type KoppelingRij = {
  id: string
  volgorde: number | null
  parallel_groep_id: string | null
  created_at: string | null
}

// Alle koppelingen van deze training, tenant- én event-gescoped.
async function haalKoppelingRijen(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  teamId: string,
): Promise<KoppelingRij[]> {
  const { data } = await supabase
    .from('training_oefeningen')
    .select('id, volgorde, parallel_groep_id, created_at')
    .eq('event_id', eventId)
    .eq('team_id', teamId)
    .order('volgorde', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  return Array.isArray(data) ? (data as KoppelingRij[]) : []
}

// Deterministische rijvolgorde. Met `orderedIds` (herordening door de client)
// wegen die posities het zwaarst; rijen die er niet in staan volgen daarna op
// hun huidige volgorde, created_at en id.
function sorteerRijen(rijen: KoppelingRij[], orderedIds?: string[]): KoppelingRij[] {
  const rang = new Map<string, number>()
  for (const [i, id] of (orderedIds ?? []).entries()) if (!rang.has(id)) rang.set(id, i)

  return [...rijen].sort(
    (a, b) =>
      (rang.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rang.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      (a.volgorde ?? 0) - (b.volgorde ?? 0) ||
      String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

// Kent elk blok (parallelle groep óf losse koppeling) bij eerste voorkomen het
// volgende blok-nummer toe en schrijft dat naar élk lid van dat blok. Schrijft
// alleen rijen waarvan de waarde daadwerkelijk verandert. Wordt aangeroepen na
// iedere groepsmutatie en bij het herordenen.
async function normaliseerBlokVolgorde(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  teamId: string,
  orderedIds?: string[],
): Promise<void> {
  const rijen = sorteerRijen(await haalKoppelingRijen(supabase, eventId, teamId), orderedIds)

  const blokIndex = new Map<string, number>()
  let volgende = 0
  for (const rij of rijen) {
    const sleutel = rij.parallel_groep_id ?? `k:${rij.id}`
    if (!blokIndex.has(sleutel)) blokIndex.set(sleutel, volgende++)
  }

  for (const rij of rijen) {
    const nieuw = blokIndex.get(rij.parallel_groep_id ?? `k:${rij.id}`) ?? 0
    if (rij.volgorde === nieuw) continue
    const { error } = await supabase
      .from('training_oefeningen')
      .update({ volgorde: nieuw })
      .eq('id', rij.id)
      .eq('event_id', eventId)
      .eq('team_id', teamId)
    if (error) throw genericError('trainingPlan.normaliseerBlokVolgorde', error)
  }
}

// Een parallelle groep heeft minimaal twee leden. Blijft er na een mutatie nog
// één over, dan vervalt de groep: dat lid wordt weer een gewone koppeling en
// zijn groepsindeling wordt gewist (de kolom hoort leeg te zijn zonder groep).
async function ruimEenzameGroepOp(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  teamId: string,
  groepId: string | null,
): Promise<void> {
  if (!groepId) return

  const { data } = await supabase
    .from('training_oefeningen')
    .select('id')
    .eq('event_id', eventId)
    .eq('team_id', teamId)
    .eq('parallel_groep_id', groepId)
  const leden = Array.isArray(data) ? (data as { id: string }[]) : []
  if (leden.length !== 1) return

  const { error } = await supabase
    .from('training_oefeningen')
    .update({ parallel_groep_id: null, parallel_spelers: [] })
    .eq('id', leden[0].id)
    .eq('event_id', eventId)
    .eq('team_id', teamId)
  if (error) throw genericError('trainingPlan.ruimEenzameGroepOp', error)
}

// ────────────────────────────────────────────────
// Parallelle oefeningen: groepen beheren
// ────────────────────────────────────────────────

// Twee of meer koppelingen tot één parallelle groep smeden. De groepssleutel
// wordt server-side gegenereerd; de client levert hem nooit aan.
export async function vormParallelGroep(
  eventId: string,
  koppelingIds: string[],
): Promise<{ groepId: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnEvent(supabase, eventId, user.id)

  const ids = [...new Set(koppelingIds)]
  if (ids.length < 2) throw new Error('Minimaal twee oefeningen voor een parallelle groep')

  // Alle leden moeten koppelingen van DEZE training van DIT team zijn: een
  // ontbrekende rij betekent een vreemd of onbestaand id.
  const { data } = await supabase
    .from('training_oefeningen')
    .select('id, parallel_groep_id')
    .in('id', ids)
    .eq('event_id', eventId)
    .eq('team_id', user.id)
  const rijen = Array.isArray(data) ? (data as { id: string; parallel_groep_id: string | null }[]) : []
  if (rijen.length !== ids.length) throw new Error('Koppeling niet gevonden')
  if (rijen.some((rij) => rij.parallel_groep_id)) {
    throw new Error('Koppeling zit al in een parallelle groep')
  }

  const groepId = crypto.randomUUID()

  for (const id of ids) {
    const { error } = await supabase
      .from('training_oefeningen')
      .update({ parallel_groep_id: groepId })
      .eq('id', id)
      .eq('event_id', eventId)
      .eq('team_id', user.id)
    if (error) throw genericError('trainingPlan.vormParallelGroep', error)
  }

  // Het blok neemt de laagste volgorde van zijn leden over; de rest schuift op.
  await normaliseerBlokVolgorde(supabase, eventId, user.id)

  revalidatePath(`/events/${eventId}/training-plan`)
  return { groepId }
}

// Losse koppeling aan een bestaande parallelle groep toevoegen. De nieuwkomer
// start met een lege groepsindeling; bestaande leden blijven onaangeroerd.
export async function voegToeAanParallelGroep(
  eventId: string,
  koppelingId: string,
  groepId: string,
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnEvent(supabase, eventId, user.id)

  const { data: koppeling } = await supabase
    .from('training_oefeningen')
    .select('id, parallel_groep_id')
    .eq('id', koppelingId)
    .eq('event_id', eventId)
    .eq('team_id', user.id)
    .maybeSingle()
  if (!koppeling) throw new Error('Koppeling niet gevonden')
  if ((koppeling as { parallel_groep_id?: string | null }).parallel_groep_id) {
    throw new Error('Koppeling zit al in een parallelle groep')
  }

  // De groepssleutel komt van de client en wordt nooit blind weggeschreven:
  // hij moet minstens één lid hebben binnen deze training van dit team. Dat
  // sluit meteen een groep-id van een ander team uit.
  const { data: bestaandLid } = await supabase
    .from('training_oefeningen')
    .select('id')
    .eq('event_id', eventId)
    .eq('team_id', user.id)
    .eq('parallel_groep_id', groepId)
    .limit(1)
    .maybeSingle()
  if (!bestaandLid) throw new Error('Ongeldige parallelle groep')

  const { error } = await supabase
    .from('training_oefeningen')
    .update({ parallel_groep_id: groepId, parallel_spelers: [] })
    .eq('id', koppelingId)
    .eq('event_id', eventId)
    .eq('team_id', user.id)
  if (error) throw genericError('trainingPlan.voegToeAanParallelGroep', error)

  await normaliseerBlokVolgorde(supabase, eventId, user.id)

  revalidatePath(`/events/${eventId}/training-plan`)
}

// Koppeling uit haar parallelle groep halen. Idempotent: een koppeling die al
// geen groep heeft levert geen fout op.
export async function haalUitParallelGroep(eventId: string, koppelingId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnEvent(supabase, eventId, user.id)

  const { data: koppeling } = await supabase
    .from('training_oefeningen')
    .select('id, parallel_groep_id')
    .eq('id', koppelingId)
    .eq('event_id', eventId)
    .eq('team_id', user.id)
    .maybeSingle()
  if (!koppeling) throw new Error('Koppeling niet gevonden')
  const groepId = (koppeling as { parallel_groep_id?: string | null }).parallel_groep_id ?? null

  // Buiten een groep hoort de groepsindeling leeg te zijn.
  const { error } = await supabase
    .from('training_oefeningen')
    .update({ parallel_groep_id: null, parallel_spelers: [] })
    .eq('id', koppelingId)
    .eq('event_id', eventId)
    .eq('team_id', user.id)
  if (error) throw genericError('trainingPlan.haalUitParallelGroep', error)

  if (groepId) {
    await ruimEenzameGroepOp(supabase, eventId, user.id, groepId)
    await normaliseerBlokVolgorde(supabase, eventId, user.id)
  }

  revalidatePath(`/events/${eventId}/training-plan`)
}

// Welke spelers doen deze oefening binnen de parallelle groep? Platte lijst
// player_id's — GEEN teamindeling: `spelerindeling` (saveSpelerindeling) blijft
// hier volledig los van staan. Argumentvolgorde bewust gelijk aan
// saveSpelerindeling.
export async function saveParallelIndeling(
  koppelingId: string,
  eventId: string,
  spelerIds: string[],
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnEvent(supabase, eventId, user.id)

  const { data: koppeling } = await supabase
    .from('training_oefeningen')
    .select('id, parallel_groep_id')
    .eq('id', koppelingId)
    .eq('event_id', eventId)
    .eq('team_id', user.id)
    .maybeSingle()
  if (!koppeling) throw new Error('Koppeling niet gevonden')
  const groepId = (koppeling as { parallel_groep_id?: string | null }).parallel_groep_id ?? null
  if (!groepId) throw new Error('Koppeling zit niet in een parallelle groep')

  // De andere leden van dezelfde groep, om dubbele indeling te weren. Alleen
  // binnen dit event en dit team — de groepssleutel alleen is niet genoeg.
  const { data: andere } = await supabase
    .from('training_oefeningen')
    .select('id, parallel_spelers')
    .eq('event_id', eventId)
    .eq('team_id', user.id)
    .eq('parallel_groep_id', groepId)
    .neq('id', koppelingId)
  const andereLeden = Array.isArray(andere)
    ? (andere as { id: string; parallel_spelers?: string[] | null }[])
    : []

  // Validatieset: alle eigen spelers (geen active-filter — zelfde afweging als
  // saveSpelerindeling).
  const ownPlayerIds = await getOwnPlayerIds(supabase, user.id)
  const clean = validateParallelSpelers(spelerIds, { ownPlayerIds })
  assertGeenOverlap(clean, andereLeden.map((lid) => lid.parallel_spelers))

  const { error } = await supabase
    .from('training_oefeningen')
    .update({ parallel_spelers: clean })
    .eq('id', koppelingId)
    .eq('event_id', eventId)
    .eq('team_id', user.id)

  if (error) throw genericError('trainingPlan.saveParallelIndeling', error)
  revalidatePath(`/events/${eventId}/training-plan`)
}

// Eén speler in één server-aanroep van het ene groepslid naar het andere
// verplaatsen. Bestaat naast saveParallelIndeling omdat een verplaatsing via
// twee losse aanroepen (bron leegmaken, doel aanvullen) halverwege kan stranden:
// de speler staat dan bij niemand meer, terwijl de client alleen een foutmelding
// ziet en terugrolt naar zijn laatst bevestigde verdeling. Pool→lid en lid→pool
// blijven via saveParallelIndeling lopen: die raken maar één rij.
export async function verplaatsParallelSpeler(
  eventId: string,
  vanKoppelingId: string,
  naarKoppelingId: string,
  spelerId: string,
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnEvent(supabase, eventId, user.id)

  if (vanKoppelingId === naarKoppelingId) throw new Error('Bron en doel zijn dezelfde oefening')

  // Beide leden in één select, gescoped op event_id + team_id: een ontbrekende
  // rij betekent een vreemd, onbestaand of niet bij deze training horend id.
  const { data } = await supabase
    .from('training_oefeningen')
    .select('id, parallel_groep_id, parallel_spelers')
    .in('id', [vanKoppelingId, naarKoppelingId])
    .eq('event_id', eventId)
    .eq('team_id', user.id)
  const rijen = Array.isArray(data)
    ? (data as { id: string; parallel_groep_id: string | null; parallel_spelers?: string[] | null }[])
    : []
  const van = rijen.find((rij) => rij.id === vanKoppelingId)
  const naar = rijen.find((rij) => rij.id === naarKoppelingId)
  if (!van || !naar) throw new Error('Koppeling niet gevonden')

  const groepId = van.parallel_groep_id ?? null
  if (!groepId || !naar.parallel_groep_id) throw new Error('Koppeling zit niet in een parallelle groep')
  if (naar.parallel_groep_id !== groepId) {
    throw new Error('Koppelingen zitten niet in dezelfde parallelle groep')
  }

  // Stond de speler daar niet (meer), dan is de client-staat verouderd; dan
  // niets schrijven, anders zou de speler op twee plekken tegelijk landen.
  const vanSpelers = Array.isArray(van.parallel_spelers)
    ? van.parallel_spelers.filter((id): id is string => typeof id === 'string')
    : []
  if (!vanSpelers.includes(spelerId)) throw new Error('Speler niet gevonden')

  const naarSpelers = Array.isArray(naar.parallel_spelers)
    ? naar.parallel_spelers.filter((id): id is string => typeof id === 'string')
    : []

  // De overige leden van dezelfde groep (bron en doel uitgezonderd), om dubbele
  // indeling te weren — zelfde afweging als saveParallelIndeling.
  const { data: andere } = await supabase
    .from('training_oefeningen')
    .select('id, parallel_spelers')
    .eq('event_id', eventId)
    .eq('team_id', user.id)
    .eq('parallel_groep_id', groepId)
    .neq('id', vanKoppelingId)
    .neq('id', naarKoppelingId)
  const andereLeden = Array.isArray(andere)
    ? (andere as { id: string; parallel_spelers?: string[] | null }[])
    : []

  const ownPlayerIds = await getOwnPlayerIds(supabase, user.id)
  const cleanNaar = validateParallelSpelers([...naarSpelers, spelerId], { ownPlayerIds })
  assertGeenOverlap(cleanNaar, andereLeden.map((lid) => lid.parallel_spelers))

  // De bron houdt exact over wat er al stond, minus deze speler: geen
  // hervalidatie, zodat een verplaatsing niet stukloopt op een reeds opgeslagen
  // id dat inmiddels geen eigen speler meer is.
  const cleanVan = vanSpelers.filter((id) => id !== spelerId)

  const { error: vanError } = await supabase
    .from('training_oefeningen')
    .update({ parallel_spelers: cleanVan })
    .eq('id', vanKoppelingId)
    .eq('event_id', eventId)
    .eq('team_id', user.id)
  if (vanError) throw genericError('trainingPlan.verplaatsParallelSpeler.van', vanError)

  const { error: naarError } = await supabase
    .from('training_oefeningen')
    .update({ parallel_spelers: cleanNaar })
    .eq('id', naarKoppelingId)
    .eq('event_id', eventId)
    .eq('team_id', user.id)

  if (naarError) {
    // Twee rijen, geen transactie: slaagt de eerste update en faalt de tweede,
    // dan zou de speler bij niemand meer staan terwijl de client op de fout
    // terugrolt naar de oude verdeling. Die stille afwijking blijft dan in de DB
    // hangen tot de volgende refresh. Daarom eerst de bron herstellen, dan pas
    // gooien; lukt het herstel ook niet, dan loggen we dat apart — de gebruiker
    // krijgt hoe dan ook dezelfde generieke fout.
    const { error: herstelError } = await supabase
      .from('training_oefeningen')
      .update({ parallel_spelers: vanSpelers })
      .eq('id', vanKoppelingId)
      .eq('event_id', eventId)
      .eq('team_id', user.id)
    if (herstelError) logError('trainingPlan.verplaatsParallelSpeler.herstel', herstelError)
    throw genericError('trainingPlan.verplaatsParallelSpeler.naar', naarError)
  }

  revalidatePath(`/events/${eventId}/training-plan`)
}

// Neemt de oefeningen van een eerdere training over in deze training.
//
// Weken lijken op elkaar: dezelfde warming-up, dezelfde partijvorm, met één
// blok anders. Opnieuw samenstellen kostte evenveel handelingen als de eerste
// keer, terwijl dupliceren-en-aanpassen het werkelijke gedrag is.
//
// APPEND, NOOIT OVERSCHRIJVEN: de gekopieerde oefeningen komen áchter wat er al
// staat. Een variant die het doelplan eerst leegmaakt is bewust niet gebouwd —
// dat is niet terug te draaien, en de UI biedt het kopiëren alleen aan bij een
// leeg plan.
//
// Wat NIET meekomt: spelerindeling en parallel_spelers. Zie de toelichting in
// lib/kopieer-trainingsplan.ts — bij een andere training staat er een andere
// groep op het veld.
export async function kopieerTrainingsplan(
  doelEventId: string,
  bronEventId: string,
): Promise<{ aantal: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  if (doelEventId === bronEventId) throw new Error('Bron en doel zijn dezelfde training')

  // Beide events moeten van dit team zijn. Zonder de bron-check zou een
  // aanroeper het plan van een andere gebruiker kunnen binnenhalen.
  await Promise.all([
    assertOwnEvent(supabase, doelEventId, user.id),
    assertOwnEvent(supabase, bronEventId, user.id),
  ])

  const { data: bronRijen, error: leesError } = await supabase
    .from('training_oefeningen')
    .select('oefening_id, volgorde, stap_override, parallel_groep_id')
    .eq('event_id', bronEventId)
    .eq('team_id', user.id)
    .order('volgorde')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (leesError) throw genericError('trainingPlan.kopieerTrainingsplan.lezen', leesError)

  const bron = bronRijen ?? []
  if (bron.length === 0) return { aantal: 0 }

  const offset = await nextVolgordeForEvent(supabase, doelEventId, user.id)
  const nieuw = kopieerKoppelingen(bron as BronKoppeling[], offset, () => crypto.randomUUID())

  const { error } = await supabase.from('training_oefeningen').insert(
    nieuw.map((rij) => ({ ...rij, team_id: user.id, event_id: doelEventId })),
  )
  if (error) throw genericError('trainingPlan.kopieerTrainingsplan', error)

  revalidatePath(`/events/${doelEventId}/training-plan`)
  return { aantal: nieuw.length }
}
