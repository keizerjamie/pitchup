'use client'

import { useDict } from '@/lib/i18n-context'

interface Props {
  defaultRating?: number | null
}

// Gedeeld door het aanmaak- en het bewerkformulier van een speler, zodat de
// beoordeling op beide plekken identiek werkt. De lege optie stuurt bewust
// rating="" mee: validatePlayerInput leest dat als "geen beoordeling".
export default function RatingSelector({ defaultRating = null }: Props) {
  const t = useDict()

  return (
    <div>
      <label className="block text-sm font-semibold text-muted mb-2">
        {t.players.rating} <span className="text-faint font-normal">({t.players.optional})</span>
      </label>
      <div className="flex gap-1.5 flex-wrap">
        {[1,2,3,4,5,6,7,8,9,10].map((n) => (
          <label key={n} className="cursor-pointer">
            <input type="radio" name="rating" value={n} defaultChecked={defaultRating === n} className="sr-only peer" />
            <span className="flex items-center justify-center w-9 h-9 rounded-xl border-2 text-sm font-bold border-[var(--border-soft)] text-faint peer-checked:bg-primary peer-checked:border-primary peer-checked:text-white transition">
              {n}
            </span>
          </label>
        ))}
        <label className="cursor-pointer">
          <input type="radio" name="rating" value="" defaultChecked={!defaultRating} className="sr-only peer" />
          <span className="flex items-center justify-center w-9 h-9 rounded-xl border-2 text-xs font-bold border-[var(--border-soft)] text-faint peer-checked:bg-surface-sunken peer-checked:border-[var(--border-soft)] peer-checked:text-muted transition">
            —
          </span>
        </label>
      </div>
    </div>
  )
}
