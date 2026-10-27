import type { Dict } from '@/messages/nl'
import type { SpeelkansRegel } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'

// Eén cel: "x van y wedstrijden" (of "geen gegevens" bij noemer 0) met eronder
// een meter. De tekst is de waarheid; de meter is decoratie (aria-hidden) en
// gebruikt één tint, want beide kolommen dragen hun identiteit in de kolomkop.
function Cel({ teller, noemer, aandeel, t }: { teller: number; noemer: number; aandeel: number | null; t: Dict }) {
  const i = t.insights
  return (
    <td className="py-2 pl-3 align-top">
      <span className="text-ink font-semibold tabular-nums">
        {noemer > 0 ? i.vanWedstrijden.replace('{x}', String(teller)).replace('{y}', String(noemer)) : i.geenGegevens}
      </span>
      {aandeel !== null && (
        <div aria-hidden="true" className="mt-1 h-1.5 w-full min-w-24 rounded-full" style={{ background: 'var(--track)' }}>
          <div className="h-full rounded-full" style={{ width: `${aandeel * 100}%`, background: 'var(--brand-accent)' }} />
        </div>
      )}
    </td>
  )
}

// Speelkansen per speler: in de selectie en in de basis (= opgeslagen
// opstelling). Semantische tabel (meer dan 7 spelers); geen rangnummers en
// geen oordeelslabels (W4). Gasten en inactieven doen mee, gasten met label.
export default function SpeelkansenKaart({ regels, fout, t }: { regels: SpeelkansRegel[]; fout: boolean; t: Dict }) {
  const i = t.insights
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (!regels.some((r) => r.noemer > 0)) empty = <InsightEmpty icon="groups" text={i.speelkansenEmpty} />

  return (
    <InsightCard title={i.speelkansenTitle} description={i.speelkansenDescription} empty={empty}>
      <div className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-bold text-muted">
                <th scope="col" className="text-left py-1.5 pr-3">{i.kolomSpeler}</th>
                <th scope="col" className="text-left py-1.5 pl-3">{i.kolomInSelectie}</th>
                <th scope="col" className="text-left py-1.5 pl-3">{i.kolomInBasis}</th>
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
                  <Cel teller={r.selectie} noemer={r.noemer} aandeel={r.selectieAandeel} t={t} />
                  <Cel teller={r.basis} noemer={r.noemer} aandeel={r.basisAandeel} t={t} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs font-semibold text-faint">{i.speelkansenUitleg}</p>
      </div>
    </InsightCard>
  )
}
