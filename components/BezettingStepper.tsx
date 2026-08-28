'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { AantallenOverride } from '@/lib/types'
import {
  bereikLabelVoor,
  bereikVoorNeutralen,
  bereikVoorTeam,
  concretiseerBezetting,
  isFlexibel,
  isFlexibelTeam,
  suggestBezetting,
  teamBereikLabel,
  valideerAantallenOverride,
  type BezettingBasis,
} from '@/lib/oefening-bezetting'
import { saveAantallenOverride } from '@/app/actions/training-plan'
import { useDict } from '@/lib/i18n-context'

interface Aantallen {
  teams: number[]
  neutralen: number
}

interface Props {
  koppelingId: string
  eventId: string
  /** Basisvorm + grenzen (= k.oefeningen). Nooit de effectieve bezetting. */
  basis: BezettingBasis
  /** Opgeslagen override (= k.aantallen_override ?? null). */
  initialAantallen: AantallenOverride | null
  /** = presentPlayerIds.length; voedt alleen de stepper-SUGGESTIE en de totaalregel. */
  aanwezigAantal: number
}

function clamp(waarde: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, waarde))
}

// Concrete (niet-delta) startwaarden: een opgeslagen override, geconcretiseerd
// tegen het actuele bereik (clamp-on-read); zonder override de suggestie op
// basis van de opkomst. Beide gaan door concretiseerBezetting, zodat clamp en
// resultaat exact hetzelfde pad volgen als elke andere consument.
function concreteVan(basis: BezettingBasis, initialAantallen: AantallenOverride | null, aanwezigAantal: number): Aantallen {
  const override = initialAantallen ?? suggestBezetting(basis, aanwezigAantal)
  const bezetting = concretiseerBezetting(basis, override)
  return { teams: bezetting.teams.map((tm) => tm.grootte), neutralen: bezetting.aantal_neutralen }
}

