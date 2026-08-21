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
  // Kale strings, geen import van elders (zie de importbeperking hierboven):
  // al server-side geresolved (ingesteld óf fallback), dus hier geen
  // fallback-logica of null-checks nodig.
  primaryColor: string
  secondaryColor: string
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
  primaryColor,
  secondaryColor,
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
    <div className="hidden print:block bg-stone-50 text-gray-900" style={{ '--club-primary': primaryColor, '--club-secondary': secondaryColor } as React.CSSProperties}>
      {/* Kop: logo (alleen als aanwezig, geen placeholder) + teamnaam links, titel rechts */}
      <div className="flex items-start justify-between gap-4 border-b-4 pb-4" style={{ borderColor: 'var(--club-primary, #004f3b)' }}>
        <div className="flex items-center gap-3">
          {teamLogoUrl && <TeamLogo src={teamLogoUrl} size={40} alt={teamName ?? 'Pitchup'} fallback={null} />}
          {teamName && <span className="font-pdf-display text-xl font-black" style={{ color: 'var(--club-primary, #004f3b)' }}>{teamName}</span>}
        </div>
        <span className="font-pdf-display text-xs font-extrabold uppercase tracking-wide" style={{ color: 'var(--club-secondary, #009966)' }}>{t.matchSquad.exportTitle}</span>
      </div>

      {/* Datumregel: dagnaam+datum + thuis/uit */}
      <p className="mt-3 text-[11px] font-extrabold uppercase tracking-wide" style={{ color: 'var(--club-secondary, #009966)' }}>
        {dateLabel}
        {homeAwayLabel && <> · {homeAwayLabel}</>}
      </p>

      {/* Volgorde volgt thuis/uit (thuisploeg altijd op regel 1, standaard
          voetbalconventie): bij een uitwedstrijd staat de tegenstander (dan
          de thuisploeg) eerst, bij een thuiswedstrijd het eigen team eerst.
          Zonder homeAway (fallback, niet expliciet gespecificeerd) blijft het
          eigen team eerst staan, zoals voorheen. Grootte is bewust NIET
          symmetrisch: het eigen team is groter/groener (nadruk), de
          tegenstander iets kleiner/donkerder — dit wijkt bewust af van het
          ontwerp (waar beide regels ongeveer gelijk groot zijn), directe
          gebruikerswens. */}
      {opponentLine && (
        <div className="mt-2">
          {ownTeamLine ? (
            homeAway === 'away' ? (
              <>
                <p className="font-pdf-display text-xl font-black" style={{ color: 'var(--club-primary, #004f3b)' }}>{opponentLine}</p>
                <p className="font-pdf-display text-6xl font-black" style={{ color: 'var(--club-secondary, #009966)' }}>{ownTeamLine}</p>
              </>
            ) : (
              <>
                <p className="font-pdf-display text-6xl font-black" style={{ color: 'var(--club-secondary, #009966)' }}>{ownTeamLine}</p>
                <p className="font-pdf-display text-xl font-black" style={{ color: 'var(--club-primary, #004f3b)' }}>{opponentLine}</p>
              </>
            )
          ) : (
            <p className="font-pdf-display text-3xl font-black" style={{ color: 'var(--club-primary, #004f3b)' }}>{opponentLine}</p>
          )}
        </div>
      )}

      {/* Verzameltijd + aftraptijd naast elkaar; ontbrekende tijd wordt
          stilzwijgend weggelaten, beide leeg → hele regel weg. `divide-x`
          levert de verticale scheidingslijn tussen de twee kolommen alleen op
          wanneer er ook daadwerkelijk twee kolommen zijn (bij één tijd is er
          niets om van te scheiden). */}
      {(gather || kickoff) && (
        <div className="mt-4 flex border-t border-b" style={{ borderColor: 'var(--club-primary, #004f3b)' }}>
          {gather && (
            <div className="flex-1 px-4 py-2" style={kickoff ? { borderRight: '1px solid var(--club-primary, #004f3b)' } : undefined}>
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500">{t.matchSquad.gatherTimeLabel}</p>
              <p className="text-2xl font-black" style={{ color: 'var(--club-primary, #004f3b)' }}>{gather}</p>
            </div>
          )}
          {kickoff && (
            <div className="flex-1 px-4 py-2">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500">{t.matchSquad.kickoffTimeLabel}</p>
              <p className="text-2xl font-black" style={{ color: 'var(--club-primary, #004f3b)' }}>{kickoff}</p>
            </div>
          )}
        </div>
      )}

      {/* Sectiekop + aantal + statisch label — geen tweede statistiek */}
      <div className="mt-5 flex items-end justify-between">
        <p className="font-pdf-display text-lg font-black" style={{ color: 'var(--club-primary, #004f3b)' }}>{t.matchSquad.sectionSelection}</p>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{selectedCount} {t.matchSquad.playersLabel} · {t.matchSquad.calledUpLabel}</p>
      </div>

      {/* Twee kolommen puur via CSS (`columns-2`) — de onderliggende <ul>/<li>
          -structuur (precies één <ul>, volgorde bepaald door
          sortSquadForExport) blijft ongewijzigd. */}
      <ul className="mt-2 columns-2 gap-x-6">
        {sorted.map((p) => (
          // Bewust ALLEEN de naam: geen gast-aanduiding. Deze lijst gaat naar de
          // spelers zelf, en wie gastspeler is hoort daar niet in te staan. Het
          // onderscheid blijft wel zichtbaar in de app (PlayerList,
          // MatchSquadEditor) en in de trainingsplan-print (AttendanceSummary).
          <li key={p.id} className="break-inside-avoid border-b border-gray-200 py-1 text-sm font-extrabold">{p.name}</li>
        ))}
      </ul>

      <MatchFormCards items={formItems} />

      {/* Footer: exact drie elementen, geen apart wedstrijddag-label (zou
          dubbelen met de dagnaam die al in dateLabel zit). De "·" tussen
          teamnaam en datum wordt puur visueel via CSS (`before:content`)
          toegevoegd aan de datum-span zelf, zodat het aantal children op 3
          blijft staan. */}
      <div className="mt-6 flex items-center border-t border-gray-300 pt-3 text-[11px] text-gray-500">
        <span className="font-semibold">{teamName}</span>
        <span className={teamName ? "font-semibold before:content-['·'] before:mx-1" : 'font-semibold'}>{dateLabel}</span>
        <span className="ml-auto flex items-center gap-1.5 font-black uppercase tracking-wide" style={{ color: 'var(--club-secondary, #009966)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- zie TeamLogo.tsx-kopcomment: dit printbestand gebruikt bewust <img>, geen next/image, om diezelfde print-timing-reden; /logo.png is hier weliswaar lokaal (geen remotePatterns-issue), maar next/image zou dat voordeel bij afdrukken alsnog tenietdoen (async optimizer-ronde) en breekt de consistente <img>-stijl van dit bestand */}
          <img src="/logo.png" alt="Pitchup" className="h-4 w-4 object-contain" />
          {t.matchSquad.footerGenerated}
        </span>
      </div>
    </div>
  )
}
