import type { Dict } from '@/messages/nl'
import type { NaastElkaarRegel } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'
import { round1 } from './TopWorstRatings'

// Opkomst, selectie en rating per speler naast elkaar. Geen rangorde, geen
// samenvattend label en geen verband (W4): alleen cijfers per kolom.
// Een gast toont alleen "x keer aanwezig" (O3): percentage === null.
function opkomstTekst(r: NaastElkaarRegel, t: Dict): string {
  const i = t.insights
  const o = r.opkomst
  if (o === null) return i.geenGegevens
  if (o.percentage === null) return i.opkomstGastWaarde.replace('{x}', String(o.aanwezig))
  return i.opkomstWaarde
    .replace('{percentage}', String(o.percentage))
    .replace('{aanwezig}', String(o.aanwezig))
    .replace('{totaal}', String(o.totaal))
}

export default function OpkomstSelectieRatingKaart({ regels, fout, t }: { regels: NaastElkaarRegel[]; fout: boolean; t: Dict }) {
  const i = t.insights
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (regels.length === 0) empty = <InsightEmpty icon="groups" text={i.naastElkaarEmpty} />

  const cel = 'py-2 pl-3 align-top text-faint font-semibold tabular-nums'
  return (
    <InsightCard title={i.naastElkaarTitle} description={i.naastElkaarDescription} empty={empty}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-bold text-muted">
              <th scope="col" className="text-left py-1.5 pr-3">{i.kolomSpeler}</th>
              <th scope="col" className="text-left py-1.5 pl-3">{i.kolomTrainingsopkomst}</th>
              <th scope="col" className="text-left py-1.5 pl-3">{i.kolomInSelectie}</th>
              <th scope="col" className="text-left py-1.5 pl-3">{i.ratingLabel}</th>
            </tr>
          </thead>
          <tbody>
            {regels.map((r) => (
              <tr key={r.player_id}>
                <th scope="row" className="py-2 pr-3 text-left align-top font-semibold text-ink leading-snug">
                  {r.naam}
                  {r.gast && (
                    <span className="ml-2 text-[11px] font-bold text-faint rounded-full px-2 py-0.5 bg-surface-sunken">{i.gastLabel}</span>
                  )}
                </th>
                <td className={cel}>{opkomstTekst(r, t)}</td>
                <td className={cel}>
                  {r.selectie
                    ? i.vanWedstrijden.replace('{x}', String(r.selectie.selectie)).replace('{y}', String(r.selectie.noemer))
                    : i.geenGegevens}
                </td>
                <td className={cel}>
                  {r.rating
                    ? i.topWorstRatingsWaarde
                        .replace('{gemiddelde}', round1(r.rating.gemiddelde).toFixed(1))
                        .replace('{aantal}', String(r.rating.aantal))
                    : i.geenGegevens}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </InsightCard>
  )
}
