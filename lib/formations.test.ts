import { describe, it, expect } from 'vitest'
import {
  formationsForSize,
  normalizeOefeningTeam,
  normalizeOefeningTeams,
  FORMATIONS,
  FORMATIONS_BY_TEAM_SIZE,
  POSITION_LABEL_MAP,
} from '@/lib/types'

// basisFormatieDef en isFormatieGeldigVoorTeam (voorheen isFormationValidForSize)
// zijn verhuisd naar lib/formaties.ts; hun tests staan in lib/formaties.test.ts.

const SIZES = [3, 4, 5, 6, 7, 8, 9, 11]

describe('formationsForSize', () => {
  it('geeft minstens één formatie per ondersteunde grootte', () => {
    for (const n of SIZES) {
      const list = formationsForSize(n)
      expect(list.length).toBeGreaterThan(0)
    }
  })

  it('elke formatie heeft evenveel posities als de teamgrootte', () => {
    for (const n of SIZES) {
      for (const f of formationsForSize(n)) {
        expect(f.positions.length).toBe(n)
      }
    }
  })

  it('geeft een lege lijst voor een niet-ondersteunde grootte', () => {
    expect(formationsForSize(10)).toEqual([])
    expect(formationsForSize(0)).toEqual([])
  })

  it('11-tal hergebruikt de bestaande FORMATIONS-vormen', () => {
    const keys = FORMATIONS_BY_TEAM_SIZE[11].map((f) => f.key)
    expect(keys).toContain('4-3-3')
    expect(keys).toContain('4-4-2')
  })

  it('geeft de formaties alfabetisch op label terug', () => {
    for (const n of SIZES) {
      const labels = formationsForSize(n).map((f) => f.label)
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'nl')))
    }
    // Concreet: 11-tal staat in FORMATIONS in invoervolgorde, gesorteerd anders.
    // Bewust geen letterlijke lijst van alle keys meer — die groeit mee met de
    // catalogus terwijl het criterium ("gesorteerd, dus niet de bronvolgorde")
    // gelijk blijft. Wat het bewijst: de bron begint met een 4-backsysteem, de
    // gesorteerde lijst met een 3-backsysteem.
    expect(Object.keys(FORMATIONS)[0]).toBe('4-3-3')
    expect(formationsForSize(11)[0].key).toBe('3-4-2-1')
    expect(formationsForSize(11).map((f) => f.key)).toHaveLength(Object.keys(FORMATIONS).length)
    // En grootte 4: '1-2' vóór '2-1' (was omgekeerd in de bron).
    expect(formationsForSize(4).map((f) => f.key)).toEqual(['1-2', '2-1'])
  })

  it('muteert FORMATIONS_BY_TEAM_SIZE en FORMATIONS niet (LineupBuilder-volgorde blijft)', () => {
    // Bronvolgorde is de invoervolgorde, niet de alfabetische.
    expect(FORMATIONS_BY_TEAM_SIZE[4].map((f) => f.key)).toEqual(['2-1', '1-2'])
    // Het 11-tal spiegelt FORMATIONS één-op-één in bronvolgorde: dát is de
    // invariant (LineupBuilder toont de formatiekiezer in deze volgorde),
    // niet een bevroren lijst keys.
    expect(FORMATIONS_BY_TEAM_SIZE[11].map((f) => f.key)).toEqual(Object.keys(FORMATIONS))
  })

  it('geeft dezelfde (stabiele) array terug bij herhaald aanroepen', () => {
    expect(formationsForSize(7)).toBe(formationsForSize(7))
    expect(formationsForSize(10)).toEqual([])
  })
})

