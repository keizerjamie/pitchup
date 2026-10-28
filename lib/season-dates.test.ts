import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MAX_SEASON_DAYS,
  MAX_WEKEN_IN_VENSTER,
  fromUtcMs,
  isDateString,
  isoWeek,
  maandagVanWeek,
  seasonTrainingDates,
  toUtcMs,
  weekdayOf,
  wekenInVenster,
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

// ── ISO-weken (inzichten-metrics fase 3a, T7 / AC-A10) ────────────────

describe('maandagVanWeek', () => {
  it('een dinsdag gaat naar de maandag van dezelfde week', () => {
    expect(maandagVanWeek('2026-10-27')).toBe('2026-10-26')
  })

  it('een maandag blijft zichzelf, een zondag gaat naar de maandag ervóór', () => {
    expect(maandagVanWeek('2026-10-26')).toBe('2026-10-26')
    expect(maandagVanWeek('2026-11-01')).toBe('2026-10-26')
    expect(maandagVanWeek('2026-11-02')).toBe('2026-11-02')
  })

  it('schrikkeljaar: 1 maart 2024 hoort bij de week van maandag 26 februari (over 29 feb heen)', () => {
    expect(maandagVanWeek('2024-03-01')).toBe('2024-02-26')
    expect(maandagVanWeek('2024-02-29')).toBe('2024-02-26')
  })

  it('jaarwisseling: 1 januari 2027 (vrijdag) hoort bij de week van maandag 28 december 2026', () => {
    expect(maandagVanWeek('2027-01-01')).toBe('2026-12-28')
    expect(maandagVanWeek('2027-01-03')).toBe('2026-12-28')
  })

  it('ongeldige invoer geeft null', () => {
    for (const ongeldig of ['2026-02-30', '', 'x', '2026-1-5', '2026-10-27T00:00:00']) {
      expect(maandagVanWeek(ongeldig)).toBeNull()
    }
  })
})

describe('isoWeek', () => {
  it('jaarwisseling: de donderdag bepaalt het ISO-jaar', () => {
    expect(isoWeek('2020-12-31')).toEqual({ jaar: 2020, week: 53 })
    expect(isoWeek('2021-01-03')).toEqual({ jaar: 2020, week: 53 })
    expect(isoWeek('2021-01-04')).toEqual({ jaar: 2021, week: 1 })
    expect(isoWeek('2024-12-30')).toEqual({ jaar: 2025, week: 1 })
    expect(isoWeek('2026-12-28')).toEqual({ jaar: 2026, week: 53 })
    expect(isoWeek('2027-01-03')).toEqual({ jaar: 2026, week: 53 })
    expect(isoWeek('2027-01-04')).toEqual({ jaar: 2027, week: 1 })
  })

  it('gewone weken en week 52', () => {
    expect(isoWeek('2026-10-27')).toEqual({ jaar: 2026, week: 44 })
    expect(isoWeek('2026-01-01')).toEqual({ jaar: 2026, week: 1 })
    expect(isoWeek('2025-12-28')).toEqual({ jaar: 2025, week: 52 })
    expect(isoWeek('2025-12-29')).toEqual({ jaar: 2026, week: 1 })
  })

  it('schrikkeljaar: 29 februari 2024 valt in week 9', () => {
    expect(isoWeek('2024-02-29')).toEqual({ jaar: 2024, week: 9 })
    expect(isoWeek('2024-03-03')).toEqual({ jaar: 2024, week: 9 })
  })

  it('ongeldige invoer geeft null', () => {
    expect(isoWeek('2026-02-30')).toBeNull()
    expect(isoWeek('')).toBeNull()
    expect(isoWeek('x')).toBeNull()
  })
})

