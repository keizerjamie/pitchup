import { describe, it, expect } from 'vitest'
import { ACTIE_HREF, BREDE_KAARTEN, THEMAS, koppelSignalen, verdeelOverThemas } from './inzichten-indeling'

const ids = (...x: string[]) => x.map((id) => ({ id }))

describe('koppelSignalen', () => {
  const tabel: [string, string, string][] = [
    ['spelers-onder-drempel', 'topWorstAanwezigheid', 'spelers'],
    ['opkomst-onder-doel', 'opkomstPerMaand', 'kalender'],
    ['opkomst-boven-doel', 'opkomstPerMaand', 'kalender'],
    ['rating-daling', 'ratings', 'spelers'],
    ['rating-stijging', 'ratings', 'spelers'],
    ['doelsaldo-negatief', 'thuisUit', 'kalender'],
    ['doelsaldo-positief', 'thuisUit', 'kalender'],
    ['speler-daler', 'stijgersDalers', 'spelers'],
    ['speler-stijger', 'stijgersDalers', 'spelers'],
    ['positie-zonder-fit', 'positiedekking', 'spelers'],
  ]
  it.each(tabel)('koppelt %s aan %s met actie %s', (id, kaart, actie) => {
    const { conclusies, verhuisd } = koppelSignalen(ids(id))
    expect(conclusies).toEqual([{ signaalId: id, kaart, actie, zelfdeGrafiek: false }])
    expect(verhuisd.has(kaart as never)).toBe(true)
  })

  it('geeft daler en stijger één kaart; de tweede krijgt zelfdeGrafiek', () => {
    const { conclusies, verhuisd } = koppelSignalen(ids('speler-daler', 'speler-stijger'))
    expect(conclusies[0]).toMatchObject({ kaart: 'stijgersDalers', zelfdeGrafiek: false })
    expect(conclusies[1]).toEqual({ signaalId: 'speler-stijger', kaart: null, actie: 'spelers', zelfdeGrafiek: true })
    expect(verhuisd.size).toBe(1)
  })

  it('geeft een onbekend id geen kaart en geen actie', () => {
    const { conclusies, verhuisd } = koppelSignalen(ids('onbekend'))
    expect(conclusies).toEqual([{ signaalId: 'onbekend', kaart: null, actie: null, zelfdeGrafiek: false }])
    expect(verhuisd.size).toBe(0)
  })

  it('geeft bij 0 signalen niets', () => {
    const { conclusies, verhuisd } = koppelSignalen([])
    expect(conclusies).toEqual([])
    expect(verhuisd.size).toBe(0)
  })
})

describe('THEMAS', () => {
  it('bevat 25 unieke kaarten verdeeld 8/6/6/5', () => {
    expect(THEMAS.map((t) => t.kaarten.length)).toEqual([8, 6, 6, 5])
    const alle = THEMAS.flatMap((t) => t.kaarten)
    expect(alle).toHaveLength(25)
    expect(new Set(alle).size).toBe(25)
  })
  it('staat alleen team standaard open', () => {
    expect(THEMAS.filter((t) => t.standaardOpen).map((t) => t.sleutel)).toEqual(['team'])
  })
  it('kent de vier brede kaarten', () => {
    expect([...BREDE_KAARTEN].sort()).toEqual(['belasting', 'opkomstSelectieRating', 'speelkansen', 'vorm'])
  })
  it('koppelt acties aan de juiste paden', () => {
    expect(ACTIE_HREF).toEqual({ spelers: '/players', kalender: '/events' })
  })
})

describe('verdeelOverThemas', () => {
  it('geeft zonder verhuisde kaarten alle vier de thema’s', () => {
    expect(verdeelOverThemas(new Set()).map((t) => t.sleutel)).toEqual(['team', 'wedstrijden', 'spelers', 'training'])
  })
  it('haalt verhuisde kaarten weg en behoudt de volgorde', () => {
    const r = verdeelOverThemas(new Set(['ratings', 'thuisUit']))
    expect(r[0].kaarten).not.toContain('ratings')
    expect(r[0].kaarten).toHaveLength(7)
    expect(r[1].kaarten[0]).toBe('formatie')
  })
  it('laat een leeg thema weg', () => {
    const r = verdeelOverThemas(new Set(THEMAS[1].kaarten))
    expect(r.map((t) => t.sleutel)).toEqual(['team', 'spelers', 'training'])
  })
})
