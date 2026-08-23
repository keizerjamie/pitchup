'use client'

import { useState } from 'react'
import { POSITION_GROUPS } from '@/lib/types'
import { useDict } from '@/lib/i18n-context'

interface Props {
  defaultPosition?: string
  defaultSecondaryPositions?: string[]
}

export default function PositionSelector({ defaultPosition, defaultSecondaryPositions = [] }: Props) {
  const [primary, setPrimary] = useState<string>(defaultPosition ?? '')
  const t = useDict()

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-semibold text-muted mb-1.5">{t.players.primaryPosition}</label>
        <select
          name="position"
          required
          value={primary}
          onChange={(e) => setPrimary(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/30 text-ink bg-surface"
        >
          <option value="">{t.players.selectPosition}</option>
          {POSITION_GROUPS.map((group) => (
            <optgroup key={group.label} label={t.players.groups[group.label] ?? group.label}>
              {group.positions.map((p) => (
                <option key={p} value={p}>{t.players.positions[p] ?? p}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-semibold text-muted mb-2">
          {t.players.secondaryPositions} <span className="text-faint font-normal">({t.players.optional})</span>
        </label>
        <div className="space-y-3">
          {POSITION_GROUPS.map((group) => {
            const options = group.positions.filter((p) => p !== primary)
            if (options.length === 0) return null
            return (
              <div key={group.label}>
                <p className="text-xs font-semibold text-faint uppercase tracking-wide mb-1.5">
                  {t.players.groups[group.label] ?? group.label}
                </p>
                <div className="flex flex-wrap gap-2">
                  {options.map((p) => (
                    <label key={p} className="cursor-pointer">
                      <input type="checkbox" name="secondary_positions" value={p} defaultChecked={defaultSecondaryPositions.includes(p)} className="sr-only peer" />
                      <span className="inline-flex items-center px-3 py-1.5 rounded-lg border-2 text-sm font-medium border-[var(--border-soft)] text-muted peer-checked:bg-brand-accent/10 peer-checked:border-brand-accent peer-checked:text-brand-accent transition cursor-pointer">
                        {t.players.positions[p] ?? p}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
