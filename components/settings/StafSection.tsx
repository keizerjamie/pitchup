// Staf-sectie op Instellingen (brief §4.3) — alleen gerenderd voor de
// hoofdtrainer (app/settings/page.tsx bepaalt dat, `listTeamMembers` gooit
// zelf ook 'Geen toegang' voor een assistent en mag dus nooit voor hen
// aangeroepen worden — zie de feedback in de backend-samenvotting fase 2 §7).
//
// Server component: haalt de ledenlijst en de actieve-uitnodiging-status in
// één keer op en geeft ze door aan de client-subcomponenten.
import { listTeamMembers } from '@/app/actions/team-members'
import { getActiveInvite } from '@/app/actions/team-invites'
import { getDict } from '@/lib/i18n'
import InviteLinkCard from './InviteLinkCard'
import StafMemberRow from './StafMemberRow'

export default async function StafSection() {
  const t = await getDict()
  const [leden, activeInvite] = await Promise.all([
    listTeamMembers().catch(() => []),
    getActiveInvite().catch(() => null),
  ])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-[14px] font-bold text-ink">{t.staf.rightsTitle}</h3>
        <p className="text-[12.5px] text-faint mt-0.5">{t.staf.rightsHint}</p>
      </div>

      {leden.length === 0 ? (
        <p className="text-[13px] text-faint">{t.staf.noMembers}</p>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--border-soft)]">
          {leden.map((lid) => (
            <StafMemberRow key={lid.userId} lid={lid} />
          ))}
        </div>
      )}

      <div className="pt-4 border-t border-[var(--border-soft)]">
        <InviteLinkCard initialActiveInvite={activeInvite} />
      </div>
    </div>
  )
}
