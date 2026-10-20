'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { Position, POSITIONS, PlayerType, PLAYER_TYPES, AttendanceStatus } from '@/lib/types'
import { getDefaultAttendance } from '@/app/actions/settings'
import { todayLocal } from '@/lib/utils'
import { genericError } from '@/lib/errors'
import { assertOwnPlayer } from '@/lib/authz'
import { assertCanEdit, requireTeamContext } from '@/lib/team-context'
import { resolveAttendanceStatus } from '@/lib/attendance-rows'

function validatePlayerInput(formData: FormData) {
  const name = (formData.get('name') as string | null)?.trim() ?? ''
  if (!name || name.length > 100) throw new Error('Ongeldige naam')

  const position = formData.get('position') as Position
  if (!POSITIONS.includes(position)) throw new Error('Ongeldige positie')

  const jerseyRaw = formData.get('jersey_number')
  const jersey_number = jerseyRaw ? Number(jerseyRaw) : null
  if (jersey_number !== null && (isNaN(jersey_number) || jersey_number < 1 || jersey_number > 99)) {
    throw new Error('Rugnummer moet tussen 1 en 99 liggen')
  }

  const ratingRaw = formData.get('rating')
  const rating = ratingRaw ? Number(ratingRaw) : null
  if (rating !== null && (isNaN(rating) || rating < 1 || rating > 10)) {
    throw new Error('Beoordeling moet tussen 1 en 10 liggen')
  }

  const secondary_positions = (formData.getAll('secondary_positions') as Position[])
    .filter((p) => POSITIONS.includes(p))

  // Ontbrekend of leeg veld betekent "gewone speler": het formulier van vóór
  // deze feature stuurt het veld niet mee. Een waarde buiten de whitelist is
  // wél een fout — zelfde gesloten-lijst-aanpak als `position`, spiegelt de
  // CHECK-constraint players_type_check.
  const typeRaw = formData.get('type')
  const type: PlayerType =
    typeRaw === null || typeRaw === '' ? 'regular' : (typeRaw as PlayerType)
  if (!PLAYER_TYPES.includes(type)) throw new Error('Ongeldig spelertype')

  return { name, position, jersey_number, rating, secondary_positions, type }
}

export async function createPlayer(formData: FormData) {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'spelers')

  const { name, position, jersey_number, rating, secondary_positions, type } = validatePlayerInput(formData)

  const { error } = await supabase.from('players').insert({
    name,
    position,
    jersey_number,
    // Beoordeling kan al bij het aanmaken mee; leeg blijft null.
    rating,
    active: true,
    team_id: ctx.teamId,
    secondary_positions,
    // Een gast is gewoon actief; `type` staat los van `active`.
    type,
  })

  if (error) throw genericError('players.createPlayer', error)
  revalidatePath('/players')
}

export async function updatePlayer(id: string, formData: FormData) {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'spelers')

  const { name, position, jersey_number, rating, secondary_positions, type } = validatePlayerInput(formData)
  const active = formData.get('active') === 'true'

  const { error } = await supabase
    .from('players')
    .update({ name, position, jersey_number, active, rating, secondary_positions, type })
    .eq('id', id)
    .eq('team_id', ctx.teamId)

  if (error) throw genericError('players.updatePlayer', error)
  revalidatePath('/players')
  revalidatePath(`/players/${id}/edit`)
}

export async function deletePlayer(id: string) {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'spelers')

  const { error } = await supabase
    .from('players')
    .delete()
    .eq('id', id)
    .eq('team_id', ctx.teamId)

  if (error) throw genericError('players.deletePlayer', error)
  revalidatePath('/players')
}

