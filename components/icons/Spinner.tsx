// Gedeelde pending-spinner — eerder los gekopieerd in TeamSwitcher.tsx (item
// in behandeling) en CopyOefeningButton.tsx (kopiëren bezig); nu één plek
// (validatieronde fase 3+4, punt 5). Inline SVG i.p.v. het `.ms`-icoonfont:
// dat font is self-hosted en gesubset en bevat geen spinner-/voortgangsglyph
// (zelfde reden als de andere iconen in deze map).
export default function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
