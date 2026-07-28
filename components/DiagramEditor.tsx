'use client'

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  DIAGRAM_DOEL_VARIANTEN,
  DIAGRAM_LIJN_STIJLEN,
  type Diagram,
  type DiagramDoelVariant,
  type DiagramLijnStijl,
  type DiagramMarker,
  type DiagramMateriaal,
  type DiagramMateriaalType,
  type OefeningTeam,
  type Veldzone,
} from '@/lib/types'
import { DIAGRAM_MAX_LIJNEN, DIAGRAM_MAX_MARKERS, DIAGRAM_MAX_MATERIAAL, DIAGRAM_MAX_PUNTEN, generateDiagram } from '@/lib/diagram'
import PitchBackground from '@/components/PitchBackground'
import { DiagramArrowDefs, DIAGRAM_ARROW_MARKER_ID, MarkerShape, MateriaalShape, lijnPath, lijnStrokeDasharray } from '@/components/DiagramElements'
import { useDict } from '@/lib/i18n-context'

type ToolMode = 'select' | 'speler' | 'materiaal-pion' | 'materiaal-bal' | 'materiaal-doeltje' | 'lijn' | 'verwijder'

// Kleur/kant-keuze bij handmatig een speler plaatsen. Puur UI-state (geen
// eigen contract-type): bepaalt alleen welke rol/teamIndex de nieuwe
// DiagramMarker krijgt — de kleur zelf volgt daarna gewoon uit de bestaande
// markerFill(rol, teamIndex)-logica in DiagramElements.
type SpelerKant = 'licht' | 'oranje' | 'neutraal'

interface Props {
  value: Diagram | null
  teams: OefeningTeam[]
  aantalNeutralen: number
  veldzone: Veldzone | null
  onChange: (diagram: Diagram) => void
}

