import Link from 'next/link'
import type { Dict } from '@/messages/nl'

export interface WeekItem {
  id: string
  day: string      // short weekday, e.g. "ZO"
  date: string     // day of month, e.g. "27"
  typeLabel: string
  accent: string   // hex accent per event type
  title: string
  time: string
  place: string
  pct: number | null
}

// "This week": upcoming events rendered as compact rows with a date tile,
// type badge and (when available) an attendance progress readout.
export default function WeekEvents({ items, t }: { items: WeekItem[]; t: Dict }) {
  return (
    <div className="surface-card p-5 flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <span className="font-display text-[17px] font-bold text-ink">{t.home.thisWeek}</span>
        <Link href="/events" className="text-[13px] font-bold text-brand-accent flex items-center gap-1">
          {t.nav.calendar}
          <span className="ms text-[17px]">chevron_right</span>
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="text-[13.5px] text-faint font-medium py-2">{t.home.empty}</p>
      ) : (
        items.map((ev) => (
          <Link
            key={ev.id}
            href={`/events/${ev.id}`}
            className="flex items-center gap-4 p-3 rounded-[15px] bg-surface-sunken transition-colors hover:bg-white"
            style={{ border: '1px solid var(--border-soft)' }}
          >
            <div
              className="w-[52px] h-[56px] rounded-xl bg-surface flex flex-col items-center justify-center leading-none flex-shrink-0"
              style={{ border: '1px solid var(--border-soft)' }}
            >
              <span className="text-[11px] font-extrabold text-faint tracking-wide">{ev.day}</span>
              <span className="font-display text-[22px] font-bold text-ink">{ev.date}</span>
            </div>
            <div className="flex-1 flex flex-col gap-1" style={{ minWidth: 0 }}>
              <div className="flex items-center gap-2.5">
                <span
                  className="text-[10.5px] font-extrabold tracking-wide uppercase text-white px-2 py-[3px] rounded-md"
                  style={{ background: ev.accent }}
                >
                  {ev.typeLabel}
                </span>
                <span className="text-[15px] font-bold text-ink truncate">{ev.title}</span>
              </div>
              <div className="flex items-center gap-3.5 text-[12.5px] font-semibold text-muted">
                {ev.time && (
                  <span className="flex items-center gap-1.5">
                    <span className="ms text-[15px]">schedule</span>{ev.time}
                  </span>
                )}
                {ev.place && (
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="ms text-[15px]">location_on</span>{ev.place}
                  </span>
                )}
              </div>
            </div>
            {ev.pct !== null && (
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <span className="text-[13px] font-bold text-ink">{ev.pct}%</span>
                <div className="w-[66px] h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-soft)' }}>
                  <div className="h-full" style={{ width: `${ev.pct}%`, background: ev.accent }} />
                </div>
              </div>
            )}
          </Link>
        ))
      )}
    </div>
  )
}
