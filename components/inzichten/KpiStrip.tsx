import type { Dict } from '@/messages/nl'
import {
  OPKOMST_DOEL,
  RATING_TREND_VENSTER,
  type Doelsaldo,
  type MaandOpkomst,
  type MaandTrend,
  type RatingTrend,
} from '@/lib/inzichten'

// De conclusie-laag boven de grafieken: vier cijfers die zeggen hoe het
// ervoor staat, niet alleen wát er is. Elke tegel draagt drie dingen die de
// losse grafieken niet hebben — een groot getal, een oordeel (de kleurrail) en
// een vergelijking (de deltaregel).
//
// Server component: geen 'use client', geen state, geen recharts. De sparkline
// is een handgeschreven <polyline>, precies omdat één trendlijntje van zes
// punten geen chart-library rechtvaardigt — zelfde afweging als VormChart.tsx.
//
// Alle cijfers komen uit rijen die de pagina toch al ophaalt; deze strook
// veroorzaakt geen enkele extra query.

type Toon = 'goed' | 'letop' | 'zorg' | 'neutraal'

// Kleuren als var(--token), nooit als hex: zo bewegen ze mee met dark mode én
// met het print-blok dat die tokens terugzet naar hun lichte waarde.
const TOON_KLEUR: Record<Toon, string> = {
  goed: 'var(--brand-accent)',
  letop: 'var(--warning-text)',
  zorg: 'var(--chip-red-fg)',
  neutraal: 'var(--faint)',
}

// Onder de norm is het een aandachtspunt, ver eronder een zorg. De tweede
// grens (70) is bewust ruim onder OPKOMST_DOEL: het verschil tussen "net niet"
// en "structureel te laag" hoort zichtbaar te zijn, anders staat de hele
// pagina permanent op rood zodra een team één maand tegenzit.
function opkomstToon(percentage: number | null): Toon {
  if (percentage === null) return 'neutraal'
  if (percentage >= OPKOMST_DOEL) return 'goed'
  if (percentage >= 70) return 'letop'
  return 'zorg'
}

// Deltaregel met expliciet teken. `+0` bestaat niet: exact gelijk is neutraal.
function tekenTekst(delta: number, decimalen = 0): string {
  const afgerond = decimalen > 0 ? delta.toFixed(decimalen) : String(Math.round(delta))
  return delta > 0 ? `+${afgerond}` : afgerond
}

function deltaToon(delta: number | null): Toon {
  if (delta === null || delta === 0) return 'neutraal'
  return delta > 0 ? 'goed' : 'letop'
}

function Sparkline({ waarden, kleur }: { waarden: number[]; kleur: string }) {
  // Onder de twee punten is er geen lijn te trekken; dan tekent dit niets in
  // plaats van een misleidend horizontaal streepje.
  if (waarden.length < 2) return null
  const breedte = 52
  const hoogte = 20
  const min = Math.min(...waarden)
  const max = Math.max(...waarden)
  // Vlakke reeks (alle waarden gelijk): deel niet door nul, teken de lijn in
  // het midden.
  const bereik = max - min || 1
  const punten = waarden
    .map((v, i) => {
      const x = (i / (waarden.length - 1)) * (breedte - 2) + 1
      const y = hoogte - 2 - ((v - min) / bereik) * (hoogte - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const laatste = punten.split(' ').slice(-1)[0].split(',')
  return (
    // aria-hidden: de sparkline herhaalt puur visueel wat het getal en de
    // deltaregel ernaast al in tekst zeggen.
    <svg width={breedte} height={hoogte} viewBox={`0 0 ${breedte} ${hoogte}`} aria-hidden="true" className="flex-shrink-0">
      <polyline points={punten} fill="none" stroke={kleur} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={laatste[0]} cy={laatste[1]} r={2.4} fill={kleur} />
    </svg>
  )
}

function Kpi({
  label,
  waarde,
  detail,
  detailToon = 'neutraal',
  toon,
  sparkline,
}: {
  label: string
  waarde: string
  detail: string
  detailToon?: Toon
  toon: Toon
  sparkline?: number[]
}) {
  return (
    <div className="surface-card relative overflow-hidden px-4 py-3.5">
      {/* Kleurrail links: het oordeel is af te lezen vóórdat je het cijfer
          leest. Bewust een rail en geen gekleurd vlak — een vol vlak zou de
          vier tegels tot een stoplicht maken. */}
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: TOON_KLEUR[toon] }} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.09em] text-faint">{label}</p>
        {sparkline && <Sparkline waarden={sparkline} kleur={TOON_KLEUR[toon]} />}
      </div>
      <p className="font-display text-[30px] font-bold leading-none tracking-tight text-ink mt-1.5 tabular-nums">{waarde}</p>
      <p className="text-[11px] font-bold mt-1" style={{ color: TOON_KLEUR[detailToon] }}>{detail}</p>
    </div>
  )
}