const EMPTY_DIAGRAM: Diagram = { markers: [], materiaal: [], lijnen: [] }

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// Bewerkbaar tactiekbord: markers zijn vrij bewerkbaar (toevoegen met de
// speler-tool, slepen, verwijderen); materiaal toevoegen/slepen/verwijderen;
// lijnen tekenen. Teams/formaties blijven alleen het startpunt voor (opnieuw)
// genereren — ze zijn geen vereiste om spelers op het bord te zetten. Werkt
// met muis én touch via Pointer Events (setPointerCapture, zodat move/up bij
// het gesleepte element blijven ook als de cursor buiten de vorm komt).
export default function DiagramEditor({ value, teams, aantalNeutralen, veldzone, onChange }: Props) {
  const t = useDict()
  const svgRef = useRef<SVGSVGElement>(null)

  // Bij mount: als value===null → eenmalig auto-genereren. Bestaat value al
  // (opgeslagen tekening), dan tonen zoals opgeslagen — niet regenereren. De
  // ref-guard voorkomt dat dit bij volgende renders opnieuw afgaat (value
  // wordt pas non-null zodra de parent onChange verwerkt heeft, dus zonder
  // guard zou dit elke render opnieuw kunnen triggeren zolang value nog null is).
  const didAutoGenerate = useRef(false)
  useEffect(() => {
    if (value !== null) return
    if (didAutoGenerate.current) return
    didAutoGenerate.current = true
    onChange(generateDiagram(teams, aantalNeutralen, veldzone))
    // Bewust alleen bij mount/zolang value null blijft — geen regeneratie bij
    // latere team-/veldzone-wijzigingen (dat kan via de expliciete
    // "Opnieuw genereren"-knop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const [toolMode, setToolModeState] = useState<ToolMode>('select')
  const [lijnStijl, setLijnStijl] = useState<DiagramLijnStijl>('pass')
  const [doelVariant, setDoelVariant] = useState<DiagramDoelVariant>('groot')
  const [spelerKant, setSpelerKant] = useState<SpelerKant>('licht')
  const [draftPunten, setDraftPunten] = useState<{ x: number; y: number }[]>([])
  const [dragMarkerIndex, setDragMarkerIndex] = useState<number | null>(null)
  const [dragMateriaalIndex, setDragMateriaalIndex] = useState<number | null>(null)
  const [regenerateConfirm, setRegenerateConfirm] = useState(false)

  function setToolMode(mode: ToolMode) {
    setToolModeState(mode)
    if (mode !== 'lijn') setDraftPunten([])
    setRegenerateConfirm(false)
  }

  const diagram = value ?? EMPTY_DIAGRAM

  function toFieldCoords(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const r = svg.getBoundingClientRect()
    const rawX = ((e.clientX - r.left) / (r.width || 1)) * 100
    const rawY = ((e.clientY - r.top) / (r.height || 1)) * 140
    return { x: clamp(rawX, 0, 100), y: clamp(rawY, 0, 140) }
  }

  function captureIfSupported(el: Element, pointerId: number) {
    if (typeof (el as { setPointerCapture?: unknown }).setPointerCapture === 'function') {
      ;(el as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture(pointerId)
    }
  }

  function releaseIfSupported(el: Element, pointerId: number) {
    if (typeof (el as { releasePointerCapture?: unknown }).releasePointerCapture === 'function') {
      ;(el as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture(pointerId)
    }
  }

  // ── Materiaal toevoegen / lijnpunten verzamelen (tik op het veld) ──
  function handleFieldPointerDown(e: ReactPointerEvent<SVGRectElement>) {
    if (!value) return
    const { x, y } = toFieldCoords(e)
    if (toolMode === 'lijn') {
      setDraftPunten((prev) => (prev.length >= DIAGRAM_MAX_PUNTEN ? prev : [...prev, { x, y }]))
      return
    }
    if (toolMode === 'speler') {
      if (value.markers.length >= DIAGRAM_MAX_MARKERS) return
      const nieuweMarker: DiagramMarker =
        spelerKant === 'licht'
          ? { x, y, teamIndex: 0, rol: 'speler' }
          : spelerKant === 'oranje'
            ? { x, y, teamIndex: 1, rol: 'speler' }
            : { x, y, teamIndex: null, rol: 'neutraal' }
      onChange({ ...value, markers: [...value.markers, nieuweMarker] })
      return
    }
    if (toolMode === 'materiaal-pion' || toolMode === 'materiaal-bal' || toolMode === 'materiaal-doeltje') {
      if (value.materiaal.length >= DIAGRAM_MAX_MATERIAAL) return
      const type = toolMode.slice('materiaal-'.length) as DiagramMateriaalType
      const nieuw: DiagramMateriaal = type === 'doeltje' ? { type, x, y, variant: doelVariant } : { type, x, y }
      onChange({ ...value, materiaal: [...value.materiaal, nieuw] })
    }
  }

  function handleFieldDoubleClick() {
    if (toolMode === 'lijn') finishLine()
  }

  function finishLine() {
    if (!value) return
    if (draftPunten.length >= 2 && value.lijnen.length < DIAGRAM_MAX_LIJNEN) {
      onChange({ ...value, lijnen: [...value.lijnen, { stijl: lijnStijl, punten: draftPunten }] })
    }
    setDraftPunten([])
  }

  // ── Markers: vrij bewerkbaar — toevoegen (via de speler-tool, zie
  // handleFieldPointerDown), slepen in 'select', verwijderen in 'verwijder'.
  // Teams/formaties blijven alleen het startpunt voor (opnieuw) genereren.
  function handleMarkerPointerDown(index: number, e: ReactPointerEvent<SVGGElement>) {
    if (!value) return
    if (toolMode === 'verwijder') {
      e.stopPropagation()
      onChange({ ...value, markers: value.markers.filter((_, i) => i !== index) })
      return
    }
    if (toolMode !== 'select') return
    captureIfSupported(e.currentTarget, e.pointerId)
    setDragMarkerIndex(index)
  }

  function handleMarkerPointerMove(index: number, e: ReactPointerEvent<SVGGElement>) {
    if (dragMarkerIndex !== index || !value) return
    const { x, y } = toFieldCoords(e)
    onChange({ ...value, markers: value.markers.map((m, i) => (i === index ? { ...m, x, y } : m)) })
  }

  function handleMarkerPointerUp(index: number, e: ReactPointerEvent<SVGGElement>) {
    if (dragMarkerIndex === index) setDragMarkerIndex(null)
    releaseIfSupported(e.currentTarget, e.pointerId)
  }

  // ── Materiaal: slepen in 'select', verwijderen in 'verwijder' ──
  function handleMateriaalPointerDown(index: number, e: ReactPointerEvent<SVGGElement>) {
    if (!value) return
    if (toolMode === 'verwijder') {
      e.stopPropagation()
      onChange({ ...value, materiaal: value.materiaal.filter((_, i) => i !== index) })
      return
    }
    if (toolMode === 'select') {
      e.stopPropagation()
      captureIfSupported(e.currentTarget, e.pointerId)
      setDragMateriaalIndex(index)
    }
  }

  function handleMateriaalPointerMove(index: number, e: ReactPointerEvent<SVGGElement>) {
    if (dragMateriaalIndex !== index || !value) return
    const { x, y } = toFieldCoords(e)
    onChange({ ...value, materiaal: value.materiaal.map((m, i) => (i === index ? { ...m, x, y } : m)) })
  }

  function handleMateriaalPointerUp(index: number, e: ReactPointerEvent<SVGGElement>) {
    if (dragMateriaalIndex === index) setDragMateriaalIndex(null)
    releaseIfSupported(e.currentTarget, e.pointerId)
  }

  // ── Lijnen: alleen verwijderen in 'verwijder' ──
  function handleLijnPointerDown(index: number, e: ReactPointerEvent<SVGPathElement>) {
    if (toolMode !== 'verwijder' || !value) return
    e.stopPropagation()
    onChange({ ...value, lijnen: value.lijnen.filter((_, i) => i !== index) })
  }

  function handleRegenerate() {
    onChange(generateDiagram(teams, aantalNeutralen, veldzone))
    setRegenerateConfirm(false)
  }

  function toolButtonClass(active: boolean) {
    return `px-3 py-2 rounded-xl text-xs font-semibold border-2 transition-all whitespace-nowrap ${
      active ? 'bg-orange-500 text-white border-orange-500' : 'border-[var(--border-soft)] text-muted hover:border-orange-300'
    }`
  }

  function segButtonClass(active: boolean) {
    return `px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all whitespace-nowrap ${
      active ? 'bg-orange-500 text-white border-orange-500' : 'border-[var(--border-soft)] text-muted hover:border-orange-300'
    }`
  }

  function lijnStijlLabel(s: DiagramLijnStijl): string {
    if (s === 'pass') return t.oefeningen.lijnStijlPass
    if (s === 'loop') return t.oefeningen.lijnStijlLoop
    return t.oefeningen.lijnStijlDribbel
  }

  function doelVariantLabel(v: DiagramDoelVariant): string {
    if (v === 'groot') return t.oefeningen.doelGroot
    if (v === 'klein') return t.oefeningen.doelKlein
    return t.oefeningen.doelMini
  }

  function spelerKantLabel(k: SpelerKant): string {
    if (k === 'licht') return t.oefeningen.spelerLicht
    if (k === 'oranje') return t.oefeningen.spelerOranje
    return t.oefeningen.spelerNeutraal
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setToolMode('select')} className={toolButtonClass(toolMode === 'select')}>
          {t.oefeningen.toolSelect}
        </button>
        <button type="button" onClick={() => setToolMode('speler')} className={toolButtonClass(toolMode === 'speler')}>
          {t.oefeningen.toolSpeler}
        </button>
        <button type="button" onClick={() => setToolMode('materiaal-pion')} className={toolButtonClass(toolMode === 'materiaal-pion')}>
          {t.oefeningen.toolPion}
        </button>
        <button type="button" onClick={() => setToolMode('materiaal-bal')} className={toolButtonClass(toolMode === 'materiaal-bal')}>
          {t.oefeningen.toolBal}
        </button>
        <button type="button" onClick={() => setToolMode('materiaal-doeltje')} className={toolButtonClass(toolMode === 'materiaal-doeltje')}>
          {t.oefeningen.toolDoeltje}
        </button>
        <button type="button" onClick={() => setToolMode('lijn')} className={toolButtonClass(toolMode === 'lijn')}>
          {t.oefeningen.toolLijn}
        </button>
        <button type="button" onClick={() => setToolMode('verwijder')} className={toolButtonClass(toolMode === 'verwijder')}>
          {t.oefeningen.toolVerwijder}
        </button>
      </div>

      {toolMode === 'speler' && (
        <div className="flex flex-wrap items-center gap-1.5 bg-surface-sunken rounded-xl p-2">
          {(['licht', 'oranje', 'neutraal'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setSpelerKant(k)} className={segButtonClass(spelerKant === k)}>
              {spelerKantLabel(k)}
            </button>
          ))}
        </div>
      )}

      {toolMode === 'materiaal-doeltje' && (
        <div className="flex flex-wrap items-center gap-1.5 bg-surface-sunken rounded-xl p-2">
          {DIAGRAM_DOEL_VARIANTEN.map((v) => (
            <button key={v} type="button" onClick={() => setDoelVariant(v)} className={segButtonClass(doelVariant === v)}>
              {doelVariantLabel(v)}
            </button>
          ))}
        </div>
      )}

      {toolMode === 'lijn' && (
        <div className="flex flex-wrap items-center gap-2 bg-surface-sunken rounded-xl p-2">
          <div className="flex gap-1.5 flex-wrap">
            {DIAGRAM_LIJN_STIJLEN.map((s) => (
              <button key={s} type="button" onClick={() => setLijnStijl(s)} className={segButtonClass(lijnStijl === s)}>
                {lijnStijlLabel(s)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={finishLine}
            disabled={draftPunten.length < 2}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t.oefeningen.lijnKlaar}
          </button>
          <span className="text-[11px] text-faint">{draftPunten.length}</span>
        </div>
      )}

      {/* Veld */}
      <div className="relative w-full mx-auto" style={{ aspectRatio: '100 / 140', maxWidth: 420 }}>
        <div className="absolute inset-0 rounded-xl overflow-hidden shadow-sm">
          <PitchBackground />
          <svg
            ref={svgRef}
            viewBox="0 0 100 140"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            style={{ touchAction: 'none' }}
            data-testid="diagram-svg"
          >
            <defs>
              <DiagramArrowDefs />
            </defs>

            {/* Onzichtbare achtergrond die tikken op leeg veld opvangt (materiaal toevoegen / lijnpunten). */}
            <rect
              x="0"
              y="0"
              width="100"
              height="140"
              fill="transparent"
              data-testid="diagram-field-bg"
              onPointerDown={handleFieldPointerDown}
              onDoubleClick={handleFieldDoubleClick}
            />

            {/* Opgeslagen lijnen */}
            {diagram.lijnen.map((lijn, i) => (
              <path
                key={i}
                data-testid={`diagram-lijn-${i}`}
                d={lijnPath(lijn)}
                fill="none"
                stroke="rgba(255,255,255,0.9)"
                strokeWidth={toolMode === 'verwijder' ? 1.4 : 0.6}
                strokeDasharray={lijnStrokeDasharray(lijn.stijl)}
                markerEnd={`url(#${DIAGRAM_ARROW_MARKER_ID})`}
                onPointerDown={(e) => handleLijnPointerDown(i, e)}
                style={{ cursor: toolMode === 'verwijder' ? 'pointer' : 'default', pointerEvents: toolMode === 'verwijder' ? 'stroke' : 'none' }}
              />
            ))}

            {/* Lijn-in-opbouw: preview + handles per getikt punt */}
            {draftPunten.length > 0 && (
              <>
                {draftPunten.length >= 2 && (
                  <path d={lijnPath({ stijl: lijnStijl, punten: draftPunten })} fill="none" stroke="rgba(255,255,255,0.6)" strokeDasharray="1 1" strokeWidth={0.5} />
                )}
                {draftPunten.map((p, i) => (
                  <circle key={i} data-testid={`diagram-draft-punt-${i}`} cx={p.x} cy={p.y} r={1.2} fill="#fff" stroke="#111827" strokeWidth={0.3} />
                ))}
              </>
            )}

            {/* Materiaal */}
            {diagram.materiaal.map((m, i) => (
              <MateriaalShape
                key={i}
                materiaal={m}
                testId={`diagram-materiaal-${i}`}
                interactive={toolMode === 'select' || toolMode === 'verwijder'}
                onPointerDown={(e) => handleMateriaalPointerDown(i, e)}
                onPointerMove={(e) => handleMateriaalPointerMove(i, e)}
                onPointerUp={(e) => handleMateriaalPointerUp(i, e)}
              />
            ))}

            {/* Markers */}
            {diagram.markers.map((mk, i) => (
              <MarkerShape
                key={i}
                marker={mk}
                testId={`diagram-marker-${i}`}
                interactive={toolMode === 'select' || toolMode === 'verwijder'}
                onPointerDown={(e) => handleMarkerPointerDown(i, e)}
                onPointerMove={(e) => handleMarkerPointerMove(i, e)}
                onPointerUp={(e) => handleMarkerPointerUp(i, e)}
              />
            ))}
          </svg>
        </div>
      </div>

      {/* Opnieuw genereren — inline bevestiging (patroon OefeningLibrary) */}
      <div>
        {!regenerateConfirm ? (
          <button type="button" onClick={() => setRegenerateConfirm(true)} className="text-xs font-semibold text-orange-600 hover:text-orange-700 transition-colors">
            {t.oefeningen.regenerate}
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-wrap rounded-xl border border-orange-200 bg-orange-50 p-2.5">
            <span className="text-xs text-orange-800">{t.oefeningen.regenerateConfirm}</span>
            <button type="button" onClick={handleRegenerate} className="text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg px-3 py-1.5 transition-colors">
              {t.oefeningen.regenerateConfirmButton}
            </button>
            <button type="button" onClick={() => setRegenerateConfirm(false)} className="text-xs font-semibold text-muted hover:text-ink rounded-lg px-3 py-1.5 transition-colors">
              {t.trainingPlan.cancel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
