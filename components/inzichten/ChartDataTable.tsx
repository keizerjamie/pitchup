// A11y-fallback voor elke grafiek: dezelfde cijfers als een `sr-only`
// <table> met <caption>, zodat schermlezers de exacte waarden krijgen zonder
// de SVG te hoeven interpreteren. Staat naast (niet in plaats van) de
// visuele grafiek plus de role="img"-aria-label op de grafiekwrapper.
export default function ChartDataTable({
  caption,
  headers,
  rows,
}: {
  caption: string
  headers: string[]
  rows: (string | number)[][]
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i} scope="col">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
