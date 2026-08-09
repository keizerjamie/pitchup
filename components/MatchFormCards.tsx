import type { MatchFormItem } from '@/lib/match-form'
import type { MatchResult } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { useDict } from '@/lib/i18n-context'

// Kleurwaarden LETTERLIJK overgenomen uit components/dashboard/FormStrip.tsx
// (STATUS_STYLE-precedent, zie de comment daar) — dat component zelf wordt
// hier bewust niet hergebruikt/gewijzigd, dit is een nieuw, apart component
// voor het print-blok van de wedstrijdselectie.
const FORM_STYLE: Record<MatchResult, { bg: string; fg: string }> = {
  win: { bg: 'rgba(22,163,74,0.14)', fg: 'var(--chip-green-fg)' },
  draw: { bg: 'rgba(245,158,11,0.16)', fg: 'var(--chip-amber-fg)' },
  loss: { bg: 'rgba(239,68,68,0.14)', fg: 'var(--chip-red-fg)' },
  unknown: { bg: 'var(--track)', fg: 'var(--faint)' },
}

// HARDE EIS: geen <ul>/<li> — de bestaande acceptatietest
// (wedstrijdselectie.acceptance.test.tsx, AC4) bewijst dat er precies één
// <ul> in het print-blok zit (de spelerslijst); een tweede <ul> hier zou die
// test terecht laten falen. Score wordt bewust met een dubbele punt
// weergegeven ("2:1") i.p.v. een liggend streepje: geen enkele
// FORMATIONS-sleutel (bv. "4-3-3") bevat een dubbele punt, dus kan een reeks
// scores nooit per ongeluk zo'n sleutel vormen (zie AC3 in datzelfde bestand).
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

  return (
    <div className="mt-6 border-t-4 border-emerald-900 pt-4">
      <p className="text-sm font-extrabold text-emerald-900">{t.matchSquad.formHeading}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <div key={item.id} className="min-w-[84px] flex-1 basis-[84px] rounded-md border border-gray-300 p-2">
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-extrabold"
              style={{ background: FORM_STYLE[item.result].bg, color: FORM_STYLE[item.result].fg }}
            >
              {letter[item.result]}
            </span>
            {/* Zichtbaar niet nodig naast de letter-badge (dubbelop in het
                kleine kaartje), maar blijft als tekst in de DOM staan — o.a.
                MatchFormCards.test.tsx toetst hierop via container.textContent. */}
            <span className="sr-only">{label[item.result]}</span>
            {item.result !== 'unknown' && item.goalsFor !== null && item.goalsAgainst !== null && (
              <p className="mt-1 text-sm font-extrabold text-gray-900">{item.goalsFor}:{item.goalsAgainst}</p>
            )}
            {item.opponent && (
              <p className="truncate text-xs font-bold text-gray-900">{t.lineup.vsLabel} {item.opponent}</p>
            )}
            <p className="text-[10px] text-gray-500">{formatDate(item.date, t.browserLocale)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
