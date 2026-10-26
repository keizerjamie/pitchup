'use client'

import { useState, useTransition } from 'react'
import { CYCLE_LENGTH_WEEKS } from '@/lib/periodization'
import { saveCyclusWeekCorrectie, deleteCyclusWeekCorrectie } from '@/app/actions/periodisering'
import { useDict } from '@/lib/i18n-context'
import BottomSheet from '@/components/ui/BottomSheet'

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
  // Periodisering-recht (brief §4.5). Default true, zelfde reden als
  // components/LineupBuilder.tsx. De effectieve week zelf staat elders op de
  // pagina als platte tekst — dit component IS uitsluitend de bewerkactie.
  canEdit?: boolean
}

const WEEKS = Array.from({ length: CYCLE_LENGTH_WEEKS }, (_, i) => i + 1)

// Sheet via de gedeelde components/ui/BottomSheet (zelfde als NulmetingManager),
// nu voor het instellen van de cyclusweek in plaats van een nulmeting.
export default function CyclusWeekCorrectie({ huidigeWeek, heeftCorrectie, triggerClassName, canEdit = true }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [gekozenWeek, setGekozenWeek] = useState(huidigeWeek ?? 1)
  // Week op het moment van openen: basis voor de dirty-waarschuwing.
  const [beginWeek, setBeginWeek] = useState(huidigeWeek ?? 1)
  const [error, setError] = useState<string | null>(null)

  function openSheet() {
    setGekozenWeek(huidigeWeek ?? 1)
    setBeginWeek(huidigeWeek ?? 1)
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

  // Zonder Periodisering-recht is dit uitsluitend een bewerkactie — de
  // effectieve week zelf blijft elders op de pagina leesbaar.
  if (!canEdit) return null

  return (
    <>
      <button type="button" onClick={openSheet} className={triggerClassName}>
        {t.periodization.adjustWeekCta}
      </button>

      {open && (
        <BottomSheet
          onClose={closeSheet}
          titel={t.periodization.adjustWeekTitle}
          sluitLabel={t.trainingPlan.cancel}
          dirty={gekozenWeek !== beginWeek}
          voet={
            <>
              <button
                type="button"
                onClick={closeSheet}
                className="flex-1 h-12 rounded-full border-2 border-[var(--border-soft)] font-semibold text-muted hover:text-ink transition active:scale-[0.97]"
              >
                {t.trainingPlan.cancel}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="flex-1 h-12 rounded-full bg-primary hover:bg-primary/90 text-white font-semibold transition active:scale-[0.97] disabled:opacity-50"
              >
                {isPending ? t.periodization.saving : t.periodization.saveWeek}
              </button>
            </>
          }
        >
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
                          ? 'bg-primary text-white'
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
                className="text-xs font-semibold text-brand-accent px-3 py-1.5 rounded-full border border-[var(--border-soft)] hover:border-brand-accent/50 transition active:scale-[0.97] disabled:opacity-60"
              >
                {t.periodization.backToAutomatic}
              </button>
            )}
          </div>
        </BottomSheet>
      )}
    </>
  )
}
