import { formationsForSize } from '@/lib/types'
import type {
  FormationDef,
  LineupPosition,
  OefeningCategorie,
  OefeningTeam,
} from '@/lib/types'

// Automatisch gegenereerde formatie-catalogus voor oefening-teams.
//
// Bewust een APART bestand (niet lib/types.ts of lib/oefening.ts): lib/oefening.ts
// importeert lib/diagram.ts en beide hebben deze helpers nodig — een importcyclus
// zou het gevolg zijn. Dit bestand is puur en framework-agnostisch (géén
// 'use server', geen React) en importeert uit lib/types.ts alleen types plus de
// gecureerde 11-tal-lijst via formationsForSize.
//
// Sleutel- en labelvorm:
//   key   (canoniek, opgeslagen) = "V-M-A", altijd drie getallen, bv. "2-0-3".
//   label (weergave)             = de niet-nulle linies in volgorde V,M,A, bv. "2-3".
// De key is zelfbeschrijvend, zodat weergave-componenten kunnen tekenen zonder de
// categorie of de catalogus te kennen.

export const MAX_VERDEDIGERS = 5
export const MAX_MIDDENVELDERS = 5
export const MAX_AANVALLERS = 3

// Ondersteunde teamgroottes voor een oefening-team (10 is hier wél geldig, in
// tegenstelling tot de oude gecureerde FORMATIONS_BY_TEAM_SIZE).
export const VALID_TEAM_SIZES = [3, 4, 5, 6, 7, 8, 9, 10, 11]

export type Compositie = { v: number; m: number; a: number }

// Minimale teamvorm die deze module nodig heeft. Zo blijven de helpers bruikbaar
// voor zowel een volledige OefeningTeam als een team-in-aanbouw in de editor.
export type TeamGrootte = Pick<OefeningTeam, 'grootte'> & { keeperInGrootte?: boolean }
export type TeamMetFormaties = TeamGrootte & { formaties?: string[] | null }

export function formatieLabel({ v, m, a }: Compositie): string {
  return [v, m, a].filter((n) => n > 0).join('-')
}

export function formatieKey({ v, m, a }: Compositie): string {
  return `${v}-${m}-${a}`
}

// Tie-break bij een botsend label: de meeste verdedigers wint; bij gelijkspel de
// meeste aanvallers. Reproduceert de bestaande gecureerde formaties
// ('1-1' = 1V+1A, '2-1' = 2V+1A, '1-2' = 1V+2A, '3-2' = 3V+2A).
function beterDan(kandidaat: Compositie, huidig: Compositie): boolean {
  if (kandidaat.v !== huidig.v) return kandidaat.v > huidig.v
  return kandidaat.a > huidig.a
}

// ── Positie-layout ───────────────────────────────────────────────────────────
// Zelfde 0-100-stelsel als FormationDef.positions in lib/types.ts: x links→rechts,
// y = 90 bij het eigen doel, kleinere y richting de aanval.

const Y_KEEPER = 90
const Y_VERDEDIGING = 68
const Y_MIDDENVELD = 46
const Y_AANVAL = 22

// Gelijkmatig verdeelde x-posities voor k spelers in één linie, gecentreerd op 50.
function xPosities(k: number): number[] {
  if (k <= 0) return []
  if (k === 1) return [50]
  const span = Math.min(76, 40 + (k - 2) * 12)
  const start = 50 - span / 2
  return Array.from({ length: k }, (_, i) =>
    Math.round((start + (i / (k - 1)) * span) * 10) / 10,
  )
}

// keeperInGrootte bepaalt of er een K-marker bijkomt:
//   true  → 1 (K) + v+m+a veldspelers  (v+m+a = grootte - 1)
//   false → alleen v+m+a veldspelers, GEEN keeper (v+m+a = grootte)
// In beide gevallen dus exact `grootte` posities.
export function layoutPosities(
  { v, m, a }: Compositie,
  keeperInGrootte: boolean,
): Omit<LineupPosition, 'player_id'>[] {
  const posities: Omit<LineupPosition, 'player_id'>[] = []
  if (keeperInGrootte) posities.push({ x: 50, y: Y_KEEPER, position_label: 'K' })
  const linies: [number, number][] = [
    [v, Y_VERDEDIGING],
    [m, Y_MIDDENVELD],
    [a, Y_AANVAL],
  ]
  for (const [aantal, y] of linies) {
    for (const x of xPosities(aantal)) {
      // Geen V/M/A-tekst: alleen de keeper blijft gelabeld.
      posities.push({ x, y, position_label: '' })
    }
  }
  return posities
}

// ── Catalogus ────────────────────────────────────────────────────────────────

const catalogusCache = new Map<string, FormationDef[]>()

