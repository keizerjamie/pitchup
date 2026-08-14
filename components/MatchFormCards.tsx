import { orderedScore, type MatchFormItem } from '@/lib/match-form'
import type { MatchResult } from '@/lib/types'
import { formatDateShort } from '@/lib/utils'
import { useDict } from '@/lib/i18n-context'

// KleurenFAMILIE (groen/amber/rood) LETTERLIJK overgenomen uit
// components/dashboard/FormStrip.tsx (STATUS_STYLE-precedent, zie de comment
// daar) — dat component zelf wordt hier bewust niet hergebruikt/gewijzigd,
// dit is een nieuw, apart component voor het print-blok van de
// wedstrijdselectie. Alleen de PRESENTATIE wijkt af van FormStrip, naar het
// goedgekeurde ontwerp: W/V krijgen een effen (niet-transparante) achtergrond
// i.p.v. FormStrip's rgba-vulling (een transparante rgba over de witte
// print-achtergrond oogt te vaag voor het steviger badge-formaat hieronder);
// G krijgt bewust GEEN vulling maar een outline in dezelfde amber-tint.
const FORM_STYLE: Record<MatchResult, { bg: string; fg: string; border?: string }> = {
  win: { bg: '#16a34a', fg: '#ffffff' },
  draw: { bg: '#ffffff', fg: 'var(--chip-amber-fg)', border: 'var(--chip-amber-fg)' },
  loss: { bg: '#fee2e2', fg: 'var(--chip-red-fg)' },
  unknown: { bg: 'var(--track)', fg: 'var(--faint)' },
}

// HARDE EIS: geen <ul>/<li> — de bestaande acceptatietest
// (wedstrijdselectie.acceptance.test.tsx, AC4) bewijst dat er precies één
// <ul> in het print-blok zit (de spelerslijst); een tweede <ul> hier zou die
// test terecht laten falen.
//
// Score-scheidingsteken: EN-DASH (–, U+2013), niet een gewoon koppelteken
// (-, U+002D). Reden: elke FORMATIONS-sleutel (bv. "4-3-3") gebruikt
// uitsluitend het gewone koppelteken; een en-dash matcht dat teken nooit, dus
// kan een reeks en-dash-scores nooit — ook niet via de tekst-aaneenschakeling
// die wedstrijdselectie-pdf.acceptance.test.tsx (Story-AC12) via
// `block.textContent` toetst — per ongeluk een geldige FORMATIONS-sleutel
// vormen. Een gewoon koppelteken zou dat risico weliswaar ook nauwelijks
// introduceren (elke score staat in een eigen <p>, gevolgd door tegenstander-
// en/of datumtekst, dus twee scores staan nooit direct na elkaar zonder
// tussenliggende, niet-cijfermatige tekst) — maar een en-dash sluit het risico
// categorisch uit (ander Unicode-teken dan de FORMATIONS-sleutels ooit
// gebruiken) én oogt vrijwel identiek aan het "liggend streepje" uit het
// ontwerp, dus is de veiligere keuze zonder esthetisch verlies.
export default function MatchFormCards({ items }: { items: MatchFormItem[] }) {
  const t = useDict()

  const letter: Record<MatchResult, string> = {
    win: t.home.formLetterWin,
    draw: t.home.formLetterDraw,
    loss: t.home.formLetterLoss,
    unknown: t.home.formLetterUnknown,
  }
  const label: Record<MatchResult, string> = {
    win: t.home.formWin,
    draw: t.home.formDraw,
    loss: t.home.formLoss,
    unknown: t.home.formUnknown,
  }

  // Samenvattingsregel ("3 GEWONNEN · 1 GELIJK · 1 VERLOREN") — uitsluitend
  // gebaseerd op win/draw/loss; 'unknown' (geen uitslag) telt bewust in geen
  // van de drie mee, dat is geen gewonnen/gelijk/verloren wedstrijd. Bij 0
  // items wordt de regel helemaal weggelaten (zie hieronder) in plaats van
  // "0 GEWONNEN · 0 GELIJK · 0 VERLOREN" te tonen — dat oogt rommelig naast
  // een verder leeg vormblok en herhaalt alleen wat de afwezigheid van
  // kaartjes al toont.
  const won = items.filter((i) => i.result === 'win').length
  const drawn = items.filter((i) => i.result === 'draw').length
  const lost = items.filter((i) => i.result === 'loss').length
  const summaryText = [
    t.matchSquad.formSummaryWon.replace('{n}', String(won)),
    t.matchSquad.formSummaryDrawn.replace('{n}', String(drawn)),
    t.matchSquad.formSummaryLost.replace('{n}', String(lost)),
  ].join(' · ')

  return (
    <div className="mt-6 border-t-4 pt-4" style={{ borderColor: 'var(--club-primary, #004f3b)' }}>
      <div className="flex items-end justify-between gap-2">
        <p className="font-pdf-display text-sm font-black" style={{ color: 'var(--club-primary, #004f3b)' }}>{t.matchSquad.formHeading}</p>
        {items.length > 0 && (
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{summaryText}</p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => {
          const score = orderedScore(item)
          return (
          <div key={item.id} className="min-w-[104px] flex-1 basis-[104px] rounded-md border border-gray-300 p-3">
            <span
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-base font-black"
              style={{
                background: FORM_STYLE[item.result].bg,
                color: FORM_STYLE[item.result].fg,
                border: FORM_STYLE[item.result].border ? `2px solid ${FORM_STYLE[item.result].border}` : undefined,
              }}
            >
              {letter[item.result]}
            </span>
            {/* Zichtbaar niet nodig naast de letter-badge (dubbelop in het
                kleine kaartje), maar blijft als tekst in de DOM staan — o.a.
                MatchFormCards.test.tsx toetst hierop via container.textContent. */}
            <span className="sr-only">{label[item.result]}</span>
            {item.result !== 'unknown' && score !== null && (
              <p className="mt-1 text-sm font-black text-gray-900">{score.first}–{score.second}</p>
            )}
            {/* Geen "vs "-prefix meer hier (wel elders in het print-blok, bij
                de hoofd-matchup) — het ontwerp toont in deze kaartjes alleen
                de kale tegenstandernaam. */}
            {item.opponent && (
              <p className="truncate text-xs font-extrabold uppercase text-gray-900">{item.opponent}</p>
            )}
            <p className="text-[10px] uppercase text-gray-500">{formatDateShort(item.date, t.browserLocale)}</p>
          </div>
          )
        })}
      </div>
    </div>
  )
}
