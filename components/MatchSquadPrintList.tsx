'use client'

import type { Player } from '@/lib/types'
import { sortSquadForExport } from '@/lib/match-squad'
import { useDict } from '@/lib/i18n-context'

interface Props {
  players: Player[]
  opponent: string | null
  dateLabel: string
}

// Print-only presentatie van de wedstrijdselectie (dual-markup-patroon, zie
// AttendanceSummary.tsx). Geen groepering zichtbaar: sortSquadForExport
// bepaalt puur de VOLGORDE (keepers eerst), er is geen kop/scheiding/witruimte
// die de grens tussen keepers en veldspelers verraadt — één doorlopende <ul>.
//
// Bewuste importbeperking: uit `@/lib/types` alleen `Player`. Geen
// FORMATIONS/POSITION_GROUPS/LineupPosition/POSITION_ABBREVIATIONS — dit
// bestand mag nooit opstelling-info kunnen lekken.
export default function MatchSquadPrintList({ players, opponent, dateLabel }: Props) {
  const t = useDict()
  const sorted = sortSquadForExport(players, t.browserLocale)

  return (
    <div className="hidden print:block">
      {opponent && <p>{t.lineup.vsLabel} {opponent}</p>}
      <p>{dateLabel}</p>
      <ul>
        {sorted.map((p) => (
          <li key={p.id}>{p.name}</li>
        ))}
      </ul>
    </div>
  )
}
