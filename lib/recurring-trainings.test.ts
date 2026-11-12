import { describe, it, expect } from 'vitest'
import {
  EMPTY_TRAINING_DEFAULTS,
  MAX_RECURRING_DAYS,
  parseRepeatDays,
  planRecurringTrainings,
  resolveNewTrainingDefaults,
} from '@/lib/recurring-trainings'
import { MAX_SEASON_DAYS, fromUtcMs, seasonTrainingDates, toUtcMs, weekdayOf } from '@/lib/season-dates'

const DAY_MS = 86_400_000
function plusDays(date: string, n: number): string {
  return fromUtcMs(toUtcMs(date)! + n * DAY_MS)
}

function okPlan(result: ReturnType<typeof planRecurringTrainings>) {
  if (!result.ok) throw new Error(`verwacht ok, kreeg ${result.error}`)
  return result
}

// ────────────────────────────────────────────────
// parseRepeatDays
// ────────────────────────────────────────────────

describe('parseRepeatDays', () => {
  it('leest een kommalijst als unieke, oplopende weekdagen', () => {
    expect(parseRepeatDays('4,2')).toEqual([2, 4])
    expect(parseRepeatDays(' 1 , 3 ,1')).toEqual([1, 3])
    expect(parseRepeatDays('0,6')).toEqual([0, 6])
  })

  it('maakt van een lege string geen zondag', () => {
    expect(parseRepeatDays('')).toEqual([])
    expect(parseRepeatDays(',,')).toEqual([])
  })

  it('negeert alles wat geen weekdag 0-6 is', () => {
    expect(parseRepeatDays('7')).toEqual([])
    expect(parseRepeatDays('a')).toEqual([])
    expect(parseRepeatDays('-1,1.5,10')).toEqual([])
    expect(parseRepeatDays('2,7,a,4')).toEqual([2, 4])
  })

  it('geeft [] voor iets anders dan tekst', () => {
    expect(parseRepeatDays(null)).toEqual([])
    expect(parseRepeatDays(undefined)).toEqual([])
    expect(parseRepeatDays(new Blob(['1']))).toEqual([])
  })
})

// ────────────────────────────────────────────────
// planRecurringTrainings
// ────────────────────────────────────────────────

