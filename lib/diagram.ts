import {
  formationsForSize,
  basisFormatieDef,
  normalizeOefeningTeam,
  DIAGRAM_MARKER_ROLLEN,
  DIAGRAM_MATERIAAL_TYPES,
  DIAGRAM_DOEL_VARIANTEN,
  DIAGRAM_LIJN_STIJLEN,
  type OefeningTeam,
  type Veldzone,
  type Diagram,
  type DiagramMarker,
  type DiagramMateriaal,
  type DiagramLijn,
  type DiagramMarkerRol,
  type DiagramMateriaalType,
  type DiagramDoelVariant,
  type DiagramLijnStijl,
  type FormationDef,
} from '@/lib/types'

// Framework-agnostische, pure logica voor het tactiekbord (diagram) van een
// bibliotheek-oefening. Bewust géén 'use server' en geen React: zowel de server
// actions (validatie) als de client (auto-generatie) kunnen dit hergebruiken.
//
// Coördinatenstelsel: x ∈ [0,100], y ∈ [0,140]. Grotere y = eigen doel/helft
// (onderin). Dit verschilt van FormationDef.positions, waar y een PERCENT (0-100)
// is; generateDiagram schaalt die percenten (× 1.4) naar het 0-140-stelsel.

// ── Grenzen voor validateDiagram (server-side normalisatie) ──────────────────
export const DIAGRAM_MAX_MARKERS = 100
export const DIAGRAM_MAX_MATERIAAL = 50
export const DIAGRAM_MAX_LIJNEN = 40
export const DIAGRAM_MAX_PUNTEN = 20
export const DIAGRAM_MAX_TEAM_INDEX = 5

// Clamp een (mogelijk onbetrouwbare) waarde naar [lo, hi]; niet-numeriek → 0.
function clamp(v: unknown, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number(v) || 0))
}

const clampX = (v: unknown) => clamp(v, 0, 100)
const clampY = (v: unknown) => clamp(v, 0, 140)

// ─────────────────────────────────────────────────────────────────────────────
// a) generateDiagram — auto-genereer een startopstelling uit de teams/neutralen
// ─────────────────────────────────────────────────────────────────────────────

// Herschaal een waarde v∈[0,inMax] lineair naar [lo, hi].
function remap(v: number, inMax: number, lo: number, hi: number): number {
  return lo + (v / inMax) * (hi - lo)
}

// Secundaire veldzone-bias: verschuif/comprimeer de x (en bij een strafschop-
// gebied ook de y) zodat de tekening in de bedoelde zone valt. Pragmatisch.
function applyVeldzone(x: number, y: number, veldzone: Veldzone | null): { x: number; y: number } {
  switch (veldzone) {
    case 'links':
      return { x: remap(x, 100, 5, 55), y }
    case 'rechts':
      return { x: remap(x, 100, 45, 95), y }
    case 'strafschopgebied_links':
      return { x: remap(x, 100, 5, 55), y: remap(y, 140, 55, 140) }
    case 'strafschopgebied_rechts':
      return { x: remap(x, 100, 45, 95), y: remap(y, 140, 55, 140) }
    default: // 'midden' | null → volle breedte, geen verschuiving
      return { x, y }
  }
}

// Verticale zone (y-bereik) van een team bij losse plaatsing (zonder formatie).
// Spiegelt de zone-verdeling van de formatie-teams: eigen helft (1 team),
// onder-/bovenhelft (2 teams) of een eigen band (3+ teams).
function looseZone(N: number, i: number): { yLo: number; yHi: number } {
  if (N <= 1) return { yLo: 70, yHi: 135 }
  if (N === 2) return i === 0 ? { yLo: 72, yHi: 135 } : { yLo: 5, yHi: 68 }
  const bandH = 140 / N
  const marge = 6
  return { yLo: i * bandH + marge, yHi: (i + 1) * bandH - marge }
}

