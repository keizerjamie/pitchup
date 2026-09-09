// Inline SVG i.p.v. het `.ms`-icoonfont: dat font is self-hosted en gesubset
// (public/fonts/material-symbols-rounded.woff2) en mist "expand_more"/
// "expand_less", dus een ontbrekende glyph toont letterlijk de tekst i.p.v.
// een icoon — zelfde patroon als components/icons/ChartBarIcon.tsx en
// components/icons/UploadIcon.tsx. Eén gedeeld icoon voor alle drie de
// dicht/openklap-plekken (NulmetingManager, OefeningEditor, LineupBuilder):
// dicht = naar beneden, `open` roteert 'm naar boven.
export default function ChevronIcon({
  open = false,
  className = '',
}: {
  open?: boolean
  className?: string
}) {
  return (
    <svg
      className={`transition-transform duration-200 ${open ? 'rotate-180' : ''} ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9.5 12 15.5 18 9.5" />
    </svg>
  )
}
