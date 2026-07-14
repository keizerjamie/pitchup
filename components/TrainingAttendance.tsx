'use client'

import { useState, useTransition, useEffect } from 'react'
import Link from 'next/link'
import { updateAttendance, markAllPresent } from '@/app/actions/attendance'
import { AttendanceStatus, Player } from '@/lib/types'
import { useDict } from '@/lib/i18n-context'

// Kleur als accent, niet als vlak: witte kaart, gekleurde linkerrand + statusdot.
// Teal = aanwezig, rood = afwezig (oranje is gereserveerd voor CTA's).
const CHIP_CARD: Record<AttendanceStatus, string> = {
  present: 'border-teal-600/25 border-l-teal-600',
  absent:  'border-red-200 border-l-red-600',
  unknown: 'border-gray-200 border-l-gray-300',
}

const CHIP_BADGE: Record<AttendanceStatus, string> = {
  present: 'bg-teal-50 text-teal-700',
  absent:  'bg-red-50 text-red-700',
  unknown: 'bg-gray-100 text-gray-500',
}

const CHIP_DOT: Record<AttendanceStatus, string> = {
  present: 'bg-teal-600 text-white',
  absent:  'bg-red-600 text-white',
  unknown: 'bg-gray-200 text-gray-500',
}

const CHIP_ICONS: Record<AttendanceStatus, string> = {
  present: '✓',
  absent:  '✗',
  unknown: '?',
}

const STATUS_OPTIONS: { key: AttendanceStatus; icon: string; style: string; active: string }[] = [
  {
    key:    'present',
    icon:   '✓',
    style:  'border-gray-100 text-gray-700 hover:border-teal-200 hover:bg-teal-50',
    active: 'border-teal-600 bg-teal-600 text-white',
  },
  {
    key:    'absent',
    icon:   '✗',
    style:  'border-gray-100 text-gray-700 hover:border-red-200 hover:bg-red-50',
    active: 'border-red-600 bg-red-600 text-white',
  },
  {
    key:    'unknown',
    icon:   '?',
    style:  'border-gray-100 text-gray-700 hover:border-gray-300 hover:bg-gray-50',
    active: 'border-gray-400 bg-gray-100 text-gray-700',
  },
]

interface Props {
  eventId: string
  players: Player[]
  initialStatuses: Record<string, AttendanceStatus>
}

