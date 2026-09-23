'use client'

// Bevestigingsknop op de invite-landing voor een reeds-ingelogde bezoeker
// (brief §2.3, backend-contract §4). `acceptInvite` redirect zelf bij succes
// (status 'ok' komt hier dus nooit terug); de overige drie statussen worden
// hier afgehandeld, geen eigen navigatie erna.

import { useState, useTransition } from 'react'
import { acceptInvite } from '@/app/actions/team-invites'
import { useDict } from '@/lib/i18n-context'

type Uitkomst = 'already_member' | 'invalid' | 'rate_limited' | 'error'

interface Props {
  token: string
  teamNaam: string
}

export default function InviteConfirm({ token, teamNaam }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [uitkomst, setUitkomst] = useState<Uitkomst | null>(null)

  function handleAccept() {
    setUitkomst(null)
    startTransition(async () => {
      try {
        const resultaat = await acceptInvite(token)
        // 'ok' eindigt in redirect() binnen de action en komt hier nooit aan;
        // TypeScript kent de tak alsnog voor een exhaustieve switch hierboven.
        if (resultaat.status === 'ok') return
        setUitkomst(resultaat.status)
      } catch (err) {
        if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) return
        setUitkomst('error')
      }
    })
  }

  if (uitkomst === 'already_member') {
    return <p className="text-white/85 text-sm">{t.invite.alreadyMember}</p>
  }
  if (uitkomst === 'invalid') {
    return <p className="text-white/85 text-sm">{t.invite.invalid}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {uitkomst === 'rate_limited' && (
        <p className="text-amber-300 text-sm">{t.invite.rateLimited}</p>
      )}
      {uitkomst === 'error' && (
        <p className="text-red-300 text-sm">{t.auth.genericError}</p>
      )}
      <button
        type="button"
        onClick={handleAccept}
        disabled={isPending}
        className="w-full py-3 rounded-xl bg-accent-strong text-white font-semibold hover:bg-accent-strong/90 active:scale-[0.98] transition disabled:opacity-60"
      >
        {isPending ? t.invite.joining : t.invite.confirmJoin.replace('{team}', teamNaam)}
      </button>
    </div>
  )
}
