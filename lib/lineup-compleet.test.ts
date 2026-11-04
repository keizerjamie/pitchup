import { describe, it, expect } from 'vitest'
import { telOpstelling } from '@/lib/lineup-compleet'
import { FORMATIONS } from '@/lib/types'

// Pure telling, geen mocks. De posities worden opgebouwd uit de echte formatie
// in FORMATIONS, zodat de test meebeweegt als een formatie ooit van vorm
// verandert — het totaal komt nooit uit een vaste 11.

const FORMATIE = '4-3-3'
const SLOTS = FORMATIONS[FORMATIE].positions

function uuid(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
}

function opstelling(spelerIds: (string | null)[]) {
  return SLOTS.map((slot, i) => ({ ...slot, player_id: spelerIds[i] ?? null }))
}

const VOL: (string | null)[] = SLOTS.map((_, i) => uuid(i + 1))

describe('telOpstelling', () => {
  it('alle posities gevuld met unieke spelers → compleet, 0 leeg', () => {
    expect(telOpstelling(FORMATIE, opstelling(VOL))).toEqual({ totaal: SLOTS.length, leeg: 0, compleet: true })
  })

  it('één lege positie → niet compleet, leeg = 1', () => {
    const ids = [...VOL]
    ids[4] = null
    expect(telOpstelling(FORMATIE, opstelling(ids))).toEqual({ totaal: SLOTS.length, leeg: 1, compleet: false })
  })

  it('drie lege posities → leeg = 3', () => {
    const ids = [...VOL]
    ids[0] = null
    ids[5] = null
    ids[10] = null
    expect(telOpstelling(FORMATIE, opstelling(ids)).leeg).toBe(3)
  })

  it('volledig leeg → leeg = totaal', () => {
    expect(telOpstelling(FORMATIE, opstelling([]))).toEqual({ totaal: SLOTS.length, leeg: SLOTS.length, compleet: false })
  })

  it('dezelfde speler op twee posities → niet compleet (unieke spelers tellen)', () => {
    const ids = [...VOL]
    ids[10] = ids[0]
    const r = telOpstelling(FORMATIE, opstelling(ids))
    expect(r.compleet).toBe(false)
    expect(r.leeg).toBe(1)
  })

  it('lege string als player_id telt als leeg', () => {
    const ids = [...VOL]
    ids[2] = ''
    expect(telOpstelling(FORMATIE, opstelling(ids)).compleet).toBe(false)
  })

  it('onbekende formatie → { totaal: null, leeg: null, compleet: false }, geen throw', () => {
    expect(telOpstelling('9-9-9', opstelling(VOL))).toEqual({ totaal: null, leeg: null, compleet: false })
  })

  it('prototype-sleutel als formatie (constructor/__proto__) → onbekend, geen throw', () => {
    expect(telOpstelling('constructor', opstelling(VOL)).compleet).toBe(false)
    expect(telOpstelling('__proto__', opstelling(VOL)).totaal).toBeNull()
  })

  it('formatie geen string → onbekend', () => {
    expect(telOpstelling(undefined, opstelling(VOL))).toEqual({ totaal: null, leeg: null, compleet: false })
    expect(telOpstelling(null, opstelling(VOL)).compleet).toBe(false)
  })

  it('positions null of geen array → onbekend, geen throw', () => {
    expect(telOpstelling(FORMATIE, null)).toEqual({ totaal: null, leeg: null, compleet: false })
    expect(telOpstelling(FORMATIE, undefined).compleet).toBe(false)
    expect(telOpstelling(FORMATIE, { 0: { player_id: VOL[0] } }).compleet).toBe(false)
    expect(telOpstelling(FORMATIE, 'kapot').leeg).toBeNull()
  })

  it('kapotte elementen in de array (null, getal) tellen als leeg, geen throw', () => {
    const posities: unknown[] = opstelling(VOL)
    posities[0] = null
    posities[1] = 42
    const r = telOpstelling(FORMATIE, posities)
    expect(r.leeg).toBe(2)
    expect(r.compleet).toBe(false)
  })

  it('minder posities dan de formatie → niet compleet, ontbrekende posities tellen als leeg', () => {
    const r = telOpstelling(FORMATIE, opstelling(VOL).slice(0, SLOTS.length - 2))
    expect(r).toEqual({ totaal: SLOTS.length, leeg: 2, compleet: false })
  })

  it('meer posities dan de formatie → niet compleet; alleen de eerste totaal tellen', () => {
    const extra = [...opstelling(VOL), { ...SLOTS[0], player_id: uuid(99) as string | null }]
    const r = telOpstelling(FORMATIE, extra)
    expect(r.compleet).toBe(false)
    expect(r.leeg).toBe(0)
  })

  it('werkt voor elke formatie in FORMATIONS met haar eigen totaal', () => {
    for (const [sleutel, f] of Object.entries(FORMATIONS)) {
      const posities = f.positions.map((slot, i) => ({ ...slot, player_id: uuid(i + 1) }))
      expect(telOpstelling(sleutel, posities)).toEqual({ totaal: f.positions.length, leeg: 0, compleet: true })
    }
  })
})
