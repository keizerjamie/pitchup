import type { Dict } from '@/messages/nl'
import type { ThuisUitSplitsing } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'
import { ResultaatKoppen, ResultaatCellen } from './ResultaatTabel'

// Thuis / uit / [onbekend] / totaal als semantische tabel — geen grafiek: het
// zijn weinig, exacte cijfers. Bewust geen percentages (eerlijk bij ≤1
// wedstrijd); alleen "n van totaal" voor clean sheets en niet-scoren.
export default function ThuisUitKaart({
  data,
  fout,
  afgekapt,
  t,
}: {
  data: ThuisUitSplitsing
  fout: boolean
  afgekapt: boolean
  t: Dict
}) {
  const i = t.insights
  const leeg = data.totaal.wedstrijden === 0

  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (afgekapt) empty = <InsightEmpty text={i.afgekapt} />
  else if (leeg) empty = <InsightEmpty icon="scoreboard" text={i.thuisUitEmpty} />

  const rijen: [string, typeof data.thuis][] = [
    [i.thuisLabel, data.thuis],
    [i.uitLabel, data.uit],
  ]
  if (data.onbekend) rijen.push([i.onbekendLabel, data.onbekend])

  return (
    <InsightCard title={i.thuisUitTitle} description={i.thuisUitDescription} empty={empty}>
      <div className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <ResultaatKoppen eersteKolom={i.locatieKolom} t={t} />
            <tbody>
              {rijen.map(([label, groep]) => (
                <tr key={label} style={{ borderTop: '1px solid var(--border-soft)' }}>
                  <th scope="row" className="text-left py-1.5 pr-3 font-semibold text-ink">{label}</th>
                  <ResultaatCellen groep={groep} />
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid var(--border-soft)' }}>
                <th scope="row" className="text-left py-1.5 pr-3 font-bold text-ink">{i.totaalLabel}</th>
                <ResultaatCellen groep={data.totaal} />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-1 text-xs font-semibold text-faint">
          <p>{i.cleanSheets.replace('{n}', String(data.totaal.cleanSheets)).replace('{totaal}', String(data.totaal.wedstrijden))}</p>
          <p>{i.zonderEigenDoelpunt.replace('{n}', String(data.totaal.zonderEigenDoelpunt)).replace('{totaal}', String(data.totaal.wedstrijden))}</p>
        </div>
      </div>
    </InsightCard>
  )
}
