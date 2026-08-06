import { describe, it, expect } from 'vitest'
import {
  generateDiagram,
  validateDiagram,
  DIAGRAM_MAX_MARKERS,
  DIAGRAM_MAX_MATERIAAL,
  DIAGRAM_MAX_LIJNEN,
  DIAGRAM_MAX_PUNTEN,
  DIAGRAM_MAX_TEAM_INDEX,
} from '@/lib/diagram'
import { formationsForSize, type OefeningTeam } from '@/lib/types'
import { formatiesVoorTeam } from '@/lib/formaties'
import { validateOefening, type OefeningInput } from '@/lib/oefening'

// De formatie-opties van een team zoals de generator ze oplevert; de categorie is
// voor de tekening niet relevant (basisFormatieDef resolvet categorie-onafhankelijk),
// dus we gebruiken hier de ruimste catalogus.
function opties(grootte: number, keeperInGrootte = true) {
  return formatiesVoorTeam({ grootte, keeperInGrootte }, 'partijen_klein')
}

// Helper: elke coördinaat binnen de grenzen van het 0-100 / 0-140-stelsel.
function within(m: { x: number; y: number }) {
  return m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 140
}

describe('generateDiagram', () => {
  it('plaatst één marker per speler + per neutrale (bij gevulde formaties)', () => {
    const teams: OefeningTeam[] = [
      { grootte: 5, formaties: [] },
      { grootte: 7, formaties: [] },
    ]
    const d = generateDiagram(teams, 3, null)
    expect(d.markers.length).toBe(5 + 7 + 3)
    expect(d.materiaal).toEqual([])
    expect(d.lijnen).toEqual([])
  })

  it('team zonder formatie: precies grootte losse spelers, geen keeper/label', () => {
    const d = generateDiagram([{ grootte: 5, formaties: [] }], 0, null)
    const teamMarkers = d.markers.filter((m) => m.teamIndex === 0)
    expect(teamMarkers.length).toBe(5)
    expect(teamMarkers.every((m) => m.rol === 'speler')).toBe(true)
    expect(teamMarkers.every((m) => m.label === undefined || m.label === '')).toBe(true)
    // Losse plaatsing valt binnen de eigen (onder)helft en binnen het bereik.
    expect(teamMarkers.every((m) => m.y >= 70)).toBe(true)
    expect(teamMarkers.every(within)).toBe(true)
  })

  it('team MET formatie: gebruikt de formatie-posities inclusief keeper, alleen K gelabeld', () => {
    const def = opties(5)[0]
    const d = generateDiagram([{ grootte: 5, formaties: [def.key] }], 0, null)
    const teamMarkers = d.markers.filter((m) => m.teamIndex === 0)
    // Inclusief keeper: exact `grootte` markers (K + 4 veldspelers).
    expect(teamMarkers.length).toBe(5)
    expect(teamMarkers.filter((m) => m.rol === 'keeper')).toHaveLength(1)
    // Gegenereerde formaties labelen alleen de keeper; V/M/A blijven leeg.
    expect(teamMarkers.filter((m) => (m.label ?? '') !== '')).toHaveLength(1)
    expect(teamMarkers.find((m) => m.rol === 'keeper')!.label).toBe('K')
  })

  it('team ZONDER keeper in de grootte: `grootte` veldspelers en GEEN keeper-marker', () => {
    const def = opties(5, false)[0]
    const d = generateDiagram(
      [{ grootte: 5, formaties: [def.key], keeperInGrootte: false }],
      0,
      null,
    )
    const teamMarkers = d.markers.filter((m) => m.teamIndex === 0)
    expect(teamMarkers.length).toBe(5)
    expect(teamMarkers.every((m) => m.rol === 'speler')).toBe(true)
    expect(teamMarkers.every((m) => (m.label ?? '') === '')).toBe(true)
  })

  it('grootte 10 wordt nu wél getekend (via de gegenereerde catalogus)', () => {
    // De gecureerde lijst kent geen 10-tal, de generator wel.
    expect(formationsForSize(10)).toEqual([])
    const def = opties(10).find((f) => f.key === '4-4-1')!
    const d = generateDiagram([{ grootte: 10, formaties: [def.key] }], 0, null)
    expect(d.markers.filter((m) => m.teamIndex === 0)).toHaveLength(10)

    // Ook zonder gekozen formatie: losse rij van 10.
    const los = generateDiagram([{ grootte: 10, formaties: [] }], 0, null)
    expect(los.markers.filter((m) => m.teamIndex === 0)).toHaveLength(10)
  })

  it('legacy multi-select-data: het diagram volgt de alfabetisch eerste (basis)', () => {
    // Productiedata van vóór de single-select kan nog meerdere waarden bevatten.
    const alle = opties(4)
    const basis = alle[0]
    const tweede = alle[1]
    const a = generateDiagram([{ grootte: 4, formaties: [tweede.key, basis.key] }], 0, null)
    const b = generateDiagram([{ grootte: 4, formaties: [basis.key, tweede.key] }], 0, null)
    const alleenBasis = generateDiagram([{ grootte: 4, formaties: [basis.key] }], 0, null)
    expect(a).toEqual(alleenBasis)
    expect(b).toEqual(alleenBasis)
    // ...en niet dat van de tweede formatie.
    expect(a).not.toEqual(generateDiagram([{ grootte: 4, formaties: [tweede.key] }], 0, null))
  })

  it('lege of onbekende selectie → losse-rij-tak, zonder te gooien', () => {
    for (const formaties of [[], ['onzin'], ['4-3-3']]) {
      const d = generateDiagram([{ grootte: 4, formaties }], 0, null)
      const teamMarkers = d.markers.filter((m) => m.teamIndex === 0)
      expect(teamMarkers.length).toBe(4)
      expect(teamMarkers.every((m) => m.rol === 'speler')).toBe(true)
      expect(teamMarkers.every((m) => m.label === undefined || m.label === '')).toBe(true)
    }
  })

  it('dual-read: een legacy team {grootte, formatie} levert hetzelfde diagram als {formaties}', () => {
    const legacy = [{ grootte: 4, formatie: '2-1' }] as unknown as OefeningTeam[]
    expect(generateDiagram(legacy, 0, null)).toEqual(
      generateDiagram([{ grootte: 4, formaties: ['2-1'] }], 0, null),
    )
  })

  it('slaat teams met onbekende grootte over', () => {
    const d = generateDiagram(
      [
        { grootte: 5, formaties: [] },
        { grootte: 99, formaties: [] },
      ],
      0,
      null,
    )
    // Alleen het geldige team van 5 telt; teamIndex is dan 0 (na filteren).
    expect(d.markers.length).toBe(5)
    expect(d.markers.every((m) => m.teamIndex === 0)).toBe(true)
  })

  it('2 teams met formatie: team 1 is exact gespiegeld t.o.v. de basispositie van team 0', () => {
    const size = 6
    const def = opties(size)[0]
    const teams: OefeningTeam[] = [
      { grootte: size, formaties: [def.key] },
      { grootte: size, formaties: [def.key] },
    ]
    const d = generateDiagram(teams, 0, null)
    const t0 = d.markers.filter((m) => m.teamIndex === 0)
    const t1 = d.markers.filter((m) => m.teamIndex === 1)
    expect(t0.length).toBe(def.positions.length)
    expect(t1.length).toBe(def.positions.length)

    def.positions.forEach((p, idx) => {
      const baseX = p.x
      const baseY = p.y * 1.4
      // team 0 = basis
      expect(t0[idx].x).toBeCloseTo(baseX, 5)
      expect(t0[idx].y).toBeCloseTo(baseY, 5)
      // team 1 = gespiegeld: y'=140−y, x'=100−x
      expect(t1[idx].y).toBeCloseTo(140 - baseY, 5)
      expect(t1[idx].x).toBeCloseTo(100 - baseX, 5)
    })

    // Keeper: team 0 grote y (onderin), team 1 kleine y (overkant).
    const k0 = t0.find((m) => m.rol === 'keeper')!
    const k1 = t1.find((m) => m.rol === 'keeper')!
    expect(k0.y).toBeGreaterThan(70)
    expect(k1.y).toBeLessThan(70)
  })

  it('1 team: alle markers liggen op de eigen (onder)helft (y>=70)', () => {
    const d = generateDiagram([{ grootte: 7, formaties: [] }], 0, null)
    expect(d.markers.every((m) => m.y >= 70)).toBe(true)
  })

  it('3+ teams: markers vallen in disjuncte y-banden per team', () => {
    const teams: OefeningTeam[] = [
      { grootte: 4, formaties: [] },
      { grootte: 4, formaties: [] },
      { grootte: 4, formaties: [] },
    ]
    const d = generateDiagram(teams, 0, null)
    const bandH = 140 / 3
    for (let i = 0; i < 3; i++) {
      const band = d.markers.filter((m) => m.teamIndex === i)
      expect(band.length).toBeGreaterThan(0)
      expect(band.every((m) => m.y >= i * bandH && m.y <= (i + 1) * bandH)).toBe(true)
    }
  })

  it('gemengd: team 0 met formatie, team 1 zonder → team 1 losjes in de bovenhelft', () => {
    const def = opties(6)[0]
    const teams: OefeningTeam[] = [
      { grootte: 6, formaties: [def.key] },
      { grootte: 6, formaties: [] },
    ]
    const d = generateDiagram(teams, 0, null)
    const t0 = d.markers.filter((m) => m.teamIndex === 0)
    const t1 = d.markers.filter((m) => m.teamIndex === 1)

    // Team 0: formatie-vorm met keeper en labels.
    expect(t0.length).toBe(def.positions.length)
    expect(t0.some((m) => m.rol === 'keeper')).toBe(true)
    expect(t0.some((m) => (m.label ?? '') !== '')).toBe(true)

    // Team 1: losjes, geen labels, geen keeper, in de (gespiegelde) bovenhelft.
    expect(t1.length).toBe(6)
    expect(t1.every((m) => m.rol === 'speler')).toBe(true)
    expect(t1.every((m) => m.label === undefined || m.label === '')).toBe(true)
    expect(t1.every((m) => m.y < 70)).toBe(true)
    expect(t1.every(within)).toBe(true)
  })

  it('0 teams → leeg diagram (geen markers)', () => {
    const d = generateDiagram([], 0, null)
    expect(d.markers).toEqual([])
  })

  it('losse teams in 3+ opstelling vallen in disjuncte y-banden per team', () => {
    const teams: OefeningTeam[] = [
      { grootte: 5, formaties: [] },
      { grootte: 5, formaties: [] },
      { grootte: 5, formaties: [] },
    ]
    const d = generateDiagram(teams, 0, null)
    const bandH = 140 / 3
    for (let i = 0; i < 3; i++) {
      const band = d.markers.filter((m) => m.teamIndex === i)
      expect(band.length).toBe(5)
      expect(band.every((m) => m.y >= i * bandH && m.y <= (i + 1) * bandH)).toBe(true)
      expect(band.every((m) => m.label === undefined || m.label === '')).toBe(true)
    }
  })

  it('neutralen: rol neutraal, teamIndex null, rond y≈70 en binnen grenzen', () => {
    const d = generateDiagram([{ grootte: 4, formaties: [] }], 5, null)
    const neutralen = d.markers.filter((m) => m.rol === 'neutraal')
    expect(neutralen.length).toBe(5)
    expect(neutralen.every((m) => m.teamIndex === null)).toBe(true)
    expect(neutralen.every((m) => Math.abs(m.y - 70) <= 5)).toBe(true)
    expect(neutralen.every(within)).toBe(true)
  })

  it('veel neutralen (>10) worden over twee rijen verdeeld, allemaal binnen grenzen', () => {
    const d = generateDiagram([{ grootte: 4, formaties: [] }], 14, null)
    const neutralen = d.markers.filter((m) => m.rol === 'neutraal')
    expect(neutralen.length).toBe(14)
    expect(neutralen.every(within)).toBe(true)
    const rijen = new Set(neutralen.map((m) => m.y))
    expect(rijen.size).toBe(2)
  })

  it('alle coördinaten blijven binnen grenzen ongeacht veldzone', () => {
    for (const z of ['links', 'rechts', 'midden', 'strafschopgebied_links', 'strafschopgebied_rechts', null] as const) {
      const d = generateDiagram([{ grootte: 8, formaties: [] }, { grootte: 8, formaties: [] }], 6, z)
      expect(d.markers.every(within)).toBe(true)
    }
  })
})

