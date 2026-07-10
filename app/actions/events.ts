'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EventType, MatchType, HomeAway } from '@/lib/types'
import { getDefaultAttendance } from '@/app/actions/settings'

// 'meting' events worden alleen nog via saveNulmeting (periodisering) aangemaakt
const VALID_EVENT_TYPES: EventType[] = ['training', 'match']
const VALID_MATCH_TYPES: MatchType[] = ['friendly', 'league', 'cup']
const VALID_HOME_AWAY: HomeAway[] = ['home', 'away']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

export async function createEvent(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const type = formData.get('type') as EventType
  if (!VALID_EVENT_TYPES.includes(type)) throw new Error('Ongeldig event type')

  const date = formData.get('date') as string
  if (!date || !DATE_RE.test(date)) throw new Error('Ongeldige datum')

  const timeRaw = (formData.get('time') as string) || null
  if (timeRaw && !TIME_RE.test(timeRaw)) throw new Error('Ongeldig tijdstip')

  const location = ((formData.get('location') as string) || null)?.slice(0, 200) ?? null
  const notes = ((formData.get('notes') as string) || null)?.slice(0, 2000) ?? null

  const payload: Record<string, unknown> = { type, date, time: timeRaw, location, notes, team_id: user.id }

  if (type === 'match') {
    const match_type = formData.get('match_type') as MatchType
    if (!VALID_MATCH_TYPES.includes(match_type)) throw new Error('Ongeldig wedstrijdtype')
    const home_away = formData.get('home_away') as HomeAway
    if (!VALID_HOME_AWAY.includes(home_away)) throw new Error('Ongeldig thuis/uit')
    const opponent = ((formData.get('opponent') as string) || '').slice(0, 100)
    payload.match_type = match_type
    payload.opponent = opponent
    payload.home_away = home_away
  }

  const { data, error } = await supabase
    .from('events')
    .insert(payload)
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  // Meting events have no attendance records
  if (type !== 'meting') {
    const [{ data: players }, defaultStatus] = await Promise.all([
      supabase.from('players').select('id').eq('active', true).eq('team_id', user.id),
      getDefaultAttendance().catch(() => 'present' as const),
    ])

    if (players && players.length > 0) {
      await supabase.from('attendance').insert(
        players.map((p) => ({
          event_id: data.id,
          player_id: p.id,
          status: defaultStatus,
          team_id: user.id,
        }))
      )
    }
  }

  revalidatePath('/events')
  revalidatePath('/')
  redirect(`/events/${data.id}`)
}

export async function deleteEvent(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', id)
    .eq('team_id', user.id)

  if (error) throw new Error(error.message)
  revalidatePath('/events')
  revalidatePath('/')
}
