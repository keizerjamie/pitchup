'use client'

import type { LineupPosition } from '@/lib/types'

type FieldPosition = Omit<LineupPosition, 'player_id'>

interface Props {
  positions: FieldPosition[]
  label?: string
  /** Maximale breedte in px; de hoogte volgt de 100/140 veld-aspect-ratio. */
  sizePx?: number
  className?: string
}

// Read-only mini voetbalveld — hergebruikt de veld-SVG-vormgeving uit
// components/LineupBuilder.tsx:160-193 (grasstroken, lijnen, middencirkel,
// strafschopgebieden), maar zonder spelertoewijzing of popup. Volledig
// responsive via aspect-ratio + max-w-full, zodat hij nooit horizontaal laat
// scrollen op smalle viewports.
export default function FormationField({ positions, label, sizePx = 96, className = '' }: Props) {
  return (
    <div className={`flex flex-col items-center max-w-full ${className}`} style={{ width: sizePx, maxWidth: '100%' }}>
      <div
        data-testid="formation-field"
        className="relative w-full max-w-full overflow-hidden rounded-lg shadow-sm"
        style={{ aspectRatio: '100 / 140' }}
      >
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, #1a5c20 0%, #236b28 25%, #2d7d33 50%, #236b28 75%, #1a5c20 100%)' }}
        >
          <svg
            viewBox="0 0 100 140"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            aria-hidden="true"
          >
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <rect key={i} x="0" y={i * 20} width="100" height="20"
                fill={i % 2 === 0 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.015)'} />
            ))}
            <rect x="3" y="3" width="94" height="134" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.65" rx="0.3" />
            <line x1="3" y1="70" x2="97" y2="70" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <circle cx="50" cy="70" r="10" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <circle cx="50" cy="70" r="0.9" fill="rgba(255,255,255,0.85)" />
            <rect x="22" y="110" width="56" height="27" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <rect x="22" y="3" width="56" height="27" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
          </svg>
        </div>

        {/* Position markers */}
        <div className="absolute inset-0" aria-hidden="true">
          {positions.map((pos, i) => (
            <div
              key={i}
              data-testid="formation-marker"
              className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full bg-white text-[7px] font-bold text-[#0d3d38] shadow-[0_1px_3px_rgba(0,0,0,0.35)]"
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: '20%', aspectRatio: '1 / 1' }}
            >
              {pos.position_label}
            </div>
          ))}
        </div>
      </div>
      {label && (
        <p className="mt-1 w-full text-center text-[11px] font-semibold text-muted truncate">{label}</p>
      )}
    </div>
  )
}
