// Pure validatie en constanten voor RPE en doelstelling-oordeel per training
// (tabel `training_evaluaties`, supabase/inzichten-metrics-fase3b.sql).
//
// Bewust géén 'use server': dit bestand exporteert constanten en synchrone
// helpers, en wordt gedeeld door de server actions
// (app/actions/training-evaluatie.ts), de pagina's en de pure functies in
// lib/inzichten.ts. Zelfde rol als lib/match-analysis.mjs voor speelminuten.
//
// De SQL-CHECKs zijn aan deze constanten gebonden door de structuurtest
// inzichten-metrics-fase3b-migratie.acceptance.test.ts:
//   rpe between 1 and 10            = RPE_MIN..RPE_MAX
//   oordeel in ('ja','deels','nee') = TRAINING_OORDELEN

import type { TrainingOordeel } from '@/lib/types'

export const RPE_MIN = 1
export const RPE_MAX = 10

// Waarden met een ankerlabel op de schaal (R7, Borg/Foster CR-10): 1 = zeer
// licht, 3 = gemiddeld, 5 = zwaar, 7 = zeer zwaar, 10 = maximaal. De teksten
// staan in messages/* (event.rpeAnkers); hier alleen welke waarden.
export const RPE_ANKERS = [1, 3, 5, 7, 10] as const

export const TRAINING_OORDELEN = ['ja', 'deels', 'nee'] as const satisfies readonly TrainingOordeel[]

// Geheel getal RPE_MIN..RPE_MAX. Een string ('5'), decimaal, NaN of null valt
// af: de waarde gaat ongewijzigd naar een smallint-kolom.
export function isValidRpe(waarde: unknown): waarde is number {
  return typeof waarde === 'number' && Number.isInteger(waarde) && waarde >= RPE_MIN && waarde <= RPE_MAX
}

export function isTrainingOordeel(waarde: unknown): waarde is TrainingOordeel {
  return typeof waarde === 'string' && (TRAINING_OORDELEN as readonly string[]).includes(waarde)
}

// Een niet-lege doelstelling: na trim minstens één teken. set_event_doelstelling
// maakt alleen '' null, dus '   ' kan in de database staan en telt hier als
// GEEN doelstelling. Wijkt bewust af van hasTrainingPlanDone (lib/todos.mjs),
// dat ' ' wél als plan telt (brief fase 3b, T-G/R10). Eén helper voor de
// pagina, de action en de pure functies, zodat ze nooit uiteenlopen.
export function heeftDoelstelling(tekst: unknown): boolean {
  return typeof tekst === 'string' && tekst.trim() !== ''
}
