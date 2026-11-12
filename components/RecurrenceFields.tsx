'use client'

// Herhaal-sectie van /events/new (alleen bij een training): schakelaar
// "Herhaal wekelijks", weekdagknoppen, einddatum en een teller. Puur
// presentatie: de ouder (NewEventForm) houdt de state en rekent het plan uit
// met planRecurringTrainings, zodat teller en server dezelfde datums zien.
// De velden `repeat_days` en `repeat_until` komen bij submit mee in FormData.

import { useId } from 'react'
import { useDict } from '@/lib/i18n-context'
import { MAX_RECURRING_DAYS, type RecurringPlan, type RecurringTrainingsErrorCode } from '@/lib/recurring-trainings'
import type { Dict } from '@/messages/nl'

// Weergavevolgorde ma..zo; waarden zijn Date#getUTCDay (0 = zondag).
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

// Vertaalde melding bij een foutcode (server of plan). Nooit ruwe tekst.
export function recurringErrorText(t: Dict, code: RecurringTrainingsErrorCode): string {
  const text = t.event.recurring.errors[code] ?? t.event.recurring.errors.generic
  return text.replace('{max}', String(MAX_RECURRING_DAYS))
}

type Props = {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  days: number[]
  onDaysChange: (days: number[]) => void
  until: string
  onUntilChange: (until: string) => void
  startDate: string
  // Plan met de bekende bestaande datums al verwerkt; null als er (nog) niets te plannen valt.
  plan: RecurringPlan | null
  // true zodra de bestaande-trainingen-check mislukt is (server beslist dan).
  existingCheckFailed: boolean
  // true als er geen seizoenseinde is om de einddatum mee voor te vullen.
  showEndDateHint: boolean
  // true als het seizoenseinde wel bestaat maar al voorbij is (andere hinttekst).
  seasonEndPast?: boolean
}

export default function RecurrenceFields({
  enabled, onEnabledChange, days, onDaysChange, until, onUntilChange,
  startDate, plan, existingCheckFailed, showEndDateHint, seasonEndPast = false,
}: Props) {
  const t = useDict()
  const r = t.event.recurring
  const uid = useId()
  const toggleId = `${uid}-toggle`
  const daysLabelId = `${uid}-days`
  const untilId = `${uid}-until`

  function toggleDay(day: number) {
    onDaysChange(days.includes(day) ? days.filter((d) => d !== day) : [...days, day])
  }

  const dayNames = DAY_ORDER.filter((d) => days.includes(d)).map((d) => t.schedule.days[d]).join(' + ')

  // Een lege einddatum meldt de ouder niet als fout; de hint en `required` doen dat werk.
  const planError = plan && !plan.ok && !(plan.error === 'invalid_end_date' && until === '') ? plan.error : null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input id={toggleId} type="checkbox" role="switch" checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="h-5 w-5 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-light" />
        <label htmlFor={toggleId} className="text-sm font-semibold text-ink cursor-pointer">{r.repeatToggle}</label>
      </div>

      {enabled && (
        <div className="space-y-4">
          <div>
            <span id={daysLabelId} className="block text-sm font-semibold text-muted mb-1.5">{r.weekdaysLabel}</span>
            <div role="group" aria-labelledby={daysLabelId}
              className="bg-surface rounded-2xl p-2 border border-[var(--border-soft)] flex gap-1.5">
              {DAY_ORDER.map((day) => {
                const active = days.includes(day)
                return (
                  <button key={day} type="button" aria-pressed={active} onClick={() => toggleDay(day)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-light ${active ? 'bg-event-training text-white shadow-sm' : 'text-muted hover:text-ink'}`}>
                    {t.schedule.days[day]}
                  </button>
                )
              })}
            </div>
            <input type="hidden" name="repeat_days" value={days.join(',')} />
          </div>

          <div>
            <label htmlFor={untilId} className="block text-sm font-semibold text-muted mb-1.5">{r.endDateLabel}</label>
            <input id={untilId} name="repeat_until" type="date" required min={startDate || undefined}
              value={until} onChange={(e) => onUntilChange(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink" />
            {(showEndDateHint || seasonEndPast) && until === '' && (
              <p className="text-xs text-faint mt-1.5">
                {seasonEndPast ? r.endDateSeasonOverHint : r.endDateRequiredHint}
              </p>
            )}
          </div>

          <p aria-live="polite" className="empty:hidden">
            {planError ? (
              <span className="block bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-4 py-3 rounded-xl">
                {recurringErrorText(t, planError)}
              </span>
            ) : plan && plan.ok && plan.dates.length === 0 ? (
              <span className="block bg-surface border border-[var(--border-soft)] text-muted text-sm px-4 py-3 rounded-xl">
                {r.counterNoDays}
              </span>
            ) : plan && plan.ok ? (
              <span className="block bg-panel-green border border-panel-green-edge rounded-xl px-4 py-3 text-sm text-panel-green-ink font-medium">
                {plan.toCreate.length === 1 ? r.counterOne : r.counter.replace('{n}', String(plan.toCreate.length))}
                {dayNames && <span className="text-panel-green-ink/80 font-normal"> · {dayNames}</span>}
                {plan.skipped > 0 && (
                  <span className="block text-panel-green-ink/80 font-normal">
                    {r.counterSkipped.replace('{n}', String(plan.skipped))}
                  </span>
                )}
                {existingCheckFailed && (
                  <span className="block text-panel-green-ink/80 font-normal">{r.counterCheckFailed}</span>
                )}
              </span>
            ) : null}
          </p>
        </div>
      )}
    </div>
  )
}
