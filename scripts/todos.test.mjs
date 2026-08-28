// Dependency-free unit tests for the To-do validation/derivation logic.
//   node --test scripts/todos.test.mjs
// Imports the exact same module the server-actions run (lib/todos.mjs).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TASK_TYPES,
  FORWARD,
  RETENTION,
  isValidTaskType,
  analysisDeadline,
  effectiveDone,
  hasTrainingPlanDone,
  isTaskVisible,
  compareTasks,
  sortTasks,
} from '../lib/todos.mjs'

// ── constanten ──────────────────────────────────────────────────────────────

test('TASK_TYPES is exact squad/lineup/analysis/training_plan', () => {
  assert.deepEqual(TASK_TYPES, ['squad', 'lineup', 'analysis', 'training_plan'])
  assert.equal(FORWARD, 7)
  assert.equal(RETENTION, 7)
})

// ── isValidTaskType ─────────────────────────────────────────────────────────

test('isValidTaskType accepteert exact de vier types', () => {
  assert.equal(isValidTaskType('squad'), true)
  assert.equal(isValidTaskType('lineup'), true)
  assert.equal(isValidTaskType('analysis'), true)
  assert.equal(isValidTaskType('training_plan'), true)
})

test('isValidTaskType weigert alles wat niet exact matcht', () => {
  for (const bad of ['lineup ', ' lineup', 'Lineup', 'LINEUP', 'squad ', 'Squad', 'match_squad', '', null, undefined, 42, 'training']) {
    assert.equal(isValidTaskType(bad), false, `${String(bad)} geweigerd`)
  }
})

// ── analysisDeadline ────────────────────────────────────────────────────────

test('analysisDeadline: eerste training STRIKT ná de wedstrijd', () => {
  assert.equal(
    analysisDeadline('2026-07-26', ['2026-07-28', '2026-07-30']),
    '2026-07-28',
  )
})

test('analysisDeadline: ongesorteerde input → minimum ná de wedstrijd', () => {
  assert.equal(
    analysisDeadline('2026-07-26', ['2026-08-05', '2026-07-29', '2026-07-27']),
    '2026-07-27',
  )
})

test('analysisDeadline: training op dezelfde dag telt NIET', () => {
  assert.equal(
    analysisDeadline('2026-07-26', ['2026-07-26', '2026-07-31']),
    '2026-07-31',
  )
})

test('analysisDeadline: geen training ná wedstrijd → fallback wedstrijddag', () => {
  assert.equal(analysisDeadline('2026-07-26', ['2026-07-20', '2026-07-26']), '2026-07-26')
  assert.equal(analysisDeadline('2026-07-26', []), '2026-07-26')
  assert.equal(analysisDeadline('2026-07-26', null), '2026-07-26')
})

// ── effectiveDone ───────────────────────────────────────────────────────────

test('effectiveDone: auto OF manueel → true', () => {
  assert.equal(effectiveDone(true, false), true)
  assert.equal(effectiveDone(false, true), true)
  assert.equal(effectiveDone(true, true), true)
})

test('effectiveDone: geen van beide → false', () => {
  assert.equal(effectiveDone(false, false), false)
})

// ── hasTrainingPlanDone ─────────────────────────────────────────────────────

test('hasTrainingPlanDone: doelstelling gevuld of oefeningen aanwezig → true', () => {
  assert.equal(hasTrainingPlanDone('Positiespel', 0), true)
  assert.equal(hasTrainingPlanDone('', 1), true)
  assert.equal(hasTrainingPlanDone(null, 3), true)
})

test('hasTrainingPlanDone: lege doelstelling en geen oefeningen → false', () => {
  assert.equal(hasTrainingPlanDone('', 0), false)
  assert.equal(hasTrainingPlanDone(null, 0), false)
})

// ── isTaskVisible: open analyse ─────────────────────────────────────────────

test('isTaskVisible: open analyse wedstrijd vandaag → zichtbaar', () => {
  assert.equal(
    isTaskVisible({ taskType: 'analysis', done: false, daysUntilEvent: 0, daysUntilDeadline: 2 }),
    true,
  )
})

test('isTaskVisible: open analyse wedstrijd 3 dagen geleden → zichtbaar', () => {
  assert.equal(
    isTaskVisible({ taskType: 'analysis', done: false, daysUntilEvent: -3, daysUntilDeadline: 2 }),
    true,
  )
})

test('isTaskVisible: open analyse toekomstige wedstrijd (+2) → NIET zichtbaar', () => {
  assert.equal(
    isTaskVisible({ taskType: 'analysis', done: false, daysUntilEvent: 2, daysUntilDeadline: 5 }),
    false,
  )
})

test('isTaskVisible: open analyse deadline verstreken → NIET zichtbaar', () => {
  assert.equal(
    isTaskVisible({ taskType: 'analysis', done: false, daysUntilEvent: -3, daysUntilDeadline: -1 }),
    false,
  )
})

