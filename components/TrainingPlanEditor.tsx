'use client'

import { useState, useTransition, useRef } from 'react'
import Link from 'next/link'
import { Oefening, OefeningCategorie, PERIODIZATION_CATEGORIES } from '@/lib/types'
import { saveDoelstelling, addOefening, updateOefening, deleteOefening, OefeningInput } from '@/app/actions/training-plan'
import { useDict } from '@/lib/i18n-context'

interface Props {
  eventId: string
  initialDoelstelling: string | null
  initialOefeningen: Oefening[]
  currentSteps: Record<string, number | null>
  hasNulmeting: boolean
  suggestion: { week: number; items: { key: string; step: number | null }[] } | null
}

const ALL_CATS = PERIODIZATION_CATEGORIES

type FormState = OefeningInput & { id?: string }

const EMPTY_FORM: FormState = {
  naam: '',
  beschrijving: '',
  categorie: 'partijen_groot',
  duur_min: null,
  breedte_m: null,
  lengte_m: null,
  orientatie: 'vrij',
  veldzone: null,
  aantal_teams: 0,
  stap_override: null,
  genest_in: null,
}

export default function TrainingPlanEditor({ eventId, initialDoelstelling, initialOefeningen, currentSteps, hasNulmeting, suggestion }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [doelstelling, setDoelstelling] = useState(initialDoelstelling ?? '')
  const [doelstellingSaved, setDoelstellingSaved] = useState(false)
  const [oefeningen, setOefeningen] = useState<Oefening[]>(initialOefeningen)

  // Sync when server revalidates and parent sends fresh data
  // (adjust-state-during-render pattern instead of a cascading effect)
  const [prevInitial, setPrevInitial] = useState(initialOefeningen)
  if (prevInitial !== initialOefeningen) {
    setPrevInitial(initialOefeningen)
    setOefeningen(initialOefeningen)
  }
  const [showForm, setShowForm] = useState(false)
  const [formState, setFormState] = useState<FormState>(EMPTY_FORM)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
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

  function openAddForm() {
    setFormState(EMPTY_FORM)
    setShowForm(true)
  }

  function openSuggestedForm(categorie: OefeningCategorie) {
    setFormState({ ...EMPTY_FORM, categorie, naam: catLabel(categorie) })
    setShowForm(true)
  }

  function openEditForm(o: Oefening) {
    setFormState({
      id: o.id,
      naam: o.naam,
      beschrijving: o.beschrijving ?? '',
      categorie: o.categorie,
      duur_min: o.duur_min,
      breedte_m: o.breedte_m,
      lengte_m: o.lengte_m,
      orientatie: o.orientatie,
      veldzone: o.veldzone,
      aantal_teams: o.aantal_teams,
      stap_override: o.stap_override,
      genest_in: o.genest_in,
    })
    setShowForm(true)
  }

  function handleFormChange(key: keyof FormState, value: unknown) {
    setFormState(prev => ({ ...prev, [key]: value }))
  }

  function handleSubmitForm() {
    const input: OefeningInput = {
      naam: formState.naam,
      beschrijving: formState.beschrijving || null,
      categorie: formState.categorie,
      duur_min: formState.duur_min,
      breedte_m: formState.breedte_m,
      lengte_m: formState.lengte_m,
      orientatie: formState.orientatie,
      veldzone: formState.veldzone,
      aantal_teams: formState.aantal_teams ?? 0,
      stap_override: formState.stap_override,
      genest_in: formState.genest_in || null,
    }
    startTransition(async () => {
      if (formState.id) {
        await updateOefening(formState.id, eventId, input)
        setOefeningen(prev => prev.map(o => o.id === formState.id ? { ...o, ...input } : o))
      } else {
        await addOefening(eventId, input)
        // Server will revalidate; optimistic add not strictly needed since page refreshes
      }
      setShowForm(false)
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteOefening(id, eventId)
      setOefeningen(prev => prev.filter(o => o.id !== id))
      setDeleteConfirm(null)
    })
  }

  const catLabel = (key: string) => {
    return t.periodization.categories[key] ?? key
  }

  const stepForCategory = (cat: string): string => {
    const s = currentSteps[cat]
    if (s === null || s === undefined) return ''
    const max = ALL_CATS.find(c => c.key === cat)?.maxStap ?? '?'
    return `${t.trainingPlan.stepBadge} ${s}/${max}`
  }

  return (
    <div className="space-y-6">

      {/* Doelstelling */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center justify-between">
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
          className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-gray-900 placeholder-gray-400 resize-none text-sm"
        />
      </div>

      {/* Cycle-week suggestion */}
      {suggestion && suggestion.items.length > 0 && (
        <div className="bg-white rounded-r-2xl border border-orange-200 border-l-[3px] border-l-orange-500 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
              {t.periodization.suggestTitle}
            </p>
            <span className="text-xs font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
              {t.periodization.cycleWeek.replace('{n}', String(suggestion.week))}
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {suggestion.items.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm text-gray-800">
                  {catLabel(item.key)}
                  {item.step !== null && (
                    <span className="text-gray-400"> · {t.periodization.step} {item.step}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => openSuggestedForm(item.key as OefeningCategorie)}
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
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
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
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Oefeningen</h2>
          <button
            type="button"
            onClick={openAddForm}
            className="text-sm font-semibold text-orange-600 hover:text-orange-700 active:scale-95 transition-all"
          >
            {t.trainingPlan.addExercise}
          </button>
        </div>

        {oefeningen.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center">
            <svg className="w-9 h-9 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <p className="font-medium text-gray-500">{t.trainingPlan.noExercises}</p>
            <p className="text-sm text-gray-400 mt-1">{t.trainingPlan.noExercisesHint}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {oefeningen.map((o, idx) => {
              const step = currentSteps[o.categorie]
              const effectiveStep = o.stap_override !== null ? o.stap_override : step
              const catMeta = ALL_CATS.find(c => c.key === o.categorie)
              return (
                <div key={o.id} className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900">{o.naam}</div>
                      {o.beschrijving && (
                        <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{o.beschrijving}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {catMeta && (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${catMeta.color}`}>
                            {catLabel(o.categorie)}
                          </span>
                        )}
                        {effectiveStep !== null && effectiveStep !== undefined && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            {stepForCategory(o.stap_override !== null ? '' : o.categorie) || `Stap ${effectiveStep}`}
                            {o.stap_override !== null && <span className="ml-1 opacity-60">(handmatig)</span>}
                          </span>
                        )}
                        {o.duur_min && (
                          <span className="text-xs text-gray-400">{o.duur_min} min</span>
                        )}
                        {o.breedte_m && o.lengte_m && (
                          <span className="text-xs text-gray-400">{o.breedte_m}×{o.lengte_m}m</span>
                        )}
                        {o.aantal_teams > 0 && (
                          <span className="text-xs text-gray-400">{o.aantal_teams} teams</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditForm(o)}
                        className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {deleteConfirm === o.id ? (
                        <div className="flex gap-1">
                          <button type="button" onClick={() => handleDelete(o.id)}
                            disabled={isPending}
                            className="text-xs font-semibold text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
                            ✓ Ja
                          </button>
                          <button type="button" onClick={() => setDeleteConfirm(null)}
                            className="text-xs text-gray-400 px-2 py-1 rounded-lg hover:bg-gray-50 transition-colors">
                            Nee
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(o.id)}
                          className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <button
          type="button"
          onClick={openAddForm}
          className="mt-3 w-full py-3 rounded-xl border-2 border-dashed border-orange-200 text-orange-500 hover:border-orange-300 hover:bg-orange-50 font-semibold text-sm transition-all active:scale-95"
        >
          {t.trainingPlan.addExercise}
        </button>
      </div>

      {/* Exercise form sheet */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowForm(false)}
          />
          <div className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92dvh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl">
              <h3 className="font-bold text-gray-900 text-lg">
                {formState.id ? 'Oefening bewerken' : 'Oefening toevoegen'}
              </h3>
              <button type="button" onClick={() => setShowForm(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Naam */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.trainingPlan.exerciseName} *</label>
                <input
                  type="text"
                  value={formState.naam}
                  onChange={e => handleFormChange('naam', e.target.value)}
                  placeholder={t.trainingPlan.exerciseNamePlaceholder}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-gray-900 placeholder-gray-400"
                />
              </div>

              {/* Categorie */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.trainingPlan.category}</label>
                <select
                  value={formState.categorie}
                  onChange={e => handleFormChange('categorie', e.target.value as OefeningCategorie)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-gray-900 bg-white"
                >
                  {ALL_CATS.map(cat => (
                    <option key={cat.key} value={cat.key}>
                      {catLabel(cat.key)}
                      {currentSteps[cat.key] !== null && currentSteps[cat.key] !== undefined
                        ? ` — Stap ${currentSteps[cat.key]}/${cat.maxStap}` : ''}
                    </option>
                  ))}
                </select>
                {currentSteps[formState.categorie] !== null && currentSteps[formState.categorie] !== undefined && (
                  <p className="text-xs text-gray-500 mt-1">
                    Auto: {t.trainingPlan.currentStep.toLowerCase()} {currentSteps[formState.categorie]}
                  </p>
                )}
              </div>

              {/* Beschrijving */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.trainingPlan.exerciseDescription}</label>
                <textarea
                  rows={3}
                  value={formState.beschrijving ?? ''}
                  onChange={e => handleFormChange('beschrijving', e.target.value)}
                  placeholder={t.trainingPlan.exerciseDescriptionPlaceholder}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-gray-900 placeholder-gray-400 resize-none text-sm"
                />
              </div>

              {/* Duur + Teams */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.trainingPlan.duration}</label>
                  <input
                    type="number" min={0} max={120}
                    value={formState.duur_min ?? ''}
                    onChange={e => handleFormChange('duur_min', e.target.value ? parseInt(e.target.value) : null)}
                    placeholder="15"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-gray-900 placeholder-gray-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.trainingPlan.teams}</label>
                  <input
                    type="number" min={0} max={20}
                    value={formState.aantal_teams ?? 0}
                    onChange={e => handleFormChange('aantal_teams', parseInt(e.target.value) || 0)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-gray-900"
                  />
                </div>
              </div>

              {/* Veldgrootte */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Veldgrootte</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <input
                      type="number" min={0} max={200} step={0.5}
                      value={formState.breedte_m ?? ''}
                      onChange={e => handleFormChange('breedte_m', e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder={t.trainingPlan.fieldWidth}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-gray-900 placeholder-gray-400 text-sm"
                    />
                  </div>
                  <div>
                    <input
                      type="number" min={0} max={200} step={0.5}
                      value={formState.lengte_m ?? ''}
                      onChange={e => handleFormChange('lengte_m', e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder={t.trainingPlan.fieldLength}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-gray-900 placeholder-gray-400 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Veldzone */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.trainingPlan.fieldZone}</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['links', 'midden', 'rechts'] as const).map(zone => (
                    <button
                      key={zone}
                      type="button"
                      onClick={() => handleFormChange('veldzone', formState.veldzone === zone ? null : zone)}
                      className={`py-2 px-3 rounded-xl text-sm font-semibold border-2 transition-all ${
                        formState.veldzone === zone
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'border-gray-200 text-gray-600 hover:border-orange-300'
                      }`}
                    >
                      {t.trainingPlan.fieldZones[zone]}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {(['strafschopgebied_links', 'strafschopgebied_rechts'] as const).map(zone => (
                    <button
                      key={zone}
                      type="button"
                      onClick={() => handleFormChange('veldzone', formState.veldzone === zone ? null : zone)}
                      className={`py-2 px-2 rounded-xl text-xs font-semibold border-2 transition-all ${
                        formState.veldzone === zone
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'border-gray-200 text-gray-600 hover:border-orange-300'
                      }`}
                    >
                      {t.trainingPlan.fieldZones[zone]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nested in */}
              {oefeningen.length > 0 && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t.trainingPlan.nestedLabel}</label>
                  <select
                    value={formState.genest_in ?? ''}
                    onChange={e => handleFormChange('genest_in', e.target.value || null)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-gray-900 bg-white text-sm"
                  >
                    <option value="">— niet genest —</option>
                    {oefeningen.filter(o => o.id !== formState.id).map(o => (
                      <option key={o.id} value={o.id}>{o.naam}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4 flex gap-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 py-3 rounded-xl border-2 border-gray-200 font-semibold text-gray-600 hover:border-gray-300 transition-all active:scale-95"
              >
                {t.trainingPlan.cancel}
              </button>
              <button
                type="button"
                onClick={handleSubmitForm}
                disabled={isPending || !formState.naam.trim()}
                className="flex-1 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-all active:scale-95 disabled:opacity-50"
              >
                {isPending ? t.trainingPlan.saving : t.trainingPlan.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
