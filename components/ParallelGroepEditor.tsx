'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Player, TrainingOefeningWithData } from '@/lib/types'
import { saveParallelIndeling, verplaatsParallelSpeler } from '@/app/actions/training-plan'
import { groepStatus } from '@/lib/parallel-groep'
import { useDict } from '@/lib/i18n-context'

// Eigen sleepmechaniek voor deze editor (bewuste keuze, zie V3 in de brief):
// géén gedeelde hook met TeamIndelingEditor.tsx, tijdelijke duplicatie van het
// patroon is geaccepteerd. Zie TeamIndelingEditor.tsx voor het principe waarop
// dit is gebaseerd (DRAG_THRESHOLD_PX, ref-gebaseerde sleepstate,
// getBoundingClientRect-zone-detectie).
const DRAG_THRESHOLD_PX = 6

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

// Zone waarboven een sleep eindigt: het id van een groepslid (koppelingId),
// 'pool', of null (buiten elke drop-zone — annuleren).
type Zone = string | 'pool' | null

interface DragState {
  playerId: string
  // koppelingId van het lid waar de speler vandaan komt, of null vanuit de pool.
  fromZone: string | null
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  dragging: boolean
}

interface Props {
  eventId: string
  groepId: string
  leden: TrainingOefeningWithData[]
  players: Player[]
  presentPlayerIds: string[]
}

// Platte verdeling per lid, defensief gelezen (parallel_spelers is optioneel
// getypeerd — zie lib/types.ts:249-250 en de bevestigde beslissingen).
function buildAssignments(leden: TrainingOefeningWithData[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const lid of leden) {
    out[lid.id] = Array.isArray(lid.parallel_spelers) ? [...lid.parallel_spelers] : []
  }
  return out
}

