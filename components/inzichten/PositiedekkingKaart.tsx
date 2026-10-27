import type { Dict } from '@/messages/nl'
import type { PositieDekking } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'

function fitTekst(n: number, t: Dict): string {
  const i = t.insights
  if (n === 0) return i.dekkingGeen
  if (n === 1) return i.dekkingEen
  return i.dekkingMeer.replace('{n}', String(n))
}

// Positiedekking: fitte vaste spelers per positie (momentopname van nu, W6).
// Neutrale tekst zonder kleur of icoon, en bewust geen drempel "dun".
// `heeftSpelers` = de bron bevatte actieve vaste spelers; zonder spelers is de
// lijst van 12 lege posities geen informatie maar een lege staat (AC-3.7).
export default function PositiedekkingKaart({
  dekking,
  heeftSpelers,
  fout,
  t,
}: {
  dekking: PositieDekking[]
  heeftSpelers: boolean
  fout: boolean
  t: Dict
}) {
  const i = t.insights
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (!heeftSpelers) empty = <InsightEmpty icon="groups" text={i.dekkingEmpty} />

  return (
    <InsightCard title={i.dekkingTitle} description={i.dekkingDescription} empty={empty}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-bold text-muted">
              <th scope="col" className="text-left py-1.5 pr-3">{i.kolomPositie}</th>
              <th scope="col" className="text-left py-1.5 px-3">{i.kolomFit}</th>
              <th scope="col" className="text-left py-1.5 pl-3">{i.kolomSpelers}</th>
            </tr>
          </thead>
          <tbody>
            {dekking.map((d) => (
              <tr key={d.positie}>
                <th scope="row" className="py-1.5 pr-3 text-left align-top font-semibold text-ink whitespace-nowrap">
                  {t.players.positions[d.positie]}
                </th>
                <td className="py-1.5 px-3 align-top text-faint font-semibold whitespace-nowrap">{fitTekst(d.spelers.length, t)}</td>
                <td className="py-1.5 pl-3 align-top text-ink font-semibold leading-snug">
                  {d.spelers.map((s, idx) => (
                    <span key={s.player_id}>
                      {idx > 0 && ', '}
                      {s.naam}
                      {s.secundair && <span className="text-faint"> {i.dekkingSecundair}</span>}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </InsightCard>
  )
}
