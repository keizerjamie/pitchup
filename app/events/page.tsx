import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FootballEvent } from '@/lib/types'
import { getDict } from '@/lib/i18n'
import { todayLocal } from '@/lib/utils'
import EventList from '@/components/EventList'

export default async function EventsPage() {
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: events }, { data: attendance }] = await Promise.all([
    supabase.from('events').select('*').eq('team_id', user.id).neq('type', 'meting').order('date', { ascending: false }),
    supabase.from('attendance').select('event_id, status').eq('team_id', user.id),
  ])

  const allEvents: FootballEvent[] = events ?? []
  const allAttendance = attendance ?? []

  const today = todayLocal()
  const upcoming = allEvents.filter((e) => e.date >= today).reverse()
  const past = allEvents.filter((e) => e.date < today)

  const attendanceMap: Record<string, { present: number; total: number }> = {}
  for (const event of allEvents) {
    const records = allAttendance.filter(a => a.event_id === event.id)
    attendanceMap[event.id] = {
      present: records.filter(a => a.status === 'present').length,
      total: records.length,
    }
  }

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">{t.calendar.title}</h1>
        {/* Desktop create actions — mobile uses the FAB */}
        <div className="hidden md:flex gap-2 flex-shrink-0">
          <Link href="/events/new?type=training" transitionTypes={['nav-forward']}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-green-600 hover:bg-green-700 active:scale-95 transition-all">
            <span className="text-base leading-none">+</span> {t.event.training}
          </Link>
          <Link href="/events/new?type=match" transitionTypes={['nav-forward']}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all">
            <span className="text-base leading-none">+</span> {t.event.match}
          </Link>
        </div>
      </div>
      <EventList upcoming={upcoming} past={past} attendanceMap={attendanceMap} />
    </div>
  )
}
