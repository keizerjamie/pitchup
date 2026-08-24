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
  // Leesbare accent-tekstkleur op wit (de primaire clubkleur zelf, of een
  // vaste donkere vervanger als die te licht is) — serverzijdig gekozen via
  // lib/club-colors.ts:readableAccentOnWhite; dat bestand mag hier niet
  // geïmporteerd worden, vandaar een kale string. Default = de primaire
  // fallbackkleur (donker genoeg op wit).
  accentText?: string
}

// Print-only presentatie van de wedstrijdselectie (dual-markup-patroon, zie
// AttendanceSummary.tsx). Herontwerp 2026-08-24, tweede ronde ("clean
// document"): een wit teamsheet met de gewone 12mm-paginamarge — geen
// kleurvlakken en geen named page meer. De vorige poster-opzet (full-bleed
// kleurvlakken + `height: 100vh`-garantie) knipte op Safari/iOS het vormblok
// af (Safari rekent 100vh in paged media anders dan Chromium) en oogde zwaar;
// een document met marges rendert op élke engine identiek.
//
// CLUBKLEUREN ALS SUBTIEL ACCENT (expliciete gebruikerswens): een dunne
// tweekleurige balk bovenaan, accent-tekstkleur op kopjes/labels (via de
// gewaarborgde `accentText`), en dunne clubkleur-lijnen. Alle inhoudstekst
// staat in neutraal donker — bij géén enkele kleurencombinatie kan er nog
// iets onleesbaar worden.
//
// GEEN RUGNUMMERS (team heeft geen vaste nummers) en GEEN POSITIEGROEPERING
// (deze selectie gaat naar de spelers en mag geen positie-/tactiekinfo
// lekken — wedstrijdselectie-AC2 t/m AC4): één doorlopende lijst, keepers
// eerst, uitsluitend namen.
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
  accentText = '#004f3b',
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

  // Beide teamregels even groot (profconventie); de eigen ploeg op volle
  // inkt, de tegenstander gedempt (opacity-75 op de donkere inkt = grijs).
  // De trap volgt de LANGSTE van de twee regels, zodat ze altijd hetzelfde
  // formaat delen en een lange clubnaam nooit van het blad loopt.
  const langsteRegel = Math.max(ownTeamLine?.length ?? 0, opponentLine?.length ?? 0)
  const matchupClass =
    langsteRegel > 30
      ? 'text-2xl leading-[1.12]'
      : langsteRegel > 18
        ? 'text-3xl leading-[1.1]'
        : 'text-5xl leading-[1.05]'

  // Kolommen passen zich aan de groepsgrootte aan: tot 18 namen twee ruime
  // kolommen, daarboven drie compactere. Minimaal 1 rij: `repeat(0, auto)`
  // is ongeldige CSS en een lege selectie is een bestaand geval.
  const squadCols = sorted.length > 18 ? 3 : 2
  const squadRows = Math.max(1, Math.ceil(sorted.length / squadCols))

  return (
    <div className="hidden print:block print-poster" style={{ '--club-primary': primaryColor, '--club-secondary': secondaryColor, '--club-accent-text': accentText } as React.CSSProperties}>
      {/* Dunne tweekleurige clubbalk — het enige kleurvlak op het vel. Het
          tweede segment draagt de secundaire kleur (.print-poster-accent). */}
      <div className="print-poster-topbar" aria-hidden="true">
        <span className="print-poster-topbar-primair" />
        <span className="print-poster-accent" />
      </div>

      {/* ── Kop: logo + teamnaam links, documenttitel rechts ──
          De `border-b-4` met inline borderColor blijft staan als bewijsanker
          dat de ingestelde clubkleur de PDF bereikt (clubkleuren.acceptance
          AC8); de print-CSS verfijnt hem tot een dunne lijn. */}
      <div className="print-poster-top">
        <div className="flex items-center justify-between gap-4 border-b-4" style={{ borderColor: 'var(--club-primary, #004f3b)' }}>
          <div className="flex items-center gap-3">
            {teamLogoUrl && (
              <span className="print-poster-plate">
                <TeamLogo src={teamLogoUrl} size={40} alt={teamName ?? 'Pitchup'} fallback={null} />
              </span>
            )}
            {teamName && <span className="font-pdf-display text-lg font-black">{teamName}</span>}
          </div>
          <span className="print-accent-text font-pdf-display text-xs font-extrabold uppercase tracking-[0.2em]">{t.matchSquad.exportTitle}</span>
        </div>
      </div>

      {/* ── Matchup: meta-regel + beide teams even groot ── */}
      <div className="print-poster-matchup">
        <p className="print-accent-text text-[10px] font-extrabold uppercase tracking-[0.22em]">
          {dateLabel}
          {homeAwayLabel && <> · {homeAwayLabel}</>}
        </p>
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

      {/* ── Inforegel: verzamelen · aftrap · locatie — witte rij tussen twee
          dunne lijnen, geen kleurvlak. Structuur blijft exact twee niveaus
          diep (rij → cel → label): wedstrijdselectie-pdf.acceptance.test.tsx
          zoekt de gemeenschappelijke voorouder van beide tijden via
          `label.parentElement.parentElement`. Ontbrekende waarde → cel weg;
          alles leeg → hele rij weg. */}
      {(gather || kickoff || location) && (
        <div className="print-poster-band">
          {gather && (
            <div>
              <p className="print-poster-meta text-[9px] font-extrabold uppercase tracking-[0.16em]">{t.matchSquad.gatherTimeLabel}</p>
              <p className="font-pdf-display text-2xl font-black leading-none mt-1">{gather}</p>
            </div>
          )}
          {kickoff && (
            <div>
              <p className="print-poster-meta text-[9px] font-extrabold uppercase tracking-[0.16em]">{t.matchSquad.kickoffTimeLabel}</p>
              <p className="font-pdf-display text-2xl font-black leading-none mt-1">{kickoff}</p>
            </div>
          )}
          {location && (
            <div>
              <p className="print-poster-meta text-[9px] font-extrabold uppercase tracking-[0.16em]">{t.event.location}</p>
              <p className="font-pdf-display text-base font-black leading-tight mt-1">{location}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Selectie: kopregel + platte namenlijst ── */}
      <div className="print-poster-sheet">
        <div className="flex items-end justify-between border-b-2 pb-1" style={{ borderColor: 'var(--club-primary, #004f3b)' }}>
          <p className="print-accent-text font-pdf-display text-sm font-black uppercase tracking-[0.14em]">{t.matchSquad.sectionSelection}</p>
          <p className="print-poster-meta text-[10px] font-black uppercase tracking-[0.14em]">{selectedCount} {t.matchSquad.playersLabel} · {t.matchSquad.calledUpLabel}</p>
        </div>

        {/* Twee of drie kolommen via CSS grid, bewust NIET via `columns-*`
            (multi-column): WebKit — en dus iOS Safari, waar de eigenaar zijn
            PDF maakt — valt bij het printen van een multi-column container
            regelmatig terug op één kolom. Grid overleeft paged media wél.
            `gridAutoFlow: column` + expliciete rijen = verticale vulvolgorde
            (keepers eerst, uit sortSquadForExport).
            De structuur: precies één <ul> met uitsluitend <li>-children, elk
            <li> exact de spelersnaam — géén rugnummers, géén gast-aanduiding,
            géén groepskoppen. */}
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

      {/* ── Voetregel: exact drie elementen (teamnaam · datum | merk). De "·"
          via CSS (`before:content`), zodat het aantal children op 3 blijft. */}
      <div className="print-poster-foot flex items-center text-[10px]">
        <span className="font-semibold">{teamName}</span>
        <span className={teamName ? "font-semibold before:content-['·'] before:mx-1" : 'font-semibold'}>{dateLabel}</span>
        <span className="print-accent-text ml-auto flex items-center gap-1.5 font-black uppercase tracking-[0.14em]">
          {/* eslint-disable-next-line @next/next/no-img-element -- zie TeamLogo.tsx-kopcomment: dit printbestand gebruikt bewust <img>, geen next/image — een synchroon renderende <img> is betrouwbaar bij afdrukken */}
          <img src="/logo.png" alt="Pitchup" className="h-4 w-4 object-contain" />
          {t.matchSquad.footerGenerated}
        </span>
      </div>
    </div>
  )
}