// Eén onderdeel, niet twee: blessure melden is spelerswerk. Dat er
// attendance-rijen uit volgen is een gevolg van die handeling, geen tweede
// handeling — de attendance-policy is daarom verruimd met
// can_edit(team,'spelers') voor INSERT en UPDATE (zie
// supabase/team-rls-gevolgacties.sql). Zelfde verhaal voor markRecovered.
export async function markInjured(playerId: string): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'spelers')

  await assertOwnPlayer(supabase, playerId, ctx.teamId)

  const today = todayLocal()

  // Toekomstige events (vandaag telt mee), geen metingen.
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id')
    .eq('team_id', ctx.teamId)
    .neq('type', 'meting')
    .gte('date', today)
  if (eventsError) throw genericError('players.markInjured.events', eventsError)

  if (events && events.length > 0) {
    // ALLE toekomstige events op 'injured', ook rijen die al 'absent' waren
    // (handmatig of door een afmeldperiode): blessure wint (besluit 11, V2).
    // Bewust géén absence_period_id in de payload: een upsert werkt alleen de
    // meegegeven kolommen bij, dus een bestaande periode-herkomst blijft staan
    // en markRecovered kan de rij daarna terugzetten op 'absent'.
    const records = events.map((e) => ({
      event_id: e.id,
      player_id: playerId,
      team_id: ctx.teamId,
      status: 'injured' as AttendanceStatus,
    }))

    const { error } = await supabase
      .from('attendance')
      .upsert(records, { onConflict: 'event_id,player_id' })
    if (error) throw genericError('players.markInjured.upsert', error)
  }

  const { error: playerError } = await supabase
    .from('players')
    .update({ injured: true })
    .eq('id', playerId)
    .eq('team_id', ctx.teamId)
  if (playerError) throw genericError('players.markInjured.player', playerError)

  revalidatePath('/players')
  revalidatePath('/')
  // Het spelersprofiel rendert de beschikbaarheidspil server-side; zonder deze
  // regel blijft die op de oude stand staan na een blessuremelding. Literaal
  // pad en bewust geen 'page'-argument: dat invalideert elk profiel in een keer
  // terwijl er precies een speler wijzigt (Next-docs revalidatePath.md).
  revalidatePath(`/players/${playerId}`)
}

export async function markRecovered(playerId: string): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'spelers')

  await assertOwnPlayer(supabase, playerId, ctx.teamId)

  const today = todayLocal()

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id')
    .eq('team_id', ctx.teamId)
    .neq('type', 'meting')
    .gte('date', today)
  if (eventsError) throw genericError('players.markRecovered.events', eventsError)

  if (events && events.length > 0) {
    const futureEventIds = events.map((e) => e.id)
    const defaultStatus = await getDefaultAttendance()

    // Een gastspeler hoort ook na herstel afwezig te blijven: hij staat alleen
    // op 'present' als de trainer hem daar handmatig op zet. Zelfde regel als
    // bij het aanmaken van een rij, hergebruikt uit lib/attendance-rows.ts.
    // Hard falen bij een fout: stil doorgaan zou de gast alsnog op de
    // teamstandaard zetten.
    const { data: player, error: playerTypeError } = await supabase
      .from('players')
      .select('type')
      .eq('id', playerId)
      .eq('team_id', ctx.teamId)
      .maybeSingle()
    if (playerTypeError) throw genericError('players.markRecovered.type', playerTypeError)
    const restoreStatus = resolveAttendanceStatus({
      defaultStatus,
      isGuest: player?.type === 'guest',
    })

    // a. TOEKOMSTIGE 'injured'-rijen zonder afmeldperiode terug naar de
    //    standaard (of 'absent' voor een gast). Bewust future-only:
    //    verleden-'injured' blijft staan als historie (AC16).
    const { error: restoreError } = await supabase
      .from('attendance')
      .update({ status: restoreStatus })
      .eq('team_id', ctx.teamId)
      .eq('player_id', playerId)
      .eq('status', 'injured')
      .is('absence_period_id', null)
      .in('event_id', futureEventIds)
    if (restoreError) throw genericError('players.markRecovered.restore', restoreError)

    // b. TOEKOMSTIGE 'injured'-rijen MET afmeldperiode naar 'absent': die
    //    periode dekt de datum nog, dus de speler is na herstel gewoon
    //    afgemeld. Hersteld zijn is geen reden om een afmelding op te heffen —
    //    die wordt via revokeAbsencePeriod ingetrokken.
    const { error: periodRestoreError } = await supabase
      .from('attendance')
      .update({ status: 'absent' })
      .eq('team_id', ctx.teamId)
      .eq('player_id', playerId)
      .eq('status', 'injured')
      .not('absence_period_id', 'is', null)
      .in('event_id', futureEventIds)
    if (periodRestoreError) throw genericError('players.markRecovered.period', periodRestoreError)
  }

  const { error: playerError } = await supabase
    .from('players')
    .update({ injured: false })
    .eq('id', playerId)
    .eq('team_id', ctx.teamId)
  if (playerError) throw genericError('players.markRecovered.player', playerError)

  revalidatePath('/players')
  revalidatePath('/')
  // Spiegel van markInjured: ook het profiel van deze ene speler moet de
  // nieuwe status tonen.
  revalidatePath(`/players/${playerId}`)
}
