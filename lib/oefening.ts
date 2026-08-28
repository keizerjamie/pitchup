import {
  OefeningCategorie,
  OefeningTeam,
  Orientatie,
  Veldzone,
  Diagram,
  OEFENING_CATEGORIES,
  VALID_ORIENTATIES,
  VALID_VELDZONES,
  normalizeOefeningTeam,
} from '@/lib/types'
import { VALID_TEAM_SIZES, formatiesVoorTeam } from '@/lib/formaties'
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
  // Bovengrens van een flexibel aantal neutralen; null/afwezig = vast aantal.
  aantal_neutralen_max?: number | null
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
  aantal_neutralen_max: number | null
  diagram: Diagram | null
}

export function validateOefening(input: OefeningInput): ValidatedOefening {
  const naam = (input.naam ?? '').trim().slice(0, 200)
  if (!naam) throw new Error('Naam verplicht')
  if (!OEFENING_CATEGORIES.includes(input.categorie)) throw new Error('Ongeldige categorie')
  if (input.orientatie && !VALID_ORIENTATIES.includes(input.orientatie)) throw new Error('Ongeldige oriëntatie')
  if (input.veldzone && !VALID_VELDZONES.includes(input.veldzone)) throw new Error('Ongeldige veldzone')

  const rawTeams = Array.isArray(input.teams) ? input.teams.slice(0, 6) : []
  const teams: OefeningTeam[] = rawTeams.map((tm) => {
    // Dual-read + strip onbekende velden: behoud alleen {grootte, formaties,
    // keeperInGrootte} plus — hieronder, apart gevalideerd — grootteMax.
    // normalizeOefeningTeam forceert keeperInGrootte bij een 11-tal al naar true.
    const { grootte, formaties, keeperInGrootte } = normalizeOefeningTeam(tm)
    if (!VALID_TEAM_SIZES.includes(grootte)) throw new Error('Ongeldige teamgrootte')
    // Single-select: hooguit één formatie per team, geen stille afkap.
    if (formaties.length > 1) throw new Error('Maximaal één formatie per team')
    // De keuzelijst hangt af van grootte, keeper-stand ÉN categorie (input.categorie
    // is hierboven al gevalideerd).
    const opties = formatiesVoorTeam({ grootte, keeperInGrootte }, input.categorie)
    // Canonieke opslag: altijd de KEY (een binnengekomen label wordt genormaliseerd).
    const canoniek = formaties.map((waarde) => {
      const def = opties.find((f) => f.key === waarde || f.label === waarde)
      if (!def) throw new Error('Formatie past niet bij teamgrootte')
      return def.key
    })

    // Bovengrens van een flexibel team. Bewust de RUWE waarde, niet die uit
    // normalizeOefeningTeam: die normaliseert de VORM (en gooit een te lage
    // grens stil weg), terwijl opslaan zo'n grens juist hoort te WEIGEREN —
    // precies zoals `grootte` hierboven ook pas hier tegen VALID_TEAM_SIZES
    // wordt afgezet.
    const ruweMax = tm?.grootteMax
    const grootteMax =
      ruweMax === null || ruweMax === undefined ? null : Math.floor(Number(ruweMax))
    if (grootteMax !== null) {
      if (formaties.length > 0) throw new Error('Formatie kan niet samen met een spelersbereik')
      if (!VALID_TEAM_SIZES.includes(grootteMax)) throw new Error('Ongeldige teamgrootte')
      if (grootteMax < grootte) throw new Error('Bovengrens kleiner dan de teamgrootte')
    }

    // Spread, geen `grootteMax: null`: een exact team schrijft exact dezelfde
    // JSONB weg als vóór deze feature.
    return {
      grootte,
      formaties: canoniek,
      keeperInGrootte,
      ...(grootteMax !== null ? { grootteMax } : {}),
    }
  })

  const aantal_neutralen = Math.max(0, Math.min(30, Math.floor(Number(input.aantal_neutralen) || 0)))
  // `!== null && !== undefined`, nooit een truthy-check: 0 is een geldige
  // bovengrens (bij een basis van 0 neutralen).
  const aantal_neutralen_max =
    input.aantal_neutralen_max === null || input.aantal_neutralen_max === undefined
      ? null
      : Math.max(0, Math.min(30, Math.floor(Number(input.aantal_neutralen_max) || 0)))
  if (aantal_neutralen_max !== null && aantal_neutralen_max < aantal_neutralen) {
    throw new Error('Bovengrens kleiner dan het aantal neutralen')
  }

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
    aantal_neutralen_max,
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
