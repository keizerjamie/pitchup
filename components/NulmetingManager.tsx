'use client'

import { useState, useTransition } from 'react'
import { PERIODIZATION_CATEGORIES, type CategorieMeting } from '@/lib/types'
import { actueleMetingen, metingenPerCategorie } from '@/lib/periodization'
import { saveCategorieMeting, deleteCategorieMeting } from '@/app/actions/periodisering'
import { formatDate, todayLocal } from '@/lib/utils'
import { useDict } from '@/lib/i18n-context'

const METING_CATEGORIES = PERIODIZATION_CATEGORIES.filter((c) => c.hasMeting)

interface Props {
  // ALLE rijen van dit team (niet alleen de actuele) — de geschiedenis van elk
  // onderdeel toont ook metingen die (nog) niet meetellen, bv. een toekomstige
  // datum. Groepering/actueel-bepaling loopt client-side over dezelfde pure
  // helpers als de rest van de feature (lib/periodization.ts), dus dit
  // component en de serverpagina's kunnen nooit uit de pas lopen.
  metingen: CategorieMeting[]
  peildatumExclusief: string
}

// Vijf onafhankelijke onderdeelblokken (AC 1-2): elk onderdeel heeft zijn
// eigen datum, eigen geschiedenis en eigen bewerk-/verwijderknoppen. Alleen de
// rij met de HOOGSTE datum (over ALLE metingen, ook toekomstige — brief §6)
// is bewerkbaar/verwijderbaar; dat is een client-side spiegeling van de
// server-guard assertNieuwsteMeting in app/actions/periodisering.ts.
export default function NulmetingManager({ metingen, peildatumExclusief }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [openCategorie, setOpenCategorie] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [datum, setDatum] = useState(todayLocal())
  const [stap, setStap] = useState(1)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({})
  // Apart van `error` (die alleen ín de sheet zichtbaar is): verwijderen
  // gebeurt vanuit de geschiedenis-lijst, BUITEN de sheet, dus een fout daar
  // moet op een plek verschijnen die de gebruiker ook echt ziet — bij het
  // blok van de betreffende categorie.
  const [deleteError, setDeleteError] = useState<{ categorie: string; message: string } | null>(null)

  const actueel = actueleMetingen(metingen, peildatumExclusief)
  const perCategorie = metingenPerCategorie(metingen)
  const openCat = METING_CATEGORIES.find((c) => c.key === openCategorie) ?? null

  function openNew(categorie: string) {
    setOpenCategorie(categorie)
    setEditingId(null)
    setDatum(todayLocal())
    setStap(1)
    setNotes('')
    setError(null)
    setDeleteError(null)
  }

  function openEdit(categorie: string, rij: CategorieMeting) {
    setOpenCategorie(categorie)
    setEditingId(rij.id)
    setDatum(rij.datum)
    setStap(rij.stap)
    setNotes(rij.notes ?? '')
    setError(null)
    setDeleteError(null)
  }

  function closeSheet() {
    setOpenCategorie(null)
  }

  // Open- en dichtklappen wist een eventuele oude verwijder-foutmelding van
  // dit blok — anders blijft die zichtbaar zonder duidelijke aanleiding zodra
  // de gebruiker de geschiedenis weer sluit en opnieuw opent.
  function toggleHistory(categorie: string) {
    setExpandedHistory((h) => ({ ...h, [categorie]: !h[categorie] }))
    setDeleteError(null)
  }

  // Server-foutmeldingen komen altijd in het Nederlands terug (server actions
  // gooien vaste strings). Alleen de twee foutmeldingen die een gebruiker via
  // deze sheet daadwerkelijk kan veroorzaken (ongeldige datum, dubbele datum
  // voor hetzelfde onderdeel) krijgen een vertaalde tekst; al het overige
  // (race-conditie op "nieuwste meting", sessieverval, DB-fout) valt terug op
  // de generieke foutmelding — nooit de rauwe NL-string in een niet-NL UI.
  function translateError(err: unknown): string {
    if (err instanceof Error) {
      if (err.message === 'Ongeldige datum') return t.periodization.errorInvalidDate
      if (err.message === 'Er staat al een meting voor dit onderdeel op deze datum') return t.periodization.errorDuplicateDate
    }
    return t.oefeningen.genericError
  }

  function handleSave() {
    if (!openCategorie) return
    setError(null)
    startTransition(async () => {
      try {
        await saveCategorieMeting({
          id: editingId ?? undefined,
          categorie: openCategorie,
          datum,
          stap,
          notes: notes || null,
        })
        setOpenCategorie(null)
      } catch (err) {
        setError(translateError(err))
      }
    })
  }

  function handleDelete(categorie: string, id: string) {
    if (!confirm(t.periodization.deleteConfirm)) return
    setDeleteError(null)
    startTransition(async () => {
      try {
        await deleteCategorieMeting(id)
      } catch (err) {
        setDeleteError({ categorie, message: translateError(err) })
      }
    })
  }

  function changeStap(delta: number, max: number) {
    setStap((s) => Math.max(1, Math.min(max, s + delta)))
  }

  function setStapValue(raw: string, max: number) {
    const n = parseInt(raw, 10)
    if (!isNaN(n)) setStap(Math.max(1, Math.min(max, n)))
  }

  return (
    <div className="flex flex-col gap-4">
      {METING_CATEGORIES.map((cat) => {
        const geschiedenis = perCategorie[cat.key] ?? []
        const actueleMeting = actueel[cat.key] ?? null
        const expanded = !!expandedHistory[cat.key]
        const label = t.periodization.categories[cat.key] ?? cat.label

        // Delta (AC 6) hoort bij de ACTUELE meting, vergeleken met haar eigen
        // chronologische voorganger in de geschiedenis — niet met "de laatst
        // ingevoerde rij" (geschiedenis[0]). Die twee lopen uiteen zodra er
        // een toekomstige meetdatum bestaat (toegestaan, brief §6): de
        // nieuwste rij qua datum is dan nog niet de actuele. Kop, knoptekst
        // en delta gebruiken daarom allemaal dezelfde bron: actueleMeting.
        const actueleIndex = actueleMeting ? geschiedenis.findIndex((r) => r.id === actueleMeting.id) : -1
        const vorigeMeting = actueleIndex >= 0 ? (geschiedenis[actueleIndex + 1] ?? null) : null
        const delta = actueleMeting && vorigeMeting ? actueleMeting.stap - vorigeMeting.stap : null

        return (
          <div key={cat.key} className="surface-card rounded-2xl overflow-hidden">
            <div className="px-5 py-4 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-[15px] font-bold text-ink">{label}</h3>
                <p className="text-[12.5px] font-semibold text-faint mt-0.5">
                  {actueleMeting
                    ? `${t.periodization.measuredOn.replace('{date}', formatDate(actueleMeting.datum, t.browserLocale))} · ${t.periodization.step} ${actueleMeting.stap}`
                    : `${t.periodization.notMeasured} · ${t.periodization.dueInWeek.replace('{n}', String(cat.cycleWeeks[0]))}`}
                </p>
                {delta !== null && vorigeMeting && (
                  <p
                    className="text-[12px] font-extrabold mt-1.5 flex items-center gap-1"
                    style={{
                      color:
                        delta > 0 ? 'var(--chip-green-fg)' : delta < 0 ? 'var(--chip-red-fg)' : 'var(--muted)',
                    }}
                  >
                    <span aria-hidden="true">{delta > 0 ? '▲' : delta < 0 ? '▼' : '='}</span>
                    {delta > 0
                      ? t.periodization.progressUp
                          .replace('{n}', String(delta))
                          .replace('{date}', formatDate(vorigeMeting.datum, t.browserLocale))
                      : delta < 0
                        ? t.periodization.progressDown
                            .replace('{n}', String(Math.abs(delta)))
                            .replace('{date}', formatDate(vorigeMeting.datum, t.browserLocale))
                        : t.periodization.progressSame.replace('{date}', formatDate(vorigeMeting.datum, t.browserLocale))}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => openNew(cat.key)}
                className="text-xs font-bold text-white px-3.5 py-2 rounded-xl bg-brand hover:bg-brand-dark transition active:scale-[0.97] flex-shrink-0"
              >
                {actueleMeting ? t.periodization.remeasureCta : t.periodization.measureCta}
              </button>
            </div>

            {geschiedenis.length > 0 && (
              <div className="border-t border-[var(--border-soft)]">
                <button
                  type="button"
                  onClick={() => toggleHistory(cat.key)}
                  className="w-full px-5 py-3 flex items-center justify-between gap-2 text-left transition-colors hover:bg-surface-sunken"
                  aria-expanded={expanded}
                >
                  <span className="text-[13px] font-bold text-ink">
                    {t.periodization.historyForCategory.replace('{n}', String(geschiedenis.length))}
                  </span>
                  <span className="ms text-[18px] text-faint" aria-hidden="true">
                    {expanded ? 'expand_less' : 'expand_more'}
                  </span>
                </button>

                {expanded && (
                  <div className="border-t border-[var(--border-soft)]">
                    {deleteError?.categorie === cat.key && (
                      <div className="mx-5 mt-3 bg-panel-red border border-panel-red-edge text-panel-red-ink text-xs px-4 py-2.5 rounded-xl">
                        {deleteError.message}
                      </div>
                    )}
                    <div className="divide-y divide-[var(--border-soft)]">
                      {geschiedenis.map((rij, i) => (
                        <div key={rij.id} className="px-5 py-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-bold text-ink">
                              {formatDate(rij.datum, t.browserLocale)} · {t.periodization.step} {rij.stap}
                            </div>
                            {rij.notes && (
                              <div className="text-[12px] text-faint italic mt-0.5 truncate">{rij.notes}</div>
                            )}
                          </div>
                          {i === 0 && (
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => openEdit(cat.key, rij)}
                                className="text-xs font-semibold text-brand px-3 py-1.5 rounded-lg border border-[var(--border-soft)] hover:border-brand/40 transition active:scale-[0.97]"
                              >
                                {t.periodization.editNulmeting}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(cat.key, rij.id)}
                                disabled={isPending}
                                aria-label={t.periodization.deleteNulmeting}
                                className="w-8 h-8 rounded-lg hover:bg-panel-red flex items-center justify-center text-faint hover:text-panel-red-ink transition active:scale-[0.97] disabled:opacity-60"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {geschiedenis.length > 1 && (
                      <p className="px-5 py-2.5 text-[11.5px] text-faint">{t.periodization.latestOnlyHint}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Editor sheet — bestaande markup hergebruikt (z-[var(--z-modal)],
          backdrop bg-black/40 backdrop-blur-sm, sticky kop/voet, max-h-[92dvh]),
          nu per categorie i.p.v. alle vijf tegelijk. */}
      {openCat && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeSheet} />
          <div className="relative w-full max-w-lg bg-surface rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92dvh] overflow-y-auto animate-scale-in">
            <div className="sticky top-0 bg-surface border-b border-[var(--border-soft)] px-5 py-4 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl">
              <h3 className="font-bold text-ink text-lg">
                {editingId
                  ? t.periodization.editNulmeting
                  : actueel[openCat.key]
                    ? t.periodization.remeasureCta
                    : t.periodization.measureCta}
                {' · '}
                {t.periodization.categories[openCat.key] ?? openCat.label}
              </h3>
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
              <p className="text-sm text-faint">{t.periodization.hint}</p>

              {error && (
                <div className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-4 py-3 rounded-xl">{error}</div>
              )}

              <div>
                <label htmlFor="nulmeting-datum" className="block text-sm font-semibold text-muted mb-1.5">{t.periodization.date}</label>
                <input
                  id="nulmeting-datum"
                  type="date"
                  value={datum}
                  onChange={(e) => setDatum(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/30 text-ink"
                />
              </div>

              <div>
                <label htmlFor="nulmeting-stap" className="block text-sm font-semibold text-muted mb-1.5">
                  {t.periodization.maxSteps.replace('{n}', String(openCat.maxStap))}
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => changeStap(-1, openCat.maxStap)}
                    className="w-9 h-9 rounded-lg bg-surface-sunken hover:bg-surface-sunken active:scale-[0.97] transition flex items-center justify-center text-muted font-bold text-lg"
                  >
                    −
                  </button>
                  <input
                    id="nulmeting-stap"
                    type="number"
                    min={1}
                    max={openCat.maxStap}
                    value={stap}
                    onChange={(e) => setStapValue(e.target.value, openCat.maxStap)}
                    className="w-16 text-center px-2 py-1.5 rounded-lg border border-[var(--border-soft)] focus:outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/30 font-semibold text-ink"
                  />
                  <button
                    type="button"
                    onClick={() => changeStap(1, openCat.maxStap)}
                    className="w-9 h-9 rounded-lg bg-surface-sunken hover:bg-surface-sunken active:scale-[0.97] transition flex items-center justify-center text-muted font-bold text-lg"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="nulmeting-notitie" className="block text-sm font-semibold text-muted mb-1.5">{t.event.notes}</label>
                <textarea
                  id="nulmeting-notitie"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t.event.notesMeetingPlaceholder}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/30 text-ink placeholder:text-faint resize-none text-sm"
                />
              </div>
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
                {isPending ? t.periodization.saving : t.periodization.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
