'use client'

// Aanmaakformulier voor een nieuw event (training of wedstrijd). Losgetrokken
// van app/events/new/page.tsx (validatiebevinding 2, brief §4.5): die pagina
// is nu een server component die eerst canEdit(ctx,'agenda') afdwingt en dit
// formulier alleen rendert mét dat recht — dit bestand blijft zelf ONgated,
// puur UI, zodat de bestaande trainingstype*.acceptance.test.tsx-bestanden
// het rechtstreeks kunnen blijven renderen zonder een teamcontext na te
// bouwen.

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import ActionBar from '@/components/ui/ActionBar'
import Button, { LinkButton } from '@/components/ui/Button'
import EventFormFields from '@/components/EventFormFields'
import RecurrenceFields, { recurringErrorText } from '@/components/RecurrenceFields'
import { createEvent } from '@/app/actions/events'
import { createRecurringTrainings, getExistingTrainingDates } from '@/app/actions/events-bulk'
import { planRecurringTrainings, EMPTY_TRAINING_DEFAULTS } from '@/lib/recurring-trainings'
import type { NewTrainingDefaults } from '@/lib/recurring-trainings'
import { todayLocal } from '@/lib/utils'
import { useDict } from '@/lib/i18n-context'
import type { TrainingsType } from '@/lib/types'

type EventType = 'training' | 'match'

// Wachttijd voordat na een wijziging de bestaande trainingen worden opgehaald.
const EXISTING_CHECK_DEBOUNCE_MS = 300

type SavedResult = { created: number; skipped: number; attendanceFailed: boolean }