// Interne generator. N = aantal VELDSPELERS (dus exclusief keeper).
// metKeeper bepaalt uitsluitend de getekende posities — nooit de key of het label.
function catalogus(N: number, alleLiniesGevuld: boolean, metKeeper: boolean): FormationDef[] {
  const cacheKey = `${N}|${alleLiniesGevuld}|${metKeeper}`
  const gecached = catalogusCache.get(cacheKey)
  if (gecached) return gecached

  const uit: FormationDef[] = []
  if (Number.isInteger(N) && N > 0) {
    const min = alleLiniesGevuld ? 1 : 0
    const perLabel = new Map<string, Compositie>()

    for (let v = min; v <= MAX_VERDEDIGERS; v++) {
      for (let m = min; m <= MAX_MIDDENVELDERS; m++) {
        const a = N - v - m
        if (a < min || a > MAX_AANVALLERS) continue
        const kandidaat = { v, m, a }
        const label = formatieLabel(kandidaat)
        const huidig = perLabel.get(label)
        if (!huidig || beterDan(kandidaat, huidig)) perLabel.set(label, kandidaat)
      }
    }

    for (const [label, c] of perLabel) {
      uit.push({ key: formatieKey(c), label, positions: layoutPosities(c, metKeeper) })
    }
    // Alfabetisch op label; key als (in de praktijk nooit nodige) tiebreak.
    uit.sort((x, y) => x.label.localeCompare(y.label, 'nl') || x.key.localeCompare(y.key, 'nl'))
  }

  catalogusCache.set(cacheKey, uit)
  return uit
}

/**
 * Alle formaties voor N veldspelers.
 * alleLiniesGevuld = true  → V>=1, M>=1, A>=1 (categorie partijen_groot)
 * alleLiniesGevuld = false → elke linie mag 0 zijn (alle overige categorieën)
 *
 * De posities bevatten hier altijd een keeper-marker; gebruik formatiesVoorTeam
 * voor de aan een team gebonden variant (met of zonder K).
 * Geeft bij herhaald aanroepen dezelfde (gecachete) array terug.
 */
export function genereerFormaties(N: number, alleLiniesGevuld: boolean): FormationDef[] {
  return catalogus(N, alleLiniesGevuld, true)
}

// Bij een 11-tal telt de keeper altijd mee (gecureerde FORMATIONS-lijst).
function keeperTelt(team: TeamGrootte): boolean {
  if (team.grootte === 11) return true
  return team.keeperInGrootte ?? true
}

// Aantal veldspelers: keeperInGrootte (default true) bepaalt of de keeper van de
// teamgrootte af moet.
export function aantalVeldspelers(team: TeamGrootte): number {
  return keeperTelt(team) ? team.grootte - 1 : team.grootte
}

// De formaties waaruit dit team mag kiezen, gegeven de categorie van de oefening.
// 11-tal houdt de bestaande gecureerde lijst (gedeeld met de wedstrijdopstelling).
export function formatiesVoorTeam(
  team: TeamGrootte,
  categorie: OefeningCategorie,
): FormationDef[] {
  if (team.grootte === 11) return formationsForSize(11)
  return catalogus(aantalVeldspelers(team), categorie === 'partijen_groot', keeperTelt(team))
}

// De basisformatie van een team: de (hooguit ene) gekozen formatie, categorie-
// ONAFHANKELIJK geresolved zodat weergave/tekening de categorie niet hoeft te
// kennen. Dat mag omdat de "alle linies gevuld"-catalogus een deelverzameling is
// van de superset: driedelige labels horen bij precies één compositie, tweedelige
// zijn via de tie-break al eenduidig.
// Tolerant: null/undefined/lege selectie → null (= "geen formatie").
// Bij meerdere waarden (oude multi-select-data) wint de alfabetisch eerste.
export function basisFormatieDef(team: TeamMetFormaties | null | undefined): FormationDef | null {
  const sel = team?.formaties ?? []
  if (!team || sel.length === 0) return null
  const past = (f: FormationDef) => sel.includes(f.key) || sel.includes(f.label)

  const kandidaten =
    team.grootte === 11
      ? formationsForSize(11)
      : catalogus(aantalVeldspelers(team), false, keeperTelt(team))
  const gevonden = kandidaten.find(past)
  if (gevonden) return gevonden

  // Legacy-vangnet: oude gecureerde keys (bv. '2-0+K') uit bestaande JSONB-rijen.
  return formationsForSize(team.grootte).find(past) ?? null
}

// Een formatie is geldig als hij als key OF label voorkomt in de catalogus van
// dit team + deze categorie. Vervangt het oude isFormationValidForSize.
export function isFormatieGeldigVoorTeam(
  key: string,
  team: TeamGrootte,
  categorie: OefeningCategorie,
): boolean {
  return formatiesVoorTeam(team, categorie).some((f) => f.key === key || f.label === key)
}
