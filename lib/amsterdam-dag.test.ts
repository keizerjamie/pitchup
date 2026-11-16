import { describe, it, expect } from 'vitest'
import { TIJDZONE_STARTSCHERM, vandaagIn, dagenTussen } from '@/lib/amsterdam-dag'

// Alle instants met expliciete Z: de uitkomst mag niet afhangen van de
// tijdzone van het testproces.
const ams = (iso: string) => vandaagIn(TIJDZONE_STARTSCHERM, new Date(iso))

describe('vandaagIn (Europe/Amsterdam)', () => {
  it('constante is Europe/Amsterdam', () => {
    expect(TIJDZONE_STARTSCHERM).toBe('Europe/Amsterdam')
  })

  it('midden op de dag', () => {
    expect(ams('2026-11-16T12:00:00Z')).toBe('2026-11-16')
  })

  it('winter (UTC+1): 23:30Z is al de volgende dag, 22:59:59Z nog niet', () => {
    expect(ams('2026-11-16T23:30:00Z')).toBe('2026-11-17')
    expect(ams('2026-11-16T22:59:59Z')).toBe('2026-11-16')
    expect(ams('2026-11-16T23:00:00Z')).toBe('2026-11-17')
  })

  it('zomer (UTC+2): 22:30Z is al de volgende dag, 21:59:59Z nog niet', () => {
    expect(ams('2026-07-01T22:30:00Z')).toBe('2026-07-02')
    expect(ams('2026-07-01T21:59:59Z')).toBe('2026-07-01')
  })

  it('DST-wissel lente 2026-03-29 (02:00 → 03:00 lokaal)', () => {
    // Nacht vóór de wissel nog wintertijd: 23:00Z = 00:00 lokaal op de 29e.
    expect(ams('2026-03-28T22:59:59Z')).toBe('2026-03-28')
    expect(ams('2026-03-28T23:00:00Z')).toBe('2026-03-29')
    // Na de wissel zomertijd: 22:00Z = 00:00 lokaal op de 30e.
    expect(ams('2026-03-29T21:59:59Z')).toBe('2026-03-29')
    expect(ams('2026-03-29T22:00:00Z')).toBe('2026-03-30')
  })

  it('DST-wissel herfst 2026-10-25 (03:00 → 02:00 lokaal)', () => {
    // Nacht vóór de wissel nog zomertijd: 22:00Z = 00:00 lokaal op de 25e.
    expect(ams('2026-10-24T21:59:59Z')).toBe('2026-10-24')
    expect(ams('2026-10-24T22:00:00Z')).toBe('2026-10-25')
    // Na de wissel wintertijd: 23:00Z = 00:00 lokaal op de 26e.
    expect(ams('2026-10-25T22:59:59Z')).toBe('2026-10-25')
    expect(ams('2026-10-25T23:00:00Z')).toBe('2026-10-26')
  })

  it('jaargrens: 2026-12-31T23:30Z → 2027-01-01', () => {
    expect(ams('2026-12-31T23:30:00Z')).toBe('2027-01-01')
  })

  it('andere tijdzone geeft een andere kalenderdag', () => {
    expect(vandaagIn('America/New_York', new Date('2026-11-17T03:00:00Z'))).toBe('2026-11-16')
    expect(vandaagIn('UTC', new Date('2026-11-16T23:30:00Z'))).toBe('2026-11-16')
  })

  it('zonder `nu` gebruikt hij de huidige klok, in vorm YYYY-MM-DD', () => {
    expect(vandaagIn(TIJDZONE_STARTSCHERM)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('onbekende tijdzone gooit', () => {
    expect(() => vandaagIn('Mars/Olympus_Mons', new Date('2026-11-16T12:00:00Z'))).toThrow()
  })
})

describe('dagenTussen', () => {
  it('0 zelfde dag, 1 dag erna, -1 dag ervoor', () => {
    expect(dagenTussen('2026-11-16', '2026-11-16')).toBe(0)
    expect(dagenTussen('2026-11-16', '2026-11-17')).toBe(1)
    expect(dagenTussen('2026-11-16', '2026-11-15')).toBe(-1)
  })

  it('over een maandgrens en een jaargrens', () => {
    expect(dagenTussen('2026-11-30', '2026-12-01')).toBe(1)
    expect(dagenTussen('2026-01-31', '2026-03-01')).toBe(29)
    expect(dagenTussen('2026-12-31', '2027-01-01')).toBe(1)
    expect(dagenTussen('2027-01-01', '2026-12-25')).toBe(-7)
    expect(dagenTussen('2026-01-01', '2027-01-01')).toBe(365)
  })

  it('over een DST-wissel blijven het hele dagen', () => {
    expect(dagenTussen('2026-03-28', '2026-03-30')).toBe(2)
    expect(dagenTussen('2026-10-24', '2026-10-26')).toBe(2)
  })

  it('ongeldige datum → NaN (geen exception)', () => {
    expect(dagenTussen('2026-11-16', 'morgen')).toBeNaN()
    expect(dagenTussen('', '2026-11-16')).toBeNaN()
  })
})
