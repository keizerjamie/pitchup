import type { SupabaseClient } from '@supabase/supabase-js'
import { PERIODIZATION_CATEGORIES, berekenStap, type CategorieMeting } from '@/lib/types'
import { toUtcMs } from '@/lib/season-dates'

export const CYCLE_LENGTH_WEEKS = 6

// De join `oefeningen(categorie)` levert (afhankelijk van de client-typing) een
// object óf een array van één rij. Normaliseer naar de categorie-string.
export function joinedCategorie(row: { oefeningen?: unknown }): string | null {
  const joined = row.oefeningen
  const rec = Array.isArray(joined) ? joined[0] : joined
  if (rec && typeof rec === 'object' && 'categorie' in rec) {
    return (rec as { categorie: string }).categorie
  }
  return null
}

// Week within the 6-week cycle (1-based), counted from the cycle's anchor date.
//
// Bewust UTC (toUtcMs), niet `new Date(str + 'T00:00:00')`: bij een lokale
// zomertijdovergang binnen het venster telt een week 167 of 169 uur, waardoor
// `floor(ms / weekMs)` een hele week kon misrekenen — 25 maart → 1 april gaf
// dan week 1 in plaats van week 2. Beide argumenten zijn kale kalenderdatums,
// dus er hoort geen tijdzone aan te pas te komen. Ongeldige datum ⇒ week 1.
export function cycleWeekFor(nulmetingDate: string, onDate: string): number {
  const van = toUtcMs(nulmetingDate)
  const tot = toUtcMs(onDate)
  if (van === null || tot === null) return 1
  const weeks = Math.max(0, Math.floor((tot - van) / (7 * 86_400_000)))
  return (weeks % CYCLE_LENGTH_WEEKS) + 1
}

// Categories scheduled for the given cycle week ('overig' has no schedule).
export function dueCategories(cycleWeek: number) {
  return PERIODIZATION_CATEGORIES.filter((c) => c.cycleWeeks.includes(cycleWeek))
}

// ────────────────────────────────────────────────
// Nulmeting per onderdeel
// ────────────────────────────────────────────────
// Elk meetbaar onderdeel heeft zijn eigen meetdatum en zijn eigen
// geschiedenis (tabel categorie_metingen). Alle datumvergelijkingen hieronder
// gaan over 'YYYY-MM-DD'-strings: lexicografisch = chronologisch, dus er komt
// geen Date en dus geen tijdzone aan te pas.

// De meting die op dit moment voor één onderdeel geldt.
export interface ActueleMeting {
  id: string
  categorie: string
  datum: string
  stap: number
  notes: string | null
}

// Per categorie de meting met de HOOGSTE datum vóór de peildatum — niet de
// laatst ingevoerde. Een achteraf toegevoegde, oudere meting verdringt de
// actuele dus nooit.
//
// De peildatum is EXCLUSIEF en verschilt per pagina: dashboard en
// /periodisering gebruiken morgen (een meting van vandaag telt meteen mee),
// de trainingsplanner gebruikt de datum van die training (strikt ervóór).
export function actueleMetingen(
  rows: CategorieMeting[],
  peildatumExclusief: string,
): Record<string, ActueleMeting> {
  const actueel: Record<string, ActueleMeting> = {}
  for (const rij of rows) {
    if (rij.datum >= peildatumExclusief) continue
    const huidig = actueel[rij.categorie]
    if (huidig && huidig.datum >= rij.datum) continue
    actueel[rij.categorie] = {
      id: rij.id,
      categorie: rij.categorie,
      datum: rij.datum,
      stap: rij.stap,
      notes: rij.notes,
    }
  }
  return actueel
}

// Ankerdatum van de cyclus = de VROEGSTE datum onder de actuele metingen.
// Nergens opgeslagen; hij wordt bij elke render opnieuw afgeleid, zodat een
// gewijzigde meetdatum de cyclus vanzelf meeneemt. Null zonder metingen.
export function ankerDatum(actueel: Record<string, ActueleMeting>): string | null {
  let anker: string | null = null
  for (const meting of Object.values(actueel)) {
    if (anker === null || meting.datum < anker) anker = meting.datum
  }
  return anker
}

// Volledige geschiedenis per categorie, NIEUWSTE EERST. Bewust hier gesorteerd
// en niet op de queryvolgorde vertrouwd: de volgorde is onderdeel van het
// contract (de bovenste rij is de enige die bewerkt of verwijderd mag worden).
export function metingenPerCategorie(rows: CategorieMeting[]): Record<string, CategorieMeting[]> {
  const perCategorie: Record<string, CategorieMeting[]> = {}
  for (const rij of rows) {
    if (!perCategorie[rij.categorie]) perCategorie[rij.categorie] = []
    perCategorie[rij.categorie].push(rij)
  }
  for (const lijst of Object.values(perCategorie)) {
    lijst.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0))
  }
  return perCategorie
}

