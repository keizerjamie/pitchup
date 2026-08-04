import { describe, it, expect } from 'vitest'
import {
  MAX_SEASON_DAYS,
  fromUtcMs,
  isDateString,
  seasonTrainingDates,
  toUtcMs,
  weekdayOf,
} from '@/lib/season-dates'

describe('isDateString / toUtcMs', () => {
  it('accepteert een geldige kalenderdatum', () => {
    expect(isDateString('2026-01-05')).toBe(true)
    expect(toUtcMs('1970-01-01')).toBe(0)
  })

  it('weigert een verkeerd formaat', () => {
    for (const value of ['5-1-2026', '2026-1-5', '2026-01-05T00:00:00', '', 'vandaag', 42, null]) {
      expect(isDateString(value)).toBe(false)
    }
  })

  it('weigert datums die niet bestaan in plaats van door te rollen', () => {
    expect(isDateString('2026-02-30')).toBe(false)
    expect(isDateString('2026-13-01')).toBe(false)
    expect(isDateString('2025-02-29')).toBe(false)
    // Schrikkeljaar bestaat wél.
    expect(isDateString('2024-02-29')).toBe(true)
  })
})

describe('weekdayOf', () => {
  it('geeft de weekdag in UTC (0 = zondag)', () => {
    expect(weekdayOf('2026-01-04')).toBe(0) // zondag
    expect(weekdayOf('2026-01-05')).toBe(1) // maandag
    expect(weekdayOf('2026-01-10')).toBe(6) // zaterdag
  })

  it('geeft null bij een ongeldige datum', () => {
    expect(weekdayOf('2026-02-30')).toBeNull()
  })
})

describe('seasonTrainingDates', () => {
  it('geeft alle datums op de gekozen weekdagen, inclusief begin en eind', () => {
    const res = seasonTrainingDates('2026-01-01', '2026-01-31', [1])
    expect(res).toEqual({
      ok: true,
      dates: ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'],
    })
  })

  it('neemt de start- en einddatum zelf mee wanneer die op een trainingsdag vallen', () => {
    const res = seasonTrainingDates('2026-01-05', '2026-01-12', [1])
    expect(res).toEqual({ ok: true, dates: ['2026-01-05', '2026-01-12'] })
  })

  it('sorteert meerdere trainingsdagen chronologisch', () => {
    const res = seasonTrainingDates('2026-01-05', '2026-01-11', [3, 1])
    expect(res).toEqual({ ok: true, dates: ['2026-01-05', '2026-01-07'] })
  })

  it('is tijdzone-onafhankelijk: zomertijd verschuift geen enkele datum', () => {
    // 29 maart 2026 is de omschakeling naar zomertijd in Europe/Amsterdam.
    const res = seasonTrainingDates('2026-03-23', '2026-04-06', [0, 1])
    expect(res).toEqual({
      ok: true,
      dates: ['2026-03-23', '2026-03-29', '2026-03-30', '2026-04-05', '2026-04-06'],
    })
  })

  it('rekent gelijk in een westelijke en een oostelijke tijdzone', () => {
    // Dezelfde aanroep moet in elke TZ hetzelfde geven; het proces draait onder
    // één TZ, dus controleren we de UTC-eigenschap direct: elke datum ligt op
    // de gevraagde weekdag volgens getUTCDay.
    const res = seasonTrainingDates('2026-06-01', '2026-08-31', [2])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    for (const date of res.dates) {
      expect(new Date(`${date}T00:00:00Z`).getUTCDay()).toBe(2)
      expect(weekdayOf(date)).toBe(2)
    }
  })

  it('geeft een lege lijst zonder (geldige) trainingsdagen', () => {
    expect(seasonTrainingDates('2026-01-01', '2026-01-31', [])).toEqual({ ok: true, dates: [] })
    expect(seasonTrainingDates('2026-01-01', '2026-01-31', [7, -1, 1.5])).toEqual({ ok: true, dates: [] })
  })

  it('weigert een ongeldige datum', () => {
    expect(seasonTrainingDates('2026-02-30', '2026-03-31', [1]))
      .toEqual({ ok: false, reason: 'invalid-date' })
    expect(seasonTrainingDates('01-01-2026', '2026-03-31', [1]))
      .toEqual({ ok: false, reason: 'invalid-date' })
  })

  it('weigert een einddatum vóór de startdatum', () => {
    expect(seasonTrainingDates('2026-03-01', '2026-01-01', [1]))
      .toEqual({ ok: false, reason: 'end-before-start' })
  })

  it('staat een seizoen van één dag toe', () => {
    expect(seasonTrainingDates('2026-01-05', '2026-01-05', [1])).toEqual({ ok: true, dates: ['2026-01-05'] })
    expect(seasonTrainingDates('2026-01-06', '2026-01-06', [1])).toEqual({ ok: true, dates: [] })
  })

  it('weigert een seizoen dat langer is dan MAX_SEASON_DAYS', () => {
    const start = '2026-01-01'
    const laatsteToegestane = fromUtcMs(toUtcMs(start)! + (MAX_SEASON_DAYS - 1) * 86_400_000)
    const eenTeVer = fromUtcMs(toUtcMs(start)! + MAX_SEASON_DAYS * 86_400_000)

    expect(seasonTrainingDates(start, laatsteToegestane, [1]).ok).toBe(true)
    expect(seasonTrainingDates(start, eenTeVer, [1]))
      .toEqual({ ok: false, reason: 'season-too-long' })
  })
})
