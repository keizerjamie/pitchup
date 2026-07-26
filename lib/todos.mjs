// Pure, dependency-free validation/derivation helpers for the To-do feature.
// Kept as .mjs so the dependency-free node test (scripts/todos.test.mjs)
// imports the exact same code the server-actions (app/actions/todos.ts) and
// the page data-build run — no duplicate logic.
//
// Datums zijn overal 'YYYY-MM-DD'-strings. Voor die vorm is lexicografische
// (string) vergelijking gelijk aan chronologische vergelijking, dus we
// vergelijken bewust op string i.p.v. Date-objecten (geen tijdzone-drift).

/** De drie taaktypes die per event kunnen voorkomen. */
export const TASK_TYPES = ['lineup', 'analysis', 'training_plan']

/** Venster-constanten voor zichtbaarheid (in dagen). */
export const FORWARD = 7
export const RETENTION = 7

/**
 * True alleen als x EXACT een van de toegestane task types is.
 * Strikt: ' lineup', 'Lineup', '', null, undefined, 42, ... → false.
 */
export function isValidTaskType(x) {
  return TASK_TYPES.includes(x)
}

/**
 * Deadline voor de analyse-taak: de EERSTE trainingdatum STRIKT ná de
 * wedstrijddag (een training op dezelfde dag telt niet mee). Is er geen
 * training ná de wedstrijd, dan valt de deadline terug op de wedstrijddag zelf.
 *
 * @param {string} matchDate 'YYYY-MM-DD'
 * @param {string[]} trainingDates array van 'YYYY-MM-DD' (mag ongesorteerd zijn)
 * @returns {string} 'YYYY-MM-DD'
 */
export function analysisDeadline(matchDate, trainingDates) {
  const later = Array.isArray(trainingDates)
    ? trainingDates.filter((d) => typeof d === 'string' && d > matchDate)
    : []
  if (later.length === 0) return matchDate
  // Minimum > matchDate (lexicografisch == chronologisch voor YYYY-MM-DD).
  return later.reduce((min, d) => (d < min ? d : min))
}

/** Effectief afgerond: automatisch klaar OF handmatig afgevinkt. */
export function effectiveDone(auto, manual) {
  return auto || manual
}

/**
 * Is het trainingsplan automatisch klaar? Waar zodra er een doelstelling is
 * ingevuld OF er ten minste één oefening is. Lege string/null doelstelling
 * telt NIET.
 */
export function hasTrainingPlanDone(doelstelling, oefCount) {
  return !!doelstelling || oefCount > 0
}

/**
 * Bepaalt of een taak op de To-do-lijst zichtbaar is.
 *
 * @param {object} p
 * @param {string} p.taskType         'lineup' | 'analysis' | 'training_plan'
 * @param {boolean} p.done            effectief afgerond (auto || manual)
 * @param {number} p.daysUntilEvent   dagen tot de event-dag (0 = vandaag, <0 = verleden)
 * @param {number} p.daysUntilDeadline dagen tot de analyse-deadline (alleen relevant voor 'analysis')
 * @returns {boolean}
 */
export function isTaskVisible({ taskType, done, daysUntilEvent, daysUntilDeadline }) {
  if (done) {
    // Afgerond: kort zichtbaar rond de event-dag (retentie terug, forward vooruit).
    return daysUntilEvent >= -RETENTION && daysUntilEvent <= FORWARD
  }
  if (taskType === 'analysis') {
    // Open analyse: vanaf de wedstrijddag t/m de deadline; GEEN +7-cap op de
    // deadline (never-miss, ook als de eerstvolgende training ver weg ligt).
    return daysUntilEvent <= 0 && daysUntilDeadline >= 0
  }
  // Open lineup/training: forward-venster; vervalt na de eigen event-dag.
  return daysUntilEvent >= 0 && daysUntilEvent <= FORWARD
}

/**
 * Vergelijkt twee taken voor de sorteervolgorde.
 * Verwacht op elk taakobject:
 *   - `effective` {boolean}  effectief afgerond (open = false)
 *   - `deadline`  {string}   'YYYY-MM-DD' waarop de taak 'af' moet zijn
 * Open taken (!effective) komen vóór afgevinkte; binnen elke groep oplopend op
 * deadline (vroegste eerst).
 */
export function compareTasks(a, b) {
  if (a.effective !== b.effective) return a.effective ? 1 : -1
  if (a.deadline < b.deadline) return -1
  if (a.deadline > b.deadline) return 1
  return 0
}

/** Retourneert een nieuwe, gesorteerde array (muteert de input niet). */
export function sortTasks(tasks) {
  return [...tasks].sort(compareTasks)
}
