import { VALID_TEAM_SIZES } from '@/lib/formaties'
import type { AantallenOverride, OefeningTeam, TrainingOefeningWithData } from '@/lib/types'

// Gedeelde, framework-agnostische kern voor FLEXIBELE oefenvormen: een oefening
// mag per team (en voor de neutralen) een bereik hebben in plaats van één vast
// aantal, en een training mag daarbinnen een eigen bezetting vastleggen.
//
// Bewust géén 'use server', geen React, geen Supabase — net als
// lib/oefening-filter.ts. Dit bestand mag daarom ook NIET lib/oefening.ts of
// lib/diagram.ts importeren: die trekken validateDiagram/FORMATIONS de
// clientbundel in. Alleen lib/types.ts en lib/formaties.ts (dat zelf alleen uit
// types leest, dus geen cyclus).
//
// Rolverdeling die nergens gebroken mag worden:
// - `oefeningen.teams` is de BASISVORM (waar het diagram op getekend is) en de
//   bron van de grenzen.
// - `training_oefeningen.aantallen_override` is de DELTA (null = basisvorm).
// - `concretiseerBezetting` is de enige plek waar die twee samenkomen; wat
//   daaruit komt (`Bezetting.teams`) is de EFFECTIEVE bezetting die alle
//   consumers (teamindeling, labels, print, parallel-groepstatus) gebruiken.

// En-dash (U+2013) in labels als '4v2–6v2' en '4–6'. Bewust hardcoded en niet
// vertaald: de notatie is in alle vijf talen identiek.
const EN_DASH = '–'

// Minimale vorm van een (bibliotheek-)oefening voor de bezettingsberekening.
// Een volledige `Oefening` past hier structureel op.
export interface BezettingBasis {
  teams: OefeningTeam[]
  aantal_neutralen: number
  aantal_neutralen_max?: number | null
}

// De uitkomst van basisvorm + override. snake_case `aantal_neutralen` is
// BEWUST: zo past Bezetting structureel op BenodigdAantalInput
// (lib/parallel-groep.ts) en op Pick<Oefening,'teams'|'aantal_neutralen'>
// (lib/oefening-filter.ts) — één vorm, geen tweede adapter.
export interface Bezetting {
  // De basisvorm-teams met de EFFECTIEVE grootte. Alle overige velden
  // (formaties, keeperInGrootte, grootteMax) blijven ongewijzigd staan.
  teams: OefeningTeam[]
  aantal_neutralen: number
  // Wijkt de effectieve bezetting af van de basisvorm? Voedt o.a. de badge
  // "tekening toont basisvorm".
  aangepast: boolean
}

export interface Bereik {
  min: number
  max: number
}

// Koppeling inclusief de één keer op de leesgrens berekende bezetting.
// `oefeningen.teams` blijft daarbij de basisvorm; de effectieve groottes staan
// UITSLUITEND in `bezetting.teams`.
export interface TrainingOefeningMetBezetting extends TrainingOefeningWithData {
  bezetting: Bezetting
}

// ────────────────────────────────────────────────
// Bereiken
// ────────────────────────────────────────────────

// Het toegestane bereik van één team. Punt-bereik (min === max === grootte) —
// dus "exact team", het bestaande gedrag — tenzij ALLE voorwaarden gelden:
// een geldige grootte, een gehele bovengrens die niet lager ligt en wél in
// VALID_TEAM_SIZES zit, en géén formatie.
//
// Dit is de enige plek waar "formatie ⇒ exact" semantisch wordt afgedwongen, en
// meteen het clamp-vangnet voor flexibel → exact: wordt een bereik in de
// bibliotheek weggehaald of krijgt het team alsnog een formatie, dan brengt het
// punt-bereik elke opgeslagen override stil terug naar de basisvorm.
export function bereikVoorTeam(team: OefeningTeam): Bereik {
  const grootte = Number(team?.grootte)
  const punt: Bereik = { min: grootte, max: grootte }
  // Een "los" team (grootte <= 0) heeft bewust geen limiet en blijft los, zie
  // autoAssignTeams in lib/spelerindeling.ts.
  if (!Number.isFinite(grootte) || grootte <= 0) return punt

  const max = team?.grootteMax
  if (max === null || max === undefined) return punt
  if (!Number.isInteger(max) || max < grootte) return punt
  if (!VALID_TEAM_SIZES.includes(max)) return punt
  if ((team?.formaties?.length ?? 0) > 0) return punt

  return { min: grootte, max }
}

