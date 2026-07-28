import { describe, it, expect } from 'vitest'
import {
  formationsForSize,
  isFormationValidForSize,
  FORMATIONS_BY_TEAM_SIZE,
} from '@/lib/types'

const SIZES = [3, 4, 5, 6, 7, 8, 9, 11]

describe('formationsForSize', () => {
  it('geeft minstens één formatie per ondersteunde grootte', () => {
    for (const n of SIZES) {
      const list = formationsForSize(n)
      expect(list.length).toBeGreaterThan(0)
    }
  })

  it('elke formatie heeft evenveel posities als de teamgrootte', () => {
    for (const n of SIZES) {
      for (const f of formationsForSize(n)) {
        expect(f.positions.length).toBe(n)
      }
    }
  })

  it('geeft een lege lijst voor een niet-ondersteunde grootte', () => {
    expect(formationsForSize(10)).toEqual([])
    expect(formationsForSize(0)).toEqual([])
  })

  it('11-tal hergebruikt de bestaande FORMATIONS-vormen', () => {
    const keys = FORMATIONS_BY_TEAM_SIZE[11].map((f) => f.key)
    expect(keys).toContain('4-3-3')
    expect(keys).toContain('4-4-2')
  })
})

describe('isFormationValidForSize', () => {
  it('null formatie is altijd geldig', () => {
    expect(isFormationValidForSize(7, null)).toBe(true)
    expect(isFormationValidForSize(null, null)).toBe(true)
  })

  it('een passende formatie (key) is geldig', () => {
    expect(isFormationValidForSize(7, '2-3-1')).toBe(true)
    expect(isFormationValidForSize(6, '2-2-1')).toBe(true)
    expect(isFormationValidForSize(11, '4-3-3')).toBe(true)
  })

  it('een niet-passende formatie is ongeldig', () => {
    expect(isFormationValidForSize(7, '4-3-3')).toBe(false)
    expect(isFormationValidForSize(3, '2-3-1')).toBe(false)
  })

  it('een formatie zonder grootte is ongeldig', () => {
    expect(isFormationValidForSize(null, '4-3-3')).toBe(false)
  })
})
