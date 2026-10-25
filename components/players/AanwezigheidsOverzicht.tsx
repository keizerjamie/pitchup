import Link from 'next/link'
import type { Dict } from '@/messages/nl'
import type { Periode } from '@/lib/inzichten'
import { formatPercentage, type OverzichtRij } from '@/lib/aanwezigheidsoverzicht'
import PeriodeFilter from '@/components/inzichten/PeriodeFilter'
import PrintButton from '@/components/PrintButton'
import type { ReactNode } from 'react'
import PageHeader from '@/components/ui/PageHeader'

// Schermdeel van het aanwezigheidsoverzicht op /players
// (?weergave=aanwezigheid). Server component: de page haalt de RPC op en geeft
// de al samengevoegde rijen door (bouwAanwezigheidsoverzicht); hier alleen
// opmaak en de vier staten. De afdruk is een apart blok
// (AanwezigheidsOverzichtPrint) dat uit DEZELFDE rijen wordt opgebouwd.

export type OverzichtStaat =
  | { soort: 'geenSeizoen' }
  | { soort: 'fout'; periode: Periode }
  | { soort: 'leeg'; periode: Periode }
  | { soort: 'data'; periode: Periode; rijen: OverzichtRij[] }

// Pad naar de weergave; de standaardperiode laat de parameter weg (zelfde
// conventie als PeriodeFilter op /inzichten).
export function overzichtHref(p: Periode): string {
  return p === 'seizoen' ? '/players?weergave=aanwezigheid' : `/players?weergave=aanwezigheid&periode=${p}`
}

// Designronde 3: titel eerst, de weergaveschakelaar (lijst/aanwezigheid)
// eronder — hij stond eerder als grote knoppenrij bóven de titel.
function Kop({ t, printPeriode, schakelaar }: { t: Dict; printPeriode?: Periode; schakelaar?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t.players.title} subtitle={t.players.overzichtSubtitle} actions={printPeriode ? <PrintButton pdf={{ doel: 'aanwezigheid', periode: printPeriode }} /> : undefined} />
      {schakelaar}
    </div>
  )
}

