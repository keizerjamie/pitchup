import { describe, it, expect } from 'vitest'
import { isTimeString } from '@/lib/utils'

describe('isTimeString', () => {
  it('accepteert een geldige kloktijd met leidende nul', () => {
    expect(isTimeString('09:05')).toBe(true)
  })

  it('accepteert de randen van de dag', () => {
    expect(isTimeString('00:00')).toBe(true)
    expect(isTimeString('23:59')).toBe(true)
  })

  it('weigert een tijd zonder leidende nullen', () => {
    expect(isTimeString('9:5')).toBe(false)
    expect(isTimeString('9:05')).toBe(false)
  })

  it('weigert een uur buiten het bereik', () => {
    expect(isTimeString('24:00')).toBe(false)
    expect(isTimeString('25:00')).toBe(false)
    expect(isTimeString('99:99')).toBe(false)
  })

  it('weigert minuten buiten het bereik', () => {
    expect(isTimeString('12:60')).toBe(false)
  })

  it('weigert seconden of andere toevoegingen', () => {
    expect(isTimeString('12:30:00')).toBe(false)
    expect(isTimeString(' 12:30')).toBe(false)
    expect(isTimeString('12:30 ')).toBe(false)
  })

  it('weigert lege en niet-string invoer', () => {
    expect(isTimeString('')).toBe(false)
    expect(isTimeString(null)).toBe(false)
    expect(isTimeString(undefined)).toBe(false)
    expect(isTimeString(1230)).toBe(false)
    expect(isTimeString({ hours: 12 })).toBe(false)
  })

  it('weigert tekst', () => {
    expect(isTimeString('abc')).toBe(false)
  })
})