test('isTaskVisible: open analyse fallback-deadline op de dag zelf', () => {
  // daysUntilEvent == daysUntilDeadline == 0 (geen training ná wedstrijd)
  assert.equal(
    isTaskVisible({ taskType: 'analysis', done: false, daysUntilEvent: 0, daysUntilDeadline: 0 }),
    true,
  )
  // een dag later verstreken
  assert.equal(
    isTaskVisible({ taskType: 'analysis', done: false, daysUntilEvent: -1, daysUntilDeadline: -1 }),
    false,
  )
})

test('isTaskVisible: open analyse deadline verder dan +7 → toch zichtbaar (never-miss)', () => {
  assert.equal(
    isTaskVisible({ taskType: 'analysis', done: false, daysUntilEvent: -2, daysUntilDeadline: 10 }),
    true,
  )
})

// ── isTaskVisible: open squad/lineup/training ───────────────────────────────

test('isTaskVisible: squad volgt hetzelfde forward-venster als lineup', () => {
  assert.equal(
    isTaskVisible({ taskType: 'squad', done: false, daysUntilEvent: 3, daysUntilDeadline: 0 }),
    true,
  )
  assert.equal(
    isTaskVisible({ taskType: 'squad', done: false, daysUntilEvent: -1, daysUntilDeadline: 0 }),
    false,
  )
  assert.equal(
    isTaskVisible({ taskType: 'squad', done: false, daysUntilEvent: 8, daysUntilDeadline: 0 }),
    false,
  )
})

test('isTaskVisible: open opstelling over 3 dagen → zichtbaar', () => {
  assert.equal(
    isTaskVisible({ taskType: 'lineup', done: false, daysUntilEvent: 3, daysUntilDeadline: 0 }),
    true,
  )
})

test('isTaskVisible: open opstelling/training na de event-dag (-1) → NIET zichtbaar', () => {
  assert.equal(
    isTaskVisible({ taskType: 'lineup', done: false, daysUntilEvent: -1, daysUntilDeadline: 0 }),
    false,
  )
  assert.equal(
    isTaskVisible({ taskType: 'training_plan', done: false, daysUntilEvent: -1, daysUntilDeadline: 0 }),
    false,
  )
})

test('isTaskVisible: open lineup/training buiten forward-venster (+8) → NIET zichtbaar', () => {
  assert.equal(
    isTaskVisible({ taskType: 'lineup', done: false, daysUntilEvent: 8, daysUntilDeadline: 0 }),
    false,
  )
})

// ── isTaskVisible: afgerond ─────────────────────────────────────────────────

test('isTaskVisible: afgerond binnen retentie/forward-venster → zichtbaar', () => {
  assert.equal(
    isTaskVisible({ taskType: 'analysis', done: true, daysUntilEvent: -7, daysUntilDeadline: 0 }),
    true,
  )
  assert.equal(
    isTaskVisible({ taskType: 'lineup', done: true, daysUntilEvent: 0, daysUntilDeadline: 0 }),
    true,
  )
  assert.equal(
    isTaskVisible({ taskType: 'lineup', done: true, daysUntilEvent: 7, daysUntilDeadline: 0 }),
    true,
  )
})

test('isTaskVisible: afgerond buiten venster (-8) → NIET zichtbaar', () => {
  assert.equal(
    isTaskVisible({ taskType: 'analysis', done: true, daysUntilEvent: -8, daysUntilDeadline: 0 }),
    false,
  )
})

// ── compareTasks / sortTasks ────────────────────────────────────────────────

test('compareTasks: open vóór afgevinkt', () => {
  const open = { effective: false, deadline: '2026-08-01' }
  const done = { effective: true, deadline: '2026-07-01' }
  assert.ok(compareTasks(open, done) < 0)
  assert.ok(compareTasks(done, open) > 0)
})

test('compareTasks: binnen groep oplopend op deadline (vroegste eerst)', () => {
  const vroeg = { effective: false, deadline: '2026-07-27' }
  const laat = { effective: false, deadline: '2026-07-30' }
  assert.ok(compareTasks(vroeg, laat) < 0)
  assert.ok(compareTasks(laat, vroeg) > 0)
  assert.equal(compareTasks(vroeg, { effective: false, deadline: '2026-07-27' }), 0)
})

test('compareTasks: open met latere deadline staat bóven afgevinkt met vroegere deadline', () => {
  const openLaat = { effective: false, deadline: '2026-12-31' }
  const doneVroeg = { effective: true, deadline: '2026-01-01' }
  assert.ok(compareTasks(openLaat, doneVroeg) < 0)
})

test('sortTasks: open (op deadline) eerst, daarna afgevinkt (op deadline)', () => {
  const tasks = [
    { id: 'a', effective: true, deadline: '2026-07-05' },
    { id: 'b', effective: false, deadline: '2026-07-30' },
    { id: 'c', effective: false, deadline: '2026-07-27' },
    { id: 'd', effective: true, deadline: '2026-07-02' },
  ]
  const sorted = sortTasks(tasks)
  assert.deepEqual(sorted.map((t) => t.id), ['c', 'b', 'd', 'a'])
  // input niet gemuteerd
  assert.equal(tasks[0].id, 'a')
})
