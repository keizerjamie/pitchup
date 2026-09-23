'use client'

// Generieke route-error-boundary (Next.js file convention).
//
// EERLIJKE KANTTEKENING (validatiebevinding 7): Next saneert in productie
// élke fout die vanuit een Server Component naar boven komt tot een generiek
// bericht + `error.digest` — de vergelijkingen op `error.message === 'Geen
// team'` / `'Geen toegang'` hieronder zijn dus DEV-ONLY. In productie vallen
// beide takken altijd terug op de generieke `GenericErrorFallback` (nooit een
// blanco scherm — de `if`'s slaan gewoon nooit aan). Dat is onschuldig, geen
// lek: AppShell.tsx beslist onafhankelijk van deze boundary (op basis van
// `hasTeam`, uit de context die layout.tsx los ophaalt) of het de lege staat
// (EmptyTeamState) toont i.p.v. de pagina, en geen enkele page in `app/**`
// gooit vandaag `'Geen toegang'` tijdens het renderen. Dit bestand bestaat
// zodat een 'Geen team'-throw (requireTeamContextOrLogin() in
// lib/team-context.ts) NOOIT Next.js' kale standaard-foutscherm laat zien:
// omdat een Server Component die als `children` aan een Client Component
// (AppShell) wordt doorgegeven altijd al ván tevoren op de server gerenderd
// moet worden, gebeurt die throw vóórdat AppShell iets met `children` doet —
// deze boundary vangt hem op met een LEGE fallback (AppShell negeert
// `children` toch al wanneer `hasTeam` false is), zodat de rest van de boom
// (inclusief de chrome) normaal blijft renderen. Elke andere fout krijgt een
// generieke melding + "opnieuw proberen", nooit de rauwe foutmelding (zelfde
// regel als lib/errors.ts) — in productie is dat sowieso alles wat hier ooit
// te zien is.
import { useEffect } from 'react'
import { useDict } from '@/lib/i18n-context'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Bewust alleen console, geen gevoelige inhoud (net zoals lib/errors.ts
    // logError doet server-side).
    console.error(error)
  }, [error])

  if (error.message === 'Geen team') return null

  // 'Geen toegang' — een pagina die assertCanEdit() aanroept vóór een
  // schrijf-of-leesactie (buiten de gewone canEdit-prop-gate om) kan dit
  // gooien. Eigen, duidelijkere melding i.p.v. de generieke.
  if (error.message === 'Geen toegang') return <GenericErrorFallback onRetry={reset} noPermission />

  return <GenericErrorFallback onRetry={reset} />
}

function GenericErrorFallback({ onRetry, noPermission }: { onRetry: () => void; noPermission?: boolean }) {
  const t = useDict()
  return (
    <div className="max-w-sm mx-auto px-4 py-16 flex flex-col items-center text-center gap-4 min-h-[70vh] justify-center">
      <p className="text-[14px] font-semibold text-ink">{noPermission ? t.errors.noPermission : t.auth.genericError}</p>
      <button
        type="button"
        onClick={onRetry}
        className="px-5 py-2.5 rounded-xl text-sm font-bold text-white active:scale-[0.98] transition"
        style={{ background: 'var(--primary)' }}
      >
        {t.common.retry}
      </button>
    </div>
  )
}
