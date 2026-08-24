'use client'

import { useState, useTransition } from 'react'
import { kopieerTrainingsplan } from '@/app/actions/training-plan'
import { formatDateLong } from '@/lib/utils'
import { useDict } from '@/lib/i18n-context'

export interface KopieerOptie {
  id: string
  date: string
  aantal: number
}

// "Kopieer van vorige training" in de lege staat van de planner.
//
// Weken lijken op elkaar: dezelfde warming-up, dezelfde partijvorm, één blok
// anders. Opnieuw samenstellen kostte evenveel handelingen als de eerste keer.
//
// Alleen zichtbaar zolang het plan leeg is (de aanroeper regelt dat): kopiëren
// plakt de oefeningen áchter wat er staat, en dat is bij een half gevuld plan
// zelden wat je bedoelt.
export default function KopieerVorigeTraining({
  eventId,
  opties,
}: {
  eventId: string
  opties: KopieerOptie[]
}) {
  const t = useDict()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Zonder bruikbare bron heeft de knop geen functie. Niets tonen is hier
  // beter dan een knop die een lege lijst opent.
  if (opties.length === 0) return null

  function kopieer(bronId: string) {
    setError(null)
    startTransition(async () => {
      try {
        await kopieerTrainingsplan(eventId, bronId)
        setOpen(false)
      } catch {
        // Nooit de rauwe serverfout tonen — zelfde principe als de andere
        // editors op deze pagina.
        setError(t.trainingPlan.copyPreviousError)
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="print:hidden w-full py-3 rounded-xl border border-[var(--border-soft)] bg-surface text-muted hover:text-ink font-semibold text-sm transition active:scale-[0.98]"
      >
        {t.trainingPlan.copyPrevious}
      </button>

      {open && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center print:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md bg-surface rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92dvh] overflow-y-auto">
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-soft)' }}>
              <h3 className="font-bold text-ink text-lg">{t.trainingPlan.copyPreviousTitle}</h3>
              <p className="text-xs text-faint mt-1">{t.trainingPlan.copyPreviousHint}</p>
            </div>

            <div className="p-5 flex flex-col gap-2">
              {error && (
                <div className="rounded-xl bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-4 py-3">
                  {error}
                </div>
              )}

              {opties.map((optie) => (
                <button
                  key={optie.id}
                  type="button"
                  disabled={isPending}
                  onClick={() => kopieer(optie.id)}
                  className="w-full text-left bg-surface rounded-xl border border-[var(--border-soft)] hover:border-warning/50 hover:bg-warning/10 px-4 py-3 transition-colors disabled:opacity-50"
                >
                  <div className="font-semibold text-ink text-sm">{formatDateLong(optie.date, t.browserLocale)}</div>
                  <div className="text-xs text-faint mt-0.5">
                    {t.trainingPlan.copyPreviousCount.replace('{n}', String(optie.aantal))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
