'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { Position, POSITIONS, PlayerType, PLAYER_TYPES, AttendanceStatus } from '@/lib/types'
import { getDefaultAttendance } from '@/app/actions/settings'
import { todayLocal } from '@/lib/utils'
import { genericError } from '@/lib/errors'
import { assertOwnPlayer } from '@/lib/authz'
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { name, position, jersey_number, secondary_positions, type } = validatePlayerInput(formData)

  const { error } = await supabase.from('players').insert({
    name,
    position,
    jersey_number,
    active: true,
    team_id: user.id,
    secondary_positions,
    // Een gast is gewoon actief; `type` staat los van `active`.
    type,
  })

  if (error) throw genericError('players.createPlayer', error)
  revalidatePath('/players')
}

export async function updatePlayer(id: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { name, position, jersey_number, rating, secondary_positions, type } = validatePlayerInput(formData)
  const active = formData.get('active') === 'true'

  const { error } = await supabase
    .from('players')
    .update({ name, position, jersey_number, active, rating, secondary_positions, type })
    .eq('id', id)
    .eq('team_id', user.id)

  if (error) throw genericError('players.updatePlayer', error)
  revalidatePath('/players')
  revalidatePath(`/players/${id}/edit`)
}

export async function deletePlayer(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { error } = await supabase
    .from('players')
    .delete()
    .eq('id', id)
    .eq('team_id', user.id)

  if (error) throw genericError('players.deletePlayer', error)
  revalidatePath('/players')
}

export async function markInjured(playerId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnPlayer(supabase, playerId, user.id)

  const today = todayLocal()

  // Toekomstige events (vandaag telt mee), geen metingen.
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id')
    .eq('team_id', user.id)
    .neq('type', 'meting')
    .gte('date', today)
  if (eventsError) throw genericError('players.markInjured.events', eventsError)

  if (events && events.length > 0) {
    const eventIds = events.map((e) => e.id)

    // Bestaande attendance-status per toekomstig event voor deze speler.
    const { data: existing, error: existingError } = await supabase
      .from('attendance')
      .select('event_id, status')
      .eq('team_id', user.id)
      .eq('player_id', playerId)
      .in('event_id', eventIds)
    if (existingError) throw genericError('players.markInjured.attendance', existingError)

    const statusByEvent = new Map<string, AttendanceStatus>()
    for (const row of existing ?? []) statusByEvent.set(row.event_id, row.status as AttendanceStatus)

    // Alleen events waar de huidige status NIET 'absent' is (geen rij, present of unknown).
    const records = eventIds
      .filter((id) => statusByEvent.get(id) !== 'absent')
      .map((id) => ({
        event_id: id,
        player_id: playerId,
        team_id: user.id,
        status: 'absent' as AttendanceStatus,
        injury_set: true,
      }))

    if (records.length > 0) {
      const { error } = await supabase
        .from('attendance')
        .upsert(records, { onConflict: 'event_id,player_id' })
      if (error) throw genericError('players.markInjured.upsert', error)
    }
  }

  const { error: playerError } = await supabase
    .from('players')
    .update({ injured: true })
    .eq('id', playerId)
    .eq('team_id', user.id)
  if (playerError) throw genericError('players.markInjured.player', playerError)

  revalidatePath('/players')
  revalidatePath('/')
}

export async function markRecovered(playerId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnPlayer(supabase, playerId, user.id)

  const today = todayLocal()

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id')
    .eq('team_id', user.id)
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
      .eq('team_id', user.id)
      .maybeSingle()
    if (playerTypeError) throw genericError('players.markRecovered.type', playerTypeError)
    const restoreStatus = resolveAttendanceStatus({
      defaultStatus,
      isGuest: player?.type === 'guest',
    })

    // a. Nog-afwezige, door-blessure-gezette TOEKOMSTIGE rijen terug naar default.
    //    Bewust future-only + status='absent': verleden-historie en handmatige
    //    afwezigheden blijven ongemoeid. Ook rijen die aan een lopende
    //    afmeldperiode hangen blijven staan (.is('absence_period_id', null)):
    //    hersteld van een blessure zijn is geen reden om een afmelding op te
    //    heffen — die wordt via revokeAbsencePeriod ingetrokken.
    const { error: restoreError } = await supabase
      .from('attendance')
      .update({ status: restoreStatus, injury_set: false })
      .eq('team_id', user.id)
      .eq('player_id', playerId)
      .eq('injury_set', true)
      .eq('status', 'absent')
      .is('absence_period_id', null)
      .in('event_id', futureEventIds)
    if (restoreError) throw genericError('players.markRecovered.restore', restoreError)
  }

  // b. ALLE resterende injury_set-markeringen van de speler opschonen zonder de
  //    status te wijzigen — ook op inmiddels-verleden events die anders verweesd
  //    achterblijven. Status blijft ongemoeid, dus 'absent'-historie blijft staan.
  const { error: clearError } = await supabase
    .from('attendance')
    .update({ injury_set: false })
    .eq('team_id', user.id)
    .eq('player_id', playerId)
    .eq('injury_set', true)
  if (clearError) throw genericError('players.markRecovered.clear', clearError)

  const { error: playerError } = await supabase
    .from('players')
    .update({ injured: false })
    .eq('id', playerId)
    .eq('team_id', user.id)
  if (playerError) throw genericError('players.markRecovered.player', playerError)

  revalidatePath('/players')
  revalidatePath('/')
}
