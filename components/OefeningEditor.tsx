'use client'

import { useState, useTransition } from 'react'
import {
  Diagram,
  Oefening,
  OefeningCategorie,
  OefeningTeam,
  Veldzone,
  PERIODIZATION_CATEGORIES,
  FORMATIONS_BY_TEAM_SIZE,
  formationsForSize,
  isFormationValidForSize,
} from '@/lib/types'
import type { OefeningInput } from '@/lib/oefening'
import FormationField from '@/components/FormationField'
import DiagramEditor from '@/components/DiagramEditor'
import { useDict } from '@/lib/i18n-context'

const ALL_CATS = PERIODIZATION_CATEGORIES
const TEAM_SIZES = Object.keys(FORMATIONS_BY_TEAM_SIZE).map(Number).sort((a, b) => a - b)
const MAX_TEAMS = 6

// Team-rij tijdens het bewerken: grootte mag tijdelijk leeg (null) zijn
// zolang de gebruiker nog geen keuze heeft gemaakt. Alleen rijen met een
// gekozen grootte worden meegenomen in de uiteindelijke OefeningInput.
interface TeamRow {
  grootte: number | null
  formatie: string | null
}

interface Props {
  /** Aanwezig => bewerk-modus met vooringevulde waarden; afwezig => nieuwe oefening. */
  initial?: Oefening | null
  onCancel: () => void
  /** De aanroeper bepaalt welke server action wordt gebruikt (createOefening / updateOefening / createAndAddOefening). */
  onSubmit: (input: OefeningInput) => Promise<unknown>
  /** Voorinvullen bij het aanmaken vanuit een periodiserings-suggestie (alleen gebruikt als `initial` ontbreekt). */
  presetCategorie?: OefeningCategorie
  presetNaam?: string
}

function teamsToRows(teams: OefeningTeam[]): TeamRow[] {
  return teams.map((t) => ({ grootte: t.grootte, formatie: t.formatie }))
}

