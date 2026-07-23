'use client'

import { useState, useTransition } from 'react'
import { PERIODIZATION_CATEGORIES } from '@/lib/types'
import { saveNulmeting, deleteNulmeting, MetingSteps } from '@/app/actions/training-plan'
import { formatDate, todayLocal } from '@/lib/utils'
import { useDict } from '@/lib/i18n-context'

const METING_CATEGORIES = PERIODIZATION_CATEGORIES.filter((c) => c.hasMeting)

const DEFAULT_STEPS: MetingSteps = {
  partijen_groot_stap: 1,
  partijen_midden_stap: 1,
  partijen_klein_stap: 1,
  sprints_weinig_rust_stap: 1,
  sprints_veel_rust_stap: 1,
}

export interface NulmetingHistoryItem {
  eventId: string
  date: string
  notes: string | null
  steps: MetingSteps
}

interface Props {
  history: NulmetingHistoryItem[]
}

export default function NulmetingManager({ history }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [date, setDate] = useState(todayLocal())
  const [steps, setSteps] = useState<MetingSteps>(DEFAULT_STEPS)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const hasHistory = history.length > 0
  const latestId = history[0]?.eventId ?? null

  function openNew() {
    setEditingId(null)
    setDate(todayLocal())
    setSteps(DEFAULT_STEPS)
    setNotes('')
    setError(null)
    setSheetOpen(true)
  }

  function openEdit(item: NulmetingHistoryItem) {
    setEditingId(item.eventId)
    setDate(item.date)
    setSteps(item.steps)
    setNotes(item.notes ?? '')
    setError(null)
    setSheetOpen(true)
  }

  function changeStep(key: keyof MetingSteps, delta: number, max: number) {
    setSteps((prev) => ({ ...prev, [key]: Math.max(1, Math.min(max, prev[key] + delta)) }))
  }

  function setStepValue(key: keyof MetingSteps, raw: string, max: number) {
    const n = parseInt(raw, 10)
    if (!isNaN(n)) setSteps((prev) => ({ ...prev, [key]: Math.max(1, Math.min(max, n)) }))
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      try {
        await saveNulmeting({ eventId: editingId ?? undefined, date, steps, notes: notes || null })
        setSheetOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Opslaan mislukt')
      }
    })
  }

  function handleDelete(eventId: string) {
    if (!confirm(t.periodization.deleteConfirm)) return
    startTransition(async () => {
      await deleteNulmeting(eventId)
    })
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={openNew}
        className="w-full bg-brand text-white py-3 rounded-xl font-semibold hover:bg-brand-dark active:scale-95 transition-all"
      >
        {hasHistory ? t.periodization.newNulmeting : t.periodization.startCta}
      </button>

      {/* History */}
      {hasHistory && (
        <div className="surface-card rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/50">
            <h2 className="font-semibold text-ink">{t.periodization.history}</h2>
          </div>
          <div className="divide-y divide-[var(--border-soft)]">
            {history.map((item) => (
              <div key={item.eventId} className="px-5 py-3.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink text-sm">{formatDate(item.date, t.browserLocale)}</div>
                  <div className="text-xs text-faint mt-0.5">
                    {METING_CATEGORIES.map((c) => item.steps[`${c.key}_stap` as keyof MetingSteps]).join(' · ')}
                    {item.notes && <span className="ml-2 text-faint italic">{item.notes}</span>}
                  </div>
                </div>
                {item.eventId === latestId && (
                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    className="text-xs font-semibold text-brand px-3 py-1.5 rounded-lg border border-[var(--border-soft)] hover:border-brand/40 transition-colors flex-shrink-0"
                  >
                    {t.periodization.editNulmeting}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(item.eventId)}
                  disabled={isPending}
                  aria-label={t.periodization.deleteNulmeting}
                  className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-faint hover:text-red-500 transition-colors flex-shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Editor sheet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSheetOpen(false)} />
          <div className="relative w-full max-w-lg bg-surface rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92dvh] overflow-y-auto">
            <div className="sticky top-0 bg-surface border-b border-[var(--border-soft)] px-5 py-4 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl">
              <h3 className="font-bold text-ink text-lg">
                {editingId ? t.periodization.editNulmeting : t.periodization.newNulmeting}
              </h3>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label={t.trainingPlan.cancel}
                className="w-8 h-8 rounded-full bg-surface-sunken flex items-center justify-center text-faint hover:bg-surface-sunken"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-faint">{t.periodization.hint}</p>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>
              )}

              <div>
                <label className="block text-sm font-semibold text-muted mb-1.5">{t.periodization.date}</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink"
                />
              </div>

              <div className="rounded-2xl border border-[var(--border-soft)] divide-y divide-[var(--border-soft)]">
                {METING_CATEGORIES.map((cat) => {
                  const stepKey = `${cat.key}_stap` as keyof MetingSteps
                  const current = steps[stepKey]
                  return (
                    <div key={cat.key} className="p-4 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-ink text-sm">{t.periodization.categories[cat.key] ?? cat.label}</div>
                        <div className="text-xs text-faint mt-0.5">{t.periodization.maxSteps.replace('{n}', String(cat.maxStap))}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => changeStep(stepKey, -1, cat.maxStap)}
                          className="w-8 h-8 rounded-lg bg-surface-sunken hover:bg-surface-sunken active:scale-90 transition-all flex items-center justify-center text-muted font-bold text-lg"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={cat.maxStap}
                          value={current}
                          onChange={(e) => setStepValue(stepKey, e.target.value, cat.maxStap)}
                          className="w-14 text-center px-2 py-1.5 rounded-lg border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light font-semibold text-ink"
                        />
                        <button
                          type="button"
                          onClick={() => changeStep(stepKey, 1, cat.maxStap)}
                          className="w-8 h-8 rounded-lg bg-surface-sunken hover:bg-surface-sunken active:scale-90 transition-all flex items-center justify-center text-muted font-bold text-lg"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div>
                <label className="block text-sm font-semibold text-muted mb-1.5">{t.event.notes}</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t.event.notesMeetingPlaceholder}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-ink placeholder:text-faint resize-none text-sm"
                />
              </div>
            </div>

            <div className="sticky bottom-0 bg-surface border-t border-[var(--border-soft)] p-4 flex gap-3">
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="flex-1 py-3 rounded-xl border-2 border-[var(--border-soft)] font-semibold text-muted hover:text-ink transition-all active:scale-95"
              >
                {t.trainingPlan.cancel}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="flex-1 py-3 rounded-xl bg-brand hover:bg-brand-dark text-white font-semibold transition-all active:scale-95 disabled:opacity-50"
              >
                {isPending ? t.periodization.saving : t.periodization.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