// De gecureerde 11-tal-catalogus is gegroeid van 5 naar 15 formaties. Deze
// bewaking vangt de drie fouten die je bij het toevoegen van een formatie maakt
// zónder dat de app luid faalt: een slot te veel/te weinig, een rugnummer dat
// dubbel op het veld staat, en een positielabel dat de aanbevelingslogica niet
// kent (dan geeft getFitScore voor iedereen 0 en verdwijnt de aanbeveling stil).
describe('FORMATIONS — vorm van elke gecureerde 11-tal-formatie', () => {
  const alle = Object.entries(FORMATIONS)

  it('bevat de klassiekers plus de 4-3-3-varianten', () => {
    const keys = alle.map(([key]) => key)
    for (const verwacht of ['4-3-3', '4-3-3 (controleur)', '4-3-3 (dubbele 6)', '4-3-3 (valse 9)', '4-4-2', '4-2-3-1', '3-4-3', '5-3-2']) {
      expect(keys).toContain(verwacht)
    }
    expect(keys.length).toBeGreaterThanOrEqual(15)
  })

  it('heeft per formatie exact 11 posities waarvan precies één keeper', () => {
    for (const [key, f] of alle) {
      expect(f.positions, key).toHaveLength(11)
      expect(f.positions.filter((p) => p.position_label === 'KP'), key).toHaveLength(1)
    }
  })

  it('gebruikt per formatie de rugnummers 1 t/m 11 zonder duplicaat', () => {
    // Het NUMMER staat op een bezet poppetje (displayNum in LineupBuilder),
    // niet het rugnummer van de speler — twee gelijke nummers zijn dus niet
    // uit elkaar te houden op het veld.
    for (const [key, f] of alle) {
      const nummers = f.positions.map((p) => p.position_number).sort((a, b) => (a ?? 0) - (b ?? 0))
      expect(nummers, key).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    }
  })

  it('gebruikt uitsluitend positielabels die POSITION_LABEL_MAP kent', () => {
    for (const [key, f] of alle) {
      for (const p of f.positions) {
        expect(POSITION_LABEL_MAP[p.position_label], `${key} → ${p.position_label}`).toBeTruthy()
      }
    }
  })

  it('houdt elke positie binnen het veld (0-100 x 0-90)', () => {
    // y = 90 is de keeperslijn; hoger zou het poppetje buiten de kaart duwen.
    for (const [key, f] of alle) {
      for (const p of f.positions) {
        expect(p.x, key).toBeGreaterThanOrEqual(0)
        expect(p.x, key).toBeLessThanOrEqual(100)
        expect(p.y, key).toBeGreaterThanOrEqual(0)
        expect(p.y, key).toBeLessThanOrEqual(90)
      }
    }
  })

  it('geeft elke formatie een label dat gelijk is aan zijn key', () => {
    // De kiezer toont het label, de database slaat de key op. Lopen ze uiteen,
    // dan toont de app iets anders dan er is opgeslagen.
    for (const [key, f] of alle) expect(f.label, key).toBe(key)
  })
})

describe('normalizeOefeningTeam (dual-read)', () => {
  it('legacy formatie-string → array van één', () => {
    expect(normalizeOefeningTeam({ grootte: 4, formatie: '2-1' })).toEqual({
      grootte: 4,
      formaties: ['2-1'],
      keeperInGrootte: true,
    })
  })

  it('legacy formatie null/lege string → lege array', () => {
    expect(normalizeOefeningTeam({ grootte: 4, formatie: null })).toEqual({
      grootte: 4,
      formaties: [],
      keeperInGrootte: true,
    })
    expect(normalizeOefeningTeam({ grootte: 4, formatie: '' })).toEqual({
      grootte: 4,
      formaties: [],
      keeperInGrootte: true,
    })
  })

  it('nieuwe vorm blijft behouden', () => {
    expect(normalizeOefeningTeam({ grootte: 4, formaties: ['2-1', '1-2'] })).toEqual({
      grootte: 4,
      formaties: ['2-1', '1-2'],
      keeperInGrootte: true,
    })
  })

  it('formaties heeft voorrang op een meegestuurd legacy formatie-veld', () => {
    expect(normalizeOefeningTeam({ grootte: 4, formaties: ['1-2'], formatie: '2-1' })).toEqual({
      grootte: 4,
      formaties: ['1-2'],
      keeperInGrootte: true,
    })
  })

  it('ontdubbelt en gooit niet-strings/lege strings weg', () => {
    expect(
      normalizeOefeningTeam({ grootte: 4, formaties: ['2-1', '2-1', '', 7, null, '1-2'] }),
    ).toEqual({ grootte: 4, formaties: ['2-1', '1-2'], keeperInGrootte: true })
  })

  it('stript onbekende velden', () => {
    const t = normalizeOefeningTeam({ grootte: 6, formaties: ['3-2'], foo: 'bar' })
    expect(Object.keys(t).sort()).toEqual(['formaties', 'grootte', 'keeperInGrootte'])
  })

  it('tolerant voor null/undefined/rommel', () => {
    expect(normalizeOefeningTeam(null).formaties).toEqual([])
    expect(normalizeOefeningTeam(undefined).formaties).toEqual([])
    expect(Number.isNaN(normalizeOefeningTeam({}).grootte)).toBe(true)
  })
})

