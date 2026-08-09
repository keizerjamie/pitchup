// Inline SVG i.p.v. het `.ms`-icoonfont: dat font is self-hosted en gesubset
// (app/globals.css:117-140, public/fonts/material-symbols-rounded.woff2), dus
// een ontbrekende glyph toont letterlijk de tekst "image" i.p.v. een icoon —
// zie ook components/PrintButton.tsx voor hetzelfde patroon. Gedeeld tussen
// TeamLogoSection (lege-avatar fallback) en de "Clublogo"-sectiekop in
// app/settings/page.tsx, zodat het pad niet dubbel voorkomt.
export default function ImageIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
      />
    </svg>
  )
}
