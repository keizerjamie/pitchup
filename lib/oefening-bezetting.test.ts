import { describe, it, expect } from 'vitest'
import {
  bereikLabel,
  bereikLabelVoor,
  bereikVoorNeutralen,
  bereikVoorTeam,
  concretiseerBezetting,
  isFlexibel,
  isFlexibelTeam,
  sorteerOpPassendheid,
  suggestBezetting,
  teamBereikLabel,
  totaalBereik,
  valideerAantallenOverride,
  vormLabel,
  type BezettingBasis,
} from '@/lib/oefening-bezetting'
import type { OefeningTeam } from '@/lib/types'

// De en-dash (U+2013) is onderdeel van het contract van de labels; een gewone
// hyphen zou hier stilzwijgend doorglippen.
const EN_DASH = '–'

function team(grootte: number, over: Partial<OefeningTeam> = {}): OefeningTeam {
  return { grootte, formaties: [], keeperInGrootte: true, ...over }
}

function basis(over: Partial<BezettingBasis> = {}): BezettingBasis {
  return { teams: [], aantal_neutralen: 0, ...over }
}

// Standaardvoorbeeld uit de story: 4v2 tot en met 6v2.
const VIER_TOT_ZES: BezettingBasis = basis({
  teams: [team(4, { grootteMax: 6 }), team(2)],
})

// ────────────────────────────────────────────────
// bereikVoorTeam / bereikVoorNeutralen
// ────────────────────────────────────────────────
describe('bereikVoorTeam', () => {
  it('geeft [grootte, grootteMax] voor een flexibel team zonder formatie', () => {
    expect(bereikVoorTeam(team(4, { grootteMax: 6 }))).toEqual({ min: 4, max: 6 })
    expect(isFlexibelTeam(team(4, { grootteMax: 6 }))).toBe(true)
  })

  it('geeft een punt-bereik zonder grootteMax (bestaand gedrag)', () => {
    expect(bereikVoorTeam(team(4))).toEqual({ min: 4, max: 4 })
    expect(bereikVoorTeam({ grootte: 4, formaties: [], grootteMax: null })).toEqual({
      min: 4,
      max: 4,
    })
    expect(isFlexibelTeam(team(4))).toBe(false)
  })

  it('dwingt "formatie ⇒ exact" af, ook bij hand-geknutselde JSONB', () => {
    // Een formatie hoort alleen bij een exact team; validateOefening weigert de
    // combinatie bij het opslaan, hier is het het lees-vangnet.
    expect(bereikVoorTeam(team(4, { grootteMax: 6, formaties: ['2-1-0'] }))).toEqual({
      min: 4,
      max: 4,
    })
  })

  it('negeert een grootteMax buiten VALID_TEAM_SIZES of onder de grootte', () => {
    expect(bereikVoorTeam(team(4, { grootteMax: 12 }))).toEqual({ min: 4, max: 4 })
    expect(bereikVoorTeam(team(4, { grootteMax: 3 }))).toEqual({ min: 4, max: 4 })
    expect(bereikVoorTeam(team(4, { grootteMax: 5.5 }))).toEqual({ min: 4, max: 4 })
  })

  it('houdt een los team (grootte <= 0) los: altijd punt-bereik', () => {
    expect(bereikVoorTeam(team(0, { grootteMax: 6 }))).toEqual({ min: 0, max: 0 })
    expect(isFlexibelTeam(team(0, { grootteMax: 6 }))).toBe(false)
  })
})

describe('bereikVoorNeutralen', () => {
  it('geeft een punt-bereik zonder maximum', () => {
    expect(bereikVoorNeutralen(basis({ aantal_neutralen: 2 }))).toEqual({ min: 2, max: 2 })
  })

  it('behandelt 0 als een geldige ondergrens (geen falsy-zero)', () => {
    const b = basis({ aantal_neutralen: 0, aantal_neutralen_max: 4 })
    expect(bereikVoorNeutralen(b)).toEqual({ min: 0, max: 4 })
    expect(isFlexibel(b)).toBe(true)
  })

  it('negeert een maximum onder het basisaantal of buiten 0..30', () => {
    expect(bereikVoorNeutralen(basis({ aantal_neutralen: 3, aantal_neutralen_max: 1 }))).toEqual({
      min: 3,
      max: 3,
    })
    expect(bereikVoorNeutralen(basis({ aantal_neutralen: 3, aantal_neutralen_max: 31 }))).toEqual({
      min: 3,
      max: 3,
    })
  })
})

