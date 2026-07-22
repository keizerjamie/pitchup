// Dependency-free unit tests for the calendar date logic.
//   node --test scripts/calendar.test.mjs
// Imports the exact same module the UI runs (lib/calendar.mjs).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monthMatrix, sameMonth, toDateStr } from '../lib/calendar.mjs'

const dayOf = (str) => new Date(str + 'T00:00:00').getDay() // 0=Sun..6=Sat

test('every week has exactly 7 days', () => {
  for (const week of monthMatrix(2026, 7)) assert.equal(week.length, 7)
})

test('days are consecutive across the whole grid', () => {
  const flat = monthMatrix(2026, 7).flat()
  for (let i = 1; i < flat.length; i++) {
    const gap = (new Date(flat[i] + 'T00:00:00') - new Date(flat[i - 1] + 'T00:00:00')) / 86_400_000
    assert.equal(gap, 1, `${flat[i - 1]} → ${flat[i]} not consecutive`)
  }
})

test('grid starts on Monday and ends on Sunday', () => {
  const flat = monthMatrix(2026, 7).flat()
  assert.equal(dayOf(flat[0]), 1, 'first cell is Monday')
  assert.equal(dayOf(flat.at(-1)), 0, 'last cell is Sunday')
})

test('grid contains every day of the target month', () => {
  const flat = new Set(monthMatrix(2026, 2).flat()) // Feb 2026 = 28 days
  for (let d = 1; d <= 28; d++) {
    assert.ok(flat.has(`2026-02-${String(d).padStart(2, '0')}`), `missing day ${d}`)
  }
})

test('handles leap-year February (29 days)', () => {
  assert.ok(monthMatrix(2028, 2).flat().includes('2028-02-29'))
})

test('handles the December → January year boundary', () => {
  const flat = monthMatrix(2026, 12).flat()
  assert.ok(flat.includes('2026-12-31'), 'has last day of December')
  assert.ok(flat.some((d) => d.startsWith('2027-01')), 'trailing days spill into January')
})

test('sameMonth matches only the given year and month', () => {
  assert.equal(sameMonth('2026-07-01', 2026, 7), true)
  assert.equal(sameMonth('2026-07-31', 2026, 7), true)
  assert.equal(sameMonth('2026-06-30', 2026, 7), false)
  assert.equal(sameMonth('2026-08-01', 2026, 7), false)
  assert.equal(sameMonth('2025-07-15', 2026, 7), false)
})

test('toDateStr zero-pads local date parts', () => {
  assert.equal(toDateStr(new Date(2026, 0, 5)), '2026-01-05')
  assert.equal(toDateStr(new Date(2026, 11, 31)), '2026-12-31')
})
