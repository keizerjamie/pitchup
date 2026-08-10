// Inline SVG i.p.v. het `.ms`-icoonfont: dat font is self-hosted en gesubset
// (app/globals.css:117-140, public/fonts/material-symbols-rounded.woff2), dus
// een ontbrekende glyph ("insights") toont letterlijk de tekst i.p.v. een
// icoon — zelfde patroon als components/icons/ImageIcon.tsx en
// components/PrintButton.tsx.
export default function ChartBarIcon({ className = '' }: { className?: string }) {
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
        d="M4.5 19.5h15M7 16.5v-4M12 16.5V8M17 16.5v-7"
      />
    </svg>
  )
}
