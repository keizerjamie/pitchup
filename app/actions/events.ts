'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EventType, MatchType, HomeAway } from '@/lib/types'
import { getDefaultAttendance } from '@/app/actions/settings'
import { assertOwnMatchEvent } from '@/lib/authz'
import { genericError } from '@/lib/errors'
import { isTimeString } from '@/lib/utils'
import { periodIdByPlayerForDate } from '@/lib/absence-periods'

// 'meting' events worden alleen nog via saveNulmeting (periodisering) aangemaakt
const VALID_EVENT_TYPES: EventType[] = ['training', 'match']
const VALID_MATCH_TYPES: MatchType[] = ['friendly', 'league', 'cup']
const VALID_HOME_AWAY: HomeAway[] = ['home', 'away']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function createEvent(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const type = formData.get('type') as EventType
  if (!VALID_EVENT_TYPES.includes(type)) throw new Error('Ongeldig event type')

  const date = formData.get('date') as string
  if (!date || !DATE_RE.test(date)) throw new Error('Ongeldige datum')

  const timeRaw = (formData.get('time') as string) || null
  if (timeRaw && !isTimeString(timeRaw)) throw new Error('Ongeldig tijdstip')

  const location = ((formData.get('location') as string) || null)?.slice(0, 200) ?? null
  const notes = ((formData.get('notes') as string) || null)?.slice(0, 2000) ?? null

  const payload: Record<string, unknown> = { type, date, time: timeRaw, location, notes, team_id: user.id }

  if (type === 'match') {
    const match_type = formData.get('match_type') as MatchType
    if (!VALID_MATCH_TYPES.includes(match_type)) throw new Error('Ongeldig wedstrijdtype')
    const home_away = formData.get('home_away') as HomeAway
    if (!VALID_HOME_AWAY.includes(home_away)) throw new Error('Ongeldig thuis/uit')
    const opponent = ((formData.get('opponent') as string) || '').slice(0, 100)
    // Verzameltijd hoort alleen bij een wedstrijd; een training krijgt de kolom
    // daarom nooit mee, ook niet als het veld toch wordt meegestuurd.
    const gatherTimeRaw = (formData.get('gather_time') as string) || null
    if (gatherTimeRaw && !isTimeString(gatherTimeRaw)) throw new Error('Ongeldig tijdstip')
    payload.match_type = match_type
    payload.opponent = opponent
    payload.home_away = home_away
    payload.gather_time = gatherTimeRaw
  }

  const { data, error } = await supabase
    .from('events')
    .insert(payload)
    .select('id')
    .single()

  if (error) throw genericError('events.createEvent', error)

  // Meting events have no attendance records
  if (type !== 'meting') {
    const [{ data: players }, defaultStatus, { data: periods, error: periodsError }] = await Promise.all([
      supabase.from('players').select('id').eq('active', true).eq('team_id', user.id),
      getDefaultAttendance().catch(() => 'present' as const),
      // Lopende afmeldperiodes die déze datum dekken (grenzen inclusief):
      // from_date <= date <= to_date. Vaste sortering zodat de herkomst bij
      // overlappende periodes deterministisch is.
      supabase
        .from('absence_periods')
        .select('id, player_id, from_date, to_date')
        .eq('team_id', user.id)
        .lte('from_date', date)
        .gte('to_date', date)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
    ])

    // Bewust hard falen: stil doorgaan zou het event met standaard-aanwezigheid
    // opleveren, terwijl de trainer de speler al had afgemeld.
    if (periodsError) throw genericError('events.createEvent.periods', periodsError)

    if (players && players.length > 0) {
      const periodByPlayer = periodIdByPlayerForDate(periods ?? [], date)
      await supabase.from('attendance').insert(
        // Elke rij krijgt dezelfde sleutels — PostgREST weigert een bulk-insert
        // met afwijkende kolommen, dus absence_period_id gaat altijd mee.
        players.map((p) => {
          const periodId = periodByPlayer.get(p.id) ?? null
          return {
            event_id: data.id,
            player_id: p.id,
            status: periodId ? 'absent' : defaultStatus,
            team_id: user.id,
            absence_period_id: periodId,
          }
        })
      )
    }
  }

  revalidatePath('/events')
  revalidatePath('/')
  redirect(`/events/${data.id}`)
}

// Zet of wist de verzameltijd van één wedstrijd. `null` (of een lege string)
// wist de tijd. Gooit bij een fout in plaats van { error } terug te geven —
// zelfde contract als toggleSquadPlayer in app/actions/match-squad.ts, want de
// aanroeper is dezelfde selectiepagina.
export async function updateGatherTime(eventId: string, gatherTime: string | null): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  // Checkt eigenaarschap én type = 'match' in één query, met een melding die
  // niet verraadt wélke van de twee misging.
  await assertOwnMatchEvent(supabase, eventId, user.id)

  // Lege string uit een leeggemaakt tijdveld betekent "wissen", niet "ongeldig".
  const value = gatherTime === '' ? null : gatherTime
  if (value !== null && !isTimeString(value)) throw new Error('Ongeldig tijdstip')

  const { error } = await supabase
    .from('events')
    .update({ gather_time: value })
    .eq('id', eventId)
    .eq('team_id', user.id)
    .eq('type', 'match')

  if (error) throw genericError('events.updateGatherTime', error)

  revalidatePath(`/events/${eventId}/squad`)
  revalidatePath(`/events/${eventId}`)
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

  if (error) throw genericError('events.deleteEvent', error)
  revalidatePath('/events')
  revalidatePath('/')
}