describe('isFlexibel', () => {
  it('is false voor een oefening zonder enig bereik', () => {
    expect(isFlexibel(basis({ teams: [team(4), team(2)], aantal_neutralen: 1 }))).toBe(false)
  })

  it('is true zodra één team óf de neutralen speelruimte hebben', () => {
    expect(isFlexibel(VIER_TOT_ZES)).toBe(true)
    expect(isFlexibel(basis({ aantal_neutralen: 2, aantal_neutralen_max: 4 }))).toBe(true)
  })
})

// ────────────────────────────────────────────────
// totaalBereik
// ────────────────────────────────────────────────
describe('totaalBereik', () => {
  it('telt de team- en neutralenbereiken op', () => {
    expect(totaalBereik(VIER_TOT_ZES)).toEqual({ min: 6, max: 8 })
    expect(
      totaalBereik(basis({ ...VIER_TOT_ZES, aantal_neutralen: 2, aantal_neutralen_max: 4 })),
    ).toEqual({ min: 8, max: 12 })
  })

  it('geeft voor een exacte oefening min === max (identiek aan de oude som)', () => {
    expect(totaalBereik(basis({ teams: [team(5), team(5)], aantal_neutralen: 2 }))).toEqual({
      min: 12,
      max: 12,
    })
  })

  it('telt een los team als 0 in min én max', () => {
    expect(totaalBereik(basis({ teams: [team(0), team(4)] }))).toEqual({ min: 4, max: 4 })
  })

  it('is defensief tegen rommelige JSONB', () => {
    const rommel = { teams: [team(5), null, { formaties: [] }], aantal_neutralen: null }
    expect(totaalBereik(rommel as unknown as BezettingBasis)).toEqual({ min: 5, max: 5 })
  })
})

// ────────────────────────────────────────────────
// concretiseerBezetting
// ────────────────────────────────────────────────
describe('concretiseerBezetting', () => {
  it('geeft zonder override de basisvorm terug', () => {
    const bezetting = concretiseerBezetting(VIER_TOT_ZES, null)
    expect(bezetting.teams.map((t) => t.grootte)).toEqual([4, 2])
    expect(bezetting.aantal_neutralen).toBe(0)
    expect(bezetting.aangepast).toBe(false)
    expect(concretiseerBezetting(VIER_TOT_ZES, undefined).aangepast).toBe(false)
  })

  it('past alleen de ingevulde elementen aan; null blijft de basisvorm', () => {
    const bezetting = concretiseerBezetting(VIER_TOT_ZES, { teams: [5, null], neutralen: null })
    expect(bezetting.teams.map((t) => t.grootte)).toEqual([5, 2])
    expect(bezetting.aangepast).toBe(true)
  })

  it('behoudt formaties en keeperInGrootte; alleen grootte wordt vervangen', () => {
    const b = basis({ teams: [team(4, { grootteMax: 6 }), team(5, { formaties: ['2-2-0'], keeperInGrootte: false })] })
    const bezetting = concretiseerBezetting(b, { teams: [6, null], neutralen: null })
    expect(bezetting.teams[0]).toEqual({ grootte: 6, formaties: [], keeperInGrootte: true, grootteMax: 6 })
    expect(bezetting.teams[1]).toEqual({ grootte: 5, formaties: ['2-2-0'], keeperInGrootte: false })
  })

  it('clamt een override buiten het (verkleinde) bereik en muteert de invoer niet', () => {
    const override = { teams: [99, null], neutralen: 99 }
    const bezetting = concretiseerBezetting(VIER_TOT_ZES, override)
    expect(bezetting.teams.map((t) => t.grootte)).toEqual([6, 2])
    expect(bezetting.aantal_neutralen).toBe(0)
    expect(override).toEqual({ teams: [99, null], neutralen: 99 })
    // ...en de basisvorm zelf blijft ook onaangeroerd.
    expect(VIER_TOT_ZES.teams.map((t) => t.grootte)).toEqual([4, 2])
  })

  it('brengt een override stil terug naar de basisvorm zodra het team exact wordt', () => {
    // Bibliotheekwijziging flexibel → exact (grootteMax weg of formatie erbij).
    const nuExact = basis({ teams: [team(4), team(2)] })
    const bezetting = concretiseerBezetting(nuExact, { teams: [6, null], neutralen: null })
    expect(bezetting.teams.map((t) => t.grootte)).toEqual([4, 2])
    expect(bezetting.aangepast).toBe(false)

    const metFormatie = basis({ teams: [team(4, { grootteMax: 6, formaties: ['2-1-0'] })] })
    expect(concretiseerBezetting(metFormatie, { teams: [6], neutralen: null }).teams[0].grootte)
      .toBe(4)
  })

  it('negeert overtollige entries en vult ontbrekende met de basisvorm', () => {
    const langer = concretiseerBezetting(VIER_TOT_ZES, { teams: [5, null, 9, 9], neutralen: null })
    expect(langer.teams.map((t) => t.grootte)).toEqual([5, 2])

    const korter = concretiseerBezetting(VIER_TOT_ZES, { teams: [], neutralen: null })
    expect(korter.teams.map((t) => t.grootte)).toEqual([4, 2])
    expect(korter.aangepast).toBe(false)
  })

  it('valt bij een niet-numerieke waarde terug op de basisvorm', () => {
    const bezetting = concretiseerBezetting(
      VIER_TOT_ZES,
      { teams: ['6', Number.NaN], neutralen: 'x' } as unknown as never,
    )
    expect(bezetting.teams.map((t) => t.grootte)).toEqual([4, 2])
    expect(bezetting.aangepast).toBe(false)
  })

  it('volgt ook een flexibel aantal neutralen', () => {
    const b = basis({ teams: [team(4)], aantal_neutralen: 0, aantal_neutralen_max: 4 })
    const bezetting = concretiseerBezetting(b, { teams: [], neutralen: 3 })
    expect(bezetting.aantal_neutralen).toBe(3)
    expect(bezetting.aangepast).toBe(true)
  })
})

