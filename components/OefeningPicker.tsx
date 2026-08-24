'use client'

import { useMemo, useState, useTransition } from 'react'
import { Oefening, OefeningCategorie, Veldzone, OEFENING_CATEGORIES, VALID_VELDZONES } from '@/lib/types'
import type { OefeningInput } from '@/lib/oefening'
import { filterOefeningen, EMPTY_OEFENING_FILTERS, type OefeningFilters } from '@/lib/oefening-filter'
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
  // Een periodiseringssuggestie opent de bibliotheek VOORGEFILTERD op die
  // categorie — niet meteen het "nieuwe oefening"-formulier, zoals eerder.
  // Dat oude gedrag duwde je naar een nieuwe oefening maken terwijl je die
  // categorie waarschijnlijk allang in je bibliotheek hebt staan; zeker in een
  // tweede seizoen is opnieuw intypen precies het verkeerde antwoord.
  // Nieuw maken blijft één klik weg, als bewuste tweede keuze.
  const [filters, setFilters] = useState<OefeningFilters>(
    presetCategorie ? { ...EMPTY_OEFENING_FILTERS, categorie: presetCategorie } : EMPTY_OEFENING_FILTERS,
  )
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  // Wat er tijdens déze sheet-sessie is toegevoegd. Een array en geen Set:
  // dezelfde oefening twee keer aan één training koppelen is bestaand,
  // bedoeld gedrag (zie dezelfde-oefening-meerdere-keren.acceptance.test.tsx),
  // dus het aantal telt.
  const [toegevoegd, setToegevoegd] = useState<string[]>([])

  const filtered = useMemo(() => filterOefeningen(library, filters), [library, filters])

  const aantalToegevoegd = (id: string) => toegevoegd.filter((x) => x === id).length

  // Toevoegen sluit de sheet NIET. Een training bestaat uit vier tot zes
  // oefeningen; met sluiten-per-oefening opende je dit paneel vijf keer,
  // inclusief vijf keer opnieuw filteren. Nu blijft de lijst staan en sluit je
  // zelf af als je klaar bent.
  function handlePick(oefeningId: string) {
    setError(null)
    startTransition(async () => {
      try {
        await addOefeningToTraining(eventId, oefeningId)
        setToegevoegd((eerder) => [...eerder, oefeningId])
      } catch (e) {
        setError(e instanceof Error ? e.message : t.oefeningen.genericError)
      }
    })
  }

  async function handleCreateAndAdd(input: OefeningInput) {
    await createAndAddOefening(eventId, input)
    // Zelfde ritme als een keuze uit de bibliotheek: terug naar de lijst, sheet
    // blijft open. De nieuwe oefening zit in de volgende `library`-prop van de
    // server, dus hij staat er meteen tussen.
    setShowCreate(false)
    setToegevoegd((eerder) => [...eerder, 'nieuw'])
  }

  if (showCreate) {
    return (
      <OefeningEditor
        // Altijd terug naar de lijst, ook bij een suggestie: annuleren betekent
        // "toch geen nieuwe maken", niet "laat de hele training met rust".
        onCancel={() => setShowCreate(false)}
        onSubmit={handleCreateAndAdd}
        presetCategorie={presetCategorie}
        presetNaam={presetCategorie ? (t.periodization.categories[presetCategorie] ?? presetCategorie) : undefined}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center">
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
            <div className="rounded-xl bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-4 py-3">
              {error}
            </div>
          )}

          {presetCategorie && (
            <p className="text-xs font-semibold text-faint">{t.oefeningen.pickerSuggestionHint}</p>
          )}

          <input
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            placeholder={t.oefeningen.pickerSearchPlaceholder}
            className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] bg-surface focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 text-ink placeholder:text-faint"
          />

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="oefening-filter-categorie" className="block text-xs font-semibold text-muted mb-1">
                  {t.oefeningen.filterCategoryLabel}
                </label>
                <select
                  id="oefening-filter-categorie"
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
                <label htmlFor="oefening-filter-veldzone" className="block text-xs font-semibold text-muted mb-1">
                  {t.oefeningen.filterZoneLabel}
                </label>
                <select
                  id="oefening-filter-veldzone"
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
            </div>

            <div>
              <p className="text-xs font-semibold text-muted mb-1">{t.oefeningen.filterCountLabel}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="oefening-filter-aantal-min" className="sr-only">
                    {`${t.oefeningen.filterCountLabel} ${t.oefeningen.filterMinPlaceholder}`}
                  </label>
                  <input
                    id="oefening-filter-aantal-min"
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
                  <label htmlFor="oefening-filter-aantal-max" className="sr-only">
                    {`${t.oefeningen.filterCountLabel} ${t.oefeningen.filterMaxPlaceholder}`}
                  </label>
                  <input
                    id="oefening-filter-aantal-max"
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="oefening-filter-duur-min" className="sr-only">
                    {`${t.oefeningen.filterDurationLabel} ${t.oefeningen.filterMinPlaceholder}`}
                  </label>
                  <input
                    id="oefening-filter-duur-min"
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
                  <label htmlFor="oefening-filter-duur-max" className="sr-only">
                    {`${t.oefeningen.filterDurationLabel} ${t.oefeningen.filterMaxPlaceholder}`}
                  </label>
                  <input
                    id="oefening-filter-duur-max"
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

          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="w-full py-3 rounded-xl border-2 border-dashed border-warning/30 text-warning-text hover:border-warning/50 hover:bg-warning/10 font-semibold text-sm transition active:scale-[0.98]"
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
                  className="w-full text-left bg-surface rounded-xl border border-[var(--border-soft)] hover:border-warning/50 hover:bg-warning/10 p-3 transition-colors disabled:opacity-50"
                >
                  <div className="font-semibold text-ink">{o.naam}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-muted">
                      {t.periodization.categories[o.categorie] ?? o.categorie}
                    </span>
                    {o.duur_min != null && <span className="text-xs text-faint">{o.duur_min} min</span>}
                    {aantalToegevoegd(o.id) > 0 && (
                      <span className="text-xs font-bold" style={{ color: 'var(--brand-accent)' }}>
                        {t.oefeningen.pickerAddedTimes.replace('{n}', String(aantalToegevoegd(o.id)))}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sluitknop onderaan: sinds toevoegen de sheet openhoudt, moet er een
            duidelijke manier zijn om te zeggen "ik ben klaar". Sticky, zodat
            hij bij een lange bibliotheek in beeld blijft. */}
        <div className="sticky bottom-0 bg-surface border-t border-[var(--border-soft)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full h-11 rounded-xl text-sm font-bold text-white active:scale-[0.98] transition"
            style={{ background: 'var(--primary)' }}
          >
            {toegevoegd.length === 0
              ? t.oefeningen.pickerDone
              : t.oefeningen.pickerDoneCount.replace('{n}', String(toegevoegd.length))}
          </button>
        </div>
      </div>
    </div>
  )
}
