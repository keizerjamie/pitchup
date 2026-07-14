import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FootballEvent } from '@/lib/types'
import { daysUntil, formatDateLong, formatTime, todayLocal } from '@/lib/utils'
import { getDict } from '@/lib/i18n'

export default async function DashboardPage() {
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = todayLocal()

  const [{ data: upcomingEvents }, { data: players }, { data: teamNameRow }] = await Promise.all([
    supabase.from('events').select('*').eq('team_id', user.id).neq('type', 'meting').gte('date', today).order('date', { ascending: true }).limit(10),
    supabase.from('players').select('id').eq('team_id', user.id).eq('active', true),
    supabase.from('settings').select('value').eq('team_id', user.id).eq('key', 'team_name').maybeSingle(),
  ])

  const teamName = teamNameRow?.value?.trim() || null

  const upcoming: FootballEvent[] = upcomingEvents ?? []
  const totalPlayers = players?.length ?? 0

  const allEventIds = upcoming.map((e) => e.id)
  const { data: attendance } = allEventIds.length > 0
    ? await supabase.from('attendance').select('event_id, status').eq('team_id', user.id).in('event_id', allEventIds)
    : { data: [] }
  const allAttendance = attendance ?? []

  const nextTraining = upcoming.find((e) => e.type === 'training') ?? null
  const nextMatch = upcoming.find((e) => e.type === 'match') ?? null

  const { data: lineupData } = nextMatch
    ? await supabase.from('lineups').select('id').eq('team_id', user.id).eq('event_id', nextMatch.id).maybeSingle()
    : { data: null }
  const hasLineup = !!lineupData

  const heroEvents = [nextTraining, nextMatch]
    .filter((e): e is FootballEvent => e !== null)
    .sort((a, b) => a.date.localeCompare(b.date))

  function getAttendanceStats(eventId: string) {
    const records = allAttendance.filter((a) => a.event_id === eventId)
    const present = records.filter((a) => a.status === 'present').length
    const absent = records.filter((a) => a.status === 'absent').length
    const unknown = records.filter((a) => a.status === 'unknown').length
    return { present, absent, unknown, total: records.length }
  }

  const heroIds = new Set(heroEvents.map((e) => e.id))
  const otherUpcoming = upcoming.filter((e) => !heroIds.has(e.id)).slice(0, 6)

  return (
    <div className="max-w-2xl lg:max-w-5xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">{teamName ?? t.dashboard.title}</h1>
        <p className="text-sm text-gray-500">{totalPlayers} {t.dashboard.activePlayers}</p>
      </div>

      {heroEvents.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center border border-dashed border-gray-200">
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
          </svg>
          <p className="text-gray-500 font-medium">{t.dashboard.noUpcoming}</p>
          <p className="text-gray-400 text-sm mt-1">{t.dashboard.noUpcomingHint}</p>
          <div className="flex gap-2 justify-center mt-4">
            <Link href="/events/new?type=training" className="bg-brand text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-brand-dark transition-colors">
              {t.dashboard.addTraining}
            </Link>
            <Link href="/events/new?type=match" className="border-2 border-brand text-brand px-4 py-2 rounded-xl text-sm font-semibold hover:bg-brand-light transition-colors">
              {t.dashboard.addMatch}
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 lg:gap-5 lg:grid-cols-2 stagger">
          {heroEvents.map((event) => {
            const isMatch = event.type === 'match'
            const stats = getAttendanceStats(event.id)
            const diff = daysUntil(event.date)
            const relLabel = diff === 0 ? t.dashboard.today
              : diff === 1 ? t.dashboard.tomorrow
              : diff <= 7 ? t.dashboard.inDays.replace('{n}', String(diff))
              : null
            const stripDone = isMatch ? hasLineup : false
            const stripHref = isMatch ? `/events/${event.id}/lineup` : `/events/${event.id}/training-plan`
            const stripLabel = isMatch
              ? (hasLineup ? t.event.lineupView : t.event.lineupCta)
              : t.event.trainingPlanCta

            return (
              <div key={event.id} className="group rounded-2xl overflow-hidden shadow-lg transition-transform duration-200 ease-out hover:scale-[1.025] hover:shadow-xl">
                <Link href={`/events/${event.id}`} transitionTypes={['nav-forward']} className="block active:opacity-90 transition-opacity">
                  <div className="p-5 text-white relative overflow-hidden"
                    style={{ background: isMatch
                      ? 'linear-gradient(135deg, #4338ca 0%, #312e81 100%)'
                      : 'linear-gradient(135deg, #0d3d38 0%, #0a2e2a 100%)' }}>
                    {event.time && (
                      <svg viewBox="0 0 200 100" preserveAspectRatio="none"
                        className="absolute right-0 top-0 h-full w-3/5 pointer-events-none select-none transition-transform duration-300 ease-out group-hover:scale-[1.12] origin-center" aria-hidden="true">
                        <defs><filter id={`thicken-${event.id}`}><feMorphology operator="dilate" radius="3" in="SourceGraphic" /></filter></defs>
                        <text x="100" y="50" textAnchor="middle" dominantBaseline="central" filter={`url(#thicken-${event.id})`}
                          fill="white" fillOpacity="0.12" fontSize="140" textLength="200" lengthAdjust="spacingAndGlyphs">
                          {formatTime(event.time)}
                        </text>
                      </svg>
                    )}
                    <div className="relative">
                      {isMatch ? (
                        <>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-white/60 text-xs font-semibold uppercase tracking-wider">{t.dashboard.nextMatch}</span>
                            {event.match_type && (
                              <span className="bg-white/20 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
                                {t.event.matchTypes[event.match_type as keyof typeof t.event.matchTypes]}
                              </span>
                            )}
                          </div>
                          <div className="text-2xl font-bold mt-2 mb-3">
                            {event.opponent ? `vs ${event.opponent}` : t.event.match}
                            {event.home_away && ` (${event.home_away === 'home' ? t.calendar.homeLabel[0] : t.calendar.awayLabel[0]})`}
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="text-white/60 text-xs font-semibold uppercase tracking-wider">{t.dashboard.nextTraining}</span>
                          <div className="text-2xl font-bold mt-2 mb-3">{t.dashboard.training}</div>
                        </>
                      )}
                      <div className="text-sm font-medium text-white/80">
                        {relLabel && <span className="font-semibold text-white">{relLabel} · </span>}
                        {formatDateLong(event.date, t.browserLocale)}
                      </div>
                      {stats.total > 0 && (
                        <div className="mt-3 flex gap-2 text-sm">
                          <span className="bg-accent-green/30 text-accent-green px-2 py-0.5 rounded-full font-medium">✓ {stats.present}</span>
                          <span className="bg-red-400/20 text-red-300 px-2 py-0.5 rounded-full font-medium">✗ {stats.absent}</span>
                          <span className="bg-white/10 text-white/50 px-2 py-0.5 rounded-full font-medium">? {stats.unknown}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Link>

                <Link href={stripHref} transitionTypes={['nav-forward']} className="block active:opacity-80 transition-opacity">
                  <div
                    className="px-4 py-3 flex items-center gap-2 relative overflow-hidden"
                    style={{
                      background: stripDone ? 'rgba(22,163,74,0.75)' : 'rgba(234,88,12,0.75)',
                      backdropFilter: 'blur(20px) saturate(200%) brightness(1.15)',
                      WebkitBackdropFilter: 'blur(20px) saturate(200%) brightness(1.15)',
                      borderTop: '1px solid rgba(255,255,255,0.22)',
                      boxShadow: '0 1px 0 rgba(255,255,255,0.18) inset',
                    }}
                  >
                    <div aria-hidden="true" style={{
                      position: 'absolute', inset: 0, pointerEvents: 'none',
                      background: 'linear-gradient(90deg, rgba(255,255,255,0.10) 0%, transparent 60%)',
                    }} />
                    {stripDone ? (
                      <svg className="w-4 h-4 text-white/90 flex-shrink-0 relative" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-white/80 flex-shrink-0 relative" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    )}
                    <span className="text-white font-semibold text-sm flex-1 relative" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.25)' }}>{stripLabel}</span>
                    <svg className="w-4 h-4 text-white/70 flex-shrink-0 relative" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              </div>
            )
          })}
        </div>
      )}

      {/* Remaining upcoming events */}
      {otherUpcoming.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t.calendar.upcoming}</h2>
          <div className="grid gap-2 lg:grid-cols-2 stagger">
            {otherUpcoming.map((event) => {
              const isMatch = event.type === 'match'
              const isMeting = event.type === 'meting'
              const title = isMatch && event.opponent ? `vs ${event.opponent}`
                : isMeting ? t.event.meting
                : t.dashboard.training
              return (
                <Link key={event.id} href={`/events/${event.id}`} transitionTypes={['nav-forward']} className="block">
                  <div className="glass-card-raised rounded-xl p-3.5 flex items-center gap-3 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200">
                    <div className={`flex-shrink-0 w-11 h-11 rounded-xl flex flex-col items-center justify-center ${isMatch ? 'bg-blue-50' : isMeting ? 'bg-purple-50' : 'bg-green-50'}`}>
                      <span className={`text-[11px] font-medium leading-none ${isMatch ? 'text-blue-500' : isMeting ? 'text-purple-500' : 'text-green-600'}`}>
                        {new Date(event.date + 'T00:00:00').toLocaleDateString(t.browserLocale, { month: 'short' })}
                      </span>
                      <span className={`text-base font-bold leading-tight ${isMatch ? 'text-blue-700' : isMeting ? 'text-purple-700' : 'text-green-700'}`}>
                        {new Date(event.date + 'T00:00:00').getDate()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 text-sm truncate">{title}</div>
                      <div className="text-xs text-gray-500">
                        {event.time && formatTime(event.time)}
                        {event.time && event.location && ' · '}
                        {event.location}
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
