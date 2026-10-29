import { describe, it, expect } from 'vitest'
import {
  RPE_ANKERS,
  RPE_MAX,
  RPE_MIN,
  TRAINING_OORDELEN,
  heeftDoelstelling,
  isTrainingOordeel,
  isValidRpe,
} from '@/lib/training-evaluatie'

describe('constanten', () => {
  it('schaal 1..10 met vijf ankers (R7) en drie oordelen', () => {
    expect([RPE_MIN, RPE_MAX]).toEqual([1, 10])
    expect([...RPE_ANKERS]).toEqual([1, 3, 5, 7, 10])
    expect([...TRAINING_OORDELEN]).toEqual(['ja', 'deels', 'nee'])
    for (const anker of RPE_ANKERS) expect(isValidRpe(anker)).toBe(true)
  })
})

describe('isValidRpe (R.5)', () => {
  it.each([1, 2, 5, 9, 10])('%s is geldig', (v) => {
    expect(isValidRpe(v)).toBe(true)
  })

  it.each([
    ['0', 0], ['11', 11], ['-1', -1], ['5.5', 5.5], ["'5'", '5'], ['null', null], ['undefined', undefined],
    ['NaN', NaN], ['Infinity', Infinity], ['een object', { rpe: 5 }],
  ])('%s is ongeldig', (_label, v) => {
    expect(isValidRpe(v)).toBe(false)
  })
})

describe('isTrainingOordeel (O.4)', () => {
  it.each(['ja', 'deels', 'nee'])('%s is geldig', (v) => {
    expect(isTrainingOordeel(v)).toBe(true)
  })

  it.each([['Ja', 'Ja'], ['leeg', ''], ['misschien', 'misschien'], ['null', null], ['een getal', 1], [' ja', ' ja']])(
    '%s is ongeldig',
    (_label, v) => {
      expect(isTrainingOordeel(v)).toBe(false)
    },
  )
})

describe('heeftDoelstelling (T-G)', () => {
  it('een tekst is een doelstelling, ook met spaties eromheen', () => {
    expect(heeftDoelstelling('doel')).toBe(true)
    expect(heeftDoelstelling('  doel  ')).toBe(true)
  })

  it.each([['leeg', ''], ['alleen spaties', '   '], ['tab en newline', '\t\n'], ['null', null], ['undefined', undefined], ['een getal', 3]])(
    '%s is geen doelstelling',
    (_label, v) => {
      expect(heeftDoelstelling(v)).toBe(false)
    },
  )
})
