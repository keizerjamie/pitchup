'use client'

import type { PointerEvent } from 'react'
import type { DiagramDoelVariant, DiagramLijn, DiagramLijnStijl, DiagramMarker, DiagramMarkerRol, DiagramMateriaal } from '@/lib/types'

// Gedeelde, puur presentationele bouwstenen voor het tactiekbord: kleuren,
// vormen en lijn-paden. Geen state, geen business-logica (die zit in
// lib/diagram.ts). Hergebruikt door DiagramEditor (interactief) en
// DiagramView (read-only) om duplicatie te voorkomen.

// team0 = licht/wit, team1 = oranje, extra teams = afgeleide tinten.
const TEAM_COLORS = ['#f8fafc', '#f97316', '#38bdf8', '#a78bfa', '#4ade80', '#f472b6']
const NEUTRAL_COLOR = '#facc15'
const KEEPER_ACCENT = '#dc2626'
const DEFAULT_STROKE = '#111827'

export function markerFill(rol: DiagramMarkerRol, teamIndex: number | null): string {
  if (rol === 'neutraal') return NEUTRAL_COLOR
  return TEAM_COLORS[(teamIndex ?? 0) % TEAM_COLORS.length]
}

export function markerStroke(rol: DiagramMarkerRol): string {
  return rol === 'keeper' ? KEEPER_ACCENT : DEFAULT_STROKE
}

export function markerStrokeWidth(rol: DiagramMarkerRol): number {
  return rol === 'keeper' ? 0.75 : 0.45
}

// Zichtbare grootte van een speler-/keeper-/neutraal-marker (0-100×0-140-
// stelsel). Klein genoeg om proportioneel als speler op het veld te ogen.
const MARKER_RADIUS = 2.5
// Onzichtbare, grotere hit-area rond de marker zodat hij op mobiel/touch nog
// goed te pakken is ondanks de kleinere zichtbare cirkel.
const MARKER_HIT_RADIUS = 5
const MARKER_LABEL_FONT_SIZE = 2.3

export const DIAGRAM_ARROW_MARKER_ID = 'diagram-arrowhead'

// <marker> arrowhead-definitie, te plaatsen binnen een <defs> in de SVG.
export function DiagramArrowDefs() {
  return (
    <marker
      id={DIAGRAM_ARROW_MARKER_ID}
      viewBox="0 0 10 10"
      refX="8"
      refY="5"
      markerWidth="3.2"
      markerHeight="3.2"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.9)" />
    </marker>
  )
}

// Bereken het SVG-path (d-attribuut) voor een lijn. pass/loop: rechte
// segmenten tussen de opgegeven punten (stijlverschil zit in dasharray).
// dribbel: golvend (sinus) pad, per segment gesampeld.
export function lijnPath(lijn: Pick<DiagramLijn, 'stijl' | 'punten'>): string {
  const pts = lijn.punten
  if (pts.length < 2) return ''
  if (lijn.stijl !== 'dribbel') {
    return `M ${pts.map((p) => `${p.x},${p.y}`).join(' L ')}`
  }
  const AMPLITUDE = 2.2
  const parts: string[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const waves = Math.max(2, Math.round(len / 8))
    const steps = waves * 8
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const baseX = a.x + dx * t
      const baseY = a.y + dy * t
      const offset = Math.sin(t * waves * Math.PI * 2) * AMPLITUDE
      const x = baseX + nx * offset
      const y = baseY + ny * offset
      parts.push(`${i === 0 && s === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`)
    }
  }
  return parts.join(' ')
}

export function lijnStrokeDasharray(stijl: DiagramLijnStijl): string | undefined {
  return stijl === 'loop' ? '2.5 1.5' : undefined
}

