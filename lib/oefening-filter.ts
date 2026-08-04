import type { Oefening, OefeningCategorie, Veldzone } from '@/lib/types'

// Gedeelde, framework-agnostische filter-/aggregatielogica voor de
// oefeningenbibliotheek. Bewust een EIGEN bestand naast lib/oefening.ts: die
// bevat server-side validatie (validateDiagram, FORMATIONS_BY_TEAM_SIZE) die we
// niet mee de clientbundel in willen trekken. Hier staat alleen pure logica —
// geen React, geen Supabase — zodat zowel de client (OefeningPicker) als
// server-code dit kan hergebruiken en het los te testen is.

export interface OefeningFilters {
  query: string
  categorie: OefeningCategorie | null
  veldzone: Veldzone | null
  aantalMin: number | null
  aantalMax: number | null
  duurMin: number | null
  duurMax: number | null
}

// Neutrale beginstand: filterOefeningen(list, EMPTY_OEFENING_FILTERS) geeft de
// ongefilterde lijst terug.
export const EMPTY_OEFENING_FILTERS: OefeningFilters = {
  query: '',
  categorie: null,
  veldzone: null,
  aantalMin: null,
  aantalMax: null,
  duurMin: null,
  duurMax: null,
}

// Totaal aantal spelers in een oefening: de som van de teamgroottes plus de
// neutralen. Veldafmetingen, oriëntatie en diagram tellen bewust niet mee.
// Defensief tegen half-gevulde JSONB-rijen (teams kan ontbreken of rommel
// bevatten): niet-numerieke waarden tellen als 0. Lege teams-array is een
// geldig geval (bv. een warming-up met alleen neutralen).
export function totaalAantalSpelers(o: Pick<Oefening, 'teams' | 'aantal_neutralen'>): number {
  return (
    (o.teams ?? []).reduce((sum, t) => sum + (Number(t?.grootte) || 0), 0) +
    (Number(o.aantal_neutralen) || 0)
  )
}

// Bereikfilter met inclusieve grenzen. Let op: 0 is een GELDIGE grens, dus
// overal `!== null` en nooit een truthy-check op min/max.
// - min én max null → filter inactief → altijd true.
// - filter actief én value null → altijd false (onbekend matcht geen bereik).
// - min > max levert vanzelf false op; dat is geen fout, gewoon een leeg bereik.
export function matchesRange(value: number | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true
  if (value === null) return false
  if (min !== null && value < min) return false
  if (max !== null && value > max) return false
  return true
}

// AND-combinatie van alle actieve filters. Een filter op null/'' doet niet mee.
export function matchesOefeningFilters(o: Oefening, f: OefeningFilters): boolean {
  // Zelfde zoekgedrag als het bestaande zoekveld: getrimd, case-insensitive
  // substring op de naam.
  const q = (f.query ?? '').trim().toLowerCase()
  if (q && !o.naam.toLowerCase().includes(q)) return false
  if (f.categorie !== null && o.categorie !== f.categorie) return false
  // Een oefening zonder veldzone matcht nooit zodra er op veldzone gefilterd wordt.
  if (f.veldzone !== null && o.veldzone !== f.veldzone) return false
  if (!matchesRange(totaalAantalSpelers(o), f.aantalMin, f.aantalMax)) return false
  if (!matchesRange(o.duur_min, f.duurMin, f.duurMax)) return false
  return true
}

export function filterOefeningen(list: Oefening[], f: OefeningFilters): Oefening[] {
  return list.filter((o) => matchesOefeningFilters(o, f))
}
