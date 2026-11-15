import { describe, it, expect } from 'vitest'
import { maakTrainingsvoorstel, type VoorstelInput } from '@/lib/trainingsvoorstel'
import { berekenDuurUitStap } from '@/lib/periodization-stappen'
import type { Oefening, OefeningCategorie, OefeningTeam } from '@/lib/types'

// Minimale, complete Oefening-fixture (zelfde vorm als lib/oefening-filter.test.ts).
function oef(over: Partial<Oefening> & { id: string; categorie: OefeningCategorie }): Oefening {
  return {
    id: over.id,
    team_id: over.team_id ?? 'user-1',
    naam: over.naam ?? over.id,
    beschrijving: null,
    categorie: over.categorie,
    duur_min: over.duur_min ?? null,
    breedte_m: null,
    lengte_m: null,
    orientatie: 'vrij',
    veldzone: null,
    teams: over.teams ?? [],
    aantal_neutralen: over.aantal_neutralen ?? 0,
    aantal_neutralen_max: over.aantal_neutralen_max ?? null,
    diagram: null,
    created_at: '2026-01-01T00:00:00Z',
  }
}

const team = (grootte: number, grootteMax: number | null = null): OefeningTeam => ({
  grootte, formaties: [], grootteMax,
})

const geenStappen: Record<string, number | null> = {}

// Eén oefening per categorie die in een cyclusweek aan de beurt kan zijn.
const volledigeBibliotheek: Oefening[] = [
  oef({ id: 'g', naam: 'Groot', categorie: 'partijen_groot', duur_min: 30 }),
  oef({ id: 'm', naam: 'Midden', categorie: 'partijen_midden', duur_min: 25 }),
  oef({ id: 'k', naam: 'Klein', categorie: 'partijen_klein', duur_min: 20 }),
  oef({ id: 'swr', naam: 'Sprint WR', categorie: 'sprints_weinig_rust', duur_min: 15 }),
  oef({ id: 'svr', naam: 'Sprint VR', categorie: 'sprints_veel_rust', duur_min: 15 }),
  oef({ id: 'st', naam: 'Steigerungs', categorie: 'steigerungs', duur_min: 10 }),
  oef({ id: 'wu', naam: 'Warming-up', categorie: 'warming_up', duur_min: 15 }),
  oef({ id: 'ps', naam: 'Positiespel', categorie: 'positiespel', duur_min: 15 }),
]

function voorstel(over: Partial<VoorstelInput>) {
  return maakTrainingsvoorstel({
    cycleWeek: 1,
    currentSteps: geenStappen,
    library: volledigeBibliotheek,
    aanwezigen: 0,
    ...over,
  })
}

function blokken(over: Partial<VoorstelInput>) {
  const u = voorstel(over)
  if (!u.ok) throw new Error(`verwacht ok, kreeg ${u.error}`)
  return u
}

describe('maakTrainingsvoorstel — categorieën per cyclusweek', () => {
  it.each([
    [1, ['partijen_groot', 'steigerungs']],
    [2, ['partijen_groot', 'steigerungs']],
    [3, ['partijen_midden', 'sprints_weinig_rust']],
    [4, ['partijen_midden', 'sprints_weinig_rust']],
    [5, ['partijen_klein', 'sprints_veel_rust']],
    [6, ['partijen_klein', 'sprints_veel_rust']],
  ])('week %i stelt precies de geplande categorieën voor, in PERIODIZATION_CATEGORIES-volgorde', (week, verwacht) => {
    const u = blokken({ cycleWeek: week })
    expect(u.blokken.map((b) => b.categorie)).toEqual(verwacht)
    expect(u.overgeslagen).toEqual([])
  })

  it('stelt nooit warming-up, positiespel of andere ongeplande categorieën voor', () => {
    for (const week of [1, 2, 3, 4, 5, 6]) {
      const ids = blokken({ cycleWeek: week }).blokken.map((b) => b.oefeningId)
      expect(ids).not.toContain('wu')
      expect(ids).not.toContain('ps')
    }
  })
})

