import { POSITION_GROUPS, type OefeningTeam, type Player } from '@/lib/types'

// Gedeelde, framework-agnostische logica voor de training-specifieke
// teamindeling (spelerindeling) van een gekoppelde oefening. Bewust géén
// 'use server': zo kan zowel de server action (training-plan.ts) als de client
// deze pure functies hergebruiken, en zijn ze los te testen.
//
// Vorm: string[][] — index = teamIndex binnen oefeningen.teams; elke sub-array
// is een lijst player_id's in dat team. Een player_id in geen enkele sub-array
// staat "in de pool".

const DEFAULT_RATING = 5

// ────────────────────────────────────────────────
// Validatie / normalisatie (server-side tenant-check)
// ────────────────────────────────────────────────
// Gooit een nette Error bij ongeldige input; retourneert anders een
// genormaliseerde string[][] met exact de aangeleverde sub-arrays.
export function validateSpelerindeling(
  input: unknown,
  opts: { teamCount: number; ownPlayerIds: Set<string> },
): string[][] {
  if (!Array.isArray(input)) throw new Error('Ongeldige spelerindeling')
  if (input.length > opts.teamCount) throw new Error('Team bestaat niet in deze oefening')

  const seen = new Set<string>()
  const clean: string[][] = []

  for (const sub of input) {
    if (!Array.isArray(sub)) throw new Error('Ongeldige spelerindeling')
    const team: string[] = []
    for (const id of sub) {
      if (typeof id !== 'string') throw new Error('Ongeldige spelerindeling')
      // Tenant-check: elk id moet een eigen speler zijn.
      if (!opts.ownPlayerIds.has(id)) throw new Error('Speler niet gevonden')
      // Een speler mag in maximaal één team staan.
      if (seen.has(id)) throw new Error('Speler in meerdere teams')
      seen.add(id)
      team.push(id)
    }
    clean.push(team)
  }

  return clean
}

// ────────────────────────────────────────────────
// Automatisch indelen
// ────────────────────────────────────────────────
// Vult ALLEEN open plekken aan; bestaande toewijzingen in `current` blijven
// ongewijzigd. Alleen aanwezige spelers die nog niet ingedeeld zijn worden
// verdeeld.
//
// Balanceren gebeurt op rating ÉN positie, via één doorlopende snake-draft:
// - De beschikbare spelers worden gegroepeerd per positiegroep
//   (POSITION_GROUPS uit lib/types.ts), in die volgorde: Keepers → Verdedigers
//   → Middenvelders → Aanvallers. Spelers zonder positie (of met een positie
//   die in geen enkele groep valt) vormen een laatste "rest"-groep.
// - Binnen elke groep gaat de sterkste speler eerst (rating hoog → laag,
//   tiebreak op id voor determinisme).
// - De snake-volgorde LOOPT DOOR over de groepen heen: er is één draftvolgorde
//   voor alle open plekken samen en de groepen worden er achter elkaar in
//   geschoven. Zou elke groep opnieuw bij team 0 beginnen, dan kreeg team 0
//   stelselmatig de beste speler van élke groep; door de draftpositie én
//   -richting door te zetten blijft het totaal gebalanceerd.
// Gevolg: twee keepers belanden in verschillende teams zolang er meerdere teams
// met open plekken zijn. Teams kennen géén positie-slots (formatie is
// uitsluitend de visuele vorm per team), dus verder is er geen positie-fit.
//
// Losse plaatsing (bevestigd besluit): een team ZONDER grootte (grootte <= 0 of
// niet-eindig) heeft geen limiet. Het OVERSCHOT — resterende aanwezige spelers
// na het vullen van alle teams-mét-grootte — komt in het/de losse team(s).
// Zijn er meerdere losse teams, dan wordt het overschot gebalanceerd (snake)
// verdeeld. Zijn er geen losse teams, dan blijft het overschot in de pool.
export function autoAssignTeams(params: {
  teams: OefeningTeam[]
  current: string[][]
  presentPlayers: Player[]
}): string[][] {
  const { teams, current, presentPlayers } = params

  // Nieuwe result-structuur (muteer `current` niet in place). Eén sub-array per
  // team, bestaande toewijzingen behouden.
  const result: string[][] = teams.map((_, i) => (current[i] ?? []).slice())

  // Reeds ingedeelde spelers (over alle teams heen).
  const assigned = new Set<string>()
  for (const team of result) for (const id of team) assigned.add(id)

  // Aanwezige spelers die nog niet ingedeeld zijn, gesorteerd op positiegroep
  // (POSITION_GROUPS-volgorde, rest-groep achteraan) en binnen elke groep op
  // rating (hoog → laag). Tiebreak op id voor determinisme. Deze ene lijst gaat
  // straks door één doorlopende snake-draft, zodat elke groep over de teams
  // gespreid wordt zonder dat team 0 telkens de eerste pick van een groep krijgt.
  const available = presentPlayers
    .filter((p) => !assigned.has(p.id))
    .map((p) => ({ p, group: positionGroupIndex(p) }))
    .sort(
      (a, b) =>
        a.group - b.group ||
        (b.p.rating ?? DEFAULT_RATING) - (a.p.rating ?? DEFAULT_RATING) ||
        (a.p.id < b.p.id ? -1 : 1),
    )
    .map(({ p }) => p)

  const hasSize = (i: number) => Number.isFinite(teams[i].grootte) && teams[i].grootte > 0
  const sizedIndices = teams.map((_, i) => i).filter((i) => hasSize(i))
  const looseIndices = teams.map((_, i) => i).filter((i) => !hasSize(i))

  // Open plekken per team-met-grootte.
  const openSlots = new Map<number, number>()
  for (const i of sizedIndices) {
    openSlots.set(i, Math.max(0, teams[i].grootte - result[i].length))
  }

  // Snake-volgorde van teamIndex-picks, begrensd door de open plekken.
  const draftOrder = snakeOrderWithLimits(sizedIndices, openSlots)

  let cursor = 0
  for (const teamIdx of draftOrder) {
    if (cursor >= available.length) break
    result[teamIdx].push(available[cursor].id)
    cursor++
  }

  // Overschot: resterende aanwezigen na de teams-met-grootte.
  const overflow = available.slice(cursor)
  if (overflow.length > 0 && looseIndices.length > 0) {
    const looseOrder = snakePicks(looseIndices, overflow.length)
    overflow.forEach((p, k) => result[looseOrder[k]].push(p.id))
  }
  // Zonder losse teams blijft het overschot buiten de indeling (in de pool).

  return result
}