// Statusregel per meetbaar onderdeel voor dashboard en /periodisering.
// `week` is de vaste eerste cyclusweek van dat onderdeel (week 1 / 3 / 5) —
// die staat los van een eventueel al lopende cyclus.
export type OnderdeelStatus =
  | { key: string; gemeten: true; stap: number | null; maxStap: number; datum: string }
  | { key: string; gemeten: false; week: number }

export function onderdeelStatus(
  actueel: Record<string, ActueleMeting>,
  currentSteps: Record<string, number | null>,
): OnderdeelStatus[] {
  return PERIODIZATION_CATEGORIES.filter((cat) => cat.hasMeting).map((cat) => {
    const meting = actueel[cat.key]
    if (!meting) return { key: cat.key, gemeten: false, week: cat.cycleWeeks[0] }
    return {
      key: cat.key,
      gemeten: true,
      stap: currentSteps[cat.key] ?? null,
      maxStap: cat.maxStap,
      datum: meting.datum,
    }
  })
}

// Loopt er een hermetingsronde? Puur een observatie over de al ingelezen
// metingen: zolang de onderdelen niet allemaal binnen één cyclus zijn gemeten,
// volgt de cyclusweek de OUDSTE meting terwijl een deel al hermeten is. Dat is
// bewust gedrag, maar zonder uitleg onbegrijpelijk — vandaar deze stand.
export interface HermetingStand {
  actief: boolean // true = de hint tonen
  hermeten: number // onderdelen waarvan de actuele meting ná het anker valt
  gemeten: number // onderdelen met een actuele meting (de noemer, niet hard 5)
  spreidingDagen: number // hele dagen tussen de vroegste en de laatste meting
}

export function hermetingStand(actueel: Record<string, ActueleMeting>): HermetingStand {
  const datums = Object.values(actueel).map((meting) => meting.datum)
  const gemeten = datums.length
  if (gemeten === 0) return { actief: false, hermeten: 0, gemeten: 0, spreidingDagen: 0 }

  let anker = datums[0]
  let laatste = datums[0]
  for (const datum of datums) {
    if (datum < anker) anker = datum
    if (datum > laatste) laatste = datum
  }

  // Een onderdeel telt als hermeten zodra zijn actuele meting later valt dan
  // het anker — ook als het pas ná het anker voor het eerst is gemeten.
  const hermeten = datums.filter((datum) => datum > anker).length

  const ankerMs = toUtcMs(anker)
  const laatsteMs = toUtcMs(laatste)
  if (ankerMs === null || laatsteMs === null) {
    return { actief: false, hermeten, gemeten, spreidingDagen: 0 }
  }

  // 86_400_000 = één dag in ms (DAY_MS in lib/season-dates.ts is niet
  // geëxporteerd). Beide datums zijn DATE-kolommen op middernacht UTC, dus de
  // uitkomst is altijd een geheel aantal dagen.
  const spreidingDagen = (laatsteMs - ankerMs) / 86_400_000

  // STRIKT groter dan één volle cyclus: bij exact 42 dagen wijst
  // cycleWeekFor(anker, laatste) weer naar week 1 en is de cyclus nog coherent.
  return { actief: spreidingDagen > CYCLE_LENGTH_WEEKS * 7, hermeten, gemeten, spreidingDagen }
}

// Per category: in how many trainingen (strictly between the two dates) the
// category appeared. Multiple exercises in one training count once.
export async function countCategoryOccurrences(
  supabase: SupabaseClient,
  teamId: string,
  fromDateExclusive: string,
  toDateExclusive: string,
): Promise<Record<string, number>> {
  const occurrences: Record<string, number> = {}

  const { data: trainingsInRange } = await supabase
    .from('events')
    .select('id')
    .eq('team_id', teamId)
    .eq('type', 'training')
    .gt('date', fromDateExclusive)
    .lt('date', toDateExclusive)

  if (!trainingsInRange || trainingsInRange.length === 0) return occurrences

  const eventIds = trainingsInRange.map((e) => e.id)
  const { data: exerciseData } = await supabase
    .from('training_oefeningen')
    .select('event_id, oefeningen(categorie)')
    .in('event_id', eventIds)
    .eq('team_id', teamId)

  if (!exerciseData) return occurrences

  const catEvents: Record<string, Set<string>> = {}
  for (const ex of exerciseData) {
    const categorie = joinedCategorie(ex)
    if (!categorie) continue
    if (!catEvents[categorie]) catEvents[categorie] = new Set()
    catEvents[categorie].add(ex.event_id)
  }
  for (const [cat, eventSet] of Object.entries(catEvents)) {
    occurrences[cat] = eventSet.size
  }
  return occurrences
}

export interface TrainingLogItem {
  key: string
  step: number | null
  override: boolean
}

export interface TrainingLogEntry {
  eventId: string
  date: string
  items: TrainingLogItem[]
}

export interface LastDoneEntry {
  date: string
  step: number | null
}

