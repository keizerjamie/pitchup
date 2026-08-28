import { describe, it, expect } from 'vitest'
import { kopieerKoppelingen, type BronKoppeling } from '@/lib/kopieer-trainingsplan'

// Deterministische id-generator, zodat de remapping toetsbaar is.
function idFabriek() {
  let n = 0
  return () => `nieuw-${++n}`
}

describe('kopieerKoppelingen', () => {
  it('neemt oefening, volgorde en handmatige stap over', () => {
    const bron: BronKoppeling[] = [
      { oefening_id: 'o1', volgorde: 0, stap_override: null },
      { oefening_id: 'o2', volgorde: 1, stap_override: 3 },
    ]
    expect(kopieerKoppelingen(bron, 0, idFabriek())).toEqual([
      { oefening_id: 'o1', volgorde: 0, stap_override: null, parallel_groep_id: null },
      { oefening_id: 'o2', volgorde: 1, stap_override: 3, parallel_groep_id: null },
    ])
  })

  it('schuift alles achter wat er al staat, zodat bestaande oefeningen blijven', () => {
    const bron: BronKoppeling[] = [
      { oefening_id: 'o1', volgorde: 0, stap_override: null },
      { oefening_id: 'o2', volgorde: 1, stap_override: null },
    ]
    expect(kopieerKoppelingen(bron, 5, idFabriek()).map((r) => r.volgorde)).toEqual([5, 6])
  })

  it('deelt nieuwe groep-id\'s uit, maar houdt leden van dezelfde groep bij elkaar', () => {
    const bron: BronKoppeling[] = [
      { oefening_id: 'o1', volgorde: 0, stap_override: null, parallel_groep_id: null },
      { oefening_id: 'o2', volgorde: 1, stap_override: null, parallel_groep_id: 'bron-a' },
      { oefening_id: 'o3', volgorde: 1, stap_override: null, parallel_groep_id: 'bron-a' },
      { oefening_id: 'o4', volgorde: 2, stap_override: null, parallel_groep_id: 'bron-b' },
      { oefening_id: 'o5', volgorde: 2, stap_override: null, parallel_groep_id: 'bron-b' },
    ]
    const uit = kopieerKoppelingen(bron, 0, idFabriek())
    expect(uit[0].parallel_groep_id).toBeNull()
    // Twee leden van dezelfde bron-groep krijgen hetzelfde nieuwe id...
    expect(uit[1].parallel_groep_id).toBe('nieuw-1')
    expect(uit[2].parallel_groep_id).toBe('nieuw-1')
    // ...en een tweede groep een ander id.
    expect(uit[3].parallel_groep_id).toBe('nieuw-2')
    expect(uit[4].parallel_groep_id).toBe('nieuw-2')
    // Geen enkel id uit de bron komt mee.
    expect(uit.some((r) => r.parallel_groep_id?.startsWith('bron-'))).toBe(false)
  })

  it('parallelle leden houden hun gedeelde volgorde', () => {
    const bron: BronKoppeling[] = [
      { oefening_id: 'o1', volgorde: 3, stap_override: null, parallel_groep_id: 'g' },
      { oefening_id: 'o2', volgorde: 3, stap_override: null, parallel_groep_id: 'g' },
    ]
    const uit = kopieerKoppelingen(bron, 2, idFabriek())
    expect(uit.map((r) => r.volgorde)).toEqual([5, 5])
  })

  it('gaten in de bron-volgorde blijven staan (niet stilzwijgend hernummeren)', () => {
    const bron: BronKoppeling[] = [
      { oefening_id: 'o1', volgorde: 0, stap_override: null },
      { oefening_id: 'o2', volgorde: 4, stap_override: null },
    ]
    expect(kopieerKoppelingen(bron, 0, idFabriek()).map((r) => r.volgorde)).toEqual([0, 4])
  })

  it('kopieert nooit spelerindeling of parallel_spelers — die horen bij de spelers van díé training', () => {
    const bron = [
      { oefening_id: 'o1', volgorde: 0, stap_override: null, spelerindeling: [['p1']], parallel_spelers: ['p2'] },
    ] as unknown as BronKoppeling[]
    const uit = kopieerKoppelingen(bron, 0, idFabriek())
    expect(Object.keys(uit[0]).sort()).toEqual(['oefening_id', 'parallel_groep_id', 'stap_override', 'volgorde'])
  })

  it('kopieert nooit aantallen_override — de kopie start op de basisvorm', () => {
    // Zelfde regel als spelerindeling: de bezetting hoort bij de opkomst van
    // díé training. De allowlist zorgt ervoor zonder aparte uitsluitingslogica.
    const bron = [
      {
        oefening_id: 'o1',
        volgorde: 0,
        stap_override: null,
        aantallen_override: { teams: [6, null], neutralen: 2 },
      },
    ] as unknown as BronKoppeling[]
    const uit = kopieerKoppelingen(bron, 0, idFabriek())
    expect(uit[0]).not.toHaveProperty('aantallen_override')
    expect(Object.keys(uit[0]).sort()).toEqual([
      'oefening_id',
      'parallel_groep_id',
      'stap_override',
      'volgorde',
    ])
  })

  it('lege bron levert een lege lijst op, geen crash', () => {
    expect(kopieerKoppelingen([], 0, idFabriek())).toEqual([])
  })
})
