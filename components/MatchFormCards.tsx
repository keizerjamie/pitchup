import { orderedScore, type MatchFormItem } from '@/lib/match-form'
import type { MatchResult } from '@/lib/types'
import { useDict } from '@/lib/i18n-context'

// KleurenFAMILIE (groen/amber/rood) gedeeld met FormStrip.tsx /
// SeizoensrapportPrint.tsx — vaste kleuren, bewust los van de clubkleuren
// (clubkleuren.acceptance AC10). W/V effen, G als outline, onbekend gedempt.
const FORM_STYLE: Record<MatchResult, { bg: string; fg: string; border?: string }> = {
  win: { bg: '#16a34a', fg: '#ffffff' },
  draw: { bg: '#ffffff', fg: 'var(--chip-amber-fg)', border: 'var(--chip-amber-fg)' },
  loss: { bg: '#fee2e2', fg: 'var(--chip-red-fg)' },
  unknown: { bg: 'var(--track)', fg: 'var(--faint)' },
}

// Compacte vormstrip onderaan het witte selectievel (herontwerp 2026-08-24):
// één regel kop + samenvatting, daaronder maximaal vijf kleine cellen met
// letterbadge + uitslag. Tegenstandernaam en datum zijn bewust geschrapt —
// die kapten af in de kaartjes ("TOS ACTIE…") en duwden het blok naar een
// tweede pagina; de uitslag zelf is de informatie die de spelers iets zegt.
//
// HARDE EIS: geen <ul>/<li> — de bestaande acceptatietest
// (wedstrijdselectie.acceptance.test.tsx, AC4) bewijst dat er precies één
// <ul> in het print-blok zit (de spelerslijst).
//
// Score-scheidingsteken: EN-DASH (–, U+2013), niet een gewoon koppelteken —
// elke FORMATIONS-sleutel (bv. "4-3-3") gebruikt uitsluitend het gewone
// koppelteken, dus kan een en-dash-score nooit per ongeluk als
// formatie-tekst gelezen worden (Story-AC12-conventie, ongewijzigd).
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

  // Samenvattingsregel ("3 GEWONNEN · 1 GELIJK · 1 VERLOREN") — 'unknown'
  // telt bewust nergens in mee. Bij 0 items geen samenvatting.
  const won = items.filter((i) => i.result === 'win').length
  const drawn = items.filter((i) => i.result === 'draw').length
  const lost = items.filter((i) => i.result === 'loss').length
  const summaryText = [
    t.matchSquad.formSummaryWon.replace('{n}', String(won)),
    t.matchSquad.formSummaryDrawn.replace('{n}', String(drawn)),
    t.matchSquad.formSummaryLost.replace('{n}', String(lost)),
  ].join(' · ')

  return (
    // De dunne kopstreep in de primaire clubkleur is het enige clubkleur-
    // accent in dit blok (non-tekst; de regressietest op de letterlijke
    // CLUB_COLOR_FALLBACK-hex leunt op precies deze var-aanroep).
    <div className="mt-5 border-t-2 pt-3" style={{ borderColor: 'var(--club-primary, #004f3b)' }}>
      <div className="flex items-end justify-between gap-2">
        <p className="print-accent-text font-pdf-display text-sm font-black uppercase tracking-[0.14em]">{t.matchSquad.formHeading}</p>
        {items.length > 0 && (
          <p className="text-[10px] font-black uppercase tracking-[0.14em] print-poster-meta">{summaryText}</p>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        {items.map((item) => {
          const score = orderedScore(item)
          return (
            <div key={item.id} className="print-form-cel">
              <span
                className="font-pdf-display inline-flex h-8 w-8 items-center justify-center rounded-lg text-base font-black"
                style={{
                  background: FORM_STYLE[item.result].bg,
                  color: FORM_STYLE[item.result].fg,
                  border: FORM_STYLE[item.result].border ? `2px solid ${FORM_STYLE[item.result].border}` : undefined,
                }}
              >
                {letter[item.result]}
              </span>
              {/* Volledige uitkomst als tekst voor assistive technology. */}
              <span className="sr-only">{label[item.result]}</span>
              {item.result !== 'unknown' && score !== null && (
                <span className="font-pdf-display text-sm font-black">{score.first}–{score.second}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
