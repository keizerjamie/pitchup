'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { OefeningTeam, Player, Spelerindeling } from '@/lib/types'
import { saveSpelerindeling } from '@/app/actions/training-plan'
import { autoAssignTeams } from '@/lib/spelerindeling'
import { useDict } from '@/lib/i18n-context'

// Vanaf hoeveel pixels beweging een pointerdown als "slepen" telt in plaats
// van een tik/klik (die nog steeds moet selecteren, zie toggleSelect). Zelfde
// idee als het select/verwijder-onderscheid in DiagramEditor, maar daar is
// elke pointerdown al ondubbelzinnig een tool-actie — hier moet een simpele
// tik nog steeds als klik werken (toetsenbord/screenreader-fallback blijft
// via onClick lopen, zie handleChipClick).
const DRAG_THRESHOLD_PX = 6

// Zelfde defensieve setPointerCapture/releasePointerCapture-wrapper als
// DiagramEditor (jsdom in tests kent deze methods niet altijd) — hier lokaal
// gehouden omdat DiagramEditor ze niet exporteert en dat bestand buiten scope
// van deze wijziging valt.
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

interface DragState {
  playerId: string
  // Team-index waar de speler ván komt, of null als hij uit de pool komt.
  fromTeamIndex: number | null
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  dragging: boolean
}

interface Props {
  koppelingId: string
  eventId: string
  teams: OefeningTeam[]
  initialIndeling: Spelerindeling
  players: Player[]
  presentPlayerIds: string[]
}

// Normaliseert defensief naar exact `teamCount` sub-arrays (index = teamIndex),
// zodat mutaties altijd een volledige, opslaanbare Spelerindeling opleveren.
// Twee randgevallen die NOOIT mogen crashen:
// - `indeling` is (nog) geen array — bv. omdat de `spelerindeling`-kolom nog
//   niet gemigreerd is en de waarde `undefined` binnenkomt. Valt terug op [].
// - `indeling` heeft MEER sub-arrays dan `teamCount` — bv. omdat het aantal
//   teams van de bibliotheek-oefening is verkleind. De sub-arrays voorbij
//   `teamCount` worden niet meegenomen in de teamkaarten: de spelers erin
//   komen daardoor vanzelf terug in de pool (zie `assignedIds` verderop).
//   `droppedCount` telt hoeveel spelers dat waren, voor de waarschuwing.
function normalize(indeling: unknown, teamCount: number): { teams: string[][]; droppedCount: number } {
  const arr = Array.isArray(indeling) ? indeling : []
  const teams = Array.from({ length: teamCount }, (_, i) => (Array.isArray(arr[i]) ? [...arr[i]] : []))
  const droppedCount = arr
    .slice(teamCount)
    .reduce((sum: number, sub) => sum + (Array.isArray(sub) ? sub.length : 0), 0)
  return { teams, droppedCount }
}

function hasSize(team: OefeningTeam): boolean {
  return Number.isFinite(team.grootte) && team.grootte > 0
}

