'use server'

// Speelminuten en wissels vastleggen op de wedstrijdanalyse (tabel
// `speelminuten`, supabase/inzichten-metrics-fase2b.sql). Eén rij per
// (wedstrijd, speler), geschreven met een upsert op die sleutel: dubbelklikken
// of twee trainers tegelijk geeft nooit een tweede rij, de laatste wint.
// Bewust een eigen bestand naast app/actions/match-analysis.ts en
// app/actions/tegendoelpunten.ts: zo blijven de bestaande vi.mock-factories in
// de componenttests volledig.
//
// Tenant-isolatie: `team_id` wordt ALTIJD met ctx.teamId geschreven en nooit
// van de client gelezen; elke lees- en schrijfquery filtert op team_id. RLS
// (onderdeel 'wedstrijd', plus "event is een wedstrijd van hetzelfde team" en
// "speler van hetzelfde team" in de insert- én update-policy) is de tweede
// laag.
//
// Tijd: `events.date` is een DATE en wordt als YYYY-MM-DD-string vergeleken met
// todayLocal(). Op een server met een UTC-klok is een wedstrijd van "vandaag"
// tussen 00:00 en ~02:00 Nederlandse tijd nog even "toekomst" — fail-safe: een
// toekomstige wedstrijd glipt er nooit door.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertOwnPlayer, isUuid } from '@/lib/authz'
import { isValidSpeelminuten, isValidWissels } from '@/lib/match-analysis.mjs'
import { errorCode, genericError } from '@/lib/errors'
import { herstelNietMogelijk, schoonCreatedAt, type HerstelSpeelminuten } from '@/lib/herstel'
import { assertCanEdit, requireTeamContext } from '@/lib/team-context'
import { todayLocal } from '@/lib/utils'

const ONGELDIG = 'Ongeldige speelminuten'
const EVENT_NIET_GEVONDEN = 'Event niet gevonden'
const NIET_GESPEELD = 'Wedstrijd nog niet gespeeld'
const NIET_GEVONDEN = 'Speelminuten niet gevonden'

// Kopie van revalidateEvent in app/actions/match-analysis.ts: een synchrone
// helper kan niet uit een 'use server'-bestand geëxporteerd worden.
function revalidateEvent(eventId: string) {
  revalidatePath(`/events/${eventId}/analysis`)
  revalidatePath(`/events/${eventId}`)
}

type Supabase = Awaited<ReturnType<typeof createClient>>

// Dezelfde tenant- en typecheck als assertOwnMatchEvent (lib/authz.ts), met de
// datum erbij: speelminuten bestaan pas vanaf de wedstrijddag (M5). Bewust
// dezelfde niet-onthullende melding als assertOwnMatchEvent voor "bestaat
// niet / ander team / geen wedstrijd".
async function eigenGespeeldeWedstrijd(supabase: Supabase, eventId: string, teamId: string): Promise<void> {
  const { data } = await supabase
    .from('events')
    .select('id, type, date')
    .eq('id', eventId)
    .eq('team_id', teamId)
    .maybeSingle()
  const event = data as { id: string; type: string; date: unknown } | null
  if (!event || event.type !== 'match') throw new Error(EVENT_NIET_GEVONDEN)
  if (typeof event.date !== 'string' || event.date > todayLocal()) throw new Error(NIET_GESPEELD)
}

// Staat er in dit team al een rij voor (wedstrijd, speler)? Voor het herstel:
// dat overschrijft nooit een intussen opgeslagen waarde.
async function speelminutenBestaat(supabase: Supabase, teamId: string, eventId: string, playerId: string): Promise<boolean> {
  const { data } = await supabase
    .from('speelminuten')
    .select('id')
    .eq('team_id', teamId)
    .eq('event_id', eventId)
    .eq('player_id', playerId)
    .maybeSingle()
  return !!data
}

// Minuten en wissels van één speler in één wedstrijd opslaan (nieuw of
// overschrijven). Beide waarden zijn verplicht; één statement, dus nooit een
// halve rij (AC-M.4).
export async function saveSpeelminuten(
  eventId: string,
  playerId: string,
  minuten: number,
  wissels: number,
): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'wedstrijd')

  if (!isUuid(eventId) || !isUuid(playerId)) throw new Error(ONGELDIG)
  if (!isValidSpeelminuten(minuten) || !isValidWissels(wissels)) throw new Error(ONGELDIG)

  await Promise.all([
    eigenGespeeldeWedstrijd(supabase, eventId, ctx.teamId),
    assertOwnPlayer(supabase, playerId, ctx.teamId),
  ])

  const { error } = await supabase
    .from('speelminuten')
    .upsert(
      { team_id: ctx.teamId, event_id: eventId, player_id: playerId, minuten, wissels },
      { onConflict: 'event_id,player_id' },
    )

  if (error) throw genericError('speelminuten.saveSpeelminuten', error)
  revalidateEvent(eventId)
}

