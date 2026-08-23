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
  type TopWorst,
  type VormTelling,
} from '@/lib/inzichten'
import { vulSignaalIn } from '@/lib/signaal-tekst'
import TeamLogo from '@/components/TeamLogo'

// Print-only seizoensrapport (dual-markup-patroon, zie MatchSquadPrintList.tsx
// en AttendanceSummary.tsx): één A4 dat een trainer kan meenemen naar een
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

function Kpi({ label, waarde, detail }: { label: string; waarde: string; detail: string }) {
  return (
    <div className="rapport-kpi">
      <p className="rapport-kpi-label">{label}</p>
      <p className="rapport-kpi-waarde font-pdf-display">{waarde}</p>
      <p className="rapport-kpi-detail">{detail}</p>
    </div>
  )
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
  primaryColor: string
  secondaryColor: string
}) {
  const metCijfer = maanden.filter((m): m is MaandOpkomst & { percentage: number } => m.percentage !== null)

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
        <Kpi
          label={t.insights.kpiOpkomstLabel}
          waarde={opkomst === null ? '—' : `${opkomst.percentage}%`}
          detail={t.insights.kpiOpkomstDoel.replace('{doel}', String(OPKOMST_DOEL))}
        />
        <Kpi
          label={t.insights.kpiAanwezigheidLabel}
          waarde={aanwezigheidPercentage === null ? '—' : `${aanwezigheidPercentage}%`}
          detail={t.insights.kpiOpkomstDoel.replace('{doel}', String(OPKOMST_DOEL))}
        />
        <Kpi
          label={t.insights.kpiRatingLabel}
          waarde={rating === null ? '—' : (Math.round(rating.gemiddelde * 10) / 10).toFixed(1)}
          detail={rating === null ? t.insights.kpiGeenData : t.insights.kpiRatingDetail.replace('{n}', String(rating.aantal))}
        />
        <Kpi
          label={t.insights.kpiDoelsaldoLabel}
          waarde={saldo.wedstrijden === 0 ? '—' : saldo.saldo > 0 ? `+${saldo.saldo}` : String(saldo.saldo)}
          detail={
            saldo.wedstrijden === 0
              ? t.insights.kpiGeenData
              : t.insights.kpiDoelsaldoDetail.replace('{voor}', String(saldo.voor)).replace('{tegen}', String(saldo.tegen))
          }
        />
      </div>

      {signalen.length > 0 && (
        <div className="rapport-sectie">
          <p className="rapport-sectiekop font-pdf-display">{t.insights.signalenTitle}</p>
          {signalen.map((s) => (
            <p key={s.id} className="rapport-signaal">
              {vulSignaalIn(t, s)}
            </p>
          ))}
        </div>
      )}

      {metCijfer.length > 0 && (
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
            <span className="rapport-norm" style={{ bottom: `${OPKOMST_DOEL}%` }} />
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
        </div>

        <div className="rapport-sectie">
          <p className="rapport-sectiekop font-pdf-display">{t.insights.topWorstAanwezigheidTitle}</p>
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
        </div>
      </div>

      <div className="rapport-sectie">
        <p className="rapport-sectiekop font-pdf-display">{t.insights.vormTitle}</p>
        <p className="rapport-vorm">{vormRegel}</p>
      </div>

      <div className="rapport-voet">
        <span>{teamName}</span>
        <span className="rapport-voet-merk">{t.matchSquad.footerGenerated}</span>
      </div>
    </div>
  )
}
