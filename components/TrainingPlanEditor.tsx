'use client'

import { useState, useTransition, useRef } from 'react'
import Link from 'next/link'
import { Oefening, OefeningCategorie, PERIODIZATION_CATEGORIES, Player, Spelerindeling, TrainingOefeningWithData, formationsForSize } from '@/lib/types'
import { saveDoelstelling } from '@/app/actions/training-plan'
import { removeOefeningFromTraining, updateKoppeling, reorderKoppelingen } from '@/app/actions/training-plan'
import FormationField from '@/components/FormationField'
import DiagramView from '@/components/DiagramView'
import OefeningPicker from '@/components/OefeningPicker'
import TeamIndelingEditor from '@/components/TeamIndelingEditor'
import { useDict } from '@/lib/i18n-context'

interface Props {
  eventId: string
  initialDoelstelling: string | null
  initialOefeningen: TrainingOefeningWithData[]
  library: Oefening[]
  currentSteps: Record<string, number | null>
  hasNulmeting: boolean
  suggestion: { week: number; items: { key: string; step: number | null }[] } | null
  players: Player[]
  presentPlayerIds: string[]
}

const ALL_CATS = PERIODIZATION_CATEGORIES

// Stabiele fallback-referentie voor een ontbrekende `spelerindeling` (bv. vóór
// migratie). Een inline `?? []` zou bij elke render van deze parent een
// nieuwe array-identiteit opleveren, waardoor TeamIndelingEditor's
// referentie-vergelijking (`prevInitial !== initialIndeling`) onterecht
// telkens opnieuw synct — en daarmee o.a. een net getoonde foutmelding
// voortijdig wegvaagt. Door dezelfde module-constante door te geven, blijft
// de referentie stabiel zolang `spelerindeling` zelf niet verandert.
const EMPTY_INDELING: Spelerindeling = []

