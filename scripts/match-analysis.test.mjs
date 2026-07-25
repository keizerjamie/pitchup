// Dependency-free unit tests for the match analysis validation/derivation.
//   node --test scripts/match-analysis.test.mjs
// Imports the exact same module the server-actions run (lib/match-analysis.mjs).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampGoals,
  isValidRating,
  isValidKind,
  isValidMinute,
  goalsSum,
  analyseBestaat,
  MATCH_EVENT_KINDS,
} from '../lib/match-analysis.mjs'

test('clampGoals clamps to 0..99 integers', () => {
  assert.equal(clampGoals(0), 0)
  assert.equal(clampGoals(3), 3)
  assert.equal(clampGoals(99), 99)
  assert.equal(clampGoals(100), 99)
  assert.equal(clampGoals(-5), 0)
  assert.equal(clampGoals(2.9), 2)
  assert.equal(clampGoals('4'), 4)
})

test('clampGoals returns null for null/empty/invalid input', () => {
  assert.equal(clampGoals(null), null)
  assert.equal(clampGoals(undefined), null)
  assert.equal(clampGoals(''), null)
  assert.equal(clampGoals('abc'), null)
  assert.equal(clampGoals(NaN), null)
  assert.equal(clampGoals(Infinity), null)
})

test('isValidRating accepts integers 1..10 only', () => {
  assert.equal(isValidRating(0), false)
  assert.equal(isValidRating(1), true)
  assert.equal(isValidRating(10), true)
  assert.equal(isValidRating(11), false)
  assert.equal(isValidRating(5.5), false)
  assert.equal(isValidRating(null), false)
  assert.equal(isValidRating('5'), false)
})

test('isValidKind accepts only the four kinds', () => {
  assert.equal(isValidKind('goal'), true)
  assert.equal(isValidKind('assist'), true)
  assert.equal(isValidKind('yellow'), true)
  assert.equal(isValidKind('red'), true)
  assert.equal(isValidKind('own_goal'), false)
  assert.equal(isValidKind(''), false)
  assert.equal(isValidKind(null), false)
})

test('isValidMinute accepts null or integer 0..130', () => {
  assert.equal(isValidMinute(null), true)
  assert.equal(isValidMinute(0), true)
  assert.equal(isValidMinute(45), true)
  assert.equal(isValidMinute(130), true)
  assert.equal(isValidMinute(131), false)
  assert.equal(isValidMinute(-1), false)
  assert.equal(isValidMinute(45.5), false)
  assert.equal(isValidMinute(undefined), false)
})

test('goalsSum counts only goal-kind events', () => {
  assert.equal(goalsSum([]), 0)
  assert.equal(goalsSum(null), 0)
  assert.equal(
    goalsSum([
      { kind: 'goal' },
      { kind: 'assist' },
      { kind: 'goal' },
      { kind: 'yellow' },
    ]),
    2,
  )
})

test('analyseBestaat is true when the result is filled in (result-only)', () => {
  assert.equal(
    analyseBestaat({ goals_for: 2, goals_against: 1, ratingCount: 0, eventCount: 0 }),
    true,
  )
  assert.equal(
    analyseBestaat({ goals_for: 0, goals_against: 0, ratingCount: 0, eventCount: 0 }),
    true,
  )
})

test('analyseBestaat is true with only ratings', () => {
  assert.equal(
    analyseBestaat({ goals_for: null, goals_against: null, ratingCount: 3, eventCount: 0 }),
    true,
  )
})

test('analyseBestaat is true with only events', () => {
  assert.equal(
    analyseBestaat({ goals_for: null, goals_against: null, ratingCount: 0, eventCount: 5 }),
    true,
  )
})

test('analyseBestaat is false when everything is empty', () => {
  assert.equal(
    analyseBestaat({ goals_for: null, goals_against: null, ratingCount: 0, eventCount: 0 }),
    false,
  )
})

test('analyseBestaat needs both goals set to count as a result', () => {
  assert.equal(
    analyseBestaat({ goals_for: 2, goals_against: null, ratingCount: 0, eventCount: 0 }),
    false,
  )
})

// ── Aanvullende, per-criterium gelabelde logica-dekking ─────────────────────

