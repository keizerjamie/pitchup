'use client'

import { useState, useTransition } from 'react'
import { saveLineup } from '@/app/actions/attendance'
import { Player, LineupPosition, FORMATIONS, POSITION_ABBREVIATIONS } from '@/lib/types'
import { useDict } from '@/lib/i18n-context'

const POSITION_LABEL_MAP: Record<string, string> = {
  KP: 'Keeper', LV: 'Linksachter', MV: 'Centrale verdediger', RV: 'Rechtsachter',
  LVB: 'Linksachter', RVB: 'Rechtsachter', DM: 'Defensieve middenvelder',
  CM: 'Centrale middenvelder', LM: 'Linksmiddenvelder', RM: 'Rechtsmiddenvelder',
  '10': 'Aanvallende middenvelder', LA: 'Linksbuiten', RA: 'Rechtsbuiten', SP: 'Spits',
}

const POSITION_FALLBACKS: Record<string, string[]> = {
  'Keeper': [],
  'Linksachter': ['Centrale verdediger', 'Rechtsachter', 'Defensieve middenvelder', 'Linksmiddenvelder'],
  'Centrale verdediger': ['Linksachter', 'Rechtsachter', 'Defensieve middenvelder'],
  'Rechtsachter': ['Centrale verdediger', 'Linksachter', 'Defensieve middenvelder', 'Rechtsmiddenvelder'],
  'Defensieve middenvelder': ['Centrale middenvelder', 'Centrale verdediger', 'Linksachter', 'Rechtsachter'],
  'Centrale middenvelder': ['Defensieve middenvelder', 'Aanvallende middenvelder', 'Linksmiddenvelder', 'Rechtsmiddenvelder'],
  'Linksmiddenvelder': ['Centrale middenvelder', 'Linksbuiten', 'Linksachter'],
  'Rechtsmiddenvelder': ['Centrale middenvelder', 'Rechtsbuiten', 'Rechtsachter'],
  'Aanvallende middenvelder': ['Centrale middenvelder', 'Spits', 'Linksbuiten', 'Rechtsbuiten'],
  'Linksbuiten': ['Linksmiddenvelder', 'Spits', 'Aanvallende middenvelder', 'Rechtsbuiten'],
  'Rechtsbuiten': ['Rechtsmiddenvelder', 'Spits', 'Aanvallende middenvelder', 'Linksbuiten'],
  'Spits': ['Aanvallende middenvelder', 'Linksbuiten', 'Rechtsbuiten'],
}

function getFitScore(player: Player, preferredPos: string): number {
  const isKeeperSlot = preferredPos === 'Keeper'
  const isKeeper = player.position === 'Keeper'
  const secPos = (player.secondary_positions ?? []) as string[]
  if (isKeeperSlot) return isKeeper ? 1.0 : secPos.includes('Keeper') ? 0.85 : 0
  if (isKeeper) return 0
  if (player.position === preferredPos) return 1.0
  if (secPos.includes(preferredPos)) return 0.85
  const fallbacks = POSITION_FALLBACKS[preferredPos] ?? []
  const primaryIdx = fallbacks.indexOf(player.position)
  if (primaryIdx >= 0) return Math.max(0.2, 0.65 - primaryIdx * 0.1)
  for (let i = 0; i < fallbacks.length; i++) {
    if (secPos.includes(fallbacks[i])) return Math.max(0.15, 0.60 - i * 0.1)
  }
  return 0
}

interface Props {
  eventId: string
  players: Player[]
  presentPlayerIds?: string[]
  initialFormation?: string
  initialPositions?: LineupPosition[]
}

