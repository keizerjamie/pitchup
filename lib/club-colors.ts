// Clubkleuren: sleutels, validatie en fallback voor de twee kleurinstellingen.
//
// Bewust geen 'use server' en geen React: hierdoor is dit los te testen én te
// delen tussen de server action (app/actions/team-colors.ts) en de
// server-components die de kleuren ophalen. Zelfde opzet als lib/logo-upload.ts:
// een 'use server'-bestand mag alleen async functies exporteren, dus constanten
// en pure helpers kunnen daar niet wonen.

// De twee keys in de bestaande key/value-tabel `settings`
// (supabase/settings.sql). Geen nieuwe tabel of kolom: de PK is (team_id, key),
// dus elk team heeft hooguit één rij per kleur.
export const CLUB_COLOR_KEYS = {
  primary: 'team_color_primary',
  secondary: 'team_color_secondary',
} as const

export type ClubColorSlot = keyof typeof CLUB_COLOR_KEYS

// Afwezigheid van de settings-rij = "niet ingesteld" = deze fallback. We slaan
// bewust nooit een lege string op (settings.value is NOT NULL en een lege
// waarde zou niet te onderscheiden zijn van "bewust wit").
// De waarden zijn de kleuren die de print-weergave vandaag al gebruikt:
// Tailwind v4 (oklch) emerald-900 en emerald-600, hier als hun sRGB-hex
// (#004f3b / #009966) — niet de oudere Tailwind v3-hex (#064e3b / #059669),
// die in dit project een zichtbaar ander groen zou zijn.
export const CLUB_COLOR_FALLBACK = {
  primary: '#004f3b',
  secondary: '#009966',
} as const

export type ClubColors = { primary: string; secondary: string }

// Optionele '#', daarna precies 3 of 6 hex-cijfers. Hoofdletters mogen erin,
// de uitvoer is altijd lowercase.
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

// Whitelist voor de slot-parameter van de server actions. Zonder deze check zou
// een client een wíllekeurige settings-key van zijn team kunnen overschrijven of
// wissen (bijv. team_logo_url of season_start). Expliciete literalvergelijking
// i.p.v. een lookup in CLUB_COLOR_KEYS: dan kan '__proto__'/'constructor' ook
// niet per ongeluk als geldige sleutel binnenkomen.
export function isClubColorSlot(value: unknown): value is ClubColorSlot {
  return value === 'primary' || value === 'secondary'
}

// Normaliseert vrije invoer naar de canonieke vorm '#rrggbb' (lowercase, 7
// tekens) of null als het geen geldige hexkleur is. Een 3-cijferige hex wordt
// geëxpandeerd ('#abc' → '#aabbcc'), zodat er in de database maar één formaat
// voorkomt en vergelijken/tonen nooit op de schrijfwijze hoeft te letten.
export function normalizeHexColor(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const match = HEX_RE.exec(input.trim())
  if (!match) return null
  const digits = match[1].toLowerCase()
  const full = digits.length === 3
    ? digits[0] + digits[0] + digits[1] + digits[1] + digits[2] + digits[2]
    : digits
  return `#${full}`
}

// Zet de (team-gescopede) settings-map om in twee kant-en-klare kleuren. Elke
// kleur wordt los afgehandeld: alleen primair ingesteld betekent primair
// ingesteld + secundair fallback. Een onparseerbare waarde in de database
// (handmatig gezet, of ooit in een ander formaat opgeslagen) valt terug op de
// fallback in plaats van een kapotte kleur door te geven — de uitkomst is dus
// nooit leeg of undefined.
export function resolveClubColors(settings: Record<string, string>): ClubColors {
  return {
    primary: normalizeHexColor(settings[CLUB_COLOR_KEYS.primary]) ?? CLUB_COLOR_FALLBACK.primary,
    secondary: normalizeHexColor(settings[CLUB_COLOR_KEYS.secondary]) ?? CLUB_COLOR_FALLBACK.secondary,
  }
}