export default function TrainingAttendance({ eventId, players, initialStatuses }: Props) {
  const [statuses, setStatuses]       = useState(initialStatuses)
  const [activePlayer, setActivePlayer] = useState<Player | null>(null)
  const [sheetVisible, setSheetVisible] = useState(false)
  const [isPending, startTransition]  = useTransition()
  const t = useDict()

  // Two-step open: mount → next frame → animate in
  function openSheet(player: Player) {
    setActivePlayer(player)
    requestAnimationFrame(() => setSheetVisible(true))
  }

  function closeSheet() {
    setSheetVisible(false)
    setTimeout(() => setActivePlayer(null), 300)
  }

  function selectStatus(status: AttendanceStatus) {
    if (!activePlayer) return
    const playerId = activePlayer.id
    setStatuses(s => ({ ...s, [playerId]: status }))
    closeSheet()
    startTransition(() => updateAttendance(eventId, playerId, status))
  }

  function handleMarkAll() {
    const all: Record<string, AttendanceStatus> = {}
    players.forEach(p => { all[p.id] = 'present' })
    setStatuses(all)
    startTransition(() => markAllPresent(eventId))
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') closeSheet() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Lock body scroll while sheet is open
  useEffect(() => {
    if (activePlayer) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [activePlayer])

  if (players.length === 0) {
    return (
      <div className="bg-white rounded-xl p-6 text-center border border-dashed border-gray-200">
        <p className="text-gray-500 text-sm">
          <Link href="/players/new" className="text-brand font-medium">{t.players.add}</Link>
        </p>
      </div>
    )
  }

  const present = players.filter(p => statuses[p.id] === 'present')
  const absent  = players.filter(p => statuses[p.id] === 'absent')
  const unknown = players.filter(p => (statuses[p.id] ?? 'unknown') === 'unknown')

  const groups = [
    { key: 'present' as AttendanceStatus, list: present, label: t.event.presentStat, accent: 'text-teal-700' },
    { key: 'absent'  as AttendanceStatus, list: absent,  label: t.event.absentStat,  accent: 'text-red-700' },
    { key: 'unknown' as AttendanceStatus, list: unknown, label: t.event.unknownStat, accent: 'text-gray-400' },
  ]

  const currentStatus = activePlayer ? (statuses[activePlayer.id] ?? 'unknown') : null

  return (
    <>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">{t.event.attendance}</h2>
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={isPending}
            className="text-sm font-medium text-brand bg-brand-light px-3 py-1.5 rounded-lg hover:bg-brand-light/70 transition-colors disabled:opacity-60"
          >
            {t.event.markAllPresent}
          </button>
        </div>

        {groups.map(({ key, list, label, accent }) =>
          list.length === 0 ? null : (
            <div key={key}>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${accent}`}>
                {label} ({list.length})
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
                {list.map(player => {
                  const s = statuses[player.id] ?? 'unknown'
                  return (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => openSheet(player)}
                      disabled={isPending}
                      className={`flex items-center gap-2 pl-2.5 pr-3 py-2.5 rounded-r-xl bg-white border border-l-[3px] transition-all active:scale-95 text-left ${CHIP_CARD[s]} ${isPending ? 'opacity-70' : ''}`}
                    >
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${CHIP_BADGE[s]}`}>
                        {player.jersey_number ?? '#'}
                      </span>
                      <span className="flex-1 text-sm font-semibold text-gray-900 truncate">{player.name}</span>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${CHIP_DOT[s]}`}>
                        {CHIP_ICONS[s]}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        )}
      </div>

      {/* Bottom sheet overlay */}
      {activePlayer && (
        <div className={`fixed inset-0 z-[300] flex flex-col justify-end transition-opacity duration-300 ${sheetVisible ? 'opacity-100' : 'opacity-0'}`}>
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={closeSheet}
          />

          {/* Sheet */}
          <div
            className={`relative rounded-t-3xl overflow-hidden transition-transform duration-300 ease-out w-full max-w-lg mx-auto ${sheetVisible ? 'translate-y-0' : 'translate-y-full'}`}
            style={{
              background: 'rgba(248, 248, 252, 0.55)',
              backdropFilter: 'blur(40px) saturate(220%) brightness(1.08)',
              WebkitBackdropFilter: 'blur(40px) saturate(220%) brightness(1.08)',
              boxShadow: '0 -8px 60px rgba(0,0,0,0.18), 0 -1px 0 rgba(255,255,255,0.9) inset, 0 1px 0 rgba(255,255,255,0.4) inset',
            }}
          >
            {/* Specular highlight */}
            <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-white to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />

            {/* Drag handle */}
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="w-8 h-1 rounded-full bg-gray-400/25" />
            </div>

            {/* Player info */}
            <div className="px-4 pt-1.5 pb-3 flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0" style={{ background: 'rgba(0,0,0,0.06)' }}>
                {activePlayer.jersey_number ?? '#'}
              </span>
              <span className="font-semibold text-gray-900">{activePlayer.name}</span>
              <span className="text-xs text-gray-600 ml-auto">{t.event.changeStatus}</span>
            </div>

            {/* Status options */}
            <div className="px-3 pb-3 space-y-1.5">
              {STATUS_OPTIONS.map(({ key, icon, active }) => {
                const isActive = currentStatus === key
                const label = key === 'present' ? t.event.presentStat : key === 'absent' ? t.event.absentStat : t.event.unknownStat
                const iconColor = key === 'present' ? 'text-teal-600' : key === 'absent' ? 'text-red-600' : 'text-gray-500'
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectStatus(key)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all active:scale-[0.97] ${isActive ? active : ''}`}
                    style={!isActive ? {
                      background: 'rgba(255,255,255,0.38)',
                      border: '1px solid rgba(255,255,255,0.95)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.08), 0 1px 0 rgba(255,255,255,0.8) inset',
                    } : undefined}
                  >
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${isActive ? 'bg-white/25 text-white' : iconColor}`} style={!isActive ? { background: 'rgba(0,0,0,0.05)' } : undefined}>
                      {icon}
                    </span>
                    <span className={`flex-1 text-left font-medium text-sm ${isActive ? 'text-white' : 'text-gray-800'}`}>{label}</span>
                    {isActive && (
                      <svg className="w-4 h-4 flex-shrink-0 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Safe area spacer */}
            <div style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }} />
          </div>
        </div>
      )}
    </>
  )
}
