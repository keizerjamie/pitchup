import Image from 'next/image'
import Link from 'next/link'
import { getDict } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'
import { peekInvite } from '@/app/actions/team-invites'
import { signOut } from '@/app/actions/auth'
import InviteConfirm from './InviteConfirm'

// Publieke uitnodigingslanding (brief §2.2/§2.3, backend-contract §4). Volle-
// scherm-layout zoals app/register/page.tsx, zonder app-chrome (AppShell.tsx
// herkent /invite/* en rendert er zelf al omheen zonder zijbalk/nav/FAB).
//
// Drie takken:
//   1. status === 'invalid' — neutrale melding, GEEN teamnaam, geen
//      onderscheid tussen verlopen/gebruikt/ingetrokken/onbekend/rate-limited
//      (dat is precies wat peekInvite() al garandeert).
//   2. status === 'ok' zonder sessie — teamnaam + twee ingangen.
//   3. status === 'ok' met sessie — bevestigingsscherm (client, InviteConfirm).
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [t, supabase] = await Promise.all([getDict(), createClient()])
  const [{ status, teamNaam }, { data: { user } }] = await Promise.all([
    peekInvite(token),
    supabase.auth.getUser(),
  ])

  return (
    <div
      className="fixed inset-0 overflow-auto flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(160deg, #0d3d38 0%, #0a2e2a 100%)' }}
    >
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Image src="/logo.png" alt="Pitchup" width={64} height={64} className="rounded-2xl mb-4" />
          <h1 className="text-2xl font-bold text-white">Pitchup</h1>
        </div>

        {status === 'invalid' ? (
          <div className="text-center flex flex-col gap-5">
            <p className="text-white/85 text-sm">{t.invite.invalid}</p>
            <Link
              href="/login"
              className="inline-block py-3 rounded-xl bg-accent-strong text-white font-semibold hover:bg-accent-strong/90 active:scale-[0.98] transition"
            >
              {t.auth.backToLogin}
            </Link>
          </div>
        ) : !user ? (
          <div className="flex flex-col gap-5 text-center">
            <div>
              <p className="text-white text-lg font-semibold">{t.invite.title}</p>
              <p className="text-white/75 text-sm mt-1">{t.invite.forTeam.replace('{team}', teamNaam ?? '')}</p>
            </div>
            <div className="flex flex-col gap-3">
              <Link
                href={`/invite/${token}/register`}
                className="w-full py-3 rounded-xl bg-accent-strong text-white font-semibold hover:bg-accent-strong/90 active:scale-[0.98] transition"
              >
                {t.invite.createAccount}
              </Link>
              <Link
                href={`/login?next=/invite/${token}`}
                className="w-full py-3 rounded-xl bg-white/10 border border-white/20 text-white font-semibold hover:bg-white/15 active:scale-[0.98] transition"
              >
                {t.invite.haveAccount}
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5 text-center">
            <div>
              <p className="text-white text-lg font-semibold">{t.invite.title}</p>
              <p className="text-white/75 text-sm mt-1">{t.invite.forTeam.replace('{team}', teamNaam ?? '')}</p>
              <p className="text-white/60 text-sm mt-3">{t.invite.loggedInAs.replace('{email}', user.email ?? '')}</p>
            </div>

            <InviteConfirm token={token} teamNaam={teamNaam ?? ''} />

            <div className="flex flex-col gap-1.5 items-center">
              <p className="text-white/60 text-xs">{t.invite.notYou}</p>
              <form action={signOut}>
                <button type="submit" className="text-white/75 text-sm font-medium hover:text-white transition-colors">
                  {t.invite.logoutFirst}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
