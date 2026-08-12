import { describe, it, expect } from 'vitest'
import { coversDate, findCoveringPeriod, periodIdByPlayerForDate } from '@/lib/absence-periods'
import type { AbsencePeriodRange } from '@/lib/absence-periods'

// Pure datumlogica: geen mocks, geen Date-objecten. De vergelijking gebeurt op
// YYYY-MM-DD-strings, dus deze tests zijn per definitie tijdzone-onafhankelijk.

const PLAYER_A = 'speler-a'
const PLAYER_B = 'speler-b'

function periode(over: Partial<AbsencePeriodRange> = {}): AbsencePeriodRange {
  return {
    id: 'p1',
    player_id: PLAYER_A,
    from_date: '2026-08-01',
    to_date: '2026-08-31',
    ...over,
  }
}

describe('coversDate', () => {
  it('dekt een datum midden in de periode', () => {
    expect(coversDate(periode(), '2026-08-15')).toBe(true)
  })

  it('telt beide grenzen mee (inclusief)', () => {
    expect(coversDate(periode(), '2026-08-01')).toBe(true)
    expect(coversDate(periode(), '2026-08-31')).toBe(true)
  })

  it('laat een dag vóór of ná de periode ongemoeid', () => {
    expect(coversDate(periode(), '2026-07-31')).toBe(false)
    expect(coversDate(periode(), '2026-09-01')).toBe(false)
  })

  it('werkt voor een periode van één dag', () => {
    const eenDag = periode({ from_date: '2026-08-10', to_date: '2026-08-10' })
    expect(coversDate(eenDag, '2026-08-10')).toBe(true)
    expect(coversDate(eenDag, '2026-08-09')).toBe(false)
    expect(coversDate(eenDag, '2026-08-11')).toBe(false)
  })

  it('vergelijkt over een jaargrens heen correct', () => {
    const winter = periode({ from_date: '2026-12-20', to_date: '2027-01-05' })
    expect(coversDate(winter, '2026-12-31')).toBe(true)
    expect(coversDate(winter, '2027-01-05')).toBe(true)
    expect(coversDate(winter, '2027-01-06')).toBe(false)
  })
})

describe('findCoveringPeriod', () => {
  it('geeft null zonder dekkende periode', () => {
    expect(findCoveringPeriod([periode()], '2026-09-15')).toBeNull()
    expect(findCoveringPeriod([], '2026-08-15')).toBeNull()
  })

  it('geeft de dekkende periode terug', () => {
    const p = periode({ id: 'p9' })
    expect(findCoveringPeriod([p], '2026-08-02')).toBe(p)
  })

  it('kiest bij overlap deterministisch de eerste uit de lijst', () => {
    const eerste = periode({ id: 'p1', from_date: '2026-08-01', to_date: '2026-08-20' })
    const tweede = periode({ id: 'p2', from_date: '2026-08-10', to_date: '2026-08-31' })
    expect(findCoveringPeriod([eerste, tweede], '2026-08-15')!.id).toBe('p1')
    expect(findCoveringPeriod([tweede, eerste], '2026-08-15')!.id).toBe('p2')
  })

  it('slaat een niet-dekkende periode over en pakt de volgende die wél dekt', () => {
    const vroeg = periode({ id: 'p1', from_date: '2026-07-01', to_date: '2026-07-31' })
    const laat = periode({ id: 'p2', from_date: '2026-08-01', to_date: '2026-08-31' })
    expect(findCoveringPeriod([vroeg, laat], '2026-08-05')!.id).toBe('p2')
  })
})

describe('periodIdByPlayerForDate', () => {
  it('mapt elke speler met een dekkende periode op het periode-id', () => {
    const map = periodIdByPlayerForDate(
      [
        periode({ id: 'p1', player_id: PLAYER_A }),
        periode({ id: 'p2', player_id: PLAYER_B, from_date: '2026-08-10', to_date: '2026-08-12' }),
      ],
      '2026-08-11',
    )
    expect(map.get(PLAYER_A)).toBe('p1')
    expect(map.get(PLAYER_B)).toBe('p2')
  })

  it('laat spelers zonder dekkende periode buiten de map', () => {
    const map = periodIdByPlayerForDate(
      [periode({ id: 'p2', player_id: PLAYER_B, from_date: '2026-08-10', to_date: '2026-08-12' })],
      '2026-08-20',
    )
    expect(map.has(PLAYER_B)).toBe(false)
    expect(map.get(PLAYER_B) ?? null).toBeNull()
    expect(map.size).toBe(0)
  })

  it('houdt bij twee overlappende periodes van dezelfde speler de eerste aan', () => {
    const map = periodIdByPlayerForDate(
      [
        periode({ id: 'p1', from_date: '2026-08-01', to_date: '2026-08-20' }),
        periode({ id: 'p2', from_date: '2026-08-10', to_date: '2026-08-31' }),
      ],
      '2026-08-15',
    )
    expect(map.get(PLAYER_A)).toBe('p1')
    expect(map.size).toBe(1)
  })

  it('telt de grensdatums mee', () => {
    const periodes = [periode({ id: 'p1', from_date: '2026-08-01', to_date: '2026-08-31' })]
    expect(periodIdByPlayerForDate(periodes, '2026-08-01').get(PLAYER_A)).toBe('p1')
    expect(periodIdByPlayerForDate(periodes, '2026-08-31').get(PLAYER_A)).toBe('p1')
    expect(periodIdByPlayerForDate(periodes, '2026-09-01').size).toBe(0)
  })

  it('geeft een lege map zonder periodes', () => {
    expect(periodIdByPlayerForDate([], '2026-08-15').size).toBe(0)
  })
})
