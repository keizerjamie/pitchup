'use client'

import { useState, useTransition } from 'react'
import { CYCLE_LENGTH_WEEKS } from '@/lib/periodization'
import { saveCyclusWeekCorrectie, deleteCyclusWeekCorrectie } from '@/app/actions/periodisering'
import { useDict } from '@/lib/i18n-context'

interface Props {
  // Voorselectie in de sheet — de effectieve week van vandaag. `null` (nog
  // geen enkele nulmeting én geen correctie) valt terug op week 1.
  huidigeWeek: number | null
  // Toont de "Terug naar automatisch"-knop; alleen zinvol als er iets is om
  // naar terug te vallen.
  heeftCorrectie: boolean
  // De trigger-knop staat op twee verschillende achtergronden (donkere
  // cyclus-kaart, lichte lege-staat-kaart) en heeft dus per plek eigen styling.
  triggerClassName?: string
}

const WEEKS = Array.from({ length: CYCLE_LENGTH_WEEKS }, (_, i) => i + 1)

// Sheet-markup één-op-één van components/NulmetingManager.tsx (container,
// backdrop, paneel, sticky kop/voet, foutbalk): dezelfde patronen, nu voor het
// instellen van de cyclusweek in plaats van een nulmeting.
export default function CyclusWeekCorrectie({ huidigeWeek, heeftCorrectie, triggerClassName }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [gekozenWeek, setGekozenWeek] = useState(huidigeWeek ?? 1)
  const [error, setError] = useState<string | null>(null)

  function openSheet() {
    setGekozenWeek(huidigeWeek ?? 1)
    setError(null)
    setOpen(true)
  }

  function closeSheet() {
    setOpen(false)
  }

  // Spiegel van translateError in NulmetingManager.tsx: alleen de fout die de
  // gebruiker hier daadwerkelijk kan veroorzaken (ongeldige week) krijgt een
  // eigen tekst; al het overige (sessieverval, DB-fout) valt terug op de
  // generieke foutmelding.
  function translateError(err: unknown): string {
    if (err instanceof Error && err.message === 'Ongeldige cyclusweek') {
      return t.periodization.errorInvalidWeek
    }
    return t.oefeningen.genericError
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      try {
        await saveCyclusWeekCorrectie(gekozenWeek)
        setOpen(false)
      } catch (err) {
        setError(translateError(err))
      }
    })
  }

  function handleBackToAutomatic() {
    setError(null)
    startTransition(async () => {
      try {
        await deleteCyclusWeekCorrectie()
        setOpen(false)
      } catch (err) {
        setError(translateError(err))
      }
    })
  }

  return (
    <>
      <button type="button" onClick={openSheet} className={triggerClassName}>
        {t.periodization.adjustWeekCta}
      </button>

      {open && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeSheet} />
          <div className="relative w-full max-w-lg bg-surface rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92dvh] overflow-y-auto animate-scale-in">
            <div className="sticky top-0 bg-surface border-b border-[var(--border-soft)] px-5 py-4 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl">
              <h3 className="font-bold text-ink text-lg">{t.periodization.adjustWeekTitle}</h3>
              <button
                type="button"
                onClick={closeSheet}
                aria-label={t.trainingPlan.cancel}
                className="w-8 h-8 rounded-full bg-surface-sunken flex items-center justify-center text-faint hover:bg-surface-sunken"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-faint">{t.periodization.adjustWeekHint}</p>

              {error && (
                <div className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-4 py-3 rounded-xl">{error}</div>
              )}

              <div role="radiogroup" aria-labelledby="cyclus-week-legend">
                <p id="cyclus-week-legend" className="block text-sm font-semibold text-muted mb-1.5">
                  {t.periodization.adjustWeekLegend}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {WEEKS.map((n) => {
                    const gekozen = gekozenWeek === n
                    return (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={gekozen}
                        onClick={() => setGekozenWeek(n)}
                        className={`rounded-xl py-2.5 text-[13px] font-bold transition-colors active:scale-[0.97] ${
                          gekozen
                            ? 'bg-brand text-white'
                            : 'bg-surface-sunken text-muted border border-[var(--border-soft)]'
                        }`}
                      >
                        {t.periodization.adjustWeekOption.replace('{n}', String(n))}
                      </button>
                    )
                  })}
                </div>
              </div>

              {heeftCorrectie && (
                <button
                  type="button"
                  onClick={handleBackToAutomatic}
                  disabled={isPending}
                  className="text-xs font-semibold text-brand px-3 py-1.5 rounded-lg border border-[var(--border-soft)] hover:border-brand/40 transition active:scale-[0.97] disabled:opacity-60"
                >
                  {t.periodization.backToAutomatic}
                </button>
              )}
            </div>

            <div className="sticky bottom-0 bg-surface border-t border-[var(--border-soft)] p-4 flex gap-3">
              <button
                type="button"
                onClick={closeSheet}
                className="flex-1 py-3 rounded-xl border-2 border-[var(--border-soft)] font-semibold text-muted hover:text-ink transition active:scale-[0.97]"
              >
                {t.trainingPlan.cancel}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="flex-1 py-3 rounded-xl bg-brand hover:bg-brand-dark text-white font-semibold transition active:scale-[0.97] disabled:opacity-50"
              >
                {isPending ? t.periodization.saving : t.periodization.saveWeek}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
