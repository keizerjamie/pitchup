// Acceptatietests voor de To-do-feature (vervangt "Deze week").
//   node --test scripts/todos.acceptance.test.mjs
//
// Dit bestand toetst de ACCEPTATIECRITERIA uit de goedgekeurde user story,
// niet losse units (die staan al in scripts/todos.test.mjs). Elke test bouwt
// een representatief scenario en rijgt de ECHTE beslislogica van
// lib/todos.mjs en lib/match-analysis.mjs aan elkaar via `buildTodoItems`,
// een testharnas dat regel-voor-regel dezelfde opbouw volgt als de
// productiecode in app/page.tsx (regels ±155-203): voor elk kandidaat-event
// een 'lineup'/'analysis'-taak (match) of 'training_plan'-taak (training),
// zichtbaarheid via isTaskVisible, sortering via sortTasks. `buildTodoItems`
// zelf bevat GEEN nieuwe beslislogica — elke beslissing (is de taak af? is
// hij zichtbaar? wat is de deadline? in welke volgorde?) komt uit de echte,
// geïmporteerde functies.
//
// De labels ('Wedstrijdselectie en opstelling maken', 'Wedstrijdanalyse
// invullen', 'Training maken') komen 1-op-1 uit messages/nl.ts:63-65 en
// worden in components/dashboard/TodoList.tsx door taskType geselecteerd
// (regel 50-54); die statische koppeling is met de hand geverifieerd en
// wordt hieronder per test aangehaald — dit bestand test zelf op taskType,
// omdat er geen component-testframework beschikbaar is (zie taakopdracht).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  analysisDeadline,
  effectiveDone,
  hasTrainingPlanDone,
  isTaskVisible,
  sortTasks,
} from '../lib/todos.mjs'
import { analyseBestaat } from '../lib/match-analysis.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Vaste "vandaag" zodat de tests niet van de systeemklok afhangen. Alleen
// datum-rekenkunde voor het testharnas — geen beslislogica.
const TODAY = '2026-07-26'

function daysUntilFixed(dateStr, today = TODAY) {
  const t = new Date(today + 'T00:00:00').getTime()
  const d = new Date(dateStr + 'T00:00:00').getTime()
  return Math.round((d - t) / 86_400_000)
}