describe('maakTrainingsvoorstel — stap en duur', () => {
  it('slaat nooit een stap_override op (besluit V-A)', () => {
    const u = blokken({ cycleWeek: 1, currentSteps: { partijen_groot: 3, steigerungs: null } })
    for (const b of u.blokken) expect(b.stapOverride).toBeNull()
  })

  it('rekent de duur van een partijvorm uit de actuele stap', () => {
    const u = blokken({ cycleWeek: 1, currentSteps: { partijen_groot: 3 } })
    const groot = u.blokken.find((b) => b.categorie === 'partijen_groot')!
    expect(groot.stap).toBe(3)
    expect(groot.duurMin).toBe(berekenDuurUitStap('partijen_groot', 3))
    expect(groot.duurMin).not.toBe(30) // niet de bibliotheekduur
  })

  it('clampt een berekende stap boven het maximum naar maxStap', () => {
    // partijen_midden maxStap = 15; computeCurrentSteps clampt bewust niet.
    const u = blokken({ cycleWeek: 3, currentSteps: { partijen_midden: 40 } })
    const midden = u.blokken.find((b) => b.categorie === 'partijen_midden')!
    expect(midden.stap).toBe(15)
    expect(midden.duurMin).toBe(berekenDuurUitStap('partijen_midden', 15))
  })

  it('clampt een stap onder 1 naar 1', () => {
    const u = blokken({ cycleWeek: 1, currentSteps: { partijen_groot: 0 } })
    expect(u.blokken[0].stap).toBe(1)
    expect(u.blokken[0].duurMin).toBe(berekenDuurUitStap('partijen_groot', 1))
  })

  it('valt zonder stap terug op de bibliotheekduur', () => {
    const u = blokken({ cycleWeek: 1, currentSteps: geenStappen })
    expect(u.blokken.find((b) => b.categorie === 'partijen_groot')!.duurMin).toBe(30)
  })

  it('steigerungs heeft geen stap en dus de bibliotheekduur', () => {
    const u = blokken({ cycleWeek: 1, currentSteps: { partijen_groot: 2 } })
    const st = u.blokken.find((b) => b.categorie === 'steigerungs')!
    expect(st.stap).toBeNull()
    expect(st.duurMin).toBe(10)
  })

  it('sprints rekenen niet uit de stap (geen minutentabel) maar nemen de bibliotheekduur', () => {
    const u = blokken({ cycleWeek: 3, currentSteps: { partijen_midden: 2, sprints_weinig_rust: 4 } })
    const sprint = u.blokken.find((b) => b.categorie === 'sprints_weinig_rust')!
    expect(sprint.stap).toBe(4)
    expect(sprint.duurMin).toBe(15)
  })
})

