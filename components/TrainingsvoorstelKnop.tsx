'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { stelTrainingVoor } from '@/app/actions/training-plan'
import type { TrainingsvoorstelFoutcode } from '@/lib/trainingsvoorstel'
import { useDict } from '@/lib/i18n-context'
import Button from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'

// "Maak trainingsvoorstel" in de lege staat van de planner (alleen VCT, alleen
// bij een leeg plan — de aanroeper regelt dat). Eén tik vult het plan met de
// blokken van deze cyclusweek; de server kiest en valideert alles zelf, deze
// component stuurt alleen het eventId mee.
//
// Na succes herlaadt de pagina via revalidatePath in de action: de lijst vult
// zich en deze lege staat verdwijnt. Daarom is er geen eigen succes-state.
export default function TrainingsvoorstelKnop({
  eventId,
  heeftCyclusweek,
  bibliotheekLeeg,
}: {
  eventId: string
  heeftCyclusweek: boolean
  bibliotheekLeeg: boolean
}) {
  const t = useDict()
  const toast = useToast()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!heeftCyclusweek) {
    return <p className="text-xs text-faint">{t.trainingPlan.voorstelGeenCyclusweek}</p>
  }

  if (bibliotheekLeeg) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-xs text-faint">{t.trainingPlan.voorstelLegeBibliotheek}</p>
        <Link href="/oefeningen" className="text-sm font-semibold text-warning-text hover:underline">
          {t.trainingPlan.voorstelNaarBibliotheek}
        </Link>
      </div>
    )
  }

  function maakVoorstel() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await stelTrainingVoor(eventId)
        if (!res.ok) {
          const code: TrainingsvoorstelFoutcode = res.error
          setError(t.trainingPlan.voorstelFout[code] ?? t.trainingPlan.voorstelFout.algemeen)
          // Het plan is intussen elders gevuld: haal de actuele stand op.
          if (code === 'plan_niet_leeg') router.refresh()
          return
        }
        const n = String(res.aantal)
        if (res.overgeslagen.length > 0) {
          const categorieen = res.overgeslagen
            .map((c) => t.periodization.categories[c] ?? c)
            .join(', ')
          toast.toon({
            bericht: t.trainingPlan.voorstelOvergeslagen.replace('{n}', n).replace('{categorieen}', categorieen),
          })
        } else {
          toast.toon({ bericht: t.trainingPlan.voorstelGelukt.replace('{n}', n) })
        }
      } catch {
        // Nooit de rauwe serverfout tonen.
        setError(t.trainingPlan.voorstelFout.algemeen)
      }
    })
  }

  return (
    <div className="flex flex-col gap-2 print:hidden">
      <Button variant="primary" fullWidth loading={isPending} onClick={maakVoorstel}>
        {isPending ? t.trainingPlan.voorstelBezig : t.trainingPlan.voorstelKnop}
      </Button>
      {error && (
        <div role="alert" className="rounded-xl bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-4 py-3 text-left">
          {error}
        </div>
      )}
    </div>
  )
}
