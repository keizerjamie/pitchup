'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useDict } from '@/lib/i18n-context'
import Button from '@/components/ui/Button'
import Spinner from '@/components/icons/Spinner'
import { COPY_SUCCESS_HOLD_MS } from '@/components/copy-feedback'
import { useDeelModus } from '@/lib/deel-modus'
import { abonneerOpslag, wachtOpOpslag } from '@/lib/opslag-wachtrij'
import { pdfBestandsnaam } from '@/lib/pdf-bestandsnaam'
import { todayLocal } from '@/lib/utils'
import type { PdfDoel } from '@/lib/pdf/doelen'

// Wat de knop deelt. Voor trainingsplan en selectie geeft de pagina de datum
// van het event (kale YYYY-MM-DD) mee voor de bestandsnaam; aanwezigheid en
// inzichten gebruiken de datum van vandaag op het toestel.
export type PdfKnopDoel =
  | Extract<PdfDoel, { eventId: string }> & { datum: string }
  | Extract<PdfDoel, { periode: string }>

// Hoe lang een klaargezette PDF (na een verlopen gebaar) bruikbaar blijft.
const KLAAR_VERLOOP_MS = 60_000
const OPSLAG_TIMEOUT_MS = 10_000
// Ruim boven maxDuration (60 s) van /api/pdf: breekt de client eerder af terwijl
// de server nog rendert, dan komt een geroteerde refresh-cookie nooit aan.
const FETCH_TIMEOUT_MS = 65_000

type DeelStatus = 'idle' | 'bezig' | 'klaar' | 'fout'
type DeelUitkomst = 'gedeeld' | 'geannuleerd' | 'verlopen' | 'fout'

// navigator.share() met een bestand. Zonder title/text, zodat bijvoorbeeld
// WhatsApp geen losse tekst of link meestuurt.
async function deelBestand(bestand: File): Promise<DeelUitkomst> {
  try {
    await navigator.share({ files: [bestand] })
    return 'gedeeld'
  } catch (err) {
    const naam = err instanceof Error ? err.name : ''
    if (naam === 'AbortError') return 'geannuleerd'
    if (naam === 'NotAllowedError') return 'verlopen'
    return 'fout'
  }
}

function pdfQuery(pdf: PdfKnopDoel): URLSearchParams {
  const params = new URLSearchParams({ doel: pdf.doel })
  // Let op: de queryparameter heet `id`, niet `eventId` (API-contract).
  if ('eventId' in pdf) params.set('id', pdf.eventId)
  else params.set('periode', pdf.periode)
  params.set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone)
  return params
}