export default function LineupBuilder({ eventId, players, presentPlayerIds, initialFormation = '4-3-3', initialPositions }: Props) {
  const t = useDict()
  const [formation, setFormation] = useState(FORMATIONS[initialFormation] ? initialFormation : '4-3-3')
  const [positions, setPositions] = useState<LineupPosition[]>(() => {
    if (initialPositions && initialPositions.length > 0) return initialPositions
    const base = FORMATIONS[initialFormation] ?? FORMATIONS['4-3-3']
    return base.positions.map((p) => ({ ...p, player_id: null }))
  })
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  function handleFormationChange(f: string) {
    setFormation(f)
    setPositions(FORMATIONS[f].positions.map((p) => ({ ...p, player_id: null })))
    setSelectedSlot(null)
  }

  function assignPlayer(playerId: string | null) {
    if (selectedSlot === null) return
    setPositions((prev) => prev.map((p, i) => {
      if (i === selectedSlot) return { ...p, player_id: playerId }
      if (p.player_id === playerId && playerId !== null) return { ...p, player_id: null }
      return p
    }))
    setSelectedSlot(null)
  }

  function autoFillLineup() {
    const presentIds = new Set(presentPlayerIds ?? players.map((p) => p.id))
    const pool = players.filter((p) => presentIds.has(p.id))
    const formationSlots = FORMATIONS[formation].positions
    const DEFAULT_RATING = 5

    const getFit = getFitScore

    const used = new Set<string>()
    const filled = new Map<number, string>()

    while (filled.size < formationSlots.length) {
      let bestScore = -1, bestPlayerId = '', bestSlotIdx = -1
      for (let si = 0; si < formationSlots.length; si++) {
        if (filled.has(si)) continue
        const preferredPos = POSITION_LABEL_MAP[formationSlots[si].position_label] ?? ''
        for (const player of pool) {
          if (used.has(player.id)) continue
          const fit = getFit(player, preferredPos)
          if (fit <= 0) continue
          const score = (player.rating ?? DEFAULT_RATING) * fit
          if (score > bestScore) { bestScore = score; bestPlayerId = player.id; bestSlotIdx = si }
        }
      }
      if (bestScore <= 0) break
      used.add(bestPlayerId)
      filled.set(bestSlotIdx, bestPlayerId)
    }

    setPositions(formationSlots.map((pos, i) => ({ ...pos, player_id: filled.get(i) ?? null })))
    setSelectedSlot(null)
  }

  const assignedPlayerIds = new Set(positions.map((p) => p.player_id).filter(Boolean))
  const availablePlayers = players.filter((p) => !assignedPlayerIds.has(p.id))

  function handleSave() {
    startTransition(async () => {
      await saveLineup(eventId, formation, positions)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  function getPlayerName(playerId: string | null): string {
    if (!playerId) return ''
    const p = players.find((pl) => pl.id === playerId)
    return p ? p.name.split(' ')[0] : ''
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">{t.lineup.formation}</label>
          <button onClick={autoFillLineup} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 active:scale-95 transition-all">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {t.lineup.autoLineup}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {Object.keys(FORMATIONS).map((f) => (
            <button key={f} onClick={() => handleFormationChange(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border-2 transition-colors ${formation === f ? 'bg-brand text-white border-brand' : 'bg-white text-gray-700 border-gray-200 hover:border-accent'}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Pitch */}
      <div className="relative" style={{ paddingTop: '140%' }}>
        {/* Clipped background layer — rounded corners + grass visual */}
        <div
          className="absolute inset-0 rounded-2xl overflow-hidden shadow-2xl"
          style={{ background: 'linear-gradient(180deg, #1a5c20 0%, #236b28 25%, #2d7d33 50%, #236b28 75%, #1a5c20 100%)' }}
        >
          <svg
            viewBox="0 0 100 140"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            style={{ pointerEvents: 'none' }}
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
            <rect x="35" y="127" width="30" height="10" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <rect x="35" y="3" width="30" height="10" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <circle cx="50" cy="121" r="0.9" fill="rgba(255,255,255,0.85)" />
            <circle cx="50" cy="19" r="0.9" fill="rgba(255,255,255,0.85)" />
            <path d="M 6,3 A 3,3 0 0,1 3,6" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <path d="M 94,3 A 3,3 0 0,0 97,6" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <path d="M 3,134 A 3,3 0 0,0 6,137" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <path d="M 94,137 A 3,3 0 0,1 97,134" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <rect x="39" y="137" width="22" height="3" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="0.55" />
            <rect x="39" y="0" width="22" height="3" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="0.55" />
          </svg>
        </div>

        {/* Unclipped interactive layer — popup can overflow the pitch edges */}
        <div className="absolute inset-0">
          {/* Click-away backdrop — closes popup when tapping blank pitch area */}
          {selectedSlot !== null && (
            <div className="absolute inset-0" style={{ zIndex: 5 }} onClick={() => setSelectedSlot(null)} />
          )}

          {/* Player markers */}
          {positions.map((pos, i) => {
            const isSelected = selectedSlot === i
            const hasPlayer = !!pos.player_id
            const displayNum = pos.position_number ?? pos.position_label
            return (
              <button
                key={i}
                onClick={() => setSelectedSlot(isSelected ? null : i)}
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 transition-all duration-150 ${isSelected ? 'scale-110' : ''}`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, zIndex: 10 }}
              >
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-150 ${
                    isSelected
                      ? 'bg-amber-400 text-amber-950 shadow-[0_0_0_3px_rgba(251,191,36,0.5),0_2px_8px_rgba(0,0,0,0.4)]'
                      : hasPlayer
                        ? 'bg-white text-[#0d3d38] shadow-[0_2px_8px_rgba(0,0,0,0.35),0_0_0_2px_rgba(255,255,255,0.9)]'
                        : 'bg-white/10 text-white/50 border border-dashed border-white/35'
                  }`}
                >
                  {hasPlayer ? displayNum : <span className="text-base leading-none">+</span>}
                </div>
                <div className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md text-center max-w-[60px] truncate leading-tight ${hasPlayer ? 'bg-black/45 text-white' : 'bg-black/20 text-white/55'}`}>
                  {hasPlayer ? getPlayerName(pos.player_id) : pos.position_label}
                </div>
              </button>
            )
          })}

          {/* Position popup — appears near the tapped slot */}
          {selectedSlot !== null && (() => {
            const slotPos = positions[selectedSlot]
            const preferredPos = POSITION_LABEL_MAP[slotPos.position_label] ?? ''
            const currentPlayer = slotPos.player_id ? players.find((p) => p.id === slotPos.player_id) : null

            const ranked = availablePlayers
              .map((p) => ({ player: p, score: getFitScore(p, preferredPos) * (p.rating ?? 5) }))
              .sort((a, b) => b.score - a.score)
            const recommended = ranked.find((x) => x.score > 0)?.player ?? null
            const others = ranked.filter((x) => x.player.id !== recommended?.id).map((x) => x.player)

            const isBottom = slotPos.y > 52
            const isLeftEdge = slotPos.x < 38
            const isRightEdge = slotPos.x > 62

            const popupStyle: React.CSSProperties = {
              position: 'absolute',
              top: isBottom ? `calc(${slotPos.y}% - 20px)` : `calc(${slotPos.y}% + 24px)`,
              width: 185,
              zIndex: 20,
            }
            if (isLeftEdge) {
              popupStyle.left = `${slotPos.x}%`
              if (isBottom) popupStyle.transform = 'translateY(-100%)'
            } else if (isRightEdge) {
              popupStyle.right = `${100 - slotPos.x}%`
              if (isBottom) popupStyle.transform = 'translateY(-100%)'
            } else {
              popupStyle.left = `${Math.min(Math.max(slotPos.x, 26), 74)}%`
              popupStyle.transform = isBottom ? 'translate(-50%, -100%)' : 'translateX(-50%)'
            }

            const cardStyle: React.CSSProperties = {
              background: 'rgba(250,250,253,0.90)',
              backdropFilter: 'blur(60px) saturate(200%) brightness(1.04)',
              WebkitBackdropFilter: 'blur(60px) saturate(200%) brightness(1.04)',
              border: '1px solid rgba(255,255,255,0.95)',
              boxShadow: '0 8px 28px rgba(0,0,0,0.22), 0 1px 0 rgba(255,255,255,0.90) inset',
              borderRadius: 13,
              overflow: 'hidden',
            }

            const row = (p: Player, accent?: boolean) => (
              <button
                key={p.id}
                onClick={() => assignPlayer(p.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: accent ? '6px 12px 8px' : '6px 12px',
                  background: accent ? 'rgba(251,191,36,0.10)' : 'transparent',
                  textAlign: 'left', cursor: 'pointer', border: 'none',
                  borderBottom: '1px solid rgba(0,0,0,0.045)',
                }}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: accent ? 'rgba(13,61,56,0.12)' : 'rgba(13,61,56,0.08)',
                  color: '#0d3d38', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
                }}>
                  {p.jersey_number ?? '#'}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: accent ? 13 : 12, fontWeight: accent ? 600 : 500, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name.split(' ')[0]}
                  </div>
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>
                    {POSITION_ABBREVIATIONS[p.position] ?? p.position}{p.rating ? ` · ${p.rating}` : ''}
                  </div>
                </span>
                {accent && <span style={{ fontSize: 12, color: '#d97706', flexShrink: 0 }}>★</span>}
              </button>
            )

            return (
              <div style={popupStyle}>
                <div style={cardStyle}>
                  {/* Header */}
                  <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {slotPos.position_label}{slotPos.position_number ? ` · #${slotPos.position_number}` : ''}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginTop: 1 }}>
                      {preferredPos || slotPos.position_label}
                    </div>
                  </div>

                  {/* Recommended */}
                  {recommended && (
                    <>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#b45309', letterSpacing: '0.07em', padding: '5px 12px 2px', textTransform: 'uppercase' }}>
                        ★ Aanbevolen
                      </div>
                      {row(recommended, true)}
                    </>
                  )}

                  {/* Other available players */}
                  {others.length > 0 && (
                    <div style={{ maxHeight: 130, overflowY: 'auto' }}>
                      {others.map((p) => row(p))}
                    </div>
                  )}

                  {/* Empty state */}
                  {availablePlayers.length === 0 && (
                    <div style={{ padding: '12px', textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
                      {t.lineup.allAssigned}
                    </div>
                  )}

                  {/* Remove current player */}
                  {currentPlayer && (
                    <button
                      onClick={() => assignPlayer(null)}
                      style={{
                        width: '100%', padding: '8px 12px', fontSize: 12, fontWeight: 600,
                        color: '#dc2626', background: 'rgba(220,38,38,0.06)',
                        borderTop: '1px solid rgba(0,0,0,0.06)', border: 'none', cursor: 'pointer',
                        display: 'block', textAlign: 'center',
                      }}
                    >
                      {t.lineup.removePlayer}
                    </button>
                  )}
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Bench */}
      {assignedPlayerIds.size > 0 && availablePlayers.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-600 mb-2">{t.lineup.bench} ({availablePlayers.length})</h3>
          <div className="flex flex-wrap gap-2">
            {availablePlayers.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-full text-xs text-gray-600">
                <span className="font-medium">{p.jersey_number ?? '#'}</span>
                {p.name.split(' ')[0]}
              </span>
            ))}
          </div>
        </div>
      )}

      <button onClick={handleSave} disabled={isPending}
        className={`w-full py-3 rounded-xl font-semibold text-white transition-all ${saved ? 'bg-green-500' : isPending ? 'bg-gray-400' : 'bg-brand hover:bg-brand-dark active:scale-95'}`}>
        {saved ? t.lineup.saved : isPending ? t.lineup.saving : t.lineup.save}
      </button>
    </div>
  )
}
