import { describe, it, expect } from 'vitest'
import {
  WEERGAVES,
  WEERGAVE_STANDAARD,
  isWeergave,
  bouwAanwezigheidsoverzicht,
  heeftOverzichtData,
  formatPercentage,
  type OverzichtRpcRij,
} from '@/lib/aanwezigheidsoverzicht'
import { berekenAanwezigheidPercentage } from '@/lib/inzichten'
import type { Player, PlayerType } from '@/lib/types'

type Speler = Pick<Player, 'id' | 'name' | 'active' | 'type'>

function speler(id: string, name: string, over: { active?: boolean; type?: PlayerType } = {}): Speler {
  return { id, name, active: over.active ?? true, type: over.type ?? 'regular' }
}

function rpc(player_id: string, aanwezig: number, afwezig: number, geblesseerd: number): OverzichtRpcRij {
  return { player_id, naam: `rpc-${player_id}`, aanwezig, afwezig, geblesseerd }
}

describe('isWeergave', () => {
  it('accepteert precies de twee weergaves', () => {
    expect(WEERGAVES).toEqual(['lijst', 'aanwezigheid'])
    expect(WEERGAVE_STANDAARD).toBe('lijst')
    expect(isWeergave('lijst')).toBe(true)
    expect(isWeergave('aanwezigheid')).toBe(true)
  })

  it('weigert al het andere', () => {
    for (const w of ['', 'Aanwezigheid', 'overzicht', undefined, null, 1, ['lijst']]) {
      expect(isWeergave(w)).toBe(false)
    }
  })
})

describe('bouwAanwezigheidsoverzicht — percentages', () => {
  it('AC5/AC6: P=8, A=2, B=2 → incl. 67%, zonder 80%', () => {
    const [rij] = bouwAanwezigheidsoverzicht([speler('p1', 'Anna')], [rpc('p1', 8, 2, 2)], 'nl-NL')
    expect(rij).toEqual({
      playerId: 'p1',
      naam: 'Anna',
      aanwezig: 8,
      afwezig: 2,
      geblesseerd: 2,
      pctIncl: 67,
      pctZonder: 80,
    })
    expect(formatPercentage(rij.pctIncl)).toBe('67%')
    expect(formatPercentage(rij.pctZonder)).toBe('80%')
  })

  it('pctIncl is gelijk aan het /inzichten-percentage met afwezig = A + B', () => {
    const [rij] = bouwAanwezigheidsoverzicht([speler('p1', 'Anna')], [rpc('p1', 13, 4, 3)], 'nl-NL')
    expect(rij.pctIncl).toBe(berekenAanwezigheidPercentage(13, 4 + 3))
  })

  it('AC22: P=0, A=0, B>0 → incl. 0% en zonder "—"', () => {
    const [rij] = bouwAanwezigheidsoverzicht([speler('p1', 'Anna')], [rpc('p1', 0, 0, 3)], 'nl-NL')
    expect(rij.pctIncl).toBe(0)
    expect(rij.pctZonder).toBeNull()
    expect(formatPercentage(rij.pctIncl)).toBe('0%')
    expect(formatPercentage(rij.pctZonder)).toBe('—')
  })

  it('AC21: noemer 0 → null, nooit 0%', () => {
    const [rij] = bouwAanwezigheidsoverzicht([speler('p1', 'Anna')], [rpc('p1', 0, 0, 0)], 'nl-NL')
    expect(rij.pctIncl).toBeNull()
    expect(rij.pctZonder).toBeNull()
  })

  it('een speler zonder RPC-rij → 0/0/0 met "—"/"—"', () => {
    const [rij] = bouwAanwezigheidsoverzicht([speler('p1', 'Anna')], [], 'nl-NL')
    expect(rij).toEqual({
      playerId: 'p1',
      naam: 'Anna',
      aanwezig: 0,
      afwezig: 0,
      geblesseerd: 0,
      pctIncl: null,
      pctZonder: null,
    })
    expect(formatPercentage(rij.pctIncl)).toBe('—')
    expect(formatPercentage(rij.pctZonder)).toBe('—')
  })

  it('neemt de naam uit de spelerslijst, niet uit de RPC', () => {
    const [rij] = bouwAanwezigheidsoverzicht([speler('p1', 'Anna')], [rpc('p1', 1, 0, 0)], 'nl-NL')
    expect(rij.naam).toBe('Anna')
  })
})

describe('bouwAanwezigheidsoverzicht — selectie en volgorde', () => {
  it('laat inactieve spelers en gasten weg (besluit 2), ook als de RPC ze zou leveren', () => {
    const rijen = bouwAanwezigheidsoverzicht(
      [
        speler('p1', 'Anna'),
        speler('p2', 'Bram', { active: false }),
        speler('g1', 'Gast', { type: 'guest' }),
      ],
      [rpc('p1', 1, 0, 0), rpc('p2', 5, 0, 0), rpc('g1', 5, 0, 0)],
      'nl-NL',
    )
    expect(rijen.map((r) => r.playerId)).toEqual(['p1'])
  })

  it('negeert RPC-rijen van spelers die niet in de spelerslijst staan', () => {
    const rijen = bouwAanwezigheidsoverzicht([speler('p1', 'Anna')], [rpc('vreemd', 9, 9, 9)], 'nl-NL')
    expect(rijen.map((r) => r.playerId)).toEqual(['p1'])
  })

  it('sorteert alfabetisch op naam (locale-bewust) met het id als tie-break', () => {
    const rijen = bouwAanwezigheidsoverzicht(
      [
        speler('z', 'Émile'),
        speler('b', 'daan'),
        speler('c', 'Anna'),
        speler('a', 'Anna'),
        speler('d', 'Bram'),
      ],
      [],
      'nl-NL',
    )
    expect(rijen.map((r) => r.playerId)).toEqual(['a', 'c', 'd', 'b', 'z'])
  })

  it('muteert de invoer niet', () => {
    const spelers = [speler('b', 'Bram'), speler('a', 'Anna')]
    const rpcRijen = [rpc('a', 1, 2, 3)]
    const spelersKopie = spelers.map((s) => ({ ...s }))
    const rpcKopie = rpcRijen.map((r) => ({ ...r }))
    bouwAanwezigheidsoverzicht(spelers, rpcRijen, 'nl-NL')
    expect(spelers).toEqual(spelersKopie)
    expect(rpcRijen).toEqual(rpcKopie)
  })

  it('lege invoer → lege lijst', () => {
    expect(bouwAanwezigheidsoverzicht([], [], 'nl-NL')).toEqual([])
  })
})

describe('heeftOverzichtData', () => {
  it('geen rijen → false', () => {
    expect(heeftOverzichtData([])).toBe(false)
  })

  it('alleen 0-registraties → false', () => {
    const rijen = bouwAanwezigheidsoverzicht([speler('p1', 'Anna'), speler('p2', 'Bram')], [], 'nl-NL')
    expect(heeftOverzichtData(rijen)).toBe(false)
  })

  it('één speler met alleen een blessure → true', () => {
    const rijen = bouwAanwezigheidsoverzicht(
      [speler('p1', 'Anna'), speler('p2', 'Bram')],
      [rpc('p2', 0, 0, 1)],
      'nl-NL',
    )
    expect(heeftOverzichtData(rijen)).toBe(true)
  })
})

describe('formatPercentage', () => {
  it('null → "—", getal → "<n>%"', () => {
    expect(formatPercentage(null)).toBe('—')
    expect(formatPercentage(0)).toBe('0%')
    expect(formatPercentage(100)).toBe('100%')
    expect(formatPercentage(67)).toBe('67%')
  })
})