export default function AanwezigheidsOverzicht({ staat, t, schakelaar }: { staat: OverzichtStaat; t: Dict; schakelaar?: ReactNode }) {
  if (staat.soort === 'geenSeizoen') {
    return (
      <div className="flex flex-col gap-5">
        <Kop t={t} schakelaar={schakelaar} />
        <div className="max-w-lg surface-card p-10 text-center flex flex-col items-center gap-3">
          <span className="ms text-[40px] text-faint" aria-hidden="true">calendar_month</span>
          <p className="text-ink font-bold">{t.insights.noSeason}</p>
          <p className="text-faint text-sm">{t.insights.noSeasonHint}</p>
          <Link
            href="/settings"
            className="mt-1 h-11 rounded-full px-5 flex items-center gap-2 text-sm font-bold text-white active:scale-[0.97] transition-[transform] duration-[160ms] ease-out"
            style={{ background: 'var(--brand-btn)' }}
          >
            {t.insights.goToSettings}
          </Link>
        </div>
      </div>
    )
  }

  if (staat.soort === 'fout') {
    // Geen ruwe fout naar de client: alleen de vaste melding. De periodekiezer
    // blijft bruikbaar zodat een andere periode meteen opnieuw kan proberen.
    return (
      <div className="flex flex-col gap-5">
        <Kop t={t} schakelaar={schakelaar} />
        <PeriodeFilter actief={staat.periode} t={t} hrefVoor={overzichtHref} />
        <div
          role="alert"
          className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm font-medium px-4 py-3 rounded-xl"
        >
          {t.players.overzichtFout}
        </div>
      </div>
    )
  }

  if (staat.soort === 'leeg') {
    const kleinerDanSeizoen = staat.periode !== 'seizoen'
    return (
      <div className="flex flex-col gap-5">
        <Kop t={t} schakelaar={schakelaar} />
        {/* Bij een kortere periode kan er elders wél data zijn: de kiezer
            moet blijven staan, anders zit de gebruiker vast. */}
        {kleinerDanSeizoen && <PeriodeFilter actief={staat.periode} t={t} hrefVoor={overzichtHref} />}
        <div className="max-w-lg surface-card p-10 text-center flex flex-col items-center gap-3">
          <span className="ms text-[40px] text-faint" aria-hidden="true">fact_check</span>
          <p className="text-ink font-bold">{t.players.overzichtLeegTitel}</p>
          <p className="text-faint text-sm">{t.players.overzichtLeegHint}</p>
        </div>
      </div>
    )
  }

  const { rijen, periode } = staat
  return (
    <div className="flex flex-col gap-5">
      <Kop t={t} printPeriode={staat.periode} schakelaar={schakelaar} />
      <PeriodeFilter actief={periode} t={t} hrefVoor={overzichtHref} />

      <div className="surface-card overflow-hidden">
        <table className="w-full table-fixed">
          <caption className="sr-only">{t.players.overzichtSubtitle}</caption>
          <thead>
            <tr className="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-[0.02em] sm:tracking-[0.06em] text-faint">
              <th scope="col" className="text-left font-extrabold pl-3 pr-1 py-3">{t.players.overzichtKolomNaam}</th>
              <Kolomkop kort={t.players.overzichtKolomAanwezig} lang={t.players.overzichtKolomAanwezigLang} />
              <Kolomkop kort={t.players.overzichtKolomAfwezig} lang={t.players.overzichtKolomAfwezigLang} />
              <Kolomkop kort={t.players.overzichtKolomGeblesseerd} lang={t.players.overzichtKolomGeblesseerdLang} />
              <Kolomkop kort={t.players.overzichtKolomPctIncl} lang={t.players.overzichtKolomPctInclLang} breed />
              <Kolomkop kort={t.players.overzichtKolomPctZonder} lang={t.players.overzichtKolomPctZonderLang} breed laatste />
            </tr>
          </thead>
          <tbody>
            {rijen.map((r) => (
              <tr key={r.playerId} style={{ borderTop: '1px solid var(--border-soft)' }}>
                {/* Naam breekt af op woordgrens maar wordt NIET afgekapt: scherm
                    en papier tonen dezelfde, volledige naam. */}
                <th scope="row" className="text-left pl-3 pr-1 py-2.5 text-[14px] font-bold text-ink break-words hyphens-auto">{r.naam}</th>
                <td className="text-right tabular-nums text-[13px] text-muted py-2.5">{r.aanwezig}</td>
                <td className="text-right tabular-nums text-[13px] text-muted py-2.5">{r.afwezig}</td>
                <td className="text-right tabular-nums text-[13px] text-muted py-2.5">{r.geblesseerd}</td>
                <td className="text-right tabular-nums text-[13px] font-bold text-ink py-2.5">{formatPercentage(r.pctIncl)}</td>
                <td className="text-right tabular-nums text-[13px] font-bold text-ink py-2.5 pr-3">{formatPercentage(r.pctZonder)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Zonder deze regel lezen twee percentages naast elkaar als een rekenfout. */}
      <p className="text-[12.5px] font-medium text-faint">{t.players.overzichtUitleg}</p>
    </div>
  )
}

// Korte kop met de volledige naam beschikbaar: <abbr title> voor hover, en
// sr-only voor schermlezers (title wordt niet overal voorgelezen).
function Kolomkop({ kort, lang, breed = false, laatste = false }: { kort: string; lang: string; breed?: boolean; laatste?: boolean }) {
  return (
    <th scope="col" className={`text-right font-extrabold py-3 pl-1 ${breed ? (laatste ? 'w-[58px] sm:w-[68px] pr-3' : 'w-[50px] sm:w-[56px]') : 'w-[38px] sm:w-[44px]'}`}>
      <abbr title={lang} className="no-underline" aria-hidden="true">{kort}</abbr>
      <span className="sr-only">{lang}</span>
    </th>
  )
}
