import { describe, it, expect } from 'vitest'
import { validateSpelerindeling, autoAssignTeams } from '@/lib/spelerindeling'
import type { OefeningTeam, Player, Position } from '@/lib/types'

function makePlayer(over: Partial<Player> & { id: string }): Player {
  return {
    id: over.id,
    name: over.name ?? over.id,
    position: (over.position ?? 'Centrale middenvelder') as Position,
    secondary_positions: over.secondary_positions ?? [],
    jersey_number: over.jersey_number ?? null,
    active: over.active ?? true,
    injured: over.injured ?? false,
    rating: over.rating ?? 5,
    created_at: over.created_at ?? '2024-01-01T00:00:00Z',
  }
}

// Speler met een positie die het Player-type niet (meer) kent — defensief:
// autoAssignTeams moet zulke spelers in de "rest"-groep verdelen, niet
// stilzwijgend overslaan.
function makePlayerZonderPositie(over: { id: string; rating?: number; position?: unknown }): Player {
  return {
    ...makePlayer({ id: over.id, rating: over.rating }),
    position: (over.position ?? null) as Position,
  }
}

// ────────────────────────────────────────────────
// validateSpelerindeling
// ────────────────────────────────────────────────
describe('validateSpelerindeling', () => {
  const own = new Set(['p1', 'p2', 'p3', 'p4'])

  it('normaliseert een geldige indeling en houdt de sub-array-structuur', () => {
    const clean = validateSpelerindeling([['p1', 'p2'], ['p3']], { teamCount: 2, ownPlayerIds: own })
    expect(clean).toEqual([['p1', 'p2'], ['p3']])
  })

  it('staat een lege indeling toe', () => {
    expect(validateSpelerindeling([], { teamCount: 2, ownPlayerIds: own })).toEqual([])
  })

  it('gooit als de input geen array is', () => {
    expect(() => validateSpelerindeling('nope', { teamCount: 2, ownPlayerIds: own }))
      .toThrow('Ongeldige spelerindeling')
  })

  it('gooit als er meer teams zijn dan de oefening kent', () => {
    expect(() => validateSpelerindeling([['p1'], ['p2'], ['p3']], { teamCount: 2, ownPlayerIds: own }))
      .toThrow('Team bestaat niet in deze oefening')
  })

  it('gooit "Speler niet gevonden" bij een player_id buiten de tenant', () => {
    expect(() => validateSpelerindeling([['p1', 'vreemd']], { teamCount: 2, ownPlayerIds: own }))
      .toThrow('Speler niet gevonden')
  })

  it('gooit "Speler in meerdere teams" bij een duplicaat over teams', () => {
    expect(() => validateSpelerindeling([['p1'], ['p1']], { teamCount: 2, ownPlayerIds: own }))
      .toThrow('Speler in meerdere teams')
  })

  it('gooit als een sub-array geen array is', () => {
    expect(() => validateSpelerindeling(['p1', 'p2'], { teamCount: 2, ownPlayerIds: own }))
      .toThrow('Ongeldige spelerindeling')
  })

  it('gooit als een element geen string is', () => {
    expect(() => validateSpelerindeling([[1, 2]], { teamCount: 2, ownPlayerIds: own }))
      .toThrow('Ongeldige spelerindeling')
  })
})

