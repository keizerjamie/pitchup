'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Dict } from '@/messages/nl'
import type { Player } from '@/lib/types'
import { markInjured, markRecovered } from '@/app/actions/players'
import Button from '@/components/ui/Button'

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

  if (!canEditSpelers && !canEditAanwezigheid) return null

  // Designronde 3: alleen de twee statusacties, naast elkaar en even breed.
  // "Speler bewerken" staat nu rechtsboven in de kop (PlayerProfileHeader).
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2.5">
        {canEditSpelers && (
          <Button
            disabled={isPending}
            onClick={handleInjuryToggle}
            variant={player.injured ? 'primary' : 'danger'}
            icon={player.injured ? 'check_circle' : 'healing'}
            className={canEditAanwezigheid ? '' : 'col-span-2'}
          >
            {player.injured ? t.players.reportRecovered : t.players.reportInjury}
          </Button>
        )}
        {canEditAanwezigheid && (
          <Button variant="secondary" onClick={onSignOff} icon="event_busy" className={canEditSpelers ? '' : 'col-span-2'}>
            {t.players.signOff}
          </Button>
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