// Index van de positiegroep (POSITION_GROUPS) waarin een speler valt. Spelers
// zonder positie — of met een positie die in geen enkele groep zit — krijgen
// POSITION_GROUPS.length en vormen zo samen de laatste "rest"-groep. Ze worden
// dus wél verdeeld, alleen als laatste.
function positionGroupIndex(player: Player): number {
  const pos = player.position
  if (!pos) return POSITION_GROUPS.length
  const idx = POSITION_GROUPS.findIndex((g) => g.positions.includes(pos))
  return idx === -1 ? POSITION_GROUPS.length : idx
}

// Snake-draft over teamIndices, met per team een maximaal aantal picks. Elke
// ronde loopt de teams heen-en-weer (0..n, n..0) zodat de sterkste spelers
// gelijkmatig verdeeld worden.
function snakeOrderWithLimits(teamIndices: number[], limits: Map<number, number>): number[] {
  const order: number[] = []
  const remaining = new Map<number, number>()
  for (const i of teamIndices) remaining.set(i, limits.get(i) ?? 0)

  let forward = true
  while (teamIndices.some((i) => (remaining.get(i) ?? 0) > 0)) {
    const seq = forward ? teamIndices : [...teamIndices].reverse()
    let picked = false
    for (const i of seq) {
      if ((remaining.get(i) ?? 0) > 0) {
        order.push(i)
        remaining.set(i, (remaining.get(i) ?? 0) - 1)
        picked = true
      }
    }
    if (!picked) break
    forward = !forward
  }
  return order
}

// Genereert `count` teamIndex-picks in snake-volgorde over teamIndices, zonder
// limiet (voor het gebalanceerd verdelen van het overschot over losse teams).
function snakePicks(teamIndices: number[], count: number): number[] {
  const picks: number[] = []
  let forward = true
  while (picks.length < count) {
    const seq = forward ? teamIndices : [...teamIndices].reverse()
    for (const i of seq) {
      if (picks.length >= count) break
      picks.push(i)
    }
    forward = !forward
  }
  return picks
}
