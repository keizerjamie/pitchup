'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { Position, POSITIONS } from '@/lib/types'

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
