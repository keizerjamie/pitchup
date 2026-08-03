import type { SupabaseClient } from '@supabase/supabase-js'
import { PERIODIZATION_CATEGORIES, berekenStap, MetingData } from '@/lib/types'

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

// Week within the 6-week cycle (1-based), counted from the nulmeting date.
export function cycleWeekFor(nulmetingDate: string, onDate: string): number {
  const ms = new Date(onDate + 'T00:00:00').getTime() - new Date(nulmetingDate + 'T00:00:00').getTime()
  const weeks = Math.max(0, Math.floor(ms / (7 * 86_400_000)))
  return (weeks % CYCLE_LENGTH_WEEKS) + 1
}

// Categories scheduled for the given cycle week ('overig' has no schedule).
export function dueCategories(cycleWeek: number) {
  return PERIODIZATION_CATEGORIES.filter((c) => c.cycleWeeks.includes(cycleWeek))
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

// Chronological log of what was actually trained per category since the
// nulmeting: for every training with exercises, the step that applied at that
// moment (nulmeting + floor(k/2), or the exercise's stap_override). Returns
// the log (newest first), the last entry per category, and the occurrence
// counts (same numbers countCategoryOccurrences would give).
export async function getTrainingLog(
  supabase: SupabaseClient,
  teamId: string,
  meting: MetingData,
  fromDateExclusive: string,
  toDateExclusive: string,
): Promise<{
  log: TrainingLogEntry[]
  lastByCategory: Record<string, LastDoneEntry>
  occurrences: Record<string, number>
}> {
  const log: TrainingLogEntry[] = []
  const lastByCategory: Record<string, LastDoneEntry> = {}
  const occurrences: Record<string, number> = {}

  const { data: trainings } = await supabase
    .from('events')
    .select('id, date')
    .eq('team_id', teamId)
    .eq('type', 'training')
    .gt('date', fromDateExclusive)
    .lt('date', toDateExclusive)
    .order('date', { ascending: true })

  if (!trainings || trainings.length === 0) return { log, lastByCategory, occurrences }

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
      const catMeta = PERIODIZATION_CATEGORIES.find((c) => c.key === key)
      const k = occurrences[key] ?? 0
      const nulStap = catMeta?.hasMeting
        ? (meting[`${key}_stap` as keyof MetingData] as number | undefined)
        : undefined
      const computed = typeof nulStap === 'number' ? berekenStap(nulStap, k) : null
      const step = override ?? computed
      items.push({ key, step, override: override !== null })
      occurrences[key] = k + 1
      lastByCategory[key] = { date: training.date, step }
    }

    items.sort((a, b) => catOrder(a.key) - catOrder(b.key))
    log.push({ eventId: training.id, date: training.date, items })
  }

  log.reverse()
  return { log, lastByCategory, occurrences }
}

// Current step per category: nulmeting step + floor(occurrences / 2)
// ("verzwaren en herhalen"). Null when the category has no meting.
export function computeCurrentSteps(
  meting: MetingData | null,
  occurrences: Record<string, number>,
): Record<string, number | null> {
  const currentSteps: Record<string, number | null> = {}
  for (const cat of PERIODIZATION_CATEGORIES) {
    if (!cat.hasMeting || !meting) {
      currentSteps[cat.key] = null
      continue
    }
    const nulStap = meting[`${cat.key}_stap` as keyof MetingData] as number | undefined
    if (typeof nulStap !== 'number') {
      currentSteps[cat.key] = null
      continue
    }
    currentSteps[cat.key] = berekenStap(nulStap, occurrences[cat.key] ?? 0)
  }
  return currentSteps
}
