'use client'

// Aanmaakformulier voor een nieuw event (training of wedstrijd). Losgetrokken
// van app/events/new/page.tsx (validatiebevinding 2, brief §4.5): die pagina
// is nu een server component die eerst canEdit(ctx,'agenda') afdwingt en dit
// formulier alleen rendert mét dat recht — dit bestand blijft zelf ONgated,
// puur UI, zodat de bestaande trainingstype*.acceptance.test.tsx-bestanden
// het rechtstreeks kunnen blijven renderen zonder een teamcontext na te
// bouwen.

import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import BackButton from '@/components/BackButton'
import EventFormFields from '@/components/EventFormFields'
import { createEvent } from '@/app/actions/events'
import { todayLocal } from '@/lib/utils'
import { useDict } from '@/lib/i18n-context'
import type { TrainingsType } from '@/lib/types'

type EventType = 'training' | 'match'

function NewEventFields() {
  const searchParams = useSearchParams()
  const raw = searchParams.get('type')
  const defaultType: EventType = raw === 'match' ? 'match' : 'training'
  const [type, setType] = useState<EventType>(defaultType)
  const [trainingstype, setTrainingstype] = useState<TrainingsType>('vct')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useDict()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    try {
      await createEvent(formData)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.event.createError)
      setIsLoading(false)
    }
  }

  const submitLabel = isLoading
    ? t.event.creating
    : type === 'match' ? t.event.createMatch
    : t.event.createTraining

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
      <div className="flex items-center gap-3 mb-6">
        <BackButton fallback="/events" className="text-faint hover:text-ink">
          <span className="ms text-[24px]" aria-hidden="true">arrow_back</span>
        </BackButton>
        <h1 className="text-2xl font-bold text-ink">{t.event.newTitle}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-4 py-3 rounded-xl">
            {error}
          </div>
        )}
        <div className="bg-surface rounded-2xl p-2 border border-[var(--border-soft)] flex gap-1.5">
          <button type="button" onClick={() => setType('training')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${type === 'training' ? 'bg-event-training text-white shadow-sm' : 'text-muted hover:text-ink'}`}>
            {t.event.training}
          </button>
          <button type="button" onClick={() => setType('match')}
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
            type={type}
            defaults={{ date: todayLocal(), matchType: 'league', homeAway: 'home' }}
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
        </div>

        <button type="submit" disabled={isLoading}
          className={`w-full py-3 rounded-xl font-semibold text-white transition active:scale-95 ${
            type === 'match' ? 'bg-event-match hover:bg-event-match/90' : 'bg-event-training hover:bg-event-training/90'
          } ${isLoading ? 'opacity-60' : ''}`}>
          {submitLabel}
        </button>
      </form>
    </div>
  )
}

export default function NewEventForm() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-faint">...</div>}>
      <NewEventFields />
    </Suspense>
  )
}
