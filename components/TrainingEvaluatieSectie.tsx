'use client'

import { useEffect, useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { TrainingEvaluatie, TrainingOordeel } from '@/lib/types'
import type { HerstelTrainingOordeel, HerstelTrainingRpe } from '@/lib/herstel'
import { RPE_ANKERS, RPE_MAX, RPE_MIN, TRAINING_OORDELEN, heeftDoelstelling } from '@/lib/training-evaluatie'
import {
  saveTrainingRpe, wisTrainingRpe, herstelTrainingRpe,
  saveTrainingOordeel, wisTrainingOordeel, herstelTrainingOordeel,
} from '@/app/actions/training-evaluatie'
import { useDict } from '@/lib/i18n-context'
import { useToast } from '@/components/ui/Toast'

// RPE en doelstelling-oordeel van een gehouden training (fase 3b). Twee
// blokken met elk een eigen useTransition: pending bij het ene blokkeert het
// andere niet. Optimistisch selecteren; een falende opslag zet de oude waarde
// terug (R.4). Wissen met undo-toast, zoals bij de speelminuten.

const MELDING_KLASSE = 'bg-panel-red border border-panel-red-edge text-panel-red-ink text-xs px-4 py-2.5 rounded-xl'

type Optie<V> = { waarde: V; label: string; ariaLabel: string; anker?: string }

// Eén wisknop voor beide blokken: de hit-slop-regel in
// ux-details.acceptance.test.tsx kijkt naar deze className-regel.
function WisKnop({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="relative hit-slop w-8 h-8 rounded-lg flex items-center justify-center text-faint hover:text-ink transition-colors active:scale-95 disabled:opacity-40"
    >
      <span className="ms text-[20px]" aria-hidden="true">close</span>
    </button>
  )
}

function KeuzeBlok<V extends number | TrainingOordeel, H>({
  label, context, uitleg, opties, kolommen, opgeslagen, magKiezen, canEdit, leesTekst, nietIngevuld, wisLabel,
  opslaan, wis, herstel, herstelWaarde,
}: {
  label: string
  // Doelstellingstekst (alleen-lezen context onder het label).
  context?: string
  // Korte uitleg onder het label.
  uitleg?: string
  opties: Optie<V>[]
  kolommen: string
  opgeslagen: V | null
  // false: er mag geen nieuwe waarde gekozen worden (geen doelstelling).
  magKiezen: boolean
  canEdit: boolean
  leesTekst: (w: V) => string
  nietIngevuld: string | null
  wisLabel: string
  opslaan: (w: V) => Promise<void>
  wis: () => Promise<H>
  herstel: (h: H) => Promise<void>
  herstelWaarde: (h: H) => V
}) {
  const t = useDict()
  const router = useRouter()
  const toast = useToast()
  const labelId = useId()
  const [isPending, startTransition] = useTransition()
  const [waarde, setWaarde] = useState<V | null>(opgeslagen)
  const [prevOpgeslagen, setPrevOpgeslagen] = useState<V | null>(opgeslagen)
  const [fout, setFout] = useState<string | null>(null)
  const [klaar, setKlaar] = useState(false)

  // Prop→state-sync na router.refresh() (zelfde patroon als de speelminuten-invoer).
  if (prevOpgeslagen !== opgeslagen) {
    setPrevOpgeslagen(opgeslagen)
    setWaarde(opgeslagen)
  }

  useEffect(() => {
    if (!klaar) return
    const id = setTimeout(() => setKlaar(false), 2000)
    return () => clearTimeout(id)
  }, [klaar])

  function kies(nieuw: V) {
    if (isPending || nieuw === waarde) return
    const vorige = waarde
    setWaarde(nieuw)
    setFout(null)
    setKlaar(false)
    startTransition(async () => {
      try {
        await opslaan(nieuw)
        setKlaar(true)
        router.refresh()
      } catch {
        setWaarde(vorige)
        setFout(t.event.evaluatieOpslaanFout)
      }
    })
  }

  function wisWaarde() {
    if (isPending || waarde === null) return
    const vorige = waarde
    setWaarde(null)
    setFout(null)
    setKlaar(false)
    startTransition(async () => {
      try {
        const snapshot = await wis()
        router.refresh()
        toast.toon({
          bericht: t.undo.deleted,
          actie: {
            label: t.undo.action,
            foutBericht: t.undo.restoreError,
            onActie: async () => {
              await herstel(snapshot)
              setWaarde(herstelWaarde(snapshot))
              router.refresh()
            },
          },
        })
      } catch {
        setWaarde(vorige)
        setFout(t.undo.deleteError)
      }
    })
  }

  const kop = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex flex-col gap-0.5">
        <span id={labelId} className="text-[13.5px] font-bold text-ink">{label}</span>
        {uitleg && <span className="text-[12.5px] text-faint">{uitleg}</span>}
        {context && <span className="text-[13px] text-muted line-clamp-2">{context}</span>}
      </div>
      {canEdit && waarde !== null && (
        <WisKnop onClick={wisWaarde} disabled={isPending} label={wisLabel} />
      )}
    </div>
  )

  const meldingen = (
    <>
      <div role="status" className="min-h-[18px] text-[12.5px] font-bold text-brand-accent">
        {klaar ? t.analysis.saved : null}
      </div>
      {fout && <div role="alert" className={MELDING_KLASSE}>{fout}</div>}
    </>
  )

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-2">
        {kop}
        <span className="text-[13.5px] font-bold text-faint tabular-nums">
          {waarde !== null ? leesTekst(waarde) : nietIngevuld}
        </span>
      </div>
    )
  }

  if (!magKiezen) {
    // Geen doelstelling: nooit nieuwe keuzes; een bestaande waarde blijft
    // zichtbaar en wisbaar (R5.1).
    return (
      <div className="flex flex-col gap-2">
        {kop}
        {waarde !== null && (
          <span className="text-[13.5px] font-bold text-faint tabular-nums">{leesTekst(waarde)}</span>
        )}
        {meldingen}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {kop}
      <div role="group" aria-labelledby={labelId} className={`grid ${kolommen} gap-1.5`}>
        {opties.map((o) => {
          const geselecteerd = waarde === o.waarde
          return (
            <div key={String(o.waarde)} className="flex flex-col items-center gap-1">
              <button
                type="button"
                aria-pressed={geselecteerd}
                aria-label={o.ariaLabel}
                disabled={isPending}
                onClick={() => kies(o.waarde)}
                className={`h-11 w-full rounded-lg font-display text-[16px] font-bold tabular-nums transition-colors active:scale-95 disabled:opacity-50 ${geselecteerd ? 'text-white' : 'bg-surface-sunken text-ink'}`}
                style={geselecteerd
                  ? { background: 'var(--primary)', border: '1px solid var(--primary)' }
                  : { border: '1px solid var(--border-soft)' }}
              >
                {o.label}
              </button>
              {o.anker && (
                <span aria-hidden="true" className="text-[10.5px] leading-tight text-faint text-center">{o.anker}</span>
              )}
            </div>
          )
        })}
      </div>
      {meldingen}
    </div>
  )
}