describe('planRecurringTrainings — datums', () => {
  it('di + do over vier weken levert acht trainingen', () => {
    // 2026-11-02 is een maandag, 2026-11-29 een zondag.
    const plan = okPlan(planRecurringTrainings('2026-11-02', '2026-11-29', [2, 4]))
    expect(plan.dates).toEqual([
      '2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12',
      '2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26',
    ])
    expect(plan.toCreate).toEqual(plan.dates)
    expect(plan.skipped).toBe(0)
  })

  it('begint bij een start op woensdag met alleen dinsdag op de dinsdag erna', () => {
    expect(weekdayOf('2026-11-04')).toBe(3)
    const plan = okPlan(planRecurringTrainings('2026-11-04', '2026-11-30', [2]))
    expect(plan.dates[0]).toBe('2026-11-10')
    expect(plan.dates).toEqual(['2026-11-10', '2026-11-17', '2026-11-24'])
  })

  it('einddatum gelijk aan start op een gekozen dag → één training', () => {
    const plan = okPlan(planRecurringTrainings('2026-11-03', '2026-11-03', [2]))
    expect(plan.dates).toEqual(['2026-11-03'])
  })

  it('einddatum gelijk aan start op een niet-gekozen dag → geen training, geen fout', () => {
    const plan = okPlan(planRecurringTrainings('2026-11-04', '2026-11-04', [2]))
    expect(plan.dates).toEqual([])
    expect(plan.toCreate).toEqual([])
    expect(plan.skipped).toBe(0)
  })

  it('staat een herhaling in het verleden toe', () => {
    const plan = okPlan(planRecurringTrainings('2020-01-01', '2020-01-31', [3]))
    expect(plan.dates).toEqual(['2020-01-01', '2020-01-08', '2020-01-15', '2020-01-22', '2020-01-29'])
  })

  it('houdt de weekdag vast over de zomertijdovergangen (2026-03-29 en 2026-10-25)', () => {
    const lente = okPlan(planRecurringTrainings('2026-03-22', '2026-04-05', [0]))
    expect(lente.dates).toEqual(['2026-03-22', '2026-03-29', '2026-04-05'])
    const herfst = okPlan(planRecurringTrainings('2026-10-18', '2026-11-01', [0]))
    expect(herfst.dates).toEqual(['2026-10-18', '2026-10-25', '2026-11-01'])
  })

  it('neemt schrikkeldag 2028-02-29 (een dinsdag) mee', () => {
    const plan = okPlan(planRecurringTrainings('2028-02-20', '2028-03-08', [2]))
    expect(plan.dates).toEqual(['2028-02-22', '2028-02-29', '2028-03-07'])
  })

  it('loopt door over de jaarwisseling', () => {
    const plan = okPlan(planRecurringTrainings('2026-12-21', '2027-01-11', [1]))
    expect(plan.dates).toEqual(['2026-12-21', '2026-12-28', '2027-01-04', '2027-01-11'])
  })

  it('negeert ongeldige weekdagen naast geldige', () => {
    const plan = okPlan(planRecurringTrainings('2026-11-02', '2026-11-08', [2, 9, -1, 1.5]))
    expect(plan.dates).toEqual(['2026-11-03'])
  })

  it('geeft exact dezelfde datums als seasonTrainingDates', () => {
    const start = '2026-08-17'
    const end = '2027-06-30'
    const days = [1, 3, 5]
    const season = seasonTrainingDates(start, end, days)
    if (!season.ok) throw new Error('seasonTrainingDates faalde')
    expect(okPlan(planRecurringTrainings(start, end, days)).dates).toEqual(season.dates)
  })
})

describe('planRecurringTrainings — bestaande trainingen', () => {
  it('slaat bestaande datums over en telt ze als overgeslagen', () => {
    const existing = new Set(['2026-11-05', '2026-11-19', '2026-11-20'])
    const plan = okPlan(planRecurringTrainings('2026-11-02', '2026-11-29', [2, 4], existing))
    expect(plan.dates).toHaveLength(8)
    expect(plan.toCreate).toEqual([
      '2026-11-03', '2026-11-10', '2026-11-12', '2026-11-17', '2026-11-24', '2026-11-26',
    ])
    // 2026-11-20 ligt niet op een gekozen dag en telt dus niet mee.
    expect(plan.skipped).toBe(2)
  })

  it('alles bestaat al → niets aan te maken, alles overgeslagen', () => {
    const existing = new Set(['2026-11-03', '2026-11-10'])
    const plan = okPlan(planRecurringTrainings('2026-11-02', '2026-11-15', [2], existing))
    expect(plan.toCreate).toEqual([])
    expect(plan.skipped).toBe(2)
  })
})

describe('planRecurringTrainings — fouten', () => {
  it('weigert zonder weekdagen', () => {
    expect(planRecurringTrainings('2026-11-02', '2026-11-29', [])).toEqual({ ok: false, error: 'no_weekdays' })
    expect(planRecurringTrainings('2026-11-02', '2026-11-29', [7, -1])).toEqual({ ok: false, error: 'no_weekdays' })
  })

  it('weigert een einddatum vóór de start', () => {
    expect(planRecurringTrainings('2026-11-10', '2026-11-09', [2])).toEqual({ ok: false, error: 'end_before_start' })
  })

  it('accepteert precies het maximum en weigert één dag meer', () => {
    expect(MAX_RECURRING_DAYS).toBe(MAX_SEASON_DAYS)
    const start = '2026-01-01'
    expect(planRecurringTrainings(start, plusDays(start, MAX_SEASON_DAYS - 1), [1]).ok).toBe(true)
    expect(planRecurringTrainings(start, plusDays(start, MAX_SEASON_DAYS), [1])).toEqual({ ok: false, error: 'too_long' })
  })

  it('weigert een niet-bestaande of lege einddatum', () => {
    expect(planRecurringTrainings('2026-02-01', '2026-02-30', [1])).toEqual({ ok: false, error: 'invalid_end_date' })
    expect(planRecurringTrainings('2026-02-01', '', [1])).toEqual({ ok: false, error: 'invalid_end_date' })
  })

  it('weigert een ongeldige startdatum', () => {
    expect(planRecurringTrainings('2026-02-30', '2026-03-30', [1])).toEqual({ ok: false, error: 'invalid_date' })
  })

  it('meldt de fouten in dezelfde volgorde als de server: start, weekdagen, einddatum, bereik', () => {
    expect(planRecurringTrainings('x', 'y', [])).toEqual({ ok: false, error: 'invalid_date' })
    expect(planRecurringTrainings('2026-11-02', 'y', [])).toEqual({ ok: false, error: 'no_weekdays' })
    expect(planRecurringTrainings('2026-11-02', 'y', [1])).toEqual({ ok: false, error: 'invalid_end_date' })
  })
})

