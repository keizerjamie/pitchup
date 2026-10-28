import type { Dict } from '@/messages/nl'
import type { OnderdeelVoortgang, PeriodiseringVoortgang, StapPunt } from '@/lib/inzichten'
import { formatDateShort } from '@/lib/utils'
import InsightCard, { InsightEmpty } from './InsightCard'

// Periodisering: voortgang per meetbaar onderdeel. Per onderdeel de nulmeting
// (eerste meting ooit), de huidige stap (stand t/m gisteren) en het verschil in
// stappen, met een staplijn van de punten en een <details> als tekstvariant.
// Een ongemeten onderdeel toont "nog niet gemeten", nooit 0. Geen drempels,
// geen oordeelskleur: een stap boven het maximum wordt getoond zoals hij is.
//
// Volgorde van de staten: fout → afgekapt (eigen tekst) → niets gemeten →
// seizoen nog niet begonnen (tabel zonder staplijn/details + uitleg) → inhoud.

const BREEDTE = 120
const HOOGTE = 24
const RAND = 6 // ruimte voor de markers (r = 4 → 8px)

function dagMs(datum: string): number {
  return Date.parse(`${datum}T00:00:00Z`)
}

// Step-after-pad: de stap blijft staan tot het volgende punt. Bij één punt
// geen lijn. Alleen meetpunten krijgen een marker.
function Staplijn({ punten }: { punten: StapPunt[] }) {
  const stappen = punten.map((p) => p.stap)
  const minStap = Math.min(...stappen)
  const maxStap = Math.max(...stappen)
  const t0 = dagMs(punten[0].datum)
  const t1 = dagMs(punten[punten.length - 1].datum)
  const x = (datum: string) =>
    t1 === t0 ? BREEDTE / 2 : RAND + ((dagMs(datum) - t0) / (t1 - t0)) * (BREEDTE - 2 * RAND)
  const y = (stap: number) =>
    maxStap === minStap ? HOOGTE / 2 : HOOGTE - RAND - ((stap - minStap) / (maxStap - minStap)) * (HOOGTE - 2 * RAND)

  let pad = ''
  if (punten.length > 1) {
    pad = `M ${x(punten[0].datum)} ${y(punten[0].stap)}`
    for (let n = 1; n < punten.length; n++) {
      pad += ` H ${x(punten[n].datum)} V ${y(punten[n].stap)}`
    }
  }

  return (
    <svg aria-hidden="true" width={BREEDTE} height={HOOGTE} viewBox={`0 0 ${BREEDTE} ${HOOGTE}`} className="block">
      {pad && (
        <path d={pad} fill="none" stroke="var(--brand-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      )}
      {punten.map((p, n) =>
        p.bron === 'meting' ? (
          <circle
            key={`${p.datum}-${n}`}
            cx={x(p.datum)}
            cy={y(p.stap)}
            r={4}
            fill="var(--surface)"
            stroke="var(--brand-accent)"
            strokeWidth={2}
          />
        ) : null,
      )}
    </svg>
  )
}

function bronTekst(p: StapPunt, i: Dict['insights']): string {
  if (p.bron === 'meting') return i.bronMeting
  return p.handmatig ? i.bronHandmatig : i.bronTraining
}

function verschilTekst(v: number): string {
  if (v > 0) return `+${v}`
  if (v < 0) return `−${Math.abs(v)}`
  return '0'
}

function Onderdeel({ o, t, toonReeks }: { o: OnderdeelVoortgang; t: Dict; toonReeks: boolean }) {
  const i = t.insights
  const naam = t.periodization.categories[o.key]
  if (!o.gemeten) {
    return (
      <tbody>
        <tr>
          <th scope="row" className="py-2 pr-3 text-left align-top font-semibold text-ink">{naam}</th>
          <td colSpan={3} className="py-2 pl-3 align-top text-faint">{i.periodiseringNietGemeten}</td>
        </tr>
      </tbody>
    )
  }
  return (
    <tbody>
      <tr>
        <th scope="row" className="pt-2 pr-3 text-left align-top font-semibold text-ink">{naam}</th>
        <td className="pt-2 pl-3 align-top text-ink font-semibold tabular-nums whitespace-nowrap">
          {o.nulmeting
            ? i.nulmetingWaarde
                .replace('{stap}', String(o.nulmeting.stap))
                .replace('{datum}', formatDateShort(o.nulmeting.datum, t.browserLocale))
            : i.geenGegevens}
        </td>
        <td className="pt-2 pl-3 align-top text-ink font-semibold tabular-nums whitespace-nowrap">
          {o.huidig ? (
            <>
              {i.stapWaarde.replace('{stap}', String(o.huidig.stap))}{' '}
              <span className="text-xs font-semibold text-faint">{i.maxStapWaarde.replace('{max}', String(o.maxStap))}</span>
            </>
          ) : (
            i.geenGegevens
          )}
        </td>
        <td className="pt-2 pl-3 align-top text-ink font-semibold tabular-nums">
          {o.geenVoortgang || o.verschil === null
            ? i.periodiseringGeenVoortgang
            : i.voortgangWaarde.replace('{verschil}', verschilTekst(o.verschil))}
        </td>
      </tr>
      <tr>
        <td colSpan={4} className="pb-2 pt-1">
          {toonReeks && o.punten.length > 0 && <Staplijn punten={o.punten} />}
          {toonReeks && o.punten.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs font-bold text-muted">{i.reeksBekijken}</summary>
              <table className="mt-1 text-xs">
                <thead>
                  <tr className="font-bold text-muted">
                    <th scope="col" className="text-left py-1 pr-3">{i.kolomDatum}</th>
                    <th scope="col" className="text-left py-1 pr-3">{i.kolomStap}</th>
                    <th scope="col" className="text-left py-1">{i.kolomBron}</th>
                  </tr>
                </thead>
                <tbody>
                  {o.punten.map((p, n) => (
                    <tr key={`${p.datum}-${p.bron}-${n}`}>
                      <td className="py-0.5 pr-3 text-ink tabular-nums whitespace-nowrap">{formatDateShort(p.datum, t.browserLocale)}</td>
                      <td className="py-0.5 pr-3 text-ink font-semibold tabular-nums">{p.stap}</td>
                      <td className="py-0.5 text-muted">{bronTekst(p, i)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </td>
      </tr>
    </tbody>
  )
}

export default function PeriodiseringVoortgangKaart({
  data,
  fout,
  t,
}: {
  data: PeriodiseringVoortgang
  fout: boolean
  t: Dict
}) {
  const i = t.insights
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (data.afgekapt) empty = <InsightEmpty text={i.periodiseringAfgekapt} />
  else if (!data.onderdelen.some((o) => o.gemeten)) {
    empty = <InsightEmpty icon="trending_up" text={i.periodiseringEmpty} />
  }

  return (
    <InsightCard title={i.periodiseringTitle} description={i.periodiseringDescription} empty={empty}>
      <div className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-bold text-muted">
                <th scope="col" className="text-left py-1.5 pr-3">{i.kolomOnderdeel}</th>
                <th scope="col" className="text-left py-1.5 pl-3">{i.kolomNulmeting}</th>
                <th scope="col" className="text-left py-1.5 pl-3">{i.kolomHuidigeStap}</th>
                <th scope="col" className="text-left py-1.5 pl-3">{i.kolomVoortgang}</th>
              </tr>
            </thead>
            {data.onderdelen.map((o) => (
              <Onderdeel key={o.key} o={o} t={t} toonReeks={!data.seizoenNogNietBegonnen} />
            ))}
          </table>
        </div>
        {data.seizoenNogNietBegonnen && (
          <p className="text-[12.5px] text-faint">{i.seizoenNogNietBegonnen}</p>
        )}
        {data.onbekend > 0 && (
          <p className="text-[12.5px] text-faint">{i.belastingOnbekend.replace('{n}', String(data.onbekend))}</p>
        )}
      </div>
    </InsightCard>
  )
}