describe('normalizeOefeningTeam (keeperInGrootte)', () => {
  it('ontbrekend veld → true (bestaande rijen tellen de keeper mee)', () => {
    expect(normalizeOefeningTeam({ grootte: 6, formaties: [] }).keeperInGrootte).toBe(true)
  })

  it('expliciet false blijft false', () => {
    expect(normalizeOefeningTeam({ grootte: 6, keeperInGrootte: false }).keeperInGrootte).toBe(false)
  })

  it('niet-booleaanse rommel valt terug op de default true', () => {
    for (const raw of ['false', 0, null, [], {}]) {
      expect(normalizeOefeningTeam({ grootte: 6, keeperInGrootte: raw }).keeperInGrootte).toBe(true)
    }
  })

  it('grootte 11 forceert true, ongeacht de invoer', () => {
    expect(normalizeOefeningTeam({ grootte: 11, keeperInGrootte: false }).keeperInGrootte).toBe(true)
  })
})

describe('normalizeOefeningTeam (grootteMax)', () => {
  it('leest een geldige bovengrens mee', () => {
    expect(normalizeOefeningTeam({ grootte: 4, formaties: [], grootteMax: 6 }).grootteMax).toBe(6)
  })

  it('laat het veld WEG als er geen bereik is (geen null-ruis in de JSONB)', () => {
    const zonder = normalizeOefeningTeam({ grootte: 4, formaties: [] })
    expect(Object.keys(zonder).sort()).toEqual(['formaties', 'grootte', 'keeperInGrootte'])
    const metNull = normalizeOefeningTeam({ grootte: 4, formaties: [], grootteMax: null })
    expect(Object.keys(metNull).sort()).toEqual(['formaties', 'grootte', 'keeperInGrootte'])
  })

  it('gooit een bovengrens onder de grootte of niet-numerieke rommel weg (vormnormalisatie)', () => {
    // Afwijzen bij het OPSLAAN is de taak van validateOefening; hier gaat het
    // alleen om een leesbare vorm.
    expect(normalizeOefeningTeam({ grootte: 4, grootteMax: 3 }).grootteMax).toBeUndefined()
    expect(normalizeOefeningTeam({ grootte: 4, grootteMax: 'zes' }).grootteMax).toBeUndefined()
    expect(normalizeOefeningTeam({ grootte: 4, grootteMax: 6.9 }).grootteMax).toBe(6)
  })
})

describe('normalizeOefeningTeams', () => {
  it('normaliseert een gemengde legacy/nieuwe lijst', () => {
    expect(
      normalizeOefeningTeams([
        { grootte: 4, formatie: '2-1' },
        { grootte: 6, formaties: ['3-2', '2-2-1'], keeperInGrootte: false },
        { grootte: 8, formatie: null },
      ]),
    ).toEqual([
      { grootte: 4, formaties: ['2-1'], keeperInGrootte: true },
      { grootte: 6, formaties: ['3-2', '2-2-1'], keeperInGrootte: false },
      { grootte: 8, formaties: [], keeperInGrootte: true },
    ])
  })

  it('niet-array → lege lijst; kapt af op 6 teams', () => {
    expect(normalizeOefeningTeams(null)).toEqual([])
    expect(normalizeOefeningTeams('x')).toEqual([])
    expect(normalizeOefeningTeams(Array.from({ length: 9 }, () => ({ grootte: 3 })))).toHaveLength(6)
  })
})
