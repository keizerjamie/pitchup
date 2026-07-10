import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PERIODIZATION_CATEGORIES, MetingData } from '@/lib/types'
import { cycleWeekFor, computeCurrentSteps, getTrainingLog, TrainingLogEntry, LastDoneEntry } from '@/lib/periodization'
import { addDays, formatDate, todayLocal } from '@/lib/utils'
import { getDict } from '@/lib/i18n'
import NulmetingManager from '@/components/NulmetingManager'

// Solid bar colors matching each category's badge tint
const BAR_COLORS: Record<string, string> = {
  partijen_groot: '#dc2626',
  partijen_midden: '#ea580c',
  partijen_klein: '#d97706',
  sprints_weinig_rust: '#2563eb',
  sprints_veel_rust: '#4f46e5',
}

export default async function PeriodizationPage() {
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: metingEvents } = await supabase
    .from('events')
    .select('id, date')
    .eq('team_id', user.id)
    .eq('type', 'meting')
    .order('date', { ascending: false })

  const events = metingEvents ?? []
  const eventIds = events.map((e) => e.id)

  const { data: metingRows } = eventIds.length > 0
    ? await supabase.from('metingen').select('*').in('event_id', eventIds).eq('team_id', user.id)
    : { data: [] }

  const metingByEvent = new Map<string, MetingData>()
  for (const m of metingRows ?? []) metingByEvent.set(m.event_id, m)

  const latestEvent = events.find((e) => metingByEvent.has(e.id)) ?? null
  const latestMeting = latestEvent ? metingByEvent.get(latestEvent.id)! : null

  const today = todayLocal()
  let currentSteps: Record<string, number | null> = {}
  let cycleWeek: number | null = null
  let trainingLog: TrainingLogEntry[] = []
  let lastByCategory: Record<string, LastDoneEntry> = {}

  if (latestEvent && latestMeting) {
    const { log, lastByCategory: last, occurrences } = await getTrainingLog(
      supabase, user.id, latestMeting, latestEvent.date, addDays(today, 1),
    )
    trainingLog = log.slice(0, 6)
    lastByCategory = last
    currentSteps = computeCurrentSteps(latestMeting, occurrences)
    cycleWeek = cycleWeekFor(latestEvent.date, today)
  }

  const history = events
    .filter((e) => metingByEvent.has(e.id))
    .map((e) => {
      const m = metingByEvent.get(e.id)!
      return {
        eventId: e.id,
        date: e.date,
        notes: m.notes,
        steps: {
          partijen_groot_stap: m.partijen_groot_stap,
          partijen_midden_stap: m.partijen_midden_stap,
          partijen_klein_stap: m.partijen_klein_stap,
          sprints_weinig_rust_stap: m.sprints_weinig_rust_stap,
          sprints_veel_rust_stap: m.sprints_veel_rust_stap,
        },
      }
    })

  const metingCategories = PERIODIZATION_CATEGORIES.filter((c) => c.hasMeting)

  return (
    <div className="max-w-2xl lg:max-w-4xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">{t.periodization.pageTitle}</h1>
        <p className="text-sm text-gray-500 mt-1">{t.periodization.pageSubtitle}</p>
      </div>

      {latestEvent && latestMeting ? (
        <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start space-y-6 lg:space-y-0">
          <div className="space-y-6">
            {/* Current status */}
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/50">
                <h2 className="font-semibold text-gray-800">{t.periodization.currentSteps}</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {t.periodization.nulmetingLabel}: {formatDate(latestEvent.date, t.browserLocale)}
                  {cycleWeek !== null && <> · {t.periodization.cycleWeek.replace('{n}', String(cycleWeek))}</>}
                </p>
              </div>
              <div className="px-5 py-4 space-y-4">
                {metingCategories.map((cat) => {
                  const step = currentSteps[cat.key]
                  const pct = step !== null && step !== undefined
                    ? Math.min(100, Math.round((step / cat.maxStap) * 100))
                    : 0
                  const last = lastByCategory[cat.key]
                  return (
                    <div key={cat.key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-gray-800">{t.periodization.categories[cat.key] ?? cat.label}</span>
                        <span className="text-xs text-gray-500">
                          {t.periodization.step} {step ?? '–'}/{cat.maxStap}
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: BAR_COLORS[cat.key] ?? '#0d3d38' }}
                        />
                      </div>
                      <p className="text-xs mt-1 text-gray-400">
                        {last
                          ? <>{t.periodization.lastDone}: {formatDate(last.date, t.browserLocale)}{last.step !== null && <> · {t.periodization.step} {last.step}</>}</>
                          : t.periodization.notDoneYet}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Training log: what was actually done per training */}
            {trainingLog.length > 0 && (
              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-white/50">
                  <h2 className="font-semibold text-gray-800">{t.periodization.recentTrainings}</h2>
                </div>
                <div className="divide-y divide-gray-100">
                  {trainingLog.map((entry) => (
                    <Link
                      key={entry.eventId}
                      href={`/events/${entry.eventId}/training-plan`}
                      transitionTypes={['nav-forward']}
                      className="block px-5 py-3 hover:bg-white/40 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-sm font-semibold text-gray-900">{formatDate(entry.date, t.browserLocale)}</span>
                        <svg className="w-3.5 h-3.5 text-gray-300 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {entry.items.map((item) => {
                          const catMeta = PERIODIZATION_CATEGORIES.find((c) => c.key === item.key)
                          return (
                            <span key={item.key} className={`text-xs font-semibold px-2 py-0.5 rounded-full ${catMeta?.color ?? 'bg-gray-100 text-gray-700'}`}>
                              {t.periodization.categories[item.key] ?? item.key}
                              {item.step !== null && <> · {t.periodization.step} {item.step}</>}
                            </span>
                          )
                        })}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Steigerungs note */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <p className="text-xs text-emerald-700">{t.periodization.steigerungsNote}</p>
            </div>
          </div>

          <NulmetingManager history={history} />
        </div>
      ) : (
        <div className="max-w-lg space-y-6">
          <div className="glass-card rounded-2xl p-8 text-center border border-dashed border-white/60">
            <svg className="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
            </svg>
            <p className="text-gray-500 font-medium">{t.periodization.noMeting}</p>
            <p className="text-gray-400 text-sm mt-1">{t.periodization.noMetingHint}</p>
          </div>
          <NulmetingManager history={[]} />
        </div>
      )}
    </div>
  )
}
