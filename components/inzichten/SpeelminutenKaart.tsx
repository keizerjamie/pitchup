import type { Dict } from '@/messages/nl'
import type { SpeelminutenVerdeling } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'

// Speelminuten en wissels per speler. Semantische tabel met een meter (meer dan
// 7 spelers en meerdere maten per speler); omdat de tabel zelf de tekstvariant
// is, is er geen ChartDataTable nodig. Eén tint, want de meter toont één
// grootte (totaal minuten). Geen rangnummers en geen oordeelskleur (W4);
// gasten en inactieven doen mee, alleen gasten krijgen een label (M4).
export default function SpeelminutenKaart({
  data,
  fout,
  t,
}: {
  data: SpeelminutenVerdeling
  fout: boolean
  t: Dict
}) {
  const i = t.insights
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (data.noemer === 0) empty = <InsightEmpty icon="groups" text={i.speelminutenEmpty} />

  return (
    <InsightCard title={i.speelminutenTitle} description={i.speelminutenDescription} empty={empty}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-bold text-muted">
              <th scope="col" className="text-left py-1.5 pr-3">{i.kolomSpeler}</th>
              <th scope="col" className="text-left py-1.5 pl-3">{i.kolomWedstrijdenMetMinuten}</th>
              <th scope="col" className="text-left py-1.5 pl-3">{i.kolomMinutenTotaal}</th>
              <th scope="col" className="text-left py-1.5 pl-3">{i.kolomGemiddeldPerWedstrijd}</th>
              <th scope="col" className="text-left py-1.5 pl-3">{i.kolomWissels}</th>
            </tr>
          </thead>
          <tbody>
            {data.regels.map((r) => {
              const geenData = r.wedstrijden === 0
              return (
                <tr key={r.player_id}>
                  <th scope="row" className="py-2 pr-3 text-left align-top font-semibold text-ink leading-snug">
                    {r.naam}
                    {r.gast && (
                      <span className="ml-2 text-[11px] font-bold text-faint rounded-full px-2 py-0.5 bg-surface-sunken">{i.gastLabel}</span>
                    )}
                  </th>
                  <td className="py-2 pl-3 align-top text-ink font-semibold tabular-nums whitespace-nowrap">
                    {i.minutenDekking.replace('{x}', String(r.wedstrijden)).replace('{y}', String(data.noemer))}
                  </td>
                  <td className="py-2 pl-3 align-top">
                    <span className="text-ink font-semibold tabular-nums">{geenData || r.minuten === null ? i.geenGegevens : r.minuten}</span>
                    {r.minutenAandeel !== null && (
                      <div aria-hidden="true" className="mt-1 h-1.5 w-full min-w-24 rounded-full" style={{ background: 'var(--track)' }}>
                        <div className="h-full rounded-full" style={{ width: `${r.minutenAandeel * 100}%`, background: 'var(--brand-accent)' }} />
                      </div>
                    )}
                  </td>
                  <td className="py-2 pl-3 align-top text-ink font-semibold tabular-nums">
                    {geenData || r.gemiddelde === null ? i.geenGegevens : r.gemiddelde}
                  </td>
                  <td className="py-2 pl-3 align-top text-ink font-semibold tabular-nums">
                    {geenData || r.wissels === null ? i.geenGegevens : r.wissels}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </InsightCard>
  )
}
