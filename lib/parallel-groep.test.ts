import { describe, it, expect } from 'vitest'
import {
  blokkenVanKoppelingen,
  subLetter,
  blokLabel,
  benodigdAantal,
  validateParallelSpelers,
  assertGeenOverlap,
  groepStatus,
} from '@/lib/parallel-groep'
import type { Oefening, TrainingOefeningWithData } from '@/lib/types'

// player_id's zijn UUID's: validateParallelSpelers keurt alles af wat die vorm
// niet heeft, dus de fixtures gebruiken echte UUID-strings.
const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const P3 = '33333333-3333-4333-8333-333333333333'
const P4 = '44444444-4444-4444-8444-444444444444'
const VREEMD = '99999999-9999-4999-8999-999999999999'

function makeOefening(over: Partial<Oefening> = {}): Oefening {
  return {
    id: 'o1',
    team_id: 'team-1',
    naam: 'Positiespel',
    beschrijving: null,
    categorie: 'positiespel',
    duur_min: 10,
    breedte_m: null,
    lengte_m: null,
    orientatie: 'vrij',
    veldzone: null,
    teams: [],
    aantal_neutralen: 0,
    diagram: null,
    created_at: '2024-01-01T00:00:00Z',
    ...over,
  }
}

function makeKoppeling(
  over: Partial<TrainingOefeningWithData> & { oefening?: Partial<Oefening> } = {},
): TrainingOefeningWithData {
  const { oefening, ...rest } = over
  return {
    id: 'k1',
    team_id: 'team-1',
    event_id: 'e1',
    oefening_id: 'o1',
    volgorde: 0,
    stap_override: null,
    genest_in: null,
    spelerindeling: [],
    parallel_groep_id: null,
    parallel_spelers: [],
    created_at: '2024-01-01T00:00:00Z',
    oefeningen: makeOefening(oefening),
    ...rest,
  }
}