export function generateDiagram(
  teams: OefeningTeam[],
  aantalNeutralen: number,
  veldzone: Veldzone | null,
  // breedteM / lengteM hebben (bewust) GEEN effect op de coördinaten. Parameters
  // zijn aanwezig voor toekomstig gebruik; nu een no-op.
  breedteM?: number | null,
  lengteM?: number | null,
): Diagram {
  void breedteM // bewust ongebruikt (no-op, zie hierboven)
  void lengteM
  // Behoud elk team met een bekende grootte (formationsForSize niet-leeg). Teams
  // MET minstens één geldige formatie krijgen de vorm van hun BASISformatie (de
  // alfabetisch eerste van de selectie); teams zonder (lege selectie of alleen
  // onbekende keys) krijgen een losse rij/grid van `grootte` spelers.
  // normalizeOefeningTeam is hier het dual-read-vangnet: er kan nog legacy
  // {grootte, formatie} uit de database of van een oudere client binnenkomen.
  const usable = (Array.isArray(teams) ? teams : [])
    .map((t) => {
      const { grootte, formaties } = normalizeOefeningTeam(t)
      if (formationsForSize(grootte).length === 0) return null // onbekende grootte → overslaan
      const def: FormationDef | null = basisFormatieDef(grootte, formaties)
      return { grootte, def }
    })
    .filter((u): u is { grootte: number; def: FormationDef | null } => u !== null)

  const N = usable.length
  const markers: DiagramMarker[] = []

  usable.forEach(({ grootte, def }, i) => {
    if (def) {
      // ── Team MET formatie: gebruik de formatie-posities (keeper + labels) ──
      for (const p of def.positions) {
        const baseX = p.x // 0-100
        const baseY = p.y * 1.4 // percent → 0-140
        const rol: DiagramMarkerRol = p.position_label === 'K' ? 'keeper' : 'speler'

        let x = baseX
        let y = baseY

        if (N <= 1) {
          // Eén team: comprimeer naar de eigen (onder)helft.
          y = 70 + (baseY / 140) * 70
        } else if (N === 2) {
          if (i === 0) {
            // Team 0 = basis, onderin.
            y = baseY
          } else {
            // Team 1 = gespiegeld naar de overkant.
            y = 140 - baseY
            x = 100 - baseX
          }
        } else {
          // N >= 3: elk team in een eigen horizontale band van 140/N hoog.
          const bandH = 140 / N
          const marge = 6
          y = i * bandH + marge + (baseY / 140) * (bandH - 2 * marge)
        }

        const biased = applyVeldzone(x, y, veldzone)
        markers.push({
          x: clampX(biased.x),
          y: clampY(biased.y),
          teamIndex: i,
          rol,
          label: p.position_label,
        })
      }
    } else {
      // ── Team ZONDER formatie: los rij/grid binnen de zone van het team ──
      // Alle spelers rol 'speler', geen keeper-aanduiding, geen positielabel.
      const { yLo, yHi } = looseZone(N, i)
      const xLo = 8
      const xHi = 92
      const perRow = Math.min(grootte, 4)
      const nRows = Math.ceil(grootte / perRow)

      for (let j = 0; j < grootte; j++) {
        const row = Math.floor(j / perRow)
        const col = j % perRow
        // Aantal spelers in déze rij (laatste rij kan korter zijn) → gecentreerd.
        const rowCount = row === nRows - 1 ? grootte - perRow * (nRows - 1) : perRow
        const x = xLo + ((col + 1) / (rowCount + 1)) * (xHi - xLo)
        const y = nRows === 1 ? (yLo + yHi) / 2 : yLo + (row / (nRows - 1)) * (yHi - yLo)

        const biased = applyVeldzone(x, y, veldzone)
        markers.push({ x: clampX(biased.x), y: clampY(biased.y), teamIndex: i, rol: 'speler' })
      }
    }
  })

  // Neutralen: rij(en) rond y≈70, gelijkmatig over de breedte.
  const k = Math.max(0, Math.floor(Number(aantalNeutralen) || 0))
  if (k > 0 && k <= 10) {
    for (let j = 0; j < k; j++) {
      const biased = applyVeldzone(((j + 1) * 100) / (k + 1), 70, veldzone)
      markers.push({ x: clampX(biased.x), y: clampY(biased.y), teamIndex: null, rol: 'neutraal', label: '' })
    }
  } else if (k > 10) {
    const first = Math.ceil(k / 2)
    const second = k - first
    for (let j = 0; j < first; j++) {
      const biased = applyVeldzone(((j + 1) * 100) / (first + 1), 66, veldzone)
      markers.push({ x: clampX(biased.x), y: clampY(biased.y), teamIndex: null, rol: 'neutraal', label: '' })
    }
    for (let j = 0; j < second; j++) {
      const biased = applyVeldzone(((j + 1) * 100) / (second + 1), 74, veldzone)
      markers.push({ x: clampX(biased.x), y: clampY(biased.y), teamIndex: null, rol: 'neutraal', label: '' })
    }
  }

  return { markers, materiaal: [], lijnen: [] }
}

