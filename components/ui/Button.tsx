import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

// Eén knop voor de hele app (designronde 3). Vóór deze component stond elke
// knop los gestyled met door elkaar rounded-xl/-lg/-full en minstens vijf
// hoogtes. Kleuren komen uitsluitend uit thema-tokens: --primary, --danger en
// --warning halen alle drie ≥4.5:1 onder witte tekst (zie de contrast-eis in
// app/globals.css), secondary/ghost volgen --surface/--ink en dus dark mode.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning' | 'match'
export type ButtonSize = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none ' +
  'transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97] ' +
  'disabled:opacity-50 disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:pointer-events-none'

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[13px]',
  md: 'h-11 px-5 text-sm',
  lg: 'h-12 px-6 text-[15px]',
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'btn-primary text-white',
  secondary: 'btn-secondary text-ink',
  ghost: 'btn-ghost text-muted hover:text-ink',
  danger: 'btn-danger text-white',
  warning: 'btn-warning text-white',
  // Wedstrijdblauw (--event-match, 5.17:1 met wit) voor acties die specifiek
  // een wedstrijd aanmaken/opslaan, naast trainingsgroen = primary.
  match: 'btn-match text-white',
}

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
}: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string } = {}) {
  return [BASE, SIZES[size], VARIANTS[variant], fullWidth ? 'w-full' : '', className].filter(Boolean).join(' ')
}

interface CommonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  /** Material Symbols-naam (moet in de gesubsette font zitten) of een eigen inline-SVG. */
  icon?: string | ReactNode
  className?: string
  children?: ReactNode
}

function Icon({ icon }: { icon: CommonProps['icon'] }) {
  if (!icon) return null
  if (typeof icon === 'string') return <span className="ms text-[1.25em] -ml-0.5" aria-hidden="true">{icon}</span>
  return <span className="inline-flex -ml-0.5" aria-hidden="true">{icon}</span>
}

type ButtonProps = CommonProps & Omit<ComponentProps<'button'>, 'className' | 'children'> & { loading?: boolean }

export default function Button({
  variant, size, fullWidth, icon, className, children, loading = false, type = 'button', disabled, ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      <Icon icon={icon} />
      {children}
    </button>
  )
}

type LinkButtonProps = CommonProps & Omit<ComponentProps<typeof Link>, 'className' | 'children'>

export function LinkButton({ variant, size, fullWidth, icon, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link className={buttonClasses({ variant, size, fullWidth, className })} {...rest}>
      <Icon icon={icon} />
      {children}
    </Link>
  )
}

// Ronde knop met alleen een icoon (terug, ⋯-menu). aria-label is verplicht:
// zonder zichtbare tekst is dat de enige toegankelijke naam.
type IconButtonProps = Omit<ComponentProps<'button'>, 'aria-label' | 'children'> & {
  'aria-label': string
  children: ReactNode
  size?: 'sm' | 'md'
}

export function IconButton({ className = '', size = 'md', type = 'button', children, ...rest }: IconButtonProps) {
  const dim = size === 'sm' ? 'w-9 h-9' : 'w-11 h-11'
  return (
    <button
      type={type}
      className={`${dim} inline-flex items-center justify-center rounded-full btn-secondary text-muted hover:text-ink transition-[background-color,color,transform] duration-150 active:scale-[0.94] flex-shrink-0 ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
