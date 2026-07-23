'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { Position, POSITIONS, AttendanceStatus } from '@/lib/types'
import { getDefaultAttendance } from '@/app/actions/settings'
import { todayLocal } from '@/lib/utils'

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

  return { name, position, jersey_number, rating, secondary_positions }
}

export async function createPlayer(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { name, position, jersey_number, secondary_positions } = validatePlayerInput(formData)

  const { error } = await supabase.from('players').insert({
    name,
    position,
    jersey_number,
    active: true,
    team_id: user.id,
    secondary_positions,
  })

  if (error) throw new Error(error.message)
  revalidatePath('/players')
}

export async function updatePlayer(id: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { name, position, jersey_number, rating, secondary_positions } = validatePlayerInput(formData)
  const active = formData.get('active') === 'true'

  const { error } = await supabase
    .from('players')
    .update({ name, position, jersey_number, active, rating, secondary_positions })
    .eq('id', id)
    .eq('team_id', user.id)

  if (error) throw new Error(error.message)
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

  if (error) throw new Error(error.message)
  revalidatePath('/players')
}

// Guard tegen callers die een id van een ander team meegeven: RLS houdt de data
// onzichtbaar, maar de UNIQUE(event_id, player_id)-constraint zou een forged
// insert alsnog de eigen writes van het bezittende team kunnen laten blokkeren.
// Spiegelt assertOwnPlayer uit app/actions/attendance.ts:16-19.
async function assertOwnPlayer(playerId: string, teamId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('players')
    .select('id')
    .eq('id', playerId)
    .eq('team_id', teamId)
    .maybeSingle()
  if (!data) throw new Error('Speler niet gevonden')
}

export async function markInjured(playerId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnPlayer(playerId, user.id)

  const today = todayLocal()

  // Toekomstige events (vandaag telt mee), geen metingen.
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id')
    .eq('team_id', user.id)
    .neq('type', 'meting')
    .gte('date', today)
  if (eventsError) throw new Error(eventsError.message)

  if (events && events.length > 0) {
    const eventIds = events.map((e) => e.id)

    // Bestaande attendance-status per toekomstig event voor deze speler.
    const { data: existing, error: existingError } = await supabase
      .from('attendance')
      .select('event_id, status')
      .eq('team_id', user.id)
      .eq('player_id', playerId)
      .in('event_id', eventIds)
    if (existingError) throw new Error(existingError.message)

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
      if (error) throw new Error(error.message)
    }
  }

  const { error: playerError } = await supabase
    .from('players')
    .update({ injured: true })
    .eq('id', playerId)
    .eq('team_id', user.id)
  if (playerError) throw new Error(playerError.message)

  revalidatePath('/players')
  revalidatePath('/')
}

export async function markRecovered(playerId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnPlayer(playerId, user.id)

  const today = todayLocal()

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id')
    .eq('team_id', user.id)
    .neq('type', 'meting')
    .gte('date', today)
  if (eventsError) throw new Error(eventsError.message)

  if (events && events.length > 0) {
    const futureEventIds = events.map((e) => e.id)
    const defaultStatus = await getDefaultAttendance()

    // a. Nog-afwezige, door-blessure-gezette TOEKOMSTIGE rijen terug naar default.
    //    Bewust future-only + status='absent': verleden-historie en handmatige
    //    afwezigheden blijven ongemoeid.
    const { error: restoreError } = await supabase
      .from('attendance')
      .update({ status: defaultStatus, injury_set: false })
      .eq('team_id', user.id)
      .eq('player_id', playerId)
      .eq('injury_set', true)
      .eq('status', 'absent')
      .in('event_id', futureEventIds)
    if (restoreError) throw new Error(restoreError.message)
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
  if (clearError) throw new Error(clearError.message)

  const { error: playerError } = await supabase
    .from('players')
    .update({ injured: false })
    .eq('id', playerId)
    .eq('team_id', user.id)
  if (playerError) throw new Error(playerError.message)

  revalidatePath('/players')
  revalidatePath('/')
}
