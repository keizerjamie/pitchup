import type { Dict } from '@/messages/nl'
import type { ZelfreviewOverzicht, ZelfreviewWeek } from '@/lib/inzichten'
import { ZELFREVIEW_STELLINGEN, ZELFREVIEW_SCORE_MAX, ZELFREVIEW_SCORE_MIN, type ZelfreviewStelling } from '@/lib/trainer-zelfreview'
import { formatDateShort } from '@/lib/utils'
import InsightCard, { InsightEmpty } from './InsightCard'

// Eigen ontwikkeling als trainer: het gemiddelde van de eigen zelfreviews per
// week als lijn met punten (weektotaal, schaal 1-5) en daaronder een weektabel
// met de vijf stellingen. Privé: de pagina toont deze kaart alleen aan de
// trainer zelf en hij staat niet in het seizoensrapport. Geen legenda, geen
// tooltip, geen norm of kleuralarm; de tabel is de waardenweergave.
//
// Volgorde van de staten: fout → afgekapt → te weinig reviews → inhoud.

const HOOGTE = 140
const PAD_BOVEN = 10
const PAD_ONDER = 10
const RASTER = [5, 3, 1]
// Minimale breedte per week zodat punten (8px) niet over elkaar vallen; bij
// veel weken scrolt de grafiek horizontaal.
const MIN_BREEDTE_PER_WEEK = 14

const yVoor = (score: number) =>
  PAD_BOVEN + ((ZELFREVIEW_SCORE_MAX - score) / (ZELFREVIEW_SCORE_MAX - ZELFREVIEW_SCORE_MIN)) * (HOOGTE - PAD_BOVEN - PAD_ONDER)

const xVoor = (index: number, aantal: number) => `${((index + 0.5) / aantal) * 100}%`

function Lijn({ weken }: { weken: ZelfreviewWeek[] }) {
  const n = weken.length
  const segmenten: React.ReactNode[] = []
  for (let i = 0; i < n - 1; i++) {
    const a = weken[i].totaal
    const b = weken[i + 1].totaal
    // Onderbroken bij een lege week: alleen aansluitende weken verbinden.
    if (a === null || b === null) continue
    segmenten.push(
      <line
        key={weken[i].maandag}
        x1={xVoor(i, n)} y1={yVoor(a)} x2={xVoor(i + 1, n)} y2={yVoor(b)}
        stroke="var(--brand-accent)" strokeWidth={2} strokeLinecap="round"
      />,
    )
  }
  return (
    <>
      {segmenten}
      {weken.map((w, i) =>
        w.totaal === null ? null : (
          <circle
            key={w.maandag}
            cx={xVoor(i, n)} cy={yVoor(w.totaal)} r={4}
            fill="var(--brand-accent)"
            opacity={w.deelweekBegin || w.deelweekEind ? 0.5 : 1}
          />
        ),
      )}
    </>
  )
}

export default function ZelfreviewKaart({
  data,
  fout,
  t,
}: {
  data: ZelfreviewOverzicht
  fout: boolean
  t: Dict
}) {
  const i = t.insights
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (data.afgekapt) empty = <InsightEmpty text={i.afgekaptTraining} />
  else if (!data.genoegVoorTrend) {
    empty = <InsightEmpty icon="assignment" text={i.zelfreviewTeWeinig.replace('{n}', String(data.aantalReviews))} />
  }

  const getal = new Intl.NumberFormat(t.browserLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const toon = (v: number | null) => (v === null ? i.geenGegevens : getal.format(v))
  const kolommen = i.zelfreviewKolommen as Record<ZelfreviewStelling, string>

  // Tabel: alleen weken met minstens één review, nieuwste eerst.
  const rijen = data.weken.filter((w) => w.aantal > 0).reverse()
  const minBreedte = data.weken.length * MIN_BREEDTE_PER_WEEK

  return (
    <InsightCard title={i.zelfreviewTitle} description={i.zelfreviewDescription} empty={empty}>
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <div aria-hidden="true" className="relative flex-shrink-0 w-4 text-[11px] text-faint tabular-nums" style={{ height: HOOGTE }}>
            {RASTER.map((score) => (
              <span key={score} className="absolute right-0 -translate-y-1/2 leading-none" style={{ top: yVoor(score) }}>
                {score}
              </span>
            ))}
          </div>
          <div className="flex-1 min-w-0 overflow-x-auto">
            <svg
              role="img"
              aria-label={i.zelfreviewGrafiekLabel.replace('{n}', String(data.weken.length))}
              width="100%"
              height={HOOGTE}
              style={{ minWidth: minBreedte, display: 'block' }}
            >
              {RASTER.map((score) => (
                <line key={score} x1="0" x2="100%" y1={yVoor(score)} y2={yVoor(score)} stroke="var(--track)" strokeWidth={1} />
              ))}
              <Lijn weken={data.weken} />
            </svg>
          </div>
        </div>

        {rijen.length === 0 ? (
          <p className="text-sm font-semibold text-faint">{i.geenGegevens}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-bold text-muted">
                  <th scope="col" className="sticky left-0 bg-surface text-left py-1.5 pr-3 whitespace-nowrap">{i.kolomWeek}</th>
                  {ZELFREVIEW_STELLINGEN.map((s) => (
                    <th key={s} scope="col" className="text-left py-1.5 px-2 whitespace-nowrap">{kolommen[s]}</th>
                  ))}
                  <th scope="col" className="text-left py-1.5 pl-3 whitespace-nowrap">{i.zelfreviewKolomTotaal}</th>
                </tr>
              </thead>
              <tbody>
                {rijen.map((w) => {
                  const deelweek = w.deelweekBegin || w.deelweekEind
                  return (
                    <tr key={w.maandag}>
                      <th scope="row" className="sticky left-0 bg-surface py-2 pr-3 text-left font-semibold text-ink whitespace-nowrap">
                        {i.weekLabel
                          .replace('{week}', String(w.isoWeek))
                          .replace('{datum}', formatDateShort(w.maandag, t.browserLocale))}
                        {deelweek && (
                          <span className="ml-2 text-[11px] font-bold text-faint rounded-full px-2 py-0.5 bg-surface-sunken">
                            {i.deelweekLabel}
                          </span>
                        )}
                      </th>
                      {ZELFREVIEW_STELLINGEN.map((s) => (
                        <td key={s} className="py-2 px-2 text-ink font-semibold tabular-nums whitespace-nowrap">{toon(w.gemiddelde[s])}</td>
                      ))}
                      <td className="py-2 pl-3 text-ink font-semibold tabular-nums whitespace-nowrap">{toon(w.totaal)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-col gap-1 text-[12.5px] text-faint">
          <p>{i.zelfreviewPrive}</p>
          <p>{i.zelfreviewVolgendeDag}</p>
        </div>
      </div>
    </InsightCard>
  )
}
