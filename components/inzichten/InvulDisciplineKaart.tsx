import type { Dict } from '@/messages/nl'
import { aandeel, type EvaluatieDiscipline, type InvulDiscipline } from '@/lib/inzichten'
import InsightCard, { InsightEmpty } from './InsightCard'

// Invul-discipline: hoeveel gespeelde wedstrijden een analyse en een uitslag
// hebben en hoeveel trainingen een plan, als "x van y" met een meter. Context
// bij de cijfers, geen oordeel: geen drempels, geen oordeelskleur, geen links.
//
// Volgorde van de staten: fout → afgekapt → geen wedstrijden én trainingen →
// inhoud. Bij `afgekapt` zijn de tellingen wel gevuld, dus eerst `afgekapt`.
function Maat({
  tekst,
  x,
  y,
  handmatig,
  handmatigTekst,
  geenTekst,
}: {
  tekst: string
  x: number
  y: number
  handmatig: number
  handmatigTekst: string
  geenTekst: string
}) {
  const a = aandeel(x, y)
  return (
    <div>
      <dt className="text-sm font-semibold text-ink tabular-nums">
        {y === 0 ? geenTekst : tekst.replace('{x}', String(x)).replace('{y}', String(y))}
      </dt>
      <dd className="mt-1">
        {a !== null && (
          <div aria-hidden="true" className="h-1.5 w-full rounded-full" style={{ background: 'var(--track)' }}>
            <div className="h-full rounded-full" style={{ width: `${a * 100}%`, background: 'var(--brand-accent)' }} />
          </div>
        )}
        {handmatig > 0 && (
          <p className="mt-1 text-[12.5px] text-faint">{handmatigTekst.replace('{n}', String(handmatig))}</p>
        )}
      </dd>
    </div>
  )
}

export default function InvulDisciplineKaart({
  data,
  fout,
  evaluatie,
  t,
}: {
  data: InvulDiscipline
  fout: boolean
  // Fase 3b: optionele RPE- en oordeel-maten. Zonder deze prop is de render
  // identiek aan fase 3a. De 3a-bron blijft leidend voor de kaartstaten; een
  // falende of afgekapte evaluatiebron geeft alleen één regel onder de maten.
  evaluatie?: { data: EvaluatieDiscipline; fout: boolean }
  t: Dict
}) {
  const i = t.insights
  let empty: React.ReactNode | undefined
  if (fout) empty = <InsightEmpty text={i.bronFout} />
  else if (data.afgekapt) empty = <InsightEmpty text={i.afgekaptTraining} />
  else if (data.wedstrijden === 0 && data.trainingen === 0) {
    empty = <InsightEmpty icon="check_circle" text={i.disciplineEmpty} />
  }

  return (
    <InsightCard title={i.disciplineTitle} description={i.disciplineDescription} empty={empty}>
      <div className="flex flex-col gap-4">
        <dl className="flex flex-col gap-4">
          <Maat
            tekst={i.disciplineAnalyse}
            x={data.metAnalyse}
            y={data.wedstrijden}
            handmatig={data.analyseHandmatig}
            handmatigTekst={i.disciplineHandmatig}
            geenTekst={i.disciplineGeenWedstrijden}
          />
          <Maat
            tekst={i.disciplineUitslag}
            x={data.metUitslag}
            y={data.wedstrijden}
            handmatig={0}
            handmatigTekst={i.disciplineHandmatig}
            geenTekst={i.disciplineGeenWedstrijden}
          />
          <Maat
            tekst={i.disciplinePlan}
            x={data.metPlan}
            y={data.trainingen}
            handmatig={data.planHandmatig}
            handmatigTekst={i.disciplineHandmatig}
            geenTekst={i.disciplineGeenTrainingen}
          />
          {evaluatie && !evaluatie.fout && !evaluatie.data.afgekapt && (
            <>
              <Maat
                tekst={i.disciplineRpe}
                x={evaluatie.data.metRpe}
                y={evaluatie.data.trainingen}
                handmatig={evaluatie.data.trainingen - evaluatie.data.metRpe}
                handmatigTekst={i.disciplineZonderRpe}
                geenTekst={i.disciplineGeenTrainingen}
              />
              <Maat
                tekst={i.disciplineOordeel}
                x={evaluatie.data.metOordeelBijDoelstelling}
                y={evaluatie.data.metDoelstelling}
                handmatig={evaluatie.data.metDoelstelling - evaluatie.data.metOordeelBijDoelstelling}
                handmatigTekst={i.disciplineZonderOordeel}
                geenTekst={i.disciplineGeenDoelstelling}
              />
            </>
          )}
        </dl>
        {evaluatie && evaluatie.fout && (
          <p className="text-[12.5px] text-faint">{i.disciplineEvaluatieFout}</p>
        )}
        {evaluatie && !evaluatie.fout && evaluatie.data.afgekapt && (
          <p className="text-[12.5px] text-faint">{i.afgekaptTraining}</p>
        )}
        <p className="text-[12.5px] text-faint">{i.disciplineAanwezigheid}</p>
      </div>
    </InsightCard>
  )
}