// Vijfhoek-hoekpunten rond (cx, cy) met straal r, punt naar boven.
function pentagonPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 5; i++) {
    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`)
  }
  return pts.join(' ')
}

// Herkenbare voetbal: witte cirkel + zwarte centrale vijfhoek + radiale
// "naad"-lijnen (klassiek panelpatroon), puur decoratief/geometrisch.
function SoccerBall({ x, y }: { x: number; y: number }) {
  const OUTER_R = 1.8
  const PENTAGON_R = 0.72
  return (
    <g>
      <circle cx={x} cy={y} r={OUTER_R} fill="#ffffff" stroke="#111827" strokeWidth={0.3} />
      {[0, 1, 2, 3, 4].map((i) => {
        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2
        const x1 = x + PENTAGON_R * Math.cos(angle)
        const y1 = y + PENTAGON_R * Math.sin(angle)
        const x2 = x + OUTER_R * 0.92 * Math.cos(angle)
        const y2 = y + OUTER_R * 0.92 * Math.sin(angle)
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#111827" strokeWidth={0.18} />
      })}
      <polygon points={pentagonPoints(x, y, PENTAGON_R)} fill="#111827" />
    </g>
  )
}

// Afmetingen per doeltje-variant (0-100×0-140-stelsel).
const GOAL_DIMENSIONS: Record<DiagramDoelVariant, { width: number; height: number; postWidth: number; strokeWidth: number; netLines: number }> = {
  groot: { width: 7, height: 3, postWidth: 0.5, strokeWidth: 0.55, netLines: 4 },
  klein: { width: 5, height: 2.2, postWidth: 0.4, strokeWidth: 0.5, netLines: 3 },
  mini: { width: 3, height: 1.3, postWidth: 0.3, strokeWidth: 0.4, netLines: 0 },
}

// Doeltje: per variant een passende doelvorm (groot = breed + palen + nethint,
// klein = kleiner, mini = kleinst/laag, geen nethint).
function GoalShape({ x, y, variant }: { x: number; y: number; variant: DiagramDoelVariant }) {
  const { width, height, postWidth, strokeWidth, netLines } = GOAL_DIMENSIONS[variant]
  const left = x - width / 2
  const top = y - height / 2
  return (
    <g>
      <rect x={left} y={top} width={width} height={height} rx={0.25} fill="none" stroke="#ffffff" strokeWidth={strokeWidth} />
      <rect x={left} y={top} width={postWidth} height={height} fill="#ffffff" />
      <rect x={left + width - postWidth} y={top} width={postWidth} height={height} fill="#ffffff" />
      {netLines > 0 &&
        Array.from({ length: netLines }, (_, i) => {
          const gx = left + ((i + 1) * width) / (netLines + 1)
          return <line key={i} x1={gx} y1={top} x2={gx} y2={top + height} stroke="rgba(255,255,255,0.5)" strokeWidth={0.18} />
        })}
    </g>
  )
}

interface MarkerShapeProps {
  marker: DiagramMarker
  testId?: string
  interactive?: boolean
  onPointerDown?: (e: PointerEvent<SVGGElement>) => void
  onPointerMove?: (e: PointerEvent<SVGGElement>) => void
  onPointerUp?: (e: PointerEvent<SVGGElement>) => void
}

// Eén speler-/keeper-/neutraal-marker. Zonder handlers = puur read-only. De
// zichtbare cirkel is bewust klein (proportioneel); een onzichtbare, grotere
// hit-cirkel binnen dezelfde <g> zorgt dat slepen op touch haalbaar blijft
// (pointer-events bubbelen naar de <g> waar de handlers op zitten).
export function MarkerShape({ marker, testId, interactive, onPointerDown, onPointerMove, onPointerUp }: MarkerShapeProps) {
  return (
    <g
      data-testid={testId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ cursor: interactive ? 'grab' : 'default', touchAction: 'none' }}
    >
      {interactive && (
        // Bewust zonder eigen data-testid: puur een grotere, onzichtbare
        // hit-area binnen dezelfde <g> (events bubbelen naar de handlers
        // hierboven), niet bedoeld als los te bevragen testelement — anders
        // zou een testid-substring-match op de marker per ongeluk ook dit
        // element meetellen.
        <circle cx={marker.x} cy={marker.y} r={MARKER_HIT_RADIUS} fill="transparent" />
      )}
      <circle
        cx={marker.x}
        cy={marker.y}
        r={MARKER_RADIUS}
        fill={markerFill(marker.rol, marker.teamIndex)}
        stroke={markerStroke(marker.rol)}
        strokeWidth={markerStrokeWidth(marker.rol)}
      />
      {/* Handmatig geplaatste/losjes geplaatste markers (bv. via de speler-tool,
          of een team zonder formatie) hebben bewust geen label — render dan
          gewoon geen <text>, in plaats van een lege/rare tekst-node. */}
      {Boolean(marker.label) && (
        <text x={marker.x} y={marker.y + 0.85} textAnchor="middle" fontSize={MARKER_LABEL_FONT_SIZE} fontWeight={700} fill="#0d3d38">
          {marker.label}
        </text>
      )}
    </g>
  )
}

interface MateriaalShapeProps {
  materiaal: DiagramMateriaal
  testId?: string
  interactive?: boolean
  onPointerDown?: (e: PointerEvent<SVGGElement>) => void
  onPointerMove?: (e: PointerEvent<SVGGElement>) => void
  onPointerUp?: (e: PointerEvent<SVGGElement>) => void
}

// Eén materiaal-item: pion (driehoek), bal (cirkel) of doeltje (kleine
// doelvorm). Zonder handlers = puur read-only.
export function MateriaalShape({ materiaal, testId, interactive, onPointerDown, onPointerMove, onPointerUp }: MateriaalShapeProps) {
  const { type, x, y } = materiaal
  return (
    <g
      data-testid={testId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ cursor: interactive ? 'pointer' : 'default', touchAction: 'none' }}
    >
      {type === 'pion' && (
        <polygon
          points={`${x},${y - 1.8} ${x - 1.6},${y + 1.4} ${x + 1.6},${y + 1.4}`}
          fill="#f97316"
          stroke="#7c2d12"
          strokeWidth={0.3}
        />
      )}
      {type === 'bal' && <SoccerBall x={x} y={y} />}
      {type === 'doeltje' && <GoalShape x={x} y={y} variant={materiaal.variant ?? 'groot'} />}
    </g>
  )
}
