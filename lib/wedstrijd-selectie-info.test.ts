import { describe, it, expect } from 'vitest'
import {
  RECENTE_WEDSTRIJDEN,
  bouwRecenteMinuten,
  groepeerSelectie,
  selectieGroepVan,
} from '@/lib/wedstrijd-selectie-info'
import type { AttendanceStatus } from '@/lib/types'

const W = [
  { id: 'w3', date: '2026-11-09' },
  { id: 'w2', date: '2026-11-02' },
  { id: 'w1', date: '2026-10-26' },
]

describe('bouwRecenteMinuten', () => {
  it('behoudt de volgorde nieuwste eerst; elke speler krijgt een rij van gelijke lengte', () => {
    const r = bouwRecenteMinuten(W, [
      { event_id: 'w1', player_id: 'a', minuten: 10 },
      { event_id: 'w3', player_id: 'a', minuten: 90 },
    ], ['a', 'b'])
    expect(r.wedstrijden).toEqual(W)
    expect(r.perSpeler).toEqual({ a: [90, null, 10], b: [null, null, null] })
  })

  it('0 blijft 0, een ontbrekende rij is null ("–")', () => {
    const r = bouwRecenteMinuten(W, [{ event_id: 'w2', player_id: 'a', minuten: 0 }], ['a'])
    expect(r.perSpeler.a).toEqual([null, 0, null])
  })

  it('negeert rijen van een vreemde event_id (tenant/spookrij) en van onbekende spelers', () => {
    const r = bouwRecenteMinuten(W, [
      { event_id: 'ander-team', player_id: 'a', minuten: 45 },
      { event_id: 'w3', player_id: 'vreemd', minuten: 45 },
    ], ['a'])
    expect(r.perSpeler).toEqual({ a: [null, null, null] })
  })

  it('negeert ongeldige minuten: negatief, >130, niet geheel, string, null', () => {
    const r = bouwRecenteMinuten(W, [
      { event_id: 'w3', player_id: 'a', minuten: -1 },
      { event_id: 'w3', player_id: 'b', minuten: 131 },
      { event_id: 'w3', player_id: 'c', minuten: 12.5 },
      { event_id: 'w3', player_id: 'd', minuten: '30' },
      { event_id: 'w3', player_id: 'e', minuten: null },
      { event_id: 'w3', player_id: 'f', minuten: 130 },
    ], ['a', 'b', 'c', 'd', 'e', 'f'])
    expect(r.perSpeler.a[0]).toBeNull()
    expect(r.perSpeler.b[0]).toBeNull()
    expect(r.perSpeler.c[0]).toBeNull()
    expect(r.perSpeler.d[0]).toBeNull()
    expect(r.perSpeler.e[0]).toBeNull()
    expect(r.perSpeler.f[0]).toBe(130)
  })

  it('zonder wedstrijden: lege lijst en lege rijen per speler', () => {
    const r = bouwRecenteMinuten([], [{ event_id: 'w3', player_id: 'a', minuten: 50 }], ['a'])
    expect(r).toEqual({ wedstrijden: [], perSpeler: { a: [] } })
  })

  it('kapt af op RECENTE_WEDSTRIJDEN', () => {
    const vier = [...W, { id: 'w0', date: '2026-10-19' }]
    const r = bouwRecenteMinuten(vier, [{ event_id: 'w0', player_id: 'a', minuten: 5 }], ['a'])
    expect(r.wedstrijden).toHaveLength(RECENTE_WEDSTRIJDEN)
    expect(r.perSpeler.a).toEqual([null, null, null])
  })

  it('gooit niet bij kapotte rijen', () => {
    const rijen = [null, 3, { event_id: 5, player_id: 'a', minuten: 1 }] as unknown as Parameters<typeof bouwRecenteMinuten>[1]
    expect(() => bouwRecenteMinuten(W, rijen, ['a'])).not.toThrow()
  })
})

describe('selectieGroepVan', () => {
  it('present → aanwezig, unknown → geenReactie, absent/injured → afwezig', () => {
    expect(selectieGroepVan({ active: true }, 'present')).toBe('aanwezig')
    expect(selectieGroepVan({ active: true }, 'unknown')).toBe('geenReactie')
    expect(selectieGroepVan({ active: true }, 'absent')).toBe('afwezig')
    expect(selectieGroepVan({ active: true }, 'injured')).toBe('afwezig')
  })

  it('inactief gaat vóór de status: altijd afwezig', () => {
    expect(selectieGroepVan({ active: false }, 'present')).toBe('afwezig')
    expect(selectieGroepVan({ active: false }, 'unknown')).toBe('afwezig')
  })
})

describe('groepeerSelectie', () => {
  const spelers = [
    { id: 'a', active: true },
    { id: 'b', active: true },
    { id: 'c', active: false },
    { id: 'd', active: true },
    { id: 'e', active: true },
    { id: 'f', active: true },
  ]
  const status: Record<string, AttendanceStatus> = { a: 'present', b: 'injured', c: 'present', d: 'unknown', f: 'present' }

  it('verdeelt over drie groepen en behoudt de invoervolgorde', () => {
    const g = groepeerSelectie(spelers, (s) => status[s.id] ?? 'unknown')
    expect(g.aanwezig.map((s) => s.id)).toEqual(['a', 'f'])
    expect(g.geenReactie.map((s) => s.id)).toEqual(['d', 'e'])
    expect(g.afwezig.map((s) => s.id)).toEqual(['b', 'c'])
  })

  it('muteert de invoer niet', () => {
    const kopie = spelers.map((s) => ({ ...s }))
    groepeerSelectie(spelers, (s) => status[s.id] ?? 'unknown')
    expect(spelers).toEqual(kopie)
  })
})
