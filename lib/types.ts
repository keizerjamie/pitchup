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

// Soort speler. 'guest' staat LOS van `active`: een gastspeler is gewoon een
// actieve speler die standaard afwezig staat (lib/attendance-rows.ts) en die
// nooit meetelt in de teambrede statistieken (supabase/inzichten.sql). Zelfde
// patroon als `position`: DB-CHECK + const-array hier + migratiebestand in
// supabase/ (gastspelers.sql).
export type PlayerType = 'regular' | 'guest'

export const PLAYER_TYPES: PlayerType[] = ['regular', 'guest']

export interface Player {
  id: string
  name: string
  position: Position
  secondary_positions: Position[]
  jersey_number: number | null
  active: boolean
  injured: boolean
  // Bewust VERPLICHT (geen `?`): elke fixture en elke aanroeper moet bewust
  // kiezen, anders glipt een gast als reguliere speler door de statistieken.
  type: PlayerType
  rating: number | null
  created_at: string
}

export type EventType = 'training' | 'match' | 'meting'
export type MatchType = 'friendly' | 'league' | 'cup'
export type HomeAway = 'home' | 'away'
export type AttendanceStatus = 'present' | 'absent' | 'unknown'
// Uitkomst van één wedstrijd vanuit het eigen team gezien; 'unknown' = geen
// (volledige) uitslag ingevuld. Afgeleid door matchResult() in
// lib/match-analysis.mjs — één bron van waarheid voor de W/G/V-vorm.
export type MatchResult = 'win' | 'draw' | 'loss' | 'unknown'

export type OefeningCategorie =
  | 'warming_up'
  | 'partijen_groot'
  | 'partijen_midden'
  | 'partijen_klein'
  | 'positiespel'
  | 'pass_trap'
  | 'sprints_weinig_rust'
  | 'sprints_veel_rust'
  | 'steigerungs'
  | 'overig'

export type Orientatie = 'breedte' | 'lengte' | 'vrij'

export type Veldzone =
  | 'links'
  | 'midden'
  | 'rechts'
  | 'strafschopgebied_links'
  | 'strafschopgebied_rechts'

// Whitelists — gedeeld door de server actions (oefening-library / training-plan)
// en de client validatie, zodat er één bron van waarheid is.
export const OEFENING_CATEGORIES: OefeningCategorie[] = [
  'warming_up',
  'partijen_groot', 'partijen_midden', 'partijen_klein',
  'positiespel', 'pass_trap',
  'sprints_weinig_rust', 'sprints_veel_rust', 'steigerungs', 'overig',
]
export const VALID_ORIENTATIES: Orientatie[] = ['breedte', 'lengte', 'vrij']
export const VALID_VELDZONES: Veldzone[] = [
  'links', 'midden', 'rechts', 'strafschopgebied_links', 'strafschopgebied_rechts',
]

