import type { Dict } from '@/messages/nl'
import { STANDAARD_SESSIEDUUR_MIN, type Tijdlijn } from '@/lib/sessie-tijdlijn'

// Samenvattingsstrook boven de oefeningenlijst: hoeveel minuten staat er
// gepland, hoe verhoudt zich dat tot de richttijd, en hoe laat is de sessie
// klaar.
//
// De vraag die dit beantwoordt stelde de planner eerder helemaal niet: je zag
// een lijst oefeningen zonder optelsom, en merkte pas op het veld dat je sessie
// twintig minuten te lang was. Alle cijfers komen uit velden die er al waren
// (`oefeningen.duur_min`, `events.time`) — geen datamodel-wijziging.
//
// Server component: puur presentatie, geen state.

// De balk vult zich tot de richttijd. Daarboven blijft hij vol en neemt de
// tekst het over ("12 min over de richttijd") — een balk die over zijn eigen
// rand heen groeit leest als een renderfout, niet als informatie.
function vulPercentage(totaal: number): number {
  if (totaal <= 0) return 0
  return Math.min(100, Math.round((totaal / STANDAARD_SESSIEDUUR_MIN) * 100))
}

export default function SessieTijdlijn({
  tijdlijn,
  startTijd,
  t,
}: {
  tijdlijn: Tijdlijn
  startTijd: string | null
  t: Dict
}) {
  const { totaalMin, blokkenZonderDuur, eindTijd } = tijdlijn

  // Niets gepland én niets zonder duur: dan is er domweg nog geen sessie om
  // iets over te zeggen.
  if (totaalMin === 0 && blokkenZonderDuur === 0) {
    return (
      <div className="surface-card px-4 py-3 print:hidden">
        <p className="text-sm font-semibold text-faint">{t.trainingPlan.sessionEmpty}</p>
      </div>
    )
  }

  const over = totaalMin - STANDAARD_SESSIEDUUR_MIN
  // Kleur volgt de bestaande semantiek van de app: groen is "past", amber is
  // "kijk hier even naar". Te lang is geen fout, dus nooit rood.
  const kleur = over > 0 ? 'var(--warning-text)' : 'var(--brand-accent)'

  const restTekst =
    over > 0
      ? t.trainingPlan.sessionOver.replace('{n}', String(over))
      : t.trainingPlan.sessionOf.replace('{n}', String(STANDAARD_SESSIEDUUR_MIN))

  const zonderDuurTekst =
    blokkenZonderDuur === 0
      ? null
      : blokkenZonderDuur === 1
        ? t.trainingPlan.sessionNoDurationOne
        : t.trainingPlan.sessionNoDurationMany.replace('{n}', String(blokkenZonderDuur))

  return (
    <div className="surface-card px-4 py-3.5 print:hidden">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[22px] font-bold text-ink tabular-nums leading-none">
            {t.trainingPlan.sessionPlanned.replace('{n}', String(totaalMin))}
          </span>
          <span className="text-xs font-bold" style={{ color: kleur }}>{restTekst}</span>
        </div>

        {/* Kloktijden alleen als ze er echt zijn. Een training zonder starttijd
            krijgt een hint in plaats van een verzonnen bereik. */}
        {startTijd && eindTijd ? (
          <span className="text-sm font-bold text-muted tabular-nums">{startTijd} – {eindTijd}</span>
        ) : (
          !startTijd && <span className="text-xs font-semibold text-faint">{t.trainingPlan.sessionNoStartTime}</span>
        )}
      </div>

      <div className="mt-2.5 h-2 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
        <div className="h-full rounded-full" style={{ width: `${vulPercentage(totaalMin)}%`, background: kleur }} />
      </div>

      {zonderDuurTekst && (
        <p className="text-[11px] font-semibold text-faint mt-1.5">{zonderDuurTekst}</p>
      )}
    </div>
  )
}