export default function TeamIndelingEditor({ koppelingId, eventId, teams, initialIndeling, players, presentPlayerIds }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [indeling, setIndeling] = useState<string[][]>(() => normalize(initialIndeling, teams.length).teams)
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [droppedPlayerCount, setDroppedPlayerCount] = useState(
    () => normalize(initialIndeling, teams.length).droppedCount,
  )

  // Laatst bevestigde (succesvol opgeslagen, of van de server ontvangen)
  // indeling. Bij een mislukte save draaien we terug naar DEZE referentie —
  // niet naar een snapshot uit de handler-closure. Zo blijft een rollback
  // correct bij overlappende saves: als save A faalt nadat save B al is
  // geslaagd, wijst deze ref al naar B's resultaat, en verdwijnt B's
  // geslaagde wijziging niet uit beeld.
  const lastConfirmedRef = useRef<string[][]>(normalize(initialIndeling, teams.length).teams)

  // Sync when server revalidates and the parent sends fresh data
  // (adjust-state-during-render pattern instead of a cascading effect)
  const [prevInitial, setPrevInitial] = useState(initialIndeling)
  if (prevInitial !== initialIndeling) {
    setPrevInitial(initialIndeling)
    const resynced = normalize(initialIndeling, teams.length)
    setIndeling(resynced.teams)
    setSelectedPlayerId(null)
    setSaveError(null)
    setDroppedPlayerCount(resynced.droppedCount)
  }

  // Refs mogen niet tijdens render worden gemuteerd (React verbiedt dit,
  // zie react-hooks/refs) — daarom houdt deze effect de "laatst bevestigde"
  // ref in de pas met een nieuwe `initialIndeling` van de server, ná render.
  useEffect(() => {
    lastConfirmedRef.current = normalize(initialIndeling, teams.length).teams
  }, [initialIndeling, teams.length])

  // Drag & drop state — zie de handlers verderop. `teamRefs`/`poolRef` wijzen
  // naar de drop-zone-containers (teamkaarten resp. pool), gebruikt om tijdens
  // het slepen te bepalen boven welke zone de vinger/cursor hangt.
  const teamRefs = useRef<(HTMLDivElement | null)[]>([])
  const poolRef = useRef<HTMLDivElement | null>(null)
  const pointerHandledClickRef = useRef(false)
  // Bron van waarheid voor de sleepstate is een ref, niet state: pointermove/
  // pointerup lezen `dragRef.current` zodat ze binnen dezelfde tick/batch al
  // het verse resultaat van een net verwerkte pointerdown zien. State (`drag`)
  // wordt er alleen nog naast bijgehouden om de UI te laten hertekenen (de
  // visuele volg-transform + ring-highlight) — nooit om de klik/sleep-logica
  // op te beslissen. Zie de bug: bij events die binnen één React-batch
  // binnenkomen (een snelle echte muis-drag) was `drag` (state) in de
  // pointermove-closure nog `null`, waardoor slepen als klik werd behandeld.
  const dragRef = useRef<DragState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hoverZone, setHoverZone] = useState<number | 'pool' | null>(null)

  if (teams.length === 0) return null

  const presentSet = new Set(presentPlayerIds)
  const playerById = new Map(players.map((p) => [p.id, p]))
  const assignedIds = new Set(indeling.flat())
  const presentPlayers = players.filter((p) => presentSet.has(p.id))
  const pool = presentPlayers.filter((p) => !assignedIds.has(p.id))

  function persist(next: string[][]) {
    setIndeling(next)
    setSelectedPlayerId(null)
    setSaveError(null)
    startTransition(async () => {
      try {
        await saveSpelerindeling(koppelingId, eventId, next)
        // Geslaagd: dit is nu de laatst bevestigde indeling.
        lastConfirmedRef.current = next
      } catch {
        // Opslaan mislukt: draai de optimistische state terug naar de laatst
        // bekende opgeslagen indeling (niet naar een snapshot uit deze
        // handler-aanroep) en meld het via een eigen i18n-string — nooit de
        // rauwe (server-)foutmelding aan de gebruiker tonen.
        setIndeling(lastConfirmedRef.current)
        setSaveError(t.teamIndeling.saveError)
      }
    })
  }

  function assignToTeam(playerId: string, teamIndex: number) {
    const next = indeling.map((team) => team.filter((id) => id !== playerId))
    next[teamIndex] = [...next[teamIndex], playerId]
    persist(next)
  }

  function removeFromTeams(playerId: string) {
    const next = indeling.map((team) => team.filter((id) => id !== playerId))
    persist(next)
  }

  function handleAutoAssign() {
    const next = autoAssignTeams({ teams, current: indeling, presentPlayers })
    persist(next)
  }

  function toggleSelect(playerId: string) {
    setSelectedPlayerId((prev) => (prev === playerId ? null : playerId))
  }

  // ── Drag & drop (unified Pointer Events, zelfde patroon als DiagramEditor:
  // pointerdown/move/up + setPointerCapture + touch-action:none) ──
  // Klikken blijft de hoofdweg voor toetsenbord/screenreader: een pointerdown
  // die zonder noemenswaardige beweging weer los komt (pointerup) wordt hier
  // direct als klik (toggleSelect) behandeld. Een "echte" muis-klik die ná een
  // pointerup nog volgt, wordt via handleChipClick + pointerHandledClickRef
  // genegeerd zodat er niet dubbel getoggeld wordt.
  function handleChipPointerDown(playerId: string, fromTeamIndex: number | null, e: ReactPointerEvent<HTMLButtonElement>) {
    captureIfSupported(e.currentTarget, e.pointerId)
    const next: DragState = {
      playerId,
      fromTeamIndex,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      dragging: false,
    }
    // Mutatie van de ref gebeurt hier bewust binnen een event-handler (niet
    // tijdens render), zodat react-hooks/refs hier geen punt van maakt.
    dragRef.current = next
    setDrag(next)
  }

  // Welke teamkaart of de pool bevindt zich op deze schermcoördinaat? Gebruikt
  // rechtstreekse getBoundingClientRect-vergelijking (net als DiagramEditor's
  // toFieldCoords) i.p.v. elementFromPoint/pointerenter — die laatste zijn
  // niet betrouwbaar zodra setPointerCapture actief is, en elementFromPoint
  // werkt sowieso niet in jsdom (geen layout-engine).
  function zoneAt(x: number, y: number): number | 'pool' | null {
    for (let i = 0; i < teamRefs.current.length; i++) {
      const el = teamRefs.current[i]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i
    }
    const poolEl = poolRef.current
    if (poolEl) {
      const r = poolEl.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return 'pool'
    }
    return null
  }

  function handleChipPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const current = dragRef.current
    if (!current || current.pointerId !== e.pointerId) return
    const dx = e.clientX - current.startX
    const dy = e.clientY - current.startY
    const dragging = current.dragging || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX
    const next: DragState = { ...current, x: e.clientX, y: e.clientY, dragging }
    dragRef.current = next
    setDrag(next)
    setHoverZone(dragging ? zoneAt(e.clientX, e.clientY) : null)
  }

  function handleChipPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    releaseIfSupported(e.currentTarget, e.pointerId)
    const current = dragRef.current
    if (!current || current.pointerId !== e.pointerId) return
    const { playerId, fromTeamIndex, dragging } = current
    dragRef.current = null
    setDrag(null)
    setHoverZone(null)
    if (!dragging) {
      // Geen noemenswaardige beweging: gewone tik/klik → selecteren, zoals voorheen.
      toggleSelect(playerId)
      pointerHandledClickRef.current = true
      return
    }
    const zone = zoneAt(e.clientX, e.clientY)
    if (zone === 'pool') {
      if (fromTeamIndex !== null) removeFromTeams(playerId)
    } else if (typeof zone === 'number') {
      if (zone !== fromTeamIndex) assignToTeam(playerId, zone)
    }
    // zone === null: losgelaten buiten elke drop-zone → annuleren, geen wijziging.
  }

  function handleChipPointerCancel() {
    dragRef.current = null
    setDrag(null)
    setHoverZone(null)
  }

  // Fallback voor toetsenbord/screenreader (Enter/Space vuurt een click-event
  // zonder voorafgaande pointer-events). Bij een muis/touch-tik heeft
  // handleChipPointerUp de selectie al gedaan; de click die daar (in echte
  // browsers) nog achteraan komt, wordt hier genegeerd via de ref-vlag.
  function handleChipClick(playerId: string) {
    if (pointerHandledClickRef.current) {
      pointerHandledClickRef.current = false
      return
    }
    toggleSelect(playerId)
  }

  if (presentPlayers.length === 0 && assignedIds.size === 0) {
    return (
      <div className="mt-3 pt-3 border-t border-[var(--border-soft)] space-y-2">
        {droppedPlayerCount > 0 && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            {t.teamIndeling.teamsRemovedWarning.replace('{n}', String(droppedPlayerCount))}
          </p>
        )}
        <p className="text-xs text-faint">{t.teamIndeling.noPresentPlayers}</p>
      </div>
    )
  }

  return (
    <div className="mt-3 pt-3 border-t border-[var(--border-soft)] space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">{t.teamIndeling.heading}</h3>
        <button
          type="button"
          onClick={handleAutoAssign}
          disabled={isPending}
          className="px-3 py-1.5 rounded-lg text-xs font-bold text-white active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100"
          style={{ background: 'var(--color-accent)' }}
        >
          {t.teamIndeling.autoAssign}
        </button>
      </div>

      <p className="text-[11px] text-faint">{t.teamIndeling.dragHint}</p>

      {droppedPlayerCount > 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
          {t.teamIndeling.teamsRemovedWarning.replace('{n}', String(droppedPlayerCount))}
        </p>
      )}

      {saveError && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
          {saveError}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {teams.map((team, i) => {
          const ids = indeling[i] ?? []
          const teamLabel = t.teamIndeling.teamLabel.replace('{n}', String(i + 1))
          const detail = hasSize(team)
            ? `${team.grootte}${team.formatie ? ` · ${team.formatie}` : ''}`
            : t.teamIndeling.losseTeam
          const sizeMismatch = hasSize(team) && ids.length > team.grootte
          const selectedAlreadyHere = selectedPlayerId !== null && ids.includes(selectedPlayerId)

          const isHovered = hoverZone === i

          return (
            <div
              key={i}
              ref={(el) => {
                teamRefs.current[i] = el
              }}
              data-testid={`teamindeling-team-${i}`}
              aria-label={t.teamIndeling.teamDropZoneLabel.replace('{team}', teamLabel)}
              className={`flex-1 min-w-[160px] rounded-xl border p-3 transition-colors ${
                isHovered ? 'border-orange-400 bg-orange-50/60' : 'border-[var(--border-soft)] bg-surface-sunken'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-ink">{teamLabel} · {detail}</span>
                {selectedPlayerId !== null && !selectedAlreadyHere && (
                  <button
                    type="button"
                    onClick={() => assignToTeam(selectedPlayerId, i)}
                    className="text-[11px] font-semibold text-orange-600 hover:text-orange-700 flex-shrink-0"
                  >
                    {t.teamIndeling.moveTo.replace('{team}', teamLabel)}
                  </button>
                )}
              </div>

              {sizeMismatch && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-2">
                  {t.teamIndeling.sizeWarning.replace('{n}', String(team.grootte))}
                </p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {ids.map((id) => {
                  const player = playerById.get(id)
                  const absent = !!player && !presentSet.has(id)
                  const unknown = !player
                  const displayName = player ? player.name.split(' ')[0] : t.teamIndeling.unknownPlayer
                  const draggingThis = drag && drag.dragging && drag.playerId === id ? drag : null
                  return (
                    <span
                      key={id}
                      className={`inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full text-xs font-semibold transition-shadow ${
                        unknown || absent
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : 'bg-surface text-muted border border-[var(--border-soft)]'
                      } ${draggingThis ? 'ring-2 ring-orange-400 shadow-lg' : ''}`}
                      style={
                        draggingThis
                          ? {
                              transform: `translate(${draggingThis.x - draggingThis.startX}px, ${draggingThis.y - draggingThis.startY}px)`,
                              position: 'relative',
                              zIndex: 30,
                            }
                          : undefined
                      }
                    >
                      <button
                        type="button"
                        onClick={() => player && handleChipClick(id)}
                        onPointerDown={(e) => player && handleChipPointerDown(id, i, e)}
                        onPointerMove={handleChipPointerMove}
                        onPointerUp={handleChipPointerUp}
                        onPointerCancel={handleChipPointerCancel}
                        disabled={!player}
                        style={{ touchAction: 'none' }}
                        className="truncate max-w-[110px]"
                      >
                        {displayName}
                      </button>
                      {absent && (
                        <span className="text-[10px] font-semibold text-amber-700">{t.teamIndeling.absentWarning}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeFromTeams(id)}
                        aria-label={`${t.teamIndeling.remove}: ${displayName}`}
                        className="w-4 h-4 flex items-center justify-center text-faint hover:text-red-500 flex-shrink-0"
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div
        ref={poolRef}
        data-testid="teamindeling-pool"
        aria-label={t.teamIndeling.poolDropZoneLabel}
        className={`rounded-xl border-2 p-2 transition-colors ${
          hoverZone === 'pool' ? 'border-orange-400 bg-orange-50/60' : 'border-transparent'
        }`}
      >
        <h4 className="text-xs font-semibold text-muted mb-1.5">{t.teamIndeling.poolLabel}</h4>
        {pool.length === 0 ? (
          <p className="text-xs text-faint">{t.teamIndeling.emptyPool}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {pool.map((p) => {
              const draggingThis = drag && drag.dragging && drag.playerId === p.id ? drag : null
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleChipClick(p.id)}
                  onPointerDown={(e) => handleChipPointerDown(p.id, null, e)}
                  onPointerMove={handleChipPointerMove}
                  onPointerUp={handleChipPointerUp}
                  onPointerCancel={handleChipPointerCancel}
                  style={{
                    touchAction: 'none',
                    ...(draggingThis
                      ? { transform: `translate(${draggingThis.x - draggingThis.startX}px, ${draggingThis.y - draggingThis.startY}px)`, position: 'relative', zIndex: 30 }
                      : undefined),
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                    selectedPlayerId === p.id
                      ? 'bg-orange-100 text-orange-700 border border-orange-300'
                      : 'bg-surface-sunken text-muted border border-[var(--border-soft)] hover:border-orange-300'
                  } ${draggingThis ? 'ring-2 ring-orange-400 shadow-lg' : ''}`}
                >
                  <span className="font-bold text-faint">{p.jersey_number ?? '#'}</span>
                  {p.name.split(' ')[0]}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