export default function OefeningEditor({ initial, onCancel, onSubmit, presetCategorie, presetNaam }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [naam, setNaam] = useState(initial?.naam ?? presetNaam ?? '')
  const [beschrijving, setBeschrijving] = useState(initial?.beschrijving ?? '')
  const [categorie, setCategorie] = useState<OefeningCategorie>(initial?.categorie ?? presetCategorie ?? 'partijen_groot')
  const [duurMin, setDuurMin] = useState<number | null>(initial?.duur_min ?? null)
  const [breedteM, setBreedteM] = useState<number | null>(initial?.breedte_m ?? null)
  const [lengteM, setLengteM] = useState<number | null>(initial?.lengte_m ?? null)
  const [veldzone, setVeldzone] = useState<Veldzone | null>(initial?.veldzone ?? null)
  const [teams, setTeams] = useState<TeamRow[]>(teamsToRows(initial?.teams ?? []))
  const [aantalNeutralen, setAantalNeutralen] = useState<number>(initial?.aantal_neutralen ?? 0)
  const [diagram, setDiagram] = useState<Diagram | null>(initial?.diagram ?? null)
  const [showDiagramEditor, setShowDiagramEditor] = useState(false)
  // orientatie heeft (net als voorheen) geen eigen invoerveld in deze sheet;
  // bestaande waarde wordt bij bewerken behouden i.p.v. stilzwijgend gereset.
  const orientatie = initial?.orientatie ?? 'vrij'

  // Teams zoals ze meegaan naar het diagram: alleen rijen met een gekozen
  // grootte (zelfde filter als handleSubmit hieronder).
  const diagramTeams: OefeningTeam[] = teams
    .filter((tm): tm is { grootte: number; formatie: string | null } => tm.grootte !== null)
    .map((tm) => ({ grootte: tm.grootte, formatie: tm.formatie }))

  const catLabel = (key: string) => t.periodization.categories[key] ?? key

  function addTeam() {
    setTeams((prev) => (prev.length >= MAX_TEAMS ? prev : [...prev, { grootte: null, formatie: null }]))
  }

  function removeTeam(index: number) {
    setTeams((prev) => prev.filter((_, i) => i !== index))
  }

  function handleTeamSizeChange(index: number, newSize: number | null) {
    setTeams((prev) => prev.map((tm, i) => {
      if (i !== index) return tm
      const stillValid = isFormationValidForSize(newSize, tm.formatie)
      return { grootte: newSize, formatie: stillValid ? tm.formatie : null }
    }))
  }

  function handleTeamFormatieChange(index: number, formatie: string | null) {
    setTeams((prev) => prev.map((tm, i) => (i === index ? { ...tm, formatie } : tm)))
  }

  function handleSubmit() {
    setError(null)
    const input: OefeningInput = {
      naam: naam.trim(),
      beschrijving: beschrijving || null,
      categorie,
      duur_min: duurMin,
      breedte_m: breedteM,
      lengte_m: lengteM,
      orientatie,
      veldzone,
      teams: teams
        .filter((tm): tm is { grootte: number; formatie: string | null } => tm.grootte !== null)
        .map((tm) => ({ grootte: tm.grootte, formatie: tm.formatie })),
      aantal_neutralen: aantalNeutralen,
      diagram,
    }
    startTransition(async () => {
      try {
        await onSubmit(input)
      } catch (e) {
        setError(e instanceof Error ? e.message : t.oefeningen.genericError)
      }
    })
  }

  const isEdit = !!initial

  return (
    <div className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-lg bg-surface rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92dvh] overflow-y-auto">
        <div className="sticky top-0 bg-surface border-b border-[var(--border-soft)] px-5 py-4 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl z-10">
          <h3 className="font-bold text-ink text-lg">
            {isEdit ? t.oefeningen.editTitle : t.oefeningen.newTitle}
          </h3>
          <button type="button" onClick={onCancel} className="w-8 h-8 rounded-full bg-surface-sunken flex items-center justify-center text-muted hover:bg-surface-sunken">
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

          {/* Naam */}
          <div>
            <label htmlFor="oefening-naam" className="block text-sm font-semibold text-muted mb-1.5">{t.trainingPlan.exerciseName} *</label>
            <input
              id="oefening-naam"
              type="text"
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              placeholder={t.trainingPlan.exerciseNamePlaceholder}
              className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-surface text-ink placeholder:text-faint"
            />
          </div>

          {/* Categorie */}
          <div>
            <label className="block text-sm font-semibold text-muted mb-1.5">{t.trainingPlan.category}</label>
            <select
              value={categorie}
              onChange={(e) => setCategorie(e.target.value as OefeningCategorie)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-ink bg-surface"
            >
              {ALL_CATS.map((cat) => (
                <option key={cat.key} value={cat.key}>{catLabel(cat.key)}</option>
              ))}
            </select>
          </div>

          {/* Beschrijving */}
          <div>
            <label className="block text-sm font-semibold text-muted mb-1.5">{t.trainingPlan.exerciseDescription}</label>
            <textarea
              rows={3}
              value={beschrijving ?? ''}
              onChange={(e) => setBeschrijving(e.target.value)}
              placeholder={t.trainingPlan.exerciseDescriptionPlaceholder}
              className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-surface text-ink placeholder:text-faint resize-none text-sm"
            />
          </div>

          {/* Duur + Aantal neutralen */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-muted mb-1.5">{t.trainingPlan.duration}</label>
              <input
                type="number" min={0} max={120}
                value={duurMin ?? ''}
                onChange={(e) => setDuurMin(e.target.value ? parseInt(e.target.value) : null)}
                placeholder="15"
                className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-surface text-ink placeholder:text-faint"
              />
            </div>
            <div>
              <label htmlFor="oefening-neutralen" className="block text-sm font-semibold text-muted mb-1.5">{t.oefeningen.neutralsLabel}</label>
              <input
                id="oefening-neutralen"
                type="number" min={0} max={30}
                value={aantalNeutralen}
                onChange={(e) => {
                  const raw = parseInt(e.target.value)
                  const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(30, raw)) : 0
                  setAantalNeutralen(clamped)
                }}
                className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-surface text-ink"
              />
            </div>
          </div>

          {/* Veldgrootte */}
          <div>
            <label className="block text-sm font-semibold text-muted mb-1.5">{t.trainingPlan.fieldSize}</label>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number" min={0} max={200} step={0.5}
                value={breedteM ?? ''}
                onChange={(e) => setBreedteM(e.target.value ? parseFloat(e.target.value) : null)}
                placeholder={t.trainingPlan.fieldWidth}
                className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-surface text-ink placeholder:text-faint text-sm"
              />
              <input
                type="number" min={0} max={200} step={0.5}
                value={lengteM ?? ''}
                onChange={(e) => setLengteM(e.target.value ? parseFloat(e.target.value) : null)}
                placeholder={t.trainingPlan.fieldLength}
                className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-surface text-ink placeholder:text-faint text-sm"
              />
            </div>
          </div>

          {/* Veldzone */}
          <div>
            <label className="block text-sm font-semibold text-muted mb-1.5">{t.trainingPlan.fieldZone}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['links', 'midden', 'rechts'] as const).map((zone) => (
                <button
                  key={zone}
                  type="button"
                  onClick={() => setVeldzone(veldzone === zone ? null : zone)}
                  className={`py-2 px-3 rounded-xl text-sm font-semibold border-2 transition-all ${
                    veldzone === zone
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'border-[var(--border-soft)] text-muted hover:border-orange-300'
                  }`}
                >
                  {t.trainingPlan.fieldZones[zone]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {(['strafschopgebied_links', 'strafschopgebied_rechts'] as const).map((zone) => (
                <button
                  key={zone}
                  type="button"
                  onClick={() => setVeldzone(veldzone === zone ? null : zone)}
                  className={`py-2 px-2 rounded-xl text-xs font-semibold border-2 transition-all ${
                    veldzone === zone
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'border-[var(--border-soft)] text-muted hover:border-orange-300'
                  }`}
                >
                  {t.trainingPlan.fieldZones[zone]}
                </button>
              ))}
            </div>
          </div>

          {/* Teams — dynamische lijst */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-semibold text-muted">{t.oefeningen.teamsSection}</label>
              <button
                type="button"
                onClick={addTeam}
                disabled={teams.length >= MAX_TEAMS}
                className="text-xs font-semibold text-orange-600 hover:text-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t.oefeningen.addTeam}
              </button>
            </div>

            {teams.length === 0 && (
              <p className="text-xs text-faint">{t.oefeningen.noTeamsHint}</p>
            )}

            <div className="space-y-3">
              {teams.map((team, i) => {
                const formationOptions = team.grootte !== null ? formationsForSize(team.grootte) : []
                const previewPositions = team.grootte !== null && team.formatie
                  ? formationOptions.find((f) => f.key === team.formatie)?.positions ?? null
                  : null
                return (
                  <div key={i} className="rounded-xl border border-[var(--border-soft)] p-3 space-y-2">
                    <div className="flex items-end gap-2">
                      <div className="flex-1 min-w-0">
                        <label htmlFor={`team-size-${i}`} className="block text-xs font-semibold text-muted mb-1">{t.oefeningen.teamSize}</label>
                        <select
                          id={`team-size-${i}`}
                          value={team.grootte ?? ''}
                          onChange={(e) => handleTeamSizeChange(i, e.target.value ? Number(e.target.value) : null)}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border-soft)] focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-sm text-ink bg-surface"
                        >
                          <option value="">{t.oefeningen.noTeamSize}</option>
                          {TEAM_SIZES.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-1 min-w-0">
                        <label htmlFor={`team-formatie-${i}`} className="block text-xs font-semibold text-muted mb-1">{t.oefeningen.formation}</label>
                        <select
                          id={`team-formatie-${i}`}
                          value={team.formatie ?? ''}
                          onChange={(e) => handleTeamFormatieChange(i, e.target.value || null)}
                          disabled={team.grootte === null}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border-soft)] focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 text-sm text-ink bg-surface disabled:bg-surface-sunken disabled:text-faint"
                        >
                          <option value="">{t.oefeningen.noFormation}</option>
                          {formationOptions.map((f) => (
                            <option key={f.key} value={f.key}>{f.label}</option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeTeam(i)}
                        aria-label={t.oefeningen.removeTeamAria}
                        className="flex-shrink-0 w-9 h-9 rounded-lg hover:bg-red-50 flex items-center justify-center text-faint hover:text-red-500 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                    {previewPositions && (
                      <FormationField positions={previewPositions} label={`${team.grootte} · ${team.formatie}`} sizePx={110} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Tekening — achter een toggle zodat de sheet op mobiel kort blijft */}
          <div>
            <button
              type="button"
              onClick={() => setShowDiagramEditor((v) => !v)}
              className="text-sm font-semibold text-orange-600 hover:text-orange-700 transition-colors"
            >
              {showDiagramEditor ? `▾ ${t.oefeningen.diagramToggle}` : `▸ ${t.oefeningen.diagramToggle}`}
            </button>
            {showDiagramEditor && (
              <div className="mt-3">
                <label className="block text-sm font-semibold text-muted mb-1.5">{t.oefeningen.diagramSection}</label>
                <DiagramEditor
                  value={diagram}
                  teams={diagramTeams}
                  aantalNeutralen={aantalNeutralen}
                  veldzone={veldzone}
                  onChange={setDiagram}
                />
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 bg-surface border-t border-[var(--border-soft)] p-4 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl border-2 border-[var(--border-soft)] font-semibold text-muted hover:text-ink transition-all active:scale-95"
          >
            {t.trainingPlan.cancel}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !naam.trim()}
            className="flex-1 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-all active:scale-95 disabled:opacity-50"
          >
            {isPending ? t.trainingPlan.saving : t.trainingPlan.save}
          </button>
        </div>
      </div>
    </div>
  )
}
