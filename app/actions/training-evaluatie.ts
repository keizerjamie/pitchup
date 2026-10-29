'use server'

// RPE en doelstelling-oordeel per training vastleggen op de trainingspagina
// (tabel `training_evaluaties`, supabase/inzichten-metrics-fase3b.sql). Eén rij
// per training; elke waarde wordt LOS geschreven: de upsert stuurt alleen de
// eigen kolom mee, dus RPE opslaan wist het oordeel nooit en andersom (R.9).
// Wissen zet alleen die kolom op null (geen delete: dat zou de andere waarde
// meenemen). Bewust een eigen bestand: zo blijven de bestaande
// vi.mock-factories van andere action-bestanden volledig.
//
// Tenant-isolatie: `team_id` wordt ALTIJD met ctx.teamId geschreven en nooit
// van de client gelezen; elke lees- en schrijfquery filtert op team_id. RLS
// (onderdeel 'training', plus "event is een training van hetzelfde team" in de
// insert- én update-policy) is de tweede laag.
//
// Tijd: `events.date` is een DATE en wordt als YYYY-MM-DD-string vergeleken met
// todayLocal(). Op een server met een UTC-klok is een training van "vandaag"
// tussen 00:00 en ~02:00 Nederlandse tijd nog even "toekomst" — fail-safe: een
// toekomstige training glipt er nooit door (zelfde gat als speelminuten).
//
// Productregels (toekomst, "oordeel alleen bij een niet-lege doelstelling")
// staan hier en in de UI, niet in RLS: het zijn geen tenantgrenzen.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/authz'
import { errorCode, genericError } from '@/lib/errors'
import { herstelNietMogelijk, type HerstelTrainingOordeel, type HerstelTrainingRpe } from '@/lib/herstel'
import { assertCanEdit, requireTeamContext } from '@/lib/team-context'
import { heeftDoelstelling, isTrainingOordeel, isValidRpe } from '@/lib/training-evaluatie'
import { todayLocal } from '@/lib/utils'
import type { TrainingOordeel } from '@/lib/types'

const ONGELDIGE_RPE = 'Ongeldige RPE'
const ONGELDIG_OORDEEL = 'Ongeldig oordeel'
const EVENT_NIET_GEVONDEN = 'Event niet gevonden'
const NIET_GEHOUDEN = 'Training nog niet gehouden'
const GEEN_DOELSTELLING = 'Geen doelstelling'
const NIET_GEVONDEN: Record<Kolom, string> = {
  rpe: 'RPE niet gevonden',
  oordeel: 'Oordeel niet gevonden',
}

type Kolom = 'rpe' | 'oordeel'
type Waarde<K extends Kolom> = K extends 'rpe' ? number : TrainingOordeel
type Supabase = Awaited<ReturnType<typeof createClient>>

const IS_GELDIG: { [K in Kolom]: (v: unknown) => v is Waarde<K> } = {
  rpe: isValidRpe,
  oordeel: isTrainingOordeel,
}

// Kopie van revalidateEvent in app/actions/speelminuten.ts, maar alleen de
// trainingspagina: een synchrone helper kan niet uit een 'use server'-bestand
// geëxporteerd worden.
function revalidateEvent(eventId: string) {
  revalidatePath(`/events/${eventId}`)
}

// Dezelfde tenant- en typecheck als assertOwnTrainingEvent (lib/authz.ts), met
// de datum en de doelstelling erbij: een evaluatie bestaat pas vanaf de
// trainingsdag (R8). Bewust dezelfde niet-onthullende melding als
// assertOwnTrainingEvent voor "bestaat niet / ander team / geen training".
async function eigenGehoudenTraining(
  supabase: Supabase,
  eventId: string,
  teamId: string,
): Promise<{ doelstelling: unknown }> {
  const { data } = await supabase
    .from('events')
    .select('id, type, date, doelstelling')
    .eq('id', eventId)
    .eq('team_id', teamId)
    .maybeSingle()
  const event = data as { id: string; type: string; date: unknown; doelstelling: unknown } | null
  if (!event || event.type !== 'training') throw new Error(EVENT_NIET_GEVONDEN)
  if (typeof event.date !== 'string' || event.date > todayLocal()) throw new Error(NIET_GEHOUDEN)
  return { doelstelling: event.doelstelling }
}

