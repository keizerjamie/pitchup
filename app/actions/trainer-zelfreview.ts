'use server'

// Privé zelfreview van de ingelogde trainer over één gehouden training (tabel
// `trainer_zelfreviews`, supabase/trainer-zelfreview.sql). Eén rij per trainer
// per training; opnieuw opslaan overschrijft de eigen rij (upsert op
// event_id,user_id). Bewust een eigen bestand, los van
// app/actions/training-evaluatie.ts: de zelfreview raakt training_evaluaties
// (RPE/oordeel van het team) nooit (AC9), en zo blijven de bestaande
// vi.mock-factories van andere action-bestanden volledig.
//
// Tenant-isolatie en privacy: `team_id` en `user_id` worden ALTIJD uit de
// context geschreven (ctx.teamId, ctx.userId) en nooit van de client gelezen.
// RLS is de tweede laag: lezen alleen de eigen rij, schrijven alleen de eigen
// rij met recht 'training' op een training van hetzelfde team die (in
// Nederlandse tijd) niet in de toekomst ligt.
//
// Tijd: `events.date` is een DATE en wordt als YYYY-MM-DD-string vergeleken met
// todayLocal() (serverklok, zie C20). Op een server met een UTC-klok is een
// training van "vandaag" tussen 00:00 en ~02:00 Nederlandse tijd nog even
// "toekomst" — fail-safe en gelijk aan of strenger dan de datumcheck in RLS.
// updated_at wordt als UTC-ISO-string (timestamptz) gezet.
//
// Er is bewust GEEN lees-action: de trainingspagina leest de eigen review zelf.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/authz'
import { genericError } from '@/lib/errors'
import { assertCanEdit, requireTeamContext } from '@/lib/team-context'
import { kolomVoor, valideerZelfreview, ZELFREVIEW_STELLINGEN, type ZelfreviewStelling } from '@/lib/trainer-zelfreview'
import { todayLocal } from '@/lib/utils'

const ONGELDIGE_ZELFREVIEW = 'Ongeldige zelfreview'
const EVENT_NIET_GEVONDEN = 'Event niet gevonden'
const NIET_GEHOUDEN = 'Training nog niet gehouden'

type Supabase = Awaited<ReturnType<typeof createClient>>

// Lokale kopie van eigenGehoudenTraining (app/actions/training-evaluatie.ts),
// zonder de doelstelling: een synchrone/gedeelde helper kan niet uit een
// 'use server'-bestand geëxporteerd worden. Bewust dezelfde niet-onthullende
// melding voor "bestaat niet / ander team / geen training".
async function eigenGehoudenTraining(supabase: Supabase, eventId: string, teamId: string): Promise<void> {
  const { data } = await supabase
    .from('events')
    .select('id, type, date')
    .eq('id', eventId)
    .eq('team_id', teamId)
    .maybeSingle()
  const event = data as { id: string; type: string; date: unknown } | null
  if (!event || event.type !== 'training') throw new Error(EVENT_NIET_GEVONDEN)
  if (typeof event.date !== 'string' || event.date > todayLocal()) throw new Error(NIET_GEHOUDEN)
}

// Zelfreview van een gehouden training opslaan: nieuw of overschrijven (de
// eigen rij). Alle vijf scores verplicht (geheel getal 1..5); meeneem
// optioneel (getrimd, '' → null, max 1000 tekens).
export async function saveTrainerZelfreview(
  eventId: string,
  invoer: { scores: Record<ZelfreviewStelling, number>; meeneem: string | null },
): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'training')

  if (!isUuid(eventId)) throw new Error(ONGELDIGE_ZELFREVIEW)
  const waarden = valideerZelfreview(invoer)
  if (!waarden) throw new Error(ONGELDIGE_ZELFREVIEW)

  await eigenGehoudenTraining(supabase, eventId, ctx.teamId)

  const payload: Record<string, unknown> = {
    team_id: ctx.teamId,
    user_id: ctx.userId,
    event_id: eventId,
  }
  for (const stelling of ZELFREVIEW_STELLINGEN) payload[kolomVoor(stelling)] = waarden.scores[stelling]
  payload.meeneem = waarden.meeneem
  payload.updated_at = new Date().toISOString()

  const { error } = await supabase
    .from('trainer_zelfreviews')
    .upsert(payload, { onConflict: 'event_id,user_id' })

  if (error) throw genericError('trainerZelfreview.save', error)
  revalidatePath(`/events/${eventId}`)
  revalidatePath('/')
}