export const PERIODIZATION_CATEGORIES: {
  key: OefeningCategorie
  label: string
  maxStap: number
  color: string
  cycleWeeks: number[]
  hasMeting: boolean
}[] = [
  { key: 'warming_up',          label: 'Warming-up',          maxStap: 99, color: 'bg-teal-100 text-teal-800',    cycleWeeks: [],    hasMeting: false },
  { key: 'partijen_groot',      label: 'Partijen Groot',      maxStap: 21, color: 'bg-red-100 text-red-800',      cycleWeeks: [1,2], hasMeting: true  },
  { key: 'partijen_midden',     label: 'Partijen Midden',     maxStap: 15, color: 'bg-orange-100 text-orange-800', cycleWeeks: [3,4], hasMeting: true  },
  { key: 'partijen_klein',      label: 'Partijen Klein',      maxStap: 13, color: 'bg-amber-100 text-amber-800',  cycleWeeks: [5,6], hasMeting: true  },
  { key: 'positiespel',         label: 'Positiespel',         maxStap: 99, color: 'bg-purple-100 text-purple-800', cycleWeeks: [],    hasMeting: false },
  { key: 'pass_trap',           label: 'Pass- en trapvorm',   maxStap: 99, color: 'bg-cyan-100 text-cyan-800',    cycleWeeks: [],    hasMeting: false },
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

// Eén team binnen een oefening: aantal spelers + hooguit één gekozen formatie.
// `formaties` blijft een array (bestaande JSONB-vorm), maar validateOefening in
// lib/oefening.ts accepteert er nog maximaal één; die ene is de "basisformatie"
// die het diagram en de weergave voeden (zie basisFormatieDef in lib/formaties.ts).
export interface OefeningTeam {
  grootte: number
  formaties: string[] // lege array = "geen formatie" (los getekend, geen labels)
  // Telt de keeper mee in `grootte`? Ontbreekt het veld (oude rijen), dan true.
  // Bij grootte 11 altijd true. false = het team speelt zonder keeper, dus
  // `grootte` veldspelers en geen K-marker op de tekening.
  keeperInGrootte?: boolean
  // Bovengrens van een flexibel team. Afwezig/null = exact team (bestaand
  // gedrag). Alleen betekenisvol zonder formatie; bereikVoorTeam
  // (lib/oefening-bezetting.ts) is de enige plek die dat semantisch afdwingt.
  grootteMax?: number | null
}

// ────────────────────────────────────────────────
// Tactiekbord (diagram) — coördinaten
// ────────────────────────────────────────────────
// Eigen coördinatenstelsel voor de tekening: x ∈ [0,100], y ∈ [0,140].
// Een grotere y ligt richting het eigen doel / de eigen helft (onderin).
// Let op: dit verschilt van FormationDef.positions, waar y een PERCENT (0-100)
// is; generateDiagram schaalt die percenten naar het 0-140-stelsel.

export type DiagramMarkerRol = 'speler' | 'keeper' | 'neutraal'
export const DIAGRAM_MARKER_ROLLEN: DiagramMarkerRol[] = ['speler', 'keeper', 'neutraal']

export interface DiagramMarker {
  x: number
  y: number
  teamIndex: number | null
  rol: DiagramMarkerRol
  label?: string
}

export type DiagramMateriaalType = 'pion' | 'bal' | 'doeltje'
export const DIAGRAM_MATERIAAL_TYPES: DiagramMateriaalType[] = ['pion', 'bal', 'doeltje']

// Varianten van een doeltje (alleen betekenisvol als type === 'doeltje').
export type DiagramDoelVariant = 'groot' | 'klein' | 'mini'
export const DIAGRAM_DOEL_VARIANTEN: DiagramDoelVariant[] = ['groot', 'klein', 'mini']

export interface DiagramMateriaal {
  type: DiagramMateriaalType
  x: number
  y: number
  // Alleen relevant voor type === 'doeltje'; bij 'pion'/'bal' afwezig.
  variant?: DiagramDoelVariant
}

export type DiagramLijnStijl = 'pass' | 'loop' | 'dribbel'
export const DIAGRAM_LIJN_STIJLEN: DiagramLijnStijl[] = ['pass', 'loop', 'dribbel']

export interface DiagramLijn {
  stijl: DiagramLijnStijl
  punten: { x: number; y: number }[]
}

export interface Diagram {
  markers: DiagramMarker[]
  materiaal: DiagramMateriaal[]
  lijnen: DiagramLijn[]
}

// Bibliotheek-oefening (los van een event). De koppeling aan een training loopt
// via training_oefeningen (zie TrainingOefening).
export interface Oefening {
  id: string
  team_id: string
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
  // Bovengrens van een flexibel aantal neutralen (supabase/oefening-flexibel-
  // aantal.sql). NULL = vast aantal. Optioneel getypeerd om dezelfde reden als
  // parallel_groep_id hieronder: zolang de migratie in een omgeving niet
  // gedraaid heeft levert de server `undefined`.
  aantal_neutralen_max?: number | null
  diagram: Diagram | null
  created_at: string
}

// Training-specifieke teamindeling per gekoppelde oefening.
// Array-van-arrays: index = teamIndex binnen oefeningen.teams; elke sub-array is
// een lijst player_id's in dat team. Een player_id in geen enkele sub-array =
// in de pool.
export type Spelerindeling = string[][]

// Platte lijst player_id's die aan één oefening BINNEN een parallelle groep is
// toegewezen. Bewust geen string[][]: dit is géén teamindeling — een speler aan
// een parallelle oefening toewijzen zet hem NIET in een team van die oefening.
export type ParallelSpelers = string[]

// Training-specifieke bezetting van één gekoppelde oefening. DELTA-vorm:
// `teams[i]` hoort bij `oefeningen.teams[i]`; null = "gebruik de basisvorm".
// Het AANTAL teams verandert nooit — spelerindeling[i] blijft aan teams[i]
// gekoppeld. De grenzen zelf staan uitsluitend op de bibliotheek-oefening
// (grootteMax / aantal_neutralen_max); clampen gebeurt bij het lezen
// (concretiseerBezetting in lib/oefening-bezetting.ts).
export interface AantallenOverride {
  teams: (number | null)[]
  neutralen: number | null
}

// Koppeling van een bibliotheek-oefening aan één training (event).
export interface TrainingOefening {
  id: string
  team_id: string
  event_id: string
  oefening_id: string
  volgorde: number
  stap_override: number | null
  genest_in: string | null
  spelerindeling: Spelerindeling
  // Parallelle groep (supabase/parallelle-oefeningen.sql). Alle koppelingen van
  // één training met dezelfde `parallel_groep_id` draaien naast elkaar en delen
  // dezelfde `volgorde`; NULL = gewone sequentiële koppeling.
  //
  // Optioneel getypeerd, net zoals de leeslaag `spelerindeling` behandelt: zolang
  // de migratie in een omgeving nog niet gedraaid heeft levert de server voor
  // deze kolommen `undefined`. Alle consumenten (lib/parallel-groep.ts) vangen
  // dat af met `?? null` resp. `?? []`.
  parallel_groep_id?: string | null
  parallel_spelers?: ParallelSpelers
  // Training-specifieke bezetting binnen het bereik van de bibliotheek-oefening
  // (supabase/oefening-flexibel-aantal.sql). NULL/afwezig = geen override, dus
  // de basisvorm. Om dezelfde reden optioneel getypeerd als parallel_*.
  aantallen_override?: AantallenOverride | null
  created_at: string
}

// Koppeling inclusief de gejoinde bibliotheek-oefening (planner-weergave).
// Spiegelt de vorm van `.select('*, oefeningen(*)')`.
export interface TrainingOefeningWithData extends TrainingOefening {
  oefeningen: Oefening
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
  // Optionele verzameltijd, alleen relevant voor 'match'-events. Achteraf
  // aanpasbaar op de squad-pagina (app/events/[id]/squad/page.tsx), zie
  // updateGatherTime (app/actions/events.ts).
  gather_time: string | null
  notes: string | null
  doelstelling: string | null
  goals_for: number | null
  goals_against: number | null
  created_at: string
}

export type MatchEventKind = 'goal' | 'assist' | 'yellow' | 'red'

export const MATCH_EVENT_KINDS: MatchEventKind[] = ['goal', 'assist', 'yellow', 'red']

export interface MatchRating {
  id: string
  event_id: string
  player_id: string
  rating: number
  created_at: string
}

export interface MatchEvent {
  id: string
  event_id: string
  player_id: string
  kind: MatchEventKind
  minute: number | null
  created_at: string
}

// Een geregistreerde afmeldperiode van één speler. De rij ZELF is de periode:
// zolang hij bestaat, krijgt elk nieuw event binnen [from_date, to_date] voor
// deze speler automatisch status 'absent'. Intrekken = de rij verwijderen.
// Datums zijn kale kalenderdatums (YYYY-MM-DD); created_at is UTC (timestamptz).
export interface AbsencePeriod {
  id: string
  player_id: string
  from_date: string
  to_date: string
  created_at: string
}

export interface Attendance {
  id: string
  event_id: string
  player_id: string
  status: AttendanceStatus
  injury_set: boolean
  // Herkomst van een 'absent'-status: wélke afmeldperiode zette deze rij? null =
  // handmatig, door blessure of gewoon de standaardstatus — die rijen blijven bij
  // het intrekken van een periode ongemoeid.
  absence_period_id: string | null
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

// Slotlabel → de volwaardige positienaam waarop een speler wordt gescoord.
// Woonde eerder in components/LineupBuilder.tsx; hier verhuisd zodat
// lib/formations.test.ts kan bewaken dat elke formatie uitsluitend labels
// gebruikt die hierin voorkomen. Een label dat hier ontbreekt levert een lege
// `preferredPos` op, waarna getFitScore voor iedereen 0 teruggeeft — geen
// aanbeveling, geen auto-opstelling, en geen enkele foutmelding.
export const POSITION_LABEL_MAP: Record<string, string> = {
  KP: 'Keeper', LV: 'Linksachter', MV: 'Centrale verdediger', RV: 'Rechtsachter',
  LVB: 'Linksachter', RVB: 'Rechtsachter', DM: 'Defensieve middenvelder',
  CM: 'Centrale middenvelder', LM: 'Linksmiddenvelder', RM: 'Rechtsmiddenvelder',
  '10': 'Aanvallende middenvelder', LA: 'Linksbuiten', RA: 'Rechtsbuiten', SP: 'Spits',
}

// Gecureerde 11-tal-formaties. Sleutel = wat er in `lineups.formation` en in
// `oefeningen.teams[].formatie` wordt opgeslagen; `label` is wat de kiezer toont.
// De volgorde hieronder is de volgorde in de formatiekiezer van de
// opstellingsbouwer (gegroepeerd op verdedigingslinie: 4, dan 3, dan 5); de
// oefeningen-editor sorteert dezelfde lijst alfabetisch via formationsForSize.
//
// Twee harde regels, bewaakt door lib/formations.test.ts:
//   • Elk `position_label` moet in POSITION_LABEL_MAP staan. Een onbekend label
//     laat getFitScore voor iedereen 0 teruggeven: geen aanbeveling, geen
//     auto-opstelling voor dat slot — en dat faalt nergens luid.
//   • `position_number` is per formatie 1 t/m 11 zonder duplicaat: het NUMMER is
//     wat op een bezet poppetje staat (displayNum in LineupBuilder), niet het
//     rugnummer van de speler, dus twee gelijke nummers zijn niet te lezen.
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
  '4-3-3 (controleur)': {
    label: '4-3-3 (controleur)',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 15, y: 70, position_label: 'LV', position_number: 3 },
      { x: 38, y: 70, position_label: 'MV', position_number: 5 },
      { x: 62, y: 70, position_label: 'MV', position_number: 4 },
      { x: 85, y: 70, position_label: 'RV', position_number: 2 },
      { x: 50, y: 58, position_label: 'DM', position_number: 6 },
      { x: 32, y: 44, position_label: 'CM', position_number: 8 },
      { x: 68, y: 44, position_label: 'CM', position_number: 10 },
      { x: 20, y: 20, position_label: 'LA', position_number: 11 },
      { x: 50, y: 16, position_label: 'SP', position_number: 9 },
      { x: 80, y: 20, position_label: 'RA', position_number: 7 },
    ],
  },
  '4-3-3 (dubbele 6)': {
    label: '4-3-3 (dubbele 6)',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 15, y: 72, position_label: 'LV', position_number: 3 },
      { x: 38, y: 72, position_label: 'MV', position_number: 5 },
      { x: 62, y: 72, position_label: 'MV', position_number: 4 },
      { x: 85, y: 72, position_label: 'RV', position_number: 2 },
      { x: 35, y: 57, position_label: 'DM', position_number: 6 },
      { x: 65, y: 57, position_label: 'DM', position_number: 8 },
      { x: 50, y: 38, position_label: '10', position_number: 10 },
      { x: 18, y: 20, position_label: 'LA', position_number: 11 },
      { x: 50, y: 15, position_label: 'SP', position_number: 9 },
      { x: 82, y: 20, position_label: 'RA', position_number: 7 },
    ],
  },
  '4-3-3 (valse 9)': {
    label: '4-3-3 (valse 9)',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 15, y: 70, position_label: 'LV', position_number: 3 },
      { x: 38, y: 70, position_label: 'MV', position_number: 5 },
      { x: 62, y: 70, position_label: 'MV', position_number: 4 },
      { x: 85, y: 70, position_label: 'RV', position_number: 2 },
      { x: 25, y: 48, position_label: 'LM', position_number: 6 },
      { x: 50, y: 48, position_label: 'CM', position_number: 8 },
      { x: 75, y: 48, position_label: 'RM', position_number: 10 },
      { x: 14, y: 17, position_label: 'LA', position_number: 11 },
      { x: 50, y: 32, position_label: 'SP', position_number: 9 },
      { x: 86, y: 17, position_label: 'RA', position_number: 7 },
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
  '4-4-2 (ruit)': {
    label: '4-4-2 (ruit)',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 15, y: 70, position_label: 'LV', position_number: 3 },
      { x: 38, y: 70, position_label: 'MV', position_number: 5 },
      { x: 62, y: 70, position_label: 'MV', position_number: 4 },
      { x: 85, y: 70, position_label: 'RV', position_number: 2 },
      { x: 50, y: 58, position_label: 'DM', position_number: 6 },
      { x: 22, y: 45, position_label: 'LM', position_number: 8 },
      { x: 78, y: 45, position_label: 'RM', position_number: 7 },
      { x: 50, y: 33, position_label: '10', position_number: 10 },
      { x: 36, y: 16, position_label: 'SP', position_number: 9 },
      { x: 64, y: 16, position_label: 'SP', position_number: 11 },
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
  '4-1-4-1': {
    label: '4-1-4-1',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 15, y: 72, position_label: 'LV', position_number: 3 },
      { x: 38, y: 72, position_label: 'MV', position_number: 5 },
      { x: 62, y: 72, position_label: 'MV', position_number: 4 },
      { x: 85, y: 72, position_label: 'RV', position_number: 2 },
      { x: 50, y: 58, position_label: 'DM', position_number: 6 },
      { x: 14, y: 42, position_label: 'LM', position_number: 11 },
      { x: 38, y: 42, position_label: 'CM', position_number: 8 },
      { x: 62, y: 42, position_label: 'CM', position_number: 10 },
      { x: 86, y: 42, position_label: 'RM', position_number: 7 },
      { x: 50, y: 16, position_label: 'SP', position_number: 9 },
    ],
  },
  '4-5-1': {
    label: '4-5-1',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 15, y: 72, position_label: 'LV', position_number: 3 },
      { x: 38, y: 72, position_label: 'MV', position_number: 5 },
      { x: 62, y: 72, position_label: 'MV', position_number: 4 },
      { x: 85, y: 72, position_label: 'RV', position_number: 2 },
      { x: 12, y: 45, position_label: 'LM', position_number: 11 },
      { x: 33, y: 47, position_label: 'CM', position_number: 8 },
      { x: 50, y: 55, position_label: 'DM', position_number: 6 },
      { x: 67, y: 47, position_label: 'CM', position_number: 10 },
      { x: 88, y: 45, position_label: 'RM', position_number: 7 },
      { x: 50, y: 18, position_label: 'SP', position_number: 9 },
    ],
  },
  '4-2-2-2': {
    label: '4-2-2-2',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 15, y: 72, position_label: 'LV', position_number: 3 },
      { x: 38, y: 72, position_label: 'MV', position_number: 5 },
      { x: 62, y: 72, position_label: 'MV', position_number: 4 },
      { x: 85, y: 72, position_label: 'RV', position_number: 2 },
      { x: 33, y: 57, position_label: 'DM', position_number: 6 },
      { x: 67, y: 57, position_label: 'DM', position_number: 8 },
      { x: 25, y: 36, position_label: '10', position_number: 10 },
      { x: 75, y: 36, position_label: '10', position_number: 7 },
      { x: 38, y: 16, position_label: 'SP', position_number: 9 },
      { x: 62, y: 16, position_label: 'SP', position_number: 11 },
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
  '3-5-2': {
    label: '3-5-2',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 25, y: 70, position_label: 'MV', position_number: 5 },
      { x: 50, y: 70, position_label: 'MV', position_number: 4 },
      { x: 75, y: 70, position_label: 'MV', position_number: 6 },
      { x: 10, y: 48, position_label: 'LVB', position_number: 3 },
      { x: 33, y: 45, position_label: 'CM', position_number: 10 },
      { x: 50, y: 58, position_label: 'DM', position_number: 8 },
      { x: 67, y: 45, position_label: 'CM', position_number: 7 },
      { x: 90, y: 48, position_label: 'RVB', position_number: 2 },
      { x: 38, y: 18, position_label: 'SP', position_number: 9 },
      { x: 62, y: 18, position_label: 'SP', position_number: 11 },
    ],
  },
  '3-4-2-1': {
    label: '3-4-2-1',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 25, y: 70, position_label: 'MV', position_number: 5 },
      { x: 50, y: 70, position_label: 'MV', position_number: 4 },
      { x: 75, y: 70, position_label: 'MV', position_number: 6 },
      { x: 12, y: 48, position_label: 'LM', position_number: 3 },
      { x: 38, y: 50, position_label: 'CM', position_number: 8 },
      { x: 62, y: 50, position_label: 'CM', position_number: 10 },
      { x: 88, y: 48, position_label: 'RM', position_number: 2 },
      { x: 32, y: 30, position_label: '10', position_number: 11 },
      { x: 68, y: 30, position_label: '10', position_number: 7 },
      { x: 50, y: 15, position_label: 'SP', position_number: 9 },
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
  '5-4-1': {
    label: '5-4-1',
    positions: [
      { x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { x: 10, y: 66, position_label: 'LVB', position_number: 3 },
      { x: 28, y: 68, position_label: 'LV', position_number: 5 },
      { x: 50, y: 68, position_label: 'MV', position_number: 4 },
      { x: 72, y: 68, position_label: 'RV', position_number: 6 },
      { x: 90, y: 66, position_label: 'RVB', position_number: 2 },
      { x: 18, y: 45, position_label: 'LM', position_number: 11 },
      { x: 40, y: 45, position_label: 'CM', position_number: 8 },
      { x: 60, y: 45, position_label: 'CM', position_number: 10 },
      { x: 82, y: 45, position_label: 'RM', position_number: 7 },
      { x: 50, y: 17, position_label: 'SP', position_number: 9 },
    ],
  },
}

