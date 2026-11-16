import { describe, it, expect } from 'vitest'
import {
  begroetingVoorUur,
  lokaalUur,
  GRENS_AVOND,
  GRENS_MIDDAG,
} from '@/lib/begroeting'

const LABELS = { morning: 'Goedemorgen', afternoon: 'Goedemiddag', evening: 'Goedenavond' }

describe('begroetingVoorUur', () => {
  it.each([
    [0, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [23, 'evening'],
  ] as const)('uur %i → %s', (uur, verwacht) => {
    expect(begroetingVoorUur(uur)).toBe(verwacht)
  })

  it('grenzen zijn 12 en 18', () => {
    expect(GRENS_MIDDAG).toBe(12)
    expect(GRENS_AVOND).toBe(18)
  })
})

describe('lokaalUur', () => {
  it('23:30 UTC is 00:30 in Amsterdam (wintertijd) → uur 0 → Goedemorgen', () => {
    const uur = lokaalUur(new Date('2026-11-04T23:30:00Z'), 'Europe/Amsterdam')
    expect(uur).toBe(0)
    expect(LABELS[begroetingVoorUur(uur)]).toBe('Goedemorgen')
  })

  it('zomertijd: 16:30 UTC is 18:30 in Amsterdam → avond', () => {
    expect(lokaalUur(new Date('2026-07-01T16:30:00Z'), 'Europe/Amsterdam')).toBe(18)
  })

  it('UTC middernacht → 0, niet 24', () => {
    expect(lokaalUur(new Date('2026-11-04T00:00:00Z'), 'UTC')).toBe(0)
  })

  it('zonder tijdzone → getHours() van de omgeving', () => {
    const d = new Date('2026-11-04T10:15:00Z')
    expect(lokaalUur(d)).toBe(d.getHours())
  })

  it('onbekende tijdzone gooit niet maar valt terug op getHours()', () => {
    const d = new Date('2026-11-04T10:15:00Z')
    expect(lokaalUur(d, 'Niet/Bestaand')).toBe(d.getHours())
  })
})
