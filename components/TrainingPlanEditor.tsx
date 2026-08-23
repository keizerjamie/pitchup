'use client'

import { useState, useTransition, useRef, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { Oefening, OefeningCategorie, PERIODIZATION_CATEGORIES, Player, Spelerindeling, TrainingOefeningWithData } from '@/lib/types'
import { basisFormatieDef } from '@/lib/formaties'
import { saveDoelstelling } from '@/app/actions/training-plan'
import { removeOefeningFromTraining, updateKoppeling, reorderKoppelingen } from '@/app/actions/training-plan'
import { vormParallelGroep, voegToeAanParallelGroep, haalUitParallelGroep } from '@/app/actions/training-plan'
import { blokkenVanKoppelingen, blokLabel } from '@/lib/parallel-groep'
import { clampStapOverride, heeftStapInhoud, maxStapVoor, stapInhoud } from '@/lib/periodization-stappen'
import FormationField from '@/components/FormationField'
import DiagramView from '@/components/DiagramView'
import OefeningPicker from '@/components/OefeningPicker'
import TeamIndelingEditor from '@/components/TeamIndelingEditor'
import ParallelGroepEditor from '@/components/ParallelGroepEditor'
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

  // Render-eenheid: losse koppelingen ÉN parallelle groepen als één blok (zie
  // lib/parallel-groep.ts). Gememoized op `koppelingen` (niet elke render
  // herberekend) zodat `blok.leden`-arrays referentieel stabiel blijven zolang
  // `koppelingen` zelf niet wijzigt — ParallelGroepEditor leunt hier verder
  // niet blindelings op (zie de waarde-signatuur daar), maar dit voorkomt
  // onnodig werk bij re-renders die niets met de oefeningen te maken hebben
  // (bv. de doelstelling typen).
  const blokken = useMemo(() => blokkenVanKoppelingen(koppelingen), [koppelingen])

  // Doorlopende nummering van de bestaande parallelle groepen in dit event,
  // voor de "Groep {n}"-optielabels in het "Parallel aan"-veld (los van de
  // blok-badge-nummering "1a/1b", die per lid al zijn eigen label heeft).
  const parallelGroepNummers = useMemo(
    () =>
      blokken
        .filter((b) => b.groepId !== null)
        .map((b, i) => ({ groepId: b.groepId as string, number: i + 1 })),
    [blokken],
  )

  const [showPicker, setShowPicker] = useState(false)
  const [pickerPresetCategorie, setPickerPresetCategorie] = useState<OefeningCategorie | undefined>(undefined)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [unlinkConfirm, setUnlinkConfirm] = useState<string | null>(null)
  const doelstellingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Foutmeldingen per koppeling voor een mislukte stap_override-save (nooit
  // de rauwe serverfout tonen — zelfde principe als TeamIndelingEditor's
  // saveError).
  const [stapOverrideErrors, setStapOverrideErrors] = useState<Record<string, string>>({})

  // Foutmeldingen per koppeling voor een mislukte parallelle-groep-mutatie via
  // het "Parallel aan"-veld (nooit de rauwe serverfout tonen — zelfde principe
  // als stapOverrideErrors hierboven).
  const [parallelErrors, setParallelErrors] = useState<Record<string, string>>({})

  // Laatst bevestigde stap_override per koppeling (server-waarde óf een
  // succesvol opgeslagen waarde) — bron voor de rollback bij een mislukte
  // save. Ref i.p.v. state: mag niet tijdens render gemuteerd worden (React
  // verbiedt dit), vandaar de useEffect hieronder die 'm bijhoudt zodra de
  // server een frisse `initialOefeningen` levert (zelfde patroon als
  // TeamIndelingEditor's lastConfirmedRef).
  const lastConfirmedStapOverrideRef = useRef<Record<string, number | null>>(
    Object.fromEntries(initialOefeningen.map((k) => [k.id, k.stap_override])),
  )
  useEffect(() => {
    lastConfirmedStapOverrideRef.current = Object.fromEntries(initialOefeningen.map((k) => [k.id, k.stap_override]))
  }, [initialOefeningen])

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

  // Werkt op blok-index (een blok is óf één losse koppeling, óf een hele
  // parallelle groep — zie `blokken` hierboven). De nieuwe `orderedIds` is de
  // platgeslagen blokkenlijst; `reorderKoppelingen` blijft ongewijzigd
  // aangeroepen, de server is al blok-bewust (normaliseerBlokVolgorde).
  function move(blokIndex: number, dir: -1 | 1) {
    const newIndex = blokIndex + dir
    if (newIndex < 0 || newIndex >= blokken.length) return
    const reordered = [...blokken]
    const [item] = reordered.splice(blokIndex, 1)
    reordered.splice(newIndex, 0, item)
    const orderedIds = reordered.flatMap((b) => b.leden.map((l) => l.id))

    // Optimistisch: ken elk blok dezelfde blok-volgorde toe als de server
    // straks zou berekenen (normaliseerBlokVolgorde: 0..m-1 op volgorde van
    // eerste voorkomen), zodat `blokkenVanKoppelingen` (die op `volgorde`
    // sorteert) de nieuwe volgorde meteen weerspiegelt — zonder te wachten op
    // de server-revalidatie.
    const volgordeByBlokSleutel = new Map<string, number>()
    reordered.forEach((b, i) => {
      const sleutel = b.groepId ?? `k:${b.leden[0].id}`
      volgordeByBlokSleutel.set(sleutel, i)
    })
    setKoppelingen((prev) =>
      prev.map((k) => {
        const sleutel = k.parallel_groep_id ?? `k:${k.id}`
        const volgorde = volgordeByBlokSleutel.get(sleutel)
        return volgorde !== undefined ? { ...k, volgorde } : k
      }),
    )

    startTransition(async () => {
      await reorderKoppelingen(eventId, orderedIds)
    })
  }

  // "Parallel aan"-veld: raw is '' (niet parallel), `groep:<id>` (bij een
  // bestaande groep voegen) of `naast:<koppelingId>` (samen met een andere,
  // nog niet-gegroepeerde koppeling een nieuwe groep vormen). Optimistisch
  // bijgewerkt met rollback naar de vorige waarde bij een serverfout —
  // generieke i18n-melding, nooit de rauwe serverstring.
  function handleParallelChange(koppelingId: string, raw: string) {
    const previous = koppelingen.find((k) => k.id === koppelingId)
    if (!previous) return

    setParallelErrors((prev) => {
      if (!(koppelingId in prev)) return prev
      const rest = { ...prev }
      delete rest[koppelingId]
      return rest
    })

    if (raw === '') {
      if (!previous.parallel_groep_id) return
      setKoppelingen((prev) => prev.map((k) => (k.id === koppelingId ? { ...k, parallel_groep_id: null, parallel_spelers: [] } : k)))
      startTransition(async () => {
        try {
          await haalUitParallelGroep(eventId, koppelingId)
        } catch {
          setKoppelingen((prev) => prev.map((k) => (k.id === koppelingId ? previous : k)))
          setParallelErrors((prev) => ({ ...prev, [koppelingId]: t.trainingPlan.parallelOpslaanMislukt }))
        }
      })
      return
    }

    if (raw.startsWith('groep:')) {
      const groepId = raw.slice('groep:'.length)
      startTransition(async () => {
        try {
          await voegToeAanParallelGroep(eventId, koppelingId, groepId)
          setKoppelingen((prev) => prev.map((k) => (k.id === koppelingId ? { ...k, parallel_groep_id: groepId, parallel_spelers: [] } : k)))
        } catch {
          setParallelErrors((prev) => ({ ...prev, [koppelingId]: t.trainingPlan.parallelOpslaanMislukt }))
        }
      })
      return
    }

    if (raw.startsWith('naast:')) {
      const otherId = raw.slice('naast:'.length)
      startTransition(async () => {
        try {
          const { groepId } = await vormParallelGroep(eventId, [koppelingId, otherId])
          setKoppelingen((prev) =>
            prev.map((k) => (k.id === koppelingId || k.id === otherId ? { ...k, parallel_groep_id: groepId } : k)),
          )
        } catch {
          setParallelErrors((prev) => ({ ...prev, [koppelingId]: t.trainingPlan.parallelOpslaanMislukt }))
        }
      })
    }
  }

  function handleStepOverrideChange(koppelingId: string, raw: string, categorie: string) {
    const value = raw === '' ? null : clampStapOverride(parseInt(raw, 10), categorie)
    setKoppelingen((prev) => prev.map((k) => (k.id === koppelingId ? { ...k, stap_override: value } : k)))
    setStapOverrideErrors((prev) => {
      if (!(koppelingId in prev)) return prev
      const rest = { ...prev }
      delete rest[koppelingId]
      return rest
    })
    startTransition(async () => {
      try {
        await updateKoppeling(koppelingId, eventId, { stap_override: value })
        // Geslaagd: dit is nu de laatst bevestigde stap_override.
        lastConfirmedStapOverrideRef.current[koppelingId] = value
      } catch {
        // Opslaan mislukt (om welke reden dan ook — niet per se omdat de
        // koppeling zelf niet gevonden werd): rollback naar de laatst
        // bevestigde waarde, generieke i18n-foutmelding — nooit de rauwe
        // (server-)fout tonen (zelfde patroon als TeamIndelingEditor's
        // saveError).
        const fallback = lastConfirmedStapOverrideRef.current[koppelingId] ?? null
        setKoppelingen((prev) => prev.map((k) => (k.id === koppelingId ? { ...k, stap_override: fallback } : k)))
        setStapOverrideErrors((prev) => ({ ...prev, [koppelingId]: t.trainingPlan.stapOpslaanMislukt }))
      }
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
      <p className="print:hidden flex items-center gap-1.5 text-xs text-faint -mb-2">
        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {t.trainingPlan.autoSaveHint}
      </p>

      {/* Doelstelling. Op print bewust compact (FOUT4 print-review): de
          scherm-typografie (grote letters, ruime p-5-padding) kostte
          onnodig veel papier. Kopje klein/subtiel, tekst in lijn met de
          rest van de afdruk ([9px], net als de teamindeling-print-tekst in
          TeamIndelingEditor.tsx) — de volledige tekst blijft zichtbaar
          (bestaand AC: niet afgekapt, niet als invoerveld).

          `print:flow-root` (validator-fix, bevestigd gemeten in browser):
          dit blok is een direct kind van `.print-plan-layout`, maar de
          `float: left` van `.print-attendance-col` (globals.css) zit één
          niveau dieper. Alleen boxen die zelf een nieuwe BFC openen wijken
          uit voor een float; een gewoon blok doet dat niet en zijn
          border-box loopt dan achter de namenkolom door. `flow-root`
          opent die BFC zonder verder gedrag te wijzigen. */}
      <div
        data-testid="doelstelling-block"
        className={`bg-surface rounded-2xl border border-[var(--border-soft)] p-5 print:break-inside-avoid print:p-[2mm] print:rounded-md print:flow-root ${doelstelling.trim() === '' ? 'print:hidden' : ''}`}
      >
        <label className="block text-sm font-semibold text-muted mb-2 flex items-center justify-between print:text-[7px] print:mb-[0.5mm] print:uppercase print:tracking-wide print:text-faint">
          {t.trainingPlan.objective}
          {doelstellingSaved && (
            <span className="print:hidden text-xs text-green-600 font-normal">{t.trainingPlan.saved}</span>
          )}
        </label>
        <textarea
          rows={2}
          value={doelstelling}
          onChange={e => handleDoelstellingChange(e.target.value)}
          placeholder={t.trainingPlan.objectivePlaceholder}
          className="print:hidden w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] bg-surface focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 text-ink placeholder:text-faint resize-none text-sm"
        />
        <p data-testid="doelstelling-print" className="hidden print:block whitespace-pre-wrap print:text-[9px] print:leading-snug text-ink">{doelstelling}</p>
      </div>

      {/* Cycle-week suggestion */}
      {suggestion && suggestion.items.length > 0 && (
        <div className="print:hidden bg-surface rounded-r-2xl border border-warning/30 border-l-[3px] border-l-orange-500 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
              {t.periodization.suggestTitle}
            </p>
            <span className="text-xs font-medium text-warning-text bg-orange-50 px-2 py-0.5 rounded-full">
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
                  className="text-xs font-semibold text-warning-text border border-warning/30 hover:border-orange-400 hover:bg-warning/10 rounded-lg px-3 py-1.5 transition-colors active:scale-95 flex-shrink-0"
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
        <div className="print:hidden bg-surface rounded-2xl border border-[var(--border-soft)] p-4">
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
        <div className="print:hidden bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
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
      <div data-testid="exercises-section" className={koppelingen.length === 0 ? 'print:hidden' : ''}>
        <div className="flex items-center justify-between mb-3">
          {/* Op print weggelaten: de genummerde oefeningen kondigen zichzelf al
              aan (badge "1", "2", ...), dus deze sectiekop voegt op papier
              geen informatie toe en kost alleen ruimte (FOUT4, print-review). */}
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wide print:hidden">{t.trainingPlan.exercisesHeading}</h2>
          <button
            type="button"
            onClick={openPicker}
            className="print:hidden text-sm font-semibold text-warning-text hover:text-orange-700 active:scale-95 transition"
          >
            {t.trainingPlan.addExercise}
          </button>
        </div>

        {koppelingen.length === 0 ? (
          <div className="print:hidden rounded-2xl border-2 border-dashed border-[var(--border-soft)] p-8 text-center">
            <svg className="w-9 h-9 mx-auto mb-2 text-faint" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <p className="font-medium text-muted">{t.trainingPlan.noExercises}</p>
            <p className="text-sm text-faint mt-1">{t.trainingPlan.noExercisesHint}</p>
          </div>
        ) : (
          <div className="space-y-2 print:space-y-[3mm]">
            {blokken.map((blok, blokIndex) => {
              // Een blok is een echte parallelle groep zodra het ≥2 leden
              // heeft (blokkenVanKoppelingen degradeert een eenzaam lid al
              // naar groepId: null, dit is een extra defensieve check).
              const isGroup = blok.groepId !== null && blok.leden.length > 1
              return (
                <div key={blok.key} className={isGroup ? 'print:break-inside-avoid' : undefined}>
                  <div
                    className={
                      isGroup
                        ? 'flex flex-col sm:flex-row flex-wrap gap-3 print:flex-row print:gap-[2mm] print:break-inside-avoid'
                        : undefined
                    }
                  >
                    {blok.leden.map((k, ledenIndex) => {
              const o = k.oefeningen
              const catStep = currentSteps[o.categorie]
              const catMeta = ALL_CATS.find(c => c.key === o.categorie)
              const parent = k.genest_in ? koppelingen.find((other) => other.id === k.genest_in) : null
              const isExpanded = expandedId === k.id

              // "Parallel aan"-opties: bij een reeds gegroepeerde koppeling
              // alleen de eigen groep (voor de select-waarde) + de mogelijkheid
              // om te ontgroeperen; anders elke bestaande groep (voegToeAan) en
              // elke ANDERE niet-gegroepeerde koppeling in dit event (vormGroep)
              // — ongeacht positie (V5, de server normaliseert de blok-volgorde).
              const currentGroupId = k.parallel_groep_id ?? null
              const parallelOptions: { value: string; label: string }[] = currentGroupId
                ? (() => {
                    const eigenGroep = parallelGroepNummers.find((pg) => pg.groepId === currentGroupId)
                    return eigenGroep
                      ? [{ value: `groep:${currentGroupId}`, label: t.parallelGroep.groepLabel.replace('{n}', String(eigenGroep.number)) }]
                      : []
                  })()
                : [
                    ...parallelGroepNummers.map((pg) => ({
                      value: `groep:${pg.groepId}`,
                      label: t.parallelGroep.groepLabel.replace('{n}', String(pg.number)),
                    })),
                    ...koppelingen
                      .filter((other) => other.id !== k.id && !other.parallel_groep_id)
                      .map((other) => ({
                        value: `naast:${other.id}`,
                        label: t.trainingPlan.parallelNaastOption.replace('{name}', other.oefeningen.naam),
                      })),
                  ]
              const parallelDisabled = !currentGroupId && parallelOptions.length === 0

              // Stap-inhoud (Arbeid/Herhalingen/Rust HH/Series/Rust series),
              // alleen voor de 5 tabel-categorieën + steigerungs
              // (heeftStapInhoud). `overrideClamped` is meteen de "stille
              // correctie bij laden" van een te hoge bestaande DB-waarde (bv.
              // stap_override: 40 bij een categorie met max 13) — het
              // invoerveld hieronder toont deze geclampte waarde, niet de
              // rauwe DB-waarde. `contentStep` (de geclampte override, anders
              // de gemeten stap) is óók de bron voor het badge/pil-nummer en
              // de print-kopregel hieronder: badge, veld én content tonen
              // voor dezelfde koppeling altijd hetzelfde stapnummer
              // (validator-fix — voorheen las de badge de rauwe, ongeclampte
              // `stap_override`, waardoor een oude DB-waarde boven het
              // categorie-maximum in de badge uit de pas liep met het veld).
              const maxStap = maxStapVoor(o.categorie)
              const overrideClamped = clampStapOverride(k.stap_override, o.categorie)
              const contentStep = overrideClamped ?? catStep ?? null
              const inhoud = stapInhoud(o.categorie, contentStep)
              const steigerungsTekst = o.categorie === 'steigerungs' && contentStep
                ? t.periodization.steigerungsSteps[contentStep - 1] ?? null
                : null
              const showsStepContent = heeftStapInhoud(o.categorie)
              // Print-only kopregel-tekst: nummer staat al in de badge links,
              // hier alleen naam + duur + afmetingen + categorie + stap achter
              // elkaar op één regel — platte tekst i.p.v. pillen (scheelt
              // padding/hoogte, zie het "kladblok"-doelontwerp).
              const stepText = contentStep !== null && contentStep !== undefined
                ? (k.stap_override !== null ? `${t.trainingPlan.stepBadge} ${contentStep}` : (stepForCategory(o.categorie) || `${t.trainingPlan.stepBadge} ${contentStep}`))
                : null
              return (
                // `print:flow-root` (validator-fix, zie de toelichting bij
                // het doelstellingblok hierboven): alleen de eerste kaart
                // overlapt de gefloate namenkolom, maar de klasse staat op
                // alle kaarten — vanaf oefening 2 staan ze toch al onder de
                // kolom, dus `flow-root` daar is een no-op.
                <div
                  key={k.id}
                  className={
                    isGroup
                      ? 'flex-1 min-w-[240px] print:break-inside-avoid bg-surface rounded-xl border border-[var(--border-soft)] p-4 print:p-[2mm] print:flow-root'
                      : 'print:break-inside-avoid bg-surface rounded-xl border border-[var(--border-soft)] p-4 print:p-[2mm] print:flow-root'
                  }
                >
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      {/* Badge: "3" voor een los blok, "3a"/"3b"/... voor de
                          leden van een parallelle groep (blokLabel). Breedte
                          buigt mee voor twee tekens (min-w i.p.v. een vaste w-7). */}
                      <span className="min-w-[1.75rem] h-7 px-1 rounded-lg bg-surface-sunken flex items-center justify-center text-xs font-bold text-muted print:min-w-[4mm] print:h-[4mm] print:px-[0.5mm] print:text-[8px] print-club-bg-primary">
                        {blokLabel(blokIndex, blok.leden.length, ledenIndex)}
                      </span>
                      <div className="print:hidden flex flex-col">
                        <button
                          type="button"
                          onClick={() => move(blokIndex, -1)}
                          disabled={blokIndex === 0}
                          aria-label={t.trainingPlan.moveUp}
                          className="w-6 h-5 flex items-center justify-center text-faint hover:text-muted disabled:opacity-30 disabled:hover:text-faint"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" /></svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => move(blokIndex, 1)}
                          disabled={blokIndex === blokken.length - 1}
                          aria-label={t.trainingPlan.moveDown}
                          className="w-6 h-5 flex items-center justify-center text-faint hover:text-muted disabled:opacity-30 disabled:hover:text-faint"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Scherm: naam op eigen regel, badges als pillen eronder.
                          Print: vervangen door één compacte kopregel hieronder
                          (samen was dit >20mm van de kaarthoogte). */}
                      <div className="font-semibold text-ink print:hidden">{o.naam}</div>

                      {/* Print-only kopregel: naam · duur · afmetingen · stap,
                          achter elkaar op één regel. Staat bewust in de DOM
                          VÓÓR de beschrijving hieronder — anders leest de
                          afdruk eerst de kleine grijze beschrijving en pas
                          daarna de vetgedrukte kopregel (omgekeerde
                          leesvolgorde, FOUT1 print-review). Categorie is hier
                          bewust weggelaten: die herhaalt alleen de
                          oefeningnaam en kost breedte zonder extra informatie
                          (FOUT2 print-review) — de categorie-badge blijft wel
                          gewoon op het scherm staan (zie hieronder). De
                          stap-aanduiding blijft wél staan: die is niet uit de
                          naam af te leiden. */}
                      <p className="hidden print:block print:text-[10px] print:font-semibold print:leading-snug">
                        {o.naam}
                        {o.duur_min != null && <> · {o.duur_min} min</>}
                        {o.breedte_m && o.lengte_m && <> · {o.breedte_m}×{o.lengte_m}m</>}
                        {stepText && <> · {stepText}</>}
                      </p>

                      {o.beschrijving && (
                        <p className="text-sm text-muted mt-0.5 line-clamp-2 print:text-[8px] print:leading-tight print:mt-[0.5mm]">{o.beschrijving}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2 print:hidden">
                        {catMeta && (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${catMeta.color}`}>
                            {catLabel(o.categorie)}
                          </span>
                        )}
                        {contentStep !== null && contentStep !== undefined && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-muted">
                            {k.stap_override !== null ? `${t.trainingPlan.stepBadge} ${contentStep}` : (stepForCategory(o.categorie) || `${t.trainingPlan.stepBadge} ${contentStep}`)}
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
                        {isGroup && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-muted">
                            {t.trainingPlan.parallelBadge}
                          </span>
                        )}
                      </div>

                      {/* Stapveld + trainingsparameters direct op de kaart
                          voor de 5 tabel-categorieën + steigerungs
                          (heeftStapInhoud) — niet meer verstopt achter
                          "Bewerken" (zie ook het "Bewerken"-paneel verderop,
                          waar dit veld voor déze categorieën is verwijderd).
                          `print:hidden`: de afdruk krijgt hieronder, ná de
                          gefloate diagram-wrapper, een eigen compacte
                          print-only regel. */}
                      {showsStepContent && (
                        <div
                          data-testid={`stap-inhoud-${k.id}`}
                          className="print:hidden mt-2 p-2.5 rounded-lg bg-surface-sunken border border-[var(--border-soft)] space-y-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <label htmlFor={`stap-override-${k.id}`} className="text-xs font-semibold text-muted">
                              {t.trainingPlan.stepBadge} ({t.trainingPlan.stepAuto})
                            </label>
                            <input
                              id={`stap-override-${k.id}`}
                              type="number"
                              min={1}
                              max={maxStap}
                              value={overrideClamped ?? ''}
                              placeholder={t.trainingPlan.stepAuto}
                              onChange={(e) => handleStepOverrideChange(k.id, e.target.value, o.categorie)}
                              className="w-20 px-2 py-1 rounded-lg border border-[var(--border-soft)] bg-surface focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 text-sm text-ink"
                            />
                          </div>
                          {stapOverrideErrors[k.id] && (
                            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                              {stapOverrideErrors[k.id]}
                            </p>
                          )}
                          {o.categorie === 'steigerungs' ? (
                            steigerungsTekst && <p className="text-xs text-ink">{steigerungsTekst}</p>
                          ) : (
                            inhoud && (
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                                <span><span className="text-faint">{t.periodization.stepWork}:</span> <span className="text-ink font-medium">{inhoud.arbeid}</span></span>
                                <span><span className="text-faint">{t.periodization.stepReps}:</span> <span className="text-ink font-medium">{inhoud.herhalingen}</span></span>
                                <span><span className="text-faint">{t.periodization.stepRestReps}:</span> <span className="text-ink font-medium">{inhoud.rustHH}</span></span>
                                {inhoud.series !== undefined && (
                                  <span><span className="text-faint">{t.periodization.stepSeries}:</span> <span className="text-ink font-medium">{inhoud.series}</span></span>
                                )}
                                {inhoud.rustSeries !== undefined && (
                                  <span><span className="text-faint">{t.periodization.stepRestSeries}:</span> <span className="text-ink font-medium">{inhoud.rustSeries}</span></span>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      )}

                      {/* Diagram/formatieveld naast de teamindeling i.p.v.
                          erboven (was de belangrijkste hoogtebesparing): het
                          diagram/formatieveld floatet op print naar links
                          (42mm breed = 59mm hoog bij de 100/140 veld-aspect-
                          ratio; FormationField-fallback iets kleiner op 30mm,
                          FOUT3 print-review — ruim binnen budget bij 1,74 van
                          de 2 A4), de teamindeling (TeamIndelingEditor's
                          print-only blok, direct hierna in de DOM) vloeit in
                          de resterende breedte ernaast. De kaarthoogte wordt
                          zo max(diagram, teamindeling) i.p.v. de som. */}
                      {(o.diagram || o.teams.length > 0) && (
                        // Binnen een parallelle groep (isGroup) is de kolom te
                        // smal voor de gefloate volle-breedte-stijl: geen float,
                        // smaller diagram/formatievelden.
                        <div className={isGroup ? 'mt-2 print:mt-[1mm] print:float-none print:w-[32mm] print:mr-[3mm]' : 'mt-2 print:mt-[1mm] print:float-left print:w-[42mm] print:mr-[3mm]'}>
                          {o.diagram ? (
                            <DiagramView diagram={o.diagram} sizePx={110} className={isGroup ? 'print:w-[32mm]!' : 'print:w-[42mm]!'} />
                          ) : (
                            <div className="flex flex-wrap gap-2 print:flex-col print:gap-[1mm]">
                              {o.teams.map((tm, i) => {
                                const basis = basisFormatieDef(tm)
                                return (
                                  <FormationField
                                    key={i}
                                    positions={basis?.positions ?? []}
                                    label={`${tm.grootte}${basis ? ` · ${basis.label}` : ''}`}
                                    sizePx={56}
                                    className={isGroup ? 'print:w-[22mm]!' : 'print:w-[30mm]!'}
                                  />
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Print-only stap-inhoud: dezelfde content als het
                          scherm-blok hierboven, maar in het `·`-gescheiden
                          platte-tekst-patroon van de print-kopregel
                          (TrainingPlanEditor.tsx:379-384 hierboven). Staat
                          bewust NA de gefloate diagram-wrapper zodat hij op
                          papier meestal in de witruimte naast het diagram
                          valt i.p.v. de kaart te verlengen. Eigen
                          data-testid omdat dezelfde tekst ook (verborgen)
                          in het scherm-blok staat — jsdom past @media print
                          niet toe, dus tests moeten het print-element apart
                          kunnen vinden. */}
                      {showsStepContent && (inhoud || steigerungsTekst) && (
                        <p
                          data-testid={`stap-inhoud-print-${k.id}`}
                          className="hidden print:block print:text-[8px] print:leading-tight print:text-ink"
                        >
                          {o.categorie === 'steigerungs'
                            ? steigerungsTekst
                            : inhoud && [
                                `${t.periodization.stepWork}: ${inhoud.arbeid}`,
                                `${t.periodization.stepReps}: ${inhoud.herhalingen}`,
                                `${t.periodization.stepRestReps}: ${inhoud.rustHH}`,
                                inhoud.series !== undefined ? `${t.periodization.stepSeries}: ${inhoud.series}` : null,
                                inhoud.rustSeries !== undefined ? `${t.periodization.stepRestSeries}: ${inhoud.rustSeries}` : null,
                              ].filter(Boolean).join(' · ')}
                        </p>
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
                    <div className="print:hidden flex items-center gap-2 flex-shrink-0">
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
                    <div className="print:hidden mt-3 pt-3 border-t border-[var(--border-soft)] grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Voor categorieën met stap-inhoud (heeftStapInhoud)
                          staat dit veld nu direct op de kaart hierboven —
                          niet meer hier, om nooit twee inputs voor hetzelfde
                          veld tegelijk te tonen. */}
                      {!showsStepContent && (
                        <div>
                          <label className="block text-xs font-semibold text-muted mb-1">{t.trainingPlan.stepBadge} ({t.trainingPlan.stepAuto})</label>
                          <input
                            type="number" min={1} max={99}
                            value={k.stap_override ?? ''}
                            placeholder={t.trainingPlan.stepAuto}
                            onChange={(e) => handleStepOverrideChange(k.id, e.target.value, o.categorie)}
                            className="w-full px-3 py-2 rounded-lg border border-[var(--border-soft)] bg-surface focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 text-sm text-ink"
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1">{t.trainingPlan.nestedLabel}</label>
                        <select
                          value={k.genest_in ?? ''}
                          onChange={(e) => handleGenestInChange(k.id, e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 text-sm text-ink bg-surface"
                        >
                          <option value="">{t.trainingPlan.nestedNoneOption}</option>
                          {koppelingen.filter((other) => other.id !== k.id).map((other) => (
                            <option key={other.id} value={other.id}>{other.oefeningen.naam}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1">{t.trainingPlan.parallelLabel}</label>
                        <select
                          value={currentGroupId ? `groep:${currentGroupId}` : ''}
                          disabled={parallelDisabled}
                          onChange={(e) => handleParallelChange(k.id, e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border-soft)] focus:outline-none focus:border-warning focus:ring-2 focus:ring-warning/30 text-sm text-ink bg-surface disabled:opacity-50"
                        >
                          <option value="">{t.trainingPlan.parallelNoneOption}</option>
                          {parallelOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        {parallelErrors[k.id] && (
                          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1 mt-1">
                            {parallelErrors[k.id]}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
                    })}
                  </div>
                  {isGroup && (
                    <ParallelGroepEditor
                      eventId={eventId}
                      groepId={blok.groepId as string}
                      leden={blok.leden}
                      players={players}
                      presentPlayerIds={presentPlayerIds}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        <button
          type="button"
          onClick={openPicker}
          className="print:hidden mt-3 w-full py-3 rounded-xl border-2 border-dashed border-warning/30 text-warning-text hover:border-warning/50 hover:bg-warning/10 font-semibold text-sm transition active:scale-[0.98]"
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