// ────────────────────────────────────────────────
// Formaties per teamgrootte (oefening-teams)
// ────────────────────────────────────────────────
// Zelfde 0-100-coördinatenstelsel als FORMATIONS: x links→rechts, y eigen doel
// (y=90) → aanval (kleinere y). K = keeper, V = verdediger, M = middenvelder,
// A = aanvaller. Dit is een pragmatische standaardset voor Nederlands
// jeugd/partijspel; de gebruiker kan deze later bijstellen.

export interface FormationDef {
  key: string
  label: string
  positions: Omit<LineupPosition, 'player_id'>[]
}

// 11-tal hergebruikt de bestaande FORMATIONS-vormen/labels ongewijzigd.
const FORMATIONS_11: FormationDef[] = Object.entries(FORMATIONS).map(([key, f]) => ({
  key,
  label: f.label,
  positions: f.positions,
}))

export const FORMATIONS_BY_TEAM_SIZE: Record<number, FormationDef[]> = {
  3: [
    { key: '1-1', label: '1-1', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 50, y: 58, position_label: 'V' },
      { x: 50, y: 25, position_label: 'A' },
    ] },
    { key: '2-0+K', label: '2-0+K', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 32, y: 55, position_label: 'V' },
      { x: 68, y: 55, position_label: 'V' },
    ] },
  ],
  4: [
    { key: '2-1', label: '2-1', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 30, y: 62, position_label: 'V' },
      { x: 70, y: 62, position_label: 'V' },
      { x: 50, y: 25, position_label: 'A' },
    ] },
    { key: '1-2', label: '1-2', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 50, y: 62, position_label: 'V' },
      { x: 32, y: 28, position_label: 'A' },
      { x: 68, y: 28, position_label: 'A' },
    ] },
  ],
  5: [
    { key: '2-1-1', label: '2-1-1', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 30, y: 65, position_label: 'V' },
      { x: 70, y: 65, position_label: 'V' },
      { x: 50, y: 45, position_label: 'M' },
      { x: 50, y: 22, position_label: 'A' },
    ] },
    { key: '1-2-1', label: '1-2-1', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 50, y: 68, position_label: 'V' },
      { x: 30, y: 45, position_label: 'M' },
      { x: 70, y: 45, position_label: 'M' },
      { x: 50, y: 22, position_label: 'A' },
    ] },
  ],
  6: [
    { key: '2-2-1', label: '2-2-1', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 30, y: 68, position_label: 'V' },
      { x: 70, y: 68, position_label: 'V' },
      { x: 30, y: 42, position_label: 'M' },
      { x: 70, y: 42, position_label: 'M' },
      { x: 50, y: 20, position_label: 'A' },
    ] },
    { key: '3-2', label: '3-2', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 25, y: 66, position_label: 'V' },
      { x: 50, y: 66, position_label: 'V' },
      { x: 75, y: 66, position_label: 'V' },
      { x: 35, y: 28, position_label: 'A' },
      { x: 65, y: 28, position_label: 'A' },
    ] },
  ],
  7: [
    { key: '2-3-1', label: '2-3-1', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 30, y: 70, position_label: 'V' },
      { x: 70, y: 70, position_label: 'V' },
      { x: 22, y: 45, position_label: 'M' },
      { x: 50, y: 45, position_label: 'M' },
      { x: 78, y: 45, position_label: 'M' },
      { x: 50, y: 20, position_label: 'A' },
    ] },
    { key: '3-2-1', label: '3-2-1', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 25, y: 70, position_label: 'V' },
      { x: 50, y: 70, position_label: 'V' },
      { x: 75, y: 70, position_label: 'V' },
      { x: 35, y: 45, position_label: 'M' },
      { x: 65, y: 45, position_label: 'M' },
      { x: 50, y: 20, position_label: 'A' },
    ] },
  ],
  8: [
    { key: '3-3-1', label: '3-3-1', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 22, y: 72, position_label: 'V' },
      { x: 50, y: 72, position_label: 'V' },
      { x: 78, y: 72, position_label: 'V' },
      { x: 22, y: 45, position_label: 'M' },
      { x: 50, y: 45, position_label: 'M' },
      { x: 78, y: 45, position_label: 'M' },
      { x: 50, y: 20, position_label: 'A' },
    ] },
    { key: '3-2-2', label: '3-2-2', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 22, y: 72, position_label: 'V' },
      { x: 50, y: 72, position_label: 'V' },
      { x: 78, y: 72, position_label: 'V' },
      { x: 35, y: 47, position_label: 'M' },
      { x: 65, y: 47, position_label: 'M' },
      { x: 35, y: 22, position_label: 'A' },
      { x: 65, y: 22, position_label: 'A' },
    ] },
  ],
  9: [
    { key: '3-3-2', label: '3-3-2', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 22, y: 73, position_label: 'V' },
      { x: 50, y: 73, position_label: 'V' },
      { x: 78, y: 73, position_label: 'V' },
      { x: 25, y: 48, position_label: 'M' },
      { x: 50, y: 48, position_label: 'M' },
      { x: 75, y: 48, position_label: 'M' },
      { x: 38, y: 22, position_label: 'A' },
      { x: 62, y: 22, position_label: 'A' },
    ] },
    { key: '3-4-1', label: '3-4-1', positions: [
      { x: 50, y: 90, position_label: 'K' },
      { x: 22, y: 73, position_label: 'V' },
      { x: 50, y: 73, position_label: 'V' },
      { x: 78, y: 73, position_label: 'V' },
      { x: 18, y: 48, position_label: 'M' },
      { x: 40, y: 48, position_label: 'M' },
      { x: 60, y: 48, position_label: 'M' },
      { x: 82, y: 48, position_label: 'M' },
      { x: 50, y: 22, position_label: 'A' },
    ] },
  ],
  11: FORMATIONS_11,
}

