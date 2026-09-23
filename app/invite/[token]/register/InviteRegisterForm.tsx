'use client'

// Client-formulier voor app/invite/[token]/register/page.tsx — kopie van
// app/register/page.tsx zonder teamnaam-veld, met een hidden `token` en
// useActionState(signUpViaInvite, null) (backend-contract §4).
import { useActionState } from 'react'
import Image from 'next/image'
import { signUpViaInvite } from '@/app/actions/auth'
import { useDict } from '@/lib/i18n-context'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-policy'
import type { Dict } from '@/messages/nl'

// `signUpViaInvite` geeft dezelfde vaste, Nederlandse foutstrings terug als
// `signUp` vandaag al doet (rechtstreeks getoond, anti-enumeratie). Twee
// ervan zijn statisch en dus 1-op-1 te vertalen; de twee met een ingevuld
// getal (wachtwoordlengte, rate-limit-minuten) blijven bewust in het
// Nederlands staan — die exact reconstrueren zou de foutstring van de action
// moeten parsen, wat bij de eerstvolgende woordwijziging daar stil breekt.
function vertaalFout(t: Dict, ruw: string): string {
  if (ruw === 'Deze uitnodiging is niet (meer) geldig. Vraag de hoofdtrainer om een nieuwe link.') {
    return t.invite.invalid
  }
  if (ruw === 'Bevestig eerst je e-mailadres en open daarna de uitnodigingslink opnieuw.') {
    return t.invite.confirmEmailFirst
  }
  if (
    ruw === 'Registratie is niet gelukt. Controleer je gegevens en probeer het opnieuw.' ||
    ruw === 'Registratie mislukt, probeer opnieuw'
  ) {
    return t.auth.genericError
  }
  return ruw
}

export default function InviteRegisterForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(signUpViaInvite, null)
  const t = useDict()

  return (
    <div className="fixed inset-0 overflow-auto flex items-center justify-center px-4" style={{ background: 'linear-gradient(160deg, #0d3d38 0%, #0a2e2a 100%)' }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Image src="/logo.png" alt="Pitchup" width={64} height={64} className="rounded-2xl mb-4" />
          <h1 className="text-2xl font-bold text-white">Pitchup</h1>
          <p className="text-white/75 text-sm mt-1">{t.invite.createAccount}</p>
        </div>

        <form action={action} className="space-y-4">
          <input type="hidden" name="token" value={token} />

          {state?.error && (
            <div className="bg-red-500/20 border border-red-400/30 text-red-200 text-sm px-4 py-3 rounded-xl">
              {vertaalFout(t, state.error)}
            </div>
          )}

          <div>
            <label className="block text-white/75 text-sm font-medium mb-1.5">{t.auth.email}</label>
            <input name="email" type="email" required autoComplete="email"
              className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder={t.auth.emailPlaceholder} />
          </div>

          <div>
            <label className="block text-white/75 text-sm font-medium mb-1.5">{t.auth.password}</label>
            <input name="password" type="password" required autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH}
              className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder={t.auth.passwordMinLength} />
          </div>

          <button type="submit" disabled={pending}
            className="w-full py-3 rounded-xl bg-accent-strong text-white font-semibold hover:bg-accent-strong/90 active:scale-[0.98] transition disabled:opacity-60 mt-2">
            {pending ? t.auth.creating : t.invite.createAccount}
          </button>
        </form>
      </div>
    </div>
  )
}