describe('maakTrainingsvoorstel — keuze binnen een categorie', () => {
  it('kiest alfabetisch op naam, dan op id', () => {
    const library = [
      oef({ id: 'z', naam: 'Bravo', categorie: 'partijen_groot' }),
      oef({ id: 'b', naam: 'Alfa', categorie: 'partijen_groot' }),
      oef({ id: 'a', naam: 'Alfa', categorie: 'partijen_groot' }),
    ]
    expect(blokken({ library }).blokken[0].oefeningId).toBe('a')
  })

  it('is deterministisch: een andere arrayvolgorde geeft hetzelfde voorstel', () => {
    const library = [
      oef({ id: 'g2', naam: 'Partij B', categorie: 'partijen_groot', teams: [team(5), team(5)] }),
      oef({ id: 'g1', naam: 'Partij A', categorie: 'partijen_groot', teams: [team(4, 8), team(4, 8)] }),
      oef({ id: 'g3', naam: 'Partij C', categorie: 'partijen_groot', teams: [team(6), team(6)] }),
      oef({ id: 's1', naam: 'Steig', categorie: 'steigerungs' }),
    ]
    const a = voorstel({ library, aanwezigen: 12 })
    const b = voorstel({ library: [...library].reverse(), aanwezigen: 12 })
    const c = voorstel({ library: [library[2], library[0], library[3], library[1]], aanwezigen: 12 })
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('geeft voorkeur aan een oefening die het aantal aanwezigen bevat', () => {
    const library = [
      oef({ id: 'a', naam: 'A 5 tegen 5', categorie: 'partijen_groot', teams: [team(5), team(5)] }),
      oef({ id: 'b', naam: 'B 7 tegen 7', categorie: 'partijen_groot', teams: [team(7), team(7)] }),
    ]
    expect(blokken({ library, aanwezigen: 14 }).blokken[0].oefeningId).toBe('b')
    expect(blokken({ library, aanwezigen: 10 }).blokken[0].oefeningId).toBe('a')
  })

  it('aanwezigen is een voorkeur, geen eis: zonder passende oefening wordt toch gekozen', () => {
    const library = [oef({ id: 'a', naam: 'A', categorie: 'partijen_groot', teams: [team(5), team(5)] })]
    expect(blokken({ library, aanwezigen: 3 }).blokken[0].oefeningId).toBe('a')
  })

  it('bij 0 aanwezigen geldt geen voorkeur op speleraantal', () => {
    const library = [
      oef({ id: 'a', naam: 'A', categorie: 'partijen_groot', teams: [team(5), team(5)] }),
      oef({ id: 'b', naam: 'B', categorie: 'partijen_groot', teams: [team(0), team(0)] }),
    ]
    // Met 0 als filter zou alleen B (0 spelers) passen; zonder voorkeur wint A.
    expect(blokken({ library, aanwezigen: 0 }).blokken[0].oefeningId).toBe('a')
  })

  it('kiest een exacte oefening vóór een flexibele, ook als de flexibele alfabetisch eerder komt', () => {
    const library = [
      oef({ id: 'flex', naam: 'A flexibel', categorie: 'partijen_groot', teams: [team(4, 8), team(4, 8)] }),
      oef({ id: 'exact', naam: 'B exact', categorie: 'partijen_groot', teams: [team(6), team(6)] }),
    ]
    expect(blokken({ library, aanwezigen: 12 }).blokken[0].oefeningId).toBe('exact')
    expect(blokken({ library, aanwezigen: 0 }).blokken[0].oefeningId).toBe('exact')
  })

  it('een passende flexibele oefening wint van een niet-passende exacte', () => {
    const library = [
      oef({ id: 'exact', naam: 'A exact', categorie: 'partijen_groot', teams: [team(3), team(3)] }),
      oef({ id: 'flex', naam: 'B flexibel', categorie: 'partijen_groot', teams: [team(4, 8), team(4, 8)] }),
    ]
    expect(blokken({ library, aanwezigen: 12 }).blokken[0].oefeningId).toBe('flex')
  })

  it('muteert de invoer niet', () => {
    const library = [
      oef({ id: 'b', naam: 'B', categorie: 'partijen_groot', teams: [team(5), team(5)] }),
      oef({ id: 'a', naam: 'A', categorie: 'partijen_groot', teams: [team(4, 8), team(4, 8)] }),
      oef({ id: 's', naam: 'S', categorie: 'steigerungs' }),
    ]
    const currentSteps = { partijen_groot: 50, steigerungs: null }
    const snapshot = JSON.parse(JSON.stringify({ library, currentSteps }))
    voorstel({ library, currentSteps, aanwezigen: 10 })
    expect({ library, currentSteps }).toEqual(snapshot)
    expect(library.map((o) => o.id)).toEqual(['b', 'a', 's'])
  })

  it('stelt dezelfde oefening nooit twee keer voor', () => {
    for (const week of [1, 2, 3, 4, 5, 6]) {
      const ids = blokken({ cycleWeek: week }).blokken.map((b) => b.oefeningId)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('maakTrainingsvoorstel — budget en lege uitkomsten', () => {
  it('lege bibliotheek → lege_bibliotheek', () => {
    expect(voorstel({ library: [] })).toEqual({ ok: false, error: 'lege_bibliotheek' })
  })

  it('geen enkele geplande categorie in de bibliotheek → niets_passend', () => {
    const library = [oef({ id: 'wu', categorie: 'warming_up', duur_min: 10 })]
    expect(voorstel({ library })).toEqual({ ok: false, error: 'niets_passend' })
  })

  it('een categorie zonder kandidaten komt in overgeslagen', () => {
    const library = [oef({ id: 'g', categorie: 'partijen_groot', duur_min: 30 })]
    const u = blokken({ library, cycleWeek: 1 })
    expect(u.blokken.map((b) => b.categorie)).toEqual(['partijen_groot'])
    expect(u.overgeslagen).toEqual(['steigerungs'])
  })

  it('duur null of 0 telt als 0 in het budget en sluit de oefening niet uit', () => {
    const library = [
      oef({ id: 'g', categorie: 'partijen_groot', duur_min: null }),
      oef({ id: 's', categorie: 'steigerungs', duur_min: 0 }),
    ]
    const u = blokken({ library, maxDuurMin: 0 })
    expect(u.blokken.map((b) => [b.oefeningId, b.duurMin])).toEqual([['g', null], ['s', 0]])
  })

  it('kiest een kortere oefening als de eerste niet meer in het budget past', () => {
    const library = [
      oef({ id: 'g', categorie: 'partijen_groot', duur_min: 80 }),
      oef({ id: 's1', naam: 'A lang', categorie: 'steigerungs', duur_min: 20 }),
      oef({ id: 's2', naam: 'B kort', categorie: 'steigerungs', duur_min: 10 }),
    ]
    const u = blokken({ library })
    expect(u.blokken.map((b) => b.oefeningId)).toEqual(['g', 's2'])
    const totaal = u.blokken.reduce((som, b) => som + (b.duurMin ?? 0), 0)
    expect(totaal).toBeLessThanOrEqual(90)
  })

  it('slaat een categorie over als niets meer in het budget past', () => {
    const library = [
      oef({ id: 'g', categorie: 'partijen_groot', duur_min: 85 }),
      oef({ id: 's', categorie: 'steigerungs', duur_min: 10 }),
    ]
    const u = blokken({ library })
    expect(u.blokken.map((b) => b.oefeningId)).toEqual(['g'])
    expect(u.overgeslagen).toEqual(['steigerungs'])
  })

  it('een uit de stap berekende duur boven 90 wordt overgeslagen', () => {
    // partijen_groot stap 21 = 15 × 6 + 2 × 5 = 100 minuten.
    expect(berekenDuurUitStap('partijen_groot', 21)).toBeGreaterThan(90)
    const library = [
      oef({ id: 'g', categorie: 'partijen_groot', duur_min: 10 }),
      oef({ id: 's', categorie: 'steigerungs', duur_min: 10 }),
    ]
    const u = blokken({ library, currentSteps: { partijen_groot: 21 } })
    expect(u.blokken.map((b) => b.oefeningId)).toEqual(['s'])
    expect(u.overgeslagen).toEqual(['partijen_groot'])
  })

  it('alles over budget → niets_passend', () => {
    const library = [
      oef({ id: 'g', categorie: 'partijen_groot', duur_min: 120 }),
      oef({ id: 's', categorie: 'steigerungs', duur_min: 95 }),
    ]
    expect(voorstel({ library })).toEqual({ ok: false, error: 'niets_passend' })
  })

  it('een exact passende som (= 90) is toegestaan', () => {
    const library = [
      oef({ id: 'g', categorie: 'partijen_groot', duur_min: 60 }),
      oef({ id: 's', categorie: 'steigerungs', duur_min: 30 }),
    ]
    expect(blokken({ library }).blokken).toHaveLength(2)
  })

  it('ongeldige cyclusweek (geen geplande categorieën) → niets_passend', () => {
    expect(voorstel({ cycleWeek: 7 })).toEqual({ ok: false, error: 'niets_passend' })
  })
})
