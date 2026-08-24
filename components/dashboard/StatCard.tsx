import { ReactNode } from 'react'
import Link from 'next/link'

// A single dashboard statistic card: label + icon, big display value, and an
// optional visual (progress bar / mini chart) plus a subtitle underneath.
// With `href` the whole card becomes a drill-down link to the detail page
// (hover-tint via `a.surface-card:hover` in globals.css — een Tailwind
// hover:bg-utility verliest de cascade van de ongelaagde .surface-card).
export default function StatCard({
  label,
  icon,
  value,
  unit,
  sub,
  href,
  children,
}: {
  label: string
  icon: string | ReactNode
  value: ReactNode
  unit?: string
  sub?: string
  href?: string
  children?: ReactNode
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-faint leading-[1.35]">{label}</span>
        {typeof icon === 'string' ? (
          <span className="ms text-[19px] text-brand-accent">{icon}</span>
        ) : (
          <span className="text-brand-accent flex-shrink-0">{icon}</span>
        )}
      </div>
      <div className="font-display text-[32px] font-bold text-ink leading-none">
        {value}
        {unit && <span className="text-[18px] text-faint font-bold"> {unit}</span>}
      </div>
      {children}
      {sub && <span className="text-[11.5px] font-semibold text-faint">{sub}</span>}
    </>
  )

  // NB: de caption-span in de "Actieve spelers"-tegel wordt in
  // gastspelers.acceptance.test.tsx gevonden via `span.text-[11.5px]` — het
  // label hierboven mag dus nooit óók 11.5px worden.
  const base = 'surface-card p-[17px] flex flex-col gap-2.5 h-full'
  if (href) {
    return (
      <Link href={href} className={`${base} transition-[background-color,transform] active:scale-[0.99]`}>
        {inner}
      </Link>
    )
  }
  return <div className={base}>{inner}</div>
}
