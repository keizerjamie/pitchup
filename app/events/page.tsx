import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FootballEvent } from '@/lib/types'
import CalendarView from '@/components/CalendarView'

export default async function EventsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: events }, { data: attendance }] = await Promise.all([
    supabase.from('events').select('*').eq('team_id', user.id).neq('type', 'meting').order('date', { ascending: false }),
    supabase.from('attendance').select('event_id, status').eq('team_id', user.id),
  ])

  const allEvents: FootballEvent[] = events ?? []
  const allAttendance = attendance ?? []

  const attendanceMap: Record<string, { present: number; total: number }> = {}
  for (const event of allEvents) {
    const records = allAttendance.filter(a => a.event_id === event.id)
    attendanceMap[event.id] = {
      present: records.filter(a => a.status === 'present').length,
      total: records.length,
    }
  }

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8">
      <CalendarView events={allEvents} attendanceMap={attendanceMap} />
    </div>
  )
}