export interface TrainingLogResultaat {
  log: TrainingLogEntry[]
  lastByCategory: Record<string, LastDoneEntry>
  occurrences: Record<string, number>
  currentSteps: Record<string, number | null>
}

// Chronologisch log van wat er per onderdeel daadwerkelijk getraind is sinds
// zijn EIGEN meting: voor elke training met oefeningen de stap die op dat
// moment gold (meting + floor(k/2), of de handmatige stap_override). Het
// venster begint bij de ankerdatum (de vroegste actuele meting) en loopt tot
// `toDateExclusive`. Geeft het log (nieuwste eerst), de laatste regel per
// categorie, de telling per categorie en de daaruit volgende actuele stappen.
export async function getTrainingLog(
  supabase: SupabaseClient,
  teamId: string,
  actueel: Record<string, ActueleMeting>,
  toDateExclusive: string,
): Promise<TrainingLogResultaat> {
  const fromDateExclusive = ankerDatum(actueel)

  const log: TrainingLogEntry[] = []
  const lastByCategory: Record<string, LastDoneEntry> = {}
  const occurrences: Record<string, number> = {}

  // Zonder één gemeten onderdeel is er geen cyclus en dus geen venster: geen
  // enkele query, alle stappen null.
  if (fromDateExclusive === null) {
    return { log, lastByCategory, occurrences, currentSteps: computeCurrentSteps(actueel, occurrences) }
  }

  const { data: trainings } = await supabase
    .from('events')
    .select('id, date')
    .eq('team_id', teamId)
    .eq('type', 'training')
    .gt('date', fromDateExclusive)
    .lt('date', toDateExclusive)
    .order('date', { ascending: true })

  if (!trainings || trainings.length === 0) {
    return { log, lastByCategory, occurrences, currentSteps: computeCurrentSteps(actueel, occurrences) }
  }

  const { data: exercises } = await supabase
    .from('training_oefeningen')
    .select('event_id, stap_override, oefeningen(categorie)')
    .in('event_id', trainings.map((t) => t.id))
    .eq('team_id', teamId)

  const byEvent = new Map<string, { categorie: string; stap_override: number | null }[]>()
  for (const ex of exercises ?? []) {
    const categorie = joinedCategorie(ex)
    if (!categorie) continue
    const list = byEvent.get(ex.event_id) ?? []
    list.push({ categorie, stap_override: ex.stap_override ?? null })
    byEvent.set(ex.event_id, list)
  }

  const catOrder = (key: string) => PERIODIZATION_CATEGORIES.findIndex((c) => c.key === key)

  for (const training of trainings) {
    const exs = byEvent.get(training.id)
    if (!exs || exs.length === 0) continue

    // One entry per category per training; a manual stap_override wins.
    const overrideByCat = new Map<string, number | null>()
    for (const ex of exs) {
      const existing = overrideByCat.get(ex.categorie)
      if (existing === undefined || (existing === null && ex.stap_override !== null)) {
        overrideByCat.set(ex.categorie, ex.stap_override)
      }
    }

    const items: TrainingLogItem[] = []
    for (const [key, override] of overrideByCat) {
      const k = occurrences[key] ?? 0
      // Telt deze training mee voor de stap-telling van dit onderdeel? Strikt
      // ná de EIGEN meetdatum: een training op de meetdatum zelf telt niet, en
      // een training die vóór de meting van B maar ná die van A ligt telt
      // alleen voor A.
      const eigen = actueel[key]
      const teltMee = eigen !== undefined && training.date > eigen.datum
      const computed = teltMee ? berekenStap(eigen.stap, k) : null
      const step = override ?? computed
      items.push({ key, step, override: override !== null })
      if (teltMee) {
        occurrences[key] = k + 1
        lastByCategory[key] = { date: training.date, step }
      }
    }

    items.sort((a, b) => catOrder(a.key) - catOrder(b.key))
    log.push({ eventId: training.id, date: training.date, items })
  }

  log.reverse()
  return { log, lastByCategory, occurrences, currentSteps: computeCurrentSteps(actueel, occurrences) }
}

// Actuele stap per categorie: de stap van de actuele meting van dat onderdeel
// + floor(occurrences / 2) ("verzwaren en herhalen"). Null voor een onderdeel
// zonder (actuele) meting en voor elke categorie zonder nulmeting. Bewust NIET
// geclampt: een berekende stap mag boven het categorie-maximum uitkomen.
export function computeCurrentSteps(
  actueel: Record<string, ActueleMeting>,
  occurrences: Record<string, number>,
): Record<string, number | null> {
  const currentSteps: Record<string, number | null> = {}
  for (const cat of PERIODIZATION_CATEGORIES) {
    const meting = cat.hasMeting ? actueel[cat.key] : undefined
    currentSteps[cat.key] = meting ? berekenStap(meting.stap, occurrences[cat.key] ?? 0) : null
  }
  return currentSteps
}
