import { describe, it, expect } from 'vitest'

import {
  AANWEZIGHEID_POSITIE_VOLGORDE,
  sorteerAanwezigheidslijst,
} from '@/lib/aanwezigheid-volgorde'
import { POSITIONS } from '@/lib/types'
import type { Player, PlayerType, Position } from '@/lib/types'

function speler(
  id: string,
  name: string,
  position: Position,
  opties: { type?: PlayerType; secondary?: Position[]; jersey?: number | null } = {},
): Player {
  return {
    id,
    name,
    position,
    secondary_positions: opties.secondary ?? [],
    jersey_number: opties.jersey ?? null,
    active: true,
    injured: false,
    type: opties.type ?? 'regular',
    rating: null,
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

const gast = (id: string, name: string, position: Position) =>
  speler(id, name, position, { type: 'guest' })

const namen = (players: Player[]) => players.map((p) => p.name)
const ids = (players: Player[]) => players.map((p) => p.id)

describe('AANWEZIGHEID_POSITIE_VOLGORDE', () => {
  it('bevat precies 12 posities, zonder dubbelen', () => {
    expect(AANWEZIGHEID_POSITIE_VOLGORDE).toHaveLength(12)
    expect(new Set(AANWEZIGHEID_POSITIE_VOLGORDE).size).toBe(12)
  })

  it('is dezelfde set als POSITIONS (alleen een andere volgorde)', () => {
    expect([...AANWEZIGHEID_POSITIE_VOLGORDE].sort()).toEqual([...POSITIONS].sort())
  })

  it('heeft de afgesproken veldvolgorde', () => {
    expect(AANWEZIGHEID_POSITIE_VOLGORDE).toEqual([
      'Keeper',
      'Rechtsachter',
      'Centrale verdediger',
      'Linksachter',
      'Defensieve middenvelder',
      'Centrale middenvelder',
      'Aanvallende middenvelder',
      'Rechtsmiddenvelder',
      'Linksmiddenvelder',
      'Rechtsbuiten',
      'Spits',
      'Linksbuiten',
    ])
  })
})

describe('sorteerAanwezigheidslijst', () => {
  it('splitst vaste spelers en gastspelers in twee blokken', () => {
    const players = [
      speler('p1', 'Anne', 'Spits'),
      gast('g1', 'Gijs', 'Keeper'),
      speler('p2', 'Bram', 'Keeper'),
      gast('g2', 'Fenna', 'Spits'),
    ]

    const { vast, gasten } = sorteerAanwezigheidslijst(players, 'nl-NL')

    expect(ids(vast)).toEqual(['p2', 'p1'])
    expect(ids(gasten)).toEqual(['g1', 'g2'])
  })

  it('sorteert 12 gehusselde posities in de afgesproken veldvolgorde', () => {
    const gehusseld: Position[] = [
      'Spits',
      'Linksachter',
      'Rechtsbuiten',
      'Keeper',
      'Centrale middenvelder',
      'Linksbuiten',
      'Rechtsachter',
      'Aanvallende middenvelder',
      'Defensieve middenvelder',
      'Linksmiddenvelder',
      'Centrale verdediger',
      'Rechtsmiddenvelder',
    ]
    // Namen in omgekeerde alfabetische volgorde t.o.v. de positie, zodat een
    // naam-sortering nooit per ongeluk dezelfde uitkomst geeft.
    const players = gehusseld.map((pos, i) =>
      speler(`p${i}`, String.fromCharCode(90 - i), pos),
    )

    const { vast } = sorteerAanwezigheidslijst(players, 'nl-NL')

    expect(vast.map((p) => p.position)).toEqual([...AANWEZIGHEID_POSITIE_VOLGORDE])
  })

  it('sorteert dezelfde volgorde ook binnen het gastenblok', () => {
    const players = [
      gast('g1', 'Anne', 'Linksbuiten'),
      gast('g2', 'Bram', 'Keeper'),
      gast('g3', 'Cas', 'Rechtsachter'),
    ]

    expect(ids(sorteerAanwezigheidslijst(players, 'nl-NL').gasten)).toEqual(['g2', 'g3', 'g1'])
  })

  it('sorteert bij gelijke positie op naam en negeert het rugnummer', () => {
    const players = [
      speler('p1', 'Sanne', 'Spits', { jersey: 1 }),
      speler('p2', 'Anne', 'Spits', { jersey: 99 }),
      speler('p3', 'Mila', 'Spits', { jersey: 7 }),
    ]

    expect(namen(sorteerAanwezigheidslijst(players, 'nl-NL').vast)).toEqual([
      'Anne',
      'Mila',
      'Sanne',
    ])
  })

  it('telt alleen de primaire positie, niet secondary_positions', () => {
    const players = [
      speler('p1', 'Anne', 'Spits', { secondary: ['Keeper'] }),
      speler('p2', 'Bram', 'Rechtsachter'),
    ]

    expect(namen(sorteerAanwezigheidslijst(players, 'nl-NL').vast)).toEqual(['Bram', 'Anne'])
  })

  it('zet een onbekende of lege positie achteraan, daarbinnen op naam', () => {
    const players = [
      speler('p1', 'Zoë', 'Onbekend' as Position),
      speler('p2', 'Bram', '' as Position),
      speler('p3', 'Anne', 'Linksbuiten'),
      speler('p4', 'Cas', 'Keeper'),
    ]

    expect(namen(sorteerAanwezigheidslijst(players, 'nl-NL').vast)).toEqual([
      'Cas',
      'Anne',
      'Bram',
      'Zoë',
    ])
  })

  it('valt bij gelijke positie en naam terug op het id, deterministisch', () => {
    const a = speler('b-id', 'Anne', 'Spits')
    const b = speler('a-id', 'Anne', 'Spits')
    const c = speler('c-id', 'Anne', 'Spits')

    const eerste = sorteerAanwezigheidslijst([a, b, c], 'nl-NL').vast
    const tweede = sorteerAanwezigheidslijst([c, a, b], 'nl-NL').vast
    const derde = sorteerAanwezigheidslijst([b, c, a], 'nl-NL').vast

    expect(ids(eerste)).toEqual(['a-id', 'b-id', 'c-id'])
    expect(ids(tweede)).toEqual(ids(eerste))
    expect(ids(derde)).toEqual(ids(eerste))
  })

  it('sorteert accenten taalcorrect (Ödegaard naast Odegaard, niet achter Z)', () => {
    const players = [
      speler('p1', 'Zander', 'Spits'),
      speler('p2', 'Ödegaard', 'Spits'),
      speler('p3', 'Odegaard', 'Spits'),
      speler('p4', 'Anne', 'Spits'),
    ]

    const volgorde = namen(sorteerAanwezigheidslijst(players, 'nl-NL').vast)

    expect(volgorde[0]).toBe('Anne')
    expect(volgorde[3]).toBe('Zander')
    expect(volgorde.slice(1, 3).sort()).toEqual(['Odegaard', 'Ödegaard'])
  })

  it('geeft twee lege blokken bij lege input', () => {
    expect(sorteerAanwezigheidslijst([], 'nl-NL')).toEqual({ vast: [], gasten: [] })
  })

  it('geeft een leeg vast-blok als er alleen gasten zijn', () => {
    const players = [gast('g1', 'Bram', 'Spits'), gast('g2', 'Anne', 'Keeper')]

    const { vast, gasten } = sorteerAanwezigheidslijst(players, 'nl-NL')

    expect(vast).toEqual([])
    expect(ids(gasten)).toEqual(['g2', 'g1'])
  })

  it('geeft een leeg gastenblok als er geen gasten zijn', () => {
    const players = [speler('p1', 'Bram', 'Spits'), speler('p2', 'Anne', 'Keeper')]

    const { vast, gasten } = sorteerAanwezigheidslijst(players, 'nl-NL')

    expect(ids(vast)).toEqual(['p2', 'p1'])
    expect(gasten).toEqual([])
  })

  it('muteert de input niet', () => {
    const players = [
      speler('p1', 'Sanne', 'Spits'),
      gast('g1', 'Gijs', 'Keeper'),
      speler('p2', 'Anne', 'Keeper'),
    ]
    const kopie = structuredClone(players)
    const volgordeVooraf = [...players]

    const { vast, gasten } = sorteerAanwezigheidslijst(players, 'nl-NL')

    expect(players).toEqual(kopie)
    players.forEach((p, i) => expect(p).toBe(volgordeVooraf[i]))
    expect(vast).not.toBe(players)
    expect(gasten).not.toBe(players)
  })

  it('zet elk type dat niet "guest" is in het vaste blok', () => {
    const players = [
      speler('p1', 'Anne', 'Spits', { type: 'regular' }),
      speler('p2', 'Bram', 'Spits', { type: 'onbekend' as PlayerType }),
      gast('g1', 'Cas', 'Spits'),
    ]

    const { vast, gasten } = sorteerAanwezigheidslijst(players, 'nl-NL')

    expect(ids(vast)).toEqual(['p1', 'p2'])
    expect(ids(gasten)).toEqual(['g1'])
  })
})
