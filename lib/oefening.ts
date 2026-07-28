import {
  OefeningCategorie,
  OefeningTeam,
  Orientatie,
  Veldzone,
  Diagram,
  OEFENING_CATEGORIES,
  VALID_ORIENTATIES,
  VALID_VELDZONES,
  FORMATIONS_BY_TEAM_SIZE,
  isFormationValidForSize,
} from '@/lib/types'
import { validateDiagram } from '@/lib/diagram'

// Gedeelde, framework-agnostische validatie/normalisatie voor bibliotheek-
// oefeningen. Bewust géén 'use server': zo kunnen zowel oefening-library.ts als
// training-plan.ts deze pure functie hergebruiken zonder dat de validator zelf
// als server action wordt geëxposeerd.

export interface OefeningInput {
  naam: string
  beschrijving?: string | null
  categorie: OefeningCategorie
  duur_min?: number | null
  breedte_m?: number | null
  lengte_m?: number | null
  orientatie?: Orientatie
  veldzone?: Veldzone | null
  teams: OefeningTeam[]
  aantal_neutralen: number
  diagram?: Diagram | null
}

export interface ValidatedOefening {
  naam: string
  beschrijving: string | null
  categorie: OefeningCategorie
  duur_min: number | null
  breedte_m: number | null
  lengte_m: number | null
  orientatie: Orientatie
  veldzone: Veldzone | null
  teams: OefeningTeam[]
  aantal_neutralen: number
  diagram: Diagram | null
}

const VALID_SIZES = Object.keys(FORMATIONS_BY_TEAM_SIZE).map(Number)

export function validateOefening(input: OefeningInput): ValidatedOefening {
  const naam = (input.naam ?? '').trim().slice(0, 200)
  if (!naam) throw new Error('Naam verplicht')
  if (!OEFENING_CATEGORIES.includes(input.categorie)) throw new Error('Ongeldige categorie')
  if (input.orientatie && !VALID_ORIENTATIES.includes(input.orientatie)) throw new Error('Ongeldige oriëntatie')
  if (input.veldzone && !VALID_VELDZONES.includes(input.veldzone)) throw new Error('Ongeldige veldzone')

  const rawTeams = Array.isArray(input.teams) ? input.teams.slice(0, 6) : []
  const teams: OefeningTeam[] = rawTeams.map((tm) => {
    const grootte = Number(tm?.grootte)
    if (!VALID_SIZES.includes(grootte)) throw new Error('Ongeldige teamgrootte')
    const formatie = tm?.formatie ?? null
    if (!isFormationValidForSize(grootte, formatie)) throw new Error('Formatie past niet bij teamgrootte')
    // Strip onbekende velden: behoud alleen {grootte, formatie}.
    return { grootte, formatie }
  })

  const aantal_neutralen = Math.max(0, Math.min(30, Math.floor(Number(input.aantal_neutralen) || 0)))

  return {
    naam,
    beschrijving: input.beschrijving?.slice(0, 2000) ?? null,
    categorie: input.categorie,
    // duur_min: hele minuten, 0..600 (10 uur) — ruim boven de UI-max van 120,
    // maar veilig binnen SMALLINT zodat een geknutselde call geen DB-overflow geeft.
    duur_min: clampInt(input.duur_min, 0, 600),
    // breedte_m / lengte_m: NUMERIC(5,1) -> 1 decimaal, 0..999.9.
    breedte_m: clampDecimal(input.breedte_m, 0, 999.9),
    lengte_m: clampDecimal(input.lengte_m, 0, 999.9),
    orientatie: input.orientatie ?? 'vrij',
    veldzone: input.veldzone ?? null,
    teams,
    aantal_neutralen,
    // JSONB nooit ongefilterd doorzetten: normaliseer/clamp naar een veilige vorm
    // (of null). Stroomt via oefeningRow(...v) mee naar insert/update.
    diagram: validateDiagram(input.diagram),
  }
}

// Clamp naar een gehele waarde binnen [min, max]; null blijft null (optioneel veld).
function clampInt(value: number | null | undefined, min: number, max: number): number | null {
  if (value === null || value === undefined) return null
  const n = Math.floor(Number(value))
  if (Number.isNaN(n)) return null
  return Math.max(min, Math.min(max, n))
}

// Clamp naar één decimaal binnen [min, max]; null blijft null (optioneel veld).
function clampDecimal(value: number | null | undefined, min: number, max: number): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (Number.isNaN(n)) return null
  return Math.max(min, Math.min(max, Math.round(n * 10) / 10))
}

// Bouwt de DB-rij voor een bibliotheek-oefening (gedeeld door create-flows).
export function oefeningRow(v: ValidatedOefening, teamId: string) {
  return { team_id: teamId, ...v }
}
