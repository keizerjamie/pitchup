import type { Dict } from '@/messages/nl'
import {
  OPKOMST_DOEL,
  maandLabel,
  RATING_TREND_VENSTER,
  type Doelsaldo,
  type MaandTrend,
  type RatingTrend,
  type ThuisUitTotaal,
} from '@/lib/inzichten'

// Eén bron voor de tekst van de zes kerncijfers. De KPI-strook op het scherm
// (KpiStrip) en het seizoensrapport (SeizoensrapportPrint) tonen exact
// dezelfde waarde-, detail-, venster- en meldingstekst; twee kopieën zouden
// uit elkaar lopen. Puur en zonder React, zoals lib/signaal-tekst.ts: de
// presentatie (rail, sparkline, kleur) blijft bij de aanroeper.

export type KpiId = 'opkomst' | 'aanwezigheid' | 'rating' | 'doelsaldo' | 'punten' | 'cleansheets'

export const KPI_VOLGORDE: readonly KpiId[] = ['opkomst', 'aanwezigheid', 'rating', 'doelsaldo', 'punten', 'cleansheets']

export interface KpiFout {
  maandOpkomst: boolean
  aanwezigheid: boolean
  teamRating: boolean
  uitslagen: boolean
}

export interface KpiTegel {
  id: KpiId
  label: string
  venster: string
  waarde: string
  detail: string
  // Fout- of afgekapt-tekst: vervangt waarde en detail.
  melding?: string
}

// Deltaregel met expliciet teken. `+0` bestaat niet: exact gelijk is neutraal.
export function tekenTekst(delta: number, decimalen = 0): string {
  const afgerond = decimalen > 0 ? delta.toFixed(decimalen) : String(Math.round(delta))
  return delta > 0 ? `+${afgerond}` : afgerond
}

// Fout gaat voor afgekapt (zoals ThuisUitKaart): een falende bron mag nooit
// als "afgekapt" of als een gedeeltelijk cijfer verschijnen.
export function bronMelding(t: Dict, fout: boolean, afgekapt = false): string | undefined {
  if (fout) return t.insights.bronFout
  if (afgekapt) return t.insights.afgekapt
  return undefined
}

export function kpiTegels(
  invoer: {
    opkomst: MaandTrend | null
    aanwezigheidPercentage: number | null
    rating: RatingTrend | null
    saldo: Doelsaldo
    // null = niet meegegeven (kaal rapportharnas): punten en clean sheets
    // tonen dan "—" in plaats van een verzonnen 0.
    resultaat: ThuisUitTotaal | null
    uitslagenAfgekapt: boolean
    periodeLabel: string
    fout: KpiFout
  },
  t: Dict,
): Record<KpiId, KpiTegel> {
  const { opkomst, aanwezigheidPercentage, rating, saldo, resultaat, uitslagenAfgekapt, periodeLabel, fout } = invoer
  const i = t.insights
  const uitslagMelding = bronMelding(t, fout.uitslagen, uitslagenAfgekapt)
  const geenUitslagen = resultaat === null || resultaat.wedstrijden === 0

  const opkomstVenster =
    opkomst === null
      ? i.kpiVensterLaatsteMaandLeeg
      : i.kpiVensterLaatsteMaand.replace('{maand}', maandLabel(opkomst.maand, t.browserLocale))

  const opkomstDetail =
    opkomst === null
      ? i.kpiGeenData
      : opkomst.delta === null
        ? i.kpiGeenVergelijking
        : i.kpiDeltaMaand.replace('{delta}', tekenTekst(opkomst.delta))

  const ratingDetail =
    rating === null
      ? i.kpiGeenData
      : rating.delta === null
        ? i.kpiRatingDetail.replace('{n}', String(rating.aantal))
        : i.kpiDeltaRating.replace('{delta}', tekenTekst(rating.delta, 1)).replace('{venster}', String(RATING_TREND_VENSTER))

  return {
    opkomst: {
      id: 'opkomst',
      label: i.kpiOpkomstLabel,
      venster: opkomstVenster,
      waarde: opkomst === null ? '—' : `${opkomst.percentage}%`,
      detail: opkomstDetail,
      melding: bronMelding(t, fout.maandOpkomst),
    },
    aanwezigheid: {
      id: 'aanwezigheid',
      label: i.kpiAanwezigheidLabel,
      venster: periodeLabel,
      waarde: aanwezigheidPercentage === null ? '—' : `${aanwezigheidPercentage}%`,
      detail: i.kpiOpkomstDoel.replace('{doel}', String(OPKOMST_DOEL)),
      melding: bronMelding(t, fout.aanwezigheid),
    },
    rating: {
      id: 'rating',
      label: i.kpiRatingLabel,
      venster: periodeLabel,
      // Eén decimaal, zelfde afronding als TopWorstRatings/RatingsChart —
      // hetzelfde gemiddelde mag nergens op de pagina anders staan.
      waarde: rating === null ? '—' : (Math.round(rating.gemiddelde * 10) / 10).toFixed(1),
      detail: ratingDetail,
      melding: bronMelding(t, fout.teamRating),
    },
    doelsaldo: {
      id: 'doelsaldo',
      label: i.kpiDoelsaldoLabel,
      venster: periodeLabel,
      waarde: saldo.wedstrijden === 0 ? '—' : tekenTekst(saldo.saldo),
      detail:
        saldo.wedstrijden === 0
          ? i.kpiGeenData
          : i.kpiDoelsaldoDetail.replace('{voor}', String(saldo.voor)).replace('{tegen}', String(saldo.tegen)),
      melding: uitslagMelding,
    },
    punten: {
      id: 'punten',
      label: i.kpiPuntenLabel,
      venster: periodeLabel,
      // Zelfde afronding als ResultaatTabel (2 decimalen).
      waarde: resultaat === null || resultaat.puntenPerWedstrijd === null ? '—' : resultaat.puntenPerWedstrijd.toFixed(2),
      detail: geenUitslagen
        ? i.kpiGeenData
        : i.kpiPuntenDetail.replace('{punten}', String(resultaat.punten)).replace('{n}', String(resultaat.wedstrijden)),
      melding: uitslagMelding,
    },
    cleansheets: {
      id: 'cleansheets',
      label: i.kpiCleanSheetsLabel,
      venster: periodeLabel,
      waarde: geenUitslagen ? '—' : String(resultaat.cleanSheets),
      detail: geenUitslagen ? i.kpiGeenData : i.kpiCleanSheetsDetail.replace('{n}', String(resultaat.wedstrijden)),
      melding: uitslagMelding,
    },
  }
}
