'use client'

import { useState, useTransition } from 'react'
import {
  Diagram,
  Oefening,
  OefeningCategorie,
  OefeningTeam,
  Veldzone,
  PERIODIZATION_CATEGORIES,
} from '@/lib/types'
import { VALID_TEAM_SIZES, formatiesVoorTeam, basisFormatieDef, isFormatieGeldigVoorTeam } from '@/lib/formaties'
import type { OefeningInput } from '@/lib/oefening'
import { teamBereikLabel } from '@/lib/oefening-bezetting'
import FormationField from '@/components/FormationField'
import DiagramEditor from '@/components/DiagramEditor'
import { useDict } from '@/lib/i18n-context'

const ALL_CATS = PERIODIZATION_CATEGORIES
const TEAM_SIZES = VALID_TEAM_SIZES
const MAX_TEAMS = 6

// Team-rij tijdens het bewerken: grootte mag tijdelijk leeg (null) zijn
// zolang de gebruiker nog geen keuze heeft gemaakt. Alleen rijen met een
// gekozen grootte worden meegenomen in de uiteindelijke OefeningInput.
// keeperInGrootte is (in tegenstelling tot OefeningTeam) NIET optioneel in de
// lokale state — er is altijd een expliciete waarde (default true), zodat elke
// afgeleide berekening (catalogus, filtering) een ondubbelzinnige teamvorm heeft.
interface TeamRow {
  grootte: number | null
  formaties: string[]
  keeperInGrootte: boolean
  // Bovengrens van een flexibel team (bereikVoorTeam, lib/oefening-bezetting.ts).
  // null = vast/exact team. Nooit samen met een gekozen formatie — zie
  // handleTeamSizeChange/selectTeamFormatie/setTeamGrootteMax.
  grootteMax: number | null
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

// Filtert meegekomen `formaties` alvast op geldigheid tegen de huidige
// categorie: voorkomt dat een inmiddels ongeldige, opgeslagen selectie in de
// state komt — anders geeft een ongerelateerde wijziging bij opslaan een
// serverfout. Reduceert de selectie daarna ook tot maximaal 1 item: legacy
// rijen uit de teruggedraaide multi-select-feature kunnen nog meerdere
// geldige keys bevatten, terwijl de UI overal single-select afdwingt. Bij
// meerdere waarden wint dezelfde alfabetisch-eerste die basisFormatieDef ook
// als "de" basisformatie aanwijst.
function teamsToRows(teams: OefeningTeam[], categorie: OefeningCategorie): TeamRow[] {
  return teams.map((t) => {
    const keeperInGrootte = t.keeperInGrootte ?? true
    const geldig = (t.formaties ?? []).filter((key) =>
      isFormatieGeldigVoorTeam(key, { grootte: t.grootte, keeperInGrootte }, categorie),
    )
    const basis = basisFormatieDef({ grootte: t.grootte, formaties: geldig, keeperInGrootte })
    const formaties = basis ? [basis.key] : []
    // Dit is exact de teamsToRows-valkuil (geheugen.md): de weergave leest
    // grootteMax al genormaliseerd (basisFormatieDef/FormationField), maar
    // zonder deze regel zou de editor-INITIALISATIE het bereik stilzwijgend
    // laten vallen zodra de trainer een bestaande oefening opent en opslaat.
    // Een rij met een (nog geldige) formatie krijgt nooit een bereik.
    const grootteMax = geldig.length > 0 ? null : (t.grootteMax ?? null)
    return { grootte: t.grootte, formaties, keeperInGrootte, grootteMax }
  })
}

export default function OefeningEditor({ initial, onCancel, onSubmit, presetCategorie, presetNaam }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [naam, setNaam] = useState(initial?.naam ?? presetNaam ?? '')
  const [beschrijving, setBeschrijving] = useState(initial?.beschrijving ?? '')
  const initialCategorie = initial?.categorie ?? presetCategorie ?? 'partijen_groot'
  const [categorie, setCategorie] = useState<OefeningCategorie>(initialCategorie)
  const [duurMin, setDuurMin] = useState<number | null>(initial?.duur_min ?? null)
  const [breedteM, setBreedteM] = useState<number | null>(initial?.breedte_m ?? null)
  const [lengteM, setLengteM] = useState<number | null>(initial?.lengte_m ?? null)
  const [veldzone, setVeldzone] = useState<Veldzone | null>(initial?.veldzone ?? null)
  const [teams, setTeams] = useState<TeamRow[]>(teamsToRows(initial?.teams ?? [], initialCategorie))
  const [aantalNeutralen, setAantalNeutralen] = useState<number>(initial?.aantal_neutralen ?? 0)
  // Bovengrens van een flexibel aantal neutralen (supabase/oefening-flexibel-
  // aantal.sql). null = vast aantal.
  const [aantalNeutralenMax, setAantalNeutralenMax] = useState<number | null>(initial?.aantal_neutralen_max ?? null)
  const [diagram, setDiagram] = useState<Diagram | null>(initial?.diagram ?? null)
  const [showDiagramEditor, setShowDiagramEditor] = useState(false)
  // orientatie heeft (net als voorheen) geen eigen invoerveld in deze sheet;
  // bestaande waarde wordt bij bewerken behouden i.p.v. stilzwijgend gereset.
  const orientatie = initial?.orientatie ?? 'vrij'

  // Teams zoals ze meegaan naar het diagram: alleen rijen met een gekozen
  // grootte (zelfde filter als handleSubmit hieronder).
  const diagramTeams: OefeningTeam[] = teams
    .filter((tm): tm is TeamRow & { grootte: number } => tm.grootte !== null)
    .map((tm) => ({ grootte: tm.grootte, formaties: tm.formaties, keeperInGrootte: tm.keeperInGrootte }))

  const catLabel = (key: string) => t.periodization.categories[key] ?? key

  function addTeam() {
    setTeams((prev) =>
      prev.length >= MAX_TEAMS ? prev : [...prev, { grootte: null, formaties: [], keeperInGrootte: true, grootteMax: null }],
    )
  }

  function removeTeam(index: number) {
    setTeams((prev) => prev.filter((_, i) => i !== index))
  }

  function handleTeamSizeChange(index: number, newSize: number | null) {
    setTeams((prev) => prev.map((tm, i) => {
      if (i !== index) return tm
      // 11-tal forceert altijd een keeper — geen keuze te tonen/te bewaren.
      const keeperInGrootte = newSize === 11 ? true : tm.keeperInGrootte
      const formaties =
        newSize === null
          ? []
          : tm.formaties.filter((key) => isFormatieGeldigVoorTeam(key, { grootte: newSize, keeperInGrootte }, categorie))
      // Stille-filter-precedent (zelfde als de formatieselectie hierboven):
      // een bovengrens die onder de nieuwe grootte zou komen te liggen
      // vervalt, net als een niet-meer-passende formatie.
      const grootteMax =
        newSize === null ? null : (tm.grootteMax !== null && tm.grootteMax >= newSize ? tm.grootteMax : null)
      return { grootte: newSize, formaties, keeperInGrootte, grootteMax }
    }))
  }

  // Single-select: dezelfde chip nogmaals aanklikken maakt de selectie leeg
  // ("geen formatie"); een andere chip aanklikken vervangt de vorige keuze.
  function selectTeamFormatie(index: number, key: string) {
    setTeams((prev) => prev.map((tm, i) => {
      if (i !== index) return tm
      const formaties = tm.formaties.includes(key) ? [] : [key]
      // Defensief (de UI disabled de chips al zodra grootteMax gezet is, zie
      // de teamrij hieronder): een formatie en een bereik gaan nooit samen.
      return { ...tm, formaties, grootteMax: formaties.length > 0 ? null : tm.grootteMax }
    }))
  }

  // Nieuw select "Tot en met": leeg (`''`) → vast/exact team.
  function setTeamGrootteMax(index: number, value: number | null) {
    setTeams((prev) => prev.map((tm, i) => (i === index ? { ...tm, grootteMax: value } : tm)))
  }

  // Keeper-schakelaar is per team: wijzigen van team A raakt team B niet.
  function setTeamKeeper(index: number, keeperInGrootte: boolean) {
    setTeams((prev) => prev.map((tm, i) => {
      if (i !== index || tm.grootte === null) return tm
      const formaties = tm.formaties.filter((key) =>
        isFormatieGeldigVoorTeam(key, { grootte: tm.grootte as number, keeperInGrootte }, categorie),
      )
      return { ...tm, keeperInGrootte, formaties }
    }))
  }

  // Categorie is oefening-breed: raakt de selectie van ALLE teamrijen tegelijk.
  function handleCategorieChange(newCategorie: OefeningCategorie) {
    setCategorie(newCategorie)
    setTeams((prev) => prev.map((tm) => {
      if (tm.grootte === null) return tm
      const formaties = tm.formaties.filter((key) =>
        isFormatieGeldigVoorTeam(key, { grootte: tm.grootte as number, keeperInGrootte: tm.keeperInGrootte }, newCategorie),
      )
      return { ...tm, formaties }
    }))
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
        .filter((tm): tm is TeamRow & { grootte: number } => tm.grootte !== null)
        .map((tm) => ({
          grootte: tm.grootte,
          formaties: tm.formaties,
          keeperInGrootte: tm.keeperInGrootte,
          // Spread-vorm (zelfde precedent als normalizeOefeningTeam/validateOefening):
          // een exact team stuurt geen `grootteMax: null`-ruis mee.
          ...(tm.grootteMax !== null ? { grootteMax: tm.grootteMax } : {}),
        })),
      aantal_neutralen: aantalNeutralen,
      aantal_neutralen_max: aantalNeutralenMax,
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
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center">
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
            <div className="rounded-xl bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-4 py-3">
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
              className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 bg-surface text-ink placeholder:text-faint"
            />
          </div>

          {/* Categorie */}
          <div>
            <label htmlFor="oefening-categorie" className="block text-sm font-semibold text-muted mb-1.5">{t.trainingPlan.category}</label>
            <select
              id="oefening-categorie"
              value={categorie}
              onChange={(e) => handleCategorieChange(e.target.value as OefeningCategorie)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 text-ink bg-surface"
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
              className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 bg-surface text-ink placeholder:text-faint resize-none text-sm"
            />
          </div>

          {/* Duur + Aantal neutralen (+ bovengrens) */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-semibold text-muted mb-1.5">{t.trainingPlan.duration}</label>
              <input
                type="number" min={0} max={120}
                value={duurMin ?? ''}
                onChange={(e) => setDuurMin(e.target.value ? parseInt(e.target.value) : null)}
                placeholder="15"
                className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 bg-surface text-ink placeholder:text-faint"
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
                className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 bg-surface text-ink"
              />
            </div>
            <div>
              <label htmlFor="oefening-neutralen-max" className="block text-sm font-semibold text-muted mb-1.5">{t.oefeningen.neutralsMaxLabel}</label>
              <input
                id="oefening-neutralen-max"
                type="number" min={aantalNeutralen} max={30}
                value={aantalNeutralenMax ?? ''}
                // Eerst op '' testen, nooit `|| null` — 0 is een geldige
                // bovengrens bij een basisaantal van 0 (falsy-zero-valkuil).
                onChange={(e) => setAantalNeutralenMax(e.target.value === '' ? null : Number(e.target.value))}
                placeholder={t.oefeningen.rangeNone}
                className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 bg-surface text-ink placeholder:text-faint"
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
                className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 bg-surface text-ink placeholder:text-faint text-sm"
              />
              <input
                type="number" min={0} max={200} step={0.5}
                value={lengteM ?? ''}
                onChange={(e) => setLengteM(e.target.value ? parseFloat(e.target.value) : null)}
                placeholder={t.trainingPlan.fieldLength}
                className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 bg-surface text-ink placeholder:text-faint text-sm"
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
                  className={`py-2 px-3 rounded-xl text-sm font-semibold border-2 transition ${
                    veldzone === zone
                      ? 'bg-warning text-white border-warning'
                      : 'border-[var(--border-soft)] text-muted hover:border-warning/50'
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
                  className={`py-2 px-2 rounded-xl text-xs font-semibold border-2 transition ${
                    veldzone === zone
                      ? 'bg-warning text-white border-warning'
                      : 'border-[var(--border-soft)] text-muted hover:border-warning/50'
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
                className="text-xs font-semibold text-warning-text hover:text-panel-orange-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t.oefeningen.addTeam}
              </button>
            </div>

            {teams.length === 0 && (
              <p className="text-xs text-faint">{t.oefeningen.noTeamsHint}</p>
            )}

            <div className="space-y-3">
              {teams.map((team, i) => {
                const formationOptions =
                  team.grootte !== null
                    ? formatiesVoorTeam({ grootte: team.grootte, keeperInGrootte: team.keeperInGrootte }, categorie)
                    : []
                const basis =
                  team.grootte !== null
                    ? basisFormatieDef({ grootte: team.grootte, formaties: team.formaties, keeperInGrootte: team.keeperInGrootte })
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
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 text-sm text-ink bg-surface"
                        >
                          <option value="">{t.oefeningen.noTeamSize}</option>
                          {TEAM_SIZES.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-1 min-w-0">
                        <label htmlFor={`team-size-max-${i}`} className="block text-xs font-semibold text-muted mb-1">{t.oefeningen.teamSizeMax}</label>
                        <select
                          id={`team-size-max-${i}`}
                          value={team.grootteMax ?? ''}
                          disabled={team.grootte === null || team.formaties.length > 0}
                          onChange={(e) => setTeamGrootteMax(i, e.target.value ? Number(e.target.value) : null)}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 text-sm text-ink bg-surface disabled:opacity-50"
                        >
                          <option value="">{t.oefeningen.rangeNone}</option>
                          {team.grootte !== null && TEAM_SIZES.filter((n) => n >= (team.grootte as number)).map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                        {/* Bereik-hint: legt uit wat dit veld doet, of waarom
                            het (samen met de formatiechips hieronder) disabled
                            staat — nooit de een de ander stilzwijgend wissen. */}
                        <p className="text-[11px] text-faint mt-1">
                          {team.formaties.length > 0 ? t.oefeningen.rangeFormationHint : t.oefeningen.rangeHint}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeTeam(i)}
                        aria-label={t.oefeningen.removeTeamAria}
                        className="flex-shrink-0 w-9 h-9 rounded-lg hover:bg-panel-red flex items-center justify-center text-faint hover:text-panel-red-ink transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>

                    {/* Keeper-schakelaar per team — verborgen bij een 11-tal
                        (die forceert de keeper altijd, geen keuze nodig). */}
                    {team.grootte !== null && team.grootte !== 11 && (
                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1">{t.oefeningen.keeperLabel}</label>
                        <div role="group" aria-label={t.oefeningen.keeperLabel} className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            aria-pressed={team.keeperInGrootte}
                            onClick={() => setTeamKeeper(i, true)}
                            className={`py-1.5 px-3 rounded-lg text-xs font-semibold border-2 transition ${
                              team.keeperInGrootte
                                ? 'bg-warning text-white border-warning'
                                : 'border-[var(--border-soft)] text-muted hover:border-warning/50'
                            }`}
                          >
                            {t.oefeningen.keeperIncluded}
                          </button>
                          <button
                            type="button"
                            aria-pressed={!team.keeperInGrootte}
                            onClick={() => setTeamKeeper(i, false)}
                            className={`py-1.5 px-3 rounded-lg text-xs font-semibold border-2 transition ${
                              !team.keeperInGrootte
                                ? 'bg-warning text-white border-warning'
                                : 'border-[var(--border-soft)] text-muted hover:border-warning/50'
                            }`}
                          >
                            {t.oefeningen.keeperExcluded}
                          </button>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">{t.oefeningen.formation}</label>
                      {team.grootte !== null && (
                        formationOptions.length > 0 ? (
                          <div role="group" aria-label={t.oefeningen.formation} className="flex flex-wrap gap-2">
                            {formationOptions.map((f) => {
                              const selected = team.formaties.includes(f.key)
                              const bereikActief = team.grootteMax !== null
                              return (
                                <button
                                  key={f.key}
                                  type="button"
                                  aria-pressed={selected}
                                  disabled={bereikActief}
                                  onClick={() => selectTeamFormatie(i, f.key)}
                                  className={`py-1.5 px-3 rounded-lg text-xs font-semibold border-2 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-[var(--border-soft)] ${
                                    selected
                                      ? 'bg-warning text-white border-warning'
                                      : 'border-[var(--border-soft)] text-muted hover:border-warning/50'
                                  }`}
                                >
                                  {f.label}
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          // AC18 — lege catalogus (bv. grootte 3 + inclusief keeper +
                          // partijen_groot): geen opties om uit te kiezen, disabled-staat.
                          <span
                            data-testid={`geen-formaties-${i}`}
                            aria-disabled="true"
                            className="inline-block py-1.5 px-3 rounded-lg text-xs font-semibold border-2 border-[var(--border-soft)] text-faint opacity-60 cursor-not-allowed"
                          >
                            {t.oefeningen.noFormationsAvailable}
                          </span>
                        )
                      )}
                      {team.grootte !== null && team.grootteMax !== null && (
                        <p className="text-[11px] text-faint mt-1">{t.oefeningen.rangeFormationHint}</p>
                      )}
                    </div>

                    {/* Preview: bij een gekozen formatie de bekende
                        `grootte · label`; bij een bereik (per definitie geen
                        formatie) het bereik-label, zodat de trainer het ook
                        hier terugziet — nu ook zonder formatie getoond zodra
                        er een bereik is. */}
                    {team.grootte !== null && (basis || team.grootteMax !== null) && (
                      <FormationField
                        positions={basis?.positions ?? []}
                        label={`${teamBereikLabel({ grootte: team.grootte, formaties: team.formaties, keeperInGrootte: team.keeperInGrootte, grootteMax: team.grootteMax })}${basis ? ` · ${basis.label}` : ''}`}
                        sizePx={110}
                      />
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
              className="text-sm font-semibold text-warning-text hover:text-panel-orange-ink transition-colors"
            >
              <span className="ms text-[18px] align-middle mr-1" aria-hidden="true">{showDiagramEditor ? 'expand_more' : 'chevron_right'}</span>{t.oefeningen.diagramToggle}
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
            className="flex-1 py-3 rounded-xl border-2 border-[var(--border-soft)] font-semibold text-muted hover:text-ink transition active:scale-95"
          >
            {t.trainingPlan.cancel}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !naam.trim()}
            className="flex-1 py-3 rounded-xl bg-warning hover:bg-warning/90 text-white font-semibold transition active:scale-95 disabled:opacity-50"
          >
            {isPending ? t.trainingPlan.saving : t.trainingPlan.save}
          </button>
        </div>
      </div>
    </div>
  )
}