// Speelminuten van één speler in één wedstrijd verwijderen. Leest de rij eerst
// (team-gescoped) zodat de herstel-snapshot voor "Ongedaan maken" teruggegeven
// kan worden. Bewust GEEN wedstrijd-, toekomst-, aanwezigheids- of
// active-check (O2): opruimen moet altijd kunnen, ook voor een speler die niet
// meer aanwezig of inactief is.
export async function deleteSpeelminuten(eventId: string, playerId: string): Promise<HerstelSpeelminuten> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'wedstrijd')

  if (!isUuid(eventId) || !isUuid(playerId)) throw new Error(NIET_GEVONDEN)

  const { data, error: leesFout } = await supabase
    .from('speelminuten')
    .select('id, event_id, player_id, minuten, wissels, created_at')
    .eq('event_id', eventId)
    .eq('player_id', playerId)
    .eq('team_id', ctx.teamId)
    .maybeSingle()
  if (leesFout) throw genericError('speelminuten.deleteSpeelminuten.lees', leesFout)
  if (!data) throw new Error(NIET_GEVONDEN)
  const rij = data as {
    id: string
    event_id: string
    player_id: string
    minuten: number
    wissels: number
    created_at: string | null
  }

  const { error } = await supabase
    .from('speelminuten')
    .delete()
    .eq('event_id', eventId)
    .eq('player_id', playerId)
    .eq('team_id', ctx.teamId)

  if (error) throw genericError('speelminuten.deleteSpeelminuten', error)
  revalidateEvent(eventId)

  return {
    soort: 'speelminuten',
    teamId: ctx.teamId,
    id: rij.id,
    eventId: rij.event_id,
    playerId: rij.player_id,
    minuten: rij.minuten,
    wissels: rij.wissels,
    createdAt: rij.created_at ?? null,
  }
}

// "Ongedaan maken" van deleteSpeelminuten: zet de rij terug met dezelfde id en
// created_at. Volledig opnieuw gevalideerd zoals saveSpeelminuten (inclusief
// de toekomstcheck); `herstel.teamId` alleen als weigercontrole, schrijven
// altijd met ctx.teamId. Geen aanwezigheids- of active-check (O2).
// Overschrijft NOOIT: staat er intussen een rij voor (wedstrijd, speler), dan
// is dit een no-op en wint die rij.
export async function herstelSpeelminuten(herstel: HerstelSpeelminuten): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'wedstrijd')

  if (!herstel || typeof herstel !== 'object' || herstel.soort !== 'speelminuten') throw herstelNietMogelijk()
  if (herstel.teamId !== ctx.teamId) throw herstelNietMogelijk()
  if (!isUuid(herstel.id) || !isUuid(herstel.eventId) || !isUuid(herstel.playerId)) throw herstelNietMogelijk()
  if (!isValidSpeelminuten(herstel.minuten) || !isValidWissels(herstel.wissels)) throw herstelNietMogelijk()
  const createdAt = schoonCreatedAt(herstel.createdAt)
  if (createdAt === undefined) throw herstelNietMogelijk()

  try {
    await Promise.all([
      eigenGespeeldeWedstrijd(supabase, herstel.eventId, ctx.teamId),
      assertOwnPlayer(supabase, herstel.playerId, ctx.teamId),
    ])
  } catch {
    throw herstelNietMogelijk()
  }

  if (await speelminutenBestaat(supabase, ctx.teamId, herstel.eventId, herstel.playerId)) {
    revalidateEvent(herstel.eventId)
    return
  }

  const { error } = await supabase.from('speelminuten').insert({
    id: herstel.id,
    team_id: ctx.teamId,
    event_id: herstel.eventId,
    player_id: herstel.playerId,
    minuten: herstel.minuten,
    wissels: herstel.wissels,
    ...(createdAt ? { created_at: createdAt } : {}),
  })

  if (error) {
    if (errorCode(error) === '23505') {
      if (await speelminutenBestaat(supabase, ctx.teamId, herstel.eventId, herstel.playerId)) {
        revalidateEvent(herstel.eventId)
        return
      }
      throw herstelNietMogelijk()
    }
    throw genericError('speelminuten.herstelSpeelminuten', error)
  }

  revalidateEvent(herstel.eventId)
}
