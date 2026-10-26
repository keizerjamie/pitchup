import type { Dict } from '@/messages/nl'
import type { FormatieResultaat } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'
import { ResultaatKoppen, ResultaatCellen } from './ResultaatTabel'

// Resultaten per formatie. De formatie is de ruwe opgeslagen waarde (vrije
// tekst ≤20 tekens), dus ook onbekende schrijfwijzen staan letterlijk in de rij.
export default function FormatieKaart({
  rijen,
  fout,
  afgekapt,
  t,
}: {
  rijen: FormatieResultaat[]
  fout: boolean
  afgekapt: boolean
  t: Dict
}) {
  const i = t.insights
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (afgekapt) empty = <InsightEmpty text={i.afgekapt} />
  else if (rijen.length === 0) empty = <InsightEmpty icon="groups" text={i.formatieEmpty} />

  return (
    <InsightCard title={i.formatieTitle} description={i.formatieDescription} empty={empty}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <ResultaatKoppen eersteKolom={i.formatieKolom} t={t} />
          <tbody>
            {rijen.map((r) => (
              <tr key={r.formatie} style={{ borderTop: '1px solid var(--border-soft)' }}>
                <th scope="row" className="text-left py-1.5 pr-3 font-semibold text-ink">{r.formatie}</th>
                <ResultaatCellen groep={r} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </InsightCard>
  )
}