// ────────────────────────────────────────────────
// suggestBezetting
// ────────────────────────────────────────────────
describe('suggestBezetting', () => {
  it('vult tot het aantal aanwezigen en negeert wat niet past', () => {
    // Basis 6, kopruimte 2 (alleen team0) → 14 aanwezig levert 6v2 op.
    expect(suggestBezetting(VIER_TOT_ZES, 14)).toEqual({ teams: [6, 2], neutralen: 0 })
  })

  it('verdeelt round-robin over twee flexibele teams, één eenheid per beurt', () => {
    const b = basis({ teams: [team(4, { grootteMax: 6 }), team(4, { grootteMax: 6 })] })
    expect(suggestBezetting(b, 8).teams).toEqual([4, 4])
    expect(suggestBezetting(b, 9).teams).toEqual([5, 4])
    expect(suggestBezetting(b, 10).teams).toEqual([5, 5])
    expect(suggestBezetting(b, 11).teams).toEqual([6, 5])
    expect(suggestBezetting(b, 12).teams).toEqual([6, 6])
    // Boven het maximum blijft het bij het maximum.
    expect(suggestBezetting(b, 40).teams).toEqual([6, 6])
  })

  it('vult de neutralen als laatste', () => {
    const b = basis({
      teams: [team(4, { grootteMax: 5 })],
      aantal_neutralen: 1,
      aantal_neutralen_max: 3,
    })
    expect(suggestBezetting(b, 6)).toEqual({ teams: [5], neutralen: 1 })
    expect(suggestBezetting(b, 7)).toEqual({ teams: [5], neutralen: 2 })
    expect(suggestBezetting(b, 8)).toEqual({ teams: [5], neutralen: 3 })
  })

  it('gaat nooit onder de basisvorm', () => {
    expect(suggestBezetting(VIER_TOT_ZES, 0)).toEqual({ teams: [4, 2], neutralen: 0 })
    expect(suggestBezetting(VIER_TOT_ZES, 2)).toEqual({ teams: [4, 2], neutralen: 0 })
    expect(suggestBezetting(VIER_TOT_ZES, Number.NaN)).toEqual({ teams: [4, 2], neutralen: 0 })
    expect(suggestBezetting(VIER_TOT_ZES, -5)).toEqual({ teams: [4, 2], neutralen: 0 })
  })

  it('geeft bij een exacte oefening exact de basisvorm', () => {
    const exact = basis({ teams: [team(5), team(5)], aantal_neutralen: 2 })
    expect(suggestBezetting(exact, 30)).toEqual({ teams: [5, 5], neutralen: 2 })
  })
})

