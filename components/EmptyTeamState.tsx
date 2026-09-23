import Link from 'next/link'
import { getDict } from '@/lib/i18n'
import CreateTeamCta from '@/components/CreateTeamCta'

// AC 16/52: een ingelogde gebruiker zonder enkel lidmaatschap (bv. na
// removeMember door de hoofdtrainer, of e-mailbevestiging die nog niet
// gelukt is). AppShell rendert dit IN PLAATS VAN children zolang er geen
// actief team is (brief §4.2), behalve op /settings en /invite/* — die
// blijven bereikbaar zodat de gebruiker kan uitloggen, zijn account kan
// verwijderen, of een uitnodigingslink alsnog kan verzilveren.
//
// Server component: geen interactiviteit nodig behalve de knop zelf, die
// daarom in een los client-bestand staat (components/CreateTeamCta.tsx).
export default async function EmptyTeamState() {
  const t = await getDict()

  return (
    <div className="max-w-sm mx-auto px-4 py-16 flex flex-col items-center text-center gap-5 min-h-[70vh] justify-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)' }}
        aria-hidden="true"
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--primary-strong)" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM3.75 20.25a8.25 8.25 0 0116.5 0" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 3.75a3 3 0 11.53 5.955M20.25 20.25c0-2.923-1.28-5.545-3.309-7.343" opacity="0.55" />
        </svg>
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-[19px] font-bold text-ink">{t.team.noTeamTitle}</h1>
        <p className="text-[13.5px] font-medium text-muted">{t.team.noTeamBody}</p>
        <p className="text-[13px] text-faint">{t.team.noTeamInviteHint}</p>
      </div>

      <CreateTeamCta />

      <Link href="/settings" className="text-[13px] font-semibold text-faint hover:text-ink transition-colors mt-1">
        {t.nav.settings}
      </Link>
    </div>
  )
}
