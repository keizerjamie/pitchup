import type { Dict } from '@/messages/nl'
import { PERIODIZATION_CATEGORIES } from '@/lib/types'
import type { BelastingOverzicht } from '@/lib/inzichten'
import { formatDateShort } from '@/lib/utils'
import InsightCard, { InsightEmpty } from './InsightCard'

// Trainingsbelasting in minuten per week: één reeks (het trainingstotaal per
// week, zoals de planner het telt) als staafjes, en daaronder een tabel week ×
// tien categorieën als tekstvariant met alle waarden. Eén tint
// (--brand-accent), geen as-getallen, geen hover-tooltip: de tabel is de
// waardenweergave. Geen KPI's, drempels of oordeelskleuren.
//
// Volgorde van de staten: fout → afgekapt → geen trainingen → inhoud. Bij
// `afgekapt` is `weken` leeg maar zijn de vlaggen wel gevuld, dus eerst
// `afgekapt` toetsen.
export default function BelastingKaart({
  data,
  fout,
  t,
}: {
  data: BelastingOverzicht
  fout: boolean
  t: Dict
}) {
  const i = t.insights
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (data.afgekapt) empty = <InsightEmpty text={i.afgekaptTraining} />
  else if (!data.heeftTrainingen) empty = <InsightEmpty icon="assignment" text={i.belastingEmpty} />

  const zonderOefeningen = data.weken.reduce((som, w) => som + w.trainingenZonderOefeningen, 0)
  const zonderDuur = data.weken.reduce((som, w) => som + w.oefeningenZonderDuur, 0)
  const onbekend = data.weken.reduce((som, w) => som + w.oefeningenOnbekend, 0)
  const totaalOnvolledig = data.weken.some((w) => w.blokkenZonderDuur > 0)

  return (
    <InsightCard title={i.belastingTitle} description={i.belastingDescription} empty={empty}>
      <div className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <div
            role="img"
            aria-label={i.belastingGrafiekLabel.replace('{n}', String(data.weken.length))}
            className="flex items-end h-24 w-full"
            style={{ gap: 2, borderBottom: '1px solid var(--track)' }}
          >
            {data.weken.map((w) => (
              <div key={w.maandag} className="flex-1 h-full flex items-end" style={{ minWidth: 8 }}>
                {w.totaalAandeel !== null && (
                  <div
                    className="w-full rounded-t-[4px]"
                    style={{
                      height: `${w.totaalAandeel * 100}%`,
                      background: 'var(--brand-accent)',
                      opacity: w.deelweekBegin || w.deelweekEind ? 0.5 : 1,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-bold text-muted">
                <th scope="col" className="sticky left-0 bg-surface text-left py-1.5 pr-3 whitespace-nowrap">{i.kolomWeek}</th>
                {PERIODIZATION_CATEGORIES.map((c) => (
                  <th key={c.key} scope="col" className="text-left py-1.5 px-2 whitespace-nowrap">
                    {t.periodization.categories[c.key]}
                  </th>
                ))}
                <th scope="col" className="text-left py-1.5 pl-3 whitespace-nowrap">{i.kolomTrainingstotaal}</th>
              </tr>
            </thead>
            <tbody>
              {data.weken.map((w) => {
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
                    {PERIODIZATION_CATEGORIES.map((c) => (
                      <td key={c.key} className="py-2 px-2 text-ink font-semibold tabular-nums whitespace-nowrap">
                        {w.perCategorie === null ? i.geenGegevens : w.perCategorie[c.key]}
                      </td>
                    ))}
                    <td className="py-2 pl-3 text-ink font-semibold tabular-nums whitespace-nowrap">
                      {w.trainingstotaalMin === null
                        ? i.geenGegevens
                        : `${w.trainingstotaalMin}${w.blokkenZonderDuur > 0 ? ' *' : ''}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-1 text-[12.5px] text-faint">
          {zonderOefeningen > 0 && <p>{i.belastingZonderOefeningen.replace('{n}', String(zonderOefeningen))}</p>}
          {zonderDuur > 0 && <p>{i.belastingZonderDuur.replace('{n}', String(zonderDuur))}</p>}
          {onbekend > 0 && <p>{i.belastingOnbekend.replace('{n}', String(onbekend))}</p>}
          {totaalOnvolledig && <p>{i.belastingTotaalOnvolledig}</p>}
          <p>{i.belastingSomUitleg}</p>
          <p>{i.belastingMomentopname}</p>
        </div>
      </div>
    </InsightCard>
  )
}