export default function ParallelGroepEditor({ eventId, groepId, leden, players, presentPlayerIds }: Props) {
  const t = useDict()
  const [, startTransition] = useTransition()
  const [assignments, setAssignments] = useState<Record<string, string[]>>(() => buildAssignments(leden))
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // `leden` komt van TrainingPlanEditor's `blokkenVanKoppelingen(koppelingen)`,
  // die bij ELKE render een gloednieuwe array-identiteit oplevert — ook als er
  // niets aan déze groep veranderde (bv. een sibling-koppeling wijzigt zijn
  // stap_override). Een reference-check (`prevLeden !== leden`, zoals
  // TeamIndelingEditor's `prevInitial`-patroon) zou hier dus bij vrijwel elke
  // render onterecht resyncen en een actief foutbanner wegvagen. Daarom hier
  // een waarde-signatuur (id + parallel_spelers) i.p.v. reference-equality —
  // zelfde doel als het EMPTY_INDELING-patroon in TrainingPlanEditor.tsx,
  // andere techniek omdat de bron hier geen stabiele array-identiteit biedt.
  const ledenSignature = useMemo(
    () => JSON.stringify(leden.map((l) => [l.id, l.parallel_spelers ?? []])),
    [leden],
  )

  const lastConfirmedRef = useRef<Record<string, string[]>>(buildAssignments(leden))

  const [prevSignature, setPrevSignature] = useState(ledenSignature)
  if (prevSignature !== ledenSignature) {
    setPrevSignature(ledenSignature)
    setAssignments(buildAssignments(leden))
    setSelectedPlayerId(null)
    setSaveError(null)
  }

  useEffect(() => {
    lastConfirmedRef.current = buildAssignments(leden)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledenSignature])

  const memberRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const poolRef = useRef<HTMLDivElement | null>(null)
  const pointerHandledClickRef = useRef(false)
  // Bron van waarheid voor de sleepstate is een ref, niet state — zie de
  // toelichting bij TeamIndelingEditor.tsx:122-131 (bekende bug-klasse: state
  // in een pointermove-closure kan nog de vorige waarde zien binnen één
  // React-batch).
  const dragRef = useRef<DragState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hoverZone, setHoverZone] = useState<Zone>(null)

  if (leden.length === 0) return null

  const presentSet = new Set(presentPlayerIds)
  const playerById = new Map(players.map((p) => [p.id, p]))
  const assignedIds = new Set(Object.values(assignments).flat())
  const presentPlayers = players.filter((p) => presentSet.has(p.id))
  const pool = presentPlayers.filter((p) => !assignedIds.has(p.id))

  const status = groepStatus({
    leden: leden.map((l) => ({ id: l.id, parallel_spelers: assignments[l.id] ?? [], oefeningen: l.oefeningen })),
    presentPlayerIds,
  })
  const statusByLid = new Map(status.perLid.map((s) => [s.koppelingId, s]))

  function persist(next: Record<string, string[]>, save: () => Promise<void>) {
    setAssignments(next)
    setSelectedPlayerId(null)
    setSaveError(null)
    startTransition(async () => {
      try {
        await save()
        lastConfirmedRef.current = next
      } catch {
        // Nooit de rauwe serverfout tonen — generieke i18n-melding, en
        // rollback naar de laatst bevestigde verdeling (niet naar een
        // snapshot uit deze handler-aanroep, zelfde principe als
        // TeamIndelingEditor's lastConfirmedRef). Bij verplaatsParallelSpeler
        // heeft de server bij een fout de bron al intern hersteld, dus deze
        // rollback blijft ook daar correct.
        setAssignments(lastConfirmedRef.current)
        setSaveError(t.parallelGroep.saveError)
      }
    })
  }

  function findCurrentMember(playerId: string): string | null {
    for (const lid of leden) {
      if ((assignments[lid.id] ?? []).includes(playerId)) return lid.id
    }
    return null
  }

  function assignToMember(playerId: string, targetId: string) {
    const sourceId = findCurrentMember(playerId)
    if (sourceId === targetId) return
    const next: Record<string, string[]> = { ...assignments }
    if (sourceId) next[sourceId] = (assignments[sourceId] ?? []).filter((id) => id !== playerId)
    next[targetId] = [...(assignments[targetId] ?? []), playerId]
    if (sourceId) {
      // Lid → lid: één atomaire server-aanroep (verplaatsParallelSpeler) i.p.v.
      // twee losse saveParallelIndeling-writes — bij een fout op de tweede
      // write herstelt de server intern de eerste, zodat de speler nooit
      // stilzwijgend bij niemand meer staat.
      persist(next, () => verplaatsParallelSpeler(eventId, sourceId, targetId, playerId))
    } else {
      // Pool → lid: raakt maar één rij, blijft via saveParallelIndeling lopen.
      persist(next, () => saveParallelIndeling(targetId, eventId, next[targetId]))
    }
  }

  function removeFromGroup(playerId: string) {
    const sourceId = findCurrentMember(playerId)
    if (!sourceId) return
    const next: Record<string, string[]> = {
      ...assignments,
      [sourceId]: (assignments[sourceId] ?? []).filter((id) => id !== playerId),
    }
    // Lid → pool: raakt maar één rij, blijft via saveParallelIndeling lopen.
    persist(next, () => saveParallelIndeling(sourceId, eventId, next[sourceId]))
  }

  function toggleSelect(playerId: string) {
    setSelectedPlayerId((prev) => (prev === playerId ? null : playerId))
  }

  // Zone-detectie via getBoundingClientRect-vergelijking — NIET elementFromPoint
  // (werkt niet in jsdom en niet betrouwbaar onder pointer capture).
  function zoneAt(x: number, y: number): Zone {
    for (const lid of leden) {
      const el = memberRefs.current.get(lid.id)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return lid.id
    }
    const poolEl = poolRef.current
    if (poolEl) {
      const r = poolEl.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return 'pool'
    }
    return null
  }

  function handleChipPointerDown(playerId: string, fromZone: string | null, e: ReactPointerEvent<HTMLButtonElement>) {
    captureIfSupported(e.currentTarget, e.pointerId)
    const next: DragState = {
      playerId,
      fromZone,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      dragging: false,
    }
    dragRef.current = next
    setDrag(next)
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
    const { playerId, fromZone, dragging } = current
    dragRef.current = null
    setDrag(null)
    setHoverZone(null)
    if (!dragging) {
      // Geen noemenswaardige beweging: gewone tik/klik → selecteren.
      toggleSelect(playerId)
      pointerHandledClickRef.current = true
      return
    }
    const zone = zoneAt(e.clientX, e.clientY)
    if (zone === 'pool') {
      if (fromZone !== null) removeFromGroup(playerId)
    } else if (typeof zone === 'string') {
      assignToMember(playerId, zone)
    }
    // zone === null: losgelaten buiten elke drop-zone → annuleren, geen wijziging.
  }

  function handleChipPointerCancel() {
    dragRef.current = null
    setDrag(null)
    setHoverZone(null)
  }

  // Fallback voor toetsenbord/screenreader (Enter/Space vuurt een click-event
  // zonder voorafgaande pointer-events).
  function handleChipClick(playerId: string) {
    if (pointerHandledClickRef.current) {
      pointerHandledClickRef.current = false
      return
    }
    toggleSelect(playerId)
  }

  return (
    <div
      data-testid={`parallelgroep-editor-${groepId}`}
      className="mt-3 pt-3 border-t border-[var(--border-soft)] print:mt-[1mm] print:pt-[1mm]"
    >
      {/* Interactieve editor — alleen op scherm. Print krijgt hieronder een
          eigen, compactere weergave die dezelfde lokale `assignments`-state
          leest (V6: alleen namen, geen tekort/overschot). Zelfde dual-markup-
          principe als TeamIndelingEditor.tsx:295-300,477-507. */}
      <div className="print:hidden space-y-3">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">{t.parallelGroep.heading}</h3>
        <p className="text-[11px] text-faint">{t.parallelGroep.dragHint}</p>

        {saveError && (
          <p className="text-xs text-panel-red-ink bg-panel-red border border-panel-red-edge rounded-lg px-2 py-1">{saveError}</p>
        )}

        <div className="flex flex-wrap gap-3">
          {leden.map((lid) => {
            const ids = assignments[lid.id] ?? []
            const memberLabel = lid.oefeningen.naam
            const stat = statusByLid.get(lid.id)
            const isHovered = hoverZone === lid.id
            const selectedAlreadyHere = selectedPlayerId !== null && ids.includes(selectedPlayerId)

            return (
              <div
                key={lid.id}
                ref={(el) => {
                  memberRefs.current.set(lid.id, el)
                }}
                data-testid={`parallelgroep-lid-${lid.id}`}
                aria-label={t.parallelGroep.dropZoneLabel.replace('{target}', memberLabel)}
                className={`flex-1 min-w-[160px] rounded-xl border p-3 transition-colors ${
                  isHovered ? 'border-warning bg-panel-orange/60' : 'border-[var(--border-soft)] bg-surface-sunken'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-ink">
                    {memberLabel}
                    {stat && stat.benodigd !== null && (
                      <span className="text-faint"> · {stat.toegewezen}/{stat.benodigd}</span>
                    )}
                    {stat && stat.benodigd === null && (
                      <span className="text-faint"> · {t.parallelGroep.geenEis}</span>
                    )}
                  </span>
                  {selectedPlayerId !== null && !selectedAlreadyHere && (
                    <button
                      type="button"
                      onClick={() => assignToMember(selectedPlayerId, lid.id)}
                      className="text-[11px] font-semibold text-warning-text hover:text-panel-orange-ink flex-shrink-0"
                    >
                      {t.parallelGroep.moveTo.replace('{target}', memberLabel)}
                    </button>
                  )}
                </div>

                {stat && stat.benodigd !== null && stat.tekort > 0 && (
                  <p className="text-[11px] text-panel-amber-ink bg-panel-amber border border-panel-amber-edge rounded-lg px-2 py-1 mb-2">
                    {t.parallelGroep.tekort.replace('{n}', String(stat.tekort))}
                  </p>
                )}
                {stat && stat.benodigd !== null && stat.overschot > 0 && (
                  <p className="text-[11px] text-panel-amber-ink bg-panel-amber border border-panel-amber-edge rounded-lg px-2 py-1 mb-2">
                    {t.parallelGroep.overschot.replace('{n}', String(stat.overschot))}
                  </p>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {ids.map((id) => {
                    const player = playerById.get(id)
                    const absent = !!player && !presentSet.has(id)
                    const unknown = !player
                    const displayName = player ? player.name.split(' ')[0] : t.parallelGroep.unknownPlayer
                    const draggingThis = drag && drag.dragging && drag.playerId === id ? drag : null
                    return (
                      <span
                        key={id}
                        className={`inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full text-xs font-semibold transition-shadow ${
                          unknown || absent
                            ? 'bg-panel-amber text-panel-amber-ink border border-panel-amber-edge'
                            : 'bg-surface text-muted border border-[var(--border-soft)]'
                        } ${draggingThis ? 'ring-2 ring-warning shadow-lg' : ''}`}
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
                          onPointerDown={(e) => player && handleChipPointerDown(id, lid.id, e)}
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
                          <span className="text-[10px] font-semibold text-panel-amber-ink">{t.parallelGroep.absentWarning}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeFromGroup(id)}
                          aria-label={`${t.parallelGroep.remove}: ${displayName}`}
                          className="w-4 h-4 flex items-center justify-center text-faint hover:text-panel-red-ink flex-shrink-0"
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
          data-testid="parallelgroep-pool"
          aria-label={t.parallelGroep.dropZoneLabel.replace('{target}', t.parallelGroep.poolLabel)}
          className={`rounded-xl border-2 p-2 transition-colors ${
            hoverZone === 'pool' ? 'border-warning bg-panel-orange/60' : 'border-transparent'
          }`}
        >
          <h4 className="text-xs font-semibold text-muted mb-1.5">{t.parallelGroep.poolLabel}</h4>
          {pool.length === 0 ? (
            <p className="text-xs text-faint">{t.parallelGroep.emptyPool}</p>
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
                        ? 'bg-panel-orange text-panel-orange-ink border border-panel-orange-edge'
                        : 'bg-surface-sunken text-muted border border-[var(--border-soft)] hover:border-warning/50'
                    } ${draggingThis ? 'ring-2 ring-warning shadow-lg' : ''}`}
                  >
                    <span className="font-bold text-faint">{p.jersey_number ?? '#'}</span>
                    {p.name.split(' ')[0]}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {status.compleet ? (
          <p className="text-xs font-semibold text-panel-green-ink bg-panel-green border border-panel-green-edge rounded-lg px-2 py-1">
            {t.parallelGroep.compleet}
          </p>
        ) : (
          status.nietIngedeeld.length > 0 && (
            <p className="text-xs text-panel-amber-ink bg-panel-amber border border-panel-amber-edge rounded-lg px-2 py-1">
              {t.parallelGroep.nietIngedeeld.replace('{n}', String(status.nietIngedeeld.length))}
            </p>
          )
        )}
      </div>

      {/* Print-only: alleen namen per oefening, GEEN tekort/overschot (V6). */}
      <div data-testid="parallelgroep-print" className="hidden print:block print:text-[9px] print:leading-snug print:text-ink">
        {leden.map((lid) => {
          const ids = assignments[lid.id] ?? []
          if (ids.length === 0) return null
          const names = ids
            .map((id) => {
              const player = playerById.get(id)
              if (!player) return t.parallelGroep.unknownPlayer
              const absent = !presentSet.has(id)
              return absent ? `${player.name} (${t.parallelGroep.absentWarning})` : player.name
            })
            .join(', ')
          return (
            <p key={lid.id}>
              <span className="font-bold">{lid.oefeningen.naam}</span>: {names}
            </p>
          )
        })}
        {pool.length > 0 && (
          <p>
            <span className="font-bold">{t.parallelGroep.poolLabelPrint}</span>: {pool.map((p) => p.name).join(', ')}
          </p>
        )}
      </div>
    </div>
  )
}
