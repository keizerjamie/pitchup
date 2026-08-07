import type { Player } from '@/lib/types'

// Gedeelde, framework-agnostische sorteerlogica voor de wedstrijdselectie.
// Bewust géén 'use server' en geen React: zowel de server action als de
// (server-)componenten kunnen deze pure functie hergebruiken en hij is los te
// testen.

// Keepers eerst, daarna de veldspelers, binnen beide groepen alfabetisch op
// naam. Keeper-test is uitsluitend de PRIMAIRE positie: secondary_positions
// telt niet mee, anders zou een veldspeler die kan keepen bovenaan de lijst
// belanden. `localeCompare` sorteert diakrieten en hoofdletters taalcorrect
// (Ödegaard naast Odegaard, niet achter Z). Bij identieke namen valt de
// vergelijking terug op het id, zodat de volgorde deterministisch blijft.
//
// Geeft een PLATTE, gesorteerde array terug — bewust geen
// {keepers, fieldPlayers}-object: de groepsgrens is zo niet uitdrukbaar in de
// consumerende laag, en de keeper-voorrang zit puur in de comparator.
// De input wordt niet gemuteerd.
export function sortSquadForExport(players: Player[], locale: string): Player[] {
  const byKeeperThenName = (a: Player, b: Player) =>
    Number(b.position === 'Keeper') - Number(a.position === 'Keeper')
    || a.name.localeCompare(b.name, locale)
    || a.id.localeCompare(b.id)

  return [...players].sort(byKeeperThenName)
}
