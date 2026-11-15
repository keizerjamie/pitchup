import { describe, it, expect } from 'vitest'
import {
  ZELFREVIEW_MEENEEM_MAX,
  ZELFREVIEW_SCORE_MAX,
  ZELFREVIEW_SCORE_MIN,
  ZELFREVIEW_STELLINGEN,
  ZELFREVIEW_TREND_MIN,
  isZelfreviewScore,
  kolomVoor,
  normaliseerMeeneem,
  valideerZelfreview,
  zelfreviewUitRij,
} from '@/lib/trainer-zelfreview'

const SCORES = { uitleg: 1, organisatie: 2, coaching: 3, sfeer: 4, tijdsbewaking: 5 }

describe('constanten', () => {
  it('vijf vaste stellingen in weergavevolgorde, schaal 1..5, tekst max 1000, trend vanaf 3', () => {
    expect([...ZELFREVIEW_STELLINGEN]).toEqual(['uitleg', 'organisatie', 'coaching', 'sfeer', 'tijdsbewaking'])
    expect([ZELFREVIEW_SCORE_MIN, ZELFREVIEW_SCORE_MAX]).toEqual([1, 5])
    expect(ZELFREVIEW_MEENEEM_MAX).toBe(1000)
    expect(ZELFREVIEW_TREND_MIN).toBe(3)
  })
})

describe('isZelfreviewScore', () => {
  it('accepteert precies de gehele getallen 1..5', () => {
    expect([1, 2, 3, 4, 5].every(isZelfreviewScore)).toBe(true)
  })
  it.each([0, 6, -1, 2.5, NaN, Infinity, '3', null, undefined, true, [3]])('weigert %s', (w) => {
    expect(isZelfreviewScore(w)).toBe(false)
  })
})

describe('normaliseerMeeneem', () => {
  it('trimt; leeg en alleen witruimte worden null; null/undefined → null', () => {
    expect(normaliseerMeeneem('  ok  ')).toBe('ok')
    expect(normaliseerMeeneem('')).toBeNull()
    expect(normaliseerMeeneem(' \n\t ')).toBeNull()
    expect(normaliseerMeeneem(null)).toBeNull()
    expect(normaliseerMeeneem(undefined)).toBeNull()
  })
  it('1000 tekens na trim mag, 1001 niet (undefined = ongeldig)', () => {
    expect(normaliseerMeeneem(` ${'a'.repeat(1000)} `)).toBe('a'.repeat(1000))
    expect(normaliseerMeeneem('a'.repeat(1001))).toBeUndefined()
  })
  it.each([42, {}, [], true])('een ander type (%s) is ongeldig', (w) => {
    expect(normaliseerMeeneem(w)).toBeUndefined()
  })
})

describe('valideerZelfreview', () => {
  it('geeft genormaliseerde waarden terug; extra sleutels vallen weg', () => {
    expect(valideerZelfreview({ scores: { ...SCORES, extra: 9 }, meeneem: '  x ' })).toEqual({ scores: SCORES, meeneem: 'x' })
    expect(valideerZelfreview({ scores: SCORES })).toEqual({ scores: SCORES, meeneem: null })
  })
  it.each([
    ['null', null],
    ['geen object', 'x'],
    ['scores ontbreekt', { meeneem: null }],
    ['scores array', { scores: [1, 2, 3, 4, 5], meeneem: null }],
    ['één stelling ontbreekt', { scores: { uitleg: 1, organisatie: 2, coaching: 3, sfeer: 4 }, meeneem: null }],
    ['één score ongeldig', { scores: { ...SCORES, sfeer: 0 }, meeneem: null }],
    ['meeneem te lang', { scores: SCORES, meeneem: 'a'.repeat(1001) }],
    ['meeneem geen string', { scores: SCORES, meeneem: 1 }],
  ])('%s → null', (_l, invoer) => {
    expect(valideerZelfreview(invoer)).toBeNull()
  })
})

describe('kolomVoor', () => {
  it('stelling → score_<stelling>', () => {
    expect(ZELFREVIEW_STELLINGEN.map(kolomVoor)).toEqual([
      'score_uitleg',
      'score_organisatie',
      'score_coaching',
      'score_sfeer',
      'score_tijdsbewaking',
    ])
  })
})

describe('zelfreviewUitRij', () => {
  const rij = { score_uitleg: 1, score_organisatie: 2, score_coaching: 3, score_sfeer: 4, score_tijdsbewaking: 5, meeneem: 'x' }
  it('een geldige rij → ZelfreviewWaarden', () => {
    expect(zelfreviewUitRij(rij)).toEqual({ scores: SCORES, meeneem: 'x' })
    expect(zelfreviewUitRij({ ...rij, meeneem: null })).toEqual({ scores: SCORES, meeneem: null })
  })
  it('geen rij of één ongeldige score → null ("geen review")', () => {
    expect(zelfreviewUitRij(null)).toBeNull()
    expect(zelfreviewUitRij(undefined)).toBeNull()
    expect(zelfreviewUitRij({ ...rij, score_sfeer: 7 })).toBeNull()
    expect(zelfreviewUitRij({ ...rij, score_uitleg: null })).toBeNull()
  })
  it('een onbruikbare tekst wordt null, de scores blijven', () => {
    expect(zelfreviewUitRij({ ...rij, meeneem: 42 })).toEqual({ scores: SCORES, meeneem: null })
  })
})