// ────────────────────────────────────────────────
// blokkenVanKoppelingen
// ────────────────────────────────────────────────
describe('blokkenVanKoppelingen', () => {
  it('groepeert rijen met dezelfde parallel_groep_id tot één blok', () => {
    const blokken = blokkenVanKoppelingen([
      makeKoppeling({ id: 'k1', volgorde: 0 }),
      makeKoppeling({ id: 'k2', volgorde: 1, parallel_groep_id: 'g1', created_at: '2024-01-02T00:00:00Z' }),
      makeKoppeling({ id: 'k3', volgorde: 1, parallel_groep_id: 'g1', created_at: '2024-01-03T00:00:00Z' }),
      makeKoppeling({ id: 'k4', volgorde: 2 }),
    ])

    expect(blokken.map((b) => b.leden.map((l) => l.id))).toEqual([['k1'], ['k2', 'k3'], ['k4']])
    expect(blokken[1].groepId).toBe('g1')
    expect(blokken[1].key).toBe('g:g1')
    expect(blokken[0].groepId).toBeNull()
  })

  it('zet de leden van een blok op created_at, dan id', () => {
    const blokken = blokkenVanKoppelingen([
      makeKoppeling({ id: 'kb', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-05T00:00:00Z' }),
      makeKoppeling({ id: 'ka', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-02T00:00:00Z' }),
      makeKoppeling({ id: 'kc', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-02T00:00:00Z' }),
    ])
    expect(blokken[0].leden.map((l) => l.id)).toEqual(['ka', 'kc', 'kb'])
  })

  it('rendert een groep met één overgebleven lid als gewoon blok (cascade-weeskind)', () => {
    // Wordt de bibliotheek-oefening van het andere lid hard verwijderd, dan
    // verdwijnt die koppelrij via FK CASCADE zonder groepsopruiming.
    const blokken = blokkenVanKoppelingen([
      makeKoppeling({ id: 'k1', volgorde: 0, parallel_groep_id: 'g1' }),
    ])
    expect(blokken).toHaveLength(1)
    expect(blokken[0].groepId).toBeNull()
    expect(blokken[0].key).toBe('k:k1')
  })

  it('houdt de blokken op volgorde, ongeacht de aanlevervolgorde', () => {
    const blokken = blokkenVanKoppelingen([
      makeKoppeling({ id: 'k3', volgorde: 2 }),
      makeKoppeling({ id: 'k1', volgorde: 0 }),
      makeKoppeling({ id: 'k2', volgorde: 1 }),
    ])
    expect(blokken.map((b) => b.leden[0].id)).toEqual(['k1', 'k2', 'k3'])
  })

  it('geeft een lege lijst bij geen koppelingen', () => {
    expect(blokkenVanKoppelingen([])).toEqual([])
  })

  it('behoudt afgeleide velden die de leesgrens toevoegt (generiek ledentype)', () => {
    // De trainingsplan-pagina hangt per koppeling een `bezetting` aan. Zou
    // blokkenVanKoppelingen dat wegtypen, dan viel de effectieve bezetting
    // stilzwijgend uit de parallelle-groep-weergave.
    const bezetting = { teams: [{ grootte: 3, formaties: [] }], aantal_neutralen: 0, aangepast: true }
    const blokken = blokkenVanKoppelingen([{ ...makeKoppeling({ id: 'k1' }), bezetting }])
    // Typetest: `.bezetting` moet zonder cast bereikbaar zijn op het lid.
    expect(blokken[0].leden[0].bezetting).toBe(bezetting)
  })
})

// ────────────────────────────────────────────────
// subLetter / blokLabel
// ────────────────────────────────────────────────
describe('subLetter', () => {
  it('telt a..z', () => {
    expect(subLetter(0)).toBe('a')
    expect(subLetter(1)).toBe('b')
    expect(subLetter(25)).toBe('z')
  })

  it('gaat na z door met aa, ab, …', () => {
    expect(subLetter(26)).toBe('aa')
    expect(subLetter(27)).toBe('ab')
  })

  it('valt terug op "a" bij onzin-input', () => {
    expect(subLetter(-1)).toBe('a')
    expect(subLetter(Number.NaN)).toBe('a')
  })
})

describe('blokLabel', () => {
  it('geeft een enkel blok alleen het nummer', () => {
    expect(blokLabel(2, 1, 0)).toBe('3')
  })

  it('geeft de leden van een groep een sub-letter', () => {
    expect(blokLabel(2, 3, 0)).toBe('3a')
    expect(blokLabel(2, 3, 1)).toBe('3b')
    expect(blokLabel(2, 3, 2)).toBe('3c')
  })
})

// ────────────────────────────────────────────────
// benodigdAantal
// ────────────────────────────────────────────────
describe('benodigdAantal', () => {
  it('telt teamgroottes en neutralen op', () => {
    expect(benodigdAantal({
      teams: [{ grootte: 5, formaties: [] }, { grootte: 5, formaties: [] }],
      aantal_neutralen: 2,
    })).toBe(12)
  })

  it('telt zonder neutralen gewoon de teams', () => {
    expect(benodigdAantal({ teams: [{ grootte: 4, formaties: [] }], aantal_neutralen: 0 })).toBe(4)
  })

  it('geeft null bij een oefening zonder teams', () => {
    expect(benodigdAantal({ teams: [], aantal_neutralen: 3 })).toBeNull()
  })

  it('geeft null bij een team zonder geldige grootte', () => {
    expect(benodigdAantal({ teams: [{ grootte: 5, formaties: [] }, { grootte: 0, formaties: [] }] })).toBeNull()
    expect(benodigdAantal({ teams: [{ grootte: Number.NaN, formaties: [] }] })).toBeNull()
  })

  it('geeft null zonder oefening', () => {
    expect(benodigdAantal(null)).toBeNull()
    expect(benodigdAantal(undefined)).toBeNull()
  })
})

// ────────────────────────────────────────────────
// validateParallelSpelers
// ────────────────────────────────────────────────
describe('validateParallelSpelers', () => {
  const own = new Set([P1, P2, P3, P4])

  it('normaliseert een geldige lijst', () => {
    expect(validateParallelSpelers([P1, P2], { ownPlayerIds: own })).toEqual([P1, P2])
  })

  it('staat een lege lijst toe', () => {
    expect(validateParallelSpelers([], { ownPlayerIds: own })).toEqual([])
  })

  it('gooit "Ongeldige indeling" als de input geen array is', () => {
    expect(() => validateParallelSpelers('nope', { ownPlayerIds: own })).toThrow('Ongeldige indeling')
    expect(() => validateParallelSpelers([[P1]], { ownPlayerIds: own })).toThrow('Ongeldige indeling')
  })

  it('gooit "Ongeldige indeling" bij een niet-string of niet-UUID', () => {
    expect(() => validateParallelSpelers([1], { ownPlayerIds: own })).toThrow('Ongeldige indeling')
    expect(() => validateParallelSpelers(['p1'], { ownPlayerIds: own })).toThrow('Ongeldige indeling')
  })

  it('gooit "Speler niet gevonden" bij een player_id buiten de tenant', () => {
    expect(() => validateParallelSpelers([P1, VREEMD], { ownPlayerIds: own }))
      .toThrow('Speler niet gevonden')
  })

  it('gooit "Speler in meerdere oefeningen" bij een duplicaat binnen de rij', () => {
    expect(() => validateParallelSpelers([P1, P1], { ownPlayerIds: own }))
      .toThrow('Speler in meerdere oefeningen')
  })
})

// ────────────────────────────────────────────────
// assertGeenOverlap
// ────────────────────────────────────────────────
describe('assertGeenOverlap', () => {
  it('laat een verdeling zonder overlap door', () => {
    expect(() => assertGeenOverlap([P1, P2], [[P3], [P4]])).not.toThrow()
  })

  it('gooit bij overlap met een ander lid van de groep', () => {
    expect(() => assertGeenOverlap([P1, P2], [[P3], [P2]]))
      .toThrow('Speler in meerdere oefeningen')
  })

  it('negeert leden zonder (geldige) indeling', () => {
    expect(() => assertGeenOverlap([P1], [null, undefined])).not.toThrow()
  })
})

// ────────────────────────────────────────────────
// groepStatus
// ────────────────────────────────────────────────
describe('groepStatus', () => {
  const oefening4 = { teams: [{ grootte: 2, formaties: [] }, { grootte: 2, formaties: [] }] }

  it('meldt een sluitende verdeling als compleet', () => {
    const status = groepStatus({
      leden: [
        { id: 'k1', parallel_spelers: [P1, P2], oefeningen: { teams: [{ grootte: 2, formaties: [] }] } },
        { id: 'k2', parallel_spelers: [P3, P4], oefeningen: { teams: [{ grootte: 2, formaties: [] }] } },
      ],
      presentPlayerIds: [P1, P2, P3, P4],
    })
    expect(status.compleet).toBe(true)
    expect(status.nietIngedeeld).toEqual([])
    expect(status.perLid).toEqual([
      { koppelingId: 'k1', toegewezen: 2, benodigd: 2, tekort: 0, overschot: 0 },
      { koppelingId: 'k2', toegewezen: 2, benodigd: 2, tekort: 0, overschot: 0 },
    ])
  })

  it('meldt de aanwezige spelers die nergens staan', () => {
    const status = groepStatus({
      leden: [
        { id: 'k1', parallel_spelers: [P1], oefeningen: oefening4 },
        { id: 'k2', parallel_spelers: [], oefeningen: oefening4 },
      ],
      presentPlayerIds: [P1, P2, P3],
    })
    expect(status.nietIngedeeld).toEqual([P2, P3])
    expect(status.compleet).toBe(false)
    expect(status.perLid[0]).toEqual({ koppelingId: 'k1', toegewezen: 1, benodigd: 4, tekort: 3, overschot: 0 })
  })

  it('rekent overschot uit en meldt ingedeelde afwezigen', () => {
    const status = groepStatus({
      leden: [
        { id: 'k1', parallel_spelers: [P1, P2, P3], oefeningen: { teams: [{ grootte: 2, formaties: [] }] } },
      ],
      presentPlayerIds: [P1, P2],
    })
    expect(status.perLid[0].overschot).toBe(1)
    expect(status.afwezigIngedeeld).toEqual([P3])
    expect(status.compleet).toBe(false)
  })

  it('geeft geen tekort/overschot zonder geldig benodigd aantal', () => {
    const status = groepStatus({
      leden: [{ id: 'k1', parallel_spelers: [P1], oefeningen: { teams: [] } }],
      presentPlayerIds: [P1],
    })
    expect(status.perLid[0]).toEqual({ koppelingId: 'k1', toegewezen: 1, benodigd: null, tekort: 0, overschot: 0 })
    // Zonder benodigd aantal blokkeert dit lid het "compleet"-oordeel niet.
    expect(status.compleet).toBe(true)
  })

  it('rekent met de effectieve bezetting zodra die is meegegeven', () => {
    // Basisvorm 2v2 (4 spelers), maar deze training draait 3v3 (6 spelers).
    const status = groepStatus({
      leden: [
        {
          id: 'k1',
          parallel_spelers: [P1, P2, P3, P4],
          oefeningen: oefening4,
          bezetting: { teams: [{ grootte: 3, formaties: [] }, { grootte: 3, formaties: [] }], aantal_neutralen: 0 },
        },
      ],
      presentPlayerIds: [P1, P2, P3, P4],
    })
    expect(status.perLid[0].benodigd).toBe(6)
    expect(status.perLid[0].tekort).toBe(2)
    expect(status.compleet).toBe(false)
  })

  it('valt zonder bezetting terug op de basisvorm (bestaand gedrag)', () => {
    const zonder = groepStatus({
      leden: [{ id: 'k1', parallel_spelers: [P1, P2, P3, P4], oefeningen: oefening4 }],
      presentPlayerIds: [P1, P2, P3, P4],
    })
    expect(zonder.perLid[0].benodigd).toBe(4)
    expect(zonder.compleet).toBe(true)

    // Ook een expliciete null-bezetting (kolom bestaat, geen override) volgt
    // de basisvorm — `?? `, geen truthiness.
    const metNull = groepStatus({
      leden: [{ id: 'k1', parallel_spelers: [P1, P2, P3, P4], oefeningen: oefening4, bezetting: null }],
      presentPlayerIds: [P1, P2, P3, P4],
    })
    expect(metNull.perLid[0].benodigd).toBe(4)
  })

  it('gaat om met een ontbrekende parallel_spelers-kolom (pre-migratie)', () => {
    const status = groepStatus({
      leden: [{ id: 'k1', oefeningen: { teams: [{ grootte: 2, formaties: [] }] } }],
      presentPlayerIds: [P1, P2],
    })
    expect(status.perLid[0].toegewezen).toBe(0)
    expect(status.nietIngedeeld).toEqual([P1, P2])
  })
})
