'use client'

// Gedeelde veld-decoratie (grasstroken, veldlijnen, middencirkel, straf- en
// doelgebieden, hoekschopbogen) voor het tactiekbord-diagram. Puur
// presentational — geen state, geen handlers. Hergebruikt de vormgeving uit
// components/LineupBuilder.tsx:160-193 zodat DiagramEditor/DiagramView niet
// hun eigen veld-SVG hoeven te verzinnen. components/FormationField.tsx blijft
// bewust ongewijzigd (eigen, simpelere variant voor de per-team preview).
//
// Verwacht een `relative` (of `absolute inset-0`) ouder-element met de
// gewenste afmetingen/aspect-ratio (100 / 140); deze component vult dat vlak.
export default function PitchBackground() {
  return (
    <div
      className="absolute inset-0"
      style={{ background: 'linear-gradient(180deg, #1a5c20 0%, #236b28 25%, #2d7d33 50%, #236b28 75%, #1a5c20 100%)' }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 140" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <rect key={i} x="0" y={i * 20} width="100" height="20"
            fill={i % 2 === 0 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.015)'} />
        ))}
        <rect x="3" y="3" width="94" height="134" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.65" rx="0.3" />
        <line x1="3" y1="70" x2="97" y2="70" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
        <circle cx="50" cy="70" r="10" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
        <circle cx="50" cy="70" r="0.9" fill="rgba(255,255,255,0.85)" />
        <rect x="22" y="110" width="56" height="27" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
        <rect x="22" y="3" width="56" height="27" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
        <rect x="35" y="127" width="30" height="10" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
        <rect x="35" y="3" width="30" height="10" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
        <circle cx="50" cy="121" r="0.9" fill="rgba(255,255,255,0.85)" />
        <circle cx="50" cy="19" r="0.9" fill="rgba(255,255,255,0.85)" />
        <path d="M 6,3 A 3,3 0 0,1 3,6" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
        <path d="M 94,3 A 3,3 0 0,0 97,6" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
        <path d="M 3,134 A 3,3 0 0,0 6,137" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
        <path d="M 94,137 A 3,3 0 0,1 97,134" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
        <rect x="39" y="137" width="22" height="3" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="0.55" />
        <rect x="39" y="0" width="22" height="3" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="0.55" />
      </svg>
    </div>
  )
}
