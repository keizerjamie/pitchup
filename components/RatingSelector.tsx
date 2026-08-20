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
      <label className="block text-sm font-semibold text-gray-700 mb-2">
        {t.players.rating} <span className="text-gray-400 font-normal">({t.players.optional})</span>
      </label>
      <div className="flex gap-1.5 flex-wrap">
        {[1,2,3,4,5,6,7,8,9,10].map((n) => (
          <label key={n} className="cursor-pointer">
            <input type="radio" name="rating" value={n} defaultChecked={defaultRating === n} className="sr-only peer" />
            <span className="flex items-center justify-center w-9 h-9 rounded-xl border-2 text-sm font-bold border-gray-200 text-gray-400 peer-checked:bg-accent peer-checked:border-accent peer-checked:text-white transition-all">
              {n}
            </span>
          </label>
        ))}
        <label className="cursor-pointer">
          <input type="radio" name="rating" value="" defaultChecked={!defaultRating} className="sr-only peer" />
          <span className="flex items-center justify-center w-9 h-9 rounded-xl border-2 text-xs font-bold border-gray-200 text-gray-300 peer-checked:bg-gray-100 peer-checked:border-gray-300 peer-checked:text-gray-500 transition-all">
            —
          </span>
        </label>
      </div>
    </div>
  )
}
