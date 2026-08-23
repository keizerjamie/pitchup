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
// POSTER-INDELING (vier stapelvlakken, zie `.print-poster*` in
// app/globals.css): donkere kop in de primaire clubkleur, effen tijdenbalk in
// de secundaire kleur, wit selectievlak dat de resterende paginahoogte vult,
// en een donkere voetstrook. De vlakken lopen tot aan de papierrand via een
// named page (`@page squad`); waar de browser dat negeert blijft de gewone
// 12mm-marge staan en wordt het hetzelfde ontwerp binnen een witte rand.
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

  // Aantal rijen per kolom bij twee kolommen. Minimaal 1: `repeat(0, auto)` is
  // ongeldige CSS, en een lege selectie (0 spelers) is een bestaand geval.
  const squadColumnRows = Math.max(1, Math.ceil(sorted.length / 2))

  return (
    <div className="hidden print:block print-poster" style={{ '--club-primary': primaryColor, '--club-secondary': secondaryColor } as React.CSSProperties}>
      <div className="print-poster-hero">
        {/* Kop: logo (alleen als aanwezig, geen placeholder) + teamnaam links,
            titel rechts. De `border-b-4` in de primaire clubkleur staat op
            dezelfde achtergrondkleur en is daardoor niet zichtbaar — hij
            blijft staan omdat clubkleuren.acceptance.test.tsx (AC8) deze
            selector én zijn inline `borderColor` als bewijs gebruikt dat de
            ingestelde clubkleur de PDF daadwerkelijk bereikt. */}
        <div className="flex items-start justify-between gap-4 border-b-4 pb-4" style={{ borderColor: 'var(--club-primary, #004f3b)' }}>
          <div className="flex items-center gap-3">
            {/* Wit plaatje onder het clublogo: clublogo's zijn vrijwel altijd
                voor een lichte ondergrond getekend en verdwijnen anders in het
                donkere kopvlak. */}
            {teamLogoUrl && (
              <span className="print-poster-plate">
                <TeamLogo src={teamLogoUrl} size={40} alt={teamName ?? 'Pitchup'} fallback={null} />
              </span>
            )}
            {teamName && <span className="font-pdf-display text-xl font-black">{teamName}</span>}
          </div>
          <span className="font-pdf-display text-xs font-extrabold uppercase tracking-wide" style={{ color: 'var(--club-secondary, #009966)' }}>{t.matchSquad.exportTitle}</span>
        </div>

        {/* Datumregel: dagnaam+datum + thuis/uit */}
        <p className="mt-6 text-[11px] font-extrabold uppercase tracking-[0.18em]" style={{ color: 'var(--club-secondary, #009966)' }}>
          {dateLabel}
          {homeAwayLabel && <> · {homeAwayLabel}</>}
        </p>

        {/* Volgorde volgt thuis/uit (thuisploeg altijd op regel 1, standaard
            voetbalconventie): bij een uitwedstrijd staat de tegenstander (dan
            de thuisploeg) eerst, bij een thuiswedstrijd het eigen team eerst.
            Zonder homeAway (fallback, niet expliciet gespecificeerd) blijft het
            eigen team eerst staan, zoals voorheen. Grootte is bewust NIET
            symmetrisch: het eigen team is groter, de tegenstander een stuk
            kleiner — dit wijkt bewust af van het oorspronkelijke ontwerp (waar
            beide regels ongeveer gelijk groot zijn), directe gebruikerswens.
            `tracking-tight` hoort bij die keuze: Archivo Black op text-6xl
            staat standaard zo ruim dat de teamnaam als losse letters leest in
            plaats van als één blok. */}
        {opponentLine && (
          <div className="mt-3">
            {ownTeamLine ? (
              homeAway === 'away' ? (
                <>
                  <p className="font-pdf-display text-xl font-black" style={{ color: 'var(--club-secondary, #009966)' }}>{opponentLine}</p>
                  <p className="font-pdf-display text-6xl font-black leading-[0.9] tracking-tight">{ownTeamLine}</p>
                </>
              ) : (
                <>
                  <p className="font-pdf-display text-6xl font-black leading-[0.9] tracking-tight">{ownTeamLine}</p>
                  <p className="font-pdf-display text-xl font-black mt-2" style={{ color: 'var(--club-secondary, #009966)' }}>{opponentLine}</p>
                </>
              )
            ) : (
              <p className="font-pdf-display text-3xl font-black tracking-tight">{opponentLine}</p>
            )}
          </div>
        )}
      </div>

      {/* Verzameltijd + aftraptijd als effen balk in de secundaire clubkleur;
          ontbrekende tijd wordt stilzwijgend weggelaten, beide leeg → hele
          balk weg. De structuur blijft exact twee niveaus diep (balk → kolom →
          label): wedstrijdselectie-pdf.acceptance.test.tsx zoekt de
          gemeenschappelijke voorouder van beide tijden via
          `label.parentElement.parentElement`. */}
      {(gather || kickoff) && (
        <div className="print-poster-band">
          {gather && (
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] opacity-80">{t.matchSquad.gatherTimeLabel}</p>
              <p className="font-pdf-display text-3xl font-black leading-none mt-1">{gather}</p>
            </div>
          )}
          {kickoff && (
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] opacity-80">{t.matchSquad.kickoffTimeLabel}</p>
              <p className="font-pdf-display text-3xl font-black leading-none mt-1">{kickoff}</p>
            </div>
          )}
        </div>
      )}

      <div className="print-poster-sheet">
        {/* Sectiekop + aantal + statisch label — geen tweede statistiek */}
        <div className="flex items-end justify-between border-b-2 pb-1" style={{ borderColor: 'var(--club-primary, #004f3b)' }}>
          <p className="font-pdf-display text-lg font-black">{t.matchSquad.sectionSelection}</p>
          <p className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: 'var(--club-secondary, #009966)' }}>{selectedCount} {t.matchSquad.playersLabel} · {t.matchSquad.calledUpLabel}</p>
        </div>

        {/* Twee kolommen via CSS grid, bewust NIET via `columns-2` (multi-column):
            WebKit — en dus iOS Safari, waar de eigenaar zijn PDF maakt — valt bij
            het printen van een multi-column container regelmatig terug op één
            kolom. Grid overleeft paged media wél.

            `gridAutoFlow: column` + een expliciet aantal rijen geeft exact
            dezelfde VERTICALE vulvolgorde als multicol had: eerste helft in de
            linkerkolom, tweede helft rechts. Met de standaard rij-flow zou de
            lijst links-rechts-links gaan lopen en zou de volgorde uit
            sortSquadForExport (keepers eerst) anders lezen.

            De structuur blijft ongemoeid: precies één <ul> met uitsluitend
            <li>-children — dat wordt getoetst in AC4
            (wedstrijdselectie.acceptance.test.tsx). */}
        <ul
          className="mt-3 grid grid-cols-2 gap-x-10"
          style={{ gridTemplateRows: `repeat(${squadColumnRows}, auto)`, gridAutoFlow: 'column' }}
        >
          {sorted.map((p) => (
            // Bewust ALLEEN de naam als tekstinhoud: geen gast-aanduiding. Deze
            // lijst gaat naar de spelers zelf, en wie gastspeler is hoort daar
            // niet in te staan. Het onderscheid blijft wel zichtbaar in de app
            // (PlayerList, MatchSquadEditor) en in de trainingsplan-print
            // (AttendanceSummary).
            //
            // Het rugnummer staat in `data-jersey` en wordt door
            // `.print-squad-item::before` (app/globals.css) getoond, juist
            // zodat het GEEN tekstnode in de <li> wordt — zie de toelichting
            // daar. Zonder ingevuld nummer blijft het attribuut een lege
            // string en toont het kader niets.
            <li
              key={p.id}
              data-jersey={p.jersey_number === null ? '' : String(p.jersey_number)}
              className="print-squad-item break-inside-avoid py-1.5 text-sm font-extrabold"
              style={{ borderBottom: '1px solid #e5e7eb' }}
            >
              {p.name}
            </li>
          ))}
        </ul>

        <MatchFormCards items={formItems} />
      </div>

      {/* Footer: exact drie elementen, geen apart wedstrijddag-label (zou
          dubbelen met de dagnaam die al in dateLabel zit). De "·" tussen
          teamnaam en datum wordt puur visueel via CSS (`before:content`)
          toegevoegd aan de datum-span zelf, zodat het aantal children op 3
          blijft staan. */}
      <div className="print-poster-foot flex items-center text-[11px]">
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
