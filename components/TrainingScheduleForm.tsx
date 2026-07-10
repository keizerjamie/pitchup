'use client'

import { useState, useTransition } from 'react'
import { saveScheduleSettings, generateSeasonTrainings, deleteSeasonTrainings } from '@/app/actions/settings'
import { useDict } from '@/lib/i18n-context'

interface Props {
  initialSeasonStart: string
  initialSeasonEnd: string
  initialDays: number[]
  initialTime: string
  initialLocation: string
}

export default function TrainingScheduleForm({ initialSeasonStart, initialSeasonEnd, initialDays, initialTime, initialLocation }: Props) {
  const t = useDict()
  const [selectedDays, setSelectedDays] = useState<number[]>(initialDays)
  const [seasonStart, setSeasonStart] = useState(initialSeasonStart)
  const [seasonEnd, setSeasonEnd] = useState(initialSeasonEnd)
  const [saved, setSaved] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, startSave] = useTransition()
  const [isGenerating, startGenerate] = useTransition()

  const DAYS = [1, 2, 3, 4, 5, 6, 0].map((v) => ({ label: t.schedule.days[v], value: v }))

  function toggleDay(day: number) {
    setSelectedDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day])
  }

  function countTrainings(): number {
    if (!seasonStart || !seasonEnd || selectedDays.length === 0) return 0
    const start = new Date(seasonStart + 'T00:00:00')
    const end = new Date(seasonEnd + 'T00:00:00')
    if (end < start) return 0
    let count = 0
    const cursor = new Date(start)
    while (cursor <= end) {
      if (selectedDays.includes(cursor.getDay())) count++
      cursor.setDate(cursor.getDate() + 1)
    }
    return count
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set('training_days', selectedDays.join(','))
    startSave(async () => {
      await saveScheduleSettings(formData)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  async function handleGenerate() {
    setError(null); setResult(null)
    startGenerate(async () => {
      try { setResult(await generateSeasonTrainings()) }
      catch (e: unknown) { setError(e instanceof Error ? e.message : t.schedule.errorDefault) }
    })
  }

  async function handleRegenerate() {
    if (!confirm(t.schedule.confirmRegenerate)) return
    setError(null); setResult(null)
    startGenerate(async () => {
      try {
        await deleteSeasonTrainings()
        setResult(await generateSeasonTrainings())
      } catch (e: unknown) { setError(e instanceof Error ? e.message : t.schedule.errorDefault) }
    })
  }

  const trainingCount = countTrainings()

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.schedule.seasonStart}</label>
          <input name="season_start" type="date" value={seasonStart} onChange={(e) => setSeasonStart(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-gray-900 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.schedule.seasonEnd}</label>
          <input name="season_end" type="date" value={seasonEnd} onChange={(e) => setSeasonEnd(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-gray-900 text-sm" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">{t.schedule.trainingDays}</label>
        <div className="flex gap-2">
          {DAYS.map((day) => (
            <button key={day.value} type="button" onClick={() => toggleDay(day.value)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${selectedDays.includes(day.value) ? 'bg-brand text-white border-brand' : 'bg-white text-gray-500 border-gray-200 hover:border-accent'}`}>
              {day.label}
            </button>
          ))}
        </div>
        <input type="hidden" name="training_days" value={selectedDays.join(',')} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
            {t.schedule.time} <span className="text-gray-400 font-normal">({t.schedule.optional})</span>
          </label>
          <input name="training_time" type="time" defaultValue={initialTime}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-gray-900 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
            {t.schedule.location} <span className="text-gray-400 font-normal">({t.schedule.optional})</span>
          </label>
          <input name="training_location" type="text" defaultValue={initialLocation} placeholder="Sportpark de Meent"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-gray-900 placeholder-gray-400 text-sm" />
        </div>
      </div>

      {trainingCount > 0 && (
        <div className="bg-brand-light rounded-xl px-4 py-3 text-sm text-brand font-medium">
          {trainingCount} {t.schedule.trainingsInSeason}
          {selectedDays.length > 0 && (
            <span className="text-brand/70 font-normal">
              {' '}· {DAYS.filter((d) => selectedDays.includes(d.value)).map((d) => d.label).join(' + ')}
            </span>
          )}
        </div>
      )}

      <button type="submit" disabled={isSaving}
        className="w-full bg-brand text-white py-3 rounded-xl font-semibold hover:bg-brand-dark active:scale-95 transition-all disabled:opacity-60">
        {saved ? t.schedule.saved : isSaving ? t.schedule.saving : t.schedule.saveSchedule}
      </button>

      {trainingCount > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={handleGenerate} disabled={isGenerating}
            className="w-full py-3 rounded-xl font-semibold border-2 border-brand text-brand hover:bg-brand-light active:scale-95 transition-all disabled:opacity-60">
            {isGenerating ? t.schedule.busy : `${t.schedule.generate} ${trainingCount} ${t.schedule.trainingsWord}`}
          </button>
          <button type="button" onClick={handleRegenerate} disabled={isGenerating}
            className="w-full py-2.5 rounded-xl text-sm font-semibold border border-red-200 text-red-600 hover:bg-red-50 active:scale-95 transition-all disabled:opacity-60">
            {isGenerating ? t.schedule.busy : t.schedule.regenerate}
          </button>
        </div>
      )}

      {result && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 font-medium">
          ✓ {result.created} {t.schedule.created}
          {result.skipped > 0 && ` · ${result.skipped} ${t.schedule.skipped}`}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>
      )}
    </form>
  )
}
