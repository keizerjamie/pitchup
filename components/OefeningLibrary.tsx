'use client'

import { useMemo, useState, useTransition } from 'react'
import { Oefening, OefeningCategorie, Veldzone, OEFENING_CATEGORIES, VALID_VELDZONES, PERIODIZATION_CATEGORIES } from '@/lib/types'
import { basisFormatieDef } from '@/lib/formaties'
import { matchesOefeningFilters, EMPTY_OEFENING_FILTERS, type OefeningFilters } from '@/lib/oefening-filter'
import { bereikLabel, bereikVoorNeutralen, isFlexibel, teamBereikLabel } from '@/lib/oefening-bezetting'
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

  // Zelfde filtermodel als de oefening-picker in de trainingsflow
  // (lib/oefening-filter.ts): één state-object, AND-combinatie met de
  // zoekbalk. De uitgebreide filters zitten achter een toggle (progressive
  // disclosure) — de bibliotheek opent rustig, filteren is één tik verder.
  const [filters, setFilters] = useState<OefeningFilters>(EMPTY_OEFENING_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [editing, setEditing] = useState<OefeningWithUsage | 'new' | null>(null)
  // Filter op oefeningen zonder ingevulde duur. Die vallen niet op in een
  // lange lijst, maar breken wél de sessietijdlijn van elke training waarin ze
  // zitten: de klok kan daar niet doortellen. Dit maakt ze in één klik
  // vindbaar en aanpasbaar.
  const [alleenZonderDuur, setAlleenZonderDuur] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const zonderDuurAantal = useMemo(
    () => oefeningen.filter((o) => o.duur_min == null).length,
    [oefeningen],
  )

  // Aantal actieve uitgebreide filters (zonder de zoekbalk) — gebruikt als
  // teller op de Filters-knop. `!== null`-checks, nooit truthiness: 0 is een
  // geldige actieve filterwaarde (zie lib/oefening-filter.ts).
  const actieveFilters =
    (filters.categorie !== null ? 1 : 0) +
    (filters.veldzone !== null ? 1 : 0) +
    (filters.aantalMin !== null || filters.aantalMax !== null ? 1 : 0) +
    (filters.duurMin !== null || filters.duurMax !== null ? 1 : 0)

  const filtered = useMemo(() => {
    const basis = oefeningen.filter((o) => matchesOefeningFilters(o, filters))
    return alleenZonderDuur ? basis.filter((o) => o.duur_min == null) : basis
  }, [oefeningen, filters, alleenZonderDuur])

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
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            placeholder={t.oefeningen.searchPlaceholder}
            className="px-3 py-2 rounded-xl border border-[var(--border-soft)] bg-surface focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 text-sm text-ink placeholder:text-faint w-[150px] sm:w-[220px] min-w-0"
          />
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            className={`text-sm font-semibold rounded-xl px-3.5 py-2 transition-colors flex-shrink-0 ${filtersOpen || actieveFilters > 0 ? 'text-white' : 'text-muted'}`}
            style={
              filtersOpen || actieveFilters > 0
                ? { background: 'var(--brand-btn)' }
                : { background: 'var(--surface-sunken)', border: '1px solid var(--border-soft)' }
            }
          >
            {t.oefeningen.filtersToggle}
            {actieveFilters > 0 && ` · ${actieveFilters}`}
          </button>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="text-sm font-semibold text-white bg-warning hover:bg-warning/90 rounded-xl px-4 py-2 transition-colors active:scale-95 flex-shrink-0"
          >
            {t.oefeningen.addNew}
          </button>
        </div>
      </div>

      {/* Uitgebreide filters — zelfde velden en semantiek als de
          oefening-picker in de trainingsflow (components/OefeningPicker.tsx),
          zodat filteren overal hetzelfde werkt. Eigen input-ids
          (bib-filter-*) zodat ze nooit met de picker-ids kunnen botsen. */}
      {filtersOpen && (
        <div className="surface-card p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="bib-filter-categorie" className="block text-xs font-semibold text-muted mb-1">
              {t.oefeningen.filterCategoryLabel}
            </label>
            <select
              id="bib-filter-categorie"
              value={filters.categorie ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, categorie: e.target.value ? (e.target.value as OefeningCategorie) : null }))
              }
              className="w-full px-3 py-2 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 text-sm text-ink bg-surface"
            >
              <option value="">{t.oefeningen.filterAll}</option>
              {OEFENING_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{t.periodization.categories[cat] ?? cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="bib-filter-veldzone" className="block text-xs font-semibold text-muted mb-1">
              {t.oefeningen.filterZoneLabel}
            </label>
            <select
              id="bib-filter-veldzone"
              value={filters.veldzone ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, veldzone: e.target.value ? (e.target.value as Veldzone) : null }))
              }
              className="w-full px-3 py-2 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 text-sm text-ink bg-surface"
            >
              <option value="">{t.oefeningen.filterAll}</option>
              {VALID_VELDZONES.map((zone) => (
                <option key={zone} value={zone}>{t.trainingPlan.fieldZones[zone]}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted mb-1">{t.oefeningen.filterCountLabel}</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="bib-filter-aantal-min" className="sr-only">
                  {`${t.oefeningen.filterCountLabel} ${t.oefeningen.filterMinPlaceholder}`}
                </label>
                <input
                  id="bib-filter-aantal-min"
                  type="number"
                  min={0}
                  value={filters.aantalMin ?? ''}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, aantalMin: e.target.value === '' ? null : Number(e.target.value) }))
                  }
                  placeholder={t.oefeningen.filterMinPlaceholder}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 bg-surface text-ink placeholder:text-faint text-sm"
                />
              </div>
              <div>
                <label htmlFor="bib-filter-aantal-max" className="sr-only">
                  {`${t.oefeningen.filterCountLabel} ${t.oefeningen.filterMaxPlaceholder}`}
                </label>
                <input
                  id="bib-filter-aantal-max"
                  type="number"
                  min={0}
                  value={filters.aantalMax ?? ''}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, aantalMax: e.target.value === '' ? null : Number(e.target.value) }))
                  }
                  placeholder={t.oefeningen.filterMaxPlaceholder}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 bg-surface text-ink placeholder:text-faint text-sm"
                />
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted mb-1">{t.oefeningen.filterDurationLabel}</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="bib-filter-duur-min" className="sr-only">
                  {`${t.oefeningen.filterDurationLabel} ${t.oefeningen.filterMinPlaceholder}`}
                </label>
                <input
                  id="bib-filter-duur-min"
                  type="number"
                  min={0}
                  value={filters.duurMin ?? ''}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, duurMin: e.target.value === '' ? null : Number(e.target.value) }))
                  }
                  placeholder={t.oefeningen.filterMinPlaceholder}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 bg-surface text-ink placeholder:text-faint text-sm"
                />
              </div>
              <div>
                <label htmlFor="bib-filter-duur-max" className="sr-only">
                  {`${t.oefeningen.filterDurationLabel} ${t.oefeningen.filterMaxPlaceholder}`}
                </label>
                <input
                  id="bib-filter-duur-max"
                  type="number"
                  min={0}
                  value={filters.duurMax ?? ''}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, duurMax: e.target.value === '' ? null : Number(e.target.value) }))
                  }
                  placeholder={t.oefeningen.filterMaxPlaceholder}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 bg-surface text-ink placeholder:text-faint text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {zonderDuurAantal > 0 && (
        <div className="mb-4 surface-card px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={() => setAlleenZonderDuur((aan) => !aan)}
            aria-pressed={alleenZonderDuur}
            className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${alleenZonderDuur ? 'text-white' : 'text-muted'}`}
            style={
              alleenZonderDuur
                ? { background: 'var(--warning)' }
                : { background: 'var(--surface-sunken)', border: '1px solid var(--border-soft)' }
            }
          >
            {t.oefeningen.withoutDurationCount.replace('{n}', String(zonderDuurAantal))}
          </button>
          <p className="text-xs text-faint min-w-0 flex-1">{t.oefeningen.withoutDurationHint}</p>
          {alleenZonderDuur && (
            <button
              type="button"
              onClick={() => setAlleenZonderDuur(false)}
              className="text-xs font-semibold text-warning-text hover:underline flex-shrink-0"
            >
              {t.oefeningen.withoutDurationShowAll}
            </button>
          )}
        </div>
      )}

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
                    {/* Vorm-badge: alleen bij een flexibele oefening (bestaand
                        gedrag blijft ongewijzigd voor een exacte oefening). */}
                    {isFlexibel(o) && (
                      <span
                        aria-label={`${t.oefeningen.shapeLabel}: ${bereikLabel(o)}`}
                        className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-muted"
                      >
                        {bereikLabel(o)}
                      </span>
                    )}
                    {(() => {
                      const neutraalBereik = bereikVoorNeutralen(o)
                      if (neutraalBereik.max <= 0) return null
                      return (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-muted">
                          {neutraalBereik.max > neutraalBereik.min
                            ? t.oefeningen.neutralsBadgeRange
                                .replace('{min}', String(neutraalBereik.min))
                                .replace('{max}', String(neutraalBereik.max))
                            : t.oefeningen.neutralsBadge.replace('{n}', String(neutraalBereik.min))}
                        </span>
                      )
                    })()}
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
                    className="w-8 h-8 rounded-lg hover:bg-panel-red flex items-center justify-center text-faint hover:text-panel-red-ink transition-colors disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Vaste thumbnail-zone: elke kaart krijgt hetzelfde visuele
                  vlak (vaste hoogte, inhoud gecentreerd), of er nu een groot
                  diagram, een formatieveld of niets in staat — anders leest
                  het raster als een ratjetoe van kaarthoogtes. */}
              <div className="mt-3 h-[190px] flex items-center justify-center gap-3 overflow-hidden rounded-xl min-w-0">
                {o.diagram ? (
                  <DiagramView diagram={o.diagram} sizePx={130} />
                ) : o.teams.length > 0 ? (
                  o.teams.map((tm, i) => {
                    const basis = basisFormatieDef(tm)
                    return (
                      <FormationField
                        key={i}
                        positions={basis?.positions ?? []}
                        label={`${teamBereikLabel(tm)}${basis ? ` · ${basis.label}` : ''}`}
                        sizePx={90}
                      />
                    )
                  })
                ) : (
                  <span className="ms text-[30px] text-faint/60" aria-hidden="true">sports_soccer</span>
                )}
              </div>

              {/* AC21: deleteConfirm wordt alleen gezet bij koppelingCount >= 1
                  (zie de delete-knop hierboven) — N=0 verwijdert direct. */}
              {deleteConfirm === o.id && (
                <div className="mt-3 rounded-xl border border-panel-red-edge bg-panel-red p-3 space-y-2">
                  <p className="text-sm text-panel-red-ink">
                    {t.oefeningen.deleteConfirmUsage.replace('{n}', String(o.koppelingCount))}
                  </p>
                  {deleteError && <p className="text-xs text-panel-red-ink">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDelete(o.id)}
                      disabled={isPending}
                      className="text-xs font-semibold text-white bg-danger hover:bg-danger rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
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