// Huidige waarde van één kolom voor deze training in dit team. `rij: false` =
// er is (voor dit team) geen rij.
async function leesKolom(
  supabase: Supabase,
  kolom: Kolom,
  eventId: string,
  teamId: string,
  context: string,
): Promise<{ rij: boolean; waarde: unknown }> {
  const { data, error } = await supabase
    .from('training_evaluaties')
    .select(`id, ${kolom}`)
    .eq('event_id', eventId)
    .eq('team_id', teamId)
    .maybeSingle()
  if (error) throw genericError(context, error)
  if (!data) return { rij: false, waarde: null }
  return { rij: true, waarde: (data as Record<string, unknown>)[kolom] ?? null }
}

async function slaKolomOp<K extends Kolom>(kolom: K, eventId: string, waarde: Waarde<K>, context: string): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'training')

  if (!isUuid(eventId) || !IS_GELDIG[kolom](waarde)) {
    throw new Error(kolom === 'rpe' ? ONGELDIGE_RPE : ONGELDIG_OORDEEL)
  }

  const event = await eigenGehoudenTraining(supabase, eventId, ctx.teamId)
  if (kolom === 'oordeel' && !heeftDoelstelling(event.doelstelling)) throw new Error(GEEN_DOELSTELLING)

  // Alleen de eigen kolom in de payload: ON CONFLICT DO UPDATE zet dan alleen
  // die kolom, de andere waarde blijft staan (R.9).
  const { error } = await supabase
    .from('training_evaluaties')
    .upsert({ team_id: ctx.teamId, event_id: eventId, [kolom]: waarde }, { onConflict: 'event_id' })

  if (error) throw genericError(context, error)
  revalidateEvent(eventId)
}

// Wissen: alleen deze kolom op null, conditioneel op de gelezen waarde, zodat
// een intussen opgeslagen nieuwere waarde nooit stil verdwijnt. Bewust GEEN
// trainings-, toekomst- of doelstellingscheck: opruimen moet altijd kunnen.
async function wisKolom<K extends Kolom>(
  kolom: K,
  eventId: string,
  context: string,
): Promise<{ teamId: string; waarde: Waarde<K> }> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'training')

  if (!isUuid(eventId)) throw new Error(NIET_GEVONDEN[kolom])

  const gelezen = await leesKolom(supabase, kolom, eventId, ctx.teamId, `${context}.lees`)
  if (!IS_GELDIG[kolom](gelezen.waarde)) throw new Error(NIET_GEVONDEN[kolom])
  const waarde = gelezen.waarde as Waarde<K>

  const { data, error } = await supabase
    .from('training_evaluaties')
    .update({ [kolom]: null })
    .eq('event_id', eventId)
    .eq('team_id', ctx.teamId)
    .eq(kolom as Kolom, waarde)
    .select('id')

  if (error) throw genericError(context, error)
  if (!Array.isArray(data) || data.length === 0) throw new Error(NIET_GEVONDEN[kolom])
  revalidateEvent(eventId)
  return { teamId: ctx.teamId, waarde }
}

// Conditionele update: alleen als de kolom (nog) leeg is. true = één rij gezet.
async function zetAlsLeeg(
  supabase: Supabase,
  kolom: Kolom,
  eventId: string,
  teamId: string,
  waarde: unknown,
  context: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('training_evaluaties')
    .update({ [kolom]: waarde })
    .eq('event_id', eventId)
    .eq('team_id', teamId)
    .is(kolom, null)
    .select('id')
  if (error) throw genericError(context, error)
  return Array.isArray(data) && data.length > 0
}