// ────────────────────────────────────────────────
// valideerAantallenOverride
// ────────────────────────────────────────────────
describe('valideerAantallenOverride', () => {
  it('geeft null bij null/undefined (override wissen)', () => {
    expect(valideerAantallenOverride(null, VIER_TOT_ZES)).toBeNull()
    expect(valideerAantallenOverride(undefined, VIER_TOT_ZES)).toBeNull()
  })

  it('normaliseert naar de delta-vorm: basiswaarde wordt null', () => {
    expect(valideerAantallenOverride({ teams: [5, 2], neutralen: 0 }, VIER_TOT_ZES)).toEqual({
      teams: [5, null],
      neutralen: null,
    })
  })

  it('geeft null zodra alles op de basisvorm staat ("Terug naar basisvorm")', () => {
    expect(valideerAantallenOverride({ teams: [4, 2], neutralen: 0 }, VIER_TOT_ZES)).toBeNull()
    expect(valideerAantallenOverride({ teams: [null, null], neutralen: null }, VIER_TOT_ZES)).toBeNull()
    expect(valideerAantallenOverride({}, VIER_TOT_ZES)).toBeNull()
  })

  it('levert een teams-array van exact de lengte van de basisvorm', () => {
    expect(valideerAantallenOverride({ teams: [5, 2, 9, 9] }, VIER_TOT_ZES)).toEqual({
      teams: [5, null],
      neutralen: null,
    })
    expect(valideerAantallenOverride({ teams: [5] }, VIER_TOT_ZES)).toEqual({
      teams: [5, null],
      neutralen: null,
    })
  })

  it('clamt een waarde buiten het bereik in plaats van hem te weigeren', () => {
    expect(valideerAantallenOverride({ teams: [99, 99], neutralen: 99 }, VIER_TOT_ZES)).toEqual({
      teams: [6, null],
      neutralen: null,
    })
    expect(valideerAantallenOverride({ teams: [1, null] }, VIER_TOT_ZES)).toBeNull()
  })

  it('muteert de invoer niet', () => {
    const input = { teams: [99, 2], neutralen: 0 }
    valideerAantallenOverride(input, VIER_TOT_ZES)
    expect(input).toEqual({ teams: [99, 2], neutralen: 0 })
  })

  it('gooit "Ongeldige bezetting" bij een verkeerde vorm', () => {
    for (const rommel of ['x', [], 42, true, [1, 2]]) {
      expect(() => valideerAantallenOverride(rommel, VIER_TOT_ZES)).toThrow('Ongeldige bezetting')
    }
  })

  it('gooit als teams aanwezig is maar geen array', () => {
    expect(() => valideerAantallenOverride({ teams: 5 }, VIER_TOT_ZES)).toThrow('Ongeldige bezetting')
    expect(() => valideerAantallenOverride({ teams: { 0: 5 } }, VIER_TOT_ZES)).toThrow(
      'Ongeldige bezetting',
    )
  })

  it('gooit bij een niet-numeriek element', () => {
    expect(() => valideerAantallenOverride({ teams: ['5', null] }, VIER_TOT_ZES)).toThrow(
      'Ongeldige bezetting',
    )
    expect(() => valideerAantallenOverride({ teams: [Number.NaN, null] }, VIER_TOT_ZES)).toThrow(
      'Ongeldige bezetting',
    )
    expect(() => valideerAantallenOverride({ teams: [null, null], neutralen: 'x' }, VIER_TOT_ZES))
      .toThrow('Ongeldige bezetting')
  })

  it('behandelt 0 als een geldige waarde bij flexibele neutralen', () => {
    const b = basis({ teams: [team(4)], aantal_neutralen: 0, aantal_neutralen_max: 4 })
    // 0 is de basiswaarde → delta null → hele override null.
    expect(valideerAantallenOverride({ teams: [null], neutralen: 0 }, b)).toBeNull()
    expect(valideerAantallenOverride({ teams: [null], neutralen: 2 }, b)).toEqual({
      teams: [null],
      neutralen: 2,
    })
  })
})

