'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

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

  await supabase
    .from('settings')
    .upsert({ team_id: user.id, key: 'default_attendance', value: defaultAttendance }, { onConflict: 'team_id,key' })

  revalidatePath('/settings')
}

export async function saveScheduleSettings(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
  const seasonStart = formData.get('season_start') as string
  const seasonEnd = formData.get('season_end') as string
  if (!DATE_RE.test(seasonStart) || !DATE_RE.test(seasonEnd)) throw new Error('Ongeldige datum')

  const entries = [
    { team_id: user.id, key: 'season_start', value: seasonStart },
    { team_id: user.id, key: 'season_end', value: seasonEnd },
    { team_id: user.id, key: 'training_days', value: formData.get('training_days') as string },
    { team_id: user.id, key: 'training_time', value: (formData.get('training_time') as string) || '' },
    { team_id: user.id, key: 'training_location', value: (formData.get('training_location') as string) || '' },
  ]

  await supabase.from('settings').upsert(entries, { onConflict: 'team_id,key' })
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

  if (error) throw new Error(error.message)
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
  const trainingDays = (settings['training_days'] || '').split(',').map(Number).filter((n) => !isNaN(n))
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

  const start = new Date(seasonStart + 'T00:00:00')
  const end = new Date(seasonEnd + 'T00:00:00')
  const toCreate: { type: string; date: string; time: string | null; location: string | null; team_id: string }[] = []

  const cursor = new Date(start)
  while (cursor <= end) {
    const dayOfWeek = cursor.getDay()
    if (trainingDays.includes(dayOfWeek)) {
      const y = cursor.getFullYear()
      const m = String(cursor.getMonth() + 1).padStart(2, '0')
      const d = String(cursor.getDate()).padStart(2, '0')
      const dateStr = `${y}-${m}-${d}`
      if (!existingDates.has(dateStr)) {
        toCreate.push({ type: 'training', date: dateStr, time: trainingTime, location: trainingLocation, team_id: user.id })
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  if (toCreate.length === 0) {
    return { created: 0, skipped: 0 }
  }

  let created = 0
  for (let i = 0; i < toCreate.length; i += 50) {
    const batch = toCreate.slice(i, i + 50)
    const { data: inserted, error } = await supabase
      .from('events')
      .insert(batch)
      .select('id')
    if (error) throw new Error(error.message)

    const { data: players } = await supabase.from('players').select('id').eq('active', true).eq('team_id', user.id)
    const defaultStatus = settings['default_attendance'] ?? 'present'

    if (players && players.length > 0 && inserted) {
      const attendanceRecords = inserted.flatMap((ev) =>
        players.map((p) => ({ event_id: ev.id, player_id: p.id, status: defaultStatus, team_id: user.id }))
      )
      await supabase.from('attendance').insert(attendanceRecords)
    }

    created += batch.length
  }

  revalidatePath('/events')
  revalidatePath('/')
  return { created, skipped: toCreate.length - created }
}
