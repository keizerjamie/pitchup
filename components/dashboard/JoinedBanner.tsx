'use client'

// Eenmalige bevestiging na het accepteren van een uitnodiging (brief §2.3
// punt 3, validatiebevinding 3): `acceptInvite` eindigt bij succes in
// `redirect('/?joined=1')`. Zonder deze banner belandt iemand die via een
// link binnenkomt zomaar op het dashboard van een team dat hij nog nooit zag
// — de teamwisselaar in de zijbalk/header is klein en geen bevestiging.
//
// `useSearchParams()` vereist een Suspense-boundary (zelfde patroon als
// app/login/page.tsx). De query-param wordt met `router.replace()` meteen
// uit de URL gehaald zodat een herlaad de banner niet opnieuw toont; de
// banner zelf blijft zichtbaar via lokale state (`shown`, één keer gelezen
// bij mount), onafhankelijk van de URL-wijziging die daarna volgt.
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useDict } from '@/lib/i18n-context'

function JoinedBannerInner({ teamName }: { teamName: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useDict()
  // Lazy initializer: leest de param precies één keer, bij de EERSTE render.
  // Bewust geen State-uit-een-effect (react-hooks/set-state-in-effect) — dat
  // zou bovendien fout gaan: zodra router.replace() hieronder de param uit de
  // URL haalt, verandert searchParams en zou een afgeleide state opnieuw
  // `false` worden vóórdat de gebruiker de banner ooit zag. `shown` verandert
  // daarna nooit meer, dus de banner blijft staan onafhankelijk van de URL.
  const [shown] = useState(() => searchParams.get('joined') === '1')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Deze effect roept bewust GEEN setState aan (alleen een navigatie-
    // side-effect) — dat is precies wat react-hooks/set-state-in-effect wil
    // voorkomen (cascaderende renders), en hoeft hier ook niet: `shown` staat
    // al vast via de lazy initializer hierboven.
    if (shown) router.replace('/', { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!shown || dismissed) return null

  return (
    <div
      role="status"
      className="rounded-2xl px-4 py-3 flex items-center justify-between gap-3 text-white"
      style={{ background: 'linear-gradient(120deg,#0d3d38,#14655c)' }}
    >
      <span className="text-[13.5px] font-semibold">{t.invite.joined.replace('{team}', teamName)}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t.common.close}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

export default function JoinedBanner({ teamName }: { teamName: string }) {
  return (
    <Suspense fallback={null}>
      <JoinedBannerInner teamName={teamName} />
    </Suspense>
  )
}
