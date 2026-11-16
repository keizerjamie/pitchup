import Link from 'next/link'
import type { Dict } from '@/messages/nl'
import {
  WEDSTRIJD_STAPPEN,
  stapHref,
  type StapVoortgang,
  type WedstrijdStap,
  type WedstrijdStapperData,
} from '@/lib/wedstrijd-stappen'

// De wedstrijd als één flow: vier stappen als gewone <Link>'s (server
// component, geen state), op elke wedstrijdpagina dezelfde stapper. De volgorde
// is vrij: niets wordt geblokkeerd, behalve analyse vóór de wedstrijddag (dan
// geen link, zelfde regel als de vroegere actiekaart). Geen overgangsanimatie:
// dit is een navigatie die vaak gebeurt, alleen drukfeedback via active:scale.
// Beschikbaar krijgt nooit een vinkje (besluit 3): die stap heeft geen
// "klaar", alleen de samenvatting eronder.

interface Props {
  data: WedstrijdStapperData
  t: Dict
}

function voortgangVan(data: WedstrijdStapperData, stap: WedstrijdStap): StapVoortgang | null {
  if (stap === 'beschikbaar') return null
  return data[stap]
}

export default function WedstrijdStapper({ data, t }: Props) {
  const label: Record<WedstrijdStap, string> = {
    beschikbaar: t.wedstrijdFlow.stapBeschikbaar,
    selectie: t.wedstrijdFlow.stapSelectie,
    opstelling: t.wedstrijdFlow.stapOpstelling,
    analyse: t.wedstrijdFlow.stapAnalyse,
  }
  const samenvattingId = `wedstrijd-stapper-samenvatting-${data.eventId}`
  const samenvatting = t.wedstrijdFlow.beschikbaarSamenvatting
    .replace('{aanwezig}', String(data.aanwezigheid.aanwezig))
    .replace('{geenReactie}', String(data.aanwezigheid.geenReactie))

  return (
    <nav aria-label={t.wedstrijdFlow.stapperLabel} className="print:hidden w-full lg:max-w-2xl">
      <ol className="grid grid-cols-4 gap-1">
        {WEDSTRIJD_STAPPEN.map((stap, i) => {
          const huidig = data.huidig === stap
          const voortgang = voortgangVan(data, stap)
          const klaar = voortgang === 'klaar'
          const vergrendeld = stap === 'analyse' && data.analyseVergrendeld && !huidig

          if (vergrendeld) {
            return (
              <li key={stap} className="min-w-0">
                <span aria-disabled="true" className="flex flex-col items-center gap-1 min-h-11 px-0.5 py-1 text-center">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold bg-surface-sunken text-faint">
                    {i + 1}
                  </span>
                  <span className="text-[11.5px] font-bold leading-tight break-words text-faint">{label[stap]}</span>
                  <span className="max-sm:sr-only text-[10.5px] font-semibold leading-tight text-faint">
                    {t.event.analysisAfterMatch}
                  </span>
                </span>
              </li>
            )
          }

          const gevuld = huidig || klaar
          return (
            <li key={stap} className="min-w-0">
              <Link
                href={stapHref(data.eventId, stap)}
                aria-current={huidig ? 'step' : undefined}
                aria-describedby={stap === 'beschikbaar' ? samenvattingId : undefined}
                className="flex flex-col items-center gap-1 min-h-11 px-0.5 py-1 rounded-lg text-center active:scale-[0.97]"
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold ${
                    gevuld ? 'text-white' : 'text-muted border border-[var(--border-soft)]'
                  }`}
                  style={{
                    ...(gevuld ? { background: 'var(--primary)' } : null),
                    ...(huidig ? { boxShadow: '0 0 0 3px color-mix(in srgb, var(--primary) 25%, transparent)' } : null),
                  }}
                >
                  {klaar ? <span className="ms text-[16px]" aria-hidden="true">check</span> : i + 1}
                </span>
                <span className={`text-[11.5px] font-bold leading-tight break-words ${huidig || klaar ? 'text-ink' : 'text-muted'}`}>
                  {label[stap]}
                </span>
                {klaar && <span className="sr-only">{t.wedstrijdFlow.stapKlaarSr}</span>}
                {voortgang === 'open' && !huidig && <span className="sr-only">{t.wedstrijdFlow.stapOpenSr}</span>}
              </Link>
            </li>
          )
        })}
      </ol>
      <p id={samenvattingId} className="mt-1.5 text-[12px] text-faint">{samenvatting}</p>
    </nav>
  )
}
