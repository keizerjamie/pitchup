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
      <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5">
        <h2 className="font-bold text-purple-900 text-lg mb-1">{t.periodization.title}</h2>
        <p className="text-sm text-purple-700">{t.periodization.hint}</p>
      </div>

      {/* Step inputs */}
      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
        {METING_CATEGORIES.map((cat) => {
          const stepKey = `${cat.key}_stap`
          const currentStep = steps[stepKey] ?? 1
          return (
            <div key={cat.key} className="p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 text-sm">{cat.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">max {cat.maxStap} stappen</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleStepChange(stepKey, String(Math.max(1, currentStep - 1)))}
                  className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 active:scale-90 transition-all flex items-center justify-center text-gray-600 font-bold text-lg"
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
                    className="w-full text-center px-2 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 font-semibold text-gray-900"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleStepChange(stepKey, String(Math.min(cat.maxStap, currentStep + 1)))}
                  className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 active:scale-90 transition-all flex items-center justify-center text-gray-600 font-bold text-lg"
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
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
        <p className="text-xs text-emerald-700">{t.periodization.steigerungsNote}</p>
      </div>

      {/* Notes */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">{t.event.notes}</label>
        <textarea
          rows={3}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={t.event.notesMeetingPlaceholder}
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 text-gray-900 placeholder-gray-400 resize-none text-sm"
        />
      </div>

      {/* Save button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={isPending}
        className={`w-full py-3.5 rounded-xl font-semibold transition-all active:scale-95 text-sm ${
          saved
            ? 'bg-green-600 text-white'
            : 'bg-purple-600 hover:bg-purple-700 text-white'
        } ${isPending ? 'opacity-60' : ''}`}
      >
        {saved ? t.periodization.saved : isPending ? t.periodization.saving : t.periodization.save}
      </button>
    </div>
  )
}
