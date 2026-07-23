'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { updateAttendance, markAllPresent } from '@/app/actions/attendance'
import { AttendanceStatus, Player, POSITION_ABBREVIATIONS } from '@/lib/types'
import { useDict } from '@/lib/i18n-context'

const AVATAR_BG = ['#16a34a', '#14655c', '#0d3d38', '#1a6b63', '#0f766e', '#15803d']
function initialsOf(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean)
  if (w.length === 0) return '?'
  return (w.length >= 2 ? w[0][0] + w[w.length - 1][0] : w[0].slice(0, 2)).toUpperCase()
}
function avatarBg(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_BG[h % AVATAR_BG.length]
}

interface Props {
  eventId: string
  players: Player[]
  initialStatuses: Record<string, AttendanceStatus>
}

export default function TrainingAttendance({ eventId, players, initialStatuses }: Props) {
  const [statuses, setStatuses] = useState(initialStatuses)
  const [isPending, startTransition] = useTransition()
  const t = useDict()

  function setStatus(playerId: string, status: AttendanceStatus) {
    // Clicking the active button again clears back to "unknown".
    const next: AttendanceStatus = (statuses[playerId] ?? 'unknown') === status ? 'unknown' : status
    setStatuses((s) => ({ ...s, [playerId]: next }))
    startTransition(() => updateAttendance(eventId, playerId, next))
  }

  function handleMarkAll() {
    const all: Record<string, AttendanceStatus> = {}
    players.forEach((p) => { all[p.id] = 'present' })
    setStatuses(all)
    startTransition(() => markAllPresent(eventId))
  }

  if (players.length === 0) {
    return (
      <div className="surface-card p-6 text-center">
        <p className="text-faint text-sm">
          <Link href="/players/new" className="text-brand-accent font-bold">{t.players.add}</Link>
        </p>
      </div>
    )
  }

  const total = players.length
  const present = players.filter((p) => statuses[p.id] === 'present').length
  const absent = players.filter((p) => statuses[p.id] === 'absent').length
  const unknown = total - present - absent
  const turnout = total > 0 ? Math.round((present / total) * 100) : 0

  return (
    <div className="flex flex-col gap-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(120deg,#0d3d38,#14655c)' }}>
          <div className="text-[12.5px] font-bold" style={{ color: '#9fd8cd' }}>{t.event.turnout}</div>
          <div className="font-display text-[30px] font-bold mt-1">{turnout}%</div>
        </div>
        <StatMini dot="#22c55e" label={t.event.presentStat} value={present} />
        <StatMini dot="#ef4444" label={t.event.absentStat} value={absent} />
        <StatMini dot="#f59e0b" label={t.event.unknownStat} value={unknown} />
      </div>

      {/* List header */}
      <div className="flex items-center justify-between">
        <span className="font-display text-[17px] font-bold text-ink">{t.event.attendance}</span>
        <button
          type="button"
          onClick={handleMarkAll}
          disabled={isPending}
          className="h-9 px-3 rounded-lg text-[13px] font-bold text-brand-accent hover:bg-surface-sunken transition-colors disabled:opacity-60"
          style={{ background: 'color-mix(in srgb, var(--primary) 10%, transparent)' }}
        >
          {t.event.markAllPresent}
        </button>
      </div>

      {/* Player rows */}
      <div className="surface-card overflow-hidden">
        {players.map((player, i) => {
          const s = statuses[player.id] ?? 'unknown'
          return (
            <div key={player.id} className="flex items-center gap-3 px-4 py-2.5"
              style={i > 0 ? { borderTop: '1px solid var(--border-soft)' } : undefined}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-[13px] font-bold font-display flex-shrink-0"
                style={{ background: avatarBg(player.name) }} aria-hidden="true">
                {initialsOf(player.name)}
              </div>
              <div className="flex-1 min-w-0 flex flex-col leading-tight">
                <span className="text-[14.5px] font-bold text-ink truncate">{player.name}</span>
                <span className="text-[12px] font-semibold text-faint">
                  {player.jersey_number != null ? `#${player.jersey_number} · ` : ''}
                  {POSITION_ABBREVIATIONS[player.position] ?? player.position}
                </span>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <StatusButton
                  active={s === 'present'} onClick={() => setStatus(player.id, 'present')} disabled={isPending}
                  icon="check" label={t.event.presentStat} activeBg="var(--primary)" />
                <StatusButton
                  active={s === 'absent'} onClick={() => setStatus(player.id, 'absent')} disabled={isPending}
                  icon="close" label={t.event.absentStat} activeBg="#dc2626" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatMini({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <div className="surface-card p-4">
      <div className="flex items-center gap-2 text-[12.5px] font-bold text-muted">
        <span className="w-[9px] h-[9px] rounded-full" style={{ background: dot }} />{label}
      </div>
      <div className="font-display text-[30px] font-bold text-ink mt-1">{value}</div>
    </div>
  )
}

function StatusButton({
  active, onClick, disabled, icon, label, activeBg,
}: {
  active: boolean; onClick: () => void; disabled: boolean; icon: string; label: string; activeBg: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className="h-9 rounded-[10px] px-3 flex items-center gap-1.5 text-[12.5px] font-bold transition-colors disabled:opacity-60"
      style={active
        ? { background: activeBg, color: '#fff' }
        : { background: 'var(--surface-sunken)', color: 'var(--muted)', border: '1px solid var(--border-soft)' }}
    >
      <span className="ms text-[17px]">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
