import type { Dict } from '@/messages/nl'
import type { EvaluatieOverzicht } from '@/lib/inzichten'
import { formatDateShort } from '@/lib/utils'
import InsightCard, { InsightEmpty } from './InsightCard'

// Ervaren trainingsbelasting (sRPE = RPE × geplande duur) in AU per week: één
// reeks als staafjes (één tint, geen as-getallen, geen hover-tooltip; de
// tabel is de waardenweergave) met daaronder een weektabel als tekstvariant.
// Geen gemiddelde, drempel, kleuralarm of KPI.
//
// Volgorde van de staten: fout → afgekapt (evaluaties of duur) → geen
// trainingen → inhoud.
export default function SrpeKaart({
  data,
  fout,
  t,
}: {
  data: EvaluatieOverzicht
  fout: boolean
  t: Dict
}) {
  const i = t.insights
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (data.afgekaptEvaluaties || data.afgekaptDuur) empty = <InsightEmpty text={i.afgekaptTraining} />
  else if (!data.heeftTrainingen) empty = <InsightEmpty icon="assignment" text={i.srpeEmpty} />

  const zonderRpe = data.totaal.trainingen - data.totaal.metRpe
  const zonderDuur = data.totaal.zonderDuur
  const onvolledig = data.totaal.onvolledigeDuur > 0

  return (
    <InsightCard title={i.srpeTitle} description={i.srpeDescription} empty={empty}>
      <div className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <div
            role="img"
            aria-label={i.srpeGrafiekLabel.replace('{n}', String(data.weken.length))}
            className="flex items-end h-24 w-full"
            style={{ gap: 2, borderBottom: '1px solid var(--track)' }}
          >
            {data.weken.map((w) => (
              <div key={w.maandag} className="flex-1 h-full flex items-end" style={{ minWidth: 8 }}>
                {w.srpeAandeel !== null && (
                  <div
                    className="w-full rounded-t-[4px]"
                    style={{
                      height: `${w.srpeAandeel * 100}%`,
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
                <th scope="col" className="text-left py-1.5 px-2 whitespace-nowrap">{i.kolomMetRpe}</th>
                <th scope="col" className="text-left py-1.5 pl-3 whitespace-nowrap">{i.kolomSrpe}</th>
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
                    <td className="py-2 px-2 text-ink font-semibold tabular-nums whitespace-nowrap">
                      {w.trainingen === 0
                        ? i.geenGegevens
                        : i.rpeDekking.replace('{x}', String(w.metRpe)).replace('{y}', String(w.trainingen))}
                    </td>
                    <td className="py-2 pl-3 text-ink font-semibold tabular-nums whitespace-nowrap">
                      {w.srpe === null ? i.geenGegevens : `${w.srpe}${w.onvolledigeDuur > 0 ? ' *' : ''}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-1 text-[12.5px] text-faint">
          {zonderRpe > 0 && <p>{i.srpeZonderRpe.replace('{n}', String(zonderRpe))}</p>}
          {zonderDuur > 0 && <p>{i.srpeZonderDuur.replace('{n}', String(zonderDuur))}</p>}
          {onvolledig && <p>{i.srpeOnvolledig}</p>}
          <p>{i.srpeMomentopname}</p>
          <p>{i.srpeVolgendeDag}</p>
        </div>
      </div>
    </InsightCard>
  )
}