export default function TrainingEvaluatieSectie({
  eventId, initial, doelstelling, canEdit, trainingGehouden, bronFout,
}: {
  eventId: string
  initial: TrainingEvaluatie
  doelstelling: string | null
  canEdit: boolean
  trainingGehouden: boolean
  bronFout: boolean
}) {
  const t = useDict()
  const e = t.event
  const ankers = e.rpeAnkers as Record<string, string>

  const rpeOpties = Array.from({ length: RPE_MAX - RPE_MIN + 1 }, (_, i) => RPE_MIN + i).map((n) => {
    const anker = (RPE_ANKERS as readonly number[]).includes(n) ? ankers[String(n)] : undefined
    const basis = e.rpeWaarde.replace('{n}', String(n))
    return { waarde: n, label: String(n), ariaLabel: anker ? `${basis} – ${anker}` : basis, anker }
  })
  const oordeelTekst: Record<TrainingOordeel, string> = { ja: e.oordeelJa, deels: e.oordeelDeels, nee: e.oordeelNee }
  const oordeelOpties = TRAINING_OORDELEN.map((o) => ({ waarde: o, label: oordeelTekst[o], ariaLabel: oordeelTekst[o] }))

  const heeftDoel = heeftDoelstelling(doelstelling)

  let inhoud: React.ReactNode
  if (bronFout) {
    inhoud = (
      <div className="surface-card p-5 text-center">
        <p className="text-faint text-[13px] font-medium">{e.evaluatieNietBeschikbaar}</p>
      </div>
    )
  } else if (!trainingGehouden) {
    inhoud = (
      <div className="surface-card p-5 text-center">
        <p className="text-faint text-[13px] font-medium">{e.evaluatieToekomst}</p>
      </div>
    )
  } else {
    inhoud = (
      <div className="surface-card p-4 flex flex-col gap-4">
        <KeuzeBlok<number, HerstelTrainingRpe>
          label={e.rpeLabel}
          uitleg={e.rpeUitleg}
          opties={rpeOpties}
          kolommen="grid-cols-5 sm:grid-cols-10"
          opgeslagen={initial.rpe}
          magKiezen
          canEdit={canEdit}
          leesTekst={(n) => {
            const anker = ankers[String(n)]
            const basis = e.rpeWaarde.replace('{n}', String(n))
            return anker && (RPE_ANKERS as readonly number[]).includes(n) ? `${basis} · ${anker}` : basis
          }}
          nietIngevuld={e.rpeNietIngevuld}
          wisLabel={e.rpeWissen}
          opslaan={(n) => saveTrainingRpe(eventId, n)}
          wis={() => wisTrainingRpe(eventId)}
          herstel={herstelTrainingRpe}
          herstelWaarde={(h) => h.rpe}
        />
        <div style={{ borderTop: '1px solid var(--border-soft)' }} />
        <KeuzeBlok<TrainingOordeel, HerstelTrainingOordeel>
          label={e.oordeelLabel}
          context={heeftDoel ? (doelstelling ?? undefined) : undefined}
          uitleg={!heeftDoel && initial.oordeel !== null ? e.oordeelZonderDoelstelling : undefined}
          opties={oordeelOpties}
          kolommen="grid-cols-3"
          opgeslagen={initial.oordeel}
          magKiezen={heeftDoel}
          canEdit={canEdit}
          leesTekst={(o) => oordeelTekst[o]}
          nietIngevuld={heeftDoel ? e.oordeelNietIngevuld : null}
          wisLabel={e.oordeelWissen}
          opslaan={(o) => saveTrainingOordeel(eventId, o)}
          wis={() => wisTrainingOordeel(eventId)}
          herstel={herstelTrainingOordeel}
          herstelWaarde={(h) => h.oordeel}
        />
        {!heeftDoel && initial.oordeel === null && (
          <p className="text-[12.5px] text-faint -mt-2">{e.oordeelGeenDoelstelling}</p>
        )}
      </div>
    )
  }

  return (
    <section aria-label={e.evaluatieTitel} className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-[17px] font-bold text-ink">{e.evaluatieTitel}</h2>
        <p className="text-[12.5px] text-faint">{e.evaluatieUitleg}</p>
      </div>
      {inhoud}
    </section>
  )
}
