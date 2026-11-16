import type { Dict } from '@/messages/nl'
import Button, { LinkButton } from '@/components/ui/Button'
import { stapHref, volgendeStap, type WedstrijdStap, type WedstrijdStapperData } from '@/lib/wedstrijd-stappen'

// "Volgende: <stap>" onderaan de inhoud van elke wedstrijdpagina. Bewust NIET
// sticky: hij staat statisch onder de inhoud en overlapt dus nooit "Opslaan" of
// de onderbalk. Op de laatste stap (analyse) is er niets om naartoe te gaan.
// Is de volgende stap analyse en nog vergrendeld, dan een uitgeschakelde knop
// met de reden zichtbaar ernaast (zelfde tekst als in de stapper).

interface Props {
  data: WedstrijdStapperData
  t: Dict
}

export default function VolgendeStap({ data, t }: Props) {
  const volgende = volgendeStap(data.huidig)
  if (!volgende) return null

  const label: Record<Exclude<WedstrijdStap, 'beschikbaar'>, string> = {
    selectie: t.wedstrijdFlow.volgendeSelectie,
    opstelling: t.wedstrijdFlow.volgendeOpstelling,
    analyse: t.wedstrijdFlow.volgendeAnalyse,
  }
  if (volgende === 'beschikbaar') return null
  const tekst = label[volgende]

  if (volgende === 'analyse' && data.analyseVergrendeld) {
    const redenId = `volgende-stap-reden-${data.eventId}`
    return (
      <div className="print:hidden flex flex-col gap-2 sm:items-end">
        <Button variant="primary" fullWidth disabled aria-describedby={redenId} className="sm:w-auto">
          {tekst}
        </Button>
        <p id={redenId} className="text-[13px] font-semibold text-faint">{t.event.analysisAfterMatch}</p>
      </div>
    )
  }

  return (
    <div className="print:hidden flex sm:justify-end">
      <LinkButton href={stapHref(data.eventId, volgende)} variant="primary" fullWidth className="sm:w-auto">
        {tekst}
      </LinkButton>
    </div>
  )
}
