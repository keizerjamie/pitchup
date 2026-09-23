'use client'

// Eén rij in de ledenlijst van StafSection.tsx: avatar-initialen, e-mailadres,
// rolbadge, en voor een assistent de zes rechten-toggles + een verwijderknop
// met een inline bevestigingsblok (zelfde soort tweetraps-bevestiging als
// components/DeleteAccountSection.tsx, hier zonder typ-woord omdat dit geen
// destructieve dataverwijdering is — alleen het lidmaatschap verdwijnt).

import { useState, useTransition } from 'react'
import { removeMember } from '@/app/actions/team-members'
import RechtenToggles from './RechtenToggles'
import { useDict } from '@/lib/i18n-context'
import type { TeamRechten } from '@/lib/team-rechten'

export interface StafLid {
  userId: string
  email: string | null
  rol: 'owner' | 'assistent'
  rechten: Record<string, boolean>
}

function initialsVan(email: string | null): string {
  if (!email) return '?'
  const local = email.split('@')[0]
  const woorden = local.split(/[.\-_]+/).filter(Boolean)
  const initials = woorden.length >= 2 ? woorden[0][0] + woorden[1][0] : local.slice(0, 2)
  return initials.toUpperCase()
}

export default function StafMemberRow({ lid }: { lid: StafLid }) {
  const t = useDict()
  const [removed, setRemoved] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (removed) return null

  function handleRemove() {
    setError(null)
    startTransition(async () => {
      try {
        await removeMember(lid.userId)
        setRemoved(true)
      } catch {
        setError(t.staf.saveFailed)
        setConfirmOpen(false)
      }
    })
  }

  return (
    <div className="py-3.5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-bold font-display flex-shrink-0"
          style={{ background: 'var(--primary)' }}
          aria-hidden="true"
        >
          {initialsVan(lid.email)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-bold text-ink truncate">{lid.email ?? '—'}</p>
          <p className="text-[12px] font-semibold text-faint">{lid.rol === 'owner' ? t.staf.roleOwner : t.staf.roleAssistant}</p>
        </div>
        {lid.rol === 'assistent' && !confirmOpen && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="text-[12.5px] font-semibold text-danger flex-shrink-0"
          >
            {t.staf.removeMember}
          </button>
        )}
      </div>

      {lid.rol === 'owner' ? (
        <p className="text-[12.5px] text-faint">{t.staf.readOnly}</p>
      ) : (
        <RechtenToggles userId={lid.userId} initialRechten={lid.rechten as TeamRechten} />
      )}

      {confirmOpen && (
        <div className="rounded-xl border border-panel-red-edge bg-panel-red/50 p-3 flex flex-col gap-2">
          <p className="text-[12.5px] font-semibold text-panel-red-ink">{t.staf.removeMemberConfirm}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="flex-1 py-2 rounded-lg text-[12.5px] font-semibold text-muted border border-[var(--border-soft)]"
            >
              {t.trainingPlan.cancel}
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={isPending}
              className="flex-1 py-2 rounded-lg text-[12.5px] font-semibold text-white bg-danger disabled:opacity-50"
            >
              {isPending ? t.settings.deleting : t.staf.removeMember}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-[12px] font-semibold text-danger">{error}</p>}
    </div>
  )
}