// ────────────────────────────────────────────────
// resolveNewTrainingDefaults
// ────────────────────────────────────────────────

describe('resolveNewTrainingDefaults', () => {
  const settings = { training_time: '19:30', training_location: 'Sportpark Oost', season_end: '2027-06-30' }

  it('neemt tijd en locatie van de laatste training, de einddatum uit de instellingen', () => {
    expect(resolveNewTrainingDefaults({ time: '18:45:00', location: '  Veld 2  ' }, settings)).toEqual({
      time: '18:45',
      location: 'Veld 2',
      seasonEnd: '2027-06-30',
    })
  })

  it('valt per veld terug op de instellingen als de laatste training het veld leeg heeft', () => {
    expect(resolveNewTrainingDefaults({ time: null, location: 'Veld 2' }, settings)).toEqual({
      time: '19:30', location: 'Veld 2', seasonEnd: '2027-06-30',
    })
    expect(resolveNewTrainingDefaults({ time: '18:45:00', location: '   ' }, settings)).toEqual({
      time: '18:45', location: 'Sportpark Oost', seasonEnd: '2027-06-30',
    })
  })

  it('gebruikt de instellingen als er nog geen training is', () => {
    expect(resolveNewTrainingDefaults(null, settings)).toEqual({
      time: '19:30', location: 'Sportpark Oost', seasonEnd: '2027-06-30',
    })
  })

  it('geeft null als training én instelling leeg zijn', () => {
    expect(resolveNewTrainingDefaults({ time: null, location: null }, {})).toEqual(EMPTY_TRAINING_DEFAULTS)
    expect(resolveNewTrainingDefaults(null, {})).toEqual(EMPTY_TRAINING_DEFAULTS)
  })

  it('negeert een ongeldige tijd uit de instellingen (die wordt bij opslaan niet gecontroleerd)', () => {
    expect(resolveNewTrainingDefaults(null, { training_time: '25:00' }).time).toBeNull()
    expect(resolveNewTrainingDefaults(null, { training_time: 'kwart over zeven' }).time).toBeNull()
    expect(resolveNewTrainingDefaults(null, { training_time: '19:00:00' }).time).toBe('19:00')
  })

  it('negeert een te lange locatie', () => {
    const lang = 'x'.repeat(201)
    expect(resolveNewTrainingDefaults({ time: null, location: lang }, {}).location).toBeNull()
    expect(resolveNewTrainingDefaults({ time: null, location: lang }, settings).location).toBe('Sportpark Oost')
    expect(resolveNewTrainingDefaults(null, { training_location: 'y'.repeat(200) }).location).toBe('y'.repeat(200))
  })

  it('negeert een ongeldig seizoenseinde', () => {
    expect(resolveNewTrainingDefaults(null, { season_end: '2027-02-30' }).seasonEnd).toBeNull()
    expect(resolveNewTrainingDefaults(null, { season_end: '' }).seasonEnd).toBeNull()
  })
})
