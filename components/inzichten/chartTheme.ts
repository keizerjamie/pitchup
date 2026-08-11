// Gedeelde, theme-aware kleurwaarden voor recharts-props binnen deze map.
//
// De CSS-klassen in app/globals.css (.chart-grid, .chart-axis, ...) winnen
// altijd visueel (CSS-regels hebben een hogere prioriteit dan SVG-
// presentatie-attributen), maar recharts zet zélf een hardcoded hex-default
// (bv. stroke="#ccc", fill="#666", stroke="#3182bd") als SVG-attribuut zodra
// een kleur-prop niet expliciet is meegegeven. Die rauwe hex-tekst blijft dan
// toch in de gerenderde DOM staan. Door hier expliciet `var(--token)`-strings
// door te geven (géén hex) voorkomen we dat recharts zijn eigen hex-default
// invult — precies zoals FormStrip.tsx elders in de app kleuren als
// `var(...)`-string doorgeeft via een inline-prop, niet als hex.
export const GRID_STROKE = 'var(--border-soft)'
export const AXIS_LINE = { stroke: 'var(--border-soft)' }
export const AXIS_TICK_LINE = { stroke: 'var(--border-soft)' }
export const AXIS_TICK = { fill: 'var(--faint)', fontSize: 11 }