function NewEventFields({ trainingDefaults }: { trainingDefaults: NewTrainingDefaults }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const raw = searchParams.get('type')
  const defaultType: EventType = raw === 'match' ? 'match' : 'training'
  const [type, setType] = useState<EventType>(defaultType)
  const [trainingstype, setTrainingstype] = useState<TrainingsType>('vct')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useDict()

  // Herhalen (alleen bij een training).
  const [today] = useState(() => todayLocal())
  const [startDate, setStartDate] = useState(today)
  const [repeat, setRepeat] = useState(false)
  const [days, setDays] = useState<number[]>([])
  const [until, setUntil] = useState(
    trainingDefaults.seasonEnd && trainingDefaults.seasonEnd >= today ? trainingDefaults.seasonEnd : '',
  )
  // Antwoord van de bestaande-check, gekoppeld aan het bereik waarvoor het geldt;
  // een antwoord voor een ander bereik telt niet mee (geen setState in de effect nodig).
  const [existingAnswer, setExistingAnswer] = useState<{ range: string; dates: Set<string> | null } | null>(null)
  const [saved, setSaved] = useState<SavedResult | null>(null)
  const requestId = useRef(0)
  const submitting = useRef(false) // synchrone dubbelklik-guard; isLoading is pas na een render zichtbaar

  const repeating = type === 'training' && repeat
  const basePlan = useMemo(
    () => (repeating ? planRecurringTrainings(startDate, until, days) : null),
    [repeating, startDate, until, days],
  )
  const rangeKey = `${startDate}|${until}`
  const existing = existingAnswer?.range === rangeKey ? existingAnswer.dates : null
  const existingCheckFailed = existingAnswer?.range === rangeKey && existingAnswer.dates === null
  const plan = useMemo(
    () => (repeating ? planRecurringTrainings(startDate, until, days, existing ?? undefined) : null),
    [repeating, startDate, until, days, existing],
  )
  const rangeValid = basePlan !== null && basePlan.ok && basePlan.dates.length > 0

  // Bestaande trainingen in het bereik ophalen (debounce; verouderde antwoorden negeren).
  useEffect(() => {
    const id = ++requestId.current
    if (!rangeValid) return
    const range = `${startDate}|${until}`
    const timer = setTimeout(() => {
      getExistingTrainingDates(startDate, until).then(
        (dates) => { if (id === requestId.current) setExistingAnswer({ range, dates: new Set(dates) }) },
        () => { if (id === requestId.current) setExistingAnswer({ range, dates: null }) },
      )
    }, EXISTING_CHECK_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [rangeValid, startDate, until])

  function changeType(next: EventType) {
    if (next === type) return
    setType(next)
    // EventFormFields remount (key={type}) en zet de datum terug op vandaag.
    setStartDate(today)
    if (next === 'match') setRepeat(false)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isLoading || submitting.current) return
    submitting.current = true
    setIsLoading(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    if (repeating) {
      try {
        const result = await createRecurringTrainings(formData)
        if (result.ok) {
          setSaved({ created: result.created, skipped: result.skipped, attendanceFailed: result.attendanceFailed })
        } else {
          setError(recurringErrorText(t, result.error))
        }
      } catch {
        // Nooit err.message tonen: de server gooit interne meldingen.
        setError(t.event.recurring.errors.generic)
      }
      submitting.current = false
      setIsLoading(false)
      return
    }
    try {
      await createEvent(formData)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.event.createError)
      submitting.current = false
      setIsLoading(false)
    }
  }

  const toCreateCount = plan && plan.ok ? plan.toCreate.length : 0
  // Server beslist als de bestaande-check mislukt is; anders blokkeert een leeg plan.
  const recurringBlocked = repeating && (!plan || !plan.ok || toCreateCount === 0)

  const submitLabel = isLoading
    ? t.event.creating
    : type === 'match' ? t.event.createMatch
    : repeating && plan && plan.ok && toCreateCount === 1 ? t.event.recurring.submitOne
    : repeating && plan && plan.ok ? t.event.recurring.submit.replace('{n}', String(toCreateCount))
    : t.event.createTraining

  if (saved) {
    return (
      <div className="max-w-lg lg:max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
        <PageHeader backFallback="/events" title={t.event.newTitle} className="mb-6" />
        <div className="space-y-3">
          <div role="status" className="bg-panel-green border border-panel-green-edge text-panel-green-ink text-sm px-4 py-3 rounded-xl">
            {saved.created === 0 && saved.skipped > 0 ? (
              t.event.recurring.allExisting
            ) : (
              <>
                {saved.created === 1 ? t.event.recurring.createdCountOne : t.event.recurring.createdCount.replace('{n}', String(saved.created))}
                {saved.skipped > 0 && (
                  <span className="block">{t.event.recurring.skippedCount.replace('{n}', String(saved.skipped))}</span>
                )}
              </>
            )}
          </div>
          {saved.attendanceFailed && (
            <div className="bg-panel-amber border border-panel-amber-edge text-panel-amber-ink text-sm px-4 py-3 rounded-xl">
              {t.event.recurring.attendanceWarning}
            </div>
          )}
          <Button type="button" fullWidth onClick={() => router.push('/events')}>
            {t.event.recurring.toAgenda}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
      <PageHeader backFallback="/events" title={t.event.newTitle} className="mb-6" />

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-4 py-3 rounded-xl">
            {error}
          </div>
        )}
        <div className="bg-surface rounded-2xl p-2 border border-[var(--border-soft)] flex gap-1.5">
          <button type="button" onClick={() => changeType('training')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${type === 'training' ? 'bg-event-training text-white shadow-sm' : 'text-muted hover:text-ink'}`}>
            {t.event.training}
          </button>
          <button type="button" onClick={() => changeType('match')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${type === 'match' ? 'bg-event-match text-white shadow-sm' : 'text-muted hover:text-ink'}`}>
            {t.event.match}
          </button>
        </div>

        <input type="hidden" name="type" value={type} />

        <div className="bg-surface rounded-2xl p-6 border border-[var(--border-soft)] space-y-5">
          {type === 'training' && (
            <div>
              <label className="block text-sm font-semibold text-muted mb-1.5">{t.event.trainingstype}</label>
              <div className="bg-surface rounded-2xl p-2 border border-[var(--border-soft)] flex gap-1.5">
                <button type="button" onClick={() => setTrainingstype('vct')}
                  aria-pressed={trainingstype === 'vct'}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-light ${trainingstype === 'vct' ? 'bg-event-training text-white shadow-sm' : 'text-muted hover:text-ink'}`}>
                  {t.event.trainingstypeVct}
                </button>
                <button type="button" onClick={() => setTrainingstype('teamtactisch')}
                  aria-pressed={trainingstype === 'teamtactisch'}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-light ${trainingstype === 'teamtactisch' ? 'bg-event-training text-white shadow-sm' : 'text-muted hover:text-ink'}`}>
                  {t.event.trainingstypeTeamtactisch}
                </button>
              </div>
              <input type="hidden" name="trainingstype" value={trainingstype} />
            </div>
          )}
          <EventFormFields
            key={type}
            type={type}
            onDateChange={setStartDate}
            defaults={{
              date: today,
              ...(type === 'training'
                ? { time: trainingDefaults.time ?? undefined, location: trainingDefaults.location ?? undefined }
                : {}),
              matchType: 'league',
              homeAway: 'home',
            }}
            matchExtra={(
              <div>
                <label className="block text-sm font-semibold text-muted mb-1.5">
                  {t.event.gatherTime} <span className="text-faint font-normal">({t.event.optional})</span>
                </label>
                <input name="gather_time" type="time"
                  className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-event-match focus:ring-2 focus:ring-event-match/30 text-ink" />
              </div>
            )}
          />
          {type === 'training' && (
            <RecurrenceFields
              enabled={repeat}
              onEnabledChange={setRepeat}
              days={days}
              onDaysChange={setDays}
              until={until}
              onUntilChange={setUntil}
              startDate={startDate}
              plan={plan}
              existingCheckFailed={existingCheckFailed}
              showEndDateHint={!trainingDefaults.seasonEnd}
              seasonEndPast={!!trainingDefaults.seasonEnd && trainingDefaults.seasonEnd < today}
            />
          )}
        </div>

        <ActionBar
          secondary={<LinkButton href="/events" variant="secondary">{t.common.cancel}</LinkButton>}
          primary={
            <Button type="submit" loading={isLoading} disabled={recurringBlocked} variant={type === 'match' ? 'match' : 'primary'}>
              {submitLabel}
            </Button>
          }
        />
      </form>
    </div>
  )
}

export default function NewEventForm({ trainingDefaults = EMPTY_TRAINING_DEFAULTS }: { trainingDefaults?: NewTrainingDefaults }) {
  return (
    <Suspense fallback={<div className="p-8 text-center text-faint">...</div>}>
      <NewEventFields trainingDefaults={trainingDefaults} />
    </Suspense>
  )
}
