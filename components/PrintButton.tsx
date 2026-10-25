'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useDict } from '@/lib/i18n-context'
import Button from '@/components/ui/Button'
import { COPY_SUCCESS_HOLD_MS } from '@/components/copy-feedback'

// iOS voert window.print() niet uit in de beginscherm-app (standalone): de
// tik doet dan niets, terwijl dezelfde knop in Safari wel afdrukt. Een
// window.open naar dezelfde site helpt niet (getest 2026-10-25: kort zwart
// scherm), want iOS houdt adressen binnen het bereik van de web-app in de
// app. Tussenoplossing tot delen-als-PDF er is: een melding met een knop om de
// link te kopiëren, zodat de pagina in Safari kan worden afgedrukt.
// `navigator.standalone` bestaat alleen op iOS, dus een geïnstalleerde app op
// Android/desktop (waar printen wél werkt) blijft printen.
function isIosBeginschermApp() {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export default function PrintButton({ className = '', disabled = false }: { className?: string; disabled?: boolean }) {
  const t = useDict()
  const [melding, setMelding] = useState(false)
  const [kopie, setKopie] = useState<'idle' | 'copied' | 'fallback'>('idle')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const meldingId = useId()

  // Sluiten bij tik buiten de melding of Escape (zelfde patroon als OverflowMenu).
  useEffect(() => {
    if (!melding) return
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setMelding(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMelding(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [melding])

  function handleClick() {
    if (isIosBeginschermApp()) {
      setKopie('idle')
      setMelding(m => !m)
      return
    }
    window.print()
  }

  async function handleCopy() {
    const url = window.location.href
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url)
        setKopie('copied')
        setTimeout(() => setKopie(k => (k === 'copied' ? 'idle' : k)), COPY_SUCCESS_HOLD_MS)
        return
      } catch {
        // Valt door naar de fallback hieronder.
      }
    }
    // Fallback (zelfde als InviteLinkCard): toon en selecteer de link zodat
    // de gebruiker hem zelf kan kopiëren.
    setKopie('fallback')
    requestAnimationFrame(() => inputRef.current?.select())
  }

  return (
    <div ref={rootRef} className="relative flex-shrink-0 print:hidden">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-expanded={melding || undefined}
        aria-controls={melding ? meldingId : undefined}
        // Designronde 3: pilvorm in de secundaire knopstijl; op smalle schermen
        // alleen het icoon (label blijft voor schermlezers), anders drukt hij
        // lange paginatitels als "Trainingsplanner" weg.
        className={`print:hidden inline-flex items-center justify-center gap-2 h-10 px-4 max-sm:w-10 max-sm:px-0 rounded-full btn-secondary text-muted hover:text-ink text-sm font-semibold transition-colors active:scale-95 flex-shrink-0 disabled:opacity-60 ${className}`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
        </svg>
        <span className="max-sm:sr-only">{t.trainingPlan.print}</span>
      </button>
      {melding && (
        <div
          id={meldingId}
          role="dialog"
          aria-label={t.trainingPlan.print}
          className="menu-popover anim-menu origin-top-right absolute right-0 top-full mt-2 w-[min(18rem,calc(100vw-2rem))] p-3.5 z-[var(--z-sheet)] flex flex-col gap-3"
        >
          <p className="text-[13.5px] text-ink leading-snug">{t.trainingPlan.printStandaloneHint}</p>
          {kopie === 'fallback' && (
            <input
              ref={inputRef}
              readOnly
              value={window.location.href}
              aria-label={t.trainingPlan.printCopyFailed}
              className="w-full h-10 px-3 rounded-xl text-sm text-ink bg-surface border border-[var(--border-soft)]"
            />
          )}
          <Button variant="primary" fullWidth onClick={handleCopy}>
            {kopie === 'copied' ? t.trainingPlan.printLinkCopied : kopie === 'fallback' ? t.trainingPlan.printCopyFailed : t.trainingPlan.printCopyLink}
          </Button>
        </div>
      )}
    </div>
  )
}
