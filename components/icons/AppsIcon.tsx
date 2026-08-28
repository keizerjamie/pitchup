// Inline SVG i.p.v. het `.ms`-icoonfont: dat font is self-hosted en gesubset
// (app/globals.css, public/fonts/material-symbols-rounded.woff2). De voor de
// hand liggende namen voor een app-launcher — `apps`, `grid_view`, `widgets`,
// `more_horiz` — zitten er alle vier NIET in (gecontroleerd tegen de
// GSUB-ligatuurtabel, Extension-lookups type 7), en zouden dus letterlijk de
// tekst "apps" tonen. Zelfde patroon als ChartBarIcon.tsx en UploadIcon.tsx.
export default function AppsIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect x="3.75" y="3.75" width="6.5" height="6.5" rx="2" />
      <rect x="13.75" y="3.75" width="6.5" height="6.5" rx="2" />
      <rect x="3.75" y="13.75" width="6.5" height="6.5" rx="2" />
      <rect x="13.75" y="13.75" width="6.5" height="6.5" rx="2" />
    </svg>
  )
}