describe('validateDiagram', () => {
  it('null/undefined/niet-object → null', () => {
    expect(validateDiagram(null)).toBeNull()
    expect(validateDiagram(undefined)).toBeNull()
    expect(validateDiagram(42)).toBeNull()
    expect(validateDiagram('x')).toBeNull()
  })

  it('clampt coördinaten binnen [0,100]/[0,140]', () => {
    const d = validateDiagram({
      markers: [
        { x: 250, y: 999, teamIndex: 0, rol: 'speler' },
        { x: -20, y: -5, teamIndex: 0, rol: 'speler' },
      ],
    })!
    expect(d.markers[0]).toMatchObject({ x: 100, y: 140 })
    expect(d.markers[1]).toMatchObject({ x: 0, y: 0 })
  })

  it('whitelist: onbekende rol → speler; onbekend materiaal/stijl gedropt', () => {
    const d = validateDiagram({
      markers: [{ x: 10, y: 10, teamIndex: 0, rol: 'alien' }],
      materiaal: [
        { type: 'bal', x: 5, y: 5 },
        { type: 'ufo', x: 5, y: 5 },
      ],
      lijnen: [
        { stijl: 'pass', punten: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
        { stijl: 'zigzag', punten: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
      ],
    })!
    expect(d.markers[0].rol).toBe('speler')
    expect(d.materiaal).toHaveLength(1)
    expect(d.materiaal[0].type).toBe('bal')
    expect(d.lijnen).toHaveLength(1)
    expect(d.lijnen[0].stijl).toBe('pass')
  })

  it('stript onbekende velden op markers', () => {
    const d = validateDiagram({
      markers: [{ x: 10, y: 10, teamIndex: 1, rol: 'keeper', label: 'K', kleur: 'rood', extra: 1 }],
    })!
    expect(Object.keys(d.markers[0]).sort()).toEqual(['label', 'rol', 'teamIndex', 'x', 'y'])
  })

  it('label wordt afgekapt tot 6 tekens; niet-string → undefined', () => {
    const d = validateDiagram({
      markers: [
        { x: 1, y: 1, teamIndex: 0, rol: 'speler', label: 'abcdefghij' },
        { x: 1, y: 1, teamIndex: 0, rol: 'speler', label: 123 },
      ],
    })!
    expect(d.markers[0].label).toBe('abcdef')
    expect(d.markers[1].label).toBeUndefined()
  })

  it('respecteert de maxima', () => {
    const d = validateDiagram({
      markers: Array.from({ length: 200 }, () => ({ x: 1, y: 1, teamIndex: 0, rol: 'speler' })),
      materiaal: Array.from({ length: 100 }, () => ({ type: 'pion', x: 1, y: 1 })),
      lijnen: Array.from({ length: 60 }, () => ({
        stijl: 'loop',
        punten: Array.from({ length: 40 }, () => ({ x: 1, y: 1 })),
      })),
    })!
    expect(d.markers).toHaveLength(DIAGRAM_MAX_MARKERS)
    expect(d.materiaal).toHaveLength(DIAGRAM_MAX_MATERIAAL)
    expect(d.lijnen).toHaveLength(DIAGRAM_MAX_LIJNEN)
    expect(d.lijnen[0].punten).toHaveLength(DIAGRAM_MAX_PUNTEN)
  })

  it('clampt teamIndex naar het maximum', () => {
    const d = validateDiagram({ markers: [{ x: 1, y: 1, teamIndex: 99, rol: 'speler' }] })!
    expect(d.markers[0].teamIndex).toBe(DIAGRAM_MAX_TEAM_INDEX)
  })

  it('teamIndex null blijft null', () => {
    const d = validateDiagram({ markers: [{ x: 1, y: 1, teamIndex: null, rol: 'neutraal' }] })!
    expect(d.markers[0].teamIndex).toBeNull()
  })

  it('doeltje zonder variant krijgt default variant groot', () => {
    const d = validateDiagram({ materiaal: [{ type: 'doeltje', x: 10, y: 10 }] })!
    expect(d.materiaal[0].variant).toBe('groot')
  })

  it('doeltje met variant klein/mini behoudt de variant', () => {
    const d = validateDiagram({
      materiaal: [
        { type: 'doeltje', x: 1, y: 1, variant: 'klein' },
        { type: 'doeltje', x: 2, y: 2, variant: 'mini' },
      ],
    })!
    expect(d.materiaal[0].variant).toBe('klein')
    expect(d.materiaal[1].variant).toBe('mini')
  })

  it('doeltje met onbekende variant valt terug op groot', () => {
    const d = validateDiagram({ materiaal: [{ type: 'doeltje', x: 1, y: 1, variant: 'gigantisch' }] })!
    expect(d.materiaal[0].variant).toBe('groot')
  })

  it('pion/bal krijgen geen variant-veld (gestript)', () => {
    const d = validateDiagram({
      materiaal: [
        { type: 'pion', x: 1, y: 1, variant: 'groot' },
        { type: 'bal', x: 2, y: 2, variant: 'mini' },
      ],
    })!
    expect(d.materiaal[0]).not.toHaveProperty('variant')
    expect(d.materiaal[1]).not.toHaveProperty('variant')
  })

  it('lijn met minder dan 2 punten wordt gedropt', () => {
    const d = validateDiagram({
      lijnen: [
        { stijl: 'dribbel', punten: [{ x: 1, y: 1 }] },
        { stijl: 'dribbel', punten: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
      ],
    })!
    expect(d.lijnen).toHaveLength(1)
  })
})

describe('validateOefening — diagram integratie', () => {
  const base: OefeningInput = {
    naam: 'Test',
    categorie: 'overig',
    teams: [{ grootte: 5, formaties: [] }],
    aantal_neutralen: 0,
  }

  it('normaliseert een corrupt diagram (clamp + whitelist)', () => {
    // Bewust corrupt (onbekende rol/type, extra veld): binnengekomen JSONB is
    // untrusted, dus we casten via unknown om de normalisatie te testen.
    const corrupt = {
      markers: [{ x: 999, y: -1, teamIndex: 0, rol: 'alien', rommel: true }],
      materiaal: [{ type: 'nope', x: 1, y: 1 }],
      lijnen: [],
    } as unknown as OefeningInput['diagram']
    const v = validateOefening({ ...base, diagram: corrupt })
    expect(v.diagram).not.toBeNull()
    expect(v.diagram!.markers[0]).toMatchObject({ x: 100, y: 0, rol: 'speler' })
    expect(v.diagram!.materiaal).toHaveLength(0)
  })

  it('geeft null terug wanneer geen diagram is meegegeven', () => {
    const v = validateOefening(base)
    expect(v.diagram).toBeNull()
  })
})
