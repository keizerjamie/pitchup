import { describe, it, expect } from 'vitest'
import {
  eventBatchGrootte,
  inBatches,
  MAX_EVENTS_PER_BATCH,
  MAX_RIJEN_PER_REQUEST,
} from '@/lib/attendance-batches'

describe('eventBatchGrootte', () => {
  it('34 spelers → 29 events per batch (29 × 34 = 986 ≤ 1000)', () => {
    expect(eventBatchGrootte(34)).toBe(29)
    expect(29 * 34).toBeLessThanOrEqual(MAX_RIJEN_PER_REQUEST)
  })

  it('weinig spelers → begrensd op MAX_EVENTS_PER_BATCH', () => {
    expect(eventBatchGrootte(1)).toBe(MAX_EVENTS_PER_BATCH)
    expect(eventBatchGrootte(20)).toBe(MAX_EVENTS_PER_BATCH)
  })

  it('0 spelers → geen deling door 0, MAX_EVENTS_PER_BATCH', () => {
    expect(eventBatchGrootte(0)).toBe(MAX_EVENTS_PER_BATCH)
  })

  it('meer dan 1000 spelers → minstens 1', () => {
    expect(eventBatchGrootte(5000)).toBe(1)
  })

  it('onbruikbare invoer (NaN, negatief) → als 1 speler', () => {
    expect(eventBatchGrootte(Number.NaN)).toBe(MAX_EVENTS_PER_BATCH)
    expect(eventBatchGrootte(-3)).toBe(MAX_EVENTS_PER_BATCH)
  })

  it('batch × spelers blijft voor elke teamgrootte ≤ 1000 rijen', () => {
    for (let n = 1; n <= 1200; n++) {
      expect(eventBatchGrootte(n) * Math.min(n, MAX_RIJEN_PER_REQUEST)).toBeLessThanOrEqual(MAX_RIJEN_PER_REQUEST)
    }
  })
})

describe('inBatches', () => {
  it('knipt in opeenvolgende stukken en behoudt de volgorde', () => {
    expect(inBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('lege lijst → geen batches', () => {
    expect(inBatches([], 10)).toEqual([])
  })

  it('ongeldige grootte → 1', () => {
    expect(inBatches(['a', 'b'], 0)).toEqual([['a'], ['b']])
    expect(inBatches(['a', 'b'], Number.NaN)).toEqual([['a'], ['b']])
  })

  it('muteert de invoer niet', () => {
    const invoer = [1, 2, 3]
    inBatches(invoer, 2)
    expect(invoer).toEqual([1, 2, 3])
  })

  it('110 events met 34 spelers → 4 batches, alle events precies één keer', () => {
    const ids = Array.from({ length: 110 }, (_, i) => `e${i}`)
    const batches = inBatches(ids, eventBatchGrootte(34))
    expect(batches).toHaveLength(4)
    expect(batches.flat()).toEqual(ids)
  })
})
