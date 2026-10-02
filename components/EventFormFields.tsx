'use client'

// Veldblok dat NewEventForm en EditEventForm delen: datum, tijd, locatie,
// (bij een wedstrijd) tegenstander, wedstrijdtype en thuis/uit, en notities.
// Puur presentatie en ongecontroleerd (defaultValue/defaultChecked): de
// ouder leest de waarden bij submit uit FormData. Geen veld voor type,
// verzameltijd, trainingstype of uitslag — die horen bij de ouder resp. bij
// hun eigen editors.

import { useId } from 'react'
import { useDict } from '@/lib/i18n-context'
import type { HomeAway, MatchType } from '@/lib/types'

type Props = {
  type: 'training' | 'match'
  defaults?: {
    date?: string
    time?: string
    location?: string
    notes?: string
    opponent?: string
    matchType?: MatchType | null
    homeAway?: HomeAway | null
  }
  // Rendert na thuis/uit en vóór notities (alleen bij een wedstrijd).
  matchExtra?: React.ReactNode
}

export default function EventFormFields({ type, defaults = {}, matchExtra }: Props) {
  const t = useDict()
  const uid = useId()
  const id = (name: string) => `${uid}-${name}`

  const notesPlaceholder = type === 'training' ? t.event.notesTrainingPlaceholder : t.event.notesMatchPlaceholder

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={id('date')} className="block text-sm font-semibold text-muted mb-1.5">{t.event.date}</label>
          <input id={id('date')} name="date" type="date" required defaultValue={defaults.date}
            className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink" />
        </div>
        <div>
          <label htmlFor={id('time')} className="block text-sm font-semibold text-muted mb-1.5">{t.event.time}</label>
          <input id={id('time')} name="time" type="time" defaultValue={defaults.time}
            className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink" />
        </div>
      </div>

      <div>
        <label htmlFor={id('location')} className="block text-sm font-semibold text-muted mb-1.5">
          {t.event.location} <span className="text-faint font-normal">({t.event.optional})</span>
        </label>
        <input id={id('location')} name="location" type="text" placeholder={t.event.locationPlaceholder} defaultValue={defaults.location}
          className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink placeholder-faint" />
      </div>

      {type === 'match' && (
        <>
          <div>
            <label htmlFor={id('opponent')} className="block text-sm font-semibold text-muted mb-1.5">{t.event.opponent}</label>
            <input id={id('opponent')} name="opponent" type="text" required placeholder={t.event.opponentPlaceholder} defaultValue={defaults.opponent}
              className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-event-match focus:ring-2 focus:ring-event-match/30 text-ink placeholder-faint" />
          </div>

          <div>
            <label className="block text-sm font-semibold text-muted mb-2">{t.event.matchType}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['friendly', 'league', 'cup'] as const).map((val) => (
                <label key={val} className="cursor-pointer">
                  <input type="radio" name="match_type" value={val} className="sr-only peer" defaultChecked={val === defaults.matchType} />
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
                  <input type="radio" name="home_away" value={val} className="sr-only peer" defaultChecked={val === defaults.homeAway} />
                  <div className="peer-checked:bg-event-match peer-checked:text-white peer-checked:border-event-match border-2 border-[var(--border-soft)] rounded-xl p-3 text-center text-sm font-semibold text-muted hover:border-event-match/50 transition-colors">
                    {val === 'home' ? t.event.home : t.event.away}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {matchExtra}
        </>
      )}

      <div>
        <label htmlFor={id('notes')} className="block text-sm font-semibold text-muted mb-1.5">
          {t.event.notes} <span className="text-faint font-normal">({t.event.optional})</span>
        </label>
        <textarea id={id('notes')} name="notes" rows={3} defaultValue={defaults.notes}
          placeholder={notesPlaceholder}
          className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink placeholder-faint resize-none" />
      </div>
    </>
  )
}