// ────────────────────────────────────────────────
// Labels
// ────────────────────────────────────────────────
describe('vormLabel / bereikLabel / teamBereikLabel', () => {
  it('zet de teamgroottes aaneen met een v', () => {
    expect(vormLabel([team(4), team(2)])).toBe('4v2')
    expect(vormLabel([team(5), team(5)])).toBe('5v5')
  })

  it('slaat teams zonder spelers over en geeft leeg terug als er niets is', () => {
    expect(vormLabel([team(0), team(4)])).toBe('4')
    expect(vormLabel([])).toBe('')
    expect(vormLabel([team(0)])).toBe('')
  })

  it('toont bij een bereik beide vormen met een en-dash', () => {
    expect(bereikLabel(VIER_TOT_ZES)).toBe(`4v2${EN_DASH}6v2`)
    expect(bereikLabel(VIER_TOT_ZES)).toBe('4v2–6v2')
  })

  it('toont bij een exacte oefening één label (bestaand gedrag)', () => {
    expect(bereikLabel(basis({ teams: [team(4), team(2)] }))).toBe('4v2')
  })

  it('geeft per team "4" of "4–6"', () => {
    expect(teamBereikLabel(team(4))).toBe('4')
    expect(teamBereikLabel(team(4, { grootteMax: 6 }))).toBe(`4${EN_DASH}6`)
  })
})

describe('bereikLabelVoor', () => {
  it('geeft bij een punt-bereik alleen het getal', () => {
    expect(bereikLabelVoor({ min: 4, max: 4 })).toBe('4')
    // 0 is een geldig punt-bereik (neutralen); nooit '' of '0–0'.
    expect(bereikLabelVoor({ min: 0, max: 0 })).toBe('0')
  })

  it('geeft bij een echt bereik "min–max"', () => {
    expect(bereikLabelVoor({ min: 4, max: 6 })).toBe(`4${EN_DASH}6`)
    expect(bereikLabelVoor({ min: 0, max: 3 })).toBe(`0${EN_DASH}3`)
  })

  it('gebruikt een en-dash U+2013, geen hyphen-minus', () => {
    const label = bereikLabelVoor({ min: 4, max: 6 })
    expect(label).toBe('4–6')
    expect(label.charCodeAt(1)).toBe(0x2013)
    expect(label).not.toContain('-')
  })

  it('is de bron van teamBereikLabel — beide leveren exact dezelfde string', () => {
    // Bewaakt dat teamBereikLabel ongewijzigd gedrag houdt nu het op
    // bereikLabelVoor leunt: het label van een team is per definitie het label
    // van zijn bereik.
    const gevallen: OefeningTeam[] = [
      team(4),
      team(4, { grootteMax: 6 }),
      // formatie ⇒ exact, dus punt-bereik en dus '4'
      team(4, { grootteMax: 6, formaties: ['2-1-0'] }),
      // grootteMax buiten VALID_TEAM_SIZES ⇒ punt-bereik
      team(4, { grootteMax: 99 }),
      team(0),
    ]
    for (const tm of gevallen) {
      expect(teamBereikLabel(tm)).toBe(bereikLabelVoor(bereikVoorTeam(tm)))
    }
    expect(gevallen.map(teamBereikLabel)).toEqual(['4', `4${EN_DASH}6`, '4', '4', '0'])
  })
})

// ────────────────────────────────────────────────
// sorteerOpPassendheid
// ────────────────────────────────────────────────
describe('sorteerOpPassendheid', () => {
  const exact = { id: 'exact', ...basis({ teams: [team(5), team(5)] }) }
  const smal = { id: 'smal', ...basis({ teams: [team(4, { grootteMax: 5 }), team(2)] }) }
  const breed = { id: 'breed', ...basis({ teams: [team(4, { grootteMax: 8 }), team(2)] }) }

  it('zet exact vóór flexibel en het smalste bereik vooraan', () => {
    expect(sorteerOpPassendheid([breed, smal, exact]).map((o) => o.id)).toEqual([
      'exact',
      'smal',
      'breed',
    ])
  })

  it('laat een uitsluitend exacte lijst ongemoeid (stabiele sort)', () => {
    const lijst = [
      { id: 'a', ...basis({ teams: [team(4)] }) },
      { id: 'b', ...basis({ teams: [team(9), team(9)] }) },
      { id: 'c', ...basis({ teams: [team(2)] }) },
    ]
    expect(sorteerOpPassendheid(lijst).map((o) => o.id)).toEqual(['a', 'b', 'c'])
  })

  it('geeft een nieuwe array terug en muteert de invoer niet', () => {
    const lijst = [breed, exact]
    const uit = sorteerOpPassendheid(lijst)
    expect(uit).not.toBe(lijst)
    expect(lijst.map((o) => o.id)).toEqual(['breed', 'exact'])
  })
})
