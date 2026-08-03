import type { Dict } from '@/messages/nl'
import { MatchResult } from '@/lib/types'

// Translucent backgrounds read on both light (white) and dark (teal) cards;
// the foreground colour is a theme-aware token so text stays legible in both.
// Colours literally reused from Availability.tsx's STATUS_STYLE — no new
// palette invented here. "unknown" deliberately uses the subtle --faint on
// --track pairing (not --muted), per product decision.
const FORM_STYLE: Record<MatchResult, { bg: string; fg: string }> = {
  win: { bg: 'rgba(22,163,74,0.14)', fg: 'var(--chip-green-fg)' },
  draw: { bg: 'rgba(245,158,11,0.16)', fg: 'var(--chip-amber-fg)' },
  loss: { bg: 'rgba(239,68,68,0.14)', fg: 'var(--chip-red-fg)' },
  unknown: { bg: 'var(--track)', fg: 'var(--faint)' },
}

export interface FormStripItem {
  id: string
  result: MatchResult
}

// Compact W/D/L strip for the last few matches — newest first, driven
// entirely by the pre-sorted `items` prop (no resorting here).
export default function FormStrip({ items, t }: { items: FormStripItem[]; t: Dict }) {
  if (items.length === 0) return null

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
    <div className="flex items-center gap-1 w-full" role="group" aria-label={t.home.formLabel}>
      {items.map((m) => (
        <span
          key={m.id}
          title={label[m.result]}
          aria-label={label[m.result]}
          className="flex-1 min-w-0 max-w-[28px] aspect-square rounded-md flex items-center justify-center text-[13px] sm:text-[15px] font-extrabold font-display"
          style={{ background: FORM_STYLE[m.result].bg, color: FORM_STYLE[m.result].fg }}
        >
          {letter[m.result]}
        </span>
      ))}
    </div>
  )
}
