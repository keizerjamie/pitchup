// Inline SVG i.p.v. het `.ms`-icoonfont: `delete` zit niet in de gesubsette
// public/fonts/material-symbols-rounded.woff2 (GSUB-check 2026-10-22) — zelfde
// patroon als components/icons/UploadIcon.tsx. Pad gelijk aan het
// prullenbakicoon dat OefeningLibrary al inline tekende.
export default function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  )
}
