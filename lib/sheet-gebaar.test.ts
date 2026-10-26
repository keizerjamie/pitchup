import { describe, it, expect } from 'vitest'
import { moetSluiten, rubberband, snelheid, SHEET_SLOP_PX, SHEET_SLUIT_MS, SHEET_TERUG_MS } from '@/lib/sheet-gebaar'

describe('moetSluiten', () => {
  it('sluit niet net onder de afstandsdrempel (dy=119, h=600)', () => {
    expect(moetSluiten({ dy: 119, vy: 0, hoogte: 600 })).toBe(false)
  })
  it('sluit op de afstandsdrempel (dy=120, h=600)', () => {
    expect(moetSluiten({ dy: 120, vy: 0, hoogte: 600 })).toBe(true)
  })
  it('gebruikt 30% van een laag blad (h=200 -> drempel 60)', () => {
    expect(moetSluiten({ dy: 59, vy: 0, hoogte: 200 })).toBe(false)
    expect(moetSluiten({ dy: 60, vy: 0, hoogte: 200 })).toBe(true)
  })
  it('flick: dy=24 met vy=0.5 sluit', () => {
    expect(moetSluiten({ dy: 24, vy: 0.5, hoogte: 600 })).toBe(true)
  })
  it('flick onder de minimale afstand sluit niet (dy=23, vy=0.9)', () => {
    expect(moetSluiten({ dy: 23, vy: 0.9, hoogte: 600 })).toBe(false)
  })
  it('te trage flick (vy=0.49) onder de afstandsdrempel sluit niet', () => {
    expect(moetSluiten({ dy: 50, vy: 0.49, hoogte: 600 })).toBe(false)
  })
  it('opwaartse snelheid blokkeert sluiten, ook ver voorbij de drempel', () => {
    expect(moetSluiten({ dy: 300, vy: -0.2, hoogte: 600 })).toBe(false)
  })
  it('opwaartse snelheid precies op -0.1 blokkeert niet', () => {
    expect(moetSluiten({ dy: 300, vy: -0.1, hoogte: 600 })).toBe(true)
  })
})

describe('rubberband', () => {
  it('is monotoon stijgend en altijd kleiner dan de overshoot', () => {
    let vorige = 0
    for (const o of [1, 10, 50, 100, 300, 1000]) {
      const r = rubberband(o, 600)
      expect(r).toBeGreaterThan(vorige)
      expect(r).toBeLessThan(o)
      vorige = r
    }
  })
  it('geeft 0 bij geen overshoot en behoudt het teken', () => {
    expect(rubberband(0, 600)).toBe(0)
    expect(rubberband(-50, 600)).toBeCloseTo(-rubberband(50, 600))
  })
})

describe('snelheid', () => {
  it('geeft 0 bij te weinig monsters of gelijke tijd', () => {
    expect(snelheid([])).toBe(0)
    expect(snelheid([{ y: 0, t: 0 }])).toBe(0)
    expect(snelheid([{ y: 0, t: 5 }, { y: 50, t: 5 }])).toBe(0)
  })
  it('meet alleen over de laatste ~100ms', () => {
    const v = snelheid([
      { y: 0, t: 0 },
      { y: 400, t: 50 },
      { y: 410, t: 200 },
      { y: 430, t: 250 },
    ])
    // venster vanaf t=200 (50ms ervoor is te oud): (430-410)/(250-200)
    expect(v).toBeCloseTo(0.4)
  })
  it('negatief bij omhoog', () => {
    expect(snelheid([{ y: 100, t: 0 }, { y: 50, t: 50 }])).toBeCloseTo(-1)
  })
})

describe('constanten', () => {
  it('volgen de brief', () => {
    expect(SHEET_SLOP_PX).toBe(8)
    expect(SHEET_SLUIT_MS).toBe(240)
    expect(SHEET_TERUG_MS).toBe(300)
  })
})
