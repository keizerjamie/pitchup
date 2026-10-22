import type { ReactNode } from 'react'
import BackButton from '@/components/BackButton'
import OverflowMenu, { type OverflowMenuItem } from '@/components/ui/OverflowMenu'

// Vaste paginakop (designronde 3). Overal dezelfde opbouw, zodat knoppen op
// een voorspelbare plek staan:
//   [terug]  titel/ondertitel  ·········  [badge] [primaire actie] [⋯]
// - Eén terugknop-stijl (vervangt de omkaderde, kale en chevron-varianten).
// - `actions`: de hoofdactie(s) van de pagina, altijd rechts.
// - `menu`: secundaire en destructieve acties in het ⋯-menu; nooit naast de
//   hoofdactie en nooit onderaan de pagina.
// Server-component-compatibel: BackButton en OverflowMenu zijn zelf client.

interface Props {
  title: ReactNode
  subtitle?: ReactNode
  eyebrow?: ReactNode
  /** Terugnavigatie; fallback is de route als er geen geschiedenis is. */
  backFallback?: string
  badge?: ReactNode
  actions?: ReactNode
  menu?: OverflowMenuItem[]
  className?: string
}

function BackArrow() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  )
}

// Losse terugknop in exact dezelfde stijl, voor koppen die (nog) een eigen
// opbouw hebben — bv. de trainingsplanner, waarvan de kop ook de printkop is.
export function HeaderBackButton({ fallback, className = '' }: { fallback: string; className?: string }) {
  return (
    <BackButton
      fallback={fallback}
      className={`w-11 h-11 inline-flex items-center justify-center rounded-full btn-secondary text-muted hover:text-ink transition-colors flex-shrink-0 print:hidden ${className}`}
    >
      <BackArrow />
    </BackButton>
  )
}

export default function PageHeader({ title, subtitle, eyebrow, backFallback, badge, actions, menu, className = '' }: Props) {
  return (
    <header className={`flex items-start gap-3 ${className}`}>
      {backFallback && <HeaderBackButton fallback={backFallback} className="-ml-1 mt-0.5" />}
      <div className="flex-1 min-w-0 pt-0.5">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] font-medium text-faint">{subtitle}</p>}
      </div>
      {(badge || actions || (menu && menu.length > 0)) && (
        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
          {badge}
          {actions}
          {menu && <OverflowMenu items={menu} />}
        </div>
      )}
    </header>
  )
}