// "Ongedaan maken" van wissen. Opnieuw gevalideerd (vorm, team, eigen gehouden
// training, recht); `teamId` uit de snapshot alleen als weigercontrole,
// schrijven altijd met ctx.teamId. Overschrijft NOOIT: staat er intussen een
// waarde, dan wint die. Bewust GEEN doelstellingscheck bij het oordeel: wissen
// kan ook bij een inmiddels lege doelstelling (R5.1), en de undo daarvan moet
// dan ook werken (R8, AC-O.2). Alleen saveTrainingOordeel eist een doelstelling.
async function herstelKolom(
  kolom: Kolom,
  herstel: { soort?: unknown; teamId?: unknown; eventId?: unknown } | null | undefined,
  soort: 'training_rpe' | 'training_oordeel',
  waarde: unknown,
  context: string,
): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'training')

  if (!herstel || typeof herstel !== 'object' || herstel.soort !== soort) throw herstelNietMogelijk()
  if (herstel.teamId !== ctx.teamId) throw herstelNietMogelijk()
  if (!isUuid(herstel.eventId)) throw herstelNietMogelijk()
  if (!IS_GELDIG[kolom](waarde)) throw herstelNietMogelijk()
  const eventId = herstel.eventId

  try {
    await eigenGehoudenTraining(supabase, eventId, ctx.teamId)
  } catch {
    throw herstelNietMogelijk()
  }

  if (await zetAlsLeeg(supabase, kolom, eventId, ctx.teamId, waarde, context)) {
    revalidateEvent(eventId)
    return
  }

  // 0 rijen: er staat al een (nieuwere) waarde, of er is geen rij.
  const nu = await leesKolom(supabase, kolom, eventId, ctx.teamId, `${context}.lees`)
  if (nu.rij && nu.waarde !== null) {
    revalidateEvent(eventId)
    return
  }
  if (nu.rij) {
    // Rij met lege kolom (intussen gewist): nog één conditionele poging.
    if (!(await zetAlsLeeg(supabase, kolom, eventId, ctx.teamId, waarde, context))) throw herstelNietMogelijk()
    revalidateEvent(eventId)
    return
  }

  const { error } = await supabase
    .from('training_evaluaties')
    .insert({ team_id: ctx.teamId, event_id: eventId, [kolom]: waarde })

  if (error) {
    if (errorCode(error) !== '23505') throw genericError(context, error)
    // Iemand anders maakte intussen de rij aan: opnieuw kijken.
    const daarna = await leesKolom(supabase, kolom, eventId, ctx.teamId, `${context}.lees`)
    if (daarna.rij && daarna.waarde !== null) {
      revalidateEvent(eventId)
      return
    }
    if (!daarna.rij || !(await zetAlsLeeg(supabase, kolom, eventId, ctx.teamId, waarde, context))) {
      throw herstelNietMogelijk()
    }
  }
  revalidateEvent(eventId)
}

// RPE (geheel getal 1..10) van een gehouden training opslaan: nieuw of
// overschrijven (laatste wint). Laat het oordeel staan.
export async function saveTrainingRpe(eventId: string, rpe: number): Promise<void> {
  await slaKolomOp('rpe', eventId, rpe, 'trainingEvaluatie.saveTrainingRpe')
}

// RPE wissen; geeft de snapshot voor "Ongedaan maken" terug.
export async function wisTrainingRpe(eventId: string): Promise<HerstelTrainingRpe> {
  const { teamId, waarde } = await wisKolom('rpe', eventId, 'trainingEvaluatie.wisTrainingRpe')
  return { soort: 'training_rpe', teamId, eventId, rpe: waarde }
}

export async function herstelTrainingRpe(herstel: HerstelTrainingRpe): Promise<void> {
  await herstelKolom('rpe', herstel, 'training_rpe', herstel?.rpe, 'trainingEvaluatie.herstelTrainingRpe')
}

// Oordeel ja/deels/nee opslaan; alleen bij een niet-lege doelstelling (R5.2).
// Laat de RPE staan.
export async function saveTrainingOordeel(eventId: string, oordeel: TrainingOordeel): Promise<void> {
  await slaKolomOp('oordeel', eventId, oordeel, 'trainingEvaluatie.saveTrainingOordeel')
}

// Oordeel wissen; geeft de snapshot voor "Ongedaan maken" terug. Ook zonder
// (huidige) doelstelling: een eerder gegeven oordeel blijft wisbaar (R5.1).
export async function wisTrainingOordeel(eventId: string): Promise<HerstelTrainingOordeel> {
  const { teamId, waarde } = await wisKolom('oordeel', eventId, 'trainingEvaluatie.wisTrainingOordeel')
  return { soort: 'training_oordeel', teamId, eventId, oordeel: waarde }
}

export async function herstelTrainingOordeel(herstel: HerstelTrainingOordeel): Promise<void> {
  await herstelKolom('oordeel', herstel, 'training_oordeel', herstel?.oordeel, 'trainingEvaluatie.herstelTrainingOordeel')
}
