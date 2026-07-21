import Link from 'next/link'
import { Player, POSITION_GROUPS } from '@/lib/types'
import type { Dict } from '@/messages/nl'

interface Props {
  present: Player[]
  absent: Player[]
  eventId: string
  t: Dict
  className?: string
}

function Chip({ player, tone }: { player: Player; tone: 'present' | 'absent' }) {
  const chip = tone === 'present' ? 'bg-teal-50 text-teal-800' : 'bg-gray-100 text-gray-500'
  const badge = tone === 'present' ? 'bg-teal-600 text-white' : 'bg-gray-200 text-gray-500'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg pl-1 pr-2.5 py-1 text-sm font-medium ${chip}`}>
      <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${badge}`}>
        {player.jersey_number ?? '#'}
      </span>
      {player.name.split(' ')[0]}
    </span>
  )
}

// Read-only overview of who is present / absent for an event, for reference
// while building a lineup or training plan. Editing lives on the event page.
export default function AttendanceSummary({ present, absent, eventId, t, className = '' }: Props) {
  return (
    <div className={`glass-card rounded-2xl overflow-hidden ${className}`}>
      <div className="px-5 py-4 border-b border-white/50 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-gray-800">{t.event.attendance}</h2>
        <span className="text-sm font-semibold text-teal-700 flex-shrink-0">
          {present.length}/{present.length + absent.length}
        </span>
      </div>

      <div className="px-5 py-4 space-y-3.5">
        {present.length === 0 ? (
          <p className="text-sm text-gray-400">{t.event.unknownStat}</p>
        ) : (
          POSITION_GROUPS.map((group) => {
            const gp = present.filter((p) => group.positions.includes(p.position))
            if (gp.length === 0) return null
            return (
              <div key={group.label}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  {t.players.groups[group.label] ?? group.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {gp.map((p) => <Chip key={p.id} player={p} tone="present" />)}
                </div>
              </div>
            )
          })
        )}

        {absent.length > 0 && (
          <div className="pt-3 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
              {t.event.absentStat} ({absent.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {absent.map((p) => <Chip key={p.id} player={p} tone="absent" />)}
            </div>
          </div>
        )}
      </div>

      <Link
        href={`/events/${eventId}`}
        transitionTypes={['nav-back']}
        className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-sm font-medium text-brand hover:bg-brand-light/40 transition-colors"
      >
        {t.event.editAttendance}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  )
}
