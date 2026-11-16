'use client'

import { useRouter } from 'next/navigation'
import { useDict } from '@/lib/i18n-context'
import { markeerInAppTerug } from '@/components/RouteTransition'

// Gedeelde terug-afhandeling (ook gebruikt door useOnopgeslagenBewaking):
// met geschiedenis terug als in-app terug, anders naar de fallback.
export function gaTerug(router: Pick<ReturnType<typeof useRouter>, 'back' | 'push'>, fallback: string) {
  if (window.history.length > 1) {
    markeerInAppTerug()
    router.back()
  } else {
    router.push(fallback)
  }
}

interface Props {
  fallback: string
  className?: string
  children: React.ReactNode
}

export default function BackButton({ fallback, className, children }: Props) {
  const router = useRouter()
  const t = useDict()

  function handleBack() {
    gaTerug(router, fallback)
  }

  return (
    // data-onopgeslagen-terug: laat useOnopgeslagenBewaking (lib/) deze klik
    // onderscheppen als de pagina niet-opgeslagen werk heeft; de waarde is de
    // fallback voor verlaat(). Zonder actieve bewaking doet het attribuut niets.
    <button type="button" onClick={handleBack} className={className} aria-label={t.nav.back} data-onopgeslagen-terug={fallback}>
      {children}
    </button>
  )
}
