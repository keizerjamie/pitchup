'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { gaTerug } from '@/components/BackButton'

// Bewaking tegen verloren, nog niet opgeslagen werk (de wedstrijd als één
// flow). Zolang `actief` is:
//  - wordt elke interne link-klik onderschept in de capture-fase (dus vóór de
//    onClick van Next's <Link>); `doel` bevat dan de bestemming en de
//    aanroeper toont een bevestigingsblad met `blijf` en `verlaat`;
//  - wordt een klik op een element met TERUG_ATTRIBUUT (de terugpijl in de
//    paginakop, BackButton) onderschept; `doel` is dan TERUG_DOEL en
//    `verlaat()` navigeert zoals BackButton zelf (router.back(), of de
//    fallback uit het attribuut zonder geschiedenis);
//  - zet `beforeunload` voor herladen en sluiten (native browsertekst).
// Browser-terug en veeggebaar blijven bewust ongedekt.

export const TERUG_ATTRIBUUT = 'data-onopgeslagen-terug'
export const TERUG_DOEL = '__terug__'

interface Bewaking {
  doel: string | null
  blijf: () => void
  verlaat: () => void
}

export function useOnopgeslagenBewaking(actief: boolean): Bewaking {
  const router = useRouter()
  const [doel, setDoel] = useState<string | null>(null)
  const terugFallbackRef = useRef('/')
  const ontkoppelRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!actief) return

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const doelEl = e.target instanceof Element ? e.target : null
      if (!doelEl) return

      const terug = doelEl.closest(`[${TERUG_ATTRIBUUT}]`)
      if (terug) {
        terugFallbackRef.current = terug.getAttribute(TERUG_ATTRIBUUT) || '/'
        e.preventDefault()
        e.stopPropagation()
        setDoel(TERUG_DOEL)
        return
      }

      const link = doelEl.closest('a[href]')
      if (!(link instanceof HTMLAnchorElement)) return
      if (link.target && link.target !== '_self') return
      if (link.hasAttribute('download')) return
      let url: URL
      try {
        url = new URL(link.href, window.location.href)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      // Alleen een hash-verschil op dezelfde pagina is geen weggaan.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return

      e.preventDefault()
      e.stopPropagation()
      setDoel(url.pathname + url.search + url.hash)
    }

    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }

    document.addEventListener('click', onClick, true)
    window.addEventListener('beforeunload', onBeforeUnload)
    const ontkoppel = () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
    ontkoppelRef.current = ontkoppel
    return () => {
      ontkoppel()
      ontkoppelRef.current = null
    }
  }, [actief])

  const blijf = useCallback(() => setDoel(null), [])

  const verlaat = useCallback(() => {
    const bestemming = doel
    setDoel(null)
    if (bestemming === null) return
    // Eerst de listeners weg: de navigatie mag niet opnieuw onderschept worden
    // of een beforeunload-dialoog oproepen.
    ontkoppelRef.current?.()
    ontkoppelRef.current = null
    if (bestemming === TERUG_DOEL) {
      gaTerug(router, terugFallbackRef.current)
      return
    }
    router.push(bestemming)
  }, [doel, router])

  return { doel, blijf, verlaat }
}
