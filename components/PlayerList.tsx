'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Player, POSITION_COLORS, POSITION_GROUPS, POSITION_ABBREVIATIONS } from '@/lib/types'
import { useDict } from '@/lib/i18n-context'

const EditIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
  </svg>
)

const AbsenceIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5m-9-6h.008v.008H12v-.008zm0 2.25h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zm-3.75-4.5h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V15zm0 2.25h.008v.008H8.25v-.008zm7.5-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008z" />
  </svg>
)

const ChevronRight = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
)

interface Props {
  active: Player[]
  inactive: Player[]
}

export default function PlayerList({ active, inactive }: Props) {
  const t = useDict()
  const router = useRouter()
  const [selected, setSelected] = useState<Player | null>(null)
  const [sheetVisible, setSheetVisible] = useState(false)

  function openSheet(player: Player) {
    setSelected(player)
    requestAnimationFrame(() => requestAnimationFrame(() => setSheetVisible(true)))
  }

  function closeSheet() {
    setSheetVisible(false)
    setTimeout(() => setSelected(null), 300)
  }

  function navigate(href: string) {
    closeSheet()
    setTimeout(() => router.push(href), 260)
  }

  useEffect(() => {
    if (!selected) return
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') closeSheet() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [selected])

  const actions = selected ? [
    {
      label: t.players.editLabel,
      icon: <EditIcon />,
      color: '#0d3d38',
      bg: 'rgba(13,61,56,0.10)',
      onClick: () => navigate(`/players/${selected.id}/edit`),
    },
    {
      label: t.players.signOff,
      icon: <AbsenceIcon />,
      color: '#dc2626',
      bg: 'rgba(220,38,38,0.10)',
      onClick: () => navigate(`/players/${selected.id}/absence`),
    },
  ] : []

  return (
    <>
      {/* Active players grouped by position */}
      <div className="space-y-5 stagger">
        {POSITION_GROUPS.map((group) => {
          const groupPlayers = active.filter((p) => group.positions.includes(p.position))
          if (groupPlayers.length === 0) return null
          return (
            <div key={group.label}>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                  {t.players.groups[group.label] ?? group.label}
                </h2>
                <span className="text-xs text-gray-400">({groupPlayers.length})</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {groupPlayers.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => openSheet(player)}
                    className="glass-card-raised rounded-xl w-full flex items-center gap-3 p-4 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 text-left active:scale-[0.99]"
                  >
                    <div className="flex-shrink-0 w-10 h-10 bg-brand-light rounded-full flex items-center justify-center font-bold text-brand text-sm">
                      {player.jersey_number ?? '#'}
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900">{player.name}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {player.rating && (
                        <span className="text-xs font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                          {player.rating}
                        </span>
                      )}
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${POSITION_COLORS[player.position] ?? 'bg-gray-100 text-gray-700'}`}>
                        {POSITION_ABBREVIATIONS[player.position] ?? player.position}
                      </span>
                    </div>
                    <span className="text-gray-300 flex-shrink-0"><ChevronRight /></span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Inactive players */}
      {inactive.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">{t.players.inactiveLabel} ({inactive.length})</h2>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {inactive.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => openSheet(player)}
                className="glass-card-raised rounded-xl w-full p-4 flex items-center gap-4 opacity-50 hover:opacity-70 transition-opacity text-left"
              >
                <div className="flex-shrink-0 w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center font-bold text-gray-500 text-sm">
                  {player.jersey_number ?? '#'}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-700">{player.name}</div>
                </div>
                <span className="text-xs text-gray-400 px-2 py-0.5 rounded-full bg-gray-100">{t.players.inactiveLabel}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom sheet */}
      {selected && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[290]"
            onClick={closeSheet}
            style={{
              background: 'rgba(0,0,0,0.20)',
              backdropFilter: sheetVisible ? 'blur(8px)' : 'blur(0px)',
              WebkitBackdropFilter: sheetVisible ? 'blur(8px)' : 'blur(0px)',
              opacity: sheetVisible ? 1 : 0,
              transition: 'opacity 0.25s ease, backdrop-filter 0.25s ease, -webkit-backdrop-filter 0.25s ease',
            }}
          />

          {/* Sheet */}
          <div
            className="fixed left-0 right-0 z-[300] px-4 max-w-md mx-auto"
            style={{
              bottom: 'max(env(safe-area-inset-bottom), 16px)',
              transform: sheetVisible ? 'translateY(0)' : 'translateY(110%)',
              transition: 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
            }}
          >
            {/* Main card */}
            <div
              className="rounded-2xl overflow-hidden mb-3"
              style={{
                background: 'rgba(248,248,252,0.62)',
                backdropFilter: 'blur(80px) saturate(220%) brightness(1.08)',
                WebkitBackdropFilter: 'blur(80px) saturate(220%) brightness(1.08)',
                border: '1px solid rgba(255,255,255,0.90)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.16), 0 1px 0 rgba(255,255,255,0.95) inset',
              }}
            >
              {/* Specular highlight */}
              <div aria-hidden="true" style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: 'inherit',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.30) 0%, transparent 50%)',
              }} />

              {/* Player header */}
              <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand-light rounded-full flex items-center justify-center font-bold text-brand text-sm flex-shrink-0">
                    {selected.jersey_number ?? '#'}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">{selected.name}</div>
                    <div className="text-xs text-gray-500">{t.players.positions[selected.position] ?? selected.position}</div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              {actions.map((action, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={action.onClick}
                  className="w-full flex items-center gap-4 px-5 py-4 active:bg-black/5 transition-colors text-left"
                  style={{ borderBottom: i < actions.length - 1 ? '1px solid rgba(0,0,0,0.055)' : undefined }}
                >
                  <div style={{
                    width: 38, height: 38, borderRadius: 11,
                    background: action.bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: action.color, flexShrink: 0,
                  }}>
                    {action.icon}
                  </div>
                  <span className="font-semibold text-gray-900 flex-1">{action.label}</span>
                  <span className="text-gray-300"><ChevronRight /></span>
                </button>
              ))}
            </div>

            {/* Cancel button */}
            <button
              type="button"
              onClick={closeSheet}
              className="w-full py-4 rounded-2xl font-semibold text-gray-700"
              style={{
                background: 'rgba(248,248,252,0.62)',
                backdropFilter: 'blur(80px) saturate(220%) brightness(1.08)',
                WebkitBackdropFilter: 'blur(80px) saturate(220%) brightness(1.08)',
                border: '1px solid rgba(255,255,255,0.90)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.16), 0 1px 0 rgba(255,255,255,0.95) inset',
              }}
            >
              {t.players.cancel ?? 'Annuleren'}
            </button>
          </div>
        </>
      )}
    </>
  )
}
