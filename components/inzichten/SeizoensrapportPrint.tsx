import type { Dict } from '@/messages/nl'
import {
  OPKOMST_DOEL,
  maandLabel,
  type AanwezigheidPerSpeler,
  type Doelsaldo,
  type MaandOpkomst,
  type MaandTrend,
  type RatingPerSpelerRij,
  type RatingTrend,
  type Signaal,
  type Seizoensvenster,
  type ThuisUitSplitsing,
  type TopWorst,
  type Topscorers,
  type VormTelling,
} from '@/lib/inzichten'
import { vulSignaalIn } from '@/lib/signaal-tekst'
import { KPI_VOLGORDE, bronMelding, kpiTegels, type KpiFout, type KpiTegel } from '@/lib/kpi-tekst'
import { ResultaatCellen, ResultaatKoppen } from './ResultaatTabel'
import TeamLogo from '@/components/TeamLogo'
import type { FormStripItem } from '@/components/dashboard/FormStrip'
import type { MatchResult } from '@/lib/types'

// Print-only seizoensrapport (dual-markup-patroon, zie MatchSquadPrintList.tsx
// en AttendanceSummary.tsx): maximaal twee A4's die een trainer kan meenemen naar een
// ouderavond of bestuursvergadering.
//
// BEWUST EEN DOCUMENT, GEEN POSTER. De wedstrijdselectie is een aankondiging
// en gebruikt daarom een named page zonder marge, met kleurvlakken tot aan de
// papierrand. Dit rapport wordt gelezen, niet opgehangen: het houdt de gewone
// 12mm-marge en gebruikt de clubkleur als accent, niet als vlak. Twee
// verschillende doelen, twee verschillende vormen — dat is geen inconsistentie.
//
// Geen recharts: de maandbalken zijn gewone divs met een hoogte in millimeters.
// Een SVG-chartlibrary is bij paged media onnodig grillig (zie de multicol-
// ervaring in geheugen.md), en zes balken rechtvaardigen die afhankelijkheid
// sowieso niet — zelfde afweging als VormChart.tsx op het scherm.

