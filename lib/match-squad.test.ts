import { describe, it, expect } from 'vitest'

import { sortSquadForExport } from '@/lib/match-squad'
import type { Player, Position } from '@/lib/types'

function speler(
  id: string,
  name: string,
  position: Position,
  secondary: Position[] = [],
): Player {
  return {
    id,
    name,
    position,
    secondary_positions: secondary,
    jersey_number: null,
    active: true,
    injured: false,
    rating: null,
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

const namen = (players: Player[]) => players.map((p) => p.name)

describe('sortSquadForExport', () => {
  it('zet keepers vooraan (alfabetisch) en veldspelers erna (alfabetisch)', () => {
    const players = [
      speler('p1', 'Sanne', 'Spits'),
      speler('p2', 'Bram', 'Keeper'),
      speler('p3', 'Anne', 'Centrale verdediger'),
      speler('p4', 'Aisha', 'Keeper'),
    ]

    expect(namen(sortSquadForExport(players, 'nl'))).toEqual(['Aisha', 'Bram', 'Anne', 'Sanne'])
  })

  it('telt alleen de primaire positie mee, niet secondary_positions', () => {
    const players = [
      speler('p1', 'Zara', 'Keeper'),
      // Kan keepen, maar is primair veldspeler → hoort bij de veldspelers.
      speler('p2', 'Aisha', 'Centrale verdediger', ['Keeper']),
    ]

    const sorted = sortSquadForExport(players, 'nl')
    expect(namen(sorted)).toEqual(['Zara', 'Aisha'])
    expect(sorted[0].position).toBe('Keeper')
  })

  it('geeft een platte array terug met dezelfde lengte als de input', () => {
    const players = [
      speler('p1', 'Bram', 'Keeper'),
      speler('p2', 'Anne', 'Spits'),
      speler('p3', 'Chris', 'Rechtsachter'),
    ]

    const sorted = sortSquadForExport(players, 'nl')
    expect(Array.isArray(sorted)).toBe(true)
    expect(sorted).toHaveLength(3)
    expect(sorted.every((p) => typeof p.id === 'string')).toBe(true)
  })

  it('sorteert een selectie met alleen keepers gewoon alfabetisch', () => {
    const players = [
      speler('p1', 'Chris', 'Keeper'),
      speler('p2', 'Aisha', 'Keeper'),
      speler('p3', 'Bram', 'Keeper'),
    ]

    expect(namen(sortSquadForExport(players, 'nl'))).toEqual(['Aisha', 'Bram', 'Chris'])
  })

  it('sorteert een selectie zonder keepers gewoon alfabetisch', () => {
    const players = [
      speler('p1', 'Chris', 'Spits'),
      speler('p2', 'Aisha', 'Linksachter'),
      speler('p3', 'Bram', 'Centrale middenvelder'),
    ]

    expect(namen(sortSquadForExport(players, 'nl'))).toEqual(['Aisha', 'Bram', 'Chris'])
  })

  it('valt bij identieke namen terug op het id (stabiele volgorde)', () => {
    const players = [
      speler('p3', 'Jan Jansen', 'Spits'),
      speler('p1', 'Jan Jansen', 'Linksbuiten'),
      speler('p2', 'Jan Jansen', 'Rechtsachter'),
    ]

    expect(sortSquadForExport(players, 'nl').map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('sorteert diakrieten en kleine letters taalcorrect (geen ASCII-volgorde)', () => {
    const players = [
      speler('p1', 'Zeeman', 'Spits'),
      speler('p2', 'Ödegaard', 'Centrale middenvelder'),
      speler('p3', 'de Vries', 'Rechtsachter'),
      speler('p4', 'van der Berg', 'Linksachter'),
    ]

    const sorted = namen(sortSquadForExport(players, 'nl'))
    expect(sorted).toEqual(['de Vries', 'Ödegaard', 'van der Berg', 'Zeeman'])
    // ASCII-sortering zou 'Zeeman' vóór 'de Vries' en 'Ödegaard' zetten.
    expect(sorted.indexOf('Zeeman')).toBeGreaterThan(sorted.indexOf('de Vries'))
    expect(sorted.indexOf('Zeeman')).toBeGreaterThan(sorted.indexOf('Ödegaard'))
  })

  it('muteert de input niet', () => {
    const players = [
      speler('p1', 'Zara', 'Spits'),
      speler('p2', 'Aisha', 'Keeper'),
    ]
    const origineel = players.map((p) => p.id)

    sortSquadForExport(players, 'nl')

    expect(players.map((p) => p.id)).toEqual(origineel)
  })

  it('geeft een lege array bij lege input', () => {
    expect(sortSquadForExport([], 'nl')).toEqual([])
  })
})
