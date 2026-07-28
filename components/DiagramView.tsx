'use client'

import type { Diagram } from '@/lib/types'
import PitchBackground from '@/components/PitchBackground'
import { DiagramArrowDefs, DIAGRAM_ARROW_MARKER_ID, MarkerShape, MateriaalShape, lijnPath, lijnStrokeDasharray } from '@/components/DiagramElements'

interface Props {
  diagram: Diagram | null
  /** Maximale breedte in px; de hoogte volgt de 100/140 veld-aspect-ratio. */
  sizePx?: number
  className?: string
}

// Read-only weergave van het tactiekbord-diagram van een oefening. Zelfde
// SVG-rendering als DiagramEditor (via PitchBackground + DiagramElements),
// maar zonder pointer-handlers, toolbar of state. Rendert niets wanneer
// diagram null is — de aanroeper valt dan terug op de bestaande
// FormationField-previews (oude/ongetekende oefeningen).
export default function DiagramView({ diagram, sizePx = 140, className = '' }: Props) {
  if (!diagram) return null

  return (
    <div className={`max-w-full ${className}`} style={{ width: sizePx, maxWidth: '100%' }}>
      <div
        data-testid="diagram-view"
        className="relative w-full max-w-full overflow-hidden rounded-lg shadow-sm"
        style={{ aspectRatio: '100 / 140' }}
      >
        <PitchBackground />
        <svg viewBox="0 0 100 140" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
          <defs>
            <DiagramArrowDefs />
          </defs>
          {diagram.lijnen.map((lijn, i) => (
            <path
              key={i}
              data-testid={`diagram-view-lijn-${i}`}
              d={lijnPath(lijn)}
              fill="none"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth={0.6}
              strokeDasharray={lijnStrokeDasharray(lijn.stijl)}
              markerEnd={`url(#${DIAGRAM_ARROW_MARKER_ID})`}
            />
          ))}
          {diagram.materiaal.map((m, i) => (
            <MateriaalShape key={i} materiaal={m} testId={`diagram-view-materiaal-${i}`} />
          ))}
          {diagram.markers.map((mk, i) => (
            <MarkerShape key={i} marker={mk} testId={`diagram-view-marker-${i}`} />
          ))}
        </svg>
      </div>
    </div>
  )
}