describe('wekenInVenster', () => {
  it('geeft de maandagen van de eerste t/m de laatste geraakte week, chronologisch', () => {
    expect(wekenInVenster('2026-10-01', '2026-10-27')).toEqual([
      '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26',
    ])
  })

  it('een venster binnen één week geeft één maandag; start = end ook', () => {
    expect(wekenInVenster('2026-10-27', '2026-10-29')).toEqual(['2026-10-26'])
    expect(wekenInVenster('2026-11-01', '2026-11-01')).toEqual(['2026-10-26'])
  })

  it('over de jaarwisseling: week 52, 53 en 1', () => {
    const weken = wekenInVenster('2026-12-20', '2027-01-06')
    expect(weken).toEqual(['2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04'])
    expect(weken.map((m) => isoWeek(m)!.week)).toEqual([51, 52, 53, 1])
  })

  it('DST: de weken rond 29-03-2026 en 25-10-2026 liggen precies 7 dagen uit elkaar', () => {
    for (const [start, end] of [['2026-03-16', '2026-04-12'], ['2026-10-12', '2026-11-08']]) {
      const weken = wekenInVenster(start, end)
      expect(weken).toHaveLength(4)
      for (let i = 1; i < weken.length; i++) {
        expect(toUtcMs(weken[i])! - toUtcMs(weken[i - 1])!).toBe(7 * 86_400_000)
        expect(weekdayOf(weken[i])).toBe(1)
      }
    }
    expect(wekenInVenster('2026-03-23', '2026-03-29')).toEqual(['2026-03-23'])
    expect(wekenInVenster('2026-10-19', '2026-10-25')).toEqual(['2026-10-19'])
  })

  it('end < start of ongeldige invoer geeft []', () => {
    expect(wekenInVenster('2026-10-27', '2026-10-26')).toEqual([])
    expect(wekenInVenster('2026-02-30', '2026-03-10')).toEqual([])
    expect(wekenInVenster('2026-03-01', '')).toEqual([])
    expect(wekenInVenster('x', 'y')).toEqual([])
  })

  it('de lus is begrensd op MAX_WEKEN_IN_VENSTER', () => {
    expect(MAX_WEKEN_IN_VENSTER).toBe(Math.ceil(MAX_SEASON_DAYS / 7) + 2)
    expect(wekenInVenster('2000-01-01', '2030-01-01')).toHaveLength(MAX_WEKEN_IN_VENSTER)
  })
})

// AC-A10: dezelfde uitkomst onder drie tijdzones × drie kloktijden (vaste klok,
// patroon inzichten-metrics-fase2b.acceptance.test.tsx).
const TZS: [string, number][] = [
  ['Europe/Amsterdam', -120],
  ['America/Los_Angeles', 420],
  ['Pacific/Auckland', -780],
]
const ORIGINELE_TZ = process.env.TZ

function isoWeekUitkomst() {
  return {
    maandagen: ['2026-10-25', '2026-10-26', '2026-11-01', '2026-03-29', '2026-03-30', '2024-02-29', '2020-12-31', '2021-01-03']
      .map(maandagVanWeek),
    weken: ['2020-12-31', '2021-01-04', '2024-12-30', '2026-12-28', '2026-03-29', '2026-10-25'].map(isoWeek),
    venster: wekenInVenster('2026-12-20', '2027-01-06'),
    dst: wekenInVenster('2026-10-12', '2026-11-08'),
  }
}

describe.each(TZS)('ISO-weken onder tijdzone %s', (tz, offset) => {
  beforeEach(() => {
    process.env.TZ = tz
  })
  afterEach(() => {
    vi.useRealTimers()
    process.env.TZ = ORIGINELE_TZ
  })

  it('TZ-controle: de tijdzone is echt gewisseld', () => {
    expect(new Date(2026, 9, 15, 12, 0).getTimezoneOffset()).toBe(offset)
  })

  it.each([[0, 30], [10, 0], [23, 30]])('om %i:%i lokaal is de uitkomst identiek', (uur, min) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 25, uur, min, 0))
    expect(isoWeekUitkomst()).toEqual({
      maandagen: ['2026-10-19', '2026-10-26', '2026-10-26', '2026-03-23', '2026-03-30', '2024-02-26', '2020-12-28', '2020-12-28'],
      weken: [
        { jaar: 2020, week: 53 },
        { jaar: 2021, week: 1 },
        { jaar: 2025, week: 1 },
        { jaar: 2026, week: 53 },
        { jaar: 2026, week: 13 },
        { jaar: 2026, week: 43 },
      ],
      venster: ['2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04'],
      dst: ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'],
    })
  })
})
