// Pure, dependency-free validation/derivation helpers for match analysis.
// Kept as .mjs so the dependency-free node test
// (scripts/match-analysis.test.mjs) imports the exact same code the
// server-actions (app/actions/match-analysis.ts) run — no duplicate logic.

/** Valid match event kinds. */
export const MATCH_EVENT_KINDS = ['goal', 'assist', 'yellow', 'red']

/**
 * Clamp a goal count to an integer 0..99, or null.
 * null/empty/invalid input → null.
 */
export function clampGoals(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const i = Math.trunc(n)
  if (i < 0) return 0
  if (i > 99) return 99
  return i
}

/** True if v is an integer rating 1..10. */
export function isValidRating(v) {
  return Number.isInteger(v) && v >= 1 && v <= 10
}

/** True if v is one of the allowed match event kinds. */
export function isValidKind(v) {
  return MATCH_EVENT_KINDS.includes(v)
}

/** True if v is null or an integer minute 0..130. */
export function isValidMinute(v) {
  if (v === null) return true
  return Number.isInteger(v) && v >= 0 && v <= 130
}

/** Number of goal-kind events in the given list. */
export function goalsSum(matchEvents) {
  if (!Array.isArray(matchEvents)) return 0
  return matchEvents.filter((e) => e && e.kind === 'goal').length
}

/**
 * Does a match analysis exist? True when the result is filled in, or there is
 * at least one rating, or at least one event.
 */
export function analyseBestaat({ goals_for, goals_against, ratingCount, eventCount }) {
  const uitslagIngevuld = goals_for !== null && goals_for !== undefined && goals_against !== null && goals_against !== undefined
  return uitslagIngevuld || (ratingCount ?? 0) > 0 || (eventCount ?? 0) > 0
}

/**
 * Uitkomst van één wedstrijd vanuit het eigen team gezien.
 * Ontbreekt één van beide doelpuntvelden, dan is er geen uitslag ('unknown') —
 * zelfde "beide velden nodig"-regel als analyseBestaat hierboven.
 * @returns {'win'|'draw'|'loss'|'unknown'}
 */
export function matchResult({ goals_for, goals_against } = {}) {
  if (goals_for === null || goals_for === undefined) return 'unknown'
  if (goals_against === null || goals_against === undefined) return 'unknown'
  if (goals_for > goals_against) return 'win'
  if (goals_for < goals_against) return 'loss'
  return 'draw'
}