export default function PrintButton({ className = '', disabled = false, pdf }: { className?: string; disabled?: boolean; pdf: PdfKnopDoel }) {
  const t = useDict()
  const modus = useDeelModus()
  const [melding, setMelding] = useState(false)
  const [kopie, setKopie] = useState<'idle' | 'copied' | 'fallback'>('idle')
  const [status, setStatusState] = useState<DeelStatus>('idle')
  // Spiegel van `status` voor de guard tegen dubbel tikken: twee klikken in
  // dezelfde tik zien anders allebei nog 'idle'.
  const statusRef = useRef<DeelStatus>('idle')
  const klaarBestand = useRef<File | null>(null)
  const klaarTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aangekoppeld = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const meldingId = useId()

  const setStatus = useCallback((next: DeelStatus) => {
    statusRef.current = next
    setStatusState(next)
  }, [])

  const wisKlaar = useCallback(() => {
    klaarBestand.current = null
    if (klaarTimer.current) clearTimeout(klaarTimer.current)
    klaarTimer.current = null
  }, [])

  useEffect(() => {
    aangekoppeld.current = true
    return () => {
      aangekoppeld.current = false
      abortRef.current?.abort()
      if (klaarTimer.current) clearTimeout(klaarTimer.current)
    }
  }, [])

  // Een klaargezette PDF mag nooit verouderd gedeeld worden: zodra er een
  // nieuwe opslag in de wachtrij komt, vervalt hij.
  useEffect(() => {
    if (status !== 'klaar') return
    return abonneerOpslag(() => {
      wisKlaar()
      setStatus('idle')
    })
  }, [status, wisKlaar, setStatus])

  const statusPopoverOpen = status === 'fout' || status === 'klaar'

  // Sluiten bij tik buiten de melding of Escape (zelfde patroon als OverflowMenu).
  useEffect(() => {
    if (!melding && !statusPopoverOpen) return
    function sluit() {
      setMelding(false)
      if (statusRef.current === 'fout' || statusRef.current === 'klaar') {
        wisKlaar()
        setStatus('idle')
      }
    }
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) sluit()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') sluit()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [melding, statusPopoverOpen, wisKlaar, setStatus])

  // Zet een gemaakte PDF klaar voor een tweede tik (gebaar was verlopen).
  function zetKlaar(bestand: File) {
    klaarBestand.current = bestand
    if (klaarTimer.current) clearTimeout(klaarTimer.current)
    klaarTimer.current = setTimeout(() => {
      klaarBestand.current = null
      klaarTimer.current = null
      if (aangekoppeld.current && statusRef.current === 'klaar') setStatus('idle')
    }, KLAAR_VERLOOP_MS)
    setStatus('klaar')
  }

  // Tweede tik: het bestand ligt klaar, dus meteen delen (zonder await ervoor,
  // zodat het gebaar van deze tik nog geldt).
  function deelKlaarBestand(bestand: File) {
    wisKlaar()
    setStatus('idle')
    void deelBestand(bestand).then((uitkomst) => {
      if (!aangekoppeld.current) return
      // Ook de tweede tik kan nog NotAllowedError geven: zet het bestand weer
      // klaar in plaats van stil te eindigen.
      if (uitkomst === 'verlopen') zetKlaar(bestand)
      else if (uitkomst === 'fout') setStatus('fout')
    })
  }

  async function maakEnDeel() {
    setStatus('bezig')
    const abort = new AbortController()
    abortRef.current = abort
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // Eerst de lopende opslag afwachten: de PDF rendert de opgeslagen stand.
      await wachtOpOpslag({ timeoutMs: OPSLAG_TIMEOUT_MS })
      // De fetch-timeout start pas na het wachten op de opslag.
      timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS)
      const res = await fetch(`/api/pdf?${pdfQuery(pdf)}`, { redirect: 'manual', signal: abort.signal })
      if (!aangekoppeld.current) return
      // Sessie verlopen: de proxy stuurt door naar /login (opaqueredirect), of
      // de route zelf meldt 401. Beide: bestaand inloggedrag (AC10).
      if (res.type === 'opaqueredirect' || res.status === 401) {
        setStatus('idle')
        window.location.assign('/login')
        return
      }
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('application/pdf')) {
        setStatus('fout')
        return
      }
      const blob = await res.blob()
      if (!aangekoppeld.current) return
      const datum = 'datum' in pdf ? pdf.datum : todayLocal()
      const bestand = new File([blob], pdfBestandsnaam(t.trainingPlan.pdfNaam[pdf.doel], datum), { type: 'application/pdf' })

      // Is het gebaar van de eerste tik al verlopen, dan heeft share() geen zin.
      if (navigator.userActivation?.isActive === false) {
        zetKlaar(bestand)
        return
      }
      const uitkomst = await deelBestand(bestand)
      if (!aangekoppeld.current) return
      if (uitkomst === 'verlopen') zetKlaar(bestand)
      else if (uitkomst === 'fout') setStatus('fout')
      else setStatus('idle')
    } catch {
      // Netwerkfout, time-out van opslag of fetch. Bij unmount stil.
      if (aangekoppeld.current) setStatus('fout')
    } finally {
      if (timer) clearTimeout(timer)
      if (abortRef.current === abort) abortRef.current = null
    }
  }

  function handleClick() {
    if (modus === 'delen') {
      if (statusRef.current === 'bezig') return
      if (statusRef.current === 'klaar' && klaarBestand.current) {
        deelKlaarBestand(klaarBestand.current)
        return
      }
      void maakEnDeel()
      return
    }
    if (modus === 'link') {
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

  const delen = modus === 'delen'
  const bezig = delen && status === 'bezig'
  const label = !delen
    ? t.trainingPlan.print
    : status === 'bezig'
      ? t.trainingPlan.shareBusy
      : status === 'klaar'
        ? t.trainingPlan.shareReady
        : t.trainingPlan.share

  return (
    <div ref={rootRef} className="relative flex-shrink-0 print:hidden">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-expanded={melding || undefined}
        aria-controls={melding ? meldingId : undefined}
        // Geen echt disabled-attribuut tijdens het maken: de focus blijft op
        // de knop; handleClick negeert de tik.
        aria-busy={bezig || undefined}
        aria-disabled={bezig || undefined}
        // Designronde 3: pilvorm in de secundaire knopstijl; op smalle schermen
        // alleen het icoon (label blijft voor schermlezers), anders drukt hij
        // lange paginatitels als "Trainingsplanner" weg.
        className={`print:hidden inline-flex items-center justify-center gap-2 h-10 px-4 max-sm:w-10 max-sm:px-0 rounded-full btn-secondary text-muted hover:text-ink text-sm font-semibold transition-colors active:scale-95 flex-shrink-0 disabled:opacity-60 ${className}`}
      >
        {/* Vast icoonvak (w-5 h-5): de knop verspringt niet bij het wisselen
            tussen icoon en spinner; alleen een opacity-crossfade. */}
        <span className="relative block w-5 h-5 flex-shrink-0" aria-hidden="true">
          {delen ? (
            <>
              <svg className={`absolute inset-0 w-5 h-5 transition-opacity duration-150 ease-out ${bezig ? 'opacity-0' : 'opacity-100'}`} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V3.75m0 0L8.25 7.5M12 3.75l3.75 3.75M7.5 11.25H6.75A2.25 2.25 0 0 0 4.5 13.5v5.25A2.25 2.25 0 0 0 6.75 21h10.5a2.25 2.25 0 0 0 2.25-2.25V13.5a2.25 2.25 0 0 0-2.25-2.25h-.75" />
              </svg>
              <Spinner size={20} className={`absolute inset-0 transition-opacity duration-150 ease-out ${bezig ? 'opacity-100' : 'opacity-0'}`} />
            </>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
            </svg>
          )}
        </span>
        <span className="max-sm:sr-only">{label}</span>
      </button>
      {delen && status === 'fout' && (
        <div
          role="alert"
          className="menu-popover anim-menu origin-top-right absolute right-0 top-full mt-2 w-[min(18rem,calc(100vw-2rem))] p-3.5 z-[var(--z-sheet)]"
        >
          <p className="text-[13.5px] text-ink leading-snug">{t.trainingPlan.shareFailed}</p>
        </div>
      )}
      {delen && status === 'klaar' && (
        <div
          role="status"
          className="menu-popover anim-menu origin-top-right absolute right-0 top-full mt-2 w-[min(18rem,calc(100vw-2rem))] p-3.5 z-[var(--z-sheet)]"
        >
          <p className="text-[13.5px] text-ink leading-snug">{t.trainingPlan.shareReadyHint}</p>
        </div>
      )}
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
