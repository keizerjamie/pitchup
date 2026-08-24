// Inline SVG i.p.v. het `.ms`-icoonfont: dat font is self-hosted en gesubset
// (public/fonts/material-symbols-rounded.woff2), dus een ontbrekende glyph
// ("upload_file") toont letterlijk de tekst i.p.v. een icoon — zelfde patroon
// als components/icons/ChartBarIcon.tsx en components/icons/ImageIcon.tsx.
export default function UploadIcon({ className = '' }: { className?: string }) {
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
        d="M12 15.5v-8M8.8 10.2 12 7l3.2 3.2M5 18.5h14"
      />
    </svg>
  )
}
