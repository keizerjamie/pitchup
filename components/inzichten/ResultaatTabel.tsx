import type { Dict } from '@/messages/nl'
import type { ResultaatGroep } from '@/lib/inzichten'

// Gedeelde tabelkoppen en -cellen voor de kaarten "Thuis en uit" en "Resultaten
// per formatie": dezelfde zes cijferkolommen, dus één bron voor kopjes, afronding
// en saldo-notatie. Kopjes zijn <abbr> met de lange naam als title, zodat de
// afkorting ook voor schermlezers en bij hover uitgelegd is.
export function ResultaatKoppen({ eersteKolom, t }: { eersteKolom: string; t: Dict }) {
  const i = t.insights
  const kolommen: [string, string][] = [
    [i.kolomGespeeld, i.kolomGespeeld],
    [i.kolomWinst, i.kolomWinstLang],
    [i.kolomGelijk, i.kolomGelijkLang],
    [i.kolomVerlies, i.kolomVerliesLang],
    [i.kolomPpw, i.kolomPpwLang],
    [i.kolomSaldo, i.kolomSaldoLang],
  ]
  return (
    <thead>
      <tr className="text-xs font-bold text-muted">
        <th scope="col" className="text-left py-1.5 pr-3">{eersteKolom}</th>
        {kolommen.map(([kort, lang]) => (
          <th key={lang} scope="col" className="text-right py-1.5 pl-3">
            <abbr title={lang} className="no-underline">{kort}</abbr>
          </th>
        ))}
      </tr>
    </thead>
  )
}

// Punt-notatie (toFixed), gelijk aan TopWorstRatings; null (0 wedstrijden) → "—".
function ppw(g: ResultaatGroep): string {
  return g.puntenPerWedstrijd === null ? '—' : g.puntenPerWedstrijd.toFixed(2)
}

function saldoTekst(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

export function ResultaatCellen({ groep }: { groep: ResultaatGroep }) {
  const cel = 'text-right py-1.5 pl-3 tabular-nums text-ink font-semibold'
  return (
    <>
      <td className={cel}>{groep.wedstrijden}</td>
      <td className={cel}>{groep.win}</td>
      <td className={cel}>{groep.gelijk}</td>
      <td className={cel}>{groep.verlies}</td>
      <td className={cel}>{ppw(groep)}</td>
      <td className={cel}>{saldoTekst(groep.saldo)}</td>
    </>
  )
}