// ────────────────────────────────────────────────
// autoAssignTeams
// ────────────────────────────────────────────────
describe('autoAssignTeams', () => {
  const teams2x2: OefeningTeam[] = [
    { grootte: 2, formaties: [] },
    { grootte: 2, formaties: [] },
  ]

  it('verdeelt aanwezigen gebalanceerd over teams-met-grootte (snake op rating)', () => {
    const present = [
      makePlayer({ id: 'a', rating: 9 }),
      makePlayer({ id: 'b', rating: 8 }),
      makePlayer({ id: 'c', rating: 7 }),
      makePlayer({ id: 'd', rating: 6 }),
    ]
    const result = autoAssignTeams({ teams: teams2x2, current: [[], []], presentPlayers: present })
    // Snake: team0 krijgt de hoogste (a), team1 de 2e (b), dan terug: team1 (c), team0 (d).
    expect(result).toEqual([['a', 'd'], ['b', 'c']])
    // Beide teams gelijkwaardig: 9+6 = 8+7.
  })

  it('vult alleen open plekken; bestaande toewijzingen blijven staan', () => {
    const present = [
      makePlayer({ id: 'a', rating: 9 }),
      makePlayer({ id: 'x', rating: 5 }), // al ingedeeld
      makePlayer({ id: 'c', rating: 7 }),
    ]
    const result = autoAssignTeams({
      teams: teams2x2,
      current: [['x'], []],
      presentPlayers: present,
    })
    // team0 heeft nog 1 plek, team1 nog 2. 'x' blijft; 'a' en 'c' worden verdeeld.
    expect(result[0]).toContain('x')
    expect(result[0]).toHaveLength(2)
    expect(result[1]).toHaveLength(1)
    const flat = result.flat()
    expect(flat).toContain('a')
    expect(flat).toContain('c')
    // 'x' niet dubbel toegevoegd.
    expect(flat.filter((id) => id === 'x')).toHaveLength(1)
  })

  it('muteert current niet in place', () => {
    const current = [[], []] as string[][]
    autoAssignTeams({
      teams: teams2x2,
      current,
      presentPlayers: [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })],
    })
    expect(current).toEqual([[], []])
  })

  it('legt het overschot in een team zonder grootte (losse plaatsing, onbeperkt)', () => {
    const teams: OefeningTeam[] = [
      { grootte: 2, formaties: [] },
      { grootte: 0, formaties: [] }, // losse plaatsing
    ]
    const present = [
      makePlayer({ id: 'a', rating: 9 }),
      makePlayer({ id: 'b', rating: 8 }),
      makePlayer({ id: 'c', rating: 7 }),
      makePlayer({ id: 'd', rating: 6 }),
      makePlayer({ id: 'e', rating: 5 }),
    ]
    const result = autoAssignTeams({ teams, current: [[], []], presentPlayers: present })
    // Team-met-grootte krijgt 2 spelers; de rest gaat naar het losse team.
    expect(result[0]).toHaveLength(2)
    expect(result[1]).toHaveLength(3)
    expect(result.flat().sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('laat het overschot in de pool als er geen los team is', () => {
    const present = [
      makePlayer({ id: 'a' }),
      makePlayer({ id: 'b' }),
      makePlayer({ id: 'c' }),
      makePlayer({ id: 'd' }),
      makePlayer({ id: 'e' }),
    ]
    const result = autoAssignTeams({ teams: teams2x2, current: [[], []], presentPlayers: present })
    // Maar 4 plekken; de 5e speler blijft buiten de indeling.
    expect(result.flat()).toHaveLength(4)
  })

  it('verdeelt het overschot gebalanceerd over meerdere losse teams', () => {
    const teams: OefeningTeam[] = [
      { grootte: 0, formaties: [] },
      { grootte: 0, formaties: [] },
    ]
    const present = [
      makePlayer({ id: 'a', rating: 9 }),
      makePlayer({ id: 'b', rating: 8 }),
      makePlayer({ id: 'c', rating: 7 }),
    ]
    const result = autoAssignTeams({ teams, current: [[], []], presentPlayers: present })
    // Geen teams-met-grootte: alle drie zijn overschot en worden snake verdeeld
    // (1 om 2, gebalanceerd). Alle spelers zijn ingedeeld, niemand dubbel.
    expect(result[0]).toHaveLength(1)
    expect(result[1]).toHaveLength(2)
    expect(result.flat().sort()).toEqual(['a', 'b', 'c'])
  })
})

// ────────────────────────────────────────────────
// autoAssignTeams — spreiding per positiegroep
// ────────────────────────────────────────────────
// De verdeling loopt per POSITION_GROUPS-groep (Keepers → Verdedigers →
// Middenvelders → Aanvallers, daarna de rest), binnen elke groep op rating, via
// één DOORLOPENDE snake-draft over alle open plekken.
describe('autoAssignTeams — spreiding per positiegroep', () => {
  const teams2x3: OefeningTeam[] = [
    { grootte: 3, formaties: [] },
    { grootte: 3, formaties: [] },
  ]

  it('zet twee keepers in verschillende teams (kerngeval)', () => {
    const present = [
      makePlayer({ id: 'k1', position: 'Keeper', rating: 8 }),
      makePlayer({ id: 'k2', position: 'Keeper', rating: 6 }),
      makePlayer({ id: 'v1', position: 'Centrale verdediger', rating: 9 }),
      makePlayer({ id: 'v2', position: 'Linksachter', rating: 7 }),
      makePlayer({ id: 'm1', position: 'Centrale middenvelder', rating: 8 }),
      makePlayer({ id: 'a1', position: 'Spits', rating: 5 }),
    ]
    const result = autoAssignTeams({ teams: teams2x3, current: [[], []], presentPlayers: present })

    const teamVan = (id: string) => result.findIndex((t) => t.includes(id))
    expect(teamVan('k1')).not.toBe(-1)
    expect(teamVan('k2')).not.toBe(-1)
    expect(teamVan('k1')).not.toBe(teamVan('k2'))

    // Deterministisch: keepers eerst (k1→team0, k2→team1), dan verdedigers met
    // een doorlopende snake (v1→team1, v2→team0), dan midden/aanval.
    expect(result).toEqual([
      ['k1', 'v2', 'm1'],
      ['k2', 'v1', 'a1'],
    ])
  })

  it('spreidt elke positiegroep: 4 verdedigers en 4 aanvallers over 2 teams → 2+2 per team', () => {
    const teams2x4: OefeningTeam[] = [
      { grootte: 4, formaties: [] },
      { grootte: 4, formaties: [] },
    ]
    const present = [
      makePlayer({ id: 'v9', position: 'Centrale verdediger', rating: 9 }),
      makePlayer({ id: 'v8', position: 'Linksachter', rating: 8 }),
      makePlayer({ id: 'v7', position: 'Rechtsachter', rating: 7 }),
      makePlayer({ id: 'v6', position: 'Centrale verdediger', rating: 6 }),
      makePlayer({ id: 'a9', position: 'Spits', rating: 9 }),
      makePlayer({ id: 'a8', position: 'Linksbuiten', rating: 8 }),
      makePlayer({ id: 'a7', position: 'Rechtsbuiten', rating: 7 }),
      makePlayer({ id: 'a6', position: 'Spits', rating: 6 }),
    ]
    const result = autoAssignTeams({ teams: teams2x4, current: [[], []], presentPlayers: present })

    for (const team of result) {
      expect(team.filter((id) => id.startsWith('v'))).toHaveLength(2)
      expect(team.filter((id) => id.startsWith('a'))).toHaveLength(2)
    }
    // En de ratings blijven in balans: 9+6+9+6 = 8+7+8+7 = 30.
    const som = (team: string[]) =>
      team.reduce((n, id) => n + (present.find((p) => p.id === id)?.rating ?? 0), 0)
    expect(som(result[0])).toBe(som(result[1]))
  })

  it('balanceert op rating binnen een groep: de twee sterkste spelers van een groep komen niet samen', () => {
    const present = [
      makePlayer({ id: 'm10', position: 'Centrale middenvelder', rating: 10 }),
      makePlayer({ id: 'm9', position: 'Defensieve middenvelder', rating: 9 }),
      makePlayer({ id: 'm8', position: 'Aanvallende middenvelder', rating: 8 }),
      makePlayer({ id: 'm7', position: 'Linksmiddenvelder', rating: 7 }),
      makePlayer({ id: 'm6', position: 'Rechtsmiddenvelder', rating: 6 }),
      makePlayer({ id: 'm5', position: 'Centrale middenvelder', rating: 5 }),
    ]
    const result = autoAssignTeams({ teams: teams2x3, current: [[], []], presentPlayers: present })

    const teamVan = (id: string) => result.findIndex((t) => t.includes(id))
    expect(teamVan('m10')).not.toBe(teamVan('m9'))
    // Snake binnen de groep: 10+7+6 = 23 vs 9+8+5 = 22 — hooguit 1 verschil.
    const som = (team: string[]) =>
      team.reduce((n, id) => n + (present.find((p) => p.id === id)?.rating ?? 0), 0)
    expect(Math.abs(som(result[0]) - som(result[1]))).toBeLessThanOrEqual(1)
  })

  it('laat de snake doorlopen over de groepen heen: team 0 krijgt niet van élke groep de beste', () => {
    const present = [
      makePlayer({ id: 'k1', position: 'Keeper', rating: 8 }),
      makePlayer({ id: 'k2', position: 'Keeper', rating: 6 }),
      makePlayer({ id: 'v1', position: 'Centrale verdediger', rating: 9 }),
      makePlayer({ id: 'v2', position: 'Linksachter', rating: 7 }),
      makePlayer({ id: 'm1', position: 'Centrale middenvelder', rating: 9 }),
      makePlayer({ id: 'm2', position: 'Defensieve middenvelder', rating: 4 }),
    ]
    const result = autoAssignTeams({ teams: teams2x3, current: [[], []], presentPlayers: present })

    // Beste keeper naar team0, maar de beste verdediger naar team1 — de
    // draftpositie/-richting zet door tussen de groepen.
    expect(result[0]).toContain('k1')
    expect(result[1]).toContain('v1')
    expect(result[0]).not.toContain('v1')
  })

  it('verdeelt ook spelers zonder (bekende) positie — de rest-groep gaat als laatste', () => {
    const teams2x2: OefeningTeam[] = [
      { grootte: 2, formaties: [] },
      { grootte: 2, formaties: [] },
    ]
    const present = [
      makePlayer({ id: 'k1', position: 'Keeper', rating: 8 }),
      makePlayer({ id: 'm1', position: 'Centrale middenvelder', rating: 7 }),
      makePlayerZonderPositie({ id: 'n1', rating: 6 }),
      makePlayerZonderPositie({ id: 'n2', rating: 4, position: 'Libero' }),
    ]
    const result = autoAssignTeams({ teams: teams2x2, current: [[], []], presentPlayers: present })

    // Niemand wordt overgeslagen.
    expect(result.flat().sort()).toEqual(['k1', 'm1', 'n1', 'n2'])
    // Volgorde: k1 (keeper) → m1 (midden) → n1, n2 (rest, op rating).
    expect(result).toEqual([
      ['k1', 'n2'],
      ['m1', 'n1'],
    ])
  })

  it('vult ook met positiegroepen alleen open plekken; bestaande toewijzingen blijven staan', () => {
    const current = [['v0'], []] as string[][]
    const present = [
      makePlayer({ id: 'v0', position: 'Centrale verdediger', rating: 9 }), // al ingedeeld
      makePlayer({ id: 'k1', position: 'Keeper', rating: 8 }),
      makePlayer({ id: 'k2', position: 'Keeper', rating: 7 }),
      makePlayer({ id: 'm1', position: 'Centrale middenvelder', rating: 6 }),
    ]
    const result = autoAssignTeams({ teams: teams2x3, current, presentPlayers: present })

    expect(result[0][0]).toBe('v0')
    expect(result.flat().filter((id) => id === 'v0')).toHaveLength(1)
    const teamVan = (id: string) => result.findIndex((t) => t.includes(id))
    expect(teamVan('k1')).not.toBe(teamVan('k2'))
    // current is niet in place gemuteerd.
    expect(current).toEqual([['v0'], []])
  })

  it('legt het overschot in het losse team en houdt de keepers gesplitst', () => {
    const teams: OefeningTeam[] = [
      { grootte: 2, formaties: [] },
      { grootte: 2, formaties: [] },
      { grootte: 0, formaties: [] }, // losse plaatsing
    ]
    const present = [
      makePlayer({ id: 'k1', position: 'Keeper', rating: 8 }),
      makePlayer({ id: 'k2', position: 'Keeper', rating: 7 }),
      makePlayer({ id: 'm1', position: 'Centrale middenvelder', rating: 9 }),
      makePlayer({ id: 'm2', position: 'Centrale middenvelder', rating: 6 }),
      makePlayer({ id: 'm3', position: 'Centrale middenvelder', rating: 5 }),
    ]
    const result = autoAssignTeams({ teams, current: [[], [], []], presentPlayers: present })

    expect(result[0]).toHaveLength(2)
    expect(result[1]).toHaveLength(2)
    expect(result[2]).toHaveLength(1) // overschot
    expect(result.flat().sort()).toEqual(['k1', 'k2', 'm1', 'm2', 'm3'])
    const teamVan = (id: string) => result.findIndex((t) => t.includes(id))
    expect(teamVan('k1')).not.toBe(teamVan('k2'))
  })

  it('laat het overschot in de pool als er geen los team is (met positiegroepen)', () => {
    const teams2x2: OefeningTeam[] = [
      { grootte: 2, formaties: [] },
      { grootte: 2, formaties: [] },
    ]
    const present = [
      makePlayer({ id: 'k1', position: 'Keeper', rating: 8 }),
      makePlayer({ id: 'k2', position: 'Keeper', rating: 7 }),
      makePlayer({ id: 'm1', position: 'Centrale middenvelder', rating: 9 }),
      makePlayer({ id: 'm2', position: 'Centrale middenvelder', rating: 6 }),
      makePlayer({ id: 'm3', position: 'Centrale middenvelder', rating: 5 }),
    ]
    const result = autoAssignTeams({ teams: teams2x2, current: [[], []], presentPlayers: present })

    expect(result.flat()).toHaveLength(4)
    // De laagst gerate middenvelder blijft in de pool; de keepers zijn gesplitst.
    expect(result.flat()).not.toContain('m3')
    const teamVan = (id: string) => result.findIndex((t) => t.includes(id))
    expect(teamVan('k1')).not.toBe(teamVan('k2'))
  })
})