// Het toegestane bereik van de neutralen. 0 is een geldige ondergrens én een
// geldige bovengrens, dus overal `=== null`/`=== undefined`, nooit truthiness.
export function bereikVoorNeutralen(basis: BezettingBasis): Bereik {
  const n = Number(basis?.aantal_neutralen) || 0
  const punt: Bereik = { min: n, max: n }

  const max = basis?.aantal_neutralen_max
  if (max === null || max === undefined) return punt
  if (!Number.isInteger(max) || max < n || max > 30) return punt

  return { min: n, max }
}

export function isFlexibelTeam(team: OefeningTeam): boolean {
  const bereik = bereikVoorTeam(team)
  return bereik.max > bereik.min
}

// Heeft deze oefening ook maar één element met speelruimte? Zo niet, dan komt er
// nergens een stepper, een bereik-badge of een basisvorm-badge bij.
export function isFlexibel(basis: BezettingBasis): boolean {
  const teams = Array.isArray(basis?.teams) ? basis.teams : []
  if (teams.some(isFlexibelTeam)) return true
  const neutralen = bereikVoorNeutralen(basis)
  return neutralen.max > neutralen.min
}

// Totaal aantal spelers als bereik. Voor een exacte oefening geldt
// min === max === totaalAantalSpelers(o) (lib/oefening-filter.ts), zodat het
// filter zich voor bestaande oefeningen exact zoals vandaag gedraagt.
// Defensief tegen half-gevulde JSONB: een niet-eindige grens telt als 0.
export function totaalBereik(basis: BezettingBasis): Bereik {
  const teams = Array.isArray(basis?.teams) ? basis.teams : []
  let min = 0
  let max = 0
  for (const team of teams) {
    const bereik = bereikVoorTeam(team)
    min += Number.isFinite(bereik.min) ? bereik.min : 0
    max += Number.isFinite(bereik.max) ? bereik.max : 0
  }
  const neutralen = bereikVoorNeutralen(basis)
  min += Number.isFinite(neutralen.min) ? neutralen.min : 0
  max += Number.isFinite(neutralen.max) ? neutralen.max : 0
  return { min, max }
}

// ────────────────────────────────────────────────
// Concretiseren (clamp-on-read)
// ────────────────────────────────────────────────

// Een niet-numerieke of ontbrekende override-waarde valt terug op de basis;
// een fractie wordt naar beneden afgerond.
function gewensteWaarde(ruw: unknown, basis: number): number {
  if (typeof ruw !== 'number' || !Number.isFinite(ruw)) return basis
  return Math.floor(ruw)
}

// Clamp binnen het bereik. Een onbruikbaar (niet-eindig) bereik laat de waarde
// staan in plaats van er NaN van te maken.
function clampBinnen(waarde: number, bereik: Bereik): number {
  if (!Number.isFinite(bereik.min) || !Number.isFinite(bereik.max)) return waarde
  return Math.max(bereik.min, Math.min(bereik.max, waarde))
}

// Basisvorm + override → de effectieve bezetting van deze training.
//
// Clamp-on-read (precedent: clampStapOverride, lib/periodization-stappen.ts):
// een opgeslagen override wordt bij ELK gebruik tegen het ACTUELE bereik
// geclampt en de DB-rij zelf wordt nooit herschreven. Daardoor geldt de clamp
// automatisch op élke leesplek tegelijk.
//
// Overtollige entries in `override.teams` worden genegeerd, ontbrekende zijn de
// basisvorm — het AANTAL teams verandert dus nooit.
export function concretiseerBezetting(
  basis: BezettingBasis,
  override: AantallenOverride | null | undefined,
): Bezetting {
  const basisTeams = Array.isArray(basis?.teams) ? basis.teams : []
  const overrideTeams = Array.isArray(override?.teams) ? override.teams : []

  let aangepast = false

  const teams = basisTeams.map((team, i) => {
    const bereik = bereikVoorTeam(team)
    const grootte = clampBinnen(gewensteWaarde(overrideTeams[i], bereik.min), bereik)
    // Object.is: NaN === NaN geldt hier als "gelijk", zodat rommelige JSONB
    // geen valse "aangepast" oplevert.
    if (!Object.is(grootte, bereik.min)) aangepast = true
    return { ...team, grootte }
  })

  const neutraalBereik = bereikVoorNeutralen(basis)
  const aantal_neutralen = clampBinnen(
    gewensteWaarde(override?.neutralen, neutraalBereik.min),
    neutraalBereik,
  )
  if (!Object.is(aantal_neutralen, neutraalBereik.min)) aangepast = true

  return { teams, aantal_neutralen, aangepast }
}

