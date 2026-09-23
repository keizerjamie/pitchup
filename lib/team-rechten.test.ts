// Unit-tests voor lib/team-rechten.ts — de vertaling tussen de zes
// boolean-kolommen op team_members en het TeamRechten-object dat de rest van
// de app gebruikt.

import { describe, it, expect } from 'vitest'
import {
  ALLE_RECHTEN,
  GEEN_RECHTEN,
  ONDERDELEN,
  RECHT_KOLOM,
  isOnderdeel,
  rechtenNaarKolommen,
  rechtenUitRij,
} from '@/lib/team-rechten'

describe('ONDERDELEN en RECHT_KOLOM', () => {
  it('heeft precies zes onderdelen — hetzelfde zestal als de kolommen op team_members en de case-takken van can_edit()', () => {
    expect(ONDERDELEN).toEqual([
      'spelers', 'agenda', 'aanwezigheid', 'wedstrijd', 'training', 'periodisering',
    ])
  })

  it('heeft voor elk onderdeel precies één, unieke kolomnaam', () => {
    const kolommen = ONDERDELEN.map((o) => RECHT_KOLOM[o])
    expect(kolommen).toHaveLength(ONDERDELEN.length)
    expect(new Set(kolommen).size).toBe(ONDERDELEN.length)
    for (const kolom of kolommen) expect(kolom).toMatch(/^mag_[a-z]+_bewerken$/)
  })
})

describe('GEEN_RECHTEN / ALLE_RECHTEN', () => {
  it('GEEN_RECHTEN is de default bij een nieuwe koppeling: alles uit', () => {
    for (const o of ONDERDELEN) expect(GEEN_RECHTEN[o], o).toBe(false)
  })

  it('ALLE_RECHTEN is alles aan', () => {
    for (const o of ONDERDELEN) expect(ALLE_RECHTEN[o], o).toBe(true)
  })

  it('zijn bevroren — een aanroeper die erin schrijft zou anders de rechten van elke volgende aanroep wijzigen', () => {
    expect(Object.isFrozen(GEEN_RECHTEN)).toBe(true)
    expect(Object.isFrozen(ALLE_RECHTEN)).toBe(true)
  })
})

describe('rechtenUitRij', () => {
  it('leest elk recht uit zijn eigen kolom', () => {
    expect(rechtenUitRij({
      mag_spelers_bewerken: true,
      mag_agenda_bewerken: false,
      mag_aanwezigheid_bewerken: true,
      mag_wedstrijd_bewerken: false,
      mag_training_bewerken: true,
      mag_periodisering_bewerken: false,
    })).toEqual({
      spelers: true, agenda: false, aanwezigheid: true,
      wedstrijd: false, training: true, periodisering: false,
    })
  })

  it('behandelt een ontbrekende kolom als "geen recht" — nooit als true', () => {
    expect(rechtenUitRij({})).toEqual(GEEN_RECHTEN)
  })

  it('accepteert alleen een echte boolean true; "true", 1 en null tellen niet mee', () => {
    const rechten = rechtenUitRij({
      mag_spelers_bewerken: 'true',
      mag_agenda_bewerken: 1,
      mag_training_bewerken: null,
    })
    expect(rechten.spelers).toBe(false)
    expect(rechten.agenda).toBe(false)
    expect(rechten.training).toBe(false)
  })

  it('geeft telkens een NIEUW object terug, geen gedeelde referentie', () => {
    const a = rechtenUitRij({})
    const b = rechtenUitRij({})
    expect(a).not.toBe(b)
  })
})

describe('rechtenNaarKolommen', () => {
  it('schrijft alle zes kolommen, ook de false-waarden — een ontbrekende kolom zou de oude waarde laten staan', () => {
    const kolommen = rechtenNaarKolommen({ ...GEEN_RECHTEN, training: true })
    expect(Object.keys(kolommen).sort()).toEqual(ONDERDELEN.map((o) => RECHT_KOLOM[o]).sort())
    expect(kolommen.mag_training_bewerken).toBe(true)
    expect(kolommen.mag_spelers_bewerken).toBe(false)
  })

  it('is de exacte omkering van rechtenUitRij', () => {
    const origineel = { ...GEEN_RECHTEN, wedstrijd: true, periodisering: true }
    expect(rechtenUitRij(rechtenNaarKolommen(origineel))).toEqual(origineel)
  })
})

describe('isOnderdeel', () => {
  it('herkent elk geldig onderdeel', () => {
    for (const o of ONDERDELEN) expect(isOnderdeel(o)).toBe(true)
  })

  it('wijst alles daarbuiten af — een onbekend onderdeel valt dicht, net als in can_edit()', () => {
    for (const waarde of ['instellingen', 'SPELERS', '', null, undefined, 0, {}]) {
      expect(isOnderdeel(waarde), String(waarde)).toBe(false)
    }
  })
})
