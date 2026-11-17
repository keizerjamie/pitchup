import type { Player, Position } from '@/lib/types'

// Pure, framework-agnostische sorteerlogica voor de aanwezigheidslijst van een
// training. Bewust géén React en geen Supabase: de component roept dit aan in
// een useMemo en de functie is los te testen (zelfde opzet als
// sortSquadForExport in lib/match-squad.ts).

// Veldvolgorde voor de aanwezigheidslijst: van achter naar voren en binnen
// elke linie van rechts naar links. Bewust een EIGEN constante en niet
// POSITIONS uit lib/types.ts: die heeft een andere volgorde en wordt elders
// (o.a. lib/inzichten.ts) gebruikt, dus die blijft onaangeroerd.
export const AANWEZIGHEID_POSITIE_VOLGORDE: readonly Position[] = [
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
]

// Index in AANWEZIGHEID_POSITIE_VOLGORDE. Een onbekende of lege positie krijgt
// de lengte van de lijst en belandt zo achteraan (vangnet, zelfde idee als
// positionGroupIndex in lib/spelerindeling.ts). Sorteert op de DB-waarde,
// nooit op een vertaald label.
function positieIndex(player: Player): number {
  const idx = AANWEZIGHEID_POSITIE_VOLGORDE.indexOf(player.position)
  return idx === -1 ? AANWEZIGHEID_POSITIE_VOLGORDE.length : idx
}

// Splitst de spelers in vaste spelers en gastspelers (type === 'guest' is gast,
// al het andere telt als vast — zelfde split als lib/aanwezigheid-telling.ts)
// en sorteert beide blokken op: positie-index → naam (taalcorrect via
// localeCompare, dus Ödegaard naast Odegaard) → id, zodat de volgorde altijd
// deterministisch is. Alleen de PRIMAIRE positie telt; secondary_positions en
// jersey_number worden bewust niet gelezen. De volgorde hangt nooit af van
// aanwezigheidsstatussen. De input wordt niet gemuteerd.
export function sorteerAanwezigheidslijst(
  players: Player[],
  locale: string,
): { vast: Player[]; gasten: Player[] } {
  const opPositieDanNaam = (a: Player, b: Player) =>
    positieIndex(a) - positieIndex(b)
    || a.name.localeCompare(b.name, locale)
    || a.id.localeCompare(b.id)

  const vast: Player[] = []
  const gasten: Player[] = []
  for (const p of players) {
    if (p.type === 'guest') gasten.push(p)
    else vast.push(p)
  }

  return { vast: vast.sort(opPositieDanNaam), gasten: gasten.sort(opPositieDanNaam) }
}