// ────────────────────────────────────────────────
// Suggestie op basis van de opkomst
// ────────────────────────────────────────────────

// Startwaarde voor de steppers: de basisvorm, opgerekt tot maximaal het aantal
// aanwezigen. De ruimte wordt round-robin één eenheid per beurt verdeeld over
// [team0, team1, …, neutralen] — alleen over elementen die nog kopruimte
// hebben. Deterministisch, nooit onder de basisvorm en nooit boven de maxima.
//
// LET OP: dit levert CONCRETE waarden op (geen delta): elk element krijgt een
// getal, ook als dat gelijk is aan de basis. Het resultaat is bedoeld als
// invoer voor concretiseerBezetting (stepper-startwaarde) en wordt pas bij het
// opslaan door valideerAantallenOverride naar de delta-vorm teruggebracht.
// Er wordt hier NIETS opgeslagen — alle andere weergaveplekken blijven de
// basisvorm tonen tot de trainer expliciet vastlegt.
export function suggestBezetting(basis: BezettingBasis, aanwezigen: number): AantallenOverride {
  const basisTeams = Array.isArray(basis?.teams) ? basis.teams : []
  const teamBereiken = basisTeams.map(bereikVoorTeam)
  const neutraalBereik = bereikVoorNeutralen(basis)

  // Elk element als [waarde, bereik]; de neutralen staan bewust achteraan.
  const elementen = [...teamBereiken, neutraalBereik].map((bereik) => ({
    bereik,
    waarde: Number.isFinite(bereik.min) ? bereik.min : 0,
  }))

  const totaal = totaalBereik(basis)
  const n = Math.floor(Number(aanwezigen))
  let rest = Number.isFinite(n) ? Math.max(0, n - totaal.min) : 0

  // Round-robin: één eenheid per beurt, in indexvolgorde, tot de aanwezigen op
  // zijn of niets meer kopruimte heeft.
  let ruimte = true
  while (rest > 0 && ruimte) {
    ruimte = false
    for (const element of elementen) {
      if (rest === 0) break
      if (!Number.isFinite(element.bereik.max) || element.waarde >= element.bereik.max) continue
      element.waarde += 1
      rest -= 1
      ruimte = true
    }
  }

  return {
    teams: elementen.slice(0, teamBereiken.length).map((e) => e.waarde),
    neutralen: elementen[elementen.length - 1].waarde,
  }
}

