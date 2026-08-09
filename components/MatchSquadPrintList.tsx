'use client'

import type { Player } from '@/lib/types'
import type { MatchFormItem } from '@/lib/match-form'
import { sortSquadForExport } from '@/lib/match-squad'
import { formatTime } from '@/lib/utils'
import { useDict } from '@/lib/i18n-context'
import TeamLogo from '@/components/TeamLogo'
import MatchFormCards from '@/components/MatchFormCards'

interface Props {
  players: Player[]
  opponent: string | null
  dateLabel: string
  teamName: string | null
  teamLogoUrl: string | null
  // Bewust een inline literal union, GEEN import van het `HomeAway`-type uit
  // `@/lib/types` — zie de importbeperking hieronder.
  homeAway: 'home' | 'away' | null
  gatherTime: string | null
  kickoffTime: string | null
  selectedCount: number
  formItems: MatchFormItem[]
}

// Print-only presentatie van de wedstrijdselectie (dual-markup-patroon, zie
// AttendanceSummary.tsx). Geen groepering zichtbaar: sortSquadForExport
// bepaalt puur de VOLGORDE (keepers eerst), er is geen kop/scheiding/witruimte
// die de grens tussen keepers en veldspelers verraadt — één doorlopende <ul>.
//
// Bewuste importbeperking: uit `@/lib/types` alleen `Player`. Geen
// FORMATIONS/POSITION_GROUPS/LineupPosition/POSITION_ABBREVIATIONS/HomeAway —
// dit bestand mag nooit opstelling-info kunnen lekken. Deze beperking geldt
// óók voor alle nieuwe content in dit bestand (kop/tijden/vorm-blok): geen van
// die toevoegingen importeert iets buiten `Player` (homeAway is bijvoorbeeld
// bewust een inline literal union, geen `HomeAway`-import) en `MatchFormItem`
// komt uit `@/lib/match-form`, niet uit `@/lib/types`.
export default function MatchSquadPrintList({
  players,
  opponent,
  dateLabel,
  teamName,
  teamLogoUrl,
  homeAway,
  gatherTime,
  kickoffTime,
  selectedCount,
  formItems,
}: Props) {
  const t = useDict()
  const sorted = sortSquadForExport(players, t.browserLocale)

  const homeAwayLabel = homeAway === 'home' ? t.calendar.homeLabel : homeAway === 'away' ? t.calendar.awayLabel : null

  // "Eigen team vs. tegenstander, groot en onder elkaar": zonder tegenstander
  // is er niets zinnigs om te vergelijken, dus die regel vervalt dan helemaal
  // (geen "vs null"/"vs undefined"). Zonder teamnaam (geen instelling) blijft
  // de bestaande, kortere "vs <opponent>"-vorm staan als ÉÉN tekstregel — dat
  // exacte, samengestelde formaat ("{vsLabel} {opponent}") wordt letterlijk
  // getoetst in wedstrijdselectie.acceptance.test.tsx (AC5/AC11) en mag dus
  // niet uiteenvallen in losse tekstnodes. Mét teamnaam splitsen we wél op in
  // twee losse, grote/vette regels (eigen team + tegenstander) — geen enkele
  // bestaande test legt voor dát geval een exacte, samengevoegde string vast.
  const ownTeamLine = opponent && teamName ? teamName : null
  const opponentLine = opponent ? (teamName ? opponent : `${t.lineup.vsLabel} ${opponent}`) : null

  const gather = formatTime(gatherTime)
  const kickoff = formatTime(kickoffTime)

  return (
    <div className="hidden print:block bg-stone-50 text-gray-900">
      {/* Kop: logo (alleen als aanwezig, geen placeholder) + teamnaam links, titel rechts */}
      <div className="flex items-start justify-between gap-4 border-b-4 border-emerald-900 pb-4">
        <div className="flex items-center gap-3">
          {teamLogoUrl && <TeamLogo src={teamLogoUrl} size={40} alt={teamName ?? 'Pitchup'} fallback={null} />}
          {teamName && <span className="text-xl font-extrabold text-emerald-900">{teamName}</span>}
        </div>
        <span className="text-xs font-bold uppercase tracking-wide text-emerald-600">{t.matchSquad.exportTitle}</span>
      </div>

      {/* Datumregel: dagnaam+datum + thuis/uit */}
      <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-emerald-600">
        {dateLabel}
        {homeAwayLabel && <> · {homeAwayLabel}</>}
      </p>

      {opponentLine && (
        <div className="mt-2">
          {ownTeamLine && <p className="text-2xl font-extrabold text-emerald-600">{ownTeamLine}</p>}
          <p className="text-3xl font-extrabold text-emerald-900">{opponentLine}</p>
        </div>
      )}

      {/* Verzameltijd + aftraptijd naast elkaar; ontbrekende tijd wordt
          stilzwijgend weggelaten, beide leeg → hele regel weg. `divide-x`
          levert de verticale scheidingslijn tussen de twee kolommen alleen op
          wanneer er ook daadwerkelijk twee kolommen zijn (bij één tijd is er
          niets om van te scheiden). */}
      {(gather || kickoff) && (
        <div className="mt-4 flex divide-x divide-emerald-900 border-t border-b border-emerald-900">
          {gather && (
            <div className="flex-1 px-4 py-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{t.matchSquad.gatherTimeLabel}</p>
              <p className="text-2xl font-extrabold text-emerald-900">{gather}</p>
            </div>
          )}
          {kickoff && (
            <div className="flex-1 px-4 py-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{t.matchSquad.kickoffTimeLabel}</p>
              <p className="text-2xl font-extrabold text-emerald-900">{kickoff}</p>
            </div>
          )}
        </div>
      )}

      {/* Sectiekop + aantal + statisch label — geen tweede statistiek */}
      <div className="mt-5 flex items-end justify-between">
        <p className="text-lg font-extrabold text-emerald-900">{t.matchSquad.sectionSelection}</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{selectedCount} {t.matchSquad.calledUpLabel}</p>
      </div>

      {/* Twee kolommen puur via CSS (`columns-2`) — de onderliggende <ul>/<li>
          -structuur (precies één <ul>, volgorde bepaald door
          sortSquadForExport) blijft ongewijzigd. */}
      <ul className="mt-2 columns-2 gap-x-6">
        {sorted.map((p) => (
          <li key={p.id} className="break-inside-avoid border-b border-gray-200 py-1 text-sm font-bold">{p.name}</li>
        ))}
      </ul>

      <MatchFormCards items={formItems} />

      {/* Footer: exact drie elementen, geen apart wedstrijddag-label (zou
          dubbelen met de dagnaam die al in dateLabel zit). De "·" tussen
          teamnaam en datum wordt puur visueel via CSS (`before:content`)
          toegevoegd aan de datum-span zelf, zodat het aantal children op 3
          blijft staan. */}
      <div className="mt-6 flex items-center border-t border-gray-300 pt-3 text-[11px] text-gray-500">
        <span>{teamName}</span>
        <span className={teamName ? "before:content-['·'] before:mx-1" : undefined}>{dateLabel}</span>
        <span className="ml-auto font-extrabold uppercase tracking-wide text-emerald-600">{t.matchSquad.footerGenerated}</span>
      </div>
    </div>
  )
}