// Alfabetisch op label; bij gelijk label op key als tiebreak (stabiel).
const byLabel = (a: FormationDef, b: FormationDef) =>
  a.label.localeCompare(b.label, 'nl') || a.key.localeCompare(b.key, 'nl')

// Eén keer bij module-init gesorteerde KOPIEËN. FORMATIONS en
// FORMATIONS_BY_TEAM_SIZE zelf blijven ongemuteerd: die worden ook los gebruikt
// (o.a. door components/LineupBuilder.tsx voor de wedstrijdopstelling), waar de
// oorspronkelijke volgorde betekenis heeft.
const FORMATIONS_SORTED_BY_TEAM_SIZE: Record<number, FormationDef[]> = Object.fromEntries(
  Object.entries(FORMATIONS_BY_TEAM_SIZE).map(([n, list]) => [Number(n), [...list].sort(byLabel)]),
)
const NO_FORMATIONS: FormationDef[] = []

// Formaties beschikbaar voor een gegeven teamgrootte, alfabetisch op label.
// LET OP: deze gecureerde lijst is voor oefening-teams alleen nog in gebruik voor
// (a) het 11-tal en (b) als resolutie-vangnet voor oude keys als '2-0+K'. De
// keuzelijst van alle overige groottes komt uit de generator in lib/formaties.ts.
// Grootte 10 blijft hier bewust leeg (legacy-gedrag); de generator ondersteunt 10 wél.
export function formationsForSize(n: number): FormationDef[] {
  return FORMATIONS_SORTED_BY_TEAM_SIZE[n] ?? NO_FORMATIONS
}

