export type Position =
  | 'Keeper'
  | 'Linksachter'
  | 'Centrale verdediger'
  | 'Rechtsachter'
  | 'Defensieve middenvelder'
  | 'Centrale middenvelder'
  | 'Linksmiddenvelder'
  | 'Rechtsmiddenvelder'
  | 'Aanvallende middenvelder'
  | 'Linksbuiten'
  | 'Rechtsbuiten'
  | 'Spits'

export const POSITIONS: Position[] = [
  'Keeper',
  'Linksachter',
  'Centrale verdediger',
  'Rechtsachter',
  'Defensieve middenvelder',
  'Centrale middenvelder',
  'Linksmiddenvelder',
  'Rechtsmiddenvelder',
  'Aanvallende middenvelder',
  'Linksbuiten',
  'Rechtsbuiten',
  'Spits',
]

export const POSITION_GROUPS: { label: string; positions: Position[] }[] = [
  { label: 'Keepers', positions: ['Keeper'] },
  { label: 'Verdedigers', positions: ['Linksachter', 'Centrale verdediger', 'Rechtsachter'] },
  {
    label: 'Middenvelders',
    positions: [
      'Defensieve middenvelder',
      'Centrale middenvelder',
      'Linksmiddenvelder',
      'Rechtsmiddenvelder',
      'Aanvallende middenvelder',
    ],
  },
  { label: 'Aanvallers', positions: ['Linksbuiten', 'Rechtsbuiten', 'Spits'] },
]

export interface Player {
  id: string
  name: string
  position: Position
  secondary_positions: Position[]
  jersey_number: number | null
  active: boolean
  injured: boolean
  rating: number | null
  created_at: string
}

export type EventType = 'training' | 'match' | 'meting'
export type MatchType = 'friendly' | 'league' | 'cup'
export type HomeAway = 'home' | 'away'
export type AttendanceStatus = 'present' | 'absent' | 'unknown'

export type OefeningCategorie =
  | 'partijen_groot'
  | 'partijen_midden'
  | 'partijen_klein'
  | 'sprints_weinig_rust'
  | 'sprints_veel_rust'
  | 'steigerungs'
  | 'overig'

export const PERIODIZATION_CATEGORIES: {
  key: OefeningCategorie
  label: string
  maxStap: number
  color: string
  cycleWeeks: number[]
  hasMeting: boolean
}[] = [
  { key: 'partijen_groot',      label: 'Partijen Groot',      maxStap: 21, color: 'bg-red-100 text-red-800',      cycleWeeks: [1,2], hasMeting: true  },
  { key: 'partijen_midden',     label: 'Partijen Midden',     maxStap: 15, color: 'bg-orange-100 text-orange-800', cycleWeeks: [3,4], hasMeting: true  },
  { key: 'partijen_klein',      label: 'Partijen Klein',      maxStap: 13, color: 'bg-amber-100 text-amber-800',  cycleWeeks: [5,6], hasMeting: true  },
  { key: 'sprints_weinig_rust', label: 'Sprints Weinig Rust', maxStap: 14, color: 'bg-blue-100 text-blue-800',    cycleWeeks: [3,4], hasMeting: true  },
  { key: 'sprints_veel_rust',   label: 'Sprints Veel Rust',   maxStap: 13, color: 'bg-indigo-100 text-indigo-800',cycleWeeks: [5,6], hasMeting: true  },
  { key: 'steigerungs',         label: 'Steigerungs',         maxStap: 5,  color: 'bg-emerald-100 text-emerald-800', cycleWeeks: [1,2], hasMeting: false },
  { key: 'overig',              label: 'Overig',              maxStap: 99, color: 'bg-gray-100 text-gray-700',    cycleWeeks: [],    hasMeting: false },
]

// Verzwaren en herhalen: step = N + floor(k/2)
// N = nulmeting step, k = # times this category appeared in training since nulmeting
export function berekenStap(nulmetingStap: number, k: number): number {
  return nulmetingStap + Math.floor(k / 2)
}

export interface MetingData {
  id: string
  event_id: string
  team_id: string
  partijen_groot_stap: number
  partijen_midden_stap: number
  partijen_klein_stap: number
  sprints_weinig_rust_stap: number
  sprints_veel_rust_stap: number
  notes: string | null
  created_at: string
}

export interface Oefening {
  id: string
  event_id: string
  team_id: string
  naam: string
  beschrijving: string | null
  categorie: OefeningCategorie
  stap_override: number | null
  breedte_m: number | null
  lengte_m: number | null
  orientatie: 'breedte' | 'lengte' | 'vrij'
  veldzone: 'links' | 'midden' | 'rechts' | 'strafschopgebied_links' | 'strafschopgebied_rechts' | null
  aantal_teams: number
  genest_in: string | null
  volgorde: number
  duur_min: number | null
  created_at: string
}

export interface FootballEvent {
  id: string
  type: EventType
  date: string
  time: string | null
  location: string | null
  match_type: MatchType | null
  opponent: string | null
  home_away: HomeAway | null
  notes: string | null
  doelstelling: string | null
  created_at: string
}

export interface Attendance {
  id: string
  event_id: string
  player_id: string
  status: AttendanceStatus
  injury_set: boolean
  created_at: string
}

export interface LineupPosition {
  player_id: string | null
  x: number
  y: number
  position_label: string
  position_number?: number
}

export interface Lineup {
  id: string
  event_id: string
  formation: string
  positions: LineupPosition[]
  notes: string | null
  created_at: string
}

export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  friendly: 'Oefenwedstrijd',
  league: 'Competitie',
  cup: 'Beker',
}

export const MATCH_TYPE_COLORS: Record<MatchType, string> = {
  friendly: 'bg-gray-100 text-gray-700',
  league: 'bg-blue-100 text-blue-700',
  cup: 'bg-yellow-100 text-yellow-700',
}

