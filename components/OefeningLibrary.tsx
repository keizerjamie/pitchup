'use client'

import { useMemo, useState, useTransition } from 'react'
import { Oefening, PERIODIZATION_CATEGORIES, basisFormatieDef } from '@/lib/types'
import type { OefeningInput } from '@/lib/oefening'
import { createOefening, updateOefening, deleteOefening } from '@/app/actions/oefening-library'
import FormationField from '@/components/FormationField'
import DiagramView from '@/components/DiagramView'
import OefeningEditor from '@/components/OefeningEditor'
import { useDict } from '@/lib/i18n-context'

// Bibliotheek-oefening + het aantal trainingen waar hij aan gekoppeld is
// (voor de verwijder-waarschuwing). De server component telt dit vooraf.
export interface OefeningWithUsage extends Oefening {
  koppelingCount: number
}

interface Props {
  oefeningen: OefeningWithUsage[]
}

export default function OefeningLibrary({ oefeningen: initialOefeningen }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [oefeningen, setOefeningen] = useState<OefeningWithUsage[]>(initialOefeningen)

  // Sync when the server revalidates and the parent sends fresh data.
  const [prevInitial, setPrevInitial] = useState(initialOefeningen)
  if (prevInitial !== initialOefeningen) {
    setPrevInitial(initialOefeningen)
    setOefeningen(initialOefeningen)
  }

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<OefeningWithUsage | 'new' | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? oefeningen.filter((o) => o.naam.toLowerCase().includes(q)) : oefeningen),
    [oefeningen, q],
  )

  const catLabel = (key: string) => t.periodization.categories[key] ?? key
  const catColor = (key: string) => PERIODIZATION_CATEGORIES.find((c) => c.key === key)?.color ?? 'bg-surface-sunken text-muted'

  async function handleCreate(input: OefeningInput) {
    await createOefening(input)
    setEditing(null)
  }

  async function handleUpdate(id: string, input: OefeningInput) {
    await updateOefening(id, input)
    setEditing(null)
  }

  function handleDelete(id: string) {
    setDeleteError(null)
    startTransition(async () => {
      try {
        await deleteOefening(id)
        setOefeningen((prev) => prev.filter((o) => o.id !== id))
        setDeleteConfirm(null)
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : t.oefeningen.genericError)
      }
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-ink">{t.oefeningen.libraryTitle}</h1>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.oefeningen.searchPlaceholder}
            className="px-3 py-2 rounded-xl border border-[var(--border-soft)] bg-surface focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-sm text-ink placeholder:text-faint w-[150px] sm:w-[220px] min-w-0"
          />
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-xl px-4 py-2 transition-colors active:scale-95 flex-shrink-0"
          >
            {t.oefeningen.addNew}
          </button>
        </div>
      </div>

      {oefeningen.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-[var(--border-soft)] p-8 text-center">
          <svg className="w-9 h-9 mx-auto mb-2 text-faint" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          <p className="font-medium text-muted">{t.oefeningen.empty}</p>
          <p className="text-sm text-faint mt-1">{t.oefeningen.emptyHint}</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-faint text-sm py-6">{t.oefeningen.empty}</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map((o) => (
            <div key={o.id} className="bg-surface rounded-2xl border border-[var(--border-soft)] p-4 lg:p-5 min-w-0 overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink truncate">{o.naam}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${catColor(o.categorie)}`}>
                      {catLabel(o.categorie)}
                    </span>
                    {o.aantal_neutralen > 0 && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-muted">
                        {t.oefeningen.neutralsBadge.replace('{n}', String(o.aantal_neutralen))}
                      </span>
                    )}
                    {o.duur_min != null && <span className="text-xs text-faint">{o.duur_min} min</span>}
                  </div>
                  {o.beschrijving && (
                    <p className="text-sm text-muted mt-1.5 line-clamp-2">{o.beschrijving}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditing(o)}
                    aria-label={t.oefeningen.editAria}
                    className="w-8 h-8 rounded-lg hover:bg-surface-sunken flex items-center justify-center text-faint hover:text-muted transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(null)
                      // AC21: N=0 → direct verwijderen zonder bevestigingsdialoog;
                      // N>=1 → eerst de waarschuwing met het exacte aantal tonen.
                      if (o.koppelingCount === 0) {
                        handleDelete(o.id)
                      } else {
                        setDeleteConfirm(o.id)
                      }
                    }}
                    aria-label={t.oefeningen.deleteAria}
                    disabled={isPending}
                    className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-faint hover:text-red-500 transition-colors disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>

              {o.diagram ? (
                <div className="mt-3">
                  <DiagramView diagram={o.diagram} sizePx={140} />
                </div>
              ) : o.teams.length > 0 && (
                <div className="flex flex-wrap gap-3 mt-3 min-w-0">
                  {o.teams.map((tm, i) => {
                    const basis = basisFormatieDef(tm.grootte, tm.formaties)
                    return (
                      <FormationField
                        key={i}
                        positions={basis?.positions ?? []}
                        label={`${tm.grootte}${basis ? ` · ${basis.label}` : ''}`}
                        sizePx={72}
                      />
                    )
                  })}
                </div>
              )}

              {/* AC21: deleteConfirm wordt alleen gezet bij koppelingCount >= 1
                  (zie de delete-knop hierboven) — N=0 verwijdert direct. */}
              {deleteConfirm === o.id && (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 space-y-2">
                  <p className="text-sm text-red-700">
                    {t.oefeningen.deleteConfirmUsage.replace('{n}', String(o.koppelingCount))}
                  </p>
                  {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDelete(o.id)}
                      disabled={isPending}
                      className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                    >
                      {t.oefeningen.deleteButton}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(null)}
                      className="text-xs font-semibold text-muted hover:text-ink rounded-lg px-3 py-1.5 transition-colors"
                    >
                      {t.trainingPlan.cancel}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <OefeningEditor
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSubmit={(input) => (editing === 'new' ? handleCreate(input) : handleUpdate(editing.id, input))}
        />
      )}
    </div>
  )
}
