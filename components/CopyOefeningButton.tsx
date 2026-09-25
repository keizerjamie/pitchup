'use client'

// "Kopiëren naar mijn bibliotheek" (brief §4.6/§2.7, AC 20, BR 56) — staat op
// het trainingsplan naast elke koppeling waarvan de gejoinde oefening NIET
// van de ingelogde gebruiker is (TrainingPlanEditor.tsx bepaalt dat via
// `isEigen`, naast de badge "Van een teamgenoot").
//
// GEEN eigen rechtencheck: `kopieerOefeningNaarBibliotheek` staat zelf ook
// zonder assertCanEdit — elk teamlid dat het trainingsplan kan lezen mag
// kopiëren, ook zonder Training-bewerkrecht (AC 20). De server beslist via
// RLS of de bron-oefening zichtbaar is; onzichtbaar of onbekend geeft
// dezelfde 'Oefening niet gevonden' als een niet-bestaand id.
import { useState, useTransition } from 'react'
import { kopieerOefeningNaarBibliotheek } from '@/app/actions/oefening-library'
import { useDict } from '@/lib/i18n-context'
import { useReducedMotion } from '@/lib/use-reduced-motion'
import Spinner from '@/components/icons/Spinner'
import { COPY_LABEL_CROSSFADE_MS, COPY_SUCCESS_HOLD_MS } from '@/components/copy-feedback'

interface Props {
  oefeningId: string
}

export default function CopyOefeningButton({ oefeningId }: Props) {
  const t = useDict()
  const reduceMotion = useReducedMotion()
  const [isPending, startTransition] = useTransition()
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [labelKey, setLabelKey] = useState(0)

  function handleCopy() {
    setState('idle')
    startTransition(async () => {
      try {
        await kopieerOefeningNaarBibliotheek(oefeningId)
        setLabelKey((k) => k + 1)
        setState('copied')
        setTimeout(() => setState('idle'), COPY_SUCCESS_HOLD_MS)
      } catch {
        // Nooit err.message: patroon RechtenToggles/InviteLinkCard — een
        // servergesaneerde fout is sowieso onbetrouwbaar in productie.
        setLabelKey((k) => k + 1)
        setState('error')
      }
    })
  }

  const label = isPending
    ? t.oefeningen.copying
    : state === 'copied'
      ? t.oefeningen.copied
      : state === 'error'
        ? t.oefeningen.copyFailed
        : t.oefeningen.copyToLibrary

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full text-warning-text hover:bg-warning/10 active:scale-[0.97] transition-transform disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {isPending && <Spinner size={12} />}
      <span
        key={labelKey}
        style={
          reduceMotion
            ? undefined
            : { display: 'inline-block', animation: `invite-copy-label-in ${COPY_LABEL_CROSSFADE_MS}ms ease-out` }
        }
      >
        {label}
      </span>
    </button>
  )
}
