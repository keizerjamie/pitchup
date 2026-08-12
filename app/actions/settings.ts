'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { genericError } from '@/lib/errors'
import { MAX_SEASON_DAYS, isDateString, seasonTrainingDates } from '@/lib/season-dates'
import { periodIdByPlayerForDate } from '@/lib/absence-periods'

export async function getDefaultAttendance(): Promise<'present' | 'unknown'> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'present'

  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('team_id', user.id)
    .eq('key', 'default_attendance')
    .single()
  return (data?.value as 'present' | 'unknown') ?? 'present'
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return {}

  const { data } = await supabase.from('settings').select('key, value').eq('team_id', user.id)
  const map: Record<string, string> = {}
  for (const row of data ?? []) map[row.key] = row.value
  return map
}

export async function saveSettings(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const defaultAttendance = formData.get('default_attendance') as string
  if (!['present', 'unknown'].includes(defaultAttendance)) throw new Error('Ongeldige waarde')

  const { error } = await supabase
    .from('settings')
    .upsert({ team_id: user.id, key: 'default_attendance', value: defaultAttendance }, { onConflict: 'team_id,key' })
  if (error) throw genericError('settings.saveSettings', error)

  revalidatePath('/settings')
}

export async function saveScheduleSettings(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  // isDateString weigert naast een verkeerd formaat ook niet-bestaande datums
  // (2026-02-30), die `Date` stilzwijgend zou doorrollen.
  const seasonStart = formData.get('season_start') as string
  const seasonEnd = formData.get('season_end') as string
  if (!isDateString(seasonStart) || !isDateString(seasonEnd)) throw new Error('Ongeldige datum')

  const entries = [
    { team_id: user.id, key: 'season_start', value: seasonStart },
    { team_id: user.id, key: 'season_end', value: seasonEnd },
    { team_id: user.id, key: 'training_days', value: formData.get('training_days') as string },
    { team_id: user.id, key: 'training_time', value: (formData.get('training_time') as string) || '' },
    { team_id: user.id, key: 'training_location', value: (formData.get('training_location') as string) || '' },
  ]

  const { error } = await supabase.from('settings').upsert(entries, { onConflict: 'team_id,key' })
  if (error) throw genericError('settings.saveScheduleSettings', error)

  revalidatePath('/settings')
}

export async function deleteSeasonTrainings(): Promise<{ deleted: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const settings = await getAllSettings()
  const seasonStart = settings['season_start']
  const seasonEnd = settings['season_end']

  if (!seasonStart || !seasonEnd) throw new Error('Stel eerst seizoensdatums in')

  const { data, error } = await supabase
    .from('events')
    .delete()
    .eq('team_id', user.id)
    .eq('type', 'training')
    .gte('date', seasonStart)
    .lte('date', seasonEnd)
    .select('id')

  if (error) throw genericError('settings.deleteSeasonTrainings', error)
  revalidatePath('/events')
  revalidatePath('/')
  return { deleted: data?.length ?? 0 }
}

export async function generateSeasonTrainings(): Promise<{ created: number; skipped: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const settings = await getAllSettings()

  const seasonStart = settings['season_start']
  const seasonEnd = settings['season_end']
  // Lege segmenten er eerst uit: `''.split(',')` levert [''] op en `Number('')`
  // is 0, waardoor een leeg `training_days` anders als "elke zondag" zou tellen.
  const trainingDays = (settings['training_days'] || '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
  const trainingTime = settings['training_time'] || null
  const trainingLocation = settings['training_location'] || null

  if (!seasonStart || !seasonEnd || trainingDays.length === 0) {
    throw new Error('Vul seizoensdata en trainingsdagen in voor je genereert')
  }

  const { data: existing } = await supabase
    .from('events')
    .select('date')
    .eq('team_id', user.id)
    .eq('type', 'training')
  const existingDates = new Set((existing ?? []).map((e) => e.date))

  // Datums worden in UTC uitgerekend (lib/season-dates.ts). Lokale
  // Date-parsing zou hier de tijdzone van de server laten meebeslissen: op een
  // UTC-lambda kan een training dan een dag verschuiven ten opzichte van wat de
  // gebruiker in Europe/Amsterdam instelde.
  const season = seasonTrainingDates(seasonStart, seasonEnd, trainingDays)
  if (!season.ok) {
    if (season.reason === 'season-too-long') {
      throw new Error(`Het seizoen mag maximaal ${MAX_SEASON_DAYS} dagen beslaan`)
    }
    throw new Error('Controleer de seizoensdatums: de einddatum moet na de startdatum liggen')
  }

  const toCreate = season.dates
    .filter((date) => !existingDates.has(date))
    .map((date) => ({
      type: 'training',
      date,
      time: trainingTime,
      location: trainingLocation,
      team_id: user.id,
    }))

  if (toCreate.length === 0) {
    return { created: 0, skipped: 0 }
  }

  // Eén keer vóór de lus: alle afmeldperiodes die met het seizoen OVERLAPPEN
  // (from_date <= seizoenseinde EN to_date >= seizoensstart). Dat is bewust een
  // bereikvergelijking, geen puntcheck — welke periode een concrete
  // trainingsdatum dekt, bepaalt periodIdByPlayerForDate() daarna in-memory.
  // Vaste sortering voor een deterministische herkomst bij overlap.
  const { data: periods, error: periodsError } = await supabase
    .from('absence_periods')
    .select('id, player_id, from_date, to_date')
    .eq('team_id', user.id)
    .lte('from_date', seasonEnd)
    .gte('to_date', seasonStart)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (periodsError) throw genericError('settings.generateSeasonTrainings.periods', periodsError)

  let created = 0
  for (let i = 0; i < toCreate.length; i += 50) {
    const batch = toCreate.slice(i, i + 50)
    // `date` moet mee: PostgREST garandeert niet dat de teruggegeven rijen in
    // dezelfde volgorde staan als de batch, dus de afmeldperiodes worden op
    // datum gematcht en nooit op array-index.
    const { data: inserted, error } = await supabase
      .from('events')
      .insert(batch)
      .select('id, date')
    if (error) throw genericError('settings.generateSeasonTrainings', error)

    const { data: players } = await supabase.from('players').select('id').eq('active', true).eq('team_id', user.id)
    const defaultStatus = settings['default_attendance'] ?? 'present'

    if (players && players.length > 0 && inserted) {
      const attendanceRecords = inserted.flatMap((ev) => {
        const periodByPlayer = periodIdByPlayerForDate(periods ?? [], ev.date)
        // Alle rijen krijgen dezelfde sleutels — PostgREST weigert een
        // bulk-insert met afwijkende kolommen, dus absence_period_id gaat ook
        // mee als hij null is.
        return players.map((p) => {
          const periodId = periodByPlayer.get(p.id) ?? null
          return {
            event_id: ev.id,
            player_id: p.id,
            status: periodId ? 'absent' : defaultStatus,
            team_id: user.id,
            absence_period_id: periodId,
          }
        })
      })
      const { error: attendanceError } = await supabase.from('attendance').insert(attendanceRecords)
      if (attendanceError) throw genericError('settings.generateSeasonTrainings.attendance', attendanceError)
    }

    created += batch.length
  }

  revalidatePath('/events')
  revalidatePath('/')
  return { created, skipped: toCreate.length - created }
}