// Dual-read: accepteert zowel de nieuwe vorm {grootte, formaties: string[]} als
// de legacy vorm {grootte, formatie: string|null} uit bestaande JSONB-rijen.
// Strippt al het andere. Er is bewust GEEN datamigratie: bij de volgende save
// wordt de nieuwe vorm weggeschreven.
export function normalizeOefeningTeam(raw: unknown): OefeningTeam {
  const r = (raw ?? {}) as {
    grootte?: unknown
    formaties?: unknown
    formatie?: unknown
    keeperInGrootte?: unknown
    grootteMax?: unknown
  }
  const grootte = Number(r.grootte)
  let keys: string[]
  if (Array.isArray(r.formaties)) {
    keys = r.formaties.filter((v): v is string => typeof v === 'string' && v !== '')
  } else if (typeof r.formatie === 'string' && r.formatie !== '') {
    keys = [r.formatie]
  } else {
    keys = []
  }
  // Ontbrekend/niet-booleaans veld → true (bestaande rijen tellen de keeper mee).
  // Een 11-tal telt de keeper altijd mee (gecureerde FORMATIONS-lijst).
  const keeperInGrootte =
    grootte === 11 ? true : typeof r.keeperInGrootte === 'boolean' ? r.keeperInGrootte : true
  // Bovengrens van een flexibel team — VORMnormalisatie, geen semantiek: alleen
  // een geheel getal dat niet onder `grootte` ligt overleeft. Of het bereik ook
  // BETEKENIS heeft (geen formatie, binnen VALID_TEAM_SIZES) beslist
  // bereikVoorTeam in lib/oefening-bezetting.ts; afwijzen bij opslaan doet
  // validateOefening in lib/oefening.ts.
  //
  // Ontbreekt het veld, dan blijft het ook in de uitvoer ONTBREKEN (geen
  // `grootteMax: null`-ruis). Zo levert een exacte oefening dezelfde JSONB en
  // dezelfde genormaliseerde vorm op als vóór deze feature.
  // `null` eerst afvangen: Number(null) is 0, en dat zou bij een los team
  // (grootte 0) een zinloze grootteMax 0 opleveren.
  const gm =
    r.grootteMax === null || r.grootteMax === undefined
      ? Number.NaN
      : Math.floor(Number(r.grootteMax))
  const grootteMax = Number.isFinite(gm) && gm >= grootte ? gm : null
  return {
    grootte,
    formaties: [...new Set(keys)],
    keeperInGrootte,
    ...(grootteMax !== null ? { grootteMax } : {}),
  }
}

export function normalizeOefeningTeams(raw: unknown): OefeningTeam[] {
  return Array.isArray(raw) ? raw.slice(0, 6).map(normalizeOefeningTeam) : []
}