// ─────────────────────────────────────────────────────────────────────────────
// b) validateDiagram — tolerante server-side normalisatie (gooit nooit)
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function normMarker(raw: unknown): DiagramMarker {
  const r = isRecord(raw) ? raw : {}
  const rol = DIAGRAM_MARKER_ROLLEN.includes(r.rol as DiagramMarkerRol)
    ? (r.rol as DiagramMarkerRol)
    : 'speler'
  const teamIndex =
    r.teamIndex === null || r.teamIndex === undefined
      ? null
      : Math.floor(clamp(r.teamIndex, 0, DIAGRAM_MAX_TEAM_INDEX))
  const label = typeof r.label === 'string' ? r.label.slice(0, 6) : undefined
  return { x: clampX(r.x), y: clampY(r.y), teamIndex, rol, label }
}

function normMateriaal(raw: unknown): DiagramMateriaal | null {
  const r = isRecord(raw) ? raw : {}
  if (!DIAGRAM_MATERIAAL_TYPES.includes(r.type as DiagramMateriaalType)) return null
  const type = r.type as DiagramMateriaalType
  const base: DiagramMateriaal = { type, x: clampX(r.x), y: clampY(r.y) }
  if (type === 'doeltje') {
    // Doeltje krijgt altijd een variant; onbekend/ontbrekend → 'groot' (backward compat).
    base.variant = DIAGRAM_DOEL_VARIANTEN.includes(r.variant as DiagramDoelVariant)
      ? (r.variant as DiagramDoelVariant)
      : 'groot'
  }
  // Voor 'pion'/'bal' wordt geen variant-veld meegenomen (gestript).
  return base
}

function normLijn(raw: unknown): DiagramLijn | null {
  const r = isRecord(raw) ? raw : {}
  if (!DIAGRAM_LIJN_STIJLEN.includes(r.stijl as DiagramLijnStijl)) return null
  if (!Array.isArray(r.punten)) return null
  const punten = r.punten
    .slice(0, DIAGRAM_MAX_PUNTEN)
    .map((p) => ({ x: clampX((p as Record<string, unknown>)?.x), y: clampY((p as Record<string, unknown>)?.y) }))
  if (punten.length < 2) return null
  return { stijl: r.stijl as DiagramLijnStijl, punten }
}

export function validateDiagram(input: unknown): Diagram | null {
  if (!isRecord(input)) return null

  const markers = Array.isArray(input.markers)
    ? input.markers.slice(0, DIAGRAM_MAX_MARKERS).map(normMarker)
    : []

  const materiaal = Array.isArray(input.materiaal)
    ? input.materiaal
        .map(normMateriaal)
        .filter((m): m is DiagramMateriaal => m !== null)
        .slice(0, DIAGRAM_MAX_MATERIAAL)
    : []

  const lijnen = Array.isArray(input.lijnen)
    ? input.lijnen
        .map(normLijn)
        .filter((l): l is DiagramLijn => l !== null)
        .slice(0, DIAGRAM_MAX_LIJNEN)
    : []

  return { markers, materiaal, lijnen }
}