export default function BezettingStepper({ koppelingId, eventId, basis, initialAantallen, aanwezigAantal }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [aantallen, setAantallen] = useState<Aantallen>(() => concreteVan(basis, initialAantallen, aanwezigAantal))
  const [error, setError] = useState<string | null>(null)

  // Laatst bevestigde (opgeslagen, of van de server ontvangen) concrete
  // bezetting — bron voor de rollback bij een mislukte save (patroon
  // TeamIndelingEditor.tsx: lastConfirmedRef).
  const lastConfirmedRef = useRef<Aantallen>(concreteVan(basis, initialAantallen, aanwezigAantal))

  // Resync op verse serverdata via een WAARDE-signatuur, niet via referentie:
  // `initialAantallen` is elke render een nieuw object (komt uit een `.map`
  // op de leesgrens), dus een reference-check zou eeuwig resyncen — zelfde
  // valkuil als de EMPTY_INDELING-module-constante (TrainingPlanEditor.tsx)
  // en hetzelfde patroon als ParallelGroepEditor's ledenSignature.
  // `aanwezigAantal` zit BEWUST niet in de signature: een latere wijziging in
  // de opkomst mag de al bepaalde suggestie/override niet stilzwijgend
  // herberekenen (geen automatische herberekening, brief §2.C).
  const signature = useMemo(() => JSON.stringify(initialAantallen ?? null), [initialAantallen])
  const [prevSignature, setPrevSignature] = useState(signature)
  if (prevSignature !== signature) {
    setPrevSignature(signature)
    setAantallen(concreteVan(basis, initialAantallen, aanwezigAantal))
    setError(null)
  }

  // Refs mogen niet tijdens render gemuteerd worden — bijwerken gebeurt hier
  // ná render, zodra de server een verse `initialAantallen` levert.
  useEffect(() => {
    lastConfirmedRef.current = concreteVan(basis, initialAantallen, aanwezigAantal)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // Exacte oefening: geen bereik, dus geen enkel nieuw DOM-element. Hooks
  // staan hierboven, vóór deze conditionele return (rules-of-hooks) — zelfde
  // volgorde als TeamIndelingEditor.tsx.
  if (!isFlexibel(basis)) return null

  function persist(next: Aantallen, delta: AantallenOverride | null) {
    setAantallen(next)
    setError(null)
    startTransition(async () => {
      try {
        await saveAantallenOverride(koppelingId, eventId, delta)
        lastConfirmedRef.current = next
      } catch {
        // Nooit de rauwe (server-)fout tonen — generieke i18n-melding, en
        // rollback naar de laatst bevestigde bezetting.
        setAantallen(lastConfirmedRef.current)
        setError(t.bezetting.saveError)
      }
    })
  }

  function adjustTeam(i: number, stap: number) {
    const bereik = bereikVoorTeam(basis.teams[i])
    setAantallen((prev) => {
      const teams = [...prev.teams]
      teams[i] = clamp(teams[i] + stap, bereik.min, bereik.max)
      return { ...prev, teams }
    })
  }

  function adjustNeutralen(stap: number) {
    const bereik = bereikVoorNeutralen(basis)
    setAantallen((prev) => ({ ...prev, neutralen: clamp(prev.neutralen + stap, bereik.min, bereik.max) }))
  }

  function handleConfirm() {
    const delta = valideerAantallenOverride(aantallen, basis)
    persist(aantallen, delta)
  }

  function handleReset() {
    const basisBezetting = concretiseerBezetting(basis, null)
    persist(
      { teams: basisBezetting.teams.map((tm) => tm.grootte), neutralen: basisBezetting.aantal_neutralen },
      null,
    )
  }

  const heeftOpgeslagenOverride = initialAantallen !== null
  // Alleen eindige waarden meetellen (zelfde defensieve stijl als
  // totaalBereik in lib/oefening-bezetting.ts) — een corrupt team-element
  // mag de totaalregel niet naar "Totaal NaN" laten omslaan.
  const totaal =
    aantallen.teams.reduce((som, n) => som + (Number.isFinite(n) ? n : 0), 0) +
    (Number.isFinite(aantallen.neutralen) ? aantallen.neutralen : 0)
  const neutraalBereik = bereikVoorNeutralen(basis)

  return (
    <div className="print:hidden mt-3 pt-3 border-t border-[var(--border-soft)] space-y-2">
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">{t.bezetting.heading}</h3>
      <p className="text-[11px] text-faint">{t.bezetting.hint}</p>

      <div className="space-y-1.5">
        {basis.teams.map((team, i) => {
          if (!isFlexibelTeam(team)) return null
          const bereik = bereikVoorTeam(team)
          const waarde = aantallen.teams[i]
          const label = t.teamIndeling.teamLabel.replace('{n}', String(i + 1))
          return (
            <div key={i} className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink">{label}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => adjustTeam(i, -1)}
                  disabled={waarde <= bereik.min}
                  aria-label={t.bezetting.decreaseAria.replace('{label}', label)}
                  className="w-9 h-9 rounded-lg border border-[var(--border-soft)] bg-surface-sunken text-ink font-bold text-lg flex items-center justify-center hover:border-warning/50 active:scale-95 transition-transform duration-150 ease-out disabled:opacity-50 disabled:active:scale-100 disabled:hover:border-[var(--border-soft)]"
                >
                  −
                </button>
                <span aria-live="polite" className="w-6 text-center tabular-nums font-semibold text-ink">
                  {waarde}
                </span>
                <button
                  type="button"
                  onClick={() => adjustTeam(i, 1)}
                  disabled={waarde >= bereik.max}
                  aria-label={t.bezetting.increaseAria.replace('{label}', label)}
                  className="w-9 h-9 rounded-lg border border-[var(--border-soft)] bg-surface-sunken text-ink font-bold text-lg flex items-center justify-center hover:border-warning/50 active:scale-95 transition-transform duration-150 ease-out disabled:opacity-50 disabled:active:scale-100 disabled:hover:border-[var(--border-soft)]"
                >
                  +
                </button>
                <span className="text-xs text-faint tabular-nums w-10 flex-shrink-0">{teamBereikLabel(team)}</span>
              </div>
            </div>
          )
        })}

        {neutraalBereik.max > neutraalBereik.min && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink">{t.oefeningen.neutralsLabel}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => adjustNeutralen(-1)}
                disabled={aantallen.neutralen <= neutraalBereik.min}
                aria-label={t.bezetting.decreaseAria.replace('{label}', t.oefeningen.neutralsLabel)}
                className="w-9 h-9 rounded-lg border border-[var(--border-soft)] bg-surface-sunken text-ink font-bold text-lg flex items-center justify-center hover:border-warning/50 active:scale-95 transition-transform duration-150 ease-out disabled:opacity-50 disabled:active:scale-100 disabled:hover:border-[var(--border-soft)]"
              >
                −
              </button>
              <span aria-live="polite" className="w-6 text-center tabular-nums font-semibold text-ink">
                {aantallen.neutralen}
              </span>
              <button
                type="button"
                onClick={() => adjustNeutralen(1)}
                disabled={aantallen.neutralen >= neutraalBereik.max}
                aria-label={t.bezetting.increaseAria.replace('{label}', t.oefeningen.neutralsLabel)}
                className="w-9 h-9 rounded-lg border border-[var(--border-soft)] bg-surface-sunken text-ink font-bold text-lg flex items-center justify-center hover:border-warning/50 active:scale-95 transition-transform duration-150 ease-out disabled:opacity-50 disabled:active:scale-100 disabled:hover:border-[var(--border-soft)]"
              >
                +
              </button>
              <span className="text-xs text-faint tabular-nums w-10 flex-shrink-0">{bereikLabelVoor(neutraalBereik)}</span>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted tabular-nums">
        {t.bezetting.totaal.replace('{n}', String(totaal)).replace('{m}', String(aanwezigAantal))}
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending}
          className="px-3 py-1.5 rounded-lg text-xs font-bold text-white active:scale-95 transition-transform duration-150 ease-out disabled:opacity-50 disabled:active:scale-100"
          style={{ background: 'var(--color-accent-strong)' }}
        >
          {t.bezetting.confirm}
        </button>
        {heeftOpgeslagenOverride && (
          <button
            type="button"
            onClick={handleReset}
            disabled={isPending}
            className="text-xs font-semibold text-muted hover:text-ink transition-colors"
          >
            {t.bezetting.reset}
          </button>
        )}
        <span className="text-xs text-faint">
          {heeftOpgeslagenOverride ? t.bezetting.savedHint : t.bezetting.notSavedHint}
        </span>
      </div>

      {error && (
        <p className="text-xs text-panel-red-ink bg-panel-red border border-panel-red-edge rounded-lg px-2 py-1">
          {error}
        </p>
      )}
    </div>
  )
}
