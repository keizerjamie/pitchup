import Link from 'next/link'
import type { Dict } from '@/messages/nl'
import { AttendanceStatus } from '@/lib/types'

export interface AvailabilityItem {
  id: string
  initials: string
  avatarBg: string
  name: string
  num: number | null
  pos: string
  status: AttendanceStatus
  injured: boolean
}

// Translucent backgrounds read on both light (white) and dark (teal) cards;
// the foreground colour is a theme-aware token so text stays legible in both.
const STATUS_STYLE: Record<AttendanceStatus, { dot: string; bg: string; fg: string }> = {
  present: { dot: '#16a34a', bg: 'rgba(22,163,74,0.14)',  fg: 'var(--chip-green-fg)' },
  absent:  { dot: '#ef4444', bg: 'rgba(239,68,68,0.14)',  fg: 'var(--chip-red-fg)' },
  unknown: { dot: '#f59e0b', bg: 'rgba(245,158,11,0.16)', fg: 'var(--chip-amber-fg)' },
}

// Availability of the squad for the next event: avatar, name + number/position,
// and a status chip driven by the real attendance records.
export default function Availability({ items, t }: { items: AvailabilityItem[]; t: Dict }) {
  const statusLabel: Record<AttendanceStatus, string> = {
    present: t.home.present,
    absent: t.home.absent,
    unknown: t.home.noResponse,
  }

  return (
    <div className="surface-card p-[18px] flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <span className="font-display text-[16px] font-bold text-ink">{t.home.availability}</span>
        <Link href="/players" className="text-[12.5px] font-bold text-brand-accent">{t.home.seeAll}</Link>
      </div>
      <div className="flex flex-col gap-2 overflow-hidden">
        {items.length === 0 ? (
          <p className="text-[13px] text-faint font-medium">{t.home.empty}</p>
        ) : (
          items.map((p) => {
            const s = STATUS_STYLE[p.status]
            return (
              <div key={p.id} className="flex items-center gap-3">
                <div
                  className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center text-white text-[12.5px] font-bold font-display flex-shrink-0"
                  style={{ background: p.avatarBg }}
                  aria-hidden="true"
                >
                  {p.initials}
                </div>
                <div className="flex-1 flex flex-col leading-tight" style={{ minWidth: 0 }}>
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="text-[13.5px] font-bold text-ink truncate">{p.name}</span>
                    {p.injured && (
                      <span
                        className="ms text-[15px] flex-shrink-0"
                        style={{ color: 'var(--chip-red-fg)' }}
                        title={t.players.injuredBadge}
                        aria-label={t.players.injuredBadge}
                      >
                        healing
                      </span>
                    )}
                  </span>
                  <span className="text-[11.5px] font-semibold text-faint">
                    {p.num != null ? `#${p.num} · ` : ''}{p.pos}
                  </span>
                </div>
                <span
                  className="text-[11px] font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1.5 flex-shrink-0"
                  style={{ background: s.bg, color: s.fg }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
                  {statusLabel[p.status]}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
