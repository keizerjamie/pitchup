import type { Dict } from '@/messages/nl'
import {
  OPKOMST_DOEL,
  type MaandOpkomst,
  type MaandTrend,
  type RatingTrend,
  type ThuisUitTotaal,
} from '@/lib/inzichten'
import { kpiTegels, type KpiFout, type KpiTegel } from '@/lib/kpi-tekst'

// De conclusie-laag boven de grafieken: zes cijfers die zeggen hoe het
// ervoor staat, niet alleen wát er is. Elke tegel draagt drie dingen die de
// losse grafieken niet hebben — een groot getal, een oordeel (de kleurrail) en
// een vergelijking (de deltaregel).
//
// Server component: geen 'use client', geen state, geen recharts. De sparkline
// is een handgeschreven <polyline>, precies omdat één trendlijntje van zes
// punten geen chart-library rechtvaardigt — zelfde afweging als VormChart.tsx.
//
// Per tegel staat het venster erbij (vensterlabel): trainingsopkomst kijkt naar
// de laatste maand, de rest naar de gekozen periode. Een falende bron toont
// `bronFout`, een afgekapte uitslagenbron `afgekapt` — nooit een gedeeltelijk
// cijfer, nooit 0 of "—" in plaats van een fout.
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

function deltaToon(delta: number | null): Toon {
  if (delta === null || delta === 0) return 'neutraal'
  return delta > 0 ? 'goed' : 'letop'
}

function Sparkline({ waarden, kleur }: { waarden: number[]; kleur: string }) {
  // Pas vanaf drie punten is het een trend. Met twee punten (bv. vroeg in het
  // seizoen) was het één schuin streepje dat op de iPhone als los lijntje in
  // de hoek van de kaart oogde (designronde 3); de deltaregel zegt dan al
  // hetzelfde in tekst.
  if (waarden.length < 3) return null
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
  tegel,
  detailToon = 'neutraal',
  toon,
  sparkline,
}: {
  tegel: KpiTegel
  detailToon?: Toon
  toon: Toon
  sparkline?: number[]
}) {
  const { id, label, venster, waarde, detail, melding } = tegel
  // Bij een fout of afgekapte bron is er geen oordeel en geen trend: rail
  // neutraal, geen sparkline.
  const heeftMelding = melding !== undefined
  const railToon: Toon = heeftMelding ? 'neutraal' : toon
  return (
    <div data-kpi={id} className="surface-card relative overflow-hidden px-4 py-3.5">
      {/* Kleurrail links: het oordeel is af te lezen vóórdat je het cijfer
          leest. Bewust een rail en geen gekleurd vlak — een vol vlak zou de
          zes tegels tot een stoplicht maken. */}
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: TOON_KLEUR[railToon] }} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.09em] text-faint">{label}</p>
        {sparkline && !heeftMelding && <Sparkline waarden={sparkline} kleur={TOON_KLEUR[railToon]} />}
      </div>
      {/* Zuster van de kopregel, niet erin: de pariteitstest haalt de tegel op
          via het label-element en leest dan de kopregel als directe ouder. */}
      <p className="text-[10px] font-semibold text-faint mt-0.5">{venster}</p>
      {heeftMelding ? (
        <p className="text-[12px] text-faint leading-snug mt-1.5">{melding}</p>
      ) : (
        <>
          <p className="font-display text-[30px] font-bold leading-none tracking-tight text-ink mt-1.5 tabular-nums">{waarde}</p>
          <p className="text-[11px] font-bold mt-1" style={{ color: TOON_KLEUR[detailToon] }}>{detail}</p>
        </>
      )}
    </div>
  )
}

export default function KpiStrip({
  opkomst,
  maanden,
  aanwezigheidPercentage,
  rating,
  resultaat,
  uitslagenAfgekapt,
  periodeLabel,
  fout,
  t,
}: {
  opkomst: MaandTrend | null
  maanden: MaandOpkomst[]
  aanwezigheidPercentage: number | null
  rating: RatingTrend | null
  resultaat: ThuisUitTotaal
  uitslagenAfgekapt: boolean
  periodeLabel: string
  fout: KpiFout
  t: Dict
}) {
  // Alle tekst (waarde, detail, venster, melding) komt uit lib/kpi-tekst.ts,
  // zodat het seizoensrapport exact dezelfde tekst toont. Hier blijven alleen
  // toon, rail en sparkline.
  const tegels = kpiTegels(
    {
      opkomst,
      aanwezigheidPercentage,
      rating,
      saldo: resultaat,
      resultaat,
      uitslagenAfgekapt,
      periodeLabel,
      fout,
    },
    t,
  )
  const saldo = resultaat

  const reeks = maanden
    .filter((m): m is MaandOpkomst & { percentage: number } => m.percentage !== null)
    .map((m) => m.percentage)

  return (
    <div data-conclusielaag="kpi" className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      <Kpi
        tegel={tegels.opkomst}
        detailToon={opkomst === null ? 'neutraal' : deltaToon(opkomst.delta)}
        toon={opkomstToon(opkomst?.percentage ?? null)}
        sparkline={reeks}
      />
      <Kpi tegel={tegels.aanwezigheid} toon={opkomstToon(aanwezigheidPercentage)} />
      <Kpi
        tegel={tegels.rating}
        detailToon={rating === null ? 'neutraal' : deltaToon(rating.delta)}
        toon={rating === null ? 'neutraal' : deltaToon(rating.delta)}
      />
      <Kpi
        tegel={tegels.doelsaldo}
        toon={saldo.wedstrijden === 0 ? 'neutraal' : saldo.saldo > 0 ? 'goed' : saldo.saldo < 0 ? 'letop' : 'neutraal'}
      />
      {/* De twee nieuwe tegels zijn bewust neutraal: de story vraagt om
          cijfers, niet om een oordeel over punten of clean sheets. */}
      <Kpi tegel={tegels.punten} toon="neutraal" />
      <Kpi tegel={tegels.cleansheets} toon="neutraal" />
    </div>
  )
}