// Zelfde parse-conventie als formatDate() in lib/utils.ts (kale kalenderdatum
// + 'T00:00:00', dus lokaal geïnterpreteerd). Bewust NIET de UTC-variant uit
// maandLabel(): die bestaat omdat een 'YYYY-MM' naar een maandnaam moet, waar
// een tijdzoneverschuiving een hele maand kan verspringen. Bij een volledige
// datum volgt dit bestand de conventie die de rest van de app al gebruikt.
function datumLabel(datum: string, locale: string): string {
  return new Date(`${datum}T00:00:00`).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// Zelfde letterkeuze als FormStrip/MatchFormCards: de i18n-letters per taal.
function vormLetter(t: Dict, result: MatchResult): string {
  switch (result) {
    case 'win': return t.home.formLetterWin
    case 'draw': return t.home.formLetterDraw
    case 'loss': return t.home.formLetterLoss
    default: return t.home.formLetterUnknown
  }
}

// Topscorers-tabel: meer dan dit aantal rijen kost op papier te veel hoogte
// (de paginabegroting is twee A4's); de regel rapportTopscorersAfgekort maakt
// zichtbaar dat er is afgekapt.
const RAPPORT_MAX_TOPSCORERS = 6

// Foutvlaggen van de rapportbronnen: de vier KPI-bronnen (gedeeld met de
// strook) plus de bronnen van de secties. Alles optioneel, default false.
type RapportFout = KpiFout & {
  ratingPerSpeler: boolean
  aanwezigheidPerSpeler: boolean
  spelerMomenten: boolean
  vorm: boolean
}

// Vier <p>'s in dezelfde volgorde als de tegel op het scherm: label, venster,
// waarde, detail. Bij een melding vervangt één regel tekst waarde en detail;
// de melding is bewust nooit een role="alert" (dit is papier).
// Bewust data-rapport-kpi en niet data-kpi: de schermtests tellen [data-kpi].
function Kpi({ tegel }: { tegel: KpiTegel }) {
  const heeftMelding = tegel.melding !== undefined
  return (
    <div className={heeftMelding ? 'rapport-kpi rapport-kpi-neutraal' : 'rapport-kpi'} data-rapport-kpi={tegel.id}>
      <p className="rapport-kpi-label">{tegel.label}</p>
      <p className="rapport-kpi-venster">{tegel.venster}</p>
      {heeftMelding ? (
        <p className="rapport-melding">{tegel.melding}</p>
      ) : (
        <>
          <p className="rapport-kpi-waarde font-pdf-display">{tegel.waarde}</p>
          <p className="rapport-kpi-detail">{tegel.detail}</p>
        </>
      )}
    </div>
  )
}

function Melding({ tekst }: { tekst: string }) {
  return <p className="rapport-melding">{tekst}</p>
}

function SpelerLijst({ titel, rijen }: { titel: string; rijen: { id: string; naam: string; waarde: string }[] }) {
  if (rijen.length === 0) return null
  return (
    <div className="rapport-lijst">
      <p className="rapport-lijst-kop">{titel}</p>
      {rijen.map((r) => (
        <p key={r.id} className="rapport-lijst-rij">
          <span>{r.naam}</span>
          <span className="rapport-lijst-waarde">{r.waarde}</span>
        </p>
      ))}
    </div>
  )
}

export default function SeizoensrapportPrint({
  t,
  teamName,
  teamLogoUrl,
  venster,
  periodeLabel,
  opkomst,
  maanden,
  aanwezigheidPercentage,
  rating,
  saldo,
  signalen,
  ratingTopWorst,
  aanwezigheidTopWorst,
  vormTelling,
  vormItems = [],
  resultaten,
  topscorers,
  uitslagenAfgekapt = false,
  signalenOnvolledig = false,
  fout,
  generatedOn = null,
  primaryColor,
  secondaryColor,
}: {
  t: Dict
  teamName: string | null
  teamLogoUrl: string | null
  venster: Seizoensvenster
  periodeLabel: string
  opkomst: MaandTrend | null
  maanden: MaandOpkomst[]
  aanwezigheidPercentage: number | null
  rating: RatingTrend | null
  saldo: Doelsaldo
  signalen: Signaal[]
  ratingTopWorst: TopWorst<RatingPerSpelerRij>
  aanwezigheidTopWorst: TopWorst<AanwezigheidPerSpeler>
  vormTelling: VormTelling
  // De laatste-5-reeks als W/G/V-badges naast de telling — zelfde visuele
  // familie als de wedstrijdselectie-poster (MatchFormCards). Optioneel met
  // lege default zodat bestaande aanroepen/testharnassen blijven compileren.
  vormItems?: FormStripItem[]
  // Nieuwe props zijn optioneel (testharnassen blijven compileren). Zonder
  // `resultaten` ontbreekt de sectie Resultaten en tonen punten/clean sheets
  // "—"; zonder `topscorers` ontbreekt de sectie Topscorers.
  resultaten?: ThuisUitSplitsing
  topscorers?: Topscorers
  uitslagenAfgekapt?: boolean
  signalenOnvolledig?: boolean
  fout?: Partial<RapportFout>
  // Al geformatteerde generatiedatum voor de voetstrook (server bepaalt de
  // datum en het locale-formaat; dit component blijft deterministisch).
  generatedOn?: string | null
  primaryColor: string
  secondaryColor: string
}) {
  const f: RapportFout = {
    maandOpkomst: false,
    aanwezigheid: false,
    teamRating: false,
    uitslagen: false,
    ratingPerSpeler: false,
    aanwezigheidPerSpeler: false,
    spelerMomenten: false,
    vorm: false,
    ...fout,
  }
  const metCijfer = maanden.filter((m): m is MaandOpkomst & { percentage: number } => m.percentage !== null)

  const tegels = kpiTegels(
    {
      opkomst,
      aanwezigheidPercentage,
      rating,
      saldo,
      resultaat: resultaten?.totaal ?? null,
      uitslagenAfgekapt,
      periodeLabel,
      fout: f,
    },
    t,
  )

  const resultatenMelding = bronMelding(t, f.uitslagen, uitslagenAfgekapt)
  const topscorerRijen = topscorers?.spelers.slice(0, RAPPORT_MAX_TOPSCORERS) ?? []
  const resultaatRijen: [string, ThuisUitSplitsing['thuis']][] = resultaten
    ? [
        [t.insights.thuisLabel, resultaten.thuis],
        [t.insights.uitLabel, resultaten.uit],
        ...(resultaten.onbekend ? ([[t.insights.onbekendLabel, resultaten.onbekend]] as [string, ThuisUitSplitsing['thuis']][]) : []),
      ]
    : []

  const vormRegel = t.insights.vormSummary
    .replace('{win}', String(vormTelling.win))
    .replace('{gelijk}', String(vormTelling.gelijk))
    .replace('{verlies}', String(vormTelling.verlies))

  return (
    <div
      className="hidden print:block rapport"
      data-print-only
      style={{ '--club-primary': primaryColor, '--club-secondary': secondaryColor } as React.CSSProperties}
    >
      <div className="rapport-kop">
        <div className="rapport-kop-links">
          {teamLogoUrl && <TeamLogo src={teamLogoUrl} size={34} alt={teamName ?? 'Pitchup'} fallback={null} />}
          <div>
            {teamName && <p className="rapport-team font-pdf-display">{teamName}</p>}
            <p className="rapport-periode">
              {datumLabel(venster.start, t.browserLocale)} – {datumLabel(venster.end, t.browserLocale)} · {periodeLabel}
            </p>
          </div>
        </div>
        <p className="rapport-titel font-pdf-display">{t.insights.rapportTitle}</p>
      </div>

      <div className="rapport-kpis">
        {KPI_VOLGORDE.map((id) => (
          <Kpi key={id} tegel={tegels[id]} />
        ))}
      </div>

      {(signalen.length > 0 || signalenOnvolledig) && (
        <div className="rapport-sectie">
          <p className="rapport-sectiekop font-pdf-display">{t.insights.signalenTitle}</p>
          {signalen.map((s) => (
            <p key={s.id} className="rapport-signaal">
              {vulSignaalIn(t, s)}
            </p>
          ))}
          {/* Geen .rapport-signaal: de melding is geen signaal en krijgt geen bolletje. */}
          {signalenOnvolledig && <Melding tekst={t.insights.signalenOnvolledig} />}
        </div>
      )}

      {(resultaten || topscorers) && (
        <div className="rapport-kolommen">
          {resultaten && (
            <div className="rapport-sectie">
              <p className="rapport-sectiekop font-pdf-display">{t.insights.rapportResultatenTitle}</p>
              {resultatenMelding ? (
                <Melding tekst={resultatenMelding} />
              ) : resultaten.totaal.wedstrijden === 0 ? (
                <p className="rapport-noot">{t.insights.thuisUitEmpty}</p>
              ) : (
                <>
                  <table className="rapport-tabel">
                    <ResultaatKoppen eersteKolom={t.insights.locatieKolom} t={t} />
                    <tbody>
                      {resultaatRijen.map(([label, groep]) => (
                        <tr key={label}>
                          <th scope="row">{label}</th>
                          <ResultaatCellen groep={groep} />
                        </tr>
                      ))}
                      <tr>
                        <th scope="row">{t.insights.totaalLabel}</th>
                        <ResultaatCellen groep={resultaten.totaal} />
                      </tr>
                    </tbody>
                  </table>
                  <p className="rapport-noot">
                    {t.insights.cleanSheets
                      .replace('{n}', String(resultaten.totaal.cleanSheets))
                      .replace('{totaal}', String(resultaten.totaal.wedstrijden))}
                  </p>
                </>
              )}
            </div>
          )}

          {topscorers && (
            <div className="rapport-sectie">
              <p className="rapport-sectiekop font-pdf-display">{t.insights.rapportTopscorersTitle}</p>
              {f.spelerMomenten ? (
                <Melding tekst={t.insights.bronFout} />
              ) : topscorers.doelpunten === 0 ? (
                <p className="rapport-noot">{t.insights.topscorersEmpty}</p>
              ) : (
                <>
                  <table className="rapport-tabel">
                    <thead>
                      <tr>
                        <th scope="col" className="text-left">{t.insights.kolomSpeler}</th>
                        <th scope="col" className="rapport-tabel-getal">{t.players.statsGoals}</th>
                        <th scope="col" className="rapport-tabel-getal">{t.players.statsAssists}</th>
                        <th scope="col" className="rapport-tabel-getal">{t.insights.rapportKolomBetrokken}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topscorerRijen.map((sp) => (
                        <tr key={sp.player_id}>
                          <th scope="row">
                            {sp.naam}
                            {sp.gast && <span className="rapport-gast">({t.insights.gastLabel})</span>}
                          </th>
                          <td className="rapport-tabel-getal">{sp.doelpunten}</td>
                          <td className="rapport-tabel-getal">{sp.assists}</td>
                          <td className="rapport-tabel-getal">{sp.betrokken}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {topscorers.spelers.length > RAPPORT_MAX_TOPSCORERS && (
                    <p className="rapport-noot">
                      {t.insights.rapportTopscorersAfgekort
                        .replace('{n}', String(RAPPORT_MAX_TOPSCORERS))
                        .replace('{totaal}', String(topscorers.spelers.length))}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="rapport-sectie">
        <p className="rapport-sectiekop font-pdf-display">{t.insights.vormTitle}</p>
        {f.vorm ? (
          <Melding tekst={t.insights.bronFout} />
        ) : (
          <>
            {/* W/G/V-badges (meest recent links) in dezelfde vaste
                groen/amber/rood-familie als de wedstrijdselectie-poster; de
                leesbare telregel eronder blijft staan. */}
            {vormItems.length > 0 && (
              <div className="rapport-vorm-badges" aria-hidden="true">
                {vormItems.map((item) => (
                  <span key={item.id} className={`rapport-vorm-badge rapport-vorm-badge-${item.result} font-pdf-display`}>
                    {vormLetter(t, item.result)}
                  </span>
                ))}
              </div>
            )}
            <p className="rapport-vorm">{vormRegel}</p>
          </>
        )}
      </div>

      {f.maandOpkomst && (
        <div className="rapport-sectie">
          <p className="rapport-sectiekop font-pdf-display">{t.insights.opkomstTitle}</p>
          <Melding tekst={t.insights.bronFout} />
        </div>
      )}

      {!f.maandOpkomst && metCijfer.length > 0 && (
        <div className="rapport-sectie">
          <p className="rapport-sectiekop font-pdf-display">{t.insights.opkomstTitle}</p>
          {/* Twee rijen met identieke flex-geometrie: de staven zitten in een
              vlak dat NIETS anders bevat, de bijschriften staan eronder.
              Eerder stonden staaf, waarde en maandnaam in dezelfde kolom —
              dan is een `height: 71%` een percentage van (staaf + twee
              tekstregels) en tekenen alle maanden vrijwel even hoog. Om
              dezelfde reden kan de normlijn nu wél kloppen: hij staat op
              `bottom: 85%` van precies het vlak waar de staven in staan. */}
          <div className="rapport-bars">
            {/* Label óp de normlijn — de schermgrafiek benoemt de norm al
                ("Norm 85%"), zonder label is de stippellijn op papier niet
                zelfstandig leesbaar. */}
            <span className="rapport-norm" style={{ bottom: `${OPKOMST_DOEL}%` }}>
              <span className="rapport-norm-label">{OPKOMST_DOEL}%</span>
            </span>
            {metCijfer.map((m) => (
              <span key={m.maand} className="rapport-bar-kolom">
                <span
                  className={m.percentage < OPKOMST_DOEL ? 'rapport-bar rapport-bar-onder' : 'rapport-bar'}
                  style={{ height: `${m.percentage}%` }}
                />
              </span>
            ))}
          </div>
          <div className="rapport-bar-labels">
            {metCijfer.map((m) => (
              <span key={m.maand} className="rapport-bar-kolom">
                <span className="rapport-bar-waarde">{m.percentage}%</span>
                <span className="rapport-bar-label">{maandLabel(m.maand, t.browserLocale)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rapport-kolommen">
        <div className="rapport-sectie">
          <p className="rapport-sectiekop font-pdf-display">{t.insights.topWorstRatingsTitle}</p>
          {f.ratingPerSpeler ? (
            <Melding tekst={t.insights.bronFout} />
          ) : (
            <>
              <SpelerLijst
                titel={t.insights.bestLabel}
                rijen={ratingTopWorst.top.map((r) => ({
                  id: `top-${r.player_id}`,
                  naam: r.naam,
                  waarde: t.insights.topWorstRatingsWaarde
                    .replace('{gemiddelde}', (Math.round(r.gemiddelde * 10) / 10).toFixed(1))
                    .replace('{aantal}', String(r.aantal)),
                }))}
              />
              <SpelerLijst
                titel={t.insights.worstLabel}
                rijen={ratingTopWorst.worst.map((r) => ({
                  id: `worst-${r.player_id}`,
                  naam: r.naam,
                  waarde: t.insights.topWorstRatingsWaarde
                    .replace('{gemiddelde}', (Math.round(r.gemiddelde * 10) / 10).toFixed(1))
                    .replace('{aantal}', String(r.aantal)),
                }))}
              />
            </>
          )}
        </div>

        <div className="rapport-sectie">
          <p className="rapport-sectiekop font-pdf-display">{t.insights.topWorstAanwezigheidTitle}</p>
          {f.aanwezigheidPerSpeler ? (
            <Melding tekst={t.insights.bronFout} />
          ) : (
            <>
              <SpelerLijst
                titel={t.insights.bestLabel}
                rijen={aanwezigheidTopWorst.top.map((r) => ({
                  id: `atop-${r.player_id}`,
                  naam: r.naam,
                  waarde: t.insights.topWorstAanwezigheidWaarde
                    .replace('{percentage}', String(r.percentage))
                    .replace('{aanwezig}', String(r.aanwezig))
                    .replace('{totaal}', String(r.aanwezig + r.afwezig)),
                }))}
              />
              <SpelerLijst
                titel={t.insights.worstLabel}
                rijen={aanwezigheidTopWorst.worst.map((r) => ({
                  id: `aworst-${r.player_id}`,
                  naam: r.naam,
                  waarde: t.insights.topWorstAanwezigheidWaarde
                    .replace('{percentage}', String(r.percentage))
                    .replace('{aanwezig}', String(r.aanwezig))
                    .replace('{totaal}', String(r.aanwezig + r.afwezig)),
                }))}
              />
            </>
          )}
        </div>
      </div>

      <div className="rapport-voet">
        <span>{teamName}</span>
        {generatedOn && <span className="rapport-voet-datum">{generatedOn}</span>}
        <span className="rapport-voet-merk">
          {/* Decoratief (alt="" + aria-hidden): de merknaam staat er als
              tekst direct naast. Zo blijft de a11y-boom van /inzichten
              beperkt tot de grafieken met aria-label. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- print-only blok, zelfde afweging als de poster-footer (MatchSquadPrintList.tsx): een gewone <img> rendert synchroon bij afdrukken */}
          <img src="/logo.png" alt="" aria-hidden="true" />
          {t.matchSquad.footerGenerated}
        </span>
      </div>
    </div>
  )
}
