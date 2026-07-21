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
        <BackButton fallback="/events" className="text-gray-400 hover:text-gray-600">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </BackButton>
        <h1 className="text-2xl font-bold text-gray-900">{t.event.newTitle}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
            {error}
          </div>
        )}
        <div className="bg-white rounded-2xl p-2 border border-gray-100 flex gap-1.5">
          <button type="button" onClick={() => setType('training')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${type === 'training' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.event.training}
          </button>
          <button type="button" onClick={() => setType('match')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${type === 'match' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.event.match}
          </button>
        </div>

        <input type="hidden" name="type" value={type} />

        <div className="bg-white rounded-2xl p-6 border border-gray-100 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.event.date}</label>
              <input name="date" type="date" required defaultValue={todayLocal()}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-gray-900" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.event.time}</label>
              <input name="time" type="time"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-gray-900" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              {t.event.location} <span className="text-gray-400 font-normal">({t.event.optional})</span>
            </label>
            <input name="location" type="text" placeholder="Sportpark de Meent"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-gray-900 placeholder-gray-400" />
          </div>

          {type === 'match' && (
            <>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.event.opponent}</label>
                <input name="opponent" type="text" required placeholder="FC Voorbeeld"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-gray-900 placeholder-gray-400" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">{t.event.matchType}</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['friendly', 'league', 'cup'] as const).map((val) => (
                    <label key={val} className="cursor-pointer">
                      <input type="radio" name="match_type" value={val} className="sr-only peer" defaultChecked={val === 'league'} />
                      <div className="peer-checked:bg-blue-600 peer-checked:text-white peer-checked:border-blue-600 border-2 border-gray-200 rounded-xl p-2 text-center text-xs font-semibold text-gray-600 hover:border-blue-300 transition-colors">
                        {t.event.matchTypes[val]}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">{t.event.homeAway}</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['home', 'away'] as const).map((val) => (
                    <label key={val} className="cursor-pointer">
                      <input type="radio" name="home_away" value={val} className="sr-only peer" defaultChecked={val === 'home'} />
                      <div className="peer-checked:bg-blue-600 peer-checked:text-white peer-checked:border-blue-600 border-2 border-gray-200 rounded-xl p-3 text-center text-sm font-semibold text-gray-600 hover:border-blue-300 transition-colors">
                        {val === 'home' ? t.event.home : t.event.away}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              {t.event.notes} <span className="text-gray-400 font-normal">({t.event.optional})</span>
            </label>
            <textarea name="notes" rows={3}
              placeholder={notesPlaceholder}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-gray-900 placeholder-gray-400 resize-none" />
          </div>
        </div>

        <button type="submit" disabled={isLoading}
          className={`w-full py-3 rounded-xl font-semibold text-white transition-all active:scale-95 ${
            type === 'match' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
          } ${isLoading ? 'opacity-60' : ''}`}>
          {submitLabel}
        </button>
      </form>
    </div>
  )
}

export default function NewEventPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400">...</div>}>
      <NewEventForm />
    </Suspense>
  )
}