export const POSITION_ABBREVIATIONS: Record<string, string> = {
  'Keeper': 'GK',
  'Linksachter': 'LB',
  'Centrale verdediger': 'CB',
  'Rechtsachter': 'RB',
  'Defensieve middenvelder': 'DM',
  'Centrale middenvelder': 'CM',
  'Linksmiddenvelder': 'LM',
  'Rechtsmiddenvelder': 'RM',
  'Aanvallende middenvelder': 'AM',
  'Linksbuiten': 'LW',
  'Rechtsbuiten': 'RW',
  'Spits': 'ST',
}

export const POSITION_COLORS: Record<string, string> = {
  'Keeper': 'bg-yellow-100 text-yellow-800',
  'Linksachter': 'bg-blue-100 text-blue-800',
  'Centrale verdediger': 'bg-blue-100 text-blue-800',
  'Rechtsachter': 'bg-blue-100 text-blue-800',
  'Defensieve middenvelder': 'bg-green-100 text-green-800',
  'Centrale middenvelder': 'bg-green-100 text-green-800',
  'Linksmiddenvelder': 'bg-green-100 text-green-800',
  'Rechtsmiddenvelder': 'bg-green-100 text-green-800',
  'Aanvallende middenvelder': 'bg-green-100 text-green-800',
  'Linksbuiten': 'bg-red-100 text-red-800',
  'Rechtsbuiten': 'bg-red-100 text-red-800',
  'Spits': 'bg-red-100 text-red-800',
}

export const FORMATIONS: Record<string, { label: string; positions: Omit<LineupPosition, 'player_id'>[] }> = {
  '4-3-3': {
    label: '4-3-3',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 15, y: 70, position_label: 'LV', position_number: 3 },
      { x: 38, y: 70, position_label: 'MV', position_number: 5 },
      { x: 62, y: 70, position_label: 'MV', position_number: 4 },
      { x: 85, y: 70, position_label: 'RV', position_number: 2 },
      { x: 25, y: 48, position_label: 'LM', position_number: 6 },
      { x: 50, y: 48, position_label: 'CM', position_number: 8 },
      { x: 75, y: 48, position_label: 'RM', position_number: 10 },
      { x: 20, y: 22, position_label: 'LA', position_number: 11 },
      { x: 50, y: 18, position_label: 'SP', position_number: 9 },
      { x: 80, y: 22, position_label: 'RA', position_number: 7 },
    ],
  },
  '4-4-2': {
    label: '4-4-2',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 15, y: 70, position_label: 'LV', position_number: 3 },
      { x: 38, y: 70, position_label: 'MV', position_number: 5 },
      { x: 62, y: 70, position_label: 'MV', position_number: 4 },
      { x: 85, y: 70, position_label: 'RV', position_number: 2 },
      { x: 15, y: 45, position_label: 'LM', position_number: 11 },
      { x: 38, y: 45, position_label: 'CM', position_number: 6 },
      { x: 62, y: 45, position_label: 'CM', position_number: 8 },
      { x: 85, y: 45, position_label: 'RM', position_number: 7 },
      { x: 35, y: 18, position_label: 'SP', position_number: 10 },
      { x: 65, y: 18, position_label: 'SP', position_number: 9 },
    ],
  },
  '4-2-3-1': {
    label: '4-2-3-1',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 15, y: 72, position_label: 'LV', position_number: 3 },
      { x: 38, y: 72, position_label: 'MV', position_number: 5 },
      { x: 62, y: 72, position_label: 'MV', position_number: 4 },
      { x: 85, y: 72, position_label: 'RV', position_number: 2 },
      { x: 35, y: 55, position_label: 'DM', position_number: 6 },
      { x: 65, y: 55, position_label: 'DM', position_number: 8 },
      { x: 15, y: 33, position_label: 'LA', position_number: 11 },
      { x: 50, y: 33, position_label: '10', position_number: 10 },
      { x: 85, y: 33, position_label: 'RA', position_number: 7 },
      { x: 50, y: 14, position_label: 'SP', position_number: 9 },
    ],
  },
  '3-4-3': {
    label: '3-4-3',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 25, y: 70, position_label: 'MV', position_number: 5 },
      { x: 50, y: 70, position_label: 'MV', position_number: 4 },
      { x: 75, y: 70, position_label: 'MV', position_number: 6 },
      { x: 20, y: 48, position_label: 'LM', position_number: 3 },
      { x: 40, y: 48, position_label: 'CM', position_number: 8 },
      { x: 60, y: 48, position_label: 'CM', position_number: 10 },
      { x: 80, y: 48, position_label: 'RM', position_number: 2 },
      { x: 20, y: 20, position_label: 'LA', position_number: 11 },
      { x: 50, y: 18, position_label: 'SP', position_number: 9 },
      { x: 80, y: 20, position_label: 'RA', position_number: 7 },
    ],
  },
  '5-3-2': {
    label: '5-3-2',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 10, y: 68, position_label: 'LVB', position_number: 3 },
      { x: 28, y: 68, position_label: 'LV', position_number: 5 },
      { x: 50, y: 68, position_label: 'MV', position_number: 4 },
      { x: 72, y: 68, position_label: 'RV', position_number: 6 },
      { x: 90, y: 68, position_label: 'RVB', position_number: 2 },
      { x: 25, y: 45, position_label: 'LM', position_number: 11 },
      { x: 50, y: 45, position_label: 'CM', position_number: 8 },
      { x: 75, y: 45, position_label: 'RM', position_number: 7 },
      { x: 35, y: 20, position_label: 'SP', position_number: 10 },
      { x: 65, y: 20, position_label: 'SP', position_number: 9 },
    ],
  },
}