function addDaysFixed(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Testharnas: bouwt de zichtbare, gesorteerde To-do-lijst op precies dezelfde
 * manier als app/page.tsx (regels ±155-203), maar met in-memory events i.p.v.
 * Supabase-rijen. Elke beslissing wordt gedelegeerd aan de echte exports.
 */
function buildTodoItems(events, { trainingDates = [], manualSet = new Set() } = {}, today = TODAY) {
  const rawTasks = []

  for (const e of events) {
    if (e.type === 'match') {
      const lineupAuto = !!e.lineupExists
      const lineupManual = manualSet.has(`${e.id}:lineup`)
      const lineupEffective = effectiveDone(lineupAuto, lineupManual)
      if (
        isTaskVisible({
          taskType: 'lineup',
          done: lineupEffective,
          daysUntilEvent: daysUntilFixed(e.date, today),
          daysUntilDeadline: 0,
        })
      ) {
        rawTasks.push({
          eventId: e.id,
          taskType: 'lineup',
          deadline: e.date,
          eventDate: e.date,
          auto: lineupAuto,
          manual: lineupManual,
          effective: lineupEffective,
        })
      }

      const analysisAuto = analyseBestaat({
        goals_for: e.goals_for ?? null,
        goals_against: e.goals_against ?? null,
        ratingCount: e.ratingCount ?? 0,
        eventCount: e.eventCount ?? 0,
      })
      const analysisManual = manualSet.has(`${e.id}:analysis`)
      const analysisEffective = effectiveDone(analysisAuto, analysisManual)
      const deadline = analysisDeadline(e.date, trainingDates)
      if (
        isTaskVisible({
          taskType: 'analysis',
          done: analysisEffective,
          daysUntilEvent: daysUntilFixed(e.date, today),
          daysUntilDeadline: daysUntilFixed(deadline, today),
        })
      ) {
        rawTasks.push({
          eventId: e.id,
          taskType: 'analysis',
          deadline,
          eventDate: e.date,
          auto: analysisAuto,
          manual: analysisManual,
          effective: analysisEffective,
        })
      }
    } else if (e.type === 'training') {
      const auto = hasTrainingPlanDone(e.doelstelling ?? null, e.oefCount ?? 0)
      const manual = manualSet.has(`${e.id}:training_plan`)
      const effective = effectiveDone(auto, manual)
      if (
        isTaskVisible({
          taskType: 'training_plan',
          done: effective,
          daysUntilEvent: daysUntilFixed(e.date, today),
          daysUntilDeadline: 0,
        })
      ) {
        rawTasks.push({
          eventId: e.id,
          taskType: 'training_plan',
          deadline: e.date,
          eventDate: e.date,
          auto,
          manual,
          effective,
        })
      }
    }
  }

  return sortTasks(rawTasks)
}

function findTask(items, eventId, taskType) {
  return items.find((i) => i.eventId === eventId && i.taskType === taskType)
}

// ═══════════════════════════════════════════════════════════════════════════
// Taken & deadlines
// ═══════════════════════════════════════════════════════════════════════════

// AC1: Wedstrijd in venster → taak "Wedstrijdselectie en opstelling maken"
// (taskType 'lineup', label messages/nl.ts:63), deadline = wedstrijddag.
test('AC1: wedstrijd deze week → open lineup-taak met deadline = wedstrijddag', () => {
  const matchDate = addDaysFixed(TODAY, 3)
  const items = buildTodoItems([
    { id: 'm1', type: 'match', date: matchDate, lineupExists: false },
  ])
  const task = findTask(items, 'm1', 'lineup')
  assert.ok(task, 'lineup-taak moet bestaan')
  assert.equal(task.deadline, matchDate)
  assert.equal(task.effective, false)
})

// AC2: Wedstrijd in venster → taak "Wedstrijdanalyse invullen" (taskType
// 'analysis'), deadline = eerstvolgende training NA de wedstrijd.
test('AC2: analyse-taak krijgt als deadline de eerstvolgende training ná de wedstrijd', () => {
  const matchDate = addDaysFixed(TODAY, -2)
  const trainingAfter = addDaysFixed(TODAY, 5)
  const items = buildTodoItems(
    [{ id: 'm2', type: 'match', date: matchDate }],
    { trainingDates: [addDaysFixed(TODAY, -10), trainingAfter, addDaysFixed(TODAY, 12)] },
  )
  const task = findTask(items, 'm2', 'analysis')
  assert.ok(task, 'analyse-taak moet bestaan')
  assert.equal(task.deadline, trainingAfter)
})

// AC3: Wedstrijd zonder volgende training → analyse-taak bestaat toch,
// deadline = wedstrijddag (fallback).
test('AC3: geen training ná de wedstrijd → analyse-deadline valt terug op wedstrijddag', () => {
  // Wedstrijd vandaag: fallback-deadline (= wedstrijddag zelf) ligt dan nog
  // niet in het verleden, dus de open taak is nog zichtbaar (AC15 dekt de
  // grens waarop hij verdwijnt).
  const matchDate = TODAY
  const items = buildTodoItems(
    [{ id: 'm3', type: 'match', date: matchDate }],
    { trainingDates: [] },
  )
  const task = findTask(items, 'm3', 'analysis')
  assert.ok(task, 'analyse-taak moet bestaan ondanks ontbreken van een volgende training')
  assert.equal(task.deadline, matchDate)
})

// AC4: Training in venster → taak "Training maken" (taskType 'training_plan',
// label messages/nl.ts:65), deadline = trainingsdag.
test('AC4: training deze week → open training_plan-taak met deadline = trainingsdag', () => {
  const trainingDate = addDaysFixed(TODAY, 2)
  const items = buildTodoItems([
    { id: 't1', type: 'training', date: trainingDate, doelstelling: null, oefCount: 0 },
  ])
  const task = findTask(items, 't1', 'training_plan')
  assert.ok(task, 'training_plan-taak moet bestaan')
  assert.equal(task.deadline, trainingDate)
  assert.equal(task.effective, false)
})

// ═══════════════════════════════════════════════════════════════════════════
// Auto-done
// ═══════════════════════════════════════════════════════════════════════════

// AC5: Er bestaat een lineups-rij → lineup-taak automatisch afgerond.
test('AC5: lineup-rij aanwezig → lineup-taak automatisch afgerond', () => {
  const matchDate = addDaysFixed(TODAY, 2)
  const items = buildTodoItems([
    { id: 'm5', type: 'match', date: matchDate, lineupExists: true },
  ])
  const task = findTask(items, 'm5', 'lineup')
  assert.ok(task, 'taak blijft zichtbaar (kort na aanmaak, binnen forward-venster)')
  assert.equal(task.auto, true)
  assert.equal(task.effective, true)
})

// AC6: analyseBestaat() true (uitslag ingevuld ÓF ≥1 rating ÓF ≥1
// match_event) → analyse-taak automatisch afgerond. Drie varianten.
test('AC6: analyse automatisch af bij uitslag, bij rating, of bij match-event (elk afzonderlijk)', () => {
  // Wedstrijd vandaag, geen trainingDates: fallback-deadline = wedstrijddag
  // zelf, dus ook de niet-automatische variant blijft (nét) zichtbaar.
  const matchDate = TODAY

  const byScore = buildTodoItems([
    { id: 'ms', type: 'match', date: matchDate, goals_for: 2, goals_against: 1 },
  ])
  assert.equal(findTask(byScore, 'ms', 'analysis').auto, true, 'uitslag ingevuld → auto')

  const byRating = buildTodoItems([
    { id: 'mr', type: 'match', date: matchDate, ratingCount: 1 },
  ])
  assert.equal(findTask(byRating, 'mr', 'analysis').auto, true, '≥1 rating → auto')

  const byEvent = buildTodoItems([
    { id: 'me', type: 'match', date: matchDate, eventCount: 1 },
  ])
  assert.equal(findTask(byEvent, 'me', 'analysis').auto, true, '≥1 match_event → auto')

  const none = buildTodoItems([
    { id: 'mn', type: 'match', date: matchDate },
  ])
  assert.equal(findTask(none, 'mn', 'analysis').auto, false, 'niets ingevuld → niet auto')
})

// AC7: doelstelling ingevuld ÓF ≥1 oefening → training_plan-taak
// automatisch afgerond.
test('AC7: trainingsplan automatisch af bij doelstelling of bij oefeningen (elk afzonderlijk)', () => {
  const trainingDate = addDaysFixed(TODAY, 1)

  const byGoal = buildTodoItems([
    { id: 'tg', type: 'training', date: trainingDate, doelstelling: 'Positiespel', oefCount: 0 },
  ])
  assert.equal(findTask(byGoal, 'tg', 'training_plan').auto, true, 'doelstelling ingevuld → auto')

  const byOef = buildTodoItems([
    { id: 'to', type: 'training', date: trainingDate, doelstelling: null, oefCount: 2 },
  ])
  assert.equal(findTask(byOef, 'to', 'training_plan').auto, true, '≥1 oefening → auto')

  const neither = buildTodoItems([
    { id: 'tn', type: 'training', date: trainingDate, doelstelling: '', oefCount: 0 },
  ])
  assert.equal(findTask(neither, 'tn', 'training_plan').auto, false, 'niets ingevuld → niet auto')
})

// ═══════════════════════════════════════════════════════════════════════════
// Effectieve status & handmatig
// ═══════════════════════════════════════════════════════════════════════════

// AC8: Effectieve status = auto OF handmatig-afgevinkt (vier combinaties).
test('AC8: effectieve done-status is auto OF handmatig, in alle vier combinaties', () => {
  const matchDate = addDaysFixed(TODAY, 1)

  const neither = buildTodoItems([{ id: 'e1', type: 'match', date: matchDate, lineupExists: false }])
  assert.equal(findTask(neither, 'e1', 'lineup').effective, false)

  const autoOnly = buildTodoItems([{ id: 'e2', type: 'match', date: matchDate, lineupExists: true }])
  assert.equal(findTask(autoOnly, 'e2', 'lineup').effective, true)

  const manualOnly = buildTodoItems(
    [{ id: 'e3', type: 'match', date: matchDate, lineupExists: false }],
    { manualSet: new Set(['e3:lineup']) },
  )
  assert.equal(findTask(manualOnly, 'e3', 'lineup').effective, true)

  const both = buildTodoItems(
    [{ id: 'e4', type: 'match', date: matchDate, lineupExists: true }],
    { manualSet: new Set(['e4:lineup']) },
  )
  assert.equal(findTask(both, 'e4', 'lineup').effective, true)
})

// AC9: Handmatig afvinken van een NIET-auto-gedane taak → taak toont
// afgerond.
test('AC9: handmatig afvinken van een niet-automatisch-gedane taak toont de taak als afgerond', () => {
  const trainingDate = addDaysFixed(TODAY, 1)
  const withoutManual = buildTodoItems([
    { id: 't9', type: 'training', date: trainingDate, doelstelling: null, oefCount: 0 },
  ])
  assert.equal(findTask(withoutManual, 't9', 'training_plan').effective, false)

  const withManual = buildTodoItems(
    [{ id: 't9', type: 'training', date: trainingDate, doelstelling: null, oefCount: 0 }],
    { manualSet: new Set(['t9:training_plan']) },
  )
  const task = findTask(withManual, 't9', 'training_plan')
  assert.equal(task.auto, false)
  assert.equal(task.manual, true)
  assert.equal(task.effective, true)
})

// AC10: Heropenen verwijdert alleen de handmatige vlag. Bij een puur
// auto-gedane taak heeft dat geen zichtbaar effect (stille no-op): de taak
// gebruikt effectiveDone(auto, manual) en blijft dus afgerond zodra manual
// weer false wordt, zolang auto true blijft. Ter contrast: bij een puur
// handmatig-gedane taak verandert de status wél zodra de vlag verdwijnt.
// De DB-mutatie zelf (task_overrides-rij verwijderen, andere brontabellen
// blijven onaangeroerd) is niet zonder Supabase te draaien; zie rapport voor
// de code-niveau-verificatie van app/actions/todos.ts.
test('AC10: manual-vlag weghalen bij een auto-gedane taak heeft geen zichtbaar effect', () => {
  const matchDate = addDaysFixed(TODAY, 1)
  const beforeReopen = buildTodoItems(
    [{ id: 'r1', type: 'match', date: matchDate, lineupExists: true }],
    { manualSet: new Set(['r1:lineup']) }, // auto=true én manual=true
  )
  assert.equal(findTask(beforeReopen, 'r1', 'lineup').effective, true)

  // "Heropenen" simuleren: alleen de manual-vlag verdwijnt, de auto-bron
  // (lineups-rij) blijft ongewijzigd.
  const afterReopen = buildTodoItems(
    [{ id: 'r1', type: 'match', date: matchDate, lineupExists: true }],
    { manualSet: new Set() },
  )
  assert.equal(findTask(afterReopen, 'r1', 'lineup').effective, true, 'stille no-op: nog steeds afgerond via auto')
})

test('AC10 (contrast): manual-vlag weghalen bij een puur handmatig-gedane taak heft de status wél op', () => {
  const trainingDate = addDaysFixed(TODAY, 1)
  const withManual = buildTodoItems(
    [{ id: 'r2', type: 'training', date: trainingDate, doelstelling: null, oefCount: 0 }],
    { manualSet: new Set(['r2:training_plan']) },
  )
  assert.equal(findTask(withManual, 'r2', 'training_plan').effective, true)

  const afterReopen = buildTodoItems(
    [{ id: 'r2', type: 'training', date: trainingDate, doelstelling: null, oefCount: 0 }],
    { manualSet: new Set() },
  )
  assert.equal(findTask(afterReopen, 'r2', 'training_plan').effective, false)
})

// ═══════════════════════════════════════════════════════════════════════════
// Weergave
// ═══════════════════════════════════════════════════════════════════════════

// AC11: Open taken bovenaan, afgevinkte onderaan; binnen groep oplopend op
// deadline.
test('AC11: open taken eerst (oplopend op deadline), daarna afgevinkte taken (oplopend op deadline)', () => {
  const items = buildTodoItems([
    { id: 'o1', type: 'training', date: addDaysFixed(TODAY, 5), doelstelling: null, oefCount: 0 }, // open, laat
    { id: 'o2', type: 'training', date: addDaysFixed(TODAY, 1), doelstelling: null, oefCount: 0 }, // open, vroeg
    { id: 'd1', type: 'match', date: addDaysFixed(TODAY, -3), lineupExists: true }, // done, vroege deadline
    { id: 'd2', type: 'match', date: addDaysFixed(TODAY, 2), lineupExists: true }, // done, latere deadline
  ])
  const lineupsAndTrainings = items.filter((i) => i.taskType !== 'analysis')
  const order = lineupsAndTrainings.map((i) => i.eventId)
  assert.deepEqual(order, ['o2', 'o1', 'd1', 'd2'])
})

// AC12: Geen limiet op aantal taken; meerdere events → volledige set taken
// per event (match → 2 taken, training → 1 taak).
test('AC12: geen limiet — meerdere events leveren hun volledige takenset op', () => {
  const events = []
  // 6 wedstrijden, elk al gespeeld (binnen de retentie) én auto-afgerond op
  // beide taken, zodat lineup + analysis allebei betrouwbaar zichtbaar zijn
  // (de timing-grenzen van open taken worden al door AC14-AC16 gedekt; AC12
  // gaat specifiek over "geen limiet + volledige set per event").
  for (let i = 0; i < 6; i++) {
    events.push({
      id: `match-${i}`,
      type: 'match',
      date: addDaysFixed(TODAY, -i),
      lineupExists: true,
      goals_for: 1,
      goals_against: 0,
    })
  }
  for (let i = 0; i < 6; i++) {
    events.push({ id: `training-${i}`, type: 'training', date: addDaysFixed(TODAY, i), doelstelling: null, oefCount: 0 })
  }
  const items = buildTodoItems(events)
  // 6 wedstrijden × 2 taken (lineup + analysis) + 6 trainingen × 1 taak = 18
  assert.equal(items.length, 18)
  for (let i = 0; i < 6; i++) {
    assert.ok(findTask(items, `match-${i}`, 'lineup'), `lineup voor match-${i} ontbreekt`)
    assert.ok(findTask(items, `match-${i}`, 'analysis'), `analysis voor match-${i} ontbreekt`)
    assert.ok(findTask(items, `training-${i}`, 'training_plan'), `training_plan voor training-${i} ontbreekt`)
  }
})

// AC13: Geen taken → lege staat. De lege-staattekst zelf
// (components/dashboard/TodoList.tsx:60-61, t.todo.empty) wordt getoond
// zodra items.length === 0 — hier toetsen we dat de beslislogica voor een
// leeg event-kandidatenveld ook daadwerkelijk een lege array oplevert.
test('AC13: geen kandidaat-events → lege takenlijst', () => {
  const items = buildTodoItems([])
  assert.deepEqual(items, [])
})

// ═══════════════════════════════════════════════════════════════════════════
// Zichtbaarheid
// ═══════════════════════════════════════════════════════════════════════════

// AC14: Afgeronde taak (auto én handmatig) zichtbaar t/m 7 dagen ná de
// event-datum, daarna weg.
test('AC14: afgeronde taak blijft t/m +7 dagen ná de event-datum zichtbaar, dag 8 verdwijnt hij', () => {
  const withinAuto = buildTodoItems([
    { id: 'v1', type: 'match', date: addDaysFixed(TODAY, -7), lineupExists: true },
  ])
  assert.ok(findTask(withinAuto, 'v1', 'lineup'), 'dag -7 (auto-done) nog zichtbaar')

  const beyondAuto = buildTodoItems([
    { id: 'v2', type: 'match', date: addDaysFixed(TODAY, -8), lineupExists: true },
  ])
  assert.equal(findTask(beyondAuto, 'v2', 'lineup'), undefined, 'dag -8 (auto-done) niet meer zichtbaar')

  const withinManual = buildTodoItems(
    [{ id: 'v3', type: 'training', date: addDaysFixed(TODAY, -7), doelstelling: null, oefCount: 0 }],
    { manualSet: new Set(['v3:training_plan']) },
  )
  assert.ok(findTask(withinManual, 'v3', 'training_plan'), 'dag -7 (handmatig afgevinkt) nog zichtbaar')

  const beyondManual = buildTodoItems(
    [{ id: 'v4', type: 'training', date: addDaysFixed(TODAY, -8), doelstelling: null, oefCount: 0 }],
    { manualSet: new Set(['v4:training_plan']) },
  )
  assert.equal(findTask(beyondManual, 'v4', 'training_plan'), undefined, 'dag -8 (handmatig afgevinkt) niet meer zichtbaar')
})

// AC15: Open analyse-taak zichtbaar vanaf wedstrijddag t/m deadline, GEEN
// +7-cap op de deadline; vóór de wedstrijd niet zichtbaar.
test('AC15: open analyse-taak alleen zichtbaar vanaf wedstrijddag, zonder +7-cap op de deadline', () => {
  // Wedstrijd nog in de toekomst → analyse-taak nog niet zichtbaar.
  const beforeMatch = buildTodoItems([
    { id: 'a1', type: 'match', date: addDaysFixed(TODAY, 1) },
  ])
  assert.equal(findTask(beforeMatch, 'a1', 'analysis'), undefined, 'vóór de wedstrijd niet zichtbaar')

  // Wedstrijd vandaag → analyse-taak wordt vanaf vandaag zichtbaar.
  const onMatchDay = buildTodoItems([
    { id: 'a2', type: 'match', date: TODAY },
  ])
  assert.ok(findTask(onMatchDay, 'a2', 'analysis'), 'op de wedstrijddag zelf al zichtbaar')

  // Deadline (eerstvolgende training) ligt ver > 7 dagen weg — toch zichtbaar
  // (never-miss, geen +7-cap op de deadline).
  const farDeadline = addDaysFixed(TODAY, 20)
  const noCap = buildTodoItems(
    [{ id: 'a3', type: 'match', date: addDaysFixed(TODAY, -5) }],
    { trainingDates: [farDeadline] },
  )
  const task = findTask(noCap, 'a3', 'analysis')
  assert.ok(task, 'deadline > 7 dagen weg is toch zichtbaar')
  assert.equal(task.deadline, farDeadline)

  // Deadline verstreken → niet meer zichtbaar.
  const expired = buildTodoItems(
    [{ id: 'a4', type: 'match', date: addDaysFixed(TODAY, -10) }],
    { trainingDates: [addDaysFixed(TODAY, -3)] },
  )
  assert.equal(findTask(expired, 'a4', 'analysis'), undefined, 'ná de deadline niet meer zichtbaar')
})

// AC16: Open opstelling/training zichtbaar in [vandaag, +7]; na de eigen
// event-dag vervalt de open taak.
test('AC16: open lineup/training-taak zichtbaar in [vandaag, +7], vervalt na de eigen event-dag', () => {
  const withinWindow = buildTodoItems([
    { id: 'w1', type: 'match', date: addDaysFixed(TODAY, 7), lineupExists: false },
  ])
  assert.ok(findTask(withinWindow, 'w1', 'lineup'), '+7 dagen nog net zichtbaar')

  const beyondWindow = buildTodoItems([
    { id: 'w2', type: 'match', date: addDaysFixed(TODAY, 8), lineupExists: false },
  ])
  assert.equal(findTask(beyondWindow, 'w2', 'lineup'), undefined, '+8 dagen buiten het venster')

  const pastEventOpen = buildTodoItems([
    { id: 'w3', type: 'match', date: addDaysFixed(TODAY, -1), lineupExists: false },
  ])
  assert.equal(findTask(pastEventOpen, 'w3', 'lineup'), undefined, 'open taak vervalt zodra de event-dag voorbij is')

  const pastEventOpenTraining = buildTodoItems([
    { id: 'w4', type: 'training', date: addDaysFixed(TODAY, -1), doelstelling: null, oefCount: 0 },
  ])
  assert.equal(findTask(pastEventOpenTraining, 'w4', 'training_plan'), undefined, 'idem voor training_plan')
})

// ═══════════════════════════════════════════════════════════════════════════
// Isolatie/robuustheid — codeniveau (niet zonder draaiende Supabase-DB
// runtime-testbaar; zie taakopdracht). Deze checks lezen de daadwerkelijke
// productiebestanden en falen als de scoping/guard-patronen verdwijnen.
// ═══════════════════════════════════════════════════════════════════════════

// AC17: Tenant-isolatie — elke query in de To-do data-opbouw is geschermd op
// team_id = user.id.
test('AC17 (codeniveau): elke Supabase-query voor de To-do-opbouw is geschermd met .eq(\'team_id\', user.id)', () => {
  const pageSrc = readFileSync(path.join(ROOT, 'app/page.tsx'), 'utf8')
  const relevantTables = ['events', 'lineups', 'match_ratings', 'match_events', 'oefeningen', 'task_overrides']
  for (const table of relevantTables) {
    const re = new RegExp(`from\\('${table}'\\)[^;]*?\\.eq\\('team_id',\\s*user\\.id\\)`, 's')
    assert.ok(re.test(pageSrc), `query op '${table}' moet .eq('team_id', user.id) bevatten`)
  }
})

// AC18: Afvink-actie op andermans/onbestaand event → geweigerd via
// assertOwnEvent, geen ruwe DB-details naar de client.
test('AC18 (codeniveau): markTaskDone/reopenTask roepen assertOwnEvent aan vóórdat er geschreven wordt', () => {
  const actionsSrc = readFileSync(path.join(ROOT, 'app/actions/todos.ts'), 'utf8')
  assert.ok(actionsSrc.includes("import { assertOwnEvent } from '@/lib/authz'"), 'assertOwnEvent moet geïmporteerd zijn')

  const markMatch = actionsSrc.match(/export async function markTaskDone[\s\S]*?^}/m)
  assert.ok(markMatch, 'markTaskDone niet gevonden')
  const markBody = markMatch[0]
  assert.ok(/await assertOwnEvent\(supabase, eventId, user\.id\)/.test(markBody), 'markTaskDone moet assertOwnEvent aanroepen')
  assert.ok(markBody.indexOf('assertOwnEvent') < markBody.indexOf(".from('task_overrides')"), 'assertOwnEvent moet vóór de schrijfactie komen')

  const reopenMatch = actionsSrc.match(/export async function reopenTask[\s\S]*?^}/m)
  assert.ok(reopenMatch, 'reopenTask niet gevonden')
  const reopenBody = reopenMatch[0]
  assert.ok(/await assertOwnEvent\(supabase, eventId, user\.id\)/.test(reopenBody), 'reopenTask moet assertOwnEvent aanroepen')
  assert.ok(reopenBody.indexOf('assertOwnEvent') < reopenBody.indexOf(".from('task_overrides')"), 'assertOwnEvent moet vóór de schrijfactie komen')

  const authzSrc = readFileSync(path.join(ROOT, 'lib/authz.ts'), 'utf8')
  assert.ok(
    /export async function assertOwnEvent[\s\S]*?\.eq\('id', eventId\)\.eq\('team_id', teamId\)[\s\S]*?if \(!data\) throw new Error\('Event niet gevonden'\)/.test(authzSrc),
    'assertOwnEvent moet op id+team_id filteren en een generieke fout gooien (geen ruwe DB-details)',
  )
})
