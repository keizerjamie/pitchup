'use server'

// Tegendoelpunten vastleggen op de wedstrijdanalyse (tabel `tegendoelpunten`,
// supabase/inzichten-metrics.sql). Bewust een eigen bestand naast
// app/actions/match-analysis.ts: zo blijft de bestaande vi.mock-factory van
// '@/app/actions/match-analysis' in de componenttests volledig.
//
// Tenant-isolatie: `team_id` wordt ALTIJD met ctx.teamId geschreven en nooit
// van de client gelezen; elke lees- en schrijfquery filtert op team_id. RLS
// (onderdeel 'wedstrijd', plus "event is een wedstrijd van hetzelfde team" in
// de insert-policy) is de tweede laag.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertOwnMatchEvent, isUuid } from '@/lib/authz'
import type { TegendoelpuntSoort } from '@/lib/types'
import { isValidMinute, isValidTegendoelpuntSoort } from '@/lib/match-analysis.mjs'
import { errorCode, genericError } from '@/lib/errors'
import { herstelNietMogelijk, schoonCreatedAt, type HerstelTegendoelpunt } from '@/lib/herstel'
import { assertCanEdit, requireTeamContext } from '@/lib/team-context'

const ONGELDIG = 'Ongeldig tegendoelpunt'
const NIET_GEVONDEN = 'Tegendoelpunt niet gevonden'

// Kopie van revalidateEvent in app/actions/match-analysis.ts: een synchrone
// helper kan niet uit een 'use server'-bestand geëxporteerd worden.
function revalidateEvent(eventId: string) {
  revalidatePath(`/events/${eventId}/analysis`)
  revalidatePath(`/events/${eventId}`)
}

type Supabase = Awaited<ReturnType<typeof createClient>>

// Bestaat deze rij al in dit team, op dit event? Voor de idempotente insert:
// bij 23505 op de door de client gekozen id is het een no-op als het onze
// eigen rij is, en een fout als de id elders bezet is.
async function tegendoelpuntBestaat(supabase: Supabase, id: string, teamId: string, eventId: string): Promise<boolean> {
  const { data } = await supabase
    .from('tegendoelpunten')
    .select('id')
    .eq('id', id)
    .eq('team_id', teamId)
    .eq('event_id', eventId)
    .maybeSingle()
  return !!data
}

// Eén tegendoelpunt toevoegen. `id` kiest de client (crypto.randomUUID) en
// houdt hij gelijk bij een retry met ongewijzigde invoer: een tweede aanroep
// met dezelfde id levert dan geen dubbel tegendoelpunt op (AC-6.7).
export async function addTegendoelpunt(
  id: string,
  eventId: string,
  soort: TegendoelpuntSoort,
  minute: number | null,
): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'wedstrijd')

  if (!isUuid(id) || !isUuid(eventId)) throw new Error(ONGELDIG)
  if (!isValidTegendoelpuntSoort(soort)) throw new Error(ONGELDIG)
  if (!isValidMinute(minute)) throw new Error(ONGELDIG)

  await assertOwnMatchEvent(supabase, eventId, ctx.teamId)

  const { error } = await supabase
    .from('tegendoelpunten')
    .insert({ id, team_id: ctx.teamId, event_id: eventId, soort, minute })

  if (error) {
    if (errorCode(error) === '23505' && (await tegendoelpuntBestaat(supabase, id, ctx.teamId, eventId))) {
      revalidateEvent(eventId)
      return
    }
    throw genericError('tegendoelpunten.addTegendoelpunt', error)
  }
  revalidateEvent(eventId)
}

// Tegendoelpunt verwijderen. Leest de rij eerst (team-gescoped) zodat de
// herstel-snapshot voor "Ongedaan maken" teruggegeven kan worden, en
// revalideert met het event uit de rij zelf.
export async function deleteTegendoelpunt(id: string): Promise<HerstelTegendoelpunt> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'wedstrijd')

  if (!isUuid(id)) throw new Error(NIET_GEVONDEN)

  const { data, error: leesFout } = await supabase
    .from('tegendoelpunten')
    .select('id, event_id, soort, minute, created_at')
    .eq('id', id)
    .eq('team_id', ctx.teamId)
    .maybeSingle()
  if (leesFout) throw genericError('tegendoelpunten.deleteTegendoelpunt.lees', leesFout)
  if (!data) throw new Error(NIET_GEVONDEN)
  const rij = data as {
    id: string
    event_id: string
    soort: TegendoelpuntSoort
    minute: number | null
    created_at: string | null
  }

  const { error } = await supabase
    .from('tegendoelpunten')
    .delete()
    .eq('id', id)
    .eq('team_id', ctx.teamId)

  if (error) throw genericError('tegendoelpunten.deleteTegendoelpunt', error)
  revalidateEvent(rij.event_id)

  return {
    soort: 'tegendoelpunt',
    teamId: ctx.teamId,
    id: rij.id,
    eventId: rij.event_id,
    doelpuntSoort: rij.soort,
    minute: rij.minute ?? null,
    createdAt: rij.created_at ?? null,
  }
}

// "Ongedaan maken" van deleteTegendoelpunt: zet de rij terug met dezelfde id
// en created_at. Volledig opnieuw gevalideerd zoals addTegendoelpunt;
// `herstel.teamId` alleen als weigercontrole, schrijven altijd met
// ctx.teamId. Idempotent (bestaande rij of 23505 op de eigen rij = succes).
export async function herstelTegendoelpunt(herstel: HerstelTegendoelpunt): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'wedstrijd')

  if (!herstel || typeof herstel !== 'object' || herstel.soort !== 'tegendoelpunt') throw herstelNietMogelijk()
  if (herstel.teamId !== ctx.teamId) throw herstelNietMogelijk()
  if (!isUuid(herstel.id) || !isUuid(herstel.eventId)) throw herstelNietMogelijk()
  if (!isValidTegendoelpuntSoort(herstel.doelpuntSoort)) throw herstelNietMogelijk()
  if (!isValidMinute(herstel.minute)) throw herstelNietMogelijk()
  const createdAt = schoonCreatedAt(herstel.createdAt)
  if (createdAt === undefined) throw herstelNietMogelijk()

  try {
    await assertOwnMatchEvent(supabase, herstel.eventId, ctx.teamId)
  } catch {
    throw herstelNietMogelijk()
  }

  if (await tegendoelpuntBestaat(supabase, herstel.id, ctx.teamId, herstel.eventId)) {
    revalidateEvent(herstel.eventId)
    return
  }

  const { error } = await supabase.from('tegendoelpunten').insert({
    id: herstel.id,
    team_id: ctx.teamId,
    event_id: herstel.eventId,
    soort: herstel.doelpuntSoort,
    minute: herstel.minute,
    ...(createdAt ? { created_at: createdAt } : {}),
  })

  if (error) {
    if (errorCode(error) === '23505') {
      if (await tegendoelpuntBestaat(supabase, herstel.id, ctx.teamId, herstel.eventId)) {
        revalidateEvent(herstel.eventId)
        return
      }
      throw herstelNietMogelijk()
    }
    throw genericError('tegendoelpunten.herstelTegendoelpunt', error)
  }

  revalidateEvent(herstel.eventId)
}
