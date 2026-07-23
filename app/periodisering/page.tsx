import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PERIODIZATION_CATEGORIES, MetingData } from '@/lib/types'
import { cycleWeekFor, computeCurrentSteps, getTrainingLog, TrainingLogEntry, LastDoneEntry, CYCLE_LENGTH_WEEKS } from '@/lib/periodization'
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
    <div className="max-w-2xl lg:max-w-4xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      <div>
        <h1 className="font-display text-[26px] lg:text-[28px] font-bold tracking-tight text-ink">{t.periodization.pageTitle}</h1>
        <p className="text-[13.5px] font-semibold text-faint mt-0.5">{t.periodization.pageSubtitle}</p>
      </div>

      {latestEvent && latestMeting ? (
        <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start flex flex-col gap-5">
          <div className="flex flex-col gap-5">
            {/* Current cycle phase */}
            {cycleWeek !== null && (
              <div className="rounded-2xl p-5 text-white" style={{ background: 'linear-gradient(135deg,#0a2e2a,#14655c)' }}>
                <div className="text-[11px] font-extrabold tracking-[.1em] uppercase" style={{ color: '#4ade80' }}>{t.periodization.cycleTitle}</div>
                <div className="font-display text-[30px] font-bold mt-1.5">{t.periodization.cycleWeek.replace('{n}', String(cycleWeek))}</div>
                <div className="text-[13.5px] font-semibold mt-1" style={{ color: '#9fd8cd' }}>
                  {t.periodization.nulmetingLabel}: {formatDate(latestEvent.date, t.browserLocale)}
                </div>
                <div className="h-2 rounded-full overflow-hidden mt-3.5" style={{ background: 'rgba(255,255,255,.14)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.round((cycleWeek / CYCLE_LENGTH_WEEKS) * 100)}%`, background: '#4ade80' }} />
                </div>
              </div>
            )}

            {/* Current steps per category */}
            <div className="surface-card overflow-hidden">
              <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-soft)' }}>
                <h2 className="font-display text-[16px] font-bold text-ink">{t.periodization.currentSteps}</h2>
              </div>
              <div className="px-5 py-4 flex flex-col gap-4">
                {metingCategories.map((cat) => {
                  const step = currentSteps[cat.key]
                  const pct = step !== null && step !== undefined ? Math.min(100, Math.round((step / cat.maxStap) * 100)) : 0
                  const last = lastByCategory[cat.key]
                  return (
                    <div key={cat.key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[13.5px] font-bold text-ink">{t.periodization.categories[cat.key] ?? cat.label}</span>
                        <span className="text-xs font-semibold text-faint">{t.periodization.step} {step ?? '–'}/{cat.maxStap}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: BAR_COLORS[cat.key] ?? '#0d3d38' }} />
                      </div>
                      <p className="text-xs mt-1 text-faint">
                        {last
                          ? <>{t.periodization.lastDone}: {formatDate(last.date, t.browserLocale)}{last.step !== null && <> · {t.periodization.step} {last.step}</>}</>
                          : t.periodization.notDoneYet}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Training log */}
            {trainingLog.length > 0 && (
              <div className="surface-card overflow-hidden">
                <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-soft)' }}>
                  <h2 className="font-display text-[16px] font-bold text-ink">{t.periodization.recentTrainings}</h2>
                </div>
                <div>
                  {trainingLog.map((entry, i) => (
                    <Link key={entry.eventId} href={`/events/${entry.eventId}/training-plan`}
                      className="block px-5 py-3 hover:bg-surface-sunken transition-colors"
                      style={i > 0 ? { borderTop: '1px solid var(--border-soft)' } : undefined}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[13.5px] font-bold text-ink">{formatDate(entry.date, t.browserLocale)}</span>
                        <span className="ms text-[18px] text-faint ml-auto">chevron_right</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {entry.items.map((item) => (
                          <span key={item.key} className="text-xs font-bold px-2 py-0.5 rounded-full text-muted bg-surface-sunken" style={{ border: '1px solid var(--border-soft)' }}>
                            {t.periodization.categories[item.key] ?? item.key}
                            {item.step !== null && <> · {t.periodization.step} {item.step}</>}
                          </span>
                        ))}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Steigerungs note */}
            <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 25%, transparent)' }}>
              <p className="text-xs font-semibold text-muted">{t.periodization.steigerungsNote}</p>
            </div>
          </div>

          <NulmetingManager history={history} />
        </div>
      ) : (
        <div className="max-w-lg flex flex-col gap-5">
          <div className="surface-card p-10 text-center flex flex-col items-center gap-3">
            <span className="ms text-[40px] text-faint">monitoring</span>
            <p className="text-ink font-bold">{t.periodization.noMeting}</p>
            <p className="text-faint text-sm">{t.periodization.noMetingHint}</p>
          </div>
          <NulmetingManager history={[]} />
        </div>
      )}
    </div>
  )
}
