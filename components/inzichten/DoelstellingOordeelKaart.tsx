import type { Dict } from '@/messages/nl'
import type { EvaluatieOverzicht } from '@/lib/inzichten'
import { formatDateShort } from '@/lib/utils'
import InsightCard, { InsightEmpty } from './InsightCard'

// Oordeel van de trainer over de doelstelling: alleen aantallen (ja / deels /
// nee / zonder oordeel) per periode en per week, in een tabel. Bewust geen
// grafiek, geen kleur per keuze en geen meter: dat zou een oordeelskleur
// suggereren. "Zonder oordeel" telt nooit als nee.
//
// Volgorde van de staten: fout → afgekapt → geen trainingen → geen
// doelstellingen en geen oordeel → inhoud.
export default function DoelstellingOordeelKaart({
  data,
  fout,
  t,
}: {
  data: EvaluatieOverzicht
  fout: boolean
  t: Dict
}) {
  const i = t.insights
  const { totaal } = data
  const heeftOordeel = totaal.ja + totaal.deels + totaal.nee > 0
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (data.afgekaptEvaluaties) empty = <InsightEmpty text={i.afgekaptTraining} />
  else if (!data.heeftTrainingen) empty = <InsightEmpty icon="check_circle" text={i.oordeelEmpty} />
  else if (totaal.metDoelstelling === 0 && !heeftOordeel) {
    empty = <InsightEmpty icon="check_circle" text={i.oordeelGeenDoelstellingen} />
  }

  const samenvatting: Array<[string, number]> = [
    [i.kolomJa, totaal.ja],
    [i.kolomDeels, totaal.deels],
    [i.kolomNee, totaal.nee],
    [i.kolomZonderOordeel, totaal.metDoelstellingZonderOordeel],
  ]

  return (
    <InsightCard title={i.oordeelTitle} description={i.oordeelDescription} empty={empty}>
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-4 gap-2">
          {samenvatting.map(([naam, aantal]) => (
            <div key={naam}>
              <dt className="text-xs font-bold text-muted">{naam}</dt>
              <dd className="font-display text-[20px] tabular-nums text-ink">{aantal}</dd>
            </div>
          ))}
        </dl>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-bold text-muted">
                <th scope="col" className="sticky left-0 bg-surface text-left py-1.5 pr-3 whitespace-nowrap">{i.kolomWeek}</th>
                <th scope="col" className="text-left py-1.5 px-2 whitespace-nowrap">{i.kolomJa}</th>
                <th scope="col" className="text-left py-1.5 px-2 whitespace-nowrap">{i.kolomDeels}</th>
                <th scope="col" className="text-left py-1.5 px-2 whitespace-nowrap">{i.kolomNee}</th>
                <th scope="col" className="text-left py-1.5 pl-3 whitespace-nowrap">{i.kolomZonderOordeel}</th>
              </tr>
            </thead>
            <tbody>
              {data.weken.map((w) => {
                const deelweek = w.deelweekBegin || w.deelweekEind
                const leeg = w.trainingen === 0
                const cel = (n: number) => (leeg ? i.geenGegevens : n)
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
                    <td className="py-2 px-2 text-ink font-semibold tabular-nums whitespace-nowrap">{cel(w.ja)}</td>
                    <td className="py-2 px-2 text-ink font-semibold tabular-nums whitespace-nowrap">{cel(w.deels)}</td>
                    <td className="py-2 px-2 text-ink font-semibold tabular-nums whitespace-nowrap">{cel(w.nee)}</td>
                    <td className="py-2 pl-3 text-ink font-semibold tabular-nums whitespace-nowrap">{cel(w.metDoelstellingZonderOordeel)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-1 text-[12.5px] text-faint">
          <p>{i.oordeelZonderUitleg}</p>
        </div>
      </div>
    </InsightCard>
  )
}
