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
  // Locatie van de wedstrijd (logistieke info, geen tactiek) — kale string.
  location: string | null
  selectedCount: number
  formItems: MatchFormItem[]
  // Kale strings, geen import van elders (zie de importbeperking hieronder):
  // al server-side geresolved (ingesteld óf fallback), dus hier geen
  // fallback-logica of null-checks nodig.
  primaryColor: string
  secondaryColor: string
  // Leesbare tekstkleur óp elk clubkleur-vlak (wit of donker, serverzijdig
  // gekozen via lib/club-colors.ts:readableInkOn — dat bestand mag hier niet
  // geïmporteerd worden, vandaar kale strings). Optioneel met wit als
  // default: het gedrag van vóór deze waarborg.
  primaryInk?: string
  secondaryInk?: string
}

// Print-only presentatie van de wedstrijdselectie (dual-markup-patroon, zie
// AttendanceSummary.tsx). Herontwerp 2026-08-24 ("van scratch", naar het
// patroon van profclub-selectieposters): één gegarandeerd A4, vier vlakken —
// kop en affiche op de primaire clubkleur, infoband op de secundaire, wit
// selectievel, voetstrook op de primaire. Zie `.print-poster*` in
// app/globals.css.
//
// CONTRASTREGELS (systematisch, n.a.v. een onleesbare rood-op-blauw-poster):
// op een clubkleur-vlak staat tekst uitsluitend in de meegegeven inktkleur
// (--club-primary-ink/--club-secondary-ink, met opacity voor secundaire
// tekst); de secundaire kleur verschijnt op het primaire vlak alleen nog als
// decoratieve accentbalk (geen tekst). Op het witte vel is alle tekst
// neutraal donker; clubkleuren zijn daar alleen randen/accenten.
//
// GEEN RUGNUMMERS: het team heeft geen vaste nummers (expliciete
// gebruikerswens 2026-08-24) — de lijst is kaal: uitsluitend namen.
//
// GEEN POSITIEGROEPERING: profclubs groeperen vaak op positie, maar deze
// selectie gaat naar de spelers zelf en mag geen positie-/tactiekinfo lekken
// — een eerdere, expliciete eigen beslissing (wedstrijdselectie-AC2 t/m AC4).
// Eén doorlopende lijst, keepers eerst (sortSquadForExport), geen tussenkop.
//
// Bewuste importbeperking: uit `@/lib/types` alleen `Player`. Geen
// FORMATIONS/POSITION_GROUPS/LineupPosition/POSITION_ABBREVIATIONS/HomeAway —
// dit bestand mag nooit opstelling-info kunnen lekken. `MatchFormItem` komt
// uit `@/lib/match-form`, niet uit `@/lib/types`.
export default function MatchSquadPrintList({
  players,
  opponent,
  dateLabel,
  teamName,
  teamLogoUrl,
  homeAway,
  gatherTime,
  kickoffTime,
  location,
  selectedCount,
  formItems,
  primaryColor,
  secondaryColor,
  primaryInk = '#ffffff',
  secondaryInk = '#ffffff',
}: Props) {
  const t = useDict()
  const sorted = sortSquadForExport(players, t.browserLocale)

  const homeAwayLabel = homeAway === 'home' ? t.calendar.homeLabel : homeAway === 'away' ? t.calendar.awayLabel : null

  // Zonder tegenstander vervalt de matchup (geen "vs null"); zonder teamnaam
  // blijft de bestaande, kortere "vs <opponent>"-vorm als ÉÉN tekstregel —
  // dat samengestelde formaat wordt letterlijk getoetst
  // (wedstrijdselectie.acceptance AC5/AC11) en mag niet uiteenvallen.
  const ownTeamLine = opponent && teamName ? teamName : null
  const opponentLine = opponent ? (teamName ? opponent : `${t.lineup.vsLabel} ${opponent}`) : null

  const gather = formatTime(gatherTime)
  const kickoff = formatTime(kickoffTime)

  // Beide teamregels even groot (profconventie: gelijkwaardige affichering;
  // de eigen ploeg onderscheidt zich met volle inkt, de tegenstander staat
  // gedempt). De trap volgt de LANGSTE van de twee regels zodat ze altijd
  // hetzelfde formaat delen en een lange clubnaam nooit van het blad loopt.
  const langsteRegel = Math.max(ownTeamLine?.length ?? 0, opponentLine?.length ?? 0)
  const matchupClass =
    langsteRegel > 30
      ? 'text-2xl leading-[1.12]'
      : langsteRegel > 18
        ? 'text-3xl leading-[1.1]'
        : 'text-5xl leading-[1.05]'

  // Kolommen passen zich aan de groepsgrootte aan: tot 18 namen twee ruime
  // kolommen, daarboven drie compactere — zo blijft de lijst één blok zonder
  // ooit de pagina te verlengen. Minimaal 1 rij: `repeat(0, auto)` is
  // ongeldige CSS en een lege selectie is een bestaand geval.
  const squadCols = sorted.length > 18 ? 3 : 2
  const squadRows = Math.max(1, Math.ceil(sorted.length / squadCols))

  return (
    <div className="hidden print:block print-poster" style={{ '--club-primary': primaryColor, '--club-secondary': secondaryColor, '--club-primary-ink': primaryInk, '--club-secondary-ink': secondaryInk } as React.CSSProperties}>
      {/* ── Kop (primair vlak): logo + teamnaam links, titel rechts ──
          De `border-b-4` in de primaire clubkleur staat op dezelfde
          achtergrondkleur en is daardoor niet zichtbaar — hij blijft staan
          omdat clubkleuren.acceptance.test.tsx (AC8) deze selector én zijn
          inline `borderColor` als bewijs gebruikt dat de ingestelde
          clubkleur de PDF daadwerkelijk bereikt. */}
      <div className="print-poster-top">
        <div className="flex items-center justify-between gap-4 border-b-4" style={{ borderColor: 'var(--club-primary, #004f3b)' }}>
          <div className="flex items-center gap-3">
            {/* Wit plaatje onder het clublogo: clublogo's zijn vrijwel altijd
                voor een lichte ondergrond getekend en verdwijnen anders in
                het gekleurde kopvlak. */}
            {teamLogoUrl && (
              <span className="print-poster-plate">
                <TeamLogo src={teamLogoUrl} size={40} alt={teamName ?? 'Pitchup'} fallback={null} />
              </span>
            )}
            {teamName && <span className="font-pdf-display text-lg font-black">{teamName}</span>}
          </div>
          {/* Titel in de inktkleur op halve sterkte — nooit meer de secundaire
              clubkleur als tekst op het primaire vlak (onleesbaar bij bv.
              rood op blauw). */}
          <span className="font-pdf-display text-xs font-extrabold uppercase tracking-[0.2em] opacity-70">{t.matchSquad.exportTitle}</span>
        </div>
      </div>

      {/* ── Affiche (primair vlak): meta-regel + beide teams even groot ── */}
      <div className="print-poster-matchup">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] opacity-75">
          {dateLabel}
          {homeAwayLabel && <> · {homeAwayLabel}</>}
        </p>
        {/* Decoratieve accentbalk — de enige plek voor de secundaire kleur op
            het primaire vlak (geen tekst, dus geen contrasteis). */}
        <span aria-hidden="true" className="print-poster-accent" />
        {opponentLine && (
          ownTeamLine ? (
            // Thuisploeg altijd op regel 1 (voetbalconventie); eigen team op
            // volle inkt, tegenstander gedempt — zelfde formaat.
            homeAway === 'away' ? (
              <>
                <p className={`font-pdf-display font-black tracking-tight opacity-75 ${matchupClass}`}>{opponentLine}</p>
                <p className={`font-pdf-display font-black tracking-tight ${matchupClass}`}>{ownTeamLine}</p>
              </>
            ) : (
              <>
                <p className={`font-pdf-display font-black tracking-tight ${matchupClass}`}>{ownTeamLine}</p>
                <p className={`font-pdf-display font-black tracking-tight opacity-75 ${matchupClass}`}>{opponentLine}</p>
              </>
            )
          ) : (
            <p className="font-pdf-display text-3xl font-black tracking-tight">{opponentLine}</p>
          )
        )}
      </div>

      {/* ── Infoband (secundair vlak): verzamelen · aftrap · locatie ──
          Structuur blijft exact twee niveaus diep (band → cel → label):
          wedstrijdselectie-pdf.acceptance.test.tsx zoekt de gemeenschappelijke
          voorouder van beide tijden via `label.parentElement.parentElement`.
          Ontbrekende waarde → cel weg; alles leeg → hele band weg. */}
      {(gather || kickoff || location) && (
        <div className="print-poster-band">
          {gather && (
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.16em] opacity-80">{t.matchSquad.gatherTimeLabel}</p>
              <p className="font-pdf-display text-2xl font-black leading-none mt-1">{gather}</p>
            </div>
          )}
          {kickoff && (
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.16em] opacity-80">{t.matchSquad.kickoffTimeLabel}</p>
              <p className="font-pdf-display text-2xl font-black leading-none mt-1">{kickoff}</p>
            </div>
          )}
          {location && (
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.16em] opacity-80">{t.event.location}</p>
              <p className="font-pdf-display text-base font-black leading-tight mt-1">{location}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Selectievel (wit): kopregel + platte namenlijst + vormstrip ── */}
      <div className="print-poster-sheet">
        <div className="flex items-end justify-between border-b-2 pb-1" style={{ borderColor: 'var(--club-primary, #004f3b)' }}>
          <p className="font-pdf-display text-lg font-black">{t.matchSquad.sectionSelection}</p>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] print-poster-meta">{selectedCount} {t.matchSquad.playersLabel} · {t.matchSquad.calledUpLabel}</p>
        </div>

        {/* Twee of drie kolommen via CSS grid, bewust NIET via `columns-*`
            (multi-column): WebKit — en dus iOS Safari, waar de eigenaar zijn
            PDF maakt — valt bij het printen van een multi-column container
            regelmatig terug op één kolom. Grid overleeft paged media wél.
            `gridAutoFlow: column` + expliciete rijen = verticale vulvolgorde
            (keepers eerst, uit sortSquadForExport).
            De structuur: precies één <ul> met uitsluitend <li>-children, elk
            <li> exact de spelersnaam — géén rugnummers (geen vaste nummers in
            dit team), géén gast-aanduiding (lijst gaat naar de spelers zelf),
            géén groepskoppen (geen positie-info op dit vel). */}
        <ul
          className={`mt-3 grid ${squadCols === 3 ? 'grid-cols-3 gap-x-6' : 'grid-cols-2 gap-x-10'}`}
          style={{ gridTemplateRows: `repeat(${squadRows}, auto)`, gridAutoFlow: 'column' }}
        >
          {sorted.map((p) => (
            <li
              key={p.id}
              className={`print-squad-item ${squadCols === 3 ? 'print-squad-item-compact' : ''}`}
            >
              {p.name}
            </li>
          ))}
        </ul>

        <MatchFormCards items={formItems} />
      </div>

      {/* ── Voetstrook (primair vlak): exact drie elementen ──
          De "·" tussen teamnaam en datum via CSS (`before:content`), zodat
          het aantal children op 3 blijft staan. Het merk staat in de
          inktkleur (was: secundaire kleur — onleesbaar bij rood op blauw). */}
      <div className="print-poster-foot flex items-center text-[10px]">
        <span className="font-semibold">{teamName}</span>
        <span className={teamName ? "font-semibold before:content-['·'] before:mx-1" : 'font-semibold'}>{dateLabel}</span>
        <span className="ml-auto flex items-center gap-1.5 font-black uppercase tracking-[0.14em] opacity-85">
          {/* eslint-disable-next-line @next/next/no-img-element -- zie TeamLogo.tsx-kopcomment: dit printbestand gebruikt bewust <img>, geen next/image — een synchroon renderende <img> is betrouwbaar bij afdrukken */}
          <img src="/logo.png" alt="Pitchup" className="h-4 w-4 object-contain" />
          {t.matchSquad.footerGenerated}
        </span>
      </div>
    </div>
  )
}