test('criterium 3 (uitslag): leeg → null, wijzigen re-clampt de overschreven waarde', () => {
  // Wat saveMatchResult naar events schrijft (app/actions/match-analysis.ts:29).
  // Leeg veld wist de uitslag (null); een nieuwe waarde overschrijft en wordt geclampt.
  assert.equal(clampGoals(''), null, 'leeg = null (wist de uitslag)')
  assert.equal(clampGoals('0'), 0, 'expliciete 0 blijft 0, niet null')
  assert.equal(clampGoals('7'), 7, 'gewijzigde waarde wordt bewaard')
  assert.equal(clampGoals('250'), 99, 'onrealistisch hoog wordt geclampt')
})

test('criterium 4 (rating): grenzen 1..10, geheeltallig, anders geweigerd', () => {
  for (let r = 1; r <= 10; r++) assert.equal(isValidRating(r), true, `rating ${r} geldig`)
  assert.equal(isValidRating(0), false, '0 ligt onder de ondergrens')
  assert.equal(isValidRating(11), false, '11 ligt boven de bovengrens')
  assert.equal(isValidRating(7.5), false, 'halve rating niet toegestaan')
})

test('criterium 5 (kind): toegestane set is exact goal/assist/yellow/red', () => {
  assert.deepEqual(MATCH_EVENT_KINDS, ['goal', 'assist', 'yellow', 'red'])
  for (const k of MATCH_EVENT_KINDS) assert.equal(isValidKind(k), true, `${k} toegestaan`)
  for (const bad of ['own_goal', 'penalty', 'GOAL', ' goal', undefined, 42]) {
    assert.equal(isValidKind(bad), false, `${String(bad)} geweigerd`)
  }
})

test('criterium 5 (minuut): optioneel (null) of plausibel 0..130 geheeltallig', () => {
  assert.equal(isValidMinute(null), true, 'minuut is optioneel')
  assert.equal(isValidMinute(0), true, 'ondergrens 0')
  assert.equal(isValidMinute(130), true, 'bovengrens 130 (verlenging)')
  assert.equal(isValidMinute(131), false, 'boven 130 geweigerd')
  assert.equal(isValidMinute(-1), false, 'negatief geweigerd')
  assert.equal(isValidMinute(90.5), false, 'halve minuut geweigerd')
})

test('criterium 7 (vrij invoerbaar): som-hint is een zachte, niet-blokkerende afleiding', () => {
  // Repliceert de hint-conditie uit components/MatchAnalysisEditor.tsx:165
  //   showSumHint = gfNum !== null && goalsSum(events) !== gfNum
  const softHint = (goalsFor, events) => goalsFor !== null && goalsSum(events) !== goalsFor
  const events = [{ kind: 'goal' }, { kind: 'assist' }, { kind: 'goal' }] // 2 doelpunten

  // Som klopt niet met de uitslag → hint aan, maar dit blokkeert niets (pure afleiding).
  assert.equal(softHint(3, events), true, 'mismatch toont hint, invoer blijft toegestaan')
  // Som klopt wél → geen hint.
  assert.equal(softHint(2, events), false, 'match → geen hint')
  // Geen uitslag ingevuld → nooit een hint.
  assert.equal(softHint(null, events), false, 'zonder uitslag geen hint')
  // goalsSum telt alleen doelpunten, niet assists/kaarten → basis van de afleiding.
  assert.equal(goalsSum(events), 2)
})

test('criterium 8 (done-status): alleen goals_against gezet telt niet als uitslag', () => {
  assert.equal(
    analyseBestaat({ goals_for: null, goals_against: 1, ratingCount: 0, eventCount: 0 }),
    false,
  )
})

test('criterium 8 (done-status): ontbrekende tellers gedragen zich als 0', () => {
  assert.equal(analyseBestaat({}), false, 'volledig leeg object → geen analyse')
  assert.equal(
    analyseBestaat({ goals_for: null, goals_against: null }),
    false,
    'alleen null-uitslag zonder tellers → geen analyse',
  )
  assert.equal(
    analyseBestaat({ goals_for: null, goals_against: null, ratingCount: 1 }),
    true,
    'één rating zonder eventCount-veld → wel analyse',
  )
})
