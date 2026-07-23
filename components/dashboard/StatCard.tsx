import { ReactNode } from 'react'

// A single dashboard statistic card: label + icon, big display value, and an
// optional visual (progress bar / mini chart) plus a subtitle underneath.
export default function StatCard({
  label,
  icon,
  value,
  unit,
  sub,
  children,
}: {
  label: string
  icon: string
  value: ReactNode
  unit?: string
  sub?: string
  children?: ReactNode
}) {
  return (
    <div className="surface-card p-[17px] flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-bold text-muted">{label}</span>
        <span className="ms text-[20px] text-brand-accent">{icon}</span>
      </div>
      <div className="font-display text-[32px] font-bold text-ink leading-none">
        {value}
        {unit && <span className="text-[18px] text-faint font-bold"> {unit}</span>}
      </div>
      {children}
      {sub && <span className="text-[11.5px] font-semibold text-faint">{sub}</span>}
    </div>
  )
}
