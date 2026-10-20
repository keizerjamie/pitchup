import type { Dict } from '@/messages/nl'
import { formatPercentage, type OverzichtRij } from '@/lib/aanwezigheidsoverzicht'
import TeamLogo from '@/components/TeamLogo'

// Print-only A4 van het aanwezigheidsoverzicht (dual-markup, zie
// SeizoensrapportPrint.tsx): scherm en afdruk lezen uit DEZELFDE rijen. Er staat
// bewust geen enkel element van het seizoensrapport in; alleen de CSS-klassen
// rapport-kop/-voet worden hergebruikt voor de huisstijl. Alleen naam,
// tellingen en percentages (geen overige persoonsgegevens).

// Zelfde parse-conventie als SeizoensrapportPrint: kale kalenderdatum +
// 'T00:00:00', dus lokaal geïnterpreteerd (geen UTC-verschuiving).
function datumLabel(datum: string, locale: string): string {
  return new Date(`${datum}T00:00:00`).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

interface Props {
  t: Dict
  rijen: OverzichtRij[]
  teamName: string | null
  teamLogoUrl: string | null
  // Het GETELDE venster (t/m gisteren), niet het onafgekapte seizoen.
  venster: { start: string; end: string }
  periodeLabel: string
  generatedOn: string
  primaryColor: string
  secondaryColor: string
}

export default function AanwezigheidsOverzichtPrint({
  t, rijen, teamName, teamLogoUrl, venster, periodeLabel, generatedOn, primaryColor, secondaryColor,
}: Props) {
  return (
    <div
      className="hidden print:block rapport"
      data-print-only
      style={{ '--club-primary': primaryColor, '--club-secondary': secondaryColor } as React.CSSProperties}
    >
      <div className="rapport-kop">
        <div className="rapport-kop-links">
          {teamLogoUrl && <TeamLogo src={teamLogoUrl} size={34} alt={teamName ?? 'Pitchup'} fallback={null} />}
          <div>
            {teamName && <p className="rapport-team font-pdf-display">{teamName}</p>}
            <p className="rapport-periode">
              {datumLabel(venster.start, t.browserLocale)} – {datumLabel(venster.end, t.browserLocale)} · {periodeLabel}
            </p>
          </div>
        </div>
        <p className="rapport-titel font-pdf-display">{t.players.overzichtPrintTitel}</p>
      </div>

      <table className="overzicht-tabel">
        <thead>
          <tr>
            <th scope="col" className="overzicht-naam">{t.players.overzichtKolomNaamLang}</th>
            <th scope="col">{t.players.overzichtKolomAanwezigLang}</th>
            <th scope="col">{t.players.overzichtKolomAfwezigLang}</th>
            <th scope="col">{t.players.overzichtKolomGeblesseerdLang}</th>
            <th scope="col">{t.players.overzichtKolomPctInclLang}</th>
            <th scope="col">{t.players.overzichtKolomPctZonderLang}</th>
          </tr>
        </thead>
        <tbody>
          {rijen.map((r) => (
            <tr key={r.playerId}>
              <td className="overzicht-naam">{r.naam}</td>
              <td>{r.aanwezig}</td>
              <td>{r.afwezig}</td>
              <td>{r.geblesseerd}</td>
              <td>{formatPercentage(r.pctIncl)}</td>
              <td>{formatPercentage(r.pctZonder)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="overzicht-uitleg">{t.players.overzichtUitleg}</p>

      <div className="rapport-voet">
        <span>{teamName}</span>
        {generatedOn && <span className="rapport-voet-datum">{generatedOn}</span>}
        <span className="rapport-voet-merk">
          {/* eslint-disable-next-line @next/next/no-img-element -- print-only blok, zelfde afweging als de poster-footer: een gewone <img> rendert synchroon bij afdrukken */}
          <img src="/logo.png" alt="" aria-hidden="true" />
          {t.matchSquad.footerGenerated}
        </span>
      </div>
    </div>
  )
}
