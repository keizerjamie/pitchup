'use client'

import { useState, useTransition } from 'react'
import { PERIODIZATION_CATEGORIES, MetingData } from '@/lib/types'
import { saveMeting } from '@/app/actions/training-plan'
import { useDict } from '@/lib/i18n-context'

interface Props {
  eventId: string
  initialMeting: MetingData | null
}

const METING_CATEGORIES = PERIODIZATION_CATEGORIES.filter(c => c.hasMeting)

export default function MetingEditor({ eventId, initialMeting }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  const [steps, setSteps] = useState<Record<string, number>>({
    partijen_groot_stap:      initialMeting?.partijen_groot_stap      ?? 1,
    partijen_midden_stap:     initialMeting?.partijen_midden_stap     ?? 1,
    partijen_klein_stap:      initialMeting?.partijen_klein_stap      ?? 1,
    sprints_weinig_rust_stap: initialMeting?.sprints_weinig_rust_stap ?? 1,
    sprints_veel_rust_stap:   initialMeting?.sprints_veel_rust_stap   ?? 1,
  })
  const [notes, setNotes] = useState(initialMeting?.notes ?? '')

  function handleStepChange(key: string, value: string) {
    const n = parseInt(value, 10)
    if (!isNaN(n)) setSteps(prev => ({ ...prev, [key]: n }))
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await saveMeting(eventId, {
          partijen_groot_stap:      steps.partijen_groot_stap,
          partijen_midden_stap:     steps.partijen_midden_stap,
          partijen_klein_stap:      steps.partijen_klein_stap,
          sprints_weinig_rust_stap: steps.sprints_weinig_rust_stap,
          sprints_veel_rust_stap:   steps.sprints_veel_rust_stap,
        }, notes || null)
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } catch {
        // silent — the revalidate will refresh the data
      }
    })
  }

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="bg-panel-purple border border-panel-purple-edge rounded-2xl p-5">
        <h2 className="font-bold text-panel-purple-ink text-lg mb-1">{t.periodization.title}</h2>
        <p className="text-sm text-panel-purple-ink">{t.periodization.hint}</p>
      </div>

      {/* Step inputs */}
      <div className="bg-surface rounded-2xl border border-[var(--border-soft)] divide-y divide-[var(--border-soft)]">
        {METING_CATEGORIES.map((cat) => {
          const stepKey = `${cat.key}_stap`
          const currentStep = steps[stepKey] ?? 1
          return (
            <div key={cat.key} className="p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ink text-sm">{cat.label}</div>
                <div className="text-xs text-faint mt-0.5">max {cat.maxStap} stappen</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleStepChange(stepKey, String(Math.max(1, currentStep - 1)))}
                  className="w-8 h-8 rounded-lg bg-surface-sunken hover:bg-[var(--track)] active:scale-90 transition flex items-center justify-center text-muted font-bold text-lg"
                >
                  −
                </button>
                <div className="w-16">
                  <input
                    type="number"
                    min={1}
                    max={cat.maxStap}
                    value={currentStep}
                    onChange={e => handleStepChange(stepKey, e.target.value)}
                    className="w-full text-center px-2 py-1.5 rounded-lg border border-[var(--border-soft)] focus:outline-none focus:border-panel-purple-ink focus:ring-2 focus:ring-panel-purple-ink/30 font-semibold text-ink"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleStepChange(stepKey, String(Math.min(cat.maxStap, currentStep + 1)))}
                  className="w-8 h-8 rounded-lg bg-surface-sunken hover:bg-[var(--track)] active:scale-90 transition flex items-center justify-center text-muted font-bold text-lg"
                >
                  +
                </button>
                <span className={`text-xs font-medium px-2 py-1 rounded-full min-w-0 ${cat.color}`}>
                  {t.periodization.step} {currentStep}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Steigerungs note */}
      <div className="bg-panel-green border border-panel-green-edge rounded-xl p-3">
        <p className="text-xs text-panel-green-ink">{t.periodization.steigerungsNote}</p>
      </div>

      {/* Notes */}
      <div className="bg-surface rounded-2xl border border-[var(--border-soft)] p-4">
        <label className="block text-sm font-semibold text-muted mb-2">{t.event.notes}</label>
        <textarea
          rows={3}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={t.event.notesMeetingPlaceholder}
          className="w-full px-3 py-2.5 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-panel-purple-ink focus:ring-2 focus:ring-panel-purple-ink/30 text-ink placeholder-faint resize-none text-sm"
        />
      </div>

      {/* Save button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={isPending}
        className={`w-full py-3.5 rounded-xl font-semibold transition active:scale-95 text-sm ${
          saved
            ? 'bg-primary text-white'
            : 'bg-panel-purple-solid hover:bg-panel-purple-solid/90 text-white'
        } ${isPending ? 'opacity-60' : ''}`}
      >
        {saved ? t.periodization.saved : isPending ? t.periodization.saving : t.periodization.save}
      </button>
    </div>
  )
}