export default function KpiStrip({
  opkomst,
  maanden,
  aanwezigheidPercentage,
  rating,
  saldo,
  t,
}: {
  opkomst: MaandTrend | null
  maanden: MaandOpkomst[]
  aanwezigheidPercentage: number | null
  rating: RatingTrend | null
  saldo: Doelsaldo
  t: Dict
}) {
  const reeks = maanden
    .filter((m): m is MaandOpkomst & { percentage: number } => m.percentage !== null)
    .map((m) => m.percentage)

  const opkomstDetail =
    opkomst === null
      ? t.insights.kpiGeenData
      : opkomst.delta === null
        ? t.insights.kpiGeenVergelijking
        : t.insights.kpiDeltaMaand.replace('{delta}', tekenTekst(opkomst.delta))

  const ratingDetail =
    rating === null
      ? t.insights.kpiGeenData
      : rating.delta === null
        ? t.insights.kpiRatingDetail.replace('{n}', String(rating.aantal))
        : t.insights.kpiDeltaRating
            .replace('{delta}', tekenTekst(rating.delta, 1))
            .replace('{venster}', String(RATING_TREND_VENSTER))

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Kpi
        label={t.insights.kpiOpkomstLabel}
        waarde={opkomst === null ? '—' : `${opkomst.percentage}%`}
        detail={opkomstDetail}
        detailToon={opkomst === null ? 'neutraal' : deltaToon(opkomst.delta)}
        toon={opkomstToon(opkomst?.percentage ?? null)}
        sparkline={reeks}
      />
      <Kpi
        label={t.insights.kpiAanwezigheidLabel}
        waarde={aanwezigheidPercentage === null ? '—' : `${aanwezigheidPercentage}%`}
        detail={t.insights.kpiOpkomstDoel.replace('{doel}', String(OPKOMST_DOEL))}
        toon={opkomstToon(aanwezigheidPercentage)}
      />
      <Kpi
        label={t.insights.kpiRatingLabel}
        // Eén decimaal, zelfde afronding als TopWorstRatings/RatingsChart —
        // hetzelfde gemiddelde mag nergens op de pagina anders staan.
        waarde={rating === null ? '—' : (Math.round(rating.gemiddelde * 10) / 10).toFixed(1)}
        detail={ratingDetail}
        detailToon={rating === null ? 'neutraal' : deltaToon(rating.delta)}
        toon={rating === null ? 'neutraal' : deltaToon(rating.delta)}
      />
      <Kpi
        label={t.insights.kpiDoelsaldoLabel}
        waarde={saldo.wedstrijden === 0 ? '—' : tekenTekst(saldo.saldo)}
        detail={
          saldo.wedstrijden === 0
            ? t.insights.kpiGeenData
            : t.insights.kpiDoelsaldoDetail
                .replace('{voor}', String(saldo.voor))
                .replace('{tegen}', String(saldo.tegen))
        }
        toon={saldo.wedstrijden === 0 ? 'neutraal' : saldo.saldo > 0 ? 'goed' : saldo.saldo < 0 ? 'letop' : 'neutraal'}
      />
    </div>
  )
}
