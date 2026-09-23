'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Dict } from '@/messages/nl'
import type { Player } from '@/lib/types'
import { markInjured, markRecovered } from '@/app/actions/players'

interface Props {
  player: Player
  t: Dict
  onSignOff: () => void
  canEditSpelers: boolean
  canEditAanwezigheid: boolean
}

// Acties onder de kop (AC19-AC22). Bewust GEEN optimistische pil: de
// server-pagina re-rendert via router.refresh() en de echte, laatst
// opgeslagen `player.injured` stroomt terug als prop (brief §2.3). Bij een
// gefaalde action blijft de pil op de laatst opgeslagen stand en toont deze
// knoprij een generieke i18n-melding — nooit de rauwe fout (lib/errors.ts).
export default function PlayerProfileActions({ player, t, onSignOff, canEditSpelers, canEditAanwezigheid }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleInjuryToggle() {
    setError(null)
    startTransition(async () => {
      try {
        if (player.injured) {
          await markRecovered(player.id)
        } else {
          await markInjured(player.id)
        }
        router.refresh()
      } catch {
        setError(t.players.actionError)
      }
    })
  }

  const buttonBase =
    'h-11 rounded-xl px-4 text-sm font-bold transition-transform duration-[160ms] ease-out active:scale-[0.97] disabled:opacity-55 disabled:pointer-events-none'

  if (!canEditSpelers && !canEditAanwezigheid) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canEditSpelers && (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={handleInjuryToggle}
              className={`${buttonBase} text-white`}
              style={{ background: player.injured ? 'var(--primary)' : 'var(--danger)' }}
            >
              {player.injured ? t.players.reportRecovered : t.players.reportInjury}
            </button>
            <Link
              href={`/players/${player.id}/edit`}
              className={`${buttonBase} bg-surface text-ink flex items-center justify-center`}
              style={{ border: '1px solid var(--border-soft)' }}
            >
              {t.players.editLabel}
            </Link>
          </>
        )}
        {canEditAanwezigheid && (
          <button
            type="button"
            onClick={onSignOff}
            className={`${buttonBase} bg-surface text-ink`}
            style={{ border: '1px solid var(--border-soft)' }}
          >
            {t.players.signOff}
          </button>
        )}
      </div>
      {error && (
        <p className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-3 py-2 rounded-lg">
          {error}
        </p>
      )}
    </div>
  )
}
