'use client'

import { useMemo, useState, useTransition } from 'react'
import { Oefening, OefeningCategorie } from '@/lib/types'
import type { OefeningInput } from '@/lib/oefening'
import { addOefeningToTraining, createAndAddOefening } from '@/app/actions/training-plan'
import OefeningEditor from '@/components/OefeningEditor'
import { useDict } from '@/lib/i18n-context'

interface Props {
  eventId: string
  library: Oefening[]
  onClose: () => void
  /** Open direct het "nieuwe oefening"-formulier, voorgevuld met deze categorie
   *  (periodiserings-suggestie "+ Voeg toe"-knop op de trainingsplanner). */
  presetCategorie?: OefeningCategorie
}

// "Kies uit bibliotheek"-sheet voor de trainingsplanner. Voegt een bestaande
// bibliotheek-oefening aan de training toe, of opent OefeningEditor om
// meteen een nieuwe oefening te maken én te koppelen.
export default function OefeningPicker({ eventId, library, onClose, presetCategorie }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(!!presetCategorie)

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? library.filter((o) => o.naam.toLowerCase().includes(q)) : library),
    [library, q],
  )

  function handlePick(oefeningId: string) {
    setError(null)
    startTransition(async () => {
      try {
        await addOefeningToTraining(eventId, oefeningId)
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : t.oefeningen.genericError)
      }
    })
  }

  async function handleCreateAndAdd(input: OefeningInput) {
    await createAndAddOefening(eventId, input)
    onClose()
  }

  if (showCreate) {
    return (
      <OefeningEditor
        onCancel={() => (presetCategorie ? onClose() : setShowCreate(false))}
        onSubmit={handleCreateAndAdd}
        presetCategorie={presetCategorie}
        presetNaam={presetCategorie ? (t.periodization.categories[presetCategorie] ?? presetCategorie) : undefined}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92dvh] overflow-y-auto flex flex-col">
        <div className="sticky top-0 bg-surface border-b border-[var(--border-soft)] px-5 py-4 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl z-10">
          <h3 className="font-bold text-ink text-lg">{t.oefeningen.pickerTitle}</h3>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-surface-sunken flex items-center justify-center text-muted hover:bg-surface-sunken">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
              {error}
            </div>
          )}

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.oefeningen.pickerSearchPlaceholder}
            className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] bg-surface focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-ink placeholder:text-faint"
          />

          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="w-full py-3 rounded-xl border-2 border-dashed border-orange-200 text-orange-500 hover:border-orange-300 hover:bg-orange-50 font-semibold text-sm transition-all active:scale-95"
          >
            {t.oefeningen.pickerCreateNew}
          </button>

          {library.length === 0 ? (
            <p className="text-center text-faint text-sm py-6">{t.oefeningen.pickerEmptyLibrary}</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-faint text-sm py-6">{t.oefeningen.pickerEmpty}</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={isPending}
                  onClick={() => handlePick(o.id)}
                  className="w-full text-left bg-surface rounded-xl border border-[var(--border-soft)] hover:border-orange-300 hover:bg-orange-50 p-3 transition-colors disabled:opacity-50"
                >
                  <div className="font-semibold text-ink">{o.naam}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-muted">
                      {t.periodization.categories[o.categorie] ?? o.categorie}
                    </span>
                    {o.duur_min != null && <span className="text-xs text-faint">{o.duur_min} min</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