// ────────────────────────────────────────────────
// Validatie (server-side, grenzen uit de bibliotheek)
// ────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Normaliseert client-invoer naar de op te slaan delta-vorm, met de grenzen uit
// `basis` — die hoort ALTIJD van de gejoinde bibliotheek-oefening te komen,
// nooit uit de payload.
//
// - null/undefined → null (override wissen).
// - Verkeerde vorm (geen object, een array, een niet-numeriek element) →
//   Error('Ongeldige bezetting'); er wordt dan niets geschreven.
// - Een getal buiten het bereik wordt GECLAMPT, niet geweigerd: een verlaat
//   tabblad met een oude grens hoort geen foutmelding op te leveren.
// - Daarna delta-normalisatie: een waarde gelijk aan de basis wordt null, de
//   array is altijd exact basis.teams.length lang, en is alles null dan is het
//   resultaat null. Zo levert "Terug naar basisvorm" gratis een NULL-kolom op.
//
// Muteert de invoer nooit.
export function valideerAantallenOverride(
  input: unknown,
  basis: BezettingBasis,
): AantallenOverride | null {
  if (input === null || input === undefined) return null
  if (!isPlainObject(input)) throw new Error('Ongeldige bezetting')

  const ruweTeams = input.teams
  if (ruweTeams !== null && ruweTeams !== undefined && !Array.isArray(ruweTeams)) {
    throw new Error('Ongeldige bezetting')
  }
  const lijst: unknown[] = Array.isArray(ruweTeams) ? ruweTeams : []

  const basisTeams = Array.isArray(basis?.teams) ? basis.teams : []
  let iets = false

  const teams = basisTeams.map((team, i) => {
    const bereik = bereikVoorTeam(team)
    const waarde = schoneWaarde(lijst[i], bereik)
    if (waarde !== null) iets = true
    return waarde
  })

  const neutralen = schoneWaarde(input.neutralen, bereikVoorNeutralen(basis))
  if (neutralen !== null) iets = true

  return iets ? { teams, neutralen } : null
}

// Eén element: afwezig → null, rommel → throw, getal → geclampt en daarna
// delta-genormaliseerd (gelijk aan de basis → null).
function schoneWaarde(ruw: unknown, bereik: Bereik): number | null {
  if (ruw === null || ruw === undefined) return null
  if (typeof ruw !== 'number' || !Number.isFinite(ruw)) throw new Error('Ongeldige bezetting')
  const waarde = clampBinnen(Math.floor(ruw), bereik)
  return Object.is(waarde, bereik.min) ? null : waarde
}

// ────────────────────────────────────────────────
// Labels (taalonafhankelijk, bewust niet vertaald)
// ────────────────────────────────────────────────

// '4v2' — de groottes van de teams die daadwerkelijk spelers hebben.
// Geen positieve teams → '' (dan toont de UI niets).
export function vormLabel(teams: OefeningTeam[]): string {
  return (Array.isArray(teams) ? teams : [])
    .map((team) => Number(team?.grootte))
    .filter((n) => Number.isFinite(n) && n > 0)
    .join('v')
}

// '4v2' bij een exacte oefening, '4v2–6v2' bij een flexibele. Het bereik van de
// neutralen zit hier bewust NIET in: dat heeft zijn eigen badge.
export function bereikLabel(basis: BezettingBasis): string {
  const teams = Array.isArray(basis?.teams) ? basis.teams : []
  const min = vormLabel(teams.map((team) => ({ ...team, grootte: bereikVoorTeam(team).min })))
  const max = vormLabel(teams.map((team) => ({ ...team, grootte: bereikVoorTeam(team).max })))
  return min === max ? min : `${min}${EN_DASH}${max}`
}

// '4' bij een punt-bereik, '4–6' bij een echt bereik. De enige plek waar die
// notatie wordt samengesteld: teamBereikLabel leunt erop, en consumers die een
// bereik hebben zonder OefeningTeam (bijv. de neutralen) gebruiken hem direct
// in plaats van de en-dash nog eens te hardcoden.
export function bereikLabelVoor(bereik: Bereik): string {
  return bereik.max > bereik.min ? `${bereik.min}${EN_DASH}${bereik.max}` : String(bereik.min)
}

// '4' of '4–6' — voedt de FormationField-labels naast de bestaande
// ` · ${basis.label}`-conventie.
export function teamBereikLabel(team: OefeningTeam): string {
  return bereikLabelVoor(bereikVoorTeam(team))
}

// ────────────────────────────────────────────────
// Sortering
// ────────────────────────────────────────────────

// Exacte oefeningen eerst, daarna oplopende bereikbreedte. Array.prototype.sort
// is stabiel (ES2019), dus bij gelijke breedte — en dus bij een uitsluitend
// exacte bibliotheek — blijft de serverbestelling exact staan.
export function sorteerOpPassendheid<T extends BezettingBasis>(list: T[]): T[] {
  const breedte = (item: T) => {
    const bereik = totaalBereik(item)
    return bereik.max - bereik.min
  }
  return [...list].sort((a, b) => breedte(a) - breedte(b))
}
