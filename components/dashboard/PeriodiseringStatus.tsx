import Link from 'next/link'
import type { Dict } from '@/messages/nl'
import type { OnderdeelStatus } from '@/lib/periodization'

// Permanente dashboardkaart met de status van alle vijf meetbare
// periodiseringsonderdelen, plus een informatieve regel voor Steigerungs
// (dat geen nulmeting kent). Vervangt SetupNulmeting volledig (AC 10): er is
// geen "alles-of-niets"-staat meer — vanaf de eerste keer dat het dashboard
// wordt geopend, staat hier per onderdeel "gemeten" of "nog te meten, week X".
//
// Kaartconventie van components/dashboard/TodoList.tsx:63-70 (surface-card
// p-5 flex flex-col gap-3.5, eyebrow-kop, per-item rij met bg-surface-sunken).
//
// Twee harde regels (brief §4.0): status nooit op kleur alleen (altijd woord
// + icoon in de chip), en een gemeten rij is bewust GEEN link (niets te doen);
// alleen "nog te meten"-rijen linken door naar /periodisering, zonder
// deep-link naar het specifieke onderdeel (PM-besluit, user-story.md).
export default function PeriodiseringStatus({
  t,
  items,
  steigerungsWeken,
}: {
  t: Dict
  items: OnderdeelStatus[]
  steigerungsWeken: [number, number]
}) {
  const rowClass = 'flex items-center gap-3 p-3 rounded-[15px] bg-surface-sunken'
  const rowStyle = { border: '1px solid var(--border-soft)' } as const

  return (
    <div className="surface-card p-5 flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint">
          {t.home.periodizationTitle}
        </span>
        <Link href="/periodisering" className="text-[12.5px] font-bold text-brand-accent">
          {t.home.periodizationManage}
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        {items.map((item) => {
          const label = t.periodization.categories[item.key] ?? item.key

          if (item.gemeten) {
            return (
              <div key={item.key} className={rowClass} style={rowStyle}>
                <span className="text-[14px] font-bold text-ink flex-1 min-w-0 truncate">{label}</span>
                <span
                  className="text-[11px] font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1 flex-shrink-0"
                  style={{ background: 'rgba(22,163,74,0.14)', color: 'var(--chip-green-fg)' }}
                >
                  <span className="ms text-[14px]" aria-hidden="true">check_circle</span>
                  {t.home.periodizationMeasured}
                </span>
                <span className="font-display text-[18px] font-bold text-ink tabular-nums flex-shrink-0 w-8 text-right">
                  {item.stap ?? '–'}
                </span>
              </div>
            )
          }

          return (
            <Link
              key={item.key}
              href="/periodisering"
              className={`${rowClass} transition-colors hover:bg-surface active:scale-[0.98]`}
              style={rowStyle}
            >
              <span className="text-[14px] font-bold text-ink flex-1 min-w-0 truncate">{label}</span>
              <span
                className="text-[11px] font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1 flex-shrink-0"
                style={{ background: 'rgba(245,158,11,0.16)', color: 'var(--warning-text)' }}
              >
                <span className="ms text-[14px]" aria-hidden="true">schedule</span>
                {t.home.periodizationToMeasure}
              </span>
              <span className="text-[12px] font-bold text-faint flex-shrink-0">
                {t.home.periodizationDueWeek.replace('{n}', String(item.week))}
              </span>
              <span className="ms text-[18px] text-faint flex-shrink-0" aria-hidden="true">chevron_right</span>
            </Link>
          )
        })}
      </div>

      <p className="text-[12.5px] font-semibold text-faint pt-3 border-t border-[var(--border-soft)]">
        {t.home.periodizationSteigerungs
          .replace('{a}', String(steigerungsWeken[0]))
          .replace('{b}', String(steigerungsWeken[1]))}
      </p>
    </div>
  )
}