export default function TrainingPlanEditor({ eventId, initialDoelstelling, initialOefeningen, library, currentSteps, hasNulmeting, suggestion, players, presentPlayerIds }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [doelstelling, setDoelstelling] = useState(initialDoelstelling ?? '')
  const [doelstellingSaved, setDoelstellingSaved] = useState(false)
  const [koppelingen, setKoppelingen] = useState<TrainingOefeningWithData[]>(initialOefeningen)

  // Sync when server revalidates and parent sends fresh data
  // (adjust-state-during-render pattern instead of a cascading effect)
  const [prevInitial, setPrevInitial] = useState(initialOefeningen)
  if (prevInitial !== initialOefeningen) {
    setPrevInitial(initialOefeningen)
    setKoppelingen(initialOefeningen)
  }

  const [showPicker, setShowPicker] = useState(false)
  const [pickerPresetCategorie, setPickerPresetCategorie] = useState<OefeningCategorie | undefined>(undefined)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [unlinkConfirm, setUnlinkConfirm] = useState<string | null>(null)
  const doelstellingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleDoelstellingChange(val: string) {
    setDoelstelling(val)
    setDoelstellingSaved(false)
    if (doelstellingTimer.current) clearTimeout(doelstellingTimer.current)
    doelstellingTimer.current = setTimeout(() => {
      startTransition(async () => {
        await saveDoelstelling(eventId, val)
        setDoelstellingSaved(true)
        setTimeout(() => setDoelstellingSaved(false), 2000)
      })
    }, 1000)
  }

  function openPicker() {
    setPickerPresetCategorie(undefined)
    setShowPicker(true)
  }

  function openSuggestedPicker(categorie: OefeningCategorie) {
    setPickerPresetCategorie(categorie)
    setShowPicker(true)
  }

  function handleUnlink(koppelingId: string) {
    startTransition(async () => {
      setKoppelingen((prev) => prev.filter((k) => k.id !== koppelingId))
      setUnlinkConfirm(null)
      await removeOefeningFromTraining(koppelingId, eventId)
    })
  }

  function move(index: number, dir: -1 | 1) {
    const newIndex = index + dir
    if (newIndex < 0 || newIndex >= koppelingen.length) return
    const reordered = [...koppelingen]
    const [item] = reordered.splice(index, 1)
    reordered.splice(newIndex, 0, item)
    setKoppelingen(reordered)
    startTransition(async () => {
      await reorderKoppelingen(eventId, reordered.map((k) => k.id))
    })
  }

  function handleStepOverrideChange(koppelingId: string, raw: string) {
    const value = raw === '' ? null : Math.max(1, Math.min(99, parseInt(raw, 10) || 1))
    setKoppelingen((prev) => prev.map((k) => (k.id === koppelingId ? { ...k, stap_override: value } : k)))
    startTransition(async () => {
      await updateKoppeling(koppelingId, eventId, { stap_override: value })
    })
  }

  function handleGenestInChange(koppelingId: string, raw: string) {
    const genest_in = raw || null
    setKoppelingen((prev) => prev.map((k) => (k.id === koppelingId ? { ...k, genest_in } : k)))
    startTransition(async () => {
      await updateKoppeling(koppelingId, eventId, { genest_in })
    })
  }

  const catLabel = (key: string) => t.periodization.categories[key] ?? key

  const stepForCategory = (cat: string): string => {
    const s = currentSteps[cat]
    if (s === null || s === undefined) return ''
    const max = ALL_CATS.find((c) => c.key === cat)?.maxStap ?? '?'
    return `${t.trainingPlan.stepBadge} ${s}/${max}`
  }

  return (
    <div className="space-y-6">

      {/* Auto-save reassurance — there is no explicit save button */}
      <p className="flex items-center gap-1.5 text-xs text-faint -mb-2">
        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {t.trainingPlan.autoSaveHint}
      </p>

      {/* Doelstelling */}
      <div className="bg-surface rounded-2xl border border-[var(--border-soft)] p-5">
        <label className="block text-sm font-semibold text-muted mb-2 flex items-center justify-between">
          {t.trainingPlan.objective}
          {doelstellingSaved && (
            <span className="text-xs text-green-600 font-normal">{t.trainingPlan.saved}</span>
          )}
        </label>
        <textarea
          rows={2}
          value={doelstelling}
          onChange={e => handleDoelstellingChange(e.target.value)}
          placeholder={t.trainingPlan.objectivePlaceholder}
          className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] bg-surface focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-ink placeholder:text-faint resize-none text-sm"
        />
      </div>

      {/* Cycle-week suggestion */}
      {suggestion && suggestion.items.length > 0 && (
        <div className="bg-surface rounded-r-2xl border border-orange-200 border-l-[3px] border-l-orange-500 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
              {t.periodization.suggestTitle}
            </p>
            <span className="text-xs font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
              {t.periodization.cycleWeek.replace('{n}', String(suggestion.week))}
            </span>
          </div>
          <div className="divide-y divide-[var(--border-soft)]">
            {suggestion.items.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm text-ink">
                  {catLabel(item.key)}
                  {item.step !== null && (
                    <span className="text-faint"> · {t.periodization.step} {item.step}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => openSuggestedPicker(item.key as OefeningCategorie)}
                  className="text-xs font-semibold text-orange-600 border border-orange-200 hover:border-orange-400 hover:bg-orange-50 rounded-lg px-3 py-1.5 transition-colors active:scale-95 flex-shrink-0"
                >
                  + {t.periodization.suggestAdd}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Periodization status */}
      {hasNulmeting ? (
        <div className="bg-surface rounded-2xl border border-[var(--border-soft)] p-4">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">
            {t.periodization.currentSteps} {t.periodization.forTraining}
          </p>
          <div className="flex flex-wrap gap-2">
            {ALL_CATS.filter(c => c.hasMeting).map(cat => {
              const s = currentSteps[cat.key]
              return (
                <span key={cat.key} className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cat.color}`}>
                  {cat.label}: {s !== null ? `${t.periodization.step} ${s}` : '–'}
                </span>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
          <p className="text-sm text-amber-800 flex-1">{t.trainingPlan.nulmetingNeeded}</p>
          <Link
            href="/periodisering"
            className="text-xs font-semibold text-amber-900 border border-amber-300 hover:bg-amber-100 rounded-lg px-3 py-1.5 transition-colors flex-shrink-0"
          >
            {t.trainingPlan.nulmetingLink}
          </Link>
        </div>
      )}

      {/* Exercises */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">{t.trainingPlan.exercisesHeading}</h2>
          <button
            type="button"
            onClick={openPicker}
            className="text-sm font-semibold text-orange-600 hover:text-orange-700 active:scale-95 transition-all"
          >
            {t.trainingPlan.addExercise}
          </button>
        </div>

        {koppelingen.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-[var(--border-soft)] p-8 text-center">
            <svg className="w-9 h-9 mx-auto mb-2 text-faint" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <p className="font-medium text-muted">{t.trainingPlan.noExercises}</p>
            <p className="text-sm text-faint mt-1">{t.trainingPlan.noExercisesHint}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {koppelingen.map((k, idx) => {
              const o = k.oefeningen
              const catStep = currentSteps[o.categorie]
              const effectiveStep = k.stap_override !== null ? k.stap_override : catStep
              const catMeta = ALL_CATS.find(c => c.key === o.categorie)
              const parent = k.genest_in ? koppelingen.find((other) => other.id === k.genest_in) : null
              const isExpanded = expandedId === k.id
              return (
                <div key={k.id} className="bg-surface rounded-xl border border-[var(--border-soft)] p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <span className="w-7 h-7 rounded-lg bg-surface-sunken flex items-center justify-center text-xs font-bold text-muted">
                        {idx + 1}
                      </span>
                      <div className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => move(idx, -1)}
                          disabled={idx === 0}
                          aria-label={t.trainingPlan.moveUp}
                          className="w-6 h-5 flex items-center justify-center text-faint hover:text-muted disabled:opacity-30 disabled:hover:text-faint"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" /></svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => move(idx, 1)}
                          disabled={idx === koppelingen.length - 1}
                          aria-label={t.trainingPlan.moveDown}
                          className="w-6 h-5 flex items-center justify-center text-faint hover:text-muted disabled:opacity-30 disabled:hover:text-faint"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-ink">{o.naam}</div>
                      {o.beschrijving && (
                        <p className="text-sm text-muted mt-0.5 line-clamp-2">{o.beschrijving}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {catMeta && (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${catMeta.color}`}>
                            {catLabel(o.categorie)}
                          </span>
                        )}
                        {effectiveStep !== null && effectiveStep !== undefined && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-muted">
                            {k.stap_override !== null ? `${t.trainingPlan.stepBadge} ${effectiveStep}` : (stepForCategory(o.categorie) || `${t.trainingPlan.stepBadge} ${effectiveStep}`)}
                            {k.stap_override !== null && <span className="ml-1 opacity-60">{t.trainingPlan.manualSuffix}</span>}
                          </span>
                        )}
                        {o.duur_min != null && (
                          <span className="text-xs text-faint">{o.duur_min} min</span>
                        )}
                        {o.breedte_m && o.lengte_m && (
                          <span className="text-xs text-faint">{o.breedte_m}×{o.lengte_m}m</span>
                        )}
                        {o.aantal_neutralen > 0 && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-muted">
                            {t.oefeningen.neutralsBadge.replace('{n}', String(o.aantal_neutralen))}
                          </span>
                        )}
                        {parent && (
                          <span className="text-xs text-faint">
                            {t.trainingPlan.nestedInBadge.replace('{name}', parent.oefeningen.naam)}
                          </span>
                        )}
                      </div>
                      {o.diagram ? (
                        <div className="mt-2">
                          <DiagramView diagram={o.diagram} sizePx={110} />
                        </div>
                      ) : o.teams.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {o.teams.map((tm, i) => (
                            <FormationField
                              key={i}
                              positions={tm.formatie ? (formationsForSize(tm.grootte).find((f) => f.key === tm.formatie)?.positions ?? []) : []}
                              label={`${tm.grootte}${tm.formatie ? ` · ${tm.formatie}` : ''}`}
                              sizePx={56}
                            />
                          ))}
                        </div>
                      )}
                      {o.teams.length > 0 && (
                        <TeamIndelingEditor
                          koppelingId={k.id}
                          eventId={eventId}
                          teams={o.teams}
                          initialIndeling={k.spelerindeling ?? EMPTY_INDELING}
                          players={players}
                          presentPlayerIds={presentPlayerIds}
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : k.id)}
                        className="w-8 h-8 rounded-lg hover:bg-surface-sunken flex items-center justify-center text-faint hover:text-muted transition-colors"
                        aria-label={t.trainingPlan.detailsToggle}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {unlinkConfirm === k.id ? (
                        <div className="flex gap-1">
                          <button type="button" onClick={() => handleUnlink(k.id)}
                            disabled={isPending}
                            className="text-xs font-semibold text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
                            {t.trainingPlan.confirmYes}
                          </button>
                          <button type="button" onClick={() => setUnlinkConfirm(null)}
                            className="text-xs text-faint px-2 py-1 rounded-lg hover:bg-surface-sunken transition-colors">
                            {t.trainingPlan.confirmNo}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setUnlinkConfirm(k.id)}
                          aria-label={t.trainingPlan.unlink}
                          className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-faint hover:text-red-500 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-[var(--border-soft)] grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1">{t.trainingPlan.stepBadge} ({t.trainingPlan.stepAuto})</label>
                        <input
                          type="number" min={1} max={99}
                          value={k.stap_override ?? ''}
                          placeholder={t.trainingPlan.stepAuto}
                          onChange={(e) => handleStepOverrideChange(k.id, e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border-soft)] bg-surface focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-sm text-ink"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1">{t.trainingPlan.nestedLabel}</label>
                        <select
                          value={k.genest_in ?? ''}
                          onChange={(e) => handleGenestInChange(k.id, e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border-soft)] focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-sm text-ink bg-surface"
                        >
                          <option value="">{t.trainingPlan.nestedNoneOption}</option>
                          {koppelingen.filter((other) => other.id !== k.id).map((other) => (
                            <option key={other.id} value={other.id}>{other.oefeningen.naam}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <button
          type="button"
          onClick={openPicker}
          className="mt-3 w-full py-3 rounded-xl border-2 border-dashed border-orange-200 text-orange-500 hover:border-orange-300 hover:bg-orange-50 font-semibold text-sm transition-all active:scale-95"
        >
          {t.trainingPlan.addExercise}
        </button>
      </div>

      {showPicker && (
        <OefeningPicker
          eventId={eventId}
          library={library}
          presetCategorie={pickerPresetCategorie}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
