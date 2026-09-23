'use client'

// Zes bewerkrechten-schakelaars voor één assistent, in de Staf-sectie op
// Instellingen (brief §4.3). Autosave per toggle (AC 9 eist direct effect):
// elke klik stuurt meteen de VOLLEDIGE zes-rechtenset (updateMemberRights
// vraagt bewust geen patch, zie app/actions/team-members.ts) — daarom staan
// alle zes rijen tijdens een save op "bezig", niet alleen de aangeklikte.
//
// Optimistisch met rollback, zelfde patroon als components/TeamIndelingEditor.tsx
// (lastConfirmedRef, nooit de rauwe serverfout tonen).

import { useRef, useState, useTransition } from 'react'
import { updateMemberRights } from '@/app/actions/team-members'
import { ONDERDELEN, type Onderdeel, type TeamRechten } from '@/lib/team-rechten'
import { useDict } from '@/lib/i18n-context'

// Thumb beweegt met transform, nooit met `left` (geheugen.md).
const THUMB_TRANSITION_MS = 160

interface Props {
  userId: string
  initialRechten: TeamRechten
}

export default function RechtenToggles({ userId, initialRechten }: Props) {
  const t = useDict()
  const [rechten, setRechten] = useState<TeamRechten>(initialRechten)
  const [isPending, startTransition] = useTransition()
  const [errorOnderdeel, setErrorOnderdeel] = useState<Onderdeel | null>(null)
  const lastConfirmedRef = useRef<TeamRechten>(initialRechten)

  function toggle(onderdeel: Onderdeel) {
    if (isPending) return
    const next = { ...rechten, [onderdeel]: !rechten[onderdeel] }
    setRechten(next)
    setErrorOnderdeel(null)
    startTransition(async () => {
      try {
        await updateMemberRights(userId, next)
        lastConfirmedRef.current = next
      } catch {
        // Terugdraaien naar de laatst BEVESTIGDE stand, niet naar de stand
        // vóór deze ene klik — zodat een eerder geslaagde save niet verloren
        // gaat als twee saves elkaar overlappen.
        setRechten(lastConfirmedRef.current)
        setErrorOnderdeel(onderdeel)
      }
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-bold text-faint uppercase tracking-wide mb-0.5">{t.staf.canEditLabel}</p>
      {ONDERDELEN.map((onderdeel) => {
        const aan = rechten[onderdeel]
        const heeftFout = errorOnderdeel === onderdeel
        return (
          <div
            key={onderdeel}
            className="flex items-center justify-between gap-3 py-2 px-2.5 -mx-2.5 rounded-lg transition-opacity"
            style={{
              opacity: isPending ? 0.6 : 1,
              border: heeftFout ? '1px solid var(--danger)' : '1px solid transparent',
            }}
          >
            <span className="text-[13.5px] font-semibold text-ink">{t.staf.onderdeel[onderdeel]}</span>
            <button
              type="button"
              role="switch"
              aria-checked={aan}
              aria-label={t.staf.onderdeel[onderdeel]}
              disabled={isPending}
              onClick={() => toggle(onderdeel)}
              className="relative w-11 h-6 rounded-full flex-shrink-0 disabled:cursor-not-allowed"
              style={{
                background: aan ? 'var(--primary)' : 'var(--surface-sunken)',
                border: '1px solid var(--border-soft)',
                transition: `background-color ${THUMB_TRANSITION_MS}ms ease-out`,
              }}
            >
              <span
                aria-hidden="true"
                className="absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white"
                style={{
                  boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                  transition: `transform ${THUMB_TRANSITION_MS}ms ease-out`,
                  transform: aan ? 'translateX(20px)' : 'translateX(0)',
                }}
              />
            </button>
          </div>
        )
      })}
      {errorOnderdeel && (
        <p className="text-[12.5px] font-semibold text-danger mt-1">{t.staf.saveFailed}</p>
      )}
    </div>
  )
}
