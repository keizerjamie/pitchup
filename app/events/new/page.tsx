'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import BackButton from '@/components/BackButton'
import { createEvent } from '@/app/actions/events'
import { todayLocal } from '@/lib/utils'
import { useDict } from '@/lib/i18n-context'

type EventType = 'training' | 'match'

function NewEventForm() {
  const searchParams = useSearchParams()
  const raw = searchParams.get('type')
  const defaultType: EventType = raw === 'match' ? 'match' : 'training'
  const [type, setType] = useState<EventType>(defaultType)
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

  const notesPlaceholder = type === 'training' ? t.event.notesTrainingPlaceholder : t.event.notesMatchPlaceholder

  const submitLabel = isLoading
    ? t.event.creating
    : type === 'match' ? t.event.createMatch
    : t.event.createTraining

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
      <div className="flex items-center gap-3 mb-6">
        <BackButton fallback="/events" className="text-faint hover:text-ink">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </BackButton>
        <h1 className="text-2xl font-bold text-ink">{t.event.newTitle}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-muted mb-1.5">{t.event.date}</label>
              <input name="date" type="date" required defaultValue={todayLocal()}
                className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-muted mb-1.5">{t.event.time}</label>
              <input name="time" type="time"
                className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-muted mb-1.5">
              {t.event.location} <span className="text-faint font-normal">({t.event.optional})</span>
            </label>
            <input name="location" type="text" placeholder="Sportpark de Meent"
              className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink placeholder-faint" />
          </div>

          {type === 'match' && (
            <>
              <div>
                <label className="block text-sm font-semibold text-muted mb-1.5">{t.event.opponent}</label>
                <input name="opponent" type="text" required placeholder="FC Voorbeeld"
                  className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-event-match focus:ring-2 focus:ring-event-match/30 text-ink placeholder-faint" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-muted mb-2">{t.event.matchType}</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['friendly', 'league', 'cup'] as const).map((val) => (
                    <label key={val} className="cursor-pointer">
                      <input type="radio" name="match_type" value={val} className="sr-only peer" defaultChecked={val === 'league'} />
                      <div className="peer-checked:bg-event-match peer-checked:text-white peer-checked:border-event-match border-2 border-[var(--border-soft)] rounded-xl p-2 text-center text-xs font-semibold text-muted hover:border-event-match/50 transition-colors">
                        {t.event.matchTypes[val]}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-muted mb-2">{t.event.homeAway}</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['home', 'away'] as const).map((val) => (
                    <label key={val} className="cursor-pointer">
                      <input type="radio" name="home_away" value={val} className="sr-only peer" defaultChecked={val === 'home'} />
                      <div className="peer-checked:bg-event-match peer-checked:text-white peer-checked:border-event-match border-2 border-[var(--border-soft)] rounded-xl p-3 text-center text-sm font-semibold text-muted hover:border-event-match/50 transition-colors">
                        {val === 'home' ? t.event.home : t.event.away}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-muted mb-1.5">
                  {t.event.gatherTime} <span className="text-faint font-normal">({t.event.optional})</span>
                </label>
                <input name="gather_time" type="time"
                  className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-event-match focus:ring-2 focus:ring-event-match/30 text-ink" />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-semibold text-muted mb-1.5">
              {t.event.notes} <span className="text-faint font-normal">({t.event.optional})</span>
            </label>
            <textarea name="notes" rows={3}
              placeholder={notesPlaceholder}
              className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink placeholder-faint resize-none" />
          </div>
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

export default function NewEventPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-faint">...</div>}>
      <NewEventForm />
    </Suspense>
  )
}
